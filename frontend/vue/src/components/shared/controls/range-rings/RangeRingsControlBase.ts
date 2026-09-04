import maplibregl from 'maplibre-gl'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { buildRingsGeoJSON, RING_DISTANCES_NM } from '@/utils/rangeRings'
import type { ResolvedRingOrigin } from '@/composables/useRangeRingOrigin'

/**
 * The shared behaviour of every domain's range-rings control: concentric
 * distance rings drawn around the **ring origin** (see `useRangeRingOrigin`),
 * plus the map furniture that says *which* point they are centred on.
 *
 * Extracted from the byte-for-byte twins the Air and Land controls had become —
 * both built the same source, the same dashed line layer and the same
 * "hide unless there is a centre" rule, and both would otherwise have grown the
 * same origin crosshair and label. Subclasses supply only what genuinely
 * differs: the layer id prefix, and where the on/off toggle is persisted.
 *
 * Rings are only ever shown when the operator's toggle is on **and** an origin
 * resolves. Toggling on without one does nothing: rings pinned to the map
 * centre would be a measurement of nothing.
 */
export abstract class RangeRingsControlBase extends SentinelControlBase {
  /** Stroke of the rings themselves, and of the origin crosshair. */
  private static readonly STROKE = 'rgba(255,255,255,0.40)'

  /** Whether the operator has the rings switched on for this map. */
  ringsVisible: boolean

  /** Where the rings are centred, or null when nothing can be drawn. */
  protected origin: ResolvedRingOrigin | null = null

  /**
   * The base id for this map's ring layers — also the source id, so the
   * existing per-domain ids (`range-rings-lines`, `land-range-rings`) survive
   * this extraction unchanged.
   */
  protected abstract get layerId(): string

  /** Record the toggle wherever this domain keeps it (a store, localStorage). */
  protected abstract persistVisible(visible: boolean): void

  constructor(initiallyVisible: boolean, initialOrigin: ResolvedRingOrigin | null) {
    super()
    this.ringsVisible = initiallyVisible
    this.origin = initialOrigin
  }

  private get originLayerId(): string {
    return `${this.layerId}-origin`
  }
  private get originDotLayerId(): string {
    return `${this.layerId}-origin-dot`
  }
  private get labelLayerId(): string {
    return `${this.layerId}-label`
  }

  get buttonLabel(): string {
    return '◎'
  }
  get buttonTitle(): string {
    return 'Toggle range rings'
  }

  protected onInit(): void {
    this.setButtonActive(this.ringsVisible)
    if (this.map.isStyleLoaded()) this._initRings()
    else this.map.once('style.load', () => this._initRings())
  }

  protected handleClick(): void {
    this.ringsVisible = !this.ringsVisible
    this.setButtonActive(this.ringsVisible)
    this.persistVisible(this.ringsVisible)
    // Honour the toggle, but rings still only show if an origin resolves.
    this._applyVisibility()
  }

  /**
   * Re-centre (or clear) the rings.
   *
   * The one entry point for everything about where the rings are: the geometry,
   * the crosshair marking a centre that is not the ⊙ marker, the ring label,
   * and whether any of it is shown at all.
   */
  setOrigin(origin: ResolvedRingOrigin | null): void {
    // The origin is recomputed on every Sentry poll, so most calls carry the
    // same point as the last: rebuilding 5 × 65-point rings every 15 seconds
    // for no visible change is work the map does not need.
    if (this._sameOrigin(origin)) return
    this.origin = origin
    if (!this.map) return
    const ringsSource = this.map.getSource(this.layerId) as maplibregl.GeoJSONSource | undefined
    if (ringsSource) ringsSource.setData(this._buildRings())
    const originSource = this.map.getSource(this.originLayerId) as
      | maplibregl.GeoJSONSource
      | undefined
    if (originSource) originSource.setData(this._buildOriginPoint())
    this._applyLabel()
    this._applyVisibility()
  }

  /** Build the source data + layers for this map's style. Re-run on style reload. */
  _initRings(): void {
    for (const id of [this.labelLayerId, this.originDotLayerId, this.originLayerId, this.layerId]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    }
    for (const id of [this.originLayerId, this.layerId]) {
      if (this.map.getSource(id)) this.map.removeSource(id)
    }

    this.map.addSource(this.layerId, { type: 'geojson', data: this._buildRings() })
    this.map.addLayer({
      id: this.layerId,
      type: 'line',
      source: this.layerId,
      layout: { visibility: 'none' },
      paint: {
        'line-color': RangeRingsControlBase.STROKE,
        'line-width': 1,
        'line-dasharray': [4, 4],
      },
    })

    this.map.addSource(this.originLayerId, { type: 'geojson', data: this._buildOriginPoint() })
    // A centre that is not your own ⊙ needs a mark of its own, or the rings
    // read as floating: the crosshair is what gives them a middle.
    this.map.addLayer({
      id: this.originLayerId,
      type: 'circle',
      source: this.originLayerId,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 5,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': RangeRingsControlBase.STROKE,
        'circle-stroke-width': 1.2,
      },
    })
    this.map.addLayer({
      id: this.originDotLayerId,
      type: 'circle',
      source: this.originLayerId,
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 1.6, 'circle-color': RangeRingsControlBase.STROKE },
    })

    // One label per ring would repeat the same fact five times, so only the
    // outermost ring carries it. `symbol-spacing` is screen distance between
    // placements along that ring, and it has to stay well under the ring's
    // on-screen circumference or the single placement lands off-view and the
    // label is invisible — which is exactly what a large spacing did here.
    this.map.addLayer({
      id: this.labelLayerId,
      type: 'symbol',
      source: this.layerId,
      filter: ['==', ['get', 'dist'], RING_DISTANCES_NM[RING_DISTANCES_NM.length - 1]],
      layout: {
        visibility: 'none',
        'symbol-placement': 'line',
        'text-font': ['Noto Sans Regular'],
        'text-field': '',
        'text-size': 10,
        'text-letter-spacing': 0.16,
        'text-max-angle': 45,
        'symbol-spacing': 500,
        'text-offset': [0, -0.9],
      },
      paint: {
        'text-color': 'rgba(255,255,255,0.65)',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    })

    this._applyLabel()
    this._applyVisibility()
  }

  private _sameOrigin(next: ResolvedRingOrigin | null): boolean {
    const current = this.origin
    if (current === null || next === null) return current === next
    return (
      current.longitude === next.longitude &&
      current.latitude === next.latitude &&
      current.label === next.label &&
      current.kind === next.kind &&
      current.degraded === next.degraded
    )
  }

  private _buildRings(): GeoJSON.FeatureCollection {
    if (!this.origin) return { type: 'FeatureCollection', features: [] }
    return buildRingsGeoJSON(this.origin.longitude, this.origin.latitude)
  }

  private _buildOriginPoint(): GeoJSON.FeatureCollection {
    if (!this.origin) return { type: 'FeatureCollection', features: [] }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [this.origin.longitude, this.origin.latitude] },
          properties: {},
        },
      ],
    }
  }

  /** Name the origin along the outer ring, flagging a position that has gone stale. */
  private _applyLabel(): void {
    if (!this.map?.getLayer(this.labelLayerId)) return
    const origin = this.origin
    const text = origin
      ? `${origin.label}${origin.degraded ? ' · OFFLINE' : ''} · ${
          RING_DISTANCES_NM[RING_DISTANCES_NM.length - 1]
        } NM`
      : ''
    this.map.setLayoutProperty(this.labelLayerId, 'text-field', text)
  }

  /** Single source of truth for what is shown. */
  private _applyVisibility(): void {
    if (!this.map?.getLayer(this.layerId)) return
    const ringsOn = this.ringsVisible && this.origin !== null
    this.map.setLayoutProperty(this.layerId, 'visibility', ringsOn ? 'visible' : 'none')
    // The ⊙ marker already marks your own position, so the crosshair and the
    // label are for the cases where the centre is somewhere else — showing them
    // on top of ⊙ would be noise, and its own name written twice.
    const originMarksOn = ringsOn && this.origin?.kind !== 'user'
    for (const id of [this.originLayerId, this.originDotLayerId, this.labelLayerId]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', originMarksOn ? 'visible' : 'none')
      }
    }
  }
}
