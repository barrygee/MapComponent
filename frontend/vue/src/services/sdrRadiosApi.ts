/**
 * Typed client for `/api/sdr/radios` + `/api/sdr/status/{id}` — Sentinel's own
 * configured-radio list. Replaces the raw `fetch` calls previously inlined in
 * `SdrDevicesControl.vue` and `SdrDeviceForm.vue`. Modelled on
 * `sdrSearchApi.ts`'s house style (one function per route, typed shapes,
 * silent-null/false on failure — the caller-facing controls already treat a
 * failed request as "nothing changed" rather than surfacing a network error).
 *
 * A radio created from a Sentry-mirrored device carries `sentry_host_id`/
 * `sentry_device_id` (ADR-0009); a manually-entered radio leaves both null and
 * behaves exactly as it always has.
 */

export interface SdrRadioRecord {
  id: number
  name: string
  host: string
  port: number
  description: string
  enabled: boolean
  bandwidth: number | null
  rf_gain: number | null
  agc: boolean | null
  sentry_host_id: number | null
  sentry_device_id: string | null
  notes: string
  antenna: string
  visibility: 'public' | 'private'
  created_at?: number
}

export type SdrRadioInput = Omit<SdrRadioRecord, 'id' | 'created_at'>

export interface SdrRadioStatus {
  connected: boolean
  [key: string]: unknown
}

const RADIOS_BASE = '/api/sdr/radios'

export async function listRadios(): Promise<SdrRadioRecord[]> {
  const response = await fetch(RADIOS_BASE)
  if (!response.ok) return []
  return (await response.json()) as SdrRadioRecord[]
}

export async function createRadio(input: SdrRadioInput): Promise<SdrRadioRecord | null> {
  const response = await fetch(RADIOS_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return null
  return (await response.json()) as SdrRadioRecord
}

export async function updateRadio(
  radioId: number,
  input: SdrRadioInput,
): Promise<SdrRadioRecord | null> {
  const response = await fetch(`${RADIOS_BASE}/${radioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) return null
  return (await response.json()) as SdrRadioRecord
}

export async function deleteRadio(radioId: number): Promise<boolean> {
  const response = await fetch(`${RADIOS_BASE}/${radioId}`, { method: 'DELETE' })
  return response.ok
}

export async function getRadioStatus(radioId: number): Promise<SdrRadioStatus | null> {
  try {
    const response = await fetch(`/api/sdr/status/${radioId}`)
    if (!response.ok) return null
    return (await response.json()) as SdrRadioStatus
  } catch {
    return null
  }
}
