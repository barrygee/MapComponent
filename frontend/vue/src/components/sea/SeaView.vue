<template>
  <div id="map-wrap" data-domain="sea">
    <NoUrlOverlay domain="sea" />
    <MapLibreMap
      ref="mapRef"
      :style-url="styleUrl"
      :center="[-2, 54]"
      :zoom="5"
      @map-created="onMapCreated"
      @style-loaded="onStyleLoaded"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Map } from 'maplibre-gl'
import { useAppStore } from '@/stores/app'
import { useConnectivity } from '@/composables/useConnectivity'
import MapLibreMap from '@/components/shared/MapLibreMap.vue'
import NoUrlOverlay from '@/components/shared/NoUrlOverlay.vue'

const appStore = useAppStore()
const mapRef = ref<InstanceType<typeof MapLibreMap> | null>(null)

let _map: Map | null = null

const styleUrl = computed(() => appStore.isOnline ? '/assets/fiord-online.json' : '/assets/fiord.json')

useConnectivity((online) => {
  _map?.setStyle(online ? '/assets/fiord-online.json' : '/assets/fiord.json')
})

function onMapCreated(m: Map) { _map = m }
function onStyleLoaded(_map: Map) {}
</script>
