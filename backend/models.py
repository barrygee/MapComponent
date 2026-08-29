from backend.database import Base
from sqlalchemy import Boolean, Column, Float, Integer, Text, UniqueConstraint


class AdsbCache(Base):
    """Cached ADS-B response from the online ADS-B feed.

    Each row stores one bounding-box query result (lat/lon/radius).
    Served fresh within adsb_ttl_ms, or stale within adsb_stale_ms on upstream failure.
    """

    __tablename__ = "adsb_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(Text, nullable=False, unique=True)  # e.g. "54.1453_-4.4815_250"
    lat = Column(Float, nullable=False)  # query centre latitude
    lon = Column(Float, nullable=False)  # query centre longitude
    radius_nm = Column(Integer, nullable=False, default=250)  # search radius in nautical miles
    payload = Column(Text, nullable=False)  # raw JSON string from the upstream feed
    ac_count = Column(Integer)  # number of aircraft in the response
    fetched_at = Column(Integer, nullable=False)  # Unix ms when this row was fetched
    expires_at = Column(Integer, nullable=False)  # fetched_at + TTL_MS


class TleCache(Base):
    """Cached TLE text fetched from Celestrak or entered manually.

    cache_key is the NORAD catalogue number as a string (e.g. '25544').
    payload stores the raw three-line element text (name + TLE1 + TLE2).
    source indicates how this entry arrived: 'online', 'url', 'upload', or 'manual'.
    Manual/upload/url entries have a far-future expires_at and are not auto-refreshed.
    """

    __tablename__ = "tle_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(Text, nullable=False, unique=True)  # NORAD ID e.g. "25544"
    payload = Column(Text, nullable=False)  # raw 3-line TLE text
    source = Column(Text, nullable=False, default="online")  # 'online'|'url'|'upload'|'manual'
    fetched_at = Column(Integer, nullable=False)  # Unix ms when fetched/entered
    expires_at = Column(Integer, nullable=False)  # fetched_at + TTL_MS (or far-future for manual)


class SatelliteCatalogue(Base):
    """Permanent identity record for known satellites.

    One row per NORAD ID. Stores the satellite name and category independently
    of TLE orbital data. Records are never deleted by TLE imports — only by an
    explicit clear. Category is preserved across TLE updates and only overwritten
    by a higher-priority source (celestrak_group > user > inferred > active).
    """

    __tablename__ = "satellite_catalogue"

    norad_id = Column(Text, primary_key=True)  # NORAD catalogue number e.g. "25544"
    name = Column(Text, nullable=False)  # e.g. "ISS (ZARYA)"
    category = Column(Text, nullable=True)  # 'space_station'|'amateur'|'weather'|
    # 'military'|'navigation'|'science'|
    # 'cubesat'|'active'|'unknown'|NULL
    category_source = Column(Text, nullable=True)  # 'celestrak_group'|'user'|'active'|NULL
    name_source = Column(Text, nullable=True)  # NULL | 'user' — 'user' locks name against TLE updates
    updated_at = Column(Integer, nullable=False)  # Unix ms of last TLE update for this sat
    # Radio info — used for amateur satellites, but the columns are generic and any sat may have them.
    # Frequencies stored as integer Hz. Modes are free text (FM|SSB|CW|FSK|GMSK|APRS|SSTV|DIGITAL etc.).
    uplink_hz = Column(Integer, nullable=True)  # uplink frequency in Hz, or NULL
    uplink_mode = Column(Text, nullable=True)  # uplink modulation e.g. "FM"
    downlink_hz = Column(Integer, nullable=True)  # downlink frequency in Hz, or NULL
    downlink_mode = Column(Text, nullable=True)  # downlink modulation e.g. "FM"
    ctcss_hz = Column(
        Float, nullable=True
    )  # CTCSS sub-audible tone in Hz (e.g. 67.0), if required to access an FM repeater
    transponder_type = Column(Text, nullable=True)  # 'FM'|'Linear'|'Digital'|'SSTV'|'Telemetry'|'APRS' etc.
    beacon_hz = Column(Integer, nullable=True)  # beacon frequency in Hz (often CW or telemetry), or NULL
    packet_info = Column(Text, nullable=True)  # short free text describing packet/APRS/digital details
    radio_status = Column(
        Text, nullable=True
    )  # 'active'|'inactive'|'silent'|'reentered'|'partial' — operational status of the radio payload
    radio_notes = Column(Text, nullable=True)  # free-form notes / description for the radio payload


class AirMessage(Base):
    """Air-domain notification message (emergency squawks, system alerts, etc.)."""

    __tablename__ = "air_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    msg_id = Column(Text, nullable=False, unique=True)  # client-generated unique id
    type = Column(Text, nullable=False)  # 'emergency'|'flight'|'system'|'squawk-clr' etc.
    title = Column(Text, nullable=False)  # short headline shown in the panel
    detail = Column(Text, nullable=False, default="")  # optional secondary text
    ts = Column(Integer, nullable=False)  # Unix ms timestamp of the event
    dismissed = Column(Boolean, nullable=False, default=False)  # soft-delete flag


class AirTracking(Base):
    """Aircraft currently being tracked by the user (selected in the ADS-B panel)."""

    __tablename__ = "air_tracking"

    id = Column(Integer, primary_key=True, autoincrement=True)
    hex = Column(Text, nullable=False, unique=True)  # ICAO 24-bit hex identifier
    callsign = Column(Text, nullable=False, default="")
    follow = Column(Boolean, nullable=False, default=False)  # camera-follow mode active
    added_at = Column(Integer, nullable=False)  # Unix ms when tracking began


class SdrRadio(Base):
    """A configured SDR device reachable via rtl_tcp on the network."""

    __tablename__ = "sdr_radios"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)  # user label e.g. "Roof RTL-SDR"
    host = Column(Text, nullable=False)  # hostname or IP e.g. "192.168.1.45"
    port = Column(Integer, nullable=False, default=1234)
    description = Column(Text, nullable=False, default="")
    enabled = Column(Boolean, nullable=False, default=True)
    bandwidth = Column(Integer, nullable=True, default=None)  # Hz sample rate; None = rtl_tcp default
    rf_gain = Column(Float, nullable=True, default=None)  # dB; None = use panel default
    agc = Column(Boolean, nullable=True, default=None)  # None = not overridden
    created_at = Column(Integer, nullable=False)  # Unix ms


class SdrFrequencyGroup(Base):
    """Named group that organises stored frequencies (e.g. 'Aviation', 'Marine')."""

    __tablename__ = "sdr_frequency_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    slug = Column(Text, nullable=False, default="")  # rename-stable key, e.g. "air-to-air-refueling"
    color = Column(Text, nullable=False, default="#c8ff00")
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)  # Unix ms


class SdrStoredFrequency(Base):
    """An individual saved frequency (bookmark) with tuning parameters."""

    __tablename__ = "sdr_stored_frequencies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, nullable=True)  # FK → sdr_frequency_groups.id (nullable = ungrouped)
    label = Column(Text, nullable=False)  # e.g. "ATIS 118.05"
    frequency_hz = Column(Integer, nullable=False)  # stored as integer Hz e.g. 118050000
    mode = Column(Text, nullable=False, default="AM")  # AM|NFM|WFM|USB|LSB|CW
    squelch = Column(Float, nullable=False, default=-60.0)  # dBFS threshold
    gain = Column(Float, nullable=False, default=30.0)  # dB RF gain; use -1.0 for auto (AGC)
    # Per-frequency tuning settings, applied when the user clicks the frequency
    # or a scan stops on it. bandwidth/sample_rate are nullable so an unset value
    # falls back to the live/per-mode default; the rest carry concrete defaults.
    bandwidth = Column(
        Integer, nullable=True, default=None
    )  # demod (audio filter) bandwidth Hz; None = per-mode default
    sample_rate = Column(Integer, nullable=True, default=None)  # device sample rate Hz; None = keep current
    volume = Column(Integer, nullable=False, default=80)  # audio volume 0-100 (%)
    zoom = Column(Float, nullable=False, default=1.0)  # waterfall zoom factor
    zmin = Column(Float, nullable=False, default=0.0)  # waterfall Min dB (0 = auto/unset)
    zmax = Column(Float, nullable=False, default=0.0)  # waterfall Max dB (0 = auto/unset)
    scannable = Column(Boolean, nullable=False, default=True)
    favourite = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=False, default="")
    created_at = Column(Integer, nullable=False)  # Unix ms


class SdrFrequencyGroupLink(Base):
    """Junction table — many-to-many between stored frequencies and groups."""

    __tablename__ = "sdr_frequency_group_links"

    frequency_id = Column(Integer, primary_key=True)
    group_id = Column(Integer, primary_key=True)


class SdrSearchRange(Base):
    """A named low/high frequency range with a step size, used by the SDR
    Search feature to sweep a band and stop on signals."""

    __tablename__ = "sdr_search_ranges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    label = Column(Text, nullable=False)  # e.g. "Air Band"
    low_hz = Column(Integer, nullable=False)  # inclusive sweep start
    high_hz = Column(Integer, nullable=False)  # inclusive sweep end
    step_hz = Column(Integer, nullable=False, default=12500)  # channel spacing
    mode = Column(Text, nullable=False, default="NFM")  # AM|NFM|WFM|USB|LSB|CW
    threshold_dbfs = Column(Float, nullable=False, default=-35.0)  # stop-on-signal threshold
    dwell_ms = Column(Integer, nullable=False, default=250)  # ms per step
    band_name = Column(Text, nullable=False, default="")  # optional sdr.bandPlan ref
    enabled = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=False, default="")
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)  # Unix ms


class SdrRecording(Base):
    """A recorded audio clip captured from the SDR demodulator."""

    __tablename__ = "sdr_recordings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    notes = Column(Text, nullable=False, default="")
    radio_id = Column(Integer, nullable=True)
    radio_name = Column(Text, nullable=False, default="")
    frequency_hz = Column(Integer, nullable=False)
    mode = Column(Text, nullable=False, default="AM")
    gain_db = Column(Float, nullable=False, default=30.0)
    squelch_dbfs = Column(Float, nullable=False, default=-60.0)
    sample_rate = Column(Integer, nullable=False, default=2048000)
    started_at = Column(Text, nullable=False)  # ISO-8601 UTC e.g. "2026-04-06T12:34:56Z"
    ended_at = Column(Text, nullable=False, default="")
    duration_s = Column(Float, nullable=False, default=0.0)
    file_size_bytes = Column(Integer, nullable=False, default=0)
    has_iq_file = Column(Boolean, nullable=False, default=False)
    iq_file_size_bytes = Column(Integer, nullable=False, default=0)
    status = Column(Text, nullable=False, default="recording")  # "recording"|"complete"|"error"
    created_at = Column(Integer, nullable=False)  # Unix ms


class AirAircraft(Base):
    """Identity registry for observed aircraft, keyed by registration (tail number).

    Uses the ADS-B 'r' field as the primary key; falls back to ICAO hex when 'r' is absent.
    Persists across sessions so history accumulates even when an aircraft reappears later.
    """

    __tablename__ = "air_aircraft"

    id = Column(Integer, primary_key=True, autoincrement=True)
    registration = Column(Text, nullable=False, unique=True)  # 'r' field or 'hex' as fallback
    hex = Column(Text, nullable=False, default="")  # most recent ICAO hex seen
    type_code = Column(Text, nullable=False, default="")  # most recent 't' field
    callsign = Column(Text, nullable=False, default="")  # most recent callsign seen
    first_seen = Column(Integer, nullable=False)  # Unix ms
    last_seen = Column(Integer, nullable=False)  # Unix ms
    flight_count = Column(Integer, nullable=False, default=0)


class AirFlight(Base):
    """A continuous flight session for one aircraft.

    A new row is created when the aircraft reappears after a gap of FLIGHT_GAP_MS.
    """

    __tablename__ = "air_flights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    aircraft_id = Column(Integer, nullable=False)  # FK → air_aircraft.id
    registration = Column(Text, nullable=False)  # denormalised for fast lookup
    callsign = Column(Text, nullable=False, default="")
    started_at = Column(Integer, nullable=False)  # Unix ms of first snapshot
    last_active_at = Column(Integer, nullable=False)  # Unix ms of most recent observation
    snapshot_count = Column(Integer, nullable=False, default=0)


class AirSnapshot(Base):
    """Time-series position record for one aircraft at one point in time."""

    __tablename__ = "air_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    flight_id = Column(Integer, nullable=False)  # FK → air_flights.id
    ts = Column(Integer, nullable=False)  # Unix ms
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    alt_baro = Column(Integer, nullable=True)  # ft; NULL when on ground
    gs = Column(Float, nullable=True)  # knots
    track = Column(Float, nullable=True)  # degrees
    baro_rate = Column(Integer, nullable=True)  # ft/min
    squawk = Column(Text, nullable=True)


class UserSettings(Base):
    """User preferences and overlay toggle states, persisted across browser sessions.

    Keyed by (namespace, key) — e.g. ('air', 'overlayStates') or ('app', 'theme').
    value is stored as a JSON string to support booleans, strings, and objects.
    """

    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    namespace = Column(Text, nullable=False)  # 'app' | 'air' | 'space' | 'sea' | 'land' | 'sdr'
    key = Column(Text, nullable=False)  # e.g. 'theme', 'overlayStates', 'spaceOverlayStates'
    value = Column(Text, nullable=False)  # JSON-serialised value
    updated_at = Column(Integer, nullable=False)  # Unix ms

    __table_args__ = (UniqueConstraint("namespace", "key", name="uq_user_settings_ns_key"),)


class SentryHost(Base):
    """A Sentry instance (Raspberry Pi running rtl_tcp dongles) Sentinel knows about.

    Per ADR-0009, Sentry stays the source of truth for device configuration;
    this row holds only what is genuinely Sentinel's own — how to reach one
    Sentry host and its bearer token — plus a small amount of poll telemetry.
    Device state itself is never persisted here; it is cached in memory by
    ``backend.services.sentry_fleet`` and always read live through the client.
    """

    __tablename__ = "sentry_hosts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=True)  # operator label; falls back to `address` when unset
    address = Column(Text, nullable=False)  # hostname or IPv4 address of the Pi
    port = Column(Integer, nullable=False, default=8000)
    auth_token = Column(Text, nullable=False, default="")  # Sentry's bearer token — write-only over the API
    enabled = Column(Boolean, nullable=False, default=True)  # whether the fleet poller polls this host
    created_at = Column(Integer, nullable=False)  # Unix ms
    last_seen_at = Column(Integer, nullable=True)  # Unix ms of the last successful poll
    last_error = Column(Text, nullable=True)  # human-readable reason for the last poll failure, if any

    __table_args__ = (UniqueConstraint("address", "port", name="uq_sentry_hosts_address_port"),)


class AprsStation(Base):
    """Latest known position/status of an APRS station heard via the Land decoder.

    One row per station callsign (upserted on each received position packet), so
    the Land map plots the most recent fix for each station. Rows older than
    ``aprs_station_ttl_ms`` are removed by the periodic cleanup sweep.
    """

    __tablename__ = "aprs_stations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    callsign = Column(Text, nullable=False, unique=True)  # e.g. "M0ABC-9" — station identity
    latitude = Column(Float, nullable=False)  # decimal degrees N
    longitude = Column(Float, nullable=False)  # decimal degrees E
    symbol = Column(Text)  # APRS symbol code (table + code, e.g. "/>") if present
    comment = Column(Text)  # free-text status/comment field
    course = Column(Float)  # course over ground in degrees, if present
    speed = Column(Float)  # speed in knots, if present
    altitude = Column(Float)  # altitude in feet, if present
    path = Column(Text)  # digipeater path, e.g. "WIDE1-1,WIDE2-1"
    raw = Column(Text)  # the raw TNC2 packet the fix was parsed from
    last_heard_ms = Column(Integer, nullable=False)  # Unix ms this station was last heard
