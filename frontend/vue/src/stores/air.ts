import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePersistedObject, usePersistedRef } from './_persist'

// The Air search/filter categories, surfaced as single-select rail sub-tabs
// beneath the FILTER tab. Exactly one is shown in the panel at a time.
export type AirFilterCategory = 'aircraft' | 'airports' | 'mil'
const AIR_FILTER_CATEGORIES: readonly AirFilterCategory[] = ['aircraft', 'airports', 'mil']
function isAirFilterCategory(value: unknown): value is AirFilterCategory {
  return typeof value === 'string' && (AIR_FILTER_CATEGORIES as readonly string[]).includes(value)
}

/** Air-specific overlays. Base-map layers that every domain shares (place
 *  names, roads) live on the `basemap` store instead. */
export interface OverlayStates {
  adsb: boolean
  adsbLabels: boolean
  airports: boolean
  militaryBases: boolean
  rangeRings: boolean
  aara: boolean
  awacs: boolean
  /** Ground vehicles in the ADS-B feed (tugs, fire, ops) — shown by default. */
  groundVehicles: boolean
  /** Fixed ADS-B ground stations ("towers") — shown by default. */
  towers: boolean
}

export type AdsbLabelField = 'type' | 'alt'

// Last-known search-result entry for an expanded aircraft, persisted so the
// selection survives navigating away from Air and back. Structurally matches
// AirFilter's PlaneResult, kept here (not imported from the .vue) so the store
// has no component dependency.
export interface SearchExpandedPlaneSnapshot {
  kind: 'plane'
  hex: string
  callsign: string
  reg: string
  squawk: string
  emergency: boolean
  coords: [number, number]
}

// The expanded aircraft in the Air search list: its hex (empty when none) plus a
// snapshot so the row can render even before the live feed repopulates on restore.
export interface SearchExpandedPlane {
  hex: string
  snapshot: SearchExpandedPlaneSnapshot | null
}

export interface AdsbLabelFields {
  civil: AdsbLabelField[]
  mil: AdsbLabelField[]
}

export interface AdsbTagFields {
  civil: AdsbTagFieldMap
  mil: AdsbTagFieldMap
}

export interface AdsbTagFieldMap {
  callsign: boolean
  altitude: boolean
  speed: boolean
  heading: boolean
  aircraftType: boolean
  registration: boolean
  squawk: boolean
  category: boolean
}

const LS_KEY = 'overlayStates'
const LS_LABEL_FIELDS_KEY = 'adsbLabelFields'
const LS_TAG_FIELDS_KEY = 'adsbTagFields_v3'
const LS_OVERHEAD_RADIUS_KEY = 'overheadAlertRadiusNm'
const LS_OVERHEAD_ALERTS_KEY = 'overheadAlerts'

export const DEFAULT_OVERHEAD_ALERT_RADIUS_NM = 10

/**
 * Overhead-alert settings for one place aircraft can be overhead *of*.
 *
 * Each Sentry watches its own patch of sky, so "is anything overhead?" is a
 * question per receiver, not one global one — the civil/military choice and the
 * radius belong to the location, not to the app.
 */
export interface OverheadAlertConfig {
  civil: boolean
  mil: boolean
  radiusNm: number
}

/** The operator's own position, which is always the first alert location. */
export const USER_ALERT_LOCATION_ID = 'user'

/** The alert-location key for one Sentry host. */
export function sentryAlertLocationId(hostId: number): string {
  return `sentry:${hostId}`
}

const DEFAULT_OVERHEAD_ALERT: OverheadAlertConfig = {
  civil: false,
  mil: false,
  radiusNm: DEFAULT_OVERHEAD_ALERT_RADIUS_NM,
}

/**
 * Read the per-location alert settings, carrying the pre-split single
 * configuration onto the operator's own location so an existing setup keeps
 * alerting on exactly what it alerted on before.
 */
function readPersistedOverheadAlerts(): Record<string, OverheadAlertConfig> {
  let stored: Record<string, OverheadAlertConfig> | null = null
  try {
    const raw = localStorage.getItem(LS_OVERHEAD_ALERTS_KEY)
    if (raw) stored = JSON.parse(raw) as Record<string, OverheadAlertConfig>
  } catch {
    stored = null
  }
  if (stored && typeof stored === 'object') return stored

  try {
    const legacyOverlays = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as {
      overheadAlerts?: boolean
      overheadAlertsCivil?: boolean
      overheadAlertsMil?: boolean
    }
    const civil = legacyOverlays.overheadAlertsCivil ?? legacyOverlays.overheadAlerts ?? false
    const mil = legacyOverlays.overheadAlertsMil ?? legacyOverlays.overheadAlerts ?? false
    return {
      [USER_ALERT_LOCATION_ID]: { civil, mil, radiusNm: readPersistedRadius() },
    }
  } catch {
    return {}
  }
}

const DEFAULT_LABEL_FIELDS: AdsbLabelFields = { civil: ['type'], mil: ['type'] }
const DEFAULT_TAG_FIELDS: AdsbTagFields = {
  civil: {
    callsign: true,
    altitude: false,
    speed: false,
    heading: false,
    aircraftType: false,
    registration: false,
    squawk: false,
    category: false,
  },
  mil: {
    callsign: true,
    altitude: false,
    speed: false,
    heading: false,
    aircraftType: true,
    registration: false,
    squawk: false,
    category: false,
  },
}

const DEFAULTS: OverlayStates = {
  adsb: true,
  adsbLabels: true,
  airports: true,
  militaryBases: true,
  rangeRings: false,
  aara: true,
  awacs: true,
  groundVehicles: true,
  towers: true,
}

function migrateOverlays(parsed: unknown): Partial<OverlayStates> {
  const obj = parsed as Partial<OverlayStates> & {
    overheadAlerts?: boolean
    overheadAlertsCivil?: boolean
    overheadAlertsMil?: boolean
  }
  // Overhead alerts are configured per location now (see `overheadAlerts`), so
  // their old overlay flags are read there and dropped from this object.
  delete obj.overheadAlerts
  delete obj.overheadAlertsCivil
  delete obj.overheadAlertsMil
  return obj
}

function migrateLabelFields(parsed: unknown): Partial<AdsbLabelFields> {
  const obj = parsed as Partial<AdsbLabelFields>
  return {
    civil: Array.isArray(obj.civil) ? obj.civil : DEFAULT_LABEL_FIELDS.civil,
    mil: Array.isArray(obj.mil) ? obj.mil : DEFAULT_LABEL_FIELDS.mil,
  }
}

function isTagFieldMap(v: unknown): v is AdsbTagFieldMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function migrateTagFields(parsed: unknown): Partial<AdsbTagFields> {
  const obj = parsed as Partial<AdsbTagFields>
  return {
    civil: isTagFieldMap(obj.civil)
      ? { ...DEFAULT_TAG_FIELDS.civil, ...obj.civil }
      : { ...DEFAULT_TAG_FIELDS.civil },
    mil: isTagFieldMap(obj.mil)
      ? { ...DEFAULT_TAG_FIELDS.mil, ...obj.mil }
      : { ...DEFAULT_TAG_FIELDS.mil },
  }
}

const LS_REPLAY_ENABLED_KEY = 'airReplayEnabled'

function readPersistedReplayEnabled(): boolean {
  try {
    return localStorage.getItem(LS_REPLAY_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

/** The pre-split app-wide radius. Read only to migrate it onto the operator's
 *  own alert location — nothing else uses it now. */
function readPersistedRadius(): number {
  try {
    const raw = localStorage.getItem(LS_OVERHEAD_RADIUS_KEY)
    if (!raw) return DEFAULT_OVERHEAD_ALERT_RADIUS_NM
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_OVERHEAD_ALERT_RADIUS_NM
  } catch {
    return DEFAULT_OVERHEAD_ALERT_RADIUS_NM
  }
}

export const useAirStore = defineStore('air', () => {
  const overlayStates = usePersistedObject<OverlayStates>(LS_KEY, DEFAULTS, migrateOverlays)
  const adsbLabelFields = usePersistedObject<AdsbLabelFields>(
    LS_LABEL_FIELDS_KEY,
    DEFAULT_LABEL_FIELDS,
    migrateLabelFields,
  )
  const adsbTagFields = usePersistedObject<AdsbTagFields>(
    LS_TAG_FIELDS_KEY,
    DEFAULT_TAG_FIELDS,
    migrateTagFields,
  )
  /** Overhead-alert settings per location — see `OverheadAlertConfig`. */
  const overheadAlerts = ref<Record<string, OverheadAlertConfig>>(readPersistedOverheadAlerts())
  // Replay (flight history recording + REPLAY tab). Opt-in, default OFF.
  // localStorage for instant restore; DB hydrate happens in main.ts at startup.
  const replayEnabled = ref<boolean>(readPersistedReplayEnabled())
  const filterQuery = ref('')
  const filterOpen = ref(false)
  // The active FILTER category (aircraft / airports / military bases), driven by
  // the rail sub-tabs. Single-select — the panel shows only this category's list.
  // Persisted so the choice is restored when returning to Air.
  const airFilterCategory = usePersistedRef<AirFilterCategory>(
    'sentinel_air_filterCategory',
    'aircraft',
    isAirFilterCategory,
  )
  // The aircraft whose detail accordion is open in the search list, persisted so
  // the selection is restored when returning to Air from another section.
  const searchExpandedPlane = usePersistedObject<SearchExpandedPlane>(
    'sentinel_air_filterExpandedPlane',
    { hex: '', snapshot: null },
  )
  // Hex of the aircraft isolated on the map (map-click "show only this one"), or
  // empty when none. Persisted so the isolation is restored when returning to Air
  // — but only when it was actually active, since it is empty otherwise.
  const mapIsolatedHex = usePersistedRef<string>('sentinel_air_mapIsolatedHex', '')
  const mapCenter = ref<[number, number] | null>(null)
  const mapZoom = ref<number | null>(null)
  const pitch = ref(0)

  function setOverlay(key: keyof OverlayStates, visible: boolean) {
    overlayStates.value[key] = visible
  }

  function setAdsbLabelFields(fields: AdsbLabelFields) {
    adsbLabelFields.value = fields
  }

  function setAdsbTagFields(fields: AdsbTagFields) {
    adsbTagFields.value = fields
  }

  function setReplayEnabled(on: boolean) {
    replayEnabled.value = on
    try {
      localStorage.setItem(LS_REPLAY_ENABLED_KEY, on ? '1' : '0')
    } catch {}
  }

  /** The settings for one location, falling back to "off, default radius". */
  function overheadAlertFor(locationId: string): OverheadAlertConfig {
    return overheadAlerts.value[locationId] ?? { ...DEFAULT_OVERHEAD_ALERT }
  }

  function _persistOverheadAlerts(): void {
    try {
      localStorage.setItem(LS_OVERHEAD_ALERTS_KEY, JSON.stringify(overheadAlerts.value))
    } catch {
      /* private-mode storage failure — the in-memory settings still stand */
    }
  }

  /** Change part of one location's alert settings, leaving the rest alone. */
  function setOverheadAlert(locationId: string, patch: Partial<OverheadAlertConfig>): void {
    const next = { ...overheadAlertFor(locationId), ...patch }
    if (!Number.isFinite(next.radiusNm) || next.radiusNm <= 0) return
    overheadAlerts.value = { ...overheadAlerts.value, [locationId]: next }
    _persistOverheadAlerts()
  }

  /**
   * Adopt a whole set of per-location settings, as read back from the config
   * database. Used on mount so the choice follows the operator to another
   * browser, the way `app/location` does.
   */
  function hydrateOverheadAlerts(stored: Record<string, OverheadAlertConfig>): void {
    overheadAlerts.value = { ...stored }
    _persistOverheadAlerts()
  }

  /** Forget a location's settings — for a Sentry that has left the fleet. */
  function forgetOverheadAlert(locationId: string): void {
    if (!(locationId in overheadAlerts.value)) return
    const next = { ...overheadAlerts.value }
    delete next[locationId]
    overheadAlerts.value = next
    _persistOverheadAlerts()
  }

  function setFilter(query: string) {
    filterQuery.value = query
  }

  function setAirFilterCategory(category: AirFilterCategory) {
    airFilterCategory.value = category
  }

  function toggleFilter() {
    filterOpen.value = !filterOpen.value
  }

  function saveMapState(center: [number, number], zoom: number, currentPitch: number) {
    mapCenter.value = center
    mapZoom.value = zoom
    pitch.value = currentPitch
  }

  return {
    overlayStates,
    adsbLabelFields,
    adsbTagFields,
    overheadAlerts,
    overheadAlertFor,
    setOverheadAlert,
    hydrateOverheadAlerts,
    forgetOverheadAlert,
    replayEnabled,
    filterQuery,
    filterOpen,
    airFilterCategory,
    searchExpandedPlane,
    mapIsolatedHex,
    mapCenter,
    mapZoom,
    pitch,
    setOverlay,
    setAdsbLabelFields,
    setAdsbTagFields,
    setReplayEnabled,
    setFilter,
    setAirFilterCategory,
    toggleFilter,
    saveMapState,
  }
})
