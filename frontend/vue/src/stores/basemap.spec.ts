import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBasemapStore } from './basemap'

const LS_KEY = 'sentinel_basemapLayers'
const LEGACY_AIR_OVERLAYS_KEY = 'overlayStates'

/** Read back what the store persisted. */
function persisted(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(LS_KEY)!) as Record<string, unknown>
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('basemap store defaults', () => {
  it('starts with both shared layers off', () => {
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('restores previously persisted layers', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ roads: true, names: false }))
    setActivePinia(createPinia())
    expect(useBasemapStore().layers).toEqual({ roads: true, names: false })
  })

  it('fills in a missing key from the defaults', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ names: true }))
    setActivePinia(createPinia())
    expect(useBasemapStore().layers).toEqual({ roads: false, names: true })
  })
})

describe('basemap store setLayer', () => {
  it('turns a layer on and persists it', () => {
    const store = useBasemapStore()
    store.setLayer('roads', true)
    expect(store.layers.roads).toBe(true)
    expect(persisted().roads).toBe(true)
  })

  it('turns a layer off and persists it', () => {
    const store = useBasemapStore()
    store.setLayer('names', true)
    store.setLayer('names', false)
    expect(store.layers.names).toBe(false)
    expect(persisted().names).toBe(false)
  })

  it('leaves the other layer untouched', () => {
    const store = useBasemapStore()
    store.setLayer('names', true)
    expect(store.layers.roads).toBe(false)
    expect(persisted()).toEqual({ roads: false, names: true })
  })
})

// The shared flags used to live on the Air map's own overlay state. Seeding
// from that key keeps an existing user's choice when they upgrade.
describe('basemap store legacy Air-overlay seeding', () => {
  function seedLegacy(value: unknown): void {
    localStorage.setItem(LEGACY_AIR_OVERLAYS_KEY, JSON.stringify(value))
    setActivePinia(createPinia())
  }

  it('adopts both flags from the legacy Air overlay state', () => {
    seedLegacy({ adsb: true, roads: true, names: true })
    expect(useBasemapStore().layers).toEqual({ roads: true, names: true })
  })

  it('lets an explicit new-key choice win over the legacy seed', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ roads: true, names: true }))
    seedLegacy({ roads: false, names: false })
    // The new key still wins — seeding only supplies the base the new key
    // merges over, so an explicit later choice is never clobbered.
    expect(useBasemapStore().layers).toEqual({ roads: true, names: true })
  })

  it('adopts only the flags the legacy state actually carried', () => {
    seedLegacy({ names: true })
    expect(useBasemapStore().layers).toEqual({ roads: false, names: true })
  })

  it('ignores legacy values of the wrong type', () => {
    seedLegacy({ roads: 'yes', names: 1 })
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('ignores a legacy key holding an array', () => {
    seedLegacy(['roads'])
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('ignores a legacy key holding null', () => {
    seedLegacy(null)
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('ignores a legacy key holding a non-object', () => {
    seedLegacy(42)
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('ignores malformed legacy JSON', () => {
    localStorage.setItem(LEGACY_AIR_OVERLAYS_KEY, '{not json')
    setActivePinia(createPinia())
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })

  it('falls back to the defaults when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    setActivePinia(createPinia())
    expect(useBasemapStore().layers).toEqual({ roads: false, names: false })
  })
})
