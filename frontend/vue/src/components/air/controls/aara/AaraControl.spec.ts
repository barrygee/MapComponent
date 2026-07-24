import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Registry of fake markers so the spec can inspect label elements and the
// add/remove lifecycle.
interface FakeMarker {
  options: { element: HTMLElement; anchor: string }
  lngLat: [number, number] | null
  setLngLat: ReturnType<typeof vi.fn>
  addTo: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const markerRegistry = vi.hoisted(() => ({ instances: [] as FakeMarker[] }))

vi.mock('maplibre-gl', () => {
  // Regular function (not arrow) so `new Marker(...)` constructs correctly.
  function Marker(this: FakeMarker, options: FakeMarker['options']) {
    this.options = options
    this.lngLat = null
    this.addTo = vi.fn(() => this)
    this.remove = vi.fn(() => this)
    this.setLngLat = vi.fn((coords: [number, number]) => {
      this.lngLat = coords
      return this
    })
    markerRegistry.instances.push(this)
  }
  return { default: { Marker } }
})

import { AaraToggleControl } from './AaraControl'
import { useAirStore } from '@/stores/air'
import type { AirStore } from '../types'
import type maplibregl from 'maplibre-gl'

const ZONE_COUNT = 14
const LAYER_IDS = ['aara-fill', 'aara-outline']

interface FakeMap {
  map: maplibregl.Map
  addSource: ReturnType<typeof vi.fn>
  addLayer: ReturnType<typeof vi.fn>
  setLayoutProperty: ReturnType<typeof vi.fn>
  project: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  styleLoadHandlers: Array<() => void>
  moveHandlers: Array<() => void>
  sources: Set<string>
  layers: Set<string>
}

function fakeMap(options: { styleLoaded?: boolean } = {}): FakeMap {
  const styleLoadHandlers: Array<() => void> = []
  const moveHandlers: Array<() => void> = []
  const sources = new Set<string>()
  const layers = new Set<string>()
  const addSource = vi.fn((id: string) => sources.add(id))
  const addLayer = vi.fn((layer: { id: string }) => layers.add(layer.id))
  const setLayoutProperty = vi.fn()
  // Identity-ish projection: lng→x, lat→y, so rotation maths run on real data.
  const project = vi.fn((coords: [number, number]) => ({ x: coords[0], y: coords[1] }))
  const on = vi.fn((event: string, handler: () => void) => {
    if (event === 'move') moveHandlers.push(handler)
  })
  const off = vi.fn((event: string, handler: () => void) => {
    if (event !== 'move') return
    const index = moveHandlers.indexOf(handler)
    if (index !== -1) moveHandlers.splice(index, 1)
  })
  const map = {
    isStyleLoaded: vi.fn(() => options.styleLoaded ?? true),
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'style.load') styleLoadHandlers.push(handler)
    }),
    on,
    off,
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    addSource,
    addLayer,
    setLayoutProperty,
    project,
  } as unknown as maplibregl.Map
  return {
    map,
    addSource,
    addLayer,
    setLayoutProperty,
    project,
    on,
    off,
    styleLoadHandlers,
    moveHandlers,
    sources,
    layers,
  }
}

let airStore: AirStore

beforeEach(() => {
  markerRegistry.instances.length = 0
  setActivePinia(createPinia())
  airStore = useAirStore()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('AaraToggleControl constructor', () => {
  it('seeds visibility from the store (default on)', () => {
    expect(new AaraToggleControl(airStore).visible).toBe(true)
  })

  it('seeds visibility off when the store disables AARA', () => {
    airStore.setOverlay('aara', false)
    expect(new AaraToggleControl(airStore).visible).toBe(false)
  })

  it('exposes its label and title', () => {
    const control = new AaraToggleControl(airStore)
    expect(control.buttonLabel).toBe('=')
    expect(control.buttonTitle).toBe('Toggle UK air-to-air refuelling areas')
  })
})

describe('AaraToggleControl.onInit', () => {
  it('adds the zone source, fill/outline layers and one label marker per zone when visible', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap({ styleLoaded: true })
    control.onAdd(map.map)

    expect(map.addSource).toHaveBeenCalledWith(
      'aara-zones',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'aara-fill', type: 'fill' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'aara-outline', type: 'line' }),
    )
    expect(markerRegistry.instances).toHaveLength(ZONE_COUNT)
    markerRegistry.instances.forEach((marker) => expect(marker.addTo).toHaveBeenCalledOnce())
  })

  it('builds layers hidden and markers detached when not visible', () => {
    airStore.setOverlay('aara', false)
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)

    const fillLayer = map.addLayer.mock.calls.find((call) => call[0].id === 'aara-fill')![0]
    expect(fillLayer.layout.visibility).toBe('none')
    markerRegistry.instances.forEach((marker) => expect(marker.addTo).not.toHaveBeenCalled())
  })

  it('defers initialisation to style.load when the style is not ready', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap({ styleLoaded: false })
    control.onAdd(map.map)
    expect(map.addSource).not.toHaveBeenCalled()
    map.styleLoadHandlers[0]!()
    expect(map.addSource).toHaveBeenCalledOnce()
  })

  it('does not rebuild when the source already exists', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    map.sources.add('aara-zones') // pretend it was already initialised
    control.onAdd(map.map)
    expect(map.addSource).not.toHaveBeenCalled()
    expect(markerRegistry.instances).toHaveLength(0)
  })

  it('renders the zone name in each label', () => {
    const control = new AaraToggleControl(airStore)
    control.onAdd(fakeMap().map)
    const firstLabel = markerRegistry.instances[0]!.options.element.textContent
    expect(firstLabel).toMatch(/^AARA \d+$/)
  })
})

describe('AaraToggleControl.toggle', () => {
  it('hides the layers and markers and persists when toggled off', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()

    expect(control.visible).toBe(false)
    LAYER_IDS.forEach((id) =>
      expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none'),
    )
    markerRegistry.instances.forEach((marker) => expect(marker.remove).toHaveBeenCalled())
    expect(airStore.overlayStates.aara).toBe(false)
  })

  it('shows the layers and markers and persists when toggled back on', () => {
    airStore.setOverlay('aara', false)
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)

    control.handleClickPublic()

    expect(control.visible).toBe(true)
    LAYER_IDS.forEach((id) =>
      expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'visible'),
    )
    markerRegistry.instances.forEach((marker) => expect(marker.addTo).toHaveBeenCalled())
    expect(airStore.overlayStates.aara).toBe(true)
  })

  it('skips absent layers when toggling', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)
    map.layers.clear() // layers vanished from the style
    map.setLayoutProperty.mockClear()

    control.handleClickPublic()
    expect(map.setLayoutProperty).not.toHaveBeenCalled()
  })

  it('persists the toggle while initialisation is still deferred (no markers yet)', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap({ styleLoaded: false }) // initLayers deferred → no markers
    control.onAdd(map.map)

    // map is set but layers/markers are not built yet — toggle must still persist.
    expect(() => control.handleClickPublic()).not.toThrow()
    expect(control.visible).toBe(false)
    expect(airStore.overlayStates.aara).toBe(false)
  })
})

describe('AaraToggleControl._updateLabelRotations', () => {
  it('reprojects each label and writes a rotate transform', () => {
    const control = new AaraToggleControl(airStore)
    control.onAdd(fakeMap().map)

    control._updateLabelRotations()
    markerRegistry.instances.forEach((marker) => {
      const label = marker.options.element.querySelector('div')!
      expect(label.style.transform).toMatch(/^rotate\(-?\d+(\.\d+)?deg\)$/)
    })
  })

  it('normalises a near-vertical edge angle into the readable range', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)
    // Force a single label with an edge whose projected angle is < -90°, so the
    // +180 normalisation branch runs.
    const label = document.createElement('div')
    ;(control as unknown as { _labelEls: HTMLElement[] })._labelEls = [label]
    ;(control as unknown as { _labelEdges: [number, number][][] })._labelEdges = [
      [
        [0, 0],
        [-1, -1],
      ],
    ]
    control._updateLabelRotations()
    // atan2(-1,-1) = -135° → +180 → 45°.
    expect(label.style.transform).toBe('rotate(45deg)')
  })

  it('is a no-op when there are no labels yet', () => {
    const control = new AaraToggleControl(airStore)
    expect(() => control._updateLabelRotations()).not.toThrow()
  })
})

describe('AaraToggleControl label rotation follows the camera', () => {
  // Projections that ignore the zones' real geometry, so the expected angle is
  // fixed by the camera alone: any label still carrying its flat lng/lat angle
  // (the 3D-pitch bug) fails these outright.
  const flattenToOneScreenRow = (coords: [number, number]) => ({ x: coords[0], y: 0 })
  const collapseToOneScreenColumn = (coords: [number, number]) => ({ x: 0, y: coords[1] })

  function labelTransforms(): string[] {
    return markerRegistry.instances.map(
      (marker) => marker.options.element.querySelector('div')!.style.transform,
    )
  }

  // A label's on-screen orientation is its rotation modulo 180° — the control
  // emits whichever of the two equivalent values keeps the text reading
  // left-to-right (e.g. an east→west edge comes out as 360°, not 0°).
  function labelOrientations(): number[] {
    return labelTransforms().map((transform) => {
      const degrees = Number(/^rotate\((-?[\d.]+)deg\)$/.exec(transform)![1])
      return ((degrees % 180) + 180) % 180
    })
  }

  it('rotates labels to the projected edge angle as soon as they are built', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    // Camera is set up before onAdd, so this covers the initial rotation pass.
    map.project.mockImplementation(collapseToOneScreenColumn)

    control.onAdd(map.map)

    // Every edge projects vertically, whatever the zone's real lng/lat bearing.
    expect(labelOrientations()).toEqual(Array(ZONE_COUNT).fill(90))
  })

  it('re-rotates labels when the camera moves (pitch/bearing change)', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)
    expect(map.on).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.moveHandlers).toHaveLength(1)

    map.project.mockImplementation(flattenToOneScreenRow)
    map.moveHandlers[0]!()

    expect(labelOrientations()).toEqual(Array(ZONE_COUNT).fill(0))
  })

  it('re-rotates labels that were re-shown after the camera moved while hidden', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)

    control.handleClickPublic() // hide
    // Camera moves while the labels are detached; no move handler is fired, so
    // only the toggle-on path can bring the rotations back in line.
    map.project.mockImplementation(flattenToOneScreenRow)
    control.handleClickPublic() // show

    expect(labelOrientations()).toEqual(Array(ZONE_COUNT).fill(0))
  })

  it('leaves the rotations untouched when the labels are hidden', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)
    const beforeHiding = labelTransforms()

    map.project.mockImplementation(flattenToOneScreenRow)
    control.handleClickPublic() // hide — must not run a rotation pass

    expect(labelTransforms()).toEqual(beforeHiding)
  })
})

describe('AaraToggleControl.onRemove', () => {
  it('removes every label marker and detaches the container', () => {
    const control = new AaraToggleControl(airStore)
    const element = control.onAdd(fakeMap().map)
    document.body.appendChild(element)

    control.onRemove()
    markerRegistry.instances.forEach((marker) => expect(marker.remove).toHaveBeenCalled())
    expect(element.parentNode).toBeNull()
  })

  it('detaches the camera-move listener so the removed control stops reprojecting', () => {
    const control = new AaraToggleControl(airStore)
    const map = fakeMap()
    control.onAdd(map.map)

    control.onRemove()

    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function))
    expect(map.moveHandlers).toHaveLength(0)
  })

  it('is a safe no-op when removed before any markers were built', () => {
    const control = new AaraToggleControl(airStore)
    expect(() => control.onRemove()).not.toThrow()
  })
})
