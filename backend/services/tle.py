"""
TLE fetching service.

Fetches Two-Line Element sets from Celestrak and caches them in SQLite.
Cache TTL is 1 hour; stale window is 12 hours (served on upstream failure).
"""

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.cache import is_fresh, is_within_stale, now_ms
from backend.config import settings
from backend.models import TleCache


async def fetch_tle(norad_id: str, db: AsyncSession, online_url: str | None = None, offline_url: str | None = None) -> str:
    """Return the latest TLE text for a given NORAD catalogue number.

    Checks the SQLite cache first. On a miss (or expired entry), tries the
    online_url first, then offline_url as fallback. On all upstream failures,
    serves stale data if available within tle_stale_ms.

    Returns a string with three newline-separated lines: name, TLE1, TLE2.
    Raises RuntimeError if data is unavailable.
    """
    result = await db.execute(select(TleCache).where(TleCache.cache_key == norad_id))
    row = result.scalar_one_or_none()

    if row and is_fresh(row.expires_at):
        return row.payload

    # Cache miss or expired — determine candidate URLs to try in order
    default_url = settings.celestrak_iss_url if norad_id == "25544" else (
        f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"
    )
    primary = online_url if online_url else default_url
    candidates = [u for u in [primary, offline_url] if u]

    for url in candidates:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text.strip()

            ts = now_ms()
            if row:
                row.payload    = text
                row.fetched_at = ts
                row.expires_at = ts + settings.tle_ttl_ms
            else:
                db.add(TleCache(
                    cache_key=norad_id,
                    payload=text,
                    fetched_at=ts,
                    expires_at=ts + settings.tle_ttl_ms,
                ))
            await db.commit()
            return text

        except Exception:
            continue

    # All upstreams failed — serve stale if within window
    if row and is_within_stale(row.fetched_at, settings.tle_stale_ms):
        return row.payload
    raise RuntimeError(f"TLE unavailable for NORAD {norad_id}: upstream failed and no usable cache")


def parse_tle_lines(tle_text: str) -> tuple[str, str, str]:
    """Parse 3-line TLE text into (name, line1, line2).

    Celestrak returns:
      ISS (ZARYA)
      1 25544U ...
      2 25544  ...
    """
    lines = [l.strip() for l in tle_text.strip().splitlines() if l.strip()]
    if len(lines) < 3:
        raise ValueError(f"Expected 3 TLE lines, got {len(lines)}")
    return lines[0], lines[1], lines[2]
