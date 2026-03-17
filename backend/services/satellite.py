"""
Satellite position and ground track computation using SGP4.

Uses the sgp4 library to propagate TLE data forward/backward in time.
All outputs use [longitude, latitude] coordinate order (GeoJSON convention).
"""

import math
from datetime import datetime, timedelta, timezone

from sgp4.api import Satrec, jday


# Earth radius in km
_RE_KM = 6371.0


def _jday_now() -> tuple[int, float]:
    """Return the current Julian date as (jd_int, jd_frac)."""
    now = datetime.now(timezone.utc)
    jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second + now.microsecond / 1e6)
    return jd, fr


def _eci_to_geodetic(r_km: list[float], t: datetime | None = None) -> tuple[float, float, float]:
    """Convert ECI position vector (km) to geodetic lat/lon/alt.

    Returns (latitude_deg, longitude_deg, altitude_km).
    Uses a simplified spherical Earth model — sufficient for display purposes.
    """
    if t is None:
        t = datetime.now(timezone.utc)
    # Greenwich Mean Sidereal Time (radians) — simple approximation
    j2000 = (t.replace(tzinfo=None) - datetime(2000, 1, 1, 12, 0, 0)).total_seconds() / 86400.0
    gmst = math.fmod(280.46061837 + 360.98564736629 * j2000, 360.0)
    gmst_rad = math.radians(gmst)

    x, y, z = r_km
    lon_rad = math.atan2(y, x) - gmst_rad
    lon_deg = math.degrees(lon_rad)
    # Normalise to -180..180
    while lon_deg > 180:
        lon_deg -= 360
    while lon_deg < -180:
        lon_deg += 360

    r_xy = math.sqrt(x * x + y * y)
    lat_deg = math.degrees(math.atan2(z, r_xy))
    alt_km = math.sqrt(x * x + y * y + z * z) - _RE_KM
    return lat_deg, lon_deg, alt_km


def _propagate_at(sat: Satrec, jd: int, fr: float) -> tuple[list[float], list[float]] | None:
    """Propagate satellite to given Julian date. Returns (r_km, v_km_s) or None on error."""
    e, r, v = sat.sgp4(jd, fr)
    if e != 0:
        return None
    return list(r), list(v)


def compute_position(tle_line1: str, tle_line2: str) -> dict:
    """Compute the current ISS position.

    Returns:
      lat        — latitude in degrees
      lon        — longitude in degrees
      alt_km     — altitude in kilometres
      velocity_kms — speed in km/s
      track_deg  — heading in degrees (0=north, clockwise)
    """
    sat = Satrec.twoline2rv(tle_line1, tle_line2)
    jd, fr = _jday_now()

    result = _propagate_at(sat, jd, fr)
    if result is None:
        raise RuntimeError("SGP4 propagation error at current time")

    r, v = result
    now = datetime.now(timezone.utc)
    lat, lon, alt_km = _eci_to_geodetic(r, now)
    velocity_kms = math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)

    # Compute heading: propagate 10 seconds ahead for bearing estimate
    fr2 = fr + 10.0 / 86400.0  # +10 seconds in fractional days
    result2 = _propagate_at(sat, jd, fr2)
    track_deg = 0.0
    if result2:
        r2, _ = result2
        lat2, lon2, _ = _eci_to_geodetic(r2, now + timedelta(seconds=10))
        d_lat = math.radians(lat2 - lat)
        d_lon = math.radians(lon2 - lon)
        lat_r = math.radians(lat)
        lat2_r = math.radians(lat2)
        x = math.sin(d_lon) * math.cos(lat2_r)
        y = math.cos(lat_r) * math.sin(lat2_r) - math.sin(lat_r) * math.cos(lat2_r) * math.cos(d_lon)
        track_deg = (math.degrees(math.atan2(x, y)) + 360) % 360

    return {
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "alt_km": round(alt_km, 1),
        "velocity_kms": round(velocity_kms, 3),
        "track_deg": round(track_deg, 1),
    }


def compute_ground_track(tle_line1: str, tle_line2: str) -> dict:
    """Compute current and next orbit as a GeoJSON FeatureCollection.

    ISS orbital period ~92 minutes, so:
      - orbit1:   0..92   minutes  → properties.track = 'orbit1'  (current orbit)
      - orbit2:  92..184  minutes  → properties.track = 'orbit2'  (next orbit)

    Splits LineStrings at the antimeridian (±180°) to avoid map wrapping artefacts.
    """
    sat = Satrec.twoline2rv(tle_line1, tle_line2)
    jd, fr = _jday_now()
    now = datetime.now(timezone.utc)

    features = []

    for track_type, start_min, end_min in [
        ("orbit1",   0,  92),
        ("orbit2",  92, 184),
    ]:
        segments: list[list[list[float]]] = []
        current_segment: list[list[float]] = []
        prev_lon: float | None = None

        for minute in range(start_min, end_min + 1):
            offset_days = minute / 1440.0
            jd_t = jd
            fr_t = fr + offset_days
            # Handle fractional day overflow
            if fr_t >= 1.0:
                jd_t += int(fr_t)
                fr_t = fr_t % 1.0
            elif fr_t < 0.0:
                extra = int(abs(fr_t)) + 1
                jd_t -= extra
                fr_t += extra

            result = _propagate_at(sat, jd_t, fr_t)
            if result is None:
                continue

            r, _ = result
            t_propagated = now + timedelta(minutes=minute)
            lat, lon, _ = _eci_to_geodetic(r, t_propagated)

            # Detect antimeridian crossing (longitude jump > 180°)
            if prev_lon is not None and abs(lon - prev_lon) > 180:
                if current_segment:
                    segments.append(current_segment)
                current_segment = []

            current_segment.append([round(lon, 4), round(lat, 4)])
            prev_lon = lon

        if current_segment:
            segments.append(current_segment)

        for seg in segments:
            if len(seg) < 2:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": seg},
                "properties": {"track": track_type},
            })

    return {"type": "FeatureCollection", "features": features}


def compute_footprint(lat: float, lon: float, alt_km: float) -> list[list[float]]:
    """Compute the ISS visibility footprint (horizon circle) as a list of [lon, lat] points.

    The footprint radius is determined by the satellite altitude:
      radius_rad = arccos(Re / (Re + alt_km))
    Returns 181 points forming a closed great-circle ring.
    """
    radius_rad = math.acos(_RE_KM / (_RE_KM + alt_km))
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)

    points = []
    for i in range(181):
        bearing_rad = math.radians(i * 2)
        lat2 = math.asin(
            math.sin(lat_rad) * math.cos(radius_rad) +
            math.cos(lat_rad) * math.sin(radius_rad) * math.cos(bearing_rad)
        )
        lon2 = lon_rad + math.atan2(
            math.sin(bearing_rad) * math.sin(radius_rad) * math.cos(lat_rad),
            math.cos(radius_rad) - math.sin(lat_rad) * math.sin(lat2)
        )
        points.append([round(math.degrees(lon2), 4), round(math.degrees(lat2), 4)])

    return points
