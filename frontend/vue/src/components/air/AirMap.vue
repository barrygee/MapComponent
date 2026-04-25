<template>
  <MapLibreMap
    ref="mapRef"
    :style-url="styleUrl"
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
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { Map as MapLibreGlMap } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useAirStore } from '@/stores/air'
import { useNotificationsStore } from '@/stores/notifications'
import { useTrackingStore } from '@/stores/tracking'
import { useConnectivity } from '@/composables/useConnectivity'
import { useUserLocation } from '@/composables/useUserLocation'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'

import { ResetViewControl }          from './controls/reset-view/ResetViewControl'
import { NamesToggleControl }         from './controls/names/NamesToggleControl'
import { RoadsToggleControl }         from './controls/roads/RoadsToggleControl'
import { RangeRingsControl }          from './controls/range-rings/RangeRingsControl'
import { AdsbLabelsToggleControl }    from './controls/adsb-labels/AdsbLabelsToggleControl'
import { ClearOverlaysControl }       from './controls/clear-overlays/ClearOverlaysControl'
import { AirportsToggleControl }      from './controls/airports/AirportsControl'
import { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'
import { AaraToggleControl }          from './controls/aara/AaraControl'
import { AwacToggleControl }          from './controls/awacs/AwacControl'
import { AdsbLiveControl }            from './controls/adsb/AdsbLiveControl'

const appStore           = useAppStore()
const airStore           = useAirStore()
const notificationsStore = useNotificationsStore()
const trackingStore      = useTrackingStore()

const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

const STYLE_ONLINE  = '/assets/fiord-online.json'
const STYLE_OFFLINE = '/assets/fiord.json'

const styleUrl = computed(() => appStore.isOnline ? STYLE_ONLINE : STYLE_OFFLINE)

// 3D state — plain variables, never reactive
let _tiltActive  = localStorage.getItem('sentinel_3d') === '1'
let _targetPitch = _tiltActive ? 45 : 0

const is3DActive     = () => _tiltActive
const getTargetPitch = () => _targetPitch

// User location
const { location: userLocation, start: startLocation } = useUserLocation()
const getUserLocation = (): [number, number] | null =>
  userLocation.value ? [userLocation.value.lon, userLocation.value.lat] : null

const _locationMarker = new UserLocationMarker('user-location-marker')

// Control instances — plain variables, initialised in onStyleLoaded
let adsbControl:         AdsbLiveControl | null            = null
let adsbLabelsControl:   AdsbLabelsToggleControl | null    = null
let rangeRingsControl:   RangeRingsControl | null          = null
let roadsControl:        RoadsToggleControl | null         = null
let namesControl:        NamesToggleControl | null         = null
let airportsControl:     AirportsToggleControl | null      = null
let militaryBasesControl: MilitaryBasesToggleControl | null = null
let aaraControl:         AaraToggleControl | null          = null
let awacsControl:        AwacToggleControl | null          = null
let clearControl:        ClearOverlaysControl | null       = null

// Expose for AirSideMenu
const getAdsbControl    = () => adsbControl
const getAdsbLabels     = () => adsbLabelsControl
const getRangeRings     = () => rangeRingsControl
const getRoadsControl   = () => roadsControl
const getNamesControl   = () => namesControl
const getAirports       = () => airportsControl
const getMilBases       = () => militaryBasesControl
const getAara           = () => aaraControl
const getAwacs          = () => awacsControl
const getClearControl   = () => clearControl

defineExpose({
  getAdsbControl, getAdsbLabels, getRangeRings, getRoadsControl,
  getNamesControl, getAirports, getMilBases, getAara, getAwacs, getClearControl,
  is3DActive, getTargetPitch,
  set3DActive(active: boolean) {
    const m = mapRef.value?.getMap()
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
  setTargetPitch(p: number) { _targetPitch = p },
  getMap: () => mapRef.value?.getMap() ?? null,
})

useConnectivity((online) => {
  const m = mapRef.value?.getMap()
  if (!m) return
  m.setStyle(online ? STYLE_ONLINE : STYLE_OFFLINE)
  // Re-init layers after style reload, clear aircraft
  m.once('style.load', () => {
    roadsControl?._applyVisibility()
    namesControl?._applyVisibility()
    airportsControl?.initLayers()
    militaryBasesControl?.initLayers()
    aaraControl?.initLayers()
    awacsControl?.initLayers()
    adsbControl?.clearAircraft()
    adsbControl?.handleConnectivityChange()
  })
})

function onMapCreated(m: MapLibreGlMap) {
  startLocation()
  _locationMarker.addTo(m)
  _watchUserLocation()
}

function onStyleLoaded(m: MapLibreGlMap) {
  if (adsbControl) return // already initialised (style reload handled by connectivity hook)

  adsbLabelsControl = new AdsbLabelsToggleControl(airStore, null)

  adsbControl = new AdsbLiveControl(
    airStore,
    notificationsStore,
    trackingStore,
    is3DActive,
    getTargetPitch,
    (v: boolean) => adsbLabelsControl?.syncToAdsb(v),
  )

  // Wire labels back to adsb
  ;(adsbLabelsControl as unknown as { _adsbControl: AdsbLiveControl | null })._adsbControl = adsbControl

  rangeRingsControl    = new RangeRingsControl(airStore, getUserLocation)
  roadsControl         = new RoadsToggleControl(airStore)
  namesControl         = new NamesToggleControl(airStore)
  airportsControl      = new AirportsToggleControl(airStore)
  militaryBasesControl = new MilitaryBasesToggleControl(airStore, is3DActive)
  aaraControl          = new AaraToggleControl(airStore)
  awacsControl         = new AwacToggleControl(airStore)

  clearControl = new ClearOverlaysControl({
    adsb:          adsbControl,
    adsbLabels:    adsbLabelsControl,
    roads:         roadsControl,
    names:         namesControl,
    rangeRings:    rangeRingsControl,
    airports:      airportsControl,
    militaryBases: militaryBasesControl,
    aara:          aaraControl,
    awacs:         awacsControl,
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

  // Restore 3D pitch after initial load
  if (_tiltActive) m.easeTo({ pitch: 45, duration: 400 })

}

function _watchUserLocation() {
  watch(userLocation, (loc) => {
    if (!loc) return
    rangeRingsControl?.updateCenter(loc.lon, loc.lat)
    _locationMarker.update(loc.lon, loc.lat)
  }, { immediate: true })
}

onBeforeUnmount(() => {
  const m = mapRef.value?.getMap()
  if (m) {
    const center = m.getCenter()
    airStore.saveMapState([center.lng, center.lat], m.getZoom(), m.getPitch())
  }
})
</script>
