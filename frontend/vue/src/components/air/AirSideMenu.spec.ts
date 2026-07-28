import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import { useAppStore } from '@/stores/app'

// Controllable user-location ref for the locActive computed + goToLocation.
const shared = vi.hoisted(() => ({
  loc: null as { value: { lon: number; lat: number } | null } | null,
}))

vi.mock('@/composables/useUserLocation', async () => {
  const { ref } = await import('vue')
  const location = ref<{ lon: number; lat: number } | null>(null)
  shared.loc = location as unknown as { value: { lon: number; lat: number } | null }
  return { useUserLocation: () => ({ location, start: vi.fn() }) }
})

import AirSideMenu from './AirSideMenu.vue'

// ---- Fake AirMap + controls ----------------------------------------------
function makeControls() {
  // The real AdsbLiveControl mutates _typeFilter/_allHidden in these setters; the
  // mock mirrors that so the menu's filter-state sync reads the updated values.
  const adsb = {
    toggle: vi.fn(),
    visible: true,
    setHideGroundVehicles: vi.fn(),
    setHideTowers: vi.fn(),
    _allHidden: false,
    _typeFilter: 'all' as 'all' | 'civil' | 'mil',
    setAllHidden: vi.fn((value: boolean) => {
      adsb._allHidden = value
    }),
    setTypeFilter: vi.fn((mode: 'all' | 'civil' | 'mil') => {
      adsb._typeFilter = mode
    }),
  }
  return {
    map: {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      flyTo: vi.fn(),
      easeTo: vi.fn(),
      getZoom: vi.fn(() => 8),
      getPitch: vi.fn(() => 20),
      getBearing: vi.fn(() => 30),
    },
    adsb,
    labels: { syncToAdsb: vi.fn(), toggle: vi.fn() },
    rangeRings: { handleClickPublic: vi.fn() },
    aara: { toggle: vi.fn() },
    awacs: { toggle: vi.fn() },
    airports: { toggle: vi.fn() },
    mil: { toggle: vi.fn() },
    names: { handleClickPublic: vi.fn() },
    clear: { toggle: vi.fn(), _cleared: true },
    set3DActive: vi.fn(),
    setTargetPitch: vi.fn(),
  }
}

type Controls = ReturnType<typeof makeControls>

function makeAirMap(controls: Controls) {
  return {
    getMap: () => controls.map,
    getAdsbControl: () => controls.adsb,
    getAdsbLabels: () => controls.labels,
    getRangeRings: () => controls.rangeRings,
    getAara: () => controls.aara,
    getAwacs: () => controls.awacs,
    getAirports: () => controls.airports,
    getMilBases: () => controls.mil,
    getNamesControl: () => controls.names,
    getClearControl: () => controls.clear,
    set3DActive: controls.set3DActive,
    setTargetPitch: controls.setTargetPitch,
  }
}

function mountMenu(current: unknown) {
  return mount(AirSideMenu, { props: { mapRef: { current } } as never })
}

const tip = (label: string) => `[data-tooltip="${label}"]`

enableAutoUnmount(afterEach)

describe('AirSideMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    if (shared.loc) shared.loc.value = null
    localStorage.clear()
    document.body.innerHTML = ''
  })

  describe('with the map available', () => {
    let controls: Controls
    let wrapper: ReturnType<typeof mountMenu>

    beforeEach(() => {
      controls = makeControls()
      wrapper = mountMenu(makeAirMap(controls))
    })

    it('renders a rail with no expand/collapse toggle and every option always visible', () => {
      expect(wrapper.find('#side-menu').exists()).toBe(true)
      expect(wrapper.find('#side-menu-toggle').exists()).toBe(false)
      // All controls (including the ones previously hidden until "expanded") are
      // rendered as icon buttons with an accessible name + hover tooltip.
      for (const label of [
        'ZOOM IN',
        'ZOOM OUT',
        'GO TO MY LOCATION',
        'RANGE RING',
        'A2A REFUELING',
        'AWACS',
        '3D VIEW',
        'MAP LAYERS',
        'FILTER',
      ]) {
        const button = wrapper.find(tip(label))
        expect(button.exists()).toBe(true)
        expect(button.attributes('aria-label')).toBeTruthy()
      }
      // Callsigns is removed entirely.
      expect(wrapper.find(tip('CALLSIGNS')).exists()).toBe(false)
      // Ground vehicles, towers, location names, airports, military bases and
      // live inside the LAYERS accordion panel (as icon buttons with
      // their own tooltips), not as standalone rail icons.
      for (const layer of ['ground', 'towers', 'names', 'airports', 'mil']) {
        const subButton = wrapper.find(`#layers-panel [data-loc="${layer}"]`)
        expect(subButton.exists()).toBe(true)
        expect(subButton.attributes('aria-label')).toBeTruthy()
        expect(subButton.attributes('data-tooltip')).toBeTruthy()
      }
      // The aircraft-filter modes live inside the FILTER accordion panel.
      for (const mode of ['all', 'civil', 'mil']) {
        const modeButton = wrapper.find(`#filter-mode-flyout [data-mode="${mode}"]`)
        expect(modeButton.exists()).toBe(true)
        expect(modeButton.attributes('aria-label')).toBeTruthy()
        expect(modeButton.attributes('data-tooltip')).toBeTruthy()
      }
    })

    it('collapses the rail when the app store hides the side menu', async () => {
      const appStore = useAppStore()
      // Visible by default: no collapsed modifier. The collapsed modifier class
      // now lives on the shared IconRail shell (icon-rail--collapsed), not a
      // side-menu-specific class name (see the Phase 6a SpaceSideMenu precedent).
      expect(wrapper.find('#side-menu').classes()).not.toContain('icon-rail--collapsed')
      appStore.toggleSideMenu()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('#side-menu').classes()).toContain('icon-rail--collapsed')
    })

    it('zooms the map in and out', async () => {
      await wrapper.find(tip('ZOOM IN')).trigger('click')
      await wrapper.find(tip('ZOOM OUT')).trigger('click')
      expect(controls.map.zoomIn).toHaveBeenCalled()
      expect(controls.map.zoomOut).toHaveBeenCalled()
    })

    it('flies to the user location when a fix is available', async () => {
      shared.loc!.value = { lon: 5, lat: 10 }
      await wrapper.vm.$nextTick()
      await wrapper.find(tip('GO TO MY LOCATION')).trigger('click')
      expect(controls.map.flyTo).toHaveBeenCalledWith({
        center: [5, 10],
        zoom: 10,
        duration: 800,
      })
    })

    it('does not fly when there is no fix', async () => {
      await wrapper.find(tip('GO TO MY LOCATION')).trigger('click')
      expect(controls.map.flyTo).not.toHaveBeenCalled()
    })

    it('toggles ground vehicles and towers', async () => {
      await wrapper.find(tip('GROUND VEHICLES')).trigger('click')
      expect(controls.adsb.setHideGroundVehicles).toHaveBeenCalledWith(true)
      await wrapper.find(tip('TOWERS')).trigger('click')
      expect(controls.adsb.setHideTowers).toHaveBeenCalledWith(true)
    })

    it('toggles the ring, refuelling and AWACS from the rail', async () => {
      await wrapper.find(tip('RANGE RING')).trigger('click')
      await wrapper.find(tip('A2A REFUELING')).trigger('click')
      await wrapper.find(tip('AWACS')).trigger('click')
      expect(controls.rangeRings.handleClickPublic).toHaveBeenCalled()
      expect(controls.aara.toggle).toHaveBeenCalled()
      expect(controls.awacs.toggle).toHaveBeenCalled()
    })

    it('toggles location names, airports and bases from the LAYERS panel', async () => {
      await wrapper.find('[data-loc="names"]').trigger('click')
      await wrapper.find('[data-loc="airports"]').trigger('click')
      await wrapper.find('[data-loc="mil"]').trigger('click')
      expect(controls.names.handleClickPublic).toHaveBeenCalled()
      expect(controls.airports.toggle).toHaveBeenCalled()
      expect(controls.mil.toggle).toHaveBeenCalled()
    })

    it('expands the LAYERS accordion on click and highlights the button while open', async () => {
      const button = wrapper.find('#sm-layers-btn')

      // Collapsed until clicked; the button is highlighted (active) only while
      // its panel is open. aria-expanded reflects the state.
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(button.classes()).not.toContain('active')

      await button.trigger('click')
      expect(button.attributes('aria-expanded')).toBe('true')
      expect(button.classes()).toContain('active')

      await button.trigger('click')
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(button.classes()).not.toContain('active')
    })

    it('toggles the 3D view on and off', async () => {
      await wrapper.find(tip('3D VIEW')).trigger('click')
      expect(controls.set3DActive).toHaveBeenCalledWith(true)
      await wrapper.find(tip('3D VIEW')).trigger('click')
      expect(controls.set3DActive).toHaveBeenCalledWith(false)
    })

    it('tilts, rotates and resets the bearing via the 3D widget', async () => {
      await wrapper.find(tip('TILT UP')).trigger('click')
      expect(controls.setTargetPitch).toHaveBeenCalledWith(30) // 20 + 10
      expect(controls.map.easeTo).toHaveBeenCalledWith({ pitch: 30, duration: 300 })

      await wrapper.find(tip('TILT DOWN')).trigger('click')
      expect(controls.setTargetPitch).toHaveBeenCalledWith(10) // 20 - 10

      await wrapper.find(tip('ROTATE LEFT')).trigger('click')
      expect(controls.map.easeTo).toHaveBeenCalledWith({ bearing: 15, duration: 300 }) // 30 - 15

      await wrapper.find(tip('ROTATE RIGHT')).trigger('click')
      expect(controls.map.easeTo).toHaveBeenCalledWith({ bearing: 45, duration: 300 })

      await wrapper.find(tip('RESET BEARING')).trigger('click')
      expect(controls.map.easeTo).toHaveBeenCalledWith({ bearing: 0, duration: 400 })
    })

    it('clamps the tilt pitch to the 0–85 range', async () => {
      controls.map.getPitch.mockReturnValue(80)
      await wrapper.find(tip('TILT UP')).trigger('click')
      expect(controls.setTargetPitch).toHaveBeenCalledWith(85)
    })
  })

  describe('filter accordion', () => {
    let controls: Controls
    let wrapper: ReturnType<typeof mountMenu>

    beforeEach(() => {
      controls = makeControls()
      wrapper = mountMenu(makeAirMap(controls))
    })

    it('expands and collapses the mode accordion on click, highlighting the button while open', async () => {
      const button = wrapper.find('#sm-filter-btn')
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(button.classes()).not.toContain('active')
      await button.trigger('click')
      expect(button.attributes('aria-expanded')).toBe('true')
      expect(button.classes()).toContain('active')
      await button.trigger('click')
      expect(button.attributes('aria-expanded')).toBe('false')
      expect(button.classes()).not.toContain('active')
    })

    it('resyncs the mode highlight from the control when the panel opens, even without an adsb-filter-change event', async () => {
      // Pins the reason onFilterAccordionTriggerClick calls syncFilterStateFromControl
      // on every trigger click (replacing the pre-migration watch(filterAccordionOpen,
      // ...)): something outside this component can mutate the ADS-B control's filter
      // fields directly (e.g. another view driving the same control) without going
      // through setFilterMode/dispatching 'adsb-filter-change'. Opening the FILTER
      // accordion must still reflect that external change immediately.
      controls.adsb._typeFilter = 'mil'
      controls.adsb._allHidden = false

      const button = wrapper.find('#sm-filter-btn')
      await button.trigger('click')

      expect(wrapper.find('[data-mode="mil"]').classes()).toContain('active')
      expect(wrapper.find('[data-mode="all"]').classes()).not.toContain('active')
      expect(wrapper.find('[data-mode="civil"]').classes()).not.toContain('active')
    })

    it('sets the filter mode, persists it, and keeps it highlighted', async () => {
      const events: string[] = []
      document.addEventListener('adsb-filter-change', () => events.push('change'))
      await wrapper.find('[data-mode="civil"]').trigger('click')
      expect(controls.adsb.setTypeFilter).toHaveBeenCalledWith('civil')
      expect(JSON.parse(localStorage.getItem('adsbFilter')!)).toEqual({
        typeFilter: 'civil',
        allHidden: false,
      })
      expect(events).toContain('change')
      // The selected mode stays green (active); the others do not.
      expect(wrapper.find('[data-mode="civil"]').classes()).toContain('active')
      expect(wrapper.find('[data-mode="all"]').classes()).not.toContain('active')
      expect(wrapper.find('[data-mode="mil"]').classes()).not.toContain('active')
    })

    it('un-hides all aircraft before applying a mode when everything was hidden', async () => {
      controls.adsb._allHidden = true
      await wrapper.find('[data-mode="mil"]').trigger('click')
      expect(controls.adsb.setAllHidden).toHaveBeenCalledWith(false)
      expect(controls.adsb.setTypeFilter).toHaveBeenCalledWith('mil')
    })

    it('marks the active filter mode and tolerates a localStorage failure', async () => {
      // _typeFilter 'all' → the ALL mode button is active.
      expect(wrapper.find('[data-mode="all"]').classes()).toContain('active')
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      // Re-selecting ALL still applies the filter and swallows the storage error.
      await expect(wrapper.find('[data-mode="all"]').trigger('click')).resolves.not.toThrow()
      expect(controls.adsb.setTypeFilter).toHaveBeenCalledWith('all')
    })
  })

  describe('without the map', () => {
    let wrapper: ReturnType<typeof mountMenu>

    beforeEach(() => {
      wrapper = mountMenu(null)
    })

    it('renders and no control action throws', async () => {
      shared.loc!.value = { lon: 1, lat: 2 } // loc present but map null → goToLocation no-ops
      await wrapper.vm.$nextTick()
      for (const label of [
        'ZOOM IN',
        'ZOOM OUT',
        'GO TO MY LOCATION',
        'RANGE RING',
        'A2A REFUELING',
        'AWACS',
        '3D VIEW',
        'MAP LAYERS',
        'FILTER',
        'TILT UP',
        'ROTATE LEFT',
        'RESET BEARING',
      ]) {
        await expect(wrapper.find(tip(label)).trigger('click')).resolves.not.toThrow()
      }
      // The LAYERS panel toggles are also safe without a map.
      for (const layer of ['ground', 'towers', 'names', 'airports', 'mil']) {
        await expect(wrapper.find(`[data-loc="${layer}"]`).trigger('click')).resolves.not.toThrow()
      }
    })

    it('selecting a filter mode without a control is a no-op', async () => {
      await expect(wrapper.find('[data-mode="civil"]').trigger('click')).resolves.not.toThrow()
      // With no control the click changes nothing — CIVIL never becomes active.
      expect(wrapper.find('[data-mode="civil"]').classes()).not.toContain('active')
    })
  })

  it('has no accessibility violations', async () => {
    const wrapper = mountMenu(makeAirMap(makeControls()))
    // The rail is a <nav> landmark; region is disabled because the component is
    // mounted in isolation here (its surrounding app landmarks aren't present).
    // Every icon button carries an aria-label, so button-name passes.
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
