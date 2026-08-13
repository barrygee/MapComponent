"""Typed async HTTP client for one Sentry host's management API (ADR-0009).

Sentry stays the source of truth for SDR device configuration; Sentinel is a
full remote client of its existing `/api` surface. This module is that
client — one instance per Sentry host, built from a `backend.models.SentryHost`
row. It does not reimplement any of Sentry's validation (port allocation, name
uniqueness, device state) — it only shapes the HTTP call and translates the
response into either a value or one of two typed errors, so a caller can
always tell "the Pi was unreachable" apart from "Sentry rejected the request".

Security notes:
- `address` is operator input used to build a URL, so it is validated against
  a strict hostname/IPv4 allow-list before ever reaching httpx — no scheme, no
  embedded credentials, no path, no port suffix (the port is a separate,
  independently-bounded field).
- The bearer token is never logged, never included in an exception message,
  and never echoed back by any caller of this module.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
from backend.config import settings

# The header Sentry stamps on every /api response (including errors) per ADR-0009.
SESSION_COOKIE_NAME = "sentry_session"
"""Sentry's session cookie (its `services/console_auth.py`).

Duplicated here rather than imported for the obvious reason — Sentry is a
separate service — which makes it part of the wire contract between the two,
alongside the paths and payload shapes this module already hard-codes.
"""

API_VERSION_HEADER = "X-Sentry-Api-Version"

# RFC-1123-ish hostname: labels of 1-63 alphanumerics/hyphens/underscores (no
# leading/trailing hyphen), dot-separated, 253 characters overall. Deliberately
# does not accept a trailing dot or wildcards — this is a concrete host to
# connect to, not a DNS pattern.
#
# Underscores are allowed despite RFC 1123 forbidding them, matching the same
# decision in Sentry's `routers/host_resolution.py`. They turn up often enough
# in real LAN names (Windows and mDNS both emit them) that rejecting one would
# leave an operator unable to add their Pi by the only name they have for it,
# with nothing but a validation error to explain why.
_HOSTNAME_RE = re.compile(r"^(?!-)[A-Za-z0-9_-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9_-]{1,63}(?<!-))*$")

# Substrings that mean the operator pasted a URL, a credential, or a path
# rather than a bare host — reject outright rather than trying to parse them.
_FORBIDDEN_ADDRESS_SUBSTRINGS = ("://", "@", "/", " ", "\t", "\n")


def validate_sentry_address(address: str) -> str:
    """Validate an operator-supplied Sentry host address.

    Accepts a bare IPv4 literal or an RFC-1123-style hostname only. Rejects
    anything that looks like a URL, embedded credentials, a path, or an IPv6
    literal/port suffix (the port is configured separately and independently
    bounded). Raises ``ValueError`` with an operator-facing message on
    rejection; callers surface that message directly to the client as a 422.
    """
    candidate = address.strip()
    if not candidate:
        raise ValueError("Host address must not be empty.")
    if len(candidate) > 253:
        raise ValueError("Host address is too long.")
    for forbidden in _FORBIDDEN_ADDRESS_SUBSTRINGS:
        if forbidden in candidate:
            raise ValueError(
                "Host address must be a bare hostname or IPv4 address — no scheme, credentials, path, or whitespace."
            )
    if ":" in candidate:
        raise ValueError("Host address must not include a port and may not be an IPv6 literal — use the port field.")
    try:
        ipaddress.IPv4Address(candidate)
        return candidate
    except ValueError:
        pass
    if not _HOSTNAME_RE.match(candidate):
        raise ValueError("Host address must be a valid hostname or IPv4 address.")
    return candidate


def validate_sentry_port(port: int) -> int:
    """Constrain a Sentry host port to the valid TCP port range."""
    if not (1 <= port <= 65535):
        raise ValueError("Port must be between 1 and 65535.")
    return port


class SentryUnreachableError(Exception):
    """Raised when a Sentry host could not be reached at all (DNS/connect/timeout).

    Distinct from `SentryApiError`: this means Sentinel never got an HTTP
    response to interpret, so there is no Sentry-authored `{code, message}` to
    surface — only Sentinel's own description of the network failure.
    """


class SentryApiError(Exception):
    """Raised when Sentry answered with a non-2xx status.

    Carries Sentry's own error envelope (`code`, `message`, and any extra
    context keys) verbatim, per ADR-0009's requirement that Sentinel surface
    Sentry's rejection rather than inventing its own.
    """

    def __init__(self, status_code: int, code: str, message: str, context: dict[str, Any] | None = None) -> None:
        super().__init__(f"Sentry API error {status_code} {code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.context = context or {}


@dataclass
class SentryResponse:
    """A successful Sentry response — the decoded JSON body plus the observed API version."""

    data: Any
    api_version: str | None


class SentryClient:
    """Async client for one Sentry host's `/api` surface.

    Construct one per call (or short-lived per poll) from a `SentryHost` row;
    it is cheap — the underlying `httpx.AsyncClient` is opened and closed per
    request rather than held open, since Sentry hosts are polled at a low,
    known rate and this avoids managing a long-lived connection pool per host
    across process restarts/config edits.
    """

    def __init__(
        self,
        address: str,
        port: int,
        console_password: str,
        *,
        connect_timeout_s: float | None = None,
        read_timeout_s: float | None = None,
    ) -> None:
        """`console_password` is Sentry's console password, not a bearer token.

        Sentry has no token auth. It was removed by Sentry's ADR-0010 in favour
        of one console password proved by a signed `sentry_session` cookie, and
        `app/backend/security.py` there reads the cookie and nothing else — so
        the `Authorization: Bearer` header this client used to send was accepted
        by nobody and silently ignored, leaving every management call 401 against
        a protected Sentry.
        """
        self._address = validate_sentry_address(address)
        self._port = validate_sentry_port(port)
        self._console_password = console_password
        self._session_cookie: str | None = None
        connect = connect_timeout_s if connect_timeout_s is not None else settings.sentry_connect_timeout_s
        read = read_timeout_s if read_timeout_s is not None else settings.sentry_read_timeout_s
        self._timeout = httpx.Timeout(connect=connect, read=read, write=read, pool=read)

    @property
    def base_url(self) -> str:
        """The validated `http://host:port` this client talks to."""
        return f"http://{self._address}:{self._port}"

    def _headers(self) -> dict[str, str]:
        """Request headers, carrying the session cookie once one has been obtained.

        The cookie is set by hand rather than by an `httpx` cookie jar: a client
        is constructed per request here (see the class docstring), so a jar would
        be discarded before it could ever be reused.
        """
        headers = {"Accept": "application/json"}
        if self._session_cookie:
            headers["Cookie"] = f"{SESSION_COOKIE_NAME}={self._session_cookie}"
        return headers

    async def _sign_in(self) -> bool:
        """Exchange the console password for a session cookie. False if it cannot.

        Silent about *why* it failed, deliberately: Sentry answers every auth
        failure identically on purpose, so there is nothing here to distinguish
        a wrong password from a password that was since changed.
        """
        if not self._console_password:
            return False
        url = f"{self.base_url}/api/auth/login"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, json={"password": self._console_password})
        except httpx.HTTPError:
            return False
        if response.status_code >= 400:
            return False
        cookie = response.cookies.get(SESSION_COOKIE_NAME)
        if not cookie:
            return False
        self._session_cookie = cookie
        return True

    async def _request(self, method: str, path: str, *, json_body: dict[str, Any] | None = None) -> SentryResponse:
        """Perform one request, translating transport/HTTP failures into the typed errors above.

        Signs in and retries **once** on a 401. A session outlives many requests
        but not for ever — it lapses, and it is invalidated outright whenever the
        operator changes Sentry's password — so the first call after that would
        otherwise fail for a reason the caller can do nothing about. Retried once
        only: a second 401 means the password is wrong, and looping on it would
        turn a typo into a login flood.
        """
        response = await self._send(method, path, json_body=json_body)
        if response.status_code == 401 and await self._sign_in():
            response = await self._send(method, path, json_body=json_body)

        api_version = response.headers.get(API_VERSION_HEADER)
        if response.status_code >= 400:
            code, message, context = _parse_error_envelope(response)
            raise SentryApiError(response.status_code, code, message, context)
        if response.status_code == 204 or not response.content:
            return SentryResponse(data=None, api_version=api_version)
        try:
            payload = response.json()
        except ValueError as exc:
            raise SentryApiError(
                response.status_code, "invalid_response", "Sentry returned a non-JSON response."
            ) from exc
        return SentryResponse(data=payload, api_version=api_version)

    async def _send(self, method: str, path: str, *, json_body: dict[str, Any] | None = None) -> httpx.Response:
        """One HTTP round trip, with transport failures raised as `SentryUnreachableError`."""
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                return await client.request(method, url, headers=self._headers(), json=json_body)
        except httpx.TimeoutException as exc:
            raise SentryUnreachableError(f"Timed out reaching Sentry host {self._address}:{self._port}.") from exc
        except httpx.HTTPError as exc:
            raise SentryUnreachableError(f"Could not reach Sentry host {self._address}:{self._port}.") from exc

    # ── health / status ──────────────────────────────────────────────────────
    async def get_health(self) -> SentryResponse:
        """`GET /api/health` — unauthenticated liveness probe."""
        return await self._request("GET", "/api/health")

    async def get_status(self) -> SentryResponse:
        """`GET /api/status` — the live per-device snapshot the fleet poller caches."""
        return await self._request("GET", "/api/status")

    # ── devices ──────────────────────────────────────────────────────────────
    async def get_devices(self) -> SentryResponse:
        """`GET /api/devices` — configured + detected devices, port suggestion, constraints."""
        return await self._request("GET", "/api/devices")

    async def patch_device(self, device_id: str, patch: dict[str, Any]) -> SentryResponse:
        """`PATCH /api/devices/{device_id}` — partial update; Sentry validates and may reject."""
        return await self._request("PATCH", f"/api/devices/{_encode_path_segment(device_id)}", json_body=patch)

    async def delete_device(self, device_id: str) -> SentryResponse:
        """`DELETE /api/devices/{device_id}` — remove a persisted (not-present) device's config."""
        return await self._request("DELETE", f"/api/devices/{_encode_path_segment(device_id)}")

    async def flash_serial(self, device_id: str, serial: str) -> SentryResponse:
        """`POST /api/devices/{device_id}/serial` — begin an EEPROM serial flash. Always confirmed."""
        return await self._request(
            "POST",
            f"/api/devices/{_encode_path_segment(device_id)}/serial",
            json_body={"serial": serial, "confirm": True},
        )

    # ── hotspot ──────────────────────────────────────────────────────────────
    async def get_hotspot(self) -> SentryResponse:
        """`GET /api/hotspot` — current hotspot configuration and state."""
        return await self._request("GET", "/api/hotspot")

    async def get_hotspot_interfaces(self) -> SentryResponse:
        """`GET /api/hotspot/interfaces` — candidate wireless interfaces."""
        return await self._request("GET", "/api/hotspot/interfaces")

    async def get_hotspot_clients(self) -> SentryResponse:
        """`GET /api/hotspot/clients` — DHCP leases the hotspot has issued."""
        return await self._request("GET", "/api/hotspot/clients")

    async def put_hotspot(self, body: dict[str, Any]) -> SentryResponse:
        """`PUT /api/hotspot` — full-replace the hotspot configuration."""
        return await self._request("PUT", "/api/hotspot", json_body=body)

    async def enable_hotspot(self, confirm_uplink_loss: bool = False) -> SentryResponse:
        """`POST /api/hotspot/enable` — bring the hotspot up provisionally (rolls back unless confirmed)."""
        return await self._request(
            "POST", "/api/hotspot/enable", json_body={"confirm_uplink_loss": confirm_uplink_loss}
        )

    async def disable_hotspot(self, confirm_uplink_loss: bool = False) -> SentryResponse:
        """`POST /api/hotspot/disable` — stop the hotspot and clear its autoconnect flag."""
        return await self._request(
            "POST", "/api/hotspot/disable", json_body={"confirm_uplink_loss": confirm_uplink_loss}
        )

    async def confirm_hotspot(self) -> SentryResponse:
        """`POST /api/hotspot/confirm` — cancel the pending rollback of a just-enabled hotspot.

        Safety-critical (ADR-0009 / Sentry ADR-0007): must only be invoked when
        the operator explicitly confirms, never automatically after `enable`.
        """
        return await self._request("POST", "/api/hotspot/confirm")

    async def delete_hotspot(self) -> SentryResponse:
        """`DELETE /api/hotspot` — forget the hotspot configuration entirely, including its password."""
        return await self._request("DELETE", "/api/hotspot")


def _encode_path_segment(value: str) -> str:
    """Percent-encode one path segment (device ids contain ':' and '.', e.g. "usb:1-1.4.2")."""
    return quote(value, safe="")


def _parse_error_envelope(response: httpx.Response) -> tuple[str, str, dict[str, Any]]:
    """Extract `(code, message, context)` from Sentry's `{"detail": {"code", "message", ...}}` envelope.

    Falls back to a generic `upstream_error` when the body doesn't match the
    expected shape (e.g. a proxy/500 page instead of Sentry itself), so a
    malformed upstream response never raises an unhandled exception here.

    Three shapes arrive in practice:
    - `{"detail": {"code": ..., "message": ...}}` — Sentry's own envelope, the
      one that carries a code worth branching on.
    - `{"detail": [ {loc, msg}, ... ]}` — FastAPI's *Pydantic* 422, raised
      before the request ever reaches Sentry's own validation. There is no
      Sentry-authored code here, but the field-level messages are the most
      useful thing an operator can be shown, so they are flattened into the
      message rather than discarded behind a bare "HTTP 422".
    - `{"detail": "some string"}` — a plain `HTTPException(detail=str)`.
    """
    generic_message = f"Sentry returned HTTP {response.status_code}."
    try:
        body = response.json()
    except ValueError:
        return "upstream_error", generic_message, {}

    detail = body.get("detail") if isinstance(body, dict) else None

    if isinstance(detail, dict):
        code = str(detail.get("code", "upstream_error"))
        message = str(detail.get("message", generic_message))
        context = {key: value for key, value in detail.items() if key not in ("code", "message")}
        return code, message, context

    if isinstance(detail, list):
        return "validation_error", _describe_validation_errors(detail, generic_message), {"errors": detail}

    if isinstance(detail, str):
        return "upstream_error", detail, {}

    return "upstream_error", generic_message, {}


def _describe_validation_errors(errors: list[Any], fallback: str) -> str:
    """Render FastAPI's list-shaped 422 body as one operator-readable sentence.

    `loc` is a path like `["body", "output_port"]`; the leading `"body"`/`"query"`
    segment names the part of the request rather than the field, so it is dropped
    to leave the field name the operator actually recognises.
    """
    described: list[str] = []
    for entry in errors:
        if not isinstance(entry, dict):
            continue
        message = str(entry.get("msg", "")).strip()
        if not message:
            continue
        location = [str(part) for part in entry.get("loc", []) if str(part) not in ("body", "query", "path")]
        described.append(f"{'.'.join(location)}: {message}" if location else message)
    return "; ".join(described) if described else fallback
