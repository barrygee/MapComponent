import maplibregl from 'maplibre-gl'
import { watch, type WatchStopHandle } from 'vue'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { aprsSymbolIcon, aprsSymbolSvg } from '@/utils/aprsSymbols'
import {
  APRS_ACCENT_COLOR,
  APRS_BADGE_BACKGROUND,
  APRS_COUNT_FILL,
  APRS_COUNT_RING,
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
  private _clusterMarkers = new Map<string, maplibregl.Marker>()
  /** How many stations each count stands for, so it is only rebuilt when that
   *  number changes. */
  private _clusterCounts = new Map<string, number>()
  private _onMapMoveEnd: (() => void) | null = null
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
    // Which stations are close enough to collapse into a count depends on the
    // zoom, so the whole set is regrouped once a movement settles. `moveend`
    // rather than `zoomend`: a pan can bring the projection's scale distortion
    // into play at high latitudes, and it fires for zooms too.
    this._onMapMoveEnd = () => this._render(this._landStore.aprsStations)
    this.map.on('moveend', this._onMapMoveEnd)
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
    /* v8 ignore start -- defensive: onInit always assigns the handler, and
       MapLibre never removes a control it did not add */
    if (this._onMapMoveEnd) this.map.off('moveend', this._onMapMoveEnd)
    /* v8 ignore stop */
    this._onMapMoveEnd = null
    this._stopWatch?.()
    this._stopWatch = null
    this._landStore.stopAprsPolling()
    this._clearMarkers()
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
    const seenClusters = new Set<string>()

    const { labelled, counts } = this._planLabels(stations)
    for (const site of labelled) {
      for (const station of site.stations) {
        seen.add(station.callsign)
        this._syncStationMarker(station)
      }
    }
    for (const cluster of counts) {
      seenClusters.add(cluster.key)
      this._syncClusterMarker(cluster)
    }

    // Drop markers for stations no longer plotted — expired, hidden, or now
    // inside a count.
    for (const [callsign, marker] of this._markers) {
      if (!seen.has(callsign)) {
        marker.remove()
        this._markers.delete(callsign)
        this._markerSignatures.delete(callsign)
        this._markerPositions.delete(callsign)
      }
    }
    // …and counts for groups the zoom has since taken apart.
    for (const [key, marker] of this._clusterMarkers) {
      if (!seenClusters.has(key)) {
        marker.remove()
        this._clusterMarkers.delete(key)
        this._clusterCounts.delete(key)
      }
    }
  }

  /**
   * Split the stations into those that get labels and those that are counted.
   *
   * Past the reveal zoom nothing is counted: by then the operator has asked for
   * that area specifically, and overlapping labels they can pan around beat a
   * number they cannot open.
   */
  private _planLabels(stations: AprsStation[]): LabelPlan {
    const sites = groupStationsBySite(stations)
    if (this.map.getZoom() >= LABEL_REVEAL_ZOOM) return { labelled: sites, counts: [] }
    return planLabels(sites, (position) => this.map.project(position))
  }

  /** Add, move or rebuild one station's label. */
  private _syncStationMarker(station: AprsStation): void {
    const coords: [number, number] = [station.longitude, station.latitude]
    const signature = this._markerSignature(station)
    const existing = this._markers.get(station.callsign)
    // Label content unchanged → keep the existing marker. A station only ever
    // moves when its beacon actually reports a new fix: re-plotting on an
    // unchanged position would make a stationary marker twitch as the poll
    // repeats the same snapshot.
    if (existing && this._markerSignatures.get(station.callsign) === signature) {
      if (this._hasMoved(station.callsign, coords)) {
        existing.setLngLat(coords)
        this._markerPositions.set(station.callsign, coords)
      }
      return
    }
    // Anything else (a new field value, or a course change that flips the
    // pill's direction) needs the marker rebuilding, since MapLibre fixes the
    // element and anchor at construction.
    existing?.remove()
    const marker = new maplibregl.Marker({
      element: this._buildMarkerElement(station),
      // Keep the leading edge over the station's position: a left-facing pill
      // extends leftward, so it anchors by its right edge.
      anchor: this._isLeftFacing(station) ? 'right' : 'left',
    })
      .setLngLat(coords)
      .addTo(this.map)
    this._markers.set(station.callsign, marker)
    this._markerSignatures.set(station.callsign, signature)
    this._markerPositions.set(station.callsign, coords)
  }

  /**
   * Place (or move) the count standing for a group of stations, and zoom in on
   * the group when it is clicked.
   */
  private _syncClusterMarker(cluster: SiteCluster): void {
    const coords: [number, number] = [cluster.longitude, cluster.latitude]
    const existing = this._clusterMarkers.get(cluster.key)
    if (existing && this._clusterCounts.get(cluster.key) === cluster.stations.length) {
      existing.setLngLat(coords)
      return
    }
    existing?.remove()
    const element = buildClusterMarker(cluster.stations.length)
    element.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      // Straight to the zoom where labels appear, centred on the group — the
      // count's whole purpose is to say "there is something here", so one click
      // should show what.
      this.map.easeTo({ center: coords, zoom: LABEL_REVEAL_ZOOM, duration: 300 })
    })
    const marker = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat(coords)
      .addTo(this.map)
    this._clusterMarkers.set(cluster.key, marker)
    this._clusterCounts.set(cluster.key, cluster.stations.length)
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
  private _markerSignature(station: AprsStation): string {
    const fields = this._landStore.aprsLabelFields
    const shown = (enabled: boolean, value: unknown) => (enabled ? value : null)
    return JSON.stringify([
      this._isLeftFacing(station),
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
    // A click opens the station in the side panel rather than a map popup: the
    // panel already shows every field of the packet, where a popup could only
    // repeat a few of them over the map it is describing.
    pill.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
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
    for (const marker of this._clusterMarkers.values()) marker.remove()
    this._clusterMarkers.clear()
    this._clusterCounts.clear()
  }
}

/**
 * The zoom at which a crowded group gives way to its labels.
 *
 * The Land map opens at zoom 6 (see LandView), so this is the first step in
 * from the standard view: counts summarise the picture at a glance, and moving
 * closer to an area is the operator asking to see what is in it.
 */
const LABEL_REVEAL_ZOOM = 7

/** Diameter of a count marker, in pixels — the ring's outer edge. */
const CLUSTER_MARKER_SIZE_PX = 32

/** Width of the ring around a count marker, in pixels. */
const CLUSTER_MARKER_RING_PX = 2

/**
 * Diameter of the filled centre the count sits on, in pixels.
 *
 * The difference from the ring's inner edge is the gap the map shows through.
 * Wider than it looks on paper: the centre is black and the map behind the gap
 * is nearly as dark, so a hairline would not read as a gap at all.
 */
const CLUSTER_MARKER_CENTRE_PX = 20

/**
 * The marker standing for a group of stations too close together to label.
 *
 * Built like the user-location marker — a stroked ring with the map showing
 * through the gap inside it, and a filled centre — so a marker that stands for
 * a place reads the same wherever it appears. Its own colours, though: grey and
 * black rather than the location marker's white and accent, which would claim
 * more attention than a group of stations deserves.
 *
 * Interactive, unlike a label: it takes pointer events so a click can zoom in
 * to reveal what it stands for, and it carries a name for assistive tech
 * because it is the only thing on the map representing those stations.
 */
export function buildClusterMarker(count: number): HTMLElement {
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.className = 'aprs-cluster-marker'
  marker.setAttribute('aria-label', `${count} APRS stations here — zoom in to see them`)
  marker.style.cssText = [
    `width:${CLUSTER_MARKER_SIZE_PX}px`,
    `height:${CLUSTER_MARKER_SIZE_PX}px`,
    'box-sizing:border-box',
    'padding:0',
    `border:${CLUSTER_MARKER_RING_PX}px solid ${APRS_COUNT_RING}`,
    'border-radius:50%',
    // Transparent, so the gap between ring and centre is the map itself.
    'background:none',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'pointer-events:auto',
  ].join(';')

  const centre = document.createElement('span')
  centre.className = 'aprs-cluster-count'
  centre.style.cssText = [
    `width:${CLUSTER_MARKER_CENTRE_PX}px`,
    `height:${CLUSTER_MARKER_CENTRE_PX}px`,
    'border-radius:50%',
    `background:${APRS_COUNT_FILL}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `color:${APRS_ACCENT_COLOR}`,
    "font-family:'Barlow Condensed','Barlow',sans-serif",
    'font-size:13px',
    'font-weight:700',
    'letter-spacing:.04em',
    // The count is centred on the disc rather than filling it, so it never
    // touches the edge however many digits it runs to.
    'line-height:1',
  ].join(';')
  centre.textContent = String(count)
  marker.appendChild(centre)
  return marker
}

/**
 * Width of a station label, in pixels, estimated from its callsign.
 *
 * Measured from rendered labels, which fit `41.5 + 7.5 × characters` almost
 * exactly: the fixed part is the glyph well and padding, the rest is condensed
 * 14px type. An estimate rather than a measurement because grouping is decided
 * before any label exists — and it only has to be close enough to tell a
 * genuine overlap from a near miss.
 *
 * Deliberately ignores optional fields (speed, altitude, path…). Assuming the
 * widest possible label would collapse stations that do not actually collide,
 * which is the failure this replaces.
 */
export function estimateLabelWidth(callsign: string): number {
  return LABEL_BASE_WIDTH_PX + LABEL_CHARACTER_WIDTH_PX * callsign.length
}

const LABEL_BASE_WIDTH_PX = 41.5
const LABEL_CHARACTER_WIDTH_PX = 7.5

/** A rectangle in screen pixels. */
interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/** Where a station's label lands on screen, given its anchor point. */
function labelRect(station: AprsStation, at: { x: number; y: number }, leftFacing: boolean): Rect {
  const width = estimateLabelWidth(station.callsign)
  const halfHeight = MAP_LABEL_SIZE_PX / 2
  return {
    left: leftFacing ? at.x - width : at.x,
    right: leftFacing ? at.x : at.x + width,
    top: at.y - halfHeight,
    bottom: at.y + halfHeight,
  }
}

/** Whether two rectangles share any area. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** A group of sites whose labels would land on top of each other. */
export interface SiteCluster {
  /** Identity of the group, stable while its membership is. */
  key: string
  /** Sites in the group, in the order they were given. */
  sites: StationSite[]
  /** Every station the group stands for. */
  stations: AprsStation[]
  /** Where the count sits — the first site's position. */
  longitude: number
  latitude: number
}

/** How the sites in view are split between labels and counts. */
export interface LabelPlan {
  /** Sites whose labels fit, in the order they were placed. */
  labelled: StationSite[]
  /** Groups of sites left over, each shown as one count. */
  counts: SiteCluster[]
}

/**
 * Decide which stations get labels and which are counted.
 *
 * Labels are placed one at a time and kept whenever they land clear of the ones
 * already placed, so a crowded view still shows every station it has room for
 * rather than collapsing the lot. Only what genuinely will not fit is counted,
 * which is the difference between "this area is busy" and "this area is
 * unreadable" — and a count that would stand for a single station is dropped in
 * favour of its label, since a "1" says less than the callsign it replaced.
 *
 * Placement order is by callsign, not by how recently a station was heard: an
 * arrival order would reshuffle which stations are labelled on every poll, and
 * a label appearing and vanishing under the cursor is worse than an arbitrary
 * but stable choice.
 */
export function planLabels(
  sites: StationSite[],
  project: (position: [number, number]) => { x: number; y: number },
): LabelPlan {
  const rects = new Map<string, Rect>()
  for (const site of sites) {
    const station = site.stations[0]!
    const leftFacing = typeof station.course === 'number' && isLeftFacing(station.course)
    rects.set(site.key, labelRect(station, project([site.longitude, site.latitude]), leftFacing))
  }

  const ordered = [...sites].sort((left, right) =>
    left.stations[0]!.callsign.localeCompare(right.stations[0]!.callsign),
  )

  const labelled: StationSite[] = []
  const placedRects: Rect[] = []
  const leftOver: StationSite[] = []
  for (const site of ordered) {
    const rect = rects.get(site.key)!
    if (placedRects.some((placed) => overlaps(placed, rect))) {
      leftOver.push(site)
      continue
    }
    labelled.push(site)
    placedRects.push(rect)
  }

  // A count standing for one station says less than the label it replaced, so
  // a lone leftover is drawn anyway and allowed to overlap.
  const grouped = groupOverlapping(leftOver, rects)
  const counts: SiteCluster[] = []
  for (const cluster of grouped) {
    if (cluster.stations.length === 1) labelled.push(...cluster.sites)
    else counts.push(cluster)
  }
  return { labelled, counts }
}

/**
 * Gather the sites that could not be labelled into counts.
 *
 * Single-linkage on true overlap: if A's label covers B's and B's covers C's,
 * the three are one pile and belong under one count.
 */
function groupOverlapping(sites: StationSite[], rects: Map<string, Rect>): SiteCluster[] {
  const clusters: SiteCluster[] = []
  for (const site of sites) {
    const rect = rects.get(site.key)!
    const touching = clusters.filter((cluster) =>
      cluster.sites.some((member) => overlaps(rects.get(member.key)!, rect)),
    )
    if (touching.length === 0) {
      clusters.push({
        key: site.key,
        sites: [site],
        stations: [...site.stations],
        longitude: site.longitude,
        latitude: site.latitude,
      })
      continue
    }
    const [first, ...rest] = touching as [SiteCluster, ...SiteCluster[]]
    first.sites.push(site)
    first.stations.push(...site.stations)
    for (const merged of rest) {
      first.sites.push(...merged.sites)
      first.stations.push(...merged.stations)
      clusters.splice(clusters.indexOf(merged), 1)
    }
  }
  return clusters
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
