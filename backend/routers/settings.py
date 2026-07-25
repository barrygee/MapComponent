"""
Settings router — user preferences and overlay toggle persistence.

Endpoints:
  GET  /api/settings                    — all settings as { namespace: { key: value } }
  GET  /api/settings/{namespace}        — settings for one namespace as { key: value }
  PUT  /api/settings/{namespace}/{key}  — upsert a single setting
  GET  /api/settings/config/preview     — current settings as a downloadable config JSON
  POST /api/settings/config/upload      — replace all settings from an uploaded config JSON
"""

import json
from functools import lru_cache
from typing import Any

from backend.cache import now_ms
from backend.database import get_db
from backend.db_helpers import upsert_setting
from backend.models import UserSettings
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

# ── Request body schemas ───────────────────────────────────────────────────────


class SettingValueIn(BaseModel):
    """Body for PUT /api/settings/{namespace}/{key}."""

    value: Any  # accepts bool, str, dict, list — stored as JSON string


router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Helpers ────────────────────────────────────────────────────────────────────


def _validated_location(value: Any) -> dict:
    """Normalise/validate an app.location value.

    Returns {"latitude": "", "longitude": ""} for an empty/unset location
    (signals "use browser geolocation"), or {"latitude": float,
    "longitude": float} for a valid pair. Raises HTTPException(400) for an
    invalid partial or out-of-range pair so a bad coordinate can't poison
    the persisted config.
    """
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="location must be an object")

    lat_raw = value.get("latitude")
    lon_raw = value.get("longitude")

    def _is_empty(v: Any) -> bool:
        return v is None or (isinstance(v, str) and v.strip() == "")

    lat_empty, lon_empty = _is_empty(lat_raw), _is_empty(lon_raw)
    if lat_empty and lon_empty:
        return {"latitude": "", "longitude": ""}
    if lat_empty != lon_empty:
        raise HTTPException(
            status_code=400,
            detail="location requires both latitude and longitude, or neither",
        )

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="latitude/longitude must be numbers") from exc

    if not (-90 <= lat <= 90):
        raise HTTPException(status_code=400, detail="latitude out of range [-90, 90]")
    if not (-180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="longitude out of range [-180, 180]")

    return {"latitude": lat, "longitude": lon}


@lru_cache(maxsize=1)
def _canonical_key_order() -> dict[str, list[str]]:
    """Per-namespace canonical key order, read from default_config.json.

    UserSettings rows have no inherent order — a key seeded later (e.g. a new
    setting added in a release) lands wherever its row was inserted, so the
    served / exported config drifts from the template's readable layout. We
    re-order each namespace dict to match default_config.json; keys not in the
    template keep their original relative order, appended after the known ones.
    """
    from backend.database import _CONFIG_PATH  # avoid import cycle at module load

    try:
        raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {ns: list(entries.keys()) for ns, entries in raw.items() if isinstance(entries, dict)}


def _rows_to_namespace_dict(rows, namespace: str | None = None) -> dict:
    """Convert a list of UserSettings rows to { key: parsed_value }, ordered to
    match default_config.json for that namespace (unknown keys kept last in
    their original order)."""
    parsed: dict = {}
    for row in rows:
        try:
            parsed[row.key] = json.loads(row.value)
        except (json.JSONDecodeError, TypeError):
            parsed[row.key] = row.value

    order = _canonical_key_order().get(namespace or "", [])
    if not order:
        return parsed
    rank = {k: i for i, k in enumerate(order)}
    # Stable sort: known keys by template position, unknown keys after, each
    # group preserving the row order they came in with.
    return dict(sorted(parsed.items(), key=lambda kv: rank.get(kv[0], len(order))))


_VALID_MODES = {"AM", "NFM", "WFM", "USB", "LSB", "CW"}

# Per-mode demod bandwidth defaults (Hz), mirroring defaultBwHz() in the SPA
# (frontend/vue/src/components/sdr/sdrPanelUtils.ts). Used when an imported
# frequency omits an explicit bandwidth.
_DEFAULT_BW_BY_MODE = {
    "WFM": 500_000,
    "NFM": 12_500,
    "AM": 10_000,
    "USB": 3_000,
    "LSB": 3_000,
    "CW": 500,
}


def _coerce_float(value: object, default: float) -> float:
    """Best-effort float coercion for hand-written/imported config values.
    Returns ``default`` for missing or non-numeric input."""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _coerce_optional_int(value: object, default: int) -> int:
    """Best-effort int coercion; returns ``default`` for missing/non-numeric
    input. Used for bandwidth/sample_rate so an omitted value is filled with a
    sensible concrete default rather than left NULL."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


async def _reconcile_sdr_frequencies(db: AsyncSession, payload: list, catalogue: list | None = None) -> None:
    """Rebuild SDR groups + stored frequencies to match the flat config
    payload (a list of {label, frequency_hz, mode, notes, groups:[slug, ...]}).

    Each frequency carries its own `groups` as group *slugs* (never
    duplicated). `catalogue` is the `sdr.groups` list — {name, slug} objects
    (current shape) or bare name strings (legacy) — and supplies the readable
    name for each slug plus the set of default/empty groups that must exist and
    must never be pruned. Groups are matched by slug so a renamed group still
    resolves and existing colours / sort order survive a round-trip (the config
    omits colour).

    Catalogue authority: when a non-empty catalogue is supplied, `sdr.groups`
    is the source of truth. A frequency slug not present in the catalogue is
    dropped from that frequency (the removed group is NOT resurrected), and any
    DB group neither in the catalogue nor referenced by a surviving frequency
    is deleted by the prune below. When the catalogue is empty/absent (legacy
    or hand-written config that omits sdr.groups) this is relaxed: slugs
    referenced by a frequency are auto-created so such imports are not wiped.
    All existing frequencies are always rebuilt from the payload."""
    from backend.models import (
        SdrFrequencyGroup,
        SdrFrequencyGroupLink,
        SdrStoredFrequency,
    )
    from backend.utils import InvalidGroupName, clean_group_name, slugify

    existing_groups = (await db.execute(select(SdrFrequencyGroup))).scalars().all()
    by_slug: dict[str, SdrFrequencyGroup] = {g.slug: g for g in existing_groups if g.slug}

    # Build slug -> display name from the catalogue, accepting {name, slug}
    # objects or legacy bare strings. A missing slug is derived from the name.
    # Names from an uploaded config bypass the GroupIn validator, so sanitise
    # here too; a malformed entry is skipped rather than aborting the import.
    name_by_slug: dict[str, str] = {}
    keep_slugs: list[str] = []
    for entry in catalogue or []:
        if isinstance(entry, dict):
            raw_name = str(entry.get("name", ""))
            raw_slug = str(entry.get("slug", "")).strip()
        elif isinstance(entry, str):
            raw_name, raw_slug = entry, ""
        else:
            continue
        try:
            nm = clean_group_name(raw_name)
        except InvalidGroupName:
            continue
        sl = slugify(raw_slug or nm)
        if not sl:
            continue
        name_by_slug.setdefault(sl, nm)
        keep_slugs.append(sl)

    # When a usable catalogue is supplied, `sdr.groups` is authoritative: a
    # frequency may only reference groups listed there, and groups absent from
    # it are pruned (the existing prune loop handles deletion). When the
    # catalogue is empty/absent (legacy or hand-written config that omits
    # sdr.groups), fall back to the historical behaviour of auto-creating
    # groups from frequency refs so such imports are not silently wiped.
    catalogue_authoritative = bool(keep_slugs)
    allowed_slugs = set(keep_slugs)

    # Frequencies are fully rebuilt from the payload.
    await db.execute(delete(SdrStoredFrequency))
    await db.execute(delete(SdrFrequencyGroupLink))

    ts = now_ms()
    next_sort = max((g.sort_order for g in existing_groups), default=-1) + 1
    keep_group_ids: set[int] = set()

    async def _resolve_group(slug: str) -> int:
        # Invariant: when catalogue_authoritative, callers only pass slugs in
        # `allowed_slugs` (the frequency loop filters first; the keep-slugs
        # pre-pass iterates the catalogue itself). So the create branch below
        # can only ever mint in-catalogue groups — a removed group is never
        # resurrected here.
        nonlocal next_sort
        group = by_slug.get(slug)
        if group is None:
            group = SdrFrequencyGroup(
                name=name_by_slug.get(slug, slug),
                slug=slug,
                color="#c8ff00",
                sort_order=next_sort,
                created_at=ts,
            )
            next_sort += 1
            db.add(group)
            await db.flush()
            by_slug[slug] = group
        return group.id

    # Default/empty groups must exist and survive pruning even with no freqs.
    for slug in keep_slugs:
        keep_group_ids.add(await _resolve_group(slug))

    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            hz = int(item.get("frequency_hz", 0))
        except (TypeError, ValueError):
            continue
        mode = str(item.get("mode", "AM")).upper().strip()
        label = str(item.get("label", "")).strip()
        if hz <= 0 or mode not in _VALID_MODES or not label:
            continue

        # Resolve this frequency's group memberships (de-duplicated, ordered).
        gids: list[int] = []
        for raw_slug in item.get("groups", []):
            if not isinstance(raw_slug, str) or not raw_slug.strip():
                continue
            sl = slugify(raw_slug.strip())
            # Catalogue is authoritative: a slug the user removed from
            # sdr.groups is dropped from the frequency rather than resurrecting
            # the group. (Legacy empty-catalogue imports keep auto-create.)
            if catalogue_authoritative and sl not in allowed_slugs:
                continue
            gid = await _resolve_group(sl)
            if gid not in gids:
                gids.append(gid)
        keep_group_ids.update(gids)

        freq = SdrStoredFrequency(
            group_id=gids[0] if gids else None,
            label=label[:60],
            frequency_hz=hz,
            mode=mode,
            squelch=_coerce_float(item.get("squelch"), -60.0),
            gain=_coerce_float(item.get("gain"), 30.0),
            bandwidth=_coerce_optional_int(item.get("bandwidth"), _DEFAULT_BW_BY_MODE.get(mode, 10000)),
            sample_rate=_coerce_optional_int(item.get("sample_rate"), 2_048_000),
            volume=int(_coerce_float(item.get("volume"), 80.0)),
            zoom=_coerce_float(item.get("zoom"), 1.0),
            zmin=_coerce_float(item.get("zmin"), 0.0),
            zmax=_coerce_float(item.get("zmax"), 0.0),
            scannable=bool(item.get("scannable", True)),
            favourite=bool(item.get("favourite", False)),
            notes=str(item.get("notes", ""))[:500],
            created_at=ts,
        )
        db.add(freq)
        await db.flush()
        for gid in gids:
            db.add(SdrFrequencyGroupLink(frequency_id=freq.id, group_id=gid))

    # Drop groups no longer referenced by any frequency.
    for group in existing_groups:
        if group.id not in keep_group_ids:
            await db.delete(group)


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.get("")
async def get_all_settings(db: AsyncSession = Depends(get_db)):
    """Return all user settings grouped by namespace."""
    result = await db.execute(select(UserSettings))
    rows = result.scalars().all()

    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row.namespace, []).append(row)

    return JSONResponse({ns: _rows_to_namespace_dict(ns_rows, ns) for ns, ns_rows in grouped.items()})


# ── Config preview (must be registered before /{namespace}) ─────────────────

# Curated reference data that now lives in dedicated files with their own
# Settings editors (backend/data/sdr_frequencies.json → Settings > SDR,
# sdr_bandplan.json → Settings > SDR, satellite_radio.json → Settings > Space).
# These keys are excluded from the app-config JSON so they are neither shown
# nor round-tripped here. The runtime UserSettings mirrors still exist (the SDR
# panel/waterfall and satellite display read them) — they're just no longer
# part of the application config.
_EXCLUDED_DATA_KEYS: dict[str, frozenset[str]] = {
    "sdr": frozenset({"groups", "frequencies", "searchRanges", "bandPlan"}),
    "space": frozenset({"satelliteRadio"}),
}


def _strip_data_keys(config: dict) -> dict:
    """Drop the moved data keys (SDR frequencies/groups/bandplan, satellite
    radio) from an exported config dict."""
    for ns, excluded in _EXCLUDED_DATA_KEYS.items():
        block = config.get(ns)
        if isinstance(block, dict):
            config[ns] = {k: v for k, v in block.items() if k not in excluded}
    return config


@router.get("/config/preview")
async def config_preview(db: AsyncSession = Depends(get_db)):
    """Return the current settings as a config JSON file (downloadable)."""
    result = await db.execute(select(UserSettings))
    rows = result.scalars().all()

    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row.namespace, []).append(row)

    config = {ns: _rows_to_namespace_dict(ns_rows, ns) for ns, ns_rows in grouped.items()}
    payload = json.dumps(_strip_data_keys(config), indent=2, ensure_ascii=False)
    return Response(content=payload, media_type="application/json")


@router.post("/config/upload", status_code=200)
async def config_upload(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace all settings from an uploaded config JSON file."""
    try:
        content = await file.read()
        config = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="Config must be a JSON object")

    # Assign sequential IDs to any sdr.radios entries that are missing them
    sdr_radios = config.get("sdr", {}).get("radios") if isinstance(config.get("sdr"), dict) else None
    if isinstance(sdr_radios, list):
        next_id = max((r.get("id", 0) for r in sdr_radios if isinstance(r, dict)), default=0) + 1
        for r in sdr_radios:
            if isinstance(r, dict) and not isinstance(r.get("id"), int):
                r["id"] = next_id
                next_id += 1

    # Validate app.location up front so a bad coordinate rejects the whole
    # upload rather than being persisted (raises HTTPException(400)).
    app_ns = config.get("app")
    if isinstance(app_ns, dict) and "location" in app_ns:
        app_ns["location"] = _validated_location(app_ns["location"])

    ts = now_ms()
    for namespace, keys in config.items():
        if not isinstance(keys, dict):
            continue
        for key, value in keys.items():
            # SDR frequencies/groups/searchRanges/bandPlan and satellite radio
            # are no longer part of the app config — they live in dedicated
            # files with their own editors. Ignore them here so an old/exported
            # config that still carries them can't silently overwrite the
            # dedicated stores.
            if key in _EXCLUDED_DATA_KEYS.get(namespace, frozenset()):
                continue
            result = await db.execute(
                select(UserSettings).where(
                    UserSettings.namespace == namespace,
                    UserSettings.key == key,
                )
            )
            row = result.scalar_one_or_none()
            value_str = json.dumps(value)
            if row:
                row.value = value_str
                row.updated_at = ts
            else:
                db.add(
                    UserSettings(
                        namespace=namespace,
                        key=key,
                        value=value_str,
                        updated_at=ts,
                    )
                )

    await db.commit()

    return JSONResponse({"status": "ok"})


# ── Namespace / key endpoints (registered after /config/* to avoid shadowing) ─


@router.get("/{namespace}")
async def get_namespace_settings(namespace: str, db: AsyncSession = Depends(get_db)):
    """Return settings for a single namespace as { key: value }."""
    result = await db.execute(select(UserSettings).where(UserSettings.namespace == namespace))
    rows = result.scalars().all()
    return JSONResponse(_rows_to_namespace_dict(rows, namespace))


@router.put("/{namespace}/{key}", status_code=200)
async def upsert_setting_endpoint(
    namespace: str,
    key: str,
    body: SettingValueIn,
    db: AsyncSession = Depends(get_db),
):
    """Upsert a single user setting. Creates the row if it doesn't exist."""
    value = body.value
    if namespace == "app" and key == "location":
        value = _validated_location(value)
    await upsert_setting(db, namespace, key, value)
    return JSONResponse({"status": "ok"})


@router.delete("/{namespace}/{key}", status_code=200)
async def delete_setting_endpoint(
    namespace: str,
    key: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single user setting. No-op if the row doesn't exist."""
    await db.execute(
        delete(UserSettings).where(
            UserSettings.namespace == namespace,
            UserSettings.key == key,
        )
    )
    await db.commit()
    return JSONResponse({"status": "ok"})
