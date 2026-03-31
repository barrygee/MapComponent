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
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.cache import now_ms
from backend.database import get_db
from backend.models import SdrFrequencyGroup, SdrRadio, SdrStoredFrequency
from backend.services import sdr as sdr_svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sdr"])


# ── Pydantic request schemas ──────────────────────────────────────────────────

class RadioIn(BaseModel):
    name: str
    host: str
    port: int = 8890
    description: str = ""
    enabled: bool = True


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
    frequency_hz: int = 100_000_000
    mode: str = "AM"
    gain_db: float = 30.0
    gain_auto: bool = False
    squelch_dbfs: float = -60.0
    sample_rate: int = 2_048_000


class DisconnectIn(BaseModel):
    radio_id: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _radio_to_dict(r: SdrRadio) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "host": r.host,
        "port": r.port,
        "description": r.description,
        "enabled": r.enabled,
        "created_at": r.created_at,
    }


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


# ── Radio CRUD ────────────────────────────────────────────────────────────────

@router.get("/api/sdr/radios")
async def list_radios(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SdrRadio).order_by(SdrRadio.created_at))).scalars().all()
    return JSONResponse([_radio_to_dict(r) for r in rows])


@router.post("/api/sdr/radios", status_code=201)
async def create_radio(body: RadioIn, db: AsyncSession = Depends(get_db)):
    radio = SdrRadio(**body.model_dump(), created_at=now_ms())
    db.add(radio)
    await db.commit()
    await db.refresh(radio)
    return JSONResponse(_radio_to_dict(radio), status_code=201)


@router.put("/api/sdr/radios/{radio_id}")
async def update_radio(radio_id: int, body: RadioIn, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRadio).where(SdrRadio.id == radio_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Radio not found")
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return JSONResponse(_radio_to_dict(row))


@router.delete("/api/sdr/radios/{radio_id}", status_code=204)
async def delete_radio(radio_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SdrRadio).where(SdrRadio.id == radio_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Radio not found")
    await db.delete(row)
    await db.commit()


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
    for f in freqs:
        f.group_id = None
    await db.delete(row)
    await db.commit()


# ── Frequency CRUD ────────────────────────────────────────────────────────────

@router.get("/api/sdr/frequencies")
async def list_frequencies(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SdrStoredFrequency).order_by(SdrStoredFrequency.group_id, SdrStoredFrequency.frequency_hz))).scalars().all()
    return JSONResponse([_freq_to_dict(f) for f in rows])


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


# ── Connection control ────────────────────────────────────────────────────────

@router.post("/api/sdr/connect")
async def connect_radio(body: ConnectIn, db: AsyncSession = Depends(get_db)):
    radio = (await db.execute(select(SdrRadio).where(SdrRadio.id == body.radio_id))).scalar_one_or_none()
    if not radio:
        raise HTTPException(404, "Radio not found")
    try:
        conn = await sdr_svc.get_or_create_connection(radio.host, radio.port)
        await conn.set_sample_rate(body.sample_rate)
        await conn.set_frequency(body.frequency_hz)
        if body.gain_auto:
            await conn.set_gain_auto()
        else:
            await conn.set_gain_manual(body.gain_db)
        conn.mode = body.mode
    except ConnectionError as exc:
        raise HTTPException(503, str(exc))
    return JSONResponse({"status": "connected", "radio_id": body.radio_id})


@router.post("/api/sdr/disconnect")
async def disconnect_radio(body: DisconnectIn, db: AsyncSession = Depends(get_db)):
    radio = (await db.execute(select(SdrRadio).where(SdrRadio.id == body.radio_id))).scalar_one_or_none()
    if not radio:
        raise HTTPException(404, "Radio not found")
    await sdr_svc.close_connection(radio.host, radio.port)
    return JSONResponse({"status": "disconnected"})


@router.get("/api/sdr/status/{radio_id}")
async def radio_status(radio_id: int, db: AsyncSession = Depends(get_db)):
    radio = (await db.execute(select(SdrRadio).where(SdrRadio.id == radio_id))).scalar_one_or_none()
    if not radio:
        raise HTTPException(404, "Radio not found")
    status = sdr_svc.connection_status(radio.host, radio.port)
    return JSONResponse({"radio_id": radio_id, "radio_name": radio.name, **status})


# ── WebSocket bridge ──────────────────────────────────────────────────────────

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

    from backend.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        radio = (await db.execute(select(SdrRadio).where(SdrRadio.id == radio_id))).scalar_one_or_none()

    if not radio:
        await websocket.send_text(json.dumps({"type": "error", "code": "NOT_FOUND", "message": f"Radio {radio_id} not found"}))
        await websocket.close()
        return

    broadcaster = None
    last_exc: Exception = RuntimeError("unknown")
    for attempt in range(3):
        try:
            broadcaster = await sdr_svc.get_or_create_broadcaster(radio.host, radio.port)
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
        await websocket.close()
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

    # Look up radio in DB (no DB dep injection for WebSocket — open our own session)
    from backend.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        radio = (await db.execute(select(SdrRadio).where(SdrRadio.id == radio_id))).scalar_one_or_none()

    if not radio:
        await websocket.send_text(json.dumps({"type": "error", "code": "NOT_FOUND", "message": f"Radio {radio_id} not found"}))
        await websocket.close()
        return

    # Connect (or reuse) and start the shared broadcaster — retry a few times
    broadcaster = None
    last_exc: Exception = RuntimeError("unknown")
    for attempt in range(3):
        try:
            broadcaster = await sdr_svc.get_or_create_broadcaster(radio.host, radio.port)
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
        await websocket.close()
        return

    conn = sdr_svc.get_connection(radio.host, radio.port)

    # Send initial status
    try:
        await websocket.send_text(json.dumps({
            "type": "status",
            "connected": True,
            "radio_id": radio.id,
            "radio_name": radio.name,
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
            except WebSocketDisconnect:
                break
            if frame.get("type") == "error":
                break

    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        broadcaster.unsubscribe(queue)
        cmd_task.cancel()
        try:
            await cmd_task
        except asyncio.CancelledError:
            pass
