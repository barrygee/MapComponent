<template>
  <div id="space-side-menu" :class="{ expanded }">
    <!-- Group 1: expand/collapse toggle -->
    <div class="sm-group" id="ssm-group-toggle">
      <button
        id="space-side-menu-toggle"
        :data-tooltip="expanded ? 'COLLAPSE MENU' : 'EXPAND MENU'"
        @click="expanded = !expanded"
      >{{ expanded ? '›' : '‹' }}</button>
    </div>

    <!-- Group 2: zoom / go-to-location nav -->
    <div class="sm-group" id="ssm-group-nav">
      <button class="sm-nav-btn" title="Zoom in"   data-tooltip="Zoom in"   @click="mapRef.value?.getMap()?.zoomIn()">+</button>
      <button class="sm-nav-btn" title="Zoom out"  data-tooltip="Zoom out"  @click="mapRef.value?.getMap()?.zoomOut()">−</button>
      <button class="sm-nav-btn" title="Go to my location" data-tooltip="Go to my location"
        :class="{ active: locActive }"
        @click="goToLocation"
        v-html="LOC_SVG"
      />
    </div>

    <!-- Group 3: ground track + footprint (expanded only) -->
    <div class="sm-group" id="ssm-group-iss">
      <button class="sm-btn" data-tooltip="GROUND TRACK"
        :class="{ active: trackActive }"
        @click="toggleTrack"
      >
        <span class="sm-icon" v-html="TRACK_SVG" />
        <span class="sm-label">GROUND TRACK</span>
      </button>
      <button class="sm-btn" data-tooltip="FOOTPRINT"
        :class="{ active: footprintActive }"
        @click="toggleFootprint"
      >
        <span class="sm-icon" v-html="FOOTPRINT_SVG" />
        <span class="sm-label">FOOTPRINT</span>
      </button>
    </div>

    <!-- Group 4: day/night (expanded only) -->
    <div class="sm-group" id="ssm-group-daynight">
      <button class="sm-btn" data-tooltip="DAY / NIGHT"
        :class="{ active: daynightActive }"
        @click="toggleDaynight"
      >
        <span class="sm-icon" v-html="MOON_SVG" />
        <span class="sm-label">DAY / NIGHT</span>
      </button>
    </div>

    <!-- Group 5: globe projection -->
    <div class="sm-group" id="ssm-group-globe">
      <button class="sm-btn" data-tooltip="GLOBE"
        :class="{ active: globeActive }"
        @click="mapRef.value?.toggleGlobe()"
      >
        <span class="sm-icon" v-html="GLOBE_SVG" />
        <span class="sm-label">GLOBE</span>
      </button>
    </div>

    <!-- Group 6: satellite search -->
    <div class="sm-group" id="ssm-group-filter">
      <button class="sm-btn enabled" id="ssm-filter-btn" data-tooltip="SEARCH"
        @click="openSearch"
      >
        <span class="sm-icon" v-html="FILTER_SVG" />
        <span class="sm-label">SEARCH</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSpaceStore } from '@/stores/space'
import { useUserLocation } from '@/composables/useUserLocation'
import type SpaceMap from './SpaceMap.vue'

// markRaw proxy from SpaceView — .current is non-reactive, preventing re-renders during teardown
const props = defineProps<{ mapRef: { current: InstanceType<typeof SpaceMap> | null } }>()

const mapRef = { get value() { return props.mapRef.current } }

const spaceStore = useSpaceStore()
const { location: userLocation } = useUserLocation()

const expanded  = ref(false)
const locActive = computed(() => userLocation.value !== null)

const trackActive    = computed(() => spaceStore.overlayStates.groundTrack)
const footprintActive= computed(() => spaceStore.overlayStates.footprint)
const daynightActive = computed(() => spaceStore.overlayStates.daynight)
const globeActive    = computed(() => spaceStore.globeActive)

const SAT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="4" height="4" fill="#c8ff00"/>
  <rect x="2"  y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
  <rect x="15" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
  <line x1="12" y1="2"  x2="12" y2="8"  stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
  <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
</svg>`

const TRACK_SVG = `<svg width="16" height="14" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 14 C6 10, 10 6, 14 6 S20 8 22 4" stroke="#ffffff" stroke-width="2" stroke-dasharray="3,2" fill="none"/>
  <path d="M2 14 C6 10, 10 6, 14 6 S20 8 22 4" stroke="#c8ff00" stroke-width="2" fill="none" stroke-dashoffset="5" stroke-dasharray="3,20"/>
</svg>`

const FOOTPRINT_SVG = `<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" stroke="rgba(200,255,0,0.6)" stroke-width="1.5" stroke-dasharray="3,2" fill="none"/>
  <circle cx="12" cy="12" r="2" fill="#c8ff00"/>
</svg>`

const MOON_SVG = `<svg width="13" height="14" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 2C10 2 5 6.5 5 12s5 10 10 10c-6 0-11-4.5-11-10S9 2 15 2z" fill="#ffffff"/>
</svg>`

const LOC_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`

const GLOBE_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
  <ellipse cx="12" cy="12" rx="4.5" ry="9" stroke="currentColor" stroke-width="1.4"/>
  <line x1="3"   y1="12" x2="21"  y2="12" stroke="currentColor" stroke-width="1.4"/>
  <line x1="5.5" y1="6.5" x2="18.5" y2="6.5" stroke="currentColor" stroke-width="1" opacity="0.6"/>
  <line x1="5.5" y1="17.5" x2="18.5" y2="17.5" stroke="currentColor" stroke-width="1" opacity="0.6"/>
</svg>`

const FILTER_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`

function goToLocation(): void {
  // Trigger location fly — MapSidebar will dispatch an event or the satelliteControl handles it
  document.dispatchEvent(new CustomEvent('space-go-to-location'))
}

function toggleTrack(): void {
  mapRef.value?.getSatelliteControl()?.toggleTrack()
}

function toggleFootprint(): void {
  mapRef.value?.getSatelliteControl()?.toggleFootprint()
}

function toggleDaynight(): void {
  mapRef.value?.getDaynightControl()?.toggleDaynight()
}

function openSearch(): void {
  document.dispatchEvent(new CustomEvent('open-space-search'))
}
</script>

<style>
#space-side-menu {
    position: fixed;
    top: 80px;
    right: 14px;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-end;
}

#space-side-menu .sm-group {
    background: transparent;
    border: none;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 4px;
    width: calc((148px - 8px) / 3);
    transition: width 0.2s ease;
}

#space-side-menu.expanded .sm-group {
    width: 148px;
}

#space-side-menu.expanded #ssm-group-nav {
    flex-direction: row;
    gap: 4px;
    background: transparent;
    border-color: transparent;
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn {
    flex: 1;
    width: auto;
}

#space-side-menu.expanded #ssm-group-toggle {
    gap: 0;
    width: calc((148px - 8px) / 3);
}

#space-side-menu-toggle {
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

#space-side-menu-toggle:hover {
    background: #111;
    color: var(--color-text-muted);
}

#space-side-menu .sm-nav-btn {
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

#space-side-menu .sm-nav-btn:hover {
    background: #111;
    color: #fff;
}

#space-side-menu .sm-btn {
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

#space-side-menu .sm-btn:hover {
    background: #111;
}

#space-side-menu .sm-btn.active {
    opacity: 1;
    color: rgba(200, 255, 0, 0.75);
}

#space-side-menu .sm-btn .sm-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 29px;
    flex-shrink: 0;
    font-size: var(--sm-icon-size, 14px);
}

#space-side-menu .sm-btn .sm-icon svg {
    display: block;
    flex-shrink: 0;
    width: auto;
    height: 15px;
}

#space-side-menu .sm-btn .sm-label {
    display: none;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
}

#space-side-menu.expanded .sm-btn {
    justify-content: flex-start;
    padding: 0 14px;
}

#space-side-menu.expanded .sm-btn .sm-icon {
    display: none;
}

#space-side-menu.expanded .sm-btn .sm-label {
    display: flex;
}

#space-side-menu:not(.expanded) #ssm-group-iss,
#space-side-menu:not(.expanded) #ssm-group-daynight {
    display: none;
}

body.globe-active #map,
body.globe-active #map .maplibregl-canvas-container,
body.globe-active #map .maplibregl-canvas {
    background: transparent !important;
}

body.globe-active #space-side-menu .sm-btn,
body.globe-active #space-side-menu .sm-nav-btn,
body.globe-active #space-side-menu-toggle {
    background: rgba(255, 255, 255, 0.08);
}

body.globe-active #space-side-menu .sm-btn:hover,
body.globe-active #space-side-menu .sm-nav-btn:hover,
body.globe-active #space-side-menu-toggle:hover {
    background: rgba(255, 255, 255, 0.15);
}

#space-side-menu:not(.expanded) .sm-btn[data-tooltip],
#space-side-menu:not(.expanded) .sm-nav-btn[data-tooltip],
#space-side-menu:not(.expanded) #space-side-menu-toggle[data-tooltip],
#space-side-menu.expanded .sm-nav-btn[data-tooltip] {
    position: relative;
}

#space-side-menu:not(.expanded) .sm-btn[data-tooltip]::before,
#space-side-menu:not(.expanded) .sm-nav-btn[data-tooltip]::before,
#space-side-menu:not(.expanded) #space-side-menu-toggle[data-tooltip]::before {
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

#space-side-menu:not(.expanded) .sm-btn[data-tooltip]:hover::before,
#space-side-menu:not(.expanded) .sm-nav-btn[data-tooltip]:hover::before,
#space-side-menu:not(.expanded) #space-side-menu-toggle[data-tooltip]:hover::before {
    opacity: 1;
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn[data-tooltip],
#space-side-menu.expanded #space-side-menu-toggle[data-tooltip] {
    position: relative;
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn[data-tooltip]::before,
#space-side-menu.expanded #space-side-menu-toggle[data-tooltip]::before {
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

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn:nth-child(1)[data-tooltip]::before {
    right: calc(100% + 8px);
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn:nth-child(2)[data-tooltip]::before {
    right: calc(100% + 8px + 50.67px);
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn:nth-child(3)[data-tooltip]::before {
    right: calc(100% + 8px + 101.33px);
}

#space-side-menu.expanded #space-side-menu-toggle[data-tooltip]::before {
    right: calc(100% + 8px);
}

#space-side-menu.expanded #ssm-group-nav .sm-nav-btn[data-tooltip]:hover::before,
#space-side-menu.expanded #space-side-menu-toggle[data-tooltip]:hover::before {
    opacity: 1;
}
</style>
