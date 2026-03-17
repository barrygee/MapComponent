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
        this._hoverHideTimer = null;
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
    // ---- Data fetch ----
    async _fetch() {
        try {
            const resp = await fetch('/api/space/iss');
            if (!resp.ok)
                return;
            const data = await resp.json();
            if (data.error)
                return;
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
            // Push to map sources
            const issSource = this.map && this.map.getSource('iss-live');
            if (issSource)
                issSource.setData(this._issGeojson);
            const trackSource = this.map && this.map.getSource('iss-track-source');
            if (trackSource)
                trackSource.setData(this._trackGeojson);
            const fpSource = this.map && this.map.getSource('iss-footprint-source');
            if (fpSource)
                fpSource.setData(this._footprintGeojson);
            // Keep callsign label in sync (only when tag is not shown)
            if (this.issVisible && !this._hoverTagMarker && !this._followEnabled) {
                this._showLabel(position.lon, position.lat);
            }
            else if (this.issVisible && this._labelMarker) {
                this._labelMarker.setLngLat([position.lon, position.lat]);
            }
            // Keep hover tag position in sync while open
            if (this._hoverTagMarker) {
                this._hoverTagMarker.setLngLat([position.lon, position.lat]);
                this._updateHoverTagContent(position);
            }
            // Keep follow tag position in sync and centre map
            if (this._tagMarker && this._followEnabled) {
                this._tagMarker.setLngLat([position.lon, position.lat]);
                this._updateStatusBar(position);
                this.map.easeTo({ center: [position.lon, position.lat], duration: 150, easing: (t) => t });
            }
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
    _buildLabelEl() {
        const el = document.createElement('div');
        el.style.cssText = [
            'background:rgba(0,0,0,0.5)',
            'color:#ffffff',
            "font-family:'Barlow Condensed','Barlow','Helvetica Neue',Arial,sans-serif",
            'font-size:13px',
            'font-weight:400',
            'letter-spacing:.12em',
            'text-transform:uppercase',
            'padding:1px 8px',
            'white-space:nowrap',
            'pointer-events:none',
            'user-select:none',
        ].join(';');
        el.textContent = 'ISS';
        return el;
    }
    _showLabel(lon, lat) {
        if (this._labelMarker) {
            this._labelMarker.setLngLat([lon, lat]);
            return;
        }
        const el = this._buildLabelEl();
        this._labelMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [22, 0] })
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
        const rows = [
            ['ALT', `${p.alt_km} km`],
            ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`],
            ['LAT', `${p.lat}°`],
            ['LON', `${p.lon}°`],
        ];
        const rowsHTML = rows.map(([lbl, val]) => `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`).join('');
        return `<div style="background:rgba(0,0,0,0.7);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;padding:6px 14px 9px;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:15px;letter-spacing:.12em;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none;color:#c8ff00;letter-spacing:.12em">ISS</span>` +
            `${trkBtn}</div>` +
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
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates;
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
        this._hoverTagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
    }
    _scheduleHideHoverTag() {
        if (this._hoverHideTimer)
            clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 200);
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
    _updateHoverTagContent(position) {
        if (!this._hoverTagMarker)
            return;
        const el = this._hoverTagMarker.getElement();
        if (!el)
            return;
        const inner = el.querySelector('[style*="background:rgba"]');
        if (!inner)
            return;
        const rowsDiv = inner.querySelector('div:last-child');
        if (rowsDiv)
            rowsDiv.innerHTML = [
                ['ALT', `${position.alt_km} km`],
                ['VEL', `${position.velocity_kms} km/s`],
                ['HDG', `${position.track_deg}°`],
                ['LAT', `${position.lat}°`],
                ['LON', `${position.lon}°`],
            ].map(([lbl, val]) => `<div style="display:flex;gap:14px;line-height:1.8">` +
                `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
                `<span>${val}</span></div>`).join('');
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
    // ---- Following / tracked tag ----
    _startFollowing() {
        if (!this._lastPosition)
            return;
        this._followEnabled = true;
        const pos = this._lastPosition;
        const coords = [pos.lon, pos.lat];
        // Hide label while tracking
        if (this._labelMarker)
            this._labelMarker.getElement().style.visibility = 'hidden';
        const el = document.createElement('div');
        el.style.pointerEvents = 'auto';
        el.innerHTML = this._tagHTML(pos, true);
        el.addEventListener('mouseenter', () => {
            const b = el.querySelector('.iss-track-btn');
            if (b)
                b.textContent = 'UNTRACK';
        });
        el.addEventListener('mouseleave', () => {
            const b = el.querySelector('.iss-track-btn');
            if (b)
                b.textContent = 'TRACKING';
        });
        this._wireUntrackButton(el);
        if (this._tagMarker) {
            this._tagMarker.remove();
            this._tagMarker = null;
        }
        this._tagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
        this._showStatusBar(pos);
        this.map.easeTo({ center: coords, zoom: 4, duration: 600 });
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
        if (this._tagMarker) {
            this._tagMarker.remove();
            this._tagMarker = null;
        }
        this._hideStatusBar();
        // Restore label
        if (this._labelMarker)
            this._labelMarker.getElement().style.visibility = '';
    }
    // ---- Status bar ----
    _buildStatusBarHTML(p) {
        const fields = [
            ['ALT', `${p.alt_km} km`],
            ['VEL', `${p.velocity_kms} km/s`],
            ['HDG', `${p.track_deg}°`],
            ['LAT', `${p.lat}°`],
            ['LON', `${p.lon}°`],
        ];
        const fieldsHTML = fields.map(([lbl, val]) => `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-label-tag">TRACKING</span>` +
            `<button class="adsb-sb-untrack-btn">UNTRACK</button>` +
            `</div>` +
            `<div class="adsb-sb-header" style="border-top:none;height:auto;padding:8px 14px 9px">` +
            `<span class="adsb-sb-callsign" style="color:#c8ff00">ISS</span>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }
    _showStatusBar(p) {
        let bar = document.getElementById('iss-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'iss-status-bar';
            bar.style.cssText = 'width:220px;background:#000;color:#fff;font-family:"Barlow","Helvetica Neue",Arial,sans-serif;pointer-events:auto;display:none;flex-direction:column;gap:0;user-select:none;box-sizing:border-box;';
            const panel = document.getElementById('tracking-panel');
            if (panel)
                panel.appendChild(bar);
            else
                document.body.appendChild(bar);
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
        if (typeof window._Tracking !== 'undefined') {
            window._Tracking.setCount(1);
            window._Tracking.openPanel();
        }
        if (typeof window._FilterPanel !== 'undefined')
            window._FilterPanel.reposition();
    }
    _hideStatusBar() {
        const bar = document.getElementById('iss-status-bar');
        if (bar)
            bar.style.display = 'none';
        if (typeof window._Tracking !== 'undefined') {
            window._Tracking.setCount(0);
            window._Tracking.closePanel();
        }
        if (typeof window._FilterPanel !== 'undefined')
            window._FilterPanel.reposition();
    }
    _updateStatusBar(p) {
        const bar = document.getElementById('iss-status-bar');
        if (!bar || bar.style.display === 'none')
            return;
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
        super.onRemove();
    }
}
issControl = new IssControl();
map.addControl(issControl, 'top-right');
