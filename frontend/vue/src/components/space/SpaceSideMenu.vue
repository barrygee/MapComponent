<template>
  <!-- Fixed icon rail pinned to the right edge, mirroring the left #map-sidebar-rail.
       Every control is always visible as an icon; the full label is the hover tooltip.
       The shell (container, accordion mechanics, collapse/touch behaviour) lives in
       IconRail/IconRailAccordion — this component owns only its buttons' content and
       the map-control/store behaviour behind them. -->
  <IconRail
    container-id="space-side-menu"
    accessible-name="Space map controls"
    :collapsed="!appStore.sideMenuOpen"
  >
    <BaseIconButton
      class="sm-btn sm-glyph"
      style="--ba-rail-transition: color 0.15s ease"
      title="Zoom in"
      tooltip-side="left"
      tooltip="Zoom in"
      accessible-name="Zoom in"
      @click="mapRef.value?.getMap()?.zoomIn()"
    >
      +
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn sm-glyph"
      style="--ba-rail-transition: color 0.15s ease"
      title="Zoom out"
      tooltip-side="left"
      tooltip="Zoom out"
      accessible-name="Zoom out"
      @click="mapRef.value?.getMap()?.zoomOut()"
    >
      −
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn"
      style="--ba-rail-transition: color 0.15s ease"
      title="Go to my location"
      tooltip-side="left"
      tooltip="Go to my location"
      accessible-name="Go to my location"
      :class="{ active: locActive }"
      :active="locActive"
      @click="goToLocation"
    >
      <MyLocationIcon />
    </BaseIconButton>

    <!-- MAP LAYERS group: a click-to-expand accordion of the satellite overlays
         (ground track, footprint, day/night, place names). -->
    <IconRailAccordion panel-id="space-layers-panel">
      <template #trigger="{ open: layersAccordionOpen, toggle: toggleLayersAccordion }">
        <BaseIconButton
          id="space-layers-btn"
          class="sm-btn"
          style="--ba-rail-transition: color 0.15s ease"
          :class="{ active: layersAccordionOpen }"
          :active="layersAccordionOpen"
          tooltip-side="left"
          tooltip="MAP LAYERS"
          accessible-name="Map layers"
          aria-controls="space-layers-panel"
          :aria-expanded="layersAccordionOpen"
          @click="toggleLayersAccordion"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 3 L21 8 L12 13 L3 8 Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
              fill="none"
            />
            <path d="M3 12 L12 17 L21 12" stroke="currentColor" stroke-width="1.6" fill="none" />
            <path d="M3 16 L12 21 L21 16" stroke="currentColor" stroke-width="1.6" fill="none" />
          </svg>
        </BaseIconButton>
      </template>
      <template #panel>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          tooltip-side="left"
          tooltip="GROUND TRACK"
          accessible-name="Ground track"
          :class="{ active: trackActive }"
          :active="trackActive"
          @click="toggleTrack"
        >
          <svg
            width="18"
            height="16"
            viewBox="0 0 24 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M2 14 C6 10, 10 6, 14 6 S20 8 22 4"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="3,2"
              fill="none"
            />
          </svg>
        </BaseIconButton>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          tooltip-side="left"
          tooltip="FOOTPRINT"
          accessible-name="Footprint"
          :class="{ active: footprintActive }"
          :active="footprintActive"
          @click="toggleFootprint"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- Satellite beaming a coverage cone down to its ground footprint. -->
            <circle cx="12" cy="3.5" r="2" fill="currentColor" />
            <path
              d="M10.5 5 L5 15.5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
            <path
              d="M13.5 5 L19 15.5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
            <ellipse
              cx="12"
              cy="17"
              rx="7.5"
              ry="2.8"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-dasharray="3,2"
              fill="none"
            />
          </svg>
        </BaseIconButton>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          tooltip-side="left"
          tooltip="DAY / NIGHT"
          accessible-name="Day / night"
          :class="{ active: daynightActive }"
          :active="daynightActive"
          @click="toggleDaynight"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- Half-lit globe — the day/night terminator. -->
            <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 2.5 A9.5 9.5 0 0 1 12 21.5 Z" fill="currentColor" />
          </svg>
        </BaseIconButton>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          tooltip-side="left"
          tooltip="LOCATION NAMES"
          accessible-name="Location name labels"
          :class="{ active: namesActive }"
          :active="namesActive"
          @click="toggleNames"
        >
          <svg
            width="15"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 22.5 C12 22.5 20 13.5 20 8.5 A8 8 0 1 0 4 8.5 C4 13.5 12 22.5 12 22.5Z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
              fill="none"
            />
            <circle cx="12" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.8" fill="none" />
          </svg>
        </BaseIconButton>
      </template>
    </IconRailAccordion>
  </IconRail>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSpaceStore } from '@/stores/space'
import { useAppStore } from '@/stores/app'
import { useBasemapStore } from '@/stores/basemap'
import { useUserLocation } from '@/composables/useUserLocation'
import MyLocationIcon from '@/components/shared/MyLocationIcon.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import IconRail from '@/components/base/IconRail.vue'
import IconRailAccordion from '@/components/base/IconRailAccordion.vue'
import type SpaceMap from './SpaceMap.vue'

// markRaw proxy from SpaceView — .current is non-reactive, preventing re-renders during teardown
const props = defineProps<{ mapRef: { current: InstanceType<typeof SpaceMap> | null } }>()

const mapRef = {
  get value() {
    return props.mapRef.current
  },
}

const spaceStore = useSpaceStore()
const appStore = useAppStore()
const basemapStore = useBasemapStore()
const { location: userLocation } = useUserLocation()

const locActive = computed(() => userLocation.value !== null)

const trackActive = computed(() => spaceStore.overlayStates.groundTrack)
const footprintActive = computed(() => spaceStore.overlayStates.footprint)
const daynightActive = computed(() => spaceStore.overlayStates.daynight)
// Place names are a shared base-map layer (see stores/basemap.ts), so this
// mirrors the same flag the Air and Land maps drive.
const namesActive = computed(() => basemapStore.layers.names)

// The satellite overlays expand from a single MAP LAYERS icon accordion; the
// group button is highlighted (green) while its panel is open. The
// open/toggle state itself now lives inside IconRailAccordion (see its
// #trigger scoped-slot binding in the template) rather than a local
// useDisclosure() call here — same transient, non-store lifecycle either way.

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

function toggleNames(): void {
  mapRef.value?.getNamesControl()?.handleClickPublic()
}
</script>

<style>
/* Shell (fixed container, accordion panel layout, collapse + touch-tooltip
   behaviour) now lives in IconRail/IconRailAccordion — see
   src/components/base/IconRail.vue and IconRailAccordion.vue. Button chrome
   (size, colour, hover/active, focus, tooltip) lives in the BaseIconButton
   atom. Only this rail's own button-content deltas remain here. */
#space-side-menu .sm-btn.sm-glyph {
  font-size: 18px;
  font-weight: 300;
}

/* Sub-items sit on the grey accordion panel; each one's own --ba-rail-hover-bg
   override (set inline in the template) gives it the stronger hover fill
   needed to read against that grey. */
</style>
