import { RangeRingsControlBase } from '@/components/shared/controls/range-rings/RangeRingsControlBase'
import type { AirStore } from '../types'
import type { ResolvedRingOrigin } from '@/composables/useRangeRingOrigin'

/**
 * Range rings on the Air map. Everything about the rings themselves lives in
 * `RangeRingsControlBase`; this subclass owns only the two Air-specific facts —
 * the layer id, and that the toggle is stored on the air store (so the side
 * menu's active state and the CLEAR OVERLAYS control can both see it).
 */
export class RangeRingsControl extends RangeRingsControlBase {
  private _airStore: AirStore

  constructor(airStore: AirStore, initialOrigin: ResolvedRingOrigin | null) {
    super(airStore.overlayStates.rangeRings, initialOrigin)
    this._airStore = airStore
  }

  protected get layerId(): string {
    return 'range-rings-lines'
  }

  protected persistVisible(visible: boolean): void {
    this._airStore.setOverlay('rangeRings', visible)
  }
}
