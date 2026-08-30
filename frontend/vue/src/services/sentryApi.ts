/**
 * Typed client for `/api/sdr/sentry-hosts` — Sentinel's remote-client surface
 * onto one or more Sentry hosts (a Raspberry Pi running rtl_tcp dongles, per
 * ADR-0009). Modelled on `sdrSearchApi.ts`'s house style: one function per
 * route, typed request/response shapes, and — because this surface proxies a
 * second service's rejections — a typed error carrying the parsed
 * `{status, code, message}` envelope so a caller can show the operator
 * exactly what Sentry said, per the router's doc comment ("surface Sentry's
 * rejection rather than inventing its own").
 *
 * Every mutating call throws `SentryApiRequestError` on a non-2xx response
 * instead of returning null — unlike `sdrSearchApi.ts`'s silent-null pattern,
 * callers here (the Sentry host/device forms) need the specific rejection
 * message to show inline on the offending field (e.g. a port conflict must
 * name which device holds the port).
 */

const BASE = '/api/sdr/sentry-hosts'

/** One Sentry host Sentinel knows about. Never carries the auth token itself. */
export interface SentryHost {
  id: number
  name: string | null
  address: string
  port: number
  enabled: boolean
  auth_token_set: boolean
  created_at: number
  last_seen_at: number | null
  last_error: string | null
  reachable: boolean
  api_version: string | null
}

/** Where the Sentry reports itself to be, from its `/api/v1/sdrs` `source.location`. */
export interface SentryLocation {
  latitude: number | null
  longitude: number | null
  updated_at: number | null
}

/** The Sentry's own description of itself, from `/api/v1/sdrs`'s `source` block. */
export interface SentrySource {
  name: string | null
  version: string | null
  host: string | null
  http_port: number | null
  location: SentryLocation | null
}

/**
 * Everything Sentinel knows about one host — `GET /api/sdr/sentry-hosts/{id}/info`.
 *
 * A superset of `SentryHost` carrying the poller's telemetry plus a live read
 * of Sentry's two unauthenticated self-report endpoints: `health` (raw
 * `GET /api/health` body — version, uptime, database/hotplug health, device
 * counts) and `source`/`location` (from `GET /api/v1/sdrs`, the only place the
 * Sentry's latitude/longitude is published).
 *
 * Always resolves for a registered host, reachable or not: an unreachable Pi
 * comes back with `reachable: false`, a human-readable `detail`, and null live
 * blocks.
 */
export interface SentryHostInfo extends SentryHost {
  detail: string
  last_polled_at: number | null
  last_success_at: number | null
  health: Record<string, unknown> | null
  source: SentrySource | null
  location: SentryLocation | null
  control_port_offset: number | null
}

/** Body for `POST /api/sdr/sentry-hosts` — register a new host. */
export interface SentryHostCreateInput {
  name?: string | null
  address: string
  port?: number
  auth_token?: string
  enabled?: boolean
}

/**
 * Body for `PUT /api/sdr/sentry-hosts/{id}` — a patch. Every field is
 * optional; an omitted key keeps the stored value, EXCEPT `name`, where an
 * explicit `null` clears it (send the key with value `null`, not omit it).
 * Omit `auth_token` entirely to keep the currently stored token — the API
 * never returns it, so a caller can't round-trip it anyway.
 */
export interface SentryHostPatchInput {
  name?: string | null
  address?: string
  port?: number
  auth_token?: string
  enabled?: boolean
}

/** Response for `POST /api/sdr/sentry-hosts/{id}/test` — always HTTP 200. */
export interface SentryHealthProbeResult {
  reachable: boolean
  detail: string
  api_version?: string | null
  health?: Record<string, unknown> | null
}

/** A device's output ports once Sentry has allocated/configured them. */
export interface SentryDeviceOutput {
  iq_port: number
  control_port: number
  host: string
}

/** USB identity Sentry read off the dongle (or last saw, for `usb_last_known`). */
export interface SentryDeviceUsbIdentity {
  manufacturer: string | null
  product: string | null
  serial: string | null
  topology_path: string | null
}

export type SentryDeviceState =
  | 'detected'
  | 'configured'
  | 'starting'
  | 'streaming'
  | 'degraded'
  | 'stopped'
  | 'error'

/**
 * The persisted tuning intent for one device.
 *
 * Field names match Sentry's `DevicePatch`/`DeviceRecord` schemas exactly
 * (`docs/api/openapi.json` in the Sentry repo) — note `sample_rate`, not
 * `sample_rate_hz`, and `gain_auto`, not `agc`. Sentinel's own radio records
 * happen to call the same concept `agc`, which is why the two are easy to
 * confuse; the wire names here are Sentry's.
 */
export interface SentryDeviceTuning {
  center_hz?: number | null
  sample_rate?: number | null
  gain_db?: number | null
  gain_auto?: boolean
  ppm_correction?: number
  bias_tee?: boolean | null
  direct_sampling?: number | null
}

/**
 * One SDR device as Sentry reports it in `GET /api/status`'s `sdrs` array.
 *
 * Describes what the device is *doing*, not what it is configured to do:
 * `DeviceStatus` deliberately carries no persisted tuning fields. Those live on
 * `SentryDeviceRecord` and are fetched separately by `getSentryDeviceRecords`.
 */
export interface SentryDeviceStatus {
  device_id: string
  name: string
  present: boolean
  state: SentryDeviceState
  state_reason: string | null
  enabled: boolean
  visibility: 'public' | 'private'
  notes: string
  antenna: string
  needs_identification: boolean
  output: SentryDeviceOutput | null
  usb: SentryDeviceUsbIdentity | null
  usb_last_known: SentryDeviceUsbIdentity | null
}

/**
 * One device as Sentry's `GET /api/devices` reports it — the persisted
 * configuration, including the tuning values an edit form needs to pre-fill.
 */
export interface SentryDeviceRecord extends SentryDeviceTuning {
  device_id: string
  record_id: number | null
  name: string
  description: string
  notes: string
  antenna: string
  output_port: number | null
  control_port: number | null
  enabled: boolean
  visibility: 'public' | 'private'
  present: boolean
  state: SentryDeviceState
  needs_identification: boolean
  identity_kind: string
  identity_key: string
  last_serial: string
  last_topology_path: string
}

/** Port rules Sentry enforces, surfaced so the port field can validate before a round trip. */
export interface SentryPortConstraints {
  min_port: number
  max_port: number
  control_port_offset: number
  reserved_ports: number[]
}

/** Response body of `GET /api/sdr/sentry-hosts/{id}/devices/records`. */
export interface SentryDeviceRecordsPayload {
  devices: SentryDeviceRecord[]
  port_suggestion: number | null
  constraints: SentryPortConstraints
}

/** Raw `GET /api/status` body Sentry returns, cached and relayed verbatim. */
export interface SentryStatusPayload {
  generated_at: number
  sdrs: SentryDeviceStatus[]
}

/** Response for `GET /api/sdr/sentry-hosts/{id}/devices` — the poller's cached snapshot. */
export interface SentryDeviceSnapshot {
  reachable: boolean
  last_error: string | null
  last_polled_at: number | null
  last_success_at: number | null
  api_version: string | null
  status: SentryStatusPayload | null
}

/** A partial update forwarded verbatim to Sentry's `PATCH /api/devices/{id}`. */
export type SentryDevicePatch = Partial<
  Pick<SentryDeviceStatus, 'name' | 'enabled' | 'visibility' | 'notes' | 'antenna'>
> &
  SentryDeviceTuning & { output_port?: number; description?: string }

/** Extra machine-readable context a Sentry rejection may carry, e.g. `conflicting_device_id`. */
export type SentryErrorContext = Record<string, unknown>

/**
 * Thrown by every mutating call in this module on a non-2xx response. Carries
 * the parsed `{code, message}` from the backend's `{"detail": {...}}`
 * envelope (or FastAPI's own validation-error shape) plus any extra context
 * keys (e.g. `conflicting_device_id` on a `port_conflict`), so a caller can
 * both show `message` verbatim to the operator and branch on `code`/context
 * to highlight the offending field.
 */
export class SentryApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly context: SentryErrorContext

  constructor(status: number, code: string, message: string, context: SentryErrorContext = {}) {
    super(message)
    this.name = 'SentryApiRequestError'
    this.status = status
    this.code = code
    this.context = context
  }
}

/** A single FastAPI 422 validation-error entry: `{loc: [...], msg: string}`. */
interface FastApiValidationError {
  loc?: unknown[]
  msg?: unknown
}

/**
 * Parse `{"detail": ...}` into `{code, message, context}`. Mirrors the
 * backend's own `_parse_error_envelope` (`backend/services/sentry_client.py`)
 * so the same three shapes are handled here: Sentry's own `{code, message}`
 * envelope (proxied verbatim), FastAPI's list-shaped 422 (raised by this
 * router's own Pydantic validation, before ever reaching Sentry), and a bare
 * string detail.
 */
function parseErrorEnvelope(status: number, body: unknown): SentryApiRequestError {
  const fallbackMessage = `Request failed (HTTP ${status}).`
  if (body === null || typeof body !== 'object' || !('detail' in body)) {
    return new SentryApiRequestError(status, 'unknown_error', fallbackMessage)
  }
  const detail = (body as { detail: unknown }).detail

  if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code : 'unknown_error'
    const message = typeof record.message === 'string' ? record.message : fallbackMessage
    const context: SentryErrorContext = {}
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'code' && key !== 'message') context[key] = value
    }
    return new SentryApiRequestError(status, code, message, context)
  }

  if (Array.isArray(detail)) {
    const described = (detail as FastApiValidationError[])
      .map((entry) => {
        const message = typeof entry.msg === 'string' ? entry.msg.trim() : ''
        if (!message) return null
        const location = Array.isArray(entry.loc)
          ? entry.loc
              .map((part) => String(part))
              .filter((part) => part !== 'body' && part !== 'query' && part !== 'path')
          : []
        return location.length > 0 ? `${location.join('.')}: ${message}` : message
      })
      .filter((line): line is string => line !== null)
    return new SentryApiRequestError(
      status,
      'validation_error',
      described.length > 0 ? described.join('; ') : fallbackMessage,
      { errors: detail },
    )
  }

  if (typeof detail === 'string') {
    return new SentryApiRequestError(status, 'unknown_error', detail)
  }

  return new SentryApiRequestError(status, 'unknown_error', fallbackMessage)
}

async function requestJson<TResponse>(url: string, init?: RequestInit): Promise<TResponse> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new SentryApiRequestError(0, 'network_error', 'Could not reach Sentinel.')
  }
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON error body — fall through to the generic fallback message */
    }
    throw parseErrorEnvelope(response.status, body)
  }
  if (response.status === 204) return undefined as TResponse
  return (await response.json()) as TResponse
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    /* v8 ignore start -- defensive: every call site in this module always
       passes a body (even an empty patch object); the undefined branch has
       no current caller to exercise it. */
    body: body === undefined ? undefined : JSON.stringify(body),
    /* v8 ignore stop */
  }
}

// ── Host CRUD ────────────────────────────────────────────────────────────────

export async function listSentryHosts(): Promise<SentryHost[]> {
  return requestJson<SentryHost[]>(BASE)
}

export async function createSentryHost(input: SentryHostCreateInput): Promise<SentryHost> {
  return requestJson<SentryHost>(BASE, jsonInit('POST', input))
}

export async function updateSentryHost(
  hostId: number,
  patch: SentryHostPatchInput,
): Promise<SentryHost> {
  return requestJson<SentryHost>(`${BASE}/${hostId}`, jsonInit('PUT', patch))
}

export async function deleteSentryHost(hostId: number): Promise<void> {
  await requestJson<undefined>(`${BASE}/${hostId}`, { method: 'DELETE' })
}

/**
 * Every known detail of one host, for the details view: the stored record, the
 * poller's telemetry, and a live read of Sentry's health and `source` blocks.
 *
 * Like `testSentryHost`, never throws for an unreachable host — the backend
 * answers 200 with `reachable: false` — so callers render gaps, not an error.
 */
export async function getSentryHostInfo(hostId: number): Promise<SentryHostInfo> {
  return requestJson<SentryHostInfo>(`${BASE}/${hostId}/info`)
}

/**
 * Probe a host's reachability. Deliberately never throws on an unreachable
 * host — the backend always answers 200 here and reports `reachable: false`
 * instead, so a dead Pi is a normal result, not an error to catch.
 */
export async function testSentryHost(hostId: number): Promise<SentryHealthProbeResult> {
  return requestJson<SentryHealthProbeResult>(`${BASE}/${hostId}/test`, { method: 'POST' })
}

// ── Devices ──────────────────────────────────────────────────────────────────

/** The poller's cached `GET /api/status` snapshot — live presence and state, no tuning. */
export async function getSentryHostDevices(hostId: number): Promise<SentryDeviceSnapshot> {
  return requestJson<SentryDeviceSnapshot>(`${BASE}/${hostId}/devices`)
}

/**
 * Sentry's persisted device configuration, including the tuning values an edit
 * form must pre-fill.
 *
 * A live round-trip rather than the cached snapshot: the operator is about to
 * edit these values, so they have to be current, and the snapshot does not
 * carry them at all. Fetch when a form opens, not on the poll timer.
 */
export async function getSentryDeviceRecords(hostId: number): Promise<SentryDeviceRecordsPayload> {
  return requestJson<SentryDeviceRecordsPayload>(`${BASE}/${hostId}/devices/records`)
}

/**
 * Apply a partial update. Sentry answers with a `DeviceRecord` — its persisted
 * configuration, not a `DeviceStatus` — so the caller sees exactly what was
 * stored, including any value Sentry normalised on the way in.
 */
export async function patchSentryDevice(
  hostId: number,
  deviceId: string,
  patch: SentryDevicePatch,
): Promise<SentryDeviceRecord> {
  return requestJson<SentryDeviceRecord>(
    `${BASE}/${hostId}/devices/${encodeURIComponent(deviceId)}`,
    jsonInit('PATCH', patch),
  )
}

export async function deleteSentryDevice(hostId: number, deviceId: string): Promise<void> {
  await requestJson<undefined>(`${BASE}/${hostId}/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  })
}

/**
 * Begin an EEPROM serial flash. Permanent and interruptible — callers must
 * have already obtained explicit operator confirmation before calling this;
 * `confirm: true` is always sent (the backend rejects anything else).
 */
export async function flashSentryDeviceSerial(
  hostId: number,
  deviceId: string,
  serial: string,
): Promise<unknown> {
  return requestJson<unknown>(
    `${BASE}/${hostId}/devices/${encodeURIComponent(deviceId)}/serial`,
    jsonInit('POST', { serial, confirm: true }),
  )
}
