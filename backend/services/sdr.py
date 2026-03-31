"""SDR service — rtl_tcp connection manager and IQ/FFT processing pipeline.

Each SdrRadio connects to a remote rtl_tcp daemon via a raw asyncio TCP socket.
IQ samples are read by a single background broadcaster task per radio; computed
spectrum frames are fanned out to all subscribed WebSocket queues.  This avoids
the "readexactly() called while another coroutine is already waiting" error that
occurs when multiple WebSocket handlers share the same StreamReader.

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
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# Default FFT parameters
DEFAULT_FFT_SIZE    = 1024   # bins used for spectrum display
DEFAULT_SAMPLE_RATE = 2_048_000
# Read ~85ms worth of IQ per chunk (174080 bytes @ 2.048MHz).
# Large enough to keep the audio worklet buffer full between frames.
READ_CHUNK_SAMPLES  = 87040  # ~85ms @ 2.048MHz
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
    fft_size: int = DEFAULT_FFT_SIZE
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
    """Single read loop per radio; fans computed frames and raw IQ to subscriber queues."""

    def __init__(self, conn: RtlTcpConnection) -> None:
        self._conn = conn
        self._subscribers:    list[asyncio.Queue] = []   # FFT JSON frames
        self._iq_subscribers: list[asyncio.Queue] = []   # raw IQ bytes
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

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
        try:
            while True:
                try:
                    raw_iq = await conn.read_iq_chunk()
                except asyncio.IncompleteReadError:
                    # Dongle briefly stops sending during retune — skip this chunk
                    logger.debug("rtl_tcp incomplete read during retune, skipping")
                    continue
                except (ConnectionError, Exception) as exc:
                    logger.warning("rtl_tcp read error (%s:%d): %s", conn.host, conn.port, exc)
                    conn.connected = False
                    err_frame = {"type": "error", "code": "READ_ERROR", "message": str(exc)}
                    self._broadcast(err_frame)
                    break

                # FFT uses only the first fft_size samples from the chunk
                frame = compute_fft_frame(raw_iq, conn.fft_size, conn.sample_rate, conn.center_hz)
                self._broadcast(frame)
                self._broadcast_iq(raw_iq, conn.sample_rate, conn.center_hz)
        except asyncio.CancelledError:
            pass
        finally:
            logger.info("Broadcaster stopped for %s:%d", conn.host, conn.port)

    def _broadcast(self, frame: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                # Slow consumer — drop oldest frame and push new one
                try:
                    q.get_nowait()
                    q.put_nowait(frame)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
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


# ── FFT ───────────────────────────────────────────────────────────────────────

def _iq_bytes_to_complex(raw: bytes) -> np.ndarray:
    """Convert raw rtl_tcp 8-bit IQ bytes to normalised complex float array."""
    samples = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
    samples = (samples - 127.5) / 127.5
    return samples[0::2] + 1j * samples[1::2]


def _hann_window(n: int) -> np.ndarray:
    return np.hanning(n).astype(np.float32)


def compute_fft_frame(
    raw_iq: bytes,
    n_fft: int,
    sample_rate: int,
    center_hz: int,
) -> dict:
    """Compute a spectrum frame from raw IQ bytes."""
    iq = _iq_bytes_to_complex(raw_iq[:n_fft * 2])
    windowed = iq * _hann_window(len(iq))
    spectrum = np.fft.fftshift(np.fft.fft(windowed, n=n_fft))
    power_db = 10.0 * np.log10(np.abs(spectrum) ** 2 + 1e-12)
    return {
        "type": "spectrum",
        "center_hz": center_hz,
        "sample_rate": sample_rate,
        "bins": [round(float(v), 1) for v in power_db],
        "timestamp_ms": int(time.time() * 1000),
    }


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
