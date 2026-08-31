import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSentrySitesStore } from './sentrySites'
import type { SentrySite } from '@/services/sentryApi'

const SITE: SentrySite = {
  id: 1,
  name: 'Roof Pi',
  address: '192.168.1.60',
  port: 8000,
  reachable: true,
  latitude: 51.5,
  longitude: -0.1,
  updated_at: 1000,
}

/** The poll interval the store uses, in ms — one tick's worth of fake time. */
const POLL_INTERVAL_MS = 15_000

function stubFetch(sites: SentrySite[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sites })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('sentrySites store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts with no sites', () => {
    expect(useSentrySitesStore().sites).toEqual([])
  })

  it('fetchSites replaces the held list from the locations endpoint', async () => {
    const fetchMock = stubFetch([SITE])
    const store = useSentrySitesStore()
    await store.fetchSites()
    expect(fetchMock).toHaveBeenCalledWith('/api/sdr/sentry-hosts/locations', undefined)
    expect(store.sites).toEqual([SITE])
  })

  it('keeps the last-known list when a refresh fails', async () => {
    stubFetch([SITE])
    const store = useSentrySitesStore()
    await store.fetchSites()
    // A Pi (or the backend) going away mid-session must not blank the map.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(store.fetchSites()).resolves.toBeUndefined()
    expect(store.sites).toEqual([SITE])
  })

  it('keeps the last-known list when the backend answers with an error status', async () => {
    stubFetch([SITE])
    const store = useSentrySitesStore()
    await store.fetchSites()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }),
    )
    await store.fetchSites()
    expect(store.sites).toEqual([SITE])
  })

  it('startPolling fetches immediately and then on the interval', async () => {
    const fetchMock = stubFetch([])
    const store = useSentrySitesStore()
    store.startPolling()
    expect(fetchMock).toHaveBeenCalledTimes(1) // immediate
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2) // one interval tick
    store.stopPolling()
  })

  it('ref-counts pollers: a second start does not add a second interval', async () => {
    const fetchMock = stubFetch([])
    const store = useSentrySitesStore()
    store.startPolling()
    store.startPolling() // a second map mounted — joins the existing poll
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2) // still one tick per interval
    store.stopPolling()
    store.stopPolling()
  })

  it('stops polling only when the last consumer leaves', async () => {
    const fetchMock = stubFetch([])
    const store = useSentrySitesStore()
    store.startPolling()
    store.startPolling()
    store.stopPolling() // one consumer left; polling continues
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    store.stopPolling() // last consumer left; polling stops
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(2) // no further ticks
  })

  it('stopPolling with no active poller is a safe no-op', () => {
    const store = useSentrySitesStore()
    expect(() => store.stopPolling()).not.toThrow()
    // …and the count never goes negative, so a later start still polls once.
    const fetchMock = stubFetch([])
    store.startPolling()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    store.stopPolling()
  })
})
