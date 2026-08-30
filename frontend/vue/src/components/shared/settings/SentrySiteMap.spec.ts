import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'

// Registry of constructed fake maps + the options each was built with, so the
// spec can assert the MapLibre wiring and drive captured handlers — the same
// shape MapLibreMap.spec.ts uses.
const mapRegistry = vi.hoisted(() => ({ instances: [] as FakeMap[], controls: [] as unknown[] }))

interface FakeMap {
  options: Record<string, unknown>
  handlers: Record<string, () => void>
  scrollZoom: { disable: ReturnType<typeof vi.fn> }
  on: ReturnType<typeof vi.fn>
  addControl: ReturnType<typeof vi.fn>
  setCenter: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const markerRegistry = vi.hoisted(() => ({
  instances: [] as { lngLat: [number, number] | null; element: HTMLElement; removed: boolean }[],
}))

vi.mock('maplibre-gl', () => {
  function Map(this: FakeMap, options: Record<string, unknown>) {
    this.options = options
    this.handlers = {}
    this.scrollZoom = { disable: vi.fn() }
    this.on = vi.fn((event: string, callback: () => void) => {
      this.handlers[event] = callback
    })
    this.addControl = vi.fn((control: unknown) => mapRegistry.controls.push(control))
    this.setCenter = vi.fn()
    this.resize = vi.fn()
    this.remove = vi.fn()
    mapRegistry.instances.push(this)
  }
  function NavigationControl(this: Record<string, unknown>, options: Record<string, unknown>) {
    this.options = options
  }
  function Marker(
    this: Record<string, unknown>,
    options: { element: HTMLElement; anchor: string },
  ) {
    const record = {
      lngLat: null as [number, number] | null,
      element: options.element,
      removed: false,
    }
    markerRegistry.instances.push(record)
    this.setLngLat = (lngLat: [number, number]) => {
      record.lngLat = lngLat
      return this
    }
    this.addTo = () => this
    this.remove = () => {
      record.removed = true
    }
  }
  return { default: { Map, Marker, NavigationControl } }
})

import SentrySiteMap from './SentrySiteMap.vue'

const GATESHEAD = { latitude: 54.951186, longitude: -1.532995, label: 'Gateshead' }

function mountMap(props = GATESHEAD) {
  return mount(SentrySiteMap, { props })
}

describe('SentrySiteMap', () => {
  beforeEach(() => {
    mapRegistry.instances.length = 0
    mapRegistry.controls.length = 0
    markerRegistry.instances.length = 0
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('builds the map on the reported position with the online domain style', () => {
    mountMap()
    const created = mapRegistry.instances[0]!
    expect(created.options).toMatchObject({
      style: '/assets/fiord-online.json',
      center: [-1.532995, 54.951186],
      zoom: 11,
      attributionControl: false,
      fadeDuration: 0,
    })
    expect(created.options.container).toBeInstanceOf(HTMLElement)
  })

  // Without this the map swallows the settings panel's own scroll, which is the
  // whole reason the map is zoomable by button rather than by wheel.
  it('disables scroll-wheel zoom and adds the +/- navigation control', () => {
    mountMap()
    const created = mapRegistry.instances[0]!
    expect(created.scrollZoom.disable).toHaveBeenCalled()
    expect(created.addControl).toHaveBeenCalledTimes(1)
    expect((mapRegistry.controls[0] as { options: unknown }).options).toEqual({
      showCompass: false,
    })
  })

  it('plots the Sentry with the ⊙ logo marker at its position', () => {
    mountMap()
    const marker = markerRegistry.instances[0]!
    expect(marker.lngLat).toEqual([-1.532995, 54.951186])
    expect(marker.element.className).toBe('sentry-site-marker')
    // The logo mark itself: white ring, accent-green dot.
    expect(marker.element.innerHTML).toContain('#c8ff00')
  })

  // The accordion that owns the map is hidden until the moment it mounts, so
  // MapLibre can measure a zero-sized container.
  it('resizes once the style has loaded', () => {
    mountMap()
    const created = mapRegistry.instances[0]!
    expect(created.resize).not.toHaveBeenCalled()
    created.handlers.load!()
    expect(created.resize).toHaveBeenCalled()
  })

  it('moves the marker and recentres when the position changes', async () => {
    const wrapper = mountMap()
    await wrapper.setProps({ latitude: 51.5, longitude: -0.12 })
    expect(markerRegistry.instances[0]!.lngLat).toEqual([-0.12, 51.5])
    expect(mapRegistry.instances[0]!.setCenter).toHaveBeenCalledWith([-0.12, 51.5])
    // The map itself is reused, never rebuilt.
    expect(mapRegistry.instances).toHaveLength(1)
  })

  it('tears the map and marker down on unmount', () => {
    const wrapper = mountMap()
    wrapper.unmount()
    expect(mapRegistry.instances[0]!.remove).toHaveBeenCalled()
    expect(markerRegistry.instances[0]!.removed).toBe(true)
  })

  it('names the map region with the host label and its coordinates', () => {
    const region = mountMap().find('[role="region"]')
    expect(region.attributes('aria-label')).toBe(
      'Map showing Gateshead at latitude 54.9512, longitude -1.5330',
    )
  })

  it('has no accessibility violations', async () => {
    const wrapper = mountMap()
    expect(await axe(wrapper.html())).toHaveNoViolations()
  })
})
