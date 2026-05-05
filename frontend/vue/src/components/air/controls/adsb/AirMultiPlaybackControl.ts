import type { Map as MapLibreGlMap, GeoJSONSource } from 'maplibre-gl'
import type { AdsbLiveControl } from './AdsbLiveControl'
import type { PlaybackAircraft, MultiSnapshot } from '@/stores/playback'

type FeatureCollection = GeoJSON.FeatureCollection
type Feature = GeoJSON.Feature

export class AirMultiPlaybackControl {
  private _map: MapLibreGlMap
  private _adsbControl: AdsbLiveControl

  constructor(map: MapLibreGlMap, adsbControl: AdsbLiveControl) {
    this._map = map
    this._adsbControl = adsbControl
    adsbControl.pauseLive()
  }

  renderAtTime(cursorMs: number, aircraft: Record<string, PlaybackAircraft>): void {
    const features: Feature[]   = []
    const trailDots: Feature[]  = []
    const trailLines: Feature[] = []

    for (const ac of Object.values(aircraft)) {
      if (!ac.snapshots.length) continue
      const idx = Math.max(0, this._bisectLeft(ac.snapshots, cursorMs))

      const snap = ac.snapshots[idx]
      features.push(this._makeAircraftFeature(ac, snap))

      const trailStart = Math.max(0, idx - 60)
      const trail = ac.snapshots.slice(trailStart, idx + 1)
      trail.forEach((s, i) => {
        trailDots.push(this._makeTrailDot(ac.registration, s, i, trail.length))
      })
      if (trail.length > 1) {
        trailLines.push(this._makeTrailLine(trail))
      }
    }

    if (this._map.getLayer('adsb-icons') && this._map.getLayoutProperty('adsb-icons', 'visibility') === 'none')
      this._map.setLayoutProperty('adsb-icons', 'visibility', 'visible')
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    this._setSource('adsb-live',             features.length      ? { type: 'FeatureCollection', features }      : empty)
    this._setSource('adsb-trails-source',    trailDots.length     ? { type: 'FeatureCollection', features: trailDots }  : empty)
    this._setSource('adsb-trail-line-source',trailLines.length    ? { type: 'FeatureCollection', features: trailLines } : empty)
  }

  destroy(): void {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
    this._setSource('adsb-live', empty)
    this._setSource('adsb-trails-source', empty)
    this._setSource('adsb-trail-line-source', empty)
    this._adsbControl.resumeLive()
  }

  private _bisectLeft(snapshots: MultiSnapshot[], ts: number): number {
    let lo = 0, hi = snapshots.length - 1, result = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (snapshots[mid].ts <= ts) { result = mid; lo = mid + 1 }
      else hi = mid - 1
    }
    return result
  }

  private _makeAircraftFeature(ac: PlaybackAircraft, snap: MultiSnapshot): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [snap.lon, snap.lat] },
      properties: {
        hex:          ac.hex || ac.registration,
        flight:       ac.callsign,
        r:            ac.registration,
        t:            ac.type_code,
        alt_baro:     snap.alt_baro   ?? 0,
        alt_geom:     null,
        gs:           snap.gs         ?? 0,
        ias:          null,
        mach:         null,
        track:        snap.track      ?? 0,
        baro_rate:    snap.baro_rate  ?? 0,
        nav_altitude: null,
        nav_heading:  null,
        category:     'A0',
        emergency:    'none',
        squawk:       snap.squawk     ?? '',
        squawkEmerg:  0,
        rssi:         null,
        military:     false,
        stale:        0,
      },
    }
  }

  private _makeTrailDot(reg: string, snap: MultiSnapshot, i: number, total: number): Feature {
    const opacity = 0.2 + 0.8 * (i / Math.max(1, total - 1))
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [snap.lon, snap.lat] },
      properties: {
        alt:      snap.alt_baro ?? 0,
        opacity,
        emerg:    0,
        military: 0,
        hex:      reg,
      },
    }
  }

  private _makeTrailLine(trail: MultiSnapshot[]): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: trail.map(s => [s.lon, s.lat]) },
      properties: { emerg: 0, military: 0 },
    }
  }

  private _setSource(id: string, data: FeatureCollection): void {
    (this._map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
  }
}
