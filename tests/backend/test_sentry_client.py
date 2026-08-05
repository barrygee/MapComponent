"""Tests for backend.services.sentry_client — the typed async HTTP client for
one Sentry host's `/api` surface (ADR-0009).

No network is used anywhere here: every request is routed through an
``httpx.MockTransport`` installed by monkeypatching ``httpx.AsyncClient`` for
the duration of a test, so the suite stays fast and deterministic while still
exercising the real request-building/response-translation code.
"""

from __future__ import annotations

import json

import httpx
import pytest

from backend.services.sentry_client import (
    SentryApiError,
    SentryClient,
    SentryUnreachableError,
    _describe_validation_errors,
    _encode_path_segment,
    _parse_error_envelope,
    validate_sentry_address,
    validate_sentry_port,
)


def _install_mock_transport(monkeypatch, handler) -> None:
    """Route every httpx.AsyncClient built inside sentry_client through an
    in-process MockTransport instead of the network, for the life of one test."""

    class _MockedAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _MockedAsyncClient)


def _capturing_handler(
    status_code: int = 200, json_body=None, headers: dict | None = None
):
    """A MockTransport handler that records the outgoing request and returns a
    fixed response. Returns (handler, captured) where captured['request'] is
    filled in once the handler has run."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        if json_body is None:
            return httpx.Response(status_code, headers=headers or {})
        return httpx.Response(status_code, json=json_body, headers=headers or {})

    return handler, captured


# ── validate_sentry_address ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "address",
    [
        "http://10.0.0.5",  # scheme
        "user:pass@10.0.0.5",  # embedded credentials
        "10.0.0.5/api",  # path
        "10.0.0.5 extra",  # embedded whitespace
        "10.0.0.5\textra",  # tab injection
        "10.0.0.5\nextra",  # newline injection
        "::1",  # bare IPv6 literal
        "[::1]",  # bracketed IPv6 literal
        "10.0.0.5:8000",  # embedded port
        "",  # empty
        "a" * 254,  # over-length
        "bad!host",  # not a valid hostname (forbidden char, not caught above)
    ],
)
def test_validate_sentry_address_rejects_malformed_input(address):
    with pytest.raises(ValueError):
        validate_sentry_address(address)


def test_validate_sentry_address_rejects_whitespace_only_after_strip():
    # A lone trailing space is stripped first, so this alone must NOT raise —
    # confirms strip() runs before the emptiness check, not after.
    assert validate_sentry_address("10.0.0.5 ") == "10.0.0.5"


@pytest.mark.parametrize(
    "address",
    [
        "192.168.1.5",  # bare IPv4
        "sentry-host",  # hostname
        "sentry.local.lan",  # dotted hostname
        "sentry_host",  # underscore — deliberately allowed, see module docstring
    ],
)
def test_validate_sentry_address_accepts_well_formed_input(address):
    assert validate_sentry_address(address) == address


def test_validate_sentry_address_strips_surrounding_whitespace():
    assert validate_sentry_address("  sentry-host  ") == "sentry-host"


def test_validate_sentry_address_boundary_length_253_is_accepted():
    candidate = ".".join(
        ["a" * 63, "a" * 63, "a" * 63, "a" * 61]
    )  # 63*3 + 61 + 3 dots = 253
    assert len(candidate) == 253
    assert validate_sentry_address(candidate) == candidate


# ── validate_sentry_port ──────────────────────────────────────────────────────


@pytest.mark.parametrize("port", [0, -1, 65536, -65535])
def test_validate_sentry_port_rejects_out_of_range_values(port):
    with pytest.raises(ValueError):
        validate_sentry_port(port)


@pytest.mark.parametrize("port", [1, 65535, 8000])
def test_validate_sentry_port_accepts_in_range_values(port):
    assert validate_sentry_port(port) == port


# ── SentryClient construction ─────────────────────────────────────────────────


def test_client_rejects_invalid_address_at_construction():
    with pytest.raises(ValueError):
        SentryClient("bad host", 8000, "token")


def test_client_rejects_invalid_port_at_construction():
    with pytest.raises(ValueError):
        SentryClient("10.0.0.5", 0, "token")


def test_client_base_url_combines_validated_address_and_port():
    client = SentryClient("10.0.0.5", 8000, "token")
    assert client.base_url == "http://10.0.0.5:8000"


def test_client_uses_explicit_timeouts_when_provided():
    client = SentryClient(
        "10.0.0.5", 8000, "token", connect_timeout_s=1.5, read_timeout_s=2.5
    )
    assert client._timeout.connect == 1.5
    assert client._timeout.read == 2.5


def test_client_falls_back_to_settings_timeouts_when_not_provided():
    from backend.config import settings

    client = SentryClient("10.0.0.5", 8000, "token")
    assert client._timeout.connect == settings.sentry_connect_timeout_s
    assert client._timeout.read == settings.sentry_read_timeout_s


# ── request headers ───────────────────────────────────────────────────────────


async def test_request_includes_bearer_token_when_set(monkeypatch):
    handler, captured = _capturing_handler(200, {"ok": True})
    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "s3cr3t-token")
    await client.get_health()
    assert captured["request"].headers["Authorization"] == "Bearer s3cr3t-token"
    assert captured["request"].headers["Accept"] == "application/json"


async def test_request_omits_authorization_header_when_token_empty(monkeypatch):
    handler, captured = _capturing_handler(200, {"ok": True})
    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "")
    await client.get_health()
    assert "Authorization" not in captured["request"].headers


# ── endpoint → HTTP method/path/body wiring ───────────────────────────────────


ENDPOINT_CASES = [
    ("get_health", (), "GET", "/api/health", None),
    ("get_status", (), "GET", "/api/status", None),
    ("get_devices", (), "GET", "/api/devices", None),
    (
        "patch_device",
        ("dev:1", {"name": "renamed"}),
        "PATCH",
        "/api/devices/dev%3A1",
        {"name": "renamed"},
    ),
    ("delete_device", ("dev:1",), "DELETE", "/api/devices/dev%3A1", None),
    (
        "flash_serial",
        ("dev:1", "SN0001"),
        "POST",
        "/api/devices/dev%3A1/serial",
        {"serial": "SN0001", "confirm": True},
    ),
    ("get_hotspot", (), "GET", "/api/hotspot", None),
    ("get_hotspot_interfaces", (), "GET", "/api/hotspot/interfaces", None),
    ("get_hotspot_clients", (), "GET", "/api/hotspot/clients", None),
    ("put_hotspot", ({"ssid": "net"},), "PUT", "/api/hotspot", {"ssid": "net"}),
    (
        "enable_hotspot",
        (True,),
        "POST",
        "/api/hotspot/enable",
        {"confirm_uplink_loss": True},
    ),
    (
        "disable_hotspot",
        (False,),
        "POST",
        "/api/hotspot/disable",
        {"confirm_uplink_loss": False},
    ),
    ("confirm_hotspot", (), "POST", "/api/hotspot/confirm", None),
    ("delete_hotspot", (), "DELETE", "/api/hotspot", None),
]


@pytest.mark.parametrize(
    "method_name, args, expected_http_method, expected_path, expected_json_body",
    ENDPOINT_CASES,
)
async def test_endpoint_sends_correct_method_path_and_body(
    monkeypatch,
    method_name,
    args,
    expected_http_method,
    expected_path,
    expected_json_body,
):
    handler, captured = _capturing_handler(200, {"echo": expected_path})
    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    result = await getattr(client, method_name)(*args)

    request = captured["request"]
    assert request.method == expected_http_method
    # `.path` is percent-decoded by httpx; compare the raw (still-encoded) path
    # so device-id segments like "dev:1" are verified as actually percent-encoded.
    assert request.url.raw_path.split(b"?")[0].decode() == expected_path
    if expected_json_body is not None:
        assert json.loads(request.content) == expected_json_body
    assert result.data == {"echo": expected_path}


async def test_response_carries_api_version_header(monkeypatch):
    handler, _ = _capturing_handler(
        200, {"ok": True}, headers={"X-Sentry-Api-Version": "1.4"}
    )
    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    response = await client.get_health()
    assert response.api_version == "1.4"


async def test_response_api_version_is_none_when_header_absent(monkeypatch):
    handler, _ = _capturing_handler(200, {"ok": True})
    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    response = await client.get_health()
    assert response.api_version is None


# ── response body handling ────────────────────────────────────────────────────


async def test_204_response_has_no_data(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    response = await client.delete_hotspot()
    assert response.data is None


async def test_empty_body_with_200_status_has_no_data(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"")

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    response = await client.get_health()
    assert response.data is None


async def test_non_json_success_body_raises_invalid_response_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json at all")

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    with pytest.raises(SentryApiError) as excinfo:
        await client.get_health()
    assert excinfo.value.code == "invalid_response"
    assert excinfo.value.status_code == 200


# ── unreachable errors (connect failure / timeout) ────────────────────────────


async def test_connect_failure_raises_sentry_unreachable_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated connect failure")

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    with pytest.raises(SentryUnreachableError) as excinfo:
        await client.get_health()
    assert "10.0.0.5:8000" in str(excinfo.value)


async def test_timeout_raises_sentry_unreachable_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated timeout")

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    with pytest.raises(SentryUnreachableError) as excinfo:
        await client.get_health()
    assert "Timed out" in str(excinfo.value)


# ── error envelope translation (via a live request) ───────────────────────────


async def test_error_status_raises_sentry_api_error_with_parsed_envelope(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={
                "detail": {"code": "bad_port", "message": "port taken", "port": 8001}
            },
        )

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "tok")
    with pytest.raises(SentryApiError) as excinfo:
        await client.get_status()
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "bad_port"
    assert excinfo.value.message == "port taken"
    assert excinfo.value.context == {"port": 8001}


# ── security: the auth token never leaks into an exception ───────────────────


async def test_auth_token_never_appears_in_unreachable_exception_message(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated")

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "TOP-SECRET-TOKEN")
    with pytest.raises(SentryUnreachableError) as excinfo:
        await client.get_health()
    assert "TOP-SECRET-TOKEN" not in str(excinfo.value)


async def test_auth_token_never_appears_in_api_error_exception(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"detail": "internal error"})

    _install_mock_transport(monkeypatch, handler)
    client = SentryClient("10.0.0.5", 8000, "TOP-SECRET-TOKEN")
    with pytest.raises(SentryApiError) as excinfo:
        await client.get_health()
    assert "TOP-SECRET-TOKEN" not in str(excinfo.value)
    assert "TOP-SECRET-TOKEN" not in excinfo.value.message
    assert "TOP-SECRET-TOKEN" not in json.dumps(excinfo.value.context)


# ── _encode_path_segment ───────────────────────────────────────────────────────


def test_encode_path_segment_percent_encodes_colon_but_not_dots_or_hyphens():
    assert _encode_path_segment("usb:1-1.4.2") == "usb%3A1-1.4.2"


def test_encode_path_segment_leaves_plain_alphanumeric_untouched():
    assert _encode_path_segment("device1") == "device1"


# ── _parse_error_envelope — every body shape it must handle ──────────────────


def _response_with_json(status_code: int, body) -> httpx.Response:
    return httpx.Response(status_code, json=body)


def test_parse_error_envelope_handles_sentry_dict_detail_and_keeps_context():
    response = _response_with_json(
        409, {"detail": {"code": "host_conflict", "message": "taken", "port": 8000}}
    )
    code, message, context = _parse_error_envelope(response)
    assert code == "host_conflict"
    assert message == "taken"
    assert context == {"port": 8000}


def test_parse_error_envelope_defaults_code_and_message_when_absent():
    response = _response_with_json(400, {"detail": {}})
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "Sentry returned HTTP 400."
    assert context == {}


def test_parse_error_envelope_flattens_pydantic_list_detail_and_keeps_raw_list():
    errors = [{"loc": ["body", "output_port"], "msg": "field required"}]
    response = _response_with_json(422, {"detail": errors})
    code, message, context = _parse_error_envelope(response)
    assert code == "validation_error"
    assert message == "output_port: field required"
    assert context == {"errors": errors}


def test_parse_error_envelope_handles_plain_string_detail():
    response = _response_with_json(400, {"detail": "not allowed"})
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "not allowed"
    assert context == {}


def test_parse_error_envelope_falls_back_on_non_json_body():
    response = httpx.Response(502, content=b"<html>Bad Gateway</html>")
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "Sentry returned HTTP 502."
    assert context == {}


def test_parse_error_envelope_falls_back_when_detail_key_has_unexpected_shape():
    # Valid JSON, but "detail" is neither a dict, list, nor string (e.g. a bool).
    response = _response_with_json(400, {"detail": True})
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "Sentry returned HTTP 400."
    assert context == {}


def test_parse_error_envelope_falls_back_when_body_has_no_detail_key():
    response = _response_with_json(500, {"error": "unexpected"})
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "Sentry returned HTTP 500."
    assert context == {}


def test_parse_error_envelope_falls_back_when_body_is_a_json_list():
    # isinstance(body, dict) is False, so `.get` must not even be attempted.
    response = _response_with_json(500, ["oops"])
    code, message, context = _parse_error_envelope(response)
    assert code == "upstream_error"
    assert message == "Sentry returned HTTP 500."
    assert context == {}


# ── _describe_validation_errors ───────────────────────────────────────────────


def test_describe_validation_errors_drops_body_query_path_location_segments():
    errors = [{"loc": ["body", "output_port"], "msg": "field required"}]
    assert (
        _describe_validation_errors(errors, "fallback") == "output_port: field required"
    )


def test_describe_validation_errors_joins_multiple_entries_with_semicolons():
    errors = [
        {"loc": ["body", "ssid"], "msg": "too long"},
        {"loc": ["query", "channel"], "msg": "out of range"},
    ]
    assert (
        _describe_validation_errors(errors, "fallback")
        == "ssid: too long; channel: out of range"
    )


def test_describe_validation_errors_omits_field_name_when_location_is_empty():
    errors = [{"loc": [], "msg": "top-level error"}]
    assert _describe_validation_errors(errors, "fallback") == "top-level error"


def test_describe_validation_errors_uses_fallback_when_list_is_empty():
    assert (
        _describe_validation_errors([], "no details available")
        == "no details available"
    )


def test_describe_validation_errors_skips_non_dict_entries():
    assert _describe_validation_errors(["not a dict"], "fallback") == "fallback"


def test_describe_validation_errors_uses_fallback_when_message_is_blank():
    errors = [{"loc": ["body", "ssid"], "msg": "   "}]
    assert _describe_validation_errors(errors, "fallback") == "fallback"
