import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import maplibregl from 'maplibre-gl'
import { NamesToggleControl } from './NamesToggleControl'
import { useBasemapStore, type BasemapStore } from '@/stores/basemap'

const NAME_LAYERS = [
  'place_suburb',
  'place_village',
  'place_town',
  'place_city',
  'place_state',
  'place_country',
  'place_country_other',
  'water_name',
]

interface FakeMap {
  map: maplibregl.Map
  isStyleLoaded: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  setLayoutProperty: ReturnType<typeof vi.fn>
  styleLoadHandlers: Array<() => void>
  existingLayers: Set<string>
}

// A fake MapLibre map whose `getLayer` reports only `existingLayers` as present,
// so we can assert the control skips layers that are not in the style.
function fakeMap(options: { styleLoaded?: boolean; existingLayers?: string[] } = {}): FakeMap {
  const styleLoadHandlers: Array<() => void> = []
  const existingLayers = new Set(options.existingLayers ?? NAME_LAYERS)
  const isStyleLoaded = vi.fn(() => options.styleLoaded ?? true)
  const once = vi.fn((event: string, handler: () => void) => {
    if (event === 'style.load') styleLoadHandlers.push(handler)
  })
  const getLayer = vi.fn((id: string) => (existingLayers.has(id) ? { id } : undefined))
  const setLayoutProperty = vi.fn()
  const map = { isStyleLoaded, once, getLayer, setLayoutProperty } as unknown as maplibregl.Map
  return {
    map,
    isStyleLoaded,
    once,
    getLayer,
    setLayoutProperty,
    styleLoadHandlers,
    existingLayers,
  }
}

let basemapStore: BasemapStore

beforeEach(() => {
  setActivePinia(createPinia())
  basemapStore = useBasemapStore()
})

describe('NamesToggleControl constructor', () => {
  it('seeds visibility from the shared basemap store (default off)', () => {
    const control = new NamesToggleControl(basemapStore)
    expect(control.namesVisible).toBe(false)
  })

  it('seeds visibility as on when the store has names enabled', () => {
    basemapStore.setLayer('names', true)
    expect(new NamesToggleControl(basemapStore).namesVisible).toBe(true)
  })

  it('exposes its label and title', () => {
    const control = new NamesToggleControl(basemapStore)
    expect(control.buttonLabel).toBe('N')
    expect(control.buttonTitle).toBe('Toggle city names')
  })
})

describe('NamesToggleControl.onInit', () => {
  it('applies visibility immediately when the style is already loaded', () => {
    basemapStore.setLayer('names', true)
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap({ styleLoaded: true, existingLayers: ['place_city', 'water_name'] })
    control.onAdd(map.map)

    // Only the two present layers are touched, each set visible.
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(2)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('place_city', 'visibility', 'visible')
    expect(map.setLayoutProperty).toHaveBeenCalledWith('water_name', 'visibility', 'visible')
    expect(control.button.style.color).toBe('rgb(200, 255, 0)')
  })

  it('defers visibility application to the style.load event when the style is not ready', () => {
    basemapStore.setLayer('names', true)
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap({ styleLoaded: false, existingLayers: ['place_city'] })
    control.onAdd(map.map)

    expect(map.setLayoutProperty).not.toHaveBeenCalled()
    expect(map.once).toHaveBeenCalledWith('style.load', expect.any(Function))

    map.styleLoadHandlers[0]!()
    expect(map.setLayoutProperty).toHaveBeenCalledWith('place_city', 'visibility', 'visible')
  })
})

describe('NamesToggleControl.handleClick', () => {
  it('toggles names on, shows the layers, and persists the new state', () => {
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: ['place_city'] })
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()

    expect(control.namesVisible).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('place_city', 'visibility', 'visible')
    expect(basemapStore.layers.names).toBe(true)
    expect(control.button.style.opacity).toBe('1')
  })

  it('toggles names off, hides the layers, and persists the new state', () => {
    basemapStore.setLayer('names', true)
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: ['place_city'] })
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()

    expect(control.namesVisible).toBe(false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('place_city', 'visibility', 'none')
    expect(basemapStore.layers.names).toBe(false)
    expect(control.button.style.opacity).toBe('0.3')
  })

  it('skips layers that are absent from the current style', () => {
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: [] })
    control.onAdd(map.map)

    control.handleClickPublic()
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})

describe('NamesToggleControl.setVisible — a change decided elsewhere', () => {
  it('adopts the new visibility and pushes it onto the style', () => {
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap()
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.setVisible(true)

    expect(control.namesVisible).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(expect.any(String), 'visibility', 'visible')
  })

  it('does not write back to the store — that is where the value came from', () => {
    const control = new NamesToggleControl(basemapStore)
    control.onAdd(fakeMap().map)
    const setLayer = vi.spyOn(basemapStore, 'setLayer')

    control.setVisible(true)

    // Writing back would fight the store that just told it to change.
    expect(setLayer).not.toHaveBeenCalled()
  })

  it('is a no-op when it already agrees', () => {
    basemapStore.setLayer('names', true)
    const control = new NamesToggleControl(basemapStore)
    const map = fakeMap()
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.setVisible(true)

    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})
