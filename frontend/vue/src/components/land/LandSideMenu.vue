<template>
  <!-- Fixed icon rail pinned to the right edge, mirroring the Air and Space side
       menus — zoom, location, then the FILTER and MAP LAYERS accordions in the
       same order those maps use. Buttons drive the map/controls via handlers
       passed from LandView; the shell (rail, accordion, collapse, tooltips)
       lives in IconRail/IconRailAccordion/BaseIconButton. -->
  <IconRail
    container-id="land-side-menu"
    accessible-name="Land map controls"
    :collapsed="!appStore.sideMenuOpen"
  >
    <BaseIconButton
      class="sm-btn sm-glyph"
      title="Zoom in"
      tooltip-side="left"
      tooltip="Zoom in"
      accessible-name="Zoom in"
      @click="zoomIn"
    >
      +
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn sm-glyph"
      title="Zoom out"
      tooltip-side="left"
      tooltip="Zoom out"
      accessible-name="Zoom out"
      @click="zoomOut"
    >
      −
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn"
      title="Go to my location"
      tooltip-side="left"
      tooltip="Go to my location"
      accessible-name="Go to my location"
      :class="{ active: locationActive }"
      :active="locationActive"
      @click="goToLocation"
    >
      <MyLocationIcon />
    </BaseIconButton>

    <!-- FILTER group: which station types are plotted. APRS is the only Land
         feed today, so it is the sole entry — more join it as they land. The
         APRS button is disabled until a radio has been named as the APRS
         receiver in Settings → LAND: with nothing decoding there is no traffic
         to plot, and a live-looking toggle over an empty map reads as a bug. -->
    <IconRailAccordion panel-id="land-filter-panel">
      <template #trigger="{ open: filterAccordionOpen, toggle: toggleFilterAccordion }">
        <BaseIconButton
          id="land-filter-btn"
          class="sm-btn"
          tooltip-side="left"
          tooltip="FILTER"
          accessible-name="Filter stations"
          :class="{ active: filterAccordionOpen }"
          :active="filterAccordionOpen"
          aria-controls="land-filter-panel"
          :aria-expanded="filterAccordionOpen"
          @click="toggleFilterAccordion"
        >
          <FilterFunnelIcon />
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
          :tooltip="aprsSourceConfigured ? 'APRS STATIONS' : 'APRS STATIONS — NO SDR SET'"
          :accessible-name="
            aprsSourceConfigured
              ? 'APRS stations'
              : 'APRS stations — unavailable until an APRS SDR is chosen in Land settings'
          "
          :class="{ active: aprsActive }"
          :active="aprsActive"
          :disabled="!aprsSourceConfigured"
          @click="toggleAprs"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="11" r="1.6" fill="currentColor" stroke="none" />
            <path d="M5.2 8.2a4 4 0 0 1 5.6 0" />
            <path d="M3.4 6.4a6.6 6.6 0 0 1 9.2 0" />
          </svg>
        </BaseIconButton>
      </template>
    </IconRailAccordion>

    <!-- MAP LAYERS group: the map-annotation overlay (range rings) first, then
         the shared base-map layers, matching the Air rail's panel order. -->
    <IconRailAccordion panel-id="land-layers-panel">
      <template #trigger="{ open: layersAccordionOpen, toggle: toggleLayersAccordion }">
        <BaseIconButton
          id="land-layers-btn"
          class="sm-btn"
          tooltip-side="left"
          tooltip="MAP LAYERS"
          accessible-name="Map layers"
          :class="{ active: layersAccordionOpen }"
          :active="layersAccordionOpen"
          aria-controls="land-layers-panel"
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
          tooltip="RANGE RINGS"
          accessible-name="Range rings"
          :class="{ active: rangeRingsActive }"
          :active="rangeRingsActive"
          @click="toggleRangeRings"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.8" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
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
          :class="{ active: basemapStore.layers.names }"
          :active="basemapStore.layers.names"
          @click="toggleNames"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 22C12 22 19 14 19 9A7 7 0 1 0 5 9C5 14 12 22 12 22Z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
              fill="none"
            />
            <circle cx="12" cy="9" r="2.4" stroke="currentColor" stroke-width="1.6" fill="none" />
          </svg>
        </BaseIconButton>
      </template>
    </IconRailAccordion>
  </IconRail>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useBasemapStore } from '@/stores/basemap'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import IconRail from '@/components/base/IconRail.vue'
import IconRailAccordion from '@/components/base/IconRailAccordion.vue'
import FilterFunnelIcon from '@/components/shared/FilterFunnelIcon.vue'
import MyLocationIcon from '@/components/shared/MyLocationIcon.vue'

defineProps<{
  zoomIn: () => void
  zoomOut: () => void
  goToLocation: () => void
  toggleRangeRings: () => void
  toggleAprs: () => void
  toggleNames: () => void
  rangeRingsActive: boolean
  aprsActive: boolean
  /** Whether an SDR has been chosen as the APRS receiver in Settings → LAND. */
  aprsSourceConfigured: boolean
  locationActive: boolean
}>()

const appStore = useAppStore()
// Location names are a shared base-map layer, so the active state is read
// straight off the cross-domain store rather than passed in from LandView.
const basemapStore = useBasemapStore()
</script>

<style>
/* Only the glyph-button content delta remains local; the rail shell + button
   chrome come from IconRail + BaseIconButton (see SpaceSideMenu for the same
   pattern). */
#land-side-menu .sm-btn.sm-glyph {
  font-size: 18px;
  font-weight: 300;
}
</style>
