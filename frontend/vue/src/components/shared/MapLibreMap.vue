<template>
  <!-- The WebGL canvas is opaque to assistive tech, so the container is exposed
       as a named region (WCAG 1.1.1 / 4.1.2) with an optional visually-hidden
       description that points screen-reader users at the accessible list/table
       equivalents of the on-map entities (the sidebar panels). -->
  <div
    ref="containerRef"
    class="map-container"
    role="region"
    :aria-label="regionLabel"
    :aria-describedby="regionDescription ? descriptionId : undefined"
  >
    <p v-if="regionDescription" :id="descriptionId" class="sr-only">{{ regionDescription }}</p>
  </div>
</template>

<script setup lang="ts">
// IMPORTANT: The MapLibre Map instance is stored as a plain module-level variable.
// Never put it in ref() or reactive() — Vue's Proxy wrapping breaks WebGL internals.
import { ref, onMounted, onUnmounted, useId } from 'vue'
import maplibregl, { type Map } from 'maplibre-gl'

// `regionLabel`/`regionDescription` are deliberately NOT named `ariaLabel` etc.:
// `aria-*` attributes on a component fall through to the root element instead of
// binding to a prop, so an `aria`-prefixed prop name would never receive a value.
const props = defineProps<{
  styleUrl: string
  /** Accessible name for the map region (e.g. "Air domain map"). */
  regionLabel: string
  /**
   * Optional visually-hidden description, surfaced via aria-describedby — used to
   * direct assistive-tech users to the list/table alternative of the map's data.
   */
  regionDescription?: string
  center?: [number, number]
  zoom?: number
  pitch?: number
  bearing?: number
}>()

const descriptionId = useId()

const emit = defineEmits<{
  'map-created': [map: Map]
  'map-removed': []
  'style-loaded': [map: Map]
}>()

const containerRef = ref<HTMLElement | null>(null)

let map: Map | null = null

onMounted(() => {
  /* v8 ignore start -- containerRef is always bound by the time onMounted runs;
     this guard is purely defensive against a missing container element */
  if (!containerRef.value) return
  /* v8 ignore stop */
  map = new maplibregl.Map({
    container: containerRef.value,
    style: props.styleUrl,
    center: props.center ?? [0, 51.5],
    zoom: props.zoom ?? 6,
    pitch: props.pitch ?? 0,
    bearing: props.bearing ?? 0,
    attributionControl: false,
    // MapLibre cross-fades symbol layers over 300ms by default, so toggling the
    // LOCATION NAMES layer made the labels drift in rather than snap on. Zero
    // makes every symbol layer (labels included) appear instantly.
    fadeDuration: 0,
  })

  map.on('load', () => {
    map?.resize()
  })

  map.on('style.load', () => {
    if (map) emit('style-loaded', map)
  })

  emit('map-created', map)
  ;(window as unknown as { map?: maplibregl.Map }).map = map
})

onUnmounted(() => {
  /* v8 ignore start -- map is always set after a successful mount, so the false
     branch pairs with the defensive container guard in onMounted and is
     unreachable in a normal mount/unmount cycle */
  if (map) {
    map.remove()
    map = null
    emit('map-removed')
  }
  /* v8 ignore stop */
})

function getMap(): Map | null {
  return map
}

defineExpose({ getMap })
</script>

<style>
.map-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  /* Match the filtered map background colour so any sub-pixel seams between
     world copies blend in instead of showing the page's black behind the canvas. */
  background-color: #2d3548;
}

#map {
  position: absolute;
  top: var(--nav-height);
  bottom: var(--footer-height);
  width: 100%;
}

.maplibregl-canvas {
  filter: brightness(0.65) saturate(0.85);
}

.maplibregl-ctrl-group {
  background-color: #000000 !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.maplibregl-ctrl-group button + button {
  border-top: 1px solid var(--color-border) !important;
}

.maplibregl-ctrl-icon {
  filter: invert(1) brightness(1.2) !important;
}

.maplibregl-ctrl-group button:hover {
  background-color: #111111 !important;
}

.maplibregl-ctrl-compass .maplibregl-ctrl-icon {
  filter: invert(1) brightness(2) !important;
}

.maplibregl-ctrl-group button {
  cursor: pointer;
  transition:
    opacity 0.2s,
    color 0.2s;
}

.maplibregl-ctrl-top-right {
  right: 14px;
  top: 12px;
}

.maplibregl-ctrl:not(.maplibregl-ctrl-group) {
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 0 !important;
}

.maplibregl-ctrl button {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif !important;
  letter-spacing: 0.08em !important;
  font-weight: 600 !important;
  transition:
    opacity 0.2s,
    color 0.2s !important;
}

@keyframes marker-circle-draw {
  to {
    stroke-dashoffset: 0;
  }
}

/* (The former marker-dot-pulse / marker-dot-end-pulse keyframes are gone —
   the ⊙ marker's dot is now static solid white by design.) */

.user-location-marker,
.space-user-location-marker {
  cursor: pointer;
  width: 60px;
  height: 60px;
  overflow: visible;
  position: relative;
}

.user-location-marker svg,
.space-user-location-marker svg {
  overflow: visible;
}

/* ── Sentry sites (SentrySitesControl) ──────────────────────────────────────
   The ⊙ mark again — same size and shape as the user-location marker — with
   the site's details in a pill butted against it, built like the map's own
   right-click menu so the two read as one piece of map furniture. */
.sentry-map-marker {
  position: relative;
  width: 60px;
  height: 60px;
  overflow: visible;
  line-height: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
}

.sentry-map-marker-mark {
  display: block;
  /* Above the details pill, which starts at this mark's own centre: the pill
     has a circle masked out of its leading edge so the ⊙ shows through, but a
     mask hides pixels without giving up pointer events — so without this the
     pill would swallow clicks aimed at the mark it is hanging off. */
  position: relative;
  z-index: 3;
  width: 60px;
  height: 60px;
  padding: 0;
  border: none;
  background: none;
  overflow: visible;
  cursor: pointer;
  line-height: 0;
}

.sentry-map-marker-mark svg {
  overflow: visible;
}

/* The mark is a circle in the middle of a large transparent box, so the default
   outline would float well clear of it — the ring itself lights up instead. */
.sentry-map-marker-mark:focus-visible {
  outline: none;
}

.sentry-map-marker-mark:focus-visible svg circle:first-of-type {
  stroke: var(--color-accent);
  stroke-width: 3.4;
}

/* The details pill. Starts at the mark's centre and has a circle masked out of
   its leading edge, so the ⊙ stays whole and the panel appears to hang off it —
   the same construction the "SET LOCATION" menu uses. */
.sentry-map-marker-info {
  position: absolute;
  left: 30px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 2px;
  min-height: 42px;
  /* Left padding clears the mark's full box, not just the masked circle, so no
     text sits under the mark's own hit area. */
  padding: 6px 14px 6px 32px;
  background: #000;
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  -webkit-mask-image: radial-gradient(circle 16px at 0 50%, transparent 16px, black 16.5px);
  mask-image: radial-gradient(circle 16px at 0 50%, transparent 16px, black 16.5px);
  z-index: 2;
}

/* Shown while the pointer is over the marker, while anything inside it holds
   focus (so the MORE action is reachable by keyboard), and once a press has
   latched it open. */
.sentry-map-marker:hover .sentry-map-marker-info,
.sentry-map-marker:focus-within .sentry-map-marker-info,
.sentry-map-marker--open .sentry-map-marker-info {
  display: flex;
}

.sentry-map-marker-name {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  line-height: 1.2;
  text-transform: uppercase;
}

.sentry-map-marker-meta {
  display: flex;
  align-items: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.12em;
  line-height: 1.2;
  text-transform: uppercase;
}

/* Reachability, matching the dot the SDR settings rows use. Never the only
   carrier of the state — the markup pairs it with a title and an sr-only
   label. */
.sentry-map-marker-status {
  display: inline-block;
  position: relative;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}

.sentry-map-marker-status--online {
  background: var(--color-accent);
}

.sentry-map-marker-status--offair {
  background: #ef4444;
}

/* A text link, not a boxed button: the pill is small, and the action is a way
   onward rather than the point of the panel. */
.sentry-map-marker-more {
  margin-top: 2px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font-family: inherit;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  line-height: 1.2;
  text-transform: uppercase;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.sentry-map-marker-more:hover {
  color: #ffffff;
}

.sentinel-context-menu {
  position: absolute;
  background: #000;
  border: none;
  padding: 4px 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  z-index: 9999;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.9);
  min-width: 180px;
  cursor: default;
}

.sentinel-context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  white-space: nowrap;
}

.sentinel-context-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
