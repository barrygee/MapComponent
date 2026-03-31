"use strict";
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
class IssControl extends SentinelControlBase {
    constructor() {
        super();
        this.issVisible = _spaceOverlayStates.iss;
        this.trackVisible = _spaceOverlayStates.groundTrack;
        this.footprintVisible = _spaceOverlayStates.footprint;
        this._pollInterval = null;
        this._tagMarker = null;
        this._hoverTagMarker = null;
        this._lastPosition = null;
        this._labelMarker = null;
        this._followEnabled = false;
        this._trackingRestored = false;
        this._hoverHideTimer = null;
        this._activeNoradId = '25544';
        this._activeSatName = 'ISS';
        // Pass notifications
        this._trackingNotifId = null;
        this._passNotifEnabled = false;
        this._passNotifTimeout = null;
        this._passRefreshInterval = null;
        this._lastFiredPassAos = 0;
        this._previewNoradId = null;
        this._previewAbort = null;
        this._restorePassNotifState();
        // GeoJSON stores
        this._issGeojson = { type: 'FeatureCollection', features: [] };
        this._trackGeojson = { type: 'FeatureCollection', features: [] };
        this._footprintGeojson = { type: 'FeatureCollection', features: [] };
    }
    get buttonLabel() {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="4" height="4" fill="#c8ff00"/>
            <rect x="2" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <rect x="15" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
            <line x1="12" y1="2" x2="12" y2="8" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
            <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
        </svg>`;
    }
    get buttonTitle() { return 'Toggle ISS tracking'; }
    onInit() {
        this.setButtonActive(this.issVisible);
        // initLayers + fetch are handled by space-overlay-reinit.ts via MapComponent.onStyleLoad,
        // which fires immediately if the style is already loaded, or on next style.load otherwise.
    }
    handleClick() { this.toggleIss(); }
    // ---- Canvas sprite factories ----
    _createSatelliteIcon() {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
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
        ctx.fillRect(cx - 28, cy - 4, 15, 8); // left panel
        ctx.fillRect(cx + 13, cy - 4, 15, 8); // right panel
        // Antenna: vertical line up
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 11);
        ctx.lineTo(cx, cy - 21);
        ctx.stroke();
        return ctx.getImageData(0, 0, size, size);
    }
    _createSatBracket() {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const left = 8, top = 8, right = 88, bottom = 88, arm = 14;
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeStyle = '#c8ff00';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'square';
        [
            [left, top, 1, 1], [right, top, -1, 1],
            [left, bottom, 1, -1], [right, bottom, -1, -1],
        ].forEach(([x, y, dx, dy]) => {
            ctx.beginPath();
            ctx.moveTo(x + dx * arm, y);
            ctx.lineTo(x, y);
            ctx.lineTo(x, y + dy * arm);
            ctx.stroke();
        });
        return ctx.getImageData(0, 0, size, size);
    }
    // ---- Layer init ----
    initLayers() {
        // Clean up existing layers/sources (includes legacy layer IDs from older builds)
        ['iss-track-past', 'iss-track-future', 'iss-track-orbit1', 'iss-track-orbit2',
            'iss-footprint-fill-outer', 'iss-footprint-fill-mid', 'iss-footprint-fill-inner', 'iss-footprint-fill-core',
            'iss-footprint-fill', 'iss-footprint', 'iss-bracket', 'iss-icon'].forEach(id => {
            try {
                this.map.removeLayer(id);
            }
            catch (e) { }
        });
        ['iss-track-source', 'iss-footprint-source', 'iss-live'].forEach(id => {
            try {
                if (this.map.getSource(id))
                    this.map.removeSource(id);
            }
            catch (e) { }
        });
        // Register sprites
        ['iss-icon-sprite', 'iss-bracket-sprite'].forEach(n => {
            if (this.map.hasImage(n))
                this.map.removeImage(n);
        });
        this.map.addImage('iss-icon-sprite', this._createSatelliteIcon(), { pixelRatio: 2, sdf: false });
        this.map.addImage('iss-bracket-sprite', this._createSatBracket(), { pixelRatio: 2, sdf: false });
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
        const issVis = this.issVisible ? 'visible' : 'none';
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
        this.map.on('mouseenter', 'iss-icon', (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e); });
        this.map.on('mouseenter', 'iss-bracket', (e) => { this.map.getCanvas().style.cursor = 'pointer'; this._showHoverTag(e); });
        this.map.on('mouseleave', 'iss-icon', () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag(); });
        this.map.on('mouseleave', 'iss-bracket', () => { this.map.getCanvas().style.cursor = ''; this._scheduleHideHoverTag(); });
    }
    // ---- No TLE overlay helpers ----
    _showNoTleOverlay() {
        const overlay = document.getElementById('no-tle-overlay');
        if (overlay)
            overlay.classList.remove('hidden');
    }
    _hideNoTleOverlay() {
        const overlay = document.getElementById('no-tle-overlay');
        if (overlay)
            overlay.classList.add('hidden');
    }
    // ---- Data fetch ----
    async _fetch() {
        try {
            const url = this._activeNoradId === '25544'
                ? '/api/space/iss'
                : `/api/space/satellite/${this._activeNoradId}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                if (body.no_tle_data)
                    this._showNoTleOverlay();
                return;
            }
            const data = await resp.json();
            if (data.error)
                return;
            this._hideNoTleOverlay();
            const { position, ground_track, footprint } = data;
            this._lastPosition = position;
            // ISS point feature
            this._issGeojson = {
                type: 'FeatureCollection',
                features: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
                        properties: {
                            alt_km: position.alt_km,
                            velocity_kms: position.velocity_kms,
                            track_deg: position.track_deg,
                        },
                    }],
            };
            this._trackGeojson = ground_track;
            this._footprintGeojson = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: footprint }, properties: {} },
                    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [footprint] }, properties: {} },
                ],
            };
            // Push to map sources (skip while a filter hover preview is active)
            if (!this._previewNoradId) {
                const issSource = this.map && this.map.getSource('iss-live');
                if (issSource)
                    issSource.setData(this._issGeojson);
                const trackSource = this.map && this.map.getSource('iss-track-source');
                if (trackSource)
                    trackSource.setData(this._trackGeojson);
                const fpSource = this.map && this.map.getSource('iss-footprint-source');
                if (fpSource)
                    fpSource.setData(this._footprintGeojson);
            }
            // Restore tracking state on first fetch after page load
            if (!this._trackingRestored) {
                this._trackingRestored = true;
                this._restoreIssTracking();
                if (this._passNotifEnabled)
                    this._startPassNotifPolling();
            }
            // Keep callsign label in sync (only when tag is not shown, and not during a hover preview)
            if (!this._previewNoradId) {
                if (this.issVisible && !this._hoverTagMarker && !this._followEnabled) {
                    this._showLabel(position.lon, position.lat);
                }
                else if (this.issVisible && this._labelMarker) {
                    this._labelMarker.setLngLat([position.lon, position.lat]);
                }
            }
            // Keep hover tag position in sync while open
            if (this._hoverTagMarker) {
                this._hoverTagMarker.setLngLat([position.lon, position.lat]);
                this._updateHoverTagContent(position);
            }
            // Keep following — centre map and update label position (skip during hover preview)
            if (this._followEnabled && !this._previewNoradId) {
                if (this._labelMarker)
                    this._labelMarker.setLngLat([position.lon, position.lat]);
                this.map.easeTo({ center: [position.lon, position.lat], duration: 150, easing: (t) => t });
                this._updateStatusBar(position);
            }
            // Push live telemetry to sat info panel
            if (window._SatInfoPanel)
                window._SatInfoPanel.updatePosition(position);
        }
        catch (e) {
            // Silently ignore fetch errors
        }
    }
    _startPolling() {
        if (this._pollInterval)
            return;
        this._pollInterval = setInterval(() => this._fetch(), 5000);
    }
    _stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }
    // ---- Callsign label ----
    _buildLabelEl(isTracking = false) {
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
        nameSpan.textContent = this._activeSatName;
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
    _showLabel(lon, lat) {
        if (this._labelMarker) {
            this._labelMarker.setLngLat([lon, lat]);
            return;
        }
        const el = this._buildLabelEl(false);
        this._labelMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [26, 0] })
            .setLngLat([lon, lat])
            .addTo(this.map);
    }
    _hideLabel() {
        if (this._labelMarker) {
            this._labelMarker.remove();
            this._labelMarker = null;
        }
    }
    // ---- Tag HTML ----
    _tagHTML(p, isTracking) {
        const trkColor = isTracking ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const trkText = isTracking ? 'TRACKING' : 'TRACK';
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
        const rows = [
            ['ALT', `${p.alt_km} km`],
            ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`],
            ['LAT', `${p.lat}°`],
            ['LON', `${p.lon}°`],
        ];
        const rowsHTML = rows.map(([lbl, val]) => `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span class="iss-tag-val" data-field="${lbl}">${val}</span></div>`).join('');
        return `<div style="background:rgba(0,0,0,0.7);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;padding:6px 14px 9px;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:15px;letter-spacing:.12em;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none;color:#c8ff00;letter-spacing:.12em">${this._activeSatName}</span>` +
            `<div style="display:flex;align-items:center;gap:0">${bellBtn}${trkBtn}</div></div>` +
            `<div style="pointer-events:none">` + rowsHTML + `</div></div>`;
    }
    // ---- Hover tag ----
    _showHoverTag(e) {
        if (!e.features || !e.features.length)
            return;
        if (this._followEnabled)
            return; // tracking tag already shown
        if (this._hoverHideTimer) {
            clearTimeout(this._hoverHideTimer);
            this._hoverHideTimer = null;
        }
        if (this._hoverTagMarker)
            return; // already shown
        const coords = [e.lngLat.lng, e.lngLat.lat];
        const props = this._lastPosition
            ? { ...this._lastPosition }
            : { ...e.features[0].properties, lon: coords[0], lat: coords[1] };
        // Hide the label while tag is visible
        if (this._labelMarker)
            this._labelMarker.getElement().style.visibility = 'hidden';
        const el = document.createElement('div');
        el.style.pointerEvents = 'auto';
        el.innerHTML = this._tagHTML(props, false);
        el.addEventListener('mouseenter', () => {
            if (this._hoverHideTimer) {
                clearTimeout(this._hoverHideTimer);
                this._hoverHideTimer = null;
            }
        });
        el.addEventListener('mouseleave', () => this._scheduleHideHoverTag());
        this._wireTrackButton(el, props);
        this._wireNotifButton(el);
        const markerCoords = this._lastPosition
            ? [this._lastPosition.lon, this._lastPosition.lat]
            : coords;
        this._hoverTagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [26, -13] })
            .setLngLat(markerCoords)
            .addTo(this.map);
    }
    _scheduleHideHoverTag() {
        if (this._hoverHideTimer)
            clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 400);
    }
    _hideHoverTagNow() {
        if (this._hoverTagMarker) {
            this._hoverTagMarker.remove();
            this._hoverTagMarker = null;
        }
        // Restore label when not tracking
        if (!this._followEnabled && this._labelMarker) {
            this._labelMarker.getElement().style.visibility = '';
        }
    }
    _updateTagContent(marker, position) {
        const el = marker.getElement();
        if (!el)
            return;
        const vals = {
            ALT: `${position.alt_km} km`,
            VEL: `${position.velocity_kms} km/s`,
            HDG: `${position.track_deg}°`,
            LAT: `${position.lat}°`,
            LON: `${position.lon}°`,
        };
        el.querySelectorAll('.iss-tag-val').forEach(span => {
            const field = span.dataset['field'];
            if (field && vals[field] !== undefined)
                span.textContent = vals[field];
        });
    }
    _updateHoverTagContent(position) {
        if (!this._hoverTagMarker)
            return;
        this._updateTagContent(this._hoverTagMarker, position);
    }
    // ---- Track button wiring ----
    _wireTrackButton(el, _props) {
        const btn = el.querySelector('.iss-track-btn');
        if (!btn)
            return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._hideHoverTagNow();
            this._startFollowing();
        });
    }
    // ---- Pass notifications ----
    _passNotifKey() {
        return `passNotifEnabled_${this._activeNoradId}`;
    }
    _restorePassNotifState() {
        try {
            this._passNotifEnabled = localStorage.getItem(this._passNotifKey()) === '1';
        }
        catch (e) { }
    }
    _savePassNotifState() {
        try {
            if (this._passNotifEnabled)
                localStorage.setItem(this._passNotifKey(), '1');
            else
                localStorage.removeItem(this._passNotifKey());
        }
        catch (e) { }
    }
    _wireNotifButton(el) {
        const btn = el.querySelector('.iss-notif-btn');
        if (!btn)
            return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._togglePassNotif();
            // Update bell appearance in this tag
            const svg = btn.querySelector('svg');
            if (svg) {
                btn.style.color = this._passNotifEnabled ? '#c8ff00' : 'rgba(255,255,255,0.3)';
                const existingSlash = svg.querySelector('line');
                if (this._passNotifEnabled && existingSlash)
                    existingSlash.remove();
                else if (!this._passNotifEnabled && !existingSlash) {
                    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    slash.setAttribute('x1', '1.5');
                    slash.setAttribute('y1', '1.5');
                    slash.setAttribute('x2', '11.5');
                    slash.setAttribute('y2', '11.5');
                    slash.setAttribute('stroke', 'currentColor');
                    slash.setAttribute('stroke-width', '1.5');
                    slash.setAttribute('stroke-linecap', 'square');
                    svg.appendChild(slash);
                }
            }
        });
    }
    _togglePassNotif() {
        if (this._passNotifEnabled) {
            // Disable
            this._passNotifEnabled = false;
            this._lastFiredPassAos = 0;
            if (this._passNotifTimeout) {
                clearTimeout(this._passNotifTimeout);
                this._passNotifTimeout = null;
            }
            if (this._passRefreshInterval) {
                clearInterval(this._passRefreshInterval);
                this._passRefreshInterval = null;
            }
            this._savePassNotifState();
            if (window._Notifications) {
                window._Notifications.add({ type: 'notif-off', title: this._activeSatName, detail: 'Pass notifications disabled' });
            }
        }
        else {
            // Enable
            if (!spaceUserLocationCenter) {
                // Trigger location request then retry once location resolves
                if (typeof goToSpaceUserLocation === 'function')
                    goToSpaceUserLocation();
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
                    type: 'tracking', title: this._activeSatName, detail: 'Pass notifications enabled',
                    action: { label: 'DISABLE NOTIFICATIONS', callback: () => {
                            this._passNotifEnabled = true; // ensure toggle turns it off
                            this._togglePassNotif();
                        } },
                });
            }
        }
    }
    _startPassNotifPolling() {
        this._fetchAndSchedulePasses();
        if (this._passRefreshInterval)
            clearInterval(this._passRefreshInterval);
        this._passRefreshInterval = setInterval(() => this._fetchAndSchedulePasses(), 5 * 60 * 1000);
    }
    async _fetchAndSchedulePasses() {
        if (!spaceUserLocationCenter)
            return;
        const [lon, lat] = spaceUserLocationCenter;
        try {
            const endpoint = this._activeNoradId === '25544'
                ? `/api/space/iss/passes?lat=${lat}&lon=${lon}&hours=24`
                : `/api/space/satellite/${this._activeNoradId}/passes?lat=${lat}&lon=${lon}&hours=24`;
            const resp = await fetch(endpoint);
            if (!resp.ok)
                return;
            const data = await resp.json();
            if (data.error || !data.passes)
                return;
            this._schedulePassNotification(data.passes);
        }
        catch (e) { }
    }
    _schedulePassNotification(passes) {
        // Cancel any pending notification
        if (this._passNotifTimeout) {
            clearTimeout(this._passNotifTimeout);
            this._passNotifTimeout = null;
        }
        if (!this._passNotifEnabled)
            return;
        const now = Date.now();
        const leadMs = 10 * 60 * 1000; // notify 10 min before AOS
        // Find the next upcoming pass
        const next = passes.find(p => p.aos_unix_ms > now);
        if (!next)
            return;
        const delay = (next.aos_unix_ms - leadMs) - now;
        if (delay < 0) {
            // Pass is imminent or already in progress — fire only if not already fired
            if (this._lastFiredPassAos !== next.aos_unix_ms) {
                this._lastFiredPassAos = next.aos_unix_ms;
                this._firePassNotification(next);
            }
            // Schedule the one after
            const remaining = passes.filter(p => p.aos_unix_ms > now + 60000);
            if (remaining.length > 0)
                this._schedulePassNotification(remaining);
            return;
        }
        this._passNotifTimeout = setTimeout(() => {
            this._passNotifTimeout = null;
            if (!this._passNotifEnabled)
                return;
            this._lastFiredPassAos = next.aos_unix_ms;
            this._firePassNotification(next);
            // Schedule the next pass after this one
            const remaining = passes.filter(p => p.aos_unix_ms > next.aos_unix_ms + 60000);
            if (remaining.length > 0) {
                this._schedulePassNotification(remaining);
            }
            else {
                // Refresh the pass list to get the next day's passes
                this._fetchAndSchedulePasses();
            }
        }, delay);
    }
    _firePassNotification(pass) {
        if (!window._Notifications)
            return;
        const aosDate = new Date(pass.aos_unix_ms);
        const aosTime = aosDate.toUTCString().slice(17, 22) + ' UTC';
        window._Notifications.add({
            type: 'tracking',
            title: `${this._activeSatName} PASS`,
            detail: `AOS ~10 min — max ${pass.max_elevation_deg}° elev at ${aosTime}`,
            action: {
                label: 'DISABLE',
                callback: () => {
                    this._passNotifEnabled = true; // ensure toggle turns it off
                    this._togglePassNotif();
                },
            },
        });
    }
    // ---- Following / tracked tag ----
    // ---- Tracking state persistence ----
    _saveIssTracking() {
        try {
            if (this._followEnabled) {
                localStorage.setItem('issTracking', '1');
            }
            else {
                localStorage.removeItem('issTracking');
            }
        }
        catch (e) { }
    }
    _restoreIssTracking() {
        try {
            localStorage.removeItem('issTracking');
        }
        catch (e) { }
    }
    _startFollowing(restoring = false) {
        if (!this._lastPosition)
            return;
        this._followEnabled = true;
        const pos = this._lastPosition;
        const coords = [pos.lon, pos.lat];
        // Update label to show TRACKING state; clicking it untracks
        const newLabelEl = this._buildLabelEl(true);
        newLabelEl.style.visibility = '';
        newLabelEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this._stopFollowing();
        });
        if (this._labelMarker)
            this._labelMarker.remove();
        this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
            .setLngLat(coords)
            .addTo(this.map);
        // Centre map (no zoom change — satellites are best viewed at current zoom)
        this.map.easeTo({ center: coords, duration: 600 });
        // Show tracking info in footer panel
        this._showStatusBar(pos);
        if (this._trackingNotifId && window._Notifications) {
            window._Notifications.dismiss(this._trackingNotifId);
            this._trackingNotifId = null;
        }
        this._saveIssTracking();
    }
    _wireUntrackButton(el) {
        const btn = el.querySelector('.iss-track-btn');
        if (!btn)
            return;
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._stopFollowing();
        });
    }
    _stopFollowing() {
        this._followEnabled = false;
        // Restore label to non-tracking state
        if (this._labelMarker && this._lastPosition) {
            const newLabelEl = this._buildLabelEl(false);
            this._labelMarker.remove();
            this._labelMarker = new maplibregl.Marker({ element: newLabelEl, anchor: 'left', offset: [26, 0] })
                .setLngLat([this._lastPosition.lon, this._lastPosition.lat])
                .addTo(this.map);
        }
        if (window._Notifications && this._trackingNotifId) {
            window._Notifications.dismiss(this._trackingNotifId);
            this._trackingNotifId = null;
        }
        this._hideStatusBar();
        this._saveIssTracking();
        this.map.easeTo({ center: [12, 20], zoom: 2, duration: 600 });
    }
    // ---- Status bar ----
    _buildTrackingFields(p) {
        return [
            { label: 'ALT', value: `${p.alt_km} km` },
            { label: 'VEL', value: `${p.velocity_kms} km/s` },
            { label: 'HDG', value: `${p.track_deg}°` },
            { label: 'LAT', value: `${p.lat}°` },
            { label: 'LON', value: `${p.lon}°` },
        ];
    }
    _showStatusBar(p) {
        if (typeof window._Tracking === 'undefined')
            return;
        window._Tracking.register({
            id: 'space',
            name: this._activeSatName,
            domain: 'SPACE',
            fields: this._buildTrackingFields(p),
            onUntrack: () => this._stopFollowing(),
        });
        if (typeof window._FilterPanel !== 'undefined')
            window._FilterPanel.reposition();
    }
    _hideStatusBar() {
        if (typeof window._Tracking !== 'undefined')
            window._Tracking.unregister('space');
        if (typeof window._FilterPanel !== 'undefined')
            window._FilterPanel.reposition();
    }
    _updateStatusBar(p) {
        if (typeof window._Tracking !== 'undefined') {
            window._Tracking.updateFields('space', this._buildTrackingFields(p));
        }
    }
    // ---- Filter hover preview ----
    // Temporarily shows a different satellite on the map while hovering a search result.
    // Does not affect polling or the active satellite state.
    async previewSatellite(noradId, name) {
        // If already previewing this satellite, do nothing
        if (this._previewNoradId === noradId)
            return;
        // Cancel any in-flight preview fetch
        if (this._previewAbort) {
            this._previewAbort.abort();
            this._previewAbort = null;
        }
        this._previewNoradId = noradId;
        const abort = new AbortController();
        this._previewAbort = abort;
        try {
            const endpoint = noradId === '25544'
                ? '/api/space/iss'
                : `/api/space/satellite/${noradId}`;
            const resp = await fetch(endpoint, { signal: abort.signal });
            if (!resp.ok || abort.signal.aborted)
                return;
            const data = await resp.json();
            if (abort.signal.aborted || this._previewNoradId !== noradId)
                return;
            const { position, ground_track, footprint } = data;
            const issGeo = {
                type: 'FeatureCollection',
                features: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
                        properties: {
                            alt_km: position.alt_km,
                            velocity_kms: position.velocity_kms,
                            track_deg: position.track_deg,
                        },
                    }],
            };
            const footprintGeo = {
                type: 'FeatureCollection',
                features: [
                    { type: 'Feature', geometry: { type: 'LineString', coordinates: footprint }, properties: {} },
                    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [footprint] }, properties: {} },
                ],
            };
            const issSource = this.map.getSource('iss-live');
            const trackSource = this.map.getSource('iss-track-source');
            const fpSource = this.map.getSource('iss-footprint-source');
            if (issSource)
                issSource.setData(issGeo);
            if (trackSource)
                trackSource.setData(ground_track);
            if (fpSource)
                fpSource.setData(footprintGeo);
            // Update the callsign label to show the previewed satellite's name and position.
            // If we're tracking a different sat, hide the TRACKING badge and show the preview name.
            // If we're hovering the currently tracked sat, leave the label untouched.
            if (this._labelMarker) {
                const isTrackedSat = noradId === this._activeNoradId;
                if (!isTrackedSat) {
                    this._labelMarker.setLngLat([position.lon, position.lat]);
                    const spans = this._labelMarker.getElement().querySelectorAll('span');
                    if (spans[0])
                        spans[0].textContent = name || noradId;
                    if (spans[1])
                        spans[1].style.display = 'none'; // hide TRACKING badge
                }
            }
            // Fly to the previewed satellite only if the user setting allows it
            let hoverPreference = 'stay';
            try {
                hoverPreference = localStorage.getItem('sentinel_space_filterHoverPreview') || 'stay';
            }
            catch (_e) { }
            if (hoverPreference === 'fly') {
                this.map.flyTo({ center: [position.lon, position.lat], zoom: Math.max(this.map.getZoom(), 2), duration: 800 });
            }
        }
        catch (_e) {
            // Fetch aborted or failed — ignore
        }
    }
    clearPreview() {
        if (!this._previewNoradId)
            return;
        if (this._previewAbort) {
            this._previewAbort.abort();
            this._previewAbort = null;
        }
        this._previewNoradId = null;
        // Restore active satellite's last known data to the map sources
        const issSource = this.map.getSource('iss-live');
        const trackSource = this.map.getSource('iss-track-source');
        const fpSource = this.map.getSource('iss-footprint-source');
        if (issSource)
            issSource.setData(this._issGeojson);
        if (trackSource)
            trackSource.setData(this._trackGeojson);
        if (fpSource)
            fpSource.setData(this._footprintGeojson);
        // Restore the callsign label to the active satellite's name and position
        if (this._labelMarker) {
            const spans = this._labelMarker.getElement().querySelectorAll('span');
            if (spans[0])
                spans[0].textContent = this._activeSatName;
            if (spans[1])
                spans[1].style.display = ''; // restore TRACKING badge
            if (this._lastPosition)
                this._labelMarker.setLngLat([this._lastPosition.lon, this._lastPosition.lat]);
        }
        // Return map view to active satellite (only if fly mode was active)
        let hoverPreference = 'stay';
        try {
            hoverPreference = localStorage.getItem('sentinel_space_filterHoverPreview') || 'stay';
        }
        catch (_e) { }
        if (hoverPreference === 'fly' && this._lastPosition) {
            this.map.flyTo({ center: [this._lastPosition.lon, this._lastPosition.lat], zoom: Math.max(this.map.getZoom(), 2), duration: 800 });
        }
    }
    // ---- Satellite switching ----
    switchSatellite(noradId, name) {
        // Cancel any active filter preview
        if (this._previewAbort) {
            this._previewAbort.abort();
            this._previewAbort = null;
        }
        this._previewNoradId = null;
        // Stop follow and clear markers for the previous satellite
        if (this._followEnabled)
            this._stopFollowing();
        this._hideHoverTagNow();
        this._hideLabel();
        // Stop pass notification polling for the outgoing satellite
        if (this._passNotifTimeout) {
            clearTimeout(this._passNotifTimeout);
            this._passNotifTimeout = null;
        }
        if (this._passRefreshInterval) {
            clearInterval(this._passRefreshInterval);
            this._passRefreshInterval = null;
        }
        this._passNotifEnabled = false;
        this._lastFiredPassAos = 0;
        this._activeNoradId = noradId;
        this._activeSatName = name;
        this._lastPosition = null;
        this._trackingRestored = true; // prevent restore of old tracking state
        // Ensure the satellite layer is visible
        if (!this.issVisible) {
            this.issVisible = true;
            const issVis = 'visible';
            const trackVis = this.trackVisible ? 'visible' : 'none';
            const fpVis = this.footprintVisible ? 'visible' : 'none';
            ['iss-icon', 'iss-bracket'].forEach(id => {
                try {
                    this.map.setLayoutProperty(id, 'visibility', issVis);
                }
                catch (e) { }
            });
            ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
                try {
                    this.map.setLayoutProperty(id, 'visibility', trackVis);
                }
                catch (e) { }
            });
            ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
                try {
                    this.map.setLayoutProperty(id, 'visibility', fpVis);
                }
                catch (e) { }
            });
            this.setButtonActive(true);
            if (typeof _spaceSyncSideMenu === 'function')
                _spaceSyncSideMenu();
        }
        // Restore per-satellite pass notification preference and resume polling if enabled
        this._restorePassNotifState();
        if (this._passNotifEnabled)
            this._startPassNotifPolling();
        // Restart polling against the new satellite
        this._stopPolling();
        this._fetch();
        this._startPolling();
        // Notify sat-info panel
        document.dispatchEvent(new CustomEvent('satellite-selected', { detail: { noradId, name } }));
    }
    // ---- Visibility toggles ----
    toggleIss() {
        this.issVisible = !this.issVisible;
        const issVis = this.issVisible ? 'visible' : 'none';
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
        ['iss-icon', 'iss-bracket'].forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', issVis);
            }
            catch (e) { }
        });
        ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', trackVis);
            }
            catch (e) { }
        });
        ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', fpVis);
            }
            catch (e) { }
        });
        this.setButtonActive(this.issVisible);
        if (!this.issVisible) {
            this._stopPolling();
            this._stopFollowing();
            this._hideHoverTagNow();
            this._hideLabel();
            // Reset to ISS when toggling off
            this._activeNoradId = '25544';
            this._activeSatName = 'ISS';
        }
        else {
            this._fetch();
            this._startPolling();
        }
        if (typeof _spaceSyncSideMenu === 'function')
            _spaceSyncSideMenu();
    }
    toggleTrack() {
        this.trackVisible = !this.trackVisible;
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', trackVis);
            }
            catch (e) { }
        });
        if (typeof _spaceSyncSideMenu === 'function')
            _spaceSyncSideMenu();
    }
    toggleFootprint() {
        this.footprintVisible = !this.footprintVisible;
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
        ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', fpVis);
            }
            catch (e) { }
        });
        if (typeof _spaceSyncSideMenu === 'function')
            _spaceSyncSideMenu();
    }
    onRemove() {
        this._stopPolling();
        this._stopFollowing();
        this._hideHoverTagNow();
        this._hideLabel();
        if (this._passNotifTimeout) {
            clearTimeout(this._passNotifTimeout);
            this._passNotifTimeout = null;
        }
        if (this._passRefreshInterval) {
            clearInterval(this._passRefreshInterval);
            this._passRefreshInterval = null;
        }
        super.onRemove();
    }
}
issControl = new IssControl();
map.addControl(issControl, 'top-right');
