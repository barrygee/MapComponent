"""Tests for reading a local readsb/tar1090 receiver as the off-grid air source.

Sentinel's air pipeline speaks one shape — airplanes.live v2, `{"ac": [...]}` —
and a local readsb publishes another. The mapping between them is small, which
is exactly why it is worth testing: every one of these differences fails
*silently*, showing an empty or subtly wrong map rather than an error.

* A missed `aircraft` → `ac` rename shows nothing at all.
* A missed seconds → milliseconds conversion dates every aircraft to 1970.
* A missed radius filter shows the receiver's whole range on a map pane asking
  for 50 nm, inflating the count against aircraft that are nowhere near.

Run with:  uv run --project backend pytest tests/backend/test_adsb_readsb_source.py
"""

from __future__ import annotations

import pytest

from backend.services.adsb import (
    _distance_nm,
    _is_readsb,
    _readsb_to_airplanes,
    _readsb_url,
)

# The deployed receiver's own position, so the distances below are real ones.
CENTRE_LAT = 54.95149
CENTRE_LON = -1.53586


def readsb_payload(*aircraft: dict, now: float = 1_786_639_319.4) -> dict:
    return {"now": now, "messages": 12345, "aircraft": list(aircraft)}


class TestRecognisingAReadsbSource:
    @pytest.mark.parametrize(
        "url",
        [
            "http://adsb-decoder:8080/data/aircraft.json",
            "http://192.168.5.20/data/aircraft.json",
            "http://tar1090.local/data",
            "http://adsb-decoder:8080/data/",
        ],
    )
    def test_recognises_a_readsb_url(self, url: str) -> None:
        assert _is_readsb(url) is True

    @pytest.mark.parametrize(
        "url",
        [
            "https://api.airplanes.live/v2",
            "https://api.airplanes.live/v2/",
            "http://some-proxy.example/adsb",
        ],
    )
    def test_leaves_the_query_api_alone(self, url: str) -> None:
        # A false positive here would send `/data/aircraft.json` to a service
        # that only answers `/point/...`, breaking the *online* source.
        assert _is_readsb(url) is False

    def test_resolves_the_file_from_a_directory_url(self) -> None:
        assert (
            _readsb_url("http://adsb:8080/data")
            == "http://adsb:8080/data/aircraft.json"
        )

    def test_accepts_the_file_url_unchanged(self) -> None:
        url = "http://adsb:8080/data/aircraft.json"
        assert _readsb_url(url) == url

    def test_tolerates_a_trailing_slash(self) -> None:
        assert (
            _readsb_url("http://adsb:8080/data/")
            == "http://adsb:8080/data/aircraft.json"
        )


class TestMappingOntoTheAppsShape:
    def test_renames_the_aircraft_list(self) -> None:
        payload = readsb_payload(
            {"hex": "4009f5", "lat": CENTRE_LAT, "lon": CENTRE_LON}
        )

        result = _readsb_to_airplanes(payload, CENTRE_LAT, CENTRE_LON, 50)

        assert [entry["hex"] for entry in result["ac"]] == ["4009f5"]

    def test_preserves_the_per_aircraft_fields_verbatim(self) -> None:
        # airplanes.live derives its feed from readsb, so the field names already
        # match — copying them through unchanged is what keeps labels, replay and
        # overhead alerts working off one shape.
        aircraft = {
            "hex": "4009f5",
            "flight": "BAW123  ",
            "lat": CENTRE_LAT,
            "lon": CENTRE_LON,
            "alt_baro": 12000,
            "gs": 410.2,
            "track": 271.3,
            "squawk": "7000",
            "category": "A3",
            "r": "G-ABCD",
            "t": "A320",
        }

        result = _readsb_to_airplanes(
            readsb_payload(aircraft), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["ac"][0] == aircraft

    def test_converts_the_timestamp_to_milliseconds(self) -> None:
        result = _readsb_to_airplanes(
            readsb_payload(now=1_786_639_319.4), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["now"] == 1_786_639_319_400

    def test_reports_the_count_after_filtering(self) -> None:
        near = {"hex": "near", "lat": 54.98, "lon": -1.60}
        far = {"hex": "far", "lat": 51.50, "lon": -0.12}

        result = _readsb_to_airplanes(
            readsb_payload(near, far), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["total"] == 1

    def test_an_empty_receiver_maps_to_an_empty_list(self) -> None:
        result = _readsb_to_airplanes(readsb_payload(), CENTRE_LAT, CENTRE_LON, 50)

        assert result["ac"] == []
        assert result["total"] == 0


class TestTheRadiusFilter:
    def test_keeps_an_aircraft_inside_the_circle(self) -> None:
        overhead = {"hex": "near", "lat": 54.96, "lon": -1.54}

        result = _readsb_to_airplanes(
            readsb_payload(overhead), CENTRE_LAT, CENTRE_LON, 50
        )

        assert len(result["ac"]) == 1

    def test_drops_an_aircraft_outside_it(self) -> None:
        # London is ~213 nm from the receiver — well outside a 50 nm pane, but
        # comfortably within a good aerial's actual range.
        london = {"hex": "far", "lat": 51.50, "lon": -0.12}

        result = _readsb_to_airplanes(
            readsb_payload(london), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["ac"] == []

    def test_a_wider_radius_admits_what_a_narrow_one_excluded(self) -> None:
        london = {"hex": "far", "lat": 51.50, "lon": -0.12}

        assert (
            _readsb_to_airplanes(readsb_payload(london), CENTRE_LAT, CENTRE_LON, 250)[
                "total"
            ]
            == 1
        )

    def test_drops_an_aircraft_with_no_position(self) -> None:
        # Heard but not yet located: it cannot be plotted, and passing it
        # through would inflate the count against an empty patch of map.
        heard_only = {"hex": "nopos", "flight": "GHOST1  "}

        result = _readsb_to_airplanes(
            readsb_payload(heard_only), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["ac"] == []

    @pytest.mark.parametrize(
        "aircraft",
        [
            pytest.param({"hex": "a", "lat": None, "lon": -1.5}, id="null-latitude"),
            pytest.param({"hex": "b", "lat": 54.9, "lon": None}, id="null-longitude"),
            pytest.param(
                {"hex": "c", "lat": "54.9", "lon": "-1.5"}, id="string-coordinates"
            ),
        ],
    )
    def test_drops_an_unusable_position_rather_than_raising(
        self, aircraft: dict
    ) -> None:
        # readsb omits fields it has not determined yet, so a partial entry is
        # ordinary traffic — it must not take the whole poll down.
        result = _readsb_to_airplanes(
            readsb_payload(aircraft), CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["ac"] == []


class TestMalformedPayloads:
    def test_a_missing_aircraft_key_is_treated_as_empty(self) -> None:
        result = _readsb_to_airplanes({"now": 1.0}, CENTRE_LAT, CENTRE_LON, 50)

        assert result["ac"] == []

    def test_a_non_list_aircraft_value_is_treated_as_empty(self) -> None:
        result = _readsb_to_airplanes(
            {"aircraft": "nonsense"}, CENTRE_LAT, CENTRE_LON, 50
        )

        assert result["ac"] == []

    def test_non_dict_entries_are_skipped(self) -> None:
        payload = {"aircraft": ["nonsense", {"hex": "ok", "lat": 54.96, "lon": -1.54}]}

        result = _readsb_to_airplanes(payload, CENTRE_LAT, CENTRE_LON, 50)

        assert [entry["hex"] for entry in result["ac"]] == ["ok"]

    def test_a_missing_timestamp_becomes_zero(self) -> None:
        assert (
            _readsb_to_airplanes({"aircraft": []}, CENTRE_LAT, CENTRE_LON, 50)["now"]
            == 0
        )


class TestTheDistanceCalculation:
    def test_zero_distance_to_itself(self) -> None:
        assert _distance_nm(
            CENTRE_LAT, CENTRE_LON, CENTRE_LAT, CENTRE_LON
        ) == pytest.approx(0.0)

    def test_matches_the_known_distance_to_london(self) -> None:
        # Newcastle → London is ~213 nm; 1% tolerance covers the earth-radius
        # constant without letting a genuinely wrong formula through.
        distance = _distance_nm(CENTRE_LAT, CENTRE_LON, 51.50, -0.12)

        assert distance == pytest.approx(213.4, rel=0.01)

    def test_is_symmetric(self) -> None:
        there = _distance_nm(CENTRE_LAT, CENTRE_LON, 51.50, -0.12)
        back = _distance_nm(51.50, -0.12, CENTRE_LAT, CENTRE_LON)

        assert there == pytest.approx(back)

    def test_longitude_degrees_shrink_at_this_latitude(self) -> None:
        # The reason for haversine over a flat approximation: at 55°N a degree
        # of longitude is little over half a degree of latitude, and treating
        # them alike admits the wrong aircraft at the edge of a pane.
        one_degree_north = _distance_nm(
            CENTRE_LAT, CENTRE_LON, CENTRE_LAT + 1, CENTRE_LON
        )
        one_degree_east = _distance_nm(
            CENTRE_LAT, CENTRE_LON, CENTRE_LAT, CENTRE_LON + 1
        )

        assert one_degree_east < one_degree_north * 0.6
