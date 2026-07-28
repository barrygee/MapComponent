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
  overheadAlertsCivil: boolean
  overheadAlertsMil: boolean
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

export const DEFAULT_OVERHEAD_ALERT_RADIUS_NM = 10

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
  overheadAlertsCivil: false,
  overheadAlertsMil: false,
}

function migrateOverlays(parsed: unknown): Partial<OverlayStates> {
  const obj = parsed as Partial<OverlayStates> & { overheadAlerts?: boolean }
  if (
    typeof obj.overheadAlerts === 'boolean' &&
    obj.overheadAlertsCivil === undefined &&
    obj.overheadAlertsMil === undefined
  ) {
    obj.overheadAlertsCivil = obj.overheadAlerts
    obj.overheadAlertsMil = obj.overheadAlerts
  }
  delete obj.overheadAlerts
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
  const overheadAlertRadiusNm = ref<number>(readPersistedRadius())
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

  function setOverheadAlertRadiusNm(nm: number) {
    if (!Number.isFinite(nm) || nm <= 0) return
    overheadAlertRadiusNm.value = nm
    try {
      localStorage.setItem(LS_OVERHEAD_RADIUS_KEY, String(nm))
    } catch {}
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
    overheadAlertRadiusNm,
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
    setOverheadAlertRadiusNm,
    setReplayEnabled,
    setFilter,
    setAirFilterCategory,
    toggleFilter,
    saveMapState,
  }
})
