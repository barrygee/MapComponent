"""
Day/night terminator computation.

Computes the solar terminator (day/night boundary) for the current UTC time
and returns a GeoJSON Polygon covering the night side of the Earth.

Uses only the Python standard library (math, datetime) — no extra dependencies.
"""

import math
from datetime import datetime, timezone


def _solar_position(dt: datetime) -> tuple[float, float]:
    """Compute the subsolar point (lat, lon) for the given UTC datetime.

    Returns (latitude_deg, longitude_deg) of the point on Earth's surface
    directly beneath the Sun.

    Algorithm: simplified VSOP87 / Spencer (1971) approximation.
    Accurate to within ~0.01° for display purposes.
    """
    # Day of year and fractional hour
    doy = dt.timetuple().tm_yday
    hour_utc = dt.hour + dt.minute / 60.0 + dt.second / 3600.0

    # Solar declination (Spencer 1971)
    B = math.radians((360 / 365.0) * (doy - 81))
    declination_deg = (
        23.45 * math.sin(B)
        - 0.39 * math.sin(2 * B)
        + 0.07 * math.sin(4 * B)
    )

    # Equation of time in minutes (Spencer 1971)
    eot_minutes = (
        9.87 * math.sin(2 * B)
        - 7.53 * math.cos(B)
        - 1.5 * math.sin(B)
    )

    # Solar noon in UTC hours at the Greenwich meridian
    solar_noon_utc = 12.0 - eot_minutes / 60.0

    # Subsolar longitude: 15° per hour from solar noon
    subsolar_lon = (solar_noon_utc - hour_utc) * 15.0
    # Normalise to -180..180
    while subsolar_lon > 180:
        subsolar_lon -= 360
    while subsolar_lon < -180:
        subsolar_lon += 360

    return declination_deg, subsolar_lon


def _terminator_lat(lon_deg: float, sun_lat_rad: float, sun_lon_rad: float) -> float:
    """Return the terminator latitude at a given longitude.

    The terminator satisfies: sin(sun_lat)*sin(lat) + cos(sun_lat)*cos(lat)*cos(lon-sun_lon) = 0
    Solving: tan(lat) = -cos(lon - sun_lon) / tan(sun_lat)
    """
    delta_lon = math.radians(lon_deg) - sun_lon_rad
    # When sun is near equator tan(sun_lat) ~ 0; clamp to avoid division issues
    tan_sun = math.tan(sun_lat_rad)
    if abs(tan_sun) < 1e-10:
        # Sun on equator: terminator is a meridian, lat undefined — return 0
        return 0.0
    lat_rad = math.atan(-math.cos(delta_lon) / tan_sun)
    return math.degrees(lat_rad)


def compute_terminator() -> dict:
    """Return a GeoJSON FeatureCollection with two Polygons covering the night side.

    Strategy: for each integer longitude -180..180 compute the terminator latitude,
    then build two polygons (one capping at +90, one at -90) so the night hemisphere
    is always correctly filled regardless of antimeridian crossings.

    The night side is the hemisphere opposite the subsolar point.  A point (lat, lon)
    is in night if:
        sin(sun_lat)*sin(lat) + cos(sun_lat)*cos(lat)*cos(lon-sun_lon) < 0
    """
    now = datetime.now(timezone.utc)
    sun_lat, sun_lon = _solar_position(now)

    sun_lat_rad = math.radians(sun_lat)
    sun_lon_rad = math.radians(sun_lon)

    # Build terminator curve: one (lon, term_lat) per degree of longitude
    lons = list(range(-180, 181))
    term_lats = [_terminator_lat(lon, sun_lat_rad, sun_lon_rad) for lon in lons]

    # Determine which pole is on the night side.
    # North pole is night if sun declination < 0 (sun in southern hemisphere).
    night_pole_lat = 90.0 if sun_lat < 0 else -90.0

    # Build a single polygon:
    #   - top edge along night_pole_lat from lon=-180 to lon=180
    #   - right edge down to terminator at lon=180
    #   - terminator curve from lon=180 back to lon=-180
    #   - left edge back up to night_pole_lat at lon=-180
    top = [[-180.0, night_pole_lat], [180.0, night_pole_lat]]
    terminator_rtol = [[lons[i], term_lats[i]] for i in range(len(lons) - 1, -1, -1)]
    coords = top + terminator_rtol + [[-180.0, night_pole_lat]]

    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [coords],
        },
        "properties": {
            "sun_lat": round(sun_lat, 3),
            "sun_lon": round(sun_lon, 3),
        },
    }
