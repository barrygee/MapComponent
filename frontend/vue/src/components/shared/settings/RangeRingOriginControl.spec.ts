import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { axe } from 'jest-axe'

vi.mock('@/composables/useRangeRingOrigin', () => ({
  useRangeRingOrigin: () => ({
    setting: ref({ kind: 'user', sentryHostId: null, latitude: null, longitude: null }),
    notice: ref(null),
    clearNotice: vi.fn(),
    selectUserOrigin: vi.fn(() => Promise.resolve()),
    selectSentryOrigin: vi.fn(() => Promise.resolve()),
    persistOriginToConfig: vi.fn(() => Promise.resolve()),
  }),
}))

vi.mock('@/composables/useUserLocation', () => ({
  useUserLocation: () => ({ location: ref({ lat: 51.5, lon: -0.12, accuracy: 0 }) }),
}))

import { useSentrySitesStore } from '@/stores/sentrySites'
import RangeRingOriginControl from './RangeRingOriginControl.vue'

enableAutoUnmount(afterEach)

function mountControl() {
  return mount(RangeRingOriginControl, { attachTo: document.body })
}

describe('RangeRingOriginControl', () => {
  let fetchSites: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const store = useSentrySitesStore()
    store.sites = []
    fetchSites = vi.fn(() => Promise.resolve())
    store.fetchSites = fetchSites as unknown as typeof store.fetchSites
  })

  it('renders the shared picker', () => {
    const wrapper = mountControl()
    // Sentinel location only, with no sites in the fleet.
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(1)
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe(
      'Centre range rings on',
    )
  })

  it('fetches the site list itself, since Settings can open with no map mounted', async () => {
    mountControl()
    await flushPromises()
    expect(fetchSites).toHaveBeenCalledOnce()
  })

  it('forwards the picker’s staged write up to the panel', async () => {
    const wrapper = mountControl()

    wrapper.findComponent({ name: 'RingOriginPicker' }).vm.$emit('stage', () => {})

    // Without this hop the panel finds nothing pending and says "NO CHANGES".
    expect(wrapper.emitted('stage')).toHaveLength(1)
  })

  it('has no axe violations', async () => {
    const wrapper = mountControl()
    await flushPromises()
    expect(await axe(wrapper.element as HTMLElement)).toHaveNoViolations()
  })
})
