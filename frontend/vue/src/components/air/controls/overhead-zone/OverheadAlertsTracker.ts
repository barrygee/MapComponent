import type { useNotificationsStore } from '../../../../stores/notifications'
import { haversineNm } from '../../../../utils/distanceUtils'

type NotificationsStore = ReturnType<typeof useNotificationsStore>

interface AircraftFeature {
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    hex: string
    flight?: string
    r?: string
    alt_baro?: number
    gs?: number
    military?: boolean
  }
}

interface FeatureCollection {
  features: AircraftFeature[]
}

/**
 * One place aircraft can be overhead *of*, with the settings that decide what
 * counts as overhead there. The operator's own position is one of these; so is
 * every Sentry, each watching its own patch of sky at its own radius.
 */
export interface OverheadAlertZone {
  /** Alert-location id — `user`, or `sentry:<hostId>`. */
  id: string
  /** What to call the place in the notification, e.g. `GATESHEAD`. */
  label: string
  lon: number
  lat: number
  civil: boolean
  mil: boolean
  radiusNm: number
}

const POLL_MS = 2000

export class OverheadAlertsTracker {
  private _notifications: NotificationsStore
  private _getFeatures: () => FeatureCollection | null
  private _onAlertClick: ((hex: string) => void) | null
  /** Keyed `zoneId|hex`: one aircraft can be overhead of two sites at once, and
   *  each site's operator is entitled to its own alert. */
  private _tracked = new Map<string, { id: string; military: boolean; zoneId: string }>()
  private _timer: ReturnType<typeof setInterval> | null = null
  private _zones: OverheadAlertZone[] = []

  constructor(
    notifications: NotificationsStore,
    getFeatures: () => FeatureCollection | null,
    onAlertClick: ((hex: string) => void) | null = null,
  ) {
    this._notifications = notifications
    this._getFeatures = getFeatures
    this._onAlertClick = onAlertClick
  }

  /** Replace the set of watched places. Alerts for a place that has gone, or
   *  for a class it no longer watches, are dismissed. */
  setZones(zones: OverheadAlertZone[]): void {
    this._zones = zones.filter((zone) => zone.civil || zone.mil)

    for (const [key, entry] of this._tracked) {
      const zone = this._zones.find((candidate) => candidate.id === entry.zoneId)
      const stillAllowed = zone ? (entry.military ? zone.mil : zone.civil) : false
      if (!stillAllowed) {
        this._notifications.dismiss(entry.id)
        this._tracked.delete(key)
      }
    }

    if (this._zones.length > 0) {
      if (!this._timer) {
        this._tick()
        this._timer = setInterval(() => this._tick(), POLL_MS)
      }
      return
    }
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this._dismissAllOverhead()
  }

  destroy(): void {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this._tracked.clear()
    this._zones = []
  }

  private _tick(): void {
    const fc = this._getFeatures()
    if (!fc) return

    const seen = new Set<string>()
    for (const zone of this._zones) {
      for (const feature of fc.features) {
        const coords = feature.geometry?.coordinates
        const hex = feature.properties?.hex
        if (!coords || !hex) continue
        const [lon, lat] = coords
        if (typeof lon !== 'number' || typeof lat !== 'number') continue
        const alt = feature.properties?.alt_baro ?? 0
        if (alt <= 0) continue
        const isMil = feature.properties?.military === true
        if (isMil ? !zone.mil : !zone.civil) continue
        const dist = haversineNm(zone.lat, zone.lon, lat, lon)
        if (dist > zone.radiusNm) continue

        const key = `${zone.id}|${hex}`
        seen.add(key)
        const gs = feature.properties?.gs
        // The place leads the detail: with several receivers watching, "which
        // sky is this overhead of?" is the first thing to answer.
        const parts: string[] = [
          zone.label,
          `${dist.toFixed(1)} nm`,
          `${Math.round(alt).toLocaleString()} ft`,
        ]
        if (typeof gs === 'number' && gs > 0) parts.push(`${Math.round(gs)} kt`)
        const detail = parts.join(' · ')
        const existing = this._tracked.get(key)
        const title =
          (feature.properties.flight || '').trim() || (feature.properties.r || '').trim() || hex
        if (existing) {
          this._notifications.update({ id: existing.id, detail })
          continue
        }
        const cb = this._onAlertClick
        const id = this._notifications.add({
          type: 'overhead',
          title,
          detail,
          hex,
          clickAction: cb ? () => cb(hex) : undefined,
        })
        this._tracked.set(key, { id, military: isMil, zoneId: zone.id })
      }
    }

    for (const [key, entry] of this._tracked) {
      if (!seen.has(key)) {
        this._notifications.dismiss(entry.id)
        this._tracked.delete(key)
      }
    }
  }

  private _dismissAllOverhead(): void {
    const ids = this._notifications.items.filter((i) => i.type === 'overhead').map((i) => i.id)
    for (const id of ids) this._notifications.dismiss(id)
    this._tracked.clear()
  }
}
