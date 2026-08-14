"""Claiming and tuning the Sentry dongle that feeds Off Grid ADS-B.

Off Grid air data used to be a URL and nothing else, which left the actual
receiver anonymous: Sentinel knew where to *read* aircraft from, but not which
dongle produced the samples, so it could neither tune it nor stop anything else
retuning it. The map went empty and said nothing about why.

This resolves `air.offgridSdrSource` — a `{sentry_host_id, sentry_device_id}`
pair — into a live Sentry device, claims it, and tunes it to 1090 MHz in one
step. See Sentinel ADR-0003.

**Tuning travels with the claim, never after it.** Two calls would leave a
window where the device is ours but still on the wrong frequency, and a second
request that can fail on its own means handling "claimed but not tuned" — a
state nothing wants to be in and nothing would clean up.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from backend.db_helpers import get_setting, upsert_setting
from backend.models import SentryHost
from backend.services.sentry_client import (
    SentryApiError,
    SentryClient,
    SentryUnreachableError,
)
from sqlalchemy.ext.asyncio import AsyncSession

ADSB_CENTRE_HZ = 1_090_000_000
"""1090 MHz — the ADS-B downlink. Not configurable: a receiver tuned anywhere
else is not an ADS-B receiver, and offering the choice would only invite a
setting that silently produces an empty map."""

ADSB_SAMPLE_RATE = 2_400_000
"""2.4 MSPS. ADS-B is a 2 MHz-wide pulse-position signal, so anything much below
this cannot resolve the pulses; 2.4 is what the decoders assume."""

RESERVATION_TTL_SECONDS = 120
RENEWAL_INTERVAL_SECONDS = 30
"""Four missed renewals before the lease lapses — enough slack for a lost poll
or two without leaving a dongle held for minutes after its user has gone."""

SOURCE_SETTING_NAMESPACE = "air"
SOURCE_SETTING_KEY = "offgridSdrSource"
INSTANCE_ID_NAMESPACE = "app"
INSTANCE_ID_KEY = "instanceId"

RESERVATION_LABEL = "Sentinel — AIR (ADS-B)"
"""What Sentry's console shows against the claimed device. Names the *view*, not
just the app: an operator seeing a dongle busy wants to know which part of
Sentinel wants it, so they know what to close to get it back."""


class AdsbSourceError(Exception):
    """A reason the source could not be claimed, in words an operator can act on."""

    def __init__(self, code: str, message: str, **context: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.context = context


@dataclass(frozen=True)
class AdsbSource:
    """The Sentry device configured as the Off Grid ADS-B receiver."""

    host_id: int
    device_id: str


async def get_instance_id(db: AsyncSession) -> str:
    """This Sentinel's stable identity, as seen by Sentry's reservations.

    Generated once and stored, because it is the only thing distinguishing
    "renewing my own lease" from "stealing someone else's". A value regenerated
    per process — or per request — would lock this Sentinel out of the device it
    is holding the moment it restarted, and it would have to wait out the lease
    it took itself.
    """
    stored = await get_setting(db, INSTANCE_ID_NAMESPACE, INSTANCE_ID_KEY)
    if isinstance(stored, str) and stored:
        return stored
    generated = f"sentinel:{uuid.uuid4()}"
    await upsert_setting(db, INSTANCE_ID_NAMESPACE, INSTANCE_ID_KEY, generated)
    return generated


async def get_source(db: AsyncSession) -> AdsbSource | None:
    """The configured source device, or `None` when the operator has not picked one."""
    raw = await get_setting(db, SOURCE_SETTING_NAMESPACE, SOURCE_SETTING_KEY)
    if not isinstance(raw, dict):
        return None
    host_id = raw.get("sentry_host_id")
    device_id = raw.get("sentry_device_id")
    if not isinstance(host_id, int) or not isinstance(device_id, str) or not device_id:
        return None
    return AdsbSource(host_id=host_id, device_id=device_id)


async def set_source(db: AsyncSession, host_id: int, device_id: str) -> AdsbSource:
    """Record which Sentry device feeds Off Grid ADS-B."""
    await upsert_setting(
        db,
        SOURCE_SETTING_NAMESPACE,
        SOURCE_SETTING_KEY,
        {"sentry_host_id": host_id, "sentry_device_id": device_id},
    )
    return AdsbSource(host_id=host_id, device_id=device_id)


async def _client_for_source(db: AsyncSession, source: AdsbSource) -> SentryClient:
    host = await db.get(SentryHost, source.host_id)
    if host is None:
        raise AdsbSourceError(
            "unknown_host",
            "The Sentry host this ADS-B source belongs to no longer exists. Pick a source again.",
        )
    if not host.enabled:
        raise AdsbSourceError(
            "host_disabled",
            f"The Sentry host {host.name or host.address} is switched off in Sentinel.",
        )
    return SentryClient(host.address, host.port, host.auth_token)


async def claim_and_tune(db: AsyncSession, *, force: bool = False) -> dict[str, Any]:
    """Claim the ADS-B source and put it on 1090 MHz. Returns the live reservation.

    Called when AIR becomes visible off grid, and again on the renewal timer.
    Both are the same call: renewing is just claiming again, and a renewal that
    arrives after the lease lapsed becomes a fresh claim rather than an error.

    The tuning is re-applied on every renewal rather than only on the first
    claim. It costs one small request every thirty seconds and it is what makes
    the arrangement self-healing: a dongle that was replugged, a Sentry that
    restarted, or an operator who retuned it by hand all come back to 1090 MHz
    on the next tick instead of leaving a map that is quietly empty.
    """
    source = await get_source(db)
    if source is None:
        raise AdsbSourceError(
            "no_source",
            "No Sentry SDR is set as the Off Grid ADS-B source. Choose one in Settings → AIR.",
        )

    holder = await get_instance_id(db)
    client = await _client_for_source(db, source)

    try:
        reservation = await client.acquire_reservation(
            source.device_id,
            holder=holder,
            label=RESERVATION_LABEL,
            ttl_seconds=RESERVATION_TTL_SECONDS,
            force=force,
        )
    except SentryUnreachableError as error:
        raise AdsbSourceError("host_unreachable", str(error)) from error
    except SentryApiError as error:
        if error.status_code == 409:
            raise AdsbSourceError(
                "device_reserved",
                error.message,
                holder=error.context.get("holder"),
                label=error.context.get("label"),
            ) from error
        if error.status_code == 401:
            raise AdsbSourceError(
                "unauthenticated",
                "Sentinel could not sign in to that Sentry. Check its console password in Settings → SDR.",
            ) from error
        raise AdsbSourceError(error.code or "sentry_error", error.message) from error

    try:
        await client.patch_device(
            source.device_id,
            {
                "center_hz": ADSB_CENTRE_HZ,
                "sample_rate": ADSB_SAMPLE_RATE,
                # AGC: ADS-B is bursty and the useful dynamic range is wide, so a
                # fixed gain that suits an aircraft overhead clips one at range.
                "gain_auto": True,
                "enabled": True,
            },
            holder=holder,
        )
    except SentryUnreachableError as error:
        raise AdsbSourceError("host_unreachable", str(error)) from error
    except SentryApiError as error:
        raise AdsbSourceError(
            error.code or "tuning_failed",
            f"The device was claimed but could not be tuned: {error.message}",
        ) from error

    return {
        "source": {"sentry_host_id": source.host_id, "sentry_device_id": source.device_id},
        "reservation": reservation.data,
        "tuned": {"center_hz": ADSB_CENTRE_HZ, "sample_rate": ADSB_SAMPLE_RATE},
        "renew_within_seconds": RENEWAL_INTERVAL_SECONDS,
    }


async def release(db: AsyncSession) -> bool:
    """Give the source device back. True when a release was actually sent.

    Best effort throughout: the lease expires on its own, so every failure here
    costs at most a couple of minutes of a device nobody is using. Leaving AIR
    should never surface an error about a dongle.
    """
    source = await get_source(db)
    if source is None:
        return False
    holder = await get_instance_id(db)
    try:
        client = await _client_for_source(db, source)
        await client.release_reservation(source.device_id, holder=holder)
    except (AdsbSourceError, SentryUnreachableError, SentryApiError):
        return False
    return True


async def get_decoder_config(db: AsyncSession) -> dict[str, Any]:
    """What the ADS-B decoder container needs to find its I/Q stream.

    Polled by the sidecar so the rtl_tcp address lives in one place — the source
    the operator picked — rather than being duplicated into compose environment
    variables that drift the moment the source changes.

    Reports the source as unset rather than erroring when none is chosen: the
    decoder polls this on a loop from boot, and a container that crash-looped
    until an operator visited a settings page would bury the real message.
    """
    source = await get_source(db)
    if source is None:
        return {"configured": False, "rtl_tcp": None}

    host = await db.get(SentryHost, source.host_id)
    if host is None:
        return {"configured": False, "rtl_tcp": None}

    client = SentryClient(host.address, host.port, host.auth_token)
    try:
        export = await client.get_sdr_export()
    except (SentryUnreachableError, SentryApiError):
        return {"configured": False, "rtl_tcp": None}

    for device in (export.data or {}).get("sdrs", []):
        if device.get("sentry_device_id") == source.device_id:
            return {
                "configured": True,
                "rtl_tcp": {"host": device.get("host"), "port": device.get("port")},
                "sentry_device_id": source.device_id,
            }
    return {"configured": False, "rtl_tcp": None}
