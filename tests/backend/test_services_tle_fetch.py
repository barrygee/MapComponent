"""Tests for single-satellite TLE fetching.

Covers `_single_satellite_url` (deriving a per-satellite CATNR feed URL from a
configured bulk GROUP feed) and the `fetch_tle` upstream-ordering behaviour that
uses it: the precise URL is tried before the bulk feed, and the configured
fallback feed is still tried when the primary fails.

Network access is stubbed by swapping `httpx.AsyncClient` for a recorder, so the
assertions are about *which URLs are requested, in what order* — the thing that
regressed.
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from backend.cache import now_ms
from backend.config import settings
from backend.models import TleCache
from backend.services import tle as tle_service

# Two SGP4-valid TLEs. NOAA 20 is the satellite under test; the ISS entry is
# filler that lets a stubbed "group feed" response hold more than one satellite.
NOAA_20_NORAD = "43013"
NOAA_20_TLE = (
    "NOAA 20\n"
    "1 43013U 17073A   24001.50000000  .00000073  00000-0  52843-4 0  9993\n"
    "2 43013  98.7234 100.0000 0001000  90.0000 270.0000 14.19554400320000\n"
)
ISS_TLE = (
    "ISS (ZARYA)\n"
    "1 25544U 98067A   24001.50000000  .00002182  00000-0  40000-4 0  9999\n"
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49012567429433\n"
)

GROUP_FEED_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
DERIVED_CATNR_URL = f"https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&CATNR={NOAA_20_NORAD}"
OFFGRID_FEED_URL = "http://192.168.1.50/tle/active.txt"

# Celestrak answers an unknown/unavailable CATNR with HTTP 200 and this body,
# not a 404 — so "unusable response" is the realistic upstream failure to test.
NO_GP_DATA = "No GP data found"


class _StubResponse:
    """Minimal stand-in for httpx.Response covering what fetch_tle touches."""

    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("upstream error", request=None, response=None)  # type: ignore[arg-type]


def _install_stub_upstream(monkeypatch, responses: dict[str, str], requested: list[str]):
    """Replace httpx.AsyncClient so fetch_tle hits `responses` instead of the network.

    `requested` accumulates every URL in request order. A URL missing from
    `responses` raises ConnectTimeout, mimicking an unreachable feed.
    """

    class _RecordingClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info) -> bool:
            return False

        async def get(self, url: str) -> _StubResponse:
            requested.append(url)
            if url not in responses:
                raise httpx.ConnectTimeout("timed out")
            return _StubResponse(responses[url])

    monkeypatch.setattr(tle_service.httpx, "AsyncClient", _RecordingClient)


@pytest.fixture()
async def db(test_engine, db_setup) -> AsyncSession:
    """Async session on the shared in-memory test engine."""
    session_factory = sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


# ── _single_satellite_url ────────────────────────────────────────────────────


class TestSingleSatelliteUrl:
    def test_group_feed_becomes_catnr_feed(self):
        derived = tle_service._single_satellite_url(GROUP_FEED_URL, NOAA_20_NORAD)
        assert derived is not None
        assert f"CATNR={NOAA_20_NORAD}" in derived
        assert "GROUP=" not in derived

    def test_preserves_host_path_and_other_params(self):
        derived = tle_service._single_satellite_url(
            "http://nas.local:9000/tle/gp.php?GROUP=gnss&FORMAT=tle", NOAA_20_NORAD
        )
        assert derived is not None
        assert derived.startswith("http://nas.local:9000/tle/gp.php?")
        assert "FORMAT=tle" in derived

    def test_plain_file_url_is_not_rewritten(self):
        # An offgrid mirror serving a static file has no GROUP to swap — leaving
        # it alone is what keeps offgrid mode from reaching for a CATNR endpoint.
        assert tle_service._single_satellite_url(OFFGRID_FEED_URL, NOAA_20_NORAD) is None

    def test_url_without_query_is_not_rewritten(self):
        assert tle_service._single_satellite_url("https://celestrak.org/gp.php", NOAA_20_NORAD) is None

    def test_already_per_satellite_url_is_not_rewritten(self):
        assert (
            tle_service._single_satellite_url(
                "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle", NOAA_20_NORAD
            )
            is None
        )


# ── fetch_tle upstream ordering ──────────────────────────────────────────────


class TestFetchTleUpstreamOrdering:
    async def test_requests_per_satellite_url_before_group_feed(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {DERIVED_CATNR_URL: NOAA_20_TLE}, requested)

        result = await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)

        # The precise URL alone satisfies the request — the ~15k-entry group feed
        # is never downloaded.
        assert requested == [DERIVED_CATNR_URL]
        assert result.splitlines()[0] == "NOAA 20"

    async def test_falls_back_to_group_feed_when_per_satellite_url_has_no_data(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(
            monkeypatch,
            {DERIVED_CATNR_URL: NO_GP_DATA, GROUP_FEED_URL: ISS_TLE + NOAA_20_TLE},
            requested,
        )

        result = await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)

        assert requested == [DERIVED_CATNR_URL, GROUP_FEED_URL]
        assert result.splitlines()[0] == "NOAA 20"

    async def test_offgrid_primary_is_fetched_unchanged(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {OFFGRID_FEED_URL: NOAA_20_TLE}, requested)

        await tle_service.fetch_tle(NOAA_20_NORAD, db, OFFGRID_FEED_URL)

        # No CATNR URL is invented for a feed that never had a GROUP — offgrid
        # mode must not silently reach a public endpoint.
        assert requested == [OFFGRID_FEED_URL]

    async def test_fallback_feed_is_tried_when_primary_is_unreachable(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {OFFGRID_FEED_URL: NOAA_20_TLE}, requested)

        result = await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL, OFFGRID_FEED_URL)

        assert requested == [DERIVED_CATNR_URL, GROUP_FEED_URL, OFFGRID_FEED_URL]
        assert result.splitlines()[0] == "NOAA 20"

    async def test_identical_primary_and_fallback_are_not_requested_twice(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)

        with pytest.raises(RuntimeError):
            await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL, GROUP_FEED_URL)

        assert requested == [DERIVED_CATNR_URL, GROUP_FEED_URL]

    async def test_default_url_used_when_no_feed_configured(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)

        with pytest.raises(RuntimeError):
            await tle_service.fetch_tle(NOAA_20_NORAD, db)

        # Built-in default for a non-ISS satellite is already per-satellite, so
        # it yields no separate derived URL.
        assert requested == [f"https://celestrak.org/NORAD/elements/gp.php?CATNR={NOAA_20_NORAD}&FORMAT=tle"]

    async def test_iss_default_group_url_yields_per_satellite_url_first(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)

        with pytest.raises(RuntimeError):
            await tle_service.fetch_tle("25544", db)

        # settings.celestrak_iss_url is a GROUP feed, so the ISS gets the same
        # precise-first treatment as any other satellite.
        assert requested[0].endswith("CATNR=25544") or "CATNR=25544" in requested[0]
        assert requested[-1] == settings.celestrak_iss_url


# ── fetch_tle cache behaviour (no network) ───────────────────────────────────


class TestFetchTleCache:
    async def test_fresh_online_row_skips_network(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)
        db.add(
            TleCache(
                cache_key=NOAA_20_NORAD,
                payload=NOAA_20_TLE,
                fetched_at=now_ms(),
                expires_at=now_ms() + 3_600_000,
                source="online",
            )
        )
        await db.commit()

        result = await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)

        assert requested == []
        assert result == NOAA_20_TLE

    async def test_fresh_manual_row_skips_network(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)
        db.add(
            TleCache(
                cache_key=NOAA_20_NORAD,
                payload=NOAA_20_TLE,
                fetched_at=now_ms(),
                expires_at=now_ms() + 3_600_000,
                source="manual",
            )
        )
        await db.commit()

        assert await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL) == NOAA_20_TLE
        assert requested == []

    async def test_expired_row_within_stale_window_served_when_upstreams_fail(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)
        db.add(
            TleCache(
                cache_key=NOAA_20_NORAD,
                payload=NOAA_20_TLE,
                fetched_at=now_ms() - 1_000,  # just fetched, but marked expired
                expires_at=now_ms() - 1,
                source="online",
            )
        )
        await db.commit()

        result = await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)

        assert requested == [DERIVED_CATNR_URL, GROUP_FEED_URL]
        assert result == NOAA_20_TLE

    async def test_raises_when_upstreams_fail_and_row_is_beyond_stale_window(self, db, monkeypatch):
        requested: list[str] = []
        _install_stub_upstream(monkeypatch, {}, requested)
        db.add(
            TleCache(
                cache_key=NOAA_20_NORAD,
                payload=NOAA_20_TLE,
                fetched_at=now_ms() - settings.tle_stale_ms - 1,
                expires_at=now_ms() - 1,
                source="online",
            )
        )
        await db.commit()

        with pytest.raises(RuntimeError, match="upstream failed and no usable cache"):
            await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)

    async def test_raises_when_upstreams_fail_and_nothing_cached(self, db, monkeypatch):
        _install_stub_upstream(monkeypatch, {}, [])

        with pytest.raises(RuntimeError, match=f"TLE unavailable for NORAD {NOAA_20_NORAD}"):
            await tle_service.fetch_tle(NOAA_20_NORAD, db, GROUP_FEED_URL)
