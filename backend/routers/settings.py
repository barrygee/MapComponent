"""
Settings router — user preferences and overlay toggle persistence.

Endpoints:
  GET  /api/settings              — all settings as { namespace: { key: value } }
  GET  /api/settings/{namespace}  — settings for one namespace as { key: value }
  PUT  /api/settings/{namespace}/{key}  — upsert a single setting
"""

import json

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from backend.cache import now_ms
from backend.database import get_db
from backend.models import UserSettings


# ── Request body schemas ───────────────────────────────────────────────────────

class SettingValueIn(BaseModel):
    """Body for PUT /api/settings/{namespace}/{key}."""
    value: Any  # accepts bool, str, dict, list — stored as JSON string


router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _rows_to_namespace_dict(rows) -> dict:
    """Convert a list of UserSettings rows to { key: parsed_value }."""
    result = {}
    for row in rows:
        try:
            result[row.key] = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            result[row.key] = row.value
    return result


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
async def get_all_settings(db: AsyncSession = Depends(get_db)):
    """Return all user settings grouped by namespace."""
    result = await db.execute(select(UserSettings))
    rows = result.scalars().all()

    grouped: dict[str, dict] = {}
    for row in rows:
        if row.namespace not in grouped:
            grouped[row.namespace] = {}
        try:
            grouped[row.namespace][row.key] = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            grouped[row.namespace][row.key] = row.value

    return JSONResponse(grouped)


@router.get("/{namespace}")
async def get_namespace_settings(namespace: str, db: AsyncSession = Depends(get_db)):
    """Return settings for a single namespace as { key: value }."""
    result = await db.execute(
        select(UserSettings).where(UserSettings.namespace == namespace)
    )
    rows = result.scalars().all()
    return JSONResponse(_rows_to_namespace_dict(rows))


@router.put("/{namespace}/{key}", status_code=200)
async def upsert_setting(
    namespace: str,
    key: str,
    body: SettingValueIn,
    db: AsyncSession = Depends(get_db),
):
    """Upsert a single user setting. Creates the row if it doesn't exist."""
    result = await db.execute(
        select(UserSettings).where(
            UserSettings.namespace == namespace,
            UserSettings.key == key,
        )
    )
    row = result.scalar_one_or_none()
    value_str = json.dumps(body.value)
    ts = now_ms()

    if row:
        row.value = value_str
        row.updated_at = ts
    else:
        db.add(UserSettings(
            namespace=namespace,
            key=key,
            value=value_str,
            updated_at=ts,
        ))

    await db.commit()
    return JSONResponse({"status": "ok"})
