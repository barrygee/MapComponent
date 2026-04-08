"""
tests/backend/test_sdr_fft.py

Tests for the pure DSP helper functions in backend/services/sdr.py.

Covered:
    _iq_bytes_to_complex    — uint8 IQ pairs → normalised complex float array
    _hann_window            — Hann window coefficients
    compute_fft_frame       — full spectrum frame dict from raw IQ bytes
"""

import math
import time

import numpy as np
import pytest

from backend.services.sdr import (
    DEFAULT_FFT_SIZE,
    _hann_window,
    _iq_bytes_to_complex,
    compute_fft_frame,
)


# ── _iq_bytes_to_complex ──────────────────────────────────────────────────────

class TestIqBytesToComplex:
    def _make_iq_bytes(self, i_val: int, q_val: int, n_pairs: int = 1) -> bytes:
        """Build raw IQ bytes with constant I and Q values."""
        return bytes([i_val, q_val] * n_pairs)

    def test_returns_complex_array(self):
        raw = self._make_iq_bytes(128, 128, 4)
        result = _iq_bytes_to_complex(raw)
        assert result.dtype == np.complex64 or np.iscomplexobj(result)

    def test_length_is_half_byte_count(self):
        n_pairs = 16
        raw = self._make_iq_bytes(128, 128, n_pairs)
        result = _iq_bytes_to_complex(raw)
        assert len(result) == n_pairs

    def test_midpoint_bytes_map_to_near_zero(self):
        # 127.5 is the midpoint; byte 128 → (128 - 127.5) / 127.5 ≈ 0.003922
        raw = self._make_iq_bytes(128, 128, 1)
        result = _iq_bytes_to_complex(raw)
        assert abs(result[0].real) < 0.01
        assert abs(result[0].imag) < 0.01

    def test_max_byte_255_maps_to_near_plus_one(self):
        raw = self._make_iq_bytes(255, 128, 1)
        result = _iq_bytes_to_complex(raw)
        assert abs(result[0].real - 1.0) < 0.01

    def test_min_byte_0_maps_to_near_minus_one(self):
        raw = self._make_iq_bytes(0, 128, 1)
        result = _iq_bytes_to_complex(raw)
        assert abs(result[0].real - (-1.0)) < 0.01

    def test_i_and_q_are_separate_components(self):
        # I=255 (≈+1), Q=0 (≈-1) should produce real≈+1, imag≈-1
        raw = self._make_iq_bytes(255, 0, 1)
        result = _iq_bytes_to_complex(raw)
        assert result[0].real > 0.9
        assert result[0].imag < -0.9

    def test_normalisation_range_is_minus_one_to_plus_one(self):
        # All 256 possible byte values should normalise to [-1, +1]
        all_bytes = bytes(range(256)) * 2  # 256 IQ pairs
        result = _iq_bytes_to_complex(all_bytes)
        assert float(np.min(result.real)) >= -1.0
        assert float(np.max(result.real)) <= 1.0


# ── _hann_window ─────────────────────────────────────────────────────────────

class TestHannWindow:
    def test_returns_float32_array(self):
        window = _hann_window(64)
        assert window.dtype == np.float32

    def test_length_matches_n(self):
        for n in (32, 64, 128, 1024):
            assert len(_hann_window(n)) == n

    def test_endpoints_are_near_zero(self):
        # Hann window is 0 at both endpoints
        window = _hann_window(64)
        assert abs(float(window[0]))  < 0.01
        assert abs(float(window[-1])) < 0.01

    def test_peak_is_at_centre(self):
        window = _hann_window(64)
        centre = len(window) // 2
        # Centre value should be 1.0 (Hann peaks at 1 at n/2)
        assert abs(float(window[centre]) - 1.0) < 0.01

    def test_values_are_between_zero_and_one(self):
        window = _hann_window(1024)
        assert float(np.min(window)) >= 0.0
        assert float(np.max(window)) <= 1.0 + 1e-6

    def test_window_is_symmetric(self):
        window = _hann_window(64)
        # Hann window is symmetric: w[i] ≈ w[n-1-i]
        assert np.allclose(window, window[::-1], atol=1e-6)


# ── compute_fft_frame ─────────────────────────────────────────────────────────

def _make_silence(n_samples: int = DEFAULT_FFT_SIZE) -> bytes:
    """Generate IQ bytes representing a DC-biased near-silence signal (all 128)."""
    return bytes([128] * (n_samples * 2))


def _make_tone(
    freq_offset_hz: float,
    sample_rate: int,
    n_samples: int = DEFAULT_FFT_SIZE,
    amplitude: float = 0.5,
) -> bytes:
    """Generate IQ bytes for a single-frequency complex tone at freq_offset_hz from centre."""
    t = np.arange(n_samples) / sample_rate
    iq = amplitude * np.exp(1j * 2 * math.pi * freq_offset_hz * t)
    i_bytes = np.clip(np.round(iq.real * 127.5 + 127.5), 0, 255).astype(np.uint8)
    q_bytes = np.clip(np.round(iq.imag * 127.5 + 127.5), 0, 255).astype(np.uint8)
    interleaved = np.empty(n_samples * 2, dtype=np.uint8)
    interleaved[0::2] = i_bytes
    interleaved[1::2] = q_bytes
    return interleaved.tobytes()


class TestComputeFftFrame:
    CENTER_HZ    = 100_000_000  # 100 MHz
    SAMPLE_RATE  = 2_048_000    # 2.048 MHz

    def test_returns_dict_with_required_keys(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        for key in ("type", "center_hz", "sample_rate", "bins", "timestamp_ms"):
            assert key in frame

    def test_type_field_is_spectrum(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        assert frame["type"] == "spectrum"

    def test_center_hz_is_passed_through(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        assert frame["center_hz"] == self.CENTER_HZ

    def test_sample_rate_is_passed_through(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        assert frame["sample_rate"] == self.SAMPLE_RATE

    def test_bins_length_equals_fft_size(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        assert len(frame["bins"]) == DEFAULT_FFT_SIZE

    def test_bins_are_floats(self):
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        assert all(isinstance(b, float) for b in frame["bins"])

    def test_bins_are_in_dbfs_range(self):
        # Power values should be in a plausible dBFS range (e.g. -200 to +10)
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        for b in frame["bins"]:
            assert -200 <= b <= 10, f"Bin value {b} is outside plausible dBFS range"

    def test_timestamp_ms_is_close_to_now(self):
        before = int(time.time() * 1000)
        frame = compute_fft_frame(_make_silence(), DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)
        after = int(time.time() * 1000)
        assert before <= frame["timestamp_ms"] <= after + 100

    def test_tone_produces_peak_at_correct_bin(self):
        # Place a tone at +100 kHz offset from centre
        offset_hz = 100_000
        raw = _make_tone(offset_hz, self.SAMPLE_RATE, DEFAULT_FFT_SIZE)
        frame = compute_fft_frame(raw, DEFAULT_FFT_SIZE, self.SAMPLE_RATE, self.CENTER_HZ)

        bins = frame["bins"]
        peak_bin = bins.index(max(bins))

        # Expected bin: offset maps to (offset / sample_rate) * n_fft bins from centre,
        # shifted by n_fft//2 because of fftshift.
        expected_bin = DEFAULT_FFT_SIZE // 2 + round(offset_hz / self.SAMPLE_RATE * DEFAULT_FFT_SIZE)
        # Allow ±2 bins of tolerance for windowing spread
        assert abs(peak_bin - expected_bin) <= 2, (
            f"Peak at bin {peak_bin}, expected near {expected_bin}"
        )

    def test_different_fft_sizes_produce_correct_bin_count(self):
        for n_fft in (256, 512, 1024):
            raw = _make_silence(n_samples=n_fft)
            frame = compute_fft_frame(raw, n_fft, self.SAMPLE_RATE, self.CENTER_HZ)
            assert len(frame["bins"]) == n_fft
