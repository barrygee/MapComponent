"""Client-side rate limiting for outbound upstream API calls.

Third-party feeds (airplanes.live in particular) publish a minimum interval
between requests and ban clients that exceed it. The response cache in the
routers keeps *most* traffic off the wire, but it is keyed per lat/lon/radius:
several map panes, several browser tabs, or a cache expiry that lands on more
than one key at once can still fire a burst of upstream calls inside the
forbidden window. This module is the last line of defence — every outbound call
passes through it, so the wire rate is capped no matter how many callers there
are or how the cache is keyed.
"""

import asyncio
import time


class UpstreamThrottledError(Exception):
    """Raised when a call is refused locally because the next slot is too far away.

    Signals "we chose not to call upstream", not "upstream failed" — callers
    should fall back to cached data rather than treating it as an outage.
    """


class MinimumIntervalRateLimiter:
    """Spaces outbound calls so that consecutive requests are at least `interval` apart.

    Slots are handed out per host key, so an unrelated upstream (for example a
    local offgrid receiver) is never throttled by traffic to a public API. Each
    waiter reserves the next free slot for its host and sleeps until that slot
    opens, which keeps the ordering fair and the spacing exact even when many
    coroutines arrive at once.
    """

    def __init__(self, interval_seconds: float) -> None:
        """Create a limiter allowing one call per `interval_seconds` per host key."""
        self._interval_seconds = interval_seconds
        self._reservation_lock = asyncio.Lock()
        # Monotonic timestamp of the next unreserved slot, per host key.
        self._next_free_slot_at: dict[str, float] = {}

    async def acquire(self, host_key: str, max_wait_seconds: float) -> None:
        """Reserve and wait for the next call slot for `host_key`.

        Args:
            host_key: Identifier of the upstream being called (usually its hostname).
                Each key gets an independent call budget.
            max_wait_seconds: Longest the caller is willing to wait. If the next
                slot is further away than this, no slot is reserved and the call
                is refused so the caller can serve cached data instead.

        Raises:
            UpstreamThrottledError: If the next free slot is beyond `max_wait_seconds`.
        """
        async with self._reservation_lock:
            now = time.monotonic()
            slot_start_at = max(now, self._next_free_slot_at.get(host_key, 0.0))
            wait_seconds = slot_start_at - now
            if wait_seconds > max_wait_seconds:
                raise UpstreamThrottledError(
                    f"next {host_key} request slot is {wait_seconds:.1f}s away (max wait {max_wait_seconds:.1f}s)"
                )
            # Reserve this slot before releasing the lock so concurrent callers
            # queue behind it rather than all claiming the same instant.
            self._next_free_slot_at[host_key] = slot_start_at + self._interval_seconds

        # Sleep outside the lock: holding it while waiting would serialise the
        # reservation bookkeeping behind the wait and break the max_wait check.
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)
