<template>
  <MapLibreMap
    ref="mapRef"
    :style-url="styleUrl"
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
import { useNotificationsStore } from '@/stores/notifications'
import { useTrackingStore } from '@/stores/tracking'
import { useConnectivity } from '@/composables/useConnectivity'
import { useUserLocation } from '@/composables/useUserLocation'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'
import { SatelliteControl } from './controls/satellite/SatelliteControl'
import { DaynightControl } from './controls/daynight/DaynightControl'
import { SpaceNamesToggleControl } from './controls/names/SpaceNamesToggleControl'

const appStore = useAppStore()
const spaceStore = useSpaceStore()
const notificationsStore = useNotificationsStore()
const trackingStore = useTrackingStore()
const { location: userLocation, start: startLocation } = useUserLocation()

const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

const STYLE_ONLINE  = '/assets/fiord-online.json'
const STYLE_OFFLINE = '/assets/fiord.json'

const styleUrl = computed(() => appStore.isOnline ? STYLE_ONLINE : STYLE_OFFLINE)

// Cached map instance — plain variable, never reactive
let _map: MapLibreGlMap | null = null

const satelliteControlRef = shallowRef<SatelliteControl | null>(null)
let satelliteControl: SatelliteControl | null = null
let daynightControl: DaynightControl | null = null
let namesControl: SpaceNamesToggleControl | null = null
const _locationMarker = new UserLocationMarker('space-user-location-marker')

const globeActiveLocal = ref(spaceStore.globeActive)

function is3DActive() { return globeActiveLocal.value }

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
    namesControl?.applyNamesVisibility()
    satelliteControl?.initLayers()
  })
})

function onMapCreated(m: MapLibreGlMap) {
  _map = m
  startLocation()
  _locationMarker.addTo(m)
}

onMounted(() => {
  watch(userLocation, (loc) => {
    if (loc) _locationMarker.update(loc.lon, loc.lat)
  }, { immediate: true })
})

function onGoToLocation(): void {
  const m = _map
  const loc = userLocation.value
  if (!m || !loc) return
  if (globeActiveLocal.value) {
    m.easeTo({ center: [loc.lon, loc.lat], duration: 800 })
  } else {
    m.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(m.getZoom(), 5) })
  }
}

useDocumentEvent('space-go-to-location', onGoToLocation)

function onStyleLoaded(m: MapLibreGlMap) {
  if (satelliteControl) return

  satelliteControl = new SatelliteControl(
    spaceStore,
    notificationsStore,
    trackingStore,
    is3DActive,
    getUserLocation,
    null,
  )
  void nextTick(() => { satelliteControlRef.value = satelliteControl })
  daynightControl = new DaynightControl(spaceStore)
  namesControl    = new SpaceNamesToggleControl(spaceStore, is3DActive)

  m.addControl(satelliteControl,     'top-right')
  m.addControl(daynightControl,'top-right')
  m.addControl(namesControl,   'top-right')

  // Hide the MapLibre native top-right control container — space side menu replaces it
  const ctrlEl = m.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-top-right')
  if (ctrlEl) ctrlEl.style.display = 'none'

  // Apply persisted globe projection
  if (spaceStore.globeActive) {
    document.body.classList.add('globe-active')
    try { (m as unknown as { setProjection: (p: object) => void }).setProjection({ type: 'globe' }) } catch {}
  }
}

function toggleGlobe(): void {
  const newVal = !globeActiveLocal.value
  globeActiveLocal.value = newVal
  spaceStore.setGlobe(newVal)
  document.body.classList.toggle('globe-active', newVal)
  const m = _map
  if (m) {
    try { (m as unknown as { setProjection: (p: object) => void }).setProjection({ type: newVal ? 'globe' : 'mercator' }) } catch {}
  }
  namesControl?.applyNamesVisibility()
  satelliteControl?.refreshTrackSource()
}

onBeforeUnmount(() => {
  const m = _map
  if (m) {
    const center = m.getCenter()
    spaceStore.saveMapState([center.lng, center.lat], m.getZoom())
  }
  _map = null
  satelliteControl = null
  daynightControl  = null
  namesControl     = null
  satelliteControlRef.value = null
  document.body.classList.remove('globe-active')
})

defineExpose({
  getSatelliteControl:     () => satelliteControl,
  get satelliteControlReactive() { return satelliteControlRef.value },
  getDaynightControl:() => daynightControl,
  getNamesControl:   () => namesControl,
  isGlobeActive:     () => globeActiveLocal.value,
  toggleGlobe,
  getMap:            () => _map,
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

.iss-label.iss-label--hidden {
    visibility: hidden;
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

.iss-tag-wrap {
    pointer-events: auto;
}

.iss-tag {
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 14px;
    font-weight: 400;
    padding: 6px 14px 9px;
    white-space: nowrap;
    user-select: none;
}

.iss-tag-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    font-size: 15px;
    letter-spacing: 0.12em;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.iss-tag-name {
    font-size: 13px;
    font-weight: 400;
    pointer-events: none;
    color: #c8ff00;
    letter-spacing: 0.12em;
}

.iss-tag-actions {
    display: flex;
    align-items: center;
    gap: 0;
}

.iss-tag-rows {
    pointer-events: none;
}

.iss-tag-row {
    display: flex;
    gap: 14px;
    line-height: 1.8;
}

.iss-tag-lbl {
    opacity: 0.5;
    min-width: 34px;
    letter-spacing: 0.05em;
}

.iss-track-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px 12px;
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    line-height: 1;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    color: rgba(255, 255, 255, 0.3);
    transition: color 0.15s;
}

.iss-track-btn.iss-track-btn--active {
    color: #c8ff00;
}

.iss-notif-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px 6px;
    line-height: 1;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    color: rgba(255, 255, 255, 0.3);
    transition: color 0.15s;
}

.iss-notif-btn.iss-notif-btn--active {
    color: #c8ff00;
}
</style>
