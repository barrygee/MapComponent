"""Characterization tests for the air router (excluding the ADS-B upstream
proxy, which hits external HTTP)."""

from __future__ import annotations

import logging

import httpx

from backend.services import adsb as adsb_service


# ── /api/air/messages ─────────────────────────────────────────────────────────


class TestAirMessages:
    def test_list_empty(self, client):
        resp = client.get("/api/air/messages")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_returns_201(self, client):
        body = {
            "msg_id": "m1",
            "type": "flight",
            "title": "X",
            "detail": "Y",
            "ts": 100,
        }
        resp = client.post("/api/air/messages", json=body)
        assert resp.status_code == 201
        assert resp.json() == {"status": "created"}

    def test_create_is_idempotent_by_msg_id(self, client):
        body = {"msg_id": "m1", "type": "flight", "title": "X", "ts": 1}
        client.post("/api/air/messages", json=body)
        # Second create with same msg_id returns 200 'exists'
        resp = client.post("/api/air/messages", json=body)
        assert resp.status_code == 200
        assert resp.json() == {"status": "exists"}

    def test_list_returns_newest_first(self, client):
        for i, ts in enumerate([100, 300, 200]):
            client.post(
                "/api/air/messages",
                json={"msg_id": f"m{i}", "type": "flight", "title": str(i), "ts": ts},
            )
        msgs = client.get("/api/air/messages").json()
        assert [m["ts"] for m in msgs] == [300, 200, 100]

    def test_list_omits_dismissed_flag(self, client):
        client.post(
            "/api/air/messages",
            json={"msg_id": "m1", "type": "flight", "title": "X", "ts": 1},
        )
        msg = client.get("/api/air/messages").json()[0]
        assert set(msg.keys()) == {"msg_id", "type", "title", "detail", "ts"}

    def test_dismiss_unknown_is_idempotent(self, client):
        # The endpoint is intentionally idempotent: dismissing a missing
        # message returns 200 {"status": "absent"}, not 404 (see docstring).
        resp = client.delete("/api/air/messages/does_not_exist")
        assert resp.status_code == 200
        assert resp.json() == {"status": "absent"}

    def test_dismiss_hides_from_list(self, client):
        client.post(
            "/api/air/messages",
            json={"msg_id": "m1", "type": "flight", "title": "X", "ts": 1},
        )
        resp = client.delete("/api/air/messages/m1")
        assert resp.status_code == 200
        assert resp.json() == {"status": "dismissed"}
        assert client.get("/api/air/messages").json() == []

    def test_dismiss_all_clears_list(self, client):
        for i in range(3):
            client.post(
                "/api/air/messages",
                json={"msg_id": f"m{i}", "type": "flight", "title": "X", "ts": i},
            )
        resp = client.delete("/api/air/messages")
        assert resp.status_code == 200
        assert resp.json() == {"status": "cleared"}
        assert client.get("/api/air/messages").json() == []


# ── /api/air/tracking ─────────────────────────────────────────────────────────


class TestAirTracking:
    def test_list_empty(self, client):
        resp = client.get("/api/air/tracking")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_add_returns_201(self, client):
        resp = client.post(
            "/api/air/tracking",
            json={"hex": "abc123", "callsign": "TEST", "follow": False},
        )
        assert resp.status_code == 201
        assert resp.json() == {"status": "created"}

    def test_add_persists_fields(self, client):
        client.post(
            "/api/air/tracking",
            json={"hex": "abc123", "callsign": "TEST", "follow": True},
        )
        rows = client.get("/api/air/tracking").json()
        assert len(rows) == 1
        assert rows[0]["hex"] == "abc123"
        assert rows[0]["callsign"] == "TEST"
        assert rows[0]["follow"] is True
        assert isinstance(rows[0]["added_at"], int)

    def test_add_existing_returns_200_updated(self, client):
        client.post("/api/air/tracking", json={"hex": "abc123", "callsign": "A"})
        resp = client.post(
            "/api/air/tracking",
            json={"hex": "abc123", "callsign": "B", "follow": True},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "updated"}
        row = client.get("/api/air/tracking").json()[0]
        assert row["callsign"] == "B"
        assert row["follow"] is True

    def test_remove_existing(self, client):
        client.post("/api/air/tracking", json={"hex": "abc123"})
        resp = client.delete("/api/air/tracking/abc123")
        assert resp.status_code == 200
        assert resp.json() == {"status": "removed"}
        assert client.get("/api/air/tracking").json() == []

    def test_remove_unknown_returns_200(self, client):
        # API contract: deleting an unknown hex is idempotent — still returns "removed".
        resp = client.delete("/api/air/tracking/never_existed")
        assert resp.status_code == 200
        assert resp.json() == {"status": "removed"}


# ── /api/air/recordings/available-dates ───────────────────────────────────────


class TestRecordingsAvailableDates:
    def test_empty_returns_empty_list(self, client):
        resp = client.get("/api/air/recordings/available-dates")
        assert resp.status_code == 200
        assert resp.json() == []


# ── /api/air/snapshots ────────────────────────────────────────────────────────


class TestSnapshotsWindow:
    def test_empty_window_returns_aircraft_empty(self, client):
        resp = client.get("/api/air/snapshots", params={"start_ms": 0, "end_ms": 1000})
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"start_ms": 0, "end_ms": 1000, "aircraft": {}}

    def test_window_over_24h_returns_400(self, client):
        # 24h + 1ms exceeds the cap → 400
        cap = 24 * 3600 * 1000
        resp = client.get(
            "/api/air/snapshots", params={"start_ms": 0, "end_ms": cap + 1}
        )
        assert resp.status_code == 400

    def test_window_exactly_24h_is_accepted(self, client):
        cap = 24 * 3600 * 1000
        resp = client.get("/api/air/snapshots", params={"start_ms": 0, "end_ms": cap})
        assert resp.status_code == 200


# ── /api/air/flights ──────────────────────────────────────────────────────────


class TestFlightsList:
    def test_empty(self, client):
        resp = client.get("/api/air/flights")
        assert resp.status_code == 200
        # Pin shape — empty list or {} depending on serializer. Accept either.
        body = resp.json()
        assert body in ([], {})

    def test_unknown_registration_returns_empty_list(self, client):
        # Current contract: unknown registration is not a 404 — it returns an
        # empty list of flights, same as a known registration with no history.
        resp = client.get("/api/air/flights/UNKNOWN")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_delete_unknown_registration(self, client):
        # Pin current contract — should not 500.
        resp = client.delete("/api/air/flights/UNKNOWN")
        assert resp.status_code in (200, 404)


# ── /api/air/adsb/point — upstream failure handling ───────────────────────────


class TestAdsbUpstreamFailover:
    """The source loop's failure branches, which decide what an outage looks like.

    These mock `fetch_aircraft` rather than hitting the network, so unlike the
    rest of the proxy they are safe to run offline.

    The regression that motivated them: airplanes.live closed its v2 API behind
    an auth key, and the resulting 403 was indistinguishable from "no aircraft
    overhead" — it fell through to the offgrid source and returned its empty
    list with no log line naming the real cause.
    """

    ONLINE = "https://online.example/v2"
    OFFGRID = "http://offgrid.example/data/aircraft.json"
    POINT = "/api/air/adsb/point/54.0/-1.5/100"

    def _configure_sources(self, client):
        """Give the router both an online and an offgrid source to fail over between."""
        client.put("/api/settings/air/onlineDataSourceURL", json={"value": self.ONLINE})
        client.put(
            "/api/settings/air/offgridDataSourceURL",
            json={"value": {"url": self.OFFGRID}},
        )

    @staticmethod
    def _status_error(status_code: int) -> httpx.HTTPStatusError:
        request = httpx.Request("GET", "https://online.example/v2/point/54.0/-1.5/100")
        response = httpx.Response(status_code, request=request)
        return httpx.HTTPStatusError("boom", request=request, response=response)

    @staticmethod
    def _air_warnings(caplog) -> str:
        """Only this router's warnings — caplog also collects httpx's INFO chatter."""
        return "\n".join(
            record.getMessage()
            for record in caplog.records
            if record.name == "backend.routers.air"
            and record.levelno >= logging.WARNING
        )

    def _patch_fetch(self, monkeypatch, behaviour):
        """Replace the upstream fetch with `behaviour(base_url)`, recording calls."""
        calls: list[str] = []

        async def fake_fetch(lat, lon, radius, base_url):
            calls.append(base_url)
            return behaviour(base_url)

        monkeypatch.setattr(adsb_service, "fetch_aircraft", fake_fetch)
        return calls

    def test_403_falls_through_to_offgrid_and_warns(self, client, monkeypatch, caplog):
        """An auth failure must not masquerade as an empty sky."""
        self._configure_sources(client)
        payload = {"ac": [{"hex": "abc123"}], "total": 1}

        def behaviour(base_url):
            if base_url == self.ONLINE:
                raise self._status_error(403)
            return payload

        calls = self._patch_fetch(monkeypatch, behaviour)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            resp = client.get(self.POINT)

        # Failed over rather than surfacing the error to the client.
        assert resp.status_code == 200
        assert resp.json() == payload
        assert resp.headers["X-Cache"] == "MISS"
        # Both sources were tried, online first.
        assert calls == [self.ONLINE, self.OFFGRID]
        # ...and the 403 named itself, with host and status.
        warnings = self._air_warnings(caplog)
        assert "online.example" in warnings
        assert "403" in warnings

    def test_429_does_not_log_the_status_warning(self, client, monkeypatch, caplog):
        """429 is an expected, self-correcting condition — it has its own path."""
        self._configure_sources(client)

        def behaviour(base_url):
            raise self._status_error(429)

        self._patch_fetch(monkeypatch, behaviour)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            resp = client.get(self.POINT)

        # No cached row exists, so an all-sources failure is a 503.
        assert resp.status_code == 503
        # The "returned HTTP" warning belongs to the non-429 branch only.
        assert "returned HTTP" not in self._air_warnings(caplog)

    def test_transport_error_warns_with_exception_name(
        self, client, monkeypatch, caplog
    ):
        """An unreachable host is the other way this silently produced a blank map."""
        self._configure_sources(client)

        def behaviour(base_url):
            raise httpx.ConnectError("no route to host")

        self._patch_fetch(monkeypatch, behaviour)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            resp = client.get(self.POINT)

        assert resp.status_code == 503
        warnings = self._air_warnings(caplog)
        assert "unreachable" in warnings
        assert "ConnectError" in warnings
        # Both sources are named, so a two-source outage is fully diagnosable.
        assert "online.example" in warnings
        assert "offgrid.example" in warnings

    def test_successful_primary_short_circuits_and_stays_quiet(
        self, client, monkeypatch, caplog
    ):
        """The happy path must not touch the fallback or log anything."""
        self._configure_sources(client)
        payload = {"ac": [], "total": 0}
        calls = self._patch_fetch(monkeypatch, lambda base_url: payload)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            resp = client.get(self.POINT)

        assert resp.status_code == 200
        assert calls == [self.ONLINE]
        assert self._air_warnings(caplog) == ""
