"""Per-Sentry-host poller — caches each enabled host's live device status (ADR-0009).

One asyncio task per **enabled** `SentryHost` row polls `GET /api/status` on an
interval, caching the latest snapshot in memory so router reads never block on
a remote round-trip to a Raspberry Pi that may be slow or off the network. On
failure the poller backs off exponentially rather than hammering an
unreachable host — the same shape as
`backend.services.sdr.RadioBroadcaster._reconnect`. `last_seen_at`/`last_error`
are mirrored onto the host's DB row so the UI can show reachability without
polling itself.

A single process-wide `fleet_poller` instance is created here and
started/stopped from `backend.main`'s lifespan, matching the existing
`_daily_cleanup_loop` pattern (create the task at startup, cancel-and-await it
at shutdown).
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.db_helpers import get_setting, upsert_setting
from backend.models import SentryHost
from backend.services.sentry_client import SentryApiError, SentryClient, SentryUnreachableError
from sqlalchemy import select

logger = logging.getLogger(__name__)


@dataclass
class HostSnapshot:
    """The latest cached state for one Sentry host, held only in memory."""

    host_id: int
    reachable: bool = False
    status_payload: dict[str, Any] | None = None  # raw GET /api/status body ({generated_at, sdrs})
    api_version: str | None = None
    last_error: str | None = None
    last_polled_at: int | None = None
    last_success_at: int | None = None
    # Raw GET /api/v1/sdrs body, refreshed far less often than the status poll —
    # the only place a Sentry publishes where it is (`source.location`), which
    # the domain maps plot. Kept on the last successful read, so a host that
    # drops off the network stays on the map at its last known position.
    export_payload: dict[str, Any] | None = None
    export_fetched_at: int | None = None  # Unix ms of the last export ATTEMPT, successful or not


class SentryFleetPoller:
    """Owns one background asyncio task per enabled Sentry host.

    Not a singleton by class design (tests can instantiate their own), but
    `fleet_poller` at module scope is the one instance the running app uses.
    """

    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._snapshots: dict[int, HostSnapshot] = {}
        self._refresh_events: dict[int, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    def get_snapshot(self, host_id: int) -> HostSnapshot | None:
        """Return the cached snapshot for a host, or None if no poller has run for it yet."""
        return self._snapshots.get(host_id)

    async def refresh_now(self, host_id: int) -> None:
        """Wake a host's poller immediately rather than waiting out the poll interval.

        Called after a write (device PATCH/DELETE, serial flash, hotspot
        mutation) so the cached snapshot doesn't stay stale for up to
        `settings.sentry_poll_interval_s`. A no-op if the host has no running
        poller (e.g. it is disabled or was just created and hasn't started yet).
        """
        event = self._refresh_events.get(host_id)
        if event is not None:
            event.set()

    async def start_all(self) -> None:
        """Start a poller task for every currently-enabled host. Called once at app startup."""
        async with AsyncSessionLocal() as db:
            hosts = (await db.execute(select(SentryHost).where(SentryHost.enabled.is_(True)))).scalars().all()
        for host in hosts:
            await self.start_host(host.id)

    async def start_host(self, host_id: int) -> None:
        """Start (or leave running) the poller task for one host."""
        async with self._lock:
            existing = self._tasks.get(host_id)
            if existing is not None and not existing.done():
                return
            self._refresh_events[host_id] = asyncio.Event()
            self._snapshots.setdefault(host_id, HostSnapshot(host_id=host_id))
            self._tasks[host_id] = asyncio.create_task(self._run(host_id), name=f"sentry-poll-{host_id}")

    async def stop_host(self, host_id: int) -> None:
        """Cancel and await one host's poller task, e.g. when it is disabled, edited, or deleted."""
        async with self._lock:
            task = self._tasks.pop(host_id, None)
            self._refresh_events.pop(host_id, None)
            self._snapshots.pop(host_id, None)
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def restart_host(self, host_id: int) -> None:
        """Stop then start a host's poller — used after editing its address/port/token/enabled."""
        await self.stop_host(host_id)
        await self.start_host(host_id)

    async def stop_all(self) -> None:
        """Cancel and await every running poller task. Called from `backend.main`'s shutdown."""
        for host_id in list(self._tasks.keys()):
            await self.stop_host(host_id)

    async def _run(self, host_id: int) -> None:
        """The poll loop for one host: poll, then sleep for the interval or until woken."""
        backoff = settings.sentry_poll_backoff_start_s
        event = self._refresh_events[host_id]
        while True:
            ok = await self._poll_once(host_id)
            backoff = (
                settings.sentry_poll_backoff_start_s if ok else min(settings.sentry_poll_backoff_max_s, backoff * 2)
            )
            wait_s = settings.sentry_poll_interval_s if ok else backoff
            event.clear()
            try:
                # Woken early by refresh_now(), or falls through once wait_s elapses.
                await asyncio.wait_for(event.wait(), timeout=wait_s)
            except TimeoutError:
                pass

    async def _poll_once(self, host_id: int) -> bool:
        """Poll one host once, updating its in-memory snapshot and DB row. Returns success."""
        async with AsyncSessionLocal() as db:
            host = await db.get(SentryHost, host_id)
            if host is None or not host.enabled:
                return False
            address, port, auth_token = host.address, host.port, host.auth_token

        snapshot = self._snapshots.setdefault(host_id, HostSnapshot(host_id=host_id))
        polled_at = int(time.time() * 1000)
        snapshot.last_polled_at = polled_at
        client = SentryClient(address, port, auth_token)
        try:
            response = await client.get_status()
        except SentryUnreachableError as exc:
            await self._record_failure(host_id, snapshot, str(exc))
            return False
        except SentryApiError as exc:
            await self._record_failure(host_id, snapshot, f"{exc.code}: {exc.message}")
            return False
        except Exception:
            # Defence-in-depth: a bug here must never kill the poll loop for
            # every other host, so it is logged and treated as a failure.
            logger.exception("Unexpected error polling Sentry host %d", host_id)
            await self._record_failure(host_id, snapshot, "Unexpected error while polling.")
            return False

        snapshot.reachable = True
        snapshot.status_payload = response.data
        snapshot.api_version = response.api_version
        snapshot.last_error = None
        snapshot.last_success_at = polled_at
        await self._update_host_row(host_id, last_seen_at=polled_at, last_error=None)
        await self._follow_device_addresses(host_id, response.data)
        await self._refresh_export(snapshot, client, polled_at)
        return True

    async def _refresh_export(self, snapshot: HostSnapshot, client: SentryClient, polled_at: int) -> None:
        """Top up the host's cached `/api/v1/sdrs` export, at most once per refresh window.

        Deliberately rate-limited well below the status poll: the export exists
        here only for the Sentry's own `source` block (its name and position),
        which changes when an operator re-sites the Pi, not every two seconds.

        Never raises and never downgrades the host: an older Sentry without the
        versioned export simply leaves the previous payload (or none) in place,
        and the attempt timestamp is still recorded so a host that cannot serve
        it is not retried on every poll.
        """
        due_at = (snapshot.export_fetched_at or 0) + int(settings.sentry_location_refresh_s * 1000)
        if snapshot.export_fetched_at is not None and polled_at < due_at:
            return
        snapshot.export_fetched_at = polled_at
        try:
            snapshot.export_payload = (await client.get_sdr_export()).data
        except (SentryUnreachableError, SentryApiError):
            pass
        except Exception:
            # Same defence-in-depth as the status poll: a surprise here must not
            # take down the loop that keeps device state fresh.
            logger.exception("Unexpected error reading the Sentry export for host %d", snapshot.host_id)

    async def _follow_device_addresses(self, host_id: int, payload: dict[str, Any] | None) -> None:
        """Re-point mirrored radios at wherever their device now answers.

        A Sentinel radio created from a Sentry device is a *mirror*: the device
        identity is the fact, and the address is a detail Sentry owns and
        reassigns. Replug a dongle into another USB socket and Sentry may give it
        a different output port — at which point the mirror is pointing at a port
        nothing listens on, and connecting to it fails with a bare socket error
        that says nothing about why.

        Since this poll already carries every device's current address, the
        cheapest place to notice is here. Nothing is written unless an address
        actually changed, so the ordinary case costs one comparison per device.

        Deliberately does **not** delete a radio whose device has disappeared. A
        dongle is unplugged for all sorts of temporary reasons, and quietly
        destroying the operator's configuration — its name, its frequency groups,
        its recordings — because a USB plug was loose would be far worse than
        showing it as unavailable, which is what `GET /api/sdr/radios` now does.
        """
        addresses: dict[str, tuple[str, int]] = {}
        for device in (payload or {}).get("sdrs", []):
            output = device.get("output") or {}
            iq_port = output.get("iq_port")
            device_id = device.get("device_id")
            if isinstance(device_id, str) and isinstance(iq_port, int):
                addresses[device_id] = (output.get("host") or "", iq_port)

        if not addresses:
            return

        async with AsyncSessionLocal() as db:
            radios = await get_setting(db, "sdr", "radios", default=[])
            if not isinstance(radios, list):
                return
            changed = False
            for radio in radios:
                if not isinstance(radio, dict) or radio.get("sentry_host_id") != host_id:
                    continue
                current = addresses.get(radio.get("sentry_device_id") or "")
                if current is None:
                    continue
                _, iq_port = current
                # Only the port is followed. The host in Sentry's payload is its
                # own view of itself and can be empty or container-internal,
                # whereas the address the operator registered is the one Sentinel
                # can actually reach.
                if radio.get("port") != iq_port:
                    logger.info(
                        "Radio %s followed device %s from port %s to %s",
                        radio.get("id"),
                        radio.get("sentry_device_id"),
                        radio.get("port"),
                        iq_port,
                    )
                    radio["port"] = iq_port
                    changed = True
            if changed:
                await upsert_setting(db, "sdr", "radios", radios)

    async def _record_failure(self, host_id: int, snapshot: HostSnapshot, message: str) -> None:
        snapshot.reachable = False
        snapshot.last_error = message
        logger.debug("Sentry host %d unreachable: %s", host_id, message)
        await self._update_host_row(host_id, last_seen_at=None, last_error=message)

    async def _update_host_row(self, host_id: int, *, last_seen_at: int | None, last_error: str | None) -> None:
        """Persist reachability telemetry. `last_seen_at=None` means "leave it unchanged" (a failure)."""
        async with AsyncSessionLocal() as db:
            host = await db.get(SentryHost, host_id)
            if host is None:
                return
            if last_seen_at is not None:
                host.last_seen_at = last_seen_at
            host.last_error = last_error
            await db.commit()


# Process-wide singleton, started in backend.main's lifespan and cancelled on shutdown.
fleet_poller = SentryFleetPoller()
