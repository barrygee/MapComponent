from sqlalchemy import Boolean, Column, Float, Integer, Text

from backend.database import Base


class AdsbCache(Base):
    """Cached ADS-B response from airplanes.live.

    Each row stores one bounding-box query result (lat/lon/radius).
    Served fresh within adsb_ttl_ms, or stale within adsb_stale_ms on upstream failure.
    """
    __tablename__ = "adsb_cache"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    cache_key  = Column(Text, nullable=False, unique=True)  # e.g. "54.1453_-4.4815_250"
    lat        = Column(Float, nullable=False)              # query centre latitude
    lon        = Column(Float, nullable=False)              # query centre longitude
    radius_nm  = Column(Integer, nullable=False, default=250)  # search radius in nautical miles
    payload    = Column(Text, nullable=False)               # raw JSON string from airplanes.live
    ac_count   = Column(Integer)                            # number of aircraft in the response
    fetched_at = Column(Integer, nullable=False)            # Unix ms when this row was fetched
    expires_at = Column(Integer, nullable=False)            # fetched_at + TTL_MS


class GeocodeCache(Base):
    """Cached Nominatim reverse-geocode result.

    Keyed at 2 decimal-place precision (roughly 1 km grid) to maximise cache hits
    for nearby positions.
    """
    __tablename__ = "geocode_cache"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    cache_key  = Column(Text, nullable=False, unique=True)  # e.g. "54.14_-4.48"
    lat        = Column(Float, nullable=False)
    lon        = Column(Float, nullable=False)
    raw        = Column(Text, nullable=False)               # full Nominatim JSON string
    fetched_at = Column(Integer, nullable=False)
    expires_at = Column(Integer, nullable=False)


class AirMessage(Base):
    """Air-domain notification message (emergency squawks, system alerts, etc.)."""
    __tablename__ = "air_messages"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    msg_id    = Column(Text, nullable=False, unique=True)  # client-generated unique id
    type      = Column(Text, nullable=False)               # 'emergency'|'flight'|'system'|'squawk-clr' etc.
    title     = Column(Text, nullable=False)               # short headline shown in the panel
    detail    = Column(Text, nullable=False, default="")   # optional secondary text
    ts        = Column(Integer, nullable=False)            # Unix ms timestamp of the event
    dismissed = Column(Boolean, nullable=False, default=False)  # soft-delete flag


class AirTracking(Base):
    """Aircraft currently being tracked by the user (selected in the ADS-B panel)."""
    __tablename__ = "air_tracking"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    hex       = Column(Text, nullable=False, unique=True)  # ICAO 24-bit hex identifier
    callsign  = Column(Text, nullable=False, default="")
    follow    = Column(Boolean, nullable=False, default=False)  # camera-follow mode active
    added_at  = Column(Integer, nullable=False)            # Unix ms when tracking began
