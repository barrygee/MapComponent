<template>
  <div ref="containerRef" class="map-container" />
</template>

<script setup lang="ts">
// IMPORTANT: The MapLibre Map instance is stored as a plain module-level variable.
// Never put it in ref() or reactive() — Vue's Proxy wrapping breaks WebGL internals.
import { ref, onMounted, onUnmounted } from 'vue'
import maplibregl, { type Map, type StyleSpecification } from 'maplibre-gl'

const props = defineProps<{
  styleUrl: string
  center?: [number, number]
  zoom?: number
  pitch?: number
  bearing?: number
}>()

const emit = defineEmits<{
  'map-created': [map: Map]
  'map-removed': []
  'style-loaded': [map: Map]
}>()

const containerRef = ref<HTMLElement | null>(null)

let map: Map | null = null

onMounted(() => {
  if (!containerRef.value) return
  map = new maplibregl.Map({
    container: containerRef.value,
    style: props.styleUrl,
    center: props.center ?? [0, 51.5],
    zoom: props.zoom ?? 6,
    pitch: props.pitch ?? 0,
    bearing: props.bearing ?? 0,
    attributionControl: false,
  })

  map.on('load', () => { map?.resize() })

  map.on('style.load', () => {
    if (map) emit('style-loaded', map)
  })

  emit('map-created', map)
})

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
    emit('map-removed')
  }
})

function getMap(): Map | null { return map }

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
    transition: opacity 0.2s, color 0.2s;
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
    transition: opacity 0.2s, color 0.2s !important;
}

@keyframes marker-circle-draw {
    to { stroke-dashoffset: 0; }
}

@keyframes marker-dot-pulse {
    0%   { opacity: 1; fill: white; }
    50%  { opacity: 1; fill: var(--color-accent); }
    100% { opacity: 1; fill: white; }
}

@keyframes marker-dot-end-pulse {
    0%   { opacity: 1;    fill: white; }
    40%  { opacity: 0.08; fill: white; }
    100% { opacity: 1;    fill: white; }
}

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
