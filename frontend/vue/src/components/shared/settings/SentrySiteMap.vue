<template>
  <!-- The WebGL canvas is opaque to assistive tech, so the container is exposed
       as a named region (WCAG 1.1.1 / 4.1.2), same as the domain maps. The
       LATITUDE/LONGITUDE cells above are its accessible text equivalent. -->
  <div
    ref="containerRef"
    class="sentry-site-map"
    role="region"
    :aria-label="`Map showing ${label} at latitude ${latitude.toFixed(4)}, longitude ${longitude.toFixed(4)}`"
  ></div>
</template>

<script setup lang="ts">
/**
 * `SentrySiteMap` — a small basemap plotting one Sentry at the
 * position it reports, using the same `⊙` logo marker (`UserLocationMarker`)
 * and the same online fiord style as the domain maps, so the Pi reads as a
 * Sentinel site rather than as a generic pin.
 *
 * Deliberately NOT built on `MapLibreMap.vue`: that component is the *domain*
 * map — it assigns `window.map` (which the domain views and controls treat as
 * the one live map) and positions itself absolutely to fill its view. Both
 * would be wrong here, so this owns its own small `maplibregl.Map`.
 *
 * Zoomable and pannable, but with scroll-wheel zoom deliberately OFF: a
 * scroll-zooming map inside a scrolling settings panel swallows the page
 * scroll. Zoom is driven by the `+`/`−` buttons, double-click, pinch, and the
 * keyboard instead. The caller renders it only in online mode — the offline
 * PMTiles basemap is a domain-map concern and is not worth loading here.
 *
 * The instance is held in a plain variable, never `ref()`/`reactive()` —
 * Vue's Proxy wrapping breaks MapLibre's WebGL internals.
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import maplibregl, { type Map as MapLibreGlMap } from 'maplibre-gl'
import { UserLocationMarker } from '@/components/shared/UserLocationMarker'

/** The same online style the Air/Land domain maps load. */
const STYLE_ONLINE = '/assets/fiord-online.json'

/** Close enough to read the Pi's surroundings without implying GPS precision. */
const SITE_ZOOM = 11

const props = defineProps<{
  latitude: number
  longitude: number
  /** Used only for the map's accessible name, e.g. the host's label. */
  label: string
}>()

const containerRef = ref<HTMLElement | null>(null)

let map: MapLibreGlMap | null = null
const siteMarker = new UserLocationMarker('sentry-site-marker')

onMounted(() => {
  /* v8 ignore start -- containerRef is always bound by the time onMounted runs;
     defensive only, matching MapLibreMap's own guard */
  if (!containerRef.value) return
  /* v8 ignore stop */
  map = new maplibregl.Map({
    container: containerRef.value,
    style: STYLE_ONLINE,
    center: [props.longitude, props.latitude],
    zoom: SITE_ZOOM,
    attributionControl: false,
    fadeDuration: 0,
  })
  // Everything except the wheel: see the component doc for why.
  map.scrollZoom.disable()
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  siteMarker.addTo(map)
  siteMarker.update(props.longitude, props.latitude)
  // The accordion that owns this map was hidden until the moment it mounted,
  // so MapLibre may have measured the container before it had a size.
  map.on('load', () => map?.resize())
})

// A Sentry that is re-sited (or a different host opened in the same row) moves
// the marker rather than rebuilding the map.
watch(
  () => [props.longitude, props.latitude] as const,
  ([longitude, latitude]) => {
    siteMarker.update(longitude, latitude)
    map?.setCenter([longitude, latitude])
  },
)

onUnmounted(() => {
  siteMarker.destroy()
  /* v8 ignore start -- map is always set after a successful mount, pairing with
     the defensive container guard above */
  if (map) {
    map.remove()
    map = null
  }
  /* v8 ignore stop */
})
</script>

<style scoped>
.sentry-site-map {
  width: 100%;
  height: 360px;
  /* Matches MapLibreMap's canvas backdrop so the tile load has nothing to
     flash against. Square corners, per the settings design language. */
  background-color: #2d3548;
}
</style>

<style>
/* Not scoped: MapLibre creates the marker element itself and appends it to the
   map container, so it never carries this component's scope attribute — the
   same reason MapLibreMap.vue styles `.user-location-marker` globally. Scaled
   down from that 60px domain-map marker to suit this smaller map. */
.sentry-site-marker {
  width: 44px;
  height: 44px;
  overflow: visible;
}
.sentry-site-marker svg {
  width: 44px;
  height: 44px;
  overflow: visible;
}
</style>
