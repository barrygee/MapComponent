import json
import time
from pathlib import Path

from backend.config import settings
from sqlalchemy import and_, event, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Path to the bundled default config — used to seed the DB on first startup.
_CONFIG_PATH = Path(__file__).parent / "default_config.json"

# Async SQLAlchemy engine backed by SQLite via aiosqlite
engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},  # required for SQLite async usage
)


# SQLite serialises writes on a single file lock. Concurrent endpoints (e.g.
# multiple ADS-B cache upserts plus a background flight-history writer) can
# collide and raise "database is locked" — surfaced as a 500. WAL lets readers
# proceed during writes, and busy_timeout makes new writers wait up to N ms for
# the lock instead of failing immediately.
@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover — driver-level hook
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


# Session factory used by all request handlers via Depends(get_db)
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep objects usable after commit without a new query
)


class Base(DeclarativeBase):
    """Declarative base class — all ORM models inherit from this."""

    pass


async def create_tables():
    """Create all database tables on startup if they do not already exist."""
    async with engine.begin() as conn:
        from backend import models  # noqa: F401 — import triggers model registration with Base

        await conn.run_sync(Base.metadata.create_all)
        # Add name_source column to satellite_catalogue if it doesn't exist yet
        # (SQLite create_all does not add new columns to existing tables)
        try:
            await conn.execute(sa_text("ALTER TABLE satellite_catalogue ADD COLUMN name_source TEXT"))
        except OperationalError:
            # Column already exists — raised by SQLite on duplicate ALTER TABLE
            pass
        for col_sql in [
            "ALTER TABLE sdr_radios ADD COLUMN bandwidth INTEGER",
            "ALTER TABLE sdr_radios ADD COLUMN rf_gain REAL",
            "ALTER TABLE sdr_radios ADD COLUMN agc INTEGER",
            "ALTER TABLE air_aircraft ADD COLUMN callsign TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE sdr_frequency_groups ADD COLUMN slug TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE satellite_catalogue ADD COLUMN uplink_hz INTEGER",
            "ALTER TABLE satellite_catalogue ADD COLUMN uplink_mode TEXT",
            "ALTER TABLE satellite_catalogue ADD COLUMN downlink_hz INTEGER",
            "ALTER TABLE satellite_catalogue ADD COLUMN downlink_mode TEXT",
            "ALTER TABLE satellite_catalogue ADD COLUMN ctcss_hz REAL",
            "ALTER TABLE satellite_catalogue ADD COLUMN transponder_type TEXT",
            "ALTER TABLE satellite_catalogue ADD COLUMN beacon_hz INTEGER",
            "ALTER TABLE satellite_catalogue ADD COLUMN packet_info TEXT",
            "ALTER TABLE satellite_catalogue ADD COLUMN radio_status TEXT",
            "ALTER TABLE satellite_catalogue ADD COLUMN radio_notes TEXT",
            # Per-frequency tuning settings (applied on click / scan-stop).
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN bandwidth INTEGER",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN sample_rate INTEGER",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN volume INTEGER NOT NULL DEFAULT 80",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN zoom REAL NOT NULL DEFAULT 1.0",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN zmin REAL NOT NULL DEFAULT 0.0",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN zmax REAL NOT NULL DEFAULT 0.0",
            "ALTER TABLE sdr_stored_frequencies ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0",
        ]:
            try:
                await conn.execute(sa_text(col_sql))
            except OperationalError:
                pass
        # Backfill the newly-added per-frequency settings for rows created before
        # the columns existed, so existing saved frequencies carry sensible values
        # (bandwidth keyed off the demodulation mode, matching defaultBwHz() in the
        # SPA). Idempotent: only touches rows still NULL after the ALTER above.
        try:
            await conn.execute(
                sa_text(
                    "UPDATE sdr_stored_frequencies SET bandwidth = CASE mode "
                    "WHEN 'WFM' THEN 500000 WHEN 'NFM' THEN 12500 WHEN 'AM' THEN 10000 "
                    "WHEN 'USB' THEN 3000 WHEN 'LSB' THEN 3000 WHEN 'CW' THEN 500 "
                    "ELSE 10000 END WHERE bandwidth IS NULL"
                )
            )
            await conn.execute(
                sa_text("UPDATE sdr_stored_frequencies SET sample_rate = 2048000 WHERE sample_rate IS NULL")
            )
        except OperationalError:
            pass
        # Backfill slugs for groups created before the column existed (or seeded
        # empty). Slug is rename-stable, so only populate where still blank.
        try:
            from backend.utils import slugify

            rows = (
                await conn.execute(sa_text("SELECT id, name FROM sdr_frequency_groups WHERE slug = '' OR slug IS NULL"))
            ).all()
            for gid, name in rows:
                await conn.execute(
                    sa_text("UPDATE sdr_frequency_groups SET slug = :s WHERE id = :i"),
                    {"s": slugify(name or "") or f"group-{gid}", "i": gid},
                )
        except OperationalError:
            pass
        try:
            await conn.execute(
                sa_text(
                    "INSERT OR IGNORE INTO sdr_frequency_group_links (frequency_id, group_id) "
                    "SELECT id, group_id FROM sdr_stored_frequencies WHERE group_id IS NOT NULL"
                )
            )
        except OperationalError:
            pass
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS ix_air_flights_registration ON air_flights (registration)",
            "CREATE INDEX IF NOT EXISTS ix_air_snapshots_flight_id_ts ON air_snapshots (flight_id, ts)",
            "CREATE INDEX IF NOT EXISTS ix_air_aircraft_last_seen ON air_aircraft (last_seen DESC)",
            "CREATE INDEX IF NOT EXISTS ix_air_snapshots_ts ON air_snapshots (ts)",
            "CREATE INDEX IF NOT EXISTS ix_air_flights_started_last ON air_flights (started_at, last_active_at)",
        ]:
            await conn.execute(sa_text(idx_sql))
    # Ensure recordings directory exists inside the data volume
    recordings_dir = Path(settings.db_path).parent / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)


async def get_db():
    """FastAPI dependency that yields an async database session per request."""
    async with AsyncSessionLocal() as session:
        yield session


def _parse_config_file(path: Path) -> list[tuple[str, str, object]]:
    """Parse a config JSON file (namespace → {key: value}) into a flat list of
    (namespace, key, value) tuples suitable for seeding the database.
    Reserved keys starting with '_' (e.g. _comment) are ignored.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    config_entries = []
    for namespace, entries in raw.items():
        if namespace.startswith("_") or not isinstance(entries, dict):
            continue
        for key, value in entries.items():
            config_entries.append((namespace, key, value))
    return config_entries


# Default URL settings seeded into the database on first startup.
# Loaded from default_config.json; env-derived values override specific keys.
def _build_default_settings() -> list[tuple[str, str, object]]:
    rows = _parse_config_file(_CONFIG_PATH)
    # Allow env/config.py values to override the JSON file for API URLs
    overrides = {
        ("air", "onlineDataSourceURL"): settings.adsb_upstream_base,
        ("space", "onlineUrl"): settings.celestrak_iss_url,
    }
    result = []
    for ns, key, value in rows:
        result.append((ns, key, overrides.get((ns, key), value)))
    return result


async def migrate_sdr_radios_to_settings() -> None:
    """One-time migration: copy rows from sdr_radios table into UserSettings sdr.radios.

    Only runs if sdr_radios has rows AND sdr.radios does not yet exist in UserSettings.
    Safe to call on every startup — skips immediately if the key already exists.
    """
    from backend.models import UserSettings  # avoid circular import

    async with AsyncSessionLocal() as session:
        # Check if sdr.radios already exists in UserSettings
        existing = await session.execute(
            select(UserSettings).where(
                UserSettings.namespace == "sdr",
                UserSettings.key == "radios",
            )
        )
        if existing.scalar_one_or_none() is not None:
            return  # already migrated or seeded — nothing to do

        # Read rows from sdr_radios (table may not exist on a fresh install)
        try:
            result = await session.execute(
                sa_text(
                    "SELECT id, name, host, port, description, enabled, bandwidth, rf_gain, agc, created_at "
                    "FROM sdr_radios ORDER BY created_at"
                )
            )
            rows = result.mappings().fetchall()
        except Exception:
            return  # table doesn't exist yet — nothing to migrate

        if not rows:
            return  # empty table — let seed_default_settings handle it

        radios = []
        for row in rows:
            radios.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "host": row["host"],
                    "port": row["port"],
                    "description": row["description"] or "",
                    "enabled": bool(row["enabled"]),
                    "bandwidth": row["bandwidth"],
                    "rf_gain": row["rf_gain"],
                    "agc": bool(row["agc"]) if row["agc"] is not None else None,
                    "created_at": row["created_at"],
                }
            )

        session.add(
            UserSettings(
                namespace="sdr",
                key="radios",
                value=json.dumps(radios),
                updated_at=int(time.time() * 1000),
            )
        )
        await session.commit()


# Settings rows left behind by features that no longer exist. Each entry is a
# (namespace, key) pair that prune_removed_settings() deletes on startup.
# Removing a feature adds its keys here rather than leaving them to accumulate
# in every existing database — they would otherwise keep showing up in the
# Application Config editor and in exported config JSON, where a reader can't
# tell them apart from live settings.
_REMOVED_SETTING_KEYS: tuple[tuple[str, str], ...] = (
    # Trunk tracking (removed 2026-08-15, ADR-0004): the master feature flag
    # and the channel-map documents rendered to the CSVs dsd-fme loaded.
    ("sdr", "trunkTrackingEnabled"),
    ("sdr", "channel_maps"),
)


async def prune_removed_settings() -> None:
    """Delete settings rows belonging to removed features.

    Idempotent and safe on every startup: a fresh install has no such rows and
    the delete is a no-op. Nothing reads these keys any more, so there is no
    value to migrate — they are dropped rather than rewritten.
    """
    from backend.models import UserSettings  # avoid circular import

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(UserSettings).where(
                or_(
                    *(
                        and_(UserSettings.namespace == namespace, UserSettings.key == key)
                        for namespace, key in _REMOVED_SETTING_KEYS
                    )
                )
            )
        )
        stale = result.scalars().all()
        if not stale:
            return
        for row in stale:
            await session.delete(row)
        await session.commit()


async def sync_sdr_groups_to_config(session: AsyncSession) -> None:
    """Mirror the live SDR stored frequencies into UserSettings
    (namespace='sdr', key='frequencies') so the persisted app config JSON
    always reflects current state.

    The config representation is a flat list of frequencies, each carrying its
    own `groups` array of group slugs (the rename-stable key). The companion
    `sdr.groups` key holds the group catalogue as {name, slug} objects so the
    config is self-contained and slugs resolve to readable names. Frequencies
    are never duplicated, even when a frequency belongs to multiple groups.
    Group colours are intentionally omitted — the `color` column still exists
    on the table for UI use."""
    from backend.db_helpers import upsert_setting  # avoid circular import
    from backend.models import (  # avoid circular import
        SdrFrequencyGroup,
        SdrFrequencyGroupLink,
        SdrStoredFrequency,
    )

    groups = (
        (await session.execute(select(SdrFrequencyGroup).order_by(SdrFrequencyGroup.sort_order, SdrFrequencyGroup.id)))
        .scalars()
        .all()
    )
    slug_by_id = {g.id: g.slug for g in groups}

    links = (await session.execute(select(SdrFrequencyGroupLink))).scalars().all()
    group_ids_by_freq: dict[int, list[int]] = {}
    for link in links:
        group_ids_by_freq.setdefault(link.frequency_id, []).append(link.group_id)

    freqs = (
        (await session.execute(select(SdrStoredFrequency).order_by(SdrStoredFrequency.frequency_hz))).scalars().all()
    )

    payload = []
    for f in freqs:
        # Union the many-to-many links with the legacy single group_id so no
        # membership is lost; preserve group sort order, drop unknown ids.
        gids = list(group_ids_by_freq.get(f.id, []))
        if f.group_id is not None and f.group_id not in gids:
            gids.append(f.group_id)
        slugs = [slug_by_id[gid] for gid in slug_by_id if gid in gids]
        payload.append(
            {
                "label": f.label,
                "frequency_hz": f.frequency_hz,
                "mode": f.mode,
                "squelch": f.squelch,
                "gain": f.gain,
                "bandwidth": f.bandwidth,
                "sample_rate": f.sample_rate,
                "volume": f.volume,
                "zoom": f.zoom,
                "zmin": f.zmin,
                "zmax": f.zmax,
                "scannable": f.scannable,
                "favourite": f.favourite,
                "notes": f.notes,
                "groups": slugs,
            }
        )

    await upsert_setting(session, "sdr", "frequencies", payload)
    # Mirror the group catalogue as {name, slug} so the config is self-contained
    # and frequency slug refs resolve to readable names on re-import.
    await upsert_setting(session, "sdr", "groups", [{"name": g.name, "slug": g.slug} for g in groups])
    await session.commit()


async def sync_sdr_search_ranges_to_config(session: AsyncSession) -> None:
    """Mirror the SdrSearchRange table into UserSettings
    (namespace='sdr', key='searchRanges') so the persisted app config JSON
    always reflects current state."""
    from backend.db_helpers import upsert_setting  # avoid circular import
    from backend.models import SdrSearchRange  # avoid circular import

    rows = (
        (await session.execute(select(SdrSearchRange).order_by(SdrSearchRange.sort_order, SdrSearchRange.id)))
        .scalars()
        .all()
    )
    payload = [
        {
            "label": r.label,
            "low_hz": r.low_hz,
            "high_hz": r.high_hz,
            "step_hz": r.step_hz,
            "mode": r.mode,
            "threshold_dbfs": r.threshold_dbfs,
            "dwell_ms": r.dwell_ms,
            "band_name": r.band_name,
            "enabled": r.enabled,
            "notes": r.notes,
        }
        for r in rows
    ]
    await upsert_setting(session, "sdr", "searchRanges", payload)
    await session.commit()


async def seed_sdr_data_from_files() -> None:
    """Seed the SDR groups/frequencies/search-ranges tables from
    backend/data/sdr_frequencies.json on first run (empty tables), then mirror
    the live tables back into the file so it stays the source of truth.

    The file is authoritative on a fresh install. After seeding, the runtime
    CRUD endpoints and the bulk textarea editor keep the file and tables in
    sync, so this only *seeds* — it does not clobber user edits on later boots.
    """
    from backend.models import SdrFrequencyGroup, SdrSearchRange  # avoid circular import
    from backend.routers.settings import _reconcile_sdr_frequencies  # avoid circular import
    from backend.services.sdr_data import (
        load_sdr_frequencies_file,
        reconcile_search_ranges,
        write_sdr_frequencies_file,
    )

    data = load_sdr_frequencies_file()

    async with AsyncSessionLocal() as session:
        groups_empty = (await session.execute(select(SdrFrequencyGroup).limit(1))).scalar_one_or_none() is None
        ranges_empty = (await session.execute(select(SdrSearchRange).limit(1))).scalar_one_or_none() is None

        if groups_empty and (data["groups"] or data["frequencies"]):
            # Rebuild groups + frequencies from the file (catalogue authoritative).
            await _reconcile_sdr_frequencies(session, data["frequencies"], data["groups"])
            await session.commit()

        if ranges_empty and data["searchRanges"]:
            await reconcile_search_ranges(session, data["searchRanges"])
            await session.commit()

        # Mirror live tables into the UserSettings snapshot, then rewrite the
        # file from that snapshot so file and DB always agree.
        await sync_sdr_groups_to_config(session)
        await sync_sdr_search_ranges_to_config(session)
        await write_sdr_frequencies_file(session)


async def seed_sdr_bandplan_from_file() -> None:
    """Seed UserSettings(sdr.bandPlan) from backend/data/sdr_bandplan.json on
    first run (key unset). The waterfall reads sdr.bandPlan; the file is the
    source of truth and is written back on edit via sdr_data.set_bandplan."""
    from backend.db_helpers import get_setting_row, upsert_setting  # avoid circular import
    from backend.services.sdr_data import load_sdr_bandplan_file

    async with AsyncSessionLocal() as session:
        if await get_setting_row(session, "sdr", "bandPlan") is not None:
            return
        await upsert_setting(session, "sdr", "bandPlan", load_sdr_bandplan_file())


async def backfill_satellite_radio_store() -> None:
    """Reconcile the on-disk satellite_radio.json source of truth into the
    persistent store (UserSettings space/satelliteRadio) on every startup.

    The file is authoritative for the entries it defines: its values are merged
    into the store, overwriting per-NORAD entries the file specifies. Entries
    that exist only in the store (e.g. a UI edit for a sat the file doesn't
    mention) are preserved. Hand-edits to the file therefore take effect on the
    next restart, while UI write-through keeps the file and store in sync.

    No-ops when nothing changes, so it's cheap to run on every boot.
    """
    from backend.db_helpers import get_setting_row, upsert_setting  # avoid circular import
    from backend.services.sat_radio import get_radio_map, load_radio_file

    file_map = load_radio_file()

    async with AsyncSessionLocal() as session:
        row = await get_setting_row(session, "space", "satelliteRadio")
        store = await get_radio_map(session) if row is not None else {}

        merged = {**store, **file_map}  # file wins per-key it defines
        if row is not None and merged == store:
            return  # already in sync — nothing to write

        await upsert_setting(session, "space", "satelliteRadio", merged)


async def seed_default_settings() -> None:
    """Insert default URL settings on startup — only if a row does not already exist."""
    from backend.models import UserSettings  # avoid circular import

    # Rename air domain keys introduced in the onlineDataSourceURL/offgridDataSourceURL refactor.
    _RENAMES = [
        ("air", "onlineUrl", "onlineDataSourceURL"),
        ("air", "offgridSource", "offgridDataSourceURL"),
    ]
    async with AsyncSessionLocal() as session:
        for namespace, old_key, new_key in _RENAMES:
            old_result = await session.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == old_key,
                )
            )
            old_row = old_result.scalar_one_or_none()
            if old_row is None:
                continue
            new_result = await session.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == new_key,
                )
            )
            if new_result.scalar_one_or_none() is None:
                old_row.key = new_key
            else:
                await session.delete(old_row)
        await session.commit()

    # Remove stale rows seeded by earlier versions.
    #   sea/land: no built-in default URLs; users must configure them.
    # sdr.groups is intentionally NOT purged here: it is the live {name, slug}
    # catalogue, owned by the sdr_frequency_groups table and rewritten by
    # sync_sdr_groups_to_config. Deleting it each boot would drop user renames
    # until the next frequency/group mutation re-synced it.
    #   sdr/space.offlineSource: pre-offgridSource spelling, no longer read.
    #   sdr.initialGroups: old {name,color} list, superseded by the
    #     code-maintained sdr.groups {name,slug} catalogue.
    #   sdr.autoCenter: renamed to sdr.autoCenterWaterfallOnTune; drop the old
    #     row so it doesn't linger in the persisted config snapshot.
    _OBSOLETE_KEYS = [
        ("space", "offgridSource"),
        ("space", "offlineSource"),
        ("sdr", "offlineSource"),
        ("sdr", "initialGroups"),
        ("sdr", "autoCenter"),
        ("sea", "onlineUrl"),
        ("sea", "offgridSource"),
        ("land", "onlineUrl"),
        ("land", "offgridSource"),
    ]
    async with AsyncSessionLocal() as session:
        for namespace, key in _OBSOLETE_KEYS:
            result = await session.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == key,
                )
            )
            row = result.scalar_one_or_none()
            if row is not None:
                await session.delete(row)
        await session.commit()

    ts = int(time.time() * 1000)
    async with AsyncSessionLocal() as session:
        for namespace, key, value in _build_default_settings():
            result = await session.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == key,
                )
            )
            if result.scalar_one_or_none() is None:
                session.add(
                    UserSettings(
                        namespace=namespace,
                        key=key,
                        value=json.dumps(value),
                        updated_at=ts,
                    )
                )
        await session.commit()
