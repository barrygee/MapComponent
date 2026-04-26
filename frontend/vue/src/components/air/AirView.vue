<template>
  <div id="map-wrap" data-domain="air">
    <AirMap ref="airMapRef" />
    <AirSideMenu :map-ref="airMapProxy" />
    <NoUrlOverlay domain="air" />
    <Teleport v-if="teleportReady" to="#msb-pane-search">
      <AirFilter
        :adsb-control="adsbControlRef"
        :airports-control="airportsControlRef"
        :military-bases-control="milBasesControlRef"
        :get-map="() => airMapRef?.getMap?.() ?? null"
        ref="airFilterRef"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, markRaw, onMounted } from 'vue'
import AirMap from './AirMap.vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import AirSideMenu from './AirSideMenu.vue'
import AirFilter from './AirFilter.vue'
import NoUrlOverlay from '@/components/shared/NoUrlOverlay.vue'
import type { AdsbLiveControl } from './controls/adsb/AdsbLiveControl'
import type { AirportsToggleControl } from './controls/airports/AirportsControl'
import type { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'

const airMapRef    = ref<InstanceType<typeof AirMap> | null>(null)
const airFilterRef = ref<InstanceType<typeof AirFilter> | null>(null)
const teleportReady = ref(!!document.getElementById('msb-pane-search'))

// msb-pane-search lives in MapSidebar which mounts after RouterView in App.vue;
// poll until it exists so the Teleport never activates against a null target.
if (!teleportReady.value) {
  onMounted(() => {
    function poll() {
      if (document.getElementById('msb-pane-search')) { teleportReady.value = true }
      else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  })
}

// Stable proxy passed to AirSideMenu — markRaw prevents Vue from tracking
// mutations, so nulling airMapRef during unmount never triggers a re-render
// of AirSideMenu while it is also being torn down.
const airMapProxy = markRaw({ get current() { return airMapRef.value } })

// Reactive refs for controls — updated once the map signals data is ready

const adsbControlRef     = shallowRef<AdsbLiveControl | null>(null)
const airportsControlRef = shallowRef<AirportsToggleControl | null>(null)
const milBasesControlRef = shallowRef<MilitaryBasesToggleControl | null>(null)

function syncControls() {
  adsbControlRef.value     = airMapRef.value?.getAdsbControl?.() ?? null
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
function onOpenSearch() { airFilterRef.value?.focus() }
function onOpenFilter() { airFilterRef.value?.focus() }

useDocumentEvent('keydown', onKeydown)
useDocumentEvent('air-open-search', onOpenSearch)
useDocumentEvent('air-open-filter', onOpenFilter)
</script>
