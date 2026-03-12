import httpx

from backend.config import settings


async def fetch_aircraft_from_upstream(lat: float, lon: float, radius: int) -> dict:
    """Fetch live aircraft data from the airplanes.live /v2/point endpoint.

    Args:
        lat: Centre latitude of the search area.
        lon: Centre longitude of the search area.
        radius: Search radius in nautical miles.

    Returns:
        Raw JSON dict from the API, shape: {"ac": [...], ...}

    Raises:
        httpx.HTTPError: If the upstream request fails or returns a non-2xx status.
    """
    url = f"{settings.adsb_upstream_base}/point/{lat}/{lon}/{radius}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            url,
            headers={
                "User-Agent": "SENTINEL/1.0",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()  # raises HTTPStatusError on 4xx/5xx
        return response.json()


# Keep original name as alias so air.py router import doesn't break
fetch_aircraft = fetch_aircraft_from_upstream
