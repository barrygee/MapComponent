import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { axe } from 'jest-axe'
import type { SentrySite } from '@/services/sentryApi'
import type { RingOriginSetting } from '@/composables/useRangeRingOrigin'

const selectUserOrigin = vi.fn()
const selectSentryOrigin = vi.fn()
const persistOriginToConfig = vi.fn(() => Promise.resolve())
const clearNotice = vi.fn()
const setting = ref<RingOriginSetting>({ kind: 'user', sentryHostId: null })
const notice = ref<string | null>(null)

vi.mock('@/composables/useRangeRingOrigin', () => ({
  useRangeRingOrigin: () => ({
    setting,
    notice,
    clearNotice,
    persistOriginToConfig,
    selectUserOrigin,
    selectSentryOrigin,
  }),
}))

const userLocation = ref<{ lat: number; lon: number; accuracy: number } | null>(null)
vi.mock('@/composables/useUserLocation', () => ({
  useUserLocation: () => ({ location: userLocation }),
}))

import { useSentrySitesStore } from '@/stores/sentrySites'
import RingOriginPicker from './RingOriginPicker.vue'

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

function mountPicker(options: { sites?: SentrySite[] } = {}) {
  useSentrySitesStore().sites = options.sites ?? []
  return mount(RingOriginPicker, { attachTo: document.body })
}

type Wrapper = ReturnType<typeof mountPicker>

const group = (wrapper: Wrapper) => wrapper.find('[role="radiogroup"]')
const rows = (wrapper: Wrapper) => wrapper.findAll('[role="radio"]')
const rowNamed = (wrapper: Wrapper, name: string) =>
  rows(wrapper).find((row) => row.find('.ring-origin-option-name').text() === name)!
const optionNames = (wrapper: Wrapper) =>
  rows(wrapper).map((row) => row.find('.ring-origin-option-name').text())
const optionDetail = (wrapper: Wrapper, name: string) =>
  rowNamed(wrapper, name).find('.ring-origin-option-sub').text()
const tabStops = (wrapper: Wrapper) => rows(wrapper).map((row) => row.attributes('tabindex'))

/** Key the group, which is where the roving-focus model lives. */
async function key(wrapper: Wrapper, keyName: string) {
  await group(wrapper).trigger('keydown', { key: keyName })
  await flushPromises()
}

describe('RingOriginPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    setting.value = { kind: 'user', sentryHostId: null }
    notice.value = null
    userLocation.value = { lat: 51.5, lon: -0.12, accuracy: 0 }
  })

  describe('the choices', () => {
    it('lists the Sentinel location first, then every Sentry', () => {
      const wrapper = mountPicker({ sites: [site(), site({ id: 2, name: 'Coastal' })] })
      expect(optionNames(wrapper)).toEqual(['Sentinel location', 'Gateshead', 'Coastal'])
    })

    it('is one radio group, so the choice reads as single-select', () => {
      const wrapper = mountPicker({ sites: [site()] })
      expect(group(wrapper).attributes('aria-label')).toBe('Centre range rings on')
    })

    it('gives each choice its name beside its coordinates', () => {
      const wrapper = mountPicker({ sites: [site()] })
      // Answers "which one" without hunting on the map. 51.5/-0.12 to
      // 54.95/-1.53 is 3.45° of latitude (207 NM) and 0.84° of longitude at
      // that latitude (51 NM) — 213 NM great-circle.
      expect(optionDetail(wrapper, 'Gateshead')).toBe('(54.95000° N 1.53000° W - 213 NM)')
    })

    it('omits the distance when there is no position to measure from', () => {
      userLocation.value = null
      const wrapper = mountPicker({ sites: [site()] })
      expect(optionDetail(wrapper, 'Gateshead')).toBe('(54.95000° N 1.53000° W)')
    })

    it('shows your coordinates, or tells you to set them', () => {
      expect(optionDetail(mountPicker(), 'Sentinel location')).toBe('(51.50000° N 0.12000° W)')

      userLocation.value = null
      const wrapper = mountPicker()
      expect(optionDetail(wrapper, 'Sentinel location')).toBe('(Set your location first)')
      expect(rowNamed(wrapper, 'Sentinel location').attributes('aria-disabled')).toBe('true')
    })

    it('checks the current choice and only that one', () => {
      setting.value = { kind: 'sentry', sentryHostId: 1 }
      const wrapper = mountPicker({ sites: [site()] })
      expect(rowNamed(wrapper, 'Gateshead').attributes('aria-checked')).toBe('true')
      expect(rowNamed(wrapper, 'Sentinel location').attributes('aria-checked')).toBe('false')
    })
  })

  describe('choosing', () => {
    it('centres on the Sentinel location and announces it', async () => {
      setting.value = { kind: 'sentry', sentryHostId: 1 }
      const wrapper = mountPicker({ sites: [site()] })

      await rowNamed(wrapper, 'Sentinel location').trigger('click')

      expect(selectUserOrigin).toHaveBeenCalledOnce()
      expect(wrapper.find('.sr-only').text()).toBe('Range rings centred on the Sentinel location.')
    })

    it('pins a Sentry by id and names it in the announcement', async () => {
      const wrapper = mountPicker({ sites: [site(), site({ id: 2, name: 'Coastal' })] })

      await rowNamed(wrapper, 'Coastal').trigger('click')

      expect(selectSentryOrigin).toHaveBeenCalledWith(2)
      expect(wrapper.find('.sr-only').text()).toBe('Range rings centred on Coastal.')
    })

    it('refuses your location when there is none, rather than drawing nothing', async () => {
      userLocation.value = null
      const wrapper = mountPicker()

      await rowNamed(wrapper, 'Sentinel location').trigger('click')

      expect(selectUserOrigin).not.toHaveBeenCalled()
      expect(wrapper.find('.sr-only').text()).toBe('')
    })

    it('dismisses the removed-Sentry notice as soon as a choice is made', async () => {
      notice.value = 'GATESHEAD was removed — rings re-centred on your location.'
      const wrapper = mountPicker({ sites: [site()] })
      expect(wrapper.find('.ring-origin-picker-notice').text()).toBe(notice.value)

      await rowNamed(wrapper, 'Gateshead').trigger('click')

      expect(clearNotice).toHaveBeenCalled()
    })

    it('shows no notice when there is nothing to explain', () => {
      expect(mountPicker().find('.ring-origin-picker-notice').exists()).toBe(false)
    })
  })

  describe('keyboard', () => {
    it('makes the group one tab stop, landing on the current choice', () => {
      setting.value = { kind: 'sentry', sentryHostId: 1 }
      const wrapper = mountPicker({ sites: [site()] })
      expect(tabStops(wrapper)).toEqual(['-1', '0'])
    })

    it('still offers a tab stop when nothing here is chosen', () => {
      // A pinned host that has left the fleet leaves nothing checked; without a
      // fallback stop the group would drop out of the tab order entirely.
      setting.value = { kind: 'sentry', sentryHostId: 99 }
      const wrapper = mountPicker({ sites: [site()] })
      expect(tabStops(wrapper)).toEqual(['0', '-1'])
    })

    it.each(['ArrowDown', 'ArrowRight'])('moves forward on %s, choosing as it lands', async (k) => {
      const wrapper = mountPicker({ sites: [site()] })

      await key(wrapper, k)

      expect(selectSentryOrigin).toHaveBeenCalledWith(1)
      expect(tabStops(wrapper)).toEqual(['-1', '0'])
    })

    it.each(['ArrowUp', 'ArrowLeft'])('moves back on %s, wrapping to the end', async (k) => {
      const wrapper = mountPicker({ sites: [site()] })

      await key(wrapper, k)

      expect(selectSentryOrigin).toHaveBeenCalledWith(1)
    })

    it('wraps forward off the end back to the first', async () => {
      setting.value = { kind: 'sentry', sentryHostId: 1 }
      const wrapper = mountPicker({ sites: [site()] })

      await key(wrapper, 'ArrowDown')

      expect(selectUserOrigin).toHaveBeenCalledOnce()
    })

    it('jumps to the ends with Home and End', async () => {
      const wrapper = mountPicker({ sites: [site()] })

      await key(wrapper, 'End')
      expect(selectSentryOrigin).toHaveBeenCalledWith(1)

      await key(wrapper, 'Home')
      expect(selectUserOrigin).toHaveBeenCalledOnce()
    })

    it('moves focus with the highlight, so the arrows are usable at all', async () => {
      const wrapper = mountPicker({ sites: [site()] })

      await key(wrapper, 'End')

      expect(document.activeElement).toBe(rowNamed(wrapper, 'Gateshead').element)
    })

    it('ignores keys it does not handle', async () => {
      const wrapper = mountPicker({ sites: [site()] })
      await key(wrapper, 'a')
      expect(selectSentryOrigin).not.toHaveBeenCalled()
      expect(selectUserOrigin).not.toHaveBeenCalled()
    })
  })

  describe('the config-database write', () => {
    it('stages the write so APPLY CHANGES reports SAVED, not "NO CHANGES"', async () => {
      const wrapper = mountPicker({ sites: [site()] })

      await rowNamed(wrapper, 'Gateshead').trigger('click')

      const staged = wrapper.emitted('stage')
      expect(staged).toHaveLength(1)
      await (staged![0]![0] as () => Promise<unknown>)()
      expect(persistOriginToConfig).toHaveBeenCalledOnce()
    })

    it('stages nothing for a choice that is refused', async () => {
      userLocation.value = null
      const wrapper = mountPicker()

      await rowNamed(wrapper, 'Sentinel location').trigger('click')

      expect(wrapper.emitted('stage')).toBeUndefined()
    })
  })

  it('has no axe violations', async () => {
    const wrapper = mountPicker({ sites: [site()] })
    expect(await axe(wrapper.element as HTMLElement)).toHaveNoViolations()
  })
})
