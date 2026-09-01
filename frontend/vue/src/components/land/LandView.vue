<template>
  <div id="map-wrap" data-domain="land">
    <h1 class="sr-only">Land domain</h1>
    <NoUrlOverlay domain="land" />
    <MapLibreMap
      ref="mapRef"
      :style-url="styleUrl"
      region-label="Land domain map"
      region-description="Interactive map of APRS stations heard by the SDR decoder. The same stations are listed in an accessible data table."
      :center="[-2, 54]"
      :zoom="6"
      @map-created="onMapCreated"
      @style-loaded="onStyleLoaded"
    />
    <LandSideMenu
      :zoom-in="zoomIn"
      :zoom-out="zoomOut"
      :go-to-location="goToLocation"
      :toggle-range-rings="toggleRangeRings"
      :toggle-aprs="toggleAprs"
      :toggle-names="toggleNames"
      :range-rings-active="rangeRingsActive"
      :aprs-active="aprsActive"
      :aprs-source-configured="aprsSourceConfigured"
      :location-active="locationActive"
    />
    <!-- msb-pane-search lives in MapSidebar, a sibling of <RouterView> in
         App.vue — see useSidebarPaneTarget for why this waits rather than
         teleporting unconditionally. -->
    <Teleport v-if="searchPaneReady" :to="sidebarPaneSelector('search')">
      <LandFilter />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { Map } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useLandStore } from '@/stores/land'
import { useBasemapStore } from '@/stores/basemap'
import { useConnectivity } from '@/composables/useConnectivity'
import { useUserLocation } from '@/composables/useUserLocation'
import { useMapContextMenu } from '@/composables/useMapContextMenu'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import NoUrlOverlay from '@/components/shared/NoUrlOverlay.vue'
import LandSideMenu from '@/components/land/LandSideMenu.vue'
import LandFilter from '@/components/land/LandFilter.vue'
import { sidebarPaneSelector } from '@/constants/sidebarPanes'
import { useSidebarPaneTarget } from '@/composables/useSidebarPaneTarget'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useSettingsStore } from '@/stores/settings'
import { useSdrStore } from '@/stores/sdr'
import { AprsStationsControl } from '@/components/land/controls/aprs/AprsStationsControl'
import { LandRangeRingsControl } from '@/components/land/controls/range-rings/LandRangeRingsControl'
import { NamesToggleControl } from '@/components/shared/controls/names/NamesToggleControl'
import { SentrySitesControl } from '@/components/shared/controls/sentry-sites/SentrySitesControl'
import { RoadsToggleControl } from '@/components/shared/controls/roads/RoadsToggleControl'

/** Zoom level the map flies to when centring on the user's location. */
const LOCATE_ZOOM = 10

const appStore = useAppStore()
const landStore = useLandStore()
const basemapStore = useBasemapStore()
const sentrySitesStore = useSentrySitesStore()
const settingsStore = useSettingsStore()
const sdrStore = useSdrStore()
const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)
const { ready: searchPaneReady } = useSidebarPaneTarget('search')

// User location drives the "go to my location" button, the range rings' centre,
// and the on-map location marker (shared app-wide via useUserLocation).
const { location: userLocation, start: startLocation } = useUserLocation()
const getUserLocation = (): [number, number] | null =>
  userLocation.value ? [userLocation.value.lon, userLocation.value.lat] : null
const _locationMarker = new UserLocationMarker('user-location-marker')

// Right-click "SET LOCATION" menu (matches the Air/Space maps). Setting a
// location dispatches sentinel:setUserLocation, which useUserLocation handles
// app-wide; the marker + range rings then follow via the userLocation watcher.
const ctxMenu = useMapContextMenu()

let _map: Map | null = null
let _initialStyleUrl: string | null = null
let _aprsControl: AprsStationsControl | null = null
let _rangeRingsControl: LandRangeRingsControl | null = null
let _namesControl: NamesToggleControl | null = null
// Sentry sites are plotted on every domain map, this one included — see
// SentrySitesControl. No side-menu button: the sites are always shown.
let _sentrySitesControl: SentrySitesControl | null = null
let _roadsControl: RoadsToggleControl | null = null

// Reactive toggle state backing the side-menu buttons' active (green) styling.
// APRS visibility lives on the store, so the map and the side panel's station
// list can never disagree about what is currently shown.
const aprsActive = computed(() => landStore.aprsLayerVisible)
// APRS has a receiver only once an SDR has been named as the APRS radio in
// Settings → LAND (backed by the same single backend decode bridge the SDR
// panel's APRS button drives). Without one nothing is decoding, so the layer is
// forced off and its side-menu button disabled rather than offering a toggle
// that could only ever show an empty map.
const aprsSourceConfigured = computed(() => sdrStore.aprsRadioId !== null)
const rangeRingsActive = ref(false)
const locationActive = computed(() => userLocation.value !== null)

const styleUrl = computed(() =>
  appStore.isOnline ? '/assets/fiord-online.json' : '/assets/fiord.json',
)

useConnectivity((online) => {
  _map?.setStyle(online ? '/assets/fiord-online.json' : '/assets/fiord.json')
})

function onMapCreated(m: Map) {
  _map = m
  _initialStyleUrl = styleUrl.value

  // The map features are IControls that own their layers/markers. We init them
  // directly (onAdd) rather than adding their default buttons — the side menu
  // owns the visible controls — and hide the native control corner.
  _rangeRingsControl = new LandRangeRingsControl(getUserLocation)
  _aprsControl = new AprsStationsControl(landStore)
  // Location names and roads are shared base-map layers driven by the
  // cross-domain basemap store, so Land shows whatever the other domains were
  // last set to. Roads has no button of its own — the control exists purely to
  // apply the stored visibility to this map's style.
  _namesControl = new NamesToggleControl(basemapStore)
  _roadsControl = new RoadsToggleControl(basemapStore)
  _sentrySitesControl = new SentrySitesControl(sentrySitesStore, settingsStore, {
    // The operator's own position joins the grouping pass, so a Sentry sitting
    // on top of it collapses into a count instead of two marks smearing
    // together; the marker is handed over so the count can stand in for it.
    getUserLocation,
    userMarker: _locationMarker,
  })
  _sentrySitesControl.onAdd(m)
  _rangeRingsControl.onAdd(m)
  _aprsControl.onAdd(m)
  _namesControl.onAdd(m)
  _roadsControl.onAdd(m)
  // APRS starts visible per the land.defaultLayers config (default ["aprs"]),
  // but only once a radio is decoding it.
  _aprsControl.setVisible(aprsSourceConfigured.value && landStore.defaultLayers.includes('aprs'))
  rangeRingsActive.value = _rangeRingsControl.visible

  const nativeCtrl = m.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-top-right')
  if (nativeCtrl) nativeCtrl.style.display = 'none'

  // Begin resolving the user's location, show its marker, and enable the
  // right-click "set my location" menu.
  startLocation()
  _locationMarker.addTo(m)
  ctxMenu.attach(m)
}

// ── side-menu handlers ─────────────────────────────────────────────────────
function zoomIn() {
  _map?.zoomIn()
}
function zoomOut() {
  _map?.zoomOut()
}
function goToLocation() {
  const location = getUserLocation()
  if (!_map || !location) return
  _map.flyTo({ center: location, zoom: Math.max(_map.getZoom(), LOCATE_ZOOM) })
}
function toggleRangeRings() {
  _rangeRingsControl?.handleClickPublic()
  rangeRingsActive.value = !rangeRingsActive.value
}
function toggleAprs() {
  // Guarded as well as disabled in the rail: the button is the only caller
  // today, but a layer with no decoder behind it must never be switchable.
  if (!aprsSourceConfigured.value) return
  // The control flips the shared store flag, which `aprsActive` tracks.
  _aprsControl?.handleClickPublic()
}
function toggleNames() {
  // The control flips the basemap store, which LandSideMenu reads directly.
  _namesControl?.handleClickPublic()
}

onMounted(() => {
  // The backend resumes the persisted APRS radio on startup, so the database is
  // the truth about whether anything is decoding — the store's localStorage
  // cache can be stale on a browser that never opened the SDR panel.
  void sdrStore.hydrateAprsFromDb()

  // Load the default-layers config, then apply it to the APRS layer (and keep it
  // in sync if the config changes, or if the APRS radio is chosen/cleared).
  void landStore.hydrateDefaultLayers()
  watch([() => landStore.defaultLayers, aprsSourceConfigured], ([layers, hasSource]) => {
    _aprsControl?.setVisible(hasSource && layers.includes('aprs'))
  })

  // Keep the location marker + range-rings centre in sync with the live fix.
  watch(
    userLocation,
    (location) => {
      if (!location) {
        _locationMarker.remove()
        _rangeRingsControl?.setLocationAvailable(false)
        return
      }
      _locationMarker.update(location.lon, location.lat)
      _rangeRingsControl?.updateCenter(location.lon, location.lat)
      _rangeRingsControl?.setLocationAvailable(true)
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  ctxMenu.detach(_map)
  _rangeRingsControl?.onRemove()
  _aprsControl?.onRemove()
  _namesControl?.onRemove()
  _roadsControl?.onRemove()
  _sentrySitesControl?.onRemove()
  _sentrySitesControl = null
  _locationMarker.remove()
  _rangeRingsControl = _aprsControl = null
  _namesControl = _roadsControl = null
})

function onStyleLoaded(m: Map) {
  const desiredStyle = styleUrl.value
  if (_initialStyleUrl !== null && _initialStyleUrl !== desiredStyle) {
    m.setStyle(desiredStyle)
  }
  _initialStyleUrl = null
  // A fresh style ships with its own layer visibilities, so re-assert the
  // base-map toggles every time one loads.
  _namesControl?.applyVisibility()
  _roadsControl?.applyVisibility()
}
</script>
