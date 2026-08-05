"""Tests for backend/services/sdr_rigctl.py — the rigctld server for trunk tracking.

Covers the pure helpers (frequency planning, command parsing, CSV-name
validation), the module-level trunk/control-channel state, the RetuneController's
offset-vs-hardware decision and event publishing, and the RigctlServer's command
responses (both directly and over a real socket).
"""

import asyncio

import pytest

from backend.services import sdr_rigctl
from backend.services.sdr_rigctl import (
    RIGCTL_ERR,
    RIGCTL_OK,
    RetuneController,
    RigctlCommand,
    RigctlServer,
    TrunkConfig,
    parse_rigctl_command,
    plan_retune,
    validate_csv_name,
)

# A control channel comfortably inside a 2.048 Msps span centred at 855 MHz.
_CENTER_HZ = 855_000_000
_SAMPLE_RATE = 2_048_000
_GUARD_HZ = 25_000


@pytest.fixture(autouse=True)
async def _reset_state():
    """Clear module-level trunk/control state and any running server per test."""
    sdr_rigctl.reset_trunk_config()
    yield
    await sdr_rigctl.stop_rigctl_server()
    sdr_rigctl.reset_trunk_config()


# ── plan_retune ─────────────────────────────────────────────────────────────────


class TestPlanRetune:
    def test_in_span_uses_offset_shift(self):
        plan = plan_retune(855_512_500, _CENTER_HZ, _SAMPLE_RATE, _GUARD_HZ)
        assert plan.method == "offset"
        assert plan.offset_hz == 512_500
        assert plan.center_hz == _CENTER_HZ
        assert plan.target_hz == 855_512_500

    def test_negative_offset_in_span(self):
        plan = plan_retune(_CENTER_HZ - 300_000, _CENTER_HZ, _SAMPLE_RATE, _GUARD_HZ)
        assert plan.method == "offset"
        assert plan.offset_hz == -300_000

    def test_out_of_span_uses_hardware_retune(self):
        plan = plan_retune(860_000_000, _CENTER_HZ, _SAMPLE_RATE, _GUARD_HZ)
        assert plan.method == "hardware"
        assert plan.offset_hz == 0
        assert plan.center_hz == 860_000_000
        assert plan.target_hz == 860_000_000

    def test_exactly_at_usable_edge_is_offset(self):
        # usable half-span = 2.048M/2 - 25k = 999_000.
        edge = _CENTER_HZ + 999_000
        assert plan_retune(edge, _CENTER_HZ, _SAMPLE_RATE, _GUARD_HZ).method == "offset"

    def test_just_past_usable_edge_is_hardware(self):
        past = _CENTER_HZ + 999_001
        assert (
            plan_retune(past, _CENTER_HZ, _SAMPLE_RATE, _GUARD_HZ).method == "hardware"
        )

    def test_guard_wider_than_half_span_always_hardware(self):
        # A tiny span with a guard exceeding the half-span leaves no usable room.
        plan = plan_retune(_CENTER_HZ, _CENTER_HZ, 40_000, _GUARD_HZ)
        assert plan.method == "hardware"


# ── parse_rigctl_command ────────────────────────────────────────────────────────


class TestParseRigctlCommand:
    def test_set_freq_short_and_long(self):
        assert parse_rigctl_command("F 855512500") == RigctlCommand(
            "set_freq", frequency_hz=855_512_500
        )
        assert parse_rigctl_command("set_freq 100") == RigctlCommand(
            "set_freq", frequency_hz=100
        )
        assert parse_rigctl_command("\\set_freq 100") == RigctlCommand(
            "set_freq", frequency_hz=100
        )

    def test_set_freq_float_token_truncated(self):
        assert parse_rigctl_command("F 855512500.7").frequency_hz == 855_512_500

    def test_set_freq_missing_arg_is_none(self):
        assert parse_rigctl_command("F").frequency_hz is None

    def test_set_freq_non_numeric_is_none(self):
        assert parse_rigctl_command("F abc").frequency_hz is None

    def test_get_freq(self):
        assert parse_rigctl_command("f").kind == "get_freq"
        assert parse_rigctl_command("get_freq").kind == "get_freq"

    def test_set_mode_with_bandwidth(self):
        command = parse_rigctl_command("M NFM 12500")
        assert command.kind == "set_mode"
        assert command.bandwidth_hz == 12_500

    def test_set_mode_without_bandwidth(self):
        command = parse_rigctl_command("M FM")
        assert command.kind == "set_mode"
        assert command.bandwidth_hz is None

    def test_get_level(self):
        assert parse_rigctl_command("l").kind == "get_level"

    def test_quit(self):
        assert parse_rigctl_command("q").kind == "quit"
        assert parse_rigctl_command("quit").kind == "quit"

    def test_blank_and_unknown(self):
        assert parse_rigctl_command("   ").kind == "unknown"
        assert parse_rigctl_command("dump_state").kind == "unknown"


# ── validate_csv_name ───────────────────────────────────────────────────────────


class TestValidateCsvName:
    def test_none_and_empty_return_none(self):
        assert validate_csv_name(None) is None
        assert validate_csv_name("") is None
        assert validate_csv_name("   ") is None

    def test_plain_names_accepted(self):
        assert validate_csv_name("system.csv") == "system.csv"
        assert validate_csv_name("cap-plus_site.1.csv") == "cap-plus_site.1.csv"

    @pytest.mark.parametrize(
        "bad",
        ["../x.csv", "a/b.csv", "a\\b.csv", "x.txt", "noext", "..csv", "a b.csv"],
    )
    def test_unsafe_names_rejected(self, bad):
        with pytest.raises(ValueError):
            validate_csv_name(bad)


# ── trunk + control-channel state ────────────────────────────────────────────────


class TestTrunkConfigState:
    def test_enable_requires_channel_map(self):
        with pytest.raises(ValueError):
            sdr_rigctl.set_trunk_config(enabled=True)

    def test_enable_with_map_sets_state(self):
        config = sdr_rigctl.set_trunk_config(
            enabled=True, channel_map="sys.csv", group_list="grp.csv"
        )
        assert config.enabled is True
        assert config.channel_map == "sys.csv"
        assert config.group_list == "grp.csv"
        assert sdr_rigctl.get_trunk_config().channel_map == "sys.csv"

    def test_invalid_map_propagates_valueerror(self):
        with pytest.raises(ValueError):
            sdr_rigctl.set_trunk_config(enabled=True, channel_map="../escape.csv")

    def test_disable_allows_no_map(self):
        config = sdr_rigctl.set_trunk_config(enabled=False)
        assert config.enabled is False
        assert config.channel_map is None

    def test_as_dict(self):
        assert TrunkConfig(enabled=True, channel_map="a.csv").as_dict() == {
            "enabled": True,
            "channel_map": "a.csv",
            "group_list": None,
        }

    def test_reset_clears_config_and_control_channel(self):
        sdr_rigctl.set_trunk_config(enabled=True, channel_map="sys.csv")
        sdr_rigctl.set_control_channel(855_000_000)
        sdr_rigctl.reset_trunk_config()
        assert sdr_rigctl.get_trunk_config().enabled is False
        assert sdr_rigctl.get_control_channel() is None

    def test_control_channel_get_set(self):
        assert sdr_rigctl.get_control_channel() is None
        sdr_rigctl.set_control_channel(851_000_000)
        assert sdr_rigctl.get_control_channel() == 851_000_000


# ── RetuneController ─────────────────────────────────────────────────────────────


class _FakeConn:
    def __init__(self, center_hz=_CENTER_HZ, sample_rate=_SAMPLE_RATE):
        self.center_hz = center_hz
        self.sample_rate = sample_rate
        self.set_frequency_calls: list[int] = []

    async def set_frequency(self, frequency_hz: int) -> None:
        self.set_frequency_calls.append(frequency_hz)
        self.center_hz = frequency_hz


class _FakeBridge:
    def __init__(self, conn: _FakeConn):
        self.connection = conn
        self.current_offset_hz = 0
        self.channel_calls: list[tuple[int, int | None]] = []
        self.published: list[dict] = []

    def set_channel(self, *, offset_hz=0, bw_hz=None):
        self.channel_calls.append((offset_hz, bw_hz))
        self.current_offset_hz = offset_hz

    def publish_event(self, event: dict) -> None:
        self.published.append(event)


def _controller(bridge: _FakeBridge | None):
    return RetuneController(resolve_bridge=lambda: bridge, guard_hz=_GUARD_HZ)


class TestRetuneController:
    async def test_in_span_shifts_offset_and_publishes(self):
        bridge = _FakeBridge(_FakeConn())
        applied = await _controller(bridge).set_frequency(855_512_500)
        assert applied is True
        assert bridge.channel_calls == [(512_500, None)]
        assert bridge.connection.set_frequency_calls == []
        event = bridge.published[-1]
        assert event["type"] == "trunk_event"
        assert event["tuned_hz"] == 855_512_500
        assert event["method"] == "offset"
        assert event["is_control_channel"] is False

    async def test_out_of_span_hardware_retunes_and_zeroes_offset(self):
        bridge = _FakeBridge(_FakeConn())
        applied = await _controller(bridge).set_frequency(860_000_000)
        assert applied is True
        assert bridge.connection.set_frequency_calls == [860_000_000]
        assert bridge.channel_calls == [(0, None)]
        assert bridge.published[-1]["method"] == "hardware"

    async def test_retune_to_control_channel_flagged(self):
        bridge = _FakeBridge(_FakeConn())
        sdr_rigctl.set_control_channel(855_100_000)
        await _controller(bridge).set_frequency(855_100_000)
        assert bridge.published[-1]["is_control_channel"] is True

    async def test_no_bridge_returns_false_without_publishing(self):
        controller = _controller(None)
        assert await controller.set_frequency(855_100_000) is False

    def test_current_frequency_with_and_without_bridge(self):
        bridge = _FakeBridge(_FakeConn())
        bridge.current_offset_hz = 12_345
        assert _controller(bridge).current_frequency() == _CENTER_HZ + 12_345
        assert _controller(None).current_frequency() is None

    def test_set_bandwidth_preserves_offset(self):
        bridge = _FakeBridge(_FakeConn())
        bridge.current_offset_hz = 7_000
        assert _controller(bridge).set_bandwidth(6_250) is True
        assert bridge.channel_calls == [(7_000, 6_250)]

    def test_set_bandwidth_no_bridge(self):
        assert _controller(None).set_bandwidth(6_250) is False


# ── RigctlServer.handle_command ──────────────────────────────────────────────────


def _server(bridge: _FakeBridge | None) -> RigctlServer:
    return RigctlServer(port=0, controller=_controller(bridge))


class TestHandleCommand:
    async def test_set_freq_ok(self):
        bridge = _FakeBridge(_FakeConn())
        result = await _server(bridge).handle_command(
            RigctlCommand("set_freq", frequency_hz=855_100_000)
        )
        assert result == RIGCTL_OK

    async def test_set_freq_missing_arg_errors(self):
        result = await _server(_FakeBridge(_FakeConn())).handle_command(
            RigctlCommand("set_freq", frequency_hz=None)
        )
        assert result == RIGCTL_ERR

    async def test_set_freq_no_session_errors(self):
        result = await _server(None).handle_command(
            RigctlCommand("set_freq", frequency_hz=855_100_000)
        )
        assert result == RIGCTL_ERR

    async def test_get_freq_returns_value(self):
        bridge = _FakeBridge(_FakeConn())
        bridge.current_offset_hz = 1_000
        result = await _server(bridge).handle_command(RigctlCommand("get_freq"))
        assert result == f"{_CENTER_HZ + 1_000}\n".encode()

    async def test_get_freq_no_session_errors(self):
        assert (
            await _server(None).handle_command(RigctlCommand("get_freq")) == RIGCTL_ERR
        )

    async def test_set_mode_applies_bandwidth(self):
        bridge = _FakeBridge(_FakeConn())
        result = await _server(bridge).handle_command(
            RigctlCommand("set_mode", bandwidth_hz=12_500)
        )
        assert result == RIGCTL_OK
        assert bridge.channel_calls == [(0, 12_500)]

    async def test_set_mode_without_bandwidth_noop(self):
        bridge = _FakeBridge(_FakeConn())
        result = await _server(bridge).handle_command(
            RigctlCommand("set_mode", bandwidth_hz=None)
        )
        assert result == RIGCTL_OK
        assert bridge.channel_calls == []

    async def test_get_level_constant(self):
        assert (
            await _server(_FakeBridge(_FakeConn())).handle_command(
                RigctlCommand("get_level")
            )
            == b"0\n"
        )

    async def test_quit_closes(self):
        assert (
            await _server(_FakeBridge(_FakeConn())).handle_command(
                RigctlCommand("quit")
            )
            is None
        )

    async def test_unknown_acknowledged(self):
        assert (
            await _server(_FakeBridge(_FakeConn())).handle_command(
                RigctlCommand("unknown")
            )
            == RIGCTL_OK
        )


# ── RigctlServer lifecycle + socket I/O ──────────────────────────────────────────


class TestRigctlServerLifecycle:
    async def test_start_is_idempotent_and_singleton(self):
        first = await sdr_rigctl.start_rigctl_server()
        second = await sdr_rigctl.start_rigctl_server()
        assert first is second
        assert sdr_rigctl.get_rigctl_server() is first
        await sdr_rigctl.stop_rigctl_server()
        assert sdr_rigctl.get_rigctl_server() is None

    async def test_stop_when_not_running_is_safe(self):
        await sdr_rigctl.stop_rigctl_server()  # no server — must not raise

    async def test_server_start_is_idempotent(self):
        server = RigctlServer(port=0, controller=_controller(_FakeBridge(_FakeConn())))
        await server.start()
        bound_port = server.port
        await server.start()  # second start is a no-op, keeps the same listener
        assert server.port == bound_port
        await server.stop()

    async def test_server_stop_before_start_is_safe(self):
        RigctlServer(port=0)  # default controller path (no injected controller)
        await RigctlServer(port=0).stop()  # never started — early return, no raise

    async def test_server_responds_over_socket(self):
        bridge = _FakeBridge(_FakeConn())
        server = RigctlServer(port=0, controller=_controller(bridge))
        await server.start()
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
            writer.write(b"F 855100000\n")
            await writer.drain()
            assert await reader.readline() == RIGCTL_OK

            writer.write(b"f\n")
            await writer.drain()
            assert (
                await reader.readline()
                == f"{bridge.connection.center_hz + bridge.current_offset_hz}\n".encode()
            )

            writer.write(b"q\n")  # quit closes the connection
            await writer.drain()
            assert await reader.readline() == b""
            writer.close()
        finally:
            await server.stop()

    async def test_client_disconnect_is_handled(self):
        server = RigctlServer(port=0, controller=_controller(_FakeBridge(_FakeConn())))
        await server.start()
        try:
            _, writer = await asyncio.open_connection("127.0.0.1", server.port)
            writer.close()  # close without sending — server's read loop sees EOF
            await asyncio.sleep(0.05)
        finally:
            await server.stop()
