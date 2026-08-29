from math import asin, cos, radians, sin, sqrt
from urllib.parse import urlsplit

import httpx
from backend.config import settings
from backend.services.upstream_rate_limit import MinimumIntervalRateLimiter

# Process-wide gate on outbound ADS-B traffic. Shared by every caller so the
# wire rate stays within the upstream's published limit regardless of how many
# distinct cache keys (map panes, tabs, clients) expire at the same moment.
_adsb_rate_limiter = MinimumIntervalRateLimiter(settings.adsb_min_request_interval_ms / 1000)


async def fetch_aircraft(lat: float, lon: float, radius: int, base_url: str) -> dict:
    """Fetch live aircraft data from the configured ADS-B upstream endpoint.

    Outbound calls are rate limited per upstream host (see
    `adsb_min_request_interval_ms`); a call that would have to wait too long for
    a free slot is refused locally rather than queued, so the caller can serve
    cached data instead.

    Args:
        lat: Centre latitude of the search area.
        lon: Centre longitude of the search area.
        radius: Search radius in nautical miles.
        base_url: Base URL for the ADS-B API (read from user settings).

    Returns:
        Raw JSON dict from the API, shape: {"ac": [...], ...}

    Raises:
        UpstreamThrottledError: If the local rate limiter refused the call.
        httpx.HTTPError: If the upstream request fails or returns a non-2xx status.
    """
    # Host, not full URL: the limit belongs to the provider, and the same host
    # may be reached through differing base paths.
    upstream_host = urlsplit(base_url).netloc or base_url
    await _adsb_rate_limiter.acquire(
        upstream_host,
        max_wait_seconds=settings.adsb_rate_limit_max_wait_ms / 1000,
    )

    async with httpx.AsyncClient(timeout=10.0) as client:
        if _is_readsb(base_url):
            payload = await _get_json(client, _readsb_url(base_url))
            return _readsb_to_airplanes(payload, lat, lon, radius)
        url = f"{base_url}/point/{lat}/{lon}/{radius}"
        return await _get_json(client, url)


async def _get_json(client: httpx.AsyncClient, url: str) -> dict:
    """GET `url` and return its parsed body, raising on any non-2xx."""
    response = await client.get(
        url,
        headers={
            "User-Agent": "SENTINEL/1.0",
            "Accept": "application/json",
        },
    )
    response.raise_for_status()  # raises HTTPStatusError on 4xx/5xx
    result: dict = response.json()
    return result


def _is_readsb(base_url: str) -> bool:
    """Whether this source is a local readsb/tar1090 rather than the online ADS-B API.

    Keyed on the URL ending in `.json`, or naming readsb's well-known
    `/data/aircraft.json`, because that is the one thing the two sources cannot
    share: the online feed is a query API addressed as
    `/point/{lat}/{lon}/{radius}`, while readsb writes a single static file
    holding everything its aerial can currently hear.

    Deliberately not auto-detected by probing. A probe costs an extra request on
    every cold start, has to cache its answer somewhere, and — worse — guesses
    silently when a source is merely down, so a decoder that was restarting
    would be remembered as the wrong flavour until the process restarted.
    """
    lowered = base_url.lower().rstrip("/")
    return lowered.endswith(".json") or lowered.endswith("/data")


def _readsb_url(base_url: str) -> str:
    """Resolve the aircraft file's URL, accepting either the file or its directory."""
    trimmed = base_url.rstrip("/")
    if trimmed.lower().endswith(".json"):
        return trimmed
    return f"{trimmed}/aircraft.json"


def _readsb_to_airplanes(payload: dict, lat: float, lon: float, radius: int) -> dict:
    """Map readsb's `aircraft.json` onto the v2 shape the app reads.

    The two are closer than they look — the v2 feeds derive their own data from
    readsb, so the per-aircraft fields (`hex`, `flight`, `lat`, `lon`,
    `alt_baro`, `gs`, `track`, `squawk`, `category`, `r`, `t`) already match.
    Two things do not, and both are handled here.

    **The list is named `aircraft`, not `ac`.** Renaming it here rather than
    teaching the frontend a second shape keeps every consumer — map, labels,
    replay, overhead alerts — reading one format.

    **readsb does not filter by radius.** It reports everything its aerial hears,
    which is the whole receiver's range rather than the map pane being asked
    about, so the filter the upstream API would have applied is applied here
    instead. Aircraft with no position yet (heard, but not yet located) are
    dropped: they cannot be plotted, and passing them through would inflate the
    count the UI shows against an empty map.
    """
    aircraft = payload.get("aircraft")
    if not isinstance(aircraft, list):
        aircraft = []

    within_radius = [
        entry for entry in aircraft if isinstance(entry, dict) and _is_within_radius(entry, lat, lon, radius)
    ]

    return {
        "ac": within_radius,
        "total": len(within_radius),
        # readsb reports `now` in seconds; the app's other source reports
        # milliseconds, and a timestamp that silently changes unit between
        # sources would read as data from 1970.
        "now": int(float(payload.get("now", 0)) * 1000),
        "msg": "readsb",
    }


def _is_within_radius(aircraft: dict, lat: float, lon: float, radius_nm: int) -> bool:
    """Whether one readsb aircraft entry sits inside the requested circle."""
    aircraft_lat = aircraft.get("lat")
    aircraft_lon = aircraft.get("lon")
    if not isinstance(aircraft_lat, (int, float)) or not isinstance(aircraft_lon, (int, float)):
        return False
    return _distance_nm(lat, lon, float(aircraft_lat), float(aircraft_lon)) <= radius_nm


def _distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in nautical miles.

    Haversine rather than a flat approximation: an equirectangular shortcut is
    fine near the equator and increasingly wrong towards the poles, and the
    receiver this serves sits at 55°N where the longitude error is already
    large enough to admit or exclude the wrong aircraft at the edge of a pane.
    """
    earth_radius_nm = 3440.065
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)
    haversine = sin(delta_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(delta_lon / 2) ** 2
    return 2 * earth_radius_nm * asin(sqrt(haversine))
