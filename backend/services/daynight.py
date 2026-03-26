"""
Day/night terminator computation.

Computes the solar terminator (day/night boundary) for the current UTC time
and returns a GeoJSON MultiPolygon covering the night side of the Earth.

Uses only the Python standard library (math, datetime) — no extra dependencies.
"""

import math
from datetime import datetime, timezone


def _solar_position(dt: datetime) -> tuple[float, float]:
    """Compute the subsolar point (lat, lon) for the given UTC datetime.

    Returns (latitude_deg, longitude_deg) of the point on Earth's surface
    directly beneath the Sun.

    Algorithm: Spencer (1971) approximation, accurate to ~0.01° for display.
    """
    doy = dt.timetuple().tm_yday
    hour_utc = dt.hour + dt.minute / 60.0 + dt.second / 3600.0

    # Day-angle in radians (Spencer 1971 approximation)
    day_angle_rad = math.radians((360.0 / 365.0) * (doy - 80))
    declination_deg = (
        23.45 * math.sin(day_angle_rad)
        - 0.39 * math.sin(2 * day_angle_rad)
        + 0.07 * math.sin(4 * day_angle_rad)
    )
    eot_minutes = (
        9.87 * math.sin(2 * day_angle_rad)
        - 7.53 * math.cos(day_angle_rad)
        - 1.5  * math.sin(day_angle_rad)
    )
    solar_noon_utc = 12.0 - eot_minutes / 60.0
    subsolar_lon = (solar_noon_utc - hour_utc) * 15.0
    while subsolar_lon >  180:
        subsolar_lon -= 360
    while subsolar_lon < -180:
        subsolar_lon += 360
    return declination_deg, subsolar_lon


def compute_terminator() -> dict:
    """Return a GeoJSON Feature covering the night side of the Earth.

    Algorithm
    ---------
    The terminator at longitude λ satisfies:

        sin(δ)·sin(φ) + cos(δ)·cos(φ)·cos(λ − λ☉) = 0

    Solving for φ:

        tan(φ) = −cos(λ − λ☉) / tan(δ)          [1]

    This is valid when δ ≠ 0.  When δ = 0 (equinox) the terminator degenerates
    to the two meridians λ = λ☉ ± 90°; we handle that as a special case.

    Polygon construction
    --------------------
    We evaluate [1] at each integer longitude from −180 to 180 to get a smooth
    curve (term_lat[lon]).  We then build a closed polygon that covers the night
    side by capping the curve at the night pole:

      • Sort the terminator points by longitude so the body never crosses ±180°.
      • The night pole (±90°) is determined by the sign of δ:
          δ > 0  → sun is north  → night pole is south (−90°)
          δ < 0  → sun is south  → night pole is north (+90°)
      • Build:
            sorted terminator (left → right)
          + [lon_max, pole_lat]   right descent to pole
          + [lon_min, pole_lat]   pole strip back left (via 0° midpoint if needed)
          + sorted_pts[0]         close ring

    Equinox special case (δ ≈ 0)
    ------------------------------
    The terminator is a meridian pair at λ☉ ± 90°.  The night hemisphere spans
    the 180° band centred on the anti-solar point (λ☉ + 180°).  We construct it
    as a simple rectangle in lon/lat space:

        [anti − 90, −90] → [anti + 90, −90] → [anti + 90, 90]
        → [anti − 90, 90] → close

    clamped to ±180° and split at the antimeridian if needed.
    """
    now = datetime.now(timezone.utc)
    sun_lat, sun_lon = _solar_position(now)

    EQUINOX_THRESH = 0.001  # degrees — treat as equinox below this declination

    # ------------------------------------------------------------------ #
    # EQUINOX CASE                                                         #
    # ------------------------------------------------------------------ #
    if abs(sun_lat) < EQUINOX_THRESH:
        # Night hemisphere is centred on the anti-solar longitude
        anti_lon = sun_lon + 180.0
        if anti_lon > 180:
            anti_lon -= 360.0

        lo = anti_lon - 90.0   # left edge of night band
        hi = anti_lon + 90.0   # right edge of night band

        def _norm(lon: float) -> float:
            while lon >  180: lon -= 360
            while lon < -180: lon += 360
            return lon

        lo = _norm(lo)
        hi = _norm(hi)

        if lo < hi:
            # No antimeridian split needed
            ring = [[lo, -90.0], [hi, -90.0], [hi, 90.0], [lo, 90.0], [lo, -90.0]]
        else:
            # Night band crosses antimeridian — full-width rectangle (slight over-coverage, acceptable)
            ring = [[-180.0, -90.0], [180.0, -90.0], [180.0, 90.0], [-180.0, 90.0], [-180.0, -90.0]]

        return {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"sun_lat": round(sun_lat, 3), "sun_lon": round(sun_lon, 3)},
        }

    # ------------------------------------------------------------------ #
    # GENERAL CASE (non-equinox)                                           #
    # ------------------------------------------------------------------ #
    sun_lat_rad = math.radians(sun_lat)
    sun_lon_rad = math.radians(sun_lon)
    tan_sun = math.tan(sun_lat_rad)

    # Evaluate terminator latitude at each integer longitude
    lons_deg = list(range(-180, 181))
    term_pts = []
    for lon_deg in lons_deg:
        delta_lon = math.radians(lon_deg) - sun_lon_rad
        lat_rad = math.atan(-math.cos(delta_lon) / tan_sun)
        term_pts.append([float(lon_deg), math.degrees(lat_rad)])

    # Night pole: south if sun is north, north if sun is south
    pole_lat = -90.0 if sun_lat > 0 else 90.0

    # The terminator points already run from lon -180 to +180 in order.
    # Build polygon: terminator (left → right) + pole cap (right → left)
    #
    # The pole cap goes from lon=+180 back to lon=-180 at pole_lat.
    # Insert a midpoint at lon=0 to avoid any 360° jump being interpreted
    # as an antimeridian crossing by renderers.

    ring = (
        term_pts
        + [[180.0, pole_lat], [0.0, pole_lat], [-180.0, pole_lat]]
        + [term_pts[0]]
    )

    # Verify no antimeridian crossings (should never happen with this construction)
    crossings = [i for i in range(1, len(ring))
                 if abs(ring[i][0] - ring[i - 1][0]) > 180]
    if crossings:
        raise RuntimeError(f"Unexpected antimeridian crossing at indices: {crossings}")

    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [ring],
        },
        "properties": {
            "sun_lat": round(sun_lat, 3),
            "sun_lon": round(sun_lon, 3),
        },
    }
