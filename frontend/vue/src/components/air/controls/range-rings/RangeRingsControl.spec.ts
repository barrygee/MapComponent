import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import maplibregl from 'maplibre-gl'
import { RangeRingsControl } from './RangeRingsControl'
import { useAirStore } from '@/stores/air'
import type { AirStore } from '../types'
import type { ResolvedRingOrigin } from '@/composables/useRangeRingOrigin'

const LAYER_ID = 'range-rings-lines'
const ORIGIN_LAYER = `${LAYER_ID}-origin`
const ORIGIN_DOT_LAYER = `${LAYER_ID}-origin-dot`
const LABEL_LAYER = `${LAYER_ID}-label`

interface FakeMap {
  map: maplibregl.Map
  addSource: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  setLayoutProperty: ReturnType<typeof vi.fn>
  setData: Map<string, ReturnType<typeof vi.fn>>
  styleLoadHandlers: Array<() => void>
  layers: Set<string>
  sources: Set<string>
  /** Last value written for a layout property, e.g. visibility of a layer. */
  layout: (layerId: string, property: string) => unknown
  sourceData: (sourceId: string) => GeoJSON.FeatureCollection | undefined
}

/**
 * Fake MapLibre map tracking layer/source existence so getLayer/getSource behave
 * like the real thing after add/remove, and recording every layout property and
 * every GeoJSON payload written.
 */
function fakeMap(options: { styleLoaded?: boolean } = {}): FakeMap {
  const styleLoadHandlers: Array<() => void> = []
  const layers = new Set<string>()
  const sources = new Set<string>()
  const layoutProps = new Map<string, unknown>()
  const written = new Map<string, GeoJSON.FeatureCollection>()
  const setData = new Map<string, ReturnType<typeof vi.fn>>()

  const addSource = vi.fn((id: string, source: { data: GeoJSON.FeatureCollection }) => {
    sources.add(id)
    written.set(id, source.data)
    setData.set(
      id,
      vi.fn((data: GeoJSON.FeatureCollection) => written.set(id, data)),
    )
  })
  const addLayer = vi.fn((layer: { id: string; layout?: Record<string, unknown> }) => {
    layers.add(layer.id)
    for (const [property, value] of Object.entries(layer.layout ?? {})) {
      layoutProps.set(`${layer.id}:${property}`, value)
    }
  })
  const setLayoutProperty = vi.fn((id: string, property: string, value: unknown) => {
    layoutProps.set(`${id}:${property}`, value)
  })

  const map = {
    isStyleLoaded: vi.fn(() => options.styleLoaded ?? true),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'style.load') styleLoadHandlers.push(handler)
    }),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData: setData.get(id) } : undefined)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
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
    styleLoadHandlers,
    layers,
    sources,
    layout: (layerId, property) => layoutProps.get(`${layerId}:${property}`),
    sourceData: (sourceId) => written.get(sourceId),
  }
}

function origin(overrides: Partial<ResolvedRingOrigin> = {}): ResolvedRingOrigin {
  return {
    longitude: -1,
    latitude: 51,
    label: 'MY LOCATION',
    kind: 'user',
    degraded: false,
    ...overrides,
  }
}

const SENTRY = origin({ kind: 'sentry', label: 'GATESHEAD', longitude: -1.53, latitude: 54.95 })

let airStore: AirStore

beforeEach(() => {
  setActivePinia(createPinia())
  airStore = useAirStore()
})

describe('RangeRingsControl (Air specifics)', () => {
  it('seeds visibility from the store, which defaults to off', () => {
    expect(new RangeRingsControl(airStore, origin()).ringsVisible).toBe(false)
  })

  it('seeds visibility on when the store already enables range rings', () => {
    airStore.setOverlay('rangeRings', true)
    expect(new RangeRingsControl(airStore, origin()).ringsVisible).toBe(true)
  })

  it('persists the toggle to the air store, so CLEAR OVERLAYS can see it', () => {
    const control = new RangeRingsControl(airStore, origin())
    control.onAdd(fakeMap().map)
    control.handleClickPublic()
    expect(airStore.overlayStates.rangeRings).toBe(true)
    control.handleClickPublic()
    expect(airStore.overlayStates.rangeRings).toBe(false)
  })

  it('exposes its label and title', () => {
    const control = new RangeRingsControl(airStore, null)
    expect(control.buttonLabel).toBe('◎')
    expect(control.buttonTitle).toBe('Toggle range rings')
  })
})

describe('RangeRingsControlBase.onInit', () => {
  it('builds the rings, the origin crosshair and the label layer when the style is loaded', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap({ styleLoaded: true })
    control.onAdd(map.map)

    expect(map.addSource).toHaveBeenCalledWith(
      LAYER_ID,
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addSource).toHaveBeenCalledWith(
      ORIGIN_LAYER,
      expect.objectContaining({ type: 'geojson' }),
    )
    expect([...map.layers]).toEqual([LAYER_ID, ORIGIN_LAYER, ORIGIN_DOT_LAYER, LABEL_LAYER])
  })

  it('draws five concentric closed rings', () => {
    const control = new RangeRingsControl(airStore, origin())
    control.onAdd(fakeMap().map)
    const data = fakeRingsOf(control)
    expect(data.features).toHaveLength(5)
    expect((data.features[0]!.geometry as GeoJSON.LineString).coordinates).toHaveLength(65)
  })

  function fakeRingsOf(control: RangeRingsControl): GeoJSON.FeatureCollection {
    // The control writes into the map it was added to; re-read it from there.
    const map = (control as unknown as { map: maplibregl.Map }).map
    const call = (map.addSource as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => args[0] === LAYER_ID,
    )!
    return (call[1] as { data: GeoJSON.FeatureCollection }).data
  }

  it('defers construction to style.load when the style is not ready', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap({ styleLoaded: false })
    control.onAdd(map.map)

    expect(map.addSource).not.toHaveBeenCalled()
    map.styleLoadHandlers[0]!()
    expect(map.addSource).toHaveBeenCalledTimes(2)
  })

  it('builds empty sources when no origin resolves', () => {
    const control = new RangeRingsControl(airStore, null)
    const map = fakeMap()
    control.onAdd(map.map)
    expect(map.sourceData(LAYER_ID)!.features).toHaveLength(0)
    expect(map.sourceData(ORIGIN_LAYER)!.features).toHaveLength(0)
  })

  it('tears down pre-existing layers and sources before rebuilding', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    for (const id of [LAYER_ID, ORIGIN_LAYER, ORIGIN_DOT_LAYER, LABEL_LAYER]) map.layers.add(id)
    map.sources.add(LAYER_ID)
    map.sources.add(ORIGIN_LAYER)

    control.onAdd(map.map)

    expect(map.map.removeLayer).toHaveBeenCalledWith(LABEL_LAYER)
    expect(map.map.removeLayer).toHaveBeenCalledWith(ORIGIN_DOT_LAYER)
    expect(map.map.removeSource).toHaveBeenCalledWith(LAYER_ID)
    expect(map.map.removeSource).toHaveBeenCalledWith(ORIGIN_LAYER)
  })

  it('filters the label to the outermost ring only', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)
    const labelLayer = map.addLayer.mock.calls
      .map((args) => args[0] as { id: string; filter?: unknown })
      .find((layer) => layer.id === LABEL_LAYER)!
    // One label per ring would repeat the same fact five times.
    expect(labelLayer.filter).toEqual(['==', ['get', 'dist'], 250])
  })
})

describe('RangeRingsControlBase visibility', () => {
  it('shows the rings when the toggle is on and an origin resolves', () => {
    airStore.setOverlay('rangeRings', true)
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)
    expect(map.layout(LAYER_ID, 'visibility')).toBe('visible')
  })

  it('keeps the rings hidden when toggled on with no origin', () => {
    const control = new RangeRingsControl(airStore, null)
    const map = fakeMap()
    control.onAdd(map.map)

    control.handleClickPublic()

    // Rings pinned to the map centre would be a measurement of nothing.
    expect(control.ringsVisible).toBe(true)
    expect(map.layout(LAYER_ID, 'visibility')).toBe('none')
  })

  it('hides the crosshair and label when the origin is the operator', () => {
    airStore.setOverlay('rangeRings', true)
    const control = new RangeRingsControl(airStore, origin({ kind: 'user' }))
    const map = fakeMap()
    control.onAdd(map.map)
    // The ⊙ marker already marks that spot; a crosshair on top of it is noise.
    expect(map.layout(ORIGIN_LAYER, 'visibility')).toBe('none')
    expect(map.layout(ORIGIN_DOT_LAYER, 'visibility')).toBe('none')
    expect(map.layout(LABEL_LAYER, 'visibility')).toBe('none')
  })

  it('shows the crosshair and label when the centre is somewhere else', () => {
    airStore.setOverlay('rangeRings', true)
    const control = new RangeRingsControl(airStore, SENTRY)
    const map = fakeMap()
    control.onAdd(map.map)
    expect(map.layout(ORIGIN_LAYER, 'visibility')).toBe('visible')
    expect(map.layout(ORIGIN_DOT_LAYER, 'visibility')).toBe('visible')
    expect(map.layout(LABEL_LAYER, 'visibility')).toBe('visible')
  })

  it('hides the crosshair again when the rings are switched off', () => {
    airStore.setOverlay('rangeRings', true)
    const control = new RangeRingsControl(airStore, SENTRY)
    const map = fakeMap()
    control.onAdd(map.map)

    control.handleClickPublic()

    expect(map.layout(ORIGIN_LAYER, 'visibility')).toBe('none')
  })

  it('does not touch layers that have not been created yet', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap({ styleLoaded: false })
    control.onAdd(map.map)
    expect(() => control.handleClickPublic()).not.toThrow()
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })

  it('survives the origin-mark layers being absent when visibility is applied', () => {
    airStore.setOverlay('rangeRings', true)
    const control = new RangeRingsControl(airStore, SENTRY)
    const map = fakeMap()
    control.onAdd(map.map)
    // A style reload can drop the extra layers while the ring layer survives.
    map.layers.delete(ORIGIN_LAYER)
    map.layers.delete(ORIGIN_DOT_LAYER)
    map.layers.delete(LABEL_LAYER)
    map.setLayoutProperty.mockClear()

    control.setOrigin(origin({ kind: 'sentry', label: 'GATESHEAD' }))

    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAYER_ID, 'visibility', 'visible')
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(ORIGIN_LAYER, 'visibility', 'visible')
  })
})

describe('RangeRingsControlBase.setOrigin', () => {
  it('rewrites the rings and the crosshair at the new centre', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)

    control.setOrigin(SENTRY)

    expect(map.sourceData(LAYER_ID)!.features).toHaveLength(5)
    const crosshair = map.sourceData(ORIGIN_LAYER)!.features[0]!.geometry as GeoJSON.Point
    expect(crosshair.coordinates).toEqual([-1.53, 54.95])
  })

  it('clears both sources when the origin goes away', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)

    control.setOrigin(null)

    expect(map.sourceData(LAYER_ID)!.features).toHaveLength(0)
    expect(map.sourceData(ORIGIN_LAYER)!.features).toHaveLength(0)
    expect(map.layout(LAYER_ID, 'visibility')).toBe('none')
  })

  it('names the origin along the outer ring', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)

    control.setOrigin(SENTRY)

    expect(map.layout(LABEL_LAYER, 'text-field')).toBe('GATESHEAD · 250 NM')
  })

  it('flags a stale position in the label rather than moving the rings', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)

    control.setOrigin({ ...SENTRY, degraded: true })

    expect(map.layout(LABEL_LAYER, 'text-field')).toBe('GATESHEAD · OFFLINE · 250 NM')
  })

  it('empties the label when there is no origin', () => {
    const control = new RangeRingsControl(airStore, SENTRY)
    const map = fakeMap()
    control.onAdd(map.map)

    control.setOrigin(null)

    expect(map.layout(LABEL_LAYER, 'text-field')).toBe('')
  })

  it('skips the redraw when the origin has not actually changed', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)
    const setData = map.setData.get(LAYER_ID)!

    // The origin recomputes on every 15s Sentry poll; rebuilding five 65-point
    // rings each time for an identical point is work the map does not need.
    control.setOrigin(origin())

    expect(setData).not.toHaveBeenCalled()
  })

  it.each([
    ['longitude', origin({ longitude: 2 })],
    ['latitude', origin({ latitude: 49 })],
    ['label', origin({ label: 'ELSEWHERE' })],
    ['kind', origin({ kind: 'sentry' })],
    ['degraded', origin({ degraded: true })],
  ])('redraws when the %s changes', (_field, next) => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)
    const setData = map.setData.get(LAYER_ID)!

    control.setOrigin(next)

    expect(setData).toHaveBeenCalledOnce()
  })

  it('redraws when an origin appears, and again when it goes', () => {
    const control = new RangeRingsControl(airStore, null)
    const map = fakeMap()
    control.onAdd(map.map)
    const setData = map.setData.get(LAYER_ID)!

    control.setOrigin(origin())
    control.setOrigin(null)

    expect(setData).toHaveBeenCalledTimes(2)
  })

  it('stays quiet when both the old and new origins are null', () => {
    const control = new RangeRingsControl(airStore, null)
    const map = fakeMap()
    control.onAdd(map.map)
    const setData = map.setData.get(LAYER_ID)!

    control.setOrigin(null)

    expect(setData).not.toHaveBeenCalled()
  })

  it('is a no-op once the control has left the map', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap()
    control.onAdd(map.map)
    control.onRemove()

    expect(() => control.setOrigin(SENTRY)).not.toThrow()
  })

  it('is a no-op when the sources do not exist yet', () => {
    const control = new RangeRingsControl(airStore, origin())
    const map = fakeMap({ styleLoaded: false })
    control.onAdd(map.map) // deferred — no sources
    control.setOrigin(SENTRY)
    expect(map.setData.size).toBe(0)
  })
})
