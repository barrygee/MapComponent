"""
Space domain router — ISS tracking, ground track, day/night terminator, and TLE management.

Endpoints:
  GET  /api/space/iss                        — ISS current position, ground track, and footprint
  GET  /api/space/iss/passes                 — Predicted passes over a given observer location
  GET  /api/space/satellite/{norad_id}       — Position, ground track, and footprint for any satellite
  GET  /api/space/satellite/{norad_id}/passes — Predicted passes for any satellite by NORAD ID
  GET  /api/space/daynight                   — Day/night terminator as GeoJSON polygon

  GET  /api/space/tle/status       — TLE database summary (counts, per-category last-updated)
  GET  /api/space/tle/uncategorised — Satellites with no assigned category
  POST /api/space/tle/fetch        — Fetch TLE data from a URL (online or local network)
  POST /api/space/tle/manual       — Store TLE data from raw text (paste / file upload)
  PATCH /api/space/tle/category    — Assign category to one or more NORAD IDs
  DELETE /api/space/tle            — Clear TLE data, optionally by category (requires confirm=true)
"""

from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx
from backend.cache import now_ms
from backend.database import get_db
from backend.error_handlers import handle_service_errors, handle_unexpected_errors
from backend.models import SatelliteCatalogue, TleCache
from backend.services import daynight as dn_service
from backend.services import sat_radio
from backend.services import satellite as sat_service
from backend.services import tle as tle_service
from backend.utils import resolve_domain_urls
from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/space", tags=["space"])

# Valid category values — sourced from tle_service to avoid duplication.
# 'active' is excluded from user-assignable categories: it is an inferred fallback,
# not a deliberate choice, and would be overridden by any real category.
_VALID_CATEGORIES = tle_service.VALID_CATEGORIES
_USER_ASSIGNABLE_CATEGORIES = _VALID_CATEGORIES - {"active"}

_ISS_NORAD = "25544"


async def _tle_database_is_empty(db: AsyncSession) -> bool:
    """Return True if the TLE cache table contains no rows."""
    result = await db.execute(select(func.count()).select_from(TleCache))
    return result.scalar() == 0


async def _get_satellite_data(
    norad_id: str,
    db: AsyncSession,
    obs_lat: float | None = None,
    obs_lon: float | None = None,
) -> dict:
    """Fetch TLE, propagate position/track/footprint for any satellite.

    When an observer location is supplied, the live position is annotated with
    observer-relative look angles (az/el) so the sky-plot marker is exact.

    Raises RuntimeError if TLE is unavailable, or re-raises other exceptions.
    """
    primary_url, fallback_url = await resolve_domain_urls("space", db)
    tle_text = await tle_service.fetch_tle(norad_id, db, primary_url, fallback_url)
    _, line1, line2 = tle_service.parse_tle_lines(tle_text)

    position = sat_service.compute_position(line1, line2)
    ground_track = sat_service.compute_ground_track(line1, line2)
    footprint = sat_service.compute_footprint(position["lat"], position["lon"], position["alt_km"])
    if obs_lat is not None and obs_lon is not None:
        position.update(
            sat_service.compute_look_angles(
                position["lat"],
                position["lon"],
                position["alt_km"],
                obs_lat,
                obs_lon,
            )
        )
    return {"position": position, "ground_track": ground_track, "footprint": footprint}


@router.get("/iss")
@handle_service_errors
async def get_iss(
    lat: float | None = Query(None, description="Observer latitude for live look-angles"),
    lon: float | None = Query(None, description="Observer longitude for live look-angles"),
    db: AsyncSession = Depends(get_db),
):
    """Return the current ISS position, ground track (±2 orbits), and visibility footprint.

    Position is propagated fresh on each request using the cached TLE.
    TLE is refreshed from the configured upstream URL at most once per hour.
    When lat/lon are supplied, the position includes observer-relative az/el.
    Returns 503 with no_tle_data=true if the TLE database is empty (e.g. after a manual clear).
    """
    # If the TLE database is empty (e.g. user cleared all data), do not auto-fetch —
    # return a distinct error so the UI can prompt the user to add TLE data.
    if await _tle_database_is_empty(db):
        return JSONResponse({"error": "No TLE data in database", "no_tle_data": True}, status_code=503)

    return JSONResponse(await _get_satellite_data(_ISS_NORAD, db, lat, lon))


@router.get("/satellite/{norad_id}")
async def get_satellite(
    norad_id: str,
    lat: float | None = Query(None, description="Observer latitude for live look-angles"),
    lon: float | None = Query(None, description="Observer longitude for live look-angles"),
    db: AsyncSession = Depends(get_db),
):
    """Return current position, ground track, and footprint for any satellite by NORAD ID.

    The satellite must exist in the TLE cache. Returns 404 if the NORAD ID is not found,
    or 503 if the TLE database is empty. When lat/lon are supplied, the position
    includes observer-relative az/el.
    """
    try:
        if await _tle_database_is_empty(db):
            return JSONResponse({"error": "No TLE data in database", "no_tle_data": True}, status_code=503)

        return JSONResponse(await _get_satellite_data(norad_id, db, lat, lon))

    except RuntimeError as e:
        msg = str(e)
        if "not found" in msg.lower() or "no tle" in msg.lower():
            return JSONResponse({"error": msg}, status_code=404)
        return JSONResponse({"error": msg}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Unexpected error: {e}"}, status_code=500)


async def _compute_passes_response(
    norad_id: str,
    lat: float,
    lon: float,
    hours: int,
    min_el: float,
    db: AsyncSession,
) -> JSONResponse:
    """Fetch TLE, compute passes, and return the standard passes JSON response."""
    primary_url, fallback_url = await resolve_domain_urls("space", db)
    tle_text = await tle_service.fetch_tle(norad_id, db, primary_url, fallback_url)
    _, line1, line2 = tle_service.parse_tle_lines(tle_text)

    passes = sat_service.compute_passes(
        line1,
        line2,
        obs_lat=lat,
        obs_lon=lon,
        lookahead_hours=hours,
        min_elevation_deg=min_el,
    )
    return JSONResponse(
        {
            "passes": passes,
            "obs_lat": lat,
            "obs_lon": lon,
            "lookahead_hours": hours,
            "computed_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    )


@router.get("/iss/passes")
@handle_service_errors
async def get_iss_passes(
    lat: float = Query(..., description="Observer latitude in degrees"),
    lon: float = Query(..., description="Observer longitude in degrees"),
    hours: int = Query(24, ge=1, le=48, description="Lookahead window in hours"),
    min_el: float = Query(0.0, ge=0.0, le=90.0, description="Minimum max-elevation filter (degrees)"),
    db: AsyncSession = Depends(get_db),
):
    """Predict ISS passes visible from an observer location within the next N hours.

    A pass is returned whenever the ISS rises above the observer's horizon (elevation >= 0°).
    Results include AOS/LOS times, duration, and maximum elevation angle.
    """
    return await _compute_passes_response(_ISS_NORAD, lat, lon, hours, min_el, db)


@router.get("/satellite/{norad_id}/passes")
@handle_service_errors
async def get_satellite_passes(
    norad_id: str,
    lat: float = Query(..., description="Observer latitude in degrees"),
    lon: float = Query(..., description="Observer longitude in degrees"),
    hours: int = Query(24, ge=1, le=48, description="Lookahead window in hours"),
    min_el: float = Query(0.0, ge=0.0, le=90.0, description="Minimum max-elevation filter (degrees)"),
    db: AsyncSession = Depends(get_db),
):
    """Predict passes for any satellite visible from an observer location within the next N hours."""
    return await _compute_passes_response(norad_id, lat, lon, hours, min_el, db)


@router.get("/passes")
@handle_service_errors
async def get_multi_satellite_passes(
    lat: float = Query(..., description="Observer latitude in degrees"),
    lon: float = Query(..., description="Observer longitude in degrees"),
    hours: int = Query(24, ge=1, le=48, description="Lookahead window in hours"),
    min_el: float = Query(10.0, ge=0.0, le=90.0, description="Minimum max-elevation filter (degrees)"),
    categories: str = Query(None, description="Comma-separated category names to include"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of passes to return"),
    db: AsyncSession = Depends(get_db),
):
    """Predict upcoming passes for all satellites in the given categories.

    For each matching satellite, computes passes within the next N hours and returns
    them sorted by AOS time across all satellites. Satellites with no cached TLE are
    silently skipped.

    Large category sets (e.g. amateur with 500+ satellites) may take 10-20 seconds.
    Recommend filtering to 1-3 categories and using min_el >= 10.
    """
    # Parse and validate categories
    if categories:
        requested = [c.strip() for c in categories.split(",") if c.strip()]
        invalid = [c for c in requested if c not in _VALID_CATEGORIES]
        if invalid:
            return JSONResponse(
                {"error": f"Invalid categories: {invalid}. Valid: {sorted(_VALID_CATEGORIES)}"},
                status_code=400,
            )
        category_filter = requested
    else:
        category_filter = list(_VALID_CATEGORIES)

    # Single query to get matching satellites
    result = await db.execute(
        select(
            SatelliteCatalogue.norad_id,
            SatelliteCatalogue.name,
            SatelliteCatalogue.category,
            SatelliteCatalogue.uplink_hz,
            SatelliteCatalogue.uplink_mode,
            SatelliteCatalogue.downlink_hz,
            SatelliteCatalogue.downlink_mode,
            SatelliteCatalogue.ctcss_hz,
            SatelliteCatalogue.transponder_type,
            SatelliteCatalogue.beacon_hz,
            SatelliteCatalogue.packet_info,
            SatelliteCatalogue.radio_status,
            SatelliteCatalogue.radio_notes,
        ).where(SatelliteCatalogue.category.in_(category_filter))
    )
    satellites = result.all()

    if not satellites:
        return JSONResponse(
            {
                "passes": [],
                "obs_lat": lat,
                "obs_lon": lon,
                "lookahead_hours": hours,
                "satellite_count": 0,
                "computed_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )

    primary_url, fallback_url = await resolve_domain_urls("space", db)
    all_passes = []

    for row in satellites[:500]:
        norad_id, name, category = row[0], row[1], row[2]
        try:
            tle_text = await tle_service.fetch_tle(norad_id, db, primary_url, fallback_url)
            _, line1, line2 = tle_service.parse_tle_lines(tle_text)
            passes = sat_service.compute_passes(
                line1,
                line2,
                obs_lat=lat,
                obs_lon=lon,
                lookahead_hours=hours,
                min_elevation_deg=min_el,
            )
            for p in passes:
                # The list view never plots arcs — the polar plot is fed by the
                # per-satellite passes endpoint. Drop the track to keep this
                # multi-satellite response small.
                p.pop("sky_track", None)
                p["norad_id"] = norad_id
                p["name"] = name
                p["category"] = category
                p["uplink_hz"] = row[3]
                p["uplink_mode"] = row[4]
                p["downlink_hz"] = row[5]
                p["downlink_mode"] = row[6]
                p["ctcss_hz"] = row[7]
                p["transponder_type"] = row[8]
                p["beacon_hz"] = row[9]
                p["packet_info"] = row[10]
                p["radio_status"] = row[11]
                p["radio_notes"] = row[12]
            all_passes.extend(passes)
        except (RuntimeError, ValueError):
            continue

    all_passes.sort(key=lambda p: p["aos_unix_ms"])
    all_passes = all_passes[:limit]

    return JSONResponse(
        {
            "passes": all_passes,
            "obs_lat": lat,
            "obs_lon": lon,
            "lookahead_hours": hours,
            "satellite_count": len(satellites),
            "computed_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    )


@router.get("/daynight")
async def get_daynight():
    """Return the current day/night terminator as a GeoJSON Polygon Feature.

    Computed fresh on each request using only the current UTC time.
    """
    try:
        feature = dn_service.compute_terminator()
        return JSONResponse(feature)
    except Exception as e:
        return JSONResponse({"error": f"Terminator computation failed: {e}"}, status_code=500)


# ── TLE management endpoints ─────────────────────────────────────────────────


@router.get("/tle/status")
@handle_unexpected_errors
async def get_tle_status(db: AsyncSession = Depends(get_db)):
    """Return a summary of the TLE database.

    Includes total satellite count, per-source counts, and per-category
    last-updated timestamps (Unix ms of the most recent TLE update in that category).
    """
    # Total count and per-source breakdown — aggregated in SQL, not Python
    total_result = await db.execute(select(func.count()).select_from(TleCache))
    total = total_result.scalar() or 0

    source_result = await db.execute(select(TleCache.source, func.count()).group_by(TleCache.source))
    source_counts = dict(source_result.all())

    # Per-category stats — one query using COALESCE to treat NULL as 'unknown'
    category_col = case((SatelliteCatalogue.category.is_(None), "unknown"), else_=SatelliteCatalogue.category)
    cat_result = await db.execute(
        select(
            category_col.label("cat"),
            func.count().label("count"),
            func.max(SatelliteCatalogue.updated_at).label("last_updated"),
        ).group_by(category_col)
    )
    category_stats = {row.cat: {"count": row.count, "last_updated": row.last_updated or 0} for row in cat_result.all()}

    # Uncategorised count comes directly from the category_stats dict
    uncategorised_count = 0
    if "unknown" in category_stats:
        # Count only true NULLs — re-query so we don't conflate NULL with explicit 'unknown'
        unc_result = await db.execute(
            select(func.count()).select_from(SatelliteCatalogue).where(SatelliteCatalogue.category.is_(None))
        )
        uncategorised_count = unc_result.scalar() or 0

    return JSONResponse(
        {
            "total": total,
            "uncategorised": uncategorised_count,
            "by_source": source_counts,
            "by_category": category_stats,
        }
    )


@router.get("/tle/list")
@handle_unexpected_errors
async def get_tle_list(db: AsyncSession = Depends(get_db)):
    """Return all satellites in the catalogue ordered by name.

    Used by the satellite list summary panel in settings.
    """
    result = await db.execute(select(SatelliteCatalogue).order_by(SatelliteCatalogue.name))
    rows = result.scalars().all()
    return JSONResponse(
        {
            "satellites": [
                {
                    "norad_id": r.norad_id,
                    "name": r.name,
                    "category": r.category,
                    "name_source": r.name_source,
                    "updated_at": r.updated_at,
                    "uplink_hz": r.uplink_hz,
                    "uplink_mode": r.uplink_mode,
                    "downlink_hz": r.downlink_hz,
                    "downlink_mode": r.downlink_mode,
                    "ctcss_hz": r.ctcss_hz,
                    "transponder_type": r.transponder_type,
                    "beacon_hz": r.beacon_hz,
                    "packet_info": r.packet_info,
                    "radio_status": r.radio_status,
                    "radio_notes": r.radio_notes,
                }
                for r in rows
            ]
        }
    )


@router.get("/tle/uncategorised")
@handle_unexpected_errors
async def get_tle_uncategorised(db: AsyncSession = Depends(get_db)):
    """Return satellites that have no category assigned.

    Used to render the uncategorised list in the settings panel so the user
    can assign categories without being prompted during the original upload.
    """
    result = await db.execute(
        select(SatelliteCatalogue).where(SatelliteCatalogue.category.is_(None)).order_by(SatelliteCatalogue.name)
    )
    rows = result.scalars().all()
    return JSONResponse({"satellites": [{"norad_id": r.norad_id, "name": r.name} for r in rows]})


@router.post("/tle/fetch")
async def fetch_tle_from_url(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Fetch TLE data from a URL (Celestrak group or local network server).

    Body: { "url": str, "category": str | null }

    Validates all TLE entries before writing. Additive — existing satellites
    are updated but not deleted. Category is applied with 'celestrak_group'
    source priority unless category is null/active (treated as 'active' priority).
    """
    try:
        url = (body.get("url") or "").strip()
        category = body.get("category") or None

        if not url:
            return JSONResponse({"error": "url is required"}, status_code=400)
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return JSONResponse({"error": "Invalid URL"}, status_code=400)

        if category and category not in _VALID_CATEGORIES:
            return JSONResponse(
                {"error": f"Invalid category. Valid values: {sorted(_VALID_CATEGORIES)}"},
                status_code=400,
            )

        cat_source = "celestrak_group" if (category and category != "active") else "active"
        counts = await tle_service.fetch_tle_from_url(url, category, cat_source, db)

        return JSONResponse(
            {
                "inserted": counts["inserted"],
                "updated": counts["updated"],
            }
        )

    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    except (httpx.TimeoutException, httpx.ConnectError) as e:
        return JSONResponse({"error": f"Network error — could not reach {url}: {type(e).__name__}"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": f"Fetch failed: {type(e).__name__}: {e}"}, status_code=502)


@router.post("/tle/manual")
async def store_tle_manual(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Store TLE data from raw text (paste or file upload content).

    Body: { "text": str, "category": str | null }

    Validates all entries before writing. Additive — existing satellites
    are updated (newer TLE wins), no existing records are deleted.
    """
    try:
        text = (body.get("text") or "").strip()
        category = body.get("category") or None

        if not text:
            return JSONResponse({"error": "text is required"}, status_code=400)

        if category and category not in _VALID_CATEGORIES:
            return JSONResponse(
                {"error": f"Invalid category. Valid values: {sorted(_VALID_CATEGORIES)}"},
                status_code=400,
            )

        entries = tle_service.validate_tle_text(text)
        cat_source = "user" if category else None
        counts = await tle_service.store_tle_bulk(
            entries,
            source="manual",
            category=category,
            category_source=cat_source,
            db=db,
        )

        return JSONResponse(
            {
                "inserted": counts["inserted"],
                "updated": counts["updated"],
                "total": len(entries),
            }
        )

    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    except Exception as e:
        return JSONResponse({"error": f"Store failed: {e}"}, status_code=500)


@router.patch("/tle/category")
@handle_unexpected_errors
async def patch_tle_category(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Assign a category to one or more satellites by NORAD ID.

    Body: { "assignments": [{ "norad_id": str, "category": str }] }

    Applied with 'user' source priority via the same _category_beats() logic
    used in bulk imports. Invalid category values return a 400 error.
    'active' is excluded as a user-assignable category — it has no meaning
    as a deliberate choice and would be overridden by any real category.
    """
    assignments = body.get("assignments") or []
    if not assignments:
        return JSONResponse({"error": "assignments array is required"}, status_code=400)

    ts = now_ms()
    updated = 0
    skipped = 0
    invalid = []

    # Validate all assignments before touching the DB
    valid_assignments: list[tuple[str, str]] = []
    for item in assignments:
        norad_id = str(item.get("norad_id") or "").strip()
        category = str(item.get("category") or "").strip()
        if not norad_id or not category:
            skipped += 1
            continue
        if category not in _USER_ASSIGNABLE_CATEGORIES:
            invalid.append(category)
            continue
        valid_assignments.append((norad_id, category))

    if invalid:
        return JSONResponse(
            {"error": f"Invalid category values: {list(set(invalid))}. Valid: {sorted(_USER_ASSIGNABLE_CATEGORIES)}"},
            status_code=400,
        )

    # Fetch all relevant satellites in one query instead of one per assignment
    norad_ids = [norad_id for norad_id, _ in valid_assignments]
    result = await db.execute(select(SatelliteCatalogue).where(SatelliteCatalogue.norad_id.in_(norad_ids)))
    rows_by_id = {row.norad_id: row for row in result.scalars().all()}

    for norad_id, category in valid_assignments:
        row = rows_by_id.get(norad_id)
        if row and tle_service._category_beats(category, "user", row.category, row.category_source):
            row.category = category
            row.category_source = "user"
            row.updated_at = ts
            updated += 1

    await db.commit()
    return JSONResponse({"updated": updated, "skipped": skipped})


@router.patch("/tle/satellite")
@handle_unexpected_errors
async def patch_tle_satellite(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Update name and/or category for a single satellite by NORAD ID.

    Body: { "norad_id": str, "name": str | null, "category": str | null }

    Name is stored with 'user' source so it persists across TLE updates.
    Category follows the same priority rules as the bulk category endpoint.
    """
    norad_id = str(body.get("norad_id") or "").strip()
    name = (body.get("name") or "").strip() or None
    category = (body.get("category") or "").strip() or None

    if not norad_id:
        return JSONResponse({"error": "norad_id is required"}, status_code=400)
    if category and category not in _USER_ASSIGNABLE_CATEGORIES:
        return JSONResponse(
            {"error": f"Invalid category. Valid values: {sorted(_USER_ASSIGNABLE_CATEGORIES)}"},
            status_code=400,
        )

    result = await db.execute(select(SatelliteCatalogue).where(SatelliteCatalogue.norad_id == norad_id))
    row = result.scalar_one_or_none()
    if not row:
        return JSONResponse({"error": "Satellite not found"}, status_code=404)

    ts = now_ms()

    if name:
        row.name = name
        row.name_source = "user"

    if category is not None:
        if tle_service._category_beats(category, "user", row.category, row.category_source):
            row.category = category
            row.category_source = "user"

    row.updated_at = ts
    await db.commit()

    return JSONResponse(
        {
            "norad_id": row.norad_id,
            "name": row.name,
            "category": row.category,
        }
    )


@router.get("/radio/file")
@handle_unexpected_errors
async def get_radio_file(db: AsyncSession = Depends(get_db)):
    """Return the full norad_id -> radio-fields map (the Space textarea source)."""
    return JSONResponse(await sat_radio.get_radio_map(db))


@router.post("/radio/file")
@handle_unexpected_errors
async def set_radio_file(body: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Replace the entire satellite radio map from an edited JSON object.

    Persists the store, refreshes the catalogue display columns, and writes
    satellite_radio.json back."""
    if not isinstance(body, dict):
        return JSONResponse({"error": "Body must be a JSON object"}, status_code=400)
    cleaned = await sat_radio.replace_radio_map(db, body)
    return JSONResponse({"status": "ok", "count": len(cleaned)})


@router.delete("/tle")
@handle_unexpected_errors
async def clear_tle_data(
    confirm: bool = Query(False, description="Must be true to execute the delete"),
    category: str = Query(
        None,
        description="If set, only clear satellites in this category "
        "('unknown' clears uncategorised). Omit to clear everything.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Delete TLE data from both tle_cache and satellite_catalogue.

    With no category, clears the entire database. With a category, clears only
    the satellites in that category (and their cached TLE rows). The special
    value 'unknown' clears uncategorised satellites (category IS NULL).

    Requires ?confirm=true query parameter as a safeguard against accidental calls.
    """
    if not confirm:
        return JSONResponse(
            {"error": "Pass ?confirm=true to confirm deletion of TLE data"},
            status_code=400,
        )

    if category is None:
        await db.execute(delete(TleCache))
        await db.execute(delete(SatelliteCatalogue))
        await db.commit()
        return JSONResponse({"cleared": True})

    # Per-category clear. Validate against known categories (plus 'unknown' for NULL).
    if category != "unknown" and category not in _VALID_CATEGORIES:
        return JSONResponse(
            {"error": f"Invalid category. Valid values: {sorted(_VALID_CATEGORIES) + ['unknown']}"},
            status_code=400,
        )

    cat_filter = (
        SatelliteCatalogue.category.is_(None) if category == "unknown" else SatelliteCatalogue.category == category
    )

    # Gather the NORAD IDs in this category so we can also drop their cached TLE
    # rows (tle_cache.cache_key == satellite_catalogue.norad_id, no FK link).
    id_rows = await db.execute(select(SatelliteCatalogue.norad_id).where(cat_filter))
    norad_ids = [row[0] for row in id_rows.all()]

    if norad_ids:
        await db.execute(delete(TleCache).where(TleCache.cache_key.in_(norad_ids)))
        await db.execute(delete(SatelliteCatalogue).where(cat_filter))
        await db.commit()

    return JSONResponse({"cleared": True, "category": category, "count": len(norad_ids)})
