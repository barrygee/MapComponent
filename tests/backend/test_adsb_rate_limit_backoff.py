"""Tests for backing off when the ADS-B upstream answers HTTP 429.

adsb.lol publishes no fixed request budget — its documentation says only that
"rate limits are dynamic based on the environment load" — so the local minimum
interval is a floor, not a guarantee. When the upstream refuses a call, the only
safe response is to stop calling it for a while.

The failure this guards against is quiet and compounding: before the cooldown
existed, a 429 was absorbed (cached data served) and the *next* poll ten seconds
later hit the same host again, and the one after that, indefinitely. Repeating a
breach on a loop against a limiter that varies with load is how a keyless public
feed bans a client — and nothing in the app would have shown it happening.

Run with:  uv run --project backend pytest tests/backend/test_adsb_rate_limit_backoff.py
"""

from __future__ import annotations

import logging

import httpx
import pytest

from backend.services import adsb as adsb_service
from backend.services.adsb import _cooldown_seconds
from backend.services.upstream_rate_limit import (
    MinimumIntervalRateLimiter,
    UpstreamThrottledError,
)

# Pinned rather than read from `settings`, so a `.env` on the machine running
# the suite cannot quietly change what these tests assert.
PENALTY_MS = 60_000
MAX_PENALTY_MS = 600_000


@pytest.fixture(autouse=True)
def pinned_penalty_settings(monkeypatch):
    """Fix the cooldown settings to their documented defaults for every test."""
    monkeypatch.setattr(adsb_service.settings, "adsb_rate_limit_penalty_ms", PENALTY_MS)
    monkeypatch.setattr(
        adsb_service.settings, "adsb_rate_limit_max_penalty_ms", MAX_PENALTY_MS
    )


# ── Choosing the cooldown length ──────────────────────────────────────────────


class TestCooldownSeconds:
    """`Retry-After` is authoritative when usable, the configured default otherwise."""

    def test_absent_header_uses_the_configured_default(self):
        assert _cooldown_seconds(None) == PENALTY_MS / 1000

    def test_a_delay_in_seconds_is_honoured(self):
        # The upstream's own statement of when it will accept traffic again
        # beats our guess, so this must not fall back to the default.
        assert _cooldown_seconds("30") == 30.0

    def test_surrounding_whitespace_is_tolerated(self):
        assert _cooldown_seconds("  30  ") == 30.0

    def test_a_fractional_delay_is_honoured(self):
        assert _cooldown_seconds("1.5") == 1.5

    def test_an_http_date_falls_back_to_the_default(self):
        # RFC 7231 allows a date here. Parsing it is not worth the surface area,
        # but silently treating it as 0 would defeat the whole cooldown.
        assert _cooldown_seconds("Wed, 21 Oct 2026 07:28:00 GMT") == PENALTY_MS / 1000

    def test_unparseable_garbage_falls_back_to_the_default(self):
        assert _cooldown_seconds("soon") == PENALTY_MS / 1000

    @pytest.mark.parametrize("header", ["0", "-5"])
    def test_a_non_positive_delay_falls_back_to_the_default(self, header: str):
        # "Retry immediately" after being told we are over the limit is exactly
        # the compounding behaviour this feature exists to stop.
        assert _cooldown_seconds(header) == PENALTY_MS / 1000

    def test_an_absurd_delay_is_clamped_to_the_ceiling(self):
        # A misconfigured or hostile header must not park the feed for hours.
        assert _cooldown_seconds("999999") == MAX_PENALTY_MS / 1000

    def test_a_delay_at_the_ceiling_is_honoured_exactly(self):
        assert _cooldown_seconds(str(MAX_PENALTY_MS / 1000)) == MAX_PENALTY_MS / 1000


# ── The limiter's cooldown mechanism ──────────────────────────────────────────


class TestPenalize:
    """`penalize` suspends slot allocation for one host without touching others."""

    async def test_a_penalised_host_refuses_calls(self):
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        # Without the penalty a zero-interval limiter always grants a slot,
        # so a refusal here can only come from the cooldown.
        await limiter.acquire("api.example", max_wait_seconds=0.01)

        await limiter.penalize("api.example", cooldown_seconds=30)

        with pytest.raises(UpstreamThrottledError):
            await limiter.acquire("api.example", max_wait_seconds=0.01)

    async def test_the_refusal_names_the_host_and_the_wait(self):
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        await limiter.penalize("api.example", cooldown_seconds=30)

        with pytest.raises(UpstreamThrottledError) as raised:
            await limiter.acquire("api.example", max_wait_seconds=0.01)

        assert "api.example" in str(raised.value)

    async def test_other_hosts_keep_their_own_budget(self):
        """A public feed's cooldown must not silence a local offgrid receiver."""
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        await limiter.penalize("api.example", cooldown_seconds=30)

        # Would raise if the penalty leaked across host keys.
        await limiter.acquire("offgrid.local", max_wait_seconds=0.01)

    async def test_calls_resume_once_the_cooldown_expires(self):
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        await limiter.penalize("api.example", cooldown_seconds=0.05)

        # A caller willing to wait out a short cooldown is served, not refused —
        # the suspension has to be temporary or the map never recovers.
        await limiter.acquire("api.example", max_wait_seconds=1.0)

    async def test_a_shorter_penalty_does_not_cut_a_longer_one_short(self):
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        await limiter.penalize("api.example", cooldown_seconds=30)

        await limiter.penalize("api.example", cooldown_seconds=0.01)

        # Still refused: the 30s window is intact. Letting the second call win
        # would mean a burst of 429s each reset the backoff to near-zero.
        with pytest.raises(UpstreamThrottledError):
            await limiter.acquire("api.example", max_wait_seconds=0.01)

    async def test_a_longer_penalty_extends_a_shorter_one(self):
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)
        await limiter.penalize("api.example", cooldown_seconds=0.01)

        await limiter.penalize("api.example", cooldown_seconds=30)

        with pytest.raises(UpstreamThrottledError):
            await limiter.acquire("api.example", max_wait_seconds=0.01)

    async def test_penalising_an_unseen_host_still_takes_effect(self):
        """The first call to a host can 429 before it has any slot history."""
        limiter = MinimumIntervalRateLimiter(interval_seconds=0)

        await limiter.penalize("never.seen.example", cooldown_seconds=30)

        with pytest.raises(UpstreamThrottledError):
            await limiter.acquire("never.seen.example", max_wait_seconds=0.01)


# ── Wiring: a 429 from the upstream triggers the cooldown ─────────────────────


class RecordingLimiter(MinimumIntervalRateLimiter):
    """A limiter that grants every slot and records the penalties it is given."""

    def __init__(self) -> None:
        super().__init__(interval_seconds=0)
        self.penalties: list[tuple[str, float]] = []

    async def penalize(self, host_key: str, cooldown_seconds: float) -> None:
        self.penalties.append((host_key, cooldown_seconds))
        await super().penalize(host_key, cooldown_seconds)


class TestFetchAircraftBacksOffOn429:
    ONLINE = "https://api.adsb.lol/v2"
    READSB = "http://offgrid.local/data/aircraft.json"

    @pytest.fixture
    def limiter(self, monkeypatch) -> RecordingLimiter:
        """Swap in a fresh limiter so tests neither wait 5s nor leak state."""
        recording = RecordingLimiter()
        monkeypatch.setattr(adsb_service, "_adsb_rate_limiter", recording)
        return recording

    @staticmethod
    def _patch_get_json(monkeypatch, behaviour):
        """Replace the HTTP round-trip with `behaviour()`."""

        async def fake_get_json(client, url):
            return behaviour()

        monkeypatch.setattr(adsb_service, "_get_json", fake_get_json)

    @staticmethod
    def _status_error(status_code: int, headers: dict | None = None):
        request = httpx.Request("GET", "https://api.adsb.lol/v2/point/54.0/-1.5/100")
        response = httpx.Response(status_code, request=request, headers=headers or {})
        return httpx.HTTPStatusError("boom", request=request, response=response)

    async def test_a_429_penalises_the_host_and_re_raises(self, monkeypatch, limiter):
        def behaviour():
            raise self._status_error(429)

        self._patch_get_json(monkeypatch, behaviour)

        # Re-raised, not swallowed: the router's failover loop and its
        # `X-Cache: RATED` response both depend on seeing the error.
        with pytest.raises(httpx.HTTPStatusError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert limiter.penalties == [("api.adsb.lol", PENALTY_MS / 1000)]

    async def test_a_429_honours_retry_after(self, monkeypatch, limiter):
        def behaviour():
            raise self._status_error(429, headers={"Retry-After": "12"})

        self._patch_get_json(monkeypatch, behaviour)

        with pytest.raises(httpx.HTTPStatusError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert limiter.penalties == [("api.adsb.lol", 12.0)]

    async def test_the_readsb_path_also_backs_off(self, monkeypatch, limiter):
        """A local receiver behind a reverse proxy can rate limit us too."""

        def behaviour():
            raise self._status_error(429)

        self._patch_get_json(monkeypatch, behaviour)

        with pytest.raises(httpx.HTTPStatusError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.READSB)

        assert limiter.penalties == [("offgrid.local", PENALTY_MS / 1000)]

    async def test_the_penalty_refuses_the_very_next_call(self, monkeypatch, limiter):
        """The point of the feature: the next poll must not repeat the breach."""
        calls: list[int] = []

        def behaviour():
            calls.append(1)
            raise self._status_error(429)

        self._patch_get_json(monkeypatch, behaviour)

        with pytest.raises(httpx.HTTPStatusError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        # The poll ten seconds later is refused locally — never reaching the wire.
        with pytest.raises(UpstreamThrottledError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert calls == [1]

    @pytest.mark.parametrize("status_code", [403, 404, 500, 503])
    async def test_other_error_statuses_do_not_back_off(
        self, monkeypatch, limiter, status_code: int
    ):
        """Only a 429 means "you are going too fast" — a 403 must not mute the feed."""

        def behaviour():
            raise self._status_error(status_code)

        self._patch_get_json(monkeypatch, behaviour)

        with pytest.raises(httpx.HTTPStatusError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert limiter.penalties == []

    async def test_a_transport_error_does_not_back_off(self, monkeypatch, limiter):
        def behaviour():
            raise httpx.ConnectError("no route to host")

        self._patch_get_json(monkeypatch, behaviour)

        with pytest.raises(httpx.ConnectError):
            await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert limiter.penalties == []

    async def test_a_successful_fetch_does_not_back_off(self, monkeypatch, limiter):
        payload = {"ac": [{"hex": "abc123"}], "total": 1}
        self._patch_get_json(monkeypatch, lambda: payload)

        result = await adsb_service.fetch_aircraft(54.0, -1.5, 100, self.ONLINE)

        assert result == payload
        assert limiter.penalties == []


# ── The router surfaces the breach ────────────────────────────────────────────


class TestRouterLogsRateLimiting:
    """A 429 used to be absorbed in silence, so a breach was invisible in the logs."""

    ONLINE = "https://online.example/v2"
    POINT = "/api/air/adsb/point/54.0/-1.5/100"

    @staticmethod
    def _air_warnings(caplog) -> str:
        return "\n".join(
            record.getMessage()
            for record in caplog.records
            if record.name == "backend.routers.air"
            and record.levelno >= logging.WARNING
        )

    def test_a_429_warns_and_names_the_host(self, client, monkeypatch, caplog):
        client.put("/api/settings/air/onlineDataSourceURL", json={"value": self.ONLINE})

        async def fake_fetch(lat, lon, radius, base_url):
            request = httpx.Request("GET", base_url)
            response = httpx.Response(429, request=request)
            raise httpx.HTTPStatusError(
                "rate limited", request=request, response=response
            )

        monkeypatch.setattr(adsb_service, "fetch_aircraft", fake_fetch)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            client.get(self.POINT)

        warnings = self._air_warnings(caplog)
        assert "online.example" in warnings
        assert "429" in warnings

    def test_a_successful_fetch_logs_no_rate_limit_warning(
        self, client, monkeypatch, caplog
    ):
        client.put("/api/settings/air/onlineDataSourceURL", json={"value": self.ONLINE})

        async def fake_fetch(lat, lon, radius, base_url):
            return {"ac": [], "total": 0}

        monkeypatch.setattr(adsb_service, "fetch_aircraft", fake_fetch)

        with caplog.at_level(logging.WARNING, logger="backend.routers.air"):
            client.get(self.POINT)

        assert "rate limited" not in self._air_warnings(caplog)
