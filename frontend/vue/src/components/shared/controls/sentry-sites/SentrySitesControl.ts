import maplibregl from 'maplibre-gl'
import { watch, type WatchStopHandle } from 'vue'
import { SentinelControlBase } from '@/components/air/controls/sentinel-control-base/SentinelControlBase'
import { buildLocationMarkerSvg } from '@/components/shared/UserLocationMarker'
import {
  buildCountMarker,
  groupByProximity,
  type ScreenPosition,
} from '@/components/shared/map-cluster/mapCluster'
import {
  removeMarkerAccessibleName,
  setMarkerAccessibleName,
} from '@/components/shared/map-label/mapMarkerAria'
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
 * own location uses, its dot blacked out so that on a map showing both, a site
 * is not mistaken for where the operator is standing — and sites too close
 * together to tell apart collapse into
 * one numbered count that zooms in when clicked — the same treatment crowded
 * APRS stations get on the Land map, from the same shared clustering module.
 * Hovering or pressing a site opens its details alongside the mark — name,
 * address, a reachability dot, and a MORE action that lands on that host's own
 * row in Settings → SDR — drawn as the same pill the map's right-click menu
 * uses, so the two read as one piece of map furniture.
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
  /** The marker whose details are currently latched open, if any. */
  private _openFlyout: HTMLElement | null = null
  private _onMapMoveEnd: (() => void) | null = null
  private _onDocumentKeydown: ((event: KeyboardEvent) => void) | null = null
  private _stopWatch: WatchStopHandle | null = null
  private _a11yRegion: HTMLDivElement | null = null
  private _visible = true

  constructor(sitesStore: SentrySitesStore, settingsStore: SettingsStore) {
    super()
    this._sitesStore = sitesStore
    this._settingsStore = settingsStore
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
    // A latched panel the keyboard cannot dismiss would fail WCAG 2.1.2, and
    // Escape is where an operator reaches for that first.
    this._onDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this._closeFlyout()
    }
    document.addEventListener('keydown', this._onDocumentKeydown)
    this._stopWatch = watch(
      () => this._sitesStore.sites,
      () => this._render(),
      {
        immediate: true,
        deep: true,
      },
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
    if (!visible) this._closeFlyout()
    this._render()
  }

  onRemove(): void {
    /* v8 ignore start -- defensive: onInit always assigns these, and MapLibre
       never removes a control it did not add */
    if (this._onMapMoveEnd) this.map.off('moveend', this._onMapMoveEnd)
    if (this._onDocumentKeydown) document.removeEventListener('keydown', this._onDocumentKeydown)
    /* v8 ignore stop */
    this._onMapMoveEnd = null
    this._onDocumentKeydown = null
    this._stopWatch?.()
    this._stopWatch = null
    this._sitesStore.stopPolling()
    this._closeFlyout()
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
    const { plotted, clusters } = this._planMarkers(sites)
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

    // Drop markers for sites no longer plotted — deregistered, disabled, or now
    // inside a count.
    for (const [siteId, marker] of this._markers) {
      if (seenSites.has(siteId)) continue
      // A site being taken off the map takes its open details with it, or the
      // panel would be left latched open against a marker that is gone.
      if (this._openFlyout === marker.getElement()) this._closeFlyout()
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
   * Split the sites into those drawn as themselves and those collapsed into a
   * count, by how close together they land on screen at this zoom.
   *
   * A group of one is never a count: a "1" says less than the marker it would
   * replace, and that marker is the one an operator can actually open.
   */
  private _planMarkers(sites: SentrySite[]): { plotted: SentrySite[]; clusters: SentryCluster[] } {
    const positions = new Map<string, ScreenPosition>()
    const points = sites.map((site) => {
      positions.set(siteKey(site), this.map.project([site.longitude, site.latitude]))
      return { key: siteKey(site), site }
    })
    const plotted: SentrySite[] = []
    const clusters: SentryCluster[] = []
    for (const group of groupByProximity(points, positions, SITE_GROUP_RADIUS_PX)) {
      const members = group.members.map((point) => point.site)
      if (members.length === 1) {
        plotted.push(members[0]!)
        continue
      }
      clusters.push({
        key: group.key,
        sites: members,
        longitude: members[0]!.longitude,
        latitude: members[0]!.latitude,
      })
    }
    return { plotted, clusters }
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
    // After addTo: MapLibre stamps its own generic "Map marker" onto the
    // element as it adds one. The element here is a plain container whose
    // children carry the real names, and `aria-label` on a container with no
    // role is both ignored by assistive tech and flagged as a prohibited
    // attribute — so the stamp is taken back off rather than replaced.
    removeMarkerAccessibleName(marker)
    this._markers.set(site.id, marker)
  }

  /**
   * The marker for one site: the SENTINEL ⊙ mark, with its details alongside.
   *
   * A container rather than a single button, because two things here are
   * operable: the mark itself, which opens the details, and the MORE action
   * inside them. Nesting the second inside the first would be invalid markup
   * and unreachable by keyboard, so the mark is a button and the details are
   * its sibling, described by `aria-controls`.
   */
  private _buildSiteElement(site: SentrySite): HTMLElement {
    const element = document.createElement('div')
    element.className = 'sentry-map-marker'

    const flyoutId = `sentry-site-flyout-${site.id}`
    const mark = document.createElement('button')
    mark.type = 'button'
    mark.className = 'sentry-map-marker-mark'
    mark.setAttribute('aria-label', `Sentry ${siteLabel(site)} — show details`)
    mark.setAttribute('aria-expanded', 'false')
    mark.setAttribute('aria-controls', flyoutId)
    mark.innerHTML = buildLocationMarkerSvg(SENTRY_MARKER_DOT_COLOR)
    // Press latches the details open, so they can be read (and their MORE
    // action reached) without holding the pointer over the marker. Hover and
    // keyboard focus reveal them too, but only for as long as they last — see
    // the `:hover`/`:focus-within` rules in MapLibreMap.vue.
    mark.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      this._toggleFlyout(element)
    })
    element.appendChild(mark)

    element.appendChild(this._buildFlyout(site, flyoutId))
    return element
  }

  /**
   * One site's details, drawn as the pill the map's own right-click menu uses:
   * a black panel butted against the ⊙ mark, with a circle masked out of its
   * leading edge so the mark stays whole and the two read as one object.
   *
   * Deliberately short — name, where it answers, whether it is up, and a way
   * through. Everything else Sentinel knows about a Sentry already has a home
   * in Settings → SDR, so this hands the operator over rather than reproducing
   * that view over the map it is covering.
   */
  private _buildFlyout(site: SentrySite, flyoutId: string): HTMLElement {
    const flyout = document.createElement('div')
    flyout.className = 'sentry-map-marker-info'
    flyout.id = flyoutId

    const name = document.createElement('span')
    name.className = 'sentry-map-marker-name'
    name.textContent = siteLabel(site)
    flyout.appendChild(name)

    const meta = document.createElement('span')
    meta.className = 'sentry-map-marker-meta'
    const statusDot = document.createElement('span')
    statusDot.className = `sentry-map-marker-status sentry-map-marker-status--${
      site.reachable ? 'online' : 'offair'
    }`
    // Never state by colour alone (WCAG 1.4.1): the dot carries a tooltip and a
    // visually-hidden label saying the same thing in words.
    const statusText = site.reachable ? 'Online' : 'Off air'
    statusDot.title = statusText
    const statusLabel = document.createElement('span')
    statusLabel.className = 'sr-only'
    statusLabel.textContent = statusText
    statusDot.appendChild(statusLabel)
    meta.appendChild(statusDot)
    meta.appendChild(document.createTextNode(`${site.address}:${site.port}`))
    flyout.appendChild(meta)

    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'sentry-map-marker-more'
    more.textContent = 'MORE'
    more.setAttribute('aria-label', `Open ${siteLabel(site)} in Settings`)
    more.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      this._closeFlyout()
      this._settingsStore.openSentryHost(site.id)
    })
    flyout.appendChild(more)

    return flyout
  }

  /** Latch one site's details open, closing whichever was open before — two
   *  panels over the map at once would overlap each other's markers. */
  private _toggleFlyout(element: HTMLElement): void {
    const alreadyOpen = this._openFlyout === element
    this._closeFlyout()
    if (alreadyOpen) return
    element.classList.add('sentry-map-marker--open')
    element.querySelector('.sentry-map-marker-mark')?.setAttribute('aria-expanded', 'true')
    this._openFlyout = element
  }

  private _closeFlyout(): void {
    if (!this._openFlyout) return
    this._openFlyout.classList.remove('sentry-map-marker--open')
    this._openFlyout
      .querySelector('.sentry-map-marker-mark')
      ?.setAttribute('aria-expanded', 'false')
    this._openFlyout = null
  }

  /** Place (or move) the count standing for a group of sites, and zoom in on
   *  the group when it is clicked. */
  private _syncClusterMarker(cluster: SentryCluster): void {
    const coords: [number, number] = [cluster.longitude, cluster.latitude]
    const existing = this._clusterMarkers.get(cluster.key)
    if (existing && this._clusterCounts.get(cluster.key) === cluster.sites.length) {
      existing.setLngLat(coords)
      return
    }
    existing?.remove()
    const countLabel = `${cluster.sites.length} Sentry sites here — zoom in to see them`
    const element = buildCountMarker({
      count: cluster.sites.length,
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
      this.map.easeTo({
        center: coords,
        zoom: Math.min(this.map.getZoom() + CLUSTER_ZOOM_STEP, CLUSTER_ZOOM_MAX),
        duration: 300,
      })
    })
    const marker = new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat(coords)
      .addTo(this.map)
    setMarkerAccessibleName(marker, countLabel)
    this._clusterMarkers.set(cluster.key, marker)
    this._clusterCounts.set(cluster.key, cluster.sites.length)
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
    this._closeFlyout()
    for (const marker of this._markers.values()) marker.remove()
    this._markers.clear()
    for (const marker of this._clusterMarkers.values()) marker.remove()
    this._clusterMarkers.clear()
    this._clusterCounts.clear()
  }
}

/** A group of sites too close together to tell apart at this zoom. */
interface SentryCluster {
  key: string
  sites: SentrySite[]
  /** Where the count sits — the first site's position. */
  longitude: number
  latitude: number
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
 * Black, against the lit accent dot the operator's own location marker carries
 * (`LOCATION_MARKER_DOT_COLOR`, #c8ff00): unmistakable side by side, and it
 * reads as a fixed installation rather than as a live position. The white ring
 * is shared and deliberately untouched — the mark is the same mark; only whose
 * place it is changes.
 */
const SENTRY_MARKER_DOT_COLOR = '#000000'

/** How close two sites must be to share a count, in pixels — the ⊙ mark's own
 *  ring diameter, so sites are grouped exactly when their marks would overlap. */
const SITE_GROUP_RADIUS_PX = 30

/** How far in one click on a count goes, in zoom levels. Three steps splits a
 *  typical huddle without throwing the operator down to street level. */
const CLUSTER_ZOOM_STEP = 3

/** Ceiling for that zoom: two Sentries in the same building never separate, and
 *  zooming past this would just leave an empty map around one count. */
const CLUSTER_ZOOM_MAX = 14

/** Ring around a Sentry count marker — the same nearly-black, semitransparent
 *  ring the APRS counts use, so a count reads the same wherever it appears. */
const SENTRY_COUNT_RING = 'rgba(20, 23, 28, 0.55)'

/** Fill of a Sentry count marker's centre. */
const SENTRY_COUNT_FILL = '#000000'

/** Colour of the count itself. White, not the site dot's black: the count sits
 *  on a black centre, so following the dot would leave it invisible. */
const SENTRY_COUNT_TEXT = '#ffffff'
