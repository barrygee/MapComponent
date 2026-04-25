import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface OverlayStates {
  adsb: boolean
  adsbLabels: boolean
  airports: boolean
  militaryBases: boolean
  roads: boolean
  names: boolean
  rangeRings: boolean
  aara: boolean
  awacs: boolean
}

export type AdsbLabelField = 'type' | 'alt'

export interface AdsbLabelFields {
  civil: AdsbLabelField[]
  mil: AdsbLabelField[]
}

export type AdsbTagField = 'alt' | 'spd' | 'hdg' | 'typ' | 'reg' | 'sqk' | 'cat'

export interface AdsbTagFields {
  civil: AdsbTagField[]
  mil: AdsbTagField[]
}

const LS_KEY = 'overlayStates'
const LS_LABEL_FIELDS_KEY = 'adsbLabelFields'
const LS_TAG_FIELDS_KEY = 'adsbTagFields_v2'

const ALL_TAG_FIELDS: AdsbTagField[] = ['alt', 'spd', 'hdg', 'typ', 'reg', 'sqk', 'cat']
const DEFAULT_LABEL_FIELDS: AdsbLabelFields = { civil: ['type'], mil: ['type'] }
const DEFAULT_TAG_FIELDS: AdsbTagFields = { civil: [], mil: ['typ'] }

const DEFAULTS: OverlayStates = {
  adsb: true,
  adsbLabels: false,
  airports: true,
  militaryBases: true,
  roads: false,
  names: false,
  rangeRings: false,
  aara: true,
  awacs: true,
}

export const useAirStore = defineStore('air', () => {
  const overlayStates = ref<OverlayStates>(_loadOverlayStates())
  const adsbLabelFields = ref<AdsbLabelFields>(_loadLabelFields())
  const adsbTagFields = ref<AdsbTagFields>(_loadTagFields())
  const filterQuery = ref('')
  const filterOpen = ref(false)
  const mapCenter = ref<[number, number] | null>(null)
  const mapZoom = ref<number | null>(null)
  const pitch = ref(0)

  function setOverlay(key: keyof OverlayStates, visible: boolean) {
    overlayStates.value[key] = visible
    _persist()
  }

  function setAdsbLabelFields(fields: AdsbLabelFields) {
    adsbLabelFields.value = fields
    try { localStorage.setItem(LS_LABEL_FIELDS_KEY, JSON.stringify(fields)) } catch {}
  }

  function setAdsbTagFields(fields: AdsbTagFields) {
    adsbTagFields.value = fields
    try { localStorage.setItem(LS_TAG_FIELDS_KEY, JSON.stringify(fields)) } catch {}
  }

  function setFilter(query: string) {
    filterQuery.value = query
  }

  function toggleFilter() {
    filterOpen.value = !filterOpen.value
  }

  function saveMapState(center: [number, number], zoom: number, currentPitch: number) {
    mapCenter.value = center
    mapZoom.value = zoom
    pitch.value = currentPitch
  }

  function _persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(overlayStates.value)) } catch {}
  }

  return { overlayStates, adsbLabelFields, adsbTagFields, filterQuery, filterOpen, mapCenter, mapZoom, pitch, setOverlay, setAdsbLabelFields, setAdsbTagFields, setFilter, toggleFilter, saveMapState }
})

function _loadOverlayStates(): OverlayStates {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

function _loadLabelFields(): AdsbLabelFields {
  try {
    const raw = localStorage.getItem(LS_LABEL_FIELDS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          civil: Array.isArray(parsed.civil) ? parsed.civil : DEFAULT_LABEL_FIELDS.civil,
          mil:   Array.isArray(parsed.mil)   ? parsed.mil   : DEFAULT_LABEL_FIELDS.mil,
        }
      }
    }
  } catch {}
  return { ...DEFAULT_LABEL_FIELDS }
}

function _loadTagFields(): AdsbTagFields {
  try {
    const raw = localStorage.getItem(LS_TAG_FIELDS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          civil: Array.isArray(parsed.civil) ? parsed.civil : [],
          mil:   Array.isArray(parsed.mil)   ? parsed.mil   : ['typ'],
        }
      }
    }
  } catch {}
  return { ...DEFAULT_TAG_FIELDS }
}
