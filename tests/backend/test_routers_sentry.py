"""Tests for the Sentry-host router (`/api/sdr/sentry-hosts`, ADR-0009).

`fleet_poller`'s start/stop/restart/refresh_now are stubbed to no-op async
mocks for every test here — the poller's own behaviour (backoff, snapshot
caching, DB persistence) is covered separately in `test_sentry_fleet.py`, and
letting the real poller start background tasks against the router's request
DB (which is not the same session the poller's AsyncSessionLocal points at)
would either hang the test process or silently do nothing useful.

Every outbound call to "Sentry itself" is routed through an httpx.MockTransport
installed on the real httpx.AsyncClient class, so `SentryClient`/`_client_for`
run unmodified — this exercises real path-building and error-translation, not
a stand-in.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.routers import sentry as sentry_router


def _install_mock_transport(monkeypatch, handler) -> None:
    """Route every httpx.AsyncClient built inside sentry_client through an
    in-process MockTransport instead of the network, for one test."""

    class _MockedAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _MockedAsyncClient)


def _json_handler(status_code: int, json_body=None, headers: dict | None = None):
    """A canned MockTransport handler returning the same response every call,
    recording the last request it saw."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        if json_body is None:
            return httpx.Response(status_code, headers=headers or {})
        return httpx.Response(status_code, json=json_body, headers=headers or {})

    return handler, captured


@pytest.fixture(autouse=True)
def _stub_fleet_poller(monkeypatch):
    """Prevent real background polling tasks from starting during router tests."""
    monkeypatch.setattr(sentry_router.fleet_poller, "start_host", AsyncMock())
    monkeypatch.setattr(sentry_router.fleet_poller, "stop_host", AsyncMock())
    monkeypatch.setattr(sentry_router.fleet_poller, "restart_host", AsyncMock())
    monkeypatch.setattr(sentry_router.fleet_poller, "refresh_now", AsyncMock())


def _create_host(client, **overrides) -> dict:
    body = {
        "name": "Pi One",
        "address": "10.0.0.5",
        "port": 8000,
        "auth_token": "s3cret-token",
    }
    body.update(overrides)
    resp = client.post("/api/sdr/sentry-hosts", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Host CRUD ──────────────────────────────────────────────────────────────────


class TestListHosts:
    def test_list_is_empty_with_no_hosts(self, client):
        resp = client.get("/api/sdr/sentry-hosts")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_returns_every_registered_host(self, client):
        _create_host(client, address="10.0.0.5")
        _create_host(client, address="10.0.0.6")
        resp = client.get("/api/sdr/sentry-hosts")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_never_leaks_auth_token_in_response_body(self, client):
        _create_host(client, auth_token="TOP-SECRET-VALUE")
        resp = client.get("/api/sdr/sentry-hosts")
        assert "TOP-SECRET-VALUE" not in resp.text
        assert resp.json()[0]["auth_token_set"] is True


class TestCreateHost:
    def test_create_assigns_id_and_starts_poller_when_enabled(self, client):
        body = _create_host(client, enabled=True)
        assert isinstance(body["id"], int)
        assert body["enabled"] is True
        assert body["auth_token_set"] is True
        sentry_router.fleet_poller.start_host.assert_awaited_once_with(body["id"])

    def test_create_does_not_start_poller_when_disabled(self, client):
        body = _create_host(client, enabled=False)
        assert body["enabled"] is False
        sentry_router.fleet_poller.start_host.assert_not_awaited()

    def test_create_defaults_port_and_empty_token(self, client):
        resp = client.post("/api/sdr/sentry-hosts", json={"address": "10.0.0.9"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["port"] == 8000
        assert body["auth_token_set"] is False

    def test_create_never_leaks_auth_token_in_response_body(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={"address": "10.0.0.5", "auth_token": "TOP-SECRET-VALUE"},
        )
        assert resp.status_code == 201
        assert "TOP-SECRET-VALUE" not in resp.text

    def test_create_rejects_duplicate_address_and_port(self, client):
        _create_host(client, address="10.0.0.5", port=8000)
        resp = client.post(
            "/api/sdr/sentry-hosts", json={"address": "10.0.0.5", "port": 8000}
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "host_conflict"

    def test_create_allows_same_address_on_a_different_port(self, client):
        _create_host(client, address="10.0.0.5", port=8000)
        resp = client.post(
            "/api/sdr/sentry-hosts", json={"address": "10.0.0.5", "port": 8001}
        )
        assert resp.status_code == 201

    def test_create_rejects_malformed_address_with_422(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts", json={"address": "user:pass@10.0.0.5"}
        )
        assert resp.status_code == 422

    def test_create_rejects_out_of_range_port_with_422(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts", json={"address": "10.0.0.5", "port": 70000}
        )
        assert resp.status_code == 422

    def test_create_rejects_oversized_name(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts", json={"address": "10.0.0.5", "name": "x" * 121}
        )
        assert resp.status_code == 422

    def test_create_rejects_oversized_auth_token(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={"address": "10.0.0.5", "auth_token": "x" * 513},
        )
        assert resp.status_code == 422

    def test_create_blank_name_is_normalised_to_none(self, client):
        body = _create_host(client, name="   ")
        assert body["name"] is None

    def test_validation_failure_never_leaks_a_provided_auth_token(self, client):
        # Invalid address + a real token in the same request: even though the
        # request is rejected before persistence, the 422 body must not echo it.
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={
                "address": "bad address with spaces",
                "auth_token": "TOP-SECRET-VALUE",
            },
        )
        assert resp.status_code == 422
        assert "TOP-SECRET-VALUE" not in resp.text


class TestGetHost:
    def test_get_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "unknown_host"

    def test_get_known_host_never_leaks_auth_token(self, client):
        created = _create_host(client, auth_token="TOP-SECRET-VALUE")
        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}")
        assert resp.status_code == 200
        assert "TOP-SECRET-VALUE" not in resp.text
        assert resp.json()["address"] == "10.0.0.5"


class TestUpdateHost:
    def test_update_requires_at_least_one_field(self, client):
        created = _create_host(client)
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}", json={})
        assert resp.status_code == 422

    def test_update_unknown_host_returns_404(self, client):
        resp = client.put("/api/sdr/sentry-hosts/999", json={"name": "x"})
        assert resp.status_code == 404

    def test_update_renames_host(self, client):
        created = _create_host(client)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"name": "Renamed"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"

    def test_update_disabling_stops_the_poller(self, client):
        created = _create_host(client, enabled=True)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"enabled": False}
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False
        sentry_router.fleet_poller.stop_host.assert_awaited_once_with(created["id"])

    def test_update_keeping_enabled_restarts_the_poller(self, client):
        created = _create_host(client, enabled=True)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"address": "10.0.0.7"}
        )
        assert resp.status_code == 200
        sentry_router.fleet_poller.restart_host.assert_awaited_once_with(created["id"])

    def test_update_conflicting_address_and_port_returns_409(self, client):
        _create_host(client, address="10.0.0.5", port=8000)
        second = _create_host(client, address="10.0.0.6", port=8000)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{second['id']}", json={"address": "10.0.0.5"}
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "host_conflict"

    def test_update_to_its_own_current_address_and_port_is_not_a_conflict(self, client):
        created = _create_host(client, address="10.0.0.5", port=8000)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}",
            json={"address": "10.0.0.5", "port": 8000},
        )
        assert resp.status_code == 200

    def test_update_omitting_auth_token_keeps_it_set(self, client):
        created = _create_host(client, auth_token="")
        assert created["auth_token_set"] is False
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"auth_token": "new-token"}
        )
        assert resp.status_code == 200
        assert resp.json()["auth_token_set"] is True
        assert "new-token" not in resp.text

    def test_update_rejects_malformed_address(self, client):
        created = _create_host(client)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"address": "not a host"}
        )
        assert resp.status_code == 422

    def test_update_rejects_out_of_range_port(self, client):
        created = _create_host(client)
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}", json={"port": 0})
        assert resp.status_code == 422

    def test_update_never_leaks_auth_token_in_response_body(self, client):
        created = _create_host(client)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}",
            json={"auth_token": "TOP-SECRET-VALUE"},
        )
        assert resp.status_code == 200
        assert "TOP-SECRET-VALUE" not in resp.text


class TestDeleteHost:
    def test_delete_known_host_returns_204_and_stops_the_poller(self, client):
        created = _create_host(client)
        resp = client.delete(f"/api/sdr/sentry-hosts/{created['id']}")
        assert resp.status_code == 204
        sentry_router.fleet_poller.stop_host.assert_awaited_once_with(created["id"])
        assert client.get(f"/api/sdr/sentry-hosts/{created['id']}").status_code == 404

    def test_delete_unknown_host_returns_404(self, client):
        resp = client.delete("/api/sdr/sentry-hosts/999")
        assert resp.status_code == 404


class TestHealthProbe:
    def test_probe_unknown_host_returns_404(self, client):
        resp = client.post("/api/sdr/sentry-hosts/999/test")
        assert resp.status_code == 404

    def test_probe_reachable_host_returns_200_with_health_payload(
        self, client, monkeypatch
    ):
        created = _create_host(client, auth_token="probe-token")
        handler, captured = _json_handler(
            200, {"status": "ok"}, headers={"X-Sentry-Api-Version": "1.0"}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(f"/api/sdr/sentry-hosts/{created['id']}/test")

        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "reachable": True,
            "detail": "ok",
            "api_version": "1.0",
            "health": {"status": "ok"},
        }
        # No bearer header: Sentry reads a session cookie and nothing else
        # (its ADR-0010), so a token here would only look like authentication.
        # `/api/health` is unauthenticated anyway, which is what makes it a
        # usable reachability probe against a Sentry whose password we may not
        # hold.
        assert "Authorization" not in captured["request"].headers

    def test_probe_unreachable_host_still_returns_200_with_reachable_false(
        self, client, monkeypatch
    ):
        created = _create_host(client, auth_token="probe-token")

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("simulated")

        _install_mock_transport(monkeypatch, handler)

        resp = client.post(f"/api/sdr/sentry-hosts/{created['id']}/test")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reachable"] is False
        assert "probe-token" not in resp.text

    def test_probe_sentry_error_returns_200_with_reachable_false_and_code(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, _ = _json_handler(
            401, {"detail": {"code": "unauthorized", "message": "bad token"}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(f"/api/sdr/sentry-hosts/{created['id']}/test")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reachable"] is False
        assert body["detail"] == "unauthorized: bad token"


# ── cached device snapshot ─────────────────────────────────────────────────────


class TestListHostLocations:
    """`GET /api/sdr/sentry-hosts/locations` — the fleet's positions, for the maps."""

    @staticmethod
    def _snapshot_with_location(
        host_id: int,
        *,
        latitude: float | None = 51.5,
        longitude: float | None = -0.1,
        updated_at: int | None = 4242,
        reachable: bool = True,
        name: str | None = "sentry-roof",
    ):
        from backend.services.sentry_fleet import HostSnapshot

        location: dict | None = None
        if latitude is not None or longitude is not None:
            location = {
                "latitude": latitude,
                "longitude": longitude,
                "updated_at": updated_at,
            }
        return HostSnapshot(
            host_id=host_id,
            reachable=reachable,
            export_payload={"source": {"name": name, "location": location}},
        )

    def _patch_snapshots(self, monkeypatch, snapshots: dict) -> None:
        monkeypatch.setattr(
            sentry_router.fleet_poller,
            "get_snapshot",
            lambda host_id: snapshots.get(host_id),
        )

    def test_empty_with_no_hosts(self, client):
        resp = client.get("/api/sdr/sentry-hosts/locations")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_the_position_a_host_reports(self, client, monkeypatch):
        created = _create_host(client, name="Roof Pi")
        self._patch_snapshots(
            monkeypatch, {created["id"]: self._snapshot_with_location(created["id"])}
        )

        resp = client.get("/api/sdr/sentry-hosts/locations")

        assert resp.status_code == 200
        assert resp.json() == [
            {
                "id": created["id"],
                "name": "Roof Pi",
                "address": "10.0.0.5",
                "port": 8000,
                "reachable": True,
                "latitude": 51.5,
                "longitude": -0.1,
                "updated_at": 4242,
            }
        ]

    def test_falls_back_to_the_name_the_sentry_calls_itself(self, client, monkeypatch):
        """A host registered without a label takes Sentry's own name for itself."""
        resp = client.post("/api/sdr/sentry-hosts", json={"address": "10.0.0.7"})
        host_id = resp.json()["id"]
        self._patch_snapshots(
            monkeypatch,
            {host_id: self._snapshot_with_location(host_id, name="sentry-barn")},
        )

        body = client.get("/api/sdr/sentry-hosts/locations").json()

        assert body[0]["name"] == "sentry-barn"

    def test_name_stays_null_when_neither_side_has_one(self, client, monkeypatch):
        resp = client.post("/api/sdr/sentry-hosts", json={"address": "10.0.0.7"})
        host_id = resp.json()["id"]
        self._patch_snapshots(
            monkeypatch, {host_id: self._snapshot_with_location(host_id, name=None)}
        )

        assert client.get("/api/sdr/sentry-hosts/locations").json()[0]["name"] is None

    def test_omits_a_host_that_reports_no_location(self, client, monkeypatch):
        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch,
            {
                created["id"]: self._snapshot_with_location(
                    created["id"], latitude=None, longitude=None
                )
            },
        )

        assert client.get("/api/sdr/sentry-hosts/locations").json() == []

    def test_omits_a_host_reporting_half_a_position(self, client, monkeypatch):
        """Latitude without longitude is not a point, and must not be plotted."""
        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch,
            {
                created["id"]: self._snapshot_with_location(
                    created["id"], longitude=None
                )
            },
        )

        assert client.get("/api/sdr/sentry-hosts/locations").json() == []

    def test_omits_a_host_the_poller_has_never_polled(self, client, monkeypatch):
        _create_host(client)
        self._patch_snapshots(monkeypatch, {})

        assert client.get("/api/sdr/sentry-hosts/locations").json() == []

    def test_omits_a_host_whose_export_has_no_source_block(self, client, monkeypatch):
        from backend.services.sentry_fleet import HostSnapshot

        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch,
            {
                created["id"]: HostSnapshot(
                    host_id=created["id"], export_payload={"sdrs": []}
                )
            },
        )

        assert client.get("/api/sdr/sentry-hosts/locations").json() == []

    def test_omits_a_disabled_host_even_when_its_position_is_known(
        self, client, monkeypatch
    ):
        """A host the operator has switched off is not part of the fleet on the map."""
        created = _create_host(client, enabled=False)
        self._patch_snapshots(
            monkeypatch, {created["id"]: self._snapshot_with_location(created["id"])}
        )

        assert client.get("/api/sdr/sentry-hosts/locations").json() == []

    def test_keeps_an_unreachable_host_at_its_last_known_position(
        self, client, monkeypatch
    ):
        """A Pi that drops off the network is a site that is off the air, not one
        that has vanished."""
        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch,
            {
                created["id"]: self._snapshot_with_location(
                    created["id"], reachable=False
                )
            },
        )

        body = client.get("/api/sdr/sentry-hosts/locations").json()

        assert len(body) == 1
        assert body[0]["reachable"] is False
        assert body[0]["latitude"] == 51.5

    def test_tolerates_a_location_without_an_update_time(self, client, monkeypatch):
        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch,
            {
                created["id"]: self._snapshot_with_location(
                    created["id"], updated_at=None
                )
            },
        )

        assert (
            client.get("/api/sdr/sentry-hosts/locations").json()[0]["updated_at"]
            is None
        )

    def test_lists_every_positioned_host_in_id_order(self, client, monkeypatch):
        first = _create_host(client, address="10.0.0.5", name="A")
        second = _create_host(client, address="10.0.0.6", name="B")
        third = _create_host(client, address="10.0.0.7", name="C")
        self._patch_snapshots(
            monkeypatch,
            {
                first["id"]: self._snapshot_with_location(first["id"]),
                # The middle host has no fix — it drops out, the others stay in order.
                second["id"]: self._snapshot_with_location(
                    second["id"], latitude=None, longitude=None
                ),
                third["id"]: self._snapshot_with_location(third["id"], latitude=52.0),
            },
        )

        body = client.get("/api/sdr/sentry-hosts/locations").json()

        assert [entry["name"] for entry in body] == ["A", "C"]

    def test_never_leaks_the_auth_token(self, client, monkeypatch):
        created = _create_host(client, auth_token="TOP-SECRET-VALUE")
        self._patch_snapshots(
            monkeypatch, {created["id"]: self._snapshot_with_location(created["id"])}
        )

        resp = client.get("/api/sdr/sentry-hosts/locations")

        assert "TOP-SECRET-VALUE" not in resp.text

    def test_locations_is_not_parsed_as_a_host_id(self, client, monkeypatch):
        """Route order: `/locations` must win over `/{host_id}`, which would 422."""
        self._patch_snapshots(monkeypatch, {})
        assert client.get("/api/sdr/sentry-hosts/locations").status_code == 200
        # …and the id route itself still resolves.
        created = _create_host(client)
        assert client.get(f"/api/sdr/sentry-hosts/{created['id']}").status_code == 200

    def test_reads_only_the_cache_and_never_the_network(self, client, monkeypatch):
        """A slow or dead Pi must not stall a map poll, so no request is made."""
        calls: list = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(200, json={})

        _install_mock_transport(monkeypatch, handler)
        created = _create_host(client)
        self._patch_snapshots(
            monkeypatch, {created["id"]: self._snapshot_with_location(created["id"])}
        )

        assert client.get("/api/sdr/sentry-hosts/locations").status_code == 200
        assert calls == []


class TestGetHostDevices:
    def test_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999/devices")
        assert resp.status_code == 404

    def test_no_snapshot_yet_returns_unreachable_defaults(self, client):
        created = _create_host(client)
        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/devices")
        assert resp.status_code == 200
        assert resp.json() == {
            "reachable": False,
            "last_error": None,
            "last_polled_at": None,
            "last_success_at": None,
            "api_version": None,
            "status": None,
        }

    def test_returns_the_pollers_cached_snapshot_verbatim(self, client, monkeypatch):
        from backend.services.sentry_fleet import HostSnapshot

        created = _create_host(client)
        snapshot = HostSnapshot(
            host_id=created["id"],
            reachable=True,
            status_payload={"generated_at": 123, "sdrs": [{"id": "usb:1"}]},
            api_version="2.1",
            last_error=None,
            last_polled_at=1000,
            last_success_at=1000,
        )
        monkeypatch.setattr(
            sentry_router.fleet_poller, "get_snapshot", lambda host_id: snapshot
        )

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/devices")

        assert resp.status_code == 200
        assert resp.json() == {
            "reachable": True,
            "last_error": None,
            "last_polled_at": 1000,
            "last_success_at": 1000,
            "api_version": "2.1",
            "status": {"generated_at": 123, "sdrs": [{"id": "usb:1"}]},
        }


class TestHostInfo:
    """`GET /{host_id}/info` — the details view's record + live self-report."""

    @staticmethod
    def _route_health_and_export(monkeypatch, *, health, export, export_status=200):
        """Answer `/api/health` and `/api/v1/sdrs` differently, like a real Sentry."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/health":
                if isinstance(health, Exception):
                    raise health
                return httpx.Response(
                    200, json=health, headers={"X-Sentry-Api-Version": "1.4"}
                )
            assert request.url.path == "/api/v1/sdrs"
            return httpx.Response(export_status, json=export)

        _install_mock_transport(monkeypatch, handler)

    def test_unknown_host_returns_404(self, client):
        assert client.get("/api/sdr/sentry-hosts/999/info").status_code == 404

    def test_reachable_host_returns_health_source_and_location(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch,
            health={"status": "ok", "version": "0.1.0", "uptime_s": 12.5},
            export={
                "control_port_offset": 2,
                "source": {
                    "name": "sentry",
                    "version": "0.1.0",
                    "host": "10.0.0.5",
                    "http_port": 8000,
                    "location": {
                        "latitude": 54.951186,
                        "longitude": -1.532995,
                        "updated_at": 1786634207233,
                    },
                },
            },
        )

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reachable"] is True
        assert body["detail"] == "ok"
        assert body["health"] == {"status": "ok", "version": "0.1.0", "uptime_s": 12.5}
        assert body["source"]["name"] == "sentry"
        assert body["source"]["http_port"] == 8000
        assert body["location"] == {
            "latitude": 54.951186,
            "longitude": -1.532995,
            "updated_at": 1786634207233,
        }
        assert body["control_port_offset"] == 2
        # The live probe's version wins over the (absent) poller snapshot's.
        assert body["api_version"] == "1.4"

    def test_never_leaks_the_auth_token(self, client, monkeypatch):
        created = _create_host(client, auth_token="TOP-SECRET-VALUE")
        self._route_health_and_export(monkeypatch, health={"status": "ok"}, export={})

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info")

        assert "TOP-SECRET-VALUE" not in resp.text
        assert resp.json()["auth_token_set"] is True

    def test_unreachable_host_returns_200_with_null_live_blocks(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch, health=httpx.ConnectError("simulated"), export={}
        )

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reachable"] is False
        assert "Could not reach Sentry host" in body["detail"]
        assert body["health"] is None
        assert body["source"] is None
        assert body["location"] is None
        assert body["control_port_offset"] is None

    def test_rejected_health_surfaces_sentrys_own_code_and_message(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, _ = _json_handler(
            503, {"detail": {"code": "starting", "message": "Still booting."}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info")

        assert resp.status_code == 200
        body = resp.json()
        assert body["reachable"] is False
        assert body["detail"] == "starting: Still booting."
        assert body["health"] is None

    def test_failed_export_leaves_location_blank_but_host_reachable(
        self, client, monkeypatch
    ):
        """An older Sentry without `/api/v1/sdrs` is reachable, just unlocated."""
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch,
            health={"status": "ok"},
            export={"detail": {"code": "not_found", "message": "No such route."}},
            export_status=404,
        )

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info")

        body = resp.json()
        assert body["reachable"] is True
        assert body["health"] == {"status": "ok"}
        assert body["source"] is None
        assert body["location"] is None

    @pytest.mark.parametrize(
        "export",
        [
            {},
            {"source": None},
            {"source": "not-an-object"},
            {"source": []},
        ],
    )
    def test_export_without_a_usable_source_block_yields_no_source(
        self, client, monkeypatch, export
    ):
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch, health={"status": "ok"}, export=export
        )

        body = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info").json()

        assert body["source"] is None
        assert body["location"] is None

    def test_source_fields_of_the_wrong_type_are_dropped_not_fatal(
        self, client, monkeypatch
    ):
        """Sentry is a remote service — a surprising payload must degrade, not 500."""
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch,
            health={"status": "ok"},
            export={
                "control_port_offset": "two",
                "source": {
                    "name": 42,
                    "version": None,
                    "host": ["10.0.0.5"],
                    "http_port": "8000",
                    "location": "somewhere",
                },
            },
        )

        body = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info").json()

        assert body["source"] == {
            "name": None,
            "version": None,
            "host": None,
            "http_port": None,
            "location": None,
        }
        assert body["location"] is None
        assert body["control_port_offset"] is None

    def test_unknown_location_keys_are_ignored(self, client, monkeypatch):
        """A newer Sentry may add keys; only the three known ones are read."""
        created = _create_host(client)
        self._route_health_and_export(
            monkeypatch,
            health={"status": "ok"},
            export={
                "source": {
                    "location": {
                        "latitude": 1.5,
                        "longitude": 2.5,
                        "updated_at": 99,
                        "altitude_m": 130,
                    }
                }
            },
        )

        body = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info").json()

        assert body["location"] == {
            "latitude": 1.5,
            "longitude": 2.5,
            "updated_at": 99,
        }

    def test_poller_telemetry_is_included_when_a_snapshot_exists(
        self, client, monkeypatch
    ):
        from backend.services.sentry_fleet import HostSnapshot

        created = _create_host(client)
        monkeypatch.setattr(
            sentry_router.fleet_poller,
            "get_snapshot",
            lambda host_id: HostSnapshot(
                host_id=host_id,
                reachable=True,
                api_version="9.9",
                last_polled_at=4321,
                last_success_at=1234,
            ),
        )
        self._route_health_and_export(monkeypatch, health={"status": "ok"}, export={})

        body = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info").json()

        assert body["last_polled_at"] == 4321
        assert body["last_success_at"] == 1234

    def test_snapshot_api_version_is_used_when_the_probe_reports_none(
        self, client, monkeypatch
    ):
        from backend.services.sentry_fleet import HostSnapshot

        created = _create_host(client)
        monkeypatch.setattr(
            sentry_router.fleet_poller,
            "get_snapshot",
            lambda host_id: HostSnapshot(host_id=host_id, api_version="7.7"),
        )

        def handler(request: httpx.Request) -> httpx.Response:
            # No X-Sentry-Api-Version header on either response.
            return httpx.Response(200, json={"status": "ok"})

        _install_mock_transport(monkeypatch, handler)

        body = client.get(f"/api/sdr/sentry-hosts/{created['id']}/info").json()

        assert body["api_version"] == "7.7"


# ── device proxy ───────────────────────────────────────────────────────────────


class TestDeviceProxy:
    def test_patch_device_proxies_response_verbatim_and_refreshes_the_poller(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(200, {"id": "usb:1", "name": "renamed"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.patch(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1",
            json={"name": "renamed"},
        )

        assert resp.status_code == 200
        assert resp.json() == {"id": "usb:1", "name": "renamed"}
        assert json.loads(captured["request"].content) == {"name": "renamed"}
        sentry_router.fleet_poller.refresh_now.assert_awaited_once_with(created["id"])

    def test_patch_device_propagates_sentrys_status_code_and_body_verbatim(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, _ = _json_handler(
            422,
            {
                "detail": {
                    "code": "invalid_field",
                    "message": "bad gain",
                    "field": "rf_gain",
                }
            },
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.patch(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1",
            json={"rf_gain": 999},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == {
            "code": "invalid_field",
            "message": "bad gain",
            "field": "rf_gain",
        }
        sentry_router.fleet_poller.refresh_now.assert_not_awaited()

    def test_patch_device_translates_plain_string_detail(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(404, {"detail": "no such device"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.patch(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1", json={}
        )

        assert resp.status_code == 404
        assert resp.json()["detail"] == {
            "code": "upstream_error",
            "message": "no such device",
        }

    def test_patch_device_unreachable_host_returns_502(self, client, monkeypatch):
        created = _create_host(client)

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("simulated")

        _install_mock_transport(monkeypatch, handler)

        resp = client.patch(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1", json={}
        )

        assert resp.status_code == 502
        assert resp.json()["detail"]["code"] == "sentry_unreachable"

    def test_patch_device_unknown_host_returns_404_without_calling_sentry(
        self, client, monkeypatch
    ):
        resp = client.patch("/api/sdr/sentry-hosts/999/devices/usb:1", json={})
        assert resp.status_code == 404
        sentry_router.fleet_poller.refresh_now.assert_not_awaited()

    def test_delete_device_returns_204_and_refreshes_the_poller(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, _ = _json_handler(204)
        _install_mock_transport(monkeypatch, handler)

        resp = client.delete(f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1")

        assert resp.status_code == 204
        sentry_router.fleet_poller.refresh_now.assert_awaited_once_with(created["id"])

    def test_delete_device_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            409, {"detail": {"code": "device_busy", "message": "in use"}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.delete(f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1")

        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "device_busy"

    def test_flash_serial_requires_confirm_true(self, client):
        created = _create_host(client)
        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1/serial",
            json={"serial": "SN0001", "confirm": False},
        )
        assert resp.status_code == 422

    def test_flash_serial_rejects_malformed_serial(self, client):
        created = _create_host(client)
        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1/serial",
            json={"serial": "bad serial!", "confirm": True},
        )
        assert resp.status_code == 422

    def test_flash_serial_success_returns_202_and_refreshes_the_poller(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(202, {"status": "flashing"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1/serial",
            json={"serial": "SN0001", "confirm": True},
        )

        assert resp.status_code == 202
        assert resp.json() == {"status": "flashing"}
        assert json.loads(captured["request"].content) == {
            "serial": "SN0001",
            "confirm": True,
        }
        sentry_router.fleet_poller.refresh_now.assert_awaited_once_with(created["id"])

    def test_flash_serial_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            409, {"detail": {"code": "device_busy", "message": "already flashing"}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/devices/usb:1/serial",
            json={"serial": "SN0001", "confirm": True},
        )

        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "device_busy"


# ── WiFi/hotspot proxy ───────────────────────────────────────────────────────────


class TestWifiProxy:
    def test_get_wifi_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999/wifi")
        assert resp.status_code == 404

    def test_get_wifi_returns_sentrys_response_verbatim(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(200, {"ssid": "MyNet", "enabled": True})
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi")

        assert resp.status_code == 200
        assert resp.json() == {"ssid": "MyNet", "enabled": True}

    def test_get_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(404, {"detail": "no hotspot configured"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi")

        assert resp.status_code == 404

    def test_get_wifi_unreachable_returns_502(self, client, monkeypatch):
        created = _create_host(client)

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("simulated")

        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi")

        assert resp.status_code == 502

    def test_put_wifi_forwards_body_including_null_passphrase_when_omitted(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(200, {"ssid": "MyNet"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi", json={"ssid": "MyNet"}
        )

        assert resp.status_code == 200
        sent = json.loads(captured["request"].content)
        assert sent["ssid"] == "MyNet"
        assert sent["passphrase"] is None

    def test_put_wifi_transmits_passphrase_to_sentry_but_never_echoes_it_back(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(
            200, {"ssid": "MyNet"}
        )  # Sentry's own response omits the passphrase
        _install_mock_transport(monkeypatch, handler)

        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi",
            json={"ssid": "MyNet", "passphrase": "wifi-secret-value"},
        )

        assert resp.status_code == 200
        assert (
            json.loads(captured["request"].content)["passphrase"] == "wifi-secret-value"
        )
        assert "wifi-secret-value" not in resp.text

    def test_put_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            422, {"detail": {"code": "invalid_channel", "message": "bad channel"}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi", json={"ssid": "MyNet"}
        )

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "invalid_channel"

    @pytest.mark.parametrize(
        "overrides",
        [
            {"ssid": ""},
            {"ssid": "x" * 33},
            {"ssid": "ok", "security": "wep"},
            {"ssid": "ok", "band": "z"},
            {"ssid": "ok", "channel": 300},
            {"ssid": "ok", "channel": -1},
            {"ssid": "ok", "interface": "bad interface name!"},
        ],
    )
    def test_put_wifi_rejects_invalid_fields(self, client, overrides):
        created = _create_host(client)
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}/wifi", json=overrides)
        assert resp.status_code == 422

    def test_delete_wifi_returns_204(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(204)
        _install_mock_transport(monkeypatch, handler)

        resp = client.delete(f"/api/sdr/sentry-hosts/{created['id']}/wifi")

        assert resp.status_code == 204

    def test_delete_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(404, {"detail": "no hotspot configured"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.delete(f"/api/sdr/sentry-hosts/{created['id']}/wifi")

        assert resp.status_code == 404

    def test_enable_wifi_forwards_confirm_flag_and_returns_sentrys_body(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(200, {"enabled": True})
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi/enable",
            json={"confirm_uplink_loss": True},
        )

        assert resp.status_code == 200
        assert json.loads(captured["request"].content) == {"confirm_uplink_loss": True}

    def test_enable_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            409, {"detail": {"code": "uplink_conflict", "message": "would drop uplink"}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi/enable", json={}
        )

        assert resp.status_code == 409

    def test_disable_wifi_forwards_confirm_flag_and_returns_sentrys_body(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        handler, captured = _json_handler(200, {"enabled": False})
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi/disable",
            json={"confirm_uplink_loss": False},
        )

        assert resp.status_code == 200
        assert json.loads(captured["request"].content) == {"confirm_uplink_loss": False}

    def test_disable_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        _install_mock_transport(
            monkeypatch, lambda request: httpx.Response(502, content=b"gateway error")
        )

        resp = client.post(
            f"/api/sdr/sentry-hosts/{created['id']}/wifi/disable", json={}
        )

        assert resp.status_code == 502
        assert resp.json()["detail"]["code"] == "upstream_error"

    def test_confirm_wifi_success_returns_sentrys_body(self, client, monkeypatch):
        created = _create_host(client)
        handler, captured = _json_handler(200, {"confirmed": True})
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(f"/api/sdr/sentry-hosts/{created['id']}/wifi/confirm")

        assert resp.status_code == 200
        assert resp.json() == {"confirmed": True}
        assert captured["request"].method == "POST"

    def test_confirm_wifi_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            400,
            {"detail": {"code": "no_pending_confirm", "message": "nothing to confirm"}},
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.post(f"/api/sdr/sentry-hosts/{created['id']}/wifi/confirm")

        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "no_pending_confirm"

    def test_confirm_wifi_unknown_host_returns_404(self, client):
        resp = client.post("/api/sdr/sentry-hosts/999/wifi/confirm")
        assert resp.status_code == 404

    def test_list_wifi_interfaces_success(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(200, [{"name": "wlan0"}])
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi/interfaces")

        assert resp.status_code == 200
        assert resp.json() == [{"name": "wlan0"}]

    def test_list_wifi_interfaces_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(500, {"detail": "internal error"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi/interfaces")

        assert resp.status_code == 500

    def test_list_wifi_interfaces_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999/wifi/interfaces")
        assert resp.status_code == 404

    def test_list_wifi_clients_success(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(200, [{"mac": "aa:bb:cc:dd:ee:ff"}])
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi/clients")

        assert resp.status_code == 200
        assert resp.json() == [{"mac": "aa:bb:cc:dd:ee:ff"}]

    def test_list_wifi_clients_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(503, {"detail": "unavailable"})
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/wifi/clients")

        assert resp.status_code == 503

    def test_list_wifi_clients_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999/wifi/clients")
        assert resp.status_code == 404


# ── Unreachable Pi ────────────────────────────────────────────────────────────


def _unreachable_handler(request: httpx.Request) -> httpx.Response:
    """A MockTransport handler standing in for a Pi that is off, asleep, or on
    the far side of the WiFi the operator is currently reconfiguring."""
    raise httpx.ConnectError("connection refused", request=request)


class TestUnreachableHostPropagation:
    """Every proxy route must report an unreachable Pi as 502 rather than
    surfacing a raw httpx exception as a 500.

    This is the failure that actually happens in the field — far more often
    than a Sentry-authored rejection — so each route is covered explicitly
    rather than trusting that one shared helper is wired into all of them.
    """

    @pytest.fixture
    def host_id(self, client, monkeypatch) -> int:
        created = _create_host(client)
        _install_mock_transport(monkeypatch, _unreachable_handler)
        return int(created["id"])

    def test_patch_device_unreachable_returns_502(self, client, host_id):
        resp = client.patch(
            f"/api/sdr/sentry-hosts/{host_id}/devices/serial:AIS-01",
            json={"notes": "anything"},
        )
        assert resp.status_code == 502

    def test_delete_device_unreachable_returns_502(self, client, host_id):
        resp = client.delete(f"/api/sdr/sentry-hosts/{host_id}/devices/serial:AIS-01")
        assert resp.status_code == 502

    def test_flash_serial_unreachable_returns_502(self, client, host_id):
        resp = client.post(
            f"/api/sdr/sentry-hosts/{host_id}/devices/serial:AIS-01/serial",
            json={"serial": "AIS-02", "confirm": True},
        )
        assert resp.status_code == 502

    def test_put_wifi_unreachable_returns_502(self, client, host_id):
        resp = client.put(
            f"/api/sdr/sentry-hosts/{host_id}/wifi",
            json={"ssid": "sentry-net", "passphrase": "longenoughpassphrase"},
        )
        assert resp.status_code == 502

    def test_delete_wifi_unreachable_returns_502(self, client, host_id):
        resp = client.delete(f"/api/sdr/sentry-hosts/{host_id}/wifi")
        assert resp.status_code == 502

    def test_enable_wifi_unreachable_returns_502(self, client, host_id):
        resp = client.post(f"/api/sdr/sentry-hosts/{host_id}/wifi/enable", json={})
        assert resp.status_code == 502

    def test_disable_wifi_unreachable_returns_502(self, client, host_id):
        resp = client.post(f"/api/sdr/sentry-hosts/{host_id}/wifi/disable", json={})
        assert resp.status_code == 502

    def test_confirm_wifi_unreachable_returns_502(self, client, host_id):
        resp = client.post(f"/api/sdr/sentry-hosts/{host_id}/wifi/confirm")
        assert resp.status_code == 502

    def test_list_wifi_interfaces_unreachable_returns_502(self, client, host_id):
        resp = client.get(f"/api/sdr/sentry-hosts/{host_id}/wifi/interfaces")
        assert resp.status_code == 502

    def test_list_wifi_clients_unreachable_returns_502(self, client, host_id):
        resp = client.get(f"/api/sdr/sentry-hosts/{host_id}/wifi/clients")
        assert resp.status_code == 502


# ── Schema validator branches ─────────────────────────────────────────────────


class TestHostPatchValidators:
    """`SentryHostPatch` fields are all optional, so each validator has a
    None-passthrough branch as well as its rejection branch."""

    def test_omitting_a_field_leaves_it_untouched(self, client):
        created = _create_host(client, name="Original", address="10.0.0.5", port=8000)

        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"enabled": False}
        )

        assert resp.status_code == 200
        assert resp.json()["name"] == "Original"
        assert resp.json()["address"] == "10.0.0.5"
        assert resp.json()["port"] == 8000
        assert resp.json()["enabled"] is False
        # The stored token survives a patch that does not mention it.
        assert resp.json()["auth_token_set"] is True

    def test_explicit_null_clears_the_name_but_not_the_connection_details(self, client):
        """`name` is the one field where an explicit null means "clear it".

        The others fall back to the stored value, matching Sentry's own
        convention for the hotspot passphrase — omitting it means "leave the
        stored one alone", and there is no sense in which a host has no address.
        """
        created = _create_host(client, name="Original", address="10.0.0.5", port=8000)

        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}",
            json={
                "name": None,
                "address": None,
                "port": None,
                "auth_token": None,
                "enabled": True,
            },
        )

        assert resp.status_code == 200
        assert resp.json()["name"] is None
        assert resp.json()["address"] == "10.0.0.5"
        assert resp.json()["port"] == 8000
        assert resp.json()["auth_token_set"] is True

    def test_empty_body_is_still_rejected(self, client):
        created = _create_host(client)
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}", json={})
        assert resp.status_code == 422

    def test_over_long_name_is_rejected(self, client):
        created = _create_host(client)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"name": "n" * 500}
        )
        assert resp.status_code == 422

    def test_over_long_auth_token_is_rejected(self, client):
        created = _create_host(client)
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"auth_token": "t" * 5000}
        )
        assert resp.status_code == 422

    def test_whitespace_only_name_becomes_null_rather_than_blank(self, client):
        created = _create_host(client, name="Original")
        resp = client.put(
            f"/api/sdr/sentry-hosts/{created['id']}", json={"name": "   "}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] is None

    def test_over_long_name_is_rejected_on_create(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={
                "name": "n" * 500,
                "address": "10.0.0.9",
                "port": 8000,
                "auth_token": "",
            },
        )
        assert resp.status_code == 422

    def test_over_long_auth_token_is_rejected_on_create(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={
                "name": "Pi",
                "address": "10.0.0.9",
                "port": 8000,
                "auth_token": "t" * 5000,
            },
        )
        assert resp.status_code == 422


class TestWifiConfigValidators:
    """`WifiConfigIn` constrains the fields Sentry would otherwise reject on a
    round trip, so the operator gets the error without waking the Pi."""

    @pytest.mark.parametrize(
        "field,value",
        [
            ("security", "wep"),
            ("security", ""),
            ("band", "ac"),
            ("channel", -1),
            ("channel", 197),
            ("interface", "wlan0!"),
            ("interface", "x" * 16),
            ("interface", ""),
        ],
    )
    def test_invalid_values_are_rejected(self, client, field, value):
        created = _create_host(client)
        body = {
            "ssid": "sentry-net",
            "passphrase": "longenoughpassphrase",
            field: value,
        }
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}/wifi", json=body)
        assert resp.status_code == 422, f"{field}={value!r} was accepted"

    @pytest.mark.parametrize(
        "field,value",
        [
            ("security", "wpa2"),
            ("security", "wpa3"),
            ("band", "bg"),
            ("band", "a"),
            ("channel", 0),
            ("channel", 196),
            ("interface", "wlan0"),
            ("interface", None),
        ],
    )
    def test_valid_boundary_values_are_accepted(
        self, client, monkeypatch, field, value
    ):
        created = _create_host(client)
        handler, _ = _json_handler(200, {"ssid": "sentry-net"})
        _install_mock_transport(monkeypatch, handler)

        body = {
            "ssid": "sentry-net",
            "passphrase": "longenoughpassphrase",
            field: value,
        }
        resp = client.put(f"/api/sdr/sentry-hosts/{created['id']}/wifi", json=body)

        assert resp.status_code == 200, f"{field}={value!r} was rejected: {resp.text}"


class TestHostCreateWithoutName:
    """`name` is an optional cosmetic label — a host created without one falls
    back to its address in the UI, so omitting it must be accepted."""

    def test_creating_a_host_with_no_name_is_accepted(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={"address": "10.0.0.7", "port": 8000, "auth_token": ""},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] is None

    def test_creating_a_host_with_an_explicit_null_name_is_accepted(self, client):
        resp = client.post(
            "/api/sdr/sentry-hosts",
            json={"name": None, "address": "10.0.0.8", "port": 8000, "auth_token": ""},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] is None


class TestDeviceRecordsProxy:
    """`GET /{host_id}/devices/records` proxies Sentry's persisted configuration.

    Distinct from the cached `/devices` snapshot: `DeviceStatus` carries no
    tuning fields, so an edit form driven off the snapshot alone would show them
    blank and write those blanks back on save.
    """

    def test_unknown_host_returns_404(self, client):
        resp = client.get("/api/sdr/sentry-hosts/999/devices/records")
        assert resp.status_code == 404

    def test_returns_sentrys_body_verbatim_including_tuning_and_suggestion(
        self, client, monkeypatch
    ):
        created = _create_host(client)
        body = {
            "devices": [
                {
                    "device_id": "serial:AIS-01",
                    "name": "AIS SDR",
                    "output_port": 1234,
                    "sample_rate": 2048000,
                    "gain_db": 28.0,
                    "gain_auto": False,
                    "ppm_correction": 3,
                    "bias_tee": True,
                    "direct_sampling": 0,
                }
            ],
            "port_suggestion": 1242,
            "constraints": {"min_port": 1024, "max_port": 65533},
        }
        handler, captured = _json_handler(200, body)
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/devices/records")

        assert resp.status_code == 200
        assert resp.json() == body
        # Sentry's own route, not the status one — the two carry different shapes.
        assert captured["request"].url.path == "/api/devices"

    def test_propagates_sentrys_error(self, client, monkeypatch):
        created = _create_host(client)
        handler, _ = _json_handler(
            403, {"detail": {"code": "forbidden", "message": "Nope."}}
        )
        _install_mock_transport(monkeypatch, handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/devices/records")

        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "forbidden"

    def test_unreachable_returns_502(self, client, monkeypatch):
        created = _create_host(client)
        _install_mock_transport(monkeypatch, _unreachable_handler)

        resp = client.get(f"/api/sdr/sentry-hosts/{created['id']}/devices/records")

        assert resp.status_code == 502
