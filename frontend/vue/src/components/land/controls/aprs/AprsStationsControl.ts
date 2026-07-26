import maplibregl from 'maplibre-gl'
import { watch, type WatchStopHandle } from 'vue'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { aprsSymbolIcon, aprsSymbolSvg } from '@/utils/aprsSymbols'
import {
  APRS_ACCENT_COLOR,
  APRS_BADGE_BACKGROUND,
  APRS_SITE_MARKER_BACKGROUND,
} from '@/constants/aprs'
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
  /** Signature of each site's leader geometry, so a marker is only rebuilt when
   *  the stations sharing the site change. */
  private _siteSignatures = new Map<string, string>()
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
    for (const { site, layout } of planSiteLayout(groupStationsBySite(stations))) {
      // A station standing alone sits on its own position and needs no tether.
      // Anywhere labels would pile up, each site gets a marker on its real
      // position and its labels are displaced into the shared column below.
      const isShared = layout.displaced
      if (isShared) {
        seenSites.add(site.key)
        this._syncSiteMarker(site, layout.startIndex)
      }
      site.stations.forEach((station, indexInSite) => {
        const stackIndex = layout.startIndex + indexInSite
        seen.add(station.callsign)
        const coords: [number, number] = [station.longitude, station.latitude]
        // A displaced label steps clear of the site marker's own square; a lone
        // station stays on its true position.
        const offset: [number, number] = isShared
          ? [this._labelHorizontalOffset(station), labelVerticalOffset(stackIndex)]
          : [0, 0]
        const signature = this._markerSignature(station, offset)
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
        const marker = new maplibregl.Marker({
          element: this._buildMarkerElement(station),
          // Keep the leading edge over the station's position: a left-facing
          // pill extends leftward, so it anchors by its right edge.
          anchor: this._isLeftFacing(station) ? 'right' : 'left',
          offset,
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
        this._siteSignatures.delete(key)
      }
    }
  }

  /**
   * Place (or move) the marker showing a shared site's real position, together
   * with the leaders reaching each of its labels.
   */
  private _syncSiteMarker(site: StationSite, startIndex: number): void {
    const coords: [number, number] = [site.longitude, site.latitude]
    const branches = this._leaderBranches(site, startIndex)
    const signature = JSON.stringify(branches)
    const existing = this._siteMarkers.get(site.key)
    if (existing) {
      existing.setLngLat(coords)
      // Only redraw the leaders when the stations sharing the site change.
      if (this._siteSignatures.get(site.key) !== signature) {
        renderSiteLeaders(existing.getElement(), branches)
        this._siteSignatures.set(site.key, signature)
      }
      return
    }
    const marker = new maplibregl.Marker({
      element: buildSiteMarker(branches),
      anchor: 'center',
    })
      .setLngLat(coords)
      .addTo(this.map)
    this._siteMarkers.set(site.key, marker)
    this._siteSignatures.set(site.key, signature)
  }

  /**
   * Where each of a site's labels sits, relative to the site marker, in pixels.
   *
   * Fixed offsets, not projected positions: every station in a site reports the
   * same fix, and a label keeps its place in the column relative to its own
   * marker, so the geometry never changes with the view.
   */
  private _leaderBranches(site: StationSite, startIndex: number): LeaderBranch[] {
    return site.stations.map((station, indexInSite) => ({
      dx: this._labelHorizontalOffset(station),
      dy: labelVerticalOffset(startIndex + indexInSite),
    }))
  }

  /** Which way a label is displaced: away from the marker, on the side its
   *  leading edge faces. */
  private _labelHorizontalOffset(station: AprsStation): number {
    return this._isLeftFacing(station) ? -LEADER_HORIZONTAL_OFFSET_PX : LEADER_HORIZONTAL_OFFSET_PX
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
  private _markerSignature(station: AprsStation, offset: [number, number]): string {
    const fields = this._landStore.aprsLabelFields
    const shown = (enabled: boolean, value: unknown) => (enabled ? value : null)
    return JSON.stringify([
      this._isLeftFacing(station),
      // The offset is fixed when the marker is constructed, so a change in how
      // many stations share this site has to rebuild it.
      offset,
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
  private _buildMarkerElement(station: AprsStation): HTMLDivElement {
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
          strokeWidth: 2.2,
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
    this._siteSignatures.clear()
  }
}

/** Vertical step between the labels of stations sharing one site, in pixels —
 *  just over a label's height, so stacked pills read as a list without touching. */
const STACKED_LABEL_OFFSET_PX = 30

/** How far a displaced label is pushed sideways from its site marker, in pixels.
 *  Gives the tether room to curve rather than doubling back on itself. */
const LEADER_HORIZONTAL_OFFSET_PX = 28

/** How far below a shared site's marker the nth label sits, in pixels. Clears
 *  the marker's own square before stepping, so the first leader can curve. */
function labelVerticalOffset(stackIndex: number): number {
  return MAP_LABEL_SIZE_PX / 2 + (stackIndex + 1) * STACKED_LABEL_OFFSET_PX
}

/** Decimal places at which two sites are near enough for their labels to pile
 *  up and need one shared column (3 dp ≈ 110 m). */
const NEIGHBOURHOOD_PRECISION_DP = 3

/** Where a site's labels sit in the column shared with its neighbours. */
export interface SiteLayout {
  /** Position of the site's first label in the column. */
  startIndex: number
  /** Whether its labels are displaced into the column at all — false for a
   *  station standing on its own, which keeps its position and needs no marker. */
  displaced: boolean
}

/**
 * Decide where each site's labels sit.
 *
 * Sites are exact positions, but two masts a few metres apart still collide on
 * screen when zoomed out — so neighbouring sites share one column of labels,
 * numbered straight through, while each keeps its own marker on its own real
 * position. Because a label's offset is measured from its own marker, the two
 * stay joined however far apart the sites drift as the map zooms in.
 */
export function planSiteLayout(sites: StationSite[]): { site: StationSite; layout: SiteLayout }[] {
  const neighbourhoodKey = (site: StationSite) =>
    `${site.latitude.toFixed(NEIGHBOURHOOD_PRECISION_DP)},${site.longitude.toFixed(NEIGHBOURHOOD_PRECISION_DP)}`

  const neighbourhoods = new Map<string, StationSite[]>()
  for (const site of sites) {
    const key = neighbourhoodKey(site)
    const neighbours = neighbourhoods.get(key)
    if (neighbours) neighbours.push(site)
    else neighbourhoods.set(key, [site])
  }

  const planned: { site: StationSite; layout: SiteLayout }[] = []
  for (const neighbours of neighbourhoods.values()) {
    const population = neighbours.reduce((total, site) => total + site.stations.length, 0)
    let startIndex = 0
    for (const site of neighbours) {
      planned.push({ site, layout: { startIndex, displaced: population > 1 } })
      startIndex += site.stations.length
    }
  }
  return planned
}

/** Stations sharing one position, with the position they share. */
export interface StationSite {
  /** The shared "lat,lon" identifying the site. */
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
 * marker at the real position with its labels displaced and tethered to it.
 *
 * Grouping is on the reported coordinates exactly, not a tolerance: stations
 * that beacon the same fix are the same point at every zoom, so their labels
 * never drift away from the leaders drawn to them. Stations merely *near* each
 * other keep their own positions, which is the truthful answer — and the only
 * one that stays true as the map zooms in.
 *
 * Ordering is by callsign rather than arrival, so a station keeps its place in
 * the stack across polls instead of hopping about as beacons arrive.
 */
export function groupStationsBySite(stations: AprsStation[]): StationSite[] {
  const sites = new Map<string, StationSite>()
  for (const station of stations) {
    const key = `${station.latitude},${station.longitude}`
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

/** Size of the site marker's inner square, in pixels. Small: it marks a point,
 *  and has to sit under a column of labels without competing with them. */
const SITE_MARKER_SIZE_PX = 12

/** Width of the marker's black outer ring, in pixels. */
const SITE_MARKER_RING_PX = 2

/**
 * The marker showing a shared site's real position.
 *
 * A small square — a dark grey centre inside a black ring, which is what holds
 * it against both the pale roads and the dark water the basemap puts under it.
 * Nothing is drawn inside: a glyph here would compete with the station symbols
 * on the labels it leads to.
 *
 * Purely a position cue: it takes no pointer events, so it never intercepts a
 * click meant for a label, and is hidden from assistive tech, which reads the
 * stations from the data table instead.
 */
export function buildSiteMarker(branches: LeaderBranch[]): HTMLElement {
  const marker = document.createElement('div')
  marker.className = 'aprs-site-marker'
  marker.setAttribute('aria-hidden', 'true')
  marker.style.cssText = [
    `width:${SITE_MARKER_SIZE_PX}px`,
    `height:${SITE_MARKER_SIZE_PX}px`,
    `background:${APRS_BADGE_BACKGROUND}`,
    // Drawn as a shadow rather than a border so the ring sits outside the box,
    // leaving the marker's centre exactly on the site's position.
    `box-shadow:0 0 0 ${SITE_MARKER_RING_PX}px ${APRS_SITE_MARKER_BACKGROUND}`,
    'pointer-events:none',
  ].join(';')
  renderSiteLeaders(marker, branches)
  return marker
}

/**
 * Draw (or redraw) a site marker's leaders.
 *
 * Separate from building the marker because the branches are screen-space: two
 * stations inside one site's tolerance are the same point when zoomed out and
 * metres apart when zoomed in, so the leaders have to be recomputed as the map
 * zooms or the labels drift away from them.
 */
export function renderSiteLeaders(marker: HTMLElement, branches: LeaderBranch[]): void {
  marker.querySelector('.aprs-site-leaders')?.remove()
  // Behind the square, so each leader appears to emerge from under the marker
  // rather than from a point floating on top of it.
  marker.insertBefore(createSiteLeaders(branches), marker.firstChild)
}

/** Where a displaced label's leading edge sits, relative to its site marker. */
export interface LeaderBranch {
  /** Horizontal offset in pixels; negative for a left-facing label. */
  dx: number
  /** Vertical offset in pixels, always below the marker. */
  dy: number
}

/** Radius of the corner where a leader turns out of its vertical run. */
const LEADER_CORNER_PX = 26

/** Round a path coordinate to a tenth of a pixel — finer than the screen can
 *  show, without dragging float noise into the markup. */
function roundToPixelFraction(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Build the leader graphic joining a shared site's marker to each of its
 * displaced labels.
 *
 * Drawn once per site rather than once per label: separate full-length curves
 * from every label overlap into a braid under the marker, where a single comb —
 * one vertical run with a rounded turn into each label — stays legible however
 * many stations share the mast.
 *
 * Dashed rather than solid so a leader never reads as a track or route, which
 * the Air domain draws solid.
 */
export function createSiteLeaders(branches: LeaderBranch[]): SVGSVGElement {
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNamespace, 'svg')
  svg.setAttribute('class', 'aprs-site-leaders')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', String(SITE_MARKER_SIZE_PX))
  svg.setAttribute('height', String(SITE_MARKER_SIZE_PX))
  svg.setAttribute('viewBox', `0 0 ${SITE_MARKER_SIZE_PX} ${SITE_MARKER_SIZE_PX}`)
  svg.setAttribute('fill', 'none')
  // Branches run well outside the marker's own box; `overflow:visible` is what
  // lets them draw there, and the marker square covers where they start.
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none'

  const centre = SITE_MARKER_SIZE_PX / 2
  for (const branch of branches) {
    // Projected pixel deltas carry float noise; a sub-pixel path coordinate is
    // meaningless on screen and makes the markup unreadable.
    const endY = roundToPixelFraction(centre + branch.dy)
    const endX = roundToPixelFraction(centre + branch.dx)
    // A straight run, a rounded corner, then a short reach to the label. Drawn
    // as explicit segments rather than one sweeping curve so that every branch's
    // vertical run lies on exactly the same line — and, sharing a start point,
    // the same dash phase — collapsing into one clean stem instead of the fan a
    // single curve per label produces.
    const towardLabel = Math.sign(branch.dx)
    const corner = roundToPixelFraction(
      Math.min(LEADER_CORNER_PX, Math.abs(branch.dx), Math.abs(branch.dy) - centre),
    )
    const path = document.createElementNS(svgNamespace, 'path')
    path.setAttribute(
      'd',
      `M ${centre} ${centre} ` +
        `L ${centre} ${endY - corner} ` +
        `Q ${centre} ${endY} ${centre + corner * towardLabel} ${endY} ` +
        `L ${endX} ${endY}`,
    )
    path.setAttribute('stroke', 'rgba(255,255,255,0.5)')
    path.setAttribute('stroke-width', '1.6')
    path.setAttribute('stroke-dasharray', '2.5 3.5')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('fill', 'none')
    svg.appendChild(path)
  }
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
