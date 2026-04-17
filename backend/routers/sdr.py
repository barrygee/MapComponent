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
  PUT    /api/sdr/frequencies/{id}        — update a frequency
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
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.cache import now_ms
from backend.config import settings
from backend.database import get_db
from backend.models import SdrFrequencyGroup, SdrRecording, SdrStoredFrequency, UserSettings
from backend.services import sdr as sdr_svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sdr"])


# ── Pydantic request schemas ──────────────────────────────────────────────────

class RadioIn(BaseModel):
    name: str
    host: str
    port: int = 1234
    description: str = ""
    enabled: bool = True
    bandwidth: Optional[int]   = None
    rf_gain:   Optional[float] = None
    agc:       Optional[bool]  = None


class GroupIn(BaseModel):
    name: str
    color: str = "#c8ff00"
    sort_order: int = 0


class FrequencyIn(BaseModel):
    group_id: Optional[int] = None
    label: str
    frequency_hz: int
    mode: str = "AM"
    squelch: float = -60.0
    gain: float = 30.0
    scannable: bool = True
    notes: str = ""


class ConnectIn(BaseModel):
    radio_id: int
    frequency_hz: Optional[int] = None   # None = preserve current freq
    mode: Optional[str] = None           # None = preserve current mode
    gain_db: Optional[float] = None      # None = preserve current gain
    gain_auto: Optional[bool] = None     # None = preserve current AGC state
    squelch_dbfs: float = -60.0
    sample_rate: Optional[int] = None    # None = preserve current sample rate


class DisconnectIn(BaseModel):
    radio_id: int


class RecordingStartIn(BaseModel):
    radio_id: Optional[int] = None
    radio_name: str = ""
    frequency_hz: int
    mode: str = "AM"
    gain_db: float = 30.0
    squelch_dbfs: float = -60.0
    sample_rate: int = 2_048_000


class RecordingPatchIn(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


# ── Radio helpers — read/write sdr.radios from UserSettings ──────────────────

async def _get_radios(db: AsyncSession) -> list[dict]:
    """Read the sdr.radios array from UserSettings. Returns [] if not set."""
    row = (await db.execute(
        select(UserSettings).where(
            UserSettings.namespace == "sdr",
            UserSettings.key == "radios",
        )
    )).scalar_one_or_none()
    if row is None:
        return []
    try:
        val = json.loads(row.value)
        return val if isinstance(val, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


async def _save_radios(db: AsyncSession, radios: list[dict]) -> None:
    """Write the sdr.radios array back to UserSettings (upsert)."""
    row = (await db.execute(
        select(UserSettings).where(
            UserSettings.namespace == "sdr",
            UserSettings.key == "radios",
        )
    )).scalar_one_or_none()
    ts = now_ms()
    value_str = json.dumps(radios)
    if row:
        row.value = value_str
        row.updated_at = ts
    else:
        db.add(UserSettings(namespace="sdr", key="radios", value=value_str, updated_at=ts))
    await db.commit()


def _group_to_dict(g: SdrFrequencyGroup) -> dict:
    return {
        "id": g.id,
        "name": g.name,
        "color": g.color,
        "sort_order": g.sort_order,
        "created_at": g.created_at,
    }


def _freq_to_dict(f: SdrStoredFrequency) -> dict:
    return {
        "id": f.id,
        "group_id": f.group_id,
        "label": f.label,
        "frequency_hz": f.frequency_hz,
        "mode": f.mode,
        "squelch": f.squelch,
        "gain": f.gain,
        "scannable": f.scannable,
        "notes": f.notes,
        "created_at": f.created_at,
    }


def _recording_to_dict(r: SdrRecording) -> dict:
    return {
        "id":                  r.id,
        "name":                r.name,
        "notes":               r.notes,
        "radio_id":            r.radio_id,
        "radio_name":          r.radio_name,
        "frequency_hz":        r.frequency_hz,
        "mode":                r.mode,
        "gain_db":             r.gain_db,
        "squelch_dbfs":        r.squelch_dbfs,
        "sample_rate":         r.sample_rate,
        "started_at":          r.started_at,
        "ended_at":            r.ended_at,
        "duration_s":          r.duration_s,
        "file_size_bytes":     r.file_size_bytes,
        "has_iq_file":         r.has_iq_file,
        "iq_file_size_bytes":  r.iq_file_size_bytes,
        "status":              r.status,
        "created_at":          r.created_at,
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
    group = SdrFrequencyGroup(**body.model_dump(), created_at=now_ms())
    db.add(group)
    await db.commit()
    await db.refresh(group)
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
    return JSONResponse(_group_to_dict(row))


@router.delete("/api/sdr/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrFrequencyGroup).where(SdrFrequencyGroup.id == group_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Group not found")
    # Ungroup any frequencies that belonged to this group
    freqs = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.group_id == group_id))).scalars().all()
    for freq in freqs:
        freq.group_id = None
    await db.delete(row)
    await db.commit()


# ── Frequency CRUD ────────────────────────────────────────────────────────────

@router.get("/api/sdr/frequencies")
async def list_frequencies(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SdrStoredFrequency).order_by(SdrStoredFrequency.group_id, SdrStoredFrequency.frequency_hz))).scalars().all()
    return JSONResponse([_freq_to_dict(freq) for freq in rows])


@router.post("/api/sdr/frequencies", status_code=201)
async def create_frequency(body: FrequencyIn, db: AsyncSession = Depends(get_db)):
    freq = SdrStoredFrequency(**body.model_dump(), created_at=now_ms())
    db.add(freq)
    await db.commit()
    await db.refresh(freq)
    return JSONResponse(_freq_to_dict(freq), status_code=201)


@router.put("/api/sdr/frequencies/{freq_id}")
async def update_frequency(freq_id: int, body: FrequencyIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.id == freq_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Frequency not found")
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return JSONResponse(_freq_to_dict(row))


@router.delete("/api/sdr/frequencies/{freq_id}", status_code=204)
async def delete_frequency(freq_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrStoredFrequency).where(SdrStoredFrequency.id == freq_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Frequency not found")
    await db.delete(row)
    await db.commit()


# ── Recording CRUD + file serving ────────────────────────────────────────────

@router.get("/api/sdr/recordings")
async def list_recordings(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(SdrRecording)
        .where(SdrRecording.status == "complete")
        .order_by(SdrRecording.created_at.desc())
    )).scalars().all()
    return JSONResponse([_recording_to_dict(r) for r in rows])


@router.post("/api/sdr/recordings/start", status_code=201)
async def start_recording(body: RecordingStartIn, db: AsyncSession = Depends(get_db)):
    """Create a pending recording row and (optionally) start server-side IQ capture."""
    started_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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
    sdr_settings_row = (await db.execute(
        select(UserSettings).where(
            UserSettings.namespace == "sdr",
            UserSettings.key == "recordRawIq",
        )
    )).scalar_one_or_none()
    record_iq = False
    if sdr_settings_row:
        try:
            record_iq = json.loads(sdr_settings_row.value) is True
        except Exception:
            pass

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
    recording_id: int        = Form(...),
    file: UploadFile         = File(...),
    name: str                = Form(""),
    ended_at: str            = Form(""),
    duration_s: float        = Form(0.0),
    db: AsyncSession         = Depends(get_db),
):
    """Finalise a recording: upload WAV, stop IQ capture, update DB row."""
    row = (await db.execute(
        select(SdrRecording).where(SdrRecording.id == recording_id)
    )).scalar_one_or_none()
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
        ended_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

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
    row = (await db.execute(
        select(SdrRecording).where(SdrRecording.id == rec_id)
    )).scalar_one_or_none()
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
    row = (await db.execute(
        select(SdrRecording).where(SdrRecording.id == rec_id)
    )).scalar_one_or_none()
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
    row = (await db.execute(
        select(SdrRecording).where(SdrRecording.id == rec_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Recording not found")
    wav_path = _recordings_dir() / f"{rec_id}.wav"
    if not wav_path.exists():
        raise HTTPException(404, "WAV file not found on disk")
    safe = "".join(c for c in row.name if c.isalnum() or c in " _-").strip() or f"recording_{rec_id}"
    return FileResponse(str(wav_path), media_type="audio/wav", filename=f"{safe}.wav")


@router.get("/api/sdr/recordings/{rec_id}/iq")
async def get_recording_iq(rec_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(SdrRecording).where(SdrRecording.id == rec_id)
    )).scalar_one_or_none()
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
        if body.sample_rate is not None:
            await conn.set_sample_rate(body.sample_rate)
        if body.frequency_hz is not None:
            await conn.set_frequency(body.frequency_hz)
        if body.gain_auto is not None:
            if body.gain_auto:
                await conn.set_gain_auto()
            elif body.gain_db is not None:
                await conn.set_gain_manual(body.gain_db)
        if body.mode is not None:
            conn.mode = body.mode
    except ConnectionError as exc:
        raise HTTPException(503, str(exc))
    return JSONResponse({"status": "connected", "radio_id": body.radio_id})


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
    status = sdr_svc.connection_status(radio["host"], radio["port"])
    return JSONResponse({"radio_id": radio_id, "radio_name": radio["name"], **status})




# ── WebSocket bridge ──────────────────────────────────────────────────────────

async def _resolve_broadcaster(
    radio_id: int,
    websocket: WebSocket,
) -> "tuple[sdr_svc.RadioBroadcaster, dict] | tuple[None, None]":
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
            await websocket.send_text(json.dumps({"type": "error", "code": "NOT_FOUND", "message": f"Radio {radio_id} not found"}))
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
      { type: "status",   connected, radio_id, radio_name, center_hz, mode, gain_db, gain_auto }
      { type: "error",    code, message }

    Inbound (client→server):
      { cmd: "tune",        frequency_hz }
      { cmd: "mode",        mode }
      { cmd: "gain",        gain_db }   — null/omit for auto
      { cmd: "squelch",     squelch_dbfs }
      { cmd: "sample_rate", rate_hz }
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
        await websocket.send_text(json.dumps({
            "type": "status",
            "connected": False,
            "radio_id": radio["id"],
            "radio_name": radio["name"],
            "center_hz": conn.center_hz,
            "sample_rate": conn.sample_rate,
            "mode": conn.mode,
            "gain_db": conn.gain_db,
            "gain_auto": conn.gain_auto,
        }))
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
                        conn.mode = str(msg.get("mode", "AM"))
                    elif cmd == "gain":
                        gval = msg.get("gain_db")
                        if gval is None:
                            await conn.set_gain_auto()
                        else:
                            await conn.set_gain_manual(float(gval))
                    elif cmd == "sample_rate":
                        await conn.set_sample_rate(int(msg["rate_hz"]))
                    elif cmd == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                except Exception as exc:
                    logger.warning("SDR command error: %s", exc)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    cmd_task = asyncio.create_task(_read_commands())

    # Stream loop: pull frames from the shared broadcaster queue and forward them
    try:
        while True:
            frame = await queue.get()
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
