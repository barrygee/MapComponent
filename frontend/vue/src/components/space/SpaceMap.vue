<template>
  <MapLibreMap
    ref="mapRef"
    :style-url="styleUrl"
    region-label="Space domain map — satellites"
    region-description="Interactive map of satellites and their ground tracks. Satellites are listed in the Search panel, and upcoming overhead passes in the Passes panel, of the map sidebar — both keyboard and screen-reader accessible."
    :center="spaceStore.mapCenter ?? [0, 30]"
    :zoom="spaceStore.mapZoom ?? 2"
    @map-created="onMapCreated"
    @style-loaded="onStyleLoaded"
  />
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import type { Map as MapLibreGlMap } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import { useBasemapStore } from '@/stores/basemap'
import {
  useNotificationsStore,
  registerSatelliteClickHandler,
  clearSatelliteClickHandler,
} from '@/stores/notifications'
import { useTrackingStore } from '@/stores/tracking'
import { useConnectivity } from '@/composables/useConnectivity'
import { useUserLocation } from '@/composables/useUserLocation'
import { useMapContextMenu } from '@/composables/useMapContextMenu'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'
import { SatelliteControl } from './controls/satellite/SatelliteControl'
import { DaynightControl } from './controls/daynight/DaynightControl'
import { NamesToggleControl } from '@/components/shared/controls/names/NamesToggleControl'

const appStore = useAppStore()
const spaceStore = useSpaceStore()
const basemapStore = useBasemapStore()
const notificationsStore = useNotificationsStore()
const trackingStore = useTrackingStore()
const { location: userLocation, start: startLocation } = useUserLocation()

const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

const STYLE_ONLINE = '/assets/fiord-online.json'
const STYLE_OFFLINE = '/assets/fiord.json'

const styleUrl = computed(() => (appStore.isOnline ? STYLE_ONLINE : STYLE_OFFLINE))

// Cached map instance — plain variable, never reactive
let _map: MapLibreGlMap | null = null

const satelliteControlRef = shallowRef<SatelliteControl | null>(null)
let satelliteControl: SatelliteControl | null = null
let daynightControl: DaynightControl | null = null
let namesControl: NamesToggleControl | null = null
const _locationMarker = new UserLocationMarker('space-user-location-marker')
const ctxMenu = useMapContextMenu()

function getUserLocation(): [number, number] | null {
  const loc = userLocation.value
  return loc ? [loc.lon, loc.lat] : null
}

useConnectivity((online) => {
  const m = _map
  if (!m) return
  m.setStyle(online ? STYLE_ONLINE : STYLE_OFFLINE)
  m.once('style.load', () => {
    daynightControl?.initLayers()
    namesControl?.applyVisibility()
    satelliteControl?.initLayers()
  })
})

let _initialStyleUrl: string | null = null

function onMapCreated(m: MapLibreGlMap) {
  _map = m
  _initialStyleUrl = styleUrl.value
  startLocation()
  _locationMarker.addTo(m)
  ctxMenu.attach(m)
}

// Bound both to the watcher (null transition) and sentinel:userLocationCleared
// so a config-clear drops the marker even if the watcher already ran with a
// stale localStorage seed on reload (ordering-independent).
function _clearLocationMarker(): void {
  _locationMarker.remove()
}

onMounted(() => {
  window.addEventListener('sentinel:userLocationCleared', _clearLocationMarker)
  watch(
    userLocation,
    (loc) => {
      // Drop the marker when the location is cleared (config emptied) so a
      // stale pin doesn't linger until GPS provides a new fix.
      if (loc) _locationMarker.update(loc.lon, loc.lat)
      else _clearLocationMarker()
    },
    { immediate: true },
  )
})

function onGoToLocation(): void {
  const m = _map
  const loc = userLocation.value
  if (!m || !loc) return
  m.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(m.getZoom(), 5) })
}

useDocumentEvent('space-go-to-location', onGoToLocation)

function onStyleLoaded(m: MapLibreGlMap) {
  if (satelliteControl) return

  satelliteControl = new SatelliteControl(
    spaceStore,
    notificationsStore,
    trackingStore,
    getUserLocation,
    null,
  )
  void nextTick(() => {
    satelliteControlRef.value = satelliteControl
  })
  daynightControl = new DaynightControl(spaceStore)
  namesControl = new NamesToggleControl(basemapStore)

  m.addControl(satelliteControl, 'top-right')
  m.addControl(daynightControl, 'top-right')
  m.addControl(namesControl, 'top-right')

  // Clicking a satellite alert centres it in the viewport here (no follow).
  // Registering drains any pending target stashed when the alert was clicked
  // from another section.
  registerSatelliteClickHandler((noradId, name) => {
    satelliteControl?.focusSatellite(noradId, name)
  })

  // Hide the MapLibre native top-right control container — space side menu replaces it
  const ctrlEl = m.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-top-right')
  if (ctrlEl) ctrlEl.style.display = 'none'

  // If connectivity mode changed between map creation and style load, apply the correct style now.
  const desiredStyle = styleUrl.value
  if (_initialStyleUrl !== null && _initialStyleUrl !== desiredStyle) {
    m.setStyle(desiredStyle)
    m.once('style.load', () => {
      daynightControl?.initLayers()
      namesControl?.applyVisibility()
      satelliteControl?.initLayers()
    })
  }
  _initialStyleUrl = null
}

onBeforeUnmount(() => {
  window.removeEventListener('sentinel:userLocationCleared', _clearLocationMarker)
  const m = _map
  ctxMenu.detach(m)
  if (m) {
    const center = m.getCenter()
    spaceStore.saveMapState([center.lng, center.lat], m.getZoom())
  }
  _map = null
  satelliteControl = null
  daynightControl = null
  namesControl = null
  satelliteControlRef.value = null
  clearSatelliteClickHandler()
})

defineExpose({
  getSatelliteControl: () => satelliteControl,
  get satelliteControlReactive() {
    return satelliteControlRef.value
  },
  getDaynightControl: () => daynightControl,
  getNamesControl: () => namesControl,
  getMap: () => _map,
})
</script>

<style>
.iss-label {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  font-family: 'Barlow Condensed', 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 10px;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}

.iss-label.iss-label--tracking {
  pointer-events: auto;
  cursor: pointer;
}

.iss-tracking-badge {
  color: #c8ff00;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  transition: color 0.2s;
}

.iss-tracking-badge.iss-tracking-badge--hidden {
  display: none;
}
</style>
