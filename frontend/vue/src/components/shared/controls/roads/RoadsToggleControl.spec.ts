import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import maplibregl from 'maplibre-gl'
import { RoadsToggleControl } from './RoadsToggleControl'
import { useBasemapStore, type BasemapStore } from '@/stores/basemap'

interface FakeMap {
  map: maplibregl.Map
  once: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  setLayoutProperty: ReturnType<typeof vi.fn>
  styleLoadHandlers: Array<() => void>
}

// Fake map reporting only `existingLayers` as present in the style.
function fakeMap(options: { styleLoaded?: boolean; existingLayers?: string[] } = {}): FakeMap {
  const styleLoadHandlers: Array<() => void> = []
  const existing = new Set(options.existingLayers ?? [])
  const isStyleLoaded = vi.fn(() => options.styleLoaded ?? true)
  const once = vi.fn((event: string, handler: () => void) => {
    if (event === 'style.load') styleLoadHandlers.push(handler)
  })
  const getLayer = vi.fn((id: string) => (existing.has(id) ? { id } : undefined))
  const setLayoutProperty = vi.fn()
  const map = { isStyleLoaded, once, getLayer, setLayoutProperty } as unknown as maplibregl.Map
  return { map, once, getLayer, setLayoutProperty, styleLoadHandlers }
}

let basemapStore: BasemapStore

beforeEach(() => {
  setActivePinia(createPinia())
  basemapStore = useBasemapStore()
})

describe('RoadsToggleControl constructor', () => {
  it('seeds visibility from the shared basemap store (default off)', () => {
    expect(new RoadsToggleControl(basemapStore).roadsVisible).toBe(false)
  })

  it('seeds visibility as on when the store has roads enabled', () => {
    basemapStore.setLayer('roads', true)
    expect(new RoadsToggleControl(basemapStore).roadsVisible).toBe(true)
  })

  it('exposes its label and title', () => {
    const control = new RoadsToggleControl(basemapStore)
    expect(control.buttonLabel).toBe('R')
    expect(control.buttonTitle).toBe('Toggle road lines and names')
  })
})

describe('RoadsToggleControl.onInit', () => {
  it('applies visibility immediately when the style is already loaded', () => {
    basemapStore.setLayer('roads', true)
    const control = new RoadsToggleControl(basemapStore)
    const map = fakeMap({ styleLoaded: true, existingLayers: ['highway_minor', 'road_pier'] })
    control.onAdd(map.map)

    expect(map.setLayoutProperty).toHaveBeenCalledWith('highway_minor', 'visibility', 'visible')
    expect(map.setLayoutProperty).toHaveBeenCalledWith('road_pier', 'visibility', 'visible')
    expect(control.button.style.color).toBe('rgb(200, 255, 0)')
  })

  it('defers visibility application to the style.load event when the style is not ready', () => {
    const control = new RoadsToggleControl(basemapStore)
    const map = fakeMap({ styleLoaded: false, existingLayers: ['highway_minor'] })
    control.onAdd(map.map)

    expect(map.setLayoutProperty).not.toHaveBeenCalled()
    expect(map.once).toHaveBeenCalledWith('style.load', expect.any(Function))

    map.styleLoadHandlers[0]!()
    expect(map.setLayoutProperty).toHaveBeenCalledWith('highway_minor', 'visibility', 'none')
  })
})

describe('RoadsToggleControl.handleClick', () => {
  it('toggles roads on, shows the present layers, and persists the new state', () => {
    const control = new RoadsToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: ['highway_minor'] })
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()

    expect(control.roadsVisible).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('highway_minor', 'visibility', 'visible')
    expect(basemapStore.layers.roads).toBe(true)
    expect(control.button.style.opacity).toBe('1')
  })

  it('toggles roads off, hides the present layers, and persists the new state', () => {
    basemapStore.setLayer('roads', true)
    const control = new RoadsToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: ['highway_minor'] })
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()

    expect(control.roadsVisible).toBe(false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('highway_minor', 'visibility', 'none')
    expect(basemapStore.layers.roads).toBe(false)
    expect(control.button.style.opacity).toBe('0.3')
  })

  it('skips layers absent from the current style', () => {
    const control = new RoadsToggleControl(basemapStore)
    const map = fakeMap({ existingLayers: [] })
    control.onAdd(map.map)

    control.handleClickPublic()
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})
