import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  listSentryHosts,
  createSentryHost,
  updateSentryHost,
  deleteSentryHost,
  testSentryHost,
  getSentryHostDevices,
  getSentryDeviceRecords,
  getSentryHostInfo,
  patchSentryDevice,
  deleteSentryDevice,
  flashSentryDeviceSerial,
  SentryApiRequestError,
  type SentryHost,
  type SentryHostCreateInput,
  type SentryDeviceSnapshot,
  type SentryHostInfo,
  type SentryDeviceRecordsPayload,
  type SentryDeviceRecord,
  type SentryHealthProbeResult,
} from './sentryApi'

function mockFetch(impl: (url: string, opts?: RequestInit) => unknown): void {
  global.fetch = vi.fn((url: string | URL | Request, opts?: RequestInit) =>
    Promise.resolve(impl(String(url), opts)),
  ) as unknown as typeof fetch
}

const sampleHost: SentryHost = {
  id: 1,
  name: 'Pi Roof',
  address: '192.168.1.60',
  port: 8000,
  enabled: true,
  auth_token_set: false,
  created_at: 1000,
  last_seen_at: null,
  last_error: null,
  reachable: true,
  api_version: '1.0',
}

const sampleCreateInput: SentryHostCreateInput = {
  name: 'Pi Roof',
  address: '192.168.1.60',
  port: 8000,
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('listSentryHosts', () => {
  it('returns the parsed hosts on success', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve([sampleHost]) }))
    await expect(listSentryHosts()).resolves.toEqual([sampleHost])
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts', undefined)
  })
})

describe('createSentryHost', () => {
  it('POSTs the body and returns the created host', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(sampleHost) }))
    await expect(createSentryHost(sampleCreateInput)).resolves.toEqual(sampleHost)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleCreateInput),
    })
  })
})

describe('updateSentryHost', () => {
  it('PUTs the patch to the id endpoint and returns the updated host', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(sampleHost) }))
    await expect(updateSentryHost(1, { enabled: false })).resolves.toEqual(sampleHost)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
  })
})

describe('deleteSentryHost', () => {
  it('issues a DELETE against the id endpoint', async () => {
    mockFetch(() => ({ ok: true, status: 204 }))
    await deleteSentryHost(1)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1', { method: 'DELETE' })
  })
})

describe('testSentryHost', () => {
  it('POSTs to the test endpoint and returns the probe result even when unreachable', async () => {
    const unreachable: SentryHealthProbeResult = { reachable: false, detail: 'timed out' }
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(unreachable) }))
    await expect(testSentryHost(1)).resolves.toEqual(unreachable)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/test', { method: 'POST' })
  })
})

describe('getSentryHostDevices', () => {
  it('returns the cached device snapshot', async () => {
    const snapshot: SentryDeviceSnapshot = {
      reachable: true,
      last_error: null,
      last_polled_at: 100,
      last_success_at: 100,
      api_version: '1.0',
      status: null,
    }
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(snapshot) }))
    await expect(getSentryHostDevices(1)).resolves.toEqual(snapshot)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/devices', undefined)
  })
})

describe('getSentryHostInfo', () => {
  it("returns the host record merged with Sentry's live self-report", async () => {
    const info = {
      id: 1,
      name: 'Gateshead',
      address: '192.168.5.67',
      port: 8000,
      enabled: true,
      auth_token_set: true,
      created_at: 1,
      last_seen_at: 2,
      last_error: null,
      reachable: true,
      api_version: '1',
      detail: 'ok',
      last_polled_at: 3,
      last_success_at: 3,
      health: { status: 'ok' },
      source: {
        name: 'sentry',
        version: '0.1.0',
        host: '192.168.5.67',
        http_port: 8000,
        location: { latitude: 54.95, longitude: -1.53, updated_at: 4 },
      },
      location: { latitude: 54.95, longitude: -1.53, updated_at: 4 },
      control_port_offset: 2,
    } satisfies SentryHostInfo
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(info) }))
    await expect(getSentryHostInfo(1)).resolves.toEqual(info)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/info', undefined)
  })
})

describe('getSentryDeviceRecords', () => {
  it('returns the persisted device records payload', async () => {
    const payload: SentryDeviceRecordsPayload = {
      devices: [],
      port_suggestion: 1234,
      constraints: { min_port: 1024, max_port: 65535, control_port_offset: 1, reserved_ports: [] },
    }
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(payload) }))
    await expect(getSentryDeviceRecords(1)).resolves.toEqual(payload)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/devices/records', undefined)
  })
})

describe('patchSentryDevice', () => {
  it('PATCHes the device and URL-encodes the device id', async () => {
    const record: SentryDeviceRecord = {
      device_id: 'usb:1/2',
      record_id: 5,
      name: 'RTL 1',
      description: '',
      notes: '',
      antenna: '',
      output_port: 1234,
      control_port: 1235,
      enabled: true,
      visibility: 'public',
      present: true,
      state: 'streaming',
      needs_identification: false,
      identity_kind: 'serial',
      identity_key: 'ABC',
      last_serial: 'ABC',
      last_topology_path: '',
    }
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(record) }))
    await expect(patchSentryDevice(1, 'usb:1/2', { name: 'RTL 1' })).resolves.toEqual(record)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/devices/usb%3A1%2F2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'RTL 1' }),
    })
  })
})

describe('deleteSentryDevice', () => {
  it('issues a DELETE against the URL-encoded device id endpoint', async () => {
    mockFetch(() => ({ ok: true, status: 204 }))
    await deleteSentryDevice(1, 'usb:1/2')
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/sentry-hosts/1/devices/usb%3A1%2F2', {
      method: 'DELETE',
    })
  })
})

describe('flashSentryDeviceSerial', () => {
  it('always sends confirm: true alongside the serial', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve({}) }))
    await flashSentryDeviceSerial(1, 'usb:1/2', 'NEW-SERIAL')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sdr/sentry-hosts/1/devices/usb%3A1%2F2/serial',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: 'NEW-SERIAL', confirm: true }),
      },
    )
  })
})

describe('requestJson success shapes', () => {
  it('resolves to undefined on a 204 response without parsing a body', async () => {
    const jsonSpy = vi.fn()
    mockFetch(() => ({ ok: true, status: 204, json: jsonSpy }))
    await expect(deleteSentryHost(1)).resolves.toBeUndefined()
    expect(jsonSpy).not.toHaveBeenCalled()
  })
})

describe('SentryApiRequestError envelope parsing', () => {
  it('throws a network_error when fetch itself rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch
    await expect(listSentryHosts()).rejects.toMatchObject({
      name: 'SentryApiRequestError',
      status: 0,
      code: 'network_error',
    })
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    mockFetch(() => ({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 502,
      code: 'unknown_error',
      message: 'Request failed (HTTP 502).',
    })
  })

  it('falls back to a generic message when the body has no detail key', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: () => Promise.resolve({ oops: true }) }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 500,
      code: 'unknown_error',
      message: 'Request failed (HTTP 500).',
    })
  })

  it('falls back to a generic message when the body is null', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: () => Promise.resolve(null) }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 500,
      code: 'unknown_error',
      message: 'Request failed (HTTP 500).',
    })
  })

  it("parses Sentry's own {code, message} envelope and preserves extra context keys", async () => {
    mockFetch(() => ({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          detail: {
            code: 'port_conflict',
            message: 'Port 1234 is already in use.',
            conflicting_device_id: 'usb:1/1',
          },
        }),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 409,
      code: 'port_conflict',
      message: 'Port 1234 is already in use.',
      context: { conflicting_device_id: 'usb:1/1' },
    })
  })

  it('defaults code and message when the Sentry envelope omits them', async () => {
    mockFetch(() => ({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: { some_context: 'x' } }),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 400,
      code: 'unknown_error',
      message: 'Request failed (HTTP 400).',
      context: { some_context: 'x' },
    })
  })

  it('joins FastAPI list-shaped 422 entries with their field location', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          detail: [
            { loc: ['body', 'address'], msg: 'field required' },
            { loc: ['query', 'port'], msg: 'must be an integer' },
          ],
        }),
    }))
    const error = await listSentryHosts().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SentryApiRequestError)
    const requestError = error as InstanceType<typeof SentryApiRequestError>
    expect(requestError.status).toBe(422)
    expect(requestError.code).toBe('validation_error')
    expect(requestError.message).toBe('address: field required; port: must be an integer')
    expect(requestError.context.errors).toEqual([
      { loc: ['body', 'address'], msg: 'field required' },
      { loc: ['query', 'port'], msg: 'must be an integer' },
    ])
  })

  it('describes a 422 entry with no location as the message alone', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: [{ msg: 'general failure' }] }),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      code: 'validation_error',
      message: 'general failure',
    })
  })

  it('falls back to the generic message when every 422 entry lacks a usable message', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: [{ msg: '   ' }, { loc: ['body'] }] }),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      message: 'Request failed (HTTP 422).',
    })
  })

  it('parses a bare string detail as the message', async () => {
    mockFetch(() => ({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ detail: 'Not authorized.' }),
    }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 403,
      code: 'unknown_error',
      message: 'Not authorized.',
    })
  })

  it('falls back to the generic message when detail is a shape none of the parsers handle', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: () => Promise.resolve({ detail: 42 }) }))
    await expect(listSentryHosts()).rejects.toMatchObject({
      status: 500,
      code: 'unknown_error',
      message: 'Request failed (HTTP 500).',
    })
  })
})
