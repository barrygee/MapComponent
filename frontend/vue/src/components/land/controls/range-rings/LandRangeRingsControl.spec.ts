import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Map as MapLibreGlMap } from 'maplibre-gl'
import { LandRangeRingsControl } from './LandRangeRingsControl'
import type { ResolvedRingOrigin } from '@/composables/useRangeRingOrigin'

const LAYER = 'land-range-rings'
const LS_KEY = 'sentinel_land_rangeRings'

function makeFakeMap(styleLoaded = true) {
  const state = {
    layers: new Set<string>(),
    sources: new Map<string, { data?: unknown; setData: ReturnType<typeof vi.fn> }>(),
    visibility: {} as Record<string, string>,
    textField: {} as Record<string, unknown>,
    styleLoadCb: null as null | (() => void),
  }
  const map = {
    isStyleLoaded: () => styleLoaded,
    once: (event: string, cb: () => void) => {
      if (event === 'style.load') state.styleLoadCb = cb
    },
    getLayer: (id: string) => (state.layers.has(id) ? { id } : undefined),
    removeLayer: (id: string) => state.layers.delete(id),
    getSource: (id: string) => state.sources.get(id),
    removeSource: (id: string) => state.sources.delete(id),
    addSource: (id: string, source: { data: unknown }) =>
      state.sources.set(id, {
        data: source.data,
        setData: vi.fn((data) => (state.sources.get(id)!.data = data)),
      }),
    addLayer: (layer: { id: string; layout?: Record<string, unknown> }) => {
      state.layers.add(layer.id)
      state.visibility[layer.id] = (layer.layout?.visibility as string) ?? 'visible'
    },
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      if (prop === 'visibility') state.visibility[id] = value as string
      if (prop === 'text-field') state.textField[id] = value
    },
    _state: state,
  }
  return map
}

function origin(overrides: Partial<ResolvedRingOrigin> = {}): ResolvedRingOrigin {
  return {
    longitude: -2,
    latitude: 54,
    label: 'MY LOCATION',
    kind: 'user',
    degraded: false,
    ...overrides,
  }
}

/** The Land control's own map type is narrower than the fake; cast at the seam. */
const asMap = (map: ReturnType<typeof makeFakeMap>) => map as unknown as MapLibreGlMap

describe('LandRangeRingsControl', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  describe('its own layer id', () => {
    it('builds under the land-specific id, not the Air map’s', () => {
      const map = makeFakeMap()
      new LandRangeRingsControl(origin()).onAdd(asMap(map))
      expect([...map._state.layers]).toEqual([
        LAYER,
        `${LAYER}-origin`,
        `${LAYER}-origin-dot`,
        `${LAYER}-label`,
      ])
    })
  })

  describe('persisting the toggle', () => {
    it('starts hidden with nothing stored', () => {
      const control = new LandRangeRingsControl(origin())
      expect(control.visible).toBe(false)
      const map = makeFakeMap()
      control.onAdd(asMap(map))
      expect(map._state.visibility[LAYER]).toBe('none')
    })

    it('restores a stored "on" toggle', () => {
      localStorage.setItem(LS_KEY, '1')
      const control = new LandRangeRingsControl(origin())
      expect(control.visible).toBe(true)
      const map = makeFakeMap()
      control.onAdd(asMap(map))
      expect(map._state.visibility[LAYER]).toBe('visible')
    })

    it('writes the toggle to localStorage, Land having no overlay store', () => {
      const control = new LandRangeRingsControl(origin())
      control.onAdd(asMap(makeFakeMap()))

      control.handleClickPublic()
      expect(localStorage.getItem(LS_KEY)).toBe('1')

      control.handleClickPublic()
      expect(localStorage.getItem(LS_KEY)).toBe('0')
    })

    it('falls back to hidden when storage cannot be read', () => {
      // Seeded "on" first, so this fails if the throwing read is not actually
      // reached: without the catch the constructor would blow up, and without
      // the spy it would read '1' and start visible.
      localStorage.setItem(LS_KEY, '1')
      const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('private mode')
      })

      expect(new LandRangeRingsControl(origin()).visible).toBe(false)

      getItem.mockRestore()
    })

    it('keeps the in-memory toggle when storage cannot be written', () => {
      const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('private mode')
      })
      const control = new LandRangeRingsControl(origin())
      control.onAdd(asMap(makeFakeMap()))

      control.handleClickPublic()

      expect(control.visible).toBe(true)
      setItem.mockRestore()
    })
  })

  describe('following the ring origin', () => {
    it('re-centres on a new origin', () => {
      localStorage.setItem(LS_KEY, '1')
      const control = new LandRangeRingsControl(origin())
      const map = makeFakeMap()
      control.onAdd(asMap(map))

      control.setOrigin(origin({ latitude: 49, longitude: 2, kind: 'sentry' }))

      expect(map._state.sources.get(LAYER)!.setData).toHaveBeenCalledOnce()
      expect(map._state.visibility[`${LAYER}-origin`]).toBe('visible')
    })

    it('hides the rings when the origin goes away', () => {
      localStorage.setItem(LS_KEY, '1')
      const control = new LandRangeRingsControl(origin())
      const map = makeFakeMap()
      control.onAdd(asMap(map))

      control.setOrigin(null)

      expect(map._state.visibility[LAYER]).toBe('none')
    })

    it('names a Sentry origin on the outer ring', () => {
      localStorage.setItem(LS_KEY, '1')
      const control = new LandRangeRingsControl(origin())
      const map = makeFakeMap()
      control.onAdd(asMap(map))

      control.setOrigin(origin({ kind: 'sentry', label: 'GATESHEAD' }))

      expect(map._state.textField[`${LAYER}-label`]).toBe('GATESHEAD · 250 NM')
    })

    it('defers the build until the style loads', () => {
      const control = new LandRangeRingsControl(origin())
      const map = makeFakeMap(false)
      control.onAdd(asMap(map))
      expect(map._state.sources.size).toBe(0)

      map._state.styleLoadCb!()

      expect(map._state.sources.has(LAYER)).toBe(true)
    })

    it('is a no-op when re-centred or toggled before the layer exists', () => {
      const control = new LandRangeRingsControl(origin())
      const map = makeFakeMap(false)
      control.onAdd(asMap(map))

      expect(() => control.setOrigin(origin({ latitude: 1 }))).not.toThrow()
      expect(() => control.handleClickPublic()).not.toThrow()
      expect(map._state.sources.has(LAYER)).toBe(false)
    })
  })
})
