/* eslint-disable vue/one-component-per-file, vue/require-prop-types -- this spec
   defines tiny stub components (with untyped capture props) to stand in for
   LandView's children. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSdrStore } from '@/stores/sdr'
import { defineComponent, h, nextTick } from 'vue'
import { axe } from 'jest-axe'

// ---- Shared mock state ----------------------------------------------------
const shared = vi.hoisted(() => ({
  emit: null as null | ((event: string, ...args: unknown[]) => void),
  connectivityCb: null as null | ((online: boolean) => void),
}))

vi.mock('@/composables/useConnectivity', () => ({
  useConnectivity: (cb: (online: boolean) => void) => {
    shared.connectivityCb = cb
  },
}))

// Right-click "set my location" menu — spy on attach/detach.
const ctxMenuSpies = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
  remove: vi.fn(),
  show: vi.fn(),
}))
vi.mock('@/composables/useMapContextMenu', () => ({ useMapContextMenu: () => ctxMenuSpies }))

// User location: a controllable ref + `start` spy.
const locationState = vi.hoisted(() => ({
  location: null as null | { value: { lat: number; lon: number; accuracy: number } | null },
  start: vi.fn(),
}))
vi.mock('@/composables/useUserLocation', async () => {
  const { ref: vueRef } = await import('vue')
  locationState.location = vueRef(null)
  return {
    useUserLocation: () => ({ location: locationState.location, start: locationState.start }),
  }
})

// UserLocationMarker: spy on its map methods (a class so it can be `new`-ed).
const markerSpies = vi.hoisted(() => ({
  addTo: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setHidden: vi.fn(),
}))
vi.mock('@/components/shared/UserLocationMarker', () => ({
  UserLocationMarker: class {
    addTo = markerSpies.addTo
    update = markerSpies.update
    remove = markerSpies.remove
    // Borrowed by SentrySitesControl, which hides this marker while one of its
    // counts stands for the operator's position.
    setHidden = markerSpies.setHidden
  },
}))

// The map feature controls are initialised via onAdd; mock them so no real
// maplibre layers are touched (they have their own specs).
const ringsSpies = vi.hoisted(() => ({
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  handleClickPublic: vi.fn(),
  updateCenter: vi.fn(),
  setLocationAvailable: vi.fn(),
  visible: false,
}))
vi.mock('@/components/land/controls/range-rings/LandRangeRingsControl', () => ({
  LandRangeRingsControl: class {
    onAdd = ringsSpies.onAdd
    onRemove = ringsSpies.onRemove
    handleClickPublic = ringsSpies.handleClickPublic
    updateCenter = ringsSpies.updateCenter
    setLocationAvailable = ringsSpies.setLocationAvailable
    get visible() {
      return ringsSpies.visible
    }
  },
}))
const aprsSpies = vi.hoisted(() => ({
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  handleClickPublic: vi.fn(),
  setVisible: vi.fn(),
}))
// The real control owns APRS visibility on the land store (so the map and the
// side panel's list can't disagree); the stub mirrors that, since the view's
// active-state prop now reads the store rather than a local ref.
vi.mock('@/components/land/controls/aprs/AprsStationsControl', () => ({
  AprsStationsControl: class {
    private _store: { aprsLayerVisible: boolean; setAprsLayerVisible: (v: boolean) => void }
    constructor(store: { aprsLayerVisible: boolean; setAprsLayerVisible: (v: boolean) => void }) {
      this._store = store
    }
    onAdd = aprsSpies.onAdd
    onRemove = aprsSpies.onRemove
    handleClickPublic = (...args: unknown[]) => {
      this._store.setAprsLayerVisible(!this._store.aprsLayerVisible)
      return aprsSpies.handleClickPublic(...args)
    }
    setVisible = (visible: boolean) => {
      this._store.setAprsLayerVisible(visible)
      return aprsSpies.setVisible(visible)
    }
  },
}))

// The shared base-map layer controls (location names / roads). Mocked for the same
// reason as the others — they own real maplibre layer visibility and have their
// own specs — but each keeps the basemap store wired up, since the side menu
// reads its active state straight off that store rather than from a prop.
const namesSpies = vi.hoisted(() => ({
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  handleClickPublic: vi.fn(),
  applyVisibility: vi.fn(),
}))
vi.mock('@/components/shared/controls/names/NamesToggleControl', () => ({
  NamesToggleControl: class {
    private _store: {
      setLayer: (key: string, visible: boolean) => void
      layers: { names: boolean }
    }
    constructor(store: {
      setLayer: (key: string, visible: boolean) => void
      layers: { names: boolean }
    }) {
      this._store = store
    }
    onAdd = namesSpies.onAdd
    onRemove = namesSpies.onRemove
    applyVisibility = namesSpies.applyVisibility
    handleClickPublic = (...args: unknown[]) => {
      this._store.setLayer('names', !this._store.layers.names)
      return namesSpies.handleClickPublic(...args)
    }
  },
}))
const roadsSpies = vi.hoisted(() => ({
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  handleClickPublic: vi.fn(),
  applyVisibility: vi.fn(),
}))
vi.mock('@/components/shared/controls/roads/RoadsToggleControl', () => ({
  RoadsToggleControl: class {
    private _store: {
      setLayer: (key: string, visible: boolean) => void
      layers: { roads: boolean }
    }
    constructor(store: {
      setLayer: (key: string, visible: boolean) => void
      layers: { roads: boolean }
    }) {
      this._store = store
    }
    onAdd = roadsSpies.onAdd
    onRemove = roadsSpies.onRemove
    applyVisibility = roadsSpies.applyVisibility
    handleClickPublic = (...args: unknown[]) => {
      this._store.setLayer('roads', !this._store.layers.roads)
      return roadsSpies.handleClickPublic(...args)
    }
  },
}))

const MapLibreMapStub = defineComponent({
  name: 'MapLibreMap',
  props: {
    styleUrl: { type: String, default: '' },
    center: { type: Array, default: () => [] },
    zoom: { type: Number, default: 0 },
  },
  emits: ['map-created', 'style-loaded'],
  setup(_props, { emit }) {
    shared.emit = emit as (event: string, ...args: unknown[]) => void
    return () => h('div', { class: 'maplibre-stub' })
  },
})
const InertStub = defineComponent({ name: 'InertStub', setup: () => () => h('div') })

// Capture the props LandView passes to the side menu so the handlers can be
// invoked and the active-state props asserted.
let sideMenuProps: Record<string, unknown> | null = null
const LandSideMenuStub = defineComponent({
  name: 'LandSideMenu',
  props: [
    'zoomIn',
    'zoomOut',
    'goToLocation',
    'toggleRangeRings',
    'toggleAprs',
    'toggleNames',
    'rangeRingsActive',
    'aprsActive',
    'aprsSourceConfigured',
    'locationActive',
  ],
  setup(props) {
    sideMenuProps = props as unknown as Record<string, unknown>
    return () => h('div', { class: 'land-side-menu-stub' })
  },
})

import LandView from './LandView.vue'
import { useAppStore } from '@/stores/app'
import { useLandStore } from '@/stores/land'
import { useBasemapStore } from '@/stores/basemap'

const ONLINE_STYLE = '/assets/fiord-online.json'
const OFFLINE_STYLE = '/assets/fiord.json'

function makeFakeMap() {
  const container = document.createElement('div')
  return {
    setStyle: vi.fn(),
    getContainer: () => container,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 6),
    // Map-movement hooks + projection: the APRS and Sentry-site controls
    // regroup their markers whenever a movement settles.
    on: vi.fn(),
    off: vi.fn(),
    project: vi.fn(() => ({ x: 0, y: 0 })),
    easeTo: vi.fn(),
    // The shared location-names/roads controls query and restyle base-map layers.
    isStyleLoaded: vi.fn(() => true),
    once: vi.fn(),
    getLayer: vi.fn(() => undefined),
    setLayoutProperty: vi.fn(),
    _container: container,
  }
}

const LandFilterStub = defineComponent({
  name: 'LandFilterStub',
  setup: () => () => h('div', { class: 'land-filter-stub' }),
})

/** Stand in for the sidebar pane MapSidebar owns, which LandView teleports into. */
function teleportTarget(): void {
  const searchPane = document.createElement('div')
  searchPane.id = 'msb-pane-search'
  document.body.append(searchPane)
}

function mountView() {
  return mount(LandView, {
    global: {
      stubs: {
        MapLibreMap: MapLibreMapStub,
        NoUrlOverlay: InertStub,
        LandSideMenu: LandSideMenuStub,
        LandFilter: LandFilterStub,
      },
    },
  })
}

enableAutoUnmount(afterEach)

describe('LandView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // The APRS layer only runs when an SDR has been chosen as the APRS radio,
    // so the map-control cases start from a configured receiver; the gating
    // itself is exercised in its own cases below.
    useSdrStore().setAprsRadioId(1)
    vi.clearAllMocks()
    shared.emit = null
    shared.connectivityCb = null
    sideMenuProps = null
    ringsSpies.visible = false
    if (locationState.location) locationState.location.value = null
    localStorage.clear()
    document.body.innerHTML = ''
  })

  describe('teleport target', () => {
    it('teleports the APRS filter pane into the sidebar once it exists', () => {
      teleportTarget()
      mountView()
      // useSidebarPaneTarget('search') resolves synchronously when the pane is
      // already present, so the Teleport is active on first render.
      expect(document.querySelector('#msb-pane-search .land-filter-stub')).not.toBeNull()
    })

    it('does not teleport until the sidebar panes appear', () => {
      // No teleportTarget(): MapSidebar hasn't rendered its panes, so the
      // Teleport stays gated off and LandFilter never mounts.
      expect(() => mountView()).not.toThrow()
      expect(document.querySelector('.land-filter-stub')).toBeNull()
    })
  })

  describe('style selection', () => {
    it('seeds the UK-centred view with the online style when online', () => {
      const wrapper = mountView()
      const props = wrapper.findComponent(MapLibreMapStub).props()
      expect(props.styleUrl).toBe(ONLINE_STYLE)
      expect(props.center).toEqual([-2, 54])
      expect(props.zoom).toBe(6)
    })

    it('uses the offline style when offline', () => {
      const app = useAppStore()
      app.isOnline = false
      const wrapper = mountView()
      expect(wrapper.findComponent(MapLibreMapStub).props('styleUrl')).toBe(OFFLINE_STYLE)
    })
  })

  describe('style reconciliation on load', () => {
    it('reloads the style when connectivity flipped between create and load', async () => {
      const app = useAppStore()
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      app.isOnline = false
      await nextTick()
      shared.emit!('style-loaded', map)
      expect(map.setStyle).toHaveBeenCalledWith(OFFLINE_STYLE)
    })

    it('does not reload when connectivity was unchanged before load', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      shared.emit!('style-loaded', map)
      expect(map.setStyle).not.toHaveBeenCalled()
    })

    it('does not reload when no map-created preceded the style load', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('style-loaded', map)
      expect(map.setStyle).not.toHaveBeenCalled()
    })
  })

  describe('connectivity changes', () => {
    it('switches the style when connectivity drops after load', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      shared.connectivityCb!(false)
      expect(map.setStyle).toHaveBeenCalledWith(OFFLINE_STYLE)
      shared.connectivityCb!(true)
      expect(map.setStyle).toHaveBeenCalledWith(ONLINE_STYLE)
    })

    it('does nothing when the map is not yet created', () => {
      mountView()
      expect(() => shared.connectivityCb!(false)).not.toThrow()
    })
  })

  describe('map controls', () => {
    it('initialises the range-rings and APRS controls and hides the native corner', () => {
      const map = makeFakeMap()
      const native = document.createElement('div')
      native.className = 'maplibregl-ctrl-top-right'
      map._container.appendChild(native)
      mountView()
      shared.emit!('map-created', map)
      expect(ringsSpies.onAdd).toHaveBeenCalledWith(map)
      expect(aprsSpies.onAdd).toHaveBeenCalledWith(map)
      expect(native.style.display).toBe('none') // native controls hidden
      expect(locationState.start).toHaveBeenCalledOnce()
      expect(markerSpies.addTo).toHaveBeenCalledWith(map)
      expect(ctxMenuSpies.attach).toHaveBeenCalledWith(map) // right-click set-location enabled
    })

    it('detaches the right-click location menu on unmount', () => {
      const map = makeFakeMap()
      const wrapper = mountView()
      shared.emit!('map-created', map)
      wrapper.unmount()
      expect(ctxMenuSpies.detach).toHaveBeenCalledWith(map)
    })

    it('seeds the range-rings active state from the control', async () => {
      ringsSpies.visible = true
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      await nextTick()
      expect(sideMenuProps!.rangeRingsActive).toBe(true)
    })

    it('shows the APRS layer by default per the land.defaultLayers config', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      // Default config is ["aprs"], so the layer starts visible.
      expect(aprsSpies.setVisible).toHaveBeenCalledWith(true)
      expect(sideMenuProps!.aprsActive).toBe(true)
    })

    it('loads the default-layers config on mount', () => {
      const land = useLandStore()
      const spy = vi.spyOn(land, 'hydrateDefaultLayers').mockResolvedValue()
      mountView()
      expect(spy).toHaveBeenCalledOnce()
    })

    it('applies a later defaultLayers change to the APRS layer', async () => {
      const land = useLandStore()
      vi.spyOn(land, 'hydrateDefaultLayers').mockResolvedValue()
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      aprsSpies.setVisible.mockClear()
      land.defaultLayers = [] // config now hides APRS
      await nextTick()
      expect(aprsSpies.setVisible).toHaveBeenCalledWith(false)
      expect(sideMenuProps!.aprsActive).toBe(false)
    })

    it('zoom buttons drive the map', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      ;(sideMenuProps!.zoomIn as () => void)()
      ;(sideMenuProps!.zoomOut as () => void)()
      expect(map.zoomIn).toHaveBeenCalledOnce()
      expect(map.zoomOut).toHaveBeenCalledOnce()
    })

    it('go-to-location flies to the user location, zooming in to at least the locate zoom', () => {
      locationState.location!.value = { lat: 55, lon: -1.5, accuracy: 10 }
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      ;(sideMenuProps!.goToLocation as () => void)()
      expect(map.flyTo).toHaveBeenCalledWith({ center: [-1.5, 55], zoom: 10 })
    })

    it('go-to-location does nothing without a fix', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      ;(sideMenuProps!.goToLocation as () => void)()
      expect(map.flyTo).not.toHaveBeenCalled()
    })

    it('toggling range rings drives the control and flips its active state', async () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      expect(sideMenuProps!.rangeRingsActive).toBe(false)
      ;(sideMenuProps!.toggleRangeRings as () => void)()
      await nextTick()
      expect(ringsSpies.handleClickPublic).toHaveBeenCalledOnce()
      expect(sideMenuProps!.rangeRingsActive).toBe(true)
    })

    it('toggling APRS drives the control and flips its active state', async () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      expect(sideMenuProps!.aprsActive).toBe(true)
      ;(sideMenuProps!.toggleAprs as () => void)()
      await nextTick()
      expect(aprsSpies.handleClickPublic).toHaveBeenCalledOnce()
      expect(sideMenuProps!.aprsActive).toBe(false)
    })

    it('initialises the shared location-names and roads controls on the map', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      expect(namesSpies.onAdd).toHaveBeenCalledWith(map)
      expect(roadsSpies.onAdd).toHaveBeenCalledWith(map)
    })

    it('toggling place names drives the control and flips the shared basemap flag', async () => {
      const map = makeFakeMap()
      const basemapStore = useBasemapStore()
      mountView()
      shared.emit!('map-created', map)
      expect(basemapStore.layers.names).toBe(false)
      ;(sideMenuProps!.toggleNames as () => void)()
      await nextTick()
      expect(namesSpies.handleClickPublic).toHaveBeenCalledOnce()
      expect(basemapStore.layers.names).toBe(true)
    })

    it('does nothing when the base-map toggle fires before the map exists', () => {
      mountView()
      expect(() => (sideMenuProps!.toggleNames as () => void)()).not.toThrow()
      expect(namesSpies.handleClickPublic).not.toHaveBeenCalled()
    })

    it('re-asserts the base-map layer visibility on every style load', () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      namesSpies.applyVisibility.mockClear()
      roadsSpies.applyVisibility.mockClear()
      // A fresh style ships its own layer visibilities, so both must reapply.
      shared.emit!('style-loaded', map)
      expect(namesSpies.applyVisibility).toHaveBeenCalledOnce()
      expect(roadsSpies.applyVisibility).toHaveBeenCalledOnce()
      shared.emit!('style-loaded', map)
      expect(namesSpies.applyVisibility).toHaveBeenCalledTimes(2)
      expect(roadsSpies.applyVisibility).toHaveBeenCalledTimes(2)
    })

    it('updates the marker + range-rings centre when a location fix arrives', async () => {
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map) // controls now exist
      // A GPS fix arrives after the map + controls are ready (real-world order).
      locationState.location!.value = { lat: 55, lon: -1.5, accuracy: 10 }
      await nextTick()
      expect(markerSpies.update).toHaveBeenCalledWith(-1.5, 55)
      expect(ringsSpies.updateCenter).toHaveBeenCalledWith(-1.5, 55)
      expect(ringsSpies.setLocationAvailable).toHaveBeenCalledWith(true)
    })

    it('removes the marker when the location is cleared', async () => {
      locationState.location!.value = { lat: 55, lon: -1.5, accuracy: 10 }
      const map = makeFakeMap()
      mountView()
      shared.emit!('map-created', map)
      markerSpies.remove.mockClear()
      locationState.location!.value = null
      await nextTick()
      expect(markerSpies.remove).toHaveBeenCalled()
      expect(ringsSpies.setLocationAvailable).toHaveBeenCalledWith(false)
    })

    it('tears down the controls and marker on unmount', () => {
      const map = makeFakeMap()
      const wrapper = mountView()
      shared.emit!('map-created', map)
      wrapper.unmount()
      expect(ringsSpies.onRemove).toHaveBeenCalledOnce()
      expect(aprsSpies.onRemove).toHaveBeenCalledOnce()
      expect(namesSpies.onRemove).toHaveBeenCalledOnce()
      expect(roadsSpies.onRemove).toHaveBeenCalledOnce()
      expect(markerSpies.remove).toHaveBeenCalled()
    })

    it('unmounts cleanly when no map was ever created', () => {
      const wrapper = mountView()
      expect(() => wrapper.unmount()).not.toThrow()
    })
  })

  it('has no accessibility violations', async () => {
    const wrapper = mountView()
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })

  it('exposes a single screen-reader heading for the view', () => {
    const wrapper = mountView()
    const heading = wrapper.find('h1')
    expect(heading.exists()).toBe(true)
    expect(heading.classes()).toContain('sr-only')
    expect(heading.text()).toBe('Land domain')
  })
})

// The APRS layer only has data behind it when a radio is named as the APRS
// receiver in Settings → LAND. Without one the layer is forced off and its rail
// button disabled, rather than offering a toggle over a permanently empty map.
describe('LandView — APRS with no receiver', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSdrStore().setAprsRadioId(null)
    vi.clearAllMocks()
    shared.emit = null
    sideMenuProps = null
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('keeps the layer off and tells the rail there is no receiver', () => {
    const map = makeFakeMap()
    mountView()
    shared.emit!('map-created', map)

    expect(aprsSpies.setVisible).toHaveBeenCalledWith(false)
    expect(sideMenuProps!.aprsSourceConfigured).toBe(false)
  })

  it('ignores a toggle request while nothing is decoding', async () => {
    const map = makeFakeMap()
    mountView()
    shared.emit!('map-created', map)
    ;(sideMenuProps!.toggleAprs as () => void)()
    await nextTick()

    expect(aprsSpies.handleClickPublic).not.toHaveBeenCalled()
  })

  it('brings the layer back when a receiver is chosen', async () => {
    const map = makeFakeMap()
    mountView()
    shared.emit!('map-created', map)
    aprsSpies.setVisible.mockClear()

    useSdrStore().setAprsRadioId(3)
    await nextTick()

    expect(aprsSpies.setVisible).toHaveBeenCalledWith(true)
    expect(sideMenuProps!.aprsSourceConfigured).toBe(true)
  })

  it('drops the layer again if the receiver is cleared', async () => {
    useSdrStore().setAprsRadioId(3)
    const map = makeFakeMap()
    mountView()
    shared.emit!('map-created', map)
    aprsSpies.setVisible.mockClear()

    useSdrStore().setAprsRadioId(null)
    await nextTick()

    expect(aprsSpies.setVisible).toHaveBeenCalledWith(false)
  })

  it('reads the decoding radio back from the database on mount', () => {
    const spy = vi.spyOn(useSdrStore(), 'hydrateAprsFromDb').mockResolvedValue()
    mountView()
    expect(spy).toHaveBeenCalledOnce()
  })
})
