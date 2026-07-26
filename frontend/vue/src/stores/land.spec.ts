import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLandStore } from './land'

const STATION = {
  callsign: 'M0ABC-9',
  latitude: 51.5,
  longitude: -0.1,
  symbol: '/>',
  comment: 'rolling',
  course: 90,
  speed: 30,
  altitude: 120,
  path: 'WIDE1-1',
  raw: 'M0ABC-9>APRS:!x',
  last_heard_ms: 1000,
}

describe('land store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts empty', () => {
    expect(useLandStore().aprsStations).toEqual([])
  })

  it('fetchAprsStations replaces the list from the snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [STATION] }) }),
    )
    const store = useLandStore()
    await store.fetchAprsStations()
    expect(store.aprsStations).toEqual([STATION])
  })

  it('fetchAprsStations ignores a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    const store = useLandStore()
    await store.fetchAprsStations()
    expect(store.aprsStations).toEqual([])
  })

  it('fetchAprsStations ignores a payload without a stations array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ oops: 1 }) }))
    const store = useLandStore()
    await store.fetchAprsStations()
    expect(store.aprsStations).toEqual([])
  })

  it('fetchAprsStations swallows a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const store = useLandStore()
    await expect(store.fetchAprsStations()).resolves.toBeUndefined()
    expect(store.aprsStations).toEqual([])
  })

  it('startAprsPolling fetches immediately and then on the interval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useLandStore()
    store.startAprsPolling()
    expect(fetchMock).toHaveBeenCalledTimes(1) // immediate
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2) // one interval tick
    store.stopAprsPolling()
  })

  it('ref-counts pollers: a second start does not add a second interval', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useLandStore()
    store.startAprsPolling()
    store.startAprsPolling() // second consumer — no extra immediate fetch, no 2nd timer
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2) // still just one tick per interval
    store.stopAprsPolling()
    store.stopAprsPolling()
  })

  it('stops polling only when the last consumer leaves', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useLandStore()
    store.startAprsPolling()
    store.startAprsPolling()
    store.stopAprsPolling() // one consumer left; polling continues
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    store.stopAprsPolling() // last consumer left; polling stops
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(2) // no more ticks
  })

  it('stopAprsPolling with no active poller is a safe no-op', () => {
    const store = useLandStore()
    expect(() => store.stopAprsPolling()).not.toThrow()
  })

  describe('APRS retention setting', () => {
    it('defaults to 5 minutes and can be set', () => {
      const store = useLandStore()
      expect(store.aprsRetentionMinutes).toBe(5)
      store.setAprsRetentionMinutes(30)
      expect(store.aprsRetentionMinutes).toBe(30)
    })
  })

  describe('default layers', () => {
    it('defaults to ["aprs"]', () => {
      expect(useLandStore().defaultLayers).toEqual(['aprs'])
    })

    it('hydrates the layer list from the land settings', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ defaultLayers: ['aprs', 'weather'] }),
        }),
      )
      const store = useLandStore()
      await store.hydrateDefaultLayers()
      expect(store.defaultLayers).toEqual(['aprs', 'weather'])
    })

    it('keeps the default on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      const store = useLandStore()
      await store.hydrateDefaultLayers()
      expect(store.defaultLayers).toEqual(['aprs'])
    })

    it('keeps the default when the payload has no layer array', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ other: 1 }) }),
      )
      const store = useLandStore()
      await store.hydrateDefaultLayers()
      expect(store.defaultLayers).toEqual(['aprs'])
    })

    it('swallows a network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const store = useLandStore()
      await expect(store.hydrateDefaultLayers()).resolves.toBeUndefined()
      expect(store.defaultLayers).toEqual(['aprs'])
    })
  })

  describe('APRS label fields', () => {
    it('defaults to the icon + callsign, matching the pre-settings map', () => {
      const store = useLandStore()
      expect(store.aprsLabelFields.callsign).toBe(true)
      expect(store.aprsLabelFields.symbol).toBe(true)
      // The symbol's name is a separate field, off by default.
      expect(store.aprsLabelFields.symbolText).toBe(false)
      expect(store.aprsLabelFields.time).toBe(false)
      expect(store.aprsLabelFields.speed).toBe(false)
      expect(store.aprsLabelFields.comment).toBe(false)
    })

    it('tracks the symbol icon and its text independently', () => {
      const store = useLandStore()
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbol: false, symbolText: true })
      expect(store.aprsLabelFields.symbol).toBe(false)
      expect(store.aprsLabelFields.symbolText).toBe(true)
    })

    it('replaces the whole map on set', () => {
      const store = useLandStore()
      store.setAprsLabelFields({ ...store.aprsLabelFields, speed: true, callsign: false })
      expect(store.aprsLabelFields.speed).toBe(true)
      expect(store.aprsLabelFields.callsign).toBe(false)
    })

    it('persists the choice to localStorage', () => {
      const store = useLandStore()
      store.setAprsLabelFields({ ...store.aprsLabelFields, path: true })
      expect(JSON.parse(localStorage.getItem('aprsLabelFields_v1')!).path).toBe(true)
    })

    it('restores a persisted choice on a fresh store', () => {
      localStorage.setItem('aprsLabelFields_v1', JSON.stringify({ comment: true }))
      setActivePinia(createPinia())
      const store = useLandStore()
      expect(store.aprsLabelFields.comment).toBe(true)
      // Keys absent from storage fall back to their defaults rather than undefined.
      expect(store.aprsLabelFields.callsign).toBe(true)
    })
  })

  describe('APRS layer visibility', () => {
    it('starts visible', () => {
      expect(useLandStore().aprsLayerVisible).toBe(true)
    })

    it('toggles, so the map and the side panel list stay in step', () => {
      const store = useLandStore()
      store.setAprsLayerVisible(false)
      expect(store.aprsLayerVisible).toBe(false)
      store.setAprsLayerVisible(true)
      expect(store.aprsLayerVisible).toBe(true)
    })
  })

  describe('search pane state', () => {
    it('starts with an empty query and no expanded station', () => {
      const store = useLandStore()
      expect(store.searchQuery).toBe('')
      expect(store.searchExpandedCallsign).toBe('')
    })

    it('records and persists the query', () => {
      const store = useLandStore()
      store.setSearchQuery('M0ABC')
      expect(store.searchQuery).toBe('M0ABC')
      expect(localStorage.getItem('sentinel_land_filterQuery')).toContain('M0ABC')
    })

    it('records the expanded station and clears it again', () => {
      const store = useLandStore()
      store.setSearchExpandedCallsign('M0ABC-9')
      expect(store.searchExpandedCallsign).toBe('M0ABC-9')
      store.setSearchExpandedCallsign('')
      expect(store.searchExpandedCallsign).toBe('')
    })

    it('restores persisted search state on a fresh store', () => {
      localStorage.setItem('sentinel_land_filterQuery', JSON.stringify('MB7'))
      localStorage.setItem('sentinel_land_filterExpanded', JSON.stringify('MB7UMS'))
      setActivePinia(createPinia())
      const store = useLandStore()
      expect(store.searchQuery).toBe('MB7')
      expect(store.searchExpandedCallsign).toBe('MB7UMS')
    })
  })
})
