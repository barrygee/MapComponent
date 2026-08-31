import maplibregl from 'maplibre-gl'
import { watch, type WatchStopHandle } from 'vue'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { buildLocationMarkerSvg } from '@/components/shared/UserLocationMarker'
import {
  buildCountMarker,
  groupByProximity,
  type ScreenPosition,
} from '@/components/shared/map-cluster/mapCluster'
import { setMarkerAccessibleName } from '@/components/shared/map-label/mapMarkerAria'
import { formatLatitude, formatLongitude } from '@/utils/locationUtils'
import type { SentrySite } from '@/services/sentryApi'
import type { useSentrySitesStore } from '@/stores/sentrySites'
import type { useSettingsStore } from '@/stores/settings'

type SentrySitesStore = ReturnType<typeof useSentrySitesStore>
type SettingsStore = ReturnType<typeof useSettingsStore>

/**
 * Plots every connected Sentry at the position it reports, on every domain map.
 *
 * A Sentry is a fixed installation — the receiver the domain data is coming
 * from — so where it sits is context for every map, not a Land or SDR concern:
 * this control is added to Air, Space, Sea and Land alike, which is why it
 * lives under `shared/controls/` rather than in one domain's folder.
 *
 * Each site is drawn with the SENTINEL ⊙ mark — the same marker the operator's
 * own location uses, its dot in the settings panel's off-white so that on a map
 * showing both, a site is not mistaken for where the operator is standing — and
 * sites too close together to tell apart collapse into
 * one numbered count that zooms in when clicked — the same treatment crowded
 * APRS stations get on the Land map, from the same shared clustering module and
 * at the same reveal zoom. The operator's own position is counted alongside the
 * sites, so a Sentry standing where the operator is standing collapses into a
 * count rather than the two marks smearing into one.
 * Hovering a site (or giving it keyboard focus) shows its details alongside the
 * mark — name, reachability dot, address and position — drawn as the same pill
 * the map's right-click menu uses, so the two read as one piece of map
 * furniture. The marker as a whole is the button: clicking the mark or its
 * details opens that host's own row in Settings → SDR.
 *
 * The map canvas is opaque to assistive tech, so the control also maintains a
 * visually-hidden table of the sites as the accessible equivalent, per
 * accessibility-standards.
 */
export class SentrySitesControl extends SentinelControlBase {
  private readonly _sitesStore: SentrySitesStore
  private readonly _settingsStore: SettingsStore
  private _markers = new Map<number, maplibregl.Marker>()
  private _clusterMarkers = new Map<string, maplibregl.Marker>()
  /** How many sites each count stands for, so it is only rebuilt when that
   *  number changes. */
  private _clusterCounts = new Map<string, number>()
  private readonly _getUserLocation: () => [number, number] | null
  private readonly _userMarker: HideableMarker | null
  private _onMapMoveEnd: (() => void) | null = null
  private _stopWatch: WatchStopHandle | null = null
  private _a11yRegion: HTMLDivElement | null = null
  private _visible = true

  /**
   * @param options.getUserLocation Where the operator's own ⊙ marker is, if the
   *   view draws one. Its position joins the sites in the grouping pass, so a
   *   Sentry sitting on top of the operator's own position collapses into a
   *   count rather than the two marks smearing into one unreadable blob.
   * @param options.userMarker That marker, so it can be hidden while a count
   *   stands for it. Views without one (Sea) pass neither.
   */
  constructor(
    sitesStore: SentrySitesStore,
    settingsStore: SettingsStore,
    options: {
      getUserLocation?: () => [number, number] | null
      userMarker?: HideableMarker | null
    } = {},
  ) {
    super()
    this._sitesStore = sitesStore
    this._settingsStore = settingsStore
    this._getUserLocation = options.getUserLocation ?? (() => null)
    this._userMarker = options.userMarker ?? null
  }

  get buttonLabel(): string {
    // The ⊙ mark in miniature — the same ring-and-dot the sites are drawn with.
    return (
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4" />' +
      '<circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>'
    )
  }

  get buttonTitle(): string {
    return 'Toggle Sentry sites'
  }

  protected onInit(): void {
    this.setButtonActive(this._visible)
    this._ensureA11yRegion()
    // Poll the fleet while this control is on the map.
    this._sitesStore.startPolling()
    // Which sites are close enough to collapse into a count depends on the
    // zoom, so the whole set is regrouped once a movement settles. `moveend`
    // rather than `zoomend`: it fires for zooms too, and a pan can bring the
    // projection's scale distortion into play at high latitudes.
    this._onMapMoveEnd = () => this._render()
    this.map.on('moveend', this._onMapMoveEnd)
    // Re-group on either input: a new fleet snapshot, or the operator's own
    // position moving — a fix that lands on top of a Sentry has to collapse the
    // two into a count just as two Sentries would.
    this._stopWatch = watch(
      () => [this._sitesStore.sites, this._getUserLocation()] as const,
      () => this._render(),
      { immediate: true, deep: true },
    )
  }

  protected handleClick(): void {
    this.setVisible(!this._visible)
  }

  /** Show or hide the Sentry sites. */
  setVisible(visible: boolean): void {
    if (this._visible === visible) return
    this._visible = visible
    this.setButtonActive(visible)
    this._render()
  }

  onRemove(): void {
    /* v8 ignore start -- defensive: onInit always assigns these, and MapLibre
       never removes a control it did not add */
    if (this._onMapMoveEnd) this.map.off('moveend', this._onMapMoveEnd)
    /* v8 ignore stop */
    this._onMapMoveEnd = null
    this._stopWatch?.()
    this._stopWatch = null
    this._sitesStore.stopPolling()
    this._clearMarkers()
    this._a11yRegion?.remove()
    this._a11yRegion = null
    super.onRemove()
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private _render(): void {
    const sites = this._sitesStore.sites
    this._syncMarkers(this._visible ? sites : [])
    this._renderA11yTable(sites)
  }

  /** Add/update/remove markers so the on-map set matches `sites`. */
  private _syncMarkers(sites: SentrySite[]): void {
    const { plotted, clusters, userLocationCounted } = this._planMarkers(sites)
    const seenSites = new Set<number>()
    const seenClusters = new Set<string>()

    for (const site of plotted) {
      seenSites.add(site.id)
      this._syncSiteMarker(site)
    }
    for (const cluster of clusters) {
      seenClusters.add(cluster.key)
      this._syncClusterMarker(cluster)
    }
    // The operator's own marker belongs to the view, not to this control — but
    // while a count stands for it, leaving it drawn would show one position
    // twice, as both a mark and a number.
    this._userMarker?.setHidden(userLocationCounted)

    // Drop markers for sites no longer plotted — deregistered, disabled, or now
    // inside a count.
    for (const [siteId, marker] of this._markers) {
      if (seenSites.has(siteId)) continue
      marker.remove()
      this._markers.delete(siteId)
    }
    // …and counts for groups the zoom has since taken apart.
    for (const [key, marker] of this._clusterMarkers) {
      if (seenClusters.has(key)) continue
      marker.remove()
      this._clusterMarkers.delete(key)
      this._clusterCounts.delete(key)
    }
  }

  /**
   * Split what is on the map into marks drawn as themselves and groups shown as
   * one count, by how close together they land on screen at this zoom.
   *
   * Past the reveal zoom nothing is counted: by then the operator has asked for
   * that area specifically, and overlapping marks they can pan between beat a
   * number they cannot open. This is the rule the Land map's APRS counts follow,
   * at the same zoom, so the two layers behave alike.
   *
   * The operator's own position takes part as an ordinary point — a Sentry
   * standing where the operator is standing is exactly the overlap that needs
   * collapsing — but it is not a site, so it is reported back separately rather
   * than plotted by this control.
   */
  private _planMarkers(sites: SentrySite[]): MarkerPlan {
    if (this.map.getZoom() >= SITE_REVEAL_ZOOM) {
      return { plotted: sites, clusters: [], userLocationCounted: false }
    }
    const positions = new Map<string, ScreenPosition>()
    const points: ClusterPoint[] = sites.map((site) => {
      positions.set(siteKey(site), this.map.project([site.longitude, site.latitude]))
      return { key: siteKey(site), site }
    })
    const userLocation = this._getUserLocation()
    if (userLocation) {
      positions.set(USER_LOCATION_KEY, this.map.project(userLocation))
      points.push({ key: USER_LOCATION_KEY, site: null })
    }

    const plotted: SentrySite[] = []
    const clusters: SentryCluster[] = []
    let userLocationCounted = false
    for (const group of groupByProximity(points, positions, SITE_GROUP_RADIUS_PX)) {
      const groupSites = group.members.map((point) => point.site).filter(isSite)
      // A group of one is never a count: a "1" says less than the mark it would
      // replace, and that mark is the one an operator can actually open.
      if (group.members.length === 1) {
        if (groupSites[0]) plotted.push(groupSites[0])
        continue
      }
      const holdsUserLocation = groupSites.length < group.members.length
      if (holdsUserLocation) userLocationCounted = true
      // A counted group always holds at least one site: the only point that is
      // not a site is the operator's own position, and on its own that is a
      // group of one, which is never counted. So the first site is always there
      // to put the count on.
      const anchor = groupSites[0]!
      clusters.push({
        key: group.key,
        sites: groupSites,
        holdsUserLocation,
        memberCount: group.members.length,
        longitude: anchor.longitude,
        latitude: anchor.latitude,
      })
    }
    return { plotted, clusters, userLocationCounted }
  }

  /** Add or move one site's marker. */
  private _syncSiteMarker(site: SentrySite): void {
    const coords: [number, number] = [site.longitude, site.latitude]
    const existing = this._markers.get(site.id)
    if (existing) {
      existing.setLngLat(coords)
      return
    }
    const marker = new maplibregl.Marker({
      element: this._buildSiteElement(site),
      anchor: 'center',
    })
      .setLngLat(coords)
      .addTo(this.map)
    // After addTo: MapLibre replaces the element's aria-label with its own
    // generic "Map marker" as it adds one, so the site's is put back.
    setMarkerAccessibleName(marker, siteMarkerLabel(site))
    this._markers.set(site.id, marker)
  }

  /**
   * The marker for one site: the SENTINEL ⊙ mark with the site's details
   * alongside it, as a single button.
   *
   * One button rather than a mark plus a separate action, because there is only
   * one thing to do here — open the host in Settings — and the whole marker
   * does it, mark and details alike. That keeps it to one tab stop with one
   * name, and means the details panel cannot swallow a click meant for the mark
   * it is butted against.
   */
  private _buildSiteElement(site: SentrySite): HTMLElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'sentry-map-marker'
    element.setAttribute('aria-label', siteMarkerLabel(site))
    element.appendChild(this._buildMark())
    element.appendChild(this._buildDetails(site))
    element.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      this._settingsStore.openSentryHost(site.id)
    })
    return element
  }

  /** The ⊙ itself. */
  private _buildMark(): HTMLElement {
    const mark = document.createElement('span')
    mark.className = 'sentry-map-marker-mark'
    mark.innerHTML = buildLocationMarkerSvg(SENTRY_MARKER_DOT_COLOR)
    return mark
  }

  /**
   * One site's details, drawn as the pill the map's own right-click menu uses:
   * a black panel butted against the ⊙ mark, with a circle masked out of its
   * leading edge so the mark stays whole and the two read as one object.
   *
   * Shown on hover and on keyboard focus. It is the operator's shorthand for
   * the host — what it is called, whether it is up, where it answers, and where
   * it is — while the action it offers belongs to the marker as a whole.
   *
   * `aria-hidden`, because the marker's own accessible name already carries
   * every one of these values: a screen reader should hear them once, not
   * twice.
   */
  private _buildDetails(site: SentrySite): HTMLElement {
    const details = document.createElement('span')
    details.className = 'sentry-map-marker-info'
    details.setAttribute('aria-hidden', 'true')

    const name = document.createElement('span')
    name.className = 'sentry-map-marker-name'
    name.textContent = siteLabel(site)
    details.appendChild(name)

    const meta = document.createElement('span')
    meta.className = 'sentry-map-marker-meta'
    const statusDot = document.createElement('span')
    statusDot.className = `sentry-map-marker-status sentry-map-marker-status--${
      site.reachable ? 'online' : 'offair'
    }`
    meta.appendChild(statusDot)
    meta.appendChild(document.createTextNode(`${site.address}:${site.port}`))
    details.appendChild(meta)

    const coordinates = document.createElement('span')
    coordinates.className = 'sentry-map-marker-coords'
    coordinates.textContent = `${formatLatitude(site.latitude)}  ${formatLongitude(site.longitude)}`
    details.appendChild(coordinates)

    return details
  }

  /** Place (or move) the count standing for a group of sites, and zoom in on
   *  the group when it is clicked. */
  private _syncClusterMarker(cluster: SentryCluster): void {
    const coords: [number, number] = [cluster.longitude, cluster.latitude]
    const existing = this._clusterMarkers.get(cluster.key)
    if (existing && this._clusterCounts.get(cluster.key) === cluster.memberCount) {
      existing.setLngLat(coords)
      return
    }
    existing?.remove()
    const countLabel = clusterLabel(cluster)
    const element = buildCountMarker({
      count: cluster.memberCount,
      ariaLabel: countLabel,
      className: 'sentry-cluster-marker',
      countClassName: 'sentry-cluster-count',
      ringColor: SENTRY_COUNT_RING,
      fillColor: SENTRY_COUNT_FILL,
      textColor: SENTRY_COUNT_TEXT,
    })
    element.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      // Far enough in to take the group apart, wherever the operator started
      // from — the count's whole purpose is to say "there is something here",
      // so one click should show what.
      // Always far enough in to take the group apart — at least the zoom the
      // marks are revealed at, however far out the operator started.
      this.map.easeTo({
        center: coords,
        zoom: Math.max(this.map.getZoom() + CLUSTER_ZOOM_STEP, SITE_REVEAL_ZOOM),
        duration: 300,
      })
    })
    const marker = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat(coords)
      .addTo(this.map)
    setMarkerAccessibleName(marker, countLabel)
    this._clusterMarkers.set(cluster.key, marker)
    this._clusterCounts.set(cluster.key, cluster.memberCount)
  }

  // ── accessibility ──────────────────────────────────────────────────────────

  private _ensureA11yRegion(): void {
    /* v8 ignore start -- defensive idempotency guard: onInit calls this exactly once */
    if (this._a11yRegion) return
    /* v8 ignore stop */
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', 'Sentry sites')
    // Visually hidden but available to assistive tech (the map canvas itself is
    // opaque to screen readers, so this table is the accessible equivalent).
    region.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
    this.map.getContainer().appendChild(region)
    this._a11yRegion = region
  }

  /** The accessible equivalent of the markers: every site, with its position and
   *  reachability, regardless of how the visual layer has grouped them. */
  private _renderA11yTable(sites: SentrySite[]): void {
    /* v8 ignore start -- defensive: _render only runs after onInit created the region */
    if (!this._a11yRegion) return
    /* v8 ignore stop */
    if (sites.length === 0) {
      this._a11yRegion.innerHTML = '<p>No Sentry sites reporting a position.</p>'
      return
    }
    const rows = sites
      .map(
        (site) =>
          `<tr><td>${escapeHtml(siteLabel(site))}</td>` +
          `<td>${escapeHtml(`${site.address}:${site.port}`)}</td>` +
          `<td>${site.reachable ? 'Online' : 'Off air'}</td>` +
          `<td>${site.latitude.toFixed(4)}</td><td>${site.longitude.toFixed(4)}</td></tr>`,
      )
      .join('')
    this._a11yRegion.innerHTML =
      '<table><caption>Sentry sites on this map</caption><thead><tr>' +
      '<th scope="col">Name</th><th scope="col">Address</th><th scope="col">Status</th>' +
      '<th scope="col">Latitude</th><th scope="col">Longitude</th></tr></thead>' +
      `<tbody>${rows}</tbody></table>`
  }

  private _clearMarkers(): void {
    // The view's own marker was only ever hidden by this control, so it is
    // handed back visible.
    this._userMarker?.setHidden(false)
    for (const marker of this._markers.values()) marker.remove()
    this._markers.clear()
    for (const marker of this._clusterMarkers.values()) marker.remove()
    this._clusterMarkers.clear()
    this._clusterCounts.clear()
  }
}

/** A marker whose visibility this control borrows — the view's own ⊙ for the
 *  operator's position, while a count stands for it. */
export interface HideableMarker {
  setHidden(hidden: boolean): void
}

/** One point in the grouping pass: a site, or the operator's own position
 *  (`site: null` — it is grouped like any other point, but never plotted here). */
interface ClusterPoint {
  key: string
  site: SentrySite | null
}

/** A group of marks too close together to tell apart at this zoom. */
interface SentryCluster {
  key: string
  /** The sites in the group — everything but the operator's own position. */
  sites: SentrySite[]
  /** Whether the operator's own position is one of the marks counted. */
  holdsUserLocation: boolean
  /** How many marks the count stands for, the operator's position included. */
  memberCount: number
  /** Where the count sits — the first member's position. */
  longitude: number
  latitude: number
}

/** How the marks in view are split between drawn and counted. */
interface MarkerPlan {
  plotted: SentrySite[]
  clusters: SentryCluster[]
  /** Whether a count now stands for the operator's own position, so the view's
   *  marker for it must be hidden. */
  userLocationCounted: boolean
}

/** Narrows a group's members to the ones that are sites. */
function isSite(site: SentrySite | null): site is SentrySite {
  return site !== null
}

/** Identity of the operator's own position in the grouping pass. Not a number,
 *  so it can never collide with a host id. */
const USER_LOCATION_KEY = 'user-location'

/**
 * What a count says it stands for.
 *
 * Names the operator's own position when it is one of the marks counted:
 * otherwise the number would be one higher than the sites it appears to
 * summarise, which reads as a miscount.
 */
function clusterLabel(cluster: SentryCluster): string {
  const subject = cluster.holdsUserLocation
    ? `${cluster.memberCount} markers here, including your location,`
    : `${cluster.memberCount} Sentry sites here`
  return `${subject} — zoom in to see them`
}

/** Everything a site marker says, as its accessible name — the same values its
 *  details panel shows, which is why that panel is `aria-hidden`. */
function siteMarkerLabel(site: SentrySite): string {
  const status = site.reachable ? 'online' : 'off air'
  const position = `${formatLatitude(site.latitude)} ${formatLongitude(site.longitude)}`
  return `Sentry ${siteLabel(site)}, ${site.address}:${site.port}, ${status}, at ${position} — open in Settings`
}

/** Identity of a site for clustering — its host id, which is stable across polls. */
function siteKey(site: SentrySite): string {
  return String(site.id)
}

/** What to call a site: its name if it has one, otherwise where it answers.
 *  A host is registered by address and named later, so the address is the only
 *  label some sites ever have. */
export function siteLabel(site: SentrySite): string {
  return site.name?.trim() || `${site.address}:${site.port}`
}

/** Escape text bound for the a11y table's markup — a Sentry's name is set on
 *  the Pi, so it is remote input and never goes into HTML unescaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The dot at the centre of a Sentry's ⊙ mark.
 *
 * The off-white the settings panel is built on (`SettingsPanel.css`), against
 * the lit accent dot the operator's own location marker carries
 * (`LOCATION_MARKER_DOT_COLOR`, #c8ff00): unmistakable side by side, and it
 * reads as a fixed installation rather than as a live position. Duplicated as a
 * hex rather than read from the stylesheet because marker elements are handed to
 * MapLibre and live outside the Vue tree. The white ring is shared and
 * deliberately untouched — the mark is the same mark; only whose place it is
 * changes.
 */
const SENTRY_MARKER_DOT_COLOR = '#f6f6f4'

/** How close two sites must be to share a count, in pixels — the ⊙ mark's own
 *  ring diameter, so sites are grouped exactly when their marks would overlap. */
const SITE_GROUP_RADIUS_PX = 30

/**
 * The zoom at which a crowded group gives way to its own marks.
 *
 * The same step-in from the standard view the Land map's APRS counts use, and
 * the same number, so a count means the same thing on either layer: below this,
 * overlapping marks are summarised; at or above it, the operator has asked for
 * this area specifically and gets every mark, overlapping or not.
 */
const SITE_REVEAL_ZOOM = 7

/** How far in one click on a count goes, in zoom levels. Three steps splits a
 *  typical huddle without throwing the operator down to street level — and never
 *  lands short of the reveal zoom, so a click always shows what it stood for. */
const CLUSTER_ZOOM_STEP = 3

/** Ring around a Sentry count marker — the same nearly-black, semitransparent
 *  ring the APRS counts use, so a count reads the same wherever it appears. */
const SENTRY_COUNT_RING = 'rgba(20, 23, 28, 0.55)'

/** Fill of a Sentry count marker's centre. */
const SENTRY_COUNT_FILL = '#000000'

/** Colour of the count itself — a site's own dot colour, which reads clearly on
 *  the count's black centre, so a group of Sentries is recognisably the same
 *  thing as the marks it stands in for. */
const SENTRY_COUNT_TEXT = SENTRY_MARKER_DOT_COLOR
