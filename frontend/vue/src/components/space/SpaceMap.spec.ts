import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'

// ---- Shared mock state ----------------------------------------------------
const shared = vi.hoisted(() => ({
  emit: null as null | ((event: string, ...args: unknown[]) => void),
  connectivityCb: null as null | ((online: boolean) => void),
  locationRef: null as { value: { lon: number; lat: number } | null } | null,
  ctx: null as null | Record<string, ReturnType<typeof vi.fn>>,
  marker: null as null | Record<string, ReturnType<typeof vi.fn>>,
  startLocation: null as null | ReturnType<typeof vi.fn>,
}))

// Registry of constructed control mocks, keyed by short name.
const controlMocks = vi.hoisted(() => {
  const instances: Record<string, Array<Record<string, unknown>>> = {}
  function make(name: string) {
    return class MockControl {
      args: unknown[]
      onAdd = vi.fn()
      onRemove = vi.fn()
      initLayers = vi.fn()
      applyVisibility = vi.fn()
      toggleDaynight = vi.fn()
      focusSatellite = vi.fn()
      constructor(...args: unknown[]) {
        this.args = args
        ;(instances[name] ||= []).push(this as unknown as Record<string, unknown>)
      }
    }
  }
  return { instances, make }
})

function last(name: string): Record<string, ReturnType<typeof vi.fn>> {
  const arr = controlMocks.instances[name]!
  return arr[arr.length - 1] as unknown as Record<string, ReturnType<typeof vi.fn>>
}

vi.mock('./controls/satellite/SatelliteControl', () => ({
  SatelliteControl: controlMocks.make('satellite'),
}))
vi.mock('./controls/daynight/DaynightControl', () => ({
  DaynightControl: controlMocks.make('daynight'),
}))
vi.mock('@/components/shared/controls/names/NamesToggleControl', () => ({
  NamesToggleControl: controlMocks.make('names'),
}))

vi.mock('@/components/shared/UserLocationMarker', () => ({
  UserLocationMarker: class {
    addTo = vi.fn()
    remove = vi.fn()
    update = vi.fn()
    constructor() {
      shared.marker = this as unknown as Record<string, ReturnType<typeof vi.fn>>
    }
  },
}))

vi.mock('@/composables/useConnectivity', () => ({
  useConnectivity: (cb: (online: boolean) => void) => {
    shared.connectivityCb = cb
  },
}))

vi.mock('@/composables/useUserLocation', async () => {
  const { ref } = await import('vue')
  const location = ref<{ lon: number; lat: number } | null>(null)
  shared.locationRef = location as unknown as { value: { lon: number; lat: number } | null }
  return {
    useUserLocation: () => {
      shared.startLocation = vi.fn()
      return { location, start: shared.startLocation }
    },
  }
})

vi.mock('@/composables/useMapContextMenu', () => ({
  useMapContextMenu: () => {
    const ctx = { attach: vi.fn(), detach: vi.fn(), remove: vi.fn(), show: vi.fn() }
    shared.ctx = ctx
    return ctx
  },
}))

// MapLibreMap stub: captures `emit` so tests drive map-created / style-loaded.
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

import SpaceMap from './SpaceMap.vue'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import { getSatelliteClickHandler } from '@/stores/notifications'

interface FakeMap {
  onceHandlers: Record<string, () => void>
  setStyle: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  flyTo: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  addControl: ReturnType<typeof vi.fn>
  getContainer: ReturnType<typeof vi.fn>
  ctrlEl: HTMLElement | null
}

function makeFakeMap(withCtrlEl = true): FakeMap {
  const onceHandlers: Record<string, () => void> = {}
  const ctrlEl = withCtrlEl ? document.createElement('div') : null
  const container = {
    querySelector: (sel: string) => (sel === '.maplibregl-ctrl-top-right' ? ctrlEl : null),
  }
  return {
    onceHandlers,
    ctrlEl,
    setStyle: vi.fn(),
    once: vi.fn((event: string, cb: () => void) => {
      onceHandlers[event] = cb
    }),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 4),
    getCenter: vi.fn(() => ({ lng: 1, lat: 2 })),
    addControl: vi.fn(),
    getContainer: vi.fn(() => container),
  }
}

function mountMap() {
  return mount(SpaceMap, { global: { stubs: { MapLibreMap: MapLibreMapStub } } })
}

// Bring the map up: create then style-load.
function bringUp(map: FakeMap): void {
  shared.emit!('map-created', map)
  shared.emit!('style-loaded', map)
}

enableAutoUnmount(afterEach)

describe('SpaceMap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    for (const key of Object.keys(controlMocks.instances)) delete controlMocks.instances[key]
    if (shared.locationRef) shared.locationRef.value = null
    localStorage.clear()
    document.body.innerHTML = ''
  })

  describe('style selection', () => {
    it('uses the online style when online and offline when offline', async () => {
      const app = useAppStore()
      const wrapper = mountMap()
      expect(wrapper.findComponent(MapLibreMapStub).props('styleUrl')).toBe(
        '/assets/fiord-online.json',
      )
      app.isOnline = false
      await nextTick()
      expect(wrapper.findComponent(MapLibreMapStub).props('styleUrl')).toBe('/assets/fiord.json')
    })

    it('seeds centre and zoom from the store, falling back to defaults', () => {
      const wrapper = mountMap()
      const props = wrapper.findComponent(MapLibreMapStub).props()
      expect(props.center).toEqual([0, 30])
      expect(props.zoom).toBe(2)
    })
  })

  describe('map creation', () => {
    it('wires the marker, location and context menu on map-created', () => {
      const map = makeFakeMap()
      mountMap()
      shared.emit!('map-created', map)
      expect(shared.startLocation).toHaveBeenCalled()
      expect(shared.marker!.addTo).toHaveBeenCalledWith(map)
      expect(shared.ctx!.attach).toHaveBeenCalledWith(map)
    })
  })

  describe('style load', () => {
    it('constructs and adds the three controls and hides the native control container', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      for (const name of ['satellite', 'daynight', 'names']) {
        expect(controlMocks.instances[name]).toHaveLength(1)
      }
      expect(map.addControl).toHaveBeenCalledTimes(3)
      expect(map.ctrlEl!.style.display).toBe('none')
    })

    it('tolerates a missing native control container', () => {
      const map = makeFakeMap(false)
      mountMap()
      expect(() => bringUp(map)).not.toThrow()
    })

    it('exposes the satellite control reactively after a tick', async () => {
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      await nextTick()
      const vm = wrapper.vm as unknown as { satelliteControlReactive: unknown }
      expect(vm.satelliteControlReactive).not.toBeNull()
    })

    it('ignores a second style load once the controls exist', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.emit!('style-loaded', map)
      expect(controlMocks.instances.satellite).toHaveLength(1)
    })

    it('passes a getUserLocation accessor that reflects the current fix', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      // 4th SatelliteControl constructor arg is the getUserLocation accessor.
      const satelliteArgs = controlMocks.instances.satellite![0]!.args as unknown[]
      const getUserLocation = satelliteArgs[3] as () => [number, number] | null
      expect(getUserLocation()).toBeNull()
      shared.locationRef!.value = { lon: 7, lat: 8 }
      expect(getUserLocation()).toEqual([7, 8])
    })

    it('routes a registered satellite click to focusSatellite', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      getSatelliteClickHandler()!('25544', 'ISS')
      expect(last('satellite').focusSatellite).toHaveBeenCalledWith('25544', 'ISS')
    })

    it('runs a corrective style reload when connectivity changed before load', async () => {
      const app = useAppStore()
      const map = makeFakeMap()
      mountMap()
      shared.emit!('map-created', map) // records initial style as online
      app.isOnline = false // desired style now offline
      await nextTick()
      shared.emit!('style-loaded', map)
      expect(map.setStyle).toHaveBeenCalledWith('/assets/fiord.json')
      // The post-reload handler re-inits all layers.
      map.onceHandlers['style.load']!()
      expect(last('daynight').initLayers).toHaveBeenCalled()
      expect(last('names').applyVisibility).toHaveBeenCalled()
      expect(last('satellite').initLayers).toHaveBeenCalled()
    })

    it('does not reload the style when connectivity was unchanged before load', () => {
      const map = makeFakeMap()
      mountMap()
      shared.emit!('map-created', map)
      shared.emit!('style-loaded', map)
      expect(map.setStyle).not.toHaveBeenCalled()
    })
  })

  describe('connectivity changes', () => {
    it('does nothing when the map is not yet created', () => {
      mountMap()
      expect(() => shared.connectivityCb!(false)).not.toThrow()
    })

    it('reloads the style and re-inits layers when connectivity flips', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.connectivityCb!(false)
      expect(map.setStyle).toHaveBeenCalledWith('/assets/fiord.json')
      map.onceHandlers['style.load']!()
      expect(last('daynight').initLayers).toHaveBeenCalled()
      expect(last('names').applyVisibility).toHaveBeenCalled()
      expect(last('satellite').initLayers).toHaveBeenCalled()
    })

    it('switches to the online style when connectivity comes back online', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.connectivityCb!(true)
      expect(map.setStyle).toHaveBeenCalledWith('/assets/fiord-online.json')
    })
  })

  describe('user location visuals', () => {
    it('updates the marker when a fix arrives', async () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.locationRef!.value = { lon: 5, lat: 10 }
      await nextTick()
      expect(shared.marker!.update).toHaveBeenCalledWith(5, 10)
    })

    it('clears the marker when the fix is lost', async () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.locationRef!.value = { lon: 5, lat: 10 }
      await nextTick()
      shared.marker!.remove.mockClear()
      shared.locationRef!.value = null
      await nextTick()
      expect(shared.marker!.remove).toHaveBeenCalled()
    })

    it('clears the marker on the userLocationCleared window event', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.marker!.remove.mockClear()
      window.dispatchEvent(new CustomEvent('sentinel:userLocationCleared'))
      expect(shared.marker!.remove).toHaveBeenCalled()
    })
  })

  describe('go-to-location', () => {
    it('flies to the fix when both map and location exist', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.locationRef!.value = { lon: 8, lat: 9 }
      document.dispatchEvent(new CustomEvent('space-go-to-location'))
      expect(map.flyTo).toHaveBeenCalledWith({ center: [8, 9], zoom: 5 })
    })

    it('does nothing without a fix', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      document.dispatchEvent(new CustomEvent('space-go-to-location'))
      expect(map.flyTo).not.toHaveBeenCalled()
    })

    it('does nothing before the map exists', () => {
      mountMap()
      shared.locationRef!.value = { lon: 8, lat: 9 }
      expect(() => document.dispatchEvent(new CustomEvent('space-go-to-location'))).not.toThrow()
    })
  })

  describe('teardown', () => {
    it('saves map state and removes the controls on unmount', () => {
      const space = useSpaceStore()
      const saveSpy = vi.spyOn(space, 'saveMapState')
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      wrapper.unmount()
      expect(shared.ctx!.detach).toHaveBeenCalledWith(map)
      expect(saveSpy).toHaveBeenCalledWith([1, 2], 4)
      // The satellite click handler is cleared on teardown.
      expect(getSatelliteClickHandler()).toBeNull()
    })

    it('skips saving state when no map was created', () => {
      const space = useSpaceStore()
      const saveSpy = vi.spyOn(space, 'saveMapState')
      const wrapper = mountMap()
      wrapper.unmount()
      expect(saveSpy).not.toHaveBeenCalled()
      expect(shared.ctx!.detach).toHaveBeenCalledWith(null)
    })
  })

  describe('exposed accessors', () => {
    it('returns the live control instances and map', () => {
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      const vm = wrapper.vm as unknown as Record<string, () => unknown>
      expect(vm.getSatelliteControl()).not.toBeNull()
      expect(vm.getDaynightControl()).not.toBeNull()
      expect(vm.getNamesControl()).not.toBeNull()
      expect(vm.getMap()).toBe(map)
    })
  })
})
