"""Sentry-host router — Sentinel's client surface onto one or more Sentry instances.

Per ADR-0009, Sentry (a Raspberry Pi running rtl_tcp dongles) stays the source
of truth for device configuration; Sentinel is a full remote client of its
`/api` surface plus a small local record of which hosts exist. This router
never reimplements Sentry's validation (port allocation, name uniqueness,
device state) — every device/hotspot mutation is proxied to Sentry and its
rejection propagated verbatim.

Endpoints:
  GET    /api/sdr/sentry-hosts                                   — list known Sentry hosts
  POST   /api/sdr/sentry-hosts                                   — register a new host
  GET    /api/sdr/sentry-hosts/{host_id}                         — one host's record
  PUT    /api/sdr/sentry-hosts/{host_id}                         — update a host
  DELETE /api/sdr/sentry-hosts/{host_id}                         — forget a host
  POST   /api/sdr/sentry-hosts/{host_id}/test                    — probe GET /api/health
  GET    /api/sdr/sentry-hosts/{host_id}/info                    — everything known about a host
  GET    /api/sdr/sentry-hosts/locations                         — every host with a known position

  GET    /api/sdr/sentry-hosts/{host_id}/devices                 — cached status snapshot
  PATCH  /api/sdr/sentry-hosts/{host_id}/devices/{device_id}     — proxy PATCH /api/devices/{id}
  DELETE /api/sdr/sentry-hosts/{host_id}/devices/{device_id}     — proxy DELETE /api/devices/{id}
  POST   /api/sdr/sentry-hosts/{host_id}/devices/{device_id}/serial — proxy the EEPROM flash

  GET    /api/sdr/sentry-hosts/{host_id}/wifi                    — proxy GET /api/hotspot
  PUT    /api/sdr/sentry-hosts/{host_id}/wifi                    — proxy PUT /api/hotspot
  DELETE /api/sdr/sentry-hosts/{host_id}/wifi                    — proxy DELETE /api/hotspot
  POST   /api/sdr/sentry-hosts/{host_id}/wifi/enable             — proxy POST /api/hotspot/enable
  POST   /api/sdr/sentry-hosts/{host_id}/wifi/disable            — proxy POST /api/hotspot/disable
  POST   /api/sdr/sentry-hosts/{host_id}/wifi/confirm            — proxy POST /api/hotspot/confirm
  GET    /api/sdr/sentry-hosts/{host_id}/wifi/interfaces         — proxy GET /api/hotspot/interfaces
  GET    /api/sdr/sentry-hosts/{host_id}/wifi/clients            — proxy GET /api/hotspot/clients

`auth_token` is write-only: accepted on POST/PUT, never returned in any
response body (only a boolean `auth_token_set`).
"""

from __future__ import annotations

import logging
from typing import Any, NoReturn

from backend.cache import now_ms
from backend.database import get_db
from backend.models import SentryHost
from backend.services.sentry_client import (
    SentryApiError,
    SentryClient,
    SentryUnreachableError,
    validate_sentry_address,
    validate_sentry_port,
)
from backend.services.sentry_fleet import fleet_poller
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sdr/sentry-hosts", tags=["sentry"])

_MAX_NAME_LEN = 120
_MAX_TOKEN_LEN = 512
_SERIAL_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class SentryHostIn(BaseModel):
    """Body for `POST /api/sdr/sentry-hosts` — register a new Sentry host."""

    name: str | None = None
    address: str
    port: int = 8000
    auth_token: str = ""
    enabled: bool = True

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        try:
            return validate_sentry_address(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("port")
    @classmethod
    def _validate_port(cls, value: int) -> int:
        try:
            return validate_sentry_port(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > _MAX_NAME_LEN:
            raise ValueError(f"name too long (max {_MAX_NAME_LEN} characters)")
        return cleaned or None

    @field_validator("auth_token")
    @classmethod
    def _bound_token(cls, value: str) -> str:
        if len(value) > _MAX_TOKEN_LEN:
            raise ValueError(f"auth_token too long (max {_MAX_TOKEN_LEN} characters)")
        return value


class SentryHostPatch(BaseModel):
    """Body for `PUT /api/sdr/sentry-hosts/{host_id}` — all fields optional, at least one required.

    Mirrors Sentry's own hotspot-PUT convention (architecture: Sentry
    `HotspotConfigRequest`): omitting `auth_token` keeps the currently stored
    token, which is what keeps the secret write-only end to end — an operator
    editing the address never has to re-paste a token they can no longer see.
    """

    name: str | None = None
    address: str | None = None
    port: int | None = None
    auth_token: str | None = None
    enabled: bool | None = None

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return validate_sentry_address(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("port")
    @classmethod
    def _validate_port(cls, value: int | None) -> int | None:
        if value is None:
            return None
        try:
            return validate_sentry_port(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > _MAX_NAME_LEN:
            raise ValueError(f"name too long (max {_MAX_NAME_LEN} characters)")
        return cleaned or None

    @field_validator("auth_token")
    @classmethod
    def _bound_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value) > _MAX_TOKEN_LEN:
            raise ValueError(f"auth_token too long (max {_MAX_TOKEN_LEN} characters)")
        return value

    @model_validator(mode="after")
    def _require_at_least_one_field(self) -> SentryHostPatch:
        """Reject a body that names no fields at all.

        Tested against `model_fields_set` — which fields the client actually
        sent — rather than the resulting values. Testing the values conflates
        "you sent nothing" with "everything you sent normalised to null", so
        clearing the host's label (`{"name": "  "}`, which strips to null) came
        back as "At least one field must be provided", an error about a
        different mistake than the one the operator made.
        """
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided.")
        return self


class SentryHostOut(BaseModel):
    """Response shape for a Sentry host — never carries the auth token itself."""

    id: int
    name: str | None
    address: str
    port: int
    enabled: bool
    auth_token_set: bool
    created_at: int
    last_seen_at: int | None
    last_error: str | None
    reachable: bool
    api_version: str | None


class HealthProbeResult(BaseModel):
    """Response for `POST /api/sdr/sentry-hosts/{host_id}/test`."""

    reachable: bool
    detail: str
    api_version: str | None = None
    health: dict[str, Any] | None = None


class SentryLocationOut(BaseModel):
    """Where the Sentry itself is, as it reports it in `/api/v1/sdrs`'s `source.location`.

    Every field is optional: a Sentry that has never had its position set
    reports `location: null`, which is a normal state, not an error.
    """

    latitude: float | None = None
    longitude: float | None = None
    updated_at: int | None = None


class SentrySourceOut(BaseModel):
    """The `source` block of `/api/v1/sdrs` — the Sentry's own description of itself."""

    name: str | None = None
    version: str | None = None
    host: str | None = None
    http_port: int | None = None
    location: SentryLocationOut | None = None


class SentryHostInfoOut(SentryHostOut):
    """Everything Sentinel knows about one Sentry host, for the details view.

    A superset of `SentryHostOut`: the stored record, the poller's telemetry,
    and a live read of the two *unauthenticated* Sentry endpoints that carry
    the rest — `GET /api/health` (version, uptime, database/hotplug health,
    device counts) and `GET /api/v1/sdrs` (the `source` block, which is the
    only place the Sentry's latitude/longitude is published). Both are
    unauthenticated by Sentry's design (its ADR-0010), so this still fills in
    for a host whose console password Sentinel does not hold.

    Never raises for an unreachable host — `reachable`/`detail` report that,
    and the live blocks come back null, so a Pi that is off the network renders
    as a details view with gaps rather than as an error.
    """

    detail: str
    last_polled_at: int | None = None
    last_success_at: int | None = None
    health: dict[str, Any] | None = None
    source: SentrySourceOut | None = None
    location: SentryLocationOut | None = None
    control_port_offset: int | None = None


class SentrySiteOut(BaseModel):
    """One Sentry host that has told Sentinel where it is — a point for the domain maps.

    Only hosts with a usable position appear, so every entry carries a real
    latitude/longitude rather than the nullable pair `SentryLocationOut` uses:
    a map plots points, and "somewhere unknown" is not one.
    """

    id: int
    name: str | None
    address: str
    port: int
    reachable: bool
    latitude: float
    longitude: float
    # When the Sentry says it last updated its own position (Unix ms), if it says.
    updated_at: int | None = None


class DeviceSnapshotOut(BaseModel):
    """Response for `GET /api/sdr/sentry-hosts/{host_id}/devices` — the cached poll snapshot."""

    reachable: bool
    last_error: str | None
    last_polled_at: int | None
    last_success_at: int | None
    api_version: str | None
    status: dict[str, Any] | None  # raw GET /api/status body: {generated_at, sdrs}


class SerialFlashIn(BaseModel):
    """Body for `POST .../devices/{device_id}/serial` — mirrors Sentry's own `SerialFlashRequest`.

    Validated here too (defence-in-depth, not a substitute for Sentry's own
    check) so an obviously malformed serial never leaves Sentinel.
    """

    serial: str
    confirm: bool

    @field_validator("serial")
    @classmethod
    def _validate_serial(cls, value: str) -> str:
        import re

        if not re.match(_SERIAL_PATTERN, value):
            raise ValueError("serial must be 1-32 characters of letters, digits, '_' or '-'.")
        return value

    @field_validator("confirm")
    @classmethod
    def _require_true(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("confirm must be true — a destructive hardware write requires explicit intent.")
        return value


class WifiConfigIn(BaseModel):
    """Body for `PUT /api/sdr/sentry-hosts/{host_id}/wifi` — mirrors Sentry's `HotspotConfigRequest`.

    `passphrase` is optional and write-only: omit it to keep the currently
    stored one (Sentry's own semantics), and it is never present on any
    response this router returns.
    """

    ssid: str
    passphrase: str | None = None
    security: str = "wpa2"
    hidden: bool = True
    enabled: bool = False
    interface: str | None = None
    band: str = "bg"
    channel: int = 0
    gateway_cidr: str | None = None
    confirm_uplink_loss: bool = False

    @field_validator("ssid")
    @classmethod
    def _validate_ssid(cls, value: str) -> str:
        encoded_len = len(value.encode("utf-8"))
        if not (1 <= encoded_len <= 32):
            raise ValueError("ssid must be 1-32 UTF-8 bytes.")
        return value

    @field_validator("security")
    @classmethod
    def _validate_security(cls, value: str) -> str:
        if value not in ("wpa2", "wpa3"):
            raise ValueError("security must be 'wpa2' or 'wpa3'.")
        return value

    @field_validator("band")
    @classmethod
    def _validate_band(cls, value: str) -> str:
        if value not in ("bg", "a"):
            raise ValueError("band must be 'bg' or 'a'.")
        return value

    @field_validator("channel")
    @classmethod
    def _validate_channel(cls, value: int) -> int:
        if not (0 <= value <= 196):
            raise ValueError("channel must be between 0 and 196.")
        return value

    @field_validator("interface")
    @classmethod
    def _validate_interface(cls, value: str | None) -> str | None:
        import re

        if value is not None and not re.match(r"^[A-Za-z0-9_.-]{1,15}$", value):
            raise ValueError("interface must be 1-15 characters of letters, digits, '_', '.', or '-'.")
        return value


class WifiActivationIn(BaseModel):
    """Body shared by `POST .../wifi/enable` and `.../wifi/disable`."""

    confirm_uplink_loss: bool = False


# ── Shared helpers ────────────────────────────────────────────────────────────


async def _get_host_or_404(host_id: int, db: AsyncSession) -> SentryHost:
    """Fetch a SentryHost row or raise 404 without leaking anything about its token."""
    host = await db.get(SentryHost, host_id)
    if host is None:
        raise HTTPException(status_code=404, detail={"code": "unknown_host", "message": "No such Sentry host."})
    return host


def _client_for(host: SentryHost) -> SentryClient:
    return SentryClient(host.address, host.port, host.auth_token)


def _host_to_out(host: SentryHost) -> SentryHostOut:
    """Build the response schema for a host, overlaying the poller's live reachability."""
    snapshot = fleet_poller.get_snapshot(host.id)
    return SentryHostOut(
        id=host.id,
        name=host.name,
        address=host.address,
        port=host.port,
        enabled=host.enabled,
        auth_token_set=bool(host.auth_token),
        created_at=host.created_at,
        last_seen_at=host.last_seen_at,
        last_error=host.last_error,
        reachable=snapshot.reachable if snapshot is not None else False,
        api_version=snapshot.api_version if snapshot is not None else None,
    )


def _raise_for_sentry_error(exc: SentryApiError) -> NoReturn:
    """Propagate Sentry's own status code and `{code, message, ...context}` envelope verbatim."""
    raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message, **exc.context})


def _raise_for_unreachable(exc: SentryUnreachableError) -> NoReturn:
    """502: Sentinel never got a response to interpret, so there is no Sentry code to surface."""
    raise HTTPException(status_code=502, detail={"code": "sentry_unreachable", "message": str(exc)})


# ── Host CRUD ──────────────────────────────────────────────────────────────────


@router.get("", response_model=list[SentryHostOut])
async def list_hosts(db: AsyncSession = Depends(get_db)) -> list[SentryHostOut]:
    """List every Sentry host Sentinel knows about."""
    hosts = (await db.execute(select(SentryHost).order_by(SentryHost.id))).scalars().all()
    return [_host_to_out(host) for host in hosts]


@router.post("", response_model=SentryHostOut, status_code=201)
async def create_host(body: SentryHostIn, db: AsyncSession = Depends(get_db)) -> SentryHostOut:
    """Register a new Sentry host and, if enabled, start polling it immediately."""
    existing = await db.execute(
        select(SentryHost).where(SentryHost.address == body.address, SentryHost.port == body.port)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "host_conflict",
                "message": "A Sentry host at this address and port is already registered.",
            },
        )
    host = SentryHost(
        name=body.name,
        address=body.address,
        port=body.port,
        auth_token=body.auth_token,
        enabled=body.enabled,
        created_at=now_ms(),
    )
    db.add(host)
    await db.commit()
    await db.refresh(host)
    if host.enabled:
        await fleet_poller.start_host(host.id)
    return _host_to_out(host)


@router.get("/locations", response_model=list[SentrySiteOut])
async def list_host_locations(db: AsyncSession = Depends(get_db)) -> list[SentrySiteOut]:
    """List every enabled Sentry host that reports a position, for plotting on the domain maps.

    Reads only the fleet poller's cached export — never the network — because
    every domain map polls this while it is open: a round trip per host per poll
    would make a slow Pi stall the map. A host that has gone unreachable keeps
    its last known position and is reported with `reachable: false`, so an
    operator sees a site that is off the air rather than a site that vanished.

    Declared before `/{host_id}` on purpose: FastAPI matches routes in
    declaration order, so the reverse would parse "locations" as a host id.
    """
    hosts = (await db.execute(select(SentryHost).order_by(SentryHost.id))).scalars().all()
    sites: list[SentrySiteOut] = []
    for host in hosts:
        if not host.enabled:
            continue
        snapshot = fleet_poller.get_snapshot(host.id)
        source = _coerce_source(snapshot.export_payload if snapshot is not None else None)
        location = source.location if source is not None else None
        if location is None or location.latitude is None or location.longitude is None:
            continue
        sites.append(
            SentrySiteOut(
                id=host.id,
                # Sentry's own name for itself is the better label when Sentinel
                # has not been given one — it is what the operator set on the Pi.
                # `source` is never None here: the position came out of it.
                name=host.name or source.name,
                address=host.address,
                port=host.port,
                reachable=snapshot.reachable if snapshot is not None else False,
                latitude=location.latitude,
                longitude=location.longitude,
                updated_at=location.updated_at,
            )
        )
    return sites


@router.get("/{host_id}", response_model=SentryHostOut)
async def get_host(host_id: int, db: AsyncSession = Depends(get_db)) -> SentryHostOut:
    """Return one Sentry host's record."""
    host = await _get_host_or_404(host_id, db)
    return _host_to_out(host)


@router.put("/{host_id}", response_model=SentryHostOut)
async def update_host(host_id: int, body: SentryHostPatch, db: AsyncSession = Depends(get_db)) -> SentryHostOut:
    """Update a Sentry host's connection details and/or enabled state.

    Restarts the poller (or starts/stops it as appropriate) so a changed
    address, port, token, or enabled flag takes effect immediately rather than
    waiting for the previous poller iteration to notice.
    """
    host = await _get_host_or_404(host_id, db)
    if body.address is not None or body.port is not None:
        new_address = body.address if body.address is not None else host.address
        new_port = body.port if body.port is not None else host.port
        conflict = await db.execute(
            select(SentryHost).where(
                SentryHost.address == new_address, SentryHost.port == new_port, SentryHost.id != host_id
            )
        )
        if conflict.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "host_conflict",
                    "message": "A Sentry host at this address and port is already registered.",
                },
            )
        host.address = new_address
        host.port = new_port
    # `name` is the one field a null means something for: it is a cosmetic
    # label that falls back to the address, so an operator must be able to
    # clear it. Keyed on whether the field was sent rather than on its value,
    # which is what makes `{"name": null}` and `{"name": "  "}` clear it while
    # omitting the key entirely leaves it alone.
    if "name" in body.model_fields_set:
        host.name = body.name
    if body.auth_token is not None:
        host.auth_token = body.auth_token
    if body.enabled is not None:
        host.enabled = body.enabled
    await db.commit()
    await db.refresh(host)
    if host.enabled:
        await fleet_poller.restart_host(host.id)
    else:
        await fleet_poller.stop_host(host.id)
    return _host_to_out(host)


@router.delete("/{host_id}", status_code=204)
async def delete_host(host_id: int, db: AsyncSession = Depends(get_db)) -> None:
    """Forget a Sentry host. Does not affect the Pi itself — only Sentinel's record of it."""
    host = await _get_host_or_404(host_id, db)
    await fleet_poller.stop_host(host_id)
    await db.delete(host)
    await db.commit()
    return None


@router.post("/{host_id}/test", response_model=HealthProbeResult)
async def test_host(host_id: int, db: AsyncSession = Depends(get_db)) -> HealthProbeResult:
    """Probe `GET /api/health` on a host — always 200, the result reports reachability.

    Deliberately never raises on an unreachable host: this endpoint exists so
    an operator can check connectivity without the negative case looking like
    Sentinel's own error.
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.get_health()
    except SentryUnreachableError as exc:
        return HealthProbeResult(reachable=False, detail=str(exc))
    except SentryApiError as exc:
        return HealthProbeResult(reachable=False, detail=f"{exc.code}: {exc.message}")
    return HealthProbeResult(reachable=True, detail="ok", api_version=response.api_version, health=response.data)


def _coerce_source(export_payload: dict[str, Any] | None) -> SentrySourceOut | None:
    """Pull the `source` block out of a `/api/v1/sdrs` body, tolerating any shape.

    The export is a remote service's response, so nothing about it is
    guaranteed: an older Sentry may omit `source` entirely, and a newer one may
    add keys. Anything unrecognised is dropped rather than allowed to fail the
    whole details read.
    """
    source = (export_payload or {}).get("source")
    if not isinstance(source, dict):
        return None
    raw_location = source.get("location")
    location = (
        SentryLocationOut(
            **{key: value for key, value in raw_location.items() if key in SentryLocationOut.model_fields}
        )
        if isinstance(raw_location, dict)
        else None
    )
    return SentrySourceOut(
        name=source.get("name") if isinstance(source.get("name"), str) else None,
        version=source.get("version") if isinstance(source.get("version"), str) else None,
        host=source.get("host") if isinstance(source.get("host"), str) else None,
        http_port=source.get("http_port") if isinstance(source.get("http_port"), int) else None,
        location=location,
    )


@router.get("/{host_id}/info", response_model=SentryHostInfoOut)
async def get_host_info(host_id: int, db: AsyncSession = Depends(get_db)) -> SentryHostInfoOut:
    """Return every known detail of one Sentry host — record, telemetry, and live self-report.

    Always 200. Reading a details view must not fail because the Pi is asleep,
    so an unreachable host answers with `reachable: false`, a human-readable
    `detail`, and null live blocks.
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    snapshot = fleet_poller.get_snapshot(host.id)

    detail = "ok"
    health: dict[str, Any] | None = None
    api_version: str | None = None
    reachable = False
    try:
        health_response = await client.get_health()
    except SentryUnreachableError as exc:
        detail = str(exc)
    except SentryApiError as exc:
        detail = f"{exc.code}: {exc.message}"
    else:
        reachable = True
        health = health_response.data
        api_version = health_response.api_version

    export_payload: dict[str, Any] | None = None
    if reachable:
        # Only worth a second round trip once the host has answered at all —
        # and a failure here (an older Sentry without the v1 export) leaves the
        # location blank rather than downgrading the host to unreachable.
        try:
            export_payload = (await client.get_sdr_export()).data
        except (SentryUnreachableError, SentryApiError):
            export_payload = None

    source = _coerce_source(export_payload)
    control_port_offset = (export_payload or {}).get("control_port_offset")

    # This request just probed the host, so its result is fresher than the
    # poller snapshot `_host_to_out` overlays: the live reachability wins, and
    # so does the live API version when the probe reported one (a host that has
    # just gone down keeps the snapshot's last-known version).
    base_fields = _host_to_out(host).model_dump()
    base_fields["reachable"] = reachable
    if api_version is not None:
        base_fields["api_version"] = api_version
    return SentryHostInfoOut(
        **base_fields,
        detail=detail,
        last_polled_at=snapshot.last_polled_at if snapshot is not None else None,
        last_success_at=snapshot.last_success_at if snapshot is not None else None,
        health=health,
        source=source,
        location=source.location if source is not None else None,
        control_port_offset=control_port_offset if isinstance(control_port_offset, int) else None,
    )


# ── Cached device snapshot ──────────────────────────────────────────────────────


@router.get("/{host_id}/devices", response_model=DeviceSnapshotOut)
async def get_host_devices(host_id: int, db: AsyncSession = Depends(get_db)) -> DeviceSnapshotOut:
    """Return the fleet poller's cached `GET /api/status` snapshot for one host.

    Served from memory, never a live round-trip, per ADR-0009: Sentinel's
    device list is a cache refreshed on a 2s poll, and this route surfaces
    exactly that cache plus its own reachability so a dead host still renders
    something instead of blocking the request.
    """
    await _get_host_or_404(host_id, db)
    snapshot = fleet_poller.get_snapshot(host_id)
    if snapshot is None:
        return DeviceSnapshotOut(
            reachable=False, last_error=None, last_polled_at=None, last_success_at=None, api_version=None, status=None
        )
    return DeviceSnapshotOut(
        reachable=snapshot.reachable,
        last_error=snapshot.last_error,
        last_polled_at=snapshot.last_polled_at,
        last_success_at=snapshot.last_success_at,
        api_version=snapshot.api_version,
        status=snapshot.status_payload,
    )


@router.get("/{host_id}/devices/records")
async def get_host_device_records(host_id: int, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `GET /api/devices` — Sentry's persisted device configuration.

    Distinct from the cached snapshot above, and both are needed. `/api/status`
    returns `DeviceStatus`, which describes what a device is *doing* — present,
    state, live tuner readout — and deliberately carries none of the persisted
    tuning intent. The stored `sample_rate`, `gain_db`, `gain_auto`,
    `ppm_correction`, `bias_tee` and `direct_sampling` live only on
    `DeviceRecord`, so an edit form driven off the snapshot alone would show
    every tuning field blank and silently clear them on save.

    Live rather than cached: it is fetched when a form opens, not on a timer,
    and the operator is about to edit these values so they must be current. It
    also carries Sentry's `port_suggestion` and `constraints`, which the port
    field needs to suggest a free port rather than guess.
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.get_devices()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


# ── Device proxy — writes go straight to Sentry, never reimplemented here ──────


@router.patch("/{host_id}/devices/{device_id}")
async def patch_host_device(
    host_id: int, device_id: str, patch: dict[str, Any], db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """Proxy `PATCH /api/devices/{device_id}` to Sentry, propagating its response verbatim.

    The body is forwarded as-is: Sentry owns the full `DevicePatch` validation
    (bounds, enums, port allocation, name uniqueness) and its rejection code
    must reach the caller unchanged, so this router does not re-validate or
    reshape it beyond being valid JSON.
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.patch_device(device_id, patch)
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    await fleet_poller.refresh_now(host_id)
    return JSONResponse(response.data)


@router.delete("/{host_id}/devices/{device_id}", status_code=204)
async def delete_host_device(host_id: int, device_id: str, db: AsyncSession = Depends(get_db)) -> Response:
    """Proxy `DELETE /api/devices/{device_id}` — removes Sentry's persisted config for that device."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        await client.delete_device(device_id)
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    await fleet_poller.refresh_now(host_id)
    return Response(status_code=204)


@router.post("/{host_id}/devices/{device_id}/serial", status_code=202)
async def flash_host_device_serial(
    host_id: int, device_id: str, body: SerialFlashIn, db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """Proxy `POST /api/devices/{device_id}/serial` — begins Sentry's guarded EEPROM flash."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.flash_serial(device_id, body.serial)
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    await fleet_poller.refresh_now(host_id)
    return JSONResponse(response.data, status_code=202)


# ── WiFi/hotspot proxy ───────────────────────────────────────────────────────────


@router.get("/{host_id}/wifi")
async def get_host_wifi(host_id: int, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `GET /api/hotspot` — Sentry's response never includes the passphrase."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.get_hotspot()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.put("/{host_id}/wifi")
async def put_host_wifi(host_id: int, body: WifiConfigIn, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `PUT /api/hotspot` — a full replace, matching Sentry's own semantics."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.put_hotspot(body.model_dump())
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.delete("/{host_id}/wifi", status_code=204)
async def delete_host_wifi(host_id: int, db: AsyncSession = Depends(get_db)) -> Response:
    """Proxy `DELETE /api/hotspot` — forgets the hotspot configuration, including its password."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        await client.delete_hotspot()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return Response(status_code=204)


@router.post("/{host_id}/wifi/enable")
async def enable_host_wifi(host_id: int, body: WifiActivationIn, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `POST /api/hotspot/enable` — brings the hotspot up provisionally.

    Sentry rolls this back unless `POST .../wifi/confirm` arrives within its
    own timeout; Sentinel never calls confirm automatically (see that route).
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.enable_hotspot(body.confirm_uplink_loss)
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.post("/{host_id}/wifi/disable")
async def disable_host_wifi(host_id: int, body: WifiActivationIn, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `POST /api/hotspot/disable`."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.disable_hotspot(body.confirm_uplink_loss)
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.post("/{host_id}/wifi/confirm")
async def confirm_host_wifi(host_id: int, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `POST /api/hotspot/confirm`.

    Safety-critical (ADR-0009 / Sentry ADR-0007): this route must only ever be
    reached by an explicit operator action in the UI — never invoked
    automatically after `enable`, and never called speculatively by this
    backend on the operator's behalf.
    """
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.confirm_hotspot()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.get("/{host_id}/wifi/interfaces")
async def list_host_wifi_interfaces(host_id: int, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `GET /api/hotspot/interfaces`."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.get_hotspot_interfaces()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)


@router.get("/{host_id}/wifi/clients")
async def list_host_wifi_clients(host_id: int, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Proxy `GET /api/hotspot/clients`."""
    host = await _get_host_or_404(host_id, db)
    client = _client_for(host)
    try:
        response = await client.get_hotspot_clients()
    except SentryApiError as exc:
        _raise_for_sentry_error(exc)
    except SentryUnreachableError as exc:
        _raise_for_unreachable(exc)
    return JSONResponse(response.data)
