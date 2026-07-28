import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAirStore, DEFAULT_OVERHEAD_ALERT_RADIUS_NM } from './air'

const LS_OVERLAYS = 'overlayStates'
const LS_LABELS = 'adsbLabelFields'
const LS_TAGS = 'adsbTagFields_v3'
const LS_RADIUS = 'overheadAlertRadiusNm'
const LS_REPLAY = 'airReplayEnabled'

describe('air store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initialises overlay states to the defaults', () => {
    const store = useAirStore()
    expect(store.overlayStates.adsb).toBe(true)
    expect(store.overlayStates.overheadAlertsCivil).toBe(false)
    expect(store.replayEnabled).toBe(false)
    expect(store.overheadAlertRadiusNm).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    expect(store.filterQuery).toBe('')
    expect(store.filterOpen).toBe(false)
    expect(store.mapCenter).toBeNull()
    expect(store.mapZoom).toBeNull()
    expect(store.pitch).toBe(0)
  })

  describe('overlay migration', () => {
    it('splits a legacy overheadAlerts flag into civil and mil', () => {
      localStorage.setItem(LS_OVERLAYS, JSON.stringify({ overheadAlerts: true }))
      const store = useAirStore()
      expect(store.overlayStates.overheadAlertsCivil).toBe(true)
      expect(store.overlayStates.overheadAlertsMil).toBe(true)
      expect(
        (store.overlayStates as unknown as Record<string, unknown>).overheadAlerts,
      ).toBeUndefined()
    })

    it('does not overwrite split flags that already exist', () => {
      localStorage.setItem(
        LS_OVERLAYS,
        JSON.stringify({ overheadAlerts: true, overheadAlertsCivil: false }),
      )
      const store = useAirStore()
      expect(store.overlayStates.overheadAlertsCivil).toBe(false)
    })

    it('keeps a stored value with no legacy flag', () => {
      localStorage.setItem(LS_OVERLAYS, JSON.stringify({ adsb: false }))
      const store = useAirStore()
      expect(store.overlayStates.adsb).toBe(false)
    })
  })

  describe('label-field migration', () => {
    it('keeps array values and defaults non-array ones', () => {
      localStorage.setItem(LS_LABELS, JSON.stringify({ civil: ['alt'], mil: 'bad' }))
      const store = useAirStore()
      expect(store.adsbLabelFields.civil).toEqual(['alt'])
      expect(store.adsbLabelFields.mil).toEqual(['type'])
    })

    it('defaults a non-array civil while keeping an array mil', () => {
      localStorage.setItem(LS_LABELS, JSON.stringify({ civil: 'bad', mil: ['alt'] }))
      const store = useAirStore()
      expect(store.adsbLabelFields.civil).toEqual(['type'])
      expect(store.adsbLabelFields.mil).toEqual(['alt'])
    })
  })

  describe('tag-field migration', () => {
    it('merges a stored tag map over the defaults', () => {
      localStorage.setItem(LS_TAGS, JSON.stringify({ civil: { altitude: true } }))
      const store = useAirStore()
      expect(store.adsbTagFields.civil.altitude).toBe(true)
      expect(store.adsbTagFields.civil.callsign).toBe(true) // from defaults
    })

    it('falls back to defaults when a side is not an object map', () => {
      localStorage.setItem(LS_TAGS, JSON.stringify({ civil: 'nope', mil: ['arr'] }))
      const store = useAirStore()
      expect(store.adsbTagFields.civil.callsign).toBe(true)
      expect(store.adsbTagFields.mil.aircraftType).toBe(true) // mil default
    })

    it('merges a stored mil tag map over the defaults', () => {
      localStorage.setItem(LS_TAGS, JSON.stringify({ mil: { squawk: true } }))
      const store = useAirStore()
      expect(store.adsbTagFields.mil.squawk).toBe(true)
      expect(store.adsbTagFields.mil.callsign).toBe(true) // from defaults
    })
  })

  describe('readPersistedReplayEnabled', () => {
    it('reads an enabled flag of "1" as true', () => {
      localStorage.setItem(LS_REPLAY, '1')
      expect(useAirStore().replayEnabled).toBe(true)
    })

    it('treats any other value as false', () => {
      localStorage.setItem(LS_REPLAY, '0')
      expect(useAirStore().replayEnabled).toBe(false)
    })

    it('defaults to false when localStorage throws', () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useAirStore().replayEnabled).toBe(false)
    })
  })

  describe('readPersistedRadius', () => {
    it('reads a valid positive number', () => {
      localStorage.setItem(LS_RADIUS, '25')
      expect(useAirStore().overheadAlertRadiusNm).toBe(25)
    })

    it('falls back to the default for a non-positive value', () => {
      localStorage.setItem(LS_RADIUS, '-5')
      expect(useAirStore().overheadAlertRadiusNm).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    })

    it('falls back to the default for a non-numeric value', () => {
      localStorage.setItem(LS_RADIUS, 'abc')
      expect(useAirStore().overheadAlertRadiusNm).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    })

    it('defaults when localStorage throws', () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useAirStore().overheadAlertRadiusNm).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    })
  })

  it('setOverlay updates and persists a single overlay', () => {
    const store = useAirStore()
    store.setOverlay('airports', false)
    expect(store.overlayStates.airports).toBe(false)
    expect(JSON.parse(localStorage.getItem(LS_OVERLAYS)!).airports).toBe(false)
  })

  it('setAdsbLabelFields and setAdsbTagFields replace the field config', () => {
    const store = useAirStore()
    store.setAdsbLabelFields({ civil: ['alt'], mil: ['alt'] })
    expect(store.adsbLabelFields.civil).toEqual(['alt'])
    store.setAdsbTagFields({
      ...store.adsbTagFields,
      civil: { ...store.adsbTagFields.civil, squawk: true },
    })
    expect(store.adsbTagFields.civil.squawk).toBe(true)
  })

  describe('setReplayEnabled', () => {
    it('persists "1" when enabled and "0" when disabled', () => {
      const store = useAirStore()
      store.setReplayEnabled(true)
      expect(store.replayEnabled).toBe(true)
      expect(localStorage.getItem(LS_REPLAY)).toBe('1')
      store.setReplayEnabled(false)
      expect(localStorage.getItem(LS_REPLAY)).toBe('0')
    })

    it('swallows write failures', () => {
      const store = useAirStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setReplayEnabled(true)).not.toThrow()
      expect(store.replayEnabled).toBe(true)
    })
  })

  describe('setOverheadAlertRadiusNm', () => {
    it('accepts and persists a valid positive radius', () => {
      const store = useAirStore()
      store.setOverheadAlertRadiusNm(30)
      expect(store.overheadAlertRadiusNm).toBe(30)
      expect(localStorage.getItem(LS_RADIUS)).toBe('30')
    })

    it('rejects non-finite or non-positive values', () => {
      const store = useAirStore()
      store.setOverheadAlertRadiusNm(0)
      store.setOverheadAlertRadiusNm(Number.NaN)
      expect(store.overheadAlertRadiusNm).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    })

    it('swallows write failures', () => {
      const store = useAirStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setOverheadAlertRadiusNm(30)).not.toThrow()
      expect(store.overheadAlertRadiusNm).toBe(30)
    })
  })

  it('setFilter, toggleFilter and saveMapState update map/filter state', () => {
    const store = useAirStore()
    store.setFilter('BAW')
    expect(store.filterQuery).toBe('BAW')
    store.toggleFilter()
    expect(store.filterOpen).toBe(true)
    store.saveMapState([1, 2], 5, 45)
    expect(store.mapCenter).toEqual([1, 2])
    expect(store.mapZoom).toBe(5)
    expect(store.pitch).toBe(45)
  })

  describe('airFilterCategory', () => {
    it('defaults to aircraft', () => {
      expect(useAirStore().airFilterCategory).toBe('aircraft')
    })

    it('setAirFilterCategory updates and persists the active category', () => {
      const store = useAirStore()
      store.setAirFilterCategory('mil')
      expect(store.airFilterCategory).toBe('mil')
      expect(localStorage.getItem('sentinel_air_filterCategory')).toBe('"mil"')
    })

    it('restores a persisted valid category and ignores an invalid one', () => {
      localStorage.setItem('sentinel_air_filterCategory', '"airports"')
      expect(useAirStore().airFilterCategory).toBe('airports')
      setActivePinia(createPinia())
      localStorage.setItem('sentinel_air_filterCategory', '"bogus"')
      expect(useAirStore().airFilterCategory).toBe('aircraft')
    })
  })
})
