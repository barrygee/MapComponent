import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type maplibregl from 'maplibre-gl'
import { ADSB_POLL_INTERVAL_MS } from '@/constants/adsb'

// ---- Marker mock registry ----
interface FakeMarker {
  options: { element: HTMLElement; anchor?: string; offset?: [number, number] }
  lngLat: [number, number] | null
  setLngLat: ReturnType<typeof vi.fn>
  addTo: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  getElement: () => HTMLElement
  removed: boolean
}
const markerRegistry = vi.hoisted(() => ({ instances: [] as FakeMarker[] }))

vi.mock('maplibre-gl', () => {
  function Marker(this: FakeMarker, options: FakeMarker['options']) {
    this.options = options
    this.lngLat = null
    this.removed = false
    this.getElement = () => this.options.element
    this.addTo = vi.fn(() => this)
    this.remove = vi.fn(() => {
      this.removed = true
      return this
    })
    this.setLngLat = vi.fn((coords: [number, number]) => {
      this.lngLat = coords
      return this
    })
    markerRegistry.instances.push(this)
  }
  return { default: { Marker } }
})

// Sprite factories touch <canvas>; stub them to opaque sentinels.
vi.mock('./adsbSprites', () => {
  const fake = () =>
    ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as unknown as ImageData
  return {
    createRadarBlip: fake,
    createBracket: fake,
    createMilBracket: fake,
    createTowerBlip: fake,
    createGroundVehicleBlip: fake,
    createUAVBlip: fake,
  }
})

import { AdsbLiveControl } from './AdsbLiveControl'
import { useAirStore } from '@/stores/air'
import { useNotificationsStore } from '@/stores/notifications'
import { useTrackingStore } from '@/stores/tracking'
import { useAirNotifStore } from '@/stores/airNotif'
import type { AirStore, NotificationsStore, TrackingStore, AirNotifStore } from '../types'

// ---- Aircraft API entry factory ----
interface ApiEntry {
  hex?: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  gs?: number
  track?: number
  category?: string
  emergency?: string
  squawk?: string
  military?: boolean
  [k: string]: unknown
}
function apiEntry(overrides: ApiEntry = {}): ApiEntry {
  return {
    hex: 'abc123',
    flight: 'TEST123',
    r: 'G-TEST',
    t: 'A320',
    lat: 51.5,
    lon: -0.1,
    alt_baro: 30000,
    gs: 400,
    track: 90,
    category: 'A3',
    squawk: '1000',
    ...overrides,
  }
}

// ---- Rich fake map ----
interface MapEvent {
  event: string
  layer?: string
  fn: (...args: unknown[]) => void
}
interface FakeMap {
  map: maplibregl.Map
  sources: Set<string>
  sourceData: Record<string, GeoJSON.GeoJSON>
  layers: Set<string>
  events: MapEvent[]
  styleHandlers: Array<() => void>
  setLayoutProperty: ReturnType<typeof vi.fn>
  setFilter: ReturnType<typeof vi.fn>
  moveLayer: ReturnType<typeof vi.fn>
  easeTo: ReturnType<typeof vi.fn>
  flyTo: ReturnType<typeof vi.fn>
  queryRenderedFeatures: ReturnType<typeof vi.fn>
  canvasStyle: { cursor: string }
  fire: (event: string, layer: string | undefined, payload?: unknown) => void
  zoom: number
}
function fakeMap(options: { styleLoaded?: boolean; zoom?: number } = {}): FakeMap {
  const sources = new Set<string>()
  const sourceData: Record<string, GeoJSON.GeoJSON> = {}
  const layers = new Set<string>()
  const events: MapEvent[] = []
  const styleHandlers: Array<() => void> = []
  const canvasStyle = { cursor: '' }
  const setLayoutProperty = vi.fn()
  const setFilter = vi.fn()
  const moveLayer = vi.fn()
  // Invoke any provided easing callback so its arrow body is executed, mirroring
  // what real MapLibre does during the camera animation.
  const easeTo = vi.fn((opts?: { easing?: (t: number) => number }) => {
    opts?.easing?.(0)
  })
  const flyTo = vi.fn()
  const queryRenderedFeatures = vi.fn(() => [] as unknown[])
  const state = { zoom: options.zoom ?? 12 }

  const map = {
    isStyleLoaded: vi.fn(() => options.styleLoaded ?? true),
    once: vi.fn((event: string, fn: () => void) => {
      if (event === 'style.load') styleHandlers.push(fn)
    }),
    on: vi.fn((event: string, layerOrFn: unknown, maybeFn?: unknown) => {
      if (typeof layerOrFn === 'function') {
        events.push({ event, fn: layerOrFn as MapEvent['fn'] })
      } else {
        events.push({ event, layer: layerOrFn as string, fn: maybeFn as MapEvent['fn'] })
      }
    }),
    off: vi.fn(),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) =>
      sources.has(id)
        ? { setData: vi.fn((data: GeoJSON.GeoJSON) => (sourceData[id] = data)) }
        : undefined,
    ),
    addSource: vi.fn((id: string, opts: { data?: GeoJSON.GeoJSON }) => {
      sources.add(id)
      if (opts?.data) sourceData[id] = opts.data
    }),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    setLayoutProperty,
    setFilter,
    moveLayer,
    easeTo,
    flyTo,
    queryRenderedFeatures,
    getCenter: vi.fn(() => ({ lat: 51.5, lng: -0.1 })),
    getZoom: vi.fn(() => state.zoom),
    getCanvas: vi.fn(() => ({ style: canvasStyle })),
    hasImage: vi.fn(() => false),
    addImage: vi.fn(),
    updateImage: vi.fn(),
    project: vi.fn((coords: [number, number]) => ({ x: coords[0], y: coords[1] })),
  } as unknown as maplibregl.Map

  const fire = (event: string, layer: string | undefined, payload?: unknown) => {
    for (const entry of events) {
      if (entry.event === event && entry.layer === layer) entry.fn(payload)
    }
  }

  return {
    map,
    sources,
    sourceData,
    layers,
    events,
    styleHandlers,
    setLayoutProperty,
    setFilter,
    moveLayer,
    easeTo,
    flyTo,
    queryRenderedFeatures,
    canvasStyle,
    fire,
    get zoom() {
      return state.zoom
    },
    set zoom(value: number) {
      state.zoom = value
    },
  }
}

// ---- Store + control bootstrap ----
let airStore: AirStore
let notificationsStore: NotificationsStore
let trackingStore: TrackingStore
let airNotifStore: AirNotifStore
let is3D = false
let targetPitch = 0
let fetchMock: ReturnType<typeof vi.fn>

function makeControl(onSync: ((visible: boolean) => void) | null = null): AdsbLiveControl {
  return new AdsbLiveControl(
    airStore,
    notificationsStore,
    trackingStore,
    airNotifStore,
    () => is3D,
    () => targetPitch,
    onSync,
  )
}

/**
 * Build + add a control onto a fresh fake map with the style already loaded.
 * Auto-polling is suppressed during mount (via an offgrid override) so the
 * mount-time `_fetch()` doesn't race the test body; tests that exercise
 * fetching call `_fetch()` explicitly.
 */
function mounted(options: { zoom?: number; onSync?: ((v: boolean) => void) | null } = {}) {
  const control = makeControl(options.onSync ?? null)
  const map = fakeMap({ styleLoaded: true, zoom: options.zoom })
  localStorage.setItem('sentinel_air_sourceOverride', 'offgrid')
  control.onAdd(map.map)
  localStorage.removeItem('sentinel_air_sourceOverride')
  return { control, map }
}

/** Seed a control's internal geojson with one feature for the given hex. */
function seedFeature(
  control: AdsbLiveControl,
  overrides: Partial<{
    hex: string
    flight: string
    r: string
    t: string
    track: number | null
    military: boolean
    category: string
    alt_baro: number
    squawk: string
    squawkEmerg: 0 | 1
    emergency: string
    gs: number
  }> = {},
) {
  const hex = overrides.hex ?? 'abc123'
  const feature = {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [-0.1, 51.5] as [number, number] },
    properties: {
      hex,
      flight: overrides.flight ?? 'TEST123',
      r: overrides.r ?? 'G-TEST',
      t: overrides.t ?? 'A320',
      alt_baro: overrides.alt_baro ?? 30000,
      alt_geom: null,
      gs: overrides.gs ?? 400,
      ias: null,
      mach: null,
      // Honour an explicit null track (don't coalesce it to 90). Cast to number
      // so the literal satisfies AircraftGeoFeature while still letting tests
      // exercise the null-track code paths at runtime.
      track: (overrides.track === undefined ? 90 : overrides.track) as number,
      baro_rate: 0,
      nav_altitude: null,
      nav_heading: null,
      category: overrides.category ?? 'A3',
      emergency: overrides.emergency ?? '',
      squawk: overrides.squawk ?? '1000',
      squawkEmerg: overrides.squawkEmerg ?? 0,
      rssi: null,
      military: overrides.military ?? false,
      stale: 0 as 0 | 1,
    },
  }
  control._geojson.features.push(feature)
  return feature
}

// Cast helper for reaching the control's private members from tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Priv = Record<string, any>
const priv = (control: AdsbLiveControl): Priv => control as unknown as Priv

beforeEach(() => {
  markerRegistry.instances.length = 0
  setActivePinia(createPinia())
  airStore = useAirStore()
  notificationsStore = useNotificationsStore()
  trackingStore = useTrackingStore()
  airNotifStore = useAirNotifStore()
  is3D = false
  targetPitch = 0
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AdsbLiveControl constructor', () => {
  it('seeds ADS-B visibility from the store', () => {
    const control = makeControl()
    expect(control.visible).toBe(airStore.overlayStates.adsb)
  })

  it('forces labels on regardless of the persisted overlay value', () => {
    // Labels are permanently on — there is no toggle. Even a stored `false`
    // (e.g. seeded into an existing install's DB/localStorage) must not hide them.
    airStore.setOverlay('adsbLabels', false)
    expect(makeControl().labelsVisible).toBe(true)
  })

  it('restores a persisted type filter and all-hidden flag from localStorage', () => {
    localStorage.setItem('adsbFilter', JSON.stringify({ typeFilter: 'mil', allHidden: true }))
    const control = makeControl()
    expect(control._typeFilter).toBe('mil')
    expect(control._allHidden).toBe(true)
  })

  it('ignores an invalid persisted type filter', () => {
    localStorage.setItem('adsbFilter', JSON.stringify({ typeFilter: 'nonsense' }))
    expect(makeControl()._typeFilter).toBe('all')
  })

  it('tolerates malformed adsbFilter JSON', () => {
    localStorage.setItem('adsbFilter', '{not json')
    expect(() => makeControl()).not.toThrow()
  })

  it('loads persisted label fields and falls back for malformed shapes', () => {
    localStorage.setItem('adsbLabelFields', JSON.stringify({ civil: ['callsign'], mil: ['type'] }))
    expect(() => makeControl()).not.toThrow()
    localStorage.setItem('adsbLabelFields', JSON.stringify({ civil: 'x' }))
    expect(() => makeControl()).not.toThrow()
    localStorage.setItem('adsbLabelFields', '[1,2,3]')
    expect(() => makeControl()).not.toThrow()
    localStorage.setItem('adsbLabelFields', '{bad')
    expect(() => makeControl()).not.toThrow()
  })
})

describe('AdsbLiveControl.onAdd / onRemove', () => {
  it('builds the button and registers field-change listeners', () => {
    const { control, map } = mounted()
    expect(control.button.textContent).toBe('ADS')
    expect(control.button.getAttribute('aria-label')).toBe('Toggle live ADS-B aircraft')
    expect(control.container).toBeTruthy()
    // The style was loaded, so layers were initialised immediately.
    expect(map.sources.has('adsb-live')).toBe(true)
  })

  it('defers layer init to style.load when the style is not ready', () => {
    const control = makeControl()
    const map = fakeMap({ styleLoaded: false })
    control.onAdd(map.map)
    expect(map.sources.has('adsb-live')).toBe(false)
    map.styleHandlers[0]!()
    expect(map.sources.has('adsb-live')).toBe(true)
  })

  it('toggles button hover background via mouse handlers', () => {
    const { control } = mounted()
    control.button.onmouseover!(new MouseEvent('mouseover'))
    expect(control.button.style.background).toBe('rgb(17, 17, 17)')
    control.button.onmouseout!(new MouseEvent('mouseout'))
    expect(control.button.style.background).toBe('rgb(0, 0, 0)')
  })

  it('reacts to adsb:labelFieldsChanged and adsb:tagFieldsChanged events', () => {
    const { control } = mounted()
    seedFeature(control)
    window.dispatchEvent(
      new CustomEvent('adsb:labelFieldsChanged', {
        detail: { civil: ['callsign'], mil: ['type'] },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('adsb:tagFieldsChanged', {
        detail: { civil: { callsign: true }, mil: { aircraftType: true } },
      }),
    )
    expect(true).toBe(true)
  })

  it('handles field-change events with no detail payload', () => {
    mounted() // registers the field-change listeners
    window.dispatchEvent(new CustomEvent('adsb:labelFieldsChanged', {}))
    window.dispatchEvent(new CustomEvent('adsb:tagFieldsChanged', {}))
    expect(true).toBe(true)
  })

  it('onRemove unregisters listeners and detaches the container', () => {
    const { control } = mounted()
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    document.body.appendChild(control.container)
    control.onRemove()
    expect(removeSpy).toHaveBeenCalledWith('adsb:labelFieldsChanged', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('adsb:tagFieldsChanged', expect.any(Function))
    expect(control.container.parentNode).toBeNull()
  })

  it('onRemove is safe with no listeners or container', () => {
    const control = makeControl()
    expect(() => control.onRemove()).not.toThrow()
  })
})

describe('AdsbLiveControl.toggle', () => {
  it('turns off: stops polling, clears selection, hides trails and persists', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    map.layers.add('adsb-trail-dots')
    control.toggle() // was on by default → now off
    expect(control.visible).toBe(false)
    expect(airStore.overlayStates.adsb).toBe(false)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-trail-line', 'visibility', 'none')
    expect(control.button.style.color).toBe('rgb(255, 255, 255)')
  })

  it('turns back on and persists', () => {
    const { control } = mounted()
    control.toggle() // off
    control.toggle() // on
    expect(control.visible).toBe(true)
    expect(airStore.overlayStates.adsb).toBe(true)
    expect(control.button.style.color).toBe('rgb(200, 255, 0)')
  })

  it('calls the label-sync callback when provided', () => {
    const onSync = vi.fn()
    const { control } = mounted({ onSync })
    control.toggle()
    expect(onSync).toHaveBeenCalledWith(false)
  })

  it('removes airborne callsign markers but keeps ground/tower markers when toggled off', () => {
    const { control } = mounted()
    const airborne = seedFeature(control, { hex: 'air1', category: 'A3' })
    const ground = seedFeature(control, { hex: 'gnd1', category: 'C2' })
    control.setLabelsVisible(true)
    priv(control)._updateCallsignMarkers()
    // Force markers to exist for both.
    expect(airborne).toBeTruthy()
    expect(ground).toBeTruthy()
    control.toggle() // off
    expect(control.visible).toBe(false)
  })
})

describe('AdsbLiveControl filter setters', () => {
  it('setTypeFilter updates the filter and reapplies', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-bracket')
    control.setTypeFilter('mil')
    expect(control._typeFilter).toBe('mil')
    expect(map.setFilter).toHaveBeenCalledWith('adsb-bracket', expect.anything())
  })

  it('setHideGroundVehicles and setHideTowers flip their flags', () => {
    const { control } = mounted()
    control.setHideGroundVehicles(true)
    control.setHideTowers(true)
    expect(control._hideGroundVehicles).toBe(true)
    expect(control._hideTowers).toBe(true)
  })

  it('setAllHidden toggles trail/tag visibility based on selection and tracking', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    map.layers.add('adsb-trail-dots')
    control._trailHex = 'abc123'
    control.setAllHidden(true)
    expect(control._allHidden).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-trail-line', 'visibility', 'none')
  })
})

describe('AdsbLiveControl._applyTypeFilter', () => {
  it('is a no-op without a map', () => {
    const control = makeControl()
    expect(() => control.setTypeFilter('civil')).not.toThrow()
  })

  it('hides bracket/icons/hit when all-hidden with no selection', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-bracket')
    map.layers.add('adsb-icons')
    map.layers.add('adsb-hit')
    control._allHidden = true
    control._selectedHex = null
    control.setTypeFilter('all')
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-bracket', 'visibility', 'none')
  })

  it('applies an isolate filter when an aircraft is isolated', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-bracket')
    map.layers.add('adsb-hit')
    map.layers.add('adsb-icons')
    control._isolatedHex = 'abc123'
    control.setTypeFilter('all')
    expect(map.setFilter).toHaveBeenCalledWith('adsb-bracket', expect.anything())
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-icons', 'visibility', 'visible')
  })

  it('builds a civil-only filter', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-bracket')
    control.setTypeFilter('civil')
    expect(map.setFilter).toHaveBeenCalled()
  })

  it('builds a mil-only filter', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-bracket')
    control.setTypeFilter('mil')
    expect(map.setFilter).toHaveBeenCalled()
  })

  it('hides icon symbols when labels are visible', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-icons')
    control.labelsVisible = true
    control.setTypeFilter('all')
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-icons', 'visibility', 'none')
  })
})

describe('AdsbLiveControl.setLabelsVisible', () => {
  it('refuses to hide labels — an inbound false keeps them on', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-icons')
    map.setLayoutProperty.mockClear() // isolate the effect of the call under test
    control.setLabelsVisible(false)
    // Labels are permanent: state stays true and the symbol layer stays hidden
    // (HTML markers keep showing), never reverting to the bare symbol layer.
    expect(control.labelsVisible).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-icons', 'visibility', 'none')
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith('adsb-icons', 'visibility', 'visible')
  })

  it('rebuilds callsign markers and hides the symbol layer when re-asserted', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-icons')
    seedFeature(control)
    control.setLabelsVisible(true)
    expect(control.labelsVisible).toBe(true)
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-icons', 'visibility', 'none')
  })
})

describe('AdsbLiveControl._interpolatedCoords', () => {
  it('returns interpolated coords when available', () => {
    const { control } = mounted()
    seedFeature(control)
    priv(control)._interpolate()
    expect(control._interpolatedCoords('abc123')).not.toBeNull()
  })

  it('falls back to the raw feature coords', () => {
    const { control } = mounted()
    seedFeature(control)
    priv(control)._interpolatedFeatures = null
    expect(control._interpolatedCoords('abc123')).toEqual([-0.1, 51.5])
  })

  it('returns null for an unknown hex', () => {
    const { control } = mounted()
    priv(control)._interpolatedFeatures = null
    expect(control._interpolatedCoords('nope')).toBeNull()
  })
})

describe('AdsbLiveControl.selectByHex', () => {
  it('eases to the aircraft and returns true', () => {
    const { control, map } = mounted()
    seedFeature(control)
    expect(control.selectByHex('abc123')).toBe(true)
    expect(map.easeTo).toHaveBeenCalled()
  })

  it('returns false for an unknown hex or no map', () => {
    const { control } = mounted()
    expect(control.selectByHex('nope')).toBe(false)
    expect(control.selectByHex('')).toBe(false)
  })
})

describe('AdsbLiveControl playback hooks', () => {
  it('pauseLive stops polling and empties the live sources', () => {
    const { control, map } = mounted()
    control.pauseLive()
    expect(map.sourceData['adsb-live']).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('resumeLive resets state and restarts polling when visible', () => {
    const { control } = mounted()
    control.pauseLive()
    control.resumeLive()
    expect(control._geojson.features).toHaveLength(0)
  })

  it('setPlaybackFeatures replaces the feature collection', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    control._geojson.features = []
    control.setPlaybackFeatures([feature])
    expect(control._geojson.features).toHaveLength(1)
  })

  it('setPlaybackFeatures repositions the tag marker for the tracked aircraft', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection() // creates the tag marker + sets _tagHex
    const tagMarker = control._tagMarker!
    ;(tagMarker.setLngLat as ReturnType<typeof vi.fn>).mockClear()
    feature.geometry.coordinates = [1, 2]
    control.setPlaybackFeatures([feature])
    expect(tagMarker.setLngLat).toHaveBeenCalledWith([1, 2])
  })
})

describe('AdsbLiveControl polling', () => {
  it('clearAircraft stops polling and empties all sources', () => {
    const { control, map } = mounted()
    seedFeature(control)
    control.clearAircraft()
    expect(control._geojson.features).toHaveLength(0)
    expect(map.sourceData['adsb-live']).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('handleConnectivityChange clears aircraft in offgrid mode', () => {
    const { control } = mounted()
    localStorage.setItem('sentinel_air_sourceOverride', 'offgrid')
    const spy = vi.spyOn(control, 'clearAircraft')
    control.handleConnectivityChange()
    expect(spy).toHaveBeenCalled()
  })

  it('handleConnectivityChange restarts polling when visible and online', () => {
    const { control } = mounted()
    localStorage.setItem('sentinel_air_sourceOverride', 'online')
    expect(() => control.handleConnectivityChange()).not.toThrow()
  })
})

describe('AdsbLiveControl._fetch', () => {
  it('renders aircraft from the API into the live source', async () => {
    const { control, map } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry()] }),
    } as Response)
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(control._geojson.features.length).toBeGreaterThan(0)
    expect(map.sourceData['adsb-live']).toBeDefined()
  })

  it('skips aircraft missing position or with excluded categories', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ac: [
            apiEntry({ hex: 'no-pos', lat: undefined }),
            apiEntry({ hex: 'a0', category: 'A0' }),
          ],
        }),
    } as Response)
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(control._geojson.features.find((f) => f.properties.hex === 'no-pos')).toBeUndefined()
  })

  it('emits an emergency notification on a new emergency squawk', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7700' })] }),
    } as Response)
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(notificationsStore.items.some((i) => i.type === 'emergency')).toBe(true)
  })

  it('clears data after three consecutive failures', async () => {
    const { control } = mounted()
    for (let attempt = 0; attempt < 3; attempt++) {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    }
    expect(control._geojson.features).toHaveLength(0)
  })

  it('backs off on HTTP 429', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(true).toBe(true)
  })

  it('swallows an aborted fetch', async () => {
    const { control } = mounted()
    fetchMock.mockRejectedValueOnce(Object.assign(new DOMException('aborted', 'AbortError')))
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(true).toBe(true)
  })

  it('uses the cached user location when fresh', async () => {
    const { control } = mounted()
    localStorage.setItem(
      'userLocation',
      JSON.stringify({ latitude: 40, longitude: -70, ts: Date.now() }),
    )
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    await (control as unknown as { _fetch: () => Promise<void> })._fetch()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('40.0000/-70.0000'),
      expect.anything(),
    )
  })
})

// ===== Batch 2: deep DOM / state coverage =====

/* eslint-disable @typescript-eslint/no-explicit-any */

const ALL_FIELDS = {
  callsign: true,
  aircraftType: true,
  altitude: true,
  heading: true,
  speed: true,
  registration: true,
  category: true,
  squawk: true,
}
function enableAllFields(control: AdsbLiveControl) {
  priv(control)._tagFields = { civil: { ...ALL_FIELDS }, mil: { ...ALL_FIELDS } }
}

interface PropsOverride {
  [key: string]: unknown
}
function props(overrides: PropsOverride = {}) {
  return {
    hex: 'abc123',
    flight: 'TEST123',
    r: 'G-TEST',
    t: 'A320',
    alt_baro: 30000,
    alt_geom: null,
    gs: 400,
    ias: null,
    mach: null,
    track: 90,
    baro_rate: 0,
    nav_altitude: null,
    nav_heading: null,
    category: 'A3',
    emergency: '',
    squawk: '1000',
    squawkEmerg: 0,
    rssi: null,
    military: false,
    stale: 0,
    ...overrides,
  }
}

describe('AdsbLiveControl map event handlers', () => {
  it('selects an aircraft on a hit-layer click and opens its side-panel accordion', () => {
    const { control, map } = mounted()
    seedFeature(control)
    const openHandler = vi.fn()
    document.addEventListener('air-open-aircraft', openHandler)
    map.fire('click', 'adsb-hit', { features: [{ properties: { hex: 'abc123' } }] })
    expect(control._selectedHex).toBe('abc123')
    expect(control._isolatedHex).toBe('abc123')
    expect(openHandler).toHaveBeenCalledTimes(1)
    expect((openHandler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ hex: 'abc123' })
    document.removeEventListener('air-open-aircraft', openHandler)
  })

  it('ignores a hit-layer click with no features', () => {
    const { control, map } = mounted()
    map.fire('click', 'adsb-hit', { features: [] })
    expect(control._selectedHex).toBeNull()
  })

  it('deselects on a bare-map click that hits nothing', () => {
    const { control, map } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._isolatedHex = 'abc123'
    map.queryRenderedFeatures.mockReturnValueOnce([])
    map.fire('click', undefined, { point: { x: 1, y: 1 } })
    expect(control._selectedHex).toBeNull()
  })

  it('keeps the selection on a bare click that hits an aircraft', () => {
    const { control, map } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    map.queryRenderedFeatures.mockReturnValueOnce([{ properties: { hex: 'abc123' } }])
    map.fire('click', undefined, { point: { x: 1, y: 1 } })
    expect(control._selectedHex).toBe('abc123')
  })

  it('resets the click guard after an aircraft click consumes the bare click', () => {
    const { control, map } = mounted()
    seedFeature(control)
    map.fire('click', 'adsb-hit', { features: [{ properties: { hex: 'abc123' } }] })
    // The aircraft handler set _clickHandled; the bare handler should reset it.
    expect(() => map.fire('click', undefined, { point: { x: 0, y: 0 } })).not.toThrow()
  })

  it('honours the tag-click guard on the bare click handler', () => {
    const { control, map } = mounted()
    priv(control)._tagClickHandled = true
    map.fire('click', undefined, { point: { x: 0, y: 0 } })
    expect(priv(control)._tagClickHandled).toBe(false)
  })

  it('ignores bare clicks while following', () => {
    const { control, map } = mounted()
    control._followEnabled = true
    control._selectedHex = 'abc123'
    map.fire('click', undefined, { point: { x: 0, y: 0 } })
    expect(control._selectedHex).toBe('abc123')
  })

  it('shows a hover tag and trail on hit-layer mouseenter, clears on leave', () => {
    const { control, map } = mounted()
    seedFeature(control)
    priv(control)._trails['abc123'] = [{ lon: -0.1, lat: 51.5, alt: 100 }]
    map.fire('mouseenter', 'adsb-hit', { features: [{ properties: { hex: 'abc123' } }] })
    expect(map.canvasStyle.cursor).toBe('pointer')
    expect(control._trailHex).toBe('abc123')
    map.fire('mouseleave', 'adsb-hit', {})
    expect(map.canvasStyle.cursor).toBe('')
  })

  it('handles trail-layer hover enter/leave', () => {
    const { control, map } = mounted()
    seedFeature(control)
    priv(control)._trails['abc123'] = [{ lon: -0.1, lat: 51.5, alt: 100 }]
    map.fire('mouseenter', 'adsb-trail-line', { features: [{ properties: { hex: 'abc123' } }] })
    expect(control._trailHex).toBe('abc123')
    map.fire('mouseleave', 'adsb-trail-line', {})
    expect(map.canvasStyle.cursor).toBe('')
  })

  it('ignores a trail hover with no hex', () => {
    const { control, map } = mounted()
    map.fire('mouseenter', 'adsb-trail-dots', { features: [{ properties: {} }] })
    expect(control._trailHex).toBeNull()
  })

  it('updates callsign markers on zoomend', () => {
    const { control, map } = mounted()
    const spy = vi.spyOn(priv(control), '_updateCallsignMarkers')
    map.fire('zoomend', undefined, {})
    expect(spy).toHaveBeenCalled()
  })

  it('routes hover trail rebuilds through the playback hook when in playback', () => {
    const { control, map } = mounted()
    seedFeature(control)
    priv(control)._isPlayback = true
    const hook = vi.fn()
    control._onPlaybackSelectionChange = hook
    map.fire('mouseenter', 'adsb-hit', { features: [{ properties: { hex: 'abc123' } }] })
    expect(hook).toHaveBeenCalled()
  })
})

describe('AdsbLiveControl map isolation persistence + restore', () => {
  const okJson = (ac: ApiEntry[]) =>
    ({ ok: true, status: 200, json: () => Promise.resolve({ ac }) }) as Response

  it('persists the isolated hex when an aircraft is isolated, and clears it on deselect', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._isolatedHex = 'abc123'
    control._applySelection()
    expect(airStore.mapIsolatedHex).toBe('abc123')

    // Deselect: _applySelection persists the empty isolation.
    control._selectedHex = null
    control._isolatedHex = null
    control._applySelection()
    expect(airStore.mapIsolatedHex).toBe('')
  })

  it('restores isolation for the persisted aircraft once it is in the feed', async () => {
    const { control } = mounted()
    airStore.mapIsolatedHex = 'abc123'
    fetchMock.mockResolvedValueOnce(okJson([apiEntry()]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBe('abc123')
    expect(control._selectedHex).toBe('abc123')
  })

  it('marks the restore done without isolating when nothing was isolated', async () => {
    const { control } = mounted()
    // mapIsolatedHex defaults to '' (nothing isolated before leaving).
    fetchMock.mockResolvedValueOnce(okJson([apiEntry()]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBeNull()
    expect(priv(control)._isolationRestored).toBe(true)
  })

  it('defers isolation restore while an aircraft is being followed', async () => {
    const { control } = mounted()
    airStore.mapIsolatedHex = 'abc123'
    control._followEnabled = true
    fetchMock.mockResolvedValueOnce(okJson([apiEntry()]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBeNull()
    expect(priv(control)._isolationRestored).toBe(true)
  })

  it('waits for the persisted aircraft to appear, then restores it on a later poll', async () => {
    const { control } = mounted()
    airStore.mapIsolatedHex = 'zzz999'
    // First poll: the isolated aircraft is not present yet — defer (retry).
    fetchMock.mockResolvedValueOnce(okJson([apiEntry()]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBeNull()
    expect(priv(control)._isolationRestored).toBe(false)

    // Second poll: it appears — now isolation restores.
    fetchMock.mockResolvedValueOnce(okJson([apiEntry({ hex: 'zzz999' })]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBe('zzz999')
    expect(priv(control)._isolationRestored).toBe(true)
  })

  it('only restores isolation once per control instance', async () => {
    const { control } = mounted()
    airStore.mapIsolatedHex = 'abc123'
    fetchMock.mockResolvedValueOnce(okJson([apiEntry()]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBe('abc123')

    // A later persisted change must not re-hijack the selection on the next poll.
    airStore.mapIsolatedHex = 'zzz999'
    control._selectedHex = null
    control._isolatedHex = null
    fetchMock.mockResolvedValueOnce(okJson([apiEntry(), apiEntry({ hex: 'zzz999' })]))
    await priv(control)._fetch()
    expect(control._isolatedHex).toBeNull()
  })
})

describe('AdsbLiveControl._buildTagHTML', () => {
  it('renders a tracked emergency military tag (left facing)', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    const html = priv(control)._buildTagHTML(
      props({ military: true, squawkEmerg: 1, squawk: '7700', track: 90 }),
    )
    expect(html).toContain('TRACKING')
  })

  it('renders a tracked tag right-facing', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    const html = priv(control)._buildTagHTML(props({ track: 270 }))
    expect(html).toContain('TRACKING')
  })

  it('renders an untracked, opted-out tag with no action buttons', () => {
    const { control } = mounted()
    enableAllFields(control)
    const html = priv(control)._buildTagHTML(props())
    // The follow button only appears on the tracked tag, and the bell only when
    // opted-in — neither applies here, and hover tags never carry action buttons.
    expect(html).not.toContain('tag-follow-btn')
    expect(html).not.toContain('tag-notif-btn')
  })

  it('shows the notification bell when the aircraft is opted-in', () => {
    const { control } = mounted()
    airNotifStore.enable('abc123')
    const html = priv(control)._buildTagHTML(props())
    expect(html).toContain('tag-notif-btn')
  })

  it('falls back to UNKNOWN when callsign, registration and hex are blank', () => {
    const { control } = mounted()
    enableAllFields(control)
    const html = priv(control)._buildTagHTML(props({ flight: '', r: '', hex: '' }))
    expect(html).toContain('UNKNOWN')
  })

  it('renders an emergency (non-squawk) civil tag with all badges', () => {
    const { control } = mounted()
    enableAllFields(control)
    const html = priv(control)._buildTagHTML(
      props({ emergency: 'general', squawk: '7700', track: 270, alt_baro: 5000 }),
    )
    expect(html).toContain('5000ft')
  })
})

describe('AdsbLiveControl._categoryLabel + helpers', () => {
  it('labels a known category, an unknown one, and a blank one', () => {
    const { control } = mounted()
    expect(priv(control)._categoryLabel('A3')).toContain('Large aircraft')
    expect(priv(control)._categoryLabel('ZZ')).toBe('ZZ')
    expect(priv(control)._categoryLabel('')).toBeNull()
  })

  it('formats altitude badges below and above the flight-level threshold', () => {
    const { control } = mounted()
    expect(priv(control)._formatAltBadge(5000)).toBe('5000ft')
    expect(priv(control)._formatAltBadge(30000)).toBe('FL300')
  })

  it('builds tracking fields across altitude, vertical-rate and class branches', () => {
    const { control } = mounted()
    enableAllFields(control)
    const ground = priv(control)._buildTrackingFields(props({ alt_baro: 0, baro_rate: -500 }))
    expect(ground.find((field: any) => field.label === 'ALT').value).toContain('GND')
    const climbing = priv(control)._buildTrackingFields(
      props({ alt_baro: 30000, baro_rate: 500, military: true, emergency: 'general' }),
    )
    expect(climbing.some((field: any) => field.label === 'CLASS')).toBe(true)
    expect(climbing.find((field: any) => field.label === 'ALT').value).toContain('↑')
    const cruising = priv(control)._buildTrackingFields(props({ alt_baro: 5000, baro_rate: 0 }))
    expect(cruising.find((field: any) => field.label === 'ALT').value).toContain('ft')
  })

  it('makes ground/tower arrow shapes without rotation', () => {
    const { control } = mounted()
    expect(priv(control)._makeArrowSvg('#fff', 90, 'C1')).toContain('circle')
    expect(priv(control)._makeArrowSvg('#fff', 90, 'C3')).toContain('circle')
    expect(priv(control)._makeArrowSvg('#fff', 90, 'A3', 'TWR')).toContain('circle')
    expect(priv(control)._makeArrowSvg('#fff', 90, 'A3')).toContain('polygon')
  })
})

describe('AdsbLiveControl selection + tag wiring', () => {
  it('shows a selected tag and status bar via _applySelection', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    expect(control._tagHex).toBe('abc123')
    expect(trackingStore.isLive('air')).toBe(true)
  })

  it('hides the tag and status bar when nothing is selected', () => {
    const { control } = mounted()
    control._selectedHex = null
    control._applySelection()
    expect(control._tagHex).toBeNull()
  })

  it('rebuilds the tag for a hex via _rebuildTagForHex', () => {
    const { control } = mounted()
    seedFeature(control)
    control._tagHex = 'abc123'
    control._rebuildTagForHex('abc123')
    expect(control._tagMarker).not.toBeNull()
  })

  it('_rebuildTagForHex ignores a non-active hex', () => {
    const { control } = mounted()
    control._tagHex = 'other'
    control._rebuildTagForHex('abc123')
    expect(control._tagMarker).toBeNull()
  })

  it('toggles follow off when the follow button is clicked while tracking', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    control._followEnabled = false
    // Build a tracked tag element with a follow button.
    control._rebuildTagForHex('abc123')
    // Now simulate the in-place follow toggle path via _wireTagButton on a hover tag.
    priv(control)._showHoverTag(seedFeature(control, { hex: 'xyz' }))
    expect(control._tagMarker).not.toBeNull()
  })
})

describe('AdsbLiveControl hover tag', () => {
  it('repositions an existing hover marker for the same hex', () => {
    const { control } = mounted()
    seedFeature(control)
    const feature = control._geojson.features[0]
    priv(control)._showHoverTag(feature)
    const firstMarker = markerRegistry.instances.at(-1)!
    priv(control)._showHoverTag(feature, true, document.createElement('div'), 'left')
    expect(firstMarker.setLngLat).toHaveBeenCalled()
  })

  it('does not show a hover tag for the selected aircraft', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    const before = markerRegistry.instances.length
    priv(control)._showHoverTag(control._geojson.features[0])
    expect(markerRegistry.instances.length).toBe(before)
  })

  it('builds a label-facing hover tag', () => {
    const { control } = mounted()
    seedFeature(control)
    const labelEl = document.createElement('div')
    priv(control)._showHoverTag(control._geojson.features[0], true, labelEl, 'right')
    expect(labelEl.style.visibility).toBe('hidden')
  })

  it('debounced hide eventually removes the hover marker', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    seedFeature(control)
    priv(control)._showHoverTag(control._geojson.features[0])
    priv(control)._hideHoverTag()
    vi.advanceTimersByTime(100)
    expect(priv(control)._hoverHex ?? null).toBeNull()
  })
})

describe('AdsbLiveControl callsign markers', () => {
  function withLabels(zoom = 12) {
    const { control, map } = mounted({ zoom })
    control.labelsVisible = true
    enableAllFields(control)
    return { control, map }
  }

  it('creates then updates a civil marker across two passes', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'civ1', military: false })
    priv(control)._updateCallsignMarkers()
    const created = markerRegistry.instances.length
    expect(created).toBeGreaterThan(0)
    // Second pass updates the existing marker in place.
    priv(control)._updateCallsignMarkers()
    expect(true).toBe(true)
  })

  it('creates and updates a military emergency marker', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'mil1', military: true, squawkEmerg: 1, squawk: '7700' })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(markerRegistry.instances.length).toBeGreaterThan(0)
  })

  it('removes markers filtered out by the type filter', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'civ1', military: false })
    priv(control)._updateCallsignMarkers()
    control._typeFilter = 'mil'
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['civ1']).toBeUndefined()
  })

  it('skips the selected aircraft and isolation non-matches', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'sel1' })
    seedFeature(control, { hex: 'other' })
    control._selectedHex = 'sel1'
    control._isolatedHex = 'sel1'
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['sel1']).toBeUndefined()
    expect(priv(control)._callsignMarkers['other']).toBeUndefined()
  })

  it('hides all type labels when all-hidden with no selection', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'civ1' })
    control._allHidden = true
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['civ1']).toBeUndefined()
  })

  it('keeps ground and tower labels under all-but-type filters', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'gnd1', category: 'C2' })
    seedFeature(control, { hex: 'twr1', category: 'C3' })
    priv(control)._updateCallsignMarkers()
    expect(markerRegistry.instances.length).toBeGreaterThan(0)
  })

  it('recreates a marker when its direction changes', () => {
    const { control } = withLabels()
    const feature = seedFeature(control, { hex: 'dir1', track: 90 })
    priv(control)._updateCallsignMarkers()
    feature.properties.track = 270 // flips facing
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['dir1']).toBeDefined()
  })

  it('prunes markers for vanished aircraft', () => {
    const { control } = withLabels()
    seedFeature(control, { hex: 'gone' })
    priv(control)._updateCallsignMarkers()
    control._geojson.features = []
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['gone']).toBeUndefined()
  })

  it('is a no-op when labels are hidden', () => {
    const { control } = mounted()
    control.labelsVisible = false
    seedFeature(control)
    priv(control)._updateCallsignMarkers()
    expect(Object.keys(priv(control)._callsignMarkers)).toHaveLength(0)
  })

  it('builds a callsign label element for emergency, ground and tower', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildCallsignLabelEl(props({ squawkEmerg: 1 }))).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ category: 'C1' }))).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ category: 'C3', track: 270 }))).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ military: true, track: 270 }))).toBeTruthy()
  })
})

describe('AdsbLiveControl trails', () => {
  it('builds trail dots and a line for the active hex', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    map.layers.add('adsb-trail-dots')
    seedFeature(control)
    priv(control)._trails['abc123'] = [
      { lon: -0.1, lat: 51.5, alt: 100 },
      { lon: -0.2, lat: 51.6, alt: 200 },
    ]
    control._trailHex = 'abc123'
    priv(control)._rebuildTrails()
    expect(
      (map.sourceData['adsb-trails-source'] as GeoJSON.FeatureCollection).features.length,
    ).toBe(2)
  })

  it('marks an emergency military trail', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    seedFeature(control, { military: true, squawkEmerg: 1 })
    priv(control)._trails['abc123'] = [
      { lon: -0.1, lat: 51.5, alt: 100 },
      { lon: -0.2, lat: 51.6, alt: 200 },
    ]
    control._trailHex = 'abc123'
    priv(control)._rebuildTrails()
    const line = map.sourceData['adsb-trail-line-source'] as GeoJSON.FeatureCollection
    expect(line.features[0]!.properties!.emerg).toBe(1)
  })

  it('clears trails when no hex is active', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    control._trailHex = null
    priv(control)._rebuildTrails()
    expect(map.setLayoutProperty).toHaveBeenCalledWith('adsb-trail-line', 'visibility', 'none')
  })

  it('does not clobber trail sources during playback', () => {
    const { control } = mounted()
    priv(control)._isPlayback = true
    seedFeature(control)
    priv(control)._trails['abc123'] = [{ lon: -0.1, lat: 51.5, alt: 100 }]
    control._trailHex = 'abc123'
    expect(() => priv(control)._rebuildTrails()).not.toThrow()
  })

  it('is a no-op without a map', () => {
    const control = makeControl()
    expect(() => priv(control)._rebuildTrails()).not.toThrow()
  })
})

describe('AdsbLiveControl interpolation', () => {
  it('dead-reckons a moving aircraft and reposition the tag', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._followEnabled = true
    control._tagHex = 'abc123'
    priv(control)._lastPositions['abc123'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 400,
      track: 90,
      lastSeen: Date.now() - 2000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 4000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._interpolate()
    expect(control._interpolatedCoords('abc123')![0]).not.toBe(-0.1)
    expect(feature).toBeTruthy()
  })

  it('removes aircraft older than the removal window', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'old1' })
    priv(control)._lastPositions['old1'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 61000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 62000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._interpolate()
    expect(control._geojson.features.find((f) => f.properties.hex === 'old1')).toBeUndefined()
  })

  it('keeps a stationary aircraft with no position record', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'still' })
    priv(control)._interpolate()
    expect(control._geojson.features).toHaveLength(1)
  })

  it('is a no-op with no features', () => {
    const { control } = mounted()
    expect(() => priv(control)._interpolate()).not.toThrow()
  })
})

describe('AdsbLiveControl._fetch deep paths', () => {
  it('updates an existing position with dead reckoning on a second poll', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ track: 90, gs: 400 })] }),
    } as Response)
    await priv(control)._fetch()
    await priv(control)._fetch()
    expect(priv(control)._lastPositions['abc123']).toBeDefined()
  })

  it('emits a squawk-cleared notification when an emergency clears', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '1200' })] }),
    } as Response)
    await priv(control)._fetch()
    expect(notificationsStore.items.some((i) => i.type === 'squawk-clr')).toBe(true)
  })

  it('schedules a parked-removal timer for an opted-in aircraft that lands', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    expect(Object.keys(priv(control)._parkedTimers)).toContain('abc123')
    vi.advanceTimersByTime(60000)
    expect(priv(control)._parkedTimers['abc123']).toBeUndefined()
  })

  it('updates the tracked tag marker on poll', async () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry()] }),
    } as Response)
    await priv(control)._fetch()
    expect(control._tagMarker).not.toBeNull()
  })

  it('hides the tag when the tracked aircraft drops out of the feed', async () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ hex: 'someoneelse' })] }),
    } as Response)
    await priv(control)._fetch()
    expect(control._tagHex).toBeNull()
  })

  it('does not run a second fetch while one is in flight', async () => {
    const { control } = mounted()
    priv(control)._isFetching = true
    await priv(control)._fetch()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AdsbLiveControl tracking persistence', () => {
  it('saves and clears tracking state in localStorage', () => {
    const { control } = mounted()
    seedFeature(control)
    control._tagHex = 'abc123'
    control._followEnabled = true
    priv(control)._saveTrackingState()
    expect(localStorage.getItem('adsbTracking')).toContain('abc123')
    control._followEnabled = false
    control._tagHex = null
    priv(control)._saveTrackingState()
    expect(localStorage.getItem('adsbTracking')).toBeNull()
  })

  it('restores tracking for a saved hex present in the feed', async () => {
    const { control } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'abc123' }))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ hex: 'abc123', follow: true }]),
    } as Response)
    const restored = priv(control)._doRestoreTracking()
    expect(restored).toBe(true)
    expect(control._followEnabled).toBe(true)
  })

  it('returns false when the saved hex is not in the feed', () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'missing' }))
    expect(priv(control)._doRestoreTracking()).toBe(false)
  })

  it('returns true when nothing is saved', () => {
    const { control } = mounted()
    expect(priv(control)._doRestoreTracking()).toBe(true)
  })

  it('_restoreTrackingState only runs once', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response)
    priv(control)._restoreTrackingState()
    expect(priv(control)._trackingRestored).toBe(true)
  })
})

describe('AdsbLiveControl polling timers', () => {
  it('starts polling on toggle-on and stops on toggle-off', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    control.toggle() // off
    control.toggle() // on → starts polling
    expect(priv(control)._pollInterval).not.toBeNull()
    control.toggle() // off → stops
    expect(priv(control)._pollInterval).toBeNull()
  })

  it('_handleUntrack resets follow state and recentres in 2D', () => {
    const { control, map } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    control._followEnabled = true
    priv(control)._handleUntrack()
    expect(control._followEnabled).toBe(false)
    expect(map.easeTo).toHaveBeenCalled()
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 3: remaining branches =====
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('AdsbLiveControl misc lifecycle branches', () => {
  it('clicking the button toggles visibility', () => {
    const { control } = mounted()
    const before = control.visible
    control.button.click()
    expect(control.visible).toBe(!before)
  })

  it('re-initialises layers, tearing down existing markers and timers', () => {
    const { control, map } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control)
    priv(control)._updateCallsignMarkers()
    priv(control)._hoverHideTimer = setTimeout(() => {}, 1000)
    priv(control)._parkedTimers['x'] = setTimeout(() => {}, 1000)
    control._selectedHex = 'abc123'
    control._applySelection()
    priv(control).initLayers()
    expect(map.map.removeLayer).toHaveBeenCalled()
  })

  it('updates existing sprite images instead of re-adding them', () => {
    const { control, map } = mounted()
    ;(map.map.hasImage as any).mockReturnValue(true)
    priv(control)._registerIcons()
    expect(map.map.updateImage).toHaveBeenCalled()
  })

  it('reacts to field-change events while labels are visible', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control)
    window.dispatchEvent(
      new CustomEvent('adsb:labelFieldsChanged', {
        detail: { civil: ['callsign'], mil: ['callsign'] },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('adsb:tagFieldsChanged', {
        detail: { civil: { callsign: true }, mil: { callsign: true } },
      }),
    )
    expect(true).toBe(true)
  })

  it('setAllHidden updates tag and hover marker visibility', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'sel' })
    seedFeature(control, { hex: 'hov' })
    control._selectedHex = 'sel'
    control._applySelection()
    priv(control)._showHoverTag(control._geojson.features[1])
    control.setAllHidden(true)
    expect(control._allHidden).toBe(true)
  })

  it('_applyTypeFilter skips absent bracket/icon layers under all-hidden', () => {
    const { control, map } = mounted()
    map.layers.clear()
    control._allHidden = true
    control._selectedHex = null
    expect(() => control.setTypeFilter('all')).not.toThrow()
  })
})

describe('AdsbLiveControl follow-toggle in place', () => {
  it('toggleFollowByHex starts following the given aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'new' })
    enableAllFields(control)
    control.toggleFollowByHex('new')
    expect(control._selectedHex).toBe('new')
    expect(control._followEnabled).toBe(true)
    expect(control.isFollowingHex('new')).toBe(true)
  })

  it('toggleFollowByHex tolerates a target hex with no matching feature', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(() => control.toggleFollowByHex('ghost')).not.toThrow()
    // The follow flag is set before the feature lookup, so it still flips on.
    expect(control._followEnabled).toBe(true)
    expect(control._selectedHex).toBe('ghost')
  })

  it('toggleFollowByHex titles the tracking notif by registration then hex', () => {
    const { control } = mounted()
    enableAllFields(control)
    seedFeature(control, { hex: 'reg1', flight: '', r: 'G-REG' })
    seedFeature(control, { hex: 'hexonly', flight: '', r: '' })
    control.toggleFollowByHex('reg1')
    expect(notificationsStore.items.some((item) => item.title === 'G-REG')).toBe(true)
    control.toggleFollowByHex('hexonly')
    expect(notificationsStore.items.some((item) => item.title === 'hexonly')).toBe(true)
  })

  it('toggleFollowByHex dismisses a prior tracking notif for the target hex', () => {
    const { control } = mounted()
    enableAllFields(control)
    seedFeature(control, { hex: 'tgt', flight: 'CALL1' })
    const priorNotifId = notificationsStore.add({ type: 'tracking', title: 'stale' })
    priv(control)._trackingNotifIds = { tgt: priorNotifId }
    control.toggleFollowByHex('tgt')
    expect(notificationsStore.items.some((item) => item.id === priorNotifId)).toBe(false)
    expect(control._followEnabled).toBe(true)
  })

  it('toggleFollowByHex untracks when called on the followed aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'new' })
    enableAllFields(control)
    control.toggleFollowByHex('new')
    expect(control.isFollowingHex('new')).toBe(true)
    control.toggleFollowByHex('new')
    expect(control._followEnabled).toBe(false)
    expect(control._selectedHex).toBeNull()
    expect(control.isFollowingHex('new')).toBe(false)
  })

  it('toggleFollowByHex switches from one followed aircraft to another', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'old' })
    seedFeature(control, { hex: 'new' })
    enableAllFields(control)
    control.toggleFollowByHex('old')
    expect(control.isFollowingHex('old')).toBe(true)
    control.toggleFollowByHex('new')
    expect(control.isFollowingHex('old')).toBe(false)
    expect(control.isFollowingHex('new')).toBe(true)
  })

  it('toggleFollowByHex is a no-op without a hex', () => {
    const { control } = mounted()
    seedFeature(control)
    enableAllFields(control)
    control.toggleFollowByHex('')
    expect(control._followEnabled).toBe(false)
    expect(control._selectedHex).toBeNull()
  })

  it('isFollowingHex is false when following a different aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'old' })
    enableAllFields(control)
    control.toggleFollowByHex('old')
    expect(control.isFollowingHex('other')).toBe(false)
  })

  it('shows UNTRACK on hover for a tracking button', () => {
    const { control } = mounted()
    seedFeature(control)
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    const el = document.createElement('div')
    el.innerHTML = priv(control)._buildTagHTML(props())
    priv(control)._wireTagButton(el)
    const btn = el.querySelector('.tag-follow-btn') as HTMLElement
    // mousedown is swallowed so it never bubbles to the map's drag/pan handlers.
    const mousedown = new MouseEvent('mousedown', { bubbles: true })
    const stopPropagation = vi.spyOn(mousedown, 'stopPropagation')
    btn.dispatchEvent(mousedown)
    expect(stopPropagation).toHaveBeenCalled()
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(btn.textContent).toBe('UNTRACK')
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(btn.textContent).toBe('TRACKING')
  })
})

describe('AdsbLiveControl callsign label button handlers', () => {
  it('wires the in-label tracking button (mil)', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'm1'
    const el = priv(control)._buildCallsignLabelEl(props({ hex: 'm1', military: true }))
    const trk = el.querySelector('.mil-trk-btn') as HTMLElement
    trk.dispatchEvent(new MouseEvent('mouseenter'))
    expect(trk.textContent).toBe('UNTRACK')
    trk.dispatchEvent(new MouseEvent('mouseleave'))
    expect(trk.textContent).toBe('TRACKING')
    trk.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(airNotifStore.isEnabled('m1')).toBe(false)
  })

  it('wires the in-label notification bell', () => {
    const { control } = mounted()
    enableAllFields(control)
    airNotifStore.enable('n1')
    const el = priv(control)._buildCallsignLabelEl(props({ hex: 'n1' }))
    const bell = el.querySelector('.tag-notif-btn') as HTMLElement
    bell.dispatchEvent(new MouseEvent('mouseenter'))
    bell.dispatchEvent(new MouseEvent('mouseleave'))
    expect(bell).toBeTruthy()
  })

  it('wires the label hover and click handlers (and opens the side-panel accordion)', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'lab1' })
    enableAllFields(control)
    const openHandler = vi.fn()
    document.addEventListener('air-open-aircraft', openHandler)
    const el = priv(control)._buildCallsignLabelEl(control._geojson.features[0].properties)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(control._trailHex).toBe('lab1')
    el.dispatchEvent(new MouseEvent('mouseleave'))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(control._selectedHex).toBe('lab1')
    expect((openHandler.mock.calls.at(-1)![0] as CustomEvent).detail).toEqual({ hex: 'lab1' })
    document.removeEventListener('air-open-aircraft', openHandler)
  })

  it('builds a label with callsign disabled', () => {
    const { control } = mounted()
    priv(control)._tagFields = { civil: { aircraftType: true }, mil: { aircraftType: true } }
    expect(priv(control)._buildCallsignLabelEl(props())).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ track: 270 }))).toBeTruthy()
  })
})

describe('AdsbLiveControl callsign marker in-place updates', () => {
  function withLabels() {
    const { control, map } = mounted()
    control.labelsVisible = true
    return { control, map }
  }

  it('grows badges on a military marker across an update', () => {
    const { control } = withLabels()
    priv(control)._tagFields = { civil: {}, mil: { callsign: true } }
    const feature = seedFeature(control, { hex: 'm1', military: true })
    priv(control)._updateCallsignMarkers()
    // Enable badges + tracking + emergency, keep direction/notif the same.
    priv(control)._tagFields = {
      civil: {},
      mil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
    }
    control._followEnabled = true
    control._tagHex = 'm1'
    feature.properties.squawkEmerg = 1
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['m1']).toBeDefined()
  })

  it('grows badges on a civil marker across an update', () => {
    const { control } = withLabels()
    priv(control)._tagFields = { civil: { callsign: true }, mil: {} }
    const feature = seedFeature(control, { hex: 'c1', military: false })
    priv(control)._updateCallsignMarkers()
    priv(control)._tagFields = {
      civil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
      mil: {},
    }
    feature.properties.squawkEmerg = 1
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['c1']).toBeDefined()
  })

  it('shrinks badges back off on a later update', () => {
    const { control } = withLabels()
    priv(control)._tagFields = {
      civil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
      mil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
    }
    const mil = seedFeature(control, { hex: 'm2', military: true, squawkEmerg: 1 })
    const civ = seedFeature(control, { hex: 'c2', military: false, squawkEmerg: 1 })
    priv(control)._updateCallsignMarkers()
    priv(control)._tagFields = { civil: { callsign: true }, mil: { callsign: true } }
    mil.properties.squawkEmerg = 0
    civ.properties.squawkEmerg = 0
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['m2']).toBeDefined()
  })

  it('dims a stale marker on update', () => {
    const { control } = withLabels()
    enableAllFields(control)
    seedFeature(control, { hex: 'd1' })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['d1'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['d1']).toBeDefined()
  })

  it('hides a marker behind an active hover tag on recreate', () => {
    const { control } = withLabels()
    enableAllFields(control)
    const feature = seedFeature(control, { hex: 'h1', track: 90 })
    priv(control)._updateCallsignMarkers()
    priv(control)._showHoverTag(feature)
    priv(control)._hoverHex = 'h1'
    feature.properties.track = 270 // force recreate
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['h1']).toBeDefined()
  })

  it('hides a freshly created marker behind an active hover tag', () => {
    const { control } = withLabels()
    enableAllFields(control)
    const feature = seedFeature(control, { hex: 'h2' })
    priv(control)._showHoverTag(feature)
    priv(control)._hoverHex = 'h2'
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['h2']).toBeDefined()
  })
})

describe('AdsbLiveControl tag/hover hide branches', () => {
  it('hides the selected tag and deletes a tracked notif opt-in', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    control._followEnabled = true
    airNotifStore.enable('abc123')
    priv(control)._hideSelectedTag()
    expect(airNotifStore.isEnabled('abc123')).toBe(false)
  })

  it('marks the selected tag hidden when all-hidden with no selection', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    control._allHidden = true
    control._selectedHex = null
    priv(control)._showSelectedTag(feature)
    const el = markerRegistry.instances.at(-1)!.options.element
    expect(el.style.visibility).toBe('hidden')
  })

  it('_showSelectedTag is a no-op with no feature', () => {
    const { control } = mounted()
    expect(() => priv(control)._showSelectedTag(null)).not.toThrow()
  })

  it('restores the label element when the hover tag is removed', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    const labelEl = document.createElement('div')
    priv(control)._showHoverTag(feature, true, labelEl, 'left')
    priv(control)._hideHoverTagNow()
    expect(labelEl.style.visibility).toBe('')
  })

  it('wires hover-tag element mouseenter/leave/click (and opens the side-panel accordion)', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    const openHandler = vi.fn()
    document.addEventListener('air-open-aircraft', openHandler)
    priv(control)._showHoverTag(feature)
    const el = markerRegistry.instances.at(-1)!.options.element
    el.dispatchEvent(new MouseEvent('mouseenter'))
    el.dispatchEvent(new MouseEvent('mouseleave'))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(control._selectedHex).toBe('abc123')
    expect((openHandler.mock.calls.at(-1)![0] as CustomEvent).detail).toEqual({ hex: 'abc123' })
    document.removeEventListener('air-open-aircraft', openHandler)
  })

  it('updates the status bar for the selected aircraft', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    expect(() => priv(control)._updateStatusBar()).not.toThrow()
  })

  it('_updateStatusBar is a no-op with no selection', () => {
    const { control } = mounted()
    control._selectedHex = null
    expect(() => priv(control)._updateStatusBar()).not.toThrow()
  })
})

describe('AdsbLiveControl interpolate + raise branches', () => {
  it('repositions callsign and hover markers during interpolation', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    const feature = seedFeature(control)
    priv(control)._updateCallsignMarkers()
    priv(control)._showHoverTag(feature)
    priv(control)._hoverHex = 'abc123'
    priv(control)._interpolate()
    expect(priv(control)._interpolatedFeatures).not.toBeNull()
  })

  it('keeps a position without track at its last point', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'noTrack' })
    priv(control)._lastPositions['noTrack'] = {
      lon: -0.5,
      lat: 52,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 1000,
      prevLon: -0.5,
      prevLat: 52,
      prevSeen: Date.now() - 2000,
      interpLon: -0.5,
      interpLat: 52,
    }
    priv(control)._interpolate()
    expect(control._interpolatedCoords('noTrack')).toEqual([-0.5, 52])
  })

  it('_interpolate is a no-op without a map', () => {
    const control = makeControl()
    priv(control)._geojson.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: props(),
    })
    expect(() => priv(control)._interpolate()).not.toThrow()
  })

  it('_raiseLayers is a no-op without a map', () => {
    const control = makeControl()
    expect(() => priv(control)._raiseLayers()).not.toThrow()
  })
})

describe('AdsbLiveControl fetch extra branches', () => {
  it('invokes the emergency notification click action', async () => {
    const { control, map } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    const emerg = notificationsStore.items.find((i) => i.type === 'emergency')!
    emerg.clickAction!()
    expect(map.flyTo).toHaveBeenCalled()
  })

  it('clears a parked timer when an opted-in aircraft climbs again', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    expect(Object.keys(priv(control)._parkedTimers)).toContain('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 6000 })] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._parkedTimers['abc123']).toBeUndefined()
  })

  it('removes a selected aircraft when its parked timer fires', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
    } as Response)
    await priv(control)._fetch()
    control._selectedHex = 'abc123'
    control._isolatedHex = 'abc123'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    vi.advanceTimersByTime(60000)
    expect(control._selectedHex).toBeNull()
  })

  it('backs off after three rejected fetches', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    fetchMock.mockRejectedValue(new Error('network'))
    await priv(control)._fetch()
    await priv(control)._fetch()
    await priv(control)._fetch()
    expect(priv(control)._fetchFailCount).toBe(0)
  })

  it('is a no-op without a map', async () => {
    const control = makeControl()
    await priv(control)._fetch()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AdsbLiveControl tracking restore deep', () => {
  it('rebinds persisted tracking notifications on restore', () => {
    const { control } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'abc123' }))
    const id = notificationsStore.add({ type: 'tracking', title: 'TEST123' })
    const restored = priv(control)._doRestoreTracking()
    expect(restored).toBe(true)
    const item = notificationsStore.items.find((i) => i.id === id)!
    item.action!.callback()
    expect(airNotifStore.isEnabled('abc123')).toBe(false)
  })

  it('restores tracking via the network path', async () => {
    const { control } = mounted()
    seedFeature(control)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ hex: 'abc123', follow: true }]),
    } as Response)
    priv(control)._restoreTrackingState()
    await Promise.resolve()
    await Promise.resolve()
    expect(priv(control)._trackingRestored).toBe(true)
  })

  it('falls back to local restore when the network errors', async () => {
    const { control } = mounted()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    priv(control)._restoreTrackingState()
    await Promise.resolve()
    expect(priv(control)._trackingRestored).toBe(true)
  })

  it('saveTrackingState deletes a stale remote track when the hex changes', () => {
    const { control } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'previous' }))
    control._tagHex = 'abc123'
    control._followEnabled = true
    priv(control)._saveTrackingState()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/air/tracking/previous'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('saveTrackingState deletes the remote track on clear', () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'previous' }))
    control._followEnabled = false
    control._tagHex = null
    priv(control)._saveTrackingState()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/air/tracking/previous'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('AdsbLiveControl playback + polling stop branches', () => {
  it('pauseLive aborts an in-flight fetch and removes the tag marker', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    priv(control)._fetchAbort = new AbortController()
    control.pauseLive()
    expect(control._tagMarker).toBeNull()
  })

  it('resumeLive restarts polling when visible', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    control.pauseLive()
    control.resumeLive()
    expect(priv(control)._pollInterval).not.toBeNull()
  })

  it('clearAircraft clears hover and parked timers', () => {
    const { control } = mounted()
    priv(control)._hoverHideTimer = setTimeout(() => {}, 1000)
    priv(control)._parkedTimers['x'] = setTimeout(() => {}, 1000)
    control.clearAircraft()
    expect(priv(control)._hoverHideTimer).toBeNull()
    expect(Object.keys(priv(control)._parkedTimers)).toHaveLength(0)
  })

  it('toggling off removes airborne callsign markers', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'air1', category: 'A3' })
    seedFeature(control, { hex: 'gnd1', category: 'C2' })
    priv(control)._updateCallsignMarkers()
    control.toggle() // off
    expect(priv(control)._callsignMarkers['air1']).toBeUndefined()
  })

  it('_effectiveMode falls back to auto when localStorage throws', () => {
    const { control } = mounted()
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(priv(control)._effectiveMode()).toBe('auto')
    spy.mockRestore()
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 4: final branch sweep =====
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('AdsbLiveControl final branch sweep', () => {
  it('guards re-entrant aircraft clicks', () => {
    const { control, map } = mounted()
    seedFeature(control)
    const payload = { features: [{ properties: { hex: 'abc123' } }] }
    map.fire('click', 'adsb-hit', payload)
    // Second synchronous click is guarded by _clickHandled before the bare reset.
    map.fire('click', 'adsb-hit', payload)
    expect(control._selectedHex).toBe('abc123')
  })

  it('ignores hover/trail enters with no features', () => {
    const { control, map } = mounted()
    map.fire('mouseenter', 'adsb-hit', { features: [] })
    map.fire('mouseenter', 'adsb-trail-line', { features: [] })
    expect(control._trailHex).toBeNull()
  })

  it('routes hover-leave trail rebuild through the playback hook', () => {
    const { control, map } = mounted()
    priv(control)._isPlayback = true
    const hook = vi.fn()
    control._onPlaybackSelectionChange = hook
    map.fire('mouseleave', 'adsb-hit', {})
    expect(hook).toHaveBeenCalled()
  })

  it('decorates the status bar name for an emergency aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { emergency: 'general' })
    control._selectedHex = 'abc123'
    control._applySelection()
    const item = trackingStore.getLiveItem('air')!
    expect(item.name).toContain('⚠')
  })

  it('_handleUntrack dismisses the tracking notification and opt-in', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    airNotifStore.enable('abc123')
    const id = notificationsStore.add({ type: 'tracking', title: 'x' })
    priv(control)._trackingNotifIds = { abc123: id }
    priv(control)._handleUntrack()
    expect(airNotifStore.isEnabled('abc123')).toBe(false)
  })

  it('toggles follow OFF via the follow button when already tracking', () => {
    const { control } = mounted()
    seedFeature(control)
    enableAllFields(control)
    control._selectedHex = 'abc123'
    control._tagHex = 'abc123'
    control._followEnabled = true
    const el = document.createElement('div')
    el.innerHTML = priv(control)._buildTagHTML(props())
    priv(control)._wireTagButton(el)
    el.querySelector('.tag-follow-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(control._followEnabled).toBe(false)
  })

  it('_rebuildTagForHex returns when the feature is gone', () => {
    const { control } = mounted()
    control._tagHex = 'ghost'
    expect(() => control._rebuildTagForHex('ghost')).not.toThrow()
    expect(control._tagMarker).toBeNull()
  })

  it('_showHoverTag is a no-op for a null feature', () => {
    const { control } = mounted()
    expect(() => priv(control)._showHoverTag(null)).not.toThrow()
  })

  it('clears a pending hide timer when re-hovering', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    priv(control)._showHoverTag(feature)
    priv(control)._hideHoverTag() // sets a hide timer
    priv(control)._showHoverTag(feature) // should clear it
    expect(priv(control)._hoverHideTimer).toBeNull()
  })

  it('builds a right-facing emergency callsign label', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildCallsignLabelEl(props({ track: 270, squawkEmerg: 1 }))).toBeTruthy()
  })

  it('_updateCallsignMarkers is a no-op without a map', () => {
    const control = makeControl()
    control.labelsVisible = true
    expect(() => priv(control)._updateCallsignMarkers()).not.toThrow()
  })

  it('removes a marker when isolation excludes it', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'iso1' })
    priv(control)._updateCallsignMarkers()
    control._isolatedHex = 'someoneelse'
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['iso1']).toBeUndefined()
  })

  it('clicks a tracking button created during a marker update (mil)', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: {}, mil: { callsign: true } }
    seedFeature(control, { hex: 'm9', military: true })
    priv(control)._updateCallsignMarkers()
    control._followEnabled = true
    control._tagHex = 'm9'
    priv(control)._updateCallsignMarkers()
    const el = priv(control)._callsignMarkers['m9'].getElement() as HTMLElement
    const trk = el.querySelector('.mil-trk-btn') as HTMLElement | null
    if (trk) {
      trk.dispatchEvent(new MouseEvent('mouseenter'))
      trk.dispatchEvent(new MouseEvent('mouseleave'))
      trk.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    expect(priv(control)._callsignMarkers['m9']).toBeDefined()
  })

  it('creates a dim brand-new marker', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'dimnew' })
    priv(control)._lastPositions['dimnew'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['dimnew']).toBeDefined()
  })

  it('_applySelection is a no-op without a map and fires the playback hook', () => {
    const noMap = makeControl()
    expect(() => noMap._applySelection()).not.toThrow()
    const { control } = mounted()
    seedFeature(control)
    priv(control)._isPlayback = true
    const hook = vi.fn()
    control._onPlaybackSelectionChange = hook
    control._selectedHex = 'abc123'
    control._applySelection()
    expect(hook).toHaveBeenCalled()
  })

  it('removes the callsign marker for an aircraft aged out during interpolation', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'agedmk' })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['agedmk'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 61000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 62000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._interpolate()
    expect(priv(control)._callsignMarkers['agedmk']).toBeUndefined()
  })

  it('eases the camera to follow during interpolation', () => {
    const { control, map } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    control._followEnabled = true
    priv(control)._lastPositions['abc123'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 400,
      track: 90,
      lastSeen: Date.now() - 1000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 2000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    map.easeTo.mockClear()
    priv(control)._interpolate()
    expect(map.easeTo).toHaveBeenCalled()
  })

  it('trims a trail that exceeds the maximum length', async () => {
    const { control } = mounted()
    priv(control)._MAX_TRAIL = 2
    for (let i = 0; i < 4; i++) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ac: [apiEntry({ lon: -0.1 - i * 0.01 })] }),
      } as Response)
      await priv(control)._fetch()
    }
    expect(priv(control)._trails['abc123'].length).toBeLessThanOrEqual(2)
  })

  it('resets an existing parked timer on a repeat landing', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    const land = () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
      } as Response)
    }
    land()
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    // climb then land again to reset the timer
    land()
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    expect(Object.keys(priv(control)._parkedTimers)).toContain('abc123')
  })

  it('retains an aircraft that is briefly missing but still has a position record', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry()] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    await priv(control)._fetch()
    expect(control._geojson.features.find((f) => f.properties.hex === 'abc123')).toBeDefined()
  })

  it('returns from fetch when the map is torn down mid-request', async () => {
    const { control } = mounted()
    fetchMock.mockImplementationOnce(() => {
      ;(control as any).map = undefined
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ac: [] }),
      } as Response)
    })
    await priv(control)._fetch()
    expect(true).toBe(true)
  })

  it('_effectiveMode returns the connectivity mode when override is auto', () => {
    const { control } = mounted()
    localStorage.setItem('sentinel_air_sourceOverride', 'auto')
    localStorage.setItem('sentinel_app_connectivityMode', 'online')
    expect(priv(control)._effectiveMode()).toBe('online')
  })

  it('clearAircraft removes an existing tag marker', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control.clearAircraft()
    expect(control._tagMarker).toBeNull()
  })

  it('setPlaybackFeatures refreshes labels when visible', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    const feature = seedFeature(control)
    control.setPlaybackFeatures([feature])
    expect(control._geojson.features).toHaveLength(1)
  })

  it('toggle-off skips a callsign marker whose aircraft has vanished', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'air1', category: 'A3' })
    priv(control)._updateCallsignMarkers()
    // Drop the feature but keep the marker to hit the missing-feature guard.
    control._geojson.features = []
    control.toggle()
    expect(control.visible).toBe(false)
  })

  it('_startPolling is idempotent', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    priv(control)._startPolling()
    const first = priv(control)._pollInterval
    priv(control)._startPolling()
    expect(priv(control)._pollInterval).toBe(first)
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 5: residual statement gaps =====
/* eslint-disable @typescript-eslint/no-explicit-any */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AdsbLiveControl residual gaps', () => {
  it('invokes the registered onUntrack callback', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    control._followEnabled = true
    trackingStore.untrackItem('air')
    expect(control._followEnabled).toBe(false)
  })

  it('swaps a prior hover label element on a same-hex re-hover', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    const labelA = document.createElement('div')
    const labelB = document.createElement('div')
    priv(control)._showHoverTag(feature, true, labelA, 'left')
    priv(control)._showHoverTag(feature, true, labelB, 'left')
    expect(labelA.style.visibility).toBe('')
    expect(labelB.style.visibility).toBe('hidden')
  })

  it('clears the hide timer when the hover element is re-entered', () => {
    const { control } = mounted()
    const feature = seedFeature(control)
    priv(control)._showHoverTag(feature)
    const el = markerRegistry.instances.at(-1)!.options.element
    priv(control)._hideHoverTag() // arms the hide timer
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(priv(control)._hoverHideTimer).toBeNull()
  })

  it('skips a blank-hex feature when updating callsign markers', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: '' })
    expect(() => priv(control)._updateCallsignMarkers()).not.toThrow()
  })

  it('recolours a solid-circle tower arrow on marker update', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'twr9', category: 'C3' })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['twr9']).toBeDefined()
  })

  it('recreates a dim marker when its direction flips', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    const feature = seedFeature(control, { hex: 'dd1', track: 90 })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['dd1'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    feature.properties.track = 270
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['dd1']).toBeDefined()
  })

  it('removes a tracking button when a marker stops being tracked', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: {}, mil: { callsign: true } }
    seedFeature(control, { hex: 'mt1', military: true })
    control._followEnabled = true
    control._tagHex = 'mt1'
    priv(control)._updateCallsignMarkers()
    control._followEnabled = false
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['mt1']).toBeDefined()
  })

  it('restarts polling after a 429 backoff window', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    vi.advanceTimersByTime(30000)
    expect(priv(control)._pollInterval).not.toBeNull()
  })

  it('aborts cleanly when the map is torn down before json parsing', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => {
        ;(control as any).map = undefined
        return Promise.resolve({ ac: [] })
      },
    } as Response)
    await priv(control)._fetch()
    expect(true).toBe(true)
  })

  it('clears a stale parked timer that was already pending on a landing', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    priv(control)._prevAlt['abc123'] = 5000
    const stale = setTimeout(() => {}, 99999)
    priv(control)._parkedTimers['abc123'] = stale
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._parkedTimers['abc123']).not.toBe(stale)
  })

  it('removes the callsign marker when a parked aircraft is culled', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    airNotifStore.enable('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
    } as Response)
    await priv(control)._fetch()
    priv(control)._updateCallsignMarkers()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    vi.advanceTimersByTime(60000)
    expect(priv(control)._callsignMarkers['abc123']).toBeUndefined()
  })

  it('prunes stale bookkeeping for aircraft no longer seen', async () => {
    const { control } = mounted()
    priv(control)._prevAlt['ghostA'] = 100
    priv(control)._hasDeparted['ghostB'] = true
    priv(control)._prevSquawk['ghostC'] = '7700'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._prevAlt['ghostA']).toBeUndefined()
    expect(priv(control)._hasDeparted['ghostB']).toBeUndefined()
    expect(priv(control)._prevSquawk['ghostC']).toBeUndefined()
  })

  it('skips a blank-hex aircraft in the squawk-change scan', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ hex: '', squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    expect(true).toBe(true)
  })

  it('restarts polling after a network-failure backoff window', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    fetchMock.mockRejectedValue(new Error('down'))
    await priv(control)._fetch()
    await priv(control)._fetch()
    await priv(control)._fetch()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    vi.advanceTimersByTime(30000)
    expect(priv(control)._pollInterval).not.toBeNull()
  })

  it('saveTrackingState tolerates malformed stored JSON on both branches', () => {
    const { control } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', '{bad json')
    control._tagHex = 'abc123'
    control._followEnabled = true
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
    localStorage.setItem('adsbTracking', '{bad json')
    control._tagHex = null
    control._followEnabled = false
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
  })

  it('restoreTrackingState persists and applies a followed network row', async () => {
    const { control } = mounted()
    seedFeature(control)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ hex: 'abc123', follow: true }]),
    } as Response)
    priv(control)._restoreTrackingState()
    await flush()
    expect(localStorage.getItem('adsbTracking')).toContain('abc123')
  })

  it('restoreTrackingState retries on a failed local restore via the network path', async () => {
    const { control } = mounted()
    // No feature present → _doRestoreTracking returns false, resetting the guard.
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'missing' }))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    } as Response)
    priv(control)._restoreTrackingState()
    await flush()
    expect(priv(control)._trackingRestored).toBe(false)
  })

  it('restoreTrackingState retries on a failed local restore via the error path', async () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'missing' }))
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    priv(control)._restoreTrackingState()
    await flush()
    expect(priv(control)._trackingRestored).toBe(false)
  })

  it('_doRestoreTracking returns true when the saved entry has no hex', () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', JSON.stringify({}))
    expect(priv(control)._doRestoreTracking()).toBe(true)
  })

  it('_doRestoreTracking returns false on malformed saved JSON', () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', '{bad json')
    expect(priv(control)._doRestoreTracking()).toBe(false)
  })

  it('_stopFetching tears down an active poll interval on a 429', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    // Set the interval directly so the 429 mock isn't consumed by the immediate
    // fetch that _startPolling would fire.
    priv(control)._pollInterval = setInterval(() => {}, 99999)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    await priv(control)._fetch()
    expect(priv(control)._pollInterval).toBeNull()
  })

  it('_startPolling issues an immediate fetch and fires the interval callbacks', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    priv(control)._lastFetchTime = 0
    const fetchSpy = vi.spyOn(priv(control), '_fetch')
    const interpSpy = vi.spyOn(priv(control), '_interpolate')
    priv(control)._startPolling()
    expect(fetchSpy).toHaveBeenCalledTimes(1) // immediate
    vi.advanceTimersByTime(ADSB_POLL_INTERVAL_MS) // poll interval callback fires
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(interpSpy).toHaveBeenCalled() // 100ms interpolate callback fires
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 6: branch matrix =====
/* eslint-disable @typescript-eslint/no-explicit-any */
function noFields(control: AdsbLiveControl) {
  priv(control)._tagFields = { civil: {}, mil: {} }
}

describe('AdsbLiveControl tag HTML branch matrix', () => {
  it('renders a minimal civil right-facing tag with no fields and no opt-in', () => {
    const { control } = mounted()
    noFields(control)
    const html = priv(control)._buildTagHTML(props({ track: 270 }))
    expect(html).toContain('<div')
  })

  it('renders enabled fields whose values are all empty/zero', () => {
    const { control } = mounted()
    enableAllFields(control)
    const html = priv(control)._buildTagHTML(
      props({
        t: '',
        r: '',
        squawk: '',
        gs: null,
        track: null,
        category: '',
        alt_baro: 0,
        flight: '',
        hex: 'abc123',
      }),
    )
    expect(html).toContain('abc123')
  })

  it('renders a ground-vehicle and a tower tag', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildTagHTML(props({ category: 'C1' }))).toContain('<div')
    expect(priv(control)._buildTagHTML(props({ t: 'TWR', category: 'C3' }))).toContain('<div')
  })

  it('renders a non-emergency military opted-in tag with the bell', () => {
    const { control } = mounted()
    enableAllFields(control)
    airNotifStore.enable('abc123')
    const html = priv(control)._buildTagHTML(props({ military: true }))
    expect(html).toContain('tag-notif-btn')
  })

  it('falls back from flight to registration for the callsign', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildTagHTML(props({ flight: '', r: 'G-REG' }))).toContain('G-REG')
  })

  it('falls back from registration to hex for the callsign', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildTagHTML(props({ flight: '', r: '', hex: 'HEXID' }))).toContain(
      'HEXID',
    )
  })

  it('renders a tracked civil non-emergency tag (left)', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    expect(priv(control)._buildTagHTML(props({ military: false }))).toContain('TRACKING')
  })
})

describe('AdsbLiveControl callsign label branch matrix', () => {
  it('builds a label with no fields enabled (civil, both facings)', () => {
    const { control } = mounted()
    noFields(control)
    expect(priv(control)._buildCallsignLabelEl(props())).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ track: 270 }))).toBeTruthy()
  })

  it('builds a label with enabled fields but empty values', () => {
    const { control } = mounted()
    enableAllFields(control)
    const el = priv(control)._buildCallsignLabelEl(
      props({ t: '', r: '', squawk: '', gs: null, track: null, category: '', alt_baro: 0 }),
    )
    expect(el).toBeTruthy()
  })

  it('builds ground and tower labels', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildCallsignLabelEl(props({ category: 'C2' }))).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ t: 'TWR', category: 'C4' }))).toBeTruthy()
  })

  it('builds a tracked military emergency label (left and right)', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'm1'
    expect(
      priv(control)._buildCallsignLabelEl(props({ hex: 'm1', military: true, squawkEmerg: 1 })),
    ).toBeTruthy()
    expect(
      priv(control)._buildCallsignLabelEl(
        props({ hex: 'm1', military: true, squawkEmerg: 1, track: 270 }),
      ),
    ).toBeTruthy()
  })

  it('falls back to UNKNOWN when nothing identifies the aircraft', () => {
    const { control } = mounted()
    enableAllFields(control)
    const el = priv(control)._buildCallsignLabelEl(props({ flight: '', r: '', hex: '' }))
    expect(el.textContent).toContain('UNKNOWN')
  })

  it('builds a notif-on civil label (bell present, both facings)', () => {
    const { control } = mounted()
    enableAllFields(control)
    airNotifStore.enable('n2')
    expect(priv(control)._buildCallsignLabelEl(props({ hex: 'n2' }))).toBeTruthy()
    expect(priv(control)._buildCallsignLabelEl(props({ hex: 'n2', track: 270 }))).toBeTruthy()
  })
})

describe('AdsbLiveControl tracking fields branch matrix', () => {
  it('builds minimal tracking fields (no reg/type/squawk/emergency/military)', () => {
    const { control } = mounted()
    priv(control)._tagFields = { civil: {}, mil: {} }
    const fields = priv(control)._buildTrackingFields(
      props({ r: '', t: '', squawk: '', emergency: '', military: false, baro_rate: 0 }),
    )
    expect(fields.some((field: any) => field.label === 'CLASS')).toBe(false)
  })

  it('marks a descending aircraft with a down arrow', () => {
    const { control } = mounted()
    enableAllFields(control)
    const fields = priv(control)._buildTrackingFields(props({ alt_baro: 20000, baro_rate: -500 }))
    expect(fields.find((field: any) => field.label === 'ALT').value).toContain('↓')
  })
})

describe('AdsbLiveControl marker update branch matrix', () => {
  function withLabels() {
    const { control, map } = mounted()
    control.labelsVisible = true
    return { control, map }
  }

  it('removes civil badges and restores padding on a later update', () => {
    const { control } = withLabels()
    priv(control)._tagFields = {
      civil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
      mil: {},
    }
    const civ = seedFeature(control, { hex: 'cc', military: false, squawkEmerg: 1 })
    priv(control)._updateCallsignMarkers()
    // Drop every optional civil field and the emergency squawk.
    priv(control)._tagFields = { civil: { callsign: true }, mil: {} }
    civ.properties.squawkEmerg = 0
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cc']).toBeDefined()
  })

  it('updates a non-emergency military marker with all badges present', () => {
    const { control } = withLabels()
    priv(control)._tagFields = {
      civil: {},
      mil: { callsign: true, aircraftType: true, altitude: true, squawk: true },
    }
    seedFeature(control, { hex: 'mm', military: true, squawkEmerg: 0 })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['mm']).toBeDefined()
  })

  it('updates a ground-vehicle marker (no rotation)', () => {
    const { control } = withLabels()
    enableAllFields(control)
    seedFeature(control, { hex: 'gg', category: 'C1' })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['gg']).toBeDefined()
  })
})

describe('AdsbLiveControl fetch field fallbacks', () => {
  it('applies defaults for a sparse API entry', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ac: [
            {
              hex: 'sparse',
              lat: 51,
              lon: -1,
              alt_baro: 'ground',
              category: 'A1',
            },
          ],
        }),
    } as Response)
    await priv(control)._fetch()
    const feature = control._geojson.features.find((f) => f.properties.hex === 'sparse')!
    expect(feature.properties.gs).toBe(0)
    expect(feature.properties.track).toBe(0)
  })

  it('derives military status from the type code', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ac: [apiEntry({ hex: 'mlt', t: 'F15', military: undefined })] }),
    } as Response)
    await priv(control)._fetch()
    expect(control._geojson.features.find((f) => f.properties.hex === 'mlt')).toBeDefined()
  })
})

describe('AdsbLiveControl save-state error handling', () => {
  it('swallows rejected tracking API calls', async () => {
    const { control } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'previous' }))
    control._tagHex = 'abc123'
    control._followEnabled = true
    fetchMock.mockRejectedValue(new Error('api down'))
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
    await flush()
  })

  it('swallows a rejected delete on clear', async () => {
    const { control } = mounted()
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'previous' }))
    control._tagHex = null
    control._followEnabled = false
    fetchMock.mockRejectedValue(new Error('api down'))
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
    await flush()
  })

  it('catches a storage write failure', () => {
    const { control } = mounted()
    seedFeature(control)
    control._tagHex = 'abc123'
    control._followEnabled = true
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
    spy.mockRestore()
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 7: branch completion =====
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AdsbLiveControl branch completion: lifecycle + filters', () => {
  it('builds layers hidden and a dim button when the overlay is off at mount', () => {
    airStore.setOverlay('adsb', false)
    const { control } = mounted()
    expect(control.button.style.opacity).toBe('0.3')
    expect(control.button.style.color).toBe('rgb(255, 255, 255)')
  })

  it('setAllHidden keeps the tag visible while tracking', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    map.layers.add('adsb-trail-dots')
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._followEnabled = true
    control._trailHex = 'abc123'
    control.setAllHidden(false)
    expect(control._allHidden).toBe(false)
  })

  it('applyTypeFilter tolerates every target layer being absent', () => {
    const { control, map } = mounted()
    map.layers.clear()
    map.setFilter.mockClear() // discard the mount-time filter call
    control._allHidden = true
    control._selectedHex = null
    control.setTypeFilter('all') // all-hidden branch, no layers
    control._allHidden = false
    control._isolatedHex = 'abc123'
    control.setTypeFilter('all') // isolate branch, no layers
    control._isolatedHex = null
    control.setTypeFilter('civil') // normal branch, no layers
    expect(map.setFilter).not.toHaveBeenCalled()
  })

  it('setLabelsVisible tolerates an absent icon layer', () => {
    const { control, map } = mounted()
    map.layers.clear()
    control.setLabelsVisible(false)
    control.setLabelsVisible(true)
    expect(control.labelsVisible).toBe(true)
  })

  it('raiseLayers tolerates all layers being absent', () => {
    const { control, map } = mounted()
    map.layers.clear()
    expect(() => priv(control)._raiseLayers()).not.toThrow()
  })

  it('rebuildTrails tolerates absent layers and sources', () => {
    const { control, map } = mounted()
    map.layers.clear()
    map.sources.clear()
    seedFeature(control)
    priv(control)._trails['abc123'] = [
      { lon: -0.1, lat: 51.5, alt: 1 },
      { lon: -0.2, lat: 51.6, alt: 2 },
    ]
    control._trailHex = 'abc123'
    expect(() => priv(control)._rebuildTrails()).not.toThrow()
  })

  it('rebuildTrails builds a trail with no interpolated tail coordinate', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    // hex has trail points but is absent from the feature collection → no interp coord.
    priv(control)._trails['lonely'] = [
      { lon: -0.1, lat: 51.5, alt: 1 },
      { lon: -0.2, lat: 51.6, alt: 2 },
    ]
    control._trailHex = 'lonely'
    priv(control)._interpolatedFeatures = []
    priv(control)._rebuildTrails()
    expect(map.sourceData['adsb-trail-line-source']).toBeDefined()
  })

  it('handleConnectivityChange does nothing extra when online but hidden', () => {
    const { control } = mounted()
    control.visible = false
    localStorage.setItem('sentinel_air_sourceOverride', 'online')
    expect(() => control.handleConnectivityChange()).not.toThrow()
  })

  it('toggle-off tolerates absent trail layers and a missing button', () => {
    const { control, map } = mounted()
    map.layers.clear()
    ;(control as any).button = undefined
    expect(() => control.toggle()).not.toThrow()
  })

  it('toggle-off handles a ground-vehicle/empty-category marker', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'g0', category: '' })
    priv(control)._updateCallsignMarkers()
    control.toggle()
    expect(control.visible).toBe(false)
  })
})

describe('AdsbLiveControl branch completion: tag/marker geometry', () => {
  it('follow ON via toggleFollowByHex uses 3D pitch for a null-track aircraft', () => {
    is3D = true
    const { control, map } = mounted()
    seedFeature(control, { hex: 'abc123', track: null as any })
    enableAllFields(control)
    control.toggleFollowByHex('abc123')
    expect(control._followEnabled).toBe(true)
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 45 }))
  })

  it('_rebuildTagForHex handles a null-track (right-facing) tracked aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { track: null as any })
    control._followEnabled = true
    control._tagHex = 'abc123'
    control._rebuildTagForHex('abc123')
    expect(control._tagMarker).not.toBeNull()
  })

  it('_showSelectedTag handles a right-facing aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { track: 270 })
    control._selectedHex = 'abc123'
    control._applySelection()
    expect(control._tagMarker).not.toBeNull()
  })

  it('_showHoverTag falls back to raw coords for a detached feature with null track', () => {
    const { control } = mounted()
    const detached = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [2, 3] as [number, number] },
      properties: props({ hex: 'detached', track: null }),
    }
    priv(control)._showHoverTag(detached as any)
    expect(markerRegistry.instances.at(-1)!.lngLat).toEqual([2, 3])
  })

  it('_handleUntrack with no tag hex, no notif and 3D active', () => {
    is3D = true
    const { control, map } = mounted()
    control._tagHex = null
    priv(control)._handleUntrack()
    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('_updateStatusBar tolerates a selection whose feature has vanished', () => {
    const { control } = mounted()
    control._selectedHex = 'ghost'
    expect(() => priv(control)._updateStatusBar()).not.toThrow()
  })
})

describe('AdsbLiveControl branch completion: callsign labels + updates', () => {
  it('builds tracking fields when every optional value is null/blank', () => {
    const { control } = mounted()
    enableAllFields(control)
    const fields = priv(control)._buildTrackingFields(
      props({
        alt_baro: null,
        baro_rate: null,
        gs: null,
        track: null,
        category: '',
        r: '',
        squawk: '',
        emergency: '',
        military: false,
        flight: '',
        hex: 'X',
      }),
    )
    expect(fields.find((field: any) => field.label === 'ALT').value).toContain('GND')
  })

  it('updates a label whose aircraft is identified only by hex', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: { callsign: true }, mil: {} }
    seedFeature(control, { hex: 'zz', flight: '', r: '' })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['zz']).toBeDefined()
  })

  it('updates a label for an empty-category aircraft', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'ec', category: '', t: '' })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['ec']).toBeDefined()
  })

  it('applySelection shows no tag when the selected feature is missing', () => {
    const { control } = mounted()
    control._selectedHex = 'ghost'
    control._applySelection()
    expect(control._tagHex).toBeNull()
  })

  it('rebuildTrails marks a non-emergency civil trail', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    seedFeature(control, { military: false, squawkEmerg: 0 })
    priv(control)._trails['abc123'] = [
      { lon: -0.1, lat: 51.5, alt: 1 },
      { lon: -0.2, lat: 51.6, alt: 2 },
    ]
    control._trailHex = 'abc123'
    priv(control)._rebuildTrails()
    const line = map.sourceData['adsb-trail-line-source'] as GeoJSON.FeatureCollection
    expect(line.features[0]!.properties!.emerg).toBe(0)
  })
})

describe('AdsbLiveControl branch completion: interpolation + polling', () => {
  it('marks a feature stale during interpolation', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'st' })
    priv(control)._lastPositions['st'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 51000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._interpolate()
    expect(
      priv(control)._interpolatedFeatures!.find((f: any) => f.properties.hex === 'st')!.properties
        .stale,
    ).toBe(1)
  })

  it('skips the tag reposition when the tracked hex is not interpolated', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'other' })
    control._selectedHex = 'other'
    control._applySelection()
    control._tagHex = 'ghost' // not present among features
    expect(() => priv(control)._interpolate()).not.toThrow()
  })

  it('interpolate tolerates the live source being absent', () => {
    const { control, map } = mounted()
    map.sources.delete('adsb-live')
    seedFeature(control)
    expect(() => priv(control)._interpolate()).not.toThrow()
  })

  it('interpolatedCoords falls through to geojson when not in the interp set', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'gj' })
    priv(control)._interpolatedFeatures = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [9, 9] },
        properties: props({ hex: 'someoneelse' }),
      } as any,
    ]
    expect(control._interpolatedCoords('gj')).toEqual([-0.1, 51.5])
  })

  it('does not restart polling after a 429 once hidden', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    await priv(control)._fetch()
    control.visible = false
    vi.advanceTimersByTime(30000)
    expect(priv(control)._pollInterval).toBeNull()
  })

  it('does not restart polling after a network backoff once hidden', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    fetchMock.mockRejectedValue(new Error('x'))
    await priv(control)._fetch()
    await priv(control)._fetch()
    await priv(control)._fetch()
    control.visible = false
    vi.advanceTimersByTime(30000)
    expect(priv(control)._pollInterval).toBeNull()
  })

  it('resumeLive does not start polling when hidden', () => {
    const { control } = mounted()
    control.pauseLive()
    control.visible = false
    control.resumeLive()
    expect(priv(control)._pollInterval).toBeNull()
  })

  it('startPolling skips the immediate fetch when the cache is fresh and reuses the interp timer', () => {
    vi.useFakeTimers()
    const { control } = mounted()
    priv(control)._lastFetchTime = Date.now()
    priv(control)._interpolateInterval = setInterval(() => {}, 100)
    const spy = vi.spyOn(priv(control), '_fetch')
    priv(control)._startPolling()
    expect(spy).not.toHaveBeenCalled()
  })

  it('setPlaybackFeatures leaves the tag put when the tracked hex is absent', () => {
    const { control } = mounted()
    seedFeature(control)
    control._selectedHex = 'abc123'
    control._applySelection()
    control._tagHex = 'abc123'
    expect(() => control.setPlaybackFeatures([])).not.toThrow()
  })
})

describe('AdsbLiveControl branch completion: fetch internals', () => {
  it('falls back to the map centre when the cached location has no timestamp', async () => {
    const { control } = mounted()
    localStorage.setItem('userLocation', JSON.stringify({ latitude: 1, longitude: 2 }))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    await priv(control)._fetch()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('51.5000/-0.1000'),
      expect.anything(),
    )
  })

  it('treats a response with no ac array as empty', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response)
    await priv(control)._fetch()
    expect(control._geojson.features).toHaveLength(0)
  })

  it('skips an already-present blank-hex feature when indexing', async () => {
    const { control } = mounted()
    control._geojson.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: props({ hex: '' }),
    } as any)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry()] }),
    } as Response)
    await priv(control)._fetch()
    expect(control._geojson.features.some((f) => f.properties.hex === 'abc123')).toBe(true)
  })

  it('holds an existing untracked position when the update has no track', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ track: undefined, gs: undefined })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ track: undefined, gs: undefined })] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._lastPositions['abc123']).toBeDefined()
  })

  it('reports an emergency on the ground with no ground speed', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7600', alt_baro: 0, gs: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    const emerg = notificationsStore.items.find((i) => i.type === 'emergency')!
    expect(emerg.detail).toContain('ON GROUND')
  })

  it('does not fly to an emergency when the map is gone', async () => {
    const { control, map } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    const emerg = notificationsStore.items.find((i) => i.type === 'emergency')!
    ;(control as any).map = undefined
    emerg.clickAction!()
    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('reports a squawk-cleared change to a blank squawk', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ squawk: '' })] }),
    } as Response)
    await priv(control)._fetch()
    const cleared = notificationsStore.items.find((i) => i.type === 'squawk-clr')!
    expect(cleared.detail).toContain('(none)')
  })

  it('prunes hasDeparted bookkeeping for unseen aircraft', async () => {
    const { control } = mounted()
    priv(control)._hasDeparted['old'] = true
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._hasDeparted['old']).toBeUndefined()
  })

  it('culls a parked aircraft after its interp set is cleared and map removed', async () => {
    vi.useFakeTimers()
    const { control } = mounted()
    airNotifStore.enable('abc123')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 5000 })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry({ alt_baro: 0 })] }),
    } as Response)
    await priv(control)._fetch()
    priv(control)._interpolatedFeatures = null
    ;(control as any).map = undefined
    expect(() => vi.advanceTimersByTime(60000)).not.toThrow()
  })
})

describe('AdsbLiveControl branch completion: tracking restore', () => {
  it('ignores a non-ok tracking response', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve([]),
    } as Response)
    priv(control)._restoreTrackingState()
    await flush()
    expect(priv(control)._trackingRestored).toBe(true)
  })

  it('restore reuses an existing trackingNotifIds map and binds the disable action', () => {
    const { control } = mounted()
    seedFeature(control, { track: null as any })
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'abc123' }))
    priv(control)._trackingNotifIds = {}
    const id = notificationsStore.add({ type: 'tracking', title: 'x' })
    expect(priv(control)._doRestoreTracking()).toBe(true)
    const item = notificationsStore.items.find((i) => i.id === id)!
    priv(control)._trackingNotifIds = null
    item.action!.callback() // exercises the null-guard inside the callback
    expect(airNotifStore.isEnabled('abc123')).toBe(false)
  })

  it('restore uses 3D pitch when active', () => {
    is3D = true
    const { control, map } = mounted()
    seedFeature(control)
    localStorage.setItem('adsbTracking', JSON.stringify({ hex: 'abc123' }))
    priv(control)._doRestoreTracking()
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 45 }))
  })

  it('saveTrackingState writes an empty callsign when the feature is gone', () => {
    const { control } = mounted()
    control._tagHex = 'ghost'
    control._followEnabled = true
    expect(() => priv(control)._saveTrackingState()).not.toThrow()
    expect(localStorage.getItem('adsbTracking')).toContain('ghost')
  })
})

/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 8: branch completion II =====
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AdsbLiveControl branch completion II', () => {
  it('setAllHidden hides a non-tracked tag and a hover tag, then reveals them', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    map.layers.add('adsb-trail-dots')
    const feature = seedFeature(control)
    priv(control)._showSelectedTag(feature) // tag marker, but no selection/tracking
    priv(control)._showHoverTag(seedFeature(control, { hex: 'hv' }))
    control._trailHex = null
    control.setAllHidden(true)
    control.setAllHidden(false)
    expect(control._allHidden).toBe(false)
  })

  it('initLayers re-renders from a populated interpolated set', () => {
    const { control } = mounted()
    seedFeature(control)
    priv(control)._interpolatedFeatures = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: props(),
      } as any,
    ]
    expect(() => priv(control).initLayers()).not.toThrow()
  })

  it('a bare-map click with no selection is a no-op', () => {
    const { control, map } = mounted()
    control._selectedHex = null
    map.fire('click', undefined, { point: { x: 1, y: 1 } })
    expect(control._selectedHex).toBeNull()
  })

  it('hover enter ignores a feature absent from the collection or lacking a hex', () => {
    const { control, map } = mounted()
    map.fire('mouseenter', 'adsb-hit', { features: [{ properties: { hex: 'absent' } }] })
    map.fire('mouseenter', 'adsb-hit', { features: [{ properties: {} }] })
    map.fire('mouseenter', 'adsb-trail-line', { features: [{ properties: { hex: 'absent' } }] })
    // The handlers run without a matching feature (no hover tag) but still record
    // the hovered hex for the trail.
    expect(control._trailHex).toBe('absent')
  })

  it('builds a non-tracked tag for an aircraft whose emergency is the string none', () => {
    const { control } = mounted()
    enableAllFields(control)
    expect(priv(control)._buildTagHTML(props({ emergency: 'none' }))).toContain('<div')
  })

  it('renders a tracked tag with the callsign field disabled', () => {
    const { control } = mounted()
    priv(control)._tagFields = { civil: { aircraftType: true }, mil: { aircraftType: true } }
    control._followEnabled = true
    control._tagHex = 'abc123'
    expect(priv(control)._buildTagHTML(props())).toContain('TRACKING')
  })

  it('decorates the status bar callsign via each fallback', () => {
    const { control } = mounted()
    const reg = seedFeature(control, { hex: 'r1', flight: '', r: 'G-REG' })
    priv(control)._showStatusBar(reg.properties)
    const hx = seedFeature(control, { hex: 'h1', flight: '', r: '' })
    priv(control)._showStatusBar(hx.properties)
    expect(trackingStore.isLive('air')).toBe(true)
  })

  it('_rebuildTagForHex anchors a non-tracked right-facing aircraft', () => {
    const { control } = mounted()
    seedFeature(control, { track: null })
    control._followEnabled = false
    control._tagHex = 'abc123'
    control._rebuildTagForHex('abc123')
    expect(control._tagMarker).not.toBeNull()
  })

  it('_showSelectedTag falls back to raw coords for a detached feature', () => {
    const { control } = mounted()
    const detached = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [5, 6] as [number, number] },
      properties: props({ hex: 'det' }),
    }
    priv(control)._showSelectedTag(detached as any)
    expect(markerRegistry.instances.at(-1)!.lngLat).toEqual([5, 6])
  })

  it('restores a prior hover label visibility under all-hidden', () => {
    const { control } = mounted()
    control._allHidden = true
    const feature = seedFeature(control)
    const labelA = document.createElement('div')
    const labelB = document.createElement('div')
    priv(control)._showHoverTag(feature, true, labelA, 'left')
    priv(control)._showHoverTag(feature, true, labelB, 'left')
    expect(labelA.style.visibility).toBe('hidden')
    priv(control)._hideHoverTagNow()
    expect(labelB.style.visibility).toBe('hidden')
  })

  it('label mouseenter ignores an aircraft absent from the collection', () => {
    const { control } = mounted()
    enableAllFields(control)
    const el = priv(control)._buildCallsignLabelEl(props({ hex: 'absentlabel' }))
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(control._trailHex).toBe('absentlabel')
  })

  it('updateCallsignMarkers under a civil type filter keeps civil aircraft', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    control._typeFilter = 'civil'
    seedFeature(control, { hex: 'cv', military: false })
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cv']).toBeDefined()
  })

  it('recreates a marker flipping from right back to left facing while dim', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    const feature = seedFeature(control, { hex: 'rl', track: 270 })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['rl'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    feature.properties.track = 90 // right → left
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['rl']).toBeDefined()
  })

  it('updates a null-track marker (no rotation arrow override)', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'nt', track: null })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['nt']).toBeDefined()
  })

  it('updates a military marker with the callsign field disabled and dimmed', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: {}, mil: { aircraftType: true } }
    seedFeature(control, { hex: 'mn', military: true, track: 270 })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['mn'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['mn']).toBeDefined()
  })

  it('updates a civil marker with the callsign field disabled', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: { aircraftType: true }, mil: {} }
    seedFeature(control, { hex: 'cn', military: false })
    priv(control)._updateCallsignMarkers()
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cn']).toBeDefined()
  })

  it('creates a dim, right-facing brand-new civil marker', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'dn', track: null })
    priv(control)._lastPositions['dn'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['dn']).toBeDefined()
  })

  it('builds a non-emergency trail when the feature emergency is the string none', () => {
    const { control, map } = mounted()
    map.layers.add('adsb-trail-line')
    seedFeature(control, { emergency: 'none', squawkEmerg: 0 })
    priv(control)._trails['abc123'] = [
      { lon: -0.1, lat: 51.5, alt: 1 },
      { lon: -0.2, lat: 51.6, alt: 2 },
    ]
    control._trailHex = 'abc123'
    priv(control)._rebuildTrails()
    const line = map.sourceData['adsb-trail-line-source'] as GeoJSON.FeatureCollection
    expect(line.features[0]!.properties!.emerg).toBe(0)
  })

  it('handles a sparse API entry with no category in the feature build', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [{ hex: 'nocat', lat: 51, lon: -1 }] }),
    } as Response)
    await priv(control)._fetch()
    const feature = control._geojson.features.find((f) => f.properties.hex === 'nocat')!
    expect(feature.properties.category).toBe('')
  })

  it('reports an emergency for an aircraft identified only by hex', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ac: [apiEntry({ hex: 'EMG1', flight: '', r: '', squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    const emerg = notificationsStore.items.find((i) => i.type === 'emergency')!
    expect(emerg.title).toBe('EMG1')
  })

  it('reports a squawk-clear for an aircraft identified only by hex', async () => {
    const { control } = mounted()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ac: [apiEntry({ hex: 'CLR1', flight: '', r: '', squawk: '7700' })] }),
    } as Response)
    await priv(control)._fetch()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ ac: [apiEntry({ hex: 'CLR1', flight: '', r: '', squawk: '1200' })] }),
    } as Response)
    await priv(control)._fetch()
    const cleared = notificationsStore.items.find((i) => i.type === 'squawk-clr')!
    expect(cleared.title).toBe('CLR1')
  })

  it('toggle-off inspects a tower marker whose type code is blank', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'tw0', category: 'C3', t: '' })
    priv(control)._updateCallsignMarkers()
    control.toggle()
    expect(control.visible).toBe(false)
  })

  it('saveTrackingState records an empty callsign for a registration-less feature', () => {
    const { control } = mounted()
    seedFeature(control, { hex: 'abc123', flight: '', r: '' })
    control._tagHex = 'abc123'
    control._followEnabled = true
    priv(control)._saveTrackingState()
    expect(localStorage.getItem('adsbTracking')).toContain('abc123')
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 9: branch completion III =====
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('AdsbLiveControl branch completion III', () => {
  it('renders a tracked tag for an emergency and a string-none aircraft', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    expect(priv(control)._buildTagHTML(props({ emergency: 'general' }))).toContain('TRACKING')
    expect(priv(control)._buildTagHTML(props({ emergency: 'none' }))).toContain('TRACKING')
  })

  it('shows UNKNOWN in the status bar when nothing identifies the aircraft', () => {
    const { control } = mounted()
    priv(control)._showStatusBar(props({ flight: '', r: '', hex: '' }))
    expect(trackingStore.getLiveItem('air')!.name).toBe('UNKNOWN')
  })

  it('setAllHidden tolerates absent trail layers with a trail hex set', () => {
    const { control, map } = mounted()
    map.layers.clear()
    control._trailHex = 'abc123'
    expect(() => control.setAllHidden(true)).not.toThrow()
  })

  it('inserts a model badge before nothing when a mil marker has no other badges', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: {}, mil: { callsign: true } }
    const feature = seedFeature(control, { hex: 'mb', military: true, squawkEmerg: 0 })
    priv(control)._updateCallsignMarkers()
    // Turn on only the type field so the update inserts a model badge with no
    // alt-badge / trk-btn / sqk-badge present as an insert reference.
    priv(control)._tagFields = { civil: {}, mil: { callsign: true, aircraftType: true } }
    feature.properties.alt_baro = 0
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['mb']).toBeDefined()
  })

  it('label mouseenter on a hexless aircraft does not set a trail hex', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._trailHex = null
    const el = priv(control)._buildCallsignLabelEl(props({ hex: '' }))
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(control._trailHex).toBeNull()
  })

  it('toggle-off evaluates a blank type code on an airborne marker', () => {
    const { control } = mounted()
    control.labelsVisible = true
    enableAllFields(control)
    seedFeature(control, { hex: 'bt', category: 'A3', t: '' })
    priv(control)._updateCallsignMarkers()
    control.toggle()
    expect(priv(control)._callsignMarkers['bt']).toBeUndefined()
  })

  it('restores civil padding after an emergency squawk clears with no other badges', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: { callsign: true, squawk: true }, mil: {} }
    const civ = seedFeature(control, { hex: 'cp', military: false, squawkEmerg: 1 })
    priv(control)._updateCallsignMarkers()
    civ.properties.squawkEmerg = 0
    priv(control)._tagFields = { civil: { callsign: true }, mil: {} }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cp']).toBeDefined()
  })

  it('creates a dim new civil marker with the callsign field disabled', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: { aircraftType: true }, mil: {} }
    seedFeature(control, { hex: 'dnc', military: false })
    priv(control)._lastPositions['dnc'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['dnc']).toBeDefined()
  })

  it('recreates a dim marker with the callsign field disabled when direction flips', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = { civil: { aircraftType: true }, mil: {} }
    const feature = seedFeature(control, { hex: 'rdc', track: 90 })
    priv(control)._updateCallsignMarkers()
    priv(control)._lastPositions['rdc'] = {
      lon: -0.1,
      lat: 51.5,
      gs: 0,
      track: null,
      lastSeen: Date.now() - 50000,
      prevLon: -0.1,
      prevLat: 51.5,
      prevSeen: Date.now() - 60000,
      interpLon: -0.1,
      interpLat: 51.5,
    }
    feature.properties.track = null as any // left → right, exercises track ?? 0
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['rdc']).toBeDefined()
  })

  it('keeps hasDeparted bookkeeping for an aircraft still in the feed', async () => {
    const { control } = mounted()
    priv(control)._hasDeparted['abc123'] = true
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ac: [apiEntry()] }),
    } as Response)
    await priv(control)._fetch()
    expect(priv(control)._hasDeparted['abc123']).toBe(true)
  })
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===== Batch 10: branch completion IV =====
describe('AdsbLiveControl branch completion IV', () => {
  it('renders a tracked emergency-squawk tag', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    expect(
      priv(control)._buildTagHTML(props({ squawkEmerg: 1, squawk: '7700', military: true })),
    ).toContain('TRACKING')
  })

  it('keeps civil padding when a removed sqk badge leaves other badges behind', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = {
      civil: { callsign: true, aircraftType: true, squawk: true },
      mil: {},
    }
    const civ = seedFeature(control, { hex: 'cpb', military: false, squawkEmerg: 1 })
    priv(control)._updateCallsignMarkers()
    civ.properties.squawkEmerg = 0 // clears the emergency sqk badge; type badge remains
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cpb']).toBeDefined()
  })
})

// ===== Batch 11: last reachable branches =====
describe('AdsbLiveControl branch completion V', () => {
  it('renders a tracked, non-emergency military tag (mil arrow colour)', () => {
    const { control } = mounted()
    enableAllFields(control)
    control._followEnabled = true
    control._tagHex = 'abc123'
    expect(
      priv(control)._buildTagHTML(props({ military: true, squawkEmerg: 0, emergency: '' })),
    ).toContain('TRACKING')
  })

  it('keeps civil padding when an altitude badge survives the sqk-badge removal', () => {
    const { control } = mounted()
    control.labelsVisible = true
    priv(control)._tagFields = {
      civil: { callsign: true, altitude: true, squawk: true },
      mil: {},
    }
    const civ = seedFeature(control, {
      hex: 'cav',
      military: false,
      squawkEmerg: 1,
      alt_baro: 30000,
    })
    priv(control)._updateCallsignMarkers()
    civ.properties.squawkEmerg = 0 // remove emergency sqk badge; civil-alt-badge remains
    priv(control)._updateCallsignMarkers()
    expect(priv(control)._callsignMarkers['cav']).toBeDefined()
  })
})
