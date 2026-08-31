<template>
  <MapLibreMap
    ref="mapRef"
    :style-url="styleUrl"
    region-label="Air domain map — live aircraft"
    region-description="Interactive map of live aircraft. The same aircraft are also listed, with full details and keyboard access, in the Search panel of the map sidebar."
    :center="airStore.mapCenter ?? [-2, 54]"
    :zoom="airStore.mapZoom ?? 6"
    :pitch="airStore.pitch"
    @map-created="onMapCreated"
    @style-loaded="onStyleLoaded"
  />
</template>

<script setup lang="ts">
// IMPORTANT: Map instance is stored in a plain variable — never in ref/reactive.
// All IControl subclasses receive Pinia store refs instead of window.* globals.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Map as MapLibreGlMap } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useAirStore } from '@/stores/air'
import { useBasemapStore } from '@/stores/basemap'
import { useNotificationsStore, registerAircraftClickHandler } from '@/stores/notifications'
import { useAirNotifStore } from '@/stores/airNotif'
import { useTrackingStore } from '@/stores/tracking'
import { useSettingsStore } from '@/stores/settings'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useConnectivity } from '@/composables/useConnectivity'
import { useUserLocation } from '@/composables/useUserLocation'
import { useMapContextMenu } from '@/composables/useMapContextMenu'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'

import { NamesToggleControl } from '@/components/shared/controls/names/NamesToggleControl'
import { SentrySitesControl } from '@/components/shared/controls/sentry-sites/SentrySitesControl'
import { RoadsToggleControl } from '@/components/shared/controls/roads/RoadsToggleControl'
import { RangeRingsControl } from './controls/range-rings/RangeRingsControl'
import { OverheadZoneControl } from './controls/overhead-zone/OverheadZoneControl'
import { AdsbLabelsToggleControl } from './controls/adsb-labels/AdsbLabelsToggleControl'
import { ClearOverlaysControl } from './controls/clear-overlays/ClearOverlaysControl'
import { AirportsToggleControl } from './controls/airports/AirportsControl'
import { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'
import { AaraToggleControl } from './controls/aara/AaraControl'
import { AwacToggleControl } from './controls/awacs/AwacControl'
import { AdsbLiveControl } from './controls/adsb/AdsbLiveControl'
import { AirMultiPlaybackControl } from './controls/adsb/AirMultiPlaybackControl'
import { usePlaybackStore, PLAYBACK_SPEEDS } from '@/stores/playback'

const appStore = useAppStore()
const airStore = useAirStore()
const basemapStore = useBasemapStore()
const notificationsStore = useNotificationsStore()
const airNotifStore = useAirNotifStore()
const trackingStore = useTrackingStore()
const settingsStore = useSettingsStore()
const playbackStore = usePlaybackStore()
const sentrySitesStore = useSentrySitesStore()

const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

const STYLE_ONLINE = '/assets/fiord-online.json'
const STYLE_OFFLINE = '/assets/fiord.json'

const styleUrl = computed(() => (appStore.isOnline ? STYLE_ONLINE : STYLE_OFFLINE))

// 3D state — plain variables, never reactive
let _tiltActive = localStorage.getItem('sentinel_3d') === '1'
let _targetPitch = _tiltActive ? 45 : 0

const is3DActive = () => _tiltActive
const getTargetPitch = () => _targetPitch

// User location
const { location: userLocation, start: startLocation } = useUserLocation()
const getUserLocation = (): [number, number] | null =>
  userLocation.value ? [userLocation.value.lon, userLocation.value.lat] : null

const _locationMarker = new UserLocationMarker('user-location-marker')

const ctxMenu = useMapContextMenu()

// Cached map instance — plain variable, never reactive
let _map: MapLibreGlMap | null = null
let _currentStyleUrl: string | null = null
let _multiPlaybackControl: AirMultiPlaybackControl | null = null
let _playbackTimer: ReturnType<typeof setTimeout> | null = null

// Control instances — plain variables, initialised in onStyleLoaded
let adsbControl: AdsbLiveControl | null = null
let adsbLabelsControl: AdsbLabelsToggleControl | null = null
let rangeRingsControl: RangeRingsControl | null = null
let overheadZoneControl: OverheadZoneControl | null = null
let roadsControl: RoadsToggleControl | null = null
let namesControl: NamesToggleControl | null = null
let airportsControl: AirportsToggleControl | null = null
let militaryBasesControl: MilitaryBasesToggleControl | null = null
let aaraControl: AaraToggleControl | null = null
let awacsControl: AwacToggleControl | null = null
let clearControl: ClearOverlaysControl | null = null
// Sentry sites are plotted on every domain map, not just this one — see
// SentrySitesControl. No side-menu button: the sites are always shown.
let sentrySitesControl: SentrySitesControl | null = null

// Expose for AirSideMenu
const getAdsbControl = () => adsbControl
const getAdsbLabels = () => adsbLabelsControl
const getRangeRings = () => rangeRingsControl
const getRoadsControl = () => roadsControl
const getNamesControl = () => namesControl
const getAirports = () => airportsControl
const getMilBases = () => militaryBasesControl
const getAara = () => aaraControl
const getAwacs = () => awacsControl
const getClearControl = () => clearControl

defineExpose({
  getAdsbControl,
  getAdsbLabels,
  getRangeRings,
  getRoadsControl,
  getNamesControl,
  getAirports,
  getMilBases,
  getAara,
  getAwacs,
  getClearControl,
  is3DActive,
  getTargetPitch,
  set3DActive(active: boolean) {
    const m = _map
    if (!m) return
    _tiltActive = active
    localStorage.setItem('sentinel_3d', active ? '1' : '0')
    const panel3d = document.getElementById('map-3d-controls')
    if (panel3d) panel3d.classList.toggle('map-3d-controls--hidden', !active)
    if (active) {
      _targetPitch = 45
      m.easeTo({ pitch: 45, duration: 400 })
    } else {
      _targetPitch = 0
      m.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
  },
  setTargetPitch(p: number) {
    _targetPitch = p
  },
  getMap: () => _map,
})

useConnectivity((online) => {
  const m = _map
  if (!m) return
  const targetStyle = online ? STYLE_ONLINE : STYLE_OFFLINE
  if (_currentStyleUrl === targetStyle) {
    // Style already correct — just update adsb state without a reload
    adsbControl?.handleConnectivityChange()
    return
  }
  _currentStyleUrl = targetStyle
  m.setStyle(targetStyle)
  // Re-init layers after style reload, clear aircraft
  m.once('style.load', () => {
    roadsControl?.applyVisibility()
    namesControl?.applyVisibility()
    rangeRingsControl?._initRings()
    overheadZoneControl?.reinit()
    airportsControl?.initLayers()
    militaryBasesControl?.initLayers()
    aaraControl?.initLayers()
    awacsControl?.initLayers()
    adsbControl?.initLayers()
    adsbControl?.handleConnectivityChange()
  })
})

function onMapCreated(m: MapLibreGlMap) {
  _map = m
  _currentStyleUrl = styleUrl.value
  startLocation()
  _locationMarker.addTo(m)
  ctxMenu.attach(m)
}

function onStyleLoaded(m: MapLibreGlMap) {
  if (adsbControl) return // already initialised (style reload handled by connectivity hook)

  adsbLabelsControl = new AdsbLabelsToggleControl(airStore, null)

  adsbControl = new AdsbLiveControl(
    airStore,
    notificationsStore,
    trackingStore,
    airNotifStore,
    is3DActive,
    getTargetPitch,
    (v: boolean) => adsbLabelsControl?.syncToAdsb(v),
  )

  // Wire labels back to adsb
  ;(adsbLabelsControl as unknown as { _adsbControl: AdsbLiveControl | null })._adsbControl =
    adsbControl

  rangeRingsControl = new RangeRingsControl(airStore, getUserLocation)
  const initialLoc = getUserLocation()
  overheadZoneControl = new OverheadZoneControl(
    airStore.overlayStates.overheadAlertsCivil || airStore.overlayStates.overheadAlertsMil,
    initialLoc,
    airStore.overheadAlertRadiusNm,
  )
  // Overhead-alert detection runs app-wide in useAirAlertsService (fires from
  // any section). AirMap keeps only the visual OverheadZoneControl ring. We
  // still register the aircraft-click handler so clicking an overhead alert
  // selects the plane while the Air map is mounted.
  registerAircraftClickHandler((hex: string) => {
    adsbControl?.selectByHex(hex)
  })
  roadsControl = new RoadsToggleControl(basemapStore)
  namesControl = new NamesToggleControl(basemapStore)
  airportsControl = new AirportsToggleControl(airStore)
  militaryBasesControl = new MilitaryBasesToggleControl(airStore, is3DActive)
  aaraControl = new AaraToggleControl(airStore)
  awacsControl = new AwacToggleControl(airStore)

  clearControl = new ClearOverlaysControl({
    adsb: adsbControl,
    adsbLabels: adsbLabelsControl,
    roads: roadsControl,
    names: namesControl,
    rangeRings: rangeRingsControl,
    airports: airportsControl,
    militaryBases: militaryBasesControl,
    aara: aaraControl,
    awacs: awacsControl,
  })

  // Initialise each control (onAdd sets this.map and triggers layer/source setup).
  // The returned container elements are discarded — AirSideMenu owns the UI buttons.
  adsbControl.onAdd(m)
  adsbLabelsControl.onAdd(m)
  rangeRingsControl.onAdd(m)
  roadsControl.onAdd(m)
  namesControl.onAdd(m)
  airportsControl.onAdd(m)
  militaryBasesControl.onAdd(m)
  aaraControl.onAdd(m)
  awacsControl.onAdd(m)
  overheadZoneControl.onAdd(m)
  sentrySitesControl = new SentrySitesControl(sentrySitesStore, settingsStore, {
    // The operator's own position joins the grouping pass, so a Sentry sitting
    // on top of it collapses into a count instead of two marks smearing
    // together; the marker is handed over so the count can stand in for it.
    getUserLocation,
    userMarker: _locationMarker,
  })
  sentrySitesControl.onAdd(m)

  // Restore 3D pitch after initial load
  if (_tiltActive) m.easeTo({ pitch: 45, duration: 400 })

  // If connectivity mode changed between map creation and style load (e.g. the offgrid
  // probe fired before _map was set so the callback was a no-op), the map has loaded
  // the wrong style. Trigger a corrective reload now that controls are initialised.
  const desiredStyle = styleUrl.value
  if (_currentStyleUrl !== desiredStyle) {
    _currentStyleUrl = desiredStyle
    m.setStyle(desiredStyle)
    m.once('style.load', () => {
      roadsControl?.applyVisibility()
      namesControl?.applyVisibility()
      rangeRingsControl?._initRings()
      airportsControl?.initLayers()
      militaryBasesControl?.initLayers()
      aaraControl?.initLayers()
      awacsControl?.initLayers()
      adsbControl?.initLayers()
      adsbControl?.handleConnectivityChange()
    })
  }
}

async function _loadMultiPlayback(): Promise<void> {
  if (!adsbControl || !_map || !playbackStore.pendingStartMs || !playbackStore.pendingEndMs) {
    playbackStore.exit()
    return
  }
  try {
    const resp = await fetch(
      `/api/air/snapshots?start_ms=${playbackStore.pendingStartMs}&end_ms=${playbackStore.pendingEndMs}`,
    )
    if (!resp.ok) {
      playbackStore.exit()
      return
    }
    const data = await resp.json()
    playbackStore.setData(data)
    settingsStore.closePanel()
    _multiPlaybackControl?.destroy()
    _multiPlaybackControl = new AirMultiPlaybackControl(_map, adsbControl)
    _multiPlaybackControl.renderAtTime(playbackStore.cursorMs!, playbackStore.aircraft)
    playbackStore.play()
  } catch {
    playbackStore.exit()
  }
}

const PLAYBACK_TICK_MS = 100

function _schedulePlaybackTick(): void {
  _stopPlaybackTimer()
  /* v8 ignore start -- defensive: every caller (status watch, speed watch, the
     tick's own reschedule) only invokes this while status is 'playing', so the
     guard is never the path taken. */
  if (playbackStore.status !== 'playing') return
  /* v8 ignore stop */
  const cursor = playbackStore.cursorMs!
  const end = playbackStore.windowEndMs!
  if (cursor >= end) {
    playbackStore.pause()
    return
  }

  _playbackTimer = setTimeout(() => {
    const speed = PLAYBACK_SPEEDS[playbackStore.speedIdx]
    const nextCursor = Math.min(end, cursor + PLAYBACK_TICK_MS * speed)
    playbackStore.seek(nextCursor)
    _multiPlaybackControl?.renderAtTime(nextCursor, playbackStore.aircraft)
    if (playbackStore.status === 'playing') _schedulePlaybackTick()
  }, PLAYBACK_TICK_MS)
}

function _stopPlaybackTimer(): void {
  if (_playbackTimer) {
    clearTimeout(_playbackTimer)
    _playbackTimer = null
  }
}

// Drop the marker + hide the location-anchored overlays. Bound both to the
// userLocation watcher (null transition) and to sentinel:userLocationCleared
// so a config-clear is deterministic even if the watcher already ran with a
// stale localStorage seed on reload (ordering-independent).
function _clearLocationVisuals(): void {
  _locationMarker.remove()
  rangeRingsControl?.setLocationAvailable(false)
  overheadZoneControl?.setVisible(false)
}

onMounted(() => {
  window.addEventListener('sentinel:userLocationCleared', _clearLocationVisuals)
  watch(
    userLocation,
    (loc) => {
      if (!loc) {
        // Location was cleared (e.g. config emptied). Drop the marker AND hide
        // the range rings / overhead zone — otherwise they linger at the old
        // centre (or snap to map-centre) until GPS provides a new fix.
        _clearLocationVisuals()
        return
      }
      rangeRingsControl?.updateCenter(loc.lon, loc.lat)
      overheadZoneControl?.updateCenter(loc.lon, loc.lat)
      _locationMarker.update(loc.lon, loc.lat)
      // Location is back — restore overlays per the user's own toggles.
      rangeRingsControl?.setLocationAvailable(true)
      overheadZoneControl?.setVisible(
        airStore.overlayStates.overheadAlertsCivil || airStore.overlayStates.overheadAlertsMil,
      )
    },
    { immediate: true },
  )

  // Only the visual ring is driven here; overhead-alert detection lives in
  // useAirAlertsService.
  watch(
    () =>
      [
        airStore.overlayStates.overheadAlertsCivil,
        airStore.overlayStates.overheadAlertsMil,
      ] as const,
    ([civil, mil]) => {
      overheadZoneControl?.setVisible(civil || mil)
    },
  )

  watch(
    () => airStore.overheadAlertRadiusNm,
    (nm) => {
      overheadZoneControl?.setRadiusNm(nm)
    },
  )

  watch(
    () => playbackStore.status,
    async (status) => {
      if (status === 'loading') {
        adsbControl?.pauseLive()
        await _loadMultiPlayback()
      } else if (status === 'idle') {
        _stopPlaybackTimer()
        _multiPlaybackControl?.destroy()
        _multiPlaybackControl = null
      } else if (status === 'playing') {
        _schedulePlaybackTick()
      } else if (status === 'paused') {
        _stopPlaybackTimer()
      }
    },
  )

  watch(
    () => playbackStore.speedIdx,
    () => {
      if (playbackStore.status === 'playing') _schedulePlaybackTick()
    },
  )

  watch(
    () => playbackStore.cursorMs,
    (ms) => {
      // Handles manual scrubbing (timer tick calls renderAtTime directly)
      if (ms !== null && _multiPlaybackControl && playbackStore.status !== 'playing')
        _multiPlaybackControl.renderAtTime(ms, playbackStore.aircraft)
    },
  )
})

onBeforeUnmount(() => {
  window.removeEventListener('sentinel:userLocationCleared', _clearLocationVisuals)
  _stopPlaybackTimer()
  _multiPlaybackControl?.destroy()
  _multiPlaybackControl = null
  const m = _map
  ctxMenu.detach(m)
  if (m) {
    const center = m.getCenter()
    airStore.saveMapState([center.lng, center.lat], m.getZoom(), m.getPitch())
  }
  _map = null
  adsbControl?.onRemove()
  adsbLabelsControl?.onRemove()
  rangeRingsControl?.onRemove()
  roadsControl?.onRemove()
  namesControl?.onRemove()
  airportsControl?.onRemove()
  militaryBasesControl?.onRemove()
  aaraControl?.onRemove()
  awacsControl?.onRemove()
  overheadZoneControl?.onRemove()
  adsbControl = null
  adsbLabelsControl = null
  rangeRingsControl = null
  overheadZoneControl = null
  roadsControl = null
  namesControl = null
  airportsControl = null
  militaryBasesControl = null
  aaraControl = null
  awacsControl = null
  clearControl = null
})
</script>
