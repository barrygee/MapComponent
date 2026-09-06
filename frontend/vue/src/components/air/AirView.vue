<template>
  <div id="map-wrap" data-domain="air">
    <h1 class="sr-only">Air — live aircraft tracking</h1>
    <AirMap ref="airMapRef" />
    <AirSideMenu :map-ref="airMapProxy" />
    <NoUrlOverlay domain="air" />
    <AdsbSourceNotice
      :error="adsbSourceClaim.error.value"
      :is-claiming="adsbSourceClaim.isClaiming.value"
      @take-control="adsbSourceClaim.takeControl"
    />
    <Teleport v-if="searchPaneReady" :to="sidebarPaneSelector('search')">
      <AirFilter
        ref="airFilterRef"
        :adsb-control="adsbControlRef"
        :airports-control="airportsControlRef"
        :military-bases-control="milBasesControlRef"
        :get-map="() => airMapRef?.getMap?.() ?? null"
      />
    </Teleport>
    <Teleport v-if="playbackPaneReady" :to="sidebarPaneSelector('playback')">
      <AirReplayPanel />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, markRaw } from 'vue'
import AirMap from './AirMap.vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import AirSideMenu from './AirSideMenu.vue'
import AirFilter from './AirFilter.vue'
import AirReplayPanel from './AirReplayPanel.vue'
import NoUrlOverlay from '@/components/shared/NoUrlOverlay.vue'
import AdsbSourceNotice from './AdsbSourceNotice.vue'
import { sidebarPaneSelector } from '@/constants/sidebarPanes'
import { useSidebarPaneTarget } from '@/composables/useSidebarPaneTarget'
import { useAdsbSourceClaim } from '@/composables/useAdsbSourceClaim'
import type { AdsbLiveControl } from './controls/adsb/AdsbLiveControl'
import type { AirportsToggleControl } from './controls/airports/AirportsControl'
import type { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'

// Holds the Sentry dongle at 1090 MHz for as long as AIR is showing off-grid
// aircraft, and gives it back on the way out. No-op online, where the data comes
// from adsb.lol and no local dongle is involved. See ADR-0003.
const adsbSourceClaim = useAdsbSourceClaim()

const airMapRef = ref<InstanceType<typeof AirMap> | null>(null)
const airFilterRef = ref<InstanceType<typeof AirFilter> | null>(null)

// msb-pane-search / msb-pane-playback live in MapSidebar, a sibling of
// <RouterView> in App.vue — see useSidebarPaneTarget for why this waits
// rather than teleporting unconditionally.
const { ready: searchPaneReady } = useSidebarPaneTarget('search')
const { ready: playbackPaneReady } = useSidebarPaneTarget('playback')

// Stable proxy passed to AirSideMenu — markRaw prevents Vue from tracking
// mutations, so nulling airMapRef during unmount never triggers a re-render
// of AirSideMenu while it is also being torn down.
const airMapProxy = markRaw({
  get current() {
    return airMapRef.value
  },
})

// Reactive refs for controls — updated once the map signals data is ready

const adsbControlRef = shallowRef<AdsbLiveControl | null>(null)
const airportsControlRef = shallowRef<AirportsToggleControl | null>(null)
const milBasesControlRef = shallowRef<MilitaryBasesToggleControl | null>(null)

function syncControls() {
  adsbControlRef.value = airMapRef.value?.getAdsbControl?.() ?? null
  airportsControlRef.value = airMapRef.value?.getAirports?.() ?? null
  milBasesControlRef.value = airMapRef.value?.getMilBases?.() ?? null
}

useDocumentEvent('adsb-data-update', syncControls)

// Ctrl+F / Cmd+F → focus filter input
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    airFilterRef.value?.focus()
  }
}

// Listen for side-menu open-search events
function onOpenSearch() {
  airFilterRef.value?.focus()
}
function onOpenFilter() {
  airFilterRef.value?.focus()
}

// Airport marker click on the map → expand that airport's accordion in the
// SEARCH list. MapSidebar handles opening the panel on the search tab.
function onOpenAirport(e: Event) {
  const icao = (e as CustomEvent<{ icao: string }>).detail?.icao
  if (icao) airFilterRef.value?.expandAirport(icao)
}

// Aircraft click on the map → expand that aircraft's accordion in the SEARCH
// list. MapSidebar handles opening the panel on the search tab.
function onOpenAircraft(e: Event) {
  const hex = (e as CustomEvent<{ hex: string }>).detail?.hex
  if (hex) airFilterRef.value?.expandAircraft(hex)
}

useDocumentEvent('keydown', onKeydown)
useDocumentEvent('air-open-search', onOpenSearch)
useDocumentEvent('air-open-filter', onOpenFilter)
useDocumentEvent('air-open-airport', onOpenAirport)
useDocumentEvent('air-open-aircraft', onOpenAircraft)
</script>
