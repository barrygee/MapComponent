"""
Air domain router — ADS-B live tracking.

Endpoints:
  GET    /api/air/adsb/point/{lat}/{lon}/{radius}  — ADS-B aircraft proxy with SQLite cache
  GET    /api/air/messages                         — List air-domain notification messages
  POST   /api/air/messages                         — Create a new air message
  DELETE /api/air/messages/{msg_id}                — Dismiss (soft-delete) a message
  DELETE /api/air/messages                         — Dismiss all messages
  GET    /api/air/tracking                         — List currently tracked aircraft
  POST   /api/air/tracking                         — Add aircraft to tracking
  DELETE /api/air/tracking/{hex}                   — Remove aircraft from tracking
"""

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.cache import is_fresh, is_within_stale, now_ms
from backend.config import settings
from backend.database import get_db
from backend.models import AdsbCache, AirMessage, AirTracking
from backend.services import adsb as adsb_service
from backend.utils import resolve_domain_urls


# ── Request body schemas ───────────────────────────────────────────────────────

class MessageIn(BaseModel):
    """Body for POST /api/air/messages — creates a new notification message."""
    msg_id: str   # client-generated unique id
    type: str     # 'emergency' | 'flight' | 'system' | 'squawk-clr' etc.
    title: str    # short headline shown in the panel
    detail: str = ""  # optional secondary text
    ts: int       # event timestamp, Unix ms


class TrackingIn(BaseModel):
    """Body for POST /api/air/tracking — adds or updates an aircraft in the tracking list."""
    hex: str              # ICAO 24-bit hex identifier
    callsign: str = ""
    follow: bool = False  # whether camera-follow mode is active


router = APIRouter(prefix="/api/air", tags=["air"])


# ── ADS-B proxy ────────────────────────────────────────────────────────────────

@router.get("/adsb/point/{lat}/{lon}/{radius}")
async def get_aircraft_near_point(
    lat: float,
    lon: float,
    radius: int = 250,
    db: AsyncSession = Depends(get_db),
):
    """Proxy the airplanes.live /v2/point endpoint with a SQLite write-through cache.

    Cache strategy:
      - HIT:   fresh row exists (within adsb_ttl_ms = 5s) → return immediately
      - MISS:  no row or expired → fetch upstream, upsert row, return fresh data
      - STALE: upstream failed but stale row within adsb_stale_ms = 30s → serve old data
      - 503:   upstream failed and no usable stale entry
    """
    # Build a deterministic cache key from the query parameters
    cache_key = f"{lat:.4f}_{lon:.4f}_{radius}"

    primary_url, fallback_url = await resolve_domain_urls("air", db)

    # Look up any existing cache row for this key
    result = await db.execute(select(AdsbCache).where(AdsbCache.cache_key == cache_key))
    row = result.scalar_one_or_none()

    # Return immediately if the cached data is still within its TTL,
    # but only when there is a primary source to fetch from. If primary_url
    # is None (e.g. offline mode with no offline source configured) we skip
    # the cache so callers get a 503 rather than stale online data.
    if row and is_fresh(row.expires_at) and primary_url is not None:
        return JSONResponse(content=json.loads(row.payload), headers={"X-Cache": "HIT"})

    # If primary_url is None the effective mode is offline with no offline source —
    # do not fall back to the online URL, just serve a 503.
    if primary_url is None:
        raise HTTPException(status_code=503, detail="ADS-B upstream unavailable")

    data: dict | None = None
    for base_url in filter(None, [primary_url, fallback_url]):
        try:
            data = await adsb_service.fetch_aircraft(lat, lon, radius, base_url)
            break
        except (httpx.HTTPError, Exception):
            continue

    if data is not None:
        payload_str = json.dumps(data)
        ts = now_ms()

        # Upsert: update existing row or insert new one
        if row:
            row.payload    = payload_str
            row.ac_count   = len(data.get("ac", []))
            row.fetched_at = ts
            row.expires_at = ts + settings.adsb_ttl_ms
        else:
            db.add(AdsbCache(
                cache_key=cache_key,
                lat=lat,
                lon=lon,
                radius_nm=radius,
                payload=payload_str,
                ac_count=len(data.get("ac", [])),
                fetched_at=ts,
                expires_at=ts + settings.adsb_ttl_ms,
            ))
        await db.commit()

        return JSONResponse(content=data, headers={"X-Cache": "MISS"})

    # All upstreams failed — serve stale data if still within the stale window
    if row and is_within_stale(row.fetched_at, settings.adsb_stale_ms):
        return JSONResponse(content=json.loads(row.payload), headers={"X-Cache": "STALE"})
    raise HTTPException(status_code=503, detail="ADS-B upstream unavailable")


# ── Notification messages ──────────────────────────────────────────────────────

@router.get("/messages")
async def list_air_messages(db: AsyncSession = Depends(get_db)):
    """Return all non-dismissed air messages, newest first."""
    result = await db.execute(
        select(AirMessage)
        .where(AirMessage.dismissed == False)  # noqa: E712
        .order_by(AirMessage.ts.desc())
    )
    rows = result.scalars().all()
    # Serialise to plain dicts (omit the dismissed flag — client doesn't need it)
    return JSONResponse([
        {"msg_id": r.msg_id, "type": r.type, "title": r.title, "detail": r.detail, "ts": r.ts}
        for r in rows
    ])


@router.post("/messages", status_code=201)
async def create_air_message(body: MessageIn, db: AsyncSession = Depends(get_db)):
    """Persist a new air message. Idempotent: if msg_id already exists, returns 200 'exists'."""
    existing = await db.execute(select(AirMessage).where(AirMessage.msg_id == body.msg_id))
    if existing.scalar_one_or_none():
        return JSONResponse({"status": "exists"}, status_code=200)  # already stored, no-op

    db.add(AirMessage(
        msg_id=body.msg_id,
        type=body.type,
        title=body.title,
        detail=body.detail,
        ts=body.ts,
    ))
    await db.commit()
    return JSONResponse({"status": "created"}, status_code=201)


@router.delete("/messages/{msg_id}", status_code=200)
async def dismiss_air_message(msg_id: str, db: AsyncSession = Depends(get_db)):
    """Soft-delete a single message by msg_id (sets dismissed=True)."""
    result = await db.execute(select(AirMessage).where(AirMessage.msg_id == msg_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    row.dismissed = True
    await db.commit()
    return JSONResponse({"status": "dismissed"})


@router.delete("/messages", status_code=200)
async def dismiss_all_air_messages(db: AsyncSession = Depends(get_db)):
    """Soft-delete all air messages in one query."""
    await db.execute(AirMessage.__table__.update().values(dismissed=True))
    await db.commit()
    return JSONResponse({"status": "cleared"})


# ── Tracking ───────────────────────────────────────────────────────────────────

@router.get("/tracking")
async def list_tracked_aircraft(db: AsyncSession = Depends(get_db)):
    """Return all currently tracked aircraft, most recently added first."""
    result = await db.execute(select(AirTracking).order_by(AirTracking.added_at.desc()))
    rows = result.scalars().all()
    return JSONResponse([
        {"hex": r.hex, "callsign": r.callsign, "follow": r.follow, "added_at": r.added_at}
        for r in rows
    ])


@router.post("/tracking", status_code=201)
async def add_tracked_aircraft(body: TrackingIn, db: AsyncSession = Depends(get_db)):
    """Add an aircraft to tracking, or update callsign/follow if it is already tracked."""
    result = await db.execute(select(AirTracking).where(AirTracking.hex == body.hex))
    row = result.scalar_one_or_none()

    if row:
        # Aircraft already tracked — update mutable fields only
        row.callsign = body.callsign
        row.follow   = body.follow
        await db.commit()
        return JSONResponse({"status": "updated"}, status_code=200)

    db.add(AirTracking(
        hex=body.hex,
        callsign=body.callsign,
        follow=body.follow,
        added_at=now_ms(),
    ))
    await db.commit()
    return JSONResponse({"status": "created"}, status_code=201)


@router.delete("/tracking/{hex}", status_code=200)
async def remove_tracked_aircraft(hex: str, db: AsyncSession = Depends(get_db)):
    """Remove an aircraft from tracking by ICAO hex. Returns 404 if not currently tracked."""
    result = await db.execute(select(AirTracking).where(AirTracking.hex == hex))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Aircraft not tracked")
    await db.delete(row)
    await db.commit()
    return JSONResponse({"status": "removed"})
