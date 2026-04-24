<template>
  <div id="filter-input-wrap">
    <svg id="filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/>
      <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    <input
      ref="inputRef"
      id="filter-input"
      type="text"
      placeholder="CALLSIGN · ICAO · SQUAWK"
      autocomplete="off"
      spellcheck="false"
      :value="query"
      @input="onInput"
      @keydown="onKeydown"
    />
    <button
      id="filter-clear-btn"
      :class="{ 'filter-clear-visible': query.length > 0 }"
      aria-label="Clear filter"
      @click="clearInput"
    >✕</button>
  </div>

  <div id="filter-results" ref="resultsRef">
    <template v-if="!results.length">
      <div class="filter-no-results">No results</div>
    </template>
    <template v-else>
      <!-- Aircraft section -->
      <template v-if="planes.length">
        <div class="filter-section-label">AIRCRAFT</div>
        <div
          v-for="r in planes"
          :key="r.hex"
          class="filter-result-item"
          :class="{ 'keyboard-focused': focusedKey === r.hex }"
        >
          <div class="filter-result-icon filter-icon-plane" @click="selectPlane(r)" v-html="PLANE_ICON" />
          <div class="filter-result-info" @click="selectPlane(r)">
            <div class="filter-result-primary">{{ r.callsign || r.hex }}</div>
            <div class="filter-result-secondary">{{ planeSecondary(r) }}</div>
          </div>
          <button
            class="filter-action-btn filter-bell-btn"
            :class="{ 'filter-bell-btn--active': notifEnabled.has(r.hex) }"
            aria-label="Toggle notifications"
            @mousedown.stop
            @click.stop="toggleNotif(r.hex)"
            v-html="bellSvg(r.hex)"
          />
        </div>
      </template>

      <!-- Airports section -->
      <template v-if="airports.length">
        <div class="filter-section-label">AIRPORTS</div>
        <div
          v-for="r in airports"
          :key="r.icao"
          class="filter-result-item"
          :class="{ 'keyboard-focused': focusedKey === r.icao }"
        >
          <div class="filter-result-icon filter-icon-airport" @click="selectAirport(r)" v-html="AIRPORT_ICON" />
          <div class="filter-result-info" @click="selectAirport(r)">
            <div class="filter-result-primary">{{ r.icao }}</div>
            <div class="filter-result-secondary">{{ r.name.toUpperCase() }}{{ r.iata ? ' · ' + r.iata : '' }}</div>
          </div>
          <div class="filter-result-badge">CVL</div>
        </div>
      </template>

      <!-- Military bases section -->
      <template v-if="milBases.length">
        <div class="filter-section-label">MILITARY BASES</div>
        <div
          v-for="r in milBases"
          :key="r.name"
          class="filter-result-item"
          :class="{ 'keyboard-focused': focusedKey === r.name }"
        >
          <div class="filter-result-icon filter-icon-mil" @click="selectMil(r)" v-html="MIL_ICON" />
          <div class="filter-result-info" @click="selectMil(r)">
            <div class="filter-result-primary">{{ r.icao || r.name.toUpperCase().slice(0, 6) }}</div>
            <div class="filter-result-secondary">{{ r.name.toUpperCase() }}</div>
          </div>
          <div class="filter-result-badge">MIL</div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { AIRPORTS_DATA, type AirportProperties } from './controls/airports/AirportsControl'
import { MILITARY_BASES_DATA } from './controls/military-bases/MilitaryBasesControl'
import type { AdsbLiveControl } from './controls/adsb/AdsbLiveControl'
import type { AirportsToggleControl } from './controls/airports/AirportsControl'
import type { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'
import { useNotificationsStore } from '@/stores/notifications'

interface PlaneResult {
  kind: 'plane'
  hex: string; callsign: string; reg: string; squawk: string; emergency: boolean
  coords: [number, number]
}
interface AirportResult {
  kind: 'airport'
  icao: string; iata: string; name: string
  bounds: [number, number, number, number]
  coords: [number, number]
}
interface MilResult {
  kind: 'mil'
  icao: string; name: string
  bounds: [number, number, number, number]
  coords: [number, number]
}

const props = defineProps<{
  adsbControl:         AdsbLiveControl | null
  airportsControl:     AirportsToggleControl | null
  militaryBasesControl: MilitaryBasesToggleControl | null
  getMap: () => import('maplibre-gl').Map | null
}>()

const notificationsStore = useNotificationsStore()

const inputRef  = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)
const query      = ref('')
const focusedKey = ref<string | null>(null)

// Notification state — mirrors adsbControl._notifEnabled reactively
const notifEnabled = ref<Set<string>>(new Set())

// Aircraft data — refreshed on adsb-data-update event
const aircraftFeatures = ref<Array<{ properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }>>([])

function refreshAircraft() {
  if (props.adsbControl?._geojson?.features) {
    aircraftFeatures.value = props.adsbControl._geojson.features as unknown as typeof aircraftFeatures.value
  } else {
    aircraftFeatures.value = []
  }
}

function onMsbTabSwitch(e: Event): void {
  const tab = (e as CustomEvent<string>).detail
  if (tab === 'search') refreshAircraft()
}


useDocumentEvent('adsb-data-update', refreshAircraft)
useDocumentEvent('msb-tab-switch', onMsbTabSwitch)

// ---- Search results ----
const results = computed<Array<PlaneResult | AirportResult | MilResult>>(() => {
  const q = query.value.trim().toLowerCase()
  const out: Array<PlaneResult | AirportResult | MilResult> = []

  // Aircraft
  for (const f of aircraftFeatures.value) {
    const p = f.properties
    const callsign = ((p.flight as string) || '').trim()
    const hex      = ((p.hex as string) || '').trim()
    const reg      = ((p.r as string) || '').trim()
    const squawk   = ((p.squawk as string) || '').trim()
    if (!q || [callsign, hex, reg, squawk].some(v => v.toLowerCase().includes(q))) {
      out.push({
        kind: 'plane', hex, callsign, reg, squawk,
        emergency: !!(p.emergency) && p.emergency !== 'none',
        coords: f.geometry.coordinates,
      })
    }
  }

  // Airports
  for (const f of AIRPORTS_DATA.features) {
    const p = f.properties
    if (!q || [p.icao, p.iata, p.name].some(v => v?.toLowerCase().includes(q))) {
      out.push({ kind: 'airport', icao: p.icao, iata: p.iata, name: p.name, bounds: p.bounds, coords: f.geometry.coordinates as [number, number] })
    }
  }

  // Military bases
  for (const f of MILITARY_BASES_DATA.features) {
    const p = f.properties
    if (!q || [p.icao, p.name].some(v => v?.toLowerCase().includes(q))) {
      out.push({ kind: 'mil', icao: p.icao, name: p.name, bounds: p.bounds, coords: f.geometry.coordinates as [number, number] })
    }
  }

  return out
})

const planes   = computed(() => results.value.filter(r => r.kind === 'plane')   as PlaneResult[])
const airports = computed(() => results.value.filter(r => r.kind === 'airport') as AirportResult[])
const milBases = computed(() => results.value.filter(r => r.kind === 'mil')     as MilResult[])

// ---- SVG icons ----
const PLANE_ICON   = `<svg width="11" height="11" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="currentColor"/></svg>`
const AIRPORT_ICON = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.4"/><line x1="6.5" y1="2" x2="6.5" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="6.5" x2="11" y2="6.5" stroke="currentColor" stroke-width="1.2"/></svg>`
const MIL_ICON     = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6.5,1.5 12,11.5 1,11.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`

function bellSvg(hex: string): string {
  const on = notifEnabled.value.has(hex)
  return `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
    `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
    (on ? '' : `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`) +
    `</svg>`
}

function planeSecondary(r: PlaneResult): string {
  const parts: string[] = []
  if (r.hex)    parts.push(r.hex.toUpperCase())
  if (r.reg)    parts.push(r.reg)
  if (r.squawk) parts.push('SQK ' + r.squawk)
  return parts.join(' · ')
}

// ---- Input handlers ----
function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value
  focusedKey.value = null
}

function clearInput() {
  query.value = ''
  focusedKey.value = null
  inputRef.value?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { query.value = ''; return }

  const allItems = results.value
  if (!allItems.length) return

  const keys = allItems.map(r => r.kind === 'plane' ? r.hex : r.kind === 'airport' ? r.icao : r.name)
  const idx = focusedKey.value ? keys.indexOf(focusedKey.value) : -1

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusedKey.value = keys[idx + 1] ?? keys[0]
    scrollToFocused()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusedKey.value = idx > 0 ? keys[idx - 1] : null
    if (focusedKey.value) scrollToFocused()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const focused = allItems[idx]
    if (focused) {
      activateResult(focused)
      inputRef.value?.focus()
    } else {
      focusedKey.value = keys[0]
      scrollToFocused()
    }
  }
}

function scrollToFocused() {
  if (!resultsRef.value || !focusedKey.value) return
  // requestAnimationFrame to let Vue render the class change first
  requestAnimationFrame(() => {
    const el = resultsRef.value?.querySelector('.keyboard-focused') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function activateResult(r: PlaneResult | AirportResult | MilResult) {
  if (r.kind === 'plane')   selectPlane(r)
  if (r.kind === 'airport') selectAirport(r)
  if (r.kind === 'mil')     selectMil(r)
}

// ---- Selection actions ----
function selectPlane(r: PlaneResult) {
  const c = props.adsbControl
  if (!c) return
  c._selectedHex = r.hex
  c._applySelection()
  const coords = c._interpolatedCoords(r.hex) ?? r.coords
  const m = props.getMap()
  if (m) m.easeTo({ center: coords, zoom: Math.max(m.getZoom(), 10), duration: 600 })
}

function fitBoundsWithPadding(bounds: [number, number, number, number]) {
  const m = props.getMap()
  if (!m) return
  const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null
  const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0
  const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0
  const pad = 80
  const topExtra = Math.max(0, ctrlH / 2 - pad)
  m.fitBounds(
    [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
    { padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW }, maxZoom: 13, duration: 800 },
  )
}

function selectAirport(r: AirportResult) {
  fitBoundsWithPadding(r.bounds)
  if (props.airportsControl) {
    props.airportsControl._showAirportPanel(
      { icao: r.icao, iata: r.iata, name: r.name, bounds: r.bounds, freqs: { tower: '', radar: '', approach: '', atis: '' } } as AirportProperties,
      r.coords,
      true,
    )
  }
}

function selectMil(r: MilResult) {
  fitBoundsWithPadding(r.bounds)
}

// ---- Notifications (bell button) ----
function toggleNotif(hex: string) {
  const c = props.adsbControl
  if (!c) return
  if (!c._notifEnabled) c._notifEnabled = new Set()
  if (!c._trackingNotifIds) c._trackingNotifIds = {}
  const matchedFeature = (c._geojson.features as unknown as Array<{ properties: Record<string, unknown> }>).find(f => (f.properties.hex as string) === hex)
  const callsign = matchedFeature
    ? (((matchedFeature.properties.flight as string) || '').trim() || ((matchedFeature.properties.r as string) || '').trim() || hex)
    : hex
  const wasOn = c._notifEnabled.has(hex)
  if (wasOn) {
    c._notifEnabled.delete(hex)
    if (c._trackingNotifIds[hex]) {
      notificationsStore.dismiss(c._trackingNotifIds[hex])
      delete c._trackingNotifIds[hex]
    }
    notificationsStore.add({ type: 'notif-off', title: callsign })
  } else {
    c._notifEnabled.add(hex)
    if (c._trackingNotifIds[hex]) notificationsStore.dismiss(c._trackingNotifIds[hex])
    c._trackingNotifIds[hex] = notificationsStore.add({
      type: 'tracking',
      title: callsign,
      action: {
        label: 'DISABLE NOTIFICATIONS',
        callback: () => {
          c._notifEnabled.delete(hex)
          if (c._trackingNotifIds) delete c._trackingNotifIds[hex]
          c._rebuildTagForHex(hex)
        },
      },
    })
  }
  // Trigger Vue to re-render bell buttons
  notifEnabled.value = new Set(c._notifEnabled)
  c._rebuildTagForHex(hex)
}

// Sync notifEnabled and aircraft data when adsbControl becomes available
watch(() => props.adsbControl, (ctrl) => {
  if (ctrl) {
    notifEnabled.value = new Set(ctrl._notifEnabled)
    refreshAircraft()
  }
}, { immediate: true })

onMounted(refreshAircraft)

// Expose focus method for keyboard shortcut
defineExpose({
  focus: () => inputRef.value?.focus(),
})
</script>

<style>
#filter-input-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 20px 13px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

#filter-icon {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.35);
    display: block;
}

#filter-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #fff;
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 14px;
    font-weight: 400;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    caret-color: var(--color-accent);
    min-width: 0;
}

#filter-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
    font-size: 11px;
    letter-spacing: 0.14em;
}

#filter-clear-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.3);
    font-family: 'Barlow', sans-serif;
    font-size: 10px;
    font-weight: 700;
    padding: 0;
    margin-right: 6px;
    display: none;
    transition: color 0.15s;
    flex-shrink: 0;
}

#filter-clear-btn.filter-clear-visible {
    display: block;
}

#filter-clear-btn:hover {
    color: var(--color-text-muted);
}

#filter-results {
    max-height: 340px;
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

#filter-results::-webkit-scrollbar {
    display: none;
}

.filter-section-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--color-accent);
    padding: 18px 18px 5px 24px;
    text-transform: uppercase;
}

.filter-section-label:first-child {
    padding-top: 34px;
}

.filter-result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 20px 13px 24px;
    border-bottom: none;
    transition: background 0.12s;
}

.filter-result-item:last-child {
    border-bottom: none;
}

.filter-result-item:hover,
.filter-result-item.keyboard-focused {
    background: rgba(255, 255, 255, 0.06);
}

.filter-result-item.keyboard-focused {
    outline: 1px solid rgba(200, 255, 0, 0.4);
    outline-offset: -1px;
}

.filter-result-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: pointer;
}

.filter-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 6px;
    flex-shrink: 0;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
    transition: color 0.15s;
}

.filter-action-btn:hover {
    color: #fff !important;
}

.filter-bell-btn.filter-bell-btn--active {
    color: #c8ff00;
}

.filter-track-btn {
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    white-space: nowrap;
    padding: 6px 0;
}

.filter-result-icon {
    display: none;
    cursor: pointer;
}

.filter-result-icon.filter-icon-plane {
    color: #ffffff;
}

.filter-result-icon.filter-icon-airport {
    color: var(--color-accent);
}

.filter-result-icon.filter-icon-mil {
    color: rgba(200, 255, 0, 0.5);
}

.filter-result-primary {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #fff;
    flex-shrink: 0;
}

.filter-result-secondary {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.filter-result-badge {
    margin-left: auto;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.25);
    flex-shrink: 0;
}

.filter-result-badge.filter-badge-emrg {
    color: #ff4040;
}

.filter-no-results {
    padding: 20px 18px;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.25);
    text-align: center;
    text-transform: uppercase;
}
</style>
