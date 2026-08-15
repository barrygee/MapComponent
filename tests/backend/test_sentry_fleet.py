"""Tests for backend.services.sentry_fleet — the per-Sentry-host background
poller that caches each enabled host's live device status (ADR-0009).

`AsyncSessionLocal` (imported directly by this module, not via `get_db`) is
redirected at a per-test in-memory engine, matching the pattern already used
by `test_aprs_store.py`/`test_routers_aprs.py` for other modules with the same
self-opened-session shape. `SentryClient` itself is faked for most tests (per
the task's "drive it with a fake/patched client" guidance); one test uses the
real client over an httpx.MockTransport to prove the auth token never reaches
a log record even through the genuine error-formatting path.
"""

from __future__ import annotations

import asyncio
import logging
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend import db_helpers
from backend.models import SentryHost  # noqa: F401 — register the ORM model with Base
from backend.services import sentry_fleet
from backend.services.sentry_client import (
    SentryApiError,
    SentryResponse,
    SentryUnreachableError,
)


@pytest.fixture()
async def session_factory(monkeypatch):
    """Per-test in-memory DB; redirect sentry_fleet's AsyncSessionLocal at it."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(sentry_fleet, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()


async def _create_host(session_factory, **overrides) -> int:
    defaults = dict(
        name="host",
        address="10.0.0.5",
        port=8000,
        auth_token="tok",
        enabled=True,
        created_at=1000,
    )
    defaults.update(overrides)
    async with session_factory() as session:
        host = SentryHost(**defaults)
        session.add(host)
        await session.commit()
        await session.refresh(host)
        return host.id


async def _reload_host(session_factory, host_id: int) -> SentryHost:
    async with session_factory() as session:
        return await session.get(SentryHost, host_id)


def _fake_client_class(outcomes: list):
    """A SentryClient stand-in whose get_status() yields `outcomes` in order
    (repeating the last entry), raising anything that is an Exception."""
    state = {"count": 0}

    class _FakeSentryClient:
        def __init__(self, address, port, auth_token) -> None:
            self.address = address
            self.port = port
            self.auth_token = auth_token

        async def get_status(self) -> SentryResponse:
            index = min(state["count"], len(outcomes) - 1)
            state["count"] += 1
            outcome = outcomes[index]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    return _FakeSentryClient


# ── _poll_once ─────────────────────────────────────────────────────────────────


async def test_poll_once_success_updates_snapshot_and_persists_last_seen_at(
    session_factory, monkeypatch
):
    host_id = await _create_host(session_factory)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class(
            [SentryResponse(data={"generated_at": 1, "sdrs": []}, api_version="1.0")]
        ),
    )
    poller = sentry_fleet.SentryFleetPoller()

    ok = await poller._poll_once(host_id)

    assert ok is True
    snapshot = poller.get_snapshot(host_id)
    assert snapshot.reachable is True
    assert snapshot.status_payload == {"generated_at": 1, "sdrs": []}
    assert snapshot.api_version == "1.0"
    assert snapshot.last_error is None
    assert snapshot.last_success_at is not None

    host_row = await _reload_host(session_factory, host_id)
    assert host_row.last_seen_at == snapshot.last_polled_at
    assert host_row.last_error is None


async def test_poll_once_unreachable_sets_last_error_without_touching_last_seen_at(
    session_factory, monkeypatch
):
    host_id = await _create_host(session_factory)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class(
            [
                SentryResponse(data={"generated_at": 1, "sdrs": []}, api_version="1.0"),
                SentryUnreachableError("Could not reach Sentry host 10.0.0.5:8000."),
            ]
        ),
    )
    poller = sentry_fleet.SentryFleetPoller()

    assert await poller._poll_once(host_id) is True
    successful_seen_at = (await _reload_host(session_factory, host_id)).last_seen_at

    assert await poller._poll_once(host_id) is False
    snapshot = poller.get_snapshot(host_id)
    assert snapshot.reachable is False
    assert snapshot.last_error == "Could not reach Sentry host 10.0.0.5:8000."

    host_row = await _reload_host(session_factory, host_id)
    assert host_row.last_seen_at == successful_seen_at  # unchanged by the failed poll
    assert host_row.last_error == "Could not reach Sentry host 10.0.0.5:8000."


async def test_poll_once_api_error_uses_code_and_message_as_last_error(
    session_factory, monkeypatch
):
    host_id = await _create_host(session_factory)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class([SentryApiError(500, "boom", "things broke")]),
    )
    poller = sentry_fleet.SentryFleetPoller()

    assert await poller._poll_once(host_id) is False
    assert poller.get_snapshot(host_id).last_error == "boom: things broke"
    assert (
        await _reload_host(session_factory, host_id)
    ).last_error == "boom: things broke"


async def test_poll_once_unexpected_exception_is_caught_logged_and_treated_as_failure(
    session_factory, monkeypatch, caplog
):
    caplog.set_level(logging.ERROR, logger="backend.services.sentry_fleet")
    host_id = await _create_host(session_factory)
    monkeypatch.setattr(
        sentry_fleet, "SentryClient", _fake_client_class([ValueError("boom")])
    )
    poller = sentry_fleet.SentryFleetPoller()

    ok = await poller._poll_once(host_id)

    assert ok is False
    assert poller.get_snapshot(host_id).last_error == "Unexpected error while polling."
    assert any(
        "Unexpected error polling Sentry host" in record.getMessage()
        for record in caplog.records
    )


async def test_poll_once_returns_false_and_creates_no_snapshot_for_unknown_host(
    session_factory,
):
    poller = sentry_fleet.SentryFleetPoller()
    assert await poller._poll_once(999999) is False
    assert poller.get_snapshot(999999) is None


async def test_poll_once_returns_false_and_creates_no_snapshot_for_disabled_host(
    session_factory,
):
    host_id = await _create_host(session_factory, enabled=False)
    poller = sentry_fleet.SentryFleetPoller()
    assert await poller._poll_once(host_id) is False
    assert poller.get_snapshot(host_id) is None


# ── refresh_now ────────────────────────────────────────────────────────────────


async def test_refresh_now_is_a_noop_when_host_has_no_running_poller():
    poller = sentry_fleet.SentryFleetPoller()
    await poller.refresh_now(123)  # must not raise


async def test_refresh_now_sets_the_hosts_refresh_event():
    poller = sentry_fleet.SentryFleetPoller()
    poller._refresh_events[42] = asyncio.Event()

    await poller.refresh_now(42)

    assert poller._refresh_events[42].is_set()


async def test_refresh_now_triggers_an_immediate_poll(monkeypatch):
    poller = sentry_fleet.SentryFleetPoller()
    poll_calls = {"count": 0}

    async def fake_poll_once(host_id: int) -> bool:
        poll_calls["count"] += 1
        return True

    monkeypatch.setattr(poller, "_poll_once", fake_poll_once)
    # Long enough that only refresh_now (never the interval) can wake iteration 2.
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 10.0)

    await poller.start_host(1)
    await asyncio.sleep(0.05)
    assert poll_calls["count"] == 1

    await poller.refresh_now(1)
    await asyncio.sleep(0.05)
    assert poll_calls["count"] == 2

    await poller.stop_host(1)


# ── backoff ───────────────────────────────────────────────────────────────────


async def test_backoff_grows_on_repeated_failure_caps_and_resets_on_success(
    monkeypatch,
):
    poller = sentry_fleet.SentryFleetPoller()
    # False, False, False, True, False, False — see gap arithmetic in the assertions.
    outcomes = [False, False, False, True, False, False]
    call_times: list[float] = []

    async def fake_poll_once(host_id: int) -> bool:
        call_times.append(time.monotonic())
        return outcomes[min(len(call_times) - 1, len(outcomes) - 1)]

    monkeypatch.setattr(poller, "_poll_once", fake_poll_once)
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_backoff_start_s", 0.02)
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_backoff_max_s", 0.08)
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 0.05)

    await poller.start_host(1)
    await asyncio.sleep(
        0.02 + 0.08 + 0.08 + 0.05 + 0.04 + 0.3
    )  # generous margin past all 6 calls
    await poller.stop_host(1)

    assert len(call_times) >= 6
    gap_after_failure_1 = call_times[1] - call_times[0]  # backoff: start*2 = 0.04
    gap_after_failure_2 = call_times[2] - call_times[1]  # backoff: min(max, *2) = 0.08
    gap_after_failure_3 = call_times[3] - call_times[2]  # capped at max = 0.08
    gap_after_success = call_times[4] - call_times[3]  # normal interval = 0.05
    gap_after_failure_post_success = (
        call_times[5] - call_times[4]
    )  # backoff reset then grown once = 0.04

    assert gap_after_failure_2 > gap_after_failure_1 * 1.3  # grows on repeated failure
    assert gap_after_failure_3 < gap_after_failure_2 * 1.3  # capped, not still doubling
    # A success drops straight back to the normal interval rather than serving
    # one more backed-off wait — otherwise a host that recovers stays sluggish
    # for as long as it was down.
    assert gap_after_success < gap_after_failure_3 * 0.9
    assert (
        gap_after_failure_post_success < gap_after_failure_3 * 0.7
    )  # reset by the intervening success


# ── start_host / stop_host / restart_host ─────────────────────────────────────


async def test_start_host_is_idempotent_while_already_running(monkeypatch):
    poller = sentry_fleet.SentryFleetPoller()
    monkeypatch.setattr(poller, "_poll_once", AsyncMock(return_value=True))
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 10.0)

    await poller.start_host(5)
    first_task = poller._tasks[5]
    await poller.start_host(5)

    assert poller._tasks[5] is first_task
    await poller.stop_host(5)


async def test_stop_host_cancels_task_and_clears_all_state(monkeypatch):
    poller = sentry_fleet.SentryFleetPoller()
    monkeypatch.setattr(poller, "_poll_once", AsyncMock(return_value=True))
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 10.0)

    await poller.start_host(5)
    task = poller._tasks[5]
    await poller.stop_host(5)

    assert task.cancelled() or task.done()
    assert 5 not in poller._tasks
    assert 5 not in poller._refresh_events
    assert poller.get_snapshot(5) is None


async def test_stop_host_is_a_noop_for_a_host_with_no_running_poller():
    poller = sentry_fleet.SentryFleetPoller()
    await poller.stop_host(999)  # must not raise


async def test_restart_host_stops_then_starts_in_order(monkeypatch):
    poller = sentry_fleet.SentryFleetPoller()
    calls: list[tuple[str, int]] = []

    async def fake_stop(host_id: int) -> None:
        calls.append(("stop", host_id))

    async def fake_start(host_id: int) -> None:
        calls.append(("start", host_id))

    monkeypatch.setattr(poller, "stop_host", fake_stop)
    monkeypatch.setattr(poller, "start_host", fake_start)

    await poller.restart_host(7)

    assert calls == [("stop", 7), ("start", 7)]


async def test_start_all_starts_only_enabled_hosts(session_factory, monkeypatch):
    enabled_id = await _create_host(session_factory, address="10.0.0.1", enabled=True)
    disabled_id = await _create_host(session_factory, address="10.0.0.2", enabled=False)

    poller = sentry_fleet.SentryFleetPoller()
    monkeypatch.setattr(poller, "_poll_once", AsyncMock(return_value=True))
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 10.0)

    await poller.start_all()

    assert enabled_id in poller._tasks
    assert disabled_id not in poller._tasks

    await poller.stop_all()


async def test_stop_all_cancels_every_running_task(monkeypatch):
    poller = sentry_fleet.SentryFleetPoller()
    monkeypatch.setattr(poller, "_poll_once", AsyncMock(return_value=True))
    monkeypatch.setattr(sentry_fleet.settings, "sentry_poll_interval_s", 10.0)

    await poller.start_host(1)
    await poller.start_host(2)
    assert len(poller._tasks) == 2

    await poller.stop_all()

    assert poller._tasks == {}


# ── security: the auth token never reaches a log record ──────────────────────


async def test_auth_token_never_appears_in_log_record_on_poll_failure(
    session_factory, monkeypatch, caplog
):
    """Uses the real SentryClient (over a MockTransport) so the failure message
    is genuinely produced by the production error path, not a test double."""
    caplog.set_level(logging.DEBUG, logger="backend.services.sentry_fleet")
    host_id = await _create_host(session_factory, auth_token="ULTRA-SECRET-TOKEN")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated")

    class _MockedAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _MockedAsyncClient)

    poller = sentry_fleet.SentryFleetPoller()
    result = await poller._poll_once(host_id)

    assert result is False
    for record in caplog.records:
        assert "ULTRA-SECRET-TOKEN" not in record.getMessage()

    snapshot = poller.get_snapshot(host_id)
    assert "ULTRA-SECRET-TOKEN" not in (snapshot.last_error or "")

    host_row = await _reload_host(session_factory, host_id)
    assert "ULTRA-SECRET-TOKEN" not in (host_row.last_error or "")


async def test_update_host_row_tolerates_the_host_being_deleted_mid_poll(
    session_factory,
):
    """A poll in flight when the operator removes the host must not raise.

    The poller opens its own session after the HTTP call returns, so there is a
    real window in which the row it is about to write telemetry to has already
    been deleted. Swallowing that is deliberate — there is nothing left to
    record, and an exception here would kill the task rather than let it exit
    cleanly on the next cancellation.
    """
    poller = sentry_fleet.SentryFleetPoller()

    await poller._update_host_row(4242, last_seen_at=123, last_error=None)


# ── mirrored radios following their device ────────────────────────────────────


async def _create_radio(session_factory, *, device_id: str, port: int, host_id: int = 1) -> int:
    """A Sentinel radio mirroring a Sentry device, as ADD creates one.

    Radios live in the `sdr.radios` UserSettings JSON array, not in the
    `sdr_radios` table — that table is vestigial for this surface.
    """
    async with session_factory() as db:
        radios = await db_helpers.get_setting(db, "sdr", "radios", default=[])
        radio_id = len(radios) + 1
        radios.append(
            {
                "id": radio_id,
                "name": "ADSB",
                "host": "192.168.5.67",
                "port": port,
                "enabled": True,
                "sentry_host_id": host_id,
                "sentry_device_id": device_id,
            }
        )
        await db_helpers.upsert_setting(db, "sdr", "radios", radios)
        return radio_id


async def _reload_radio(session_factory, radio_id: int) -> dict | None:
    async with session_factory() as db:
        radios = await db_helpers.get_setting(db, "sdr", "radios", default=[])
    return next((r for r in radios if r.get("id") == radio_id), None)


def _status_with_device(device_id: str, iq_port: int) -> SentryResponse:
    return SentryResponse(
        data={
            "generated_at": 1,
            "sdrs": [
                {
                    "device_id": device_id,
                    "name": "ADSB",
                    "present": True,
                    "enabled": True,
                    "output": {"iq_port": iq_port, "control_port": iq_port + 2, "host": ""},
                }
            ],
        },
        api_version="1.0",
    )


async def test_a_poll_repoints_a_radio_whose_device_moved_port(session_factory, monkeypatch):
    """The replug case: Sentry reassigns the port, and the mirror follows.

    Without this the radio points at a port nothing listens on, and connecting
    fails with a bare socket error naming neither the device nor the reason.
    """
    host_id = await _create_host(session_factory)
    radio_id = await _create_radio(session_factory, device_id="serial:AAA", port=2345, host_id=host_id)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class([_status_with_device("serial:AAA", 4343)]),
    )

    await sentry_fleet.SentryFleetPoller()._poll_once(host_id)

    assert (await _reload_radio(session_factory, radio_id))["port"] == 4343


async def test_a_poll_leaves_an_already_correct_radio_alone(session_factory, monkeypatch):
    host_id = await _create_host(session_factory)
    radio_id = await _create_radio(session_factory, device_id="serial:AAA", port=4343, host_id=host_id)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class([_status_with_device("serial:AAA", 4343)]),
    )

    await sentry_fleet.SentryFleetPoller()._poll_once(host_id)

    assert (await _reload_radio(session_factory, radio_id))["port"] == 4343


async def test_a_poll_never_deletes_a_radio_whose_device_vanished(session_factory, monkeypatch):
    """A dongle is unplugged for all sorts of temporary reasons.

    Destroying the operator's configuration — its name, its groups, its
    recordings — because a USB plug was loose would be far worse than showing it
    as unavailable, which `GET /api/sdr/radios` does instead.
    """
    host_id = await _create_host(session_factory)
    radio_id = await _create_radio(session_factory, device_id="serial:GONE", port=2345, host_id=host_id)
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class([_status_with_device("usb:1-1.4", 6565)]),
    )

    await sentry_fleet.SentryFleetPoller()._poll_once(host_id)

    radio = await _reload_radio(session_factory, radio_id)
    assert radio is not None
    assert radio["port"] == 2345


async def test_a_poll_does_not_touch_another_hosts_radios(session_factory, monkeypatch):
    # Two Sentries can each have a device with the same id; a poll of one must
    # not re-point the other's mirror.
    host_id = await _create_host(session_factory)
    other_radio = await _create_radio(
        session_factory, device_id="serial:AAA", port=1111, host_id=host_id + 99
    )
    monkeypatch.setattr(
        sentry_fleet,
        "SentryClient",
        _fake_client_class([_status_with_device("serial:AAA", 4343)]),
    )

    await sentry_fleet.SentryFleetPoller()._poll_once(host_id)

    assert (await _reload_radio(session_factory, other_radio))["port"] == 1111
