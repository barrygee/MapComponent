import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { claimAdsbSource, getAdsbSource, releaseAdsbSource, setAdsbSource } from './adsbSourceApi'

/**
 * Tests for the `/api/sdr/adsb` client.
 *
 * The behaviour worth pinning is that **nothing here throws**. Every caller is a
 * background lifecycle step — a claim on view entry, a renewal on a timer, a
 * release during unload — where an exception has nobody to catch it and would
 * surface as an unhandled rejection in the console instead of a message in the
 * UI. A claim's failure is information the operator needs, so it comes back as
 * data.
 *
 * The error envelope matters for the same reason: `code` is what separates
 * "pick a source", "take the device back", "fix a password" and "start the Pi",
 * and collapsing them would put the operator back where they started — an empty
 * map and no idea why.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getAdsbSource', () => {
  it('returns the configured source', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        configured: true,
        sentry_host_id: 1,
        sentry_device_id: 'serial:AAA',
      }),
    )

    expect(await getAdsbSource()).toEqual({
      configured: true,
      sentry_host_id: 1,
      sentry_device_id: 'serial:AAA',
    })
  })

  it('returns null on a non-2xx rather than throwing', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, false, 500))

    expect(await getAdsbSource()).toBeNull()
  })

  it('returns null when the network is down', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))

    expect(await getAdsbSource()).toBeNull()
  })
})

describe('setAdsbSource', () => {
  it('sends both ids in the body', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ configured: true }))

    await setAdsbSource(7, 'serial:97710286')

    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      sentry_host_id: 7,
      sentry_device_id: 'serial:97710286',
    })
  })

  it('returns null on a rejection', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, false, 422))

    expect(await setAdsbSource(1, 'serial:AAA')).toBeNull()
  })

  it('returns null when the network is down', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))

    expect(await setAdsbSource(1, 'serial:AAA')).toBeNull()
  })
})

describe('claimAdsbSource', () => {
  it('returns the claim on success', async () => {
    const claim = {
      source: { sentry_host_id: 1, sentry_device_id: 'serial:AAA' },
      reservation: null,
      tuned: { center_hz: 1_090_000_000, sample_rate: 2_400_000 },
      renew_within_seconds: 30,
    }
    fetchSpy.mockResolvedValue(jsonResponse(claim))

    expect(await claimAdsbSource()).toEqual({ claim })
  })

  it('does not force by default', async () => {
    // A renewal must never quietly win a fight over hardware it just lost.
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await claimAdsbSource()

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ force: false })
  })

  it('forces when asked', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}))

    await claimAdsbSource(true)

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ force: true })
  })

  it('surfaces the code and holder of a refusal', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        {
          detail: {
            code: 'device_reserved',
            message: 'Voice decoder has it.',
            holder: 'sentinel:other',
            label: 'Voice decoder',
          },
        },
        false,
        409,
      ),
    )

    const result = await claimAdsbSource()

    expect(result).toEqual({
      error: {
        code: 'device_reserved',
        message: 'Voice decoder has it.',
        holder: 'sentinel:other',
        label: 'Voice decoder',
      },
    })
  })

  it('omits holder and label when the refusal carries none', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ detail: { code: 'no_source', message: 'Pick one.' } }, false, 409),
    )

    const result = await claimAdsbSource()

    expect(result).toEqual({ error: { code: 'no_source', message: 'Pick one.' } })
  })

  it('falls back when the error body is not JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)

    const result = await claimAdsbSource()

    expect(result).toEqual({
      error: { code: 'unknown_error', message: 'The ADS-B source could not be claimed.' },
    })
  })

  it('falls back when the error body has no detail', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ something: 'else' }, false, 500))

    const result = await claimAdsbSource()

    expect(result).toEqual({
      error: { code: 'unknown_error', message: 'The ADS-B source could not be claimed.' },
    })
  })

  it('reports an unreachable Sentinel as a network error, not a claim refusal', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))

    expect(await claimAdsbSource()).toEqual({
      error: { code: 'network_error', message: 'Could not reach Sentinel.' },
    })
  })
})

describe('releaseAdsbSource', () => {
  it('sends a keepalive DELETE so an unload release still leaves the browser', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(null))

    await releaseAdsbSource()

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/sdr/adsb/claim')
    expect(init).toMatchObject({ method: 'DELETE', keepalive: true })
  })

  it('never throws — the lease expires regardless', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))

    await expect(releaseAdsbSource()).resolves.toBeUndefined()
  })
})
