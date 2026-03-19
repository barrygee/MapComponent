// ============================================================
// ISS LIVE CONTROL
// Polls /api/space/iss every 5 seconds for the current ISS position,
// ground track (past + future passes), and visibility footprint.
// Renders all three as MapLibre layers.
//
// Layers:
//   iss-track-orbit1  — solid bright line (current orbit)
//   iss-track-orbit2  — solid dimmer line (next orbit)
//   iss-footprint-fill — semi-transparent dark fill (visibility horizon)
//   iss-footprint     — black outline (visibility horizon)
//   iss-bracket       — military-style bracket at ISS position
//   iss-icon          — satellite icon rotated to heading
//
// Hover on ISS shows an info tag with altitude, velocity, heading + TRACK button.
// TRACK keeps ISS centred on map and shows status bar in tracking panel.
//
// Depends on: map (global alias), SentinelControlBase,
//             _spaceOverlayStates, _saveSpaceOverlayStates
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../../air/controls/sentinel-control-base/sentinel-control-base.ts" />

interface IssPosition {
    lon:          number;
    lat:          number;
    alt_km:       number;
    velocity_kms: number;
    track_deg:    number;
}

interface IssApiResponse {
    error?:       string;
    position:     IssPosition;
    ground_track: GeoJSON.FeatureCollection;
    footprint:    [number, number][];
}

interface IssPass {
    aos_utc:           string;
    los_utc:           string;
    aos_unix_ms:       number;
    los_unix_ms:       number;
    duration_s:        number;
    max_elevation_deg: number;
    max_el_utc:        string;
}

interface IssPassesApiResponse {
    passes:          IssPass[];
    obs_lat:         number;
    obs_lon:         number;
    lookahead_hours: number;
    computed_at:     string;
    error?:          string;
}

class IssControl extends SentinelControlBase {
    issVisible:       boolean;
    trackVisible:     boolean;
    footprintVisible: boolean;
    _pollInterval:    ReturnType<typeof setInterval> | null;
    _tagMarker:       maplibregl.Marker | null;
    _hoverTagMarker:  maplibregl.Marker | null;
    _lastPosition:    IssPosition | null;
    _labelMarker:     maplibregl.Marker | null;
    _followEnabled:      boolean;
    _trackingRestored:   boolean;
    _hoverHideTimer:     ReturnType<typeof setTimeout> | null;
    _issGeojson:      GeoJSON.FeatureCollection;
    _trackGeojson:    GeoJSON.FeatureCollection;
    _footprintGeojson: GeoJSON.FeatureCollection;
    _passNotifEnabled:   boolean;
    _trackingNotifId:    string | null;
    _passNotifTimeout:   ReturnType<typeof setTimeout> | null;
    _passRefreshInterval: ReturnType<typeof setInterval> | null;
    _lastFiredPassAos:   number;

    constructor() {
        super();
        this.issVisible       = _spaceOverlayStates.iss;
        this.trackVisible     = _spaceOverlayStates.groundTrack;
        this.footprintVisible = _spaceOverlayStates.footprint;
        this._pollInterval    = null;
        this._tagMarker       = null;
        this._hoverTagMarker  = null;
        this._lastPosition    = null;
        this._labelMarker     = null;
        this._followEnabled     = false;
        this._trackingRestored  = false;
        this._hoverHideTimer    = null;
        // Pass notifications
        this._trackingNotifId     = null;
        this._passNotifEnabled    = false;
        this._passNotifTimeout    = null;
        this._passRefreshInterval = null;
        this._lastFiredPassAos    = 0;
        this._restorePassNotifState();
        // GeoJSON stores
        this._issGeojson       = { type: 'FeatureCollection', features: [] };
        this._trackGeojson     = { type: 'FeatureCollection', features: [] };
        this._footprintGeojson = { type: 'FeatureCollection', features: [] };
    }

    get buttonLabel(): string {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="4" height="4" fill="#c8ff00"/>
            <rect x="2" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <rect x="15" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <line x1="12" y1="2" x2="12" y2="8" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
            <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
        </svg>`;
    }
    get buttonTitle(): string { return 'Toggle ISS tracking'; }

    protected onInit(): void {
        this.setButtonActive(this.issVisible);
        // initLayers + fetch are handled by space-overlay-reinit.ts via MapComponent.onStyleLoad,
        // which fires immediately if the style is already loaded, or on next style.load otherwise.
    }

    protected handleClick(): void { this.toggleIss(); }

    // ---- Canvas sprite factories ----
    private _createSatelliteIcon(): ImageData {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const cx = size / 2, cy = size / 2;

        // Body: diamond shape in white
        ctx.beginPath();
        ctx.moveTo(cx, cy - 11);
        ctx.lineTo(cx + 9, cy);
        ctx.lineTo(cx, cy + 11);
        ctx.lineTo(cx - 9, cy);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Solar panels: horizontal bars in white
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(cx - 28, cy - 4, 15, 8);  // left panel
        ctx.fillRect(cx + 13,  cy - 4, 15, 8);  // right panel

        // Antenna: vertical line up
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 11);
        ctx.lineTo(cx, cy - 21);
        ctx.stroke();

        return ctx.getImageData(0, 0, size, size);
    }

    private _createSatBracket(): ImageData {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const left = 8, top = 8, right = 88, bottom = 88, arm = 14;

        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(left, top, right - left, bottom - top);

        ctx.strokeStyle = '#c8ff00';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'square';

        ([
            [left, top, 1, 1], [right, top, -1, 1],
            [left, bottom, 1, -1], [right, bottom, -1, -1],
        ] as [number, number, number, number][]).forEach(([x, y, dx, dy]) => {
            ctx.beginPath();
            ctx.moveTo(x + dx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * arm);
            ctx.stroke();
        });

        return ctx.getImageData(0, 0, size, size);
    }

    // ---- Layer init ----
    initLayers(): void {
        // Clean up existing layers/sources (includes legacy layer IDs from older builds)
        ['iss-track-past', 'iss-track-future', 'iss-track-orbit1', 'iss-track-orbit2',
         'iss-footprint-fill-outer', 'iss-footprint-fill-mid', 'iss-footprint-fill-inner', 'iss-footprint-fill-core',
         'iss-footprint-fill', 'iss-footprint', 'iss-bracket', 'iss-icon'].forEach(id => {
            try { this.map.removeLayer(id); } catch (e) {}
        });
        ['iss-track-source', 'iss-footprint-source', 'iss-live'].forEach(id => {
            try { if (this.map.getSource(id)) this.map.removeSource(id); } catch (e) {}
        });

        // Register sprites
        ['iss-icon-sprite', 'iss-bracket-sprite'].forEach(n => {
            if (this.map.hasImage(n)) this.map.removeImage(n);
        });
        this.map.addImage('iss-icon-sprite',    this._createSatelliteIcon(), { pixelRatio: 2, sdf: false });
        this.map.addImage('iss-bracket-sprite', this._createSatBracket(),    { pixelRatio: 2, sdf: false });

        const trackVis = (this.issVisible && this.trackVisible)     ? 'visible' : 'none';
        const fpVis    = (this.issVisible && this.footprintVisible)  ? 'visible' : 'none';
        const issVis   = this.issVisible ? 'visible' : 'none';

        // Ground track source — past, orbit1, orbit2 features in one collection
        this.map.addSource('iss-track-source', { type: 'geojson', data: this._trackGeojson });

        // Current orbit: solid, bright
        this.map.addLayer({
            id: 'iss-track-orbit1',
            type: 'line',
            source: 'iss-track-source',
            filter: ['==', ['get', 'track'], 'orbit1'],
            layout: { visibility: trackVis },
            paint: {
                'line-color': '#c8ff00',
                'line-width': 1.5,
                'line-opacity': 0.80,
            },
        });

        // Next orbit: solid, dimmer
        this.map.addLayer({
            id: 'iss-track-orbit2',
            type: 'line',
            source: 'iss-track-source',
            filter: ['==', ['get', 'track'], 'orbit2'],
            layout: { visibility: trackVis },
            paint: {
                'line-color': '#c8ff00',
                'line-width': 1.5,
                'line-opacity': 0.45,
            },
        });

        // Footprint source + layers (semi-transparent dark fill + black outline)
        this.map.addSource('iss-footprint-source', { type: 'geojson', data: this._footprintGeojson });

        this.map.addLayer({
            id: 'iss-footprint-fill',
            type: 'fill',
            source: 'iss-footprint-source',
            filter: ['==', ['geometry-type'], 'Polygon'],
            layout: { visibility: fpVis },
            paint: {
                'fill-color': 'rgba(0,0,0,0.22)',
            },
        });

        this.map.addLayer({
            id: 'iss-footprint',
            type: 'line',
            source: 'iss-footprint-source',
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { visibility: fpVis },
            paint: {
                'line-color': '#000000',
                'line-width': 1.2,
            },
        });

        // ISS live position source
        this.map.addSource('iss-live', { type: 'geojson', data: this._issGeojson });

        // Bracket layer (rendered behind icon)
        this.map.addLayer({
            id: 'iss-bracket',
            type: 'symbol',
            source: 'iss-live',
            layout: {
                visibility: issVis,
                'icon-image': 'iss-bracket-sprite',
                'icon-size': 0.75,
                'icon-rotation-alignment': 'viewport',
                'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
        });

        // Icon layer — rotated to heading
        this.map.addLayer({
            id: 'iss-icon',
            type: 'symbol',
            source: 'iss-live',
            layout: {
                visibility: issVis,
                'icon-image': 'iss-icon-sprite',
                'icon-size': 0.75,
                'icon-rotate': ['get', 'track_deg'],
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
        });

        // Hover on ISS icon/bracket — show info tag
        this.map.on('mouseenter', 'iss-icon',    (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e); });
        this.map.on('mouseenter', 'iss-bracket', (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e); });
        this.map.on('mouseleave', 'iss-icon',    () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag(); });
        this.map.on('mouseleave', 'iss-bracket', () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag(); });
    }

    // ---- Data fetch ----
    async _fetch(): Promise<void> {
        try {
            const resp = await fetch('/api/space/iss');
            if (!resp.ok) return;
            const data = await resp.json() as IssApiResponse;
            if (data.error) return;

            const { position, ground_track, footprint } = data;
            this._lastPosition = position;

            // ISS point feature
            this._issGeojson = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
                    properties: {
                        alt_km:       position.alt_km,
                        velocity_kms: position.velocity_kms,
                        track_deg:    position.track_deg,
                    },
                }],
            };

            this._trackGeojson = ground_track;

            this._footprintGeojson = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: footprint }, properties: {} },
                    { type: 'Feature', geometry: { type: 'Polygon',    coordinates: [footprint] }, properties: {} },
                ],
            };

            // Push to map sources
            const issSource = this.map && this.map.getSource('iss-live') as maplibregl.GeoJSONSource | undefined;
            if (issSource) issSource.setData(this._issGeojson);

            const trackSource = this.map && this.map.getSource('iss-track-source') as maplibregl.GeoJSONSource | undefined;
            if (trackSource) trackSource.setData(this._trackGeojson);

            const fpSource = this.map && this.map.getSource('iss-footprint-source') as maplibregl.GeoJSONSource | undefined;
            if (fpSource) fpSource.setData(this._footprintGeojson);

            // Restore tracking state on first fetch after page load
            if (!this._trackingRestored) {
                this._trackingRestored = true;
                this._restoreIssTracking();
                if (this._passNotifEnabled) this._startPassNotifPolling();
            }

            // Keep callsign label in sync (only when tag is not shown)
            if (this.issVisible && !this._hoverTagMarker && !this._followEnabled) {
                this._showLabel(position.lon, position.lat);
            } else if (this.issVisible && this._labelMarker) {
                this._labelMarker.setLngLat([position.lon, position.lat]);
            }

            // Keep hover tag position in sync while open
            if (this._hoverTagMarker) {
                this._hoverTagMarker.setLngLat([position.lon, position.lat]);
                this._updateHoverTagContent(position);
            }

            // Keep following — centre map and update label position
            if (this._followEnabled) {
                if (this._labelMarker) this._labelMarker.setLngLat([position.lon, position.lat]);
                this.map.easeTo({ center: [position.lon, position.lat], duration: 150, easing: (t: number) => t });
                this._updateStatusBar(position);
            }

        } catch (e) {
            // Silently ignore fetch errors
        }
    }

    _startPolling(): void {
        if (this._pollInterval) return;
        this._pollInterval = setInterval(() => this._fetch(), 5000);
    }

    private _stopPolling(): void {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }

    // ---- Callsign label ----
    private _buildLabelEl(isTracking: boolean = false): HTMLDivElement {
        const el = document.createElement('div');
        el.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:8px',
            'background:rgba(0,0,0,0.5)',
            'color:#ffffff',
            "font-family:'Barlow Condensed','Barlow','Helvetica Neue',Arial,sans-serif",
            'font-size:13px',
            'font-weight:400',
            'letter-spacing:.12em',
            'text-transform:uppercase',
            'padding:3px 10px',
            'white-space:nowrap',
            isTracking ? 'pointer-events:auto' : 'pointer-events:none',
            'user-select:none',
            isTracking ? 'cursor:pointer' : '',
        ].join(';');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = 'ISS';
        el.appendChild(nameSpan);
        if (isTracking) {
            const trkSpan = document.createElement('span');
            trkSpan.style.cssText = 'color:#c8ff00;font-size:10px;font-weight:700;letter-spacing:.1em;transition:color 0.2s';
            trkSpan.textContent = 'TRACKING';
            el.addEventListener('mouseenter', () => { trkSpan.textContent = 'UNTRACK'; });
            el.addEventListener('mouseleave', () => { trkSpan.textContent = 'TRACKING'; });
            el.appendChild(trkSpan);
        }
        return el;
    }

    private _showLabel(lon: number, lat: number): void {
        if (this._labelMarker) {
            this._labelMarker.setLngLat([lon, lat]);
            return;
        }
        const el = this._buildLabelEl(false);
        this._labelMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [26, 0] })
            .setLngLat([lon, lat])
            .addTo(this.map);
    }

    private _hideLabel(): void {
        if (this._labelMarker) { this._labelMarker.remove(); this._labelMarker = null; }
    }

    // ---- Tag HTML ----
    private _tagHTML(p: IssPosition, isTracking: boolean): string {
        const trkColor = isTracking ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const trkText  = isTracking ? 'TRACKING' : 'TRACK';
        const trkBtn = `<button class="iss-track-btn" style="background:none;border:none;cursor:pointer;padding:8px 12px;color:${trkColor};font-family:'Barlow Condensed','Barlow',sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent">${trkText}</button>`;
        const bellColor = this._passNotifEnabled ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const bellSlash = this._passNotifEnabled ? '' :
            `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`;
        const bellBtn = `<button class="iss-notif-btn" style="background:none;border:none;cursor:pointer;padding:8px 6px;color:${bellColor};line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent" aria-label="Toggle pass notifications">` +
            `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
            `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
            bellSlash +
            `</svg></button>`;

        const rows: [string, string][] = [
            ['ALT', `${p.alt_km} km`],
            ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`],
            ['LAT', `${p.lat}°`],
            ['LON', `${p.lon}°`],
        ];
        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span class="iss-tag-val" data-field="${lbl}">${val}</span></div>`
        ).join('');

        return `<div style="background:rgba(0,0,0,0.7);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;padding:6px 14px 9px;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:15px;letter-spacing:.12em;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none;color:#c8ff00;letter-spacing:.12em">ISS</span>` +
            `<div style="display:flex;align-items:center;gap:0">${bellBtn}${trkBtn}</div></div>` +
            `<div style="pointer-events:none">` + rowsHTML + `</div></div>`;
    }

    // ---- Hover tag ----
    private _showHoverTag(e: maplibregl.MapLayerMouseEvent): void {
        if (!e.features || !e.features.length) return;
        if (this._followEnabled) return; // tracking tag already shown
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        if (this._hoverTagMarker) return; // already shown

        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const props: IssPosition = this._lastPosition
            ? { ...this._lastPosition }
            : { ...(e.features[0].properties as Omit<IssPosition, 'lat' | 'lon'>), lon: coords[0], lat: coords[1] };

        // Hide the label while tag is visible
        if (this._labelMarker) this._labelMarker.getElement().style.visibility = 'hidden';

        const el = document.createElement('div');
        el.style.pointerEvents = 'auto';
        el.innerHTML = this._tagHTML(props, false);
        el.addEventListener('mouseenter', () => {
            if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        });
        el.addEventListener('mouseleave', () => this._scheduleHideHoverTag());
        this._wireTrackButton(el, props);
        this._wireNotifButton(el);

        const markerCoords: [number, number] = this._lastPosition
            ? [this._lastPosition.lon, this._lastPosition.lat]
            : coords;
        this._hoverTagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [26, -13] })
            .setLngLat(markerCoords)
            .addTo(this.map);
    }

    private _scheduleHideHoverTag(): void {
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 400);
    }

    private _hideHoverTagNow(): void {
        if (this._hoverTagMarker) { this._hoverTagMarker.remove(); this._hoverTagMarker = null; }
        // Restore label when not tracking
        if (!this._followEnabled && this._labelMarker) {
            this._labelMarker.getElement().style.visibility = '';
        }
    }

    private _updateTagContent(marker: maplibregl.Marker, position: IssPosition): void {
        const el = marker.getElement();
        if (!el) return;
        const vals: Record<string, string> = {
            ALT: `${position.alt_km} km`,
            VEL: `${position.velocity_kms} km/s`,
            HDG: `${position.track_deg}°`,
            LAT: `${position.lat}°`,
            LON: `${position.lon}°`,
        };
        el.querySelectorAll<HTMLElement>('.iss-tag-val').forEach(span => {
            const field = span.dataset['field'];
            if (field && vals[field] !== undefined) span.textContent = vals[field];
        });
    }

    private _updateHoverTagContent(position: IssPosition): void {
        if (!this._hoverTagMarker) return;
        this._updateTagContent(this._hoverTagMarker, position);
    }

    // ---- Track button wiring ----
    private _wireTrackButton(el: HTMLElement, _props: IssPosition): void {
        const btn = el.querySelector('.iss-track-btn');
        if (!btn) return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._hideHoverTagNow();
            this._startFollowing();
        });
    }

    // ---- Pass notifications ----
    private _restorePassNotifState(): void {
        try {
            this._passNotifEnabled = localStorage.getItem('issPassNotifEnabled') === '1';
        } catch (e) {}
    }

    private _savePassNotifState(): void {
        try {
            if (this._passNotifEnabled) localStorage.setItem('issPassNotifEnabled', '1');
            else localStorage.removeItem('issPassNotifEnabled');
        } catch (e) {}
    }

    private _wireNotifButton(el: HTMLElement): void {
        const btn = el.querySelector('.iss-notif-btn');
        if (!btn) return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._togglePassNotif();
            // Update bell appearance in this tag
            const svg = btn.querySelector('svg');
            if (svg) {
                (btn as HTMLElement).style.color = this._passNotifEnabled ? '#c8ff00' : 'rgba(255,255,255,0.3)';
                const existingSlash = svg.querySelector('line');
                if (this._passNotifEnabled && existingSlash) existingSlash.remove();
                else if (!this._passNotifEnabled && !existingSlash) {
                    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    slash.setAttribute('x1', '1.5'); slash.setAttribute('y1', '1.5');
                    slash.setAttribute('x2', '11.5'); slash.setAttribute('y2', '11.5');
                    slash.setAttribute('stroke', 'currentColor');
                    slash.setAttribute('stroke-width', '1.5');
                    slash.setAttribute('stroke-linecap', 'square');
                    svg.appendChild(slash);
                }
            }
        });
    }

    private _togglePassNotif(): void {
        if (this._passNotifEnabled) {
            // Disable
            this._passNotifEnabled = false;
            this._lastFiredPassAos = 0;
            if (this._passNotifTimeout) { clearTimeout(this._passNotifTimeout); this._passNotifTimeout = null; }
            if (this._passRefreshInterval) { clearInterval(this._passRefreshInterval); this._passRefreshInterval = null; }
            this._savePassNotifState();
            if (window._Notifications) {
                window._Notifications.add({ type: 'notif-off', title: 'ISS', detail: 'Pass notifications disabled' });
            }
        } else {
            // Enable
            if (!spaceUserLocationCenter) {
                // Trigger location request then retry once location resolves
                if (typeof goToSpaceUserLocation === 'function') goToSpaceUserLocation();
                const poller = setInterval(() => {
                    if (spaceUserLocationCenter) {
                        clearInterval(poller);
                        this._passNotifEnabled = true;
                        this._savePassNotifState();
                        this._startPassNotifPolling();
                    }
                }, 500);
                setTimeout(() => clearInterval(poller), 30000);
                return;
            }
            this._passNotifEnabled = true;
            this._savePassNotifState();
            this._startPassNotifPolling();
            if (window._Notifications) {
                window._Notifications.add({
                    type: 'tracking', title: 'ISS', detail: 'Pass notifications enabled',
                    action: { label: 'DISABLE NOTIFICATIONS', callback: () => {
                        this._passNotifEnabled = true; // ensure toggle turns it off
                        this._togglePassNotif();
                    }},
                });
            }
        }
    }

    private _startPassNotifPolling(): void {
        this._fetchAndSchedulePasses();
        if (this._passRefreshInterval) clearInterval(this._passRefreshInterval);
        this._passRefreshInterval = setInterval(() => this._fetchAndSchedulePasses(), 5 * 60 * 1000);
    }

    private async _fetchAndSchedulePasses(): Promise<void> {
        if (!spaceUserLocationCenter) return;
        const [lon, lat] = spaceUserLocationCenter;
        try {
            const resp = await fetch(`/api/space/iss/passes?lat=${lat}&lon=${lon}&hours=24`);
            if (!resp.ok) return;
            const data = await resp.json() as IssPassesApiResponse;
            if (data.error || !data.passes) return;
            this._schedulePassNotification(data.passes);
        } catch (e) {}
    }

    private _schedulePassNotification(passes: IssPass[]): void {
        // Cancel any pending notification
        if (this._passNotifTimeout) { clearTimeout(this._passNotifTimeout); this._passNotifTimeout = null; }
        if (!this._passNotifEnabled) return;

        const now = Date.now();
        const leadMs = 10 * 60 * 1000; // notify 10 min before AOS

        // Find the next upcoming pass
        const next = passes.find(p => p.aos_unix_ms > now);
        if (!next) return;

        const delay = (next.aos_unix_ms - leadMs) - now;
        if (delay < 0) {
            // Pass is imminent or already in progress — fire only if not already fired
            if (this._lastFiredPassAos !== next.aos_unix_ms) {
                this._lastFiredPassAos = next.aos_unix_ms;
                this._firePassNotification(next);
            }
            // Schedule the one after
            const remaining = passes.filter(p => p.aos_unix_ms > now + 60000);
            if (remaining.length > 0) this._schedulePassNotification(remaining);
            return;
        }

        this._passNotifTimeout = setTimeout(() => {
            this._passNotifTimeout = null;
            if (!this._passNotifEnabled) return;
            this._lastFiredPassAos = next.aos_unix_ms;
            this._firePassNotification(next);
            // Schedule the next pass after this one
            const remaining = passes.filter(p => p.aos_unix_ms > next.aos_unix_ms + 60000);
            if (remaining.length > 0) {
                this._schedulePassNotification(remaining);
            } else {
                // Refresh the pass list to get the next day's passes
                this._fetchAndSchedulePasses();
            }
        }, delay);
    }

    private _firePassNotification(pass: IssPass): void {
        if (!window._Notifications) return;
        const aosDate = new Date(pass.aos_unix_ms);
        const aosTime = aosDate.toUTCString().slice(17, 22) + ' UTC';
        window._Notifications.add({
            type:   'tracking',
            title:  'ISS PASS',
            detail: `AOS ~10 min — max ${pass.max_elevation_deg}° elev at ${aosTime}`,
            action: {
                label:    'DISABLE',
                callback: () => {
                    if (issControl) {
                        issControl._passNotifEnabled = true; // ensure toggle turns it off
                        issControl._togglePassNotif();
                    }
                },
            },
        });
    }

    // ---- Following / tracked tag ----
    // ---- Tracking state persistence ----
    private _saveIssTracking(): void {
        try {
            if (this._followEnabled) {
                localStorage.setItem('issTracking', '1');
            } else {
                localStorage.removeItem('issTracking');
            }
        } catch (e) {}
    }

    private _restoreIssTracking(): void {
        try {
            if (localStorage.getItem('issTracking') === '1' && this._lastPosition) {
                localStorage.removeItem('issTracking');
                this._startFollowing(true);
            }
        } catch (e) {}
    }

    private _startFollowing(restoring = false): void {
        if (!this._lastPosition) return;
        this._followEnabled = true;
        const pos = this._lastPosition;
        const coords: [number, number] = [pos.lon, pos.lat];

        // Update label to show TRACKING state; clicking it untracks
        const newLabelEl = this._buildLabelEl(true);
        newLabelEl.style.visibility = '';
        newLabelEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this._stopFollowing();
        });
        if (this._labelMarker) this._labelMarker.remove();
        this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
            .setLngLat(coords)
            .addTo(this.map);

        // Centre map (no zoom change — satellites are best viewed at current zoom)
        this.map.easeTo({ center: coords, duration: 600 });

        // Show tracking info in footer panel
        this._showStatusBar(pos);
        if (!restoring && window._Notifications) {
            if (this._trackingNotifId) { window._Notifications.dismiss(this._trackingNotifId); this._trackingNotifId = null; }
            this._trackingNotifId = window._Notifications.add({ type: 'track', title: 'ISS' });
        }
        this._saveIssTracking();
    }

    private _wireUntrackButton(el: HTMLElement): void {
        const btn = el.querySelector('.iss-track-btn');
        if (!btn) return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._stopFollowing();
        });
    }

    private _stopFollowing(): void {
        this._followEnabled = false;
        // Restore label to non-tracking state
        if (this._labelMarker && this._lastPosition) {
            const newLabelEl = this._buildLabelEl(false);
            this._labelMarker.remove();
            this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
                .setLngLat([this._lastPosition.lon, this._lastPosition.lat])
                .addTo(this.map);
        }
        if (window._Notifications && this._trackingNotifId) { window._Notifications.dismiss(this._trackingNotifId); this._trackingNotifId = null; }
        this._hideStatusBar();
        this._saveIssTracking();
        this.map.easeTo({ center: [12, 20], zoom: 2, duration: 600 });
    }

    // ---- Status bar ----
    private _buildStatusBarHTML(p: IssPosition): string {
        const fields: [string, string][] = [
            ['ALT', `${p.alt_km} km`],
            ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`],
            ['LAT', `${p.lat}°`],
            ['LON', `${p.lon}°`],
        ];
        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`
        ).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-label-tag">TRACKING</span>` +
            `<button class="adsb-sb-untrack-btn">UNTRACK</button>` +
            `</div>` +
            `<div class="adsb-sb-header" style="border-top:none;height:auto;padding:8px 14px 9px">` +
            `<span class="adsb-sb-callsign" style="color:#c8ff00">ISS</span>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    private _showStatusBar(p: IssPosition): void {
        let bar = document.getElementById('iss-status-bar') as HTMLDivElement | null;
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'iss-status-bar';
            bar.style.cssText = 'width:220px;background:#000;color:#fff;font-family:"Barlow","Helvetica Neue",Arial,sans-serif;pointer-events:auto;display:none;flex-direction:column;gap:0;user-select:none;box-sizing:border-box;';
            const panel = document.getElementById('tracking-panel');
            if (panel) panel.appendChild(bar);
            else document.body.appendChild(bar);
        }
        bar.innerHTML = this._buildStatusBarHTML(p);
        bar.style.display = 'flex';
        const untrackBtn = bar.querySelector('.adsb-sb-untrack-btn');
        if (untrackBtn) {
            untrackBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._stopFollowing();
            });
        }
        if (typeof window._Tracking !== 'undefined') { window._Tracking.setCount(1); window._Tracking.openPanel(); }
        if (typeof window._FilterPanel !== 'undefined') window._FilterPanel.reposition();
    }

    private _hideStatusBar(): void {
        const bar = document.getElementById('iss-status-bar');
        if (bar) bar.style.display = 'none';
        if (typeof window._Tracking !== 'undefined') { window._Tracking.setCount(0); window._Tracking.closePanel(); }
        if (typeof window._FilterPanel !== 'undefined') window._FilterPanel.reposition();
    }

    private _updateStatusBar(p: IssPosition): void {
        const bar = document.getElementById('iss-status-bar');
        if (!bar || bar.style.display === 'none') return;
        bar.innerHTML = this._buildStatusBarHTML(p);
        const untrackBtn = bar.querySelector('.adsb-sb-untrack-btn');
        if (untrackBtn) {
            untrackBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._stopFollowing();
            });
        }
    }

    // ---- Visibility toggles ----
    toggleIss(): void {
        this.issVisible = !this.issVisible;
        const issVis   = this.issVisible ? 'visible' : 'none';
        const trackVis = (this.issVisible && this.trackVisible)     ? 'visible' : 'none';
        const fpVis    = (this.issVisible && this.footprintVisible)  ? 'visible' : 'none';
        ['iss-icon', 'iss-bracket'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', issVis); } catch (e) {}
        });
        ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', trackVis); } catch (e) {}
        });
        ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', fpVis); } catch (e) {}
        });
        this.setButtonActive(this.issVisible);
        if (!this.issVisible) {
            this._stopPolling();
            this._stopFollowing();
            this._hideHoverTagNow();
            this._hideLabel();
        } else {
            this._fetch();
            this._startPolling();
        }
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    toggleTrack(): void {
        this.trackVisible = !this.trackVisible;
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', trackVis); } catch (e) {}
        });
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    toggleFootprint(): void {
        this.footprintVisible = !this.footprintVisible;
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
        ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', fpVis); } catch (e) {}
        });
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    onRemove(): void {
        this._stopPolling();
        this._stopFollowing();
        this._hideHoverTagNow();
        this._hideLabel();
        if (this._passNotifTimeout) { clearTimeout(this._passNotifTimeout); this._passNotifTimeout = null; }
        if (this._passRefreshInterval) { clearInterval(this._passRefreshInterval); this._passRefreshInterval = null; }
        super.onRemove();
    }
}

issControl = new IssControl();
map.addControl(issControl, 'top-right');
