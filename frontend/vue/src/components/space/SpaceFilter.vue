<template>
  <div id="space-filter-input-wrap">
    <svg id="space-filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/>
      <line x1="8.5" y1="8.5" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    <input
      ref="inputRef"
      id="space-filter-input"
      type="text"
      placeholder="SATELLITE NAME · NORAD ID · CATEGORY"
      v-model="query"
      autocomplete="off"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <button
      id="space-filter-clear-btn"
      :class="{ 'space-filter-clear-visible': query.length > 0 }"
      aria-label="Clear filter"
      @click="clearQuery"
    >✕</button>
  </div>
  <div id="space-filter-results">
    <template v-if="!loaded">
      <div class="space-filter-no-results">Loading satellite database…</div>
    </template>
    <template v-else-if="results.length === 0">
      <div class="space-filter-no-results">No satellites found</div>
    </template>
    <template v-else>
      <template v-for="group in groupedResults" :key="group.cat">
        <div class="space-filter-section-label">{{ group.label }}</div>
        <div
          v-for="sat in group.sats"
          :key="sat.norad_id"
          class="space-filter-result-item"
          :class="{ 'sfr-expanded': expandedNoradId === sat.norad_id, 'keyboard-focused': focusedNoradId === sat.norad_id }"
          @mouseenter="onMouseEnter(sat)"
          @mouseleave="onMouseLeave"
          @click="onItemClick(sat)"
        >
          <div class="space-filter-result-info">
            <div class="space-filter-result-primary">{{ sat.name || sat.norad_id }}</div>
            <div class="space-filter-result-secondary">{{ satSecondary(sat) }}</div>
          </div>
          <span class="sfr-item-chevron">
            <ChevronIcon />
          </span>
          <!-- Expanded accordion body -->
          <div v-if="expandedNoradId === sat.norad_id" class="sfr-accordion-body">
            <div class="sfr-acc-live">
              <div class="sfr-acc-live-row" v-for="field in liveFields" :key="field.id">
                <span class="sfr-acc-live-label">{{ field.label }}</span>
                <span class="sfr-acc-live-value">{{ liveTelemetry[field.id] ?? '—' }}</span>
              </div>
            </div>
            <button class="sfr-acc-track-btn" @click.stop="trackSat(sat)">TRACK SATELLITE</button>
            <div class="sfr-acc-status" :class="{ 'sfr-acc-status-loading': accordionLoading }">{{ accordionStatus }}</div>
            <div class="sfr-acc-pass-list">
              <template v-if="accordionPasses.length === 0 && !accordionLoading">
                <div v-if="accordionStatus.startsWith('NEXT')" class="sfr-acc-no-passes">No passes in the next 24 hours.</div>
              </template>
              <div
                v-for="(pass, i) in accordionPasses"
                :key="i"
                class="sfr-acc-pass-card"
                :data-aos-ms="pass.aos_unix_ms"
                :data-los-ms="pass.los_unix_ms"
              >
                <div class="sfr-acc-pass-times">
                  <div class="sfr-acc-pass-aos-row">
                    <span class="sfr-acc-pass-date">{{ formatPassDate(pass.aos_utc) }}</span>
                    <span class="sfr-acc-pass-time">{{ formatPassTime(pass.aos_utc) }}</span>
                  </div>
                  <div class="sfr-acc-pass-los">LOS {{ formatPassTime(pass.los_utc) }} · {{ formatPassDuration(pass.duration_s) }}</div>
                </div>
                <div class="sfr-acc-pass-meta">
                  <div class="sfr-acc-pass-countdown" :class="{ 'sfr-in-progress': isNow(pass) }">
                    {{ isNow(pass) ? 'NOW' : passCountdownText(pass) }}
                  </div>
                  <div class="sfr-acc-pass-maxel">MAX {{ pass.max_elevation_deg.toFixed(1) }}°</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { SatelliteControl } from './controls/satellite/SatelliteControl'
import { useDocumentEvent } from '../../composables/useDocumentEvent'
import ChevronIcon from '../shared/ChevronIcon.vue'
import {
  SATELLITE_CATEGORY_SHORT_LABELS,
  SATELLITE_CATEGORY_ORDER,
  SATELLITE_CATEGORY_SECTION_LABELS,
  formatPassCountdown,
  formatPassDuration,
  formatPassTime,
  formatPassDate,
} from '../../utils/satelliteUtils'

interface SatEntry {
  norad_id:   string
  name:       string
  category:   string | null
  updated_at: number | null
}

interface SatPass {
  aos_utc:           string
  los_utc:           string
  aos_unix_ms:       number
  los_unix_ms:       number
  duration_s:        number
  max_elevation_deg: number
  max_el_utc:        string
}

const props = defineProps<{
  satelliteControl: SatelliteControl | null
  getUserLocation: () => [number, number] | null
}>()

const inputRef = ref<HTMLInputElement | null>(null)

const query         = ref('')
const satellites    = ref<SatEntry[]>([])
const loaded        = ref(false)
const expandedNoradId = ref<string | null>(null)
const focusedNoradId  = ref<string | null>(null)

const accordionLoading = ref(false)
const accordionStatus  = ref('COMPUTING PASSES…')
const accordionPasses  = ref<SatPass[]>([])
const liveTelemetry    = ref<Record<string, string>>({})

let clearPreviewTimer: ReturnType<typeof setTimeout> | null = null
let itemFetchAbort: AbortController | null = null
let itemTickInterval: ReturnType<typeof setInterval> | null = null
let countdownTick: ReturnType<typeof setInterval> | null = null

const liveFields = [
  { id: 'alt', label: 'ALT' },
  { id: 'vel', label: 'VEL' },
  { id: 'hdg', label: 'HDG' },
  { id: 'lat', label: 'LAT' },
  { id: 'lon', label: 'LON' },
]

const CATEGORY_ALIASES: Record<string, string[]> = {
  space_station: ['space station', 'station', 'iss'],
  amateur:       ['amateur', 'ham'],
  weather:       ['weather', 'met'],
  military:      ['military', 'mil', 'defense', 'defence'],
  navigation:    ['navigation', 'nav', 'gps', 'gnss'],
  science:       ['science', 'sci', 'research'],
  cubesat:       ['cubesat', 'cube', 'smallsat'],
  active:        ['active'],
  unknown:       ['unknown', 'unkn'],
}

function categoryForQuery(q: string): string | null {
  const lq = q.toLowerCase().trim()
  if (lq.length < 2) return null
  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some(a => a === lq || a.startsWith(lq) || lq.startsWith(a))) return cat
  }
  return null
}

const results = computed<SatEntry[]>(() => {
  const q = query.value.trim()
  if (!q) return satellites.value
  const matchedCat = categoryForQuery(q)
  const lq = q.toLowerCase()
  return satellites.value.filter(s =>
    s.name?.toLowerCase().includes(lq) ||
    s.norad_id.includes(lq) ||
    (matchedCat !== null && s.category === matchedCat),
  )
})

const groupedResults = computed(() => {
  const CAP = 20
  const groups = new Map<string, SatEntry[]>()
  for (const cat of SATELLITE_CATEGORY_ORDER) groups.set(cat, [])
  for (const sat of results.value) {
    const key = sat.category || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(sat)
  }
  const out: { cat: string; label: string; sats: SatEntry[] }[] = []
  groups.forEach((sats, cat) => {
    if (!sats.length) return
    out.push({
      cat,
      label: SATELLITE_CATEGORY_SECTION_LABELS[cat] || cat.replace(/_/g, ' ').toUpperCase(),
      sats: sats.slice(0, CAP),
    })
  })
  return out
})

function satSecondary(sat: SatEntry): string {
  const catLabel = sat.category ? (SATELLITE_CATEGORY_SHORT_LABELS[sat.category] || sat.category.toUpperCase()) : ''
  return catLabel ? `${catLabel} · NORAD ${sat.norad_id}` : `NORAD ${sat.norad_id}`
}

function onMouseEnter(sat: SatEntry): void {
  if (clearPreviewTimer) { clearTimeout(clearPreviewTimer); clearPreviewTimer = null }
  props.satelliteControl?.previewSatellite(sat.norad_id, sat.name || sat.norad_id)
}

function onMouseLeave(): void {
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  clearPreviewTimer = setTimeout(() => {
    clearPreviewTimer = null
    props.satelliteControl?.clearPreview()
  }, 50)
}

function onItemClick(sat: SatEntry): void {
  const wasExpanded = expandedNoradId.value === sat.norad_id
  collapseExpanded()
  if (!wasExpanded) {
    expandedNoradId.value = sat.norad_id
    accordionPasses.value = []
    accordionStatus.value = 'COMPUTING PASSES…'
    accordionLoading.value = true
    liveTelemetry.value = {}
    props.satelliteControl?.switchSatellite(sat.norad_id, sat.name || sat.norad_id)
    void fetchAccordionPasses(sat.norad_id)
  }
}

function collapseExpanded(): void {
  expandedNoradId.value = null
  accordionPasses.value = []
  if (itemFetchAbort) { itemFetchAbort.abort(); itemFetchAbort = null }
  if (itemTickInterval) { clearInterval(itemTickInterval); itemTickInterval = null }
}

async function fetchAccordionPasses(noradId: string): Promise<void> {
  if (itemFetchAbort) { itemFetchAbort.abort() }
  itemFetchAbort = new AbortController()
  const abort = itemFetchAbort
  const loc = props.getUserLocation()
  if (!loc) {
    accordionStatus.value = 'SET LOCATION TO CALCULATE PASSES'
    accordionLoading.value = false
    return
  }
  const [lon, lat] = loc
  try {
    const url = `/api/space/satellite/${encodeURIComponent(noradId)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`
    const resp = await fetch(url, { signal: abort.signal })
    if (abort.signal.aborted) return
    if (!resp.ok) { accordionStatus.value = 'COULD NOT LOAD PASSES'; accordionLoading.value = false; return }
    const data = await resp.json() as { passes: SatPass[]; computed_at: string }
    const t = new Date(data.computed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    accordionStatus.value = `NEXT 24H · UPDATED ${t}`
    accordionPasses.value = data.passes || []
    accordionLoading.value = false
    startItemTick()
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return
    accordionStatus.value = 'NETWORK ERROR'
    accordionLoading.value = false
  }
}

function startItemTick(): void {
  if (itemTickInterval) clearInterval(itemTickInterval)
  itemTickInterval = setInterval(() => { accordionPasses.value = [...accordionPasses.value] }, 1000)
}

function trackSat(sat: SatEntry): void {
  props.satelliteControl?.switchSatellite(sat.norad_id, sat.name || sat.norad_id)
  props.satelliteControl?.startFollowing()
  collapseExpanded()
}

function clearQuery(): void {
  query.value = ''
  collapseExpanded()
  inputRef.value?.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') { clearQuery(); return }
  const allSats = groupedResults.value.flatMap(g => g.sats)
  if (!allSats.length) return
  const idx = allSats.findIndex(s => s.norad_id === focusedNoradId.value)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = allSats[idx + 1] || allSats[0]
    focusedNoradId.value = next.norad_id
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx <= 0) { focusedNoradId.value = null; return }
    focusedNoradId.value = allSats[idx - 1].norad_id
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const target = focusedNoradId.value
      ? allSats.find(s => s.norad_id === focusedNoradId.value)
      : allSats[0]
    if (target) onItemClick(target)
  }
}

// Live telemetry forwarding into expanded accordion
function onSatPositionUpdate(e: Event): void {
  if (!expandedNoradId.value) return
  const { noradId, position } = (e as CustomEvent<{
    noradId: string
    position: { alt_km: number; velocity_kms: number; track_deg: number; lat: number; lon: number }
  }>).detail
  if (noradId !== expandedNoradId.value) return
  liveTelemetry.value = {
    alt: `${position.alt_km} km`,
    vel: `${position.velocity_kms} km/s`,
    hdg: `${position.track_deg}°`,
    lat: `${position.lat}°`,
    lon: `${position.lon}°`,
  }
}

async function loadSatellites(): Promise<void> {
  try {
    const resp = await fetch('/api/space/tle/list')
    if (!resp.ok) { loaded.value = true; return }
    const data = await resp.json() as { satellites?: SatEntry[] }
    satellites.value = data.satellites ?? []
    loaded.value = true
  } catch {
    loaded.value = true
  }
}

function isNow(pass: SatPass): boolean {
  const now = Date.now()
  return now >= pass.aos_unix_ms && now <= pass.los_unix_ms
}
function passCountdownText(pass: SatPass): string {
  return formatPassCountdown(pass.aos_unix_ms - Date.now())
}

function onSettingsPanelClosed(): void {
  if (!loaded.value) void loadSatellites()
}

onMounted(() => {
  void loadSatellites()
  countdownTick = setInterval(() => {
    if (accordionPasses.value.length) accordionPasses.value = [...accordionPasses.value]
  }, 1000)
})

onUnmounted(() => {
  if (countdownTick) clearInterval(countdownTick)
  if (itemFetchAbort) itemFetchAbort.abort()
  if (itemTickInterval) clearInterval(itemTickInterval)
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
})

useDocumentEvent('sat-position-update', onSatPositionUpdate)
useDocumentEvent('settings-panel-closed', onSettingsPanelClosed)

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style>
#space-filter-input-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 28px 13px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

#space-filter-icon {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.35);
    display: block;
}

#space-filter-input {
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

#space-filter-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
    font-size: 11px;
    letter-spacing: 0.14em;
}

#space-filter-clear-btn {
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

#space-filter-clear-btn.space-filter-clear-visible {
    display: block;
}

#space-filter-clear-btn:hover {
    color: var(--color-text-muted);
}

#space-filter-results {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
}

#space-filter-results::-webkit-scrollbar {
    display: none;
}

.space-filter-section-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--color-accent);
    padding: 18px 28px 5px 24px;
    text-transform: uppercase;
    flex-shrink: 0;
}

.space-filter-section-label:first-child {
    padding-top: 34px;
}

.space-filter-result-item {
    display: flex;
    flex-direction: column;
    position: relative;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition: background 0.12s;
}

.space-filter-result-item:last-child {
    border-bottom: none;
}

.space-filter-result-item > .space-filter-result-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 13px 52px 13px 24px;
    min-width: 0;
}

.space-filter-result-item:hover,
.space-filter-result-item.keyboard-focused {
    background: rgba(255, 255, 255, 0.04);
}

.space-filter-result-item.sfr-expanded {
    background: rgba(255, 255, 255, 0.04);
}

.space-filter-result-item.keyboard-focused {
    outline: 1px solid rgba(200, 255, 0, 0.4);
    outline-offset: -1px;
}

.space-filter-result-icon {
    display: none;
}

.space-filter-result-primary {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.space-filter-result-secondary {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sfr-item-chevron {
    position: absolute;
    right: 0;
    top: 0;
    height: 44px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.25);
    transition: transform 0.2s ease, color 0.15s;
    transform: rotate(-90deg);
    pointer-events: none;
}

.space-filter-result-item.sfr-expanded .sfr-item-chevron {
    transform: rotate(0deg);
    color: var(--color-accent);
}

.sfr-accordion-body {
    display: flex;
    flex-direction: column;
    animation: sfr-expand 0.18s ease;
}

@keyframes sfr-expand {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
}

.sfr-acc-live {
    display: flex;
    flex-direction: column;
    padding: 10px 28px 10px 24px;
    gap: 2px;
}

.sfr-acc-live-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    line-height: 1.6;
}

.sfr-acc-live-label {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    min-width: 28px;
    flex-shrink: 0;
}

.sfr-acc-live-value {
    font-family: var(--font-primary);
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.85);
}

.sfr-acc-track-btn {
    margin: 10px 24px 10px 24px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.15);
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.45);
    padding: 6px 12px;
    text-transform: uppercase;
    transition: color 0.12s, border-color 0.12s;
    align-self: flex-start;
}

.sfr-acc-track-btn:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.45);
}

.sfr-acc-status {
    padding: 8px 24px 4px 24px;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
}

.sfr-acc-status.sfr-acc-status-loading {
    color: var(--color-accent);
}

.sfr-acc-no-passes {
    padding: 8px 24px 12px 24px;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
}

.sfr-acc-pass-list {
    display: flex;
    flex-direction: column;
}

.sfr-acc-pass-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 24px;
}

.sfr-acc-pass-card:last-child {
    padding-bottom: 14px;
}

.sfr-acc-pass-num {
    display: none;
}

.sfr-acc-pass-times {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.sfr-acc-pass-aos-row {
    display: flex;
    align-items: baseline;
    gap: 7px;
}

.sfr-acc-pass-date {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.28);
    text-transform: uppercase;
    flex-shrink: 0;
}

.sfr-acc-pass-time {
    font-family: var(--font-primary);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: #fff;
}

.sfr-acc-pass-los {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.28);
    text-transform: uppercase;
}

.sfr-acc-pass-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}

.sfr-acc-pass-countdown {
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-accent);
    white-space: nowrap;
    text-transform: uppercase;
}

.sfr-acc-pass-countdown.sfr-in-progress {
    color: #ff9900;
}

.sfr-acc-pass-maxel {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.32);
    white-space: nowrap;
    text-transform: uppercase;
}

.space-filter-no-results {
    padding: 20px 18px;
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.25);
    text-align: center;
    text-transform: uppercase;
}
</style>
