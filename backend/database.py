import json
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import settings

# Async SQLAlchemy engine backed by SQLite via aiosqlite
engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},  # required for SQLite async usage
)

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
            await conn.execute(
                __import__("sqlalchemy").text(
                    "ALTER TABLE satellite_catalogue ADD COLUMN name_source TEXT"
                )
            )
        except Exception:
            pass  # column already exists


async def get_db():
    """FastAPI dependency that yields an async database session per request."""
    async with AsyncSessionLocal() as session:
        yield session


# Default URL settings seeded into the database on first startup.
# These are the canonical values previously hardcoded throughout the app.
_DEFAULT_SETTINGS: list[tuple[str, str, object]] = [
    # namespace, key, value
    # onlineUrl  — plain string, used directly as the upstream base URL
    # offlineSource — {url: string}, matches the frontend settings panel shape
    ("app",   "connectivityProbeUrl", "https://tile.openstreetmap.org/favicon.ico"),
    ("app",   "connectivityMode",    "online"),
    ("air",   "sourceOverride", "auto"),
    ("space", "onlineUrl",      settings.celestrak_iss_url),
    ("space", "offlineSource",  {"url": "http://localhost"}),
    ("space", "sourceOverride", "auto"),
    ("sea",   "sourceOverride", "auto"),
    ("land",  "sourceOverride", "auto"),
    ("sdr",   "onlineUrl",      "https://"),
    ("sdr",   "offlineSource",  {"url": "http://localhost"}),
]


async def seed_default_settings() -> None:
    """Insert default URL settings on startup — only if a row does not already exist."""
    from backend.models import UserSettings  # avoid circular import

    # Remove stale placeholder URL rows that were seeded in earlier versions.
    # air/sea/land have no built-in default URLs; users must configure them.
    _OBSOLETE_KEYS = [
        ("air",  "onlineUrl"),
        ("air",  "offlineSource"),
        ("sea",  "onlineUrl"),
        ("sea",  "offlineSource"),
        ("land", "onlineUrl"),
        ("land", "offlineSource"),
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
        for namespace, key, value in _DEFAULT_SETTINGS:
            result = await session.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == key,
                )
            )
            if result.scalar_one_or_none() is None:
                session.add(UserSettings(
                    namespace=namespace,
                    key=key,
                    value=json.dumps(value),
                    updated_at=ts,
                ))
        await session.commit()
