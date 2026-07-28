import { defineStore } from 'pinia'
import { usePersistedObject } from './_persist'

/**
 * Base-map layer toggles that are shared by every domain map (Air, Land,
 * Space). These describe the underlying MapLibre style rather than any one
 * domain's data, so the operator sets them once and every map agrees — turning
 * roads on in Land turns them on in Air too.
 */
export interface BasemapLayerStates {
  /** Road lines, road names and road refs from the base style. */
  roads: boolean
  /** Place-name labels (country/state/city/town/village/suburb + water names). */
  names: boolean
}

const LS_KEY = 'sentinel_basemapLayers'

/** Both off by default — the maps start uncluttered and the operator opts in. */
const DEFAULTS: BasemapLayerStates = {
  roads: false,
  names: false,
}

/** Pre-unification localStorage key holding the Air map's overlay states, which
 *  is where the shared `roads`/`names` flags used to live. */
const LEGACY_AIR_OVERLAYS_KEY = 'overlayStates'

/**
 * Seed the shared flags from the Air map's old per-domain overlay state the
 * first time this store is read, so an existing user's roads/place-names choice
 * survives the move to a shared store. (Space's separate `names` flag is
 * deliberately not consulted — with one shared value there can be only one
 * winner, and Air is the map where both flags existed.)
 */
function seedFromLegacyAirOverlays(): Partial<BasemapLayerStates> {
  try {
    const raw = localStorage.getItem(LEGACY_AIR_OVERLAYS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const legacy = parsed as Partial<BasemapLayerStates>
    const seeded: Partial<BasemapLayerStates> = {}
    if (typeof legacy.roads === 'boolean') seeded.roads = legacy.roads
    if (typeof legacy.names === 'boolean') seeded.names = legacy.names
    return seeded
  } catch {
    return {}
  }
}

/**
 * Cross-domain base-map layer store. Held separately from the per-domain stores
 * (`air`, `space`, `land`) precisely because its state is not domain-specific.
 */
export const useBasemapStore = defineStore('basemap', () => {
  const layers = usePersistedObject<BasemapLayerStates>(LS_KEY, {
    ...DEFAULTS,
    ...seedFromLegacyAirOverlays(),
  })

  /** Set one base-map layer's visibility (persisted for every map). */
  function setLayer(key: keyof BasemapLayerStates, visible: boolean): void {
    layers.value[key] = visible
  }

  return { layers, setLayer }
})

export type BasemapStore = ReturnType<typeof useBasemapStore>
