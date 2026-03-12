import httpx

from backend.config import settings


async def reverse_geocode_coordinates(lat: float, lon: float) -> dict:
    """Reverse geocode a lat/lon pair using the Nominatim API.

    Args:
        lat: Latitude to look up.
        lon: Longitude to look up.

    Returns:
        Raw Nominatim JSON dict. Includes `address.country` for the footer label.

    Raises:
        httpx.HTTPError: If the Nominatim request fails or returns a non-2xx status.
    """
    url = f"{settings.nominatim_base}/reverse"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            url,
            params={"format": "json", "lat": lat, "lon": lon},
            headers={
                # Nominatim requires a descriptive User-Agent to identify the application
                "User-Agent": "SENTINEL/1.0 (surveillance map application)",
                "Accept-Language": "en",
            },
        )
        response.raise_for_status()
        return response.json()


# Keep original name as alias so air.py router import doesn't break
reverse_geocode = reverse_geocode_coordinates
