"""
TLE fetching and storage service.

Single source of truth: all TLE data (regardless of origin) flows through
store_tle_bulk() which validates, deduplicates, and upserts into both
tle_cache (orbital data) and satellite_catalogue (identity/category).

Category priority (never downgraded):
  celestrak_group > user > active > NULL

TTL rules:
  online auto-fetch  — 6 hours, refreshed automatically
  manual/upload/url  — 30 days, only replaced by another explicit write
"""

from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from backend.cache import is_fresh, is_within_stale, now_ms
from backend.config import settings
from backend.models import SatelliteCatalogue, TleCache
from backend.services import sat_radio
from sgp4.api import Satrec
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Well-known NORAD IDs → (category, category_source) for auto-classification
# when a satellite is fetched individually rather than via a categorised group feed.
_KNOWN_SATELLITE_CATEGORIES: dict[str, tuple[str, str]] = {
    "25544": ("space_station", "inferred"),  # ISS (ZARYA)
    "48274": ("space_station", "inferred"),  # CSS Tianhe
}


# ── Category priority ordering (higher index = higher priority) ──────────────
# Keys are valid category *values* — 'user' is intentionally excluded because it
# is a category_source sentinel, never a stored category value.
_CATEGORY_PRIORITY = {
    None: 0,
    "unknown": 1,
    "active": 2,
    "cubesat": 3,
    "science": 3,
    "navigation": 3,
    "military": 3,
    "weather": 3,
    "amateur": 3,
    "space_station": 4,
}

# Actual category values (excludes 'user', which is a category_source sentinel, and None)
VALID_CATEGORIES: frozenset[str] = frozenset(k for k in _CATEGORY_PRIORITY if k is not None and k != "user")

# category_source priority
_SOURCE_PRIORITY = {
    None: 0,
    "active": 1,
    "inferred": 2,
    "user": 3,
    "celestrak_group": 4,
}


def _category_beats(new_cat: str | None, new_src: str | None, old_cat: str | None, old_src: str | None) -> bool:
    """Return True if the new category/source should overwrite the existing one.

    Category priority always takes precedence over source priority: a more
    specific existing category (e.g. 'cubesat') is never replaced by a less
    specific incoming one (e.g. 'active' or 'unknown'), regardless of source.
    Only when categories are equally specific does source priority act as the
    tiebreaker, and only a strictly higher source priority can then win.
    """
    new_cp = _CATEGORY_PRIORITY.get(new_cat, 0)
    old_cp = _CATEGORY_PRIORITY.get(old_cat, 0)
    # Never downgrade to a less specific category
    if new_cp < old_cp:
        return False
    if new_cp > old_cp:
        # Only upgrade if the new source is at least as authoritative
        new_sp = _SOURCE_PRIORITY.get(new_src, 0)
        old_sp = _SOURCE_PRIORITY.get(old_src, 0)
        return new_sp >= old_sp
    # Same category specificity — require strictly higher source priority to update
    new_sp = _SOURCE_PRIORITY.get(new_src, 0)
    old_sp = _SOURCE_PRIORITY.get(old_src, 0)
    return new_sp > old_sp


# ── TLE validation ───────────────────────────────────────────────────────────


def _nonblank_lines(tle_text: str) -> list[str]:
    """Strip whitespace and drop blank lines from a TLE text block."""
    return [ln.strip() for ln in tle_text.strip().splitlines() if ln.strip()]


def validate_tle_text(tle_text: str) -> list[tuple[str, str, str]]:
    """Parse and SGP4-validate a block of TLE text.

    Accepts one or more satellites in 3-line format (name, line1, line2).
    Returns a list of (name, line1, line2) tuples for all valid entries.
    Raises ValueError if the text is completely unparseable.
    Silently skips malformed individual entries (logged via return count).
    """
    lines = _nonblank_lines(tle_text)
    if len(lines) < 3:
        raise ValueError("TLE text must contain at least one 3-line entry")

    entries: list[tuple[str, str, str]] = []
    i = 0
    while i + 2 < len(lines):
        name = lines[i]
        line1 = lines[i + 1]
        line2 = lines[i + 2]

        # Basic structural checks
        if not (line1.startswith("1 ") and line2.startswith("2 ")):
            i += 1
            continue

        # SGP4 parse check
        try:
            sat = Satrec.twoline2rv(line1, line2)
            if sat.error != 0:
                i += 3
                continue
        except Exception:
            i += 3
            continue

        entries.append((name, line1, line2))
        i += 3

    if not entries:
        raise ValueError("No valid TLE entries found in provided text")

    return entries


def parse_tle_lines(tle_text: str) -> tuple[str, str, str]:
    """Parse a single 3-line TLE into (name, line1, line2).

    Used by the space router before propagating a satellite's position or passes.
    Raises ValueError if the text does not contain 3 lines.
    """
    lines = _nonblank_lines(tle_text)
    if len(lines) < 3:
        raise ValueError(f"Expected 3 TLE lines, got {len(lines)}")
    return lines[0], lines[1], lines[2]


def _norad_from_line1(line1: str) -> str:
    """Extract NORAD catalogue number from TLE line 1 (columns 3–7)."""
    return line1[2:7].strip()


# ── Bulk upsert ──────────────────────────────────────────────────────────────


async def store_tle_bulk(
    entries: list[tuple[str, str, str]],
    source: str,
    category: str | None,
    category_source: str | None,
    db: AsyncSession,
) -> dict[str, int]:
    """Upsert a list of validated (name, line1, line2) TLE entries into the DB.

    Updates both tle_cache and satellite_catalogue.

    Category rules:
    - If category_source is 'celestrak_group' or 'user', always set the category
      on satellite_catalogue if it beats the existing one (see _category_beats).
    - If category_source is 'active', only fill NULL category slots.
    - Name in satellite_catalogue is always updated to the latest TLE name.

    Returns dict with keys: inserted, updated, skipped (validation failures).
    """
    ts = now_ms()
    ttl = settings.tle_manual_ttl_ms if source != "online" else settings.tle_ttl_ms
    inserted = updated = 0

    # Pre-fetch all existing rows in two bulk queries to avoid N+1 per entry.
    norad_ids = [_norad_from_line1(line1) for _, line1, _ in entries]

    tle_result = await db.execute(select(TleCache).where(TleCache.cache_key.in_(norad_ids)))
    existing_tle: dict[str, TleCache] = {r.cache_key: r for r in tle_result.scalars().all()}

    cat_result = await db.execute(select(SatelliteCatalogue).where(SatelliteCatalogue.norad_id.in_(norad_ids)))
    existing_cat: dict[str, SatelliteCatalogue] = {r.norad_id: r for r in cat_result.scalars().all()}

    for name, line1, line2 in entries:
        norad_id = _norad_from_line1(line1)
        payload = f"{name}\n{line1}\n{line2}"
        expires = ts + ttl

        # ── tle_cache upsert ─────────────────────────────────────────────
        tle_row = existing_tle.get(norad_id)
        if tle_row:
            tle_row.payload = payload
            tle_row.source = source
            tle_row.fetched_at = ts
            tle_row.expires_at = expires
            updated += 1
        else:
            new_row = TleCache(
                cache_key=norad_id,
                payload=payload,
                source=source,
                fetched_at=ts,
                expires_at=expires,
            )
            db.add(new_row)
            existing_tle[norad_id] = new_row  # prevent duplicates if same NORAD appears twice
            inserted += 1

        # ── satellite_catalogue upsert ───────────────────────────────────
        cat_row = existing_cat.get(norad_id)
        if cat_row:
            # Preserve user-set names; only update name from TLE if not locked
            if cat_row.name_source != "user":
                cat_row.name = name
            cat_row.updated_at = ts
            if _category_beats(category, category_source, cat_row.category, cat_row.category_source):
                cat_row.category = category
                cat_row.category_source = category_source
        else:
            new_cat = SatelliteCatalogue(
                norad_id=norad_id,
                name=name,
                category=category,
                category_source=category_source,
                updated_at=ts,
            )
            db.add(new_cat)
            existing_cat[norad_id] = new_cat  # prevent duplicates if same NORAD appears twice

    # Restore user-curated radio frequencies from the persistent store onto the
    # catalogue rows (both new and pre-existing). The store survives a TLE clear,
    # so this repopulates the display columns that the clear/re-import wiped.
    radio_map = await sat_radio.get_radio_map(db)
    if radio_map:
        sat_radio.apply_radio_to_rows(list(existing_cat.values()), radio_map)

    await db.commit()
    return {"inserted": inserted, "updated": updated}


# ── Single-satellite fetch (used by /api/space/iss) ──────────────────────────


def _single_satellite_url(feed_url: str, norad_id: str) -> str | None:
    """Return the per-satellite variant of a Celestrak-style GP feed URL, or None.

    The configured domain URL is normally a *bulk group* feed
    (``gp.php?GROUP=active&FORMAT=tle``). Fetching one satellite from it means
    downloading the whole catalogue, and it silently fails for any satellite
    that group happens not to contain. Swapping ``GROUP=<name>`` for
    ``CATNR=<norad_id>`` asks the same host for exactly the satellite wanted.

    Returns None when the URL has no GROUP parameter (an offgrid/local mirror or
    a plain .txt file), so those are fetched unchanged.
    """
    parsed = urlparse(feed_url)
    query = parse_qs(parsed.query)
    if "GROUP" not in query:
        return None

    query.pop("GROUP")
    query["CATNR"] = [norad_id]
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


async def fetch_tle(
    norad_id: str,
    db: AsyncSession,
    online_url: str | None = None,
    offline_url: str | None = None,
) -> str:
    """Return the latest TLE text for a given NORAD catalogue number.

    Checks the SQLite cache first. Manual/upload/url entries are served
    directly without hitting the network (they have long TTLs).

    For online-sourced entries: refreshes if expired, falls back to
    offline_url on failure, then serves stale within tle_stale_ms.

    Returns a string with three newline-separated lines: name, TLE1, TLE2.
    Raises RuntimeError if data is unavailable.
    """
    result = await db.execute(select(TleCache).where(TleCache.cache_key == norad_id))
    row = result.scalar_one_or_none()

    # Manual/upload/url entries: serve as long as within their long TTL
    if row and row.source in ("manual", "upload", "url") and is_fresh(row.expires_at):
        return row.payload

    # Online cache hit
    if row and row.source == "online" and is_fresh(row.expires_at):
        return row.payload

    # Cache miss or expired online entry — try to fetch from upstream
    default_url = (
        settings.celestrak_iss_url
        if norad_id == "25544"
        else (f"https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle")
    )
    primary = online_url if online_url else default_url

    # Try each configured feed's per-satellite form before its bulk form: a group
    # feed that omits this satellite would otherwise fetch ~15k entries and still
    # fail, and the precise URL was previously unreachable whenever a domain URL
    # was configured (which is always).
    fetch_urls: list[str] = []
    for feed_url in [primary, offline_url]:
        if not feed_url:
            continue
        for candidate in [_single_satellite_url(feed_url, norad_id), feed_url]:
            if candidate and candidate not in fetch_urls:
                fetch_urls.append(candidate)

    for url in fetch_urls:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text.strip()

            # Validate before storing
            entries = validate_tle_text(text)
            # Infer category for well-known satellites when fetching individually
            inferred = _KNOWN_SATELLITE_CATEGORIES.get(norad_id)
            inferred_category = inferred[0] if inferred else None
            inferred_category_source = inferred[1] if inferred else None
            await store_tle_bulk(
                entries, source="online", category=inferred_category, category_source=inferred_category_source, db=db
            )
            # Return the specific NORAD entry we need
            for name, line1, line2 in entries:
                if _norad_from_line1(line1) == norad_id:
                    return f"{name}\n{line1}\n{line2}"

            # Fallback: re-query the DB after bulk store committed it
            db_result = await db.execute(select(TleCache).where(TleCache.cache_key == norad_id))
            refreshed_row = db_result.scalar_one_or_none()
            if refreshed_row:
                return refreshed_row.payload

        except Exception:
            continue

    # All upstreams failed — serve stale if within window
    if row and is_within_stale(row.fetched_at, settings.tle_stale_ms):
        return row.payload

    raise RuntimeError(f"TLE unavailable for NORAD {norad_id}: upstream failed and no usable cache")


# ── Fetch from arbitrary URL (for manual URL fetch endpoint) ─────────────────


async def fetch_tle_from_url(
    url: str,
    category: str | None,
    category_source: str,
    db: AsyncSession,
) -> dict[str, int]:
    """Fetch TLE data from a URL, validate, and bulk-upsert into the DB.

    Used by POST /api/space/tle/fetch. Returns insert/update counts.
    Raises RuntimeError on network failure or ValueError on bad TLE data.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        text = resp.text.strip()

    entries = validate_tle_text(text)
    return await store_tle_bulk(entries, source="url", category=category, category_source=category_source, db=db)
