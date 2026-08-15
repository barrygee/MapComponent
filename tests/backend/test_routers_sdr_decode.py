"""
tests/backend/test_routers_sdr_decode.py

Tests for the digital-decode HTTP/WebSocket surface in backend/routers/sdr.py:

    POST /api/sdr/decode/ingest          — sidecar → backend decoded events
    GET  /api/sdr/decode/status/{id}     — is decode active / decoder reachable
    WS   /ws/sdr/{id}/decode             — decoded events to the browser
    WS   /ws/sdr/{id}/decode/audio       — decoded voice PCM to the browser
    cmd  digital_decode / digital_channel on the control socket

The bridge's own networking is covered in test_sdr_decode.py; here we register a
bridge directly (no real sockets) and monkeypatch the rtl_tcp resolution so the
HTTP/WS layer can be tested without a physical device.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.config import settings
from backend.routers import sdr as sdr_router
from backend.services import sdr_decode
from backend.services.sdr_decode import DigitalDecodeBridge


class _FakeBroadcaster:
    """IQ fan-out stub (the bridge only calls subscribe_iq/unsubscribe_iq)."""

    def subscribe_iq(self) -> asyncio.Queue:
        return asyncio.Queue()

    def unsubscribe_iq(self, queue: asyncio.Queue) -> None:
        pass


@pytest.fixture(autouse=True)
def _reset_decode_state():
    """Isolate the module-level bridge caches and the decode secret."""
    sdr_decode._bridges.clear()
    sdr_decode._aprs_bridges.clear()
    original_secret = settings.decoder_ingest_secret
    yield
    sdr_decode._bridges.clear()
    sdr_decode._aprs_bridges.clear()
    settings.decoder_ingest_secret = original_secret
    sdr_decode._ingest_secret = None


def _add_radio(client, host="h1", port=1234) -> int:
    created = client.post(
        "/api/sdr/radios", json={"name": "Test", "host": host, "port": port}
    ).json()
    return created["id"]


def _register_bridge(host="h1", port=1234) -> DigitalDecodeBridge:
    """Place a bridge in the cache for (host, port) without opening sockets."""
    bridge = DigitalDecodeBridge(_FakeBroadcaster(), pcm_port=0, audio_udp_port=0)
    sdr_decode._bridges[f"{host}:{port}"] = bridge
    return bridge


# ── POST /api/sdr/decode/ingest ───────────────────────────────────────────────


class TestIngest:
    def test_disabled_when_secret_unresolvable(self, client, monkeypatch):
        # If no secret can be resolved at all, ingestion is refused (fail closed).
        monkeypatch.setattr(sdr_decode, "resolve_ingest_secret", lambda: "")
        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"mode": "DMR"}},
            headers={"X-Decode-Secret": "anything"},
        )
        assert resp.status_code == 503

    def test_bad_secret_rejected(self, client):
        settings.decoder_ingest_secret = "right-secret"
        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"mode": "DMR"}},
            headers={"X-Decode-Secret": "wrong-secret"},
        )
        assert resp.status_code == 401

    def test_missing_secret_header_rejected(self, client):
        settings.decoder_ingest_secret = "right-secret"
        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"mode": "DMR"}},
        )
        assert resp.status_code == 401

    def test_no_active_bridge_returns_409(self, client):
        settings.decoder_ingest_secret = "s"
        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"mode": "DMR"}},
            headers={"X-Decode-Secret": "s"},
        )
        assert resp.status_code == 409

    def test_success_publishes_event_to_active_bridge(self, client):
        settings.decoder_ingest_secret = "s"
        bridge = _register_bridge()
        queue = bridge.subscribe_events()
        queue.get_nowait()  # drop the seeded status frame

        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"mode": "P25", "talkgroup": 7}},
            headers={"X-Decode-Secret": "s"},
        )
        assert resp.status_code == 200
        event = queue.get_nowait()
        assert event["type"] == "decode_event"
        assert event["mode"] == "P25"
        assert event["talkgroup"] == 7

    def test_event_can_override_type(self, client):
        settings.decoder_ingest_secret = "s"
        bridge = _register_bridge()
        queue = bridge.subscribe_events()
        queue.get_nowait()
        client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"type": "decode_status", "decoder_reachable": True}},
            headers={"X-Decode-Secret": "s"},
        )
        event = queue.get_nowait()
        assert event["type"] == "decode_status"

    def test_oversized_event_rejected(self, client):
        settings.decoder_ingest_secret = "s"
        _register_bridge()
        resp = client.post(
            "/api/sdr/decode/ingest",
            json={"event": {"blob": "x" * 5000}},
            headers={"X-Decode-Secret": "s"},
        )
        assert resp.status_code == 422


# ── GET /api/sdr/decode/status/{id} ───────────────────────────────────────────


class TestDecodeStatus:
    def test_unknown_radio_returns_404(self, client):
        assert client.get("/api/sdr/decode/status/999").status_code == 404

    def test_inactive_when_no_bridge(self, client):
        radio_id = _add_radio(client)
        body = client.get(f"/api/sdr/decode/status/{radio_id}").json()
        assert body["active"] is False
        assert body["decoder_reachable"] is False

    def test_active_and_reachable_when_decoder_connected(self, client):
        radio_id = _add_radio(client)
        bridge = _register_bridge()
        bridge._decoder_connected = True
        body = client.get(f"/api/sdr/decode/status/{radio_id}").json()
        assert body["active"] is True
        assert body["decoder_reachable"] is True


# ── WebSocket routes ──────────────────────────────────────────────────────────


def _patch_resolve(monkeypatch, broadcaster, radio):
    async def _fake_resolve(radio_id, websocket):
        return broadcaster, radio

    monkeypatch.setattr(sdr_router, "_resolve_broadcaster", _fake_resolve)


class TestDecodeWebsocket:
    def test_streams_seeded_status_then_event(self, client, monkeypatch):
        radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
        _patch_resolve(monkeypatch, _FakeBroadcaster(), radio)
        bridge = _register_bridge()
        with client.websocket_connect("/ws/sdr/1/decode") as ws:
            seeded = ws.receive_json()
            assert seeded["type"] == "decode_status"
            bridge.publish_event({"type": "decode_event", "mode": "NXDN"})
            event = ws.receive_json()
            assert event["mode"] == "NXDN"

    def test_no_bridge_sends_inactive_status_and_closes(self, client, monkeypatch):
        radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
        _patch_resolve(monkeypatch, _FakeBroadcaster(), radio)

        async def _no_bridge(host, port, timeout=3.0):
            return None

        monkeypatch.setattr(sdr_router, "_wait_for_bridge", _no_bridge)
        with client.websocket_connect("/ws/sdr/1/decode") as ws:
            status = ws.receive_json()
            assert status["active"] is False

    def test_audio_no_bridge_closes(self, client, monkeypatch):
        radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
        _patch_resolve(monkeypatch, _FakeBroadcaster(), radio)

        async def _no_bridge(host, port, timeout=3.0):
            return None

        monkeypatch.setattr(sdr_router, "_wait_for_bridge", _no_bridge)
        from starlette.websockets import WebSocketDisconnect as StarletteWSDisconnect

        with pytest.raises(StarletteWSDisconnect):
            with client.websocket_connect("/ws/sdr/1/decode/audio") as ws:
                ws.receive_bytes()


class TestWaitForBridge:
    async def test_returns_bridge_once_present(self):
        bridge = _register_bridge("hX", 1)
        found = await sdr_router._wait_for_bridge("hX", 1, timeout=1.0)
        assert found is bridge

    async def test_times_out_when_absent(self):
        found = await sdr_router._wait_for_bridge("ghost", 1, timeout=0.2)
        assert found is None

    async def test_finds_aprs_bridge_for_radio(self):
        # A radio running APRS (not voice) has no entry in the voice registry;
        # the wait must fall through to the APRS registry.
        bridge = sdr_decode.AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        sdr_decode._aprs_bridges["hA:2"] = bridge
        found = await sdr_router._wait_for_bridge("hA", 2, timeout=1.0)
        assert found is bridge


class TestAprsDecodeWebsocket:
    def test_events_stream_from_aprs_bridge(self, client, monkeypatch):
        # The panels reuse the same decode events WS; for an APRS radio it streams
        # the APRS bridge's events.
        radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
        _patch_resolve(monkeypatch, _FakeBroadcaster(), radio)
        bridge = sdr_decode.AprsDecodeBridge(_FakeBroadcaster(), pcm_port=0)
        sdr_decode._aprs_bridges["h1:1234"] = bridge
        with client.websocket_connect("/ws/sdr/1/decode") as ws:
            assert ws.receive_json()["type"] == "decode_status"
            bridge.publish_event({"type": "aprs", "from": "M0ABC-9"})
            assert ws.receive_json()["from"] == "M0ABC-9"

    def test_audio_ws_closes_for_aprs_radio(self, client, monkeypatch):
        # APRS carries no decoded voice, so the audio socket must close cleanly
        # rather than error when the radio is running APRS.
        radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
        _patch_resolve(monkeypatch, _FakeBroadcaster(), radio)
        sdr_decode._aprs_bridges["h1:1234"] = sdr_decode.AprsDecodeBridge(
            _FakeBroadcaster(), pcm_port=0
        )
        from starlette.websockets import WebSocketDisconnect as StarletteWSDisconnect

        with pytest.raises(StarletteWSDisconnect):
            with client.websocket_connect("/ws/sdr/1/decode/audio") as ws:
                ws.receive_bytes()


# ── Control-socket digital_decode / digital_channel commands ──────────────────


class _FakeConn:
    host = "h1"
    port = 1234
    center_hz = 100_000_000
    sample_rate = 2_048_000
    mode = "NFM"
    gain_db = 30.0
    gain_auto = False
    # Demod state the WS status frame now carries so followers can mirror the
    # owner's exact channel (offset within the band + audio bandwidth).
    demod_offset_hz = 0
    bw_hz = 0
    # Sweep state the WS status frame now carries so followers render the same
    # scan/search overlay.
    scan_active = False
    scan_groups: list[str] = []
    search_active = False
    search_low_hz: int | None = None
    search_high_hz: int | None = None
    search_current_hz: int | None = None
    # Tuning-ownership fields the WS status frame reads (no relay control channel
    # in this stub, so it behaves as a sole owner with control unavailable).
    is_owner = True
    control_available = False
    tuner_locked = False


class _ControlBroadcaster:
    """Control-WS fan-out stub: empty spectrum queue, no real device."""

    def subscribe(self) -> asyncio.Queue:
        return asyncio.Queue()

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        pass


def _patch_control(monkeypatch):
    radio = {"id": 1, "name": "Test", "host": "h1", "port": 1234}
    _patch_resolve(monkeypatch, _ControlBroadcaster(), radio)
    monkeypatch.setattr(
        sdr_router.sdr_svc, "get_connection", lambda host, port: _FakeConn()
    )
    # Neutralise the finally-block teardown so it doesn't interfere with assertions.
    monkeypatch.setattr(sdr_router.sdr_decode, "stop_bridge", AsyncMock())


class TestControlDigitalCommands:
    def test_enable_starts_bridge(self, client, monkeypatch):
        _patch_control(monkeypatch)
        fake_bridge = MagicMock()
        fake_bridge.start = AsyncMock()
        get_or_create = AsyncMock(return_value=fake_bridge)
        monkeypatch.setattr(
            sdr_router.sdr_decode, "get_or_create_bridge", get_or_create
        )

        with client.websocket_connect("/ws/sdr/1") as ws:
            ws.receive_json()  # initial status
            ws.send_json(
                {
                    "cmd": "digital_decode",
                    "enabled": True,
                    "offset_hz": 5000,
                    "bw_hz": 12500,
                }
            )
            # ping/pong barrier: commands are processed in order, so a pong proves
            # the digital_decode command was already handled.
            ws.send_json({"cmd": "ping"})
            while ws.receive_json().get("type") != "pong":
                pass

        get_or_create.assert_awaited_once()
        fake_bridge.start.assert_awaited_once_with(offset_hz=5000, bw_hz=12500)

    def test_disable_stops_bridge(self, client, monkeypatch):
        _patch_control(monkeypatch)
        stop_bridge = AsyncMock()
        monkeypatch.setattr(sdr_router.sdr_decode, "stop_bridge", stop_bridge)

        with client.websocket_connect("/ws/sdr/1") as ws:
            ws.receive_json()
            ws.send_json({"cmd": "digital_decode", "enabled": False})
            ws.send_json({"cmd": "ping"})
            while ws.receive_json().get("type") != "pong":
                pass

        # Called once for the explicit disable (the teardown call also lands, so
        # assert it was invoked with the radio's host/port at least once).
        stop_bridge.assert_any_await("h1", 1234)

    def test_digital_channel_updates_active_bridge(self, client, monkeypatch):
        _patch_control(monkeypatch)
        fake_bridge = MagicMock()
        monkeypatch.setattr(
            sdr_router.sdr_decode, "get_bridge", lambda host, port: fake_bridge
        )

        with client.websocket_connect("/ws/sdr/1") as ws:
            ws.receive_json()
            ws.send_json({"cmd": "digital_channel", "offset_hz": 25000, "bw_hz": 6250})
            ws.send_json({"cmd": "ping"})
            while ws.receive_json().get("type") != "pong":
                pass

        fake_bridge.set_channel.assert_called_once_with(offset_hz=25000, bw_hz=6250)

    def test_digital_channel_noop_when_no_bridge(self, client, monkeypatch):
        _patch_control(monkeypatch)
        monkeypatch.setattr(
            sdr_router.sdr_decode, "get_bridge", lambda host, port: None
        )
        with client.websocket_connect("/ws/sdr/1") as ws:
            ws.receive_json()
            ws.send_json({"cmd": "digital_channel", "offset_hz": 0})
            ws.send_json({"cmd": "ping"})
            while ws.receive_json().get("type") != "pong":
                pass
        # No exception raised → the missing-bridge branch is handled gracefully.


# ── GET /api/sdr/decode/config ────────────────────────────────────────────────


class TestDecodeConfig:
    def test_disabled_when_secret_unresolvable(self, client, monkeypatch):
        monkeypatch.setattr(sdr_decode, "resolve_ingest_secret", lambda: "")
        resp = client.get("/api/sdr/decode/config", headers={"X-Decode-Secret": "x"})
        assert resp.status_code == 503

    def test_bad_secret_rejected(self, client):
        settings.decoder_ingest_secret = "right-secret"
        resp = client.get(
            "/api/sdr/decode/config", headers={"X-Decode-Secret": "wrong"}
        )
        assert resp.status_code == 401

    def test_reports_inactive_without_a_decode_session(self, client):
        settings.decoder_ingest_secret = "s"
        resp = client.get("/api/sdr/decode/config", headers={"X-Decode-Secret": "s"})
        assert resp.status_code == 200
        assert resp.json() == {"active": False}

    def test_active_true_when_a_session_is_serving_pcm(self, client, monkeypatch):
        # The supervisor gates dsd-fme launch on this flag, so it must be True only
        # while a bridge is actually serving PCM (started, not merely created).
        settings.decoder_ingest_secret = "s"
        monkeypatch.setattr(
            sdr_router.sdr_decode,
            "get_active_bridge",
            lambda: SimpleNamespace(running=True),
        )
        resp = client.get("/api/sdr/decode/config", headers={"X-Decode-Secret": "s"})
        assert resp.json()["active"] is True

    def test_active_false_when_bridge_not_yet_serving(self, client, monkeypatch):
        settings.decoder_ingest_secret = "s"
        monkeypatch.setattr(
            sdr_router.sdr_decode,
            "get_active_bridge",
            lambda: SimpleNamespace(running=False),
        )
        resp = client.get("/api/sdr/decode/config", headers={"X-Decode-Secret": "s"})
        assert resp.json()["active"] is False
