"""Tests for prune_removed_settings() — backend/database.py.

The migration deletes settings rows belonging to features that no longer exist
(currently trunk tracking, removed in ADR-0004). It runs on every startup, so
the cases that matter most are the negative ones: it must never touch a live
setting, and a second run must be a no-op.

prune_removed_settings() opens its own session from the module-level
AsyncSessionLocal rather than taking one, so each test points that factory at
the in-memory test engine.
"""

from __future__ import annotations

import json
import time

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from backend import database as db
from backend.models import UserSettings


@pytest.fixture()
def session_factory(test_engine, db_setup, monkeypatch):
    """Point the module-level session factory at the per-test in-memory engine."""
    factory = sessionmaker(
        bind=test_engine, class_=AsyncSession, expire_on_commit=False
    )
    monkeypatch.setattr(db, "AsyncSessionLocal", factory)
    return factory


async def _add_settings(factory, rows: list[tuple[str, str, object]]) -> None:
    async with factory() as session:
        for namespace, key, value in rows:
            session.add(
                UserSettings(
                    namespace=namespace,
                    key=key,
                    value=json.dumps(value),
                    updated_at=int(time.time() * 1000),
                )
            )
        await session.commit()


async def _stored_keys(factory) -> list[tuple[str, str]]:
    async with factory() as session:
        rows = (await session.execute(select(UserSettings))).scalars().all()
        return sorted((row.namespace, row.key) for row in rows)


class TestPruneRemovedSettings:
    async def test_deletes_every_removed_key(self, session_factory):
        await _add_settings(
            session_factory,
            [
                ("sdr", "trunkTrackingEnabled", True),
                ("sdr", "channel_maps", [{"name": "site", "channels": []}]),
            ],
        )
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == []

    async def test_leaves_live_settings_untouched(self, session_factory):
        # The blast radius is the whole settings table, so a live SDR setting
        # sitting beside the removed ones must survive.
        await _add_settings(
            session_factory,
            [
                ("sdr", "trunkTrackingEnabled", True),
                ("sdr", "showBandPlan", True),
                ("sdr", "radios", []),
                ("app", "theme", "dark"),
            ],
        )
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == [
            ("app", "theme"),
            ("sdr", "radios"),
            ("sdr", "showBandPlan"),
        ]

    async def test_matches_on_namespace_as_well_as_key(self, session_factory):
        # Keys are (namespace, key) pairs: the same key name in another
        # namespace is a different setting and must be left alone.
        await _add_settings(
            session_factory,
            [
                ("sdr", "channel_maps", [{"name": "site", "channels": []}]),
                ("air", "channel_maps", ["not the sdr one"]),
            ],
        )
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == [("air", "channel_maps")]

    async def test_no_op_on_a_fresh_database(self, session_factory):
        # A fresh install has no such rows — the early return path.
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == []

    async def test_no_op_when_only_live_settings_exist(self, session_factory):
        await _add_settings(session_factory, [("sdr", "showBandPlan", True)])
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == [("sdr", "showBandPlan")]

    async def test_is_idempotent_across_startups(self, session_factory):
        # It runs on every startup, so the second run must neither fail nor
        # delete anything further.
        await _add_settings(
            session_factory,
            [("sdr", "trunkTrackingEnabled", True), ("sdr", "showBandPlan", True)],
        )
        await db.prune_removed_settings()
        await db.prune_removed_settings()
        assert await _stored_keys(session_factory) == [("sdr", "showBandPlan")]

    async def test_removed_keys_are_all_namespace_key_pairs(self):
        # The delete builds one AND-clause per entry; a bare string would make
        # the query match on the namespace alone and delete a whole namespace.
        assert db._REMOVED_SETTING_KEYS
        for entry in db._REMOVED_SETTING_KEYS:
            assert isinstance(entry, tuple)
            assert len(entry) == 2
            assert all(isinstance(part, str) and part for part in entry)
