import maplibregl from 'maplibre-gl'
import { watch, type WatchStopHandle } from 'vue'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { aprsSymbolIcon, aprsSymbolSvg } from '@/utils/aprsSymbols'
import { APRS_ACCENT_COLOR, APRS_BADGE_BACKGROUND } from '@/constants/aprs'
import {
  appendMirrored,
  createAccentBadge,
  createDimBadge,
  createDirectionArrowShape,
  createGlyphSvg,
  createGlyphWell,
  createLabelPill,
  createNameSegment,
  isLeftFacing,
  MAP_LABEL_GLYPH_SIZE_PX,
  MAP_LABEL_SIZE_PX,
} from '@/components/shared/map-label/mapLabelParts'
import type { AprsStation, useLandStore } from '@/stores/land'

type LandStore = ReturnType<typeof useLandStore>

/**
 * Land-map control that plots APRS stations heard by the SDR APRS decoder.
 *
 * Renders each station as a simple marker + callsign label (real APRS symbol
 * glyphs are a later enhancement) with a click popup, and keeps them in sync
 * with the polled station snapshot in the Land store. Because the map canvas is
 * opaque to assistive tech, it also maintains a visually-hidden data table of
 * the stations as the accessible equivalent (per accessibility-standards).
 *
 * This is the first real Land control; it follows the same SentinelControlBase
 * pattern as the air/space controls.
 */
export class AprsStationsControl extends SentinelControlBase {
  private readonly _landStore: LandStore
  private _markers = new Map<string, maplibregl.Marker>()
  private _markerSignatures = new Map<string, string>()
  private _markerPositions = new Map<string, [number, number]>()
  private _siteMarkers = new Map<string, maplibregl.Marker>()
  private _popup: maplibregl.Popup | null = null
  private _stopWatch: WatchStopHandle | null = null
  private _a11yRegion: HTMLDivElement | null = null

  constructor(landStore: LandStore) {
    super()
    this._landStore = landStore
  }

  get buttonLabel(): string {
    // A small broadcast/beacon glyph (waves rising from a point).
    return (
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="8" cy="11" r="1.6" fill="currentColor" stroke="none" />' +
      '<path d="M5.2 8.2a4 4 0 0 1 5.6 0" /><path d="M3.4 6.4a6.6 6.6 0 0 1 9.2 0" /></svg>'
    )
  }

  get buttonTitle(): string {
    return 'Toggle APRS stations'
  }

  /** Whether the APRS layer is shown. Lives on the store so the side panel can
   *  list exactly what the map plots. */
  private get _visible(): boolean {
    return this._landStore.aprsLayerVisible
  }

  protected onInit(): void {
    this.setButtonActive(this._visible)
    this._ensureA11yRegion()
    // Poll the station snapshot while this control is on the map, and re-render
    // markers + the a11y table whenever the list changes.
    this._landStore.startAprsPolling()
    // Re-render on either input: a new station snapshot, or the operator
    // switching label fields on/off in Settings. Watching the store directly is
    // enough — unlike the Air domain, no DOM CustomEvent bridge is needed.
    this._stopWatch = watch(
      () =>
        [
          this._landStore.aprsStations,
          this._landStore.aprsLabelFields,
          this._landStore.aprsLayerVisible,
        ] as const,
      () => this._render(this._landStore.aprsStations),
      { immediate: true, deep: true },
    )
  }

  protected handleClick(): void {
    this._landStore.setAprsLayerVisible(!this._visible)
    this.setButtonActive(this._visible)
    this._render(this._landStore.aprsStations)
  }

  /** Set visibility to a specific value (e.g. from the map's default-layers
   *  config), a no-op if already in that state. */
  setVisible(visible: boolean): void {
    if (this._visible === visible) return
    this._landStore.setAprsLayerVisible(visible)
    this.setButtonActive(this._visible)
    this._render(this._landStore.aprsStations)
  }

  onRemove(): void {
    this._stopWatch?.()
    this._stopWatch = null
    this._landStore.stopAprsPolling()
    this._clearMarkers()
    this._popup?.remove()
    this._popup = null
    this._a11yRegion?.remove()
    this._a11yRegion = null
    super.onRemove()
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private _render(stations: AprsStation[]): void {
    this._syncMarkers(this._visible ? stations : [])
    this._renderA11yTable(stations)
  }

  /** Add/update/remove markers so the on-map set matches `stations` by callsign. */
  private _syncMarkers(stations: AprsStation[]): void {
    const seen = new Set<string>()
    const seenSites = new Set<string>()
    for (const site of groupStationsBySite(stations)) {
      // A lone station sits on its own position and needs no tether. A shared
      // one gets a dot marking the real position, with every label displaced
      // below it and joined back by a leader line.
      const isShared = site.stations.length > 1
      if (isShared) {
        seenSites.add(site.key)
        this._syncSiteDot(site)
      }
      site.stations.forEach((station, stackIndex) => {
        seen.add(station.callsign)
        const coords: [number, number] = [station.longitude, station.latitude]
        // Displaced stacks start one step down so the site dot stays clear.
        const leaderLength = isShared ? (stackIndex + 1) * STACKED_LABEL_OFFSET_PX : 0
        const signature = this._markerSignature(station, leaderLength)
        const existing = this._markers.get(station.callsign)
        // Label content unchanged → keep the existing marker. A station only
        // ever moves when its beacon actually reports a new fix: re-plotting on
        // an unchanged position would make a stationary marker twitch as the
        // poll repeats the same snapshot.
        if (existing && this._markerSignatures.get(station.callsign) === signature) {
          if (this._hasMoved(station.callsign, coords)) {
            existing.setLngLat(coords)
            this._markerPositions.set(station.callsign, coords)
          }
          return
        }
        // Anything else (a new field value, a course change that flips the
        // pill's direction, or a change in how many stations share the site)
        // needs the marker rebuilding, since MapLibre fixes the element, anchor
        // and offset at construction.
        existing?.remove()
        const leftFacing = this._isLeftFacing(station)
        const marker = new maplibregl.Marker({
          element: this._buildMarkerElement(station, leaderLength),
          // Keep the leading edge over the station's position: a left-facing
          // pill extends leftward, so it anchors by its right edge.
          anchor: leftFacing ? 'right' : 'left',
          // Displaced sideways as well as down, so the tether has room to curve
          // and the labels never sit over the dot's own column.
          offset: [
            leaderLength === 0
              ? 0
              : leftFacing
                ? -LEADER_HORIZONTAL_OFFSET_PX
                : LEADER_HORIZONTAL_OFFSET_PX,
            leaderLength,
          ],
        })
          .setLngLat(coords)
          .addTo(this.map)
        this._markers.set(station.callsign, marker)
        this._markerSignatures.set(station.callsign, signature)
        this._markerPositions.set(station.callsign, coords)
      })
    }
    // Drop markers for stations no longer present (expired or hidden).
    for (const [callsign, marker] of this._markers) {
      if (!seen.has(callsign)) {
        marker.remove()
        this._markers.delete(callsign)
        this._markerSignatures.delete(callsign)
        this._markerPositions.delete(callsign)
      }
    }
    // …and dots for sites that no longer hold more than one station.
    for (const [key, marker] of this._siteMarkers) {
      if (!seenSites.has(key)) {
        marker.remove()
        this._siteMarkers.delete(key)
      }
    }
  }

  /** Place (or move) the dot marking a shared site's real position. */
  private _syncSiteDot(site: StationSite): void {
    const coords: [number, number] = [site.longitude, site.latitude]
    const existing = this._siteMarkers.get(site.key)
    if (existing) {
      existing.setLngLat(coords)
      return
    }
    const marker = new maplibregl.Marker({ element: buildSiteDot(), anchor: 'center' })
      .setLngLat(coords)
      .addTo(this.map)
    this._siteMarkers.set(site.key, marker)
  }

  /** Whether this snapshot carries a genuinely new fix for the station, rather
   *  than a repeat of the position already plotted. */
  private _hasMoved(callsign: string, coords: [number, number]): boolean {
    const plotted = this._markerPositions.get(callsign)
    /* v8 ignore start -- defensive: a marker always has a recorded position */
    if (!plotted) return true
    /* v8 ignore stop */
    return plotted[0] !== coords[0] || plotted[1] !== coords[1]
  }

  /** Whether a station is travelling leftward across the screen. Stations with
   *  no reported course (digipeaters, weather nodes) always read right-facing. */
  private _isLeftFacing(station: AprsStation): boolean {
    return typeof station.course === 'number' && isLeftFacing(station.course)
  }

  /**
   * Everything about a station that affects its rendered pill, as one string —
   * cheap change detection so unchanged markers are never rebuilt.
   *
   * Values only count when the field that shows them is switched on, which
   * matters most for position: a station beaconing a new fix every few seconds
   * would otherwise rebuild its marker on every poll instead of taking the far
   * cheaper `setLngLat` path. Facing is always included because it decides the
   * marker's anchor, not just its content.
   */
  private _markerSignature(station: AprsStation, leaderLength: number): string {
    const fields = this._landStore.aprsLabelFields
    const shown = (enabled: boolean, value: unknown) => (enabled ? value : null)
    return JSON.stringify([
      this._isLeftFacing(station),
      // The offset and leader line are fixed when the marker is constructed, so
      // a change in how many stations share this site has to rebuild it.
      leaderLength,
      fields,
      shown(fields.callsign, station.callsign),
      shown(fields.symbolText, station.symbol),
      shown(fields.time, station.last_heard_ms),
      shown(fields.course, station.course),
      shown(fields.speed, station.speed),
      shown(fields.altitude, station.altitude),
      shown(fields.latitude, station.latitude),
      shown(fields.longitude, station.longitude),
      shown(fields.path, station.path),
      shown(fields.comment, station.comment),
      // With the icon shown and no course reported, the well draws the symbol
      // glyph — so a symbol change must redraw it even when the text chip is off.
      fields.symbol && station.course === null ? station.symbol : null,
    ])
  }

  /**
   * Build a station's map label: the shared Sentinel pill, in the APRS accent,
   * showing whichever fields the operator has enabled.
   *
   * The leading icon and the symbol's name are separate fields: an operator can
   * keep the at-a-glance glyph while dropping the "CAR"/"DIGIPEATER" text, or
   * vice versa.
   */
  private _buildMarkerElement(station: AprsStation, leaderLength = 0): HTMLDivElement {
    const fields = this._landStore.aprsLabelFields
    const leftFacing = this._isLeftFacing(station)
    const symbol = aprsSymbolIcon(station.symbol)

    // With the icon switched off the callsign has no glyph to sit against, so
    // both its edges are outer edges and it takes the balanced padding.
    const nameSide = fields.symbol ? (leftFacing ? 'left' : 'right') : 'standalone'

    const pill = createLabelPill()
    pill.style.pointerEvents = 'auto'
    pill.dataset.dir = leftFacing ? 'left' : 'right'
    pill.dataset.callsign = station.callsign
    pill.setAttribute('aria-label', `APRS station ${station.callsign}, ${symbol.label}`)

    appendMirrored(
      pill,
      [
        fields.symbol ? createGlyphWell(this._glyphMarkup(station), APRS_BADGE_BACKGROUND) : null,
        fields.callsign ? createNameSegment(station.callsign, nameSide) : null,
        fields.symbolText
          ? createAccentBadge(symbol.label, APRS_BADGE_BACKGROUND, APRS_ACCENT_COLOR)
          : null,
        this._dimField(fields.time, 'TIME', formatHeardTime(station.last_heard_ms)),
        this._dimField(fields.course, 'CRS', formatCourse(station.course)),
        this._dimField(fields.speed, 'SPD', formatSpeed(station.speed)),
        this._dimField(fields.altitude, 'ALT', formatAltitude(station.altitude)),
        this._dimField(fields.latitude, 'LAT', station.latitude.toFixed(4)),
        this._dimField(fields.longitude, 'LON', station.longitude.toFixed(4)),
        this._dimField(fields.path, 'PATH', truncate(station.path)),
        this._dimField(fields.comment, 'CMT', truncate(station.comment)),
      ],
      leftFacing,
    )

    // Tether a displaced label back to its site's dot, so its real position is
    // never in doubt. The line rises from the label's leading edge — the side
    // carrying the icon, or the callsign when the icon is switched off — which
    // is the edge the anchor puts directly below the dot.
    // The line positions against the pill without setting `position` on it:
    // MapLibre's own `.maplibregl-marker` rule makes every marker element
    // absolute, which is already a containing block. Setting `position:relative`
    // here would override that rule and drop the label out of the map's
    // transform entirely.
    if (leaderLength > 0)
      pill.appendChild(createLeaderLine(leaderLength, LEADER_HORIZONTAL_OFFSET_PX, leftFacing))

    pill.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      this._openPopup(station)
      // Let the Land side panel expand this station's row (see LandFilter).
      document.dispatchEvent(
        new CustomEvent('aprs-station-selected', { detail: { callsign: station.callsign } }),
      )
    })
    return pill
  }

  /**
   * The icon drawn in the label's leading well: a course arrow when the station
   * reports a course — identical to an aircraft's track arrow, so movement is
   * readable at a glance — otherwise its APRS symbol, since an arrow would imply
   * a heading the beacon never sent.
   */
  private _glyphMarkup(station: AprsStation): string {
    return typeof station.course === 'number'
      ? createGlyphSvg(createDirectionArrowShape(APRS_ACCENT_COLOR), station.course)
      : // Drawn at the shared glyph size so a station symbol and an aircraft
        // arrow are the same size on screen. The APRS icons use a 24-unit
        // viewBox against the arrow's 12, so the stroke is scaled up to keep
        // the same on-screen weight once shrunk.
        aprsSymbolSvg(station.symbol, {
          size: MAP_LABEL_GLYPH_SIZE_PX,
          color: APRS_ACCENT_COLOR,
          strokeWidth: 2.6,
        })
  }

  /** A dim `LABEL value` segment, or null when the field is switched off or the
   *  packet didn't carry it. */
  private _dimField(enabled: boolean, label: string, value: string | null): HTMLSpanElement | null {
    if (!enabled || value === null) return null
    return createDimBadge(label, escapeHtml(value), APRS_ACCENT_COLOR)
  }

  private _openPopup(station: AprsStation): void {
    this._popup?.remove()
    this._popup = new maplibregl.Popup({ closeButton: true, offset: 12 })
      .setLngLat([station.longitude, station.latitude])
      .setHTML(this._popupHtml(station))
      .addTo(this.map)
  }

  private _popupHtml(station: AprsStation): string {
    const rows: string[] = [
      `<strong>${escapeHtml(station.callsign)}</strong>`,
      `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`,
    ]
    if (station.comment) rows.push(escapeHtml(station.comment))
    if (typeof station.course === 'number' || typeof station.speed === 'number') {
      // Units come straight from aprslib's normalised values (km/h, not the
      // packet's knots) — the previous "kn" label misreported them.
      rows.push(
        `Course ${formatCourse(station.course) ?? '—'} · Speed ${formatSpeed(station.speed) ?? '—'}`,
      )
    }
    rows.push(`Heard ${formatHeardTime(station.last_heard_ms)}`)
    return (
      '<div style="font-family:\'Barlow\',sans-serif;font-size:12px;line-height:1.5;color:#0a0d14">' +
      rows.join('<br>') +
      '</div>'
    )
  }

  // ── accessibility ────────────────────────────────────────────────────────────

  private _ensureA11yRegion(): void {
    /* v8 ignore start -- defensive idempotency guard: onInit calls this exactly once */
    if (this._a11yRegion) return
    /* v8 ignore stop */
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', 'APRS stations')
    // Visually hidden but available to assistive tech (the map canvas itself is
    // opaque to screen readers, so this table is the accessible equivalent).
    region.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
    this.map.getContainer().appendChild(region)
    this._a11yRegion = region
  }

  private _renderA11yTable(stations: AprsStation[]): void {
    /* v8 ignore start -- defensive: _render only runs after onInit created the region */
    if (!this._a11yRegion) return
    /* v8 ignore stop */
    if (stations.length === 0) {
      this._a11yRegion.innerHTML = '<p>No APRS stations heard.</p>'
      return
    }
    // The table carries every field regardless of which are switched on for the
    // map labels: it is the accessible equivalent of the map, and a screen-reader
    // user shouldn't lose data to a visual-density setting.
    const rows = stations
      .map((station) => {
        const cells = [
          escapeHtml(station.callsign),
          escapeHtml(aprsSymbolIcon(station.symbol).label),
          formatHeardTime(station.last_heard_ms),
          `${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)}`,
          formatCourse(station.course) ?? '',
          formatSpeed(station.speed) ?? '',
          formatAltitude(station.altitude) ?? '',
          station.path ? escapeHtml(station.path) : '',
          station.comment ? escapeHtml(station.comment) : '',
        ]
        return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`
      })
      .join('')
    const headers = [
      'Callsign',
      'Symbol',
      'Time',
      'Position',
      'Course',
      'Speed',
      'Altitude',
      'Path',
      'Comment',
    ]
    this._a11yRegion.innerHTML =
      '<table><caption>APRS stations heard</caption><thead><tr>' +
      headers.map((header) => `<th scope="col">${header}</th>`).join('') +
      `</tr></thead><tbody>${rows}</tbody></table>`
  }

  private _clearMarkers(): void {
    for (const marker of this._markers.values()) marker.remove()
    this._markers.clear()
    this._markerSignatures.clear()
    this._markerPositions.clear()
    for (const marker of this._siteMarkers.values()) marker.remove()
    this._siteMarkers.clear()
  }
}

/** Vertical step between the labels of stations sharing one site, in pixels —
 *  just over a label's height, so stacked pills read as a list without touching. */
const STACKED_LABEL_OFFSET_PX = 30

/** How far a displaced label is pushed sideways from its site dot, in pixels.
 *  Gives the tether room to curve rather than doubling back on itself. */
const LEADER_HORIZONTAL_OFFSET_PX = 20

/** Decimal places used to decide two stations share a site (3 dp ≈ 110 m). */
const SITE_PRECISION_DP = 3

/** Stations sharing one position, with the position they share. */
export interface StationSite {
  /** Rounded "lat,lon" identifying the site. */
  key: string
  longitude: number
  latitude: number
  /** Ordered by callsign, so a station keeps its place across polls. */
  stations: AprsStation[]
}

/**
 * Group stations by the position they beacon.
 *
 * Co-sited stations are routine in APRS — a repeater, its digipeater and a
 * gateway on one mast all beacon the same coordinates — and superimposed labels
 * would render as a single unreadable smear, making the map look like it holds
 * fewer stations than it does. A site with more than one station is drawn as a
 * dot at the real position with its labels displaced and tethered to it.
 *
 * Ordering is by callsign rather than arrival, so a station keeps its place in
 * the stack across polls instead of hopping about as beacons arrive.
 */
export function groupStationsBySite(stations: AprsStation[]): StationSite[] {
  const sites = new Map<string, StationSite>()
  for (const station of stations) {
    const key = `${station.latitude.toFixed(SITE_PRECISION_DP)},${station.longitude.toFixed(SITE_PRECISION_DP)}`
    const site = sites.get(key)
    if (site) site.stations.push(station)
    else
      sites.set(key, {
        key,
        longitude: station.longitude,
        latitude: station.latitude,
        stations: [station],
      })
  }
  for (const site of sites.values()) {
    site.stations.sort((left, right) => left.callsign.localeCompare(right.callsign))
  }
  return [...sites.values()]
}

/**
 * The dot marking a shared site's real position.
 *
 * Purely a position cue — it takes no pointer events, so it never intercepts a
 * click meant for a label, and is hidden from assistive tech, which reads the
 * stations from the data table instead.
 */
export function buildSiteDot(): HTMLDivElement {
  const dot = document.createElement('div')
  dot.className = 'aprs-site-dot'
  dot.setAttribute('aria-hidden', 'true')
  dot.style.cssText = [
    'width:7px',
    'height:7px',
    'border-radius:50%',
    `background:${APRS_ACCENT_COLOR}`,
    // A dark ring keeps the dot legible over pale coastline and road fills.
    'box-shadow:0 0 0 2px rgba(10,13,20,0.85)',
    'pointer-events:none',
  ].join(';')
  return dot
}

/**
 * The curved, dashed tether joining a displaced label to its site dot.
 *
 * Drawn inside the label and positioned out of flow, so it does not affect the
 * element's box — and therefore not the anchor MapLibre computes from it. The
 * curve starts at the label's leading edge (the side carrying the icon, or the
 * callsign when the icon is off) and sweeps up to the dot, which the offset
 * places `rise` pixels above and `run` pixels to the side.
 *
 * Dashed rather than solid so a tether never reads as a route or a track — the
 * Air domain draws those as solid lines.
 */
export function createLeaderLine(rise: number, run: number, leftFacing: boolean): SVGSVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNamespace, 'svg')
  svg.setAttribute('class', 'aprs-leader-line')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', String(run))
  svg.setAttribute('height', String(rise))
  svg.setAttribute('viewBox', `0 0 ${run} ${rise}`)
  svg.setAttribute('fill', 'none')

  // The label edge sits at the box's bottom on the dot's side; the control
  // point below the dot bends the run out of the label before it climbs.
  const labelEdgeX = leftFacing ? 0 : run
  const dotX = leftFacing ? run : 0
  const path = document.createElementNS(svgNamespace, 'path')
  path.setAttribute('d', `M ${labelEdgeX} ${rise} Q ${dotX} ${rise} ${dotX} 0`)
  path.setAttribute('stroke', 'rgba(255,255,255,0.45)')
  path.setAttribute('stroke-width', '1')
  path.setAttribute('stroke-dasharray', '2 3')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('fill', 'none')
  svg.appendChild(path)

  const halfLabel = MAP_LABEL_SIZE_PX / 2
  svg.style.cssText = [
    'position:absolute',
    // Sits just outside the label, on the side the dot is on.
    leftFacing ? `right:-${run}px` : `left:-${run}px`,
    `top:${halfLabel - rise}px`,
    'overflow:visible',
    'pointer-events:none',
  ].join(';')
  return svg
}

/** Time a station was last heard, as 24-hour local wall time. */
export function formatHeardTime(lastHeardMs: number): string {
  return new Date(lastHeardMs).toLocaleTimeString([], { hour12: false })
}

/** Course over ground in whole degrees, or null when not reported. */
export function formatCourse(course: number | null): string | null {
  return typeof course === 'number' ? `${Math.round(course)}°` : null
}

/** Speed in km/h — the unit aprslib normalises APRS speeds to (it converts the
 *  packet's knots on parse), so the raw value must not be relabelled here. */
export function formatSpeed(speed: number | null): string | null {
  return typeof speed === 'number' ? `${Math.round(speed)} KM/H` : null
}

/** Altitude in metres — likewise already converted from the packet's feet. */
export function formatAltitude(altitude: number | null): string | null {
  return typeof altitude === 'number' ? `${Math.round(altitude)} M` : null
}

/** Longest free-text run allowed on a map label before it crowds the map. */
const MAX_LABEL_TEXT_LENGTH = 24

/** Clip free-text fields (path, comment) so one chatty station can't stretch a
 *  pill across the viewport. The full text stays in the popup and side panel. */
export function truncate(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > MAX_LABEL_TEXT_LENGTH
    ? `${trimmed.slice(0, MAX_LABEL_TEXT_LENGTH - 1)}…`
    : trimmed
}

/** Escape a string for safe interpolation into marker/popup/table HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
