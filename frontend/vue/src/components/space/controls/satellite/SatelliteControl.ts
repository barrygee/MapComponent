import maplibregl from 'maplibre-gl'
import { SentinelControlBase } from '../../../air/controls/sentinel-control-base/SentinelControlBase'
import type { useSpaceStore } from '@/stores/space'
import type { useNotificationsStore } from '@/stores/notifications'
import type { useTrackingStore } from '@/stores/tracking'

type SpaceStore        = ReturnType<typeof useSpaceStore>
type NotificationsStore = ReturnType<typeof useNotificationsStore>
type TrackingStore     = ReturnType<typeof useTrackingStore>

interface IssPosition {
    lon: number; lat: number; alt_km: number; velocity_kms: number; track_deg: number
}
interface IssApiResponse {
    error?: string
    position: IssPosition
    ground_track: GeoJSON.FeatureCollection
    footprint: [number, number][]
}
interface IssPass {
    aos_utc: string; los_utc: string
    aos_unix_ms: number; los_unix_ms: number
    duration_s: number; max_elevation_deg: number; max_el_utc: string
}
interface IssPassesApiResponse {
    passes: IssPass[]; obs_lat: number; obs_lon: number
    lookahead_hours: number; computed_at: string; error?: string
}

export class SatelliteControl extends SentinelControlBase {
    issVisible:       boolean
    trackVisible:     boolean
    footprintVisible: boolean

    private _spaceStore:         SpaceStore
    private _notificationsStore: NotificationsStore
    private _trackingStore:      TrackingStore
    private _isGlobeActive:      () => boolean
    private _getUserLocation:    () => [number, number] | null
    private _onSwitchSat:        ((noradId: string, name: string) => void) | null

    private _pollInterval:    ReturnType<typeof setInterval> | null = null
    private _tagMarker:       maplibregl.Marker | null = null
    private _hoverTagMarker:  maplibregl.Marker | null = null
    _lastPosition:            IssPosition | null = null
    private _labelMarker:     maplibregl.Marker | null = null
    _followEnabled            = false
    private _trackingRestored = false
    private _hoverHideTimer:  ReturnType<typeof setTimeout> | null = null
    _activeNoradId            = '25544'
    _activeSatName            = 'ISS'

    private _issGeojson:       GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    private _trackGeojson:     GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    private _footprintGeojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

    private _passNotifEnabled   = false
    private _trackingNotifId:   string | null = null
    private _passNotifTimeout:  ReturnType<typeof setTimeout> | null = null
    private _passRefreshInterval: ReturnType<typeof setInterval> | null = null
    private _lastFiredPassAos   = 0
    _previewNoradId:            string | null = null
    private _previewAbort:      AbortController | null = null

    constructor(
        spaceStore: SpaceStore,
        notificationsStore: NotificationsStore,
        trackingStore: TrackingStore,
        isGlobeActive: () => boolean,
        getUserLocation: () => [number, number] | null,
        onSwitchSat: ((noradId: string, name: string) => void) | null = null,
    ) {
        super()
        this._spaceStore         = spaceStore
        this._notificationsStore = notificationsStore
        this._trackingStore      = trackingStore
        this._isGlobeActive      = isGlobeActive
        this._getUserLocation    = getUserLocation
        this._onSwitchSat        = onSwitchSat
        this.issVisible          = spaceStore.overlayStates.iss
        // ground track and footprint are not stored separately in the new store, default to true
        this.trackVisible        = true
        this.footprintVisible    = true
        this._restorePassNotifState()
    }

    get buttonLabel(): string {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="4" height="4" fill="#c8ff00"/>
            <rect x="2" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <rect x="15" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <line x1="12" y1="2" x2="12" y2="8" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
            <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
        </svg>`
    }
    get buttonTitle(): string { return 'Toggle ISS tracking' }

    protected onInit(): void {
        this.setButtonActive(this.issVisible)
        if (this.map.isStyleLoaded()) this.initLayers()
        else this.map.once('style.load', () => this.initLayers())
    }

    protected handleClick(): void { this.toggleIss() }

    onRemove(): void {
        this._stopPolling()
        // Deactivate (not unregister) so the tracked sat stays visible in the
        // tracking panel as a read-only item when navigating to another section.
        if (this._followEnabled) {
            this._followEnabled = false
            if (this._trackingNotifId) { this._notificationsStore.dismiss(this._trackingNotifId); this._trackingNotifId = null }
            this._trackingStore.deactivate('space')
        }
        this._hideHoverTagNow()
        this._hideLabel()
        if (this._passNotifTimeout)    { clearTimeout(this._passNotifTimeout);     this._passNotifTimeout = null }
        if (this._passRefreshInterval) { clearInterval(this._passRefreshInterval); this._passRefreshInterval = null }
        super.onRemove()
    }

    // ---- Projection helpers ----
    private static _normLon(lon: number): number {
        return ((lon % 360) + 540) % 360 - 180
    }

    private static _unwrapRing(coords: [number, number][]): [number, number][] {
        const out: [number, number][] = []
        let prev: number | null = null; let acc = 0
        for (const [lon, lat] of coords) {
            if (prev === null) { acc = lon } else { acc += ((lon - prev + 180) % 360 - 180) }
            out.push([acc, lat])
            prev = lon
        }
        return out
    }

    private static _splitRingForGlobe(coords: [number, number][]): [number, number][][] {
        const segments: [number, number][][] = []
        let seg: [number, number][] = []
        let prevNorm: number | null = null; let prevLat: number | null = null
        for (const [lon, lat] of coords) {
            const norm = SatelliteControl._normLon(lon)
            if (prevNorm !== null && prevLat !== null &&
                ((prevNorm > 90 && norm < -90) || (prevNorm < -90 && norm > 90))) {
                const crossLon = prevNorm > 0 ? 180 : -180
                const t = (crossLon - prevNorm) / (norm + (prevNorm > 0 ? 360 : -360) - prevNorm)
                const crossLat = prevLat + t * (lat - prevLat)
                seg.push([crossLon, crossLat])
                segments.push(seg)
                seg = [[-crossLon, crossLat]]
            }
            seg.push([norm, lat])
            prevNorm = norm; prevLat = lat
        }
        if (seg.length) segments.push(seg)
        return segments
    }

    private _trackForProjection(track: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        if (!this._isGlobeActive()) return track
        const out: GeoJSON.Feature[] = []
        for (const feat of track.features) {
            if (feat.geometry.type !== 'LineString') { out.push(feat); continue }
            const segs = SatelliteControl._splitRingForGlobe(feat.geometry.coordinates as [number, number][])
            for (const s of segs) {
                if (s.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: s }, properties: feat.properties })
            }
        }
        return { type: 'FeatureCollection', features: out }
    }

    private _footprintForProjection(fp: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
        if (!this._isGlobeActive()) return fp
        const out: GeoJSON.Feature[] = []
        for (const feat of fp.features) {
            if (feat.geometry.type === 'LineString') {
                const segs = SatelliteControl._splitRingForGlobe(feat.geometry.coordinates as [number, number][])
                for (const s of segs) {
                    if (s.length >= 2) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: s }, properties: feat.properties })
                }
            } else {
                out.push(feat)
            }
        }
        return { type: 'FeatureCollection', features: out }
    }

    // ---- Canvas sprite factories ----
    private _createSatelliteIcon(): ImageData {
        const size = 96; const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')!
        const cx = size / 2, cy = size / 2
        ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx + 9, cy)
        ctx.lineTo(cx, cy + 11); ctx.lineTo(cx - 9, cy); ctx.closePath()
        ctx.fillStyle = '#ffffff'; ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fillRect(cx - 28, cy - 4, 15, 8); ctx.fillRect(cx + 13, cy - 4, 15, 8)
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy - 21); ctx.stroke()
        return ctx.getImageData(0, 0, size, size)
    }

    private _createSatBracket(): ImageData {
        const size = 96; const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')!
        const left = 8, top = 8, right = 88, bottom = 88, arm = 14
        ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(left, top, right - left, bottom - top)
        ctx.strokeStyle = '#c8ff00'; ctx.lineWidth = 2.5; ctx.lineCap = 'square'
        ;([
            [left, top, 1, 1], [right, top, -1, 1],
            [left, bottom, 1, -1], [right, bottom, -1, -1],
        ] as [number, number, number, number][]).forEach(([x, y, dx, dy]) => {
            ctx.beginPath(); ctx.moveTo(x + dx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * arm); ctx.stroke()
        })
        return ctx.getImageData(0, 0, size, size)
    }

    // ---- Layer init ----
    initLayers(): void {
        ;['iss-track-past', 'iss-track-future', 'iss-track-orbit1', 'iss-track-orbit2',
          'iss-footprint-fill-outer', 'iss-footprint-fill-mid', 'iss-footprint-fill-inner', 'iss-footprint-fill-core',
          'iss-footprint-fill', 'iss-footprint', 'iss-bracket', 'iss-icon'].forEach(id => { if (this.map.getLayer(id)) this.map.removeLayer(id) })
        ;['iss-track-source', 'iss-footprint-source', 'iss-live'].forEach(id => {
            try { if (this.map.getSource(id)) this.map.removeSource(id) } catch {}
        })
        ;['iss-icon-sprite', 'iss-bracket-sprite'].forEach(n => {
            if (this.map.hasImage(n)) this.map.removeImage(n)
        })
        this.map.addImage('iss-icon-sprite',    this._createSatelliteIcon(), { pixelRatio: 2, sdf: false })
        this.map.addImage('iss-bracket-sprite', this._createSatBracket(),    { pixelRatio: 2, sdf: false })

        const trackVis = (this.issVisible && this.trackVisible)     ? 'visible' : 'none'
        const fpVis    = (this.issVisible && this.footprintVisible)  ? 'visible' : 'none'
        const issVis   = this.issVisible ? 'visible' : 'none'

        this.map.addSource('iss-track-source',     { type: 'geojson', data: this._trackGeojson })
        this.map.addSource('iss-footprint-source', { type: 'geojson', data: this._footprintGeojson })
        this.map.addSource('iss-live',             { type: 'geojson', data: this._issGeojson })

        this.map.addLayer({
            id: 'iss-track-orbit1', type: 'line', source: 'iss-track-source',
            filter: ['==', ['get', 'track'], 'orbit1'],
            layout: { visibility: trackVis },
            paint: { 'line-color': '#c8ff00', 'line-width': 1.5, 'line-opacity': 0.80 },
        })
        this.map.addLayer({
            id: 'iss-track-orbit2', type: 'line', source: 'iss-track-source',
            filter: ['==', ['get', 'track'], 'orbit2'],
            layout: { visibility: trackVis },
            paint: { 'line-color': '#c8ff00', 'line-width': 1.5, 'line-opacity': 0.45 },
        })
        this.map.addLayer({
            id: 'iss-footprint-fill', type: 'fill', source: 'iss-footprint-source',
            filter: ['==', ['geometry-type'], 'Polygon'],
            layout: { visibility: fpVis },
            paint: { 'fill-color': 'rgba(0,0,0,0.22)' },
        })
        this.map.addLayer({
            id: 'iss-footprint', type: 'line', source: 'iss-footprint-source',
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { visibility: fpVis },
            paint: { 'line-color': '#000000', 'line-width': 1.2 },
        })
        this.map.addLayer({
            id: 'iss-bracket', type: 'symbol', source: 'iss-live',
            layout: {
                visibility: issVis,
                'icon-image': 'iss-bracket-sprite', 'icon-size': 0.75,
                'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true, 'icon-ignore-placement': true,
            },
        })
        this.map.addLayer({
            id: 'iss-icon', type: 'symbol', source: 'iss-live',
            layout: {
                visibility: issVis,
                'icon-image': 'iss-icon-sprite', 'icon-size': 0.75,
                'icon-rotate': ['get', 'track_deg'],
                'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
                'icon-allow-overlap': true, 'icon-ignore-placement': true,
            },
        })

        this.map.on('mouseenter', 'iss-icon',    (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e) })
        this.map.on('mouseenter', 'iss-bracket', (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e) })
        this.map.on('mouseleave', 'iss-icon',    () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag() })
        this.map.on('mouseleave', 'iss-bracket', () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag() })

        // Start polling after layers are ready
        this._fetch()
        this._startPolling()
    }

    // ---- No TLE overlay ----
    private _showNoTleOverlay(): void { document.getElementById('no-tle-overlay')?.classList.remove('hidden') }
    private _hideNoTleOverlay(): void { document.getElementById('no-tle-overlay')?.classList.add('hidden') }

    // ---- Data fetch ----
    async _fetch(): Promise<void> {
        try {
            const url = this._activeNoradId === '25544'
                ? '/api/space/iss'
                : `/api/space/satellite/${this._activeNoradId}`
            const resp = await fetch(url)
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({})) as { no_tle_data?: boolean }
                if (body.no_tle_data) this._showNoTleOverlay()
                return
            }
            const data = await resp.json() as IssApiResponse
            if (data.error) return
            this._hideNoTleOverlay()

            const { position, ground_track, footprint } = data
            this._lastPosition = position

            this._issGeojson = {
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
                    properties: { alt_km: position.alt_km, velocity_kms: position.velocity_kms, track_deg: position.track_deg } }],
            }
            this._trackGeojson = ground_track

            const fpUnwrapped = SatelliteControl._unwrapRing(footprint as [number, number][])
            this._footprintGeojson = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: fpUnwrapped }, properties: {} },
                    { type: 'Feature', geometry: { type: 'Polygon',    coordinates: [fpUnwrapped] }, properties: {} },
                ],
            }

            if (!this._previewNoradId) {
                const issSource   = this.map?.getSource('iss-live')             as maplibregl.GeoJSONSource | undefined
                const trackSource = this.map?.getSource('iss-track-source')     as maplibregl.GeoJSONSource | undefined
                const fpSource    = this.map?.getSource('iss-footprint-source') as maplibregl.GeoJSONSource | undefined
                if (issSource)   issSource.setData(this._issGeojson)
                if (trackSource) trackSource.setData(this._trackForProjection(this._trackGeojson))
                if (fpSource)    fpSource.setData(this._footprintForProjection(this._footprintGeojson))
            }

            if (!this._trackingRestored) {
                this._trackingRestored = true
                if (this._passNotifEnabled) this._startPassNotifPolling()
            }

            if (!this._previewNoradId) {
                if (this.issVisible && !this._hoverTagMarker && !this._followEnabled) {
                    this._showLabel(position.lon, position.lat)
                } else if (this.issVisible && this._labelMarker) {
                    this._labelMarker.setLngLat([position.lon, position.lat])
                }
            }
            if (this._hoverTagMarker) {
                this._hoverTagMarker.setLngLat([position.lon, position.lat])
                this._updateHoverTagContent(position)
            }
            if (this._followEnabled && !this._previewNoradId) {
                if (!this._labelMarker) {
                    // First position after a satellite switch — re-initialise the follow UI and tracking panel
                    this._followEnabled = false
                    this._startFollowing()
                } else {
                    this._labelMarker.setLngLat([position.lon, position.lat])
                    this.map.easeTo({ center: [position.lon, position.lat], duration: 150, easing: (t: number) => t })
                    this._updateStatusBar(position)
                }
            }

            // Emit for SatInfoPanel — include noradId so accordions can match without tracking satellite-selected
            document.dispatchEvent(new CustomEvent('iss-position-update', { detail: { ...position, noradId: this._activeNoradId } }))

        } catch {}
    }

    _startPolling(): void {
        if (this._pollInterval) return
        this._pollInterval = setInterval(() => this._fetch(), 5000)
    }
    private _stopPolling(): void {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null }
    }

    // ---- Label ----
    private _buildLabelEl(isTracking = false): HTMLDivElement {
        const el = document.createElement('div')
        el.className = 'iss-label' + (isTracking ? ' iss-label--tracking' : '')
        const nameSpan = document.createElement('span')
        nameSpan.textContent = this._activeSatName
        el.appendChild(nameSpan)
        if (isTracking) {
            const trkSpan = document.createElement('span')
            trkSpan.className = 'iss-tracking-badge'
            trkSpan.textContent = 'TRACKING'
            el.addEventListener('mouseenter', () => { trkSpan.textContent = 'UNTRACK' })
            el.addEventListener('mouseleave', () => { trkSpan.textContent = 'TRACKING' })
            el.appendChild(trkSpan)
        }
        return el
    }

    private _showLabel(lon: number, lat: number): void {
        if (this._labelMarker) { this._labelMarker.setLngLat([lon, lat]); return }
        const el = this._buildLabelEl(false)
        this._labelMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [26, 0] })
            .setLngLat([lon, lat]).addTo(this.map)
    }

    private _hideLabel(): void {
        if (this._labelMarker) { this._labelMarker.remove(); this._labelMarker = null }
    }

    // ---- Hover tag ----
    private _tagHTML(p: IssPosition, isTracking: boolean): string {
        const trkText  = isTracking ? 'TRACKING' : 'TRACK'
        const trkClass = isTracking ? 'iss-track-btn iss-track-btn--active' : 'iss-track-btn'
        const bellSlash = this._passNotifEnabled ? '' :
            `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`
        const bellClass = this._passNotifEnabled ? 'iss-notif-btn iss-notif-btn--active' : 'iss-notif-btn'
        const rows: [string, string][] = [
            ['ALT', `${p.alt_km} km`], ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`], ['LAT', `${p.lat}°`], ['LON', `${p.lon}°`],
        ]
        const rowsHTML = rows.map(([lbl, val]) =>
            `<div class="iss-tag-row"><span class="iss-tag-lbl">${lbl}</span><span class="iss-tag-val" data-field="${lbl}">${val}</span></div>`
        ).join('')
        return `<div class="iss-tag">` +
            `<div class="iss-tag-header"><span class="iss-tag-name">${this._activeSatName}</span>` +
            `<div class="iss-tag-actions">` +
            `<button class="${bellClass}" aria-label="Toggle pass notifications">` +
            `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
            `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
            bellSlash + `</svg></button>` +
            `<button class="${trkClass}">${trkText}</button></div></div>` +
            `<div class="iss-tag-rows">${rowsHTML}</div></div>`
    }

    private _showHoverTag(e: maplibregl.MapLayerMouseEvent): void {
        if (!e.features?.length) return
        if (this._followEnabled) return
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null }
        if (this._hoverTagMarker) return

        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        const props: IssPosition = this._lastPosition
            ? { ...this._lastPosition }
            : { ...(e.features[0].properties as Omit<IssPosition, 'lat' | 'lon'>), lon: coords[0], lat: coords[1] }

        if (this._labelMarker) this._labelMarker.getElement().classList.add('iss-label--hidden')
        const el = document.createElement('div')
        el.className = 'iss-tag-wrap'
        el.innerHTML = this._tagHTML(props, false)
        el.addEventListener('mouseenter', () => { if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null } })
        el.addEventListener('mouseleave', () => this._scheduleHideHoverTag())
        this._wireTrackButton(el, props)
        this._wireNotifButton(el)

        const markerCoords: [number, number] = this._lastPosition
            ? [this._lastPosition.lon, this._lastPosition.lat] : coords
        this._hoverTagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [26, -13] })
            .setLngLat(markerCoords).addTo(this.map)
    }

    private _scheduleHideHoverTag(): void {
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer)
        this._hoverHideTimer = setTimeout(() => { this._hoverHideTimer = null; this._hideHoverTagNow() }, 400)
    }

    private _hideHoverTagNow(): void {
        if (this._hoverTagMarker) { this._hoverTagMarker.remove(); this._hoverTagMarker = null }
        if (!this._followEnabled && this._labelMarker) {
            this._labelMarker.getElement().classList.remove('iss-label--hidden')
        }
    }

    private _updateHoverTagContent(position: IssPosition): void {
        if (!this._hoverTagMarker) return
        const el = this._hoverTagMarker.getElement()
        const vals: Record<string, string> = {
            ALT: `${position.alt_km} km`, VEL: `${position.velocity_kms} km/s`,
            HDG: `${position.track_deg}°`, LAT: `${position.lat}°`, LON: `${position.lon}°`,
        }
        el.querySelectorAll<HTMLElement>('.iss-tag-val').forEach(span => {
            const field = span.dataset['field']
            if (field && vals[field] !== undefined) span.textContent = vals[field]
        })
    }

    private _wireTrackButton(el: HTMLElement, _props: IssPosition): void {
        const btn = el.querySelector('.iss-track-btn')
        if (!btn) return
        btn.addEventListener('mousedown', (e) => e.stopPropagation())
        btn.addEventListener('click', (e) => { e.stopPropagation(); this._hideHoverTagNow(); this._startFollowing() })
    }

    // ---- Pass notifications ----
    private _passNotifKey(): string { return `passNotifEnabled_${this._activeNoradId}` }

    private _restorePassNotifState(): void {
        try { this._passNotifEnabled = localStorage.getItem(this._passNotifKey()) === '1' } catch {}
    }

    private _savePassNotifState(): void {
        try {
            if (this._passNotifEnabled) localStorage.setItem(this._passNotifKey(), '1')
            else localStorage.removeItem(this._passNotifKey())
        } catch {}
    }

    private _wireNotifButton(el: HTMLElement): void {
        const btn = el.querySelector('.iss-notif-btn')
        if (!btn) return
        btn.addEventListener('mousedown', (e) => e.stopPropagation())
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            this._togglePassNotif()
            const svg = btn.querySelector('svg')
            if (svg) {
                ;(btn as HTMLElement).classList.toggle('iss-notif-btn--active', this._passNotifEnabled)
                const existingSlash = svg.querySelector('line')
                if (this._passNotifEnabled && existingSlash) existingSlash.remove()
                else if (!this._passNotifEnabled && !existingSlash) {
                    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'line')
                    slash.setAttribute('x1', '1.5'); slash.setAttribute('y1', '1.5')
                    slash.setAttribute('x2', '11.5'); slash.setAttribute('y2', '11.5')
                    slash.setAttribute('stroke', 'currentColor'); slash.setAttribute('stroke-width', '1.5')
                    slash.setAttribute('stroke-linecap', 'square')
                    svg.appendChild(slash)
                }
            }
        })
    }

    private _togglePassNotif(): void {
        if (this._passNotifEnabled) {
            this._passNotifEnabled = false; this._lastFiredPassAos = 0
            if (this._passNotifTimeout)    { clearTimeout(this._passNotifTimeout);     this._passNotifTimeout = null }
            if (this._passRefreshInterval) { clearInterval(this._passRefreshInterval); this._passRefreshInterval = null }
            this._savePassNotifState()
            this._notificationsStore.add({ type: 'notif-off', title: this._activeSatName, detail: 'Pass notifications disabled' })
        } else {
            const loc = this._getUserLocation()
            if (!loc) {
                const poller = setInterval(() => {
                    const l = this._getUserLocation()
                    if (l) {
                        clearInterval(poller); this._passNotifEnabled = true
                        this._savePassNotifState(); this._startPassNotifPolling()
                    }
                }, 500)
                setTimeout(() => clearInterval(poller), 30000)
                return
            }
            this._passNotifEnabled = true; this._savePassNotifState(); this._startPassNotifPolling()
            this._notificationsStore.add({
                type: 'tracking', title: this._activeSatName, detail: 'Pass notifications enabled',
                action: { label: 'DISABLE NOTIFICATIONS', callback: () => {
                    this._passNotifEnabled = true; this._togglePassNotif()
                }},
            })
        }
    }

    private _startPassNotifPolling(): void {
        this._fetchAndSchedulePasses()
        if (this._passRefreshInterval) clearInterval(this._passRefreshInterval)
        this._passRefreshInterval = setInterval(() => this._fetchAndSchedulePasses(), 5 * 60 * 1000)
    }

    private async _fetchAndSchedulePasses(): Promise<void> {
        const loc = this._getUserLocation()
        if (!loc) return
        const [lon, lat] = loc
        try {
            const endpoint = this._activeNoradId === '25544'
                ? `/api/space/iss/passes?lat=${lat}&lon=${lon}&hours=24`
                : `/api/space/satellite/${this._activeNoradId}/passes?lat=${lat}&lon=${lon}&hours=24`
            const resp = await fetch(endpoint)
            if (!resp.ok) return
            const data = await resp.json() as IssPassesApiResponse
            if (data.error || !data.passes) return
            this._schedulePassNotification(data.passes)
        } catch {}
    }

    private _schedulePassNotification(passes: IssPass[]): void {
        if (this._passNotifTimeout) { clearTimeout(this._passNotifTimeout); this._passNotifTimeout = null }
        if (!this._passNotifEnabled) return
        const now = Date.now(); const leadMs = 10 * 60 * 1000
        const next = passes.find(p => p.aos_unix_ms > now)
        if (!next) return
        const delay = (next.aos_unix_ms - leadMs) - now
        if (delay < 0) {
            if (this._lastFiredPassAos !== next.aos_unix_ms) {
                this._lastFiredPassAos = next.aos_unix_ms; this._firePassNotification(next)
            }
            const remaining = passes.filter(p => p.aos_unix_ms > now + 60000)
            if (remaining.length > 0) this._schedulePassNotification(remaining)
            return
        }
        this._passNotifTimeout = setTimeout(() => {
            this._passNotifTimeout = null
            if (!this._passNotifEnabled) return
            this._lastFiredPassAos = next.aos_unix_ms; this._firePassNotification(next)
            const remaining = passes.filter(p => p.aos_unix_ms > next.aos_unix_ms + 60000)
            if (remaining.length > 0) this._schedulePassNotification(remaining)
            else this._fetchAndSchedulePasses()
        }, delay)
    }

    private _firePassNotification(pass: IssPass): void {
        const aosDate = new Date(pass.aos_unix_ms)
        const aosTime = aosDate.toUTCString().slice(17, 22) + ' UTC'
        this._notificationsStore.add({
            type: 'tracking', title: `${this._activeSatName} PASS`,
            detail: `AOS ~10 min — max ${pass.max_elevation_deg}° elev at ${aosTime}`,
            action: { label: 'DISABLE', callback: () => { this._passNotifEnabled = true; this._togglePassNotif() } },
        })
    }

    // ---- Following ----
    private _startFollowing(_restoring = false): void {
        if (!this._lastPosition) return
        this._followEnabled = true
        const pos = this._lastPosition
        const coords: [number, number] = [pos.lon, pos.lat]
        const newLabelEl = this._buildLabelEl(true)
        newLabelEl.addEventListener('click', (e) => { e.stopPropagation(); this._stopFollowing() })
        if (this._labelMarker) this._labelMarker.remove()
        this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
            .setLngLat(coords).addTo(this.map)
        this.map.easeTo({ center: coords, duration: 600 })
        this._showStatusBar(pos)
        if (this._trackingNotifId) { this._notificationsStore.dismiss(this._trackingNotifId); this._trackingNotifId = null }
    }

    private _stopFollowing(): void {
        this._followEnabled = false
        if (this._labelMarker && this._lastPosition) {
            const newLabelEl = this._buildLabelEl(false)
            this._labelMarker.remove()
            this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
                .setLngLat([this._lastPosition.lon, this._lastPosition.lat]).addTo(this.map)
        }
        if (this._trackingNotifId) { this._notificationsStore.dismiss(this._trackingNotifId); this._trackingNotifId = null }
        this._hideStatusBar()
        this.map.easeTo({ center: [12, 20], zoom: 2, duration: 600 })
    }

    // ---- Status bar ----
    private _showStatusBar(p: IssPosition): void {
        this._trackingStore.register({
            id: 'space', name: this._activeSatName, domain: 'space',
            fields: this._buildTrackingFields(p),
            onUntrack: () => this._stopFollowing(),
        })
    }

    private _hideStatusBar(): void { this._trackingStore.unregister('space') }

    private _updateStatusBar(p: IssPosition): void {
        this._trackingStore.updateFields('space', this._buildTrackingFields(p))
    }

    private _buildTrackingFields(p: IssPosition) {
        return [
            { label: 'ALT', value: `${p.alt_km} km` },
            { label: 'VEL', value: `${p.velocity_kms} km/s` },
            { label: 'HDG', value: `${p.track_deg}°` },
            { label: 'LAT', value: `${p.lat}°` },
            { label: 'LON', value: `${p.lon}°` },
        ]
    }

    // ---- Preview (filter hover) ----
    async previewSatellite(noradId: string, name?: string): Promise<void> {
        if (this._previewNoradId === noradId) return
        if (this._previewAbort) { this._previewAbort.abort(); this._previewAbort = null }
        this._previewNoradId = noradId
        const abort = new AbortController()
        this._previewAbort = abort
        try {
            const endpoint = noradId === '25544' ? '/api/space/iss' : `/api/space/satellite/${noradId}`
            const resp = await fetch(endpoint, { signal: abort.signal })
            if (!resp.ok || abort.signal.aborted) return
            const data = await resp.json() as IssApiResponse
            if (abort.signal.aborted || this._previewNoradId !== noradId) return

            const { position, ground_track, footprint } = data
            const fpUnwrapped2 = SatelliteControl._unwrapRing(footprint as [number, number][])
            const footprintGeo: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: fpUnwrapped2 }, properties: {} },
                    { type: 'Feature', geometry: { type: 'Polygon',    coordinates: [fpUnwrapped2] }, properties: {} },
                ],
            }
            const issGeo: GeoJSON.FeatureCollection = {
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
                    properties: { alt_km: position.alt_km, velocity_kms: position.velocity_kms, track_deg: position.track_deg } }],
            }

            const issSource   = this.map.getSource('iss-live')             as maplibregl.GeoJSONSource | undefined
            const trackSource = this.map.getSource('iss-track-source')     as maplibregl.GeoJSONSource | undefined
            const fpSource    = this.map.getSource('iss-footprint-source') as maplibregl.GeoJSONSource | undefined
            if (issSource)   issSource.setData(issGeo)
            if (trackSource) trackSource.setData(this._trackForProjection(ground_track))
            if (fpSource)    fpSource.setData(this._footprintForProjection(footprintGeo))

            // Ensure layers are visible for the preview even if the overlay was toggled off
            try {
                this.map.setLayoutProperty('iss-icon',    'visibility', 'visible')
                this.map.setLayoutProperty('iss-bracket', 'visibility', 'visible')
                this.map.setLayoutProperty('iss-track-orbit1', 'visibility', 'visible')
                this.map.setLayoutProperty('iss-track-orbit2', 'visibility', 'visible')
                this.map.setLayoutProperty('iss-footprint-fill', 'visibility', 'visible')
                this.map.setLayoutProperty('iss-footprint',      'visibility', 'visible')
            } catch {}

            if (this._labelMarker) {
                if (noradId !== this._activeNoradId) {
                    this._labelMarker.setLngLat([position.lon, position.lat])
                    const spans = this._labelMarker.getElement().querySelectorAll('span')
                    if (spans[0]) spans[0].textContent = name || noradId
                    if (spans[1]) (spans[1] as HTMLElement).classList.add('iss-tracking-badge--hidden')
                }
            }

            let hoverPreference = 'stay'
            try { hoverPreference = localStorage.getItem('sentinel_space_filterHoverPreview') || 'stay' } catch {}
            if (hoverPreference === 'fly') {
                this.map.flyTo({ center: [position.lon, position.lat], zoom: Math.max(this.map.getZoom(), 2), duration: 800 })
            }
        } catch {}
    }

    clearPreview(): void {
        if (!this._previewNoradId) return
        if (this._previewAbort) { this._previewAbort.abort(); this._previewAbort = null }
        this._previewNoradId = null

        const issSource   = this.map.getSource('iss-live')             as maplibregl.GeoJSONSource | undefined
        const trackSource = this.map.getSource('iss-track-source')     as maplibregl.GeoJSONSource | undefined
        const fpSource    = this.map.getSource('iss-footprint-source') as maplibregl.GeoJSONSource | undefined
        if (issSource)   issSource.setData(this._issGeojson)
        if (trackSource) trackSource.setData(this._trackForProjection(this._trackGeojson))
        if (fpSource)    fpSource.setData(this._footprintForProjection(this._footprintGeojson))

        // Restore layer visibility to match actual toggle state
        try {
            const issVis   = this.issVisible ? 'visible' : 'none'
            const trackVis = (this.issVisible && this.trackVisible)    ? 'visible' : 'none'
            const fpVis    = (this.issVisible && this.footprintVisible) ? 'visible' : 'none'
            this.map.setLayoutProperty('iss-icon',    'visibility', issVis)
            this.map.setLayoutProperty('iss-bracket', 'visibility', issVis)
            this.map.setLayoutProperty('iss-track-orbit1', 'visibility', trackVis)
            this.map.setLayoutProperty('iss-track-orbit2', 'visibility', trackVis)
            this.map.setLayoutProperty('iss-footprint-fill', 'visibility', fpVis)
            this.map.setLayoutProperty('iss-footprint',      'visibility', fpVis)
        } catch {}

        if (this._labelMarker) {
            const spans = this._labelMarker.getElement().querySelectorAll('span')
            if (spans[0]) spans[0].textContent = this._activeSatName
            if (spans[1]) (spans[1] as HTMLElement).classList.remove('iss-tracking-badge--hidden')
            if (this._lastPosition) this._labelMarker.setLngLat([this._lastPosition.lon, this._lastPosition.lat])
        }

        let hoverPreference = 'stay'
        try { hoverPreference = localStorage.getItem('sentinel_space_filterHoverPreview') || 'stay' } catch {}
        if (hoverPreference === 'fly' && this._lastPosition) {
            this.map.flyTo({ center: [this._lastPosition.lon, this._lastPosition.lat], zoom: Math.max(this.map.getZoom(), 2), duration: 800 })
        }
    }

    // ---- Satellite switching ----
    switchSatellite(noradId: string, name: string): void {
        if (this._previewAbort) { this._previewAbort.abort(); this._previewAbort = null }
        this._previewNoradId = null
        const wasFollowing = this._followEnabled
        if (this._followEnabled) this._stopFollowing()
        this._hideHoverTagNow(); this._hideLabel()
        if (wasFollowing) this._followEnabled = true  // re-arm so _fetch resumes following on first position
        if (this._passNotifTimeout)    { clearTimeout(this._passNotifTimeout);     this._passNotifTimeout = null }
        if (this._passRefreshInterval) { clearInterval(this._passRefreshInterval); this._passRefreshInterval = null }
        this._passNotifEnabled = false; this._lastFiredPassAos = 0

        this._activeNoradId = noradId; this._activeSatName = name
        this._lastPosition = null; this._trackingRestored = true

        if (!this.issVisible) {
            this.issVisible = true
            ;['iss-icon', 'iss-bracket'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', 'visible') } catch {} })
            ;['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', this.trackVisible ? 'visible' : 'none') } catch {} })
            ;['iss-footprint-fill', 'iss-footprint'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', this.footprintVisible ? 'visible' : 'none') } catch {} })
            this.setButtonActive(true)
            this._spaceStore.setOverlay('iss', true)
        }

        this._restorePassNotifState()
        if (this._passNotifEnabled) this._startPassNotifPolling()
        this._stopPolling(); this._fetch(); this._startPolling()

        // Notify filter/passes panels
        document.dispatchEvent(new CustomEvent('satellite-selected', { detail: { noradId, name } }))
        this._onSwitchSat?.(noradId, name)
    }

    refreshTrackSource(): void {
        if (!this.map) return
        const trackSource = this.map.getSource('iss-track-source')     as maplibregl.GeoJSONSource | undefined
        const fpSource    = this.map.getSource('iss-footprint-source') as maplibregl.GeoJSONSource | undefined
        if (trackSource) trackSource.setData(this._trackForProjection(this._trackGeojson))
        if (fpSource)    fpSource.setData(this._footprintForProjection(this._footprintGeojson))
    }

    // ---- Visibility toggles ----
    toggleIss(): void {
        this.issVisible = !this.issVisible
        const issVis   = this.issVisible ? 'visible' : 'none'
        const trackVis = (this.issVisible && this.trackVisible)     ? 'visible' : 'none'
        const fpVis    = (this.issVisible && this.footprintVisible)  ? 'visible' : 'none'
        ;['iss-icon', 'iss-bracket'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', issVis) } catch {} })
        ;['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', trackVis) } catch {} })
        ;['iss-footprint-fill', 'iss-footprint'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', fpVis) } catch {} })
        this.setButtonActive(this.issVisible)
        this._spaceStore.setOverlay('iss', this.issVisible)
        if (!this.issVisible) {
            this._stopPolling(); this._stopFollowing(); this._hideHoverTagNow(); this._hideLabel()
            this._activeNoradId = '25544'; this._activeSatName = 'ISS'
        } else {
            this._fetch(); this._startPolling()
        }
    }

    startFollowing(): void {
        if (this._lastPosition) {
            this._startFollowing()
        } else {
            this._followEnabled = true
        }
    }

    toggleTrack(): void {
        this.trackVisible = !this.trackVisible
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none'
        ;['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', trackVis) } catch {} })
    }

    toggleFootprint(): void {
        this.footprintVisible = !this.footprintVisible
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none'
        ;['iss-footprint-fill', 'iss-footprint'].forEach(id => { try { this.map.setLayoutProperty(id, 'visibility', fpVis) } catch {} })
    }
}
