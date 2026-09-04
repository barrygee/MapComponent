import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { axe } from 'jest-axe'
import type { SentrySite } from '@/services/sentryApi'

vi.mock('@/services/settingsApi', () => ({
  getNamespace: vi.fn(() => Promise.resolve(null)),
  put: vi.fn(() => Promise.resolve()),
  del: vi.fn(),
  getAll: vi.fn(),
}))
import * as settingsApi from '@/services/settingsApi'

const locationRef = ref<{ lat: number; lon: number; accuracy: number } | null>(null)
vi.mock('@/composables/useUserLocation', () => ({
  useUserLocation: () => ({ location: locationRef }),
}))

import { useAirStore, USER_ALERT_LOCATION_ID, sentryAlertLocationId } from '@/stores/air'
import { useSentrySitesStore } from '@/stores/sentrySites'
import OverheadAlertsControl from './OverheadAlertsControl.vue'

enableAutoUnmount(afterEach)

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

function mountControl(options: { sites?: SentrySite[] } = {}) {
  useSentrySitesStore().sites = options.sites ?? []
  return mount(OverheadAlertsControl, { attachTo: document.body })
}

type Wrapper = ReturnType<typeof mountControl>

const rows = (wrapper: Wrapper) => wrapper.findAll('.overhead-alerts-location')
const rowNamed = (wrapper: Wrapper, name: string) =>
  rows(wrapper).find((row) => row.find('.overhead-alerts-name').text() === name)!
const switchFor = (wrapper: Wrapper, name: string, index: 0 | 1) =>
  rowNamed(wrapper, name).findAll('[role="switch"]')[index]!
const radiusFor = (wrapper: Wrapper, name: string) =>
  rowNamed(wrapper, name).find('.overhead-alerts-radius-input')

describe('OverheadAlertsControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    locationRef.value = { lat: 51.5, lon: -0.12, accuracy: 0 }
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
  })

  describe('the list of locations', () => {
    it('leads with the Sentinel location, then names each Sentry', () => {
      const wrapper = mountControl({ sites: [site(), site({ id: 2, name: 'Coastal' })] })
      expect(rows(wrapper).map((row) => row.find('.overhead-alerts-name').text())).toEqual([
        'Sentinel location',
        'Sentry: GATESHEAD',
        'Sentry: COASTAL',
      ])
    })

    it('shows each location’s coordinates', () => {
      const wrapper = mountControl({ sites: [site()] })
      expect(
        rowNamed(wrapper, 'Sentry: GATESHEAD').find('.overhead-alerts-coords').text(),
      ).toContain('54.95000° N')
    })

    it('gives every location a Civil and a Military switch and a radius', () => {
      const wrapper = mountControl({ sites: [site()] })
      for (const row of rows(wrapper)) {
        expect(row.findAll('[role="switch"]')).toHaveLength(2)
        expect(row.find('.overhead-alerts-radius-input').exists()).toBe(true)
      }
      expect(wrapper.findAll('.overhead-alerts-toggle-label').map((node) => node.text())).toEqual([
        'Civil',
        'Military',
        'Civil',
        'Military',
      ])
    })

    it('explains an empty list rather than showing nothing', () => {
      locationRef.value = null
      const wrapper = mountControl()
      expect(wrapper.find('.overhead-alerts-empty').text()).toBe(
        'No location to watch yet — set your location, or register a Sentry host.',
      )
    })
  })

  describe('toggling a class', () => {
    it('switches civil alerts on for that location alone', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl({ sites: [site()] })

      await switchFor(wrapper, 'Sentry: GATESHEAD', 0).trigger('click')

      expect(airStore.overheadAlertFor(sentryAlertLocationId(1)).civil).toBe(true)
      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(false)
    })

    it('switches military alerts on independently of civil', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      await switchFor(wrapper, 'Sentinel location', 1).trigger('click')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID)).toMatchObject({
        civil: false,
        mil: true,
      })
    })

    it('switches back off again', async () => {
      const airStore = useAirStore()
      airStore.setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true })
      const wrapper = mountControl()

      await switchFor(wrapper, 'Sentinel location', 0).trigger('click')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(false)
    })

    it('reflects the stored state', () => {
      useAirStore().setOverheadAlert(USER_ALERT_LOCATION_ID, { mil: true })
      const wrapper = mountControl()
      expect(switchFor(wrapper, 'Sentinel location', 0).attributes('aria-checked')).toBe('false')
      expect(switchFor(wrapper, 'Sentinel location', 1).attributes('aria-checked')).toBe('true')
    })
  })

  describe('the radius', () => {
    it('shows the stored radius for each location', () => {
      const airStore = useAirStore()
      airStore.setOverheadAlert(sentryAlertLocationId(1), { radiusNm: 40 })
      const wrapper = mountControl({ sites: [site()] })
      expect((radiusFor(wrapper, 'Sentinel location').element as HTMLInputElement).value).toBe('10')
      expect((radiusFor(wrapper, 'Sentry: GATESHEAD').element as HTMLInputElement).value).toBe('40')
    })

    it('commits a typed radius on blur', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('25')
      await field.trigger('blur')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(25)
    })

    it('holds the half-typed value while editing, so clearing the field is not read as zero', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('')

      expect((field.element as HTMLInputElement).value).toBe('')
      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(10)
    })

    it('falls back to the stored radius when the entry is not a number', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('abc')
      await field.trigger('blur')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(10)
      expect((radiusFor(wrapper, 'Sentinel location').element as HTMLInputElement).value).toBe('10')
    })

    it('refuses a non-positive radius, keeping the stored one', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('0')
      await field.trigger('blur')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(10)
    })

    it('blurring an untouched field changes nothing', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      await radiusFor(wrapper, 'Sentinel location').trigger('blur')

      expect(airStore.overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(10)
    })

    it('keeps each location’s draft separate', async () => {
      const wrapper = mountControl({ sites: [site()] })

      await radiusFor(wrapper, 'Sentinel location').setValue('99')

      expect((radiusFor(wrapper, 'Sentry: GATESHEAD').element as HTMLInputElement).value).toBe('10')
    })
  })

  describe('the config-database write', () => {
    it('stages a write so APPLY CHANGES reports what it did, not "NO CHANGES"', async () => {
      const wrapper = mountControl()

      await switchFor(wrapper, 'Sentinel location', 0).trigger('click')

      // The store update is immediate (the map draws its zone at once); the
      // durable write is staged for the panel's APPLY button.
      const staged = wrapper.emitted('stage')
      expect(staged).toHaveLength(1)
      await (staged![0]![0] as () => Promise<unknown>)()
      expect(settingsApi.put).toHaveBeenCalledWith('air', 'overheadAlerts', {
        [USER_ALERT_LOCATION_ID]: { civil: true, mil: false, radiusNm: 10 },
      })
    })

    it('stages a radius change too', async () => {
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('25')
      await field.trigger('blur')

      expect(wrapper.emitted('stage')).toHaveLength(1)
    })

    it('stages nothing for a rejected radius', async () => {
      const wrapper = mountControl()

      const field = radiusFor(wrapper, 'Sentinel location')
      await field.setValue('abc')
      await field.trigger('blur')

      expect(wrapper.emitted('stage')).toBeUndefined()
    })
  })

  describe('hydrating from the config database', () => {
    it('adopts the stored per-location settings', async () => {
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        overheadAlerts: {
          [USER_ALERT_LOCATION_ID]: { civil: true, mil: false, radiusNm: 22 },
        },
      })
      const wrapper = mountControl()
      await flushPromises()

      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).radiusNm).toBe(22)
      expect(switchFor(wrapper, 'Sentinel location', 0).attributes('aria-checked')).toBe('true')
    })

    it('carries the pre-split single configuration onto your own location', async () => {
      // The database may still hold the old flat {civil, mil, radiusNm} shape.
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        overheadAlerts: { civil: false, mil: true, radiusNm: 30 },
      })
      mountControl()
      await flushPromises()

      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID)).toEqual({
        civil: false,
        mil: true,
        radiusNm: 30,
      })
    })

    it('defaults the radius when the legacy shape carries none', async () => {
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        overheadAlerts: { civil: true },
      })
      mountControl()
      await flushPromises()

      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID)).toEqual({
        civil: true,
        mil: false,
        radiusNm: 10,
      })
    })

    it.each([
      ['no config at all', null],
      ['no such key', {}],
      ['a non-object value', { overheadAlerts: 42 }],
      ['an array', { overheadAlerts: [] }],
    ])('leaves the local settings alone with %s', async (_case, data) => {
      useAirStore().setOverheadAlert(USER_ALERT_LOCATION_ID, { civil: true })
      vi.mocked(settingsApi.getNamespace).mockResolvedValue(data as Record<string, unknown> | null)
      mountControl()
      await flushPromises()

      expect(useAirStore().overheadAlertFor(USER_ALERT_LOCATION_ID).civil).toBe(true)
    })
  })

  describe('accessibility', () => {
    it('names every control for the location it belongs to', () => {
      const wrapper = mountControl({ sites: [site()] })
      const sentryRow = rowNamed(wrapper, 'Sentry: GATESHEAD')
      expect(sentryRow.findAll('[role="switch"]')[0]!.attributes('aria-label')).toBe(
        'Civil aircraft alerts for GATESHEAD',
      )
      expect(sentryRow.findAll('[role="switch"]')[1]!.attributes('aria-label')).toBe(
        'Military aircraft alerts for GATESHEAD',
      )
      expect(sentryRow.find('.overhead-alerts-radius-input').attributes('aria-label')).toBe(
        'Alert radius for GATESHEAD, nautical miles',
      )
    })

    it('names the operator’s own row in plain words', () => {
      const wrapper = mountControl()
      expect(switchFor(wrapper, 'Sentinel location', 0).attributes('aria-label')).toBe(
        'Civil aircraft alerts for your location',
      )
    })

    it('has no axe violations', async () => {
      const wrapper = mountControl({ sites: [site()] })
      expect(await axe(wrapper.element as HTMLElement)).toHaveNoViolations()
    })
  })
})
