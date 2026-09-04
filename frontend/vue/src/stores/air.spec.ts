import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useAirStore,
  DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
  USER_ALERT_LOCATION_ID,
  sentryAlertLocationId,
} from './air'

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
    expect(store.replayEnabled).toBe(false)
    expect(store.filterQuery).toBe('')
    expect(store.filterOpen).toBe(false)
    expect(store.mapCenter).toBeNull()
    expect(store.mapZoom).toBeNull()
    expect(store.pitch).toBe(0)
  })

  describe('overlay migration', () => {
    it('drops the legacy overhead flags — they are alert settings now', () => {
      localStorage.setItem(
        LS_OVERLAYS,
        JSON.stringify({ overheadAlerts: true, overheadAlertsCivil: true, adsb: false }),
      )
      const overlays = useAirStore().overlayStates as unknown as Record<string, unknown>
      // They live on `overheadAlerts`, per location — see the migration below.
      expect(overlays.overheadAlerts).toBeUndefined()
      expect(overlays.overheadAlertsCivil).toBeUndefined()
      expect(overlays.overheadAlertsMil).toBeUndefined()
    })

    it('keeps a stored value with no legacy flag', () => {
      localStorage.setItem(LS_OVERLAYS, JSON.stringify({ adsb: false }))
      const store = useAirStore()
      expect(store.overlayStates.adsb).toBe(false)
    })
  })

  describe('overhead alerts, per location', () => {
    it('defaults a location to off at the default radius', () => {
      const store = useAirStore()
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID)).toEqual({
        civil: false,
        mil: false,
        radiusNm: DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
      })
    })

    it('names a Sentry location by its host id', () => {
      expect(sentryAlertLocationId(7)).toBe('sentry:7')
    })

    it('patches one field, leaving the rest of that location alone', () => {
      const store = useAirStore()
      store.setOverheadAlert(USER_ALERT_LOCATION_ID, { radiusNm: 25 })
      store.setOverheadAlert(USER_ALERT_LOCATION_ID, { mil: true })
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID)).toEqual({
        civil: false,
        mil: true,
        radiusNm: 25,
      })
    })

    it('keeps each location’s settings independent', () => {
      const store = useAirStore()
      const sentry = sentryAlertLocationId(1)
      store.setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true, radiusNm: 5 })
      store.setOverheadAlert(sentry, { mil: true, radiusNm: 40 })
      // Each Sentry watches its own patch of sky at its own radius.
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID)).toMatchObject({
        civil: true,
        radiusNm: 5,
      })
      expect(store.overheadAlertFor(sentry)).toMatchObject({ mil: true, radiusNm: 40 })
    })

    it.each([0, -5, Number.NaN])('refuses a radius of %s', (radiusNm) => {
      const store = useAirStore()
      store.setOverheadAlert(USER_ALERT_LOCATION_ID, { radiusNm })
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(
        DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
      )
    })

    it('persists the settings', () => {
      useAirStore().setOverheadAlert(sentryAlertLocationId(2), { civil: true, radiusNm: 15 })
      // The operator's own location is always present (the migration seeds it),
      // so this asserts the Sentry's entry rather than the whole map.
      expect(JSON.parse(localStorage.getItem('overheadAlerts') ?? '{}')['sentry:2']).toEqual({
        civil: true,
        mil: false,
        radiusNm: 15,
      })
    })

    it('restores persisted settings', () => {
      localStorage.setItem(
        'overheadAlerts',
        JSON.stringify({ 'sentry:3': { civil: true, mil: false, radiusNm: 30 } }),
      )
      expect(useAirStore().overheadAlertFor('sentry:3')).toEqual({
        civil: true,
        mil: false,
        radiusNm: 30,
      })
    })

    it('forgets a location that has left the fleet', () => {
      const store = useAirStore()
      const sentry = sentryAlertLocationId(4)
      store.setOverheadAlert(sentry, { civil: true })
      store.forgetOverheadAlert(sentry)
      expect(store.overheadAlertFor(sentry).civil).toBe(false)
      expect(JSON.parse(localStorage.getItem('overheadAlerts') ?? '{}')[sentry]).toBeUndefined()
    })

    it('forgetting an unknown location changes nothing', () => {
      const store = useAirStore()
      store.setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true })
      store.forgetOverheadAlert('sentry:999')
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(true)
    })

    describe('migrating the pre-split single configuration', () => {
      it('carries the old civil/mil flags and radius onto your own location', () => {
        localStorage.setItem(
          LS_OVERLAYS,
          JSON.stringify({ overheadAlertsCivil: true, overheadAlertsMil: false }),
        )
        localStorage.setItem('overheadAlertRadiusNm', '18')
        // An existing setup must keep alerting on exactly what it did before.
        expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID)).toEqual({
          civil: true,
          mil: false,
          radiusNm: 18,
        })
      })

      it('reads the even older single overheadAlerts flag as both classes', () => {
        localStorage.setItem(LS_OVERLAYS, JSON.stringify({ overheadAlerts: true }))
        expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID)).toMatchObject({
          civil: true,
          mil: true,
        })
      })

      it('prefers already-migrated settings over the legacy flags', () => {
        localStorage.setItem(LS_OVERLAYS, JSON.stringify({ overheadAlertsCivil: true }))
        localStorage.setItem(
          'overheadAlerts',
          JSON.stringify({ user: { civil: false, mil: false, radiusNm: 10 } }),
        )
        expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(false)
      })

      it('survives unreadable stored settings', () => {
        localStorage.setItem('overheadAlerts', '{oops')
        expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(false)
      })
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

  describe('reading the legacy radius during migration', () => {
    // The pre-split radius has no setting of its own any more; it survives only
    // to be carried onto the operator's own alert location.
    function migratedRadius(): number {
      localStorage.setItem(LS_OVERLAYS, JSON.stringify({ overheadAlertsCivil: true }))
      return useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm
    }

    it('reads a valid positive number', () => {
      localStorage.setItem(LS_RADIUS, '25')
      expect(migratedRadius()).toBe(25)
    })

    it.each([
      ['a non-positive value', '-5'],
      ['a non-numeric value', 'abc'],
    ])('falls back to the default for %s', (_case, stored) => {
      localStorage.setItem(LS_RADIUS, stored)
      expect(migratedRadius()).toBe(DEFAULT_OVERHEAD_ALERT_RADIUS_NM)
    })

    it('defaults when localStorage throws', () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(
        DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
      )
    })

    it('defaults when only the radius key is unreadable', () => {
      localStorage.setItem(LS_OVERLAYS, JSON.stringify({ overheadAlertsCivil: true }))
      const real = localStorage.getItem.bind(localStorage)
      vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
        if (key === LS_RADIUS) throw new Error('blocked')
        return real(key)
      })
      // The migration still runs; only the radius falls back.
      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID)).toMatchObject({
        civil: true,
        radiusNm: DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
      })
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

  describe('persisting alert settings', () => {
    it('swallows write failures, keeping the in-memory settings', () => {
      const store = useAirStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setOverheadAlert(USER_ALERT_LOCATION_ID, { radiusNm: 30 })).not.toThrow()
      expect(store.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(30)
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
describe('air store — ADS-B filter overlays', () => {
  it('shows ground vehicles and towers by default', () => {
    const store = useAirStore()
    // Both are part of the picture until the operator says otherwise; the map
    // reads them as "shown" and inverts them onto the control's "hide".
    expect(store.overlayStates.groundVehicles).toBe(true)
    expect(store.overlayStates.towers).toBe(true)
  })

  it('persists them like every other overlay', () => {
    const store = useAirStore()
    store.setOverlay('groundVehicles', false)
    store.setOverlay('towers', false)
    const stored = JSON.parse(localStorage.getItem('overlayStates') ?? '{}')
    expect(stored.groundVehicles).toBe(false)
    expect(stored.towers).toBe(false)
  })
})
