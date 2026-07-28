import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Registry of constructed fake maps + the options each was built with, so the
// spec can assert the MapLibre constructor wiring and drive captured handlers.
const mapRegistry = vi.hoisted(() => ({ instances: [] as FakeMap[] }))

interface FakeMap {
  options: Record<string, unknown>
  handlers: Record<string, () => void>
  on: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

vi.mock('maplibre-gl', () => {
  function Map(this: FakeMap, options: Record<string, unknown>) {
    this.options = options
    this.handlers = {}
    this.on = vi.fn((event: string, cb: () => void) => {
      this.handlers[event] = cb
    })
    this.resize = vi.fn()
    this.remove = vi.fn()
    mapRegistry.instances.push(this)
  }
  return { default: { Map } }
})

import MapLibreMap from './MapLibreMap.vue'
import { axe } from 'jest-axe'

const STYLE = 'https://tiles.example/style.json'

describe('MapLibreMap', () => {
  beforeEach(() => {
    mapRegistry.instances.length = 0
    delete (window as unknown as { map?: unknown }).map
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates a map with prop-driven view options and attribution disabled', () => {
    mount(MapLibreMap, {
      props: {
        styleUrl: STYLE,
        regionLabel: 'Test map',
        center: [10, 20],
        zoom: 9,
        pitch: 45,
        bearing: 30,
      },
    })
    const created = mapRegistry.instances[0]!
    expect(created.options).toMatchObject({
      style: STYLE,
      center: [10, 20],
      zoom: 9,
      pitch: 45,
      bearing: 30,
      attributionControl: false,
    })
    expect(created.options.container).toBeInstanceOf(HTMLElement)
  })

  // Every domain map is built through this component, so disabling MapLibre's
  // 300ms symbol cross-fade here is what makes base-map labels (and every other
  // symbol layer) appear instantly rather than drifting in when a layer is
  // toggled on. Asserted explicitly because nothing else in the app would fail
  // if the option were dropped — the fade would just quietly come back.
  it('disables the symbol fade so toggled layers appear instantly', () => {
    mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    expect(mapRegistry.instances[0]!.options.fadeDuration).toBe(0)
  })

  it('falls back to default view options when view props are omitted', () => {
    mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    expect(mapRegistry.instances[0]!.options).toMatchObject({
      center: [0, 51.5],
      zoom: 6,
      pitch: 0,
      bearing: 0,
    })
  })

  it('emits map-created and exposes the instance via window.map and getMap()', () => {
    const wrapper = mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    const created = mapRegistry.instances[0]!
    expect(wrapper.emitted('map-created')).toHaveLength(1)
    expect(wrapper.emitted('map-created')![0]![0]).toBe(created)
    expect((window as unknown as { map?: unknown }).map).toBe(created)
    expect((wrapper.vm as unknown as { getMap: () => unknown }).getMap()).toBe(created)
  })

  it('resizes on the load event and emits style-loaded on style.load', () => {
    const wrapper = mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    const created = mapRegistry.instances[0]!

    created.handlers.load!()
    expect(created.resize).toHaveBeenCalledOnce()

    created.handlers['style.load']!()
    expect(wrapper.emitted('style-loaded')).toHaveLength(1)
    expect(wrapper.emitted('style-loaded')![0]![0]).toBe(created)
  })

  it('removes the map and emits map-removed on unmount', () => {
    const wrapper = mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    const created = mapRegistry.instances[0]!
    wrapper.unmount()
    expect(created.remove).toHaveBeenCalledOnce()
    expect(wrapper.emitted('map-removed')).toHaveLength(1)
  })

  it('guards the load/style.load handlers once the map has been torn down', () => {
    const wrapper = mount(MapLibreMap, { props: { styleUrl: STYLE, regionLabel: 'Test map' } })
    const created = mapRegistry.instances[0]!
    // Capture the handlers, then unmount so the module-level `map` becomes null.
    const loadHandler = created.handlers.load!
    const styleLoadHandler = created.handlers['style.load']!
    wrapper.unmount()
    created.resize.mockClear()

    // After teardown the defensive null-guards short-circuit: no resize, no emit.
    loadHandler()
    styleLoadHandler()
    expect(created.resize).not.toHaveBeenCalled()
    expect(wrapper.emitted('style-loaded')).toBeUndefined()
  })

  describe('accessible region', () => {
    it('names the map container as a region and omits aria-describedby with no description', () => {
      const wrapper = mount(MapLibreMap, {
        props: { styleUrl: STYLE, regionLabel: 'Air domain map' },
      })
      const container = wrapper.find('.map-container')
      expect(container.attributes('role')).toBe('region')
      expect(container.attributes('aria-label')).toBe('Air domain map')
      expect(container.attributes('aria-describedby')).toBeUndefined()
      expect(wrapper.find('p.sr-only').exists()).toBe(false)
    })

    it('renders a visually-hidden description wired via aria-describedby', () => {
      const wrapper = mount(MapLibreMap, {
        props: {
          styleUrl: STYLE,
          regionLabel: 'Air domain map',
          regionDescription: 'Aircraft are also listed in the Search panel.',
        },
      })
      const description = wrapper.find('p.sr-only')
      expect(description.exists()).toBe(true)
      expect(description.text()).toBe('Aircraft are also listed in the Search panel.')
      // The description is programmatically associated with the region.
      expect(wrapper.find('.map-container').attributes('aria-describedby')).toBe(
        description.attributes('id'),
      )
    })

    it('has no accessibility violations', async () => {
      const wrapper = mount(MapLibreMap, {
        props: {
          styleUrl: STYLE,
          regionLabel: 'Air domain map',
          regionDescription: 'Aircraft are also listed in the Search panel.',
        },
      })
      expect(await axe(wrapper.html())).toHaveNoViolations()
    })
  })
})
