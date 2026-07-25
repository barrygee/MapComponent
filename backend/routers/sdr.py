"""SDR router — radio management, frequency storage, and WebSocket rtl_tcp bridge.

REST endpoints:
  GET    /api/sdr/radios                  — list configured SDR radios
  POST   /api/sdr/radios                  — add a new radio
  PUT    /api/sdr/radios/{id}             — update a radio
  DELETE /api/sdr/radios/{id}             — delete a radio

  GET    /api/sdr/groups                  — list frequency groups (with frequencies)
  POST   /api/sdr/groups                  — create a group
  PUT    /api/sdr/groups/{id}             — update a group
  DELETE /api/sdr/groups/{id}             — delete a group

  GET    /api/sdr/frequencies             — list all stored frequencies
  POST   /api/sdr/frequencies             — save a frequency
  PUT    /api/sdr/frequencies/{id}        — update a frequency (full replace)
  PATCH  /api/sdr/frequencies/{id}        — partial update (currently: favourite)
  DELETE /api/sdr/frequencies/{id}        — delete a frequency

  POST   /api/sdr/connect                 — open TCP connection to a radio
  POST   /api/sdr/disconnect              — close TCP connection to a radio
  GET    /api/sdr/status/{radio_id}       — connection state for a radio

WebSocket:
  WS     /ws/sdr/{radio_id}              — stream spectrum frames; receive commands
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import secrets
from pathlib import Path

from backend.cache import now_ms
from backend.config import settings
from backend.database import get_db, sync_sdr_groups_to_config, sync_sdr_search_ranges_to_config
from backend.db_helpers import get_setting, upsert_setting
from backend.models import SdrFrequencyGroup, SdrFrequencyGroupLink, SdrRecording, SdrSearchRange, SdrStoredFrequency
from backend.services import aprs_store, sdr_channel_maps, sdr_decode, sdr_rigctl
from backend.services import sdr as sdr_svc
from backend.services.sdr_data import write_sdr_frequencies_file
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sdr"])

# Bounds for the untrusted ``sweep_state`` control-socket payload (owner → follower
# scan/search overlay mirroring). Cap the group-name list so a malformed/hostile
# client can't push an unbounded blob through the relay to every follower.
MAX_SCAN_GROUPS = 64
MAX_SCAN_GROUP_NAME_LEN = 64


def _sanitize_optional_hz(value: object) -> int | None:
    """Coerce an untrusted sweep-frequency field to a non-negative int, else None.

    Used for the ``sweep_state`` search bounds, which are legitimately null when the
    owner is not searching. Any non-numeric or negative value collapses to None so a
    follower never renders a bogus range.
    """
    if value is None:
        return None
    try:
        parsed = int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


# ── Pydantic request schemas ──────────────────────────────────────────────────


class RadioIn(BaseModel):
    name: str
    host: str
    port: int = 1234
    description: str = ""
    enabled: bool = True
    bandwidth: int | None = None
    rf_gain: float | None = None
    agc: bool | None = None


class GroupIn(BaseModel):
    name: str
    color: str = "#c8ff00"
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        from backend.utils import InvalidGroupName, clean_group_name

        try:
            return clean_group_name(v)
        except InvalidGroupName as exc:
            raise ValueError(str(exc)) from exc


class FrequencyIn(BaseModel):
    group_id: int | None = None
    group_ids: list[int] | None = None
    label: str
    frequency_hz: int
    mode: str = "AM"
    squelch: float = -60.0
    gain: float = 30.0
    bandwidth: int | None = None  # demod bandwidth Hz; None = per-mode default
    sample_rate: int | None = None  # device sample rate Hz; None = keep current
    volume: int = 80  # audio volume 0-100 (%)
    zoom: float = 1.0  # waterfall zoom factor
    zmin: float = 0.0  # waterfall Min dB (0 = auto/unset)
    zmax: float = 0.0  # waterfall Max dB (0 = auto/unset)
    scannable: bool = True
    favourite: bool = False
    notes: str = ""


class SearchRangeIn(BaseModel):
    label: str
    low_hz: int
    high_hz: int
    step_hz: int = 12_500
    mode: str = "NFM"
    threshold_dbfs: float = -35.0
    dwell_ms: int = 250
    band_name: str = ""
    enabled: bool = True
    notes: str = ""
    sort_order: int = 0


class ConnectIn(BaseModel):
    radio_id: int
    frequency_hz: int | None = None  # None = preserve current freq
    mode: str | None = None  # None = preserve current mode
    gain_db: float | None = None  # None = preserve current gain
    gain_auto: bool | None = None  # None = preserve current AGC state
    squelch_dbfs: float = -60.0
    sample_rate: int | None = None  # None = preserve current sample rate


class DisconnectIn(BaseModel):
    radio_id: int


class DecodeEventIn(BaseModel):
    """A decoded event POSTed by the dsd-fme sidecar's log parser.

    ``event`` is the decoder-shaped payload (mode, talkgroup, source/dest IDs,
    sync state, …). It is constrained in size so a misbehaving sidecar cannot
    flood the WS subscribers, and is required to be JSON-serialisable. The
    event is routed to the single active decode session, so no radio id is
    needed (only one decoder runs at a time).
    """

    event: dict

    @field_validator("event")
    @classmethod
    def _validate_event(cls, value: dict) -> dict:
        try:
            serialised = json.dumps(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("event must be JSON-serialisable") from exc
        if len(serialised) > 4096:
            raise ValueError("event too large (max 4096 bytes serialised)")
        return value


class AprsControlIn(BaseModel):
    """Body for starting/stopping APRS decode on a specific radio.

    ``offset_hz``/``bw_hz`` select the demod channel within the captured span
    (0 = span centre / the bridge's default bandwidth). APRS runs in the
    background independent of the SDR view, so it is controlled over HTTP rather
    than the spectrum WebSocket (which tears its bridge down on close).
    """

    radio_id: int
    offset_hz: int = 0
    bw_hz: int = 0


class RecordingStartIn(BaseModel):
    radio_id: int | None = None
    radio_name: str = ""
    frequency_hz: int
    mode: str = "AM"
    gain_db: float = 30.0
    squelch_dbfs: float = -60.0
    sample_rate: int = 2_048_000


class FrequencyPatchIn(BaseModel):
    """Body for the partial-update `PATCH /api/sdr/frequencies/{id}` endpoint.

    Deliberately narrow (currently just `favourite`) rather than a partial
    `FrequencyIn`: the sibling `PUT /api/sdr/frequencies/{id}` is a full
    replace (`setattr`s every `FrequencyIn` field from `body.model_dump()`),
    so routing a star-toggle through it would silently reset every field a
    stale client omitted (mode, gain, scannable, group links, …). Only fields
    set to a non-None value here are applied; anything else on the row is
    left untouched.
    """

    favourite: bool | None = None


class RecordingPatchIn(BaseModel):
    name: str | None = None
    notes: str | None = None

    @field_validator("name", "notes")
    @classmethod
    def _sanitize_text(cls, v: str | None) -> str | None:
        """Defence-in-depth for user-supplied text.

        Queries go through the SQLAlchemy ORM (bound parameters), so SQL
        injection is not reachable here, and Vue escapes interpolated text so
        stored XSS is mitigated at render. We still validate the input: strip
        control characters (keeping tab/newline), collapse to a sane length,
        and reject anything implausible so junk never reaches the DB.
        """
        if v is None:
            return None
        # Drop C0/C1 control chars except tab (\t) and newline (\n).
        cleaned = "".join(ch for ch in v if ch in ("\t", "\n") or (ord(ch) >= 0x20 and ord(ch) != 0x7F)).strip()
        if len(cleaned) > 250:
            raise ValueError("text too long (max 250 characters)")
        return cleaned


# ── Radio helpers — read/write sdr.radios from UserSettings ──────────────────


async def _get_radios(db: AsyncSession) -> list[dict]:
    """Read the sdr.radios array from UserSettings. Returns [] if not set."""
    val = await get_setting(db, "sdr", "radios", default=[])
    return val if isinstance(val, list) else []


async def _save_radios(db: AsyncSession, radios: list[dict]) -> None:
    """Write the sdr.radios array back to UserSettings (upsert)."""
    await upsert_setting(db, "sdr", "radios", radios)


async def _sync_groups(db: AsyncSession) -> None:
    """Mirror groups/frequencies into UserSettings and write the file back, so
    every group/frequency mutation keeps sdr_frequencies.json the source of
    truth (matches the satellite-radio write-through)."""
    await sync_sdr_groups_to_config(db)
    await write_sdr_frequencies_file(db)


async def _sync_search_ranges(db: AsyncSession) -> None:
    """Mirror search ranges into UserSettings and write the file back."""
    await sync_sdr_search_ranges_to_config(db)
    await write_sdr_frequencies_file(db)


def _group_to_dict(g: SdrFrequencyGroup) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "slug": g.slug,
        "color": g.color,
        "sort_order": g.sort_order,
        "created_at": g.created_at,
    }


def _freq_to_dict(f: SdrStoredFrequency, group_ids: list[int] | None = None) -> dict:
    return {
        "id": f.id,
        "group_id": f.group_id,
        "group_ids": group_ids if group_ids is not None else [],
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
        "created_at": f.created_at,
    }


async def _load_freq_group_map(db: AsyncSession) -> dict[int, list[int]]:
    rows = (await db.execute(select(SdrFrequencyGroupLink))).scalars().all()
    out: dict[int, list[int]] = {}
    for link in rows:
        out.setdefault(link.frequency_id, []).append(link.group_id)
    return out


async def _set_freq_groups(db: AsyncSession, freq_id: int, group_ids: list[int]) -> None:
    existing = (
        (await db.execute(select(SdrFrequencyGroupLink).where(SdrFrequencyGroupLink.frequency_id == freq_id)))
        .scalars()
        .all()
    )
    for link in existing:
        await db.delete(link)
    seen: set[int] = set()
    for gid in group_ids:
        if gid is None or gid in seen:
            continue
        seen.add(gid)
        db.add(SdrFrequencyGroupLink(frequency_id=freq_id, group_id=gid))


def _recording_to_dict(r: SdrRecording) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "notes": r.notes,
        "radio_id": r.radio_id,
        "radio_name": r.radio_name,
        "frequency_hz": r.frequency_hz,
        "mode": r.mode,
        "gain_db": r.gain_db,
        "squelch_dbfs": r.squelch_dbfs,
        "sample_rate": r.sample_rate,
        "started_at": r.started_at,
        "ended_at": r.ended_at,
        "duration_s": r.duration_s,
        "file_size_bytes": r.file_size_bytes,
        "has_iq_file": r.has_iq_file,
        "iq_file_size_bytes": r.iq_file_size_bytes,
        "status": r.status,
        "created_at": r.created_at,
    }


def _recordings_dir() -> Path:
    return Path(settings.db_path).parent / "recordings"


def _get_radio_by_id(radios: list[dict], radio_id: int) -> dict | None:
    """Return the radio dict with the given id, or None if not found."""
    return next((r for r in radios if r.get("id") == radio_id), None)


# In-memory map of active IQ recording queues: recording_id → asyncio.Queue
_active_iq_recordings: dict[int, asyncio.Queue] = {}


# ── Radio CRUD — backed by UserSettings sdr.radios ───────────────────────────


@router.get("/api/sdr/radios")
async def list_radios(db: AsyncSession = Depends(get_db)):
    return JSONResponse(await _get_radios(db))


@router.post("/api/sdr/radios", status_code=201)
async def create_radio(body: RadioIn, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    new_id = max((r.get("id", 0) for r in radios if isinstance(r.get("id"), int)), default=0) + 1
    new_radio = {"id": new_id, "created_at": now_ms(), **body.model_dump()}
    radios.append(new_radio)
    await _save_radios(db, radios)
    return JSONResponse(new_radio, status_code=201)


@router.put("/api/sdr/radios/{radio_id}")
async def update_radio(radio_id: int, body: RadioIn, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    for i, radio in enumerate(radios):
        if radio.get("id") == radio_id:
            radios[i] = {**radio, **body.model_dump()}
            await _save_radios(db, radios)
            return JSONResponse(radios[i])
    raise HTTPException(404, "Radio not found")


@router.delete("/api/sdr/radios/{radio_id}", status_code=204)
async def delete_radio(radio_id: int, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    new_radios = [radio for radio in radios if radio.get("id") != radio_id]
    if len(new_radios) == len(radios):
        raise HTTPException(404, "Radio not found")
    await _save_radios(db, new_radios)


# ── Group CRUD ────────────────────────────────────────────────────────────────


@router.get("/api/sdr/groups")
async def list_groups(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SdrFrequencyGroup).order_by(SdrFrequencyGroup.sort_order))).scalars().all()
    return JSONResponse([_group_to_dict(g) for g in rows])


@router.post("/api/sdr/groups", status_code=201)
async def create_group(body: GroupIn, db: AsyncSession = Depends(get_db)):
    from backend.utils import slugify

    # Slug is derived once from the name and stays stable across later renames.
    existing = set((await db.execute(select(SdrFrequencyGroup.slug))).scalars().all())
    base = slugify(body.name) or "group"
    slug, n = base, 2
    while slug in existing:
        slug, n = f"{base}-{n}", n + 1
    group = SdrFrequencyGroup(**body.model_dump(), slug=slug, created_at=now_ms())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    await _sync_groups(db)
    return JSONResponse(_group_to_dict(group), status_code=201)


@router.put("/api/sdr/groups/{group_id}")
async def update_group(group_id: int, body: GroupIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrFrequencyGroup).where(SdrFrequencyGroup.id == group_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Group not found")
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await _sync_groups(db)
    return JSONResponse(_group_to_dict(row))


@router.delete("/api/sdr/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrFrequencyGroup).where(SdrFrequencyGroup.id == group_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Group not found")
    # Ungroup any frequencies that belonged to this group
    freqs = (
        (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.group_id == group_id))).scalars().all()
    )
    for freq in freqs:
        freq.group_id = None
    links = (
        (await db.execute(select(SdrFrequencyGroupLink).where(SdrFrequencyGroupLink.group_id == group_id)))
        .scalars()
        .all()
    )
    for link in links:
        await db.delete(link)
    await db.delete(row)
    await db.commit()
    await _sync_groups(db)


# ── Frequency CRUD ────────────────────────────────────────────────────────────


def _resolve_group_ids(body: FrequencyIn) -> list[int]:
    if body.group_ids is not None:
        return [g for g in body.group_ids if g is not None]
    if body.group_id is not None:
        return [body.group_id]
    return []


@router.get("/api/sdr/frequencies")
async def list_frequencies(db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(SdrStoredFrequency).order_by(SdrStoredFrequency.group_id, SdrStoredFrequency.frequency_hz)
            )
        )
        .scalars()
        .all()
    )
    group_map = await _load_freq_group_map(db)
    return JSONResponse([_freq_to_dict(freq, group_map.get(freq.id, [])) for freq in rows])


@router.post("/api/sdr/frequencies", status_code=201)
async def create_frequency(body: FrequencyIn, db: AsyncSession = Depends(get_db)):
    gids = _resolve_group_ids(body)
    payload = body.model_dump(exclude={"group_ids"})
    payload["group_id"] = gids[0] if gids else None
    freq = SdrStoredFrequency(**payload, created_at=now_ms())
    db.add(freq)
    await db.flush()
    await _set_freq_groups(db, freq.id, gids)
    await db.commit()
    await _sync_groups(db)
    await db.refresh(freq)
    return JSONResponse(_freq_to_dict(freq, gids), status_code=201)


@router.put("/api/sdr/frequencies/{freq_id}")
async def update_frequency(freq_id: int, body: FrequencyIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.id == freq_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Frequency not found")
    gids = _resolve_group_ids(body)
    payload = body.model_dump(exclude={"group_ids"})
    payload["group_id"] = gids[0] if gids else None
    for k, v in payload.items():
        setattr(row, k, v)
    await _set_freq_groups(db, freq_id, gids)
    await db.commit()
    await _sync_groups(db)
    await db.refresh(row)
    return JSONResponse(_freq_to_dict(row, gids))


@router.patch("/api/sdr/frequencies/{freq_id}")
async def patch_frequency(freq_id: int, body: FrequencyPatchIn, db: AsyncSession = Depends(get_db)):
    """Apply a partial update to a stored frequency (currently just `favourite`).

    Unlike `update_frequency` above — a full replace that `setattr`s every
    `FrequencyIn` field from the request body — this only touches fields the
    caller explicitly set. That is what makes a star-toggle (or any future
    single-field patch) safe: a stale client's cached copy can never clobber
    the frequency's other tuning settings or group links by omission.
    """
    row = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.id == freq_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Frequency not found")
    # Only fields the caller actually sent AND set to a real value count as an
    # update — an explicit `null` applies nothing, so it must take the no-op
    # path too rather than sneaking past the guard below.
    applied_fields = {name: value for name, value in body.model_dump(exclude_unset=True).items() if value is not None}
    if not applied_fields:
        # Nothing to apply — skip commit/_sync_groups entirely. _sync_groups is
        # expensive (rewrites the user_settings config mirror AND rewrites
        # sdr_frequencies.json to disk), so an empty patch looping on this
        # unauthenticated endpoint must not become a free disk-write amplifier.
        # Still a valid no-op, so return 200 with the row unchanged rather than
        # rejecting the request.
        group_map = await _load_freq_group_map(db)
        return JSONResponse(_freq_to_dict(row, group_map.get(row.id, [])))
    for field_name, field_value in applied_fields.items():
        setattr(row, field_name, field_value)
    await db.commit()
    await _sync_groups(db)
    await db.refresh(row)
    group_map = await _load_freq_group_map(db)
    return JSONResponse(_freq_to_dict(row, group_map.get(row.id, [])))


@router.delete("/api/sdr/frequencies/{freq_id}", status_code=204)
async def delete_frequency(freq_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.id == freq_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Frequency not found")
    links = (
        (await db.execute(select(SdrFrequencyGroupLink).where(SdrFrequencyGroupLink.frequency_id == freq_id)))
        .scalars()
        .all()
    )
    for link in links:
        await db.delete(link)
    await db.delete(row)
    await db.commit()
    await _sync_groups(db)


# ── Search Range CRUD ─────────────────────────────────────────────────────────


def _search_range_to_dict(r: SdrSearchRange) -> dict:
    return {
        "id": r.id,
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
        "sort_order": r.sort_order,
        "created_at": r.created_at,
    }


@router.get("/api/sdr/search-ranges")
async def list_search_ranges(db: AsyncSession = Depends(get_db)):
    rows = (
        (await db.execute(select(SdrSearchRange).order_by(SdrSearchRange.sort_order, SdrSearchRange.id)))
        .scalars()
        .all()
    )
    return JSONResponse([_search_range_to_dict(r) for r in rows])


@router.post("/api/sdr/search-ranges", status_code=201)
async def create_search_range(body: SearchRangeIn, db: AsyncSession = Depends(get_db)):
    if body.low_hz >= body.high_hz:
        raise HTTPException(400, "low_hz must be less than high_hz")
    if body.step_hz <= 0:
        raise HTTPException(400, "step_hz must be positive")
    row = SdrSearchRange(**body.model_dump(), created_at=now_ms())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _sync_search_ranges(db)
    return JSONResponse(_search_range_to_dict(row), status_code=201)


@router.put("/api/sdr/search-ranges/{range_id}")
async def update_search_range(range_id: int, body: SearchRangeIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrSearchRange).where(SdrSearchRange.id == range_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Search range not found")
    if body.low_hz >= body.high_hz:
        raise HTTPException(400, "low_hz must be less than high_hz")
    if body.step_hz <= 0:
        raise HTTPException(400, "step_hz must be positive")
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await _sync_search_ranges(db)
    return JSONResponse(_search_range_to_dict(row))


@router.delete("/api/sdr/search-ranges/{range_id}", status_code=204)
async def delete_search_range(range_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrSearchRange).where(SdrSearchRange.id == range_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Search range not found")
    await db.delete(row)
    await db.commit()
    await _sync_search_ranges(db)


# ── Bulk data editors (textarea JSON for Settings > SDR) ──────────────────────


@router.get("/api/sdr/data/frequencies")
async def get_sdr_data_frequencies(db: AsyncSession = Depends(get_db)):
    """Return {groups, frequencies, searchRanges} as the textarea source — the
    current DB state mirrored into the flat config representation."""
    return JSONResponse(
        {
            "groups": await get_setting(db, "sdr", "groups", default=[]),
            "frequencies": await get_setting(db, "sdr", "frequencies", default=[]),
            "searchRanges": await get_setting(db, "sdr", "searchRanges", default=[]),
        }
    )


@router.post("/api/sdr/data/frequencies")
async def set_sdr_data_frequencies(body: dict, db: AsyncSession = Depends(get_db)):
    """Replace SDR groups/frequencies/search-ranges from an edited JSON object.

    Reconciles into the dedicated tables (reusing the same logic as the config
    upload), then re-derives the snapshot and writes sdr_frequencies.json."""
    from backend.routers.settings import _reconcile_sdr_frequencies
    from backend.services.sdr_data import reconcile_search_ranges

    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    groups = body.get("groups") if isinstance(body.get("groups"), list) else []
    freqs = body.get("frequencies") if isinstance(body.get("frequencies"), list) else []
    ranges = body.get("searchRanges") if isinstance(body.get("searchRanges"), list) else []

    await _reconcile_sdr_frequencies(db, freqs, groups)
    await reconcile_search_ranges(db, ranges)
    await db.commit()
    await _sync_groups(db)  # mirrors groups+frequencies, writes the file
    await sync_sdr_search_ranges_to_config(db)
    return JSONResponse({"status": "ok"})


@router.get("/api/sdr/data/bandplan")
async def get_sdr_data_bandplan(db: AsyncSession = Depends(get_db)):
    """Return {bandPlan} as the textarea source."""
    from backend.services.sdr_data import get_bandplan

    return JSONResponse({"bandPlan": await get_bandplan(db)})


@router.post("/api/sdr/data/bandplan")
async def set_sdr_data_bandplan(body: dict, db: AsyncSession = Depends(get_db)):
    """Replace the band plan from an edited JSON object {bandPlan: [...]}."""
    from backend.services.sdr_data import set_bandplan

    if not isinstance(body, dict) or not isinstance(body.get("bandPlan"), list):
        raise HTTPException(400, "Body must be a JSON object with a bandPlan array")
    await set_bandplan(db, body["bandPlan"])
    return JSONResponse({"status": "ok"})


@router.get("/api/sdr/data/channel-maps")
async def get_sdr_data_channel_maps(db: AsyncSession = Depends(get_db)):
    """Return {channel_maps} as the editor source — trunk channel maps as JSON.

    The DB is the source of truth once anything has been saved. Before that (no
    DB value yet) we seed from any channel-map CSVs already present in the maps
    directory, so hand-made maps appear in the editor and aren't lost on first
    save.
    """
    stored = await get_setting(db, "sdr", "channel_maps", default=None)
    if isinstance(stored, list):
        return JSONResponse({"channel_maps": stored})
    seeded = sdr_channel_maps.read_channel_maps_from_dir(Path(settings.channel_maps_dir))
    return JSONResponse({"channel_maps": seeded})


@router.post("/api/sdr/data/channel-maps")
async def set_sdr_data_channel_maps(body: dict, db: AsyncSession = Depends(get_db)):
    """Replace trunk channel maps from an edited JSON object {channel_maps: [...]}.

    Validates the shape, stores it in the DB, then renders each map to the
    ``<name>.csv`` file dsd-fme loads (pruning maps that were removed). The
    rendered CSVs are what the TRUNK control lists and what trunk tracking uses.
    """
    try:
        maps = sdr_channel_maps.validate_channel_maps_payload(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await upsert_setting(db, "sdr", "channel_maps", maps)
    try:
        sdr_channel_maps.write_channel_maps_to_dir(Path(settings.channel_maps_dir), maps)
    except OSError as exc:
        raise HTTPException(500, f"could not write channel-map files: {exc}") from exc
    return JSONResponse({"status": "ok"})


# ── Recording CRUD + file serving ────────────────────────────────────────────


@router.get("/api/sdr/recordings")
async def list_recordings(db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(SdrRecording).where(SdrRecording.status == "complete").order_by(SdrRecording.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return JSONResponse([_recording_to_dict(r) for r in rows])


@router.post("/api/sdr/recordings/start", status_code=201)
async def start_recording(body: RecordingStartIn, db: AsyncSession = Depends(get_db)):
    """Create a pending recording row and (optionally) start server-side IQ capture."""
    started_at = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    rec = SdrRecording(
        name=f"Recording {started_at[:16].replace('T', ' ')}",
        notes="",
        radio_id=body.radio_id,
        radio_name=body.radio_name,
        frequency_hz=body.frequency_hz,
        mode=body.mode,
        gain_db=body.gain_db,
        squelch_dbfs=body.squelch_dbfs,
        sample_rate=body.sample_rate,
        started_at=started_at,
        ended_at="",
        duration_s=0.0,
        file_size_bytes=0,
        has_iq_file=False,
        iq_file_size_bytes=0,
        status="recording",
        created_at=now_ms(),
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)

    # Check if raw IQ recording is enabled in settings
    record_iq = await get_setting(db, "sdr", "recordRawIq", default=False) is True

    if record_iq and body.radio_id is not None:
        # Look up the radio's host/port so we can find its broadcaster
        radios = await _get_radios(db)
        radio = _get_radio_by_id(radios, body.radio_id)
        if radio:
            try:
                broadcaster = sdr_svc.get_broadcaster(radio["host"], radio["port"])
                if broadcaster:
                    rdir = _recordings_dir()
                    rdir.mkdir(parents=True, exist_ok=True)
                    iq_path = str(rdir / f"{rec.id}.u8")
                    q = await broadcaster.start_iq_recording(iq_path)
                    _active_iq_recordings[rec.id] = q
                    rec.has_iq_file = True
                    await db.commit()
            except Exception as exc:
                logger.warning("Could not start IQ recording for rec %d: %s", rec.id, exc)

    return JSONResponse({"id": rec.id}, status_code=201)


@router.post("/api/sdr/recordings/stop")
async def stop_recording(
    recording_id: int = Form(...),
    file: UploadFile = File(...),
    name: str = Form(""),
    ended_at: str = Form(""),
    duration_s: float = Form(0.0),
    db: AsyncSession = Depends(get_db),
):
    """Finalise a recording: upload WAV, stop IQ capture, update DB row."""
    row = (await db.execute(select(SdrRecording).where(SdrRecording.id == recording_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Recording not found")

    # Stop IQ recording if active
    if recording_id in _active_iq_recordings:
        q = _active_iq_recordings.pop(recording_id)
        # Find the broadcaster to call stop properly
        try:
            radios_cache = await _get_radios(db)
            radio = _get_radio_by_id(radios_cache, row.radio_id)
            if radio:
                broadcaster = sdr_svc.get_broadcaster(radio["host"], radio["port"])
                if broadcaster:
                    broadcaster.stop_iq_recording(q)
                    await asyncio.sleep(0.2)  # let drain task finish flushing
        except Exception as exc:
            logger.warning("Error stopping IQ recording %d: %s", recording_id, exc)

    # Save WAV file
    rdir = _recordings_dir()
    rdir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    wav_path = rdir / f"{recording_id}.wav"
    wav_path.write_bytes(content)

    # Update IQ file size if it was recorded
    iq_file_size = 0
    if row.has_iq_file:
        iq_path = rdir / f"{recording_id}.u8"
        if iq_path.exists():
            iq_file_size = iq_path.stat().st_size

    if not ended_at:
        ended_at = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    row.name = name or row.name
    row.ended_at = ended_at
    row.duration_s = duration_s
    row.file_size_bytes = len(content)
    row.iq_file_size_bytes = iq_file_size
    row.status = "complete"
    await db.commit()
    await db.refresh(row)
    return JSONResponse(_recording_to_dict(row))


@router.patch("/api/sdr/recordings/{rec_id}")
async def update_recording(rec_id: int, body: RecordingPatchIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRecording).where(SdrRecording.id == rec_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Recording not found")
    if body.name is not None:
        row.name = body.name
    if body.notes is not None:
        row.notes = body.notes
    await db.commit()
    await db.refresh(row)
    return JSONResponse(_recording_to_dict(row))


@router.delete("/api/sdr/recordings/{rec_id}", status_code=204)
async def delete_recording(rec_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRecording).where(SdrRecording.id == rec_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Recording not found")
    rdir = _recordings_dir()
    for ext in ("wav", "u8"):
        p = rdir / f"{rec_id}.{ext}"
        if p.exists():
            p.unlink()
    await db.delete(row)
    await db.commit()


@router.get("/api/sdr/recordings/{rec_id}/file")
async def get_recording_wav(rec_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRecording).where(SdrRecording.id == rec_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Recording not found")
    wav_path = _recordings_dir() / f"{rec_id}.wav"
    if not wav_path.exists():
        raise HTTPException(404, "WAV file not found on disk")
    safe = "".join(c for c in row.name if c.isalnum() or c in " _-").strip() or f"recording_{rec_id}"
    return FileResponse(str(wav_path), media_type="audio/wav", filename=f"{safe}.wav")


@router.get("/api/sdr/recordings/{rec_id}/iq")
async def get_recording_iq(rec_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRecording).where(SdrRecording.id == rec_id))).scalar_one_or_none()
    if not row or not row.has_iq_file:
        raise HTTPException(404, "IQ file not found")
    iq_path = _recordings_dir() / f"{rec_id}.u8"
    if not iq_path.exists():
        raise HTTPException(404, "IQ file not found on disk")
    safe = "".join(c for c in row.name if c.isalnum() or c in " _-").strip() or f"recording_{rec_id}"
    return FileResponse(str(iq_path), media_type="application/octet-stream", filename=f"{safe}.u8")


# ── Connection control ────────────────────────────────────────────────────────


@router.post("/api/sdr/connect")
async def connect_radio(body: ConnectIn, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, body.radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    try:
        conn = await sdr_svc.get_or_create_connection(radio["host"], radio["port"])
        try:
            if body.sample_rate is not None:
                await conn.set_sample_rate(body.sample_rate)
            if body.frequency_hz is not None:
                await conn.set_frequency(body.frequency_hz)
            if body.gain_auto is not None:
                if body.gain_auto:
                    await conn.set_gain_auto()
                elif body.gain_db is not None:
                    await conn.set_gain_manual(body.gain_db)
        except sdr_svc.ReadOnlyTuningError:
            # Another instance owns the shared tuner: connect as a read-only
            # follower rather than failing. Hardware tuning is left untouched; the
            # follower tracks the owner's tuning via the control channel.
            logger.info("Radio %s connected read-only (another instance owns tuning)", body.radio_id)
        # Demodulation mode is per-instance (it shapes this client's audio, not the
        # shared hardware), so a follower may still set it.
        if body.mode is not None:
            conn.mode = body.mode
    except ConnectionError as exc:
        raise HTTPException(503, str(exc)) from exc
    return JSONResponse(
        {
            "status": "connected",
            "radio_id": body.radio_id,
            "is_owner": conn.is_owner,
            "control_available": conn.control_available,
            "locked": conn.tuner_locked,
        }
    )


@router.post("/api/sdr/disconnect")
async def disconnect_radio(body: DisconnectIn, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, body.radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    await sdr_svc.close_connection(radio["host"], radio["port"])
    return JSONResponse({"status": "disconnected"})


@router.get("/api/sdr/status/{radio_id}")
async def radio_status(radio_id: int, db: AsyncSession = Depends(get_db)):
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    status = await sdr_svc.reachability_status(radio["host"], radio["port"])
    return JSONResponse({"radio_id": radio_id, "radio_name": radio["name"], **status})


# ── WebSocket bridge ──────────────────────────────────────────────────────────


async def _resolve_broadcaster(
    radio_id: int,
    websocket: WebSocket,
) -> tuple[sdr_svc.RadioBroadcaster, dict] | tuple[None, None]:
    """Look up a radio by id and return a running broadcaster for it.

    Sends an error frame and closes the WebSocket on failure.
    Returns (broadcaster, radio_dict) on success, or (None, None) on failure.
    """
    from backend.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, radio_id)

    if not radio:
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "code": "NOT_FOUND", "message": f"Radio {radio_id} not found"})
            )
        except Exception:
            pass
        try:
            await websocket.close()
        except RuntimeError:
            pass
        return None, None

    broadcaster = None
    last_exc: Exception = RuntimeError("unknown")
    for attempt in range(3):
        try:
            broadcaster = await sdr_svc.get_or_create_broadcaster(radio["host"], radio["port"])
            break
        except ConnectionError as exc:
            last_exc = exc
            if attempt < 2:
                await asyncio.sleep(1)

    if broadcaster is None:
        try:
            await websocket.send_text(json.dumps({"type": "error", "code": "CONNECT_FAILED", "message": str(last_exc)}))
        except Exception:
            pass
        try:
            await websocket.close()
        except RuntimeError:
            pass
        return None, None

    return broadcaster, radio


async def _handle_trunk_command(
    websocket: WebSocket,
    radio: dict,
    broadcaster: sdr_svc.RadioBroadcaster,
    msg: dict,
) -> None:
    """Apply a ``trunk_decode`` control-socket command.

    Enabling sets the desired trunk config (validated channel-map CSV), ensures
    the decode bridge + rigctld server are running, and — if the decoder was
    already decoding without trunk flags — bounces it so the sidecar relaunches
    dsd-fme in trunk mode. Disabling clears the config, stops the rigctld server,
    and bounces the decoder back to plain decode. A ``trunk_status`` frame is
    sent back to the browser either way.
    """
    enabled = bool(msg.get("enabled"))
    if enabled:
        try:
            sdr_rigctl.set_trunk_config(
                enabled=True,
                channel_map=msg.get("channel_map"),
                group_list=msg.get("group_list"),
            )
        except ValueError as exc:
            await websocket.send_text(json.dumps({"type": "trunk_status", "enabled": False, "error": str(exc)}))
            return
        bridge = await sdr_decode.get_or_create_bridge(radio["host"], radio["port"], broadcaster)
        was_running = bridge.running
        await bridge.start(
            offset_hz=int(msg.get("offset_hz", 0) or 0),
            bw_hz=int(msg.get("bw_hz", 0) or 0) or None,
        )
        # The channel tuned at enable time is the control channel; record it so
        # retune events can be labelled control-channel vs voice.
        sdr_rigctl.set_control_channel(bridge.connection.center_hz + bridge.current_offset_hz)
        await sdr_rigctl.start_rigctl_server()
        # If decode was already live, dsd-fme is connected without trunk flags;
        # force it to relaunch so it picks up the new config. A fresh start needs
        # no bounce — the sidecar connects with trunk flags on its next cycle.
        if was_running:
            bridge.bounce_decoder()
        await websocket.send_text(json.dumps({"type": "trunk_status", "enabled": True}))
    else:
        sdr_rigctl.reset_trunk_config()
        await sdr_rigctl.stop_rigctl_server()
        bridge = sdr_decode.get_bridge(radio["host"], radio["port"])
        if bridge is not None and bridge.running:
            bridge.bounce_decoder()
        await websocket.send_text(json.dumps({"type": "trunk_status", "enabled": False}))


@router.websocket("/ws/sdr/{radio_id}/iq")
async def sdr_iq_websocket(radio_id: int, websocket: WebSocket):
    """Stream raw IQ binary frames to a single client.

    Binary frame layout (little-endian):
      bytes 0-3  : uint32 sample_rate (Hz)
      bytes 4-7  : uint32 center_hz
      bytes 8+   : uint8 IQ pairs (I, Q, I, Q, …) as received from rtl_tcp

    The client decodes: sample = (byte - 127.5) / 127.5 for each I and Q byte.
    """
    await websocket.accept()

    broadcaster, _radio = await _resolve_broadcaster(radio_id, websocket)
    if broadcaster is None:
        return

    queue = broadcaster.subscribe_iq()
    try:
        while True:
            payload = await queue.get()
            if payload is None:  # recording stopped / broadcaster shutdown
                break
            try:
                await websocket.send_bytes(payload)
            except WebSocketDisconnect:
                break
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        broadcaster.unsubscribe_iq(queue)


@router.websocket("/ws/sdr/{radio_id}")
async def sdr_websocket(radio_id: int, websocket: WebSocket):
    """Bridge WebSocket clients to a live rtl_tcp connection.

    The radio must first be configured via POST /api/sdr/connect (or we connect
    on-demand here if a radio with this id exists in the DB).

    Outbound (server→client):
      { type: "spectrum", center_hz, sample_rate, bins, timestamp_ms }
      { type: "status",   connected, radio_id, radio_name, center_hz, mode, gain_db, gain_auto, is_owner, control_available, locked }
      { type: "control",  is_owner, control_available, locked, center_hz, sample_rate, gain_db, gain_auto, mode,
                          offset_hz, bw_hz, scan_active, scan_groups, search_active, search_low_hz, search_high_hz, search_current_hz }
                          — tuning ownership changed: another instance took/released the
                            shared tuner, or this client's retune was refused (read-only).
                            `locked` = the tuner is held by some instance (vs free to claim).
                            The sweep_* fields mirror the owner's scan/search overlay.
      { type: "error",    code, message }

    Inbound (client→server):
      { cmd: "tune",        frequency_hz }
      { cmd: "mode",        mode }
      { cmd: "release" }    — owner hands the shared tuner back (stopped/deselected)
      { cmd: "claim" }      — actively-watching follower auto-takes a freed tuner
      { cmd: "demod",       offset_hz, mode, bw_hz }
                          — owner's within-band demod state (NCO offset, mode, audio
                            bandwidth); forwarded to followers so they mirror the exact
                            channel the owner hears, not just the hardware centre.
      { cmd: "sweep_state", scan_active, scan_groups, search_active,
                            search_low_hz, search_high_hz, search_current_hz }
                          — owner's scanner/search sweep state; forwarded to followers
                            so they render the same "paused during active scan/search"
                            overlay. Search bounds are null when not searching.
      { cmd: "gain",        gain_db }   — null/omit for auto
      { cmd: "squelch",     squelch_dbfs }
      { cmd: "sample_rate", rate_hz }
      { cmd: "fft_size",    bins }       — desired spectrum bin count; backend clamps to a power of two in [1024, 8192]. Shared across subscribers (last writer wins).
      { cmd: "ping" }
    """
    await websocket.accept()

    broadcaster, radio = await _resolve_broadcaster(radio_id, websocket)
    if broadcaster is None:
        return

    conn = sdr_svc.get_connection(radio["host"], radio["port"])

    # Send initial status — connected=False until the first spectrum frame confirms
    # data is actually flowing from the physical device
    try:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "status",
                    "connected": False,
                    "radio_id": radio["id"],
                    "radio_name": radio["name"],
                    "center_hz": conn.center_hz,
                    "sample_rate": conn.sample_rate,
                    "mode": conn.mode,
                    "gain_db": conn.gain_db,
                    "gain_auto": conn.gain_auto,
                    "offset_hz": conn.demod_offset_hz,
                    "bw_hz": conn.bw_hz,
                    "is_owner": conn.is_owner,
                    "control_available": conn.control_available,
                    "locked": conn.tuner_locked,
                    "scan_active": conn.scan_active,
                    "scan_groups": conn.scan_groups,
                    "search_active": conn.search_active,
                    "search_low_hz": conn.search_low_hz,
                    "search_high_hz": conn.search_high_hz,
                    "search_current_hz": conn.search_current_hz,
                }
            )
        )
    except WebSocketDisconnect:
        return

    # Subscribe to the broadcaster queue for this client
    queue = broadcaster.subscribe()

    async def _read_commands():
        """Background task: receive JSON commands from browser and apply them."""
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                cmd = msg.get("cmd")
                try:
                    if cmd == "tune":
                        await conn.set_frequency(int(msg["frequency_hz"]))
                    elif cmd == "mode":
                        # Forward the demod mode to read-only followers over the relay
                        # control channel, the same way `tune` forwards the centre
                        # frequency. A follower has no other carrier for the mode (the
                        # spectrum stream conveys only the hardware centre), so without
                        # this it tracks the owner's frequency but stays stuck on its
                        # old mode when the owner switches AM/FM/etc. set_demod stores
                        # the mode locally and only publishes while we own the shared
                        # tuner (a no-op for a single instance / raw rtl_tcp),
                        # preserving the current within-band offset and bandwidth.
                        await conn.set_demod(
                            offset_hz=conn.demod_offset_hz,
                            mode=str(msg.get("mode", conn.mode)),
                            bw_hz=conn.bw_hz,
                        )
                    elif cmd == "release":
                        # Owner is done (stopped/deselected): hand the shared tuner
                        # back so another instance can take over. No-op unless we own it.
                        await conn.release_ownership()
                    elif cmd == "claim":
                        # An actively-watching follower auto-takes a freed tuner so
                        # control passes cleanly to it when the owner stops. The relay
                        # grants it only if the token is free (never steals a live owner).
                        await conn.claim_ownership()
                    elif cmd == "demod":
                        # Owner publishes its demod state (offset within the band,
                        # mode, audio bandwidth) so read-only followers mirror the
                        # exact channel it is listening to, not just the hardware
                        # centre. No-op on hardware; forwarded to the relay only
                        # while this instance owns the tuner (see set_demod).
                        await conn.set_demod(
                            offset_hz=int(msg.get("offset_hz", 0) or 0),
                            mode=str(msg.get("mode", conn.mode)),
                            bw_hz=int(msg.get("bw_hz", 0) or 0),
                        )
                    elif cmd == "sweep_state":
                        # Owner publishes its scanner/search sweep state so read-only
                        # followers render the same "paused during active scan/search"
                        # overlay. Inputs are validated/clamped here (untrusted client
                        # JSON); forwarded to the relay only while we own the tuner.
                        raw_groups = msg.get("scan_groups")
                        scan_groups = (
                            [str(name)[:MAX_SCAN_GROUP_NAME_LEN] for name in raw_groups[:MAX_SCAN_GROUPS]]
                            if isinstance(raw_groups, list)
                            else []
                        )
                        await conn.set_sweep_state(
                            scan_active=bool(msg.get("scan_active")),
                            scan_groups=scan_groups,
                            search_active=bool(msg.get("search_active")),
                            search_low_hz=_sanitize_optional_hz(msg.get("search_low_hz")),
                            search_high_hz=_sanitize_optional_hz(msg.get("search_high_hz")),
                            search_current_hz=_sanitize_optional_hz(msg.get("search_current_hz")),
                        )
                    elif cmd == "gain":
                        gval = msg.get("gain_db")
                        if gval is None:
                            await conn.set_gain_auto()
                        else:
                            await conn.set_gain_manual(float(gval))
                    elif cmd == "sample_rate":
                        await conn.set_sample_rate(int(msg["rate_hz"]))
                    elif cmd == "fft_size":
                        conn.set_fft_size(int(msg["bins"]))
                    elif cmd == "digital_decode":
                        if bool(msg.get("enabled")):
                            bridge = await sdr_decode.get_or_create_bridge(radio["host"], radio["port"], broadcaster)
                            await bridge.start(
                                offset_hz=int(msg.get("offset_hz", 0) or 0),
                                bw_hz=int(msg.get("bw_hz", 0) or 0) or None,
                            )
                        else:
                            await sdr_decode.stop_bridge(radio["host"], radio["port"])
                    elif cmd == "digital_channel":
                        bridge = sdr_decode.get_bridge(radio["host"], radio["port"])
                        if bridge is not None:
                            bridge.set_channel(
                                offset_hz=int(msg.get("offset_hz", 0) or 0),
                                bw_hz=int(msg.get("bw_hz", 0) or 0) or None,
                            )
                    elif cmd == "trunk_decode":
                        await _handle_trunk_command(websocket, radio, broadcaster, msg)
                    elif cmd == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                except sdr_svc.ReadOnlyTuningError:
                    # Another instance owns the shared tuner — the change was not
                    # applied. Tell the browser it is read-only so it can disable
                    # its tuning controls and reflect the owner's real tuning.
                    try:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "control",
                                    "is_owner": False,
                                    "control_available": conn.control_available,
                                    "locked": conn.tuner_locked,
                                    "center_hz": conn.center_hz,
                                    "sample_rate": conn.sample_rate,
                                    "gain_db": conn.gain_db,
                                    "gain_auto": conn.gain_auto,
                                    "mode": conn.mode,
                                    "offset_hz": conn.demod_offset_hz,
                                    "bw_hz": conn.bw_hz,
                                }
                            )
                        )
                    except (WebSocketDisconnect, RuntimeError):
                        pass
                except Exception as exc:
                    logger.warning("SDR command error: %s", exc)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    cmd_task = asyncio.create_task(_read_commands())

    # Stream loop: pull frames from the shared broadcaster queue and forward them
    try:
        while True:
            frame = await queue.get()
            if frame is None:  # broadcaster stopped (server shutdown)
                break
            try:
                await websocket.send_text(json.dumps(frame))
            except (WebSocketDisconnect, RuntimeError):
                break
            if frame.get("type") == "error":
                break

    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    finally:
        broadcaster.unsubscribe(queue)
        cmd_task.cancel()
        try:
            await cmd_task
        except asyncio.CancelledError:
            pass
        # A decode session must never outlive its control socket — and neither
        # should trunk tracking, so tear down the rigctld server with it.
        await sdr_decode.stop_bridge(radio["host"], radio["port"])
        sdr_rigctl.reset_trunk_config()
        await sdr_rigctl.stop_rigctl_server()


# ── Digital decode (dsd-fme sidecar) ────────────────────────────────────────────


@router.post("/api/sdr/decode/ingest")
async def ingest_decode_event(
    body: DecodeEventIn,
    x_decode_secret: str = Header(default=""),
):
    """Receive a decoded event from the dsd-fme sidecar and fan it to WS clients.

    Authenticated with a shared secret. Fails closed: if no secret is configured,
    ingestion is disabled entirely. The event is routed to the single active
    decode session — only one decoder runs at a time — so the sidecar needs no
    knowledge of which radio is selected. The backend stays decoder-agnostic: it
    only relays validated JSON onto the active bridge's event subscribers.
    """
    secret = sdr_decode.resolve_ingest_secret()
    if not secret:
        raise HTTPException(503, "decode ingestion disabled")
    if not secrets.compare_digest(x_decode_secret, secret):
        raise HTTPException(401, "invalid decode secret")
    bridge = sdr_decode.get_active_bridge()
    if bridge is None:
        raise HTTPException(409, "decode not active")
    # Default the frame type so the frontend can route it; the decoder may
    # override it (e.g. "decode_status") via its own "type" key.
    bridge.publish_event({"type": "decode_event", **body.event})
    return JSONResponse({"status": "ok"})


@router.get("/api/sdr/decode/config")
async def decode_config(x_decode_secret: str = Header(default="")):
    """Report the decoder's desired trunk config to the dsd-fme sidecar supervisor.

    Authenticated with the same shared secret as ingest (fails closed). The
    supervisor polls this before each dsd-fme launch to decide whether to add the
    trunking + rigctl flags and which channel-map CSV to load. ``rigctl_port`` is
    the port the backend's rigctld server listens on (and that dsd-fme connects to
    via the sidecar's localhost forwarder).

    ``active`` reports whether a decode session is actually serving PCM. The
    supervisor gates on it: with no active session the PCM feed isn't listening, so
    launching dsd-fme just makes it fail to connect and spew startup output that the
    ingest endpoint rejects with 409 — a flood of wasted requests. When ``active``
    is false the supervisor idles instead of launching.
    """
    secret = sdr_decode.resolve_ingest_secret()
    if not secret:
        raise HTTPException(503, "decode ingestion disabled")
    if not secrets.compare_digest(x_decode_secret, secret):
        raise HTTPException(401, "invalid decode secret")
    bridge = sdr_decode.get_active_bridge()
    return JSONResponse(
        {
            "trunk": sdr_rigctl.get_trunk_config().as_dict(),
            "rigctl_port": settings.decoder_rigctl_port,
            "active": bool(bridge and bridge.running),
        }
    )


# ── APRS decode (Direwolf sidecar) ──────────────────────────────────────────────


@router.post("/api/sdr/aprs/start")
async def aprs_start(body: AprsControlIn, db: AsyncSession = Depends(get_db)):
    """Start (or retune) background APRS decode on a radio and persist the choice.

    Independent of the SDR view: the APRS bridge subscribes to the radio's IQ
    fan-out (keeping its broadcaster alive) and serves PCM to the Direwolf
    sidecar until explicitly stopped, so it keeps feeding the Land map even when
    another radio is being viewed. The enabled radio is persisted so it resumes
    on restart (see :func:`resume_persisted_aprs`).
    """
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, body.radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    try:
        broadcaster = await sdr_svc.get_or_create_broadcaster(radio["host"], radio["port"])
    except ConnectionError as exc:
        raise HTTPException(502, f"radio connect failed: {exc}") from exc
    bridge = await sdr_decode.get_or_create_aprs_bridge(radio["host"], radio["port"], broadcaster)
    await bridge.start(offset_hz=body.offset_hz, bw_hz=body.bw_hz or None)
    await upsert_setting(db, "sdr", "aprs_radio_id", body.radio_id)
    return JSONResponse({"status": "ok", "radio_id": body.radio_id, "active": True})


@router.post("/api/sdr/aprs/stop")
async def aprs_stop(body: AprsControlIn, db: AsyncSession = Depends(get_db)):
    """Stop background APRS decode on a radio and clear the persisted choice."""
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, body.radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    await sdr_decode.stop_aprs_bridge(radio["host"], radio["port"])
    await upsert_setting(db, "sdr", "aprs_radio_id", None)
    return JSONResponse({"status": "ok", "radio_id": body.radio_id, "active": False})


@router.get("/api/sdr/aprs/status/{radio_id}")
async def aprs_status(radio_id: int, db: AsyncSession = Depends(get_db)):
    """Report whether APRS decode is running for a radio and decoder reachability."""
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    bridge = sdr_decode.get_aprs_bridge(radio["host"], radio["port"])
    return JSONResponse(
        {
            "radio_id": radio_id,
            "active": bool(bridge and bridge.running),
            "decoder_reachable": bool(bridge and bridge.decoder_reachable),
        }
    )


@router.post("/api/sdr/aprs/ingest")
async def ingest_aprs_event(body: DecodeEventIn, x_decode_secret: str = Header(default="")):
    """Receive a decoded APRS event from the Direwolf sidecar and fan it out.

    Authenticated with the same shared secret as the voice ingest (fails closed).
    Position-bearing packets are upserted into the APRS station store for the
    Land map; every event is also relayed to the active APRS session's WS
    subscribers (the waterfall panels), mirroring the voice ingest contract. Raw
    TNC2 ``log`` events and status frames carry no position and are relay-only.
    """
    secret = sdr_decode.resolve_ingest_secret()
    if not secret:
        raise HTTPException(503, "decode ingestion disabled")
    if not secrets.compare_digest(x_decode_secret, secret):
        raise HTTPException(401, "invalid decode secret")
    bridge = sdr_decode.get_active_aprs_bridge()
    if bridge is None:
        raise HTTPException(409, "aprs decode not active")
    station = aprs_store.station_from_event(body.event)
    if station is not None:
        await aprs_store.upsert_station(station, now_ms())
    # Default the frame type to "aprs" so the frontend can route it; the sidecar
    # may override it (e.g. "log", "decode_status") via its own "type" key.
    bridge.publish_event({"type": "aprs", **body.event})
    return JSONResponse({"status": "ok"})


@router.get("/api/sdr/aprs/config")
async def aprs_decode_config(x_decode_secret: str = Header(default="")):
    """Report whether an APRS decode session is serving PCM, for the sidecar.

    Secret-authed twin of the voice ``decode_config``. The Direwolf supervisor
    gates on ``active`` exactly as the dsd-fme supervisor does: with no session
    the PCM port isn't listening, so launching Direwolf would just fail to
    connect and flood ingest with rejected startup output.
    """
    secret = sdr_decode.resolve_ingest_secret()
    if not secret:
        raise HTTPException(503, "decode ingestion disabled")
    if not secrets.compare_digest(x_decode_secret, secret):
        raise HTTPException(401, "invalid decode secret")
    bridge = sdr_decode.get_active_aprs_bridge()
    return JSONResponse({"active": bool(bridge and bridge.running)})


async def resume_persisted_aprs() -> None:
    """Restart APRS decode on the persisted radio at startup, if one was enabled.

    Best-effort: a missing radio or an unreachable dongle is logged and skipped
    so a failed resume never blocks application startup. Called from the app
    lifespan after tables/settings are ready.
    """
    from backend.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        radio_id = await get_setting(db, "sdr", "aprs_radio_id", default=None)
        if not isinstance(radio_id, int):
            return
        radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, radio_id)
    if not radio:
        logging.getLogger(__name__).warning("Persisted APRS radio %s not found; skipping resume", radio_id)
        return
    try:
        broadcaster = await sdr_svc.get_or_create_broadcaster(radio["host"], radio["port"])
        bridge = await sdr_decode.get_or_create_aprs_bridge(radio["host"], radio["port"], broadcaster)
        await bridge.start()
    except (ConnectionError, OSError):
        logging.getLogger(__name__).exception("Failed to resume APRS decode on radio %s", radio_id)


@router.get("/api/sdr/trunk/channel-maps")
async def list_channel_maps():
    """List the trunking channel-map / group-list CSV filenames available to select.

    Reads the mounted channel-maps directory and returns the plain ``*.csv``
    filenames (sorted), each re-validated as a safe name. Returns an empty list
    if the directory is absent (e.g. a dev run without any maps), so the UI
    simply shows no options rather than erroring.
    """
    maps_dir = Path(settings.channel_maps_dir)
    names: list[str] = []
    try:
        for entry in sorted(maps_dir.iterdir()):
            if not entry.is_file():
                continue
            try:
                safe = sdr_rigctl.validate_csv_name(entry.name)
            except ValueError:
                continue
            if safe:
                names.append(safe)
    except OSError:
        pass
    return JSONResponse({"channel_maps": names})


@router.get("/api/sdr/decode/status/{radio_id}")
async def decode_status(radio_id: int, db: AsyncSession = Depends(get_db)):
    """Report whether digital decode is active for a radio and decoder reachability."""
    radios = await _get_radios(db)
    radio = _get_radio_by_id(radios, radio_id)
    if not radio:
        raise HTTPException(404, "Radio not found")
    bridge = sdr_decode.get_bridge(radio["host"], radio["port"])
    return JSONResponse(
        {
            "radio_id": radio_id,
            "active": bridge is not None,
            "decoder_reachable": bool(bridge and bridge.decoder_reachable),
        }
    )


async def _wait_for_bridge(host: str, port: int, timeout: float = 3.0) -> sdr_decode.PcmDecodeBridge | None:
    """Poll briefly for a decode bridge (voice or APRS) to appear for this radio.

    The bridge is created asynchronously — a voice bridge by the control socket's
    `digital_decode` command (which may race the opening of this socket), or an
    APRS bridge by the `/api/sdr/aprs/start` endpoint. A radio runs at most one
    kind at a time, so whichever registry has it is the right bridge to stream.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        bridge = sdr_decode.get_bridge(host, port) or sdr_decode.get_aprs_bridge(host, port)
        if bridge is not None:
            return bridge
        await asyncio.sleep(0.1)
    return None


@router.websocket("/ws/sdr/{radio_id}/decode")
async def sdr_decode_websocket(radio_id: int, websocket: WebSocket):
    """Stream decoded events (text JSON) for a radio's active decode session.

    Outbound: { type: "decode_event", … } and { type: "decode_status", decoder_reachable }.
    """
    await websocket.accept()
    broadcaster, radio = await _resolve_broadcaster(radio_id, websocket)
    if broadcaster is None:
        return
    bridge = await _wait_for_bridge(radio["host"], radio["port"])
    if bridge is None:
        try:
            await websocket.send_text(
                json.dumps({"type": "decode_status", "active": False, "decoder_reachable": False})
            )
        except Exception:
            pass
        try:
            await websocket.close()
        except RuntimeError:
            pass
        return
    queue = bridge.subscribe_events()
    try:
        while True:
            event = await queue.get()
            if event is None:  # bridge stopped
                break
            try:
                await websocket.send_text(json.dumps(event))
            except (WebSocketDisconnect, RuntimeError):
                break
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        bridge.unsubscribe_events(queue)


@router.websocket("/ws/sdr/{radio_id}/decode/audio")
async def sdr_decode_audio_websocket(radio_id: int, websocket: WebSocket):
    """Stream decoded voice PCM (binary) for a radio's active decode session.

    Frames are the raw PCM datagrams dsd-fme emits over UDP (48 kHz s16 mono).
    """
    await websocket.accept()
    broadcaster, radio = await _resolve_broadcaster(radio_id, websocket)
    if broadcaster is None:
        return
    bridge = await _wait_for_bridge(radio["host"], radio["port"])
    # Only the voice bridge produces decoded audio; APRS has no voice stream, so
    # close cleanly if this radio is running an APRS decode instead.
    if not isinstance(bridge, sdr_decode.DigitalDecodeBridge):
        try:
            await websocket.close()
        except RuntimeError:
            pass
        return
    queue = bridge.subscribe_audio()
    try:
        while True:
            payload = await queue.get()
            if payload is None:  # bridge stopped
                break
            try:
                await websocket.send_bytes(payload)
            except (WebSocketDisconnect, RuntimeError):
                break
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        bridge.unsubscribe_audio(queue)
