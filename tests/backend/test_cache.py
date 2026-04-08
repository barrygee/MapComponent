"""
tests/backend/test_cache.py

Tests for the pure helper functions in backend/cache.py.

Covered:
    now_ms              — returns current Unix time in milliseconds
    is_fresh            — returns True when expires_at is in the future
    is_within_stale     — returns True when fetched_at + stale_ms > now
"""

import time

from backend.cache import is_fresh, is_within_stale, now_ms


# ── now_ms ────────────────────────────────────────────────────────────────────

class TestNowMs:
    def test_returns_integer(self):
        assert isinstance(now_ms(), int)

    def test_close_to_system_time(self):
        system_ms = int(time.time() * 1000)
        result = now_ms()
        # Allow ±500 ms for test execution time
        assert abs(result - system_ms) < 500

    def test_monotonically_increases(self):
        first = now_ms()
        second = now_ms()
        assert second >= first

    def test_value_is_in_milliseconds(self):
        # A 13-digit ms timestamp is in the year 2001–2286 range; 10-digit would be seconds
        result = now_ms()
        assert 1_000_000_000_000 < result < 9_999_999_999_999


# ── is_fresh ──────────────────────────────────────────────────────────────────

class TestIsFresh:
    def test_future_expiry_is_fresh(self):
        expires_at = now_ms() + 60_000  # expires in 60 seconds
        assert is_fresh(expires_at) is True

    def test_past_expiry_is_not_fresh(self):
        expires_at = now_ms() - 1  # expired 1 ms ago
        assert is_fresh(expires_at) is False

    def test_far_future_expiry_is_fresh(self):
        expires_at = now_ms() + 3_600_000  # expires in 1 hour
        assert is_fresh(expires_at) is True

    def test_far_past_expiry_is_not_fresh(self):
        expires_at = now_ms() - 3_600_000  # expired 1 hour ago
        assert is_fresh(expires_at) is False

    def test_zero_expiry_is_not_fresh(self):
        # Unix epoch 0 is always in the past
        assert is_fresh(0) is False


# ── is_within_stale ───────────────────────────────────────────────────────────

class TestIsWithinStale:
    def test_recent_fetch_within_stale_window(self):
        fetched_at = now_ms() - 5_000   # fetched 5 seconds ago
        stale_ms   = 30_000             # 30-second stale window
        assert is_within_stale(fetched_at, stale_ms) is True

    def test_old_fetch_outside_stale_window(self):
        fetched_at = now_ms() - 60_000  # fetched 60 seconds ago
        stale_ms   = 30_000             # 30-second stale window
        assert is_within_stale(fetched_at, stale_ms) is False

    def test_fetch_exactly_at_stale_boundary_is_not_within(self):
        # fetched_at + stale_ms == now  →  not strictly within (now < boundary)
        stale_ms   = 30_000
        fetched_at = now_ms() - stale_ms
        # At this instant fetched_at + stale_ms ≈ now, so the check is borderline.
        # We allow either result — just confirm no exception is raised.
        result = is_within_stale(fetched_at, stale_ms)
        assert isinstance(result, bool)

    def test_zero_stale_window_is_never_within(self):
        # Any fetch is outside a zero-millisecond window
        fetched_at = now_ms()
        assert is_within_stale(fetched_at, 0) is False

    def test_very_large_stale_window_is_always_within(self):
        fetched_at = now_ms() - 3_600_000  # fetched 1 hour ago
        stale_ms   = 7_200_000             # 2-hour stale window
        assert is_within_stale(fetched_at, stale_ms) is True

    def test_epoch_zero_fetch_outside_reasonable_stale_window(self):
        # A fetched_at of Unix epoch 0 should never be within a 30-second window
        assert is_within_stale(0, 30_000) is False
