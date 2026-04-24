<template>
  <div id="side-menu" :class="{ expanded }">

    <!-- Group 1: expand / collapse toggle -->
    <div class="sm-group" id="sm-group-toggle">
      <button
        id="side-menu-toggle"
        :data-tooltip="expanded ? 'COLLAPSE MENU' : 'EXPAND MENU'"
        @click="expanded = !expanded"
      >{{ expanded ? '›' : '‹' }}</button>
    </div>

    <!-- Group 2: zoom + location -->
    <div class="sm-group" id="sm-group-nav">
      <button class="sm-nav-btn" data-tooltip="ZOOM IN"  @click="getMap()?.zoomIn()">+</button>
      <button class="sm-nav-btn" data-tooltip="ZOOM OUT" @click="getMap()?.zoomOut()">−</button>
      <button
        class="sm-nav-btn"
        :class="{ active: locActive }"
        data-tooltip="GO TO MY LOCATION"
        @click="goToLocation"
        v-html="LOC_SVG"
      />
    </div>

    <!-- Group 3: overlay toggles -->
    <div class="sm-group">
      <!-- PLANES (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: airStore.overlayStates.adsb }"
        data-tooltip="PLANES"
        @click="togglePlanes"
        v-html="PLANE_SVG_WRAP"
      />

      <!-- GROUND VEHICLES (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: !hideGnd }"
        data-tooltip="GROUND VEHICLES"
        @click="toggleGround"
      >
        <span class="sm-icon" style="--sm-icon-size:8px">GND</span>
        <span class="sm-label">GROUND VEHICLES</span>
      </button>

      <!-- TOWERS (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: !hideTowers }"
        data-tooltip="TOWERS"
        @click="toggleTowers"
      >
        <span class="sm-icon" style="--sm-icon-size:8px">TWR</span>
        <span class="sm-label">TOWERS</span>
      </button>

      <!-- CALLSIGNS (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: planesOn && airStore.overlayStates.adsbLabels, 'sm-planes-off': !planesOn }"
        data-tooltip="CALLSIGNS"
        @click="toggleLabels"
      >
        <span class="sm-icon" style="--sm-icon-size:8px">CALL</span>
        <span class="sm-label">CALLSIGNS</span>
      </button>

      <!-- RANGE RING -->
      <button
        class="sm-btn"
        :class="{ active: airStore.overlayStates.rangeRings }"
        data-tooltip="RANGE RING"
        @click="mapRef?.getRangeRings()?.handleClickPublic()"
      >
        <span class="sm-icon" style="--sm-icon-size:16px">◎</span>
        <span class="sm-label">RANGE RING</span>
      </button>

      <!-- A2A REFUELING -->
      <button
        class="sm-btn"
        :class="{ active: airStore.overlayStates.aara }"
        data-tooltip="A2A REFUELING"
        @click="mapRef?.getAara()?.toggle()"
      >
        <span class="sm-icon" style="--sm-icon-size:16px">=</span>
        <span class="sm-label">A2A REFUELING</span>
      </button>

      <!-- AWACS -->
      <button
        class="sm-btn"
        :class="{ active: airStore.overlayStates.awacs }"
        data-tooltip="AWACS"
        @click="mapRef?.getAwacs()?.toggle()"
      >
        <span class="sm-icon" style="--sm-icon-size:16px">○</span>
        <span class="sm-label">AWACS</span>
      </button>

      <!-- 3D VIEW -->
      <button
        class="sm-btn"
        :class="{ active: tiltActive }"
        data-tooltip="3D VIEW"
        @click="toggle3D"
        v-html="CUBE_SVG_WRAP"
      />

      <!-- AIRPORTS (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: airStore.overlayStates.airports }"
        data-tooltip="AIRPORTS"
        @click="mapRef?.getAirports()?.toggle()"
      >
        <span class="sm-icon" style="--sm-icon-size:8px">CVL</span>
        <span class="sm-label">AIRPORTS</span>
      </button>

      <!-- MILITARY BASES (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: airStore.overlayStates.militaryBases }"
        data-tooltip="MILITARY BASES"
        @click="mapRef?.getMilBases()?.toggle()"
      >
        <span class="sm-icon" style="--sm-icon-size:8px">MIL</span>
        <span class="sm-label">MILITARY BASES</span>
      </button>

      <!-- LOCATIONS (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: airStore.overlayStates.names }"
        data-tooltip="LOCATIONS"
        @click="mapRef?.getNamesControl()?.handleClickPublic()"
      >
        <span class="sm-icon" style="--sm-icon-size:14px">N</span>
        <span class="sm-label">LOCATIONS</span>
      </button>

      <!-- ROADS (expanded-only) -->
      <button
        class="sm-btn sm-expanded-only"
        :class="{ active: airStore.overlayStates.roads }"
        data-tooltip="ROADS"
        @click="mapRef?.getRoadsControl()?.handleClickPublic()"
      >
        <span class="sm-icon" style="--sm-icon-size:14px">R</span>
        <span class="sm-label">ROADS</span>
      </button>
    </div>

    <!-- Group 5: filter mode flyout + filter button -->
    <div class="sm-group" style="position:relative">
      <button
        class="sm-btn enabled"
        :class="{ 'filter-flyout-open': flyoutOpen }"
        id="sm-filter-btn"
        data-tooltip="FILTER"
        @mouseenter="showFlyout"
        @mouseleave="startHideFlyout"
        @click="openFilter"
      >
        <span class="sm-icon" v-html="FILTER_SVG" />
        <span class="sm-label">FILTER</span>
      </button>

      <!-- Filter mode flyout -->
      <div
        id="filter-mode-flyout"
        :class="{ 'filter-flyout-visible': flyoutOpen }"
        @mouseenter="showFlyout"
        @mouseleave="startHideFlyout"
      >
        <button
          v-for="mode in filterModes"
          :key="mode.value"
          class="filter-flyout-btn"
          :class="{ active: isFilterModeActive(mode.value) }"
          :data-mode="mode.value"
          @click.stop="setFilterMode(mode.value)"
        >{{ mode.label }}</button>
      </div>
    </div>

    <!-- Group 6: search button -->
    <div class="sm-group">
      <button
        class="sm-btn enabled"
        id="sm-search-btn"
        data-tooltip="SEARCH"
        @click="openSearch"
      >
        <span class="sm-icon" v-html="SEARCH_SVG" />
        <span class="sm-label">SEARCH</span>
      </button>
    </div>

  </div>

  <!-- 3D controls widget (fixed bottom-right) -->
  <div id="map-3d-controls" :class="{ 'map-3d-controls--hidden': !tiltActive }">
    <span />
    <button class="map-3d-btn" data-tooltip="TILT UP"      @click="tiltBy(10)">↑</button>
    <span />
    <button class="map-3d-btn" data-tooltip="ROTATE LEFT"  @click="rotateBy(-15)">↺</button>
    <button class="map-3d-btn" data-tooltip="RESET BEARING" @click="resetBearing">⌖</button>
    <button class="map-3d-btn" data-tooltip="ROTATE RIGHT" @click="rotateBy(15)">↻</button>
    <span />
    <button class="map-3d-btn" data-tooltip="TILT DOWN"    @click="tiltBy(-10)">↓</button>
    <span />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAirStore } from '@/stores/air'
import { useUserLocation } from '@/composables/useUserLocation'
import type AirMap from './AirMap.vue'

// AirMap exposes typed methods via defineExpose — we accept InstanceType<typeof AirMap> | null
const props = defineProps<{
  mapRef: InstanceType<typeof AirMap> | null
}>()

const airStore = useAirStore()
const { location: userLocation } = useUserLocation()

const expanded  = ref(false)
const tiltActive = ref(localStorage.getItem('sentinel_3d') === '1')
const cleared    = ref(false)
const locActive  = computed(() => userLocation.value !== null)
const hideGnd    = ref(false)
const hideTowers = ref(false)
const flyoutOpen = ref(false)
let flyoutTimer: ReturnType<typeof setTimeout> | null = null

const planesOn = computed(() =>
  airStore.overlayStates.adsb && !(props.mapRef?.getAdsbControl?.()?._allHidden ?? false)
)

// ---- SVG constants ----
const LOC_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`

const PLANE_SVG_WRAP = `<span class="sm-icon"><svg width="16" height="15" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="#ffffff"/><polyline points="10,0 0,0 0,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,0 56,0 56,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="10,52 0,52 0,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,52 56,52 56,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/></svg></span><span class="sm-label">PLANES</span>`

const CUBE_SVG_WRAP = `<span class="sm-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="7,1 13,4.5 13,9.5 7,13 1,9.5 1,4.5" stroke="currentColor" stroke-width="1.2" fill="none"/><polyline points="7,1 7,7" stroke="currentColor" stroke-width="1.2"/><polyline points="1,4.5 7,7 13,4.5" stroke="currentColor" stroke-width="1.2"/></svg></span><span class="sm-label">3D VIEW</span>`

const FILTER_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="3.5" x2="14" y2="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="3.5" y1="7.5" x2="11.5" y2="7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="6" y1="11.5" x2="9" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`

const SEARCH_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`

const filterModes = [
  { value: 'all',  label: 'ALL' },
  { value: 'civil', label: 'CIVIL' },
  { value: 'mil',  label: 'MILITARY' },
  { value: 'none', label: 'NONE' },
] as const

// ---- Map access helpers ----
function getMap() {
  const m = props.mapRef as { getMap?: () => import('maplibre-gl').Map | null } | null
  return m?.getMap?.() ?? null
}
function getAdsb() {
  return props.mapRef?.getAdsbControl?.() as import('./controls/adsb/AdsbLiveControl').AdsbLiveControl | null ?? null
}
function getAdsbLabels() {
  return props.mapRef?.getAdsbLabels?.() as import('./controls/adsb-labels/AdsbLabelsToggleControl').AdsbLabelsToggleControl | null ?? null
}

// ---- Location ----
function goToLocation() {
  const m = getMap()
  const loc = userLocation.value
  if (!m || !loc) return
  m.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(m.getZoom(), 10), duration: 800 })
}

// ---- Plane overlay ----
function togglePlanes() {
  const c = getAdsb()
  if (!c) return
  c.toggle()
  const labels = getAdsbLabels()
  if (labels) labels.syncToAdsb(c.visible)
}

function toggleGround() {
  const c = getAdsb()
  if (!c) return
  hideGnd.value = !hideGnd.value
  c.setHideGroundVehicles(hideGnd.value)
}

function toggleTowers() {
  const c = getAdsb()
  if (!c) return
  hideTowers.value = !hideTowers.value
  c.setHideTowers(hideTowers.value)
}

function toggleLabels() {
  const labels = getAdsbLabels()
  if (!labels || !planesOn.value) return
  labels.toggle()
}

// ---- 3D ----
function toggle3D() {
  const airMap = props.mapRef as { set3DActive?: (v: boolean) => void } | null
  tiltActive.value = !tiltActive.value
  airMap?.set3DActive?.(tiltActive.value)
}

function tiltBy(delta: number) {
  const m = getMap()
  if (!m) return
  const newPitch = Math.min(Math.max(m.getPitch() + delta, 0), 85)
  const airMap = props.mapRef as { setTargetPitch?: (p: number) => void } | null
  airMap?.setTargetPitch?.(newPitch)
  m.easeTo({ pitch: newPitch, duration: 300 })
}

function rotateBy(delta: number) {
  const m = getMap()
  if (!m) return
  m.easeTo({ bearing: m.getBearing() + delta, duration: 300 })
}

function resetBearing() {
  const m = getMap()
  if (!m) return
  m.easeTo({ bearing: 0, duration: 400 })
}

// ---- Clear overlays ----
function toggleClear() {
  const ctrl = props.mapRef?.getClearControl?.() as import('./controls/clear-overlays/ClearOverlaysControl').ClearOverlaysControl | null ?? null
  if (!ctrl) return
  ctrl.toggle()
  cleared.value = ctrl._cleared
}

// ---- Filter flyout ----
function showFlyout() {
  if (flyoutTimer) { clearTimeout(flyoutTimer); flyoutTimer = null }
  flyoutOpen.value = true
}

function startHideFlyout() {
  flyoutTimer = setTimeout(() => { flyoutOpen.value = false }, 120)
}

function isFilterModeActive(mode: string): boolean {
  const c = getAdsb()
  if (!c) return false
  if (mode === 'none') return c._allHidden
  return !c._allHidden && c._typeFilter === mode
}

function setFilterMode(mode: string) {
  const c = getAdsb()
  if (!c) return
  if (mode === 'none') {
    const isHiding = !c._allHidden
    if (!isHiding) c.setTypeFilter('all')
    c.setAllHidden(isHiding)
  } else {
    if (c._allHidden) c.setAllHidden(false)
    c.setTypeFilter(mode as 'all' | 'civil' | 'mil')
  }
  _saveFilter()
}

function _saveFilter() {
  const c = getAdsb()
  if (!c) return
  try {
    localStorage.setItem('adsbFilter', JSON.stringify({
      typeFilter: c._typeFilter,
      allHidden:  c._allHidden,
    }))
  } catch {}
}

function openFilter() {
  // Open the sidebar search tab / filter
  const sidebar = document.getElementById('map-sidebar')
  if (sidebar) {
    // Emit to parent or trigger via the MapSidebar's exposed API
    // AirView.vue will wire this up via ref
    const event = new CustomEvent('air-open-filter')
    document.dispatchEvent(event)
  }
}

function openSearch() {
  const event = new CustomEvent('air-open-search')
  document.dispatchEvent(event)
}

// ---- Restore persisted filter state ----
try {
  const saved = localStorage.getItem('adsbFilter')
  if (saved) {
    const { typeFilter, allHidden } = JSON.parse(saved) as { typeFilter: string; allHidden: boolean }
    // Applied lazily when adsbControl is available (after map loads)
    setTimeout(() => {
      const c = getAdsb()
      if (!c) return
      if (allHidden) {
        c.setAllHidden(true)
      } else if (typeFilter && typeFilter !== 'all') {
        c.setTypeFilter(typeFilter as 'civil' | 'mil')
      }
    }, 2000)
  }
} catch {}
</script>

<style>
#side-menu {
    position: fixed;
    top: 80px;
    right: 14px;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
}

.sm-group {
    background: transparent;
    border: none;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 4px;
    width: calc((148px - 8px) / 3);
    transition: width 0.2s ease;
}

#side-menu.expanded .sm-group {
    width: 148px;
}

#side-menu.expanded #sm-group-nav {
    flex-direction: row;
    gap: 4px;
    background: transparent;
    border-color: transparent;
}

#side-menu.expanded .sm-nav-btn {
    flex: 1;
    width: auto;
}

#side-menu.expanded #sm-group-toggle {
    gap: 0;
    width: calc((148px - 8px) / 3);
}

#side-menu-toggle {
    width: 100%;
    height: 36px;
    background: #000;
    border: none;
    color: rgba(255,255,255,0.35);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    font-weight: 400;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, background 0.2s;
}

#side-menu-toggle:hover {
    background: #111;
    color: var(--color-text-muted);
}

.sm-nav-btn {
    flex: none;
    width: 100%;
    height: 36px;
    background: #000;
    border: none;
    color: rgba(255,255,255,0.6);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 18px;
    font-weight: 300;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, color 0.2s;
}

.sm-nav-btn:hover {
    background: #111;
    color: #fff;
}

.sm-nav-btn.active {
    background: #111;
    color: var(--color-accent);
}

#side-menu .sm-btn {
    width: 100%;
    height: 36px;
    background: #000;
    border: none;
    color: #fff;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, opacity 0.2s, color 0.2s;
    opacity: 1;
    flex-shrink: 0;
    white-space: nowrap;
    padding: 0;
}

#side-menu .sm-btn:hover {
    background: #111;
}

#side-menu .sm-btn.active {
    opacity: 1;
    color: rgba(200, 255, 0, 0.75);
}

#side-menu .sm-btn.enabled {
    opacity: 1;
}

#side-menu .sm-btn.sm-planes-off {
    opacity: 0.1;
    pointer-events: none;
}

#side-menu .sm-btn .sm-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 29px;
    flex-shrink: 0;
    font-size: var(--sm-icon-size, 14px);
}

#side-menu .sm-btn .sm-icon svg {
    display: block;
    flex-shrink: 0;
    width: auto;
    height: 15px;
}

#side-menu .sm-btn .sm-label {
    display: none;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
}

#side-menu.expanded .sm-btn {
    justify-content: flex-start;
    padding: 0 14px;
}

#side-menu.expanded .sm-btn .sm-icon {
    display: none;
}

#side-menu.expanded .sm-btn .sm-label {
    display: flex;
}

#side-menu .sm-btn.sm-expanded-only {
    display: none;
}
#side-menu.expanded .sm-btn.sm-expanded-only {
    display: flex;
}

#side-menu:not(.expanded) .sm-btn[data-tooltip],
#side-menu:not(.expanded) .sm-nav-btn[data-tooltip],
#side-menu:not(.expanded) #side-menu-toggle[data-tooltip],
#side-menu.expanded .sm-nav-btn[data-tooltip] {
    position: relative;
}

#side-menu:not(.expanded) .sm-btn[data-tooltip]::before,
#side-menu:not(.expanded) .sm-nav-btn[data-tooltip]::before,
#side-menu:not(.expanded) #side-menu-toggle[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 10px;
    height: 28px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 1002;
}

#side-menu:not(.expanded) .sm-btn[data-tooltip]:hover::before,
#side-menu:not(.expanded) .sm-nav-btn[data-tooltip]:hover::before,
#side-menu:not(.expanded) #side-menu-toggle[data-tooltip]:hover::before {
    opacity: 1;
}

#side-menu.expanded #sm-group-nav .sm-nav-btn[data-tooltip],
#side-menu.expanded #side-menu-toggle[data-tooltip] {
    position: relative;
}

#side-menu.expanded #sm-group-nav .sm-nav-btn[data-tooltip]::before,
#side-menu.expanded #side-menu-toggle[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 10px;
    height: 28px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 1002;
}

#side-menu.expanded #sm-group-nav .sm-nav-btn:nth-child(1)[data-tooltip]::before {
    right: calc(100% + 8px);
}

#side-menu.expanded #sm-group-nav .sm-nav-btn:nth-child(2)[data-tooltip]::before {
    right: calc(100% + 8px + 50.67px);
}

#side-menu.expanded #sm-group-nav .sm-nav-btn:nth-child(3)[data-tooltip]::before {
    right: calc(100% + 8px + 101.33px);
}

#side-menu.expanded #side-menu-toggle[data-tooltip]::before {
    right: calc(100% + 8px);
}

#side-menu.expanded #sm-group-nav .sm-nav-btn[data-tooltip]:hover::before,
#side-menu.expanded #side-menu-toggle[data-tooltip]:hover::before {
    opacity: 1;
}

.sm-group:has(#sm-filter-btn) {
    position: relative;
}

#filter-mode-flyout {
    position: absolute;
    right: calc(100% + 8px);
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: transparent;
    pointer-events: none;
    width: 0;
    overflow: hidden;
    transition: width 0.2s ease;
    z-index: 1002;
    white-space: nowrap;
}

#filter-mode-flyout.filter-flyout-visible {
    width: 80px;
    pointer-events: auto;
}

#sm-filter-btn.filter-flyout-open::before {
    opacity: 0 !important;
}

.filter-flyout-btn {
    background: #000;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.35);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    padding: 0 14px;
    height: 36px;
    width: 80px;
    display: flex;
    align-items: center;
    text-transform: uppercase;
    transition: color 0.15s, background 0.15s;
}

.filter-flyout-btn:hover {
    color: #fff;
}

.filter-flyout-btn.active {
    color: var(--color-accent);
}

#map-3d-controls {
    position: fixed;
    bottom: calc(44px + 14px);
    right: 14px;
    z-index: 1002;
    display: grid;
    grid-template-columns: repeat(3, 36px);
    grid-template-rows: repeat(3, 36px);
    gap: 4px;
}

#map-3d-controls.map-3d-controls--hidden {
    display: none;
}

.map-3d-btn {
    width: 36px;
    height: 36px;
    background: #000;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    position: relative;
}

.map-3d-btn:hover {
    background: #111;
    color: var(--color-accent);
}

.map-3d-btn:active {
    background: #1a1a1a;
    color: var(--color-accent);
}

.map-3d-btn[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 10px;
    height: 24px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 10001;
}

.map-3d-btn[data-tooltip]:hover::before {
    opacity: 1;
}
</style>
