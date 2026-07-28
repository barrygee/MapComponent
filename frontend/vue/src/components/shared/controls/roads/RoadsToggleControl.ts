import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import type { BasemapStore } from '@/stores/basemap'

/** Base-style layers carrying road geometry, names and shields. */
const ROAD_LAYERS = [
  'highway_path',
  'highway_minor',
  'highway_major_casing',
  'highway_major_inner',
  'highway_major_subtle',
  'highway_motorway_casing',
  'highway_motorway_inner',
  'highway_motorway_subtle',
  'highway_name_motorway',
  'highway_name_other',
  'highway_ref',
  'tunnel_motorway_casing',
  'tunnel_motorway_inner',
  'road_area_pier',
  'road_pier',
]

/**
 * Toggles the base map's road lines and labels. Shared by every domain map —
 * the visibility it reads and writes lives on the cross-domain basemap store,
 * so the choice follows the operator from one map to the next.
 */
export class RoadsToggleControl extends SentinelControlBase {
  roadsVisible: boolean
  private _basemapStore: BasemapStore

  constructor(basemapStore: BasemapStore) {
    super()
    this._basemapStore = basemapStore
    this.roadsVisible = basemapStore.layers.roads
  }

  get buttonLabel(): string {
    return 'R'
  }
  get buttonTitle(): string {
    return 'Toggle road lines and names'
  }

  protected onInit(): void {
    if (this.map.isStyleLoaded()) {
      this.applyVisibility()
    } else {
      this.map.once('style.load', () => this.applyVisibility())
    }
  }

  protected handleClick(): void {
    this.roadsVisible = !this.roadsVisible
    this.applyVisibility()
    this._basemapStore.setLayer('roads', this.roadsVisible)
  }

  /** Push the current visibility onto the style. Public because a map that
   *  swaps its style (online↔offline) must re-apply it after the reload. */
  applyVisibility(): void {
    const visibility = this.roadsVisible ? 'visible' : 'none'
    ROAD_LAYERS.forEach((id) => {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility)
    })
    this.setButtonActive(this.roadsVisible)
  }
}
