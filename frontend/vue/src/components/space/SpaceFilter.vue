<template>
  <div id="space-filter-input-wrap">
    <input
      id="space-filter-input"
      ref="inputRef"
      v-model="query"
      type="text"
      role="combobox"
      aria-label="Filter satellites by name, NORAD ID or category"
      aria-autocomplete="list"
      :aria-expanded="listboxShown"
      :aria-controls="listboxShown ? 'space-filter-listbox' : undefined"
      :aria-activedescendant="activeDescId"
      placeholder="SATELLITE NAME · NORAD ID · CATEGORY"
      autocomplete="off"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <BaseIconAction
      id="space-filter-clear-btn"
      :active="query.length > 0"
      active-class="space-filter-clear-visible"
      accessible-name="Clear filter"
      @click="clearQuery"
    >
      ✕
    </BaseIconAction>
  </div>
  <!-- The scroll container is keyboard-focusable (WCAG 2.1.1 / axe
       scrollable-region-focusable): when rows overflow, none of the content is
       tabbable — options are driven from the combobox via aria-activedescendant
       by design — so without a tab stop a keyboard user could never scroll the
       overflowing results. role="group" + a name keeps the stop meaningful to
       assistive tech without disturbing the combobox/listbox structure. -->
  <div id="space-filter-results" role="group" aria-label="Filter results" tabindex="0">
    <!-- Empty structural listbox: it OWNS the option rows below via aria-owns.
         The rows can't live inside it because each carries non-option chrome
         (category header buttons, and — when expanded — an accordion of track /
         notify / auto-tune / record buttons) that a listbox/option subtree may
         not contain. -->
    <div
      v-if="listboxShown"
      id="space-filter-listbox"
      role="listbox"
      aria-label="Satellites"
      :aria-owns="ownedOptionIds"
    ></div>

    <template v-if="!loaded">
      <div class="space-filter-no-results">Loading satellite database…</div>
    </template>
    <template v-else-if="results.length === 0">
      <div class="space-filter-no-results">No satellites found</div>
    </template>
    <div v-else class="space-filter-results-body">
      <!-- The active category is chosen by the rail sub-tabs (FILTER tab); only its
           flat list renders. The text box above filters within that category. -->
      <div v-if="activeGroup" class="space-filter-result-group">
        <div
          v-for="sat in activeGroup.sats"
          :key="sat.norad_id"
          class="space-filter-result-item"
          :class="{
            'sfr-expanded': expandedNoradId === sat.norad_id,
            'keyboard-focused': focusedNoradId === sat.norad_id,
          }"
          @mouseenter="onMouseEnter(sat)"
          @mouseleave="onMouseLeave"
          @click="onItemClick(sat)"
        >
          <!-- The option is just the row header (identity + chevron); the
                 expanded accordion is a sibling so its buttons aren't nested
                 inside the option. -->
          <div
            :id="`space-filter-opt-${sat.norad_id}`"
            role="option"
            :aria-selected="focusedNoradId === sat.norad_id"
            :aria-label="satOptionLabel(sat)"
            class="space-filter-result-option"
          >
            <div class="space-filter-result-info">
              <div class="space-filter-result-primary">{{ sat.name || sat.norad_id }}</div>
              <div class="space-filter-result-secondary">{{ satSecondary(sat) }}</div>
            </div>
            <span class="sfr-item-chevron">
              <ChevronIcon />
            </span>
          </div>
          <!-- Expanded accordion body -->
          <div v-if="expandedNoradId === sat.norad_id" class="sfr-accordion-body">
            <BaseDataGrid title="POSITION DATA" :columns="3">
              <BaseDataCell label="LATITUDE" :value="liveTelemetry['lat'] ?? '—'" />
              <BaseDataCell label="LONGITUDE" :value="liveTelemetry['lon'] ?? '—'" />
              <BaseDataCell label="HEADING" :value="liveTelemetry['hdg'] ?? '—'" />
            </BaseDataGrid>
            <BaseDataGrid title="ORBITAL DATA" :columns="3">
              <BaseDataCell label="ALTITUDE" :value="liveTelemetry['alt'] ?? '—'" />
              <BaseDataCell label="VELOCITY" :value="liveTelemetry['vel'] ?? '—'" />
            </BaseDataGrid>
            <SatRadioInfoSection :radio="sat" class-prefix="sfr-acc" />
            <div class="sfr-acc-section sfr-acc-section--track">
              <div class="sfr-acc-track-row">
                <BaseIconAction
                  class="sfr-acc-track-btn"
                  :active="followedNoradId === sat.norad_id"
                  active-class="sfr-acc-track-btn--active"
                  :accessible-name="
                    followedNoradId === sat.norad_id ? 'Untrack satellite' : 'Track satellite'
                  "
                  :tooltip="
                    followedNoradId === sat.norad_id ? 'Untrack satellite' : 'Track satellite'
                  "
                  @click.stop="trackSat(sat)"
                >
                  <LocationPinIcon />
                </BaseIconAction>
                <BaseIconAction
                  class="sfr-acc-notif-btn"
                  :active="notifNoradId === sat.norad_id"
                  active-class="sfr-acc-notif-btn--active"
                  :accessible-name="
                    notifNoradId === sat.norad_id
                      ? 'Disable pass notifications'
                      : 'Enable pass notifications'
                  "
                  :tooltip="
                    notifNoradId === sat.norad_id
                      ? 'Disable pass notifications'
                      : 'Enable pass notifications'
                  "
                  @click.stop="togglePassNotif(sat)"
                >
                  <BellIcon :size="14" />
                </BaseIconAction>
                <BaseIconAction
                  v-if="sat.downlink_hz"
                  class="sfr-acc-autotune-btn"
                  :active="isArmed(sat.norad_id)"
                  active-class="sfr-acc-autotune-btn--active"
                  :accessible-name="autoTuneLabel(sat)"
                  :tooltip="autoTuneLabel(sat)"
                  @click.stop="toggleAutoTune(sat)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <!-- radio receiver: matches the SDR tab glyph -->
                    <path
                      d="M5 7h14v12H5z"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linejoin="miter"
                      fill="none"
                    />
                    <line
                      x1="6"
                      y1="7"
                      x2="17"
                      y2="3"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                    <circle
                      cx="9"
                      cy="13"
                      r="3"
                      stroke="currentColor"
                      stroke-width="1.8"
                      fill="none"
                    />
                    <line
                      x1="15.5"
                      y1="11"
                      x2="17"
                      y2="11"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                    <line
                      x1="15.5"
                      y1="15"
                      x2="17"
                      y2="15"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                  </svg>
                </BaseIconAction>
                <BaseIconAction
                  v-if="sat.downlink_hz"
                  class="sfr-acc-record-btn"
                  :active="isRecordArmed(sat.norad_id)"
                  active-class="sfr-acc-record-btn--active"
                  :disabled="!isArmed(sat.norad_id)"
                  accessible-name="Record pass"
                  tooltip="Record pass"
                  @click.stop="toggleRecord(sat)"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="6" fill="currentColor" />
                  </svg>
                </BaseIconAction>
              </div>
              <div
                v-if="isArmed(sat.norad_id) && autoTuneConflictText"
                class="sfr-acc-autotune-warn"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3 2 20h20L12 3Z"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                    fill="none"
                  />
                  <line
                    x1="12"
                    y1="9"
                    x2="12"
                    y2="14"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                  <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="currentColor" />
                </svg>
                <span>{{ autoTuneConflictText }}</span>
              </div>
            </div>
            <div class="sfr-acc-section sfr-acc-section--polar">
              <div class="sfr-acc-section-title sfr-acc-polar-title">
                <span>{{ polarTitle }}</span>
                <span v-if="polarPass" class="sfr-acc-polar-maxel"
                  >MAX {{ polarPass.max_elevation_deg.toFixed(0) }}°</span
                >
              </div>
              <SatPolarPlot
                v-if="polarPass && polarPass.sky_track && polarPass.sky_track.length > 1"
                :track="polarPass.sky_track"
                :live="polarLive"
              />
              <div v-else class="sfr-acc-polar-empty">
                {{ accordionLoading ? 'COMPUTING ARC…' : 'NO UPCOMING PASS TO PLOT' }}
              </div>
            </div>
            <div class="sfr-acc-section sfr-acc-section--passes">
              <div class="sfr-acc-section-title sfr-acc-passes-title">
                <span>UPCOMING PASSES</span>
                <span
                  class="sfr-acc-status"
                  :class="{ 'sfr-acc-status-loading': accordionLoading }"
                  >{{ accordionStatus }}</span
                >
              </div>
              <div class="sfr-acc-pass-list">
                <template v-if="accordionPasses.length === 0 && !accordionLoading">
                  <div v-if="accordionStatus.startsWith('NEXT')" class="sfr-acc-no-passes">
                    No passes in the next 24 hours.
                  </div>
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
                    <div class="sfr-acc-pass-los">
                      LOS {{ formatPassTime(pass.los_utc) }} ·
                      {{ formatPassDuration(pass.duration_s) }}
                    </div>
                  </div>
                  <div class="sfr-acc-pass-meta">
                    <div class="sfr-acc-pass-countdown" :class="{ 'sfr-in-progress': isNow(pass) }">
                      {{ isNow(pass) ? 'NOW' : passCountdownText(pass) }}
                    </div>
                    <div class="sfr-acc-pass-maxel">
                      MAX {{ pass.max_elevation_deg.toFixed(1) }}°
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="space-filter-no-results">No satellites found</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import { useSpaceStore } from '@/stores/space'
import type { SatelliteControl } from './controls/satellite/SatelliteControl'
import {
  isPassNotifEnabled,
  isAutoTuneEnabled,
  setAutoTuneEnabled,
  isRecordOnPassEnabled,
  setRecordOnPassEnabled,
  getAllPassNotifs,
} from './controls/satellite/passNotifStore'
import { useNotificationsStore } from '../../stores/notifications'
import { useDocumentEvent } from '../../composables/useDocumentEvent'
import ChevronIcon from '../shared/ChevronIcon.vue'
import LocationPinIcon from '../shared/LocationPinIcon.vue'
import BellIcon from '../shared/BellIcon.vue'
import SatPolarPlot from './SatPolarPlot.vue'
import BaseDataGrid from '../base/BaseDataGrid.vue'
import BaseDataCell from '../base/BaseDataCell.vue'
import SatRadioInfoSection from './SatRadioInfoSection.vue'
import {
  SATELLITE_CATEGORY_SHORT_LABELS,
  SATELLITE_CATEGORY_ORDER,
  formatPassCountdown,
  formatPassDuration,
  formatPassTime,
  formatPassDate,
} from '../../utils/satelliteUtils'

interface SatEntry {
  norad_id: string
  name: string
  category: string | null
  updated_at: number | null
  uplink_hz?: number | null
  uplink_mode?: string | null
  downlink_hz?: number | null
  downlink_mode?: string | null
  ctcss_hz?: number | null
  transponder_type?: string | null
  beacon_hz?: number | null
  packet_info?: string | null
  radio_status?: string | null
  radio_notes?: string | null
}

interface SkyPoint {
  az: number
  el: number
}

interface SatPass {
  aos_utc: string
  los_utc: string
  aos_unix_ms: number
  los_unix_ms: number
  duration_s: number
  max_elevation_deg: number
  max_el_utc: string
  sky_track?: SkyPoint[]
}

const props = defineProps<{
  satelliteControl: SatelliteControl | null
  getUserLocation: () => [number, number] | null
}>()

const inputRef = ref<HTMLInputElement | null>(null)

// Search query, the expanded satellite accordion, and which category sections
// are collapsed all persist so the Search pane resumes exactly as you left it
// after navigating away from Space (and across a full refresh). They live on the
// store (a singleton) so restore is independent of this teleported pane's
// remount timing.
const spaceStore = useSpaceStore()
const {
  searchQuery: query,
  searchExpandedNorad: expandedNoradId,
  // The active FILTER category, selected via the rail sub-tabs in MapSidebar.
  // Single-select — only this category's satellites render in the panel.
  spaceFilterCategory: filterCategory,
} = storeToRefs(spaceStore)
const satellites = ref<SatEntry[]>([])
const loaded = ref(false)
const focusedNoradId = ref<string | null>(null)

const accordionLoading = ref(false)
const accordionStatus = ref('COMPUTING PASSES…')
const accordionPasses = ref<SatPass[]>([])
const liveTelemetry = ref<Record<string, string>>({})
const followedNoradId = ref<string | null>(props.satelliteControl?.followedNoradId ?? null)
const notifNoradId = ref<string | null>(
  props.satelliteControl?.passNotificationsEnabled ? props.satelliteControl.activeNoradId : null,
)
// Auto-tune armed state is read straight from the store (multiple sats can be
// armed). `armedTick` nudges reactivity when arming changes.
const armedTick = ref(0)
const notificationsStore = useNotificationsStore()

// Passes of OTHER armed sats, fetched lazily so we can detect lock-in conflicts
// for the expanded sat (SpaceFilter only loads one sat's passes at a time). Only
// the fields the overlap test needs, tagged with the owning sat.
interface ArmedPass {
  norad_id: string
  name: string
  aos_unix_ms: number
  los_unix_ms: number
}
const armedPasses = ref<ArmedPass[]>([])

function isArmed(noradId: string): boolean {
  void armedTick.value
  return isAutoTuneEnabled(noradId)
}

function isRecordArmed(noradId: string): boolean {
  void armedTick.value
  return isRecordOnPassEnabled(noradId)
}

const now = ref(Date.now())

// Exact observer-relative look-angles for the live satellite, supplied by the
// backend on each position poll. Null until the first annotated update arrives.
const liveAzEl = ref<SkyPoint | null>(null)

// The pass to plot: the active (in-progress) pass if there is one, else the next.
const polarPass = computed<SatPass | null>(() => {
  if (!accordionPasses.value.length) return null
  const active = accordionPasses.value.find((p) => isNow(p))
  if (active) return active
  return accordionPasses.value.find((p) => p.aos_unix_ms > now.value) ?? null
})

const polarTitle = computed(() => {
  const p = polarPass.value
  if (!p) return 'NEXT PASS'
  const label = isNow(p) ? 'CURRENT PASS' : 'NEXT PASS'
  return `${label} · ${formatPassDate(p.aos_utc)} ${formatPassTime(p.aos_utc)}`
})

// Show the live marker only while the plotted pass is actually in progress.
const polarLive = computed<SkyPoint | null>(() => {
  const p = polarPass.value
  if (!p || !isNow(p)) return null
  return liveAzEl.value
})

function readPassNotifState(noradId: string): boolean {
  return isPassNotifEnabled(noradId)
}

function autoTuneLabel(_sat: SatEntry): string {
  return 'Auto-tune SDR'
}

// Lock-in conflict for the expanded accordion: which OTHER armed sat has a pass
// overlapping this sat's loaded passes. SpaceFilter passes lack norad_id and only
// the expanded sat is loaded, so we test raw time-overlap of `accordionPasses`
// against the lazily-fetched `armedPasses` (passes of other armed sats).
const autoTuneConflict = computed<{ name: string; aosMs: number } | null>(() => {
  void armedTick.value
  const exp = expandedNoradId.value
  /* v8 ignore start -- defensive: this computed is only read via autoTuneConflictText,
     which the template only evaluates inside an expanded card whose auto-tune is armed —
     so `exp` is always set and armed here, and this early-out never fires. */
  if (!exp || !isAutoTuneEnabled(exp)) return null
  /* v8 ignore stop */
  const now = Date.now()
  const mine = accordionPasses.value.filter((p) => p.los_unix_ms > now)
  let best: { name: string; aosMs: number } | null = null
  for (const o of armedPasses.value) {
    if (o.los_unix_ms <= now) continue
    /* v8 ignore start -- defensive: refreshArmedPasses excludes the expanded sat and only
       includes currently-armed ids, so neither condition can be true here. */
    if (o.norad_id === exp || !isAutoTuneEnabled(o.norad_id)) continue
    /* v8 ignore stop */
    const overlaps = mine.some(
      (m) => m.aos_unix_ms < o.los_unix_ms && o.aos_unix_ms < m.los_unix_ms,
    )
    if (!overlaps) continue
    /* v8 ignore start -- o.name is set to the norad-id fallback in refreshArmedPasses, so it
       is never empty here; the `|| o.norad_id` arm is unreachable. */
    if (!best || o.aos_unix_ms < best.aosMs)
      best = { name: o.name || o.norad_id, aosMs: o.aos_unix_ms }
    /* v8 ignore stop */
  }
  return best
})

const autoTuneConflictText = computed<string>(() => {
  const c = autoTuneConflict.value
  if (!c) return ''
  const t = new Date(c.aosMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Overlaps ${c.name} @ ${t} — earlier pass keeps the radio`
})

// Fetch upcoming passes for every armed sat except `excludeNoradId` (the one whose
// own passes are already in accordionPasses), so the conflict check has data.
async function refreshArmedPasses(excludeNoradId: string): Promise<void> {
  const loc = props.getUserLocation()
  if (!loc) {
    armedPasses.value = []
    return
  }
  const [lon, lat] = loc
  const armed = Object.keys(getAllPassNotifs()).filter(
    (id) => id !== excludeNoradId && isAutoTuneEnabled(id),
  )
  if (armed.length === 0) {
    armedPasses.value = []
    return
  }
  try {
    const results = await Promise.all(
      armed.map(async (id) => {
        const url = `/api/space/satellite/${encodeURIComponent(id)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`
        const resp = await fetch(url)
        if (!resp.ok) return []
        const data = (await resp.json()) as {
          passes: Array<{ aos_unix_ms: number; los_unix_ms: number }>
        }
        /* v8 ignore start -- `id` comes from Object.keys(getAllPassNotifs()), so the entry is
           always present; the optional-chain null arm is unreachable. */
        const name = getAllPassNotifs()[id]?.name || id
        /* v8 ignore stop */
        return (data.passes || []).map((p) => ({
          norad_id: id,
          name,
          aos_unix_ms: p.aos_unix_ms,
          los_unix_ms: p.los_unix_ms,
        }))
      }),
    )
    armedPasses.value = results.flat()
  } catch {
    armedPasses.value = []
  }
}

// Persistent "armed" alert-card wording. One card per satellite represents the
// auto-tune arming; record folds into its detail rather than adding a 2nd card.
const ARMED_DETAIL_AUTOTUNE = 'Auto-tune on pass enabled'
const ARMED_DETAIL_RECORD = 'Auto-tune and record on pass enabled'
function isArmedCardDetail(detail: string): boolean {
  return detail === ARMED_DETAIL_AUTOTUNE || detail === ARMED_DETAIL_RECORD
}

function toggleAutoTune(sat: SatEntry): void {
  /* v8 ignore start -- defensive: the auto-tune button is `v-if="sat.downlink_hz"`, so this
     handler only ever runs for a satellite that has a downlink frequency. */
  if (!sat.downlink_hz) return
  /* v8 ignore stop */
  const noradId = sat.norad_id
  const name = sat.name || noradId
  const enabled = !isAutoTuneEnabled(noradId)
  setAutoTuneEnabled(noradId, enabled, {
    name,
    // `downlink_hz` is narrowed to a number by the early-return guard above.
    downlinkHz: sat.downlink_hz,
    downlinkMode: sat.downlink_mode ?? undefined,
  })
  armedTick.value++
  void refreshArmedPasses(noradId)
  document.dispatchEvent(
    new CustomEvent('satellite-auto-tune-changed', { detail: { noradId, enabled } }),
  )
  if (enabled) {
    notificationsStore.add({
      type: 'autotune',
      title: name,
      detail: ARMED_DETAIL_AUTOTUNE,
      noradId,
      satName: name,
    })
  } else {
    // Remove the persistent armed card so the alerts list stays in sync. Record
    // folds its state into this one card's detail (see toggleRecord), so match
    // either wording. The live pass/tune trace alerts share the noradId but have
    // a different detail, so they're left untouched.
    notificationsStore.items
      .filter((i) => i.type === 'autotune' && i.noradId === noradId && isArmedCardDetail(i.detail))
      .forEach((i) => notificationsStore.dismiss(i.id))
  }
}

function toggleRecord(sat: SatEntry): void {
  /* v8 ignore start -- defensive: the record button is `v-if="sat.downlink_hz"` and
     `:disabled="!isArmed(...)"`, so this handler only runs for a downlink-bearing satellite
     whose auto-tune is already armed; jsdom also suppresses clicks on the disabled state. */
  if (!sat.downlink_hz) return
  const noradId = sat.norad_id
  // Record needs a live tune — only togglable while auto-tune is armed.
  if (!isAutoTuneEnabled(noradId)) return
  /* v8 ignore stop */
  const name = sat.name || noradId
  const enabled = !isRecordOnPassEnabled(noradId)
  setRecordOnPassEnabled(noradId, enabled, { name })
  armedTick.value++
  // Notify the alerts service so enabling record mid-pass starts recording the
  // overhead pass now, rather than only taking effect on the next pass.
  document.dispatchEvent(
    new CustomEvent('satellite-record-on-pass-changed', { detail: { noradId, enabled } }),
  )
  // Don't add a second card for record — fold its state into the existing
  // auto-tune armed card by retitling its detail. If for some reason that card
  // is gone (e.g. dismissed), add a fresh one with the combined wording.
  const detail = enabled ? ARMED_DETAIL_RECORD : ARMED_DETAIL_AUTOTUNE
  const existing = notificationsStore.items.find(
    (i) => i.type === 'autotune' && i.noradId === noradId && isArmedCardDetail(i.detail),
  )
  if (existing) {
    notificationsStore.update({ id: existing.id, detail })
  } else {
    notificationsStore.add({ type: 'autotune', title: name, detail, noradId, satName: name })
  }
}

let clearPreviewTimer: ReturnType<typeof setTimeout> | null = null
let itemFetchAbort: AbortController | null = null
let itemTickInterval: ReturnType<typeof setInterval> | null = null
let countdownTick: ReturnType<typeof setInterval> | null = null

const CATEGORY_ALIASES: Record<string, string[]> = {
  space_station: ['space station', 'station', 'iss'],
  amateur: ['amateur', 'ham'],
  weather: ['weather', 'met'],
  military: ['military', 'mil', 'defense', 'defence'],
  navigation: ['navigation', 'nav', 'gps', 'gnss'],
  science: ['science', 'sci', 'research'],
  cubesat: ['cubesat', 'cube', 'smallsat'],
  active: ['active'],
  unknown: ['unknown', 'unkn'],
}

function categoryForQuery(q: string): string | null {
  const lq = q.toLowerCase().trim()
  if (lq.length < 2) return null
  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((a) => a === lq || a.startsWith(lq) || lq.startsWith(a))) return cat
  }
  return null
}

// Lower score = better match, so the most relevant satellites sort first
// within their category group (e.g. "ISS (ZARYA)" floats above the other
// space stations when the query is "iss").
function matchScore(s: SatEntry, lq: string, matchedCat: string | null): number {
  /* v8 ignore start -- s.name is typed non-null; the `?.`/`??` are defensive and the
     empty-string fallback can't occur for well-formed data. */
  const name = s.name?.toLowerCase() ?? ''
  /* v8 ignore stop */
  if (name === lq) return 0
  if (name.startsWith(lq)) return 1
  if (name.includes(lq)) return 2
  if (s.norad_id.includes(lq)) return 3
  /* v8 ignore start -- unreachable tail: a satellite reaching here failed the name and
     norad checks above, so it must have passed the results filter via category — the
     category test is therefore always true (score 4) and `return 5` is never reached. */
  if (matchedCat !== null && s.category === matchedCat) return 4
  return 5
  /* v8 ignore stop */
}

const results = computed<SatEntry[]>(() => {
  const q = query.value.trim()
  if (!q) return satellites.value
  const matchedCat = categoryForQuery(q)
  const lq = q.toLowerCase()
  return satellites.value
    .filter(
      (s) =>
        s.name?.toLowerCase().includes(lq) ||
        s.norad_id.includes(lq) ||
        (matchedCat !== null && s.category === matchedCat),
    )
    .sort((a, b) => matchScore(a, lq, matchedCat) - matchScore(b, lq, matchedCat))
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
  const out: { cat: string; sats: SatEntry[] }[] = []
  groups.forEach((sats, cat) => {
    if (!sats.length) return
    out.push({ cat, sats: sats.slice(0, CAP) })
  })
  return out
})

// The satellite categories that have data, in display order — computed from the
// FULL loaded set (not the text-filtered results) so the rail sub-tab set stays
// stable as you type. Published to the store so MapSidebar can render one rail
// sub-tab per available category. Also default/repair the selected category so the
// panel always shows a valid one (empty on first load, or a category that vanished).
const availableCategories = computed<string[]>(() => {
  const present = new Set<string>()
  for (const sat of satellites.value) present.add(sat.category || 'unknown')
  return SATELLITE_CATEGORY_ORDER.filter((cat) => present.has(cat))
})
watch(
  availableCategories,
  (cats) => {
    spaceStore.setSpaceAvailableCategories(cats)
    if (!cats.includes(filterCategory.value)) {
      spaceStore.setSpaceFilterCategory(cats[0] ?? '')
    }
  },
  { immediate: true },
)

// The single category group shown in the panel (the selected sub-tab). Null when
// the selected category has no matching satellites (e.g. the text filter excludes
// them all), which the template surfaces as a no-results message.
const activeGroup = computed(
  () => groupedResults.value.find((group) => group.cat === filterCategory.value) ?? null,
)

function satSecondary(sat: SatEntry): string {
  const catLabel = sat.category
    ? // defensive: a rendered row's category always came from either the rail
      // sub-tab selection (gated to SATELLITE_CATEGORY_ORDER, whose keys are a
      // 1:1 match with SATELLITE_CATEGORY_SHORT_LABELS) or
      // restoreExpandedAccordion (which sets filterCategory, but the
      // availableCategories watch immediately resets any category not in
      // that same order back to the first available one) — so sat.category
      // can never actually miss a short label at render time. Kept as a guard
      // against the two lookup tables drifting out of sync.
      /* v8 ignore start -- unreachable given the category-order/short-label key parity; see above */
      SATELLITE_CATEGORY_SHORT_LABELS[sat.category] || sat.category.toUpperCase()
    : /* v8 ignore stop */
      ''
  return catLabel ? `${catLabel} · NORAD ${sat.norad_id}` : `NORAD ${sat.norad_id}`
}

// Each result row is a role="option". An explicit aria-label keeps the option's
// accessible name to the satellite identity (otherwise it would absorb the whole
// expanded accordion); the open/closed state is announced too since an option
// cannot carry aria-expanded.
function satOptionLabel(sat: SatEntry): string {
  const state = expandedNoradId.value === sat.norad_id ? 'expanded' : 'collapsed'
  return `${sat.name || sat.norad_id}, ${satSecondary(sat)}, ${state}`
}

// Space-separated ids of every option row currently rendered (collapsed
// categories render none), in visual order. The listbox claims these via
// aria-owns — they live outside it in the DOM so the surrounding header / action
// buttons stay valid.
const ownedOptionIds = computed<string>(() =>
  (activeGroup.value?.sats ?? []).map((sat) => `space-filter-opt-${sat.norad_id}`).join(' '),
)

// The combobox popup (listbox) is only present when at least one option is
// rendered — an empty listbox would fail aria-required-children, and a combobox
// with no visible options should report aria-expanded=false.
const listboxShown = computed<boolean>(() => ownedOptionIds.value.length > 0)

// Id of the option the search input is virtually focused on (roving keyboard
// nav), surfaced via aria-activedescendant. Only references an option that is
// actually rendered (its category section is expanded), else undefined.
const activeDescId = computed<string | undefined>(() => {
  const id = focusedNoradId.value
  if (!id) return undefined
  const rendered = !!activeGroup.value?.sats.some((s) => s.norad_id === id)
  return rendered ? `space-filter-opt-${id}` : undefined
})

function onMouseEnter(sat: SatEntry): void {
  if (clearPreviewTimer) {
    clearTimeout(clearPreviewTimer)
    clearPreviewTimer = null
  }
  props.satelliteControl?.previewSatellite(sat.norad_id, sat.name || sat.norad_id)
}

function onMouseLeave(): void {
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
  clearPreviewTimer = setTimeout(() => {
    clearPreviewTimer = null
    props.satelliteControl?.clearPreview()
  }, 50)
}

// Open the accordion for a satellite: select it on the map and load its passes
// / telemetry. Shared by a click and by the on-mount restore of a persisted
// expansion. switchSatellite (follow=false) selects the sat and starts the
// position polling that feeds the live POSITION/ORBITAL fields and polar plot
// via 'sat-position-update' — without moving the camera, so it's safe on a
// passive restore too. (Skipping it left the restored accordion's data blank.)
function openAccordion(sat: SatEntry): void {
  expandedNoradId.value = sat.norad_id
  accordionPasses.value = []
  accordionStatus.value = 'COMPUTING PASSES…'
  accordionLoading.value = true
  liveTelemetry.value = {}
  liveAzEl.value = null
  props.satelliteControl?.switchSatellite(sat.norad_id, sat.name || sat.norad_id)
  notifNoradId.value = readPassNotifState(sat.norad_id) ? sat.norad_id : null
  void fetchAccordionPasses(sat.norad_id)
  if (isAutoTuneEnabled(sat.norad_id)) void refreshArmedPasses(sat.norad_id)
  else armedPasses.value = []
}

function onItemClick(sat: SatEntry): void {
  const wasExpanded = expandedNoradId.value === sat.norad_id
  collapseExpanded()
  if (!wasExpanded) {
    openAccordion(sat)
  }
}

function collapseExpanded(): void {
  expandedNoradId.value = ''
  accordionPasses.value = []
  if (itemFetchAbort) {
    itemFetchAbort.abort()
    itemFetchAbort = null
  }
  if (itemTickInterval) {
    clearInterval(itemTickInterval)
    itemTickInterval = null
  }
}

async function fetchAccordionPasses(noradId: string): Promise<void> {
  /* v8 ignore start -- defensive: every openAccordion is preceded by collapseExpanded
     (which aborts + nulls itemFetchAbort), and the restore path runs only once on load, so
     itemFetchAbort is always null on entry. SpaceFilter has no periodic refresh that would
     re-enter while a fetch is live. */
  if (itemFetchAbort) {
    itemFetchAbort.abort()
  }
  /* v8 ignore stop */
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
    if (!resp.ok) {
      accordionStatus.value = 'COULD NOT LOAD PASSES'
      accordionLoading.value = false
      return
    }
    const data = (await resp.json()) as { passes: SatPass[]; computed_at: string }
    const t = new Date(data.computed_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
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
  /* v8 ignore start -- defensive: startItemTick only runs after a successful accordion
     fetch, and collapseExpanded clears itemTickInterval before any subsequent open, so it is
     always null here. */
  if (itemTickInterval) clearInterval(itemTickInterval)
  /* v8 ignore stop */
  itemTickInterval = setInterval(() => {
    accordionPasses.value = [...accordionPasses.value]
  }, 1000)
}

function togglePassNotif(sat: SatEntry): void {
  const ctrl = props.satelliteControl
  if (!ctrl) return
  if (ctrl.activeNoradId !== sat.norad_id) {
    ctrl.switchSatellite(sat.norad_id, sat.name || sat.norad_id)
  }
  ctrl.togglePassNotifications()
}

function trackSat(sat: SatEntry): void {
  if (followedNoradId.value === sat.norad_id) {
    props.satelliteControl?.stopFollowing()
  } else {
    props.satelliteControl?.switchSatellite(sat.norad_id, sat.name || sat.norad_id, true)
  }
}

function clearQuery(): void {
  query.value = ''
  collapseExpanded()
  inputRef.value?.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    clearQuery()
    return
  }
  // Keyboard nav is scoped to the active category's rendered rows.
  const allSats = activeGroup.value?.sats ?? []
  if (!allSats.length) return
  const idx = allSats.findIndex((s) => s.norad_id === focusedNoradId.value)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = allSats[idx + 1] || allSats[0]
    focusedNoradId.value = next.norad_id
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx <= 0) {
      focusedNoradId.value = null
      return
    }
    focusedNoradId.value = allSats[idx - 1].norad_id
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const target = focusedNoradId.value
      ? allSats.find((s) => s.norad_id === focusedNoradId.value)
      : allSats[0]
    if (target) onItemClick(target)
  }
}

// Live telemetry forwarding into expanded accordion
function onSatPositionUpdate(e: Event): void {
  if (!expandedNoradId.value) return
  const { noradId, position } = (
    e as CustomEvent<{
      noradId: string
      position: {
        alt_km: number
        velocity_kms: number
        track_deg: number
        lat: number
        lon: number
        az?: number
        el?: number
      }
    }>
  ).detail
  if (noradId !== expandedNoradId.value) return
  liveTelemetry.value = {
    alt: `${position.alt_km} km`,
    vel: `${position.velocity_kms} km/s`,
    hdg: `${position.track_deg}°`,
    lat: `${position.lat}°`,
    lon: `${position.lon}°`,
  }
  // Use the backend-computed look-angles when present (exact); otherwise leave
  // the live marker off rather than guessing.
  liveAzEl.value =
    position.az != null && position.el != null ? { az: position.az, el: position.el } : null
}

async function loadSatellites(): Promise<void> {
  try {
    const resp = await fetch('/api/space/tle/list')
    if (!resp.ok) {
      loaded.value = true
      return
    }
    const data = (await resp.json()) as { satellites?: SatEntry[] }
    satellites.value = data.satellites ?? []
    loaded.value = true
    restoreExpandedAccordion()
  } catch {
    loaded.value = true
  }
}

// Re-open the satellite accordion the user left expanded before navigating away.
// The persisted id may be stale (sat dropped from the DB) — clear it if so.
// openAccordion re-selects the sat (follow=false, camera-safe) so its live
// telemetry repopulates.
function restoreExpandedAccordion(): void {
  const id = expandedNoradId.value
  if (!id) return
  const sat = satellites.value.find((s) => s.norad_id === id)
  if (sat) {
    // Switch to the restored satellite's category so its row (and open accordion)
    // is in the visible single-category list.
    spaceStore.setSpaceFilterCategory(sat.category || 'unknown')
    openAccordion(sat)
  } else expandedNoradId.value = ''
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
    now.value = Date.now()
    if (accordionPasses.value.length) accordionPasses.value = [...accordionPasses.value]
  }, 1000)
})

onUnmounted(() => {
  /* v8 ignore start -- defensive: onMounted always assigns countdownTick, so it is never
     null here (this guard can't be false). */
  if (countdownTick) clearInterval(countdownTick)
  /* v8 ignore stop */
  if (itemFetchAbort) itemFetchAbort.abort()
  if (itemTickInterval) clearInterval(itemTickInterval)
  if (clearPreviewTimer) clearTimeout(clearPreviewTimer)
})

useDocumentEvent('sat-position-update', onSatPositionUpdate)
useDocumentEvent('settings-panel-closed', onSettingsPanelClosed)
useDocumentEvent('satellite-follow-changed', (e: Event) => {
  const { noradId, following } = (e as CustomEvent<{ noradId: string; following: boolean }>).detail
  followedNoradId.value = following ? noradId : null
})
useDocumentEvent('satellite-pass-notif-changed', (e: Event) => {
  const { noradId, enabled } = (e as CustomEvent<{ noradId: string; enabled: boolean }>).detail
  notifNoradId.value = enabled
    ? noradId
    : notifNoradId.value === noradId
      ? null
      : notifNoradId.value
})
useDocumentEvent('satellite-auto-tune-changed', () => {
  // Re-read armed state from the store (another component may have toggled) and
  // refresh the conflict data for whatever sat is expanded.
  armedTick.value++
  const exp = expandedNoradId.value
  if (exp && isAutoTuneEnabled(exp)) void refreshArmedPasses(exp)
  else armedPasses.value = []
})

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<style>
#space-filter-input-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  /* Match the height of the SEARCH rail tab button (.msb-rail-btn). */
  height: 40px;
  padding: 0 20px 0 24px;
  background: var(--color-search-field-bg);
  box-sizing: border-box;
  transition: background 0.12s;
}

/* Drop the green a11y focus ring (assets/a11y.css :focus-visible); the input row
   keeps its own fill on focus. The accent text caret is the visible focus cue
   for this text field (WCAG 2.4.7). */
#space-filter-input:focus-visible {
  outline: none !important;
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

/* The visual body and its per-category groups carry the vertical stacking that
   used to sit directly on #space-filter-results (now just the scroll container),
   so the visual layout is unchanged. #space-filter-listbox is an empty aria-owns
   host and takes no space. */
.space-filter-results-body,
.space-filter-result-group {
  display: flex;
  flex-direction: column;
}

/* Now the accordion category headers are gone, the first row would sit flush under
   the search input. Add top space matching the between-item gap so the
   input→first-item gap reads the same as the gap between list items. */
.space-filter-results-body {
  padding-top: 9px;
}

.space-filter-result-item {
  display: flex;
  flex-direction: column;
  position: relative;
  cursor: pointer;
  transition: background 0.12s;
}

/* The option wrapper holds the row header (identity text + chevron); the chevron
   is absolutely positioned against the .space-filter-result-item, so the option
   itself stays unpositioned. */
.space-filter-result-option > .space-filter-result-info {
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
  padding: 0 20px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.25);
  transition:
    transform 0.2s ease,
    color 0.15s;
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
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.sfr-acc-section {
  padding: 14px 24px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sfr-acc-section-title {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--color-accent);
  text-transform: uppercase;
}

/* The label/value grid itself (POSITION DATA / ORBITAL DATA / RADIO) now
   lives in BaseDataGrid/BaseDataCell — the single source of truth TrackingPanel
   and SpacePasses also consume, instead of silently reaching into this file's
   former sfr-acc-grid/sfr-acc-cell/sfr-acc-cell-value classes. sfr-acc-cell-label
   stays: the RADIO section's PACKET/NOTES caption lines still use it directly. */
.sfr-acc-cell-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
}

.sfr-acc-section--track {
  padding-top: 16px;
  padding-bottom: 24px;
}

.sfr-acc-track-row {
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
}

.sfr-acc-track-btn {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  background: #0d1015;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.12s,
    background 0.12s;
}

.sfr-acc-track-btn:hover {
  color: var(--color-accent);
  background: #05070a;
}

.sfr-acc-track-btn.sfr-acc-track-btn--active {
  color: var(--color-accent);
  background: rgba(200, 255, 0, 0.12);
}

.sfr-acc-track-btn.sfr-acc-track-btn--active:hover {
  background: rgba(200, 255, 0, 0.18);
}

.sfr-acc-notif-btn {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  background: #0d1015;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.12s,
    background 0.12s;
}

.sfr-acc-notif-btn:hover {
  color: var(--color-accent);
  background: #05070a;
}

.sfr-acc-notif-btn.sfr-acc-notif-btn--active {
  color: var(--color-accent);
  background: rgba(200, 255, 0, 0.12);
}

.sfr-acc-notif-btn.sfr-acc-notif-btn--active:hover {
  background: rgba(200, 255, 0, 0.18);
}

.sfr-acc-autotune-btn {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  background: #0d1015;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.12s,
    background 0.12s;
}

.sfr-acc-autotune-btn:hover {
  color: var(--color-accent);
  background: #05070a;
}

.sfr-acc-autotune-btn.sfr-acc-autotune-btn--active {
  color: var(--color-accent);
  background: rgba(200, 255, 0, 0.12);
}

.sfr-acc-autotune-btn.sfr-acc-autotune-btn--active:hover {
  background: rgba(200, 255, 0, 0.18);
}

/* Record-on-pass button — sits beside auto-tune and is only enabled once
   auto-tune is armed (recording needs a live tune to capture). */
.sfr-acc-record-btn {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  background: #0d1015;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.12s,
    background 0.12s;
}

.sfr-acc-record-btn:hover:not(:disabled) {
  color: #ff4040;
  background: #05070a;
}

.sfr-acc-record-btn.sfr-acc-record-btn--active {
  color: #ff4040;
  background: rgba(255, 64, 64, 0.12);
}

.sfr-acc-record-btn.sfr-acc-record-btn--active:hover {
  background: rgba(255, 64, 64, 0.18);
}

.sfr-acc-record-btn:disabled {
  cursor: not-allowed;
  color: rgba(255, 255, 255, 0.18);
}

/* Inline lock-in conflict warning: another armed sat overlaps this one, so only
   one of the two passes will actually be tuned. */
.sfr-acc-autotune-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 5px 8px;
  background: rgba(255, 176, 0, 0.08);
  border-left: 2px solid #ffb000;
  color: #ffb000;
  font-size: 10px;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.sfr-acc-autotune-warn svg {
  flex: 0 0 auto;
}

/* The notif / auto-tune icon buttons' hover tooltip (black pill above the
   button, left-anchored) comes from BaseIconAction's default
   tooltipSide="top" look. */

.sfr-acc-section--polar {
  padding-top: 14px;
  padding-bottom: 6px;
  gap: 8px;
}

.sfr-acc-polar-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.sfr-acc-polar-maxel {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.32);
  text-transform: uppercase;
}

.sfr-acc-polar-empty {
  padding: 18px 0;
  text-align: left;
  font-family: var(--font-primary);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.28);
  text-transform: uppercase;
}

.sfr-acc-section--passes {
  padding-top: 6px;
  padding-bottom: 4px;
  gap: 6px;
}

.sfr-acc-passes-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.sfr-acc-status {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.28);
  text-transform: uppercase;
}

.sfr-acc-status.sfr-acc-status-loading {
  color: var(--color-accent);
}

.sfr-acc-no-passes {
  padding: 4px 24px 8px 24px;
  font-family: var(--font-primary);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.28);
  text-transform: uppercase;
}

.sfr-acc-pass-list {
  display: flex;
  flex-direction: column;
  margin: 0 -24px;
}

.sfr-acc-pass-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 24px;
}

.sfr-acc-pass-card:last-child {
  padding-bottom: 16px;
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

/* ---- RADIO section ---- */
/* The grid itself and its "· MODE" suffix span now live in BaseDataGrid
   (rendered with `bare` so it shares this file's own sfr-acc-section flex/gap
   for the PACKET/NOTES lines below) and BaseDataCell's :slotted(.ba-data-cell-mode). */
.sfr-acc-radio-line {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sfr-acc-radio-text {
  font-family: var(--font-primary);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.78);
}
.sfr-acc-radio-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sfr-acc-radio-list li {
  position: relative;
  padding-left: 14px;
  font-family: var(--font-primary);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.82);
}
.sfr-acc-radio-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent);
  opacity: 0.65;
}
</style>
