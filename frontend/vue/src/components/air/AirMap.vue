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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { Map as MapLibreGlMap, MapMouseEvent } from 'maplibre-gl'
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

// Right-click context menu
let _ctxMenu: HTMLElement | null = null

function _removeCtxMenu(): void {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null }
}

function _onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') _removeCtxMenu()
}

function _showCtxMenu(e: MapMouseEvent): void {
  _removeCtxMenu()
  const { lng, lat } = e.lngLat
  const latStr = lat.toFixed(5)
  const lonStr = lng.toFixed(5)
  const cx = e.originalEvent.clientX
  const cy = e.originalEvent.clientY

  const el = document.createElement('div')
  // position:fixed so clientX/clientY map directly to viewport coordinates
  el.style.cssText = 'position:fixed;background:#000000;border:1px solid rgba(255,255,255,0.08);font-family:\'Barlow Condensed\',\'Barlow\',sans-serif;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,0.4);z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,0.95);min-width:200px;user-select:none'
  el.style.left = cx + 'px'
  el.style.top  = cy + 'px'

  const coordRow = document.createElement('div')
  coordRow.style.cssText = 'padding:8px 12px 6px;color:rgba(255,255,255,0.25);font-size:9px;letter-spacing:.14em;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.06)'
  coordRow.textContent = `${latStr}° N  ${lonStr}° E`
  el.appendChild(coordRow)

  const setLocBtn = document.createElement('div')
  setLocBtn.style.cssText = 'padding:10px 12px;cursor:pointer;white-space:nowrap;color:rgba(255,255,255,0.7);display:flex;align-items:center;gap:8px'
  setLocBtn.innerHTML =
    `<svg width="11" height="11" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">` +
    `<circle cx="7" cy="7" r="5.5" stroke="#c8ff00" stroke-width="1.5"/>` +
    `<circle cx="7" cy="7" r="2" fill="#c8ff00"/>` +
    `<line x1="7" y1="1" x2="7" y2="3" stroke="#c8ff00" stroke-width="1.5" stroke-linecap="square"/>` +
    `<line x1="7" y1="11" x2="7" y2="13" stroke="#c8ff00" stroke-width="1.5" stroke-linecap="square"/>` +
    `<line x1="1" y1="7" x2="3" y2="7" stroke="#c8ff00" stroke-width="1.5" stroke-linecap="square"/>` +
    `<line x1="11" y1="7" x2="13" y2="7" stroke="#c8ff00" stroke-width="1.5" stroke-linecap="square"/>` +
    `</svg>SET MY LOCATION`
  setLocBtn.addEventListener('mouseenter', () => { setLocBtn.style.background = 'rgba(255,255,255,0.06)' })
  setLocBtn.addEventListener('mouseleave', () => { setLocBtn.style.background = '' })
  setLocBtn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    window.dispatchEvent(new CustomEvent('sentinel:setUserLocation', { detail: { longitude: lng, latitude: lat } }))
    _removeCtxMenu()
  })
  el.appendChild(setLocBtn)

  document.body.appendChild(el)
  _ctxMenu = el

  // Clamp to viewport — defer one frame so the browser has laid out the element
  requestAnimationFrame(() => {
    if (!_ctxMenu) return
    const rect = _ctxMenu.getBoundingClientRect()
    if (rect.right  > window.innerWidth)  _ctxMenu.style.left = (cx - rect.width)  + 'px'
    if (rect.bottom > window.innerHeight) _ctxMenu.style.top  = (cy - rect.height) + 'px'
  })
}

// Cached map instance — plain variable, never reactive
let _map: MapLibreGlMap | null = null
let _currentStyleUrl: string | null = null

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
  setTargetPitch(p: number) { _targetPitch = p },
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
    roadsControl?._applyVisibility()
    namesControl?._applyVisibility()
    rangeRingsControl?._initRings()
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
  m.on('contextmenu', _showCtxMenu)
  // Register dismiss listeners on the map canvas rather than document so the
  // contextmenu → mouseup/click sequence on the canvas doesn't immediately close the menu.
  m.on('click', _removeCtxMenu)
  document.addEventListener('keydown', _onDocKeydown, { capture: true })
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

  // If connectivity mode changed between map creation and style load (e.g. the offgrid
  // probe fired before _map was set so the callback was a no-op), the map has loaded
  // the wrong style. Trigger a corrective reload now that controls are initialised.
  const desiredStyle = styleUrl.value
  if (_currentStyleUrl !== desiredStyle) {
    _currentStyleUrl = desiredStyle
    m.setStyle(desiredStyle)
    m.once('style.load', () => {
      roadsControl?._applyVisibility()
      namesControl?._applyVisibility()
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

onMounted(() => {
  watch(userLocation, (loc) => {
    if (!loc) return
    rangeRingsControl?.updateCenter(loc.lon, loc.lat)
    _locationMarker.update(loc.lon, loc.lat)
  }, { immediate: true })
})

onBeforeUnmount(() => {
  _removeCtxMenu()
  const m = _map
  document.removeEventListener('keydown', _onDocKeydown, { capture: true })
  if (m) {
    m.off('contextmenu', _showCtxMenu)
    m.off('click', _removeCtxMenu)
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
  adsbControl         = null
  adsbLabelsControl   = null
  rangeRingsControl   = null
  roadsControl        = null
  namesControl        = null
  airportsControl     = null
  militaryBasesControl = null
  aaraControl         = null
  awacsControl        = null
  clearControl        = null
})
</script>
