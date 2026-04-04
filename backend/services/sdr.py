"""SDR service — rtl_tcp connection manager and IQ processing pipeline.

Each SdrRadio connects to a remote rtl_tcp daemon via a raw asyncio TCP socket.
IQ samples are read by a single background broadcaster task per radio and fanned
out to all subscribed IQ WebSocket queues.  This avoids the "readexactly() called
while another coroutine is already waiting" error that occurs when multiple
WebSocket handlers share the same StreamReader.

rtl_tcp binary command format: 5 bytes — [cmd_byte (1)] [value (4, big-endian uint32)]
Key commands:
  0x01  set center frequency (Hz)
  0x02  set sample rate (Hz)
  0x03  set gain mode (0=auto, 1=manual)
  0x04  set gain (tenths of dB, e.g. 300 = 30.0 dB)
  0x05  set frequency correction (ppm)
  0x08  set AGC mode (0=off, 1=on)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_SAMPLE_RATE = 2_048_000
# Read ~5ms worth of IQ per chunk (10240 bytes @ 2.048MHz).
# Must stay small so the async loop drains rtl_tcp fast enough to avoid worker timeout.
READ_CHUNK_SAMPLES  = 5120   # ~5ms @ 2.048MHz (multiple of 512 for USB alignment)
READ_CHUNK_BYTES    = READ_CHUNK_SAMPLES * 2  # 2 bytes per IQ pair

# Connection cache: key = "host:port"
_connections: dict[str, "RtlTcpConnection"] = {}
# Broadcaster cache: key = "host:port"
_broadcasters: dict[str, "RadioBroadcaster"] = {}


@dataclass
class RtlTcpConnection:
    host: str
    port: int
    reader: Optional[asyncio.StreamReader] = field(default=None, repr=False)
    writer: Optional[asyncio.StreamWriter] = field(default=None, repr=False)
    connected: bool = False
    center_hz: int = 100_000_000
    sample_rate: int = DEFAULT_SAMPLE_RATE
    gain_db: float = 30.0
    gain_auto: bool = False
    mode: str = "AM"
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    async def connect(self) -> None:
        async with self._lock:
            if self.connected:
                return
            try:
                self.reader, self.writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port),
                    timeout=5.0,
                )
                self.connected = True
                logger.info("Connected to rtl_tcp at %s:%d", self.host, self.port)
                # rtl_tcp sends a 12-byte magic header on connect — discard it
                await asyncio.wait_for(self.reader.read(12), timeout=3.0)
            except Exception as exc:
                self.connected = False
                raise ConnectionError(f"Cannot connect to rtl_tcp at {self.host}:{self.port}: {exc}") from exc

    async def disconnect(self) -> None:
        async with self._lock:
            self.connected = False
            if self.writer:
                try:
                    self.writer.close()
                    await self.writer.wait_closed()
                except Exception:
                    pass
            self.reader = None
            self.writer = None
            logger.info("Disconnected from rtl_tcp at %s:%d", self.host, self.port)

    async def _send_command(self, cmd: int, value: int) -> None:
        if not self.connected or not self.writer:
            raise ConnectionError("Not connected")
        data = bytes([cmd]) + value.to_bytes(4, "big")
        self.writer.write(data)
        await self.writer.drain()

    async def set_frequency(self, freq_hz: int) -> None:
        await self._send_command(0x01, freq_hz)
        self.center_hz = freq_hz

    async def set_sample_rate(self, rate_hz: int) -> None:
        await self._send_command(0x02, rate_hz)
        self.sample_rate = rate_hz

    async def set_gain_auto(self) -> None:
        await self._send_command(0x03, 0)  # gain mode = auto
        await self._send_command(0x08, 1)  # AGC on
        self.gain_auto = True

    async def set_gain_manual(self, gain_db: float) -> None:
        await self._send_command(0x03, 1)  # gain mode = manual
        await self._send_command(0x08, 0)  # AGC off
        tenths = max(0, int(round(gain_db * 10)))
        await self._send_command(0x04, tenths)
        self.gain_db = gain_db
        self.gain_auto = False

    async def read_iq_chunk(self) -> bytes:
        """Read one chunk of IQ pairs (2 bytes each) from rtl_tcp."""
        if not self.connected or not self.reader:
            raise ConnectionError("Not connected")
        data = await asyncio.wait_for(
            self.reader.readexactly(READ_CHUNK_BYTES),
            timeout=10.0,
        )
        return data


# ── Fan-out broadcaster ───────────────────────────────────────────────────────

class RadioBroadcaster:
    """Single read loop per radio; fans raw IQ to subscriber queues."""

    def __init__(self, conn: RtlTcpConnection) -> None:
        self._conn = conn
        self._iq_subscribers: list[asyncio.Queue] = []   # raw IQ bytes
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    def subscribe_iq(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._iq_subscribers.append(q)
        return q

    def unsubscribe_iq(self, q: asyncio.Queue) -> None:
        try:
            self._iq_subscribers.remove(q)
        except ValueError:
            pass

    async def start(self) -> None:
        async with self._lock:
            if self._task and not self._task.done():
                return
            self._task = asyncio.create_task(self._run(), name=f"sdr-broadcast-{self._conn.host}:{self._conn.port}")

    async def stop(self) -> None:
        async with self._lock:
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
                self._task = None

    async def _run(self) -> None:
        conn = self._conn
        logger.info("Broadcaster started for %s:%d", conn.host, conn.port)
        # Queue between the read loop and the process loop — large enough to absorb bursts
        iq_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=16)
        process_task = asyncio.create_task(self._process(iq_queue))
        try:
            while True:
                # Reconnect if needed
                if not conn.connected:
                    try:
                        await conn.connect()
                    except Exception as exc:
                        logger.warning("rtl_tcp reconnect failed (%s:%d): %s — retrying in 2s", conn.host, conn.port, exc)
                        await asyncio.sleep(2)
                        continue

                try:
                    raw_iq = await conn.read_iq_chunk()
                except asyncio.IncompleteReadError:
                    logger.debug("rtl_tcp incomplete read during retune, skipping")
                    continue
                except (ConnectionError, Exception) as exc:
                    logger.warning("rtl_tcp read error (%s:%d): %s — will reconnect", conn.host, conn.port, exc)
                    conn.connected = False
                    await asyncio.sleep(1)
                    continue

                # Drop oldest chunk if process loop is falling behind — never block the read
                if iq_queue.full():
                    try:
                        iq_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                iq_queue.put_nowait(raw_iq)

        except asyncio.CancelledError:
            pass
        finally:
            process_task.cancel()
            try:
                await process_task
            except asyncio.CancelledError:
                pass
            logger.info("Broadcaster stopped for %s:%d", conn.host, conn.port)

    async def _process(self, iq_queue: asyncio.Queue) -> None:
        """Consume raw IQ chunks and fan out to IQ subscribers."""
        conn = self._conn
        try:
            while True:
                raw_iq = await iq_queue.get()
                self._broadcast_iq(raw_iq, conn.sample_rate, conn.center_hz)
        except asyncio.CancelledError:
            pass

    def _broadcast_iq(self, raw_iq: bytes, sample_rate: int, center_hz: int) -> None:
        """Fan raw IQ bytes to IQ subscribers.

        Wire format (binary): 4-byte little-endian uint32 sample_rate,
        4-byte little-endian uint32 center_hz, then raw uint8 IQ pairs.
        """
        if not self._iq_subscribers:
            return
        import struct
        header = struct.pack("<II", sample_rate, center_hz)
        payload = header + raw_iq
        for q in list(self._iq_subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass


# ── Connection cache helpers ──────────────────────────────────────────────────

def get_connection(host: str, port: int) -> Optional[RtlTcpConnection]:
    return _connections.get(f"{host}:{port}")


async def get_or_create_connection(host: str, port: int) -> RtlTcpConnection:
    key = f"{host}:{port}"
    conn = _connections.get(key)
    if conn is None:
        conn = RtlTcpConnection(host=host, port=port)
        _connections[key] = conn
    if not conn.connected:
        await conn.connect()
    return conn


async def close_connection(host: str, port: int) -> None:
    key = f"{host}:{port}"
    broadcaster = _broadcasters.pop(key, None)
    if broadcaster:
        await broadcaster.stop()
    conn = _connections.pop(key, None)
    if conn:
        await conn.disconnect()


def connection_status(host: str, port: int) -> dict:
    conn = get_connection(host, port)
    if conn is None or not conn.connected:
        return {"connected": False}
    return {
        "connected": True,
        "center_hz": conn.center_hz,
        "sample_rate": conn.sample_rate,
        "gain_db": conn.gain_db,
        "gain_auto": conn.gain_auto,
        "mode": conn.mode,
    }


async def get_or_create_broadcaster(host: str, port: int) -> RadioBroadcaster:
    """Return the running broadcaster for this radio, starting it if needed."""
    key = f"{host}:{port}"
    conn = await get_or_create_connection(host, port)
    broadcaster = _broadcasters.get(key)
    if broadcaster is None:
        broadcaster = RadioBroadcaster(conn)
        _broadcasters[key] = broadcaster
    await broadcaster.start()
    return broadcaster
