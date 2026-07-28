import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import type { BasemapStore } from '@/stores/basemap'

/** Base-style layers carrying place-name labels. */
const NAME_LAYERS = [
  'place_suburb',
  'place_village',
  'place_town',
  'place_city',
  'place_state',
  'place_country',
  'place_country_other',
  'water_name',
]

/**
 * Toggles the base map's place-name labels. Shared by every domain map — the
 * visibility it reads and writes lives on the cross-domain basemap store, so
 * the choice follows the operator from Air to Land to Space.
 */
export class NamesToggleControl extends SentinelControlBase {
  namesVisible: boolean
  private _basemapStore: BasemapStore

  constructor(basemapStore: BasemapStore) {
    super()
    this._basemapStore = basemapStore
    this.namesVisible = basemapStore.layers.names
  }

  get buttonLabel(): string {
    return 'N'
  }
  get buttonTitle(): string {
    return 'Toggle city names'
  }

  protected onInit(): void {
    this.setButtonActive(this.namesVisible)
    if (this.map.isStyleLoaded()) {
      this.applyVisibility()
    } else {
      this.map.once('style.load', () => this.applyVisibility())
    }
  }

  protected handleClick(): void {
    this.namesVisible = !this.namesVisible
    this.applyVisibility()
    this._basemapStore.setLayer('names', this.namesVisible)
  }

  /** Push the current visibility onto the style. Public because a map that
   *  swaps its style (online↔offline) must re-apply it after the reload. */
  applyVisibility(): void {
    const visibility = this.namesVisible ? 'visible' : 'none'
    NAME_LAYERS.forEach((id) => {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility)
    })
    this.setButtonActive(this.namesVisible)
  }
}
