import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  listRadios,
  createRadio,
  updateRadio,
  deleteRadio,
  getRadioStatus,
  type SdrRadioRecord,
  type SdrRadioInput,
} from './sdrRadiosApi'

function mockFetch(impl: (url: string, opts?: RequestInit) => unknown): void {
  global.fetch = vi.fn((url: string | URL | Request, opts?: RequestInit) =>
    Promise.resolve(impl(String(url), opts)),
  ) as unknown as typeof fetch
}

const sampleRadio: SdrRadioRecord = {
  id: 3,
  name: 'Roof',
  host: '192.168.1.50',
  port: 1234,
  description: '',
  enabled: true,
  bandwidth: 2048000,
  rf_gain: 30,
  agc: true,
  sentry_host_id: null,
  sentry_device_id: null,
  notes: '',
  antenna: '',
  visibility: 'public',
  created_at: 1000,
}

const sampleInput: SdrRadioInput = {
  name: 'Roof',
  host: '192.168.1.50',
  port: 1234,
  description: '',
  enabled: true,
  bandwidth: 2048000,
  rf_gain: 30,
  agc: true,
  sentry_host_id: null,
  sentry_device_id: null,
  notes: '',
  antenna: '',
  visibility: 'public',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('listRadios', () => {
  it('returns the parsed radios on success', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve([sampleRadio]) }))
    await expect(listRadios()).resolves.toEqual([sampleRadio])
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/radios')
  })

  it('returns an empty array on a non-OK response', async () => {
    mockFetch(() => ({ ok: false, json: () => Promise.resolve([]) }))
    await expect(listRadios()).resolves.toEqual([])
  })
})

describe('createRadio', () => {
  it('POSTs the body and returns the created radio', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(sampleRadio) }))
    await expect(createRadio(sampleInput)).resolves.toEqual(sampleRadio)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/radios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleInput),
    })
  })

  it('returns null on a non-OK response', async () => {
    mockFetch(() => ({ ok: false, json: () => Promise.resolve({}) }))
    await expect(createRadio(sampleInput)).resolves.toBeNull()
  })
})

describe('updateRadio', () => {
  it('PUTs the body to the id endpoint and returns the updated radio', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve(sampleRadio) }))
    await expect(updateRadio(3, sampleInput)).resolves.toEqual(sampleRadio)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/radios/3', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleInput),
    })
  })

  it('returns null on a non-OK response', async () => {
    mockFetch(() => ({ ok: false, json: () => Promise.resolve({}) }))
    await expect(updateRadio(3, sampleInput)).resolves.toBeNull()
  })
})

describe('deleteRadio', () => {
  it('issues a DELETE and returns true on success', async () => {
    mockFetch(() => ({ ok: true }))
    await expect(deleteRadio(3)).resolves.toBe(true)
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/radios/3', { method: 'DELETE' })
  })

  it('returns false on a non-OK response', async () => {
    mockFetch(() => ({ ok: false }))
    await expect(deleteRadio(3)).resolves.toBe(false)
  })
})

describe('getRadioStatus', () => {
  it('returns the parsed status on success', async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve({ connected: true }) }))
    await expect(getRadioStatus(3)).resolves.toEqual({ connected: true })
    expect(global.fetch).toHaveBeenCalledWith('/api/sdr/status/3')
  })

  it('returns null on a non-OK response', async () => {
    mockFetch(() => ({ ok: false, json: () => Promise.resolve({}) }))
    await expect(getRadioStatus(3)).resolves.toBeNull()
  })

  it('returns null when the request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    await expect(getRadioStatus(3)).resolves.toBeNull()
  })
})
