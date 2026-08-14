"""Characterization tests for the space router.

Focused on the DB-only endpoints (TLE management, daynight, /tle/list, etc.).
The /iss, /satellite/{n}, and /passes endpoints require real TLE data and
SGP4 propagation; their error paths are still exercised here.
"""

from __future__ import annotations


# ── /api/space/daynight ──────────────────────────────────────────────────────


class TestDaynight:
    def test_returns_geojson_feature(self, client):
        resp = client.get("/api/space/daynight")
        assert resp.status_code == 200
        body = resp.json()
        # Pin the GeoJSON shape — Feature with a geometry block
        assert body.get("type") == "Feature"
        assert "geometry" in body


# ── /api/space/tle/status ────────────────────────────────────────────────────


class TestTleStatus:
    def test_empty_database_shape(self, client):
        resp = client.get("/api/space/tle/status")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "total",
            "uncategorised",
            "by_source",
            "by_category",
        }
        assert body["total"] == 0
        assert body["uncategorised"] == 0
        assert body["by_source"] == {}
        assert body["by_category"] == {}


# ── /api/space/tle/list ──────────────────────────────────────────────────────


class TestTleList:
    def test_empty_returns_empty_satellites(self, client):
        resp = client.get("/api/space/tle/list")
        assert resp.status_code == 200
        assert resp.json() == {"satellites": []}


# ── /api/space/tle/uncategorised ─────────────────────────────────────────────


class TestTleUncategorised:
    def test_empty_returns_empty_satellites(self, client):
        resp = client.get("/api/space/tle/uncategorised")
        assert resp.status_code == 200
        assert resp.json() == {"satellites": []}


# ── /api/space/iss (without TLE data) ────────────────────────────────────────


class TestIssNoTle:
    def test_returns_error_when_no_tle(self, client):
        # No TLE seeded → propagation can't run. Current contract:
        # error response with status code 503 (RuntimeError) or 500 (Exception).
        resp = client.get("/api/space/iss")
        assert resp.status_code in (500, 503)


# ── /api/space/satellite/{n} (without TLE data) ──────────────────────────────


class TestSatelliteByIdNoTle:
    def test_unknown_norad_id_returns_error(self, client):
        resp = client.get("/api/space/satellite/99999")
        assert resp.status_code in (500, 503)


# ── /api/space/passes (without location or TLE) ──────────────────────────────


class TestPasses:
    def test_missing_required_query_returns_422(self, client):
        # lat/lon are required query params; their absence is a Pydantic
        # validation error → FastAPI returns 422.
        resp = client.get("/api/space/passes")
        assert resp.status_code == 422

    def test_no_tle_seeded_returns_error_not_500_explosion(self, client):
        resp = client.get(
            "/api/space/passes",
            params={
                "lat": 51.5,
                "lon": 0.0,
                "hours": 24,
                "min_el": 30,
                "categories": "weather",
            },
        )
        # Pin: the no-TLE path must return a JSON response (not raise) at 200/500/503.
        assert resp.status_code in (200, 500, 503)
        assert resp.headers["content-type"].startswith("application/json")


# ── /api/space/tle (DELETE — wipe all) ───────────────────────────────────────


class TestTleDelete:
    def test_without_confirm_returns_400(self, client):
        # Safety: deleting all TLE data requires ?confirm=true.
        resp = client.delete("/api/space/tle")
        assert resp.status_code == 400
        assert "error" in resp.json()

    def test_with_confirm_returns_cleared(self, client):
        resp = client.delete("/api/space/tle", params={"confirm": "true"})
        assert resp.status_code == 200
        assert resp.json() == {"cleared": True}


# ── Domain URL resolution → fetch_tle (offgrid fallback pass-through) ────────


class TestDomainUrlsReachFetchTle:
    """The space domain's offgrid fallback URL must reach fetch_tle.

    All three TLE-backed endpoints resolve (primary, fallback) for the domain;
    dropping the fallback silently disables the configured offgrid mirror
    whenever the primary feed is unreachable.
    """

    PRIMARY_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
    FALLBACK_URL = "http://192.168.1.50/tle/active.txt"
    NOAA_20_TLE = (
        "NOAA 20\n"
        "1 43013U 17073A   24001.50000000  .00000073  00000-0  52843-4 0  9993\n"
        "2 43013  98.7234 100.0000 0001000  90.0000 270.0000 14.19554400320000\n"
    )

    def _capture_fetch_tle_urls(self, monkeypatch) -> list[tuple]:
        """Stub resolve_domain_urls + fetch_tle; return the list capturing URL args."""
        from backend.routers import space as space_router

        captured: list[tuple] = []

        async def fake_resolve(domain, db, online_default=None):
            return self.PRIMARY_URL, self.FALLBACK_URL

        async def fake_fetch_tle(norad_id, db, online_url=None, offline_url=None):
            captured.append((online_url, offline_url))
            return self.NOAA_20_TLE

        monkeypatch.setattr(space_router, "resolve_domain_urls", fake_resolve)
        monkeypatch.setattr(space_router.tle_service, "fetch_tle", fake_fetch_tle)
        return captured

    def test_satellite_position_passes_both_urls(self, client, monkeypatch):
        from backend.routers import space as space_router

        captured = self._capture_fetch_tle_urls(monkeypatch)
        # Bypass the empty-database guard so the request reaches fetch_tle.
        monkeypatch.setattr(space_router, "_tle_database_is_empty", lambda db: _false())

        resp = client.get("/api/space/satellite/43013")

        assert resp.status_code == 200
        assert captured == [(self.PRIMARY_URL, self.FALLBACK_URL)]

    def test_satellite_passes_endpoint_passes_both_urls(self, client, monkeypatch):
        captured = self._capture_fetch_tle_urls(monkeypatch)

        resp = client.get(
            "/api/space/satellite/43013/passes", params={"lat": 51.5, "lon": 0.0}
        )

        assert resp.status_code == 200
        assert captured == [(self.PRIMARY_URL, self.FALLBACK_URL)]

    def test_multi_satellite_passes_endpoint_passes_both_urls(
        self, client, monkeypatch
    ):
        from backend.models import SatelliteCatalogue
        from backend.database import get_db

        captured = self._capture_fetch_tle_urls(monkeypatch)

        # One catalogue row so the endpoint gets past its "no satellites" short-circuit.
        async def _seed():
            async for session in client.app.dependency_overrides[get_db]():
                session.add(
                    SatelliteCatalogue(
                        norad_id="43013",
                        name="NOAA 20",
                        category="weather",
                        updated_at=0,
                    )
                )
                await session.commit()
                break

        _run(_seed())

        resp = client.get(
            "/api/space/passes",
            params={"lat": 51.5, "lon": 0.0, "categories": "weather"},
        )

        assert resp.status_code == 200
        assert captured == [(self.PRIMARY_URL, self.FALLBACK_URL)]


async def _false() -> bool:
    """Awaitable False — stands in for the async _tle_database_is_empty guard."""
    return False


def _run(coro):
    """Run a coroutine from a sync test body."""
    import asyncio

    return asyncio.run(coro)
