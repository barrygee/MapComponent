import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import { useAirStore } from '@/stores/air'
import { useBasemapStore } from '@/stores/basemap'
import MapLayersControl from './MapLayersControl.vue'

enableAutoUnmount(afterEach)

function mountControl() {
  return mount(MapLayersControl, { attachTo: document.body })
}

const rows = (wrapper: ReturnType<typeof mountControl>) => wrapper.findAll('.lft-row')
const rowNamed = (wrapper: ReturnType<typeof mountControl>, name: string) =>
  rows(wrapper).find((row) => row.find('.lft-row-name').text() === name)!
const switchOf = (wrapper: ReturnType<typeof mountControl>, name: string) =>
  rowNamed(wrapper, name).find('[role="switch"]')
const isOn = (wrapper: ReturnType<typeof mountControl>, name: string) =>
  switchOf(wrapper, name).attributes('aria-checked') === 'true'

describe('MapLayersControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('lists every map layer, once each', () => {
    const wrapper = mountControl()
    expect(rows(wrapper).map((row) => row.find('.lft-row-name').text())).toEqual([
      'Range rings',
      'A2A refuelling',
      'AWACS',
      'Ground vehicles',
      'Towers',
      'Location names',
      'Airports',
      'Military bases',
    ])
  })

  describe('reading the current state', () => {
    it('reflects the Air overlay flags', () => {
      const airStore = useAirStore()
      airStore.setOverlay('airports', false)
      airStore.setOverlay('rangeRings', true)
      const wrapper = mountControl()
      expect(isOn(wrapper, 'Airports')).toBe(false)
      expect(isOn(wrapper, 'Range rings')).toBe(true)
    })

    it('reads place names off the shared basemap store, not the Air overlays', () => {
      // Names describe the base map every domain draws, so they live on the
      // cross-domain store; reading them from the Air overlays would go stale
      // the moment another map changed them.
      useBasemapStore().setLayer('names', true)
      expect(isOn(mountControl(), 'Location names')).toBe(true)
    })

    it('shows ground vehicles and towers on by default', () => {
      const wrapper = mountControl()
      expect(isOn(wrapper, 'Ground vehicles')).toBe(true)
      expect(isOn(wrapper, 'Towers')).toBe(true)
    })

    it('follows a change made on the map rail', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()
      expect(isOn(wrapper, 'AWACS')).toBe(true)

      // What the rail's own button does: there is one value, not two kept in step.
      airStore.setOverlay('awacs', false)
      await wrapper.vm.$nextTick()

      expect(isOn(wrapper, 'AWACS')).toBe(false)
    })
  })

  describe('toggling', () => {
    it.each([
      ['Range rings', 'rangeRings'],
      ['A2A refuelling', 'aara'],
      ['AWACS', 'awacs'],
      ['Ground vehicles', 'groundVehicles'],
      ['Towers', 'towers'],
      ['Airports', 'airports'],
      ['Military bases', 'militaryBases'],
    ] as const)('writes %s to the air store', async (label, key) => {
      const airStore = useAirStore()
      const before = airStore.overlayStates[key]
      const wrapper = mountControl()

      await switchOf(wrapper, label).trigger('click')

      expect(airStore.overlayStates[key]).toBe(!before)
    })

    it('writes place names to the basemap store', async () => {
      const basemapStore = useBasemapStore()
      const wrapper = mountControl()

      await switchOf(wrapper, 'Location names').trigger('click')

      expect(basemapStore.layers.names).toBe(true)
    })

    it('toggles back off again', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      await switchOf(wrapper, 'Airports').trigger('click')
      await switchOf(wrapper, 'Airports').trigger('click')

      expect(airStore.overlayStates.airports).toBe(true)
    })

    it('leaves the other layers alone', async () => {
      const airStore = useAirStore()
      const wrapper = mountControl()

      await switchOf(wrapper, 'Towers').trigger('click')

      expect(airStore.overlayStates.groundVehicles).toBe(true)
      expect(airStore.overlayStates.airports).toBe(true)
    })
  })

  it('names every switch for assistive tech', () => {
    const wrapper = mountControl()
    for (const control of wrapper.findAll('[role="switch"]')) {
      expect(control.attributes('aria-label')).toBeTruthy()
    }
  })

  it('has no axe violations', async () => {
    expect(await axe(mountControl().element as HTMLElement)).toHaveNoViolations()
  })
})
