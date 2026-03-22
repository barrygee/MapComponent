"""
Space domain router — ISS tracking, ground track, day/night terminator, and TLE management.

Endpoints:
  GET  /api/space/iss              — ISS current position, ground track, and footprint
  GET  /api/space/iss/passes       — Predicted passes over a given observer location
  GET  /api/space/satellite/{norad_id}/passes — Predicted passes for any satellite by NORAD ID
  GET  /api/space/daynight         — Day/night terminator as GeoJSON polygon

  GET  /api/space/tle/status       — TLE database summary (counts, per-category last-updated)
  GET  /api/space/tle/uncategorised — Satellites with no assigned category
  POST /api/space/tle/fetch        — Fetch TLE data from a URL (online or local network)
  POST /api/space/tle/manual       — Store TLE data from raw text (paste / file upload)
  PATCH /api/space/tle/category    — Assign category to one or more NORAD IDs
  DELETE /api/space/tle            — Clear all TLE data (requires confirm=true)
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.cache import now_ms
from backend.database import get_db
from backend.models import SatelliteCatalogue, TleCache
from backend.services import daynight as dn_service
from backend.services import satellite as sat_service
from backend.services import tle as tle_service
from backend.utils import resolve_domain_urls

router = APIRouter(prefix="/api/space", tags=["space"])

# Valid category values accepted by the API
_VALID_CATEGORIES = {
    "space_station", "amateur", "weather", "military",
    "navigation", "science", "cubesat", "active", "unknown",
}

_ISS_NORAD = "25544"



@router.get("/iss")
async def get_iss(db: AsyncSession = Depends(get_db)):
    """Return the current ISS position, ground track (±2 orbits), and visibility footprint.

    Position is propagated fresh on each request using the cached TLE.
    TLE is refreshed from the configured upstream URL at most once per hour.
    Returns 503 with no_tle_data=true if the TLE database is empty (e.g. after a manual clear).
    """
    try:
        # If the TLE database is empty (e.g. user cleared all data), do not auto-fetch —
        # return a distinct error so the UI can prompt the user to add TLE data.
        tle_count_result = await db.execute(select(func.count()).select_from(TleCache))
        if tle_count_result.scalar() == 0:
            return JSONResponse({"error": "No TLE data in database", "no_tle_data": True}, status_code=503)

        online_url, _ = await resolve_domain_urls("space", db)
        tle_text = await tle_service.fetch_tle(_ISS_NORAD, db, online_url)
        _, line1, line2 = tle_service.parse_tle_lines(tle_text)

        position = sat_service.compute_position(line1, line2)
        ground_track = sat_service.compute_ground_track(line1, line2)
        footprint = sat_service.compute_footprint(
            position["lat"], position["lon"], position["alt_km"]
        )

        return JSONResponse({
            "position": position,
            "ground_track": ground_track,
            "footprint": footprint,
        })

    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Unexpected error: {e}"}, status_code=500)


@router.get("/satellite/{norad_id}")
async def get_satellite(norad_id: str, db: AsyncSession = Depends(get_db)):
    """Return current position, ground track, and footprint for any satellite by NORAD ID.

    The satellite must exist in the TLE cache. Returns 404 if the NORAD ID is not found,
    or 503 if the TLE database is empty.
    """
    try:
        tle_count_result = await db.execute(select(func.count()).select_from(TleCache))
        if tle_count_result.scalar() == 0:
            return JSONResponse({"error": "No TLE data in database", "no_tle_data": True}, status_code=503)

        online_url, _ = await resolve_domain_urls("space", db)
        tle_text = await tle_service.fetch_tle(norad_id, db, online_url)
        _, line1, line2 = tle_service.parse_tle_lines(tle_text)

        position = sat_service.compute_position(line1, line2)
        ground_track = sat_service.compute_ground_track(line1, line2)
        footprint = sat_service.compute_footprint(
            position["lat"], position["lon"], position["alt_km"]
        )

        return JSONResponse({
            "position":     position,
            "ground_track": ground_track,
            "footprint":    footprint,
        })

    except RuntimeError as e:
        msg = str(e)
        if "not found" in msg.lower() or "no tle" in msg.lower():
            return JSONResponse({"error": msg}, status_code=404)
        return JSONResponse({"error": msg}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Unexpected error: {e}"}, status_code=500)


@router.get("/iss/passes")
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
    try:
        online_url, _ = await resolve_domain_urls("space", db)
        tle_text = await tle_service.fetch_tle(_ISS_NORAD, db, online_url)
        _, line1, line2 = tle_service.parse_tle_lines(tle_text)

        passes = sat_service.compute_passes(
            line1, line2,
            obs_lat=lat,
            obs_lon=lon,
            lookahead_hours=hours,
            min_elevation_deg=min_el,
        )

        return JSONResponse({
            "passes":          passes,
            "obs_lat":         lat,
            "obs_lon":         lon,
            "lookahead_hours": hours,
            "computed_at":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Unexpected error: {e}"}, status_code=500)


@router.get("/satellite/{norad_id}/passes")
async def get_satellite_passes(
    norad_id: str,
    lat: float = Query(..., description="Observer latitude in degrees"),
    lon: float = Query(..., description="Observer longitude in degrees"),
    hours: int = Query(24, ge=1, le=48, description="Lookahead window in hours"),
    min_el: float = Query(0.0, ge=0.0, le=90.0, description="Minimum max-elevation filter (degrees)"),
    db: AsyncSession = Depends(get_db),
):
    """Predict passes for any satellite visible from an observer location within the next N hours."""
    try:
        online_url, _ = await resolve_domain_urls("space", db)
        tle_text = await tle_service.fetch_tle(norad_id, db, online_url)
        _, line1, line2 = tle_service.parse_tle_lines(tle_text)

        passes = sat_service.compute_passes(
            line1, line2,
            obs_lat=lat,
            obs_lon=lon,
            lookahead_hours=hours,
            min_elevation_deg=min_el,
        )

        return JSONResponse({
            "passes":          passes,
            "obs_lat":         lat,
            "obs_lon":         lon,
            "lookahead_hours": hours,
            "computed_at":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Unexpected error: {e}"}, status_code=500)


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
async def get_tle_status(db: AsyncSession = Depends(get_db)):
    """Return a summary of the TLE database.

    Includes total satellite count, per-source counts, and per-category
    last-updated timestamps (Unix ms of the most recent TLE update in that category).
    """
    try:
        # Total count and per-source breakdown from tle_cache
        tle_result = await db.execute(select(TleCache))
        tle_rows = tle_result.scalars().all()

        source_counts: dict[str, int] = {}
        for row in tle_rows:
            source_counts[row.source] = source_counts.get(row.source, 0) + 1

        # Per-category last-updated from satellite_catalogue
        cat_result = await db.execute(select(SatelliteCatalogue))
        cat_rows = cat_result.scalars().all()

        category_stats: dict[str, dict] = {}
        for row in cat_rows:
            cat = row.category or "unknown"
            if cat not in category_stats:
                category_stats[cat] = {"count": 0, "last_updated": 0}
            category_stats[cat]["count"] += 1
            if row.updated_at > category_stats[cat]["last_updated"]:
                category_stats[cat]["last_updated"] = row.updated_at

        uncategorised_count = sum(
            1 for r in cat_rows if r.category is None
        )

        return JSONResponse({
            "total":               len(tle_rows),
            "uncategorised":       uncategorised_count,
            "by_source":           source_counts,
            "by_category":         category_stats,
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/tle/list")
async def get_tle_list(db: AsyncSession = Depends(get_db)):
    """Return all satellites in the catalogue ordered by name.

    Used by the satellite list summary panel in settings.
    """
    try:
        result = await db.execute(
            select(SatelliteCatalogue).order_by(SatelliteCatalogue.name)
        )
        rows = result.scalars().all()
        return JSONResponse({
            "satellites": [
                {
                    "norad_id":    r.norad_id,
                    "name":        r.name,
                    "category":    r.category,
                    "name_source": r.name_source,
                    "updated_at":  r.updated_at,
                }
                for r in rows
            ]
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/tle/uncategorised")
async def get_tle_uncategorised(db: AsyncSession = Depends(get_db)):
    """Return satellites that have no category assigned.

    Used to render the uncategorised list in the settings panel so the user
    can assign categories without being prompted during the original upload.
    """
    try:
        result = await db.execute(
            select(SatelliteCatalogue)
            .where(SatelliteCatalogue.category.is_(None))
            .order_by(SatelliteCatalogue.name)
        )
        rows = result.scalars().all()
        return JSONResponse({
            "satellites": [
                {"norad_id": r.norad_id, "name": r.name}
                for r in rows
            ]
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


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
        url      = (body.get("url") or "").strip()
        category = body.get("category") or None

        if not url:
            return JSONResponse({"error": "url is required"}, status_code=400)
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError()
        except Exception:
            return JSONResponse({"error": "Invalid URL"}, status_code=400)

        if category and category not in _VALID_CATEGORIES:
            return JSONResponse(
                {"error": f"Invalid category. Valid values: {sorted(_VALID_CATEGORIES)}"},
                status_code=400,
            )

        cat_source = "celestrak_group" if (category and category != "active") else "active"
        counts = await tle_service.fetch_tle_from_url(url, category, cat_source, db)

        return JSONResponse({
            "inserted": counts["inserted"],
            "updated":  counts["updated"],
        })

    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    except Exception as e:
        return JSONResponse({"error": f"Fetch failed: {e}"}, status_code=502)


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
        text     = (body.get("text") or "").strip()
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
            entries, source="manual",
            category=category, category_source=cat_source,
            db=db,
        )

        return JSONResponse({
            "inserted": counts["inserted"],
            "updated":  counts["updated"],
            "total":    len(entries),
        })

    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=422)
    except Exception as e:
        return JSONResponse({"error": f"Store failed: {e}"}, status_code=500)


@router.patch("/tle/category")
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
    # 'active' is not a valid user-assignable category
    _USER_ASSIGNABLE = _VALID_CATEGORIES - {"active"}

    try:
        assignments = body.get("assignments") or []
        if not assignments:
            return JSONResponse({"error": "assignments array is required"}, status_code=400)

        ts       = now_ms()
        updated  = 0
        skipped  = 0
        invalid  = []

        for item in assignments:
            norad_id = str(item.get("norad_id") or "").strip()
            category = str(item.get("category") or "").strip()

            if not norad_id or not category:
                skipped += 1
                continue
            if category not in _USER_ASSIGNABLE:
                invalid.append(category)
                continue

            result = await db.execute(
                select(SatelliteCatalogue).where(SatelliteCatalogue.norad_id == norad_id)
            )
            row = result.scalar_one_or_none()
            if row and tle_service._category_beats(category, "user", row.category, row.category_source):
                row.category        = category
                row.category_source = "user"
                row.updated_at      = ts
                updated += 1

        if invalid:
            return JSONResponse(
                {"error": f"Invalid category values: {list(set(invalid))}. Valid: {sorted(_USER_ASSIGNABLE)}"},
                status_code=400,
            )

        await db.commit()
        return JSONResponse({"updated": updated, "skipped": skipped})

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.patch("/tle/satellite")
async def patch_tle_satellite(
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Update name and/or category for a single satellite by NORAD ID.

    Body: { "norad_id": str, "name": str | null, "category": str | null }

    Name is stored with 'user' source so it persists across TLE updates.
    Category follows the same priority rules as the bulk category endpoint.
    """
    _USER_ASSIGNABLE = _VALID_CATEGORIES - {"active"}

    try:
        norad_id = str(body.get("norad_id") or "").strip()
        name     = (body.get("name") or "").strip() or None
        category = (body.get("category") or "").strip() or None

        if not norad_id:
            return JSONResponse({"error": "norad_id is required"}, status_code=400)
        if category and category not in _USER_ASSIGNABLE:
            return JSONResponse(
                {"error": f"Invalid category. Valid values: {sorted(_USER_ASSIGNABLE)}"},
                status_code=400,
            )

        result = await db.execute(
            select(SatelliteCatalogue).where(SatelliteCatalogue.norad_id == norad_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            return JSONResponse({"error": "Satellite not found"}, status_code=404)

        ts = now_ms()

        if name:
            row.name        = name
            row.name_source = "user"

        if category is not None:
            if tle_service._category_beats(category, "user", row.category, row.category_source):
                row.category        = category
                row.category_source = "user"

        row.updated_at = ts
        await db.commit()

        return JSONResponse({
            "norad_id": row.norad_id,
            "name":     row.name,
            "category": row.category,
        })

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.delete("/tle")
async def clear_tle_data(
    confirm: bool = Query(False, description="Must be true to execute the delete"),
    db: AsyncSession = Depends(get_db),
):
    """Delete all TLE data from both tle_cache and satellite_catalogue.

    Requires ?confirm=true query parameter as a safeguard against accidental calls.
    """
    if not confirm:
        return JSONResponse(
            {"error": "Pass ?confirm=true to confirm deletion of all TLE data"},
            status_code=400,
        )
    try:
        await db.execute(delete(TleCache))
        await db.execute(delete(SatelliteCatalogue))
        await db.commit()
        return JSONResponse({"cleared": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
