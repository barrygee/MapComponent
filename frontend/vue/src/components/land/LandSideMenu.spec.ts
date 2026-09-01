import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import LandSideMenu from './LandSideMenu.vue'
import { useBasemapStore } from '@/stores/basemap'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    goToLocation: vi.fn(),
    toggleRangeRings: vi.fn(),
    toggleAprs: vi.fn(),
    toggleNames: vi.fn(),
    rangeRingsActive: false,
    aprsActive: true,
    aprsSourceConfigured: true,
    locationActive: false,
    ...overrides,
  }
}

function mountMenu(overrides: Record<string, unknown> = {}) {
  const props = makeProps(overrides)
  const wrapper = mount(LandSideMenu, { props })
  return { wrapper, props }
}

/**
 * The accordion panels are shown/hidden with `v-show`, which writes `display`
 * straight onto the element. Reading that inline value is checked rather than
 * VTU's `isVisible()`, whose `getComputedStyle` cascade is unreliable in jsdom
 * once the scoped `display: flex` rule for the panel is in the document.
 */
function panelDisplay(wrapper: ReturnType<typeof mountMenu>['wrapper'], panelId: string): string {
  return (wrapper.find(panelId).element as HTMLElement).style.display
}

describe('LandSideMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('renders every map control with an accessible name', () => {
    const { wrapper } = mountMenu()
    for (const name of [
      'Zoom in',
      'Zoom out',
      'Go to my location',
      'Filter stations',
      'APRS stations',
      'Map layers',
      'Range rings',
      'Location name labels',
    ]) {
      expect(wrapper.find(`[aria-label="${name}"]`).exists()).toBe(true)
    }
  })

  it('is a right-edge rail landmark', () => {
    const { wrapper } = mountMenu()
    const rail = wrapper.find('#land-side-menu')
    expect(rail.exists()).toBe(true)
    expect(rail.attributes('aria-label')).toBe('Land map controls')
  })

  it('orders the rail to match the Air and Space maps', () => {
    const { wrapper } = mountMenu()
    // Only the rail's own buttons, not the ones inside the two accordion panels.
    const railLabels = wrapper
      .findAll('#land-side-menu > button')
      .map((button) => button.attributes('aria-label'))
    expect(railLabels).toEqual([
      'Zoom in',
      'Zoom out',
      'Go to my location',
      'Filter stations',
      'Map layers',
    ])
  })

  it('wires each rail button to its handler', async () => {
    const { wrapper, props } = mountMenu()
    await wrapper.find('[aria-label="Zoom in"]').trigger('click')
    expect(props.zoomIn).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Zoom out"]').trigger('click')
    expect(props.zoomOut).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Go to my location"]').trigger('click')
    expect(props.goToLocation).toHaveBeenCalledOnce()
  })

  it('wires each panel button to its handler', async () => {
    const { wrapper, props } = mountMenu()
    await wrapper.find('[aria-label="APRS stations"]').trigger('click')
    expect(props.toggleAprs).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Range rings"]').trigger('click')
    expect(props.toggleRangeRings).toHaveBeenCalledOnce()
    await wrapper.find('[aria-label="Location name labels"]').trigger('click')
    expect(props.toggleNames).toHaveBeenCalledOnce()
  })

  it('reflects the active (green) state of each prop-driven toggle', () => {
    const { wrapper } = mountMenu({
      rangeRingsActive: true,
      aprsActive: true,
      locationActive: true,
    })
    expect(wrapper.find('[aria-label="Range rings"]').classes()).toContain('active')
    expect(wrapper.find('[aria-label="APRS stations"]').classes()).toContain('active')
    expect(wrapper.find('[aria-label="Go to my location"]').classes()).toContain('active')
  })

  it('shows prop-driven toggles as inactive when off', () => {
    const { wrapper } = mountMenu({
      rangeRingsActive: false,
      aprsActive: false,
      locationActive: false,
    })
    expect(wrapper.find('[aria-label="Range rings"]').classes()).not.toContain('active')
    expect(wrapper.find('[aria-label="APRS stations"]').classes()).not.toContain('active')
    expect(wrapper.find('[aria-label="Go to my location"]').classes()).not.toContain('active')
  })

  it('reads the base-map toggle straight off the shared basemap store', async () => {
    const basemapStore = useBasemapStore()
    const { wrapper } = mountMenu()
    expect(wrapper.find('[aria-label="Location name labels"]').classes()).not.toContain('active')

    // A change made on another map (or restored from storage) lights it up
    // here without LandView passing anything down.
    basemapStore.setLayer('names', true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[aria-label="Location name labels"]').classes()).toContain('active')
  })
})

describe('LandSideMenu accordions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts with both accordion panels collapsed', () => {
    const { wrapper } = mountMenu()
    expect(wrapper.find('[aria-label="Filter stations"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[aria-label="Map layers"]').attributes('aria-expanded')).toBe('false')
    expect(panelDisplay(wrapper, '#land-filter-panel')).toBe('none')
    expect(panelDisplay(wrapper, '#land-layers-panel')).toBe('none')
  })

  it('expands and collapses the FILTER panel on click', async () => {
    const { wrapper } = mountMenu()
    const trigger = wrapper.find('[aria-label="Filter stations"]')
    expect(trigger.attributes('aria-controls')).toBe('land-filter-panel')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(trigger.classes()).toContain('active')
    expect(panelDisplay(wrapper, '#land-filter-panel')).not.toBe('none')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.classes()).not.toContain('active')
    expect(panelDisplay(wrapper, '#land-filter-panel')).toBe('none')
  })

  it('expands and collapses the MAP LAYERS panel on click', async () => {
    const { wrapper } = mountMenu()
    const trigger = wrapper.find('[aria-label="Map layers"]')
    expect(trigger.attributes('aria-controls')).toBe('land-layers-panel')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(trigger.classes()).toContain('active')
    expect(panelDisplay(wrapper, '#land-layers-panel')).not.toBe('none')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.classes()).not.toContain('active')
    expect(panelDisplay(wrapper, '#land-layers-panel')).toBe('none')
  })

  it('puts APRS stations in the FILTER panel', () => {
    const { wrapper } = mountMenu()
    const labels = wrapper
      .findAll('#land-filter-panel button')
      .map((button) => button.attributes('aria-label'))
    expect(labels).toEqual(['APRS stations'])
  })

  it('puts range rings above the shared base-map layers in the LAYERS panel', () => {
    const { wrapper } = mountMenu()
    const labels = wrapper
      .findAll('#land-layers-panel button')
      .map((button) => button.attributes('aria-label'))
    expect(labels).toEqual(['Range rings', 'Location name labels'])
  })
})

describe('LandSideMenu accessibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('has no accessibility violations while collapsed', async () => {
    const { wrapper } = mountMenu()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  it('has no accessibility violations with both panels expanded', async () => {
    const { wrapper } = mountMenu()
    await wrapper.find('[aria-label="Filter stations"]').trigger('click')
    await wrapper.find('[aria-label="Map layers"]').trigger('click')
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })
})

// The APRS layer has no data behind it until a radio is named as the APRS
// receiver in Settings → LAND, so the button must not offer a toggle that could
// only ever show an empty map.
describe('LandSideMenu — APRS with no receiver', () => {
  it('disables the APRS button and says why in its accessible name', () => {
    const { wrapper } = mountMenu({ aprsSourceConfigured: false })
    const aprsButton = wrapper.find(
      '[aria-label="APRS stations — unavailable until an APRS SDR is chosen in Land settings"]',
    )

    expect((aprsButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(aprsButton.attributes('data-tooltip')).toBe('APRS STATIONS — NO SDR SET')
  })

  it('leaves the button enabled, plainly named, once a receiver is set', () => {
    const { wrapper } = mountMenu({ aprsSourceConfigured: true })
    const aprsButton = wrapper.find('[aria-label="APRS stations"]')

    expect((aprsButton.element as HTMLButtonElement).disabled).toBe(false)
    expect(aprsButton.attributes('data-tooltip')).toBe('APRS STATIONS')
  })

  it('cannot be toggled while disabled', async () => {
    const { wrapper, props } = mountMenu({ aprsSourceConfigured: false })
    await wrapper
      .find(
        '[aria-label="APRS stations — unavailable until an APRS SDR is chosen in Land settings"]',
      )
      .trigger('click')

    expect(props.toggleAprs).not.toHaveBeenCalled()
  })
})
