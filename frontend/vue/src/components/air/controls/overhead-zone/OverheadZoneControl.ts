import maplibregl from 'maplibre-gl'
import { buildCirclePolygon } from '../../../../utils/distanceUtils'

const SOURCE_ID = 'overhead-zone'
const FILL_ID = 'overhead-zone-fill'
const LINE_ID = 'overhead-zone-line'

export const OVERHEAD_ZONE_RADIUS_NM = 10

/** One drawn zone: a circle of `radiusNm` around a watched place. */
export interface OverheadZone {
  lon: number
  lat: number
  radiusNm: number
}

/**
 * The shaded circles marking what counts as "overhead" — one per watched place.
 *
 * Every alert location draws its own, because each Sentry watches its own patch
 * of sky at its own radius; a single ring around the operator would say nothing
 * about where the other alerts are coming from.
 */
export class OverheadZoneControl {
  private _map: maplibregl.Map | null = null
  private _zones: OverheadZone[] = []

  constructor(initialZones: OverheadZone[] = []) {
    this._zones = initialZones
  }

  onAdd(map: maplibregl.Map): void {
    this._map = map
    if (map.isStyleLoaded()) this._init()
    else map.once('style.load', () => this._init())
  }

  onRemove(): void {
    const m = this._map
    if (!m) return
    if (m.getLayer(LINE_ID)) m.removeLayer(LINE_ID)
    if (m.getLayer(FILL_ID)) m.removeLayer(FILL_ID)
    if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID)
    this._map = null
  }

  /** Replace the drawn zones. With none, the layers are simply empty and hidden. */
  setZones(zones: OverheadZone[]): void {
    this._zones = zones
    const m = this._map
    if (!m) return
    const src = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) {
      this._init()
      return
    }
    src.setData(this._buildZones())
    this._applyVisibility(m)
  }

  /** Rebuild after a style swap, which drops the layers with it. */
  reinit(): void {
    if (this._map) this._init()
  }

  private _buildZones(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this._zones.map(
        (zone) => buildCirclePolygon(zone.lon, zone.lat, zone.radiusNm) as GeoJSON.Feature,
      ),
    }
  }

  /** Single source of truth for layer visibility: something to draw, or nothing.
   *  Takes the map from its caller, which has already established there is one. */
  private _applyVisibility(m: maplibregl.Map): void {
    const vis = this._zones.length > 0 ? 'visible' : 'none'
    if (m.getLayer(FILL_ID)) m.setLayoutProperty(FILL_ID, 'visibility', vis)
    if (m.getLayer(LINE_ID)) m.setLayoutProperty(LINE_ID, 'visibility', vis)
  }

  private _init(): void {
    const m = this._map
    if (!m) return

    if (m.getLayer(LINE_ID)) m.removeLayer(LINE_ID)
    if (m.getLayer(FILL_ID)) m.removeLayer(FILL_ID)
    if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID)

    m.addSource(SOURCE_ID, { type: 'geojson', data: this._buildZones() })

    m.addLayer({
      id: FILL_ID,
      type: 'fill',
      source: SOURCE_ID,
      layout: { visibility: 'none' },
      paint: { 'fill-color': 'rgba(0, 0, 0, 0.12)' },
    })
    m.addLayer({
      id: LINE_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { visibility: 'none' },
      paint: { 'line-color': 'rgba(0, 0, 0, 0.35)', 'line-width': 0.6 },
    })
    this._applyVisibility(m)
  }
}
