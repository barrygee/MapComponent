import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, ref } from 'vue'
import type { SentrySite } from '@/services/sentryApi'

const locationRef = ref<{ lat: number; lon: number; accuracy: number } | null>(null)
vi.mock('@/composables/useUserLocation', () => ({
  useUserLocation: () => ({ location: locationRef }),
}))

import { useAirStore, USER_ALERT_LOCATION_ID, sentryAlertLocationId } from '@/stores/air'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useOverheadAlertZones } from './useOverheadAlertZones'

function site(overrides: Partial<SentrySite> = {}): SentrySite {
  return {
    id: 1,
    name: 'Gateshead',
    address: '192.168.1.60',
    port: 8000,
    reachable: true,
    latitude: 54.95,
    longitude: -1.53,
    updated_at: null,
    ...overrides,
  }
}

describe('useOverheadAlertZones', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    locationRef.value = { lat: 51.5, lon: -0.12, accuracy: 0 }
  })

  describe('the list of places', () => {
    it('puts the operator first, then each Sentry in fleet order', () => {
      useSentrySitesStore().sites = [site(), site({ id: 2, name: 'Coastal' })]
      const { locations } = useOverheadAlertZones()
      expect(locations.value.map((zone) => zone.label)).toEqual([
        'MY LOCATION',
        'GATESHEAD',
        'COASTAL',
      ])
      expect(locations.value[0]!.isUser).toBe(true)
      expect(locations.value[1]!.isUser).toBe(false)
    })

    it('omits the operator when there is no fix', () => {
      locationRef.value = null
      useSentrySitesStore().sites = [site()]
      const { locations } = useOverheadAlertZones()
      // There is no "enabled but nowhere" state: no fix, no place to watch.
      expect(locations.value.map((zone) => zone.id)).toEqual([sentryAlertLocationId(1)])
    })

    it('carries each place its own coordinates', () => {
      useSentrySitesStore().sites = [site()]
      const { locations } = useOverheadAlertZones()
      expect(locations.value[0]).toMatchObject({ lon: -0.12, lat: 51.5 })
      expect(locations.value[1]).toMatchObject({ lon: -1.53, lat: 54.95 })
    })

    it('names a Sentry by address when it has no name', () => {
      useSentrySitesStore().sites = [site({ name: null })]
      expect(useOverheadAlertZones().locations.value[1]!.label).toBe('192.168.1.60:8000')
    })

    it('is empty with no fix and no fleet', () => {
      locationRef.value = null
      expect(useOverheadAlertZones().locations.value).toEqual([])
    })
  })

  describe('resolving each place’s settings', () => {
    it('defaults a place to off at the default radius', () => {
      const { locations } = useOverheadAlertZones()
      expect(locations.value[0]).toMatchObject({ civil: false, mil: false, radiusNm: 10 })
    })

    it('reads the settings stored against that place', () => {
      const airStore = useAirStore()
      useSentrySitesStore().sites = [site()]
      airStore.setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true, radiusNm: 5 })
      airStore.setOverheadAlert(sentryAlertLocationId(1), { mil: true, radiusNm: 40 })

      const { locations } = useOverheadAlertZones()

      // Each Sentry watches its own patch of sky at its own radius.
      expect(locations.value[0]).toMatchObject({ civil: true, mil: false, radiusNm: 5 })
      expect(locations.value[1]).toMatchObject({ civil: false, mil: true, radiusNm: 40 })
    })

    it('follows a setting changed after the fact', async () => {
      const airStore = useAirStore()
      const { locations } = useOverheadAlertZones()
      expect(locations.value[0]!.civil).toBe(false)

      airStore.setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true })
      await nextTick()

      expect(locations.value[0]!.civil).toBe(true)
    })

    it('follows a Sentry joining the fleet', async () => {
      const sentrySitesStore = useSentrySitesStore()
      const { locations } = useOverheadAlertZones()
      expect(locations.value).toHaveLength(1)

      sentrySitesStore.sites = [site()]
      await nextTick()

      expect(locations.value).toHaveLength(2)
    })
  })

  describe('activeZones', () => {
    it('keeps only the places actually watching something', () => {
      const airStore = useAirStore()
      useSentrySitesStore().sites = [site()]
      airStore.setOverheadAlert(sentryAlertLocationId(1), { mil: true })

      const { activeZones } = useOverheadAlertZones()

      expect(activeZones.value.map((zone) => zone.label)).toEqual(['GATESHEAD'])
    })

    it.each([
      ['civil only', { civil: true }],
      ['military only', { mil: true }],
      ['both', { civil: true, mil: true }],
    ])('includes a place watching %s', (_case, patch) => {
      useAirStore().setOverheadAlert(USER_ALERT_LOCATION_ID, patch)
      expect(useOverheadAlertZones().activeZones.value).toHaveLength(1)
    })

    it('is empty while every place is switched off', () => {
      useSentrySitesStore().sites = [site()]
      expect(useOverheadAlertZones().activeZones.value).toEqual([])
    })
  })

  it('gives every caller the same answer, so zones and alerts cannot disagree', () => {
    useAirStore().setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true, radiusNm: 33 })
    // The map and the alert service each call this; they must resolve alike.
    const fromMap = useOverheadAlertZones().activeZones.value
    const fromService = useOverheadAlertZones().activeZones.value
    expect(fromMap).toEqual(fromService)
  })
})
