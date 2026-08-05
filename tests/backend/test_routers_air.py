"""Characterization tests for the air router (excluding the ADS-B upstream
proxy, which hits external HTTP)."""

from __future__ import annotations


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
