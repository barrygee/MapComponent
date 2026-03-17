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
// Click on ISS shows an info tag with altitude, velocity, heading.
//
// Depends on: map (global alias), SentinelControlBase,
//             _spaceOverlayStates, _saveSpaceOverlayStates
// ============================================================

class IssControl extends SentinelControlBase {
    constructor() {
        super();
        this.issVisible       = _spaceOverlayStates.iss;
        this.trackVisible     = _spaceOverlayStates.groundTrack;
        this.footprintVisible = _spaceOverlayStates.footprint;
        this._pollInterval    = null;
        this._tagMarker       = null;
        this._lastPosition    = null;
        this._labelMarker     = null;
        // GeoJSON stores
        this._issGeojson       = { type: 'FeatureCollection', features: [] };
        this._trackGeojson     = { type: 'FeatureCollection', features: [] };
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
        if (this.map.isStyleLoaded()) {
            this.initLayers();
            if (this.issVisible) {
                this._fetch();
                this._startPolling();
            }
        }
        // Style-reload reinit is handled by space-overlay-reinit.js via MapComponent.onStyleLoad
    }

    handleClick() { this.toggleIss(); }

    // ---- Canvas sprite factories ----
    _createSatelliteIcon() {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const cx = size / 2, cy = size / 2;

        // Body: diamond shape in lime
        ctx.beginPath();
        ctx.moveTo(cx, cy - 11);
        ctx.lineTo(cx + 9, cy);
        ctx.lineTo(cx, cy + 11);
        ctx.lineTo(cx - 9, cy);
        ctx.closePath();
        ctx.fillStyle = '#c8ff00';
        ctx.fill();

        // Solar panels: horizontal bars
        ctx.fillStyle = 'rgba(200,255,0,0.55)';
        ctx.fillRect(cx - 28, cy - 4, 15, 8);  // left panel
        ctx.fillRect(cx + 13,  cy - 4, 15, 8);  // right panel

        // Antenna: vertical line up
        ctx.strokeStyle = 'rgba(200,255,0,0.55)';
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

        [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]].forEach(([x, y, dx, dy]) => {
            ctx.beginPath();
            ctx.moveTo(x + dx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * arm);
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

        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        const fpVis    = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
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

        // Click on ISS — show info tag
        this.map.on('click', 'iss-icon',    (e) => this._showTag(e));
        this.map.on('click', 'iss-bracket', (e) => this._showTag(e));
        this.map.on('click', (e) => {
            const hits = this.map.queryRenderedFeatures(e.point, { layers: ['iss-icon', 'iss-bracket'] });
            if (!hits.length) this._hideTag();
        });
        this.map.on('mouseenter', 'iss-icon',    () => { this.map.getCanvas().style.cursor = 'pointer'; });
        this.map.on('mouseleave', 'iss-icon',    () => { this.map.getCanvas().style.cursor = ''; });
        this.map.on('mouseenter', 'iss-bracket', () => { this.map.getCanvas().style.cursor = 'pointer'; });
        this.map.on('mouseleave', 'iss-bracket', () => { this.map.getCanvas().style.cursor = ''; });
    }

    // ---- Data fetch ----
    async _fetch() {
        try {
            const resp = await fetch('/api/space/iss');
            if (!resp.ok) return;
            const data = await resp.json();
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
                    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [footprint] }, properties: {} },
                ],
            };

            // Push to map sources
            const issSource = this.map && this.map.getSource('iss-live');
            if (issSource) issSource.setData(this._issGeojson);

            const trackSource = this.map && this.map.getSource('iss-track-source');
            if (trackSource) trackSource.setData(this._trackGeojson);

            const fpSource = this.map && this.map.getSource('iss-footprint-source');
            if (fpSource) fpSource.setData(this._footprintGeojson);

            // Keep callsign label in sync
            if (this.issVisible) {
                this._showLabel(position.lon, position.lat);
            }

            // Keep tag position in sync while open
            if (this._tagMarker) {
                this._tagMarker.setLngLat([position.lon, position.lat]);
                this._updateTagContent(position);
            }

        } catch (e) {
            // Silently ignore fetch errors
        }
    }

    _startPolling() {
        if (this._pollInterval) return;
        this._pollInterval = setInterval(() => this._fetch(), 5000);
    }

    _stopPolling() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }

    // ---- Callsign label ----
    _buildLabelEl() {
        const el = document.createElement('div');
        el.style.cssText = [
            'background:rgba(0,0,0,0.5)',
            'color:#c8ff00',
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
        if (this._labelMarker) { this._labelMarker.remove(); this._labelMarker = null; }
    }

    // ---- Info tag ----
    _buildTagEl(props) {
        const el = document.createElement('div');
        el.style.cssText = [
            'background:#000',
            'border:1px solid rgba(200,255,0,0.5)',
            'color:#fff',
            'font-family:"Barlow Condensed","Barlow","Helvetica Neue",Arial,sans-serif',
            'font-size:11px',
            'letter-spacing:0.08em',
            'padding:8px 12px',
            'pointer-events:none',
            'white-space:nowrap',
            'z-index:1000',
            'transform:translate(-50%,-115%)',
        ].join(';');
        el.innerHTML = this._tagHTML(props);
        return el;
    }

    _tagHTML(p) {
        return [
            `<div style="color:#c8ff00;font-weight:700;font-size:12px;margin-bottom:4px">ISS</div>`,
            `<div>ALT&nbsp;&nbsp;<span style="color:#c8ff00">${p.alt_km} km</span></div>`,
            `<div>VEL&nbsp;&nbsp;<span style="color:#c8ff00">${p.velocity_kms} km/s</span></div>`,
            `<div>HDG&nbsp;&nbsp;<span style="color:#c8ff00">${p.track_deg}°</span></div>`,
            `<div>LAT&nbsp;&nbsp;<span style="color:rgba(255,255,255,0.6)">${p.lat}°</span></div>`,
            `<div>LON&nbsp;&nbsp;<span style="color:rgba(255,255,255,0.6)">${p.lon}°</span></div>`,
        ].join('');
    }

    _updateTagContent(position) {
        if (!this._tagMarker) return;
        const el = this._tagMarker.getElement();
        if (el) el.innerHTML = this._tagHTML(position);
    }

    _showTag(e) {
        if (!e.features || !e.features.length) return;
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates;
        this._hideTag();
        const el = this._buildTagEl(props);
        this._tagMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(coords)
            .addTo(this.map);
    }

    _hideTag() {
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
    }

    // ---- Visibility toggles ----
    toggleIss() {
        this.issVisible = !this.issVisible;
        const issVis   = this.issVisible ? 'visible' : 'none';
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        const fpVis    = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
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
            this._hideTag();
            this._hideLabel();
        } else {
            this._fetch();
            this._startPolling();
        }
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    toggleTrack() {
        this.trackVisible = !this.trackVisible;
        const trackVis = (this.issVisible && this.trackVisible) ? 'visible' : 'none';
        ['iss-track-orbit1', 'iss-track-orbit2'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', trackVis); } catch (e) {}
        });
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    toggleFootprint() {
        this.footprintVisible = !this.footprintVisible;
        const fpVis = (this.issVisible && this.footprintVisible) ? 'visible' : 'none';
        ['iss-footprint-fill', 'iss-footprint'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', fpVis); } catch (e) {}
        });
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
    }

    onRemove() {
        this._stopPolling();
        this._hideTag();
        this._hideLabel();
        super.onRemove();
    }
}

issControl = new IssControl();
map.addControl(issControl, 'top-right');
