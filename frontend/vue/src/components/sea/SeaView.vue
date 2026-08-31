<template>
  <div id="map-wrap" data-domain="sea">
    <h1 class="sr-only">Sea domain</h1>
    <NoUrlOverlay domain="sea" />
    <MapLibreMap
      ref="mapRef"
      :style-url="styleUrl"
      region-label="Sea domain map"
      :center="[-2, 54]"
      :zoom="5"
      @map-created="onMapCreated"
      @style-loaded="onStyleLoaded"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import type { Map } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useConnectivity } from '@/composables/useConnectivity'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import NoUrlOverlay from '@/components/shared/NoUrlOverlay.vue'
import { SentrySitesControl } from '@/components/shared/controls/sentry-sites/SentrySitesControl'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useSettingsStore } from '@/stores/settings'

const appStore = useAppStore()
const sentrySitesStore = useSentrySitesStore()
const settingsStore = useSettingsStore()
const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

let _map: Map | null = null
let _initialStyleUrl: string | null = null
// The Sentry sites layer — plotted on every domain map, this one included,
// even though Sea is otherwise still scaffolding.
let _sentrySitesControl: SentrySitesControl | null = null

const styleUrl = computed(() =>
  appStore.isOnline ? '/assets/fiord-online.json' : '/assets/fiord.json',
)

useConnectivity((online) => {
  _map?.setStyle(online ? '/assets/fiord-online.json' : '/assets/fiord.json')
})

function onMapCreated(m: Map) {
  _map = m
  _initialStyleUrl = styleUrl.value
  _sentrySitesControl = new SentrySitesControl(sentrySitesStore, settingsStore)
  _sentrySitesControl.onAdd(m)
}

onBeforeUnmount(() => {
  _sentrySitesControl?.onRemove()
  _sentrySitesControl = null
  _map = null
})
function onStyleLoaded(m: Map) {
  const desiredStyle = styleUrl.value
  if (_initialStyleUrl !== null && _initialStyleUrl !== desiredStyle) {
    m.setStyle(desiredStyle)
  }
  _initialStyleUrl = null
}
</script>
