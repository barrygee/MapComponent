"""`/api/sdr/adsb` — the Sentry dongle behind Off Grid ADS-B.

Three jobs, all about one device: say which Sentry SDR feeds AIR, claim and tune
it while AIR is watching, and tell the decoder sidecar where to read its I/Q
from. See Sentinel ADR-0003 and `services/adsb_source.py`.
"""

from __future__ import annotations

from typing import Any

from backend.database import get_db
from backend.services import adsb_source
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/sdr/adsb", tags=["adsb-source"])


class AdsbSourceIn(BaseModel):
    """Body for `PUT /api/sdr/adsb/source` — which Sentry device feeds AIR."""

    sentry_host_id: int = Field(description="Id of a Sentry host Sentinel knows about")
    sentry_device_id: str = Field(min_length=1, max_length=256, description='Sentry device id, e.g. "serial:97710286"')


class ClaimIn(BaseModel):
    """Body for `POST /api/sdr/adsb/claim`."""

    force: bool = Field(
        default=False,
        description="Take the device from whatever currently holds it. The operator's override",
    )


def _as_http_error(error: adsb_source.AdsbSourceError) -> HTTPException:
    """Map a claim failure onto its HTTP status, keeping the operator-facing message.

    `409` for a device somebody else is using and `502` for a Sentry that could
    not be reached or refused us — the caller shows these to an operator, so the
    distinction between "busy" and "broken" has to survive the trip.
    """
    status_by_code = {
        "no_source": 409,
        "device_reserved": 409,
        "host_disabled": 409,
        "unknown_host": 404,
        "unauthenticated": 502,
        "host_unreachable": 502,
    }
    return HTTPException(
        status_code=status_by_code.get(error.code, 502),
        detail={"code": error.code, "message": error.message, **error.context},
    )


@router.get("/source")
async def get_source(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Report which Sentry device is configured as the ADS-B receiver."""
    source = await adsb_source.get_source(db)
    if source is None:
        return {"configured": False, "sentry_host_id": None, "sentry_device_id": None}
    return {
        "configured": True,
        "sentry_host_id": source.host_id,
        "sentry_device_id": source.device_id,
    }


@router.put("/source")
async def put_source(body: AdsbSourceIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Set the ADS-B receiver.

    Deliberately does not verify the device exists on that Sentry. A dongle can
    be unplugged, and a host can be down, without the operator's choice becoming
    wrong — the claim is where reachability is discovered, and it reports it in
    terms of something they just tried to do.
    """
    source = await adsb_source.set_source(db, body.sentry_host_id, body.sentry_device_id)
    return {
        "configured": True,
        "sentry_host_id": source.host_id,
        "sentry_device_id": source.device_id,
    }


@router.post("/claim")
async def claim(body: ClaimIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Claim the source device and tune it to 1090 MHz. Also the renewal call.

    Called when AIR becomes visible off grid and every
    `renew_within_seconds` after, which the response carries so the caller does
    not hard-code a cadence that only this service knows.
    """
    try:
        return await adsb_source.claim_and_tune(db, force=body.force)
    except adsb_source.AdsbSourceError as error:
        raise _as_http_error(error) from error


@router.delete("/claim", status_code=204)
async def release(db: AsyncSession = Depends(get_db)) -> None:
    """Release the source device when AIR stops watching.

    Never fails: the lease expires on its own, so a release that does not land
    costs a couple of minutes of an idle dongle. Leaving a view must not raise
    an error about hardware.
    """
    await adsb_source.release(db)


@router.get("/config")
async def decoder_config(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Where the decoder sidecar should read its I/Q from.

    Polled by the container on a loop, which is why an unconfigured source is a
    normal `200` answer rather than an error: a sidecar that crash-looped until
    somebody visited a settings page would bury the message that says so.
    """
    return await adsb_source.get_decoder_config(db)
