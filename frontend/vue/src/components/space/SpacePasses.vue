<template>
  <div id="spp-status-bar" :class="{ 'spp-loading': loading }">{{ statusText }}</div>
  <div id="spp-list">
    <div v-if="message" class="spp-message">
      <div>{{ message }}</div>
      <button v-if="showSetLocationBtn" class="spp-action-btn" @click="requestLocation">SET LOCATION</button>
    </div>
    <template v-else>
      <div
        v-for="pass in passes"
        :key="pass.norad_id + pass.aos_unix_ms"
        class="spp-pass-card"
        :class="{ 'spp-expanded': expandedKey === passKey(pass) }"
        :data-aos-ms="pass.aos_unix_ms"
        :data-los-ms="pass.los_unix_ms"
        @mouseenter="onMouseEnter(pass)"
        @mouseleave="onMouseLeave"
        @click="onCardClick(pass)"
      >
        <div class="spp-pass-card-header">
          <div class="spp-pass-info">
            <div class="spp-pass-primary">{{ pass.name || pass.norad_id }}</div>
            <div class="spp-pass-secondary">{{ passSecondary(pass) }}</div>
          </div>
          <div class="spp-pass-meta">
            <div class="spp-pass-aos" :class="{ 'spp-in-progress': isInProgress(pass) }">
              {{ aosText(pass) }}
            </div>
            <div class="spp-pass-detail">{{ formatPassDuration(pass.duration_s) }} · {{ pass.max_elevation_deg.toFixed(1) }}°</div>
          </div>
          <span class="spp-pass-chevron">
            <ChevronIcon />
          </span>
        </div>
        <!-- Expanded accordion -->
        <div v-if="expandedKey === passKey(pass)" class="spp-acc-body">
          <div class="spp-acc-live">
            <div v-for="field in liveFields" :key="field.id" class="spp-acc-live-row">
              <span class="spp-acc-live-label">{{ field.label }}</span>
              <span class="spp-acc-live-value">{{ liveTelemetry[field.id] ?? '—' }}</span>
            </div>
          </div>
          <button class="spp-acc-track-btn" @click.stop="trackSat(pass)">TRACK SATELLITE</button>
          <div class="spp-acc-status" :class="{ 'spp-acc-status-loading': accLoading }">{{ accStatus }}</div>
          <div class="spp-acc-pass-list">
            <div v-if="accPasses.length === 0 && !accLoading && accStatus.startsWith('NEXT')" class="spp-acc-no-passes">
              No passes in the next 24 hours.
            </div>
            <div
              v-for="(ap, i) in accPasses"
              :key="i"
              class="spp-acc-pass-card"
            >
              <div class="spp-acc-pass-times">
                <div class="spp-acc-pass-aos-row">
                  <span class="spp-acc-pass-date">{{ formatPassDate(ap.aos_utc) }}</span>
                  <span class="spp-acc-pass-time">{{ formatPassTime(ap.aos_utc) }}</span>
                </div>
                <div class="spp-acc-pass-los">LOS {{ formatPassTime(ap.los_utc) }} · {{ formatPassDuration(ap.duration_s) }}</div>
              </div>
              <div class="spp-acc-pass-meta">
                <div class="spp-acc-pass-countdown" :class="{ 'spp-in-progress': accPassIsNow(ap) }">
                  {{ accPassIsNow(ap) ? 'NOW' : formatPassCountdown(ap.aos_unix_ms - now) }}
                </div>
                <div class="spp-acc-pass-maxel">MAX {{ ap.max_elevation_deg.toFixed(1) }}°</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { SatelliteControl } from './controls/satellite/SatelliteControl'
import { useDocumentEvent } from '../../composables/useDocumentEvent'
import ChevronIcon from '../shared/ChevronIcon.vue'
import {
  SATELLITE_CATEGORY_SHORT_LABELS,
  SATELLITE_CATEGORY_ORDER,
  SATELLITE_CATEGORY_DISPLAY_NAMES,
  formatPassCountdown,
  formatPassDuration,
  formatPassTime,
  formatPassDate,
} from '../../utils/satelliteUtils'

interface SatPass {
  norad_id:          string
  name:              string
  category:          string | null
  aos_utc:           string
  los_utc:           string
  aos_unix_ms:       number
  los_unix_ms:       number
  duration_s:        number
  max_elevation_deg: number
  max_el_utc:        string
}

interface AccPass {
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
  isVisible: boolean
}>()

// ---- State ----
const passes          = ref<SatPass[]>([])
const loading         = ref(false)
const statusText      = ref('')
const message         = ref('')
const showSetLocationBtn = ref(false)

const selectedCategories = ref<Set<string>>(new Set(['space_station', 'weather', 'amateur']))
const minEl  = ref(35)
const hours  = ref(24)
const filtersExpanded = ref(false)

const expandedKey = ref<string | null>(null)
const liveTelemetry = ref<Record<string, string>>({})

const accLoading = ref(false)
const accStatus  = ref('COMPUTING PASSES…')
const accPasses  = ref<AccPass[]>([])

const now = ref(Date.now())

let fetchAbort: AbortController | null = null
let accFetchAbort: AbortController | null = null
let refreshInterval: ReturnType<typeof setInterval> | null = null
let tickInterval: ReturnType<typeof setInterval> | null = null
let locationPoll: ReturnType<typeof setInterval> | null = null
let clearPreviewTimer: ReturnType<typeof setTimeout> | null = null

const liveFields = [
  { id: 'alt', label: 'ALT' },
  { id: 'vel', label: 'VEL' },
  { id: 'hdg', label: 'HDG' },
  { id: 'lat', label: 'LAT' },
  { id: 'lon', label: 'LON' },
]

function passKey(p: SatPass): string { return `${p.norad_id}_${p.aos_unix_ms}` }

function passSecondary(pass: SatPass): string {
  const cat = pass.category ? (SATELLITE_CATEGORY_SHORT_LABELS[pass.category] || pass.category.toUpperCase()) : ''
  return cat ? `${cat} · NORAD ${pass.norad_id}` : `NORAD ${pass.norad_id}`
}

function isInProgress(pass: SatPass): boolean {
  const t = Date.now()
  return t >= pass.aos_unix_ms && t <= pass.los_unix_ms
}

function aosText(pass: SatPass): string {
  if (isInProgress(pass)) return 'IN PROGRESS'
  const ms = pass.aos_unix_ms - Date.now()
  return ms < 3_600_000 ? formatPassCountdown(ms) : new Date(pass.aos_unix_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function accPassIsNow(ap: AccPass): boolean {
  return now.value >= ap.aos_unix_ms && now.value <= ap.los_unix_ms
}

// ---- Fetch ----
async function fetchPasses(): Promise<void> {
  if (fetchAbort) fetchAbort.abort()
  fetchAbort = new AbortController()
  const abort = fetchAbort
  const loc = props.getUserLocation()
  if (!loc) { showNoLocation(); return }
  const [lon, lat] = loc
  const cats = Array.from(selectedCategories.value).join(',')
  if (!cats) { message.value = 'Select at least one satellite category.'; showSetLocationBtn.value = false; return }
  loading.value = true
  statusText.value = 'COMPUTING PASSES…'
  message.value = ''
  try {
    const url = `/api/space/passes?lat=${lat}&lon=${lon}&hours=${hours.value}&min_el=${minEl.value}&categories=${encodeURIComponent(cats)}&limit=100`
    const resp = await fetch(url, { signal: abort.signal })
    if (abort.signal.aborted) return
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({})) as { error?: string; no_tle_data?: boolean }
      if (data.no_tle_data) { message.value = 'No TLE data. Import satellites in Settings.'; return }
      message.value = `Error ${resp.status} — ${data.error || 'Failed to load passes'}`
      return
    }
    const data = await resp.json() as { passes: SatPass[]; satellite_count: number; computed_at: string }
    passes.value = data.passes || []
    const t = new Date(data.computed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    statusText.value = `${data.satellite_count} SATELLITES · UPDATED ${t}`
    if (!passes.value.length) message.value = 'No passes found. Try broader categories, lower elevation, or longer window.'
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return
    message.value = 'Network error — check connection and retry.'
  } finally {
    loading.value = false
  }
}

function showNoLocation(): void {
  message.value = 'Set your location to calculate passes.'
  showSetLocationBtn.value = true
  if (!locationPoll) {
    let n = 0
    locationPoll = setInterval(() => {
      n++
      if (props.getUserLocation()) {
        clearInterval(locationPoll!); locationPoll = null
        void fetchPasses()
      } else if (n > 120) { clearInterval(locationPoll!); locationPoll = null }
    }, 500)
  }
}

function requestLocation(): void {
  document.dispatchEvent(new CustomEvent('space-go-to-location'))
}

// ---- Accordion ----
function collapseExpanded(): void {
  expandedKey.value = null
  accPasses.value = []
  if (accFetchAbort) { accFetchAbort.abort(); accFetchAbort = null }
}

function onCardClick(pass: SatPass): void {
  const key = passKey(pass)
  const wasExpanded = expandedKey.value === key
  collapseExpanded()
  if (!wasExpanded) {
    expandedKey.value = key
    accPasses.value = []
    accStatus.value = 'COMPUTING PASSES…'
    accLoading.value = true
    liveTelemetry.value = {}
    props.satelliteControl?.switchSatellite(pass.norad_id, pass.name || pass.norad_id)
    void fetchAccordionPasses(pass.norad_id)
  }
}

async function fetchAccordionPasses(noradId: string): Promise<void> {
  if (accFetchAbort) accFetchAbort.abort()
  accFetchAbort = new AbortController()
  const abort = accFetchAbort
  const loc = props.getUserLocation()
  if (!loc) { accStatus.value = 'SET LOCATION TO CALCULATE PASSES'; accLoading.value = false; return }
  const [lon, lat] = loc
  try {
    const url = `/api/space/satellite/${encodeURIComponent(noradId)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`
    const resp = await fetch(url, { signal: abort.signal })
    if (abort.signal.aborted) return
    if (!resp.ok) { accStatus.value = 'COULD NOT LOAD PASSES'; accLoading.value = false; return }
    const data = await resp.json() as { passes: AccPass[]; computed_at: string }
    const t = new Date(data.computed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    accStatus.value = `NEXT 24H · UPDATED ${t}`
    accPasses.value = data.passes || []
    accLoading.value = false
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return
    accStatus.value = 'NETWORK ERROR'
    accLoading.value = false
  }
}

function trackSat(pass: SatPass): void {
  props.satelliteControl?.switchSatellite(pass.norad_id, pass.name || pass.norad_id, true)
  collapseExpanded()
}

function onMouseEnter(pass: SatPass): void {
  if (clearPreviewTimer) { clearTimeout(clearPreviewTimer); clearPreviewTimer = null }
  props.satelliteControl?.previewSatellite(pass.norad_id, pass.name || pass.norad_id)
}

function onMouseLeave(): void {
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  clearPreviewTimer = setTimeout(() => { clearPreviewTimer = null; props.satelliteControl?.clearPreview() }, 50)
}

function onSatPositionUpdate(e: Event): void {
  if (!expandedKey.value) return
  const { noradId, position } = (e as CustomEvent<{
    noradId: string
    position: { alt_km: number; velocity_kms: number; track_deg: number; lat: number; lon: number }
  }>).detail
  if (!expandedKey.value.startsWith(noradId)) return
  liveTelemetry.value = {
    alt: `${position.alt_km} km`,
    vel: `${position.velocity_kms} km/s`,
    hdg: `${position.track_deg}°`,
    lat: `${position.lat}°`,
    lon: `${position.lon}°`,
  }
}

onMounted(() => {
  const loc = props.getUserLocation()
  if (loc) void fetchPasses()
  else showNoLocation()

  refreshInterval = setInterval(() => { void fetchPasses() }, 5 * 60 * 1000)
  tickInterval = setInterval(() => {
    now.value = Date.now()
    passes.value = [...passes.value]
  }, 1000)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  if (tickInterval) clearInterval(tickInterval)
  if (locationPoll) clearInterval(locationPoll)
  if (fetchAbort) fetchAbort.abort()
  if (accFetchAbort) accFetchAbort.abort()
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
})

useDocumentEvent('sat-position-update', onSatPositionUpdate)

defineExpose({ fetchPasses, selectedCategories, minEl, hours, SATELLITE_CATEGORY_ORDER, SATELLITE_CATEGORY_DISPLAY_NAMES })
</script>

<style>
#msb-pane-passes {
    display: none;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
}

#msb-pane-passes.msb-pane-active {
    display: flex;
}

.spp-filter-toggle {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 18px 28px 18px 28px;
    background: none;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: none;
    cursor: pointer;
    transition: background 0.12s;
    box-sizing: border-box;
}

.spp-filter-toggle:hover {
    background: rgba(255, 255, 255, 0.03);
}

.spp-filter-toggle-left {
    display: flex;
    align-items: center;
    gap: 7px;
}

.spp-filter-toggle-icon {
    display: flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.3);
    transition: transform 0.2s ease, color 0.15s;
    flex-shrink: 0;
    transform: rotate(-90deg);
}

.spp-filter-toggle.expanded .spp-filter-toggle-icon {
    transform: rotate(0deg);
    color: var(--color-accent);
}

.spp-filter-toggle-left > span:last-child {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    transition: color 0.15s;
}

.spp-filter-toggle.expanded .spp-filter-toggle-left > span:last-child {
    color: rgba(255, 255, 255, 0.6);
}

.spp-filter-summary {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
    white-space: nowrap;
}

.spp-filter-toggle.expanded .spp-filter-summary {
    opacity: 0;
}

.spp-filter-body {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 0 28px 0 28px;
    border-bottom: none;
    overflow: hidden;
    max-height: 0;
    opacity: 0;
    transition: max-height 0.2s ease, opacity 0.2s ease, padding 0.2s ease;
}

.spp-filter-body.expanded {
    max-height: 400px;
    opacity: 1;
    padding: 20px 28px 22px 28px;
}

.spp-section-label {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
}

#spp-category-checkboxes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.spp-cat-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.5);
    padding: 0 10px;
    height: 28px;
    text-transform: uppercase;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
    display: flex;
    align-items: center;
}

.spp-cat-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

.spp-cat-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(200, 255, 0, 0.75);
}

.spp-cat-btn.active:hover {
    background: rgba(255, 255, 255, 0.15);
    color: var(--color-accent);
}

.spp-filter-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.spp-filter-label {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    flex-shrink: 0;
    min-width: 90px;
}

#spp-elevation-slider {
    flex: 1;
    min-width: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    height: 3px;
    border-radius: 2px;
    background: var(--color-accent);
    outline: none;
    border: none;
}

#spp-elevation-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

#spp-elevation-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

#spp-elevation-slider::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: var(--color-accent);
}

.spp-filter-value {
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-accent);
    min-width: 28px;
    text-align: right;
    flex-shrink: 0;
}

.spp-seg-btns {
    display: flex;
    gap: 4px;
}

.spp-seg-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.5);
    padding: 0 10px;
    height: 28px;
    text-transform: uppercase;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
    display: flex;
    align-items: center;
}

.spp-seg-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
}

.spp-seg-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(200, 255, 0, 0.75);
}

.spp-seg-btn.active:hover {
    background: rgba(255, 255, 255, 0.15);
    color: var(--color-accent);
}

#spp-status-bar {
    flex-shrink: 0;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
    padding: 32px 28px 8px 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
}

#spp-status-bar.spp-loading {
    color: var(--color-accent);
}

#spp-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
}

#spp-list::-webkit-scrollbar {
    display: none;
}

.spp-pass-card {
    display: flex;
    flex-direction: column;
    position: relative;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition: background 0.12s;
}

.spp-pass-card:last-child {
    border-bottom: none;
}

.spp-pass-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 52px 13px 28px;
}

.spp-pass-card:first-child .spp-pass-card-header {
    padding-top: 18px;
}

.spp-pass-card:hover {
    background: rgba(255, 255, 255, 0.04);
}

.spp-pass-card.spp-expanded {
    background: rgba(255, 255, 255, 0.04);
}

.spp-pass-chevron {
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

.spp-pass-card.spp-expanded .spp-pass-chevron {
    transform: rotate(0deg);
    color: var(--color-accent);
}

.spp-pass-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.spp-pass-primary {
    font-family: var(--font-primary);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.spp-pass-secondary {
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.spp-pass-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}

.spp-pass-aos {
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-accent);
    white-space: nowrap;
    text-transform: uppercase;
}

.spp-pass-aos.spp-in-progress {
    color: #ff9900;
}

.spp-pass-detail {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
}

.spp-acc-body {
    display: flex;
    flex-direction: column;
    animation: spp-expand 0.18s ease;
}

@keyframes spp-expand {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
}

.spp-acc-live {
    display: flex;
    flex-direction: column;
    padding: 10px 28px 10px 28px;
    gap: 2px;
}

.spp-acc-live-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    line-height: 1.6;
}

.spp-acc-live-label {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase;
    min-width: 28px;
    flex-shrink: 0;
}

.spp-acc-live-value {
    font-family: var(--font-primary);
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.85);
}

.spp-acc-track-btn {
    margin: 10px 28px 10px 28px;
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

.spp-acc-track-btn:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.45);
}

.spp-acc-status {
    padding: 8px 28px 4px 28px;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
}

.spp-acc-status.spp-acc-status-loading {
    color: var(--color-accent);
}

.spp-acc-no-passes {
    padding: 8px 28px 12px 28px;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.22);
    text-transform: uppercase;
}

.spp-acc-pass-list {
    display: flex;
    flex-direction: column;
}

.spp-acc-pass-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 28px;
}

.spp-acc-pass-card:last-child {
    padding-bottom: 14px;
}

.spp-acc-pass-num {
    display: none;
}

.spp-acc-pass-times {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.spp-acc-pass-aos-row {
    display: flex;
    align-items: baseline;
    gap: 7px;
}

.spp-acc-pass-date {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.28);
    text-transform: uppercase;
    flex-shrink: 0;
}

.spp-acc-pass-time {
    font-family: var(--font-primary);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: #fff;
}

.spp-acc-pass-los {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.28);
    text-transform: uppercase;
}

.spp-acc-pass-meta {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
}

.spp-acc-pass-countdown {
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--color-accent);
    white-space: nowrap;
    text-transform: uppercase;
}

.spp-acc-pass-countdown.spp-in-progress {
    color: #ff9900;
}

.spp-acc-pass-maxel {
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.32);
    white-space: nowrap;
    text-transform: uppercase;
}

.spp-message {
    padding: 24px 28px;
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    line-height: 1.6;
}

.spp-action-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.5);
    padding: 5px 10px;
    text-transform: uppercase;
    transition: color 0.12s, border-color 0.12s;
}

.spp-action-btn:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.5);
}

body:not([data-domain="space"]) .spp-filter-toggle,
body:not([data-domain="space"]) .spp-filter-body {
    display: none;
}
</style>
