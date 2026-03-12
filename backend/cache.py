import time


def now_ms() -> int:
    """Return the current Unix time in milliseconds."""
    return int(time.time() * 1000)


def is_fresh(expires_at: int) -> bool:
    """Return True if a cache entry has not yet passed its expiry timestamp."""
    return now_ms() < expires_at


def is_within_stale(fetched_at: int, stale_ms: int) -> bool:
    """Return True if a stale entry is still within the acceptable serve window.

    Used as a fallback when the upstream API is unreachable — serves old data
    rather than a 503, up to stale_ms milliseconds after the entry was fetched.
    """
    return now_ms() < fetched_at + stale_ms
