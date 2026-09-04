import { describe, it, expect, vi } from 'vitest'
import maplibregl from 'maplibre-gl'
import { OverheadZoneControl } from './OverheadZoneControl'

const SOURCE_ID = 'overhead-zone'
const FILL_ID = 'overhead-zone-fill'
const LINE_ID = 'overhead-zone-line'

interface FakeMap {
  map: maplibregl.Map
  addSource: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  setLayoutProperty: ReturnType<typeof vi.fn>
  setData: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
  removeSource: ReturnType<typeof vi.fn>
  styleLoadHandlers: Array<() => void>
  layers: Set<string>
  sources: Set<string>
}

function fakeMap(options: { styleLoaded?: boolean } = {}): FakeMap {
  const styleLoadHandlers: Array<() => void> = []
  const layers = new Set<string>()
  const sources = new Set<string>()
  const setData = vi.fn()
  const addSource = vi.fn((id: string) => sources.add(id))
  const addLayer = vi.fn((layer: { id: string }) => layers.add(layer.id))
  const setLayoutProperty = vi.fn()
  const removeLayer = vi.fn((id: string) => layers.delete(id))
  const removeSource = vi.fn((id: string) => sources.delete(id))
  const map = {
    isStyleLoaded: vi.fn(() => options.styleLoaded ?? true),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'style.load') styleLoadHandlers.push(handler)
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData } : undefined)),
    removeLayer,
    removeSource,
    addSource,
    addLayer,
    setLayoutProperty,
  } as unknown as maplibregl.Map
  return {
    map,
    addSource,
    addLayer,
    setLayoutProperty,
    setData,
    removeLayer,
    removeSource,
    styleLoadHandlers,
    layers,
    sources,
  }
}

/** One drawn zone, defaulting to a 10 nm circle at the operator's position. */
function zone(overrides: Partial<{ lon: number; lat: number; radiusNm: number }> = {}) {
  return { lon: -1, lat: 51, radiusNm: 10, ...overrides }
}

/** The FeatureCollection last written to the source, whether at init or after. */
function writtenZones(map: FakeMap): GeoJSON.FeatureCollection {
  if (map.setData.mock.calls.length > 0) {
    return map.setData.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection
  }
  const call = map.addSource.mock.calls.at(-1)!
  return (call[1] as { data: GeoJSON.FeatureCollection }).data
}

describe('OverheadZoneControl.onAdd', () => {
  it('builds the source and both layers when the style is already loaded', () => {
    const map = fakeMap({ styleLoaded: true })
    new OverheadZoneControl([zone()]).onAdd(map.map)

    expect(map.addSource).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    )
    expect([...map.layers]).toEqual([FILL_ID, LINE_ID])
  })

  it('defers the build to style.load when the style is not ready', () => {
    const map = fakeMap({ styleLoaded: false })
    new OverheadZoneControl([zone()]).onAdd(map.map)

    expect(map.addSource).not.toHaveBeenCalled()
    map.styleLoadHandlers[0]!()
    expect(map.addSource).toHaveBeenCalledOnce()
  })

  it('draws the zones it was constructed with, so the first paint is not a frame behind', () => {
    const map = fakeMap()
    new OverheadZoneControl([zone(), zone({ lat: 55 })]).onAdd(map.map)

    expect(writtenZones(map).features).toHaveLength(2)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(FILL_ID, 'visibility', 'visible')
  })

  it('starts hidden and empty with nothing to watch', () => {
    const map = fakeMap()
    new OverheadZoneControl().onAdd(map.map)

    expect(writtenZones(map).features).toHaveLength(0)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(FILL_ID, 'visibility', 'none')
  })

  it('tears down pre-existing layers and the source before rebuilding', () => {
    const map = fakeMap()
    map.layers.add(FILL_ID)
    map.layers.add(LINE_ID)
    map.sources.add(SOURCE_ID)

    new OverheadZoneControl([zone()]).onAdd(map.map)

    expect(map.removeLayer).toHaveBeenCalledWith(LINE_ID)
    expect(map.removeLayer).toHaveBeenCalledWith(FILL_ID)
    expect(map.removeSource).toHaveBeenCalledWith(SOURCE_ID)
  })
})

describe('OverheadZoneControl.setZones', () => {
  it('draws one circle per watched place', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl()
    control.onAdd(map.map)

    // Each Sentry watches its own patch of sky, so each gets its own circle.
    control.setZones([zone(), zone({ lat: 55, radiusNm: 40 })])

    expect(writtenZones(map).features).toHaveLength(2)
  })

  it('shows the layers once there is something to draw', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl()
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.setZones([zone()])

    expect(map.setLayoutProperty).toHaveBeenCalledWith(FILL_ID, 'visibility', 'visible')
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LINE_ID, 'visibility', 'visible')
  })

  it('hides them again when every place is switched off', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.setZones([])

    expect(writtenZones(map).features).toHaveLength(0)
    expect(map.setLayoutProperty).toHaveBeenCalledWith(FILL_ID, 'visibility', 'none')
  })

  it('honours each zone’s own radius', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl()
    control.onAdd(map.map)

    control.setZones([zone({ radiusNm: 5 }), zone({ radiusNm: 50 })])

    const [small, large] = writtenZones(map).features as GeoJSON.Feature<GeoJSON.Polygon>[]
    const spread = (feature: GeoJSON.Feature<GeoJSON.Polygon>) => {
      const lats = feature.geometry.coordinates[0]!.map((coordinate) => coordinate[1]!)
      return Math.max(...lats) - Math.min(...lats)
    }
    expect(spread(large!)).toBeGreaterThan(spread(small!))
  })

  it('builds the layers if the source is not there yet', () => {
    const map = fakeMap({ styleLoaded: false })
    const control = new OverheadZoneControl()
    control.onAdd(map.map) // deferred — no source

    control.setZones([zone()])

    expect(map.addSource).toHaveBeenCalledOnce()
  })

  it('is a no-op before the control has a map', () => {
    const control = new OverheadZoneControl()
    expect(() => control.setZones([zone()])).not.toThrow()
  })
})

describe('OverheadZoneControl teardown and restyle', () => {
  it('reinit rebuilds after a style swap drops the layers', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)

    control.reinit()

    expect(map.addSource).toHaveBeenCalledTimes(2)
  })

  it('reinit is a no-op with no map', () => {
    const control = new OverheadZoneControl([zone()])
    expect(() => control.reinit()).not.toThrow()
  })

  it('onRemove drops both layers and the source', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)

    control.onRemove()

    expect(map.removeLayer).toHaveBeenCalledWith(LINE_ID)
    expect(map.removeLayer).toHaveBeenCalledWith(FILL_ID)
    expect(map.removeSource).toHaveBeenCalledWith(SOURCE_ID)
  })

  it('ignores a style.load that arrives after the control was removed', () => {
    const map = fakeMap({ styleLoaded: false })
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)
    control.onRemove()

    // The deferred build must not resurrect layers on a map it has left.
    map.styleLoadHandlers[0]!()

    expect(map.addSource).not.toHaveBeenCalled()
  })

  it('onRemove is a safe no-op when never added', () => {
    expect(() => new OverheadZoneControl().onRemove()).not.toThrow()
  })

  it('onRemove tolerates layers a style swap already dropped', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)
    map.layers.clear()
    map.sources.clear()

    expect(() => control.onRemove()).not.toThrow()
    expect(map.removeLayer).not.toHaveBeenCalled()
  })

  it('setZones tolerates the layers being absent while the source survives', () => {
    const map = fakeMap()
    const control = new OverheadZoneControl([zone()])
    control.onAdd(map.map)
    // A style reload can drop the layers while the source is still registered.
    map.layers.clear()
    map.setLayoutProperty.mockClear()

    control.setZones([zone({ lat: 55 })])

    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })
})
