/**
 * Typed client for `/api/sdr/adsb` — the Sentry dongle behind Off Grid ADS-B.
 *
 * Off Grid air data has two halves that used to be unrelated: a URL to read
 * aircraft from, and the SDR that produced the samples. This is the second —
 * naming that SDR, claiming it while AIR is watching, and tuning it to
 * 1090 MHz. See Sentinel ADR-0003.
 *
 * Errors are returned rather than thrown. Every caller here is a background
 * lifecycle step — a claim on view entry, a renewal on a timer — where an
 * exception has nobody to catch it and would surface as an unhandled rejection
 * in the console instead of a message in the UI. The claim's failure *is* the
 * information the operator needs, so it is data.
 */

/** Which Sentry device feeds AIR, as the backend reports it. */
export interface AdsbSourceConfig {
  configured: boolean
  sentry_host_id: number | null
  sentry_device_id: string | null
}

/** A live claim on the source device, with what it was tuned to. */
export interface AdsbClaim {
  source: { sentry_host_id: number; sentry_device_id: string }
  reservation: {
    device_id: string
    holder: string
    label: string
    reserved_at: number
    expires_at: number
  } | null
  tuned: { center_hz: number; sample_rate: number }
  /** Seconds after which the caller should claim again to keep the lease alive. */
  renew_within_seconds: number
}

/**
 * Why a claim failed, in terms an operator can act on.
 *
 * `code` distinguishes the cases that need different actions — pick a source,
 * take the device back, fix a password, start a Pi — which is the whole reason
 * the backend keeps them apart rather than returning one generic failure.
 */
export interface AdsbClaimError {
  code: string
  message: string
  /** Present on `device_reserved`: who currently holds the device. */
  holder?: string
  label?: string
}

const BASE = '/api/sdr/adsb'

async function readError(response: Response, fallback: string): Promise<AdsbClaimError> {
  try {
    const body = (await response.json()) as { detail?: Partial<AdsbClaimError> }
    const detail = body.detail ?? {}
    return {
      code: detail.code ?? 'unknown_error',
      message: detail.message ?? fallback,
      ...(detail.holder ? { holder: detail.holder } : {}),
      ...(detail.label ? { label: detail.label } : {}),
    }
  } catch {
    return { code: 'unknown_error', message: fallback }
  }
}

/** Read which Sentry device is configured as the ADS-B receiver. */
export async function getAdsbSource(): Promise<AdsbSourceConfig | null> {
  try {
    const response = await fetch(`${BASE}/source`)
    if (!response.ok) return null
    return (await response.json()) as AdsbSourceConfig
  } catch {
    return null
  }
}

/** Set the ADS-B receiver. */
export async function setAdsbSource(
  sentryHostId: number,
  sentryDeviceId: string,
): Promise<AdsbSourceConfig | null> {
  try {
    const response = await fetch(`${BASE}/source`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sentry_host_id: sentryHostId,
        sentry_device_id: sentryDeviceId,
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as AdsbSourceConfig
  } catch {
    return null
  }
}

/**
 * Claim the source device and tune it, or renew an existing claim.
 *
 * The same call does both — renewing is claiming again — so the caller's timer
 * does not need to know whether the previous lease is still alive.
 *
 * `force` takes the device from whatever holds it: the operator's override,
 * offered only after a `device_reserved` failure has said who that is.
 */
export async function claimAdsbSource(
  force = false,
): Promise<{ claim: AdsbClaim } | { error: AdsbClaimError }> {
  let response: Response
  try {
    response = await fetch(`${BASE}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
  } catch {
    return { error: { code: 'network_error', message: 'Could not reach Sentinel.' } }
  }
  if (!response.ok) {
    return { error: await readError(response, 'The ADS-B source could not be claimed.') }
  }
  return { claim: (await response.json()) as AdsbClaim }
}

/**
 * Release the source device.
 *
 * Never reports failure, because there is nothing a caller could usefully do
 * about it: the lease expires on its own, so the worst case is a couple of
 * minutes of a dongle nobody is using. Uses `keepalive` so a release fired
 * during page unload still leaves the browser.
 */
export async function releaseAdsbSource(): Promise<void> {
  try {
    await fetch(`${BASE}/claim`, { method: 'DELETE', keepalive: true })
  } catch {
    /* the lease expires regardless */
  }
}
