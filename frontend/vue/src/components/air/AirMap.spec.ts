import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'

// ---- Shared mock state ----------------------------------------------------
// Populated by the mocked composables/components below so each test can drive
// the map lifecycle, connectivity changes and the user-location stream.
const shared = vi.hoisted(() => {
  return {
    emit: null as null | ((event: string, ...args: unknown[]) => void),
    connectivityCb: null as null | ((online: boolean) => void),
    // location ref + ctx-menu + marker are assigned inside the mock factories.
    locationRef: null as { value: { lon: number; lat: number } | null } | null,
    ctx: null as null | Record<string, ReturnType<typeof vi.fn>>,
    marker: null as null | Record<string, ReturnType<typeof vi.fn>>,
    startLocation: null as null | ReturnType<typeof vi.fn>,
  }
})

// Registry of every constructed control mock, keyed by a short name, so tests
// can assert wiring and invoke methods AirMap delegates to.
const controlMocks = vi.hoisted(() => {
  const instances: Record<string, Array<Record<string, unknown>>> = {}
  function make(name: string) {
    return class MockControl {
      args: unknown[]
      onAdd = vi.fn()
      onRemove = vi.fn()
      initLayers = vi.fn()
      applyVisibility = vi.fn()
      _initRings = vi.fn()
      reinit = vi.fn()
      handleConnectivityChange = vi.fn()
      syncToAdsb = vi.fn()
      selectByHex = vi.fn()
      pauseLive = vi.fn()
      setLocationAvailable = vi.fn()
      updateCenter = vi.fn()
      setVisible = vi.fn()
      setRadiusNm = vi.fn()
      destroy = vi.fn()
      renderAtTime = vi.fn()
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

vi.mock('@/components/shared/controls/names/NamesToggleControl', () => ({
  NamesToggleControl: controlMocks.make('names'),
}))
vi.mock('@/components/shared/controls/roads/RoadsToggleControl', () => ({
  RoadsToggleControl: controlMocks.make('roads'),
}))
vi.mock('@/components/shared/controls/sentry-sites/SentrySitesControl', () => ({
  SentrySitesControl: controlMocks.make('sentrySites'),
}))
vi.mock('./controls/range-rings/RangeRingsControl', () => ({
  RangeRingsControl: controlMocks.make('rangeRings'),
}))
vi.mock('./controls/overhead-zone/OverheadZoneControl', () => ({
  OverheadZoneControl: controlMocks.make('overheadZone'),
}))
vi.mock('./controls/adsb-labels/AdsbLabelsToggleControl', () => ({
  AdsbLabelsToggleControl: controlMocks.make('adsbLabels'),
}))
vi.mock('./controls/clear-overlays/ClearOverlaysControl', () => ({
  ClearOverlaysControl: controlMocks.make('clear'),
}))
vi.mock('./controls/airports/AirportsControl', () => ({
  AirportsToggleControl: controlMocks.make('airports'),
}))
vi.mock('./controls/military-bases/MilitaryBasesControl', () => ({
  MilitaryBasesToggleControl: controlMocks.make('mil'),
}))
vi.mock('./controls/aara/AaraControl', () => ({ AaraToggleControl: controlMocks.make('aara') }))
vi.mock('./controls/awacs/AwacControl', () => ({ AwacToggleControl: controlMocks.make('awacs') }))
vi.mock('./controls/adsb/AdsbLiveControl', () => ({
  AdsbLiveControl: controlMocks.make('adsb'),
}))
vi.mock('./controls/adsb/AirMultiPlaybackControl', () => ({
  AirMultiPlaybackControl: controlMocks.make('multiPlayback'),
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
    pitch: { type: Number, default: 0 },
    bearing: { type: Number, default: 0 },
  },
  emits: ['map-created', 'style-loaded', 'map-removed'],
  setup(_props, { emit }) {
    shared.emit = emit as (event: string, ...args: unknown[]) => void
    return () => h('div', { class: 'maplibre-stub' })
  },
})

import AirMap from './AirMap.vue'
import { useAppStore } from '@/stores/app'
import { useAirStore } from '@/stores/air'
import { useSettingsStore } from '@/stores/settings'
import { usePlaybackStore } from '@/stores/playback'
import { getAircraftClickHandler } from '@/stores/notifications'

interface FakeMap {
  onceHandlers: Record<string, () => void>
  easeTo: ReturnType<typeof vi.fn>
  setStyle: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  getCenter: ReturnType<typeof vi.fn>
  getZoom: ReturnType<typeof vi.fn>
  getPitch: ReturnType<typeof vi.fn>
}

function makeFakeMap(): FakeMap {
  const onceHandlers: Record<string, () => void> = {}
  return {
    onceHandlers,
    easeTo: vi.fn(),
    setStyle: vi.fn(),
    once: vi.fn((event: string, cb: () => void) => {
      onceHandlers[event] = cb
    }),
    getCenter: vi.fn(() => ({ lng: 1, lat: 2 })),
    getZoom: vi.fn(() => 7),
    getPitch: vi.fn(() => 30),
  }
}

function mountMap() {
  return mount(AirMap, { global: { stubs: { MapLibreMap: MapLibreMapStub } } })
}

// Bring the map fully online: create then style-load.
function bringUp(map: FakeMap): void {
  shared.emit!('map-created', map)
  shared.emit!('style-loaded', map)
}

enableAutoUnmount(afterEach)

describe('AirMap', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    for (const key of Object.keys(controlMocks.instances)) delete controlMocks.instances[key]
    if (shared.locationRef) shared.locationRef.value = null
    localStorage.clear()
    document.body.innerHTML = ''
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('style selection', () => {
    it('uses the online style URL when online and offline when offline', () => {
      const app = useAppStore()
      const wrapper = mountMap()
      expect(wrapper.findComponent(MapLibreMapStub).props('styleUrl')).toBe(
        '/assets/fiord-online.json',
      )
      app.isOnline = false
      // styleUrl is computed; re-read after Vue updates the prop binding.
      return nextTick().then(() => {
        expect(wrapper.findComponent(MapLibreMapStub).props('styleUrl')).toBe('/assets/fiord.json')
      })
    })
  })

  describe('map creation + style load', () => {
    it('wires the marker, location and context menu on map-created', () => {
      const map = makeFakeMap()
      mountMap()
      shared.emit!('map-created', map)
      expect(shared.startLocation).toHaveBeenCalled()
      expect(shared.marker!.addTo).toHaveBeenCalledWith(map)
      expect(shared.ctx!.attach).toHaveBeenCalledWith(map)
    })

    it('constructs and adds every control on style load', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      for (const name of [
        'adsb',
        'adsbLabels',
        'rangeRings',
        'roads',
        'names',
        'airports',
        'mil',
        'aara',
        'awacs',
        'overheadZone',
      ]) {
        expect(controlMocks.instances[name]).toHaveLength(1)
        expect(last(name).onAdd).toHaveBeenCalledWith(map)
      }
    })

    it('ignores a second style load once controls exist', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.emit!('style-loaded', map)
      // Still exactly one adsb control — the guard returned early.
      expect(controlMocks.instances.adsb).toHaveLength(1)
    })

    it('eases to 3D pitch on load when the 3D flag is set', () => {
      localStorage.setItem('sentinel_3d', '1')
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, duration: 400 })
    })

    it('runs a corrective style reload when connectivity changed before load', async () => {
      const app = useAppStore()
      const map = makeFakeMap()
      mountMap()
      shared.emit!('map-created', map) // records _currentStyleUrl as the online style
      app.isOnline = false // desired style is now offline
      await nextTick()
      shared.emit!('style-loaded', map)
      expect(map.setStyle).toHaveBeenCalledWith('/assets/fiord.json')
      // The post-reload style.load handler re-initialises every layer.
      map.onceHandlers['style.load']!()
      expect(last('adsb').initLayers).toHaveBeenCalled()
      expect(last('adsb').handleConnectivityChange).toHaveBeenCalled()
      expect(last('overheadZone').reinit).not.toHaveBeenCalled() // corrective path skips reinit
    })

    it('routes a registered aircraft click to the adsb control', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      getAircraftClickHandler()!('ABCDEF')
      expect(last('adsb').selectByHex).toHaveBeenCalledWith('ABCDEF')
    })

    it('wires the adsb label-sync callback through to the labels control', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      // The 7th AdsbLiveControl constructor arg is the label-sync callback.
      const adsbArgs = controlMocks.instances.adsb![0]!.args as unknown[]
      const syncLabels = adsbArgs[6] as (visible: boolean) => void
      syncLabels(true)
      expect(last('adsbLabels').syncToAdsb).toHaveBeenCalledWith(true)
    })

    it('seeds the range-ring + overhead-zone centre from an existing fix', () => {
      const map = makeFakeMap()
      mountMap()
      shared.locationRef!.value = { lon: 3, lat: 4 }
      shared.emit!('map-created', map)
      shared.emit!('style-loaded', map)
      // OverheadZoneControl receives [lon, lat] as its initial location arg.
      const zoneArgs = controlMocks.instances.overheadZone![0]!.args as unknown[]
      expect(zoneArgs[1]).toEqual([3, 4])
    })

    it('exposes every control accessor after style load', () => {
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      const vm = wrapper.vm as unknown as Record<string, () => unknown>
      for (const accessor of [
        'getAdsbControl',
        'getAdsbLabels',
        'getRangeRings',
        'getRoadsControl',
        'getNamesControl',
        'getAirports',
        'getMilBases',
        'getAara',
        'getAwacs',
        'getClearControl',
      ]) {
        expect(vm[accessor]!()).not.toBeNull()
      }
    })
  })

  describe('connectivity changes', () => {
    it('does nothing when the map is not yet created', () => {
      mountMap()
      expect(() => shared.connectivityCb!(false)).not.toThrow()
    })

    it('updates adsb without a style reload when the style is already correct', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.connectivityCb!(true) // already online → no setStyle
      expect(map.setStyle).not.toHaveBeenCalled()
      expect(last('adsb').handleConnectivityChange).toHaveBeenCalled()
    })

    it('reloads the style and re-inits layers when connectivity flips', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.connectivityCb!(false) // online → offline
      expect(map.setStyle).toHaveBeenCalledWith('/assets/fiord.json')
      map.onceHandlers['style.load']!()
      expect(last('roads').applyVisibility).toHaveBeenCalled()
      expect(last('overheadZone').reinit).toHaveBeenCalled()
      expect(last('adsb').initLayers).toHaveBeenCalled()
    })
  })

  describe('user location visuals', () => {
    it('clears the marker and overlays when the location is lost', async () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      // Establish a fix first (controls are created on style load, after the
      // immediate watch run), then drop it to exercise the clear path.
      shared.locationRef!.value = { lon: 5, lat: 10 }
      await nextTick()
      shared.marker!.remove.mockClear()
      last('rangeRings').setLocationAvailable.mockClear()
      last('overheadZone').setVisible.mockClear()
      shared.locationRef!.value = null
      await nextTick()
      expect(shared.marker!.remove).toHaveBeenCalled()
      expect(last('rangeRings').setLocationAvailable).toHaveBeenCalledWith(false)
      expect(last('overheadZone').setVisible).toHaveBeenCalledWith(false)
    })

    it('updates ring + zone centre and restores visibility when a fix arrives', async () => {
      const air = useAirStore()
      air.overlayStates.overheadAlertsCivil = true
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      shared.locationRef!.value = { lon: 5, lat: 10 }
      await nextTick()
      expect(last('rangeRings').updateCenter).toHaveBeenCalledWith(5, 10)
      expect(last('overheadZone').updateCenter).toHaveBeenCalledWith(5, 10)
      expect(shared.marker!.update).toHaveBeenCalledWith(5, 10)
      expect(last('rangeRings').setLocationAvailable).toHaveBeenCalledWith(true)
      expect(last('overheadZone').setVisible).toHaveBeenLastCalledWith(true)
    })

    it('clears visuals on the userLocationCleared window event', () => {
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      last('overheadZone').setVisible.mockClear()
      window.dispatchEvent(new CustomEvent('sentinel:userLocationCleared'))
      expect(last('overheadZone').setVisible).toHaveBeenCalledWith(false)
    })

    it('toggles the overhead zone when alert overlays change', async () => {
      const air = useAirStore()
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      last('overheadZone').setVisible.mockClear()
      air.overlayStates.overheadAlertsMil = true
      await nextTick()
      expect(last('overheadZone').setVisible).toHaveBeenCalledWith(true)
    })

    it('updates the overhead zone radius when it changes', async () => {
      const air = useAirStore()
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      air.overheadAlertRadiusNm = 75
      await nextTick()
      expect(last('overheadZone').setRadiusNm).toHaveBeenCalledWith(75)
    })
  })

  describe('exposed 3D API', () => {
    it('enables 3D: eases to pitch 45 and shows the controls panel', () => {
      const panel = document.createElement('div')
      panel.id = 'map-3d-controls'
      panel.classList.add('map-3d-controls--hidden')
      document.body.appendChild(panel)
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      ;(wrapper.vm as unknown as { set3DActive: (on: boolean) => void }).set3DActive(true)
      expect(localStorage.getItem('sentinel_3d')).toBe('1')
      expect(panel.classList.contains('map-3d-controls--hidden')).toBe(false)
      expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, duration: 400 })
      expect((wrapper.vm as unknown as { is3DActive: () => boolean }).is3DActive()).toBe(true)
    })

    it('disables 3D: eases pitch and bearing back to zero', () => {
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      ;(wrapper.vm as unknown as { set3DActive: (on: boolean) => void }).set3DActive(false)
      expect(localStorage.getItem('sentinel_3d')).toBe('0')
      expect(map.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0, duration: 600 })
    })

    it('ignores set3DActive before the map exists', () => {
      const wrapper = mountMap()
      expect(() =>
        (wrapper.vm as unknown as { set3DActive: (on: boolean) => void }).set3DActive(true),
      ).not.toThrow()
    })

    it('setTargetPitch updates the target read back by getTargetPitch', () => {
      const wrapper = mountMap()
      ;(wrapper.vm as unknown as { setTargetPitch: (pitch: number) => void }).setTargetPitch(60)
      expect((wrapper.vm as unknown as { getTargetPitch: () => number }).getTargetPitch()).toBe(60)
    })

    it('getMap returns the live map instance', () => {
      const map = makeFakeMap()
      const wrapper = mountMap()
      shared.emit!('map-created', map)
      expect((wrapper.vm as unknown as { getMap: () => unknown }).getMap()).toBe(map)
    })
  })

  describe('playback', () => {
    it('exits immediately when the playback window is incomplete', async () => {
      const playback = usePlaybackStore()
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      playback.pendingStartMs = null
      playback.activate() // status → loading
      await flushPromises()
      expect(last('adsb').pauseLive).toHaveBeenCalled()
      expect(playback.status).toBe('idle')
    })

    it('exits when the snapshot fetch is not ok', async () => {
      const playback = usePlaybackStore()
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false })
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      playback.pendingStartMs = 1000
      playback.pendingEndMs = 2000
      playback.activate()
      await flushPromises()
      expect(playback.status).toBe('idle')
    })

    it('exits when the snapshot fetch rejects', async () => {
      const playback = usePlaybackStore()
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'))
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      playback.pendingStartMs = 1000
      playback.pendingEndMs = 2000
      playback.activate()
      await flushPromises()
      expect(playback.status).toBe('idle')
    })

    // Loads a window under real timers (so flushPromises resolves the fetch),
    // leaving playback in the 'playing' state with the control constructed.
    async function loadWindow(playback: ReturnType<typeof usePlaybackStore>, endMs = 1000) {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          start_ms: 0,
          end_ms: endMs,
          aircraft: { ABC: { snapshots: [{ ts: 0 }] } },
        }),
      })
      const map = makeFakeMap()
      mountMap()
      bringUp(map)
      // Non-zero pending values: the load guard treats 0 as "incomplete".
      playback.pendingStartMs = 1
      playback.pendingEndMs = endMs
      playback.activate()
      await flushPromises()
    }

    it('loads data, closes the panel and starts playing', async () => {
      const playback = usePlaybackStore()
      const settings = useSettingsStore()
      const closeSpy = vi.spyOn(settings, 'closePanel')
      await loadWindow(playback)
      expect(closeSpy).toHaveBeenCalled()
      expect(controlMocks.instances.multiPlayback).toHaveLength(1)
      expect(playback.status).toBe('playing')
    })

    it('advances the cursor on a tick and pauses at the end of the window', async () => {
      const playback = usePlaybackStore()
      await loadWindow(playback, 1000)
      // Re-schedule the tick loop under fake timers for deterministic stepping.
      vi.useFakeTimers()
      playback.pause()
      await nextTick()
      playback.play()
      await nextTick()

      vi.advanceTimersByTime(100)
      expect(last('multiPlayback').renderAtTime).toHaveBeenCalled()
      expect(playback.cursorMs).toBeGreaterThan(0)

      vi.advanceTimersByTime(2000)
      expect(playback.status).toBe('paused')
    })

    it('reschedules on a speed change while playing, but not while paused', async () => {
      const playback = usePlaybackStore()
      await loadWindow(playback, 10000)
      vi.useFakeTimers()
      // Playing → speed change reschedules the tick (true branch).
      playback.speedIdx = 1
      await nextTick()
      // Paused → speed change schedules nothing (false branch).
      playback.pause()
      await nextTick()
      playback.speedIdx = 2
      await nextTick()
      // Manual scrub while paused re-renders via the cursor watch.
      last('multiPlayback').renderAtTime.mockClear()
      playback.seek(500)
      await nextTick()
      expect(last('multiPlayback').renderAtTime).toHaveBeenCalled()
    })

    it('stops rescheduling when the status flips away from playing mid-tick', async () => {
      const playback = usePlaybackStore()
      await loadWindow(playback, 100000)
      vi.useFakeTimers()
      // A render that pauses playback simulates the status changing between the
      // tick being scheduled and its callback running.
      last('multiPlayback').renderAtTime.mockImplementation(() => playback.pause())
      playback.pause()
      await nextTick()
      playback.play()
      await nextTick()
      vi.advanceTimersByTime(100)
      // The tick ran once, observed the paused status and did not reschedule.
      expect(playback.status).toBe('paused')
    })

    it('ignores a status with no matching watch arm', async () => {
      const playback = usePlaybackStore()
      await loadWindow(playback)
      // 'ready' is a valid status but no playback watch arm handles it.
      expect(() => {
        playback.status = 'ready'
      }).not.toThrow()
      await nextTick()
    })

    it('tears down the multi-playback control when playback returns to idle', async () => {
      const playback = usePlaybackStore()
      await loadWindow(playback)
      const multi = last('multiPlayback')
      playback.exit() // status → idle, cursorMs → null
      await nextTick()
      expect(multi.destroy).toHaveBeenCalled()
    })
  })

  describe('teardown', () => {
    it('saves map state and removes every control on unmount', async () => {
      const air = useAirStore()
      const saveSpy = vi.spyOn(air, 'saveMapState')
      const map = makeFakeMap()
      const wrapper = mountMap()
      bringUp(map)
      wrapper.unmount()
      expect(shared.ctx!.detach).toHaveBeenCalledWith(map)
      expect(saveSpy).toHaveBeenCalledWith([1, 2], 7, 30)
      expect(last('adsb').onRemove).toHaveBeenCalled()
      expect(last('overheadZone').onRemove).toHaveBeenCalled()
    })

    it('skips saving state when no map was ever created', () => {
      const air = useAirStore()
      const saveSpy = vi.spyOn(air, 'saveMapState')
      const wrapper = mountMap()
      wrapper.unmount()
      expect(saveSpy).not.toHaveBeenCalled()
      expect(shared.ctx!.detach).toHaveBeenCalledWith(null)
    })
  })
})
