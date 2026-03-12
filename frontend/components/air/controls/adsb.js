// ============================================================
// ADS-B LIVE CONTROL
// Polls airplanes.live API (via backend proxy) every 5s,
// dead-reckons positions every 100ms, renders aircraft as
// canvas sprites in MapLibre symbol layers, manages click/hover
// data tags, trail history, tracking, squawk emergency detection,
// and departure/landing notifications.
//
// Depends on:
//   map (global alias), maplibregl, _overlayStates, _saveOverlayStates,
//   _Notifications, _Tracking, _FilterPanel (optional), window._adsb,
//   AIRPORTS_DATA (airports.js must load first)
// ============================================================

class AdsbLiveControl {
    constructor() {
        // Restore visibility from localStorage; defaults to true on first load
        this.visible = _overlayStates.adsb;

        // Polling/interpolation interval IDs (set by _startPolling, cleared by _stopPolling)
        this._pollInterval        = null;
        this._interpolateInterval = null;

        // GeoJSON feature collections written to MapLibre sources
        this._geojson       = { type: 'FeatureCollection', features: [] }; // latest API snapshot
        this._trailsGeojson = { type: 'FeatureCollection', features: [] }; // dot trail for selected aircraft

        // Per-hex position history (ring buffer, max 100 points)
        this._trails    = {};
        this._MAX_TRAIL = 100;

        // Currently selected and followed aircraft hex codes
        this._selectedHex = null;

        // Guard: click/hover map event handlers added once only
        this._eventsAdded = false;

        // Last real API fix per hex: { lon, lat, gs, track, lastSeen }
        // Used by the dead-reckoning interpolator
        this._lastPositions = {};

        // Placeholder — sprite loading is synchronous (canvas-drawn), resolves immediately
        this._spriteReady = Promise.resolve();

        // Currently visible HTML data-tag marker (click to select an aircraft)
        this._tagMarker = null;
        this._tagHex    = null;

        // Whether "TRACKING" mode is active (map follows selected aircraft)
        this._followEnabled = false;

        // Hover tag marker (shown while hovering an unselected aircraft)
        this._hoverMarker = null;
        this._hoverHex    = null;

        // HTML callsign label markers: hex → MapLibre Marker
        this._callsignMarkers = {};

        // Independent of ADS-B layer visibility — labels may be toggled separately
        this.labelsVisible = _overlayStates.adsbLabels ?? true;

        // Landing/departure detection state (per hex)
        this._prevAlt      = {};  // last known altitude for detecting transitions
        this._hasDeparted  = {};  // true once a departure notification has fired (until next landing)
        this._landedAt     = {};  // timestamp when the aircraft transitioned to alt=0
        this._seenOnGround = {};  // true once observed at alt=0 while notifications are enabled

        // Timeout IDs to remove parked aircraft from the map after 1 minute
        this._parkedTimers = {};

        // Set of hex codes that have notifications enabled (independent of tracking)
        this._notifEnabled = new Set();

        // Prevents restoring tracking state more than once per session
        this._trackingRestored = false;

        // Timestamps / in-flight guard for the API fetch loop
        this._lastFetchTime = 0;
        this._isFetching    = false;

        // Squawk codes that trigger emergency notifications
        this._emergencySquawks = new Set(['7700', '7600', '7500']);

        // Previous squawk per hex — used to detect squawk changes
        this._prevSquawk = {};

        // Type filter: 'all' | 'civil' | 'mil'
        this._typeFilter = 'all';

        // Master override: true hides all aircraft regardless of type filter
        this._allHidden = false;

        // Fine-grained hide flags for non-aircraft categories
        this._hideGroundVehicles = false; // C1, C2
        this._hideTowers         = false; // C3, C4, C5 or t=TWR

        // Consecutive fetch failure count — resets on success, triggers 30s back-off at 3
        this._fetchFailCount = 0;
    }

    // ---- Public filter setters (called by _FilterPanel / side-menu) ----

    /** Apply a civil/mil/all type filter to the map layers and callsign markers. */
    setTypeFilter(mode) {
        this._typeFilter = mode;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    /**
     * Master hide/show for all aircraft.
     * While hidden, the tracked aircraft (if any) remains visible.
     */
    setAllHidden(hidden) {
        this._allHidden = hidden;
        this._applyTypeFilter();
        this._updateCallsignMarkers();

        // HTML markers (tag and hover) must also be hidden/shown manually
        // — they live outside MapLibre's filter system.
        const isTracking = this._followEnabled && this._selectedHex;
        const tagEl = this._tagMarker ? this._tagMarker.getElement() : null;
        if (tagEl) tagEl.style.visibility = (hidden && !isTracking) ? 'hidden' : '';
        const hoverEl = this._hoverMarker ? this._hoverMarker.getElement() : null;
        if (hoverEl) hoverEl.style.visibility = hidden ? 'hidden' : '';

        // Trails layer: keep visible while actively tracking, otherwise hide
        try { this.map.setLayoutProperty('adsb-trails', 'visibility', (!hidden || isTracking) ? 'visible' : 'none'); } catch(e) {}
    }

    /** Hide/show ground vehicles (ADS-B category C1/C2). */
    setHideGroundVehicles(hide) {
        this._hideGroundVehicles = hide;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    /** Hide/show fixed obstructions / towers (C3/C4/C5 or t=TWR). */
    setHideTowers(hide) {
        this._hideTowers = hide;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    // ---- Layer filter ----

    /**
     * Build and push a MapLibre filter expression to adsb-bracket and adsb-icons
     * that reflects the current type filter, hide flags, and allHidden state.
     * Ground vehicles and towers are only shown when type filter is 'all'.
     */
    _applyTypeFilter() {
        if (!this.map) return;

        // Base display rule: show if airborne OR if zoomed in enough to show ground traffic
        const baseFilter  = ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]];

        // MapLibre expressions to identify vehicle/tower categories
        const isGndExpr   = ['match', ['get', 'category'], ['C1', 'C2'], true, false];
        const isTowerExpr = ['any',
            ['match', ['get', 'category'], ['C3', 'C4', 'C5'], true, false],
            ['==', ['get', 't'], 'TWR'],
        ];
        // A "plane" is anything that is neither a ground vehicle nor a tower
        const isPlaneExpr = ['all', ['!', isGndExpr], ['!', isTowerExpr]];

        if (this._allHidden) {
            // All hidden — keep only the tracked aircraft visible if follow is active
            const trackedHex = this._followEnabled && this._selectedHex ? this._selectedHex : null;
            if (trackedHex) {
                const trackedFilter = ['==', ['get', 'hex'], trackedHex];
                ['adsb-bracket', 'adsb-icons'].forEach(id => {
                    try {
                        this.map.setLayoutProperty(id, 'visibility', 'visible');
                        this.map.setFilter(id, trackedFilter);
                    } catch(e) {}
                });
            } else {
                ['adsb-bracket', 'adsb-icons'].forEach(id => {
                    try { this.map.setLayoutProperty(id, 'visibility', 'none'); } catch(e) {}
                });
            }
            return;
        }

        // Ensure both layers are visible before setting filters
        ['adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', 'visible'); } catch(e) {}
        });

        // Ground vehicles and towers are only shown in 'all' mode and when their
        // respective hide flags are not set
        const typeFiltering = this._typeFilter !== 'all';
        const showGnd    = this.visible && !typeFiltering && !this._hideGroundVehicles;
        const showTowers = this.visible && !typeFiltering && !this._hideTowers;

        // Build an array of sub-filters; combine with 'any' at the end
        const conditions = [];

        if (this.visible) {
            if (this._typeFilter === 'civil') {
                // Civil planes only (not flagged military)
                conditions.push(['all', baseFilter, isPlaneExpr, ['!', ['boolean', ['get', 'military'], false]]]);
            } else if (this._typeFilter === 'mil') {
                // Military planes only
                conditions.push(['all', baseFilter, isPlaneExpr, ['boolean', ['get', 'military'], false]]);
            } else {
                // All plane categories
                conditions.push(['all', baseFilter, isPlaneExpr]);
            }
        }

        if (showGnd)    conditions.push(isGndExpr);
        if (showTowers) conditions.push(isTowerExpr);

        // If nothing is included, match nothing; otherwise OR all conditions together
        const filter = conditions.length === 0
            ? ['==', ['get', 'hex'], '']
            : conditions.length === 1 ? conditions[0] : ['any', ...conditions];

        try { this.map.setFilter('adsb-bracket', filter); } catch(e) {}
        try { this.map.setFilter('adsb-icons',   filter); } catch(e) {}
    }

    // ---- MapLibre control lifecycle ----

    /**
     * Called by MapLibre when this control is added to the map.
     * Builds the toolbar button and schedules layer/sprite initialisation.
     */
    onAdd(map) {
        this.map = map;

        // Standard MapLibre control wrapper
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        // "ADS" text button — compact label fits the 29px toolbar slot
        this.button = document.createElement('button');
        this.button.title     = 'Toggle live ADS-B aircraft';
        this.button.textContent = 'ADS';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:8px;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s,color 0.2s';
        this.button.style.opacity = this.visible ? '1'       : '0.3';
        this.button.style.color   = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick     = () => this.toggle();
        this.button.onmouseover = () => { this.button.style.background = '#111'; };
        this.button.onmouseout  = () => { this.button.style.background = '#000'; };

        this.container.appendChild(this.button);

        // Pre-fetch data now so planes are ready when style.load fires
        if (this.visible) this._fetch();

        // Sprite images are drawn to canvas (no I/O), so this resolves immediately.
        // The .then() pattern is kept to match the style-load guard logic.
        this._spriteReady.then(() => {
            if (!this.map) return;
            if (this.map.isStyleLoaded()) {
                this.initLayers();
            } else {
                this.map.once('style.load', () => this.initLayers());
            }
        });

        return this.container;
    }

    /** Clean up intervals and remove the control element on removal. */
    onRemove() {
        this._stopPolling();
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    // ---- Altitude helper ----

    /**
     * Normalise alt_baro to a non-negative integer.
     * The API returns 'ground', '', or null for surface positions — all become 0.
     */
    _parseAlt(alt_baro) {
        if (alt_baro === 'ground' || alt_baro === '' || alt_baro == null) return 0;
        const alt = typeof alt_baro === 'number' ? alt_baro : parseFloat(alt_baro) || 0;
        return alt < 0 ? 0 : alt; // clamp negative altitudes (underground) to zero
    }

    // ---- Canvas sprite factories ----
    // All icons are drawn at 64×64 px (devicePixelRatio 2 → 32px logical).
    // ImageData is returned and registered with maplibregl.Map.addImage().

    /**
     * Solid directional triangle pointing north.
     * Rotated by MapLibre's icon-rotate property to match aircraft track.
     * @param {string} color - fill colour (hex or CSS)
     * @param {number} scale - size multiplier around the triangle centroid
     */
    _createRadarBlip(color = '#ffffff', scale = 1) {
        const S  = 64;
        const cx = S / 2, cy = S / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        // Triangle vertices centred on the canvas
        const apex = { x: cx,     y: cy - 13 };
        const bR   = { x: cx + 9, y: cy + 10 };
        const bL   = { x: cx - 9, y: cy + 10 };

        // Compute centroid so scaling is centred on the visual centre of mass
        const gcx = (apex.x + bR.x + bL.x) / 3;
        const gcy = (apex.y + bR.y + bL.y) / 3;

        // Scale each vertex around the centroid
        const scaleVertex = (v) => ({ x: gcx + (v.x - gcx) * scale, y: gcy + (v.y - gcy) * scale });
        const A = scaleVertex(apex), B = scaleVertex(bR), C = scaleVertex(bL);

        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.lineTo(C.x, C.y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        return ctx.getImageData(0, 0, S, S);
    }

    /**
     * Axis-aligned bracket corners (matching the SENTINEL location-marker SVG).
     * Viewport-aligned so it never rotates regardless of map bearing.
     * @param {string} color - stroke colour (default lime)
     */
    _createBracket(color = '#c8ff00') {
        const S   = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        // Bounding box coordinates (maps SVG viewBox 14 15 32 30 to 64×64 at 2:1)
        const x1 = 4, y1 = 4, x2 = 60, y2 = 56;
        const arm = 10; // length of each bracket arm in canvas pixels

        // Semi-transparent black fill makes the bracket visible on bright map tiles
        ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

        ctx.strokeStyle = color;
        ctx.lineWidth   = 3;      // 1.5 logical px at pixelRatio 2
        ctx.lineCap     = 'square';

        // Draw four corner brackets
        ctx.beginPath(); ctx.moveTo(x1 + arm, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 + arm); ctx.stroke(); // top-left
        ctx.beginPath(); ctx.moveTo(x2 - arm, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + arm); ctx.stroke(); // top-right
        ctx.beginPath(); ctx.moveTo(x1 + arm, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - arm); ctx.stroke(); // bottom-left
        ctx.beginPath(); ctx.moveTo(x2 - arm, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - arm); ctx.stroke(); // bottom-right

        return ctx.getImageData(0, 0, S, S);
    }

    /**
     * Military bracket: same shape as civil but black stroke on darker fill.
     * Used for military aircraft to distinguish them from the lime civil bracket.
     */
    _createMilBracket() {
        const S   = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');
        const x1 = 4, y1 = 4, x2 = 60, y2 = 56, arm = 10;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; // slightly darker fill than civil
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeStyle = '#000000'; // black bracket arms
        ctx.lineWidth   = 3;
        ctx.lineCap     = 'square';
        ctx.beginPath(); ctx.moveTo(x1 + arm, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 + arm); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2 - arm, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + arm); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1 + arm, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - arm); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2 - arm, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - arm); ctx.stroke();

        return ctx.getImageData(0, 0, S, S);
    }

    /**
     * Fixed obstruction / tower icon — solid white circle.
     * Does not rotate (icon-rotate is not applied to this image).
     */
    _createTowerBlip(scale = 1.1) {
        const S  = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, 9 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        return ctx.getImageData(0, 0, S, S);
    }

    /**
     * Ground vehicle icon — solid filled square.
     * @param {string} color - fill colour (C1 emergency vehicles use red)
     */
    _createGroundVehicleBlip(color = '#ffffff', scale = 1.1) {
        const S  = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');
        const half = 9 * scale;
        const cx = S / 2, cy = S / 2;
        ctx.fillStyle = color;
        ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
        return ctx.getImageData(0, 0, S, S);
    }

    /**
     * UAV / drone icon — directional triangle with an × drawn inside.
     * Inherits the same shape and scale logic as _createRadarBlip.
     */
    _createUAVBlip(color = '#ffffff', scale = 1.1) {
        const S  = 64;
        const cx = S / 2, cy = S / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        const apex = { x: cx,     y: cy - 13 };
        const bR   = { x: cx + 9, y: cy + 10 };
        const bL   = { x: cx - 9, y: cy + 10 };
        const gcx = (apex.x + bR.x + bL.x) / 3;
        const gcy = (apex.y + bR.y + bL.y) / 3;
        const sv  = (v) => ({ x: gcx + (v.x - gcx) * scale, y: gcy + (v.y - gcy) * scale });
        const A = sv(apex), B = sv(bR), C = sv(bL);

        // Filled triangle body
        ctx.beginPath();
        ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // × drawn at the triangle's centroid to visually distinguish UAVs from conventional aircraft
        const xSize = 4.5 * scale;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 1.8;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(gcx - xSize, gcy - xSize); ctx.lineTo(gcx + xSize, gcy + xSize);
        ctx.moveTo(gcx + xSize, gcy - xSize); ctx.lineTo(gcx - xSize, gcy + xSize);
        ctx.stroke();

        return ctx.getImageData(0, 0, S, S);
    }

    // ---- Sprite registration ----

    /**
     * Remove any previously registered ADS-B images from the map (e.g. after a style reload)
     * and add fresh ones. Called by initLayers() on every style-load cycle.
     */
    _registerIcons() {
        // Remove old images first — harmless if they don't exist (no-op)
        const toRemove = ['adsb-bracket', 'adsb-bracket-mil', 'adsb-bracket-emerg',
                          'adsb-blip', 'adsb-blip-mil', 'adsb-blip-emerg', 'adsb-blip-uav',
                          'adsb-blip-gnd', 'adsb-blip-tower', 'adsb-blip-emerg-gnd',
                          'adsb-bracket-emerg-gnd'];
        toRemove.forEach(name => { if (this.map.hasImage(name)) this.map.removeImage(name); });

        // Register all icon variants; pixelRatio:2 keeps logical size at 32px
        this.map.addImage('adsb-bracket',           this._createBracket(),                         { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-bracket-mil',        this._createMilBracket(),                      { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-bracket-emerg',      this._createBracket('#ff2222'),                { pixelRatio: 2, sdf: false }); // red bracket for emergencies
        this.map.addImage('adsb-bracket-emerg-gnd',  this._createBracket('#ff2222'),                { pixelRatio: 2, sdf: false }); // same red, C1 emergency ground vehicle
        this.map.addImage('adsb-blip',               this._createRadarBlip('#ffffff',         1.1), { pixelRatio: 2, sdf: false }); // civil aircraft
        this.map.addImage('adsb-blip-mil',           this._createRadarBlip('#c8ff00',         1.1), { pixelRatio: 2, sdf: false }); // military — lime fill
        this.map.addImage('adsb-blip-emerg',         this._createRadarBlip('#ff2222',         1.1), { pixelRatio: 2, sdf: false }); // emergency squawk — red
        this.map.addImage('adsb-blip-uav',           this._createUAVBlip('#ffffff',           1.1), { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-blip-gnd',           this._createGroundVehicleBlip('#ffffff', 1.1), { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-blip-emerg-gnd',     this._createGroundVehicleBlip('#ff2222', 1.1), { pixelRatio: 2, sdf: false }); // C1 emergency vehicle
        this.map.addImage('adsb-blip-tower',         this._createTowerBlip(1.1),                    { pixelRatio: 2, sdf: false });
    }

    // ---- Map layer initialisation ----

    /**
     * Add GeoJSON sources and the three ADS-B map layers (trails, bracket, icons).
     * Called once on initial style load and again by overlay-reinit.js after each
     * style switch (online ↔ offline). Also wires click/hover event handlers.
     */
    initLayers() {
        const vis = this.visible ? 'visible' : 'none';

        // Clean up any layers/sources from a previous style cycle
        ['adsb-icons', 'adsb-bracket', 'adsb-trails'].forEach(id => {
            try { this.map.removeLayer(id); } catch(e) {}
        });
        this._clearCallsignMarkers();
        ['adsb-live', 'adsb-trails-source'].forEach(id => {
            if (this.map.getSource(id)) this.map.removeSource(id);
        });

        // Re-register canvas sprite images after the style reload
        this._registerIcons();

        // --- Trail dots (rendered behind icons so they're covered by the aircraft symbol) ---
        this.map.addSource('adsb-trails-source', { type: 'geojson', data: this._trailsGeojson });
        this.map.addLayer({
            id: 'adsb-trails',
            type: 'circle',
            source: 'adsb-trails-source',
            layout: { visibility: vis },
            paint: {
                'circle-radius': 2.5,
                'circle-opacity': ['get', 'opacity'], // oldest dots are near 0, newest near 1
                'circle-stroke-width': 0,
                // Red trail for emergency squawks, lime for everything else
                'circle-color': ['case', ['==', ['get', 'emerg'], 1], '#ff2222', '#c8ff00'],
            },
        });

        // --- Aircraft position source ---
        this.map.addSource('adsb-live', { type: 'geojson', data: this._geojson });

        // --- Bracket layer: viewport-aligned so bracket corners always face screen edges ---
        // Bracket image selection priority: emergency > military > C1 ground > default
        this.map.addLayer({
            id: 'adsb-bracket',
            type: 'symbol',
            source: 'adsb-live',
            // A0/B0/C0 = "no category info" — excluded to avoid cluttering the map
            filter: ['all',
                ['!', ['match', ['get', 'category'], ['A0', 'B0', 'C0'], true, false]],
                ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            ],
            layout: {
                visibility: vis,
                'icon-image': [
                    'case',
                    ['==', ['get', 'squawkEmerg'], 1], 'adsb-bracket-emerg',     // emergency squawk → red bracket
                    ['boolean', ['get', 'military'], false], 'adsb-bracket-mil', // military → black bracket
                    ['==', ['get', 'category'], 'C1'], 'adsb-bracket-emerg-gnd', // C1 emergency vehicle → red
                    'adsb-bracket',                                               // default lime
                ],
                'icon-size': 0.75,
                'icon-rotation-alignment': 'viewport', // bracket corners always aligned to screen
                'icon-pitch-alignment':    'viewport',
                'icon-allow-overlap':      true,
                'icon-ignore-placement':   true,
            },
            paint: {
                // Stale aircraft (no data for ≥30s) rendered at 30% opacity
                'icon-opacity': ['case', ['==', ['get', 'stale'], 1], 0.3, 1],
                'icon-opacity-transition': { duration: 0 }, // instant — no fade
            },
        });

        // --- Icon layer: rotates with aircraft track ---
        // Icon selection priority: emergency > military > UAV > ground vehicles > tower > default
        this.map.addLayer({
            id: 'adsb-icons',
            type: 'symbol',
            source: 'adsb-live',
            filter: ['all',
                ['!', ['match', ['get', 'category'], ['A0', 'B0', 'C0'], true, false]],
                ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            ],
            layout: {
                visibility: vis,
                'icon-image': [
                    'case',
                    ['==', ['get', 'squawkEmerg'], 1],                    'adsb-blip-emerg',
                    ['boolean', ['get', 'military'], false],               'adsb-blip-mil',
                    ['==', ['get', 'category'], 'B6'],                     'adsb-blip-uav',
                    ['==', ['get', 'category'], 'C1'],                     'adsb-blip-emerg-gnd',
                    ['==', ['get', 'category'], 'C2'],                     'adsb-blip-gnd',
                    ['==', ['get', 'category'], 'C3'],                     'adsb-blip-tower',
                    ['==', ['get', 't'], 'TWR'],                           'adsb-blip-tower',
                    'adsb-blip',
                ],
                'icon-size': 0.75,
                'icon-rotate': ['get', 'track'],      // rotates the triangle to point in the direction of travel
                'icon-rotation-alignment': 'map',     // rotation is in geographic space
                'icon-pitch-alignment':    'map',
                'icon-allow-overlap':      true,
                'icon-ignore-placement':   true,
            },
            paint: {
                'icon-opacity': ['case', ['==', ['get', 'stale'], 1], 0.3, 1],
                'icon-opacity-transition': { duration: 0 },
            },
        });

        // --- Click and hover event handlers ---
        // Registered once only — guarded by _eventsAdded so they survive style reloads
        if (!this._eventsAdded) {
            this._eventsAdded = true;

            // _clickHandled prevents the aircraft-layer click AND the map click
            // from both running for the same user interaction.
            let _clickHandled = false;

            const handleAircraftClick = (e) => {
                if (_clickHandled) return;
                if (!e.features || !e.features.length) return;
                _clickHandled = true;
                const hex = e.features[0].properties.hex;
                // Toggle: click the same aircraft again to deselect
                this._selectedHex = (hex === this._selectedHex) ? null : hex;
                this._hideHoverTag();
                this._applySelection();
            };

            // Wire to both layers so either the bracket or the icon is clickable
            this.map.on('click', 'adsb-bracket', handleAircraftClick);
            this.map.on('click', 'adsb-icons',   handleAircraftClick);

            // Map-level click: deselect when clicking empty space (not an aircraft)
            this.map.on('click', (e) => {
                if (_clickHandled) { _clickHandled = false; return; } // consumed above
                if (this._followEnabled) return; // don't interrupt tracking mode
                if (this._selectedHex) {
                    const hits = this.map.queryRenderedFeatures(e.point, { layers: ['adsb-bracket', 'adsb-icons'] });
                    if (!hits.length) {
                        this._selectedHex = null;
                        this._applySelection();
                    }
                }
            });

            // Hover enter: show compact data tag and change cursor to pointer
            const handleHoverEnter = (e) => {
                this.map.getCanvas().style.cursor = 'pointer';
                if (!e.features || !e.features.length) return;
                const hex = e.features[0].properties.hex;
                const f = this._geojson.features.find(f => f.properties.hex === hex);
                if (f) this._showHoverTag(f);
            };
            // Hover leave: hide compact tag and restore default cursor
            const handleHoverLeave = () => {
                this.map.getCanvas().style.cursor = '';
                this._hideHoverTag();
            };

            this.map.on('mouseenter', 'adsb-bracket', handleHoverEnter);
            this.map.on('mouseleave', 'adsb-bracket', handleHoverLeave);
            this.map.on('mouseenter', 'adsb-icons',   handleHoverEnter);
            this.map.on('mouseleave', 'adsb-icons',   handleHoverLeave);

            // Callsign label visibility is zoom-dependent — refresh on zoom change
            this.map.on('zoomend', () => this._updateCallsignMarkers());
        }

        // Move ADS-B layers above all other feature layers (roads, borders, etc.)
        this._raiseLayers();
        this._applyTypeFilter();

        // If a pre-fetch already completed while waiting for the style to load,
        // push that data immediately so planes appear without another round-trip
        if (this._geojson.features.length) this._interpolate();

        // Start polling now that the source exists (data can be written immediately)
        if (this.visible && !this._pollInterval) this._startPolling();
    }

    // ---- ADS-B category label lookup ----

    /**
     * Return a human-readable label for an ADS-B emitter category code.
     * Returns null for unknown codes.
     * @param {string} code - e.g. 'A3', 'B6', 'C1'
     */
    _categoryLabel(code) {
        const labels = {
            A0: 'No category info', A1: 'Light aircraft',    A2: 'Small aircraft',
            A3: 'Large aircraft',   A4: 'High vortex',        A5: 'Heavy aircraft',
            A6: 'High performance', A7: 'Rotorcraft',
            B0: 'No category info', B1: 'Glider / sailplane', B2: 'Lighter-than-air',
            B3: 'Parachutist',      B4: 'Ultralight',         B6: 'UAV / drone',
            B7: 'Space vehicle',
            C1: 'Emergency surface vehicle', C2: 'Service surface vehicle',
            C3: 'Fixed obstruction / tower', C4: 'Cluster obstacle',
            C5: 'Line obstacle',             C6: 'No category info',
        };
        if (!code) return null;
        const desc = labels[code.toUpperCase()];
        return desc ? `${code.toUpperCase()} – ${desc}` : code.toUpperCase();
    }

    // ---- Data tag HTML builders ----

    /**
     * Build the HTML string for the selected-aircraft data tag.
     * Two layouts are used:
     *   - Tracking mode: compact one-line callsign + TRACKING button (data is in status bar)
     *   - Normal mode: full data box with ALT / SPD / HDG / TYP / REG / SQK rows
     * @param {object} props - GeoJSON feature properties for the aircraft
     */
    _buildTagHTML(props) {
        // Resolve the best available identifier in order: callsign > registration > hex
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const isEmergency  = props.squawkEmerg === 1 || (props.emergency && props.emergency !== 'none');
        const callsignColor = isEmergency ? '#ff4040' : '#ffffff';

        const isTracked  = this._followEnabled && props.hex === this._tagHex;
        const notifOn    = this._notifEnabled.has(props.hex);

        // TRACK / TRACKING button HTML (colour reflects active state)
        const trkColor   = isTracked ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const trkBtnText = isTracked ? 'TRACKING' : 'TRACK';
        const trkBtn = `<button class="tag-follow-btn" style="background:none;border:none;cursor:pointer;padding:8px 12px;color:${trkColor};font-family:'Barlow Condensed','Barlow',sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent">${trkBtnText}</button>`;

        // Bell icon button — lime when notifications enabled, dim when off
        const bellColor = notifOn ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const bellBtn = `<button class="tag-notif-btn" data-hex="${props.hex}" style="background:none;border:none;cursor:pointer;padding:8px 6px;color:${bellColor};line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent" aria-label="Toggle notifications">` +
            `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
            `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
            (notifOn ? '' : `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`) +
            `</svg></button>`;

        // Tracking layout: compact one-liner — all flight data is in the status bar below
        if (isTracked) {
            const milTypeBadge = (props.military && props.t)
                ? `<span style="background:#4d6600;color:#c8ff00;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 4px;">${props.t.toUpperCase()}</span>`
                : '';
            const hasBadge = !!(props.military && props.t);
            return `<div style="background:rgba(0,0,0,0.7);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:13px;font-weight:400;padding:1px ${hasBadge ? '0' : '8px'} 1px 8px;white-space:nowrap;user-select:none">` +
                `<div style="display:flex;align-items:stretch;gap:4px">` +
                `<span style="font-size:13px;font-weight:400;letter-spacing:.12em;color:${callsignColor};pointer-events:none;align-self:center">${callsign}</span>` +
                `${milTypeBadge}${trkBtn}</div></div>`;
        }

        // Normal layout: altitude / speed / heading rows + optional type/registration/squawk
        const alt    = props.alt_baro ?? 0;
        const vrt    = props.baro_rate ?? 0;
        // Format altitude: 0 → 'GND'; ≥ FL180 as flight level; otherwise feet with commas
        const altStr = alt === 0 ? 'GND'
            : alt >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0')
            : alt.toLocaleString() + ' ft';
        const vrtArrow = vrt >  200 ? ' ↑' : vrt < -200 ? ' ↓' : ''; // climb/descent indicator

        const rows = [
            ['ALT', altStr + vrtArrow],
            ['SPD', Math.round(props.gs ?? 0) + ' kt'],
            ['HDG', Math.round(props.track ?? 0) + '°'],
        ];
        if (props.t)        rows.push(['TYP', props.t]);
        if (props.r)        rows.push(['REG', props.r]);
        if (props.squawk)   rows.push(['SQK', props.squawk]);
        const catLabel = this._categoryLabel(props.category);
        if (catLabel)       rows.push(['CAT', catLabel]);

        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`
        ).join('');

        return `<div style="background:rgba(0,0,0,0.7);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;padding:6px 14px 9px;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:15px;letter-spacing:.12em;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none;color:${callsignColor}">${callsign}</span>` +
            `<div style="display:flex;align-items:center;gap:0">${bellBtn}${trkBtn}</div></div>` +
            `<div style="pointer-events:none">` + rowsHTML + `</div></div>`;
    }

    /**
     * Build the HTML string for the tracking panel status bar.
     * Shown inside the collapsible tracking panel (bottom-left) while tracking is active.
     * More verbose than the data tag — includes vertical speed, category, emergency fields.
     */
    _buildStatusBarHTML(props) {
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const alt      = props.alt_baro ?? 0;
        const vrt      = props.baro_rate ?? 0;
        const altStr   = alt === 0 ? 'GND'
            : alt >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0')
            : alt.toLocaleString() + ' ft';
        const vrtArrow = vrt > 200 ? ' ↑' : vrt < -200 ? ' ↓' : '';
        const vrtStr   = vrt === 0 ? '0 fpm' : (vrt > 0 ? '+' : '') + Math.round(vrt).toLocaleString() + ' fpm';

        // Build ordered field list — insert optional fields only when available
        const fields = [];
        if (props.r)           fields.push(['REG',     props.r]);
        if (props.t)           fields.push(['TYPE',    props.t]);
        fields.push(['ALT',    altStr + vrtArrow]);
        fields.push(['GS',     Math.round(props.gs ?? 0) + ' kt']);
        fields.push(['HDG',    Math.round(props.track ?? 0) + '°']);
        if (props.squawk)      fields.push(['SQUAWK',  props.squawk]);
        if (props.emergency && props.emergency !== 'none') fields.push(['EMRG', props.emergency.toUpperCase()]);
        if (props.military)    fields.push(['CLASS',   'MILITARY']);
        const catLabel = this._categoryLabel(props.category);
        if (catLabel)          fields.push(['CATEGORY', catLabel]);

        const isEmergency = props.emergency && props.emergency !== 'none';
        const headerColor = isEmergency ? '#ff4040' : '#ffffff'; // red callsign for emergencies

        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value${lbl === 'EMRG' ? ' adsb-sb-emrg' : ''}">${val}</span>` +
            `</div>`
        ).join('');

        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-label-tag">TRACKING</span>` +
            `<button class="adsb-sb-untrack-btn">UNTRACK</button>` +
            `</div>` +
            `<div class="adsb-sb-header" style="border-top:none;height:auto;padding:8px 14px 9px">` +
            `<span class="adsb-sb-callsign" style="color:${headerColor}">${callsign}</span>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    // ---- Status bar show/hide/update ----

    /**
     * Inject the status bar DOM into the tracking panel and open the panel.
     * Creates the #adsb-status-bar element if it doesn't exist yet.
     */
    _showStatusBar(props) {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            // Prefer inserting into the tracking panel; fall back to body
            const panel = document.getElementById('tracking-panel');
            if (panel) panel.appendChild(bar);
            else document.body.appendChild(bar);
        }
        delete bar.dataset.apt; // clear any airport-detail flag set by airports.js
        bar.innerHTML = this._buildStatusBarHTML(props);
        bar.classList.add('adsb-sb-visible');
        this._wireStatusBarUntrack(bar);
        if (typeof _Tracking !== 'undefined') { _Tracking.setCount(1); _Tracking.openPanel(); }
        if (typeof _FilterPanel !== 'undefined') _FilterPanel.reposition();
    }

    /** Hide the status bar and close/reset the tracking panel. */
    _hideStatusBar() {
        const bar = document.getElementById('adsb-status-bar');
        if (bar) bar.classList.remove('adsb-sb-visible');
        if (typeof _Tracking !== 'undefined') { _Tracking.setCount(0); _Tracking.closePanel(); }
        if (typeof _FilterPanel !== 'undefined') _FilterPanel.reposition();
    }

    /** Refresh status bar content with the latest data for the tracked aircraft. */
    _updateStatusBar() {
        if (!this._followEnabled || !this._selectedHex) return;
        const bar = document.getElementById('adsb-status-bar');
        if (!bar || !bar.classList.contains('adsb-sb-visible')) return;
        const f = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
        if (f) {
            bar.innerHTML = this._buildStatusBarHTML(f.properties);
            this._wireStatusBarUntrack(bar);
        }
    }

    /**
     * Attach the UNTRACK button click handler to the status bar.
     * Resets follow mode, dismisses tracking notifications, and rebuilds the data tag
     * in non-tracking layout so the user can see the full data box again.
     */
    _wireStatusBarUntrack(bar) {
        const btn = bar.querySelector('.adsb-sb-untrack-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._followEnabled = false;

            // Dismiss tracking notification for the previously followed plane
            if (this._tagHex && this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                _Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                delete this._trackingNotifIds[this._tagHex];
            }
            if (this._tagHex) this._notifEnabled.delete(this._tagHex);

            // Rebuild data tag in normal (non-tracking) layout
            if (this._tagHex) {
                const f = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (f) {
                    const coords = this._interpolatedCoords(this._tagHex) || f.geometry.coordinates;
                    const newEl = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'top-left', offset: [14, -13] })
                        .setLngLat(coords)
                        .addTo(this.map);
                }
            }
            this._hideStatusBar();
            this._saveTrackingState();
            // Restore flat map view when not in 3D mode
            const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
            if (!is3D) this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
        });
    }

    // ---- Tag button wiring ----

    /**
     * Wire the TRACK / TRACKING and notification bell buttons inside a tag element.
     * Called whenever a tag marker is created or rebuilt.
     * @param {HTMLElement} el - the tag's root DOM element
     * @param {string|null} overrideHex - when called from the hover tag, the hex of the
     *   hovered aircraft (not yet selected); null when called from the selected tag
     */
    _wireTagButton(el, overrideHex = null) {
        const btn = el.querySelector('.tag-follow-btn');
        if (!btn) return;

        // ---- Notification bell ----
        const bellBtn = el.querySelector('.tag-notif-btn');
        if (bellBtn) {
            bellBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            bellBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hex = bellBtn.dataset.hex || overrideHex || this._tagHex;
                if (!hex) return;

                const wasEnabled = this._notifEnabled.has(hex);
                const f = this._geojson.features.find(f => f.properties.hex === hex);
                const callsign = f ? ((f.properties.flight || '').trim() || (f.properties.r || '').trim() || hex) : hex;
                if (!this._trackingNotifIds) this._trackingNotifIds = {};

                if (wasEnabled) {
                    // Disable: remove from set, dismiss existing notif, add notifications-off event
                    this._notifEnabled.delete(hex);
                    if (this._trackingNotifIds[hex]) {
                        _Notifications.dismiss(this._trackingNotifIds[hex]);
                        delete this._trackingNotifIds[hex];
                    }
                    _Notifications.add({ type: 'notif-off', title: callsign, detail: undefined });
                } else {
                    // Enable: add to set, dismiss old notif, create a new tracking notification
                    this._notifEnabled.add(hex);
                    if (this._trackingNotifIds[hex]) _Notifications.dismiss(this._trackingNotifIds[hex]);
                    this._trackingNotifIds[hex] = _Notifications.add({
                        type:   'tracking',
                        title:  callsign,
                        detail: undefined,
                        action: {
                            label: 'DISABLE NOTIFICATIONS',
                            callback: () => {
                                this._notifEnabled.delete(hex);
                                if (this._trackingNotifIds) delete this._trackingNotifIds[hex];
                                this._rebuildTagForHex(hex);
                            },
                        },
                    });
                }

                // Update bell icon colour and slash line immediately without a full rebuild
                const nowEnabled = this._notifEnabled.has(hex);
                bellBtn.style.color = nowEnabled ? '#c8ff00' : 'rgba(255,255,255,0.3)';
                const slash = bellBtn.querySelector('line');
                if (slash) slash.setAttribute('display', nowEnabled ? 'none' : 'inline');

                // Rebuild the stored tag marker so any subsequent re-opens show the correct state
                this._rebuildTagForHex(hex);
            });
        }

        // ---- TRACK / TRACKING button ----
        // MapLibre calls e.preventDefault() on every mousedown on its marker element,
        // which suppresses the click. Stop propagation so MapLibre never sees button presses.
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });

        // While in tracking mode, hovering the tag swaps "TRACKING" → "UNTRACK" as a prompt
        if (btn.textContent === 'TRACKING') {
            el.addEventListener('mouseenter', () => { btn.textContent = 'UNTRACK'; });
            el.addEventListener('mouseleave', () => { btn.textContent = 'TRACKING'; });
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const hex = overrideHex || this._tagHex;
            if (!hex) return;

            if (overrideHex && overrideHex !== this._selectedHex) {
                // TRACK clicked from the hover tag: select the hovered plane and start tracking
                // Dismiss any existing tracking notification for the previously tracked plane
                if (this._tagHex && this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                    _Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                    delete this._trackingNotifIds[this._tagHex];
                }
                if (this._tagHex) this._notifEnabled.delete(this._tagHex);
                this._selectedHex = overrideHex;
                this._hideHoverTagNow();
                this._applySelection();

                this._followEnabled = true;
                this._notifEnabled.add(hex);
                const f = this._geojson.features.find(f => f.properties.hex === hex);
                if (f) {
                    const cs = (f.properties.flight || '').trim() || (f.properties.r || '').trim() || hex;
                    if (!this._trackingNotifIds) this._trackingNotifIds = {};
                    if (this._trackingNotifIds[hex]) _Notifications.dismiss(this._trackingNotifIds[hex]);
                    this._trackingNotifIds[hex] = _Notifications.add({ type: 'track', title: cs });
                    this._showStatusBar(f.properties);
                    const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
                    const coords = this._interpolatedCoords(hex) || f.geometry.coordinates;
                    this.map.easeTo({ center: coords, zoom: 16, ...(is3D ? { pitch: 45 } : {}), duration: 600 });
                    // Rebuild tag in tracking layout (compact, left-anchored)
                    const newEl = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'left', offset: [14, 0] })
                        .setLngLat(coords)
                        .addTo(this.map);
                }
                this._saveTrackingState();
                return;
            }

            // Toggle follow mode on the already-selected aircraft
            this._followEnabled = !this._followEnabled;

            if (!this._followEnabled && this._tagHex) {
                // Stopped tracking — clean up notifications
                this._notifEnabled.delete(this._tagHex);
                if (this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                    _Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                    delete this._trackingNotifIds[this._tagHex];
                }
            }

            if (this._followEnabled && this._tagHex) {
                // Started tracking — auto-enable notifications
                this._notifEnabled.add(this._tagHex);
                const trkF  = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                const trkCs = trkF ? ((trkF.properties.flight || '').trim() || (trkF.properties.r || '').trim() || this._tagHex) : this._tagHex;
                if (!this._trackingNotifIds) this._trackingNotifIds = {};
                if (this._trackingNotifIds[this._tagHex]) _Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                this._trackingNotifIds[this._tagHex] = _Notifications.add({ type: 'track', title: trkCs });
            }

            // Recreate the marker to change anchor:
            //   tracking → left anchor (vertically centred on the aircraft icon)
            //   normal   → top-left (data box appears below-right of the icon)
            if (this._tagHex) {
                const f = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (f) {
                    const coords = this._interpolatedCoords(this._tagHex) || f.geometry.coordinates;
                    const newEl  = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    const anchor = this._followEnabled ? 'left'     : 'top-left';
                    const offset = this._followEnabled ? [14, 0]    : [14, -13];
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor, offset })
                        .setLngLat(coords)
                        .addTo(this.map);
                    if (this._followEnabled) {
                        this._showStatusBar(f.properties);
                        const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
                        const trackCoords = this._interpolatedCoords(this._tagHex) || f.geometry.coordinates;
                        this.map.easeTo({ center: trackCoords, zoom: 16, ...(is3D ? { pitch: 45 } : {}), duration: 600 });
                    } else {
                        this._hideStatusBar();
                        const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
                        if (!is3D) this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
                    }
                }
            }

            // If allHidden mode is active, re-apply filter so the tracked plane stays visible
            if (this._allHidden) {
                this._applyTypeFilter();
                const isTracking = this._followEnabled && this._selectedHex;
                const tagEl = this._tagMarker ? this._tagMarker.getElement() : null;
                if (tagEl) tagEl.style.visibility = isTracking ? '' : 'hidden';
                try { this.map.setLayoutProperty('adsb-trails', 'visibility', isTracking ? 'visible' : 'none'); } catch(e) {}
            }
            this._saveTrackingState();
        });
    }

    /**
     * Rebuild the selected-aircraft data tag in-place.
     * Called when bell state changes to keep the stored marker in sync without losing position.
     */
    _rebuildTagForHex(hex) {
        if (!hex || hex !== this._tagHex) return;
        const f = this._geojson.features.find(f => f.properties.hex === hex);
        if (!f) return;
        const coords   = this._interpolatedCoords(hex) || f.geometry.coordinates;
        const newEl    = document.createElement('div');
        newEl.innerHTML = this._buildTagHTML(f.properties);
        this._wireTagButton(newEl);
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        const isTracked = this._followEnabled && hex === this._tagHex;
        const anchor    = isTracked ? 'left'  : 'top-left';
        const offset    = isTracked ? [14, 0] : [14, -13];
        this._tagMarker = new maplibregl.Marker({ element: newEl, anchor, offset })
            .setLngLat(coords)
            .addTo(this.map);
    }

    // ---- Selected-aircraft tag show/hide ----

    /** Create and add the data tag marker for the newly selected aircraft. */
    _showSelectedTag(feature) {
        this._hideSelectedTag();
        this._hideStatusBar();
        if (!feature || !this.map) return;
        this._followEnabled = false; // clicking a new aircraft resets tracking mode
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        this._wireTagButton(el);
        const coords = this._interpolatedCoords(feature.properties.hex) || feature.geometry.coordinates;
        // Data box uses top-left anchor so it appears below-right of the aircraft icon
        this._tagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
        if (this._allHidden) el.style.visibility = 'hidden'; // respect master hide flag
        this._tagHex = feature.properties.hex;
    }

    /** Remove the selected-aircraft tag and release tracking state. */
    _hideSelectedTag() {
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        // Clean up notification state when deselecting a tracked plane
        if (this._tagHex && this._followEnabled) this._notifEnabled.delete(this._tagHex);
        this._tagHex = null;
        this._saveTrackingState();
    }

    // ---- Hover tag show/hide ----

    /**
     * Show a compact data tag for the hovered (unselected) aircraft.
     * If the hover tag is already showing for the same hex, just update its position.
     * @param {object} feature - GeoJSON feature
     * @param {boolean} fromLabel - true when triggered by hovering a callsign label (not the icon)
     */
    _showHoverTag(feature, fromLabel = false) {
        if (!feature || !this.map) return;
        const hex = feature.properties.hex;
        if (hex === this._selectedHex) return; // already showing full tag — no hover tag needed
        // Cancel any pending delayed hide
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        // Already showing for this hex — just nudge position
        const coords = this._interpolatedCoords(hex) || feature.geometry.coordinates;
        if (this._hoverHex === hex && this._hoverMarker) {
            this._hoverMarker.setLngLat(coords);
            return;
        }
        // Remove any existing hover tag for a different hex
        this._hideHoverTagNow();
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        el.style.pointerEvents = 'auto'; // allow cursor to move onto the tag without hiding it
        el.addEventListener('mouseenter', () => {
            // Cancel hide when cursor moves from icon onto the tag element
            if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        });
        el.addEventListener('mouseleave', () => this._hideHoverTag());
        this._wireTagButton(el, hex); // overrideHex allows TRACK to work from the hover tag
        this._hoverMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
        this._hoverHex       = hex;
        this._hoverFromLabel = fromLabel;
        // Hide the callsign label while the hover data box is visible (it covers the same area)
        if (this._callsignMarkers[hex]) {
            this._callsignMarkers[hex].getElement().style.visibility = 'hidden';
        }
    }

    /** Schedule a 80ms delayed hide to allow cursor to move onto the tag element. */
    _hideHoverTag() {
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 80);
    }

    /** Immediately remove the hover tag and restore the callsign label. */
    _hideHoverTagNow() {
        // Restore the callsign label that was hidden while hover tag was visible
        if (this._hoverHex && this._callsignMarkers[this._hoverHex]) {
            this._callsignMarkers[this._hoverHex].getElement().style.visibility = '';
        }
        if (this._hoverMarker) { this._hoverMarker.remove(); this._hoverMarker = null; }
        this._hoverHex       = null;
        this._hoverFromLabel = false;
    }

    // ---- Callsign label markers ----

    /**
     * Build the DOM element for a callsign label marker.
     * Includes optional military type badge and TRACKING/UNTRACK button.
     * Hover/click handlers delegate to _showHoverTag and _applySelection.
     */
    _buildCallsignLabelEl(props) {
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const isEmerg  = props.squawkEmerg === 1;

        const el = document.createElement('div');
        el.style.cssText = [
            isEmerg ? 'background:rgba(180,0,0,0.85)' : 'background:rgba(0,0,0,0.5)',
            'color:#ffffff',
            "font-family:'Barlow Condensed','Barlow',sans-serif",
            'font-size:13px', 'font-weight:400', 'letter-spacing:.12em',
            'text-transform:uppercase', 'box-sizing:border-box',
            'display:flex', 'align-items:center', 'gap:5px',
            'padding:1px 8px', 'cursor:pointer',
            'white-space:nowrap', 'user-select:none',
        ].join(';');

        // Callsign text span
        const nameSpan = document.createElement('span');
        nameSpan.textContent = callsign;
        nameSpan.style.cssText = isEmerg ? 'color:#ff4040 !important' : 'color:#ffffff !important';
        el.appendChild(nameSpan);

        // Military aircraft: add type badge (e.g. "C17") and optional TRACKING button
        if (props.military) {
            const isTracked = this._notifEnabled.has(props.hex);
            const hasBadge  = !!props.t;
            if (hasBadge || isTracked) el.style.paddingRight = '0';

            if (hasBadge) {
                const modelBadge = document.createElement('span');
                modelBadge.className = 'mil-model-badge';
                modelBadge.textContent = props.t.toUpperCase();
                modelBadge.style.cssText = 'background:#4d6600;color:#c8ff00 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 5px;';
                el.insertBefore(modelBadge, el.querySelector('.mil-trk-btn') || el.querySelector('.sqk-badge') || null);
            }

            if (isTracked) {
                const trkBtn = document.createElement('button');
                trkBtn.className = 'mil-trk-btn';
                trkBtn.textContent = 'TRACKING';
                trkBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0 6px;color:#c8ff00;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.1em;align-self:stretch;display:flex;align-items:center;white-space:nowrap;';
                trkBtn.addEventListener('mouseenter', () => { trkBtn.textContent = 'UNTRACK'; });
                trkBtn.addEventListener('mouseleave', () => { trkBtn.textContent = 'TRACKING'; });
                trkBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._notifEnabled.delete(props.hex);
                    this._updateCallsignMarkers();
                });
                el.appendChild(trkBtn);
            }
        }

        // Emergency squawk badge — black background, red squawk code
        if (isEmerg) {
            el.style.paddingRight = '0';
            el.style.gap = '0';
            const badge = document.createElement('span');
            badge.className = 'sqk-badge';
            badge.textContent = props.squawk;
            const hasTypeBadge = props.military && props.t;
            badge.style.cssText = `background:#000;color:#ff2222 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px ${hasTypeBadge ? '0' : '8px'};`;
            el.appendChild(badge);
        }

        // Hover: show the full data tag for this aircraft
        el.addEventListener('mouseenter', () => {
            const f = this._geojson.features.find(f => f.properties.hex === props.hex);
            if (f) this._showHoverTag(f, true);
        });
        el.addEventListener('mouseleave', () => this._hideHoverTag());

        // Click: select/deselect the aircraft
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectedHex = (props.hex === this._selectedHex) ? null : props.hex;
            this._hideHoverTag();
            this._applySelection();
        });

        return el;
    }

    /** Control whether HTML callsign markers are shown at all. */
    setLabelsVisible(v) {
        this.labelsVisible = v;
        if (!v) { this._clearCallsignMarkers(); }
        else    { this._updateCallsignMarkers(); }
    }

    /**
     * Create, update, or remove HTML callsign label markers to match the current
     * aircraft list and filter state.
     * Called after each API fetch, on zoom change, and when filter flags change.
     */
    _updateCallsignMarkers() {
        if (!this.map || !this.labelsVisible) return;
        const features = this._geojson.features;
        const seen = new Set(); // track which hexes are still in the feed

        for (const f of features) {
            const hex = f.properties.hex;
            if (!hex) continue;
            seen.add(hex);

            // Mirror the layer filter: only show label when the icon is visible
            const zoom     = this.map.getZoom();
            const isMil    = !!f.properties.military;
            const cat      = (f.properties.category || '').toUpperCase();
            const isGnd    = ['C1', 'C2'].includes(cat);
            const isTower  = ['C3', 'C4', 'C5'].includes(cat) || (f.properties.t || '').toUpperCase() === 'TWR';
            // Non-altitude categories are always shown at any zoom when enabled
            const iconVisible  = isGnd || isTower || (f.properties.alt_baro > 0) || (zoom >= 10);
            let   typeVisible;
            if (this._allHidden) {
                typeVisible = false;
            } else if (isGnd) {
                typeVisible = this._typeFilter === 'all' && !this._hideGroundVehicles;
            } else if (isTower) {
                typeVisible = this._typeFilter === 'all' && !this._hideTowers;
            } else {
                typeVisible = this.visible && (
                    this._typeFilter === 'all' ||
                    (this._typeFilter === 'civil' && !isMil) ||
                    (this._typeFilter === 'mil'   && isMil)
                );
            }

            if (!iconVisible || !typeVisible) {
                // Remove label if it exists and conditions aren't met
                if (this._callsignMarkers[hex]) {
                    this._callsignMarkers[hex].remove();
                    delete this._callsignMarkers[hex];
                }
                continue;
            }

            // Selected aircraft uses the full data tag popup — no callsign label alongside
            if (hex === this._selectedHex) {
                if (this._callsignMarkers[hex]) {
                    this._callsignMarkers[hex].remove();
                    delete this._callsignMarkers[hex];
                }
                continue;
            }

            const lngLat  = this._interpolatedCoords(hex) || f.geometry.coordinates;
            const pos     = this._lastPositions[hex];
            const ageSec  = pos ? (Date.now() - pos.lastSeen) / 1000 : 0;
            const isStale = ageSec >= 30 && f.properties.alt_baro !== 0; // ground planes can't go stale

            if (this._callsignMarkers[hex]) {
                // Marker exists — update position and refresh label contents in-place
                // (avoids creating/destroying DOM for every poll)
                this._callsignMarkers[hex].setLngLat(lngLat);
                const labelEl    = this._callsignMarkers[hex].getElement();
                const raw        = (f.properties.flight || '').trim() || (f.properties.r || '').trim() || f.properties.hex || '';
                const isEmerg    = f.properties.squawkEmerg === 1;
                labelEl.style.background = isEmerg ? 'rgba(180,0,0,0.85)' : 'rgba(0,0,0,0.5)';
                labelEl.style.opacity    = isStale ? '0.3' : '1';
                // Update callsign text (first child span that is not a badge)
                const nameSpan = labelEl.querySelector('span:not(.sqk-badge):not(.mil-model-badge)') || labelEl;
                nameSpan.textContent = raw || 'UNKNOWN';
                nameSpan.style.cssText = isStale ? 'color:rgba(255,255,255,0.45) !important' : 'color:#ffffff !important';

                // Military type badge and tracking button: add/remove/update as needed
                if (f.properties.military) {
                    const isTracked = this._notifEnabled.has(hex);
                    const hasBadge  = !!f.properties.t;
                    if (hasBadge || isTracked) labelEl.style.paddingRight = '0';
                    else                        labelEl.style.paddingRight = '8px';

                    let modelBadge = labelEl.querySelector('.mil-model-badge');
                    if (hasBadge) {
                        if (!modelBadge) {
                            modelBadge = document.createElement('span');
                            modelBadge.className = 'mil-model-badge';
                            modelBadge.style.cssText = 'background:#4d6600;color:#c8ff00 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 5px;';
                            labelEl.insertBefore(modelBadge, labelEl.querySelector('.mil-trk-btn') || labelEl.querySelector('.sqk-badge') || null);
                        }
                        modelBadge.textContent = f.properties.t.toUpperCase();
                    } else if (modelBadge) {
                        modelBadge.remove();
                    }

                    let trkBtn = labelEl.querySelector('.mil-trk-btn');
                    if (isTracked && !trkBtn) {
                        trkBtn = document.createElement('button');
                        trkBtn.className = 'mil-trk-btn';
                        trkBtn.textContent = 'TRACKING';
                        trkBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0 6px;color:#c8ff00;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.1em;align-self:stretch;display:flex;align-items:center;white-space:nowrap;';
                        trkBtn.addEventListener('mouseenter', () => { trkBtn.textContent = 'UNTRACK'; });
                        trkBtn.addEventListener('mouseleave', () => { trkBtn.textContent = 'TRACKING'; });
                        trkBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._notifEnabled.delete(hex);
                            this._updateCallsignMarkers();
                        });
                        labelEl.appendChild(trkBtn);
                    } else if (!isTracked && trkBtn) {
                        trkBtn.remove();
                    }
                } else {
                    // Non-military: remove any lingering mil badges
                    labelEl.querySelector('.mil-model-badge')?.remove();
                    labelEl.querySelector('.mil-trk-btn')?.remove();
                    if (!isEmerg) labelEl.style.paddingRight = '8px';
                }

                // Emergency squawk badge: add/update/remove
                let badge = labelEl.querySelector('.sqk-badge');
                if (isEmerg) {
                    labelEl.style.paddingRight = '0';
                    labelEl.style.gap = '0';
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'sqk-badge';
                        badge.style.cssText = 'background:#000;color:#ff2222 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 8px;';
                        labelEl.appendChild(badge);
                    }
                    badge.textContent = f.properties.squawk;
                } else if (badge) {
                    badge.remove();
                    labelEl.style.gap = '5px';
                    if (!labelEl.querySelector('.mil-model-badge') && !labelEl.querySelector('.mil-trk-btn')) {
                        labelEl.style.paddingRight = '8px';
                    }
                }
            } else {
                // New aircraft — build the label element from scratch
                const labelEl = this._buildCallsignLabelEl(f.properties);
                if (isStale) {
                    labelEl.style.opacity = '0.3';
                    const nameSpan = labelEl.querySelector('span:not(.sqk-badge):not(.mil-model-badge)') || labelEl;
                    if (nameSpan) nameSpan.style.color = 'rgba(255,255,255,0.45)';
                }
                const marker = new maplibregl.Marker({ element: labelEl, anchor: 'left', offset: [14, 0] })
                    .setLngLat(lngLat)
                    .addTo(this.map);
                this._callsignMarkers[hex] = marker;
            }
        }

        // Remove markers for aircraft that have left the API feed
        for (const hex of Object.keys(this._callsignMarkers)) {
            if (!seen.has(hex)) {
                this._callsignMarkers[hex].remove();
                delete this._callsignMarkers[hex];
            }
        }
    }

    /** Remove all HTML callsign markers from the map (e.g. on style reload). */
    _clearCallsignMarkers() {
        for (const marker of Object.values(this._callsignMarkers)) marker.remove();
        this._callsignMarkers = {};
    }

    // ---- Selection helpers ----

    /**
     * Apply the current selection state: re-apply the type filter, update callsign markers,
     * show/hide the selected tag, and rebuild the trail dots.
     */
    _applySelection() {
        if (!this.map) return;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
        if (this._selectedHex) {
            const f = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
            this._showSelectedTag(f || null);
        } else {
            this._hideSelectedTag();
            this._hideStatusBar();
        }
        this._rebuildTrails();
    }

    /**
     * Rebuild the trail GeoJSON from the position history of the selected aircraft.
     * Opacity gradient: oldest point ≈ 0, newest = 1.0.
     */
    _rebuildTrails() {
        const trailFeatures = [];
        if (this._selectedHex && this._trails[this._selectedHex]) {
            const points = this._trails[this._selectedHex];
            const n = points.length;
            const selFeature = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
            const isEmerg = selFeature && (
                selFeature.properties.squawkEmerg === 1 ||
                (selFeature.properties.emergency && selFeature.properties.emergency !== 'none')
            ) ? 1 : 0;
            for (let i = 0; i < n; i++) {
                const p = points[i];
                trailFeatures.push({
                    type: 'Feature',
                    geometry:   { type: 'Point', coordinates: [p.lon, p.lat] },
                    properties: { alt: p.alt, opacity: (i + 1) / n, emerg: isEmerg },
                });
            }
        }
        this._trailsGeojson = { type: 'FeatureCollection', features: trailFeatures };
        if (this.map && this.map.getSource('adsb-trails-source')) {
            this.map.getSource('adsb-trails-source').setData(this._trailsGeojson);
        }
    }

    // ---- Dead-reckoning interpolator ----

    /**
     * Runs every 100ms (setInterval in _startPolling).
     * Extrapolates each aircraft's position from its last real API fix using ground speed
     * and track so movement appears continuous between 5s API polls.
     * Also removes aircraft that have not been seen for 60s.
     */
    _interpolate() {
        if (!this.map || !this._geojson.features.length) return;
        const now = Date.now();

        // Unit conversion constants
        const NM_DEG  = 1 / 60;    // 1 nautical mile ≈ 1/60 degree of latitude
        const HR_SEC  = 3600;      // seconds per hour (speed is in kt = nm/hr)
        const STALE_SEC  = 30;     // dim aircraft icon after 30s without a new position fix
        const REMOVE_SEC = 60;     // remove from the map entirely after 60s

        // Remove features that have not had a position update within REMOVE_SEC
        this._geojson.features = this._geojson.features.filter(f => {
            const pos = this._lastPositions[f.properties.hex];
            if (!pos) return true; // no position data yet — keep
            const ageSec = (now - pos.lastSeen) / 1000;
            if (ageSec >= REMOVE_SEC) {
                const hex = f.properties.hex;
                if (hex && this._callsignMarkers[hex]) {
                    this._callsignMarkers[hex].remove();
                    delete this._callsignMarkers[hex];
                }
                return false;
            }
            return true;
        });

        // Build an array of extrapolated features for this tick
        this._interpolatedFeatures = this._geojson.features.map(f => {
            const hex     = f.properties.hex;
            const pos     = this._lastPositions[hex];
            const ageSec  = pos ? (now - pos.lastSeen) / 1000 : 0;
            const onGround = f.properties.alt_baro === 0;

            if (onGround) {
                // Ground vehicles: dead-reckon only if moving at ≥10kt with a known track
                const groundStale = ageSec >= STALE_SEC;
                if (!pos || pos.gs < 10 || groundStale || pos.track === null) {
                    const coords = pos ? [pos.lon, pos.lat] : f.geometry.coordinates;
                    return { ...f, geometry: { type: 'Point', coordinates: coords }, properties: { ...f.properties, stale: 0 } };
                }
            } else {
                // Airborne: mark stale if no new data within threshold
                const stale = ageSec >= STALE_SEC ? 1 : 0;
                if (!pos || pos.gs < 10 || stale) {
                    const coords = pos ? [pos.lon, pos.lat] : f.geometry.coordinates;
                    return { ...f, geometry: { type: 'Point', coordinates: coords }, properties: { ...f.properties, stale } };
                }
            }

            // Dead-reckon: project forward along the current track vector
            const trackRad  = pos.track * Math.PI / 180;
            const nmPerSec  = pos.gs / HR_SEC;
            const dLat = nmPerSec * ageSec * Math.cos(trackRad) * NM_DEG;
            // Longitude step is scaled by cos(lat) to account for meridian convergence at high latitudes
            const dLon = nmPerSec * ageSec * Math.sin(trackRad) * NM_DEG / Math.cos(pos.lat * Math.PI / 180);
            return {
                ...f,
                geometry:   { type: 'Point', coordinates: [pos.lon + dLon, pos.lat + dLat] },
                properties: { ...f.properties, stale: 0 },
            };
        });

        // Push the interpolated snapshot to the MapLibre source
        if (this.map.getSource('adsb-live')) {
            this.map.getSource('adsb-live').setData({ type: 'FeatureCollection', features: this._interpolatedFeatures });
            // setData resets layer filters — reapply to restore civil/mil/all state
            this._applyTypeFilter();
        }

        // Track the followed aircraft and update HTML markers to interpolated positions
        if (this._tagMarker && this._tagHex) {
            const f = this._interpolatedFeatures.find(f => f.properties.hex === this._tagHex);
            if (f) {
                this._tagMarker.setLngLat(f.geometry.coordinates);
                if (this._followEnabled) {
                    // Smoothly pan to keep the aircraft centred; respect 3D pitch if active
                    const followPitch = typeof window._getTargetPitch === 'function' ? window._getTargetPitch() : 0;
                    this.map.easeTo({ center: f.geometry.coordinates, pitch: followPitch, duration: 150, easing: t => t });
                }
            }
        }
        // Move all callsign label and hover markers to their interpolated positions
        for (const f of this._interpolatedFeatures) {
            const hex = f.properties.hex;
            if (hex && this._callsignMarkers[hex]) {
                this._callsignMarkers[hex].setLngLat(f.geometry.coordinates);
            }
            if (hex && hex === this._hoverHex && this._hoverMarker) {
                this._hoverMarker.setLngLat(f.geometry.coordinates);
            }
        }
    }

    /**
     * Return the current interpolated coordinates for a hex code.
     * Falls back to the raw API coordinates if interpolation hasn't run yet.
     * Returns null if the hex is not in the feature list at all.
     */
    _interpolatedCoords(hex) {
        if (this._interpolatedFeatures) {
            const f = this._interpolatedFeatures.find(f => f.properties.hex === hex);
            if (f) return f.geometry.coordinates;
        }
        const f = this._geojson.features.find(f => f.properties.hex === hex);
        return f ? f.geometry.coordinates : null;
    }

    // ---- API fetch ----

    /**
     * Fetch live aircraft from the backend proxy (which calls airplanes.live).
     * Uses the user's cached GPS location if fresh (< 10 min); otherwise the map centre.
     * Handles rate limiting (429 → 30s back-off) and consecutive failure back-off.
     */
    async _fetch() {
        if (!this.map || this._isFetching) return;
        this._isFetching = true;

        // Prefer fresh user GPS over the map centre for a more relevant radar window
        let lat, lon;
        const cached = localStorage.getItem('userLocation');
        if (cached) {
            try {
                const loc = JSON.parse(cached);
                if (Date.now() - (loc.ts || 0) < 10 * 60 * 1000) {
                    lat = loc.latitude;
                    lon = loc.longitude;
                }
            } catch(e) {}
        }
        if (lat === undefined) {
            const c = this.map.getCenter();
            lat = c.lat; lon = c.lng;
        }

        try {
            // 250nm radius covers the whole UK from a central location
            const url  = `${origin}/api/air/adsb/point/${lat.toFixed(4)}/${lon.toFixed(4)}/250`;
            const resp = await fetch(url);

            if (!resp.ok) {
                if (resp.status === 429) {
                    // Rate limited: pause polling for 30s then resume
                    this._isFetching = false;
                    this._stopFetching();
                    setTimeout(() => { if (this.visible) this._startPolling(); }, 30000);
                    return;
                }
                this._isFetching = false;
                return;
            }

            this._fetchFailCount = 0;
            const data     = await resp.json();
            const aircraft = data.ac || [];
            const seen     = new Set(); // hex codes present in this API response

            // Build the new GeoJSON feature collection
            this._geojson = {
                type: 'FeatureCollection',
                features: aircraft
                    // Filter: must have a position; skip "no category info" types
                    .filter(a => a.lat != null && a.lon != null && !['A0', 'B0', 'C0'].includes((a.category || '').toUpperCase()))
                    .map(a => {
                        const alt = this._parseAlt(a.alt_baro);
                        const hex = a.hex || '';
                        seen.add(hex);

                        // ---- Trail history ----
                        if (hex) {
                            if (!this._trails[hex]) this._trails[hex] = [];
                            const trail = this._trails[hex];
                            const last  = trail[trail.length - 1];
                            // Only add a new trail point if the position actually changed
                            if (!last || last.lon !== a.lon || last.lat !== a.lat) {
                                trail.push({ lon: a.lon, lat: a.lat, alt });
                                if (trail.length > this._MAX_TRAIL) trail.shift(); // ring buffer
                            }
                        }

                        // ---- Last-known-position for dead-reckoning ----
                        if (hex) {
                            // Back-date lastSeen by seen_pos so ageSec reflects how stale the
                            // position fix is, not just when we fetched the API response
                            const lastSeen  = Date.now() - (a.seen_pos ?? 0) * 1000;
                            const existing  = this._lastPositions[hex];
                            if (!existing) {
                                this._lastPositions[hex] = { lon: a.lon, lat: a.lat, gs: a.gs ?? 0, track: a.track ?? null, lastSeen };
                            } else {
                                existing.lon = a.lon; existing.lat = a.lat;
                                existing.gs  = a.gs ?? 0; existing.track = a.track ?? null;
                                existing.lastSeen = lastSeen;
                            }
                        }

                        // ---- Landing / departure detection ----
                        if (hex) {
                            const prevAlt     = this._prevAlt[hex];
                            const gs          = a.gs ?? 0;
                            const justLanded  = (prevAlt !== undefined && prevAlt > 0 && alt === 0);
                            if (justLanded) this._landedAt[hex] = Date.now();

                            // Record ground contact while notifications are enabled
                            if (alt === 0 && this._notifEnabled.has(hex)) {
                                this._seenOnGround[hex] = true;
                            }

                            // Departure: first time we see the aircraft airborne after being on the ground
                            const justDeparted = (
                                alt > 0 && gs > 0 &&
                                !this._hasDeparted[hex] &&
                                this._seenOnGround[hex] &&
                                this._notifEnabled.has(hex)
                            );
                            this._prevAlt[hex] = alt;

                            // Reset departure flag when the aircraft lands again
                            if (alt === 0) this._hasDeparted[hex] = false;

                            // Nearest airport lookup (haversine distance, checks AIRPORTS_DATA)
                            const _nearestAirport = (lat, lon) => {
                                let best = null, bestDist = Infinity;
                                for (const f of AIRPORTS_DATA.features) {
                                    const [aLon, aLat] = f.geometry.coordinates;
                                    const dLat = (lat - aLat) * Math.PI / 180;
                                    const dLon = (lon - aLon) * Math.PI / 180;
                                    const a2 = Math.sin(dLat/2)**2 + Math.cos(aLat * Math.PI/180) * Math.cos(lat * Math.PI/180) * Math.sin(dLon/2)**2;
                                    const dist = 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
                                    if (dist < bestDist) { bestDist = dist; best = f.properties; }
                                }
                                return best;
                            };

                            if (justDeparted) {
                                this._hasDeparted[hex] = true;
                                const callsign = (a.flight || '').trim() || (a.r || '').trim();
                                const apt      = _nearestAirport(a.lat, a.lon);
                                const aptStr   = apt ? `${apt.name} (${apt.icao})` : '';
                                _Notifications.add({
                                    type:   'departure',
                                    title:  callsign,
                                    detail: aptStr || undefined,
                                });
                            }

                            if (justLanded && this._notifEnabled.has(hex)) {
                                const callsign = (a.flight || '').trim() || (a.r || '').trim();
                                const apt      = _nearestAirport(a.lat, a.lon);
                                const aptStr   = apt ? `${apt.name} (${apt.icao})` : '';
                                _Notifications.add({
                                    type:   'flight',
                                    title:  callsign,
                                    detail: aptStr || undefined,
                                });
                                // After 1 minute parked, sweep this aircraft from all internal state
                                if (this._parkedTimers[hex]) clearTimeout(this._parkedTimers[hex]);
                                this._parkedTimers[hex] = setTimeout(() => {
                                    delete this._parkedTimers[hex];
                                    delete this._prevAlt[hex];
                                    delete this._hasDeparted[hex];
                                    delete this._trails[hex];
                                    delete this._lastPositions[hex];
                                    this._geojson = { type: 'FeatureCollection', features: this._geojson.features.filter(f => f.properties.hex !== hex) };
                                    if (this._interpolatedFeatures) {
                                        this._interpolatedFeatures = this._interpolatedFeatures.filter(f => f.properties.hex !== hex);
                                    }
                                    if (this._callsignMarkers[hex]) {
                                        this._callsignMarkers[hex].remove();
                                        delete this._callsignMarkers[hex];
                                    }
                                    if (this._selectedHex === hex) {
                                        this._selectedHex = null;
                                        this._followEnabled = false;
                                        this._hideSelectedTag();
                                        this._hideStatusBar();
                                    }
                                    this._rebuildTrails();
                                    this._interpolate();
                                }, 60 * 1000);
                            }

                            // Cancel removal timer if the aircraft becomes airborne again
                            if (alt > 0 && this._parkedTimers[hex]) {
                                clearTimeout(this._parkedTimers[hex]);
                                delete this._parkedTimers[hex];
                            }
                        }

                        // ---- Military detection ----
                        // The API provides a.military flag; ICAO hex ranges supplement it:
                        //   0x43C000–0x43FFFF = UK military  (but LAAD = US Low Altitude Air Defence → civilian-ish)
                        //   0xAE0000–0xAFFFFF = US military
                        const gs      = a.gs ?? 0;
                        const hexInt  = parseInt(hex, 16);
                        const military = a.t !== 'LAAD'
                            && (a.military === true
                            || (hexInt >= 0x43C000 && hexInt <= 0x43FFFF)
                            || (hexInt >= 0xAE0000 && hexInt <= 0xAFFFFF));

                        return {
                            type: 'Feature',
                            geometry:   { type: 'Point', coordinates: [a.lon, a.lat] },
                            properties: {
                                hex,
                                flight:       (a.flight || '').trim(),
                                r:            a.r   || '',   // registration
                                t:            a.t   || '',   // type code (e.g. B738, C17)
                                alt_baro:     alt,
                                alt_geom:     a.alt_geom    ?? null,
                                gs,
                                ias:          a.ias         ?? null,
                                mach:         a.mach        ?? null,
                                track:        a.track       ?? 0,    // heading in degrees
                                baro_rate:    a.baro_rate   ?? 0,    // vertical speed in fpm
                                nav_altitude: a.nav_altitude_mcp ?? a.nav_altitude_fms ?? null,
                                nav_heading:  a.nav_heading ?? null,
                                category:     (a.category || '').toUpperCase(),
                                emergency:    a.emergency   || '',
                                squawk:       a.squawk      || '',
                                squawkEmerg:  this._emergencySquawks.has(a.squawk || '') ? 1 : 0,
                                rssi:         a.rssi        ?? null,
                                military,
                            },
                        };
                    }),
            };

            // Clean up per-hex state for aircraft that are no longer in the feed
            for (const hex of Object.keys(this._trails))        { if (!seen.has(hex)) delete this._trails[hex]; }
            for (const hex of Object.keys(this._lastPositions)) { if (!seen.has(hex)) delete this._lastPositions[hex]; }
            for (const hex of Object.keys(this._prevAlt))       { if (!seen.has(hex) && !this._parkedTimers[hex]) delete this._prevAlt[hex]; }
            for (const hex of Object.keys(this._hasDeparted))   { if (!seen.has(hex)) delete this._hasDeparted[hex]; }
            for (const hex of Object.keys(this._prevSquawk))    { if (!seen.has(hex)) delete this._prevSquawk[hex]; }

            // ---- Squawk emergency change detection ----
            // Fire a notification when an aircraft enters or exits an emergency squawk code
            for (const f of this._geojson.features) {
                const props   = f.properties;
                const hex     = props.hex;
                if (!hex) continue;
                const squawk  = props.squawk || '';
                const prev    = this._prevSquawk[hex];
                const isEmerg  = this._emergencySquawks.has(squawk);
                const wasEmerg = prev !== undefined && this._emergencySquawks.has(prev);

                if (squawk !== prev) {
                    if (isEmerg) {
                        // Entered emergency squawk — full notification with code label and position data
                        const callsign = (props.flight || '').trim() || (props.r || '').trim() || hex;
                        const squawkLabels = { '7700': 'General Emergency', '7600': 'Radio Failure / Lost Comm', '7500': 'Hijacking / Unlawful Interference' };
                        const now = new Date();
                        const detail = [
                            `SQK ${squawk} — ${squawkLabels[squawk] || 'Emergency'}`,
                            props.alt_baro > 0 ? `ALT ${props.alt_baro.toLocaleString()} ft` : 'ON GROUND',
                            props.gs ? `GS ${Math.round(props.gs)} kt` : '',
                        ].filter(Boolean).join(' · ') +
                        `\n${now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}  ${now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
                        const coords = f.geometry.coordinates;
                        _Notifications.add({
                            type:   'emergency',
                            title:  callsign,
                            detail,
                            clickAction: () => {
                                // Fly to the aircraft's last known position when the notification is clicked
                                if (this.map) this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 9) });
                            },
                        });
                    } else if (wasEmerg) {
                        // Exited emergency squawk — announce the code change
                        const callsign = (props.flight || '').trim() || (props.r || '').trim() || hex;
                        const now = new Date();
                        _Notifications.add({
                            type:   'squawk-clr',
                            title:  callsign,
                            detail: `Squawk changed to ${squawk || '(none)'}  ·  ${now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}  ${now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`,
                        });
                    }
                    this._prevSquawk[hex] = squawk;
                }
            }

            // Record fetch time — _startPolling uses this to skip the first redundant poll
            this._lastFetchTime = Date.now();

            // Restore any previously tracked aircraft on first fetch after page load
            this._restoreTrackingState();

            // Refresh trail and data tag for the currently selected aircraft
            this._rebuildTrails();
            if (this._tagHex && this._tagMarker) {
                const f = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (f) {
                    this._tagMarker.getElement().innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(this._tagMarker.getElement());
                    this._updateStatusBar();
                } else {
                    // Selected aircraft has left the 250nm radius — deselect
                    this._hideSelectedTag();
                    this._hideStatusBar();
                }
            }

            // Refresh all callsign label markers
            this._updateCallsignMarkers();

            // Keep ADS-B layers above all other map layers after setData calls
            this._raiseLayers();
            this._fetchFailCount = 0;

        } catch(e) {
            // Consecutive failure back-off: 3 failures → pause polling for 30s
            this._fetchFailCount++;
            if (this._fetchFailCount >= 3) {
                this._fetchFailCount = 0;
                this._isFetching = false;
                this._stopFetching();
                setTimeout(() => { if (this.visible) this._startPolling(); }, 30000);
                return;
            }
            console.warn('ADS-B fetch error:', e);
        } finally {
            this._isFetching = false;
        }
    }

    // ---- Layer z-order ----

    /**
     * Move all three ADS-B layers to the top of the layer stack.
     * Called after setData (which resets the stack) and after each style reload.
     */
    _raiseLayers() {
        if (!this.map) return;
        // moveLayer() with no second argument moves to the top
        ['adsb-trails', 'adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.moveLayer(id); } catch(e) {}
        });
    }

    // ---- Tracking state persistence ----

    /**
     * Persist the current tracking state to localStorage and the backend API.
     * Called whenever follow mode changes so tracking survives a page reload.
     */
    _saveTrackingState() {
        try {
            const activeHex = this._tagHex || (this._followEnabled ? this._selectedHex : null);
            if (activeHex && this._followEnabled) {
                // If tracking a different hex than before, remove the old backend entry first
                const prevHex = (() => { try { return JSON.parse(localStorage.getItem('adsbTracking') || '{}').hex; } catch(e) { return null; } })();
                if (prevHex && prevHex !== activeHex) {
                    fetch(`/api/air/tracking/${encodeURIComponent(prevHex)}`, { method: 'DELETE' }).catch(() => {});
                }
                localStorage.setItem('adsbTracking', JSON.stringify({ hex: activeHex }));
                const f        = this._geojson.features.find(f => f.properties.hex === activeHex);
                const callsign = f ? ((f.properties.flight || '').trim() || (f.properties.r || '').trim() || '') : '';
                fetch('/api/air/tracking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ hex: activeHex, callsign, follow: true }),
                }).catch(() => {});
            } else {
                // No longer tracking: remove from localStorage and backend
                const prevHex = (() => { try { return JSON.parse(localStorage.getItem('adsbTracking') || '{}').hex; } catch(e) { return null; } })();
                localStorage.removeItem('adsbTracking');
                if (prevHex) {
                    fetch(`/api/air/tracking/${encodeURIComponent(prevHex)}`, { method: 'DELETE' }).catch(() => {});
                }
            }
        } catch(e) {}
    }

    /**
     * Check the backend and localStorage for a previously tracked aircraft.
     * Called once after the first API fetch to restore tracking on page reload.
     * Backend is authoritative; localStorage is the fallback.
     */
    _restoreTrackingState() {
        if (this._trackingRestored) return;
        this._trackingRestored = true;
        fetch('/api/air/tracking')
            .then(r => r.ok ? r.json() : [])
            .then(rows => {
                const tracked = rows.find(r => r.follow);
                if (tracked) localStorage.setItem('adsbTracking', JSON.stringify({ hex: tracked.hex }));
                this._doRestoreTracking();
            })
            .catch(() => this._doRestoreTracking());
    }

    /**
     * Apply the persisted tracking hex: select the aircraft, enable follow mode,
     * rebuild the data tag in tracking layout, and open the status bar.
     */
    _doRestoreTracking() {
        try {
            const saved = localStorage.getItem('adsbTracking');
            if (!saved) return;
            const { hex } = JSON.parse(saved);
            if (!hex) return;
            const f = this._geojson.features.find(f => f.properties.hex === hex);
            if (!f) return; // not in the current radar window — skip

            this._selectedHex = hex;
            this._applySelection();
            this._followEnabled = true;
            this._saveTrackingState();
            this._notifEnabled.add(hex);

            // Restore action callbacks for any persisted tracking notifications
            // (in-memory callbacks are lost on page refresh — re-wire them here)
            try {
                const persisted = JSON.parse(localStorage.getItem('notifications') || '[]');
                if (!this._trackingNotifIds) this._trackingNotifIds = {};
                const restoredIds = [];
                for (const item of persisted) {
                    if (item.type === 'tracking') {
                        this._trackingNotifIds[hex] = item.id;
                        _Notifications.update({
                            id: item.id,
                            action: {
                                label: 'DISABLE NOTIFICATIONS',
                                callback: () => {
                                    this._notifEnabled.delete(hex);
                                    if (this._trackingNotifIds) delete this._trackingNotifIds[hex];
                                    this._rebuildTagForHex(hex);
                                },
                            },
                        });
                        restoredIds.push(item.id);
                    }
                }
                if (restoredIds.length) _Notifications.render(restoredIds);
            } catch(e) {}

            // Build the compact tracking-mode data tag
            const coords = this._interpolatedCoords(hex) || f.geometry.coordinates;
            const newEl  = document.createElement('div');
            newEl.innerHTML = this._buildTagHTML(f.properties);
            this._wireTagButton(newEl);
            if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
            this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'left', offset: [14, 0] })
                .setLngLat(coords)
                .addTo(this.map);
            this._showStatusBar(f.properties);
            const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
            this.map.easeTo({ center: f.geometry.coordinates, zoom: 16, ...(is3D ? { pitch: 45 } : {}), duration: 600 });
        } catch(e) {}
    }

    // ---- Polling control ----

    /**
     * Start the 5s API poll and 100ms interpolation intervals.
     * Skips the immediate fetch if data was already fetched within the last 4s
     * (e.g. the pre-fetch in onAdd() completed just before the style loaded).
     */
    _startPolling() {
        if (Date.now() - this._lastFetchTime > 4000) this._fetch();
        this._pollInterval = setInterval(() => this._fetch(), 5000);
        if (!this._interpolateInterval) {
            this._interpolateInterval = setInterval(() => this._interpolate(), 100);
        }
    }

    /** Stop both the polling and interpolation intervals. */
    _stopPolling() {
        if (this._pollInterval)        { clearInterval(this._pollInterval);        this._pollInterval        = null; }
        if (this._interpolateInterval) { clearInterval(this._interpolateInterval); this._interpolateInterval = null; }
    }

    /** Stop only the fetch poll (leave interpolation running — used during back-off). */
    _stopFetching() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }

    // ---- Visibility toggle ----

    /** Toggle ADS-B layer visibility; start/stop polling accordingly. */
    toggle() {
        this.visible = !this.visible;
        if (this.visible) {
            this._startPolling();
        } else {
            this._stopPolling();
            // Deselect any tracked aircraft when turning off
            this._selectedHex  = null;
            this._followEnabled = false;
            this._hideSelectedTag();
            this._hideHoverTag();
            this._hideStatusBar();
            // Remove callsign markers for planes only — ground vehicles and towers
            // are shown independently of the ADS-B toggle
            for (const [hex, marker] of Object.entries(this._callsignMarkers)) {
                const f   = this._geojson.features.find(f => f.properties.hex === hex);
                if (!f) continue;
                const cat     = (f.properties.category || '').toUpperCase();
                const isGnd   = ['C1', 'C2'].includes(cat);
                const isTower = ['C3', 'C4', 'C5'].includes(cat) || (f.properties.t || '').toUpperCase() === 'TWR';
                if (!isGnd && !isTower) { marker.remove(); delete this._callsignMarkers[hex]; }
            }
        }

        // Trails have no non-plane items — hide/show directly
        try { this.map.setLayoutProperty('adsb-trails', 'visibility', this.visible ? 'visible' : 'none'); } catch(e) {}
        this._applyTypeFilter();

        // Update button appearance
        this.button.style.opacity = this.visible ? '1'       : '0.3';
        this.button.style.color   = this.visible ? '#c8ff00' : '#ffffff';

        // Keep the labels toggle in sync with the ADS-B toggle
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(this.visible);

        _saveOverlayStates();
    }
}

// Instantiate and register with MapLibre.
// Store in the global adsbControl variable declared in air-globals.js
// so overlay-reinit.js can call adsbControl.initLayers() after style switches.
adsbControl = new AdsbLiveControl();
map.addControl(adsbControl, 'top-right');

// Expose on window for dev testing via squawk-test.js
window._adsb = adsbControl;
