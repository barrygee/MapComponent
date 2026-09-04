<template>
  <!-- Fixed icon rail pinned to the right edge, mirroring the left #map-sidebar-rail.
       Every control from the full menu is always visible as an icon; the full label
       is the button's accessible name and its hover tooltip. The shell (container,
       accordion mechanics, collapse/touch behaviour) lives in IconRail/
       IconRailAccordion — this component owns only its buttons' content and the
       map-control/store behaviour behind them. -->
  <IconRail
    container-id="side-menu"
    accessible-name="Air map controls"
    :collapsed="!appStore.sideMenuOpen"
  >
    <!-- Zoom + location -->
    <BaseIconButton
      class="sm-btn sm-glyph"
      style="--ba-rail-transition: color 0.15s ease"
      tooltip-side="left"
      tooltip="ZOOM IN"
      accessible-name="Zoom in"
      @click="getMap()?.zoomIn()"
    >
      +
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn sm-glyph"
      style="--ba-rail-transition: color 0.15s ease"
      tooltip-side="left"
      tooltip="ZOOM OUT"
      accessible-name="Zoom out"
      @click="getMap()?.zoomOut()"
    >
      −
    </BaseIconButton>
    <BaseIconButton
      class="sm-btn"
      style="--ba-rail-transition: color 0.15s ease"
      :class="{ active: locActive }"
      :active="locActive"
      tooltip-side="left"
      tooltip="GO TO MY LOCATION"
      accessible-name="Go to my location"
      @click="goToLocation"
    >
      <MyLocationIcon />
    </BaseIconButton>

    <!-- FILTER group: a click-to-expand accordion of aircraft-filter modes
         (all / civil / military) shown below the icon. -->
    <IconRailAccordion panel-id="filter-mode-flyout">
      <template #trigger="{ open: filterAccordionOpen, toggle: toggleFilterAccordion }">
        <BaseIconButton
          id="sm-filter-btn"
          class="sm-btn"
          style="--ba-rail-transition: color 0.15s ease"
          :class="{ active: filterAccordionOpen }"
          :active="filterAccordionOpen"
          tooltip-side="left"
          tooltip="FILTER"
          accessible-name="Filter aircraft"
          aria-controls="filter-mode-flyout"
          :aria-expanded="filterAccordionOpen"
          @click="onFilterAccordionTriggerClick(toggleFilterAccordion)"
        >
          <FilterFunnelIcon />
        </BaseIconButton>
      </template>
      <template #panel>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          :class="{ active: isFilterModeActive('all') }"
          :active="isFilterModeActive('all')"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          data-mode="all"
          tooltip-side="left"
          tooltip="ALL AIRCRAFT"
          accessible-name="Show all aircraft"
          @click="setFilterMode('all')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="8" height="8" stroke="currentColor" stroke-width="1.5" />
            <rect x="13" y="3" width="8" height="8" stroke="currentColor" stroke-width="1.5" />
            <rect x="3" y="13" width="8" height="8" stroke="currentColor" stroke-width="1.5" />
            <rect x="13" y="13" width="8" height="8" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </BaseIconButton>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          :class="{ active: isFilterModeActive('civil') }"
          :active="isFilterModeActive('civil')"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          data-mode="civil"
          tooltip-side="left"
          tooltip="CIVIL AIRCRAFT"
          accessible-name="Civil aircraft only"
          @click="setFilterMode('civil')"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 2C12.8 2 13.2 3.6 13.2 6.6 L21 11.5 V13.4 L13.2 11 V16.5 L15.5 18.5 V20 L12 19 L8.5 20 V18.5 L10.8 16.5 V11 L3 13.4 V11.5 L10.8 6.6 C10.8 3.6 11.2 2 12 2Z"
              fill="currentColor"
            />
          </svg>
        </BaseIconButton>
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          :class="{ active: isFilterModeActive('mil') }"
          :active="isFilterModeActive('mil')"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          data-mode="mil"
          tooltip-side="left"
          tooltip="MILITARY AIRCRAFT"
          accessible-name="Military aircraft only"
          @click="setFilterMode('mil')"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <polygon
              points="12,2 15,9 22,9 16.5,13.5 18.5,21 12,16.5 5.5,21 7.5,13.5 2,9 9,9"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </BaseIconButton>
      </template>
    </IconRailAccordion>

    <!-- LAYERS group: a click-to-expand accordion of every map overlay shown
         below the icon — the map-annotation overlays first (range ring, A2A
         refuelling, AWACS), then the data/base-map layers (ground vehicles,
         towers, location names, airports, military bases). -->
    <IconRailAccordion panel-id="layers-panel">
      <template #trigger="{ open: layersAccordionOpen, toggle: toggleLayersAccordion }">
        <BaseIconButton
          id="sm-layers-btn"
          class="sm-btn"
          style="--ba-rail-transition: color 0.15s ease"
          :class="{ active: layersAccordionOpen }"
          :active="layersAccordionOpen"
          tooltip-side="left"
          tooltip="MAP LAYERS"
          accessible-name="Map layers"
          aria-controls="layers-panel"
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
              stroke-width="1.4"
              stroke-linejoin="round"
              fill="none"
            />
            <path d="M3 12 L12 17 L21 12" stroke="currentColor" stroke-width="1.4" fill="none" />
            <path d="M3 16 L12 21 L21 16" stroke="currentColor" stroke-width="1.4" fill="none" />
          </svg>
        </BaseIconButton>
      </template>
      <template #panel>
        <!-- RANGE RING -->
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          :class="{ active: airStore.overlayStates.rangeRings }"
          :active="airStore.overlayStates.rangeRings"
          tooltip-side="left"
          tooltip="RANGE RING"
          accessible-name="Range ring"
          @click="mapRef.value?.getRangeRings()?.handleClickPublic()"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          </svg>
        </BaseIconButton>

        <!-- A2A REFUELING -->
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          :class="{ active: airStore.overlayStates.aara }"
          :active="airStore.overlayStates.aara"
          tooltip-side="left"
          tooltip="A2A REFUELING"
          accessible-name="A2A refueling"
          @click="mapRef.value?.getAara()?.toggle()"
        >
          <svg
            width="14"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- Fuel droplet — the air-to-air refuelling track. -->
            <path
              d="M12 2 C7 9 5 12 5 15 a7 7 0 1 0 14 0 c0 -3 -2 -6 -7 -13 z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </BaseIconButton>

        <!-- AWACS -->
        <BaseIconButton
          class="sm-btn sm-sub-btn"
          style="
            --ba-rail-hover-bg: rgba(255, 255, 255, 0.2);
            --ba-rail-transition: color 0.15s ease;
          "
          :class="{ active: airStore.overlayStates.awacs }"
          :active="airStore.overlayStates.awacs"
          tooltip-side="left"
          tooltip="AWACS"
          accessible-name="AWACS"
          @click="mapRef.value?.getAwacs()?.toggle()"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <!-- Mirrors the AWACS map overlay: a circle with a semi-transparent fill. -->
            <circle
              cx="12"
              cy="12"
              r="8"
              fill="currentColor"
              fill-opacity="0.2"
              stroke="currentColor"
              stroke-width="1.6"
            />
          </svg>
        </BaseIconButton>
      </template>
    </IconRailAccordion>
  </IconRail>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAirStore } from '@/stores/air'
import { useAppStore } from '@/stores/app'
import { useUserLocation } from '@/composables/useUserLocation'
import MyLocationIcon from '@/components/shared/MyLocationIcon.vue'
import FilterFunnelIcon from '@/components/shared/FilterFunnelIcon.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import IconRail from '@/components/base/IconRail.vue'
import IconRailAccordion from '@/components/base/IconRailAccordion.vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import type AirMap from './AirMap.vue'

// Receives a markRaw proxy so Vue never re-renders this component when the map
// mounts/unmounts — accessing .current is non-reactive by design.
const props = defineProps<{
  mapRef: { current: InstanceType<typeof AirMap> | null }
}>()

// Non-reactive accessor — reads through the proxy at call-time only
const mapRef = {
  get value() {
    return props.mapRef.current
  },
}

const airStore = useAirStore()
const appStore = useAppStore()
const { location: userLocation } = useUserLocation()

const cleared = ref(false)
const locActive = computed(() => userLocation.value !== null)

// FILTER and LAYERS each expand a vertical icon accordion on click; the group
// button is highlighted (green) while its panel is open. The open/toggle state
// itself now lives inside IconRailAccordion (see its #trigger scoped-slot
// binding in the template) rather than a local useDisclosure() call here —
// same transient, non-store lifecycle either way.

// The ADS-B control's filter fields aren't reactive, so mirror them into refs to
// drive the active (green) mode highlight. Synced from the control whenever the
// FILTER accordion's trigger is clicked (covers the open transition — syncing
// again on close is a harmless no-op, the panel is hidden either way) and
// whenever the filter changes anywhere else in the app.
const filterTypeMode = ref<'all' | 'civil' | 'mil'>('all')
const filterAllHidden = ref(false)

function syncFilterStateFromControl() {
  const control = getAdsb()
  if (!control) return
  filterTypeMode.value = control._typeFilter
  filterAllHidden.value = control._allHidden
}

// IconRailAccordion's `open` flag is internal to that component instance (only
// exposed via its #trigger scoped slot), so this component can no longer
// `watch` it directly — the trigger's click handler resyncs explicitly instead.
function onFilterAccordionTriggerClick(toggleFilterAccordion: () => void): void {
  toggleFilterAccordion()
  syncFilterStateFromControl()
}

useDocumentEvent('adsb-filter-change', syncFilterStateFromControl)

// ---- Map access helpers ----
function getMap() {
  const m = mapRef.value as { getMap?: () => import('maplibre-gl').Map | null } | null
  return m?.getMap?.() ?? null
}
function getAdsb() {
  return (
    (mapRef.value?.getAdsbControl?.() as
      | import('./controls/adsb/AdsbLiveControl').AdsbLiveControl
      | null) ?? null
  )
}
// ---- Location ----
function goToLocation() {
  const m = getMap()
  const loc = userLocation.value
  if (!m || !loc) return
  m.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(m.getZoom(), 10), duration: 800 })
}

// ---- Clear overlays ----
// Currently unwired (no template binding); retained for the clear-overlays control.
/* v8 ignore start -- dead code: no template binding and not exposed, so there is
   no path to invoke this from a test. Kept for the clear-overlays control. */
function _toggleClear() {
  const ctrl =
    (mapRef.value?.getClearControl?.() as
      | import('./controls/clear-overlays/ClearOverlaysControl').ClearOverlaysControl
      | null) ?? null
  if (!ctrl) return
  ctrl.toggle()
  cleared.value = ctrl._cleared
}
/* v8 ignore stop */

// ---- Filter accordion ----
function isFilterModeActive(mode: string): boolean {
  return !filterAllHidden.value && filterTypeMode.value === mode
}

function setFilterMode(mode: string) {
  const c = getAdsb()
  if (!c) return
  if (c._allHidden) c.setAllHidden(false)
  c.setTypeFilter(mode as 'all' | 'civil' | 'mil')
  _saveFilter()
  // Let the search list re-apply the same filter to its aircraft section.
  document.dispatchEvent(new CustomEvent('adsb-filter-change'))
}

function _saveFilter() {
  const c = getAdsb()
  /* v8 ignore start -- defensive: the only caller (setFilterMode) already returns
     early when there is no control, so this guard is never the path taken. */
  if (!c) return
  /* v8 ignore stop */
  try {
    localStorage.setItem(
      'adsbFilter',
      JSON.stringify({
        typeFilter: c._typeFilter,
        allHidden: c._allHidden,
      }),
    )
  } catch {}
}

// Persisted filter state (localStorage `adsbFilter`) is restored inside the
// AdsbLiveControl constructor (_loadFilterState) so the first poll renders under
// the correct filter — restoring it here via setTimeout caused civil aircraft to
// flash for ~1s on load before the filter applied.
</script>

<style>
/* Shell (fixed container, accordion panel layout, collapse + touch-tooltip
   behaviour) now lives in IconRail/IconRailAccordion — see
   src/components/base/IconRail.vue and IconRailAccordion.vue. Button chrome
   (size, colour, hover/active, focus, tooltip) lives in the BaseIconButton
   atom. Only this rail's own button-content deltas and the out-of-scope 3D
   controls widget remain here. */
#side-menu .sm-btn.sm-glyph {
  font-size: 18px;
  font-weight: 300;
}

/* Sub-items inherit the rail-button look (white icon, green on hover/active,
   left-opening tooltip) via BaseIconButton; the grey panel background (owned by
   IconRailAccordion) is what sets the open sub-menu apart, and each sub-button's
   own --ba-rail-hover-bg override (set inline in the template) gives it the
   stronger hover fill needed to read against that grey. */

/* 3D controls — pinned bottom-right, shifted left to clear the 44px rail. This
   widget sits outside IconRail entirely (see the template comment above) so it
   keeps its own fixed layout and touch-tooltip suppression. */
</style>
