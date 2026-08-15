"""
tests/backend/test_sdr_decode.py

Tests for the server-side FM-demodulation DSP core in
backend/services/sdr_decode.py — the chain that feeds dsd-fme:

    IQ decimate → NCO mix → channel LPF → FM discriminator → resample to 48 kHz

Covered:
    _compute_iq_decim     — integer decimation-factor selection
    _build_lpf_taps       — Hamming-windowed sinc FIR
    DemodState            — carried filter state + reset
    demod_chunk           — full chain, output format, signal correctness,
                            and chunk-boundary continuity
"""

import asyncio
import math
import struct
from pathlib import Path

import numpy as np
import pytest

from backend.config import settings
from backend.services import sdr_decode
from backend.services.sdr_decode import (
    DEFAULT_DECODE_BW_HZ,
    OUTPUT_RATE,
    AprsDecodeBridge,
    DigitalDecodeBridge,
    DemodState,
    _AUDIO_BYTES_PER_SAMPLE,
    _AUDIO_RATE_MEASURE_SECONDS,
    _build_lpf_taps,
    _compute_iq_decim,
    demod_chunk,
)


# ── Synthetic-signal helpers ──────────────────────────────────────────────────


def _fm_iq_bytes(
    audio_hz: float,
    deviation_hz: float,
    carrier_offset_hz: float,
    sample_rate: int,
    n_samples: int,
    start_phase: float = 0.0,
) -> bytes:
    """Build raw uint8 IQ bytes for an FM-modulated tone.

    A single audio tone at ``audio_hz`` frequency-modulates a carrier sitting
    ``carrier_offset_hz`` from the IQ centre, with peak ``deviation_hz``.
    Returns interleaved uint8 I/Q pairs as rtl_tcp delivers them.
    """
    times = (np.arange(n_samples) + start_phase) / sample_rate
    # Instantaneous phase = carrier term + integrated message (FM).
    message_phase = (deviation_hz / audio_hz) * np.sin(2 * math.pi * audio_hz * times)
    phase = 2 * math.pi * carrier_offset_hz * times + message_phase
    iq = 0.7 * np.exp(1j * phase)
    i_bytes = np.clip(np.round(iq.real * 127.5 + 127.5), 0, 255).astype(np.uint8)
    q_bytes = np.clip(np.round(iq.imag * 127.5 + 127.5), 0, 255).astype(np.uint8)
    interleaved = np.empty(n_samples * 2, dtype=np.uint8)
    interleaved[0::2] = i_bytes
    interleaved[1::2] = q_bytes
    return interleaved.tobytes()


def _pcm_to_float(pcm: bytes) -> np.ndarray:
    """Decode s16 LE PCM bytes back to a float array in [-1, 1]."""
    return np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32767.0


# ── _compute_iq_decim ─────────────────────────────────────────────────────────


class TestComputeIqDecim:
    def test_returns_power_of_two(self):
        for sample_rate in (1_024_000, 2_048_000, 2_400_000):
            factor = _compute_iq_decim(sample_rate, DEFAULT_DECODE_BW_HZ)
            assert factor in (1, 2, 4, 8)

    def test_low_rate_not_decimated(self):
        # At 1.024 Msps the floor is already met, so no decimation.
        assert _compute_iq_decim(1_024_000, DEFAULT_DECODE_BW_HZ) == 1

    def test_high_rate_decimated_but_above_floor(self):
        # 2.048 Msps → /2 = 1.024 Msps (still ≥ floor); /4 would drop below it.
        assert _compute_iq_decim(2_048_000, DEFAULT_DECODE_BW_HZ) == 2

    def test_never_exceeds_ceiling(self):
        # An extreme rate must still cap at the factor-8 ceiling.
        assert _compute_iq_decim(64_000_000, DEFAULT_DECODE_BW_HZ) == 8

    def test_wide_bandwidth_raises_floor(self):
        # A very wide channel forces less decimation than a narrow one.
        narrow = _compute_iq_decim(2_048_000, 12_500)
        wide = _compute_iq_decim(2_048_000, 900_000)
        assert wide <= narrow


# ── _build_lpf_taps ───────────────────────────────────────────────────────────


class TestBuildLpfTaps:
    def test_tap_count_is_order_plus_one(self):
        taps = _build_lpf_taps(6_250, 1_024_000)
        assert taps.size == 65

    def test_unity_dc_gain(self):
        # Normalised so the coefficients sum to 1 (0 dB at DC).
        taps = _build_lpf_taps(6_250, 1_024_000)
        assert abs(float(taps.sum()) - 1.0) < 1e-9

    def test_symmetric(self):
        taps = _build_lpf_taps(6_250, 1_024_000)
        assert np.allclose(taps, taps[::-1], atol=1e-12)

    def test_passes_dc_blocks_high_freq(self):
        # A DC (constant) input passes; a near-Nyquist tone is strongly attenuated.
        taps = _build_lpf_taps(6_250, 1_024_000)
        dc_gain = abs(float(taps.sum()))
        nyquist = np.cos(math.pi * np.arange(taps.size))  # alternating ±1
        hf_gain = abs(float((taps * nyquist).sum()))
        assert dc_gain > 0.9
        assert hf_gain < 0.05


# ── DemodState ────────────────────────────────────────────────────────────────


class TestDemodState:
    def test_defaults(self):
        state = DemodState()
        assert state.offset_hz == 0
        assert state.bw_hz == DEFAULT_DECODE_BW_HZ
        assert state.iq_decim == 1

    def test_reset_filters_clears_memory(self):
        state = DemodState()
        state.nco_phase = 1.23
        state.fm_prev = 0.5 + 0.5j
        state.res_phase = 4.0
        state.lpf_taps = np.ones(5)
        state.iq_leftover = np.ones(3, dtype=np.complex128)
        state.reset_filters()
        assert state.nco_phase == 0.0
        assert state.fm_prev == 1 + 0j
        assert state.res_phase == 0.0
        assert state.lpf_taps is None
        assert state.iq_leftover.size == 0


# ── demod_chunk ───────────────────────────────────────────────────────────────


class TestDemodChunk:
    SAMPLE_RATE = 1_024_000  # no IQ decimation at this rate → simplest path

    def test_empty_input_returns_empty(self):
        assert demod_chunk(b"", self.SAMPLE_RATE, DemodState()) == b""

    def test_output_is_s16_pcm(self):
        raw = _fm_iq_bytes(1000, 2500, 0, self.SAMPLE_RATE, 8192)
        pcm = demod_chunk(raw, self.SAMPLE_RATE, DemodState())
        # Even byte count (s16) and non-empty.
        assert len(pcm) > 0
        assert len(pcm) % 2 == 0

    def test_output_rate_is_48k(self):
        # ~40 ms of input should yield ~40 ms of 48 kHz output.
        n_in = int(self.SAMPLE_RATE * 0.040)
        raw = _fm_iq_bytes(1000, 2500, 0, self.SAMPLE_RATE, n_in)
        pcm = demod_chunk(raw, self.SAMPLE_RATE, DemodState())
        n_out = len(pcm) // 2
        expected = OUTPUT_RATE * 0.040
        assert abs(n_out - expected) < expected * 0.05  # within 5%

    def test_unmodulated_carrier_demodulates_near_silence(self):
        # A pure carrier at DC (no modulation) → ~constant discriminator → near 0.
        raw = _fm_iq_bytes(1.0, 0.0, 0, self.SAMPLE_RATE, 8192)
        pcm = demod_chunk(raw, self.SAMPLE_RATE, DemodState())
        audio = _pcm_to_float(pcm)
        assert float(np.mean(np.abs(audio))) < 0.02

    def test_modulated_signal_recovers_audio_tone(self):
        # FM-demodulating a 2 kHz-modulated carrier should produce a 2 kHz tone:
        # the dominant spectral peak of the output sits near 2 kHz.
        audio_hz = 2000.0
        raw = _fm_iq_bytes(audio_hz, 3000, 0, self.SAMPLE_RATE, 48_000)
        pcm = demod_chunk(raw, self.SAMPLE_RATE, DemodState())
        audio = _pcm_to_float(pcm)
        audio = audio - np.mean(audio)
        spectrum = np.abs(np.fft.rfft(audio * np.hanning(audio.size)))
        peak_bin = int(np.argmax(spectrum))
        peak_hz = peak_bin * OUTPUT_RATE / audio.size
        assert abs(peak_hz - audio_hz) < 150

    def test_offset_carrier_is_recovered_via_nco(self):
        # Same tone but the carrier sits +120 kHz off-centre; with the NCO offset
        # set, demodulation still recovers the 2 kHz audio.
        audio_hz = 2000.0
        offset = 120_000
        raw = _fm_iq_bytes(audio_hz, 3000, offset, self.SAMPLE_RATE, 48_000)
        state = DemodState(offset_hz=offset)
        pcm = demod_chunk(raw, self.SAMPLE_RATE, state)
        audio = _pcm_to_float(pcm)
        audio = audio - np.mean(audio)
        spectrum = np.abs(np.fft.rfft(audio * np.hanning(audio.size)))
        peak_hz = int(np.argmax(spectrum)) * OUTPUT_RATE / audio.size
        assert abs(peak_hz - audio_hz) < 150

    def test_chunk_boundary_continuity(self):
        # Demodulating two consecutive halves with carried state must closely
        # match demodulating the whole block at once (no boundary discontinuity).
        n = 16_384
        full_raw = _fm_iq_bytes(1500, 2500, 0, self.SAMPLE_RATE, n)
        first_raw = _fm_iq_bytes(1500, 2500, 0, self.SAMPLE_RATE, n // 2)
        second_raw = _fm_iq_bytes(
            1500, 2500, 0, self.SAMPLE_RATE, n // 2, start_phase=n // 2
        )

        whole = _pcm_to_float(demod_chunk(full_raw, self.SAMPLE_RATE, DemodState()))

        split_state = DemodState()
        part_a = _pcm_to_float(demod_chunk(first_raw, self.SAMPLE_RATE, split_state))
        part_b = _pcm_to_float(demod_chunk(second_raw, self.SAMPLE_RATE, split_state))
        split = np.concatenate((part_a, part_b))

        compare = min(whole.size, split.size)
        # Trim a few edge samples (resampler phase) and compare the bulk.
        seg = slice(64, compare - 64)
        assert compare > 256
        assert float(np.max(np.abs(whole[seg] - split[seg]))) < 0.02

    def test_decimation_path_runs_at_high_rate(self):
        # At 2.048 Msps the IQ decimator engages (factor 2); output stays valid.
        raw = _fm_iq_bytes(1000, 2500, 0, 2_048_000, 80_000)
        state = DemodState()
        pcm = demod_chunk(raw, 2_048_000, state)
        assert state.iq_decim == 2
        assert len(pcm) > 0

    def test_decimation_factor_change_resets_filters(self):
        # First a high rate (factor 2), then a low rate (factor 1) → state reset.
        state = DemodState()
        demod_chunk(_fm_iq_bytes(1000, 2500, 0, 2_048_000, 80_000), 2_048_000, state)
        assert state.iq_decim == 2
        demod_chunk(_fm_iq_bytes(1000, 2500, 0, 1_024_000, 40_000), 1_024_000, state)
        assert state.iq_decim == 1

    def test_tiny_chunk_below_decim_group_returns_empty(self):
        # Fewer IQ samples than the decimation factor → leftover carried, no output.
        state = DemodState()
        # 2.048 Msps → factor 2; a single IQ pair can't complete a group.
        pcm = demod_chunk(b"\x80\x80", 2_048_000, state)
        assert pcm == b""
        assert state.iq_leftover.size == 1


# ── DigitalDecodeBridge ───────────────────────────────────────────────────────


class _FakeBroadcaster:
    """Minimal stand-in exposing just the IQ fan-out the bridge needs."""

    def __init__(self) -> None:
        self.iq_queue: asyncio.Queue = asyncio.Queue()
        self.subscribed = False
        self.unsubscribed = False

    def subscribe_iq(self) -> asyncio.Queue:
        self.subscribed = True
        return self.iq_queue

    def unsubscribe_iq(self, queue: asyncio.Queue) -> None:
        self.unsubscribed = True


def _iq_payload(sample_rate: int, center_hz: int, raw_iq: bytes) -> bytes:
    """Build a broadcaster IQ payload: 8-byte LE header + raw uint8 IQ."""
    return struct.pack("<II", sample_rate, center_hz) + raw_iq


@pytest.fixture(autouse=True)
def _clear_bridges():
    """Keep the module-level bridge caches + secret cache clean between tests."""
    sdr_decode._bridges.clear()
    sdr_decode._aprs_bridges.clear()
    sdr_decode._ingest_secret = None
    yield
    sdr_decode._bridges.clear()
    sdr_decode._aprs_bridges.clear()
    sdr_decode._ingest_secret = None


async def _wait_until(predicate, timeout: float = 2.0) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(0.01)
    return False


class TestDigitalDecodeBridge:
    async def test_serves_pcm_to_connected_decoder(self):
        broadcaster = _FakeBroadcaster()
        bridge = DigitalDecodeBridge(broadcaster, pcm_port=0, audio_udp_port=0)
        await bridge.start(offset_hz=0, bw_hz=DEFAULT_DECODE_BW_HZ)
        try:
            assert broadcaster.subscribed
            reader, writer = await asyncio.open_connection("127.0.0.1", bridge.pcm_port)
            # Wait until the bridge has registered the decoder connection.
            assert await _wait_until(lambda: bridge.decoder_reachable)

            raw = _fm_iq_bytes(1500, 2500, 0, 1_024_000, 40_000)
            await broadcaster.iq_queue.put(_iq_payload(1_024_000, 100_000_000, raw))
            pcm = await asyncio.wait_for(reader.read(256), timeout=2.0)
            assert len(pcm) > 0
            writer.close()
        finally:
            await bridge.stop()

    async def test_skips_demod_when_no_decoder_connected(self):
        broadcaster = _FakeBroadcaster()
        bridge = DigitalDecodeBridge(broadcaster, pcm_port=0, audio_udp_port=0)
        await bridge.start()
        try:
            raw = _fm_iq_bytes(1500, 2500, 0, 1_024_000, 40_000)
            await broadcaster.iq_queue.put(_iq_payload(1_024_000, 100_000_000, raw))
            await asyncio.sleep(0.05)  # let the loop drain the chunk
            assert bridge.decoder_reachable is False  # nothing crashed; still no client
        finally:
            await bridge.stop()

    async def test_forwards_decoded_audio_udp_to_subscribers(self):
        broadcaster = _FakeBroadcaster()
        bridge = DigitalDecodeBridge(broadcaster, pcm_port=0, audio_udp_port=0)
        await bridge.start()
        try:
            # Pin the measured rate to OUTPUT_RATE so the datagram is forwarded
            # unchanged (and not dropped during rate measurement).
            bridge._detected_input_rate = OUTPUT_RATE
            audio_queue = bridge.subscribe_audio()
            loop = asyncio.get_running_loop()
            transport, _ = await loop.create_datagram_endpoint(
                asyncio.DatagramProtocol,
                remote_addr=("127.0.0.1", bridge.audio_udp_port),
            )
            transport.sendto(b"\x11\x22\x33\x44")
            received = await asyncio.wait_for(audio_queue.get(), timeout=2.0)
            assert received == b"\x11\x22\x33\x44"
            transport.close()
        finally:
            await bridge.stop()

    async def test_measures_input_rate_from_throughput(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        events = bridge.subscribe_events()
        events.get_nowait()  # drop the seeded status
        window = _AUDIO_RATE_MEASURE_SECONDS
        # First datagram only opens the window; the next supplies a window's worth
        # of 16000 samples/sec → a measured input rate of 16000 Hz.
        bridge._measure_input_rate(4, now=10.0)
        assert bridge._detected_input_rate is None
        bridge._measure_input_rate(
            round(16000 * window) * _AUDIO_BYTES_PER_SAMPLE, now=10.0 + window
        )
        assert bridge._detected_input_rate == 16000
        # The browser is told the uniform OUTPUT_RATE, not the raw input rate.
        frame = events.get_nowait()
        assert frame["type"] == "decode_status"
        assert frame["audio_sample_rate"] == OUTPUT_RATE

    async def test_audio_dropped_while_measuring_then_forwarded_once_known(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        audio = bridge.subscribe_audio()
        # Before the rate is known, frames are dropped (and feed the measurement).
        bridge._on_decoded_audio(b"\x01\x00\x02\x00")
        assert audio.empty()
        assert bridge._audio_measure_start is not None
        # Once known (at OUTPUT_RATE → no resample), frames pass through unchanged.
        bridge._detected_input_rate = OUTPUT_RATE
        bridge._on_decoded_audio(b"\x03\x00\x04\x00")
        assert audio.get_nowait() == b"\x03\x00\x04\x00"

    async def test_keeps_measuring_until_audio_arrives(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        # Window elapses but no bytes accumulated → no rate yet, keep measuring.
        bridge._measure_input_rate(0, now=100.0)
        bridge._measure_input_rate(0, now=100.0 + _AUDIO_RATE_MEASURE_SECONDS + 0.1)
        assert bridge._detected_input_rate is None

    async def test_resample_to_output_upsamples_and_passes_through(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        # Half OUTPUT_RATE → twice the samples after resampling.
        bridge._detected_input_rate = OUTPUT_RATE // 2
        upsampled = bridge._resample_to_output(b"\x01\x00\x02\x00")  # 2 samples
        assert len(upsampled) // _AUDIO_BYTES_PER_SAMPLE == 4
        # Already at OUTPUT_RATE → returned unchanged.
        bridge._detected_input_rate = OUTPUT_RATE
        assert bridge._resample_to_output(b"\x05\x00") == b"\x05\x00"
        # Sub-sample payload is too small to resample → returned unchanged.
        bridge._detected_input_rate = OUTPUT_RATE // 2
        assert bridge._resample_to_output(b"\x07") == b"\x07"

    async def test_status_frame_reports_output_rate(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        seeded = bridge.subscribe_events().get_nowait()
        assert seeded["audio_sample_rate"] == OUTPUT_RATE

    async def test_subscribe_events_seeds_status_frame(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        queue = bridge.subscribe_events()
        seeded = queue.get_nowait()
        assert seeded["type"] == "decode_status"
        assert seeded["decoder_reachable"] is False

    async def test_publish_event_fans_to_subscribers(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        queue = bridge.subscribe_events()
        queue.get_nowait()  # drop the seeded status
        bridge.publish_event({"type": "decode_event", "mode": "DMR", "talkgroup": 42})
        event = queue.get_nowait()
        assert event["mode"] == "DMR"
        assert event["talkgroup"] == 42

    async def test_unsubscribe_stops_delivery(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        events = bridge.subscribe_events()
        audio = bridge.subscribe_audio()
        bridge.unsubscribe_events(events)
        bridge.unsubscribe_audio(audio)
        bridge.publish_event({"type": "decode_event"})
        bridge._on_decoded_audio(b"x")
        # The seeded status is still queued, but nothing new arrives after it.
        events.get_nowait()  # seeded status
        assert events.empty()
        assert audio.empty()

    async def test_set_channel_updates_state(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        bridge.set_channel(offset_hz=25_000, bw_hz=6_250)
        assert bridge._state.offset_hz == 25_000
        assert bridge._state.bw_hz == 6_250

    async def test_start_while_running_updates_channel(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        await bridge.start(offset_hz=0, bw_hz=DEFAULT_DECODE_BW_HZ)
        try:
            await bridge.start(
                offset_hz=10_000, bw_hz=7_000
            )  # idempotent → set_channel
            assert bridge._state.offset_hz == 10_000
            assert bridge._state.bw_hz == 7_000
        finally:
            await bridge.stop()

    async def test_stop_unsubscribes_iq_and_sentinels_subscribers(self):
        broadcaster = _FakeBroadcaster()
        bridge = DigitalDecodeBridge(broadcaster, pcm_port=0, audio_udp_port=0)
        await bridge.start()
        events = bridge.subscribe_events()
        events.get_nowait()  # seeded status
        audio = bridge.subscribe_audio()
        await bridge.stop()
        assert broadcaster.unsubscribed
        assert events.get_nowait() is None  # sentinel
        assert audio.get_nowait() is None

    async def test_decoder_disconnect_marks_unreachable(self):
        broadcaster = _FakeBroadcaster()
        bridge = DigitalDecodeBridge(broadcaster, pcm_port=0, audio_udp_port=0)
        await bridge.start()
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", bridge.pcm_port)
            assert await _wait_until(lambda: bridge.decoder_reachable)
            writer.close()
            assert await _wait_until(lambda: not bridge.decoder_reachable)
        finally:
            await bridge.stop()


# ── Bridge cache helpers ──────────────────────────────────────────────────────


class TestBridgeCacheHelpers:
    async def test_get_or_create_creates_and_reuses(self):
        broadcaster = _FakeBroadcaster()
        first = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        second = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        assert first is second
        assert sdr_decode.get_bridge("h1", 1234) is first

    async def test_get_or_create_stops_other_radio_bridge(self):
        broadcaster = _FakeBroadcaster()
        old = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        await old.start(bw_hz=DEFAULT_DECODE_BW_HZ)
        # Creating a bridge for a different radio must stop and evict the old one.
        new = await sdr_decode.get_or_create_bridge("h2", 1234, broadcaster)
        assert sdr_decode.get_bridge("h1", 1234) is None
        assert sdr_decode.get_bridge("h2", 1234) is new

    async def test_get_bridge_missing_returns_none(self):
        assert sdr_decode.get_bridge("nope", 9999) is None

    async def test_stop_bridge_removes_from_cache(self):
        broadcaster = _FakeBroadcaster()
        await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        await sdr_decode.stop_bridge("h1", 1234)
        assert sdr_decode.get_bridge("h1", 1234) is None

    async def test_stop_bridge_missing_is_noop(self):
        await sdr_decode.stop_bridge("ghost", 1)  # must not raise

    async def test_wake_all_decoders_sentinels_subscribers(self):
        broadcaster = _FakeBroadcaster()
        bridge = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        events = bridge.subscribe_events()
        events.get_nowait()  # seeded status
        sdr_decode.wake_all_decoders()
        assert events.get_nowait() is None

    async def test_shutdown_all_decoders_stops_every_bridge(self):
        broadcaster = _FakeBroadcaster()
        bridge = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        await bridge.start()
        await sdr_decode.shutdown_all_decoders()
        assert sdr_decode._bridges == {}

    def test_get_active_bridge_returns_the_single_bridge(self):
        bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
        sdr_decode._bridges["h1:1234"] = bridge
        assert sdr_decode.get_active_bridge() is bridge

    def test_get_active_bridge_none_when_empty(self):
        assert sdr_decode.get_active_bridge() is None


# ── resolve_ingest_secret ─────────────────────────────────────────────────────


class TestResolveIngestSecret:
    def test_explicit_setting_takes_precedence(self, monkeypatch):
        monkeypatch.setattr(settings, "decoder_ingest_secret", "pinned")
        assert sdr_decode.resolve_ingest_secret() == "pinned"

    def test_reads_existing_secret_file(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "secret"
        secret_file.write_text("from-file\n")
        monkeypatch.setattr(settings, "decoder_ingest_secret", "")
        monkeypatch.setattr(settings, "decoder_secret_file", str(secret_file))
        assert sdr_decode.resolve_ingest_secret() == "from-file"

    def test_generates_and_persists_when_missing(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "sub" / "secret"
        monkeypatch.setattr(settings, "decoder_ingest_secret", "")
        monkeypatch.setattr(settings, "decoder_secret_file", str(secret_file))
        generated = sdr_decode.resolve_ingest_secret()
        assert generated
        # Persisted to disk so the decoder container can read the same value.
        assert secret_file.read_text().strip() == generated

    def test_caches_after_first_resolution(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "secret"
        monkeypatch.setattr(settings, "decoder_ingest_secret", "")
        monkeypatch.setattr(settings, "decoder_secret_file", str(secret_file))
        first = sdr_decode.resolve_ingest_secret()
        secret_file.write_text("changed-on-disk")
        # Cached → the on-disk change is not re-read within the process.
        assert sdr_decode.resolve_ingest_secret() == first

    def test_falls_back_to_memory_when_file_unwritable(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "decoder_ingest_secret", "")
        monkeypatch.setattr(settings, "decoder_secret_file", str(tmp_path / "secret"))

        def _boom(*args, **kwargs):
            raise OSError("read-only fs")

        monkeypatch.setattr(Path, "write_text", _boom)
        secret = sdr_decode.resolve_ingest_secret()
        assert secret  # ephemeral in-memory secret, backend still works


class _ConnStub:
    center_hz = 100_000_000
    sample_rate = 2_048_000


class _BroadcasterWithConn(_FakeBroadcaster):
    """IQ fan-out stub that also exposes a connection."""

    connection = _ConnStub()


class TestBridgeState:
    def test_running_false_before_start(self):
        bridge = DigitalDecodeBridge(
            _BroadcasterWithConn(), pcm_port=0, audio_udp_port=0
        )
        assert bridge.running is False


# ── AprsDecodeBridge ──────────────────────────────────────────────────────────


class TestAprsDecodeBridge:
    async def test_serves_pcm_without_udp_audio(self):
        # The APRS bridge shares the PCM spine but adds no decoded-voice UDP path
        # (Direwolf reads PCM and returns packets purely as ingested events).
        broadcaster = _FakeBroadcaster()
        bridge = AprsDecodeBridge(broadcaster, pcm_port=0)
        await bridge.start(offset_hz=0, bw_hz=DEFAULT_DECODE_BW_HZ)
        try:
            assert bridge.kind == "aprs"
            assert broadcaster.subscribed
            reader, writer = await asyncio.open_connection("127.0.0.1", bridge.pcm_port)
            assert await _wait_until(lambda: bridge.decoder_reachable)

            raw = _fm_iq_bytes(1500, 2500, 0, 1_024_000, 40_000)
            await broadcaster.iq_queue.put(_iq_payload(1_024_000, 100_000_000, raw))
            pcm = await asyncio.wait_for(reader.read(256), timeout=2.0)
            assert len(pcm) > 0
            writer.close()
        finally:
            await bridge.stop()

    def test_defaults_come_from_aprs_settings(self):
        # Uncustomised, the bridge takes its port and bandwidth from the APRS
        # settings (distinct from the voice defaults).
        bridge = AprsDecodeBridge(_FakeBroadcaster())
        assert bridge.pcm_port == settings.aprs_decoder_pcm_port
        assert bridge._state.bw_hz == settings.aprs_decoder_default_bw_hz

    def test_status_frame_has_no_audio_rate(self):
        # Unlike the voice bridge, APRS carries no decoded audio, so its status
        # frame must omit audio_sample_rate.
        bridge = AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        frame = bridge._status_frame()
        assert frame == {"type": "decode_status", "decoder_reachable": False}
        assert "audio_sample_rate" not in frame

    def test_has_no_voice_only_methods(self):
        # APRS must not expose the voice bridge's audio API.
        bridge = AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        assert not hasattr(bridge, "subscribe_audio")

    async def test_stop_drains_event_subscribers(self):
        bridge = AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        await bridge.start()
        events = bridge.subscribe_events()
        events.get_nowait()  # seeded status frame
        await bridge.stop()
        assert events.get_nowait() is None  # sentinel on stop


# ── APRS bridge cache helpers ─────────────────────────────────────────────────


class TestAprsBridgeCacheHelpers:
    async def test_get_or_create_creates_and_reuses(self, monkeypatch):
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        first = await sdr_decode.get_or_create_aprs_bridge("h1", 1234, broadcaster)
        second = await sdr_decode.get_or_create_aprs_bridge("h1", 1234, broadcaster)
        assert first is second
        assert isinstance(first, AprsDecodeBridge)
        assert sdr_decode.get_aprs_bridge("h1", 1234) is first

    async def test_get_or_create_stops_other_radio_aprs_bridge(self, monkeypatch):
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        old = await sdr_decode.get_or_create_aprs_bridge("h1", 1234, broadcaster)
        await old.start()
        new = await sdr_decode.get_or_create_aprs_bridge("h2", 1234, broadcaster)
        assert sdr_decode.get_aprs_bridge("h1", 1234) is None
        assert sdr_decode.get_aprs_bridge("h2", 1234) is new

    async def test_aprs_and_voice_bridges_coexist(self, monkeypatch):
        # The whole point of the split: creating an APRS bridge must NOT evict a
        # voice bridge (concurrent decode on two dongles).
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        voice = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        aprs = await sdr_decode.get_or_create_aprs_bridge("h2", 5678, broadcaster)
        assert sdr_decode.get_bridge("h1", 1234) is voice
        assert sdr_decode.get_aprs_bridge("h2", 5678) is aprs

    def test_get_aprs_bridge_missing_returns_none(self):
        assert sdr_decode.get_aprs_bridge("nope", 9999) is None

    def test_get_active_aprs_bridge_none_when_empty(self):
        assert sdr_decode.get_active_aprs_bridge() is None

    def test_get_active_aprs_bridge_returns_the_single_bridge(self):
        bridge = AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        sdr_decode._aprs_bridges["h1:1234"] = bridge
        assert sdr_decode.get_active_aprs_bridge() is bridge

    async def test_stop_aprs_bridge_removes_from_cache(self, monkeypatch):
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        await sdr_decode.get_or_create_aprs_bridge("h1", 1234, broadcaster)
        await sdr_decode.stop_aprs_bridge("h1", 1234)
        assert sdr_decode.get_aprs_bridge("h1", 1234) is None

    async def test_stop_aprs_bridge_missing_is_noop(self):
        await sdr_decode.stop_aprs_bridge("ghost", 1)  # must not raise

    async def test_wake_all_decoders_covers_aprs(self, monkeypatch):
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        bridge = await sdr_decode.get_or_create_aprs_bridge("h1", 1234, broadcaster)
        events = bridge.subscribe_events()
        events.get_nowait()  # seeded status
        sdr_decode.wake_all_decoders()
        assert events.get_nowait() is None

    async def test_shutdown_all_decoders_stops_both_registries(self, monkeypatch):
        monkeypatch.setattr(settings, "aprs_decoder_pcm_port", 0)
        broadcaster = _FakeBroadcaster()
        voice = await sdr_decode.get_or_create_bridge("h1", 1234, broadcaster)
        await voice.start()
        aprs = await sdr_decode.get_or_create_aprs_bridge("h2", 5678, broadcaster)
        await aprs.start()
        await sdr_decode.shutdown_all_decoders()
        assert sdr_decode._bridges == {}
        assert sdr_decode._aprs_bridges == {}
