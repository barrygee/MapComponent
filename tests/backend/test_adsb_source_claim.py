"""Tests for `/api/sdr/adsb` — claiming and tuning the Sentry dongle behind AIR.

This is the piece that turns an empty Off Grid map into aircraft: without it a
dongle sits on whatever frequency it was last left on, and nothing says so. The
properties worth pinning are the ones an operator would otherwise have to
diagnose from silence:

* **Tuning goes out with the claim**, and to 1090 MHz at 2.4 MSPS specifically.
  A claim that succeeds without retuning leaves exactly the symptom this whole
  feature exists to remove.
* **Every failure names itself.** "No source picked", "someone else has it" and
  "that Sentry is unreachable" need different actions from the operator, so they
  must not collapse into one error.
* **The holder is stable.** It is the only thing separating renewing our own
  lease from stealing somebody else's, so a value that changed per call would
  lock Sentinel out of the device it is holding.

Sentry itself is faked at the HTTP boundary: the real reservation semantics are
tested in Sentry's own suite, and what matters here is that Sentinel sends the
right calls and reacts correctly to each answer.

Run with:  uv run --project backend pytest tests/backend/test_adsb_source_claim.py
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from backend.services import adsb_source

HOST_BODY = {
    "name": "Attic Pi",
    "address": "10.0.0.5",
    "port": 8000,
    "auth_token": "console-password",
    "enabled": True,
}
DEVICE_ID = "serial:97710286"


def _install_sentry(
    monkeypatch: pytest.MonkeyPatch, handler: Any
) -> list[httpx.Request]:
    """Route every outbound Sentry call to `handler`, recording the requests."""
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    transport = httpx.MockTransport(recording)
    original = httpx.AsyncClient.__init__

    def patched(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = transport
        original(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    return seen


def sentry_ok(request: httpx.Request) -> httpx.Response:
    """A Sentry that signs us in, grants the claim and accepts the tuning."""
    if request.url.path == "/api/auth/login":
        return httpx.Response(
            204, headers={"set-cookie": "sentry_session=granted; Path=/"}
        )
    if request.url.path.endswith("/reservation"):
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(
            200,
            json={
                "device_id": DEVICE_ID,
                "holder": "sentinel:whoever",
                "label": "Sentinel — AIR (ADS-B)",
                "reserved_at": 1,
                "expires_at": 120_001,
            },
        )
    return httpx.Response(200, json={"device_id": DEVICE_ID})


def register_host(client: Any) -> int:
    return client.post("/api/sdr/sentry-hosts", json=HOST_BODY).json()["id"]


def set_source(client: Any, host_id: int) -> Any:
    return client.put(
        "/api/sdr/adsb/source",
        json={"sentry_host_id": host_id, "sentry_device_id": DEVICE_ID},
    )


class TestChoosingTheSource:
    def test_reports_no_source_before_one_is_picked(self, client: Any) -> None:
        body = client.get("/api/sdr/adsb/source").json()

        assert body["configured"] is False

    def test_records_the_chosen_device(self, client: Any) -> None:
        host_id = register_host(client)

        set_source(client, host_id)

        body = client.get("/api/sdr/adsb/source").json()
        assert body == {
            "configured": True,
            "sentry_host_id": host_id,
            "sentry_device_id": DEVICE_ID,
        }

    def test_accepts_a_device_without_checking_it_exists(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A dongle can be unplugged without the operator's choice becoming
        # wrong. Reachability is the claim's problem, reported in terms of
        # something they just tried to do.
        host_id = register_host(client)

        response = client.put(
            "/api/sdr/adsb/source",
            json={
                "sentry_host_id": host_id,
                "sentry_device_id": "serial:NOT-PLUGGED-IN",
            },
        )

        assert response.status_code == 200


class TestClaimingAndTuning:
    def test_refuses_when_no_source_is_configured(self, client: Any) -> None:
        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "no_source"

    def test_claims_then_tunes_to_1090(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 200
        patches = [r for r in seen if r.method == "PATCH"]
        assert len(patches) == 1
        import json as json_module

        body = json_module.loads(patches[0].content)
        assert body["center_hz"] == 1_090_000_000
        assert body["sample_rate"] == 2_400_000

    def test_uses_a_fixed_maximum_gain_rather_than_agc(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # AGC cannot track a 0.5 microsecond pulse. It settles for the silence
        # between messages — which is to say it settles low — and the pulses
        # that matter arrive under the noise floor.
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        client.post("/api/sdr/adsb/claim", json={})

        import json as json_module

        body = json_module.loads(next(r for r in seen if r.method == "PATCH").content)
        assert body["gain_auto"] is False
        assert body["gain_db"] == adsb_source.ADSB_GAIN_DB

    def test_the_claim_precedes_the_tuning(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Tuning a device we have not claimed would be the very thing the lease
        # exists to stop somebody else doing.
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        client.post("/api/sdr/adsb/claim", json={})

        methods = [
            r.method
            for r in seen
            if r.url.path.endswith("/reservation") or r.method == "PATCH"
        ]
        assert methods.index("POST") < methods.index("PATCH")

    def test_the_patch_proves_we_hold_the_lease(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Without the header Sentry would refuse our own tuning under our own
        # lock — the lock would lock us out.
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        client.post("/api/sdr/adsb/claim", json={})

        patch = next(r for r in seen if r.method == "PATCH")
        assert patch.headers["X-Sentry-Reservation-Holder"].startswith("sentinel:")

    def test_tells_the_caller_when_to_renew(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        body = client.post("/api/sdr/adsb/claim", json={}).json()

        assert body["renew_within_seconds"] == adsb_source.RENEWAL_INTERVAL_SECONDS

    def test_renewing_reuses_the_same_holder(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        client.post("/api/sdr/adsb/claim", json={})
        client.post("/api/sdr/adsb/claim", json={})

        import json as json_module

        holders = {
            json_module.loads(r.content)["holder"]
            for r in seen
            if r.method == "POST" and r.url.path.endswith("/reservation")
        }
        assert len(holders) == 1

    def test_retunes_on_every_renewal(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Self-healing: a replugged dongle or a hand-retuned one comes back to
        # 1090 MHz on the next tick rather than leaving a quietly empty map.
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))

        client.post("/api/sdr/adsb/claim", json={})
        client.post("/api/sdr/adsb/claim", json={})

        assert len([r for r in seen if r.method == "PATCH"]) == 2


class TestFailuresAnOperatorCanAct_On:
    def test_a_device_someone_else_holds_reports_who(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def busy(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/auth/login":
                return httpx.Response(
                    204, headers={"set-cookie": "sentry_session=g; Path=/"}
                )
            return httpx.Response(
                409,
                json={
                    "detail": {
                        "code": "device_reserved",
                        "message": "Voice decoder is using this device.",
                        "holder": "sentinel:other",
                        "label": "Voice decoder",
                    }
                },
            )

        _install_sentry(monkeypatch, busy)
        set_source(client, register_host(client))

        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "device_reserved"
        assert detail["holder"] == "sentinel:other"

    def test_a_wrong_password_says_so_rather_than_looking_like_a_busy_device(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def unauthorised(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"detail": {"code": "unauthenticated"}})

        _install_sentry(monkeypatch, unauthorised)
        set_source(client, register_host(client))

        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "unauthenticated"

    def test_an_unreachable_sentry_says_so(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def unreachable(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        _install_sentry(monkeypatch, unreachable)
        set_source(client, register_host(client))

        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "host_unreachable"

    def test_a_disabled_host_is_refused_before_any_network_call(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        host_id = register_host(client)
        client.put(f"/api/sdr/sentry-hosts/{host_id}", json={"enabled": False})
        set_source(client, host_id)
        seen = _install_sentry(monkeypatch, sentry_ok)

        response = client.post("/api/sdr/adsb/claim", json={})

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "host_disabled"
        assert seen == []


class TestReleasing:
    def test_release_sends_a_delete(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen = _install_sentry(monkeypatch, sentry_ok)
        set_source(client, register_host(client))
        client.post("/api/sdr/adsb/claim", json={})

        response = client.delete("/api/sdr/adsb/claim")

        assert response.status_code == 204
        assert any(r.method == "DELETE" for r in seen)

    def test_release_never_fails_the_caller(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Leaving a view must not raise an error about hardware; the lease
        # expires on its own regardless.
        def unreachable(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("gone")

        _install_sentry(monkeypatch, unreachable)
        set_source(client, register_host(client))

        assert client.delete("/api/sdr/adsb/claim").status_code == 204

    def test_release_without_a_source_is_harmless(self, client: Any) -> None:
        assert client.delete("/api/sdr/adsb/claim").status_code == 204


class TestTheDecoderConfig:
    def test_reports_unconfigured_rather_than_erroring(self, client: Any) -> None:
        # The sidecar polls this from boot; an error would crash-loop it before
        # an operator could read why.
        body = client.get("/api/sdr/adsb/config").json()

        assert body == {"configured": False, "rtl_tcp": None}

    def test_reports_the_rtl_tcp_endpoint_for_the_chosen_device(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def export(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "sdrs": [
                        {
                            "sentry_device_id": "serial:OTHER",
                            "host": "10.0.0.5",
                            "port": 1234,
                        },
                        {
                            "sentry_device_id": DEVICE_ID,
                            "host": "10.0.0.5",
                            "port": 2345,
                        },
                    ]
                },
            )

        _install_sentry(monkeypatch, export)
        set_source(client, register_host(client))

        body = client.get("/api/sdr/adsb/config").json()

        assert body["configured"] is True
        assert body["rtl_tcp"] == {"host": "10.0.0.5", "port": 2345}

    def test_reports_unconfigured_when_the_device_is_not_published(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def export(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"sdrs": []})

        _install_sentry(monkeypatch, export)
        set_source(client, register_host(client))

        assert client.get("/api/sdr/adsb/config").json()["configured"] is False
