<template>
  <BaseFilterPanel
    ref="panelRef"
    :items="items"
    :query="query"
    :expanded-key="expandedKey"
    id-prefix="filter"
    input-label="Filter aircraft by callsign, ICAO or squawk"
    placeholder="CALLSIGN · ICAO · SQUAWK"
    listbox-label="Aircraft, airports and military bases"
    :enter-activates-first-row="false"
    clear-focus-on-input
    @update:query="query = $event"
    @update:expanded-key="onExpandedKeyChange"
  >
    <!-- Military bases don't expand — they carry a MIL badge where the other
         categories show their disclosure chevron. -->
    <template #row-trailing>
      <span class="filter-result-badge">MIL</span>
    </template>

    <template #accordion="{ item }">
      <!-- Inline accordion of live telemetry + controls, keyed off the category
           the row came from. Data re-renders each ADS-B poll. -->
      <div
        v-if="filterCategory === 'aircraft'"
        class="apt-acc-body acft-acc-body"
        :class="{
          'acft-acc-body--stale': signalLost,
          'acft-acc-body--emergency': planeFor(item.key)!.emergency,
        }"
      >
        <div v-if="signalLost" class="acft-acc-signal-lost" role="status">SIGNAL LOST</div>
        <div class="apt-acc-section">
          <div class="apt-acc-section-title">POSITION</div>
          <div class="apt-acc-grid apt-acc-grid--three">
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">LATITUDE</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.lat }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">LONGITUDE</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.lon }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">HEADING</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.hdg }}</div>
            </div>
          </div>
        </div>
        <div class="apt-acc-section">
          <div class="apt-acc-grid apt-acc-grid--three">
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">ALTITUDE</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.alt }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">SPEED</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.spd }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">VERTICAL</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.vrate }}</div>
            </div>
          </div>
        </div>
        <div class="apt-acc-section">
          <div class="apt-acc-section-title">IDENTIFICATION</div>
          <div class="apt-acc-grid apt-acc-grid--two">
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">TYPE</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.type }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">REGISTRATION</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.reg }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">CATEGORY</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.category }}</div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">SQUAWK</div>
              <div class="apt-acc-cell-value">{{ liveAircraftData.squawk }}</div>
            </div>
          </div>
        </div>
        <div class="apt-acc-section acft-acc-action-section">
          <div class="acft-acc-action-row">
            <BaseIconAction
              class="acft-acc-btn"
              :active="followedHex === item.key"
              active-class="acft-acc-btn--active"
              :accessible-name="followedHex === item.key ? 'Untrack aircraft' : 'Track aircraft'"
              :tooltip="followedHex === item.key ? 'Untrack aircraft' : 'Track aircraft'"
              @click.stop="toggleTrack(item.key)"
            >
              <LocationPinIcon />
            </BaseIconAction>
            <BaseIconAction
              class="acft-acc-btn"
              :active="notifEnabled.has(item.key)"
              active-class="acft-acc-btn--active"
              :accessible-name="
                notifEnabled.has(item.key) ? 'Disable notifications' : 'Enable notifications'
              "
              :tooltip="
                notifEnabled.has(item.key) ? 'Disable notifications' : 'Enable notifications'
              "
              @click.stop="toggleNotif(item.key)"
            >
              <!-- Strike-through shown when notifications for this aircraft are off. -->
              <BellIcon :size="14" :struck="!notifEnabled.has(item.key)" />
            </BaseIconAction>
            <BaseIconAction
              class="acft-acc-btn"
              accessible-name="Centre on map"
              tooltip="Centre on map"
              @click.stop="centrePlane(planeFor(item.key)!)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  stroke="currentColor"
                  stroke-width="1.8"
                  fill="none"
                />
                <line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" stroke-width="1.8" />
                <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" stroke-width="1.8" />
                <line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" stroke-width="1.8" />
                <line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1.8" />
              </svg>
            </BaseIconAction>
          </div>
        </div>
      </div>

      <!-- Airport accordion: location + clickable frequencies. Military bases
           are the only other category and never expand, so the two expandable
           categories are the whole story here. -->
      <div v-else class="apt-acc-body">
        <div class="apt-acc-section">
          <div class="apt-acc-section-title">LOCATION</div>
          <div class="apt-acc-grid apt-acc-grid--two">
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">LATITUDE</div>
              <div class="apt-acc-cell-value">
                {{ formatLat(airportFor(item.key)!.coords[1]) }}
              </div>
            </div>
            <div class="apt-acc-cell">
              <div class="apt-acc-cell-label">LONGITUDE</div>
              <div class="apt-acc-cell-value">
                {{ formatLon(airportFor(item.key)!.coords[0]) }}
              </div>
            </div>
          </div>
        </div>
        <div class="apt-acc-section">
          <div class="apt-acc-section-title">FREQUENCIES</div>
          <div class="apt-acc-grid apt-acc-grid--two">
            <button
              v-for="freq in airportFreqs(airportFor(item.key)!)"
              :key="freq.label"
              class="apt-acc-cell apt-acc-freq"
              :title="
                sdrConnected ? `Tune to ${freq.display} ${freq.mode}` : 'Connect an SDR to tune'
              "
              @click="tuneFreq(airportFor(item.key)!, freq)"
            >
              <div class="apt-acc-cell-label">{{ freq.label.toUpperCase() }}</div>
              <div class="apt-acc-cell-value">
                {{ freq.display }}<span class="apt-acc-cell-mode"> · {{ freq.mode }}</span>
              </div>
            </button>
          </div>
          <div v-if="tuneNotice === item.key" class="apt-acc-notice">
            Connect an SDR before tuning
          </div>
        </div>
      </div>
    </template>
  </BaseFilterPanel>
</template>

<script setup lang="ts">
/**
 * Air FILTER pane — the searchable list of aircraft, airports and military
 * bases, one category at a time.
 *
 * Supplies rows and expanded-row content to the shared BaseFilterPanel shell
 * (combobox, listbox/aria-owns wiring, roving keyboard navigation, focusable
 * scroll region, accordion); everything domain-specific stays here: which
 * category is active, the ADS-B feed mirror and its filter gating, the pinned
 * expanded aircraft with its SIGNAL LOST grace window, and the map/SDR actions
 * an expanded row offers.
 */
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from 'vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import BaseFilterPanel, {
  type FilterPanelItem,
} from '@/components/shared/filter/BaseFilterPanel.vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import LocationPinIcon from '@/components/shared/LocationPinIcon.vue'
import BellIcon from '@/components/shared/BellIcon.vue'
import { AIRPORTS_DATA } from './controls/airports/AirportsControl'
import { MILITARY_BASES_DATA } from './controls/military-bases/MilitaryBasesControl'
import type { AdsbLiveControl } from './controls/adsb/AdsbLiveControl'
import type { AirportsToggleControl } from './controls/airports/AirportsControl'
import type { MilitaryBasesToggleControl } from './controls/military-bases/MilitaryBasesControl'
import { storeToRefs } from 'pinia'
import { useNotificationsStore } from '@/stores/notifications'
import { useAirNotifStore } from '@/stores/airNotif'
import { useSdrStore } from '@/stores/sdr'
import { useAirStore } from '@/stores/air'

interface PlaneResult {
  kind: 'plane'
  hex: string
  callsign: string
  reg: string
  squawk: string
  emergency: boolean
  coords: [number, number]
}
interface AirportResult {
  kind: 'airport'
  icao: string
  iata: string
  name: string
  bounds: [number, number, number, number]
  coords: [number, number]
  freqs: { tower: string; radar: string; approach: string; atis: string }
}
interface MilResult {
  kind: 'mil'
  icao: string
  name: string
  bounds: [number, number, number, number]
  coords: [number, number]
}

const props = defineProps<{
  adsbControl: AdsbLiveControl | null
  airportsControl: AirportsToggleControl | null
  militaryBasesControl: MilitaryBasesToggleControl | null
  getMap: () => import('maplibre-gl').Map | null
}>()

const notificationsStore = useNotificationsStore()
const airNotifStore = useAirNotifStore()
const sdrStore = useSdrStore()
const airStore = useAirStore()

const panelRef = useTemplateRef<InstanceType<typeof BaseFilterPanel>>('panelRef')

// Which airport row is expanded (by ICAO), and which one is currently showing
// the "connect an SDR" inline notice.
const expandedAirport = ref<string | null>(null)
const tuneNotice = ref<string | null>(null)

// Live telemetry shown in an expanded aircraft row's accordion. The formatted
// snapshot is held separately from the raw feed so that when the aircraft drops
// out of coverage we can keep showing its last-known values (dimmed) and flag
// the dropout, rather than blanking the panel.
interface AircraftLiveData {
  lat: string
  lon: string
  hdg: string
  alt: string
  spd: string
  vrate: string
  type: string
  reg: string
  category: string
  squawk: string
}
// Placeholder shown for any field with no live value (em dashes throughout).
const EMPTY_AIRCRAFT_DATA: AircraftLiveData = {
  lat: '—',
  lon: '—',
  hdg: '—',
  alt: '—',
  spd: '—',
  vrate: '—',
  type: '—',
  reg: '—',
  category: '—',
  squawk: '—',
}
// Hex of the aircraft whose accordion is expanded (null when none), and its
// last-known search-result snapshot — both backed by the persisted air store so
// the selection is restored when returning to Air from another section. The
// snapshot keeps the row (and accordion) rendered if the aircraft briefly leaves
// the live list, and lets the restored row render before the feed repopulates.
const { searchExpandedPlane } = storeToRefs(airStore)
const expandedPlane = computed<string | null>({
  get: () => searchExpandedPlane.value.hex || null,
  set: (value) => {
    searchExpandedPlane.value = { ...searchExpandedPlane.value, hex: value ?? '' }
  },
})
const expandedPlaneSnapshot = computed<PlaneResult | null>({
  get: () => searchExpandedPlane.value.snapshot,
  set: (value) => {
    searchExpandedPlane.value = { ...searchExpandedPlane.value, snapshot: value }
  },
})
// Always a full object (placeholder when nothing is expanded) so the template
// reads fields directly without null-guards.
const liveAircraftData = ref<AircraftLiveData>({ ...EMPTY_AIRCRAFT_DATA })
// True when the expanded aircraft has dropped out of the live feed.
const signalLost = ref(false)
// Once an expanded aircraft drops out of the feed we show SIGNAL LOST for a short
// grace window — long enough to ride out a brief dropout — then remove the row so
// a permanently-lost aircraft doesn't linger at the end of the list forever.
const SIGNAL_LOST_GRACE_MS = 15000
let signalLostTimer: ReturnType<typeof setTimeout> | null = null

function clearSignalLostTimer() {
  if (signalLostTimer !== null) {
    clearTimeout(signalLostTimer)
    signalLostTimer = null
  }
}

const sdrConnected = computed(() => sdrStore.connected)

const query = ref('')

// The active FILTER category (aircraft / airports / mil), selected via the rail
// sub-tabs in MapSidebar. Single-select — only this category's flat list renders.
const { airFilterCategory: filterCategory } = storeToRefs(airStore)

// Notification opt-in state — sourced from the persisted airNotif store.
const notifEnabled = computed(() => airNotifStore.enabledHexes)

// Hex of the aircraft the map is currently following, or null. The control is a
// plain (non-reactive) class, so this mirror is refreshed from it on every data
// update and updated optimistically when the track button is clicked.
const followedHex = ref<string | null>(null)

// Aircraft data — refreshed on adsb-data-update event
const aircraftFeatures = ref<
  Array<{ properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }>
>([])

// Mirror of the map's active filter so the search list shows the same aircraft
// the map does (ALL / CIVIL / MILITARY). Refreshed alongside the feature data
// and whenever the user changes the filter mode.
const typeFilter = ref<'all' | 'civil' | 'mil'>('all')
const allHidden = ref(false)

function refreshFilterState() {
  if (props.adsbControl) {
    typeFilter.value = props.adsbControl._typeFilter
    allHidden.value = props.adsbControl._allHidden
    followedHex.value = props.adsbControl._followEnabled ? props.adsbControl._selectedHex : null
  }
}

function refreshAircraft() {
  if (props.adsbControl?._geojson?.features) {
    aircraftFeatures.value = props.adsbControl._geojson
      .features as unknown as typeof aircraftFeatures.value
  } else {
    aircraftFeatures.value = []
  }
  refreshFilterState()
  refreshExpandedPlane()
}

function onMsbTabSwitch(e: Event): void {
  const tab = (e as CustomEvent<string>).detail
  if (tab === 'search') refreshAircraft()
}

useDocumentEvent('adsb-data-update', refreshAircraft)
useDocumentEvent('msb-tab-switch', onMsbTabSwitch)
// AirSideMenu dispatches this when the map filter mode changes so the list stays in sync.
useDocumentEvent('adsb-filter-change', refreshFilterState)

// ---- Search results ----
const results = computed<Array<PlaneResult | AirportResult | MilResult>>(() => {
  const q = query.value.trim().toLowerCase()
  const out: Array<PlaneResult | AirportResult | MilResult> = []

  // Aircraft — gated by the map's active filter (ALL hides everything; CIVIL/MIL
  // restrict to planes matching the military flag, excluding ground/tower like the map).
  const planeResults: PlaneResult[] = []
  for (const f of aircraftFeatures.value) {
    if (allHidden.value) break
    const p = f.properties
    const category = ((p.category as string) || '').trim()
    const t = ((p.t as string) || '').trim()
    // The list shows only aircraft — never ground vehicles (C1/C2) or
    // tower/static emitters (C3-C5, TWR), regardless of the ALL/CIVIL/MIL filter.
    const isGnd = category === 'C1' || category === 'C2'
    const isTower = ['C3', 'C4', 'C5'].includes(category) || t === 'TWR'
    if (isGnd || isTower) continue
    if (typeFilter.value !== 'all') {
      const isMil = !!p.military
      if (typeFilter.value === 'mil' && !isMil) continue
      if (typeFilter.value === 'civil' && isMil) continue
    }
    const callsign = ((p.flight as string) || '').trim()
    const hex = ((p.hex as string) || '').trim()
    const reg = ((p.r as string) || '').trim()
    const squawk = ((p.squawk as string) || '').trim()
    if (!q || [callsign, hex, reg, squawk].some((v) => v.toLowerCase().includes(q))) {
      planeResults.push({
        kind: 'plane',
        hex,
        callsign,
        reg,
        squawk,
        emergency: !!p.emergency && p.emergency !== 'none',
        coords: f.geometry.coordinates,
      })
    }
  }
  // Stable ordering so rows keep their place as the feed reorders/repopulates
  // each poll — otherwise an open accordion would jump around as aircraft come
  // and go.
  planeResults.sort(comparePlanes)
  out.push(...planeResults)

  // Airports
  for (const f of AIRPORTS_DATA.features) {
    const p = f.properties
    if (!q || [p.icao, p.iata, p.name].some((v) => v?.toLowerCase().includes(q))) {
      out.push({
        kind: 'airport',
        icao: p.icao,
        iata: p.iata,
        name: p.name,
        bounds: p.bounds,
        coords: f.geometry.coordinates as [number, number],
        freqs: p.freqs,
      })
    }
  }

  // Military bases
  for (const f of MILITARY_BASES_DATA.features) {
    const p = f.properties
    if (!q || [p.icao, p.name].some((v) => v?.toLowerCase().includes(q))) {
      out.push({
        kind: 'mil',
        icao: p.icao,
        name: p.name,
        bounds: p.bounds,
        coords: f.geometry.coordinates as [number, number],
      })
    }
  }

  return out
})

// Row ordering: by callsign (falling back to the immutable hex when an aircraft
// has not broadcast one yet), then hex as a stable tie-break.
function comparePlanes(first: PlaneResult, second: PlaneResult): number {
  return (
    (first.callsign || first.hex).localeCompare(second.callsign || second.hex) ||
    first.hex.localeCompare(second.hex)
  )
}

const planes = computed(() => results.value.filter((r) => r.kind === 'plane') as PlaneResult[])

// The aircraft rows actually rendered. The expanded (selected) aircraft is
// pinned to the top so its open accordion never moves as the rest of the list
// reorders/repopulates each poll. The pinned row uses its live data when still
// in the feed, or the last-known snapshot when it has briefly dropped out (so it
// stays visible while SIGNAL LOST shows). All other aircraft follow in sort order.
const displayPlanes = computed<PlaneResult[]>(() => {
  const live = planes.value
  const snapshot = expandedPlaneSnapshot.value
  if (!snapshot) return live
  const pinned = live.find((r) => r.hex === snapshot.hex) ?? snapshot
  return [pinned, ...live.filter((r) => r.hex !== snapshot.hex)]
})
const airports = computed(
  () => results.value.filter((r) => r.kind === 'airport') as AirportResult[],
)
const milBases = computed(() => results.value.filter((r) => r.kind === 'mil') as MilResult[])

function planeSecondary(r: PlaneResult): string {
  const parts: string[] = []
  if (r.hex) parts.push(r.hex.toUpperCase())
  if (r.reg) parts.push(r.reg)
  if (r.squawk) parts.push('SQK ' + r.squawk)
  return parts.join(' · ')
}

// ---- Rows ----
// Only the active category's rows render, so the shell sees one flat list. Each
// row's element ids keep the per-category, index-based token the pane has always
// used — a base name can contain spaces, which would split the listbox's
// space-separated aria-owns list into dangling IDREFs.
//
// Expandable rows (aircraft, airports) also announce their open/closed state in
// their accessible name, since an option cannot carry aria-expanded.
const items = computed<FilterPanelItem[]>(() => {
  if (filterCategory.value === 'aircraft') {
    return displayPlanes.value.map((plane, index) => ({
      key: plane.hex,
      idKey: `plane-${index}`,
      primary: plane.callsign || plane.hex,
      secondary: planeSecondary(plane),
      optionLabel: planeOptionLabel(plane),
      rowClass: plane.emergency ? 'filter-result-item--emergency' : undefined,
    }))
  }
  if (filterCategory.value === 'airports') {
    return airports.value.map((airport, index) => ({
      key: airport.icao,
      idKey: `airport-${index}`,
      primary: airport.icao,
      secondary: `${airport.name.toUpperCase()}${airport.iata ? ' · ' + airport.iata : ''}`,
      optionLabel: airportOptionLabel(airport),
    }))
  }
  // defensive: AirFilterCategory is an exhaustive 'aircraft' | 'airports' |
  // 'mil' union guarded on load (isAirFilterCategory), so once the two prior
  // arms are excluded, category here is always 'mil'.
  return milBases.value.map((base, index) => ({
    key: base.name,
    idKey: `mil-${index}`,
    primary: base.icao || base.name.toUpperCase().slice(0, 6),
    secondary: base.name.toUpperCase(),
    optionLabel: milOptionLabel(base),
    // A base has no detail to disclose — clicking one just flies the map to it.
    expandable: false,
  }))
})

// The row the shell should render open: whichever of the two expandable
// categories is active (military bases never expand).
const expandedKey = computed<string>(() => {
  if (filterCategory.value === 'aircraft') return expandedPlane.value ?? ''
  if (filterCategory.value === 'airports') return expandedAirport.value ?? ''
  return ''
})

function planeOptionLabel(r: PlaneResult): string {
  const secondary = planeSecondary(r)
  const primary = r.callsign || r.hex
  return secondary ? `${primary}, ${secondary}` : primary
}
function airportOptionLabel(r: AirportResult): string {
  const iata = r.iata ? ` ${r.iata}` : ''
  const state = expandedAirport.value === r.icao ? 'expanded' : 'collapsed'
  return `${r.icao}, ${r.name.toUpperCase()}${iata}, ${state}`
}
function milOptionLabel(r: MilResult): string {
  const primary = r.icao || r.name.toUpperCase().slice(0, 6)
  return `${primary}, ${r.name.toUpperCase()}`
}

// Look-ups from a row key back to its source record, for the accordion slot and
// the click handlers. Each is only ever called for a row of its own category —
// the caller has already established which one is active — so neither has to
// re-check the category.
function planeFor(key: string): PlaneResult | undefined {
  return displayPlanes.value.find((plane) => plane.hex === key)
}
function airportFor(key: string): AirportResult | undefined {
  return airports.value.find((airport) => airport.icao === key)
}

// ---- Row activation ----
// The shell reports the row that should now be open ('' when the open row was
// clicked shut). Each category turns that into its own action.
function onExpandedKeyChange(key: string): void {
  if (filterCategory.value === 'aircraft') {
    if (!key) {
      expandedPlane.value = null
      refreshExpandedPlane()
      return
    }
    const plane = planeFor(key)
    /* v8 ignore start -- the key always comes from a rendered row of the active
       category, so the look-up above cannot miss. */
    if (!plane) return
    /* v8 ignore stop */
    selectPlane(plane)
    return
  }
  if (filterCategory.value === 'airports') {
    if (!key) {
      expandedAirport.value = null
      return
    }
    const airport = airportFor(key)
    /* v8 ignore start -- as above: the key is always a rendered airport row. */
    if (!airport) return
    /* v8 ignore stop */
    openAirport(airport)
    return
  }
  // Military bases don't expand: a click just flies the map to the base. The
  // shell still reports the key (nothing is open, so it is never the collapse
  // case), which is the signal to navigate.
  const base = milBases.value.find((candidate) => candidate.name === key)
  /* v8 ignore start -- as above: the key is always a rendered base row. */
  if (!base) return
  /* v8 ignore stop */
  fitBoundsWithPadding(base.bounds)
}

// Opening an aircraft row centres the map on it (matching the airport rows'
// behaviour) and pins it to the top of the list.
function selectPlane(r: PlaneResult) {
  expandedPlane.value = r.hex
  // Capture the clicked row so it stays rendered (with last-known telemetry) if
  // the aircraft later drops out of the live list.
  expandedPlaneSnapshot.value = r
  refreshExpandedPlane()
  centrePlane(r)
}

// Ease the map to an aircraft, preferring the control's interpolated position
// over the (older) snapshot coordinates from the search result.
function centrePlane(r: PlaneResult) {
  const c = props.adsbControl
  if (!c) return
  const coords = c._interpolatedCoords(r.hex) ?? r.coords
  const m = props.getMap()
  if (m) m.easeTo({ center: coords, zoom: Math.max(m.getZoom(), 10), duration: 600 })
}

// Locate the live feature for a hex in the current ADS-B snapshot.
function findAircraftFeature(hex: string) {
  return aircraftFeatures.value.find((f) => f.properties.hex === hex)
}

// Format an aircraft's raw properties into the labelled values the accordion
// shows. Missing/zero numeric fields render as an em dash rather than "0".
function formatAircraftLiveData(feature: {
  properties: Record<string, unknown>
  geometry: { coordinates: [number, number] }
}): AircraftLiveData {
  const p = feature.properties
  const [lon, lat] = feature.geometry.coordinates
  return {
    lat: formatLat(lat),
    lon: formatLon(lon),
    hdg: formatHeading(p.track),
    alt: formatAltitude(p.alt_baro),
    spd: formatSpeed(p.gs),
    vrate: formatVerticalRate(p.baro_rate),
    type: ((p.t as string) || '').trim() || '—',
    reg: ((p.r as string) || '').trim() || '—',
    category: ((p.category as string) || '').trim() || '—',
    squawk: ((p.squawk as string) || '').trim() || '—',
  }
}

// Refresh the expanded aircraft's telemetry from the latest feed. Keeps the last
// known values and flags SIGNAL LOST when the aircraft is no longer present.
function refreshExpandedPlane() {
  const hex = expandedPlane.value
  if (!hex) {
    liveAircraftData.value = { ...EMPTY_AIRCRAFT_DATA }
    expandedPlaneSnapshot.value = null
    signalLost.value = false
    clearSignalLostTimer()
    return
  }
  const feature = findAircraftFeature(hex)
  signalLost.value = !feature
  if (feature) {
    // Live again: refresh values and cancel any pending removal.
    liveAircraftData.value = formatAircraftLiveData(feature)
    clearSignalLostTimer()
  } else if (signalLostTimer === null) {
    // Just dropped out: keep the last-known values, and schedule removal of the
    // row if the aircraft doesn't return within the grace window.
    signalLostTimer = setTimeout(() => {
      signalLostTimer = null
      expandedPlane.value = null
      refreshExpandedPlane()
    }, SIGNAL_LOST_GRACE_MS)
  }
}

onUnmounted(clearSignalLostTimer)

function fitBoundsWithPadding(bounds: [number, number, number, number]) {
  const m = props.getMap()
  if (!m) return
  const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null
  const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0
  const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0
  const pad = 80
  const topExtra = Math.max(0, ctrlH / 2 - pad)
  m.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    {
      padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW },
      maxZoom: 13,
      duration: 800,
    },
  )
}

// Opening an airport row both navigates the map to it and expands the inline
// accordion of frequencies.
function openAirport(r: AirportResult) {
  expandedAirport.value = r.icao
  tuneNotice.value = null
  fitBoundsWithPadding(r.bounds)
}

interface AirportFreq {
  label: string
  display: string
  mode: 'AM'
  hz: number
}

// All airband voice/ATIS channels are AM. A stored value may hold more than one
// frequency ("118.500 / 118.700"); the first is the primary we tune to.
function airportFreqs(r: AirportResult): AirportFreq[] {
  const defs: [string, string][] = [
    ['Tower', r.freqs.tower],
    ['Radar', r.freqs.radar],
    ['Approach', r.freqs.approach],
    ['ATIS', r.freqs.atis],
  ]
  const out: AirportFreq[] = []
  for (const [label, raw] of defs) {
    const first = (raw || '').split('/')[0].trim()
    const mhz = parseFloat(first)
    if (isNaN(mhz) || mhz <= 0) continue
    out.push({ label, display: raw.trim(), mode: 'AM', hz: Math.round(mhz * 1e6) })
  }
  return out
}

function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`
}
function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
}

// Coerce a feed value to a finite number, or null when absent/non-numeric.
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatHeading(track: unknown): string {
  const value = asFiniteNumber(track)
  return value === null ? '—' : `${Math.round(value)}°`
}

function formatAltitude(altBaro: unknown): string {
  const value = asFiniteNumber(altBaro)
  if (value === null) return '—'
  // alt_baro of 0 (or below) means on/near the ground in the ADS-B feed.
  return value <= 0 ? 'GND' : `${Math.round(value).toLocaleString('en-US')} ft`
}

function formatSpeed(groundSpeed: unknown): string {
  const value = asFiniteNumber(groundSpeed)
  return value === null ? '—' : `${Math.round(value)} kt`
}

function formatVerticalRate(baroRate: unknown): string {
  const value = asFiniteNumber(baroRate)
  if (value === null) return '—'
  const rounded = Math.round(value)
  // Show an explicit + for climbs so the sign reads at a glance.
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toLocaleString('en-US')} fpm`
}

// Tune the connected SDR to a clicked frequency. If no radio is connected, show
// a subtle inline notice instead of attempting to tune.
function tuneFreq(r: AirportResult, f: AirportFreq) {
  if (!sdrStore.connected) {
    tuneNotice.value = r.icao
    return
  }
  tuneNotice.value = null
  document.dispatchEvent(
    new CustomEvent('sentinel:sdr-tune-external', {
      detail: { hz: f.hz, mode: f.mode, satName: `${r.name} ${f.label}` },
    }),
  )
  notificationsStore.add({
    type: 'system',
    title: `${r.icao} ${f.label.toUpperCase()}`,
    detail: `Tuned ${f.display} ${f.mode}`,
  })
}

// ---- Tracking (track button) ----
// Toggle following the aircraft on the map. Delegates to the live control, then
// mirrors the resulting follow state back into the local reactive flag so the
// button's active styling updates immediately.
function toggleTrack(hex: string) {
  const c = props.adsbControl
  if (!c) return
  c.toggleFollowByHex(hex)
  followedHex.value = c.isFollowingHex(hex) ? hex : null
}

// ---- Notifications (bell button) ----
function toggleNotif(hex: string) {
  const c = props.adsbControl
  if (c && !c._trackingNotifIds) c._trackingNotifIds = {}
  const matchedFeature = c
    ? (c._geojson.features as unknown as Array<{ properties: Record<string, unknown> }>).find(
        (f) => (f.properties.hex as string) === hex,
      )
    : undefined
  const callsign = matchedFeature
    ? ((matchedFeature.properties.flight as string) || '').trim() ||
      ((matchedFeature.properties.r as string) || '').trim() ||
      hex
    : airNotifStore.callsignFor(hex)
  const wasOn = airNotifStore.isEnabled(hex)
  if (wasOn) {
    airNotifStore.disable(hex)
    if (c?._trackingNotifIds?.[hex]) {
      notificationsStore.dismiss(c._trackingNotifIds[hex])
      delete c._trackingNotifIds[hex]
    }
    notificationsStore.add({ type: 'notif-off', title: callsign })
  } else {
    airNotifStore.enable(hex, callsign)
    if (c) {
      if (c._trackingNotifIds![hex]) notificationsStore.dismiss(c._trackingNotifIds![hex])
      c._trackingNotifIds![hex] = notificationsStore.add({
        type: 'tracking',
        title: callsign,
        action: {
          label: 'DISABLE NOTIFICATIONS',
          callback: () => {
            airNotifStore.disable(hex)
            if (c._trackingNotifIds) delete c._trackingNotifIds[hex]
            c._rebuildTagForHex(hex)
          },
        },
      })
    } else {
      notificationsStore.add({ type: 'tracking', title: callsign })
    }
  }
  c?._rebuildTagForHex(hex)
}

// Refresh aircraft data when adsbControl becomes available.
watch(
  () => props.adsbControl,
  (ctrl) => {
    if (ctrl) refreshAircraft()
  },
  { immediate: true },
)

onMounted(() => {
  refreshAircraft()
})

// Expand a specific airport's accordion by ICAO (driven by a map marker click).
// Clears any active search and switches the FILTER category to airports so the
// row is in the visible list; the shell scrolls the opened row into view.
function expandAirport(icao: string) {
  const r = AIRPORTS_DATA.features.find((f) => f.properties.icao === icao)
  if (!r) return
  query.value = ''
  airStore.setAirFilterCategory('airports')
  expandedAirport.value = icao
  tuneNotice.value = null
}

// Expand a specific aircraft's accordion by hex (driven by a map aircraft click).
// Clears any active search and switches the FILTER category to aircraft, then
// pins the aircraft to the top via the snapshot. A no-op if the hex isn't a
// listed aircraft (e.g. a ground vehicle or tower, which the list omits).
function expandAircraft(hex: string) {
  query.value = ''
  airStore.setAirFilterCategory('aircraft')
  const liveResult = planes.value.find((r) => r.hex === hex)
  if (!liveResult) return
  expandedPlane.value = hex
  expandedPlaneSnapshot.value = liveResult
  refreshExpandedPlane()
}

// Expose methods driven by map-marker clicks + the focus keyboard shortcut.
defineExpose({
  focus: () => panelRef.value?.focus(),
  expandAirport,
  expandAircraft,
})
</script>

<style>
/* The shared shell (BaseFilterPanel) supplies the input row, results region and
   row chrome; what stays here is the Air pane's own deviations from it, plus the
   expanded-row accordion, which is entirely this pane's content. */

/* This pane's results region is a fixed-height box rather than a flex child. */
#filter-results {
  flex: none;
  max-height: 340px;
}

/* Rows are separated by a 1px seam of the panel background, and this pane's
   input→first-row gap is a touch wider than the shell default. The gap is set
   as the shell's custom property because the shell holds that space inside the
   first row's header, where an expanded row's tint covers it. */
#filter-results .bfp-results-body {
  gap: 1px;
  --bfp-results-top-gap: 10px;
}

/* Keyboard focus is a touch stronger here, and its outline keeps the softened
   accent this pane has always used. */
#filter-results .bfp-result-item {
  --bfp-focus-outline: rgba(200, 255, 0, 0.4);
}
#filter-results .bfp-result-item {
  --bfp-focus-highlight: rgba(255, 255, 255, 0.06);
}

/* Emergency squawk (7500/7600/7700): the aircraft goes red on the map, so flag it
   the same way in the side panel — callsign in the row and the detail accordion's
   section headings. #ff4040 matches the map's emergency callsign label colour. */
.filter-result-item--emergency .bfp-result-primary {
  color: #ff4040;
}

/* This pane centres its empty state and sets it smaller and dimmer than the
   shell's default. */
#filter-results .bfp-no-results {
  /* The extra 10px on top stands in for the row list's own top padding, which
     the empty state sits outside of — without it the message rides higher than
     a first row would. */
  padding: 30px 18px 20px;
  font-family: 'Barlow', sans-serif;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.25);
  text-align: center;
}

.filter-result-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

/* ---- Expanded-row accordion (airports + aircraft) ---- */
/* Matches the space satellite detail panel. The same lighter-grey tint as the
   open row carries through the content so the whole expanded block reads as one
   block. */
.apt-acc-body {
  display: flex;
  flex-direction: column;
  /* No background of its own: the shell tints the whole expanded row, accordion
     included. Repeating the tint here would layer it twice and lighten the
     accordion relative to the row header it hangs from. */
  /* Extra breathing room before the next airport in the list. */
  padding-bottom: 12px;
}

.apt-acc-section {
  padding: 14px 24px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.apt-acc-section-title {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--color-accent);
  text-transform: uppercase;
}

/* POSITION / IDENTIFICATION headings go red for an aircraft with an emergency
   squawk, matching the red callsign and the map marker. */
.acft-acc-body--emergency .apt-acc-section-title {
  color: #ff4040;
}

.apt-acc-grid {
  display: grid;
  column-gap: 16px;
  row-gap: 12px;
}

.apt-acc-grid--two {
  grid-template-columns: 1fr 1fr;
}

.apt-acc-grid--three {
  grid-template-columns: 1fr 1fr 1fr;
}

.apt-acc-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.apt-acc-cell-label {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
}

.apt-acc-cell-value {
  font-family: var(--font-primary);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.apt-acc-cell-mode {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 400;
  margin-left: 2px;
}

/* Frequency cells are tunable buttons. */
.apt-acc-freq {
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0;
  transition: opacity 0.12s;
}

.apt-acc-freq:hover {
  opacity: 0.7;
}

.apt-acc-notice {
  margin-top: 2px;
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
}

/* ---- Aircraft live-telemetry accordion ---- */
/* When the aircraft drops out of the feed, dim the (last-known) values. */
.acft-acc-body--stale .apt-acc-cell-value {
  color: rgba(255, 255, 255, 0.4);
}

.acft-acc-signal-lost {
  margin: 12px 24px 0 24px;
  padding: 6px 10px;
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #ff4040;
  background: rgba(255, 64, 64, 0.1);
  border-left: 2px solid #ff4040;
}

.acft-acc-action-section {
  padding-top: 8px;
  padding-bottom: 0;
  /* Pull the button row left so its boxes left-align with the section text
     above (overrides the 24px left padding inherited from .apt-acc-section). */
  padding-left: 16px;
}

/* The aircraft accordion ends on the action row, so it needs less bottom
   breathing room than the airport accordion (which ends on a data grid). */
.acft-acc-body {
  padding-bottom: 16px;
}

.acft-acc-action-row {
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
}

/* 36px square controls matching the satellite list-item accordion buttons. */
.acft-acc-btn {
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

.acft-acc-btn:hover {
  color: var(--color-accent);
  background: #05070a;
}

.acft-acc-btn.acft-acc-btn--active {
  color: var(--color-accent);
  background: rgba(200, 255, 0, 0.12);
}

.acft-acc-btn.acft-acc-btn--active:hover {
  background: rgba(200, 255, 0, 0.18);
}

/* The hover tooltip (black pill above the button, left-anchored) comes from
   BaseIconAction's default tooltipSide="top" look. */
</style>
