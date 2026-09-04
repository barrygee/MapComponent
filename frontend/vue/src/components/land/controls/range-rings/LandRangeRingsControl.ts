import { RangeRingsControlBase } from '@/components/shared/controls/range-rings/RangeRingsControlBase'
import type { ResolvedRingOrigin } from '@/composables/useRangeRingOrigin'

const LS_KEY = 'sentinel_land_rangeRings'

/**
 * Range rings on the Land map. Everything about the rings themselves lives in
 * `RangeRingsControlBase`; this subclass owns only the two Land-specific facts —
 * the layer id, and that the toggle persists to localStorage rather than a
 * store, Land having no overlay state of its own to hang it on.
 */
export class LandRangeRingsControl extends RangeRingsControlBase {
  constructor(initialOrigin: ResolvedRingOrigin | null) {
    super(LandRangeRingsControl._readPersisted(), initialOrigin)
  }

  /** Current toggle state (rings shown when this is on and an origin resolves). */
  get visible(): boolean {
    return this.ringsVisible
  }

  private static _readPersisted(): boolean {
    try {
      return localStorage.getItem(LS_KEY) === '1'
    } catch {
      return false
    }
  }

  protected get layerId(): string {
    return 'land-range-rings'
  }

  protected persistVisible(visible: boolean): void {
    try {
      localStorage.setItem(LS_KEY, visible ? '1' : '0')
    } catch {
      /* private-mode storage failure — keep the in-memory toggle */
    }
  }
}
