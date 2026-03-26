import httpx


async def fetch_aircraft(lat: float, lon: float, radius: int, base_url: str) -> dict:
    """Fetch live aircraft data from the configured ADS-B upstream endpoint.

    Args:
        lat: Centre latitude of the search area.
        lon: Centre longitude of the search area.
        radius: Search radius in nautical miles.
        base_url: Base URL for the ADS-B API (read from user settings).

    Returns:
        Raw JSON dict from the API, shape: {"ac": [...], ...}

    Raises:
        httpx.HTTPError: If the upstream request fails or returns a non-2xx status.
    """
    url = f"{base_url}/point/{lat}/{lon}/{radius}"
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
