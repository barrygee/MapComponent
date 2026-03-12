"""
Sea domain router — AIS vessel tracking, port data, maritime zones.

Future endpoints (when data sources are identified):
  GET /api/sea/vessels       — Live AIS vessel positions (e.g. aisstream.io, MarineTraffic)
  GET /api/sea/ports         — UK port metadata
  GET /api/sea/zones         — Maritime exclusion/traffic zones
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/sea", tags=["sea"])


@router.get("/status")
async def sea_status():
    """Placeholder — sea domain not yet implemented."""
    return JSONResponse({"status": "not_implemented", "domain": "sea"})
