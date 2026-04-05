from sqlalchemy import Boolean, Column, Float, Integer, Text, UniqueConstraint

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


class TleCache(Base):
    """Cached TLE text fetched from Celestrak or entered manually.

    cache_key is the NORAD catalogue number as a string (e.g. '25544').
    payload stores the raw three-line element text (name + TLE1 + TLE2).
    source indicates how this entry arrived: 'online', 'url', 'upload', or 'manual'.
    Manual/upload/url entries have a far-future expires_at and are not auto-refreshed.
    """
    __tablename__ = "tle_cache"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    cache_key  = Column(Text, nullable=False, unique=True)  # NORAD ID e.g. "25544"
    payload    = Column(Text, nullable=False)               # raw 3-line TLE text
    source     = Column(Text, nullable=False, default="online")  # 'online'|'url'|'upload'|'manual'
    fetched_at = Column(Integer, nullable=False)            # Unix ms when fetched/entered
    expires_at = Column(Integer, nullable=False)            # fetched_at + TTL_MS (or far-future for manual)


class SatelliteCatalogue(Base):
    """Permanent identity record for known satellites.

    One row per NORAD ID. Stores the satellite name and category independently
    of TLE orbital data. Records are never deleted by TLE imports — only by an
    explicit clear. Category is preserved across TLE updates and only overwritten
    by a higher-priority source (celestrak_group > user > inferred > active).
    """
    __tablename__ = "satellite_catalogue"

    norad_id        = Column(Text, primary_key=True)   # NORAD catalogue number e.g. "25544"
    name            = Column(Text, nullable=False)      # e.g. "ISS (ZARYA)"
    category        = Column(Text, nullable=True)       # 'space_station'|'amateur'|'weather'|
                                                        # 'military'|'navigation'|'science'|
                                                        # 'cubesat'|'active'|'unknown'|NULL
    category_source = Column(Text, nullable=True)       # 'celestrak_group'|'user'|'active'|NULL
    name_source     = Column(Text, nullable=True)       # NULL | 'user' — 'user' locks name against TLE updates
    updated_at      = Column(Integer, nullable=False)   # Unix ms of last TLE update for this sat


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



class SdrRadio(Base):
    """A configured SDR device reachable via rtl_tcp on the network."""
    __tablename__ = "sdr_radios"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(Text, nullable=False)               # user label e.g. "Roof RTL-SDR"
    host        = Column(Text, nullable=False)               # hostname or IP e.g. "192.168.1.45"
    port        = Column(Integer, nullable=False, default=1234)
    description = Column(Text, nullable=False, default="")
    enabled     = Column(Boolean, nullable=False, default=True)
    bandwidth   = Column(Integer,  nullable=True, default=None)  # Hz sample rate; None = rtl_tcp default
    rf_gain     = Column(Float,    nullable=True, default=None)  # dB; None = use panel default
    agc         = Column(Boolean,  nullable=True, default=None)  # None = not overridden
    created_at  = Column(Integer, nullable=False)            # Unix ms


class SdrFrequencyGroup(Base):
    """Named group that organises stored frequencies (e.g. 'Aviation', 'Marine')."""
    __tablename__ = "sdr_frequency_groups"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    name       = Column(Text, nullable=False)
    color      = Column(Text, nullable=False, default="#c8ff00")
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)             # Unix ms


class SdrStoredFrequency(Base):
    """An individual saved frequency (bookmark) with tuning parameters."""
    __tablename__ = "sdr_stored_frequencies"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    group_id     = Column(Integer, nullable=True)            # FK → sdr_frequency_groups.id (nullable = ungrouped)
    label        = Column(Text, nullable=False)              # e.g. "ATIS 118.05"
    frequency_hz = Column(Integer, nullable=False)           # stored as integer Hz e.g. 118050000
    mode         = Column(Text, nullable=False, default="AM")  # AM|NFM|WFM|USB|LSB|CW
    squelch      = Column(Float, nullable=False, default=-60.0)  # dBFS threshold
    gain         = Column(Float, nullable=False, default=30.0)   # dB; use -1.0 for auto
    scannable    = Column(Boolean, nullable=False, default=True)
    notes        = Column(Text, nullable=False, default="")
    created_at   = Column(Integer, nullable=False)           # Unix ms


class UserSettings(Base):
    """User preferences and overlay toggle states, persisted across browser sessions.

    Keyed by (namespace, key) — e.g. ('air', 'overlayStates') or ('app', 'theme').
    value is stored as a JSON string to support booleans, strings, and objects.
    """
    __tablename__ = "user_settings"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    namespace  = Column(Text, nullable=False)   # 'app' | 'air' | 'space' | 'sea' | 'land' | 'sdr'
    key        = Column(Text, nullable=False)   # e.g. 'theme', 'overlayStates', 'spaceOverlayStates'
    value      = Column(Text, nullable=False)   # JSON-serialised value
    updated_at = Column(Integer, nullable=False)  # Unix ms

    __table_args__ = (UniqueConstraint('namespace', 'key', name='uq_user_settings_ns_key'),)
