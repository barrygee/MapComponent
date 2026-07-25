"""Characterization tests for the settings router.

Pins the JSON shapes and status codes of every endpoint so the Phase 2B
refactor (db_helpers, error_handlers) cannot silently change the API contract.
"""

from __future__ import annotations

import io
import json


# ── GET /api/settings ─────────────────────────────────────────────────────────


class TestGetAllSettings:
    def test_empty_database_returns_empty_object(self, client):
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_after_put_returns_grouped_namespace(self, client):
        client.put("/api/settings/air/foo", json={"value": "bar"})
        client.put("/api/settings/air/baz", json={"value": 42})
        client.put("/api/settings/space/qux", json={"value": True})

        resp = client.get("/api/settings")
        assert resp.status_code == 200
        assert resp.json() == {
            "air": {"foo": "bar", "baz": 42},
            "space": {"qux": True},
        }


# ── GET /api/settings/{namespace} ─────────────────────────────────────────────


class TestGetNamespace:
    def test_unknown_namespace_returns_empty_object(self, client):
        resp = client.get("/api/settings/does_not_exist")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_returns_key_value_map(self, client):
        client.put("/api/settings/air/onlineUrl", json={"value": "https://example.com"})
        client.put("/api/settings/air/offgridUrl", json={"value": ""})

        resp = client.get("/api/settings/air")
        assert resp.status_code == 200
        assert resp.json() == {
            "onlineUrl": "https://example.com",
            "offgridUrl": "",
        }

    def test_does_not_leak_other_namespaces(self, client):
        client.put("/api/settings/air/a", json={"value": 1})
        client.put("/api/settings/space/b", json={"value": 2})

        air = client.get("/api/settings/air").json()
        assert "a" in air and "b" not in air


# ── PUT /api/settings/{namespace}/{key} ───────────────────────────────────────


class TestUpsertSetting:
    def test_insert_returns_ok(self, client):
        resp = client.put("/api/settings/air/key1", json={"value": "first"})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_update_overwrites_previous_value(self, client):
        client.put("/api/settings/air/key1", json={"value": "first"})
        client.put("/api/settings/air/key1", json={"value": "second"})
        resp = client.get("/api/settings/air")
        assert resp.json() == {"key1": "second"}

    def test_value_can_be_object(self, client):
        payload = {"nested": {"a": 1, "b": [2, 3]}}
        client.put("/api/settings/space/blob", json={"value": payload})
        assert client.get("/api/settings/space").json() == {"blob": payload}

    def test_value_can_be_list(self, client):
        client.put("/api/settings/air/list", json={"value": [1, 2, 3]})
        assert client.get("/api/settings/air").json() == {"list": [1, 2, 3]}

    def test_value_can_be_boolean(self, client):
        client.put("/api/settings/air/flag", json={"value": True})
        assert client.get("/api/settings/air").json() == {"flag": True}


# ── app.location validation (PUT + config upload) ─────────────────────────────


class TestAppLocationValidation:
    def test_valid_pair_is_stored(self, client):
        resp = client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": 54.97, "longitude": -1.6}},
        )
        assert resp.status_code == 200
        assert client.get("/api/settings/app").json() == {
            "location": {"latitude": 54.97, "longitude": -1.6}
        }

    def test_empty_pair_stored_as_unset(self, client):
        resp = client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": "", "longitude": ""}},
        )
        assert resp.status_code == 200
        assert client.get("/api/settings/app").json() == {
            "location": {"latitude": "", "longitude": ""}
        }

    def test_out_of_range_latitude_returns_400(self, client):
        resp = client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": 200, "longitude": 0}},
        )
        assert resp.status_code == 400

    def test_partial_pair_returns_400(self, client):
        resp = client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": 54.97, "longitude": ""}},
        )
        assert resp.status_code == 400

    def test_non_numeric_returns_400(self, client):
        resp = client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": "abc", "longitude": "def"}},
        )
        assert resp.status_code == 400

    def test_location_round_trips_through_preview(self, client):
        client.put(
            "/api/settings/app/location",
            json={"value": {"latitude": 54.97, "longitude": -1.6}},
        )
        body = json.loads(client.get("/api/settings/config/preview").content)
        assert body["app"]["location"] == {"latitude": 54.97, "longitude": -1.6}

    def test_upload_with_invalid_location_returns_400(self, client):
        resp = client.post(
            "/api/settings/config/upload",
            files={
                "file": (
                    "config.json",
                    io.BytesIO(
                        json.dumps(
                            {"app": {"location": {"latitude": 999, "longitude": 0}}}
                        ).encode()
                    ),
                    "application/json",
                )
            },
        )
        assert resp.status_code == 400

    def test_upload_with_valid_location_persists(self, client):
        client.post(
            "/api/settings/config/upload",
            files={
                "file": (
                    "config.json",
                    io.BytesIO(
                        json.dumps(
                            {"app": {"location": {"latitude": 1.5, "longitude": 2.5}}}
                        ).encode()
                    ),
                    "application/json",
                )
            },
        )
        assert client.get("/api/settings/app").json() == {
            "location": {"latitude": 1.5, "longitude": 2.5}
        }


# ── GET /api/settings/config/preview ──────────────────────────────────────────


class TestConfigPreview:
    def test_returns_json_content_type(self, client):
        resp = client.get("/api/settings/config/preview")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/json")

    def test_empty_database_is_empty_object(self, client):
        resp = client.get("/api/settings/config/preview")
        assert json.loads(resp.content) == {}

    def test_includes_all_namespaces(self, client):
        client.put("/api/settings/air/a", json={"value": 1})
        client.put("/api/settings/space/b", json={"value": 2})
        body = json.loads(client.get("/api/settings/config/preview").content)
        assert body == {"air": {"a": 1}, "space": {"b": 2}}


# ── POST /api/settings/config/upload ──────────────────────────────────────────


class TestConfigUpload:
    def _upload(self, client, payload):
        return client.post(
            "/api/settings/config/upload",
            files={
                "file": (
                    "config.json",
                    io.BytesIO(json.dumps(payload).encode()),
                    "application/json",
                )
            },
        )

    def test_returns_status_ok(self, client):
        resp = self._upload(client, {"air": {"key": "value"}})
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_settings_are_persisted_after_upload(self, client):
        self._upload(client, {"air": {"a": 1, "b": 2}, "space": {"c": 3}})
        assert client.get("/api/settings").json() == {
            "air": {"a": 1, "b": 2},
            "space": {"c": 3},
        }

    def test_invalid_json_returns_400(self, client):
        resp = client.post(
            "/api/settings/config/upload",
            files={
                "file": ("config.json", io.BytesIO(b"not json"), "application/json")
            },
        )
        assert resp.status_code == 400

    def test_non_object_root_returns_400(self, client):
        resp = self._upload(client, ["array", "instead", "of", "object"])
        assert resp.status_code == 400

    def test_sdr_radios_get_sequential_ids(self, client):
        payload = {
            "sdr": {
                "radios": [
                    {"name": "a", "host": "h", "port": 1, "enabled": True},
                    {"name": "b", "host": "h", "port": 1, "enabled": True, "id": 5},
                    {"name": "c", "host": "h", "port": 1, "enabled": True},
                ],
            },
        }
        self._upload(client, payload)
        radios = client.get("/api/settings/sdr").json()["radios"]
        ids = [r["id"] for r in radios]
        # `b` already had id=5; `a` and `c` must have integer ids and not collide with each other.
        assert all(isinstance(i, int) for i in ids)
        assert len(set(ids)) == 3

    # ── sdr.groups authority on import ────────────────────────────────────────
    # SDR groups/frequencies are no longer part of config-upload (they live in a
    # dedicated store, excluded via _EXCLUDED_DATA_KEYS). POST /api/sdr/data/
    # frequencies owns the reconcile, so these authority tests target it.
    def _set_sdr_data(self, client, sdr_block):
        return client.post("/api/sdr/data/frequencies", json=sdr_block)

    def test_dangling_group_ref_dropped_when_catalogue_authoritative(self, client):
        # Frequency references "maritime" but it is NOT in groups → the
        # ref is dropped and the group is never created/resurrected.
        payload = {
            "groups": [{"name": "Airband", "slug": "airband"}],
            "frequencies": [
                {
                    "label": "EGNT Tower",
                    "frequency_hz": 119700000,
                    "mode": "AM",
                    "notes": "",
                    "groups": ["airband", "maritime"],
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200

        group_slugs = {g["slug"] for g in client.get("/api/sdr/groups").json()}
        assert group_slugs == {"airband"}
        assert "maritime" not in group_slugs

        freqs = client.get("/api/sdr/frequencies").json()
        assert len(freqs) == 1
        # The frequency keeps only the in-catalogue group.
        group_ids = freqs[0].get("group_ids") or []
        gid_to_slug = {g["id"]: g["slug"] for g in client.get("/api/sdr/groups").json()}
        assert [gid_to_slug[i] for i in group_ids if i] == ["airband"]

    def test_in_catalogue_empty_group_preserved(self, client):
        # "empty" is in groups but referenced by no frequency → kept.
        payload = {
            "groups": [
                {"name": "Airband", "slug": "airband"},
                {"name": "Empty", "slug": "empty"},
            ],
            "frequencies": [
                {
                    "label": "EGNT Tower",
                    "frequency_hz": 119700000,
                    "mode": "AM",
                    "notes": "",
                    "groups": ["airband"],
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        slugs = {g["slug"] for g in client.get("/api/sdr/groups").json()}
        assert slugs == {"airband", "empty"}

    def test_legacy_empty_catalogue_auto_creates_group(self, client):
        # No groups key at all → relaxed (legacy) mode: a slug referenced
        # by a frequency is auto-created so the import is not silently wiped.
        payload = {
            "frequencies": [
                {
                    "label": "EGNT Tower",
                    "frequency_hz": 119700000,
                    "mode": "AM",
                    "notes": "",
                    "groups": ["foo"],
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        slugs = {g["slug"] for g in client.get("/api/sdr/groups").json()}
        assert "foo" in slugs

    # ── per-frequency tuning settings on reconcile ────────────────────────────
    def test_reconcile_parses_per_frequency_settings(self, client):
        payload = {
            "groups": [{"name": "Airband", "slug": "airband"}],
            "frequencies": [
                {
                    "label": "EGNT Tower",
                    "frequency_hz": 119700000,
                    "mode": "AM",
                    "groups": ["airband"],
                    "squelch": -45.0,
                    "gain": 28.0,
                    "bandwidth": 8000,
                    "sample_rate": 1024000,
                    "volume": 55,
                    "zoom": 2.5,
                    "zmin": -80.0,
                    "zmax": -10.0,
                    "scannable": False,
                    "favourite": True,
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        freq = client.get("/api/sdr/frequencies").json()[0]
        assert freq["squelch"] == -45.0
        assert freq["gain"] == 28.0
        assert freq["bandwidth"] == 8000
        assert freq["sample_rate"] == 1024000
        assert freq["volume"] == 55
        assert freq["zoom"] == 2.5
        assert freq["zmin"] == -80.0
        assert freq["zmax"] == -10.0
        assert freq["scannable"] is False
        assert freq["favourite"] is True

    def test_reconcile_defaults_favourite_false_when_absent(self, client):
        # This is the data-loss-prevention pairing: a settings import that
        # doesn't mention `favourite` at all (e.g. an older exported config)
        # must not be misread as "keep whatever was there" — reconcile always
        # rebuilds rows from scratch, so the absent key must resolve to the
        # documented default (False), not True or a stale carry-over.
        payload = {
            "groups": [],
            "frequencies": [
                {
                    "label": "No favourite key",
                    "frequency_hz": 100000000,
                    "mode": "AM",
                    "groups": [],
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        freq = client.get("/api/sdr/frequencies").json()[0]
        assert freq["favourite"] is False

    def test_reconcile_defaults_bandwidth_per_mode_when_omitted(self, client):
        payload = {
            "groups": [],
            "frequencies": [
                {
                    "label": "NFM ch",
                    "frequency_hz": 145000000,
                    "mode": "NFM",
                    "groups": [],
                },
                {
                    "label": "AM ch",
                    "frequency_hz": 119000000,
                    "mode": "AM",
                    "groups": [],
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        by_label = {f["label"]: f for f in client.get("/api/sdr/frequencies").json()}
        # Bandwidth is keyed off the mode when the entry omits it (matches defaultBwHz).
        assert by_label["NFM ch"]["bandwidth"] == 12500
        assert by_label["AM ch"]["bandwidth"] == 10000
        # The rest take their concrete defaults.
        assert by_label["AM ch"]["sample_rate"] == 2048000
        assert by_label["AM ch"]["volume"] == 80
        assert by_label["AM ch"]["zoom"] == 1.0
        assert by_label["AM ch"]["zmin"] == 0.0
        assert by_label["AM ch"]["zmax"] == 0.0

    def test_reconcile_coerces_invalid_setting_values_to_defaults(self, client):
        payload = {
            "groups": [],
            "frequencies": [
                {
                    "label": "Bad",
                    "frequency_hz": 119000000,
                    "mode": "AM",
                    "groups": [],
                    "squelch": "loud",
                    "gain": None,
                    "bandwidth": "wide",
                    "sample_rate": "fast",
                    "volume": "max",
                    "zoom": "x",
                    "zmin": None,
                    "zmax": "y",
                },
            ],
        }
        assert self._set_sdr_data(client, payload).status_code == 200
        freq = client.get("/api/sdr/frequencies").json()[0]
        assert freq["squelch"] == -60.0
        assert freq["gain"] == 30.0
        assert freq["bandwidth"] == 10000  # AM per-mode default
        assert freq["sample_rate"] == 2048000
        assert freq["volume"] == 80
        assert freq["zoom"] == 1.0
        assert freq["zmin"] == 0.0
        assert freq["zmax"] == 0.0


class TestSettingCoercionHelpers:
    def test_coerce_float_parses_or_falls_back(self):
        from backend.routers.settings import _coerce_float

        assert _coerce_float("12.5", 0.0) == 12.5
        assert _coerce_float(7, 0.0) == 7.0
        assert _coerce_float("not-a-number", -1.0) == -1.0
        assert _coerce_float(None, -2.0) == -2.0

    def test_coerce_optional_int_parses_or_falls_back(self):
        from backend.routers.settings import _coerce_optional_int

        assert _coerce_optional_int("2048000", 0) == 2048000
        assert _coerce_optional_int(1536000, 0) == 1536000
        assert _coerce_optional_int("bad", 99) == 99
        assert _coerce_optional_int(None, 99) == 99

    def test_default_bandwidth_by_mode_matches_frontend(self):
        from backend.routers.settings import _DEFAULT_BW_BY_MODE

        assert _DEFAULT_BW_BY_MODE["WFM"] == 500_000
        assert _DEFAULT_BW_BY_MODE["NFM"] == 12_500
        assert _DEFAULT_BW_BY_MODE["AM"] == 10_000
        assert _DEFAULT_BW_BY_MODE["USB"] == 3_000
        assert _DEFAULT_BW_BY_MODE["LSB"] == 3_000
        assert _DEFAULT_BW_BY_MODE["CW"] == 500
