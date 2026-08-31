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
 * own location uses, its dot shifted a step cooler so that on a map showing both
 * a site is not mistaken for where the operator is standing — and sites too
 * close together to tell apart collapse into
 * one numbered count that zooms in when clicked — the same treatment crowded
 * APRS stations get on the Land map, from the same shared clustering module.
 * Clicking a site opens its name and a MORE action that lands on that host's
 * row in Settings → SDR.
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
  private _popup: maplibregl.Popup | null = null
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
    // MapLibre's popup has no Escape handling of its own, and a click-opened
    // panel that traps the operator would fail keyboard operability (WCAG 2.1.2).
    this._onDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this._closePopup()
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
    if (!visible) this._closePopup()
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
    this._closePopup()
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
    // After addTo: MapLibre replaces the element's aria-label with its own
    // generic "Map marker" as it adds one, so the site's name is put back.
    setMarkerAccessibleName(marker, `Sentry ${siteLabel(site)} — show details`)
    this._markers.set(site.id, marker)
  }

  /**
   * The marker for one site: the SENTINEL ⊙ mark, as a button.
   *
   * A button rather than the plain `div` the user-location marker uses, because
   * this one is operable — it opens the site's details — and so has to be
   * reachable and activatable from the keyboard as well as the pointer.
   */
  private _buildSiteElement(site: SentrySite): HTMLElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'sentry-map-marker'
    element.setAttribute('aria-label', `Sentry ${siteLabel(site)} — show details`)
    element.innerHTML = buildLocationMarkerSvg(SENTRY_MARKER_DOT_COLOR)
    element.addEventListener('click', (domEvent: Event) => {
      domEvent.stopPropagation()
      this._openPopup(site)
    })
    return element
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

  // ── the site popup ─────────────────────────────────────────────────────────

  /**
   * Open one site's details beside its marker: what it is called, where it
   * answers, whether it is currently reachable, and a way through to the rest.
   *
   * Deliberately short. Everything else Sentinel knows about a Sentry already
   * has a home in Settings → SDR, so this names the host and hands the operator
   * over rather than reproducing that view over the map it is covering.
   */
  private _openPopup(site: SentrySite): void {
    this._closePopup()
    const content = document.createElement('div')
    content.className = 'sentry-site-popup-body'

    const name = document.createElement('p')
    name.className = 'sentry-site-popup-name'
    name.textContent = siteLabel(site)
    content.appendChild(name)

    const meta = document.createElement('p')
    meta.className = 'sentry-site-popup-meta'
    meta.textContent = `${site.address}:${site.port} · ${site.reachable ? 'ONLINE' : 'OFF AIR'}`
    content.appendChild(meta)

    const moreButton = document.createElement('button')
    moreButton.type = 'button'
    moreButton.className = 'sentry-site-popup-more'
    moreButton.textContent = 'MORE'
    moreButton.setAttribute('aria-label', `Open ${siteLabel(site)} in Settings`)
    moreButton.addEventListener('click', () => {
      this._closePopup()
      this._settingsStore.openSentryHost(site.id)
    })
    content.appendChild(moreButton)

    this._popup = new maplibregl.Popup({
      className: 'sentry-site-popup',
      // Clear of the ⊙ mark's ring, so the popup points at the site rather than
      // sitting on top of it.
      offset: SITE_POPUP_OFFSET_PX,
      closeOnClick: true,
      ...this._popupAnchor(site),
    })
      .setLngLat([site.longitude, site.latitude])
      .setDOMContent(content)
      .addTo(this.map)
  }

  /**
   * Pin the popup below a site sitting high on screen, rather than leaving the
   * side to MapLibre.
   *
   * MapLibre picks the side with room inside the *map container*, and the
   * container runs the full height of the window with the app's fixed header
   * drawn over its top — so for a site near the top it finds room that is in
   * fact covered, and opens a popup the header hides. Anywhere else its own
   * choice is the better one, so this returns nothing and lets it decide.
   */
  private _popupAnchor(site: SentrySite): { anchor?: 'top' } {
    const projected = this.map.project([site.longitude, site.latitude])
    const containerTop = this.map.getContainer().getBoundingClientRect().top
    const spaceAbove = containerTop + projected.y - headerHeightPx()
    return spaceAbove < POPUP_CLEARANCE_PX ? { anchor: 'top' } : {}
  }

  private _closePopup(): void {
    this._popup?.remove()
    this._popup = null
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
 * A cooler, slightly deeper green than the app accent the operator's own
 * location marker uses (`LOCATION_MARKER_DOT_COLOR`, #c8ff00): far enough over
 * to separate the two side by side, close enough that a site still reads as one
 * of Sentinel's own marks rather than as a warning. The white ring is shared and
 * deliberately untouched — the mark is the same mark; only whose place it is
 * changes.
 */
const SENTRY_MARKER_DOT_COLOR = '#3ce0a0'

/** How close two sites must be to share a count, in pixels — the ⊙ mark's own
 *  ring diameter, so sites are grouped exactly when their marks would overlap. */
const SITE_GROUP_RADIUS_PX = 30

/** How far in one click on a count goes, in zoom levels. Three steps splits a
 *  typical huddle without throwing the operator down to street level. */
const CLUSTER_ZOOM_STEP = 3

/** Ceiling for that zoom: two Sentries in the same building never separate, and
 *  zooming past this would just leave an empty map around one count. */
const CLUSTER_ZOOM_MAX = 14

/**
 * Height to keep clear above a site before its popup is forced below it.
 *
 * A little more than the popup itself stands, so the decision is made on
 * whether the whole thing fits rather than on where its top edge lands.
 */
const POPUP_CLEARANCE_PX = 130

/** Height of the app's fixed header, which is drawn over the map's top edge.
 *  Read from the same custom property the layout uses, so the two cannot drift;
 *  the fallback is that property's own desktop value. */
function headerHeightPx(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--nav-height')
  const parsed = Number.parseFloat(declared)
  return Number.isFinite(parsed) ? parsed : DEFAULT_HEADER_HEIGHT_PX
}

const DEFAULT_HEADER_HEIGHT_PX = 68

/** Popup offset from the site's position, clearing the ⊙ mark's ring. */
const SITE_POPUP_OFFSET_PX = 18

/** Ring around a Sentry count marker — the same nearly-black, semitransparent
 *  ring the APRS counts use, so a count reads the same wherever it appears. */
const SENTRY_COUNT_RING = 'rgba(20, 23, 28, 0.55)'

/** Fill of a Sentry count marker's centre. */
const SENTRY_COUNT_FILL = '#000000'

/** Colour of the count itself — a site's own dot colour, so a group of Sentries
 *  is recognisably the same thing as the marks it stands in for. */
const SENTRY_COUNT_TEXT = SENTRY_MARKER_DOT_COLOR
