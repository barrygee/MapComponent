// ============================================================
// ADS-B LIVE CONTROL
// Polls airplanes.live API (via backend proxy) every 5s,
// holds aircraft at last known position (removes after 60s no data), renders aircraft as
// canvas sprites in MapLibre symbol layers, manages click/hover
// data tags, trail history, tracking, squawk emergency detection,
// and departure/landing notifications.
//
// Depends on:
//   map (global alias), maplibregl, _overlayStates, _saveOverlayStates,
//   window._Notifications, window._Tracking, AIRPORTS_DATA (airports.ts must load first)
// ============================================================

/// <reference types="maplibre-gl" />
/// <reference path="../../../globals.d.ts" />
/// <reference path="../../../types.ts" />

// ---- Internal types ----

interface TrailEntry {
    lon: number;
    lat: number;
    alt: number;
}

interface AircraftGeoFeature {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: AircraftProperties;
}

interface TrailGeoFeature {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { alt: number; opacity: number; emerg: 0 | 1 };
}

class AdsbLiveControl implements maplibregl.IControl {
    visible: boolean;
    labelsVisible: boolean;

    // MapLibre control elements — public so clear-overlays.ts can access map
    map!:       maplibregl.Map;
    container!: HTMLDivElement;
    button!:    HTMLButtonElement;

    // Polling intervals
    private _pollInterval:        ReturnType<typeof setInterval> | null = null;
    private _interpolateInterval: ReturnType<typeof setInterval> | null = null;

    // GeoJSON data — public so filter.ts/side-menu.ts can read aircraft list
    _geojson:       { type: 'FeatureCollection'; features: AircraftGeoFeature[] };
    private _trailsGeojson: { type: 'FeatureCollection'; features: TrailGeoFeature[] };

    // Per-hex state
    private _trails:       Record<string, TrailEntry[]> = {};
    private _MAX_TRAIL     = 100;
    private _lastPositions: Record<string, LastPosition> = {};
    private _interpolatedFeatures: AircraftGeoFeature[] | null = null;

    // Selection / tracking — public so filter.ts/side-menu.ts can read/write
    _selectedHex:   string | null = null;
    private _eventsAdded    = false;
    _followEnabled  = false;

    // HTML markers — public so filter.ts can access tag marker
    _tagMarker: maplibregl.Marker | null = null;
    _tagHex:    string | null = null;
    private _hoverMarker:     maplibregl.Marker | null = null;
    private _hoverHex:        string | null = null;
    private _hoverFromLabel   = false;
    private _hoverHideTimer:  ReturnType<typeof setTimeout> | null = null;
    private _callsignMarkers: Record<string, maplibregl.Marker> = {};

    // Landing/departure detection
    private _prevAlt:      Record<string, number>  = {};
    private _hasDeparted:  Record<string, boolean> = {};
    private _landedAt:     Record<string, number>  = {};
    private _seenOnGround: Record<string, boolean> = {};
    private _parkedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    // Notifications / tracking — public so filter.ts can access
    _notifEnabled:     Set<string>                  = new Set();
    private _trackingRestored  = false;
    _trackingNotifIds: Record<string, string> | null = null;

    // Fetch state
    private _lastFetchTime   = 0;
    private _isFetching      = false;
    private _fetchFailCount  = 0;

    // Squawk / filter — public so side-menu.ts/filter.ts can read
    private _emergencySquawks: Set<string> = new Set(['7700', '7600', '7500']);
    private _prevSquawk:       Record<string, string> = {};
    _typeFilter:               'all' | 'civil' | 'mil' = 'all';
    _allHidden         = false;
    _hideGroundVehicles = false;
    _hideTowers         = false;

    // Sprite ready (canvas-drawn, always sync)
    private _spriteReady: Promise<void> = Promise.resolve();

    constructor() {
        this.visible       = _overlayStates.adsb;
        this.labelsVisible = _overlayStates.adsbLabels ?? true;
        this._geojson       = { type: 'FeatureCollection', features: [] };
        this._trailsGeojson = { type: 'FeatureCollection', features: [] };
    }

    // ---- Public filter setters ----

    setTypeFilter(mode: 'all' | 'civil' | 'mil'): void {
        this._typeFilter = mode;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    setAllHidden(hidden: boolean): void {
        this._allHidden = hidden;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
        const isTracking = this._followEnabled && this._selectedHex;
        const tagEl  = this._tagMarker   ? this._tagMarker.getElement()   : null;
        if (tagEl)  tagEl.style.visibility  = (hidden && !isTracking) ? 'hidden' : '';
        const hoverEl = this._hoverMarker ? this._hoverMarker.getElement() : null;
        if (hoverEl) hoverEl.style.visibility = hidden ? 'hidden' : '';
        try { this.map.setLayoutProperty('adsb-trails', 'visibility', (!hidden || isTracking) ? 'visible' : 'none'); } catch(e) {}
    }

    setHideGroundVehicles(hide: boolean): void {
        this._hideGroundVehicles = hide;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    setHideTowers(hide: boolean): void {
        this._hideTowers = hide;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
    }

    // ---- Layer filter ----

    private _applyTypeFilter(): void {
        if (!this.map) return;

        const baseFilter  = ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]];
        const isGndExpr   = ['match', ['get', 'category'], ['C1', 'C2'], true, false];
        const isTowerExpr = ['any',
            ['match', ['get', 'category'], ['C3', 'C4', 'C5'], true, false],
            ['==', ['get', 't'], 'TWR'],
        ];
        const isPlaneExpr = ['all', ['!', isGndExpr], ['!', isTowerExpr]];

        if (this._allHidden) {
            const trackedHex = this._followEnabled && this._selectedHex ? this._selectedHex : null;
            if (trackedHex) {
                const trackedFilter = ['==', ['get', 'hex'], trackedHex];
                ['adsb-bracket', 'adsb-icons'].forEach(id => {
                    try {
                        this.map.setLayoutProperty(id, 'visibility', 'visible');
                        this.map.setFilter(id, trackedFilter as maplibregl.FilterSpecification);
                    } catch(e) {}
                });
            } else {
                ['adsb-bracket', 'adsb-icons'].forEach(id => {
                    try { this.map.setLayoutProperty(id, 'visibility', 'none'); } catch(e) {}
                });
            }
            return;
        }

        ['adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', 'visible'); } catch(e) {}
        });

        const typeFiltering = this._typeFilter !== 'all';
        const showGnd    = this.visible && !typeFiltering && !this._hideGroundVehicles;
        const showTowers = this.visible && !typeFiltering && !this._hideTowers;
        const conditions: unknown[] = [];

        if (this.visible) {
            if (this._typeFilter === 'civil') {
                conditions.push(['all', baseFilter, isPlaneExpr, ['!', ['boolean', ['get', 'military'], false]]]);
            } else if (this._typeFilter === 'mil') {
                conditions.push(['all', baseFilter, isPlaneExpr, ['boolean', ['get', 'military'], false]]);
            } else {
                conditions.push(['all', baseFilter, isPlaneExpr]);
            }
        }

        if (showGnd)    conditions.push(isGndExpr);
        if (showTowers) conditions.push(isTowerExpr);

        const filter = conditions.length === 0
            ? ['==', ['get', 'hex'], '']
            : conditions.length === 1 ? conditions[0] : ['any', ...conditions];

        try { this.map.setFilter('adsb-bracket', filter as maplibregl.FilterSpecification); } catch(e) {}
        try { this.map.setFilter('adsb-icons',   filter as maplibregl.FilterSpecification); } catch(e) {}
    }

    // ---- MapLibre IControl lifecycle ----

    onAdd(mapInstance: maplibregl.Map): HTMLElement {
        this.map = mapInstance;

        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        this.button = document.createElement('button');
        this.button.title       = 'Toggle live ADS-B aircraft';
        this.button.textContent = 'ADS';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:8px;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s,color 0.2s';
        this.button.style.opacity = this.visible ? '1'       : '0.3';
        this.button.style.color   = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick     = () => this.toggle();
        this.button.onmouseover = () => { this.button.style.background = '#111'; };
        this.button.onmouseout  = () => { this.button.style.background = '#000'; };
        this.container.appendChild(this.button);

        if (this.visible) this._fetch();

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

    onRemove(): void {
        this._stopPolling();
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        (this.map as unknown) = undefined;
    }

    // ---- Altitude helper ----

    private _parseAlt(alt_baro: number | string | null): number {
        if (alt_baro === 'ground' || alt_baro === '' || alt_baro == null) return 0;
        const alt = typeof alt_baro === 'number' ? alt_baro : parseFloat(alt_baro as string) || 0;
        return alt < 0 ? 0 : alt;
    }

    // ---- Canvas sprite factories ----

    private _createRadarBlip(color = '#ffffff', scale = 1): ImageData {
        const canvasSize = 64, centerX = canvasSize / 2, centerY = canvasSize / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        const apexVertex      = { x: centerX,     y: centerY - 13 };
        const bottomRightVertex = { x: centerX + 9, y: centerY + 10 };
        const bottomLeftVertex  = { x: centerX - 9, y: centerY + 10 };
        const triangleCentroidX = (apexVertex.x + bottomRightVertex.x + bottomLeftVertex.x) / 3;
        const triangleCentroidY = (apexVertex.y + bottomRightVertex.y + bottomLeftVertex.y) / 3;
        const scaleFromCentroid = (v: { x: number; y: number }) => ({
            x: triangleCentroidX + (v.x - triangleCentroidX) * scale,
            y: triangleCentroidY + (v.y - triangleCentroidY) * scale,
        });
        const scaledApex        = scaleFromCentroid(apexVertex);
        const scaledBottomRight = scaleFromCentroid(bottomRightVertex);
        const scaledBottomLeft  = scaleFromCentroid(bottomLeftVertex);
        ctx.beginPath(); ctx.moveTo(scaledApex.x, scaledApex.y); ctx.lineTo(scaledBottomRight.x, scaledBottomRight.y); ctx.lineTo(scaledBottomLeft.x, scaledBottomLeft.y);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    private _createBracket(color = '#c8ff00'): ImageData {
        const canvasSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        const left = 4, top = 4, right = 60, bottom = 56, cornerArmLength = 10;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'square';
        ctx.beginPath(); ctx.moveTo(left + cornerArmLength, top);    ctx.lineTo(left,  top);    ctx.lineTo(left,  top    + cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(right - cornerArmLength, top);   ctx.lineTo(right, top);    ctx.lineTo(right, top    + cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(left + cornerArmLength, bottom);  ctx.lineTo(left,  bottom); ctx.lineTo(left,  bottom - cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(right - cornerArmLength, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - cornerArmLength); ctx.stroke();
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    private _createMilBracket(): ImageData {
        const canvasSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        const left = 4, top = 4, right = 60, bottom = 56, cornerArmLength = 10;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeStyle = '#c8ff00'; ctx.lineWidth = 3; ctx.lineCap = 'square';
        ctx.beginPath(); ctx.moveTo(left + cornerArmLength, top);    ctx.lineTo(left,  top);    ctx.lineTo(left,  top    + cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(right - cornerArmLength, top);   ctx.lineTo(right, top);    ctx.lineTo(right, top    + cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(left + cornerArmLength, bottom);  ctx.lineTo(left,  bottom); ctx.lineTo(left,  bottom - cornerArmLength); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(right - cornerArmLength, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - cornerArmLength); ctx.stroke();
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    private _createTowerBlip(scale = 1.1): ImageData {
        const canvasSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        ctx.beginPath(); ctx.arc(canvasSize / 2, canvasSize / 2, 9 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill();
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    private _createGroundVehicleBlip(color = '#ffffff', scale = 1.1): ImageData {
        const canvasSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        const halfSquareSize = 9 * scale, centerX = canvasSize / 2, centerY = canvasSize / 2;
        ctx.fillStyle = color;
        ctx.fillRect(centerX - halfSquareSize, centerY - halfSquareSize, halfSquareSize * 2, halfSquareSize * 2);
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    private _createUAVBlip(color = '#ffffff', scale = 1.1): ImageData {
        const canvasSize = 64, centerX = canvasSize / 2, centerY = canvasSize / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = canvasSize;
        const ctx = canvas.getContext('2d')!;
        const apexVertex        = { x: centerX,     y: centerY - 13 };
        const bottomRightVertex = { x: centerX + 9, y: centerY + 10 };
        const bottomLeftVertex  = { x: centerX - 9, y: centerY + 10 };
        const triangleCentroidX = (apexVertex.x + bottomRightVertex.x + bottomLeftVertex.x) / 3;
        const triangleCentroidY = (apexVertex.y + bottomRightVertex.y + bottomLeftVertex.y) / 3;
        const scaleFromCentroid = (v: { x: number; y: number }) => ({
            x: triangleCentroidX + (v.x - triangleCentroidX) * scale,
            y: triangleCentroidY + (v.y - triangleCentroidY) * scale,
        });
        const scaledApex        = scaleFromCentroid(apexVertex);
        const scaledBottomRight = scaleFromCentroid(bottomRightVertex);
        const scaledBottomLeft  = scaleFromCentroid(bottomLeftVertex);
        ctx.beginPath(); ctx.moveTo(scaledApex.x, scaledApex.y); ctx.lineTo(scaledBottomRight.x, scaledBottomRight.y); ctx.lineTo(scaledBottomLeft.x, scaledBottomLeft.y);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
        const crosshairHalfSize = 4.5 * scale;
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(triangleCentroidX - crosshairHalfSize, triangleCentroidY - crosshairHalfSize); ctx.lineTo(triangleCentroidX + crosshairHalfSize, triangleCentroidY + crosshairHalfSize);
        ctx.moveTo(triangleCentroidX + crosshairHalfSize, triangleCentroidY - crosshairHalfSize); ctx.lineTo(triangleCentroidX - crosshairHalfSize, triangleCentroidY + crosshairHalfSize);
        ctx.stroke();
        return ctx.getImageData(0, 0, canvasSize, canvasSize);
    }

    // ---- Sprite registration ----

    _registerIcons(): void {
        const _addOrUpdate = (name: string, data: ImageData, options: { pixelRatio: number; sdf: boolean }) => {
            if (this.map.hasImage(name)) {
                this.map.updateImage(name, data);
            } else {
                this.map.addImage(name, data, options);
            }
        };

        _addOrUpdate('adsb-bracket',          this._createBracket(),                         { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-bracket-mil',       this._createMilBracket(),                      { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-bracket-emerg',     this._createBracket('#ff2222'),                { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-bracket-emerg-gnd', this._createBracket('#ff2222'),                { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip',              this._createRadarBlip('#ffffff',         1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-mil',          this._createRadarBlip('#c8ff00',         1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-emerg',        this._createRadarBlip('#ff2222',         1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-uav',          this._createUAVBlip('#ffffff',           1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-gnd',          this._createGroundVehicleBlip('#ffffff', 1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-emerg-gnd',    this._createGroundVehicleBlip('#ff2222', 1.1), { pixelRatio: 2, sdf: false });
        _addOrUpdate('adsb-blip-tower',        this._createTowerBlip(1.1),                    { pixelRatio: 2, sdf: false });
    }

    // ---- Map layer initialisation ----

    initLayers(): void {
        const layerVisibility = this.visible ? 'visible' : 'none';

        ['adsb-icons', 'adsb-bracket', 'adsb-trails'].forEach(id => {
            try { this.map.removeLayer(id); } catch(e) {}
        });

        // Cancel any pending timers that could mutate state after we wipe it.
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        for (const t of Object.values(this._parkedTimers)) clearTimeout(t);
        this._parkedTimers = {};

        // Remove all DOM markers.
        this._clearCallsignMarkers();
        this._hideHoverTagNow();
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        this._tagHex = null;
        this._hideStatusBar();

        // Reset selection/tracking state.
        this._selectedHex  = null;
        this._followEnabled = false;

        ['adsb-live', 'adsb-trails-source'].forEach(id => {
            if (this.map.getSource(id)) this.map.removeSource(id);
        });

        // Preserve aircraft data across style reloads — sources/layers must be re-added
        // after setStyle() destroys them, but the data itself must survive so planes don't
        // vanish. Deliberate data wipes (going offline) are handled by _clearAdsbAircraft().
        const _savedGeojson        = this._geojson;
        const _savedTrailsGeojson  = this._trailsGeojson;
        const _savedTrails         = this._trails;
        const _savedLastPositions  = this._lastPositions;
        const _savedInterpolated   = this._interpolatedFeatures;
        const _savedPrevAlt        = this._prevAlt;
        const _savedHasDeparted    = this._hasDeparted;
        const _savedSeenOnGround   = this._seenOnGround;
        const _savedLandedAt       = this._landedAt;
        const _savedPrevSquawk     = this._prevSquawk;
        this._geojson           = { type: 'FeatureCollection', features: [] };
        this._trailsGeojson     = { type: 'FeatureCollection', features: [] };
        this._trails            = {};
        this._lastPositions     = {};
        this._interpolatedFeatures = [];
        this._prevAlt           = {};
        this._hasDeparted       = {};
        this._seenOnGround      = {};
        this._landedAt          = {};
        this._prevSquawk        = {};

        this._registerIcons();

        this.map.addSource('adsb-trails-source', { type: 'geojson', data: this._trailsGeojson as GeoJSON.GeoJSON });
        this.map.addLayer({
            id: 'adsb-trails', type: 'circle', source: 'adsb-trails-source',
            layout: { visibility: layerVisibility },
            paint: {
                'circle-radius': 2.5,
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-width': 0,
                'circle-color': ['case', ['==', ['get', 'emerg'], 1], '#ff2222', '#c8ff00'],
            },
        });

        this.map.addSource('adsb-live', { type: 'geojson', data: this._geojson as GeoJSON.GeoJSON });

        this.map.addLayer({
            id: 'adsb-bracket', type: 'symbol', source: 'adsb-live',
            filter: ['all',
                ['!', ['match', ['get', 'category'], ['A0', 'B0', 'C0'], true, false]],
                ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            ] as maplibregl.FilterSpecification,
            layout: {
                visibility: layerVisibility,
                'icon-image': ['case',
                    ['==', ['get', 'squawkEmerg'], 1], 'adsb-bracket-emerg',
                    ['boolean', ['get', 'military'], false], 'adsb-bracket-mil',
                    ['==', ['get', 'category'], 'C1'], 'adsb-bracket-emerg-gnd',
                    'adsb-bracket',
                ] as maplibregl.ExpressionSpecification,
                'icon-size': 0.75,
                'icon-rotation-alignment': 'viewport',
                'icon-pitch-alignment':    'viewport',
                'icon-allow-overlap':      true,
                'icon-ignore-placement':   true,
            },
            paint: {
                'icon-opacity': ['case', ['==', ['get', 'stale'], 1], 0.3, 1] as maplibregl.ExpressionSpecification,
                'icon-opacity-transition': { duration: 0 },
            } as Record<string, unknown>,
        });

        this.map.addLayer({
            id: 'adsb-icons', type: 'symbol', source: 'adsb-live',
            filter: ['all',
                ['!', ['match', ['get', 'category'], ['A0', 'B0', 'C0'], true, false]],
                ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            ] as maplibregl.FilterSpecification,
            layout: {
                visibility: layerVisibility,
                'icon-image': ['case',
                    ['==', ['get', 'squawkEmerg'], 1],                    'adsb-blip-emerg',
                    ['boolean', ['get', 'military'], false],               'adsb-blip-mil',
                    ['==', ['get', 'category'], 'B6'],                     'adsb-blip-uav',
                    ['==', ['get', 'category'], 'C1'],                     'adsb-blip-emerg-gnd',
                    ['==', ['get', 'category'], 'C2'],                     'adsb-blip-gnd',
                    ['==', ['get', 'category'], 'C3'],                     'adsb-blip-tower',
                    ['==', ['get', 't'], 'TWR'],                           'adsb-blip-tower',
                    'adsb-blip',
                ] as maplibregl.ExpressionSpecification,
                'icon-size': 0.75,
                'icon-rotate': ['get', 'track'] as maplibregl.ExpressionSpecification,
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment':    'map',
                'icon-allow-overlap':      true,
                'icon-ignore-placement':   true,
            },
            paint: {
                'icon-opacity': ['case', ['==', ['get', 'stale'], 1], 0.3, 1] as maplibregl.ExpressionSpecification,
                'icon-opacity-transition': { duration: 0 },
            } as Record<string, unknown>,
        });

        // Restore aircraft data into the freshly re-created sources.
        this._geojson              = _savedGeojson;
        this._trailsGeojson        = _savedTrailsGeojson;
        this._trails               = _savedTrails;
        this._lastPositions        = _savedLastPositions;
        this._interpolatedFeatures = _savedInterpolated;
        this._prevAlt              = _savedPrevAlt;
        this._hasDeparted          = _savedHasDeparted;
        this._seenOnGround         = _savedSeenOnGround;
        this._landedAt             = _savedLandedAt;
        this._prevSquawk           = _savedPrevSquawk;
        try {
            const renderData = (this._interpolatedFeatures && this._interpolatedFeatures.length)
                ? { type: 'FeatureCollection' as const, features: this._interpolatedFeatures }
                : this._geojson;
            (this.map.getSource('adsb-live') as maplibregl.GeoJSONSource)?.setData(renderData as GeoJSON.GeoJSON);
            (this.map.getSource('adsb-trails-source') as maplibregl.GeoJSONSource)?.setData(this._trailsGeojson as GeoJSON.GeoJSON);
        } catch(e) {}

        if (!this._eventsAdded) {
            this._eventsAdded = true;
            let _clickHandled = false;

            const handleAircraftClick = (e: maplibregl.MapLayerMouseEvent) => {
                if (_clickHandled) return;
                if (!e.features || !e.features.length) return;
                _clickHandled = true;
                const hex = (e.features[0].properties as AircraftProperties).hex;
                this._selectedHex = (hex === this._selectedHex) ? null : hex;
                this._hideHoverTag();
                this._applySelection();
            };

            this.map.on('click', 'adsb-bracket', handleAircraftClick);
            this.map.on('click', 'adsb-icons',   handleAircraftClick);

            this.map.on('click', (e: maplibregl.MapMouseEvent) => {
                if (_clickHandled) { _clickHandled = false; return; }
                if (this._followEnabled) return;
                if (this._selectedHex) {
                    const hits = this.map.queryRenderedFeatures(e.point, { layers: ['adsb-bracket', 'adsb-icons'] });
                    if (!hits.length) { this._selectedHex = null; this._applySelection(); }
                }
            });

            const handleHoverEnter = (e: maplibregl.MapLayerMouseEvent) => {
                this.map.getCanvas().style.cursor = 'pointer';
                if (!e.features || !e.features.length) return;
                const hex = (e.features[0].properties as AircraftProperties).hex;
                const hoveredFeature = this._geojson.features.find(f => f.properties.hex === hex);
                if (hoveredFeature) this._showHoverTag(hoveredFeature);
            };
            const handleHoverLeave = () => {
                this.map.getCanvas().style.cursor = '';
                this._hideHoverTag();
            };

            this.map.on('mouseenter', 'adsb-bracket', handleHoverEnter);
            this.map.on('mouseleave', 'adsb-bracket', handleHoverLeave);
            this.map.on('mouseenter', 'adsb-icons',   handleHoverEnter);
            this.map.on('mouseleave', 'adsb-icons',   handleHoverLeave);
            this.map.on('zoomend', () => this._updateCallsignMarkers());
        }

        this._raiseLayers();
        this._applyTypeFilter();
        if (this._geojson.features.length) this._interpolate();
        if (this.visible && !this._pollInterval && _airEffectiveMode() !== 'offgrid') this._startPolling();
    }

    // ---- ADS-B category label ----

    private _categoryLabel(code: string): string | null {
        const labels: Record<string, string> = {
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

    private _buildTagHTML(props: AircraftProperties): string {
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const isEmergency   = props.squawkEmerg === 1 || (props.emergency && props.emergency !== 'none');
        const callsignColor = isEmergency ? '#ff4040' : '#ffffff';
        const isTracked     = this._followEnabled && props.hex === this._tagHex;
        const notifOn       = this._notifEnabled.has(props.hex);
        const trkColor      = isTracked ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const trkBtnText    = isTracked ? 'TRACKING' : 'TRACK';
        const trkBtn = `<button class="tag-follow-btn" style="background:none;border:none;cursor:pointer;padding:8px 12px;color:${trkColor};font-family:'Barlow Condensed','Barlow',sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent">${trkBtnText}</button>`;
        const bellColor = notifOn ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const bellBtn = `<button class="tag-notif-btn" data-hex="${props.hex}" style="background:none;border:none;cursor:pointer;padding:8px 6px;color:${bellColor};line-height:1;touch-action:manipulation;-webkit-tap-highlight-color:transparent" aria-label="Toggle notifications">` +
            `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
            `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
            (notifOn ? '' : `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`) +
            `</svg></button>`;

        if (isTracked) {
            const milTypeBadge = (props.military && props.t)
                ? `<span style="background:#4d6600;color:#c8ff00;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 4px;">${props.t.toUpperCase()}</span>`
                : '';
            const hasBadge = !!(props.military && props.t);
            return `<div style="background:rgb(10,13,20);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:13px;font-weight:400;padding:1px ${hasBadge ? '0' : '8px'} 1px 8px;white-space:nowrap;user-select:none">` +
                `<div style="display:flex;align-items:stretch;gap:4px">` +
                `<span style="font-size:13px;font-weight:400;letter-spacing:.12em;color:${callsignColor};pointer-events:none;align-self:center">${callsign}</span>` +
                `${milTypeBadge}${trkBtn}</div></div>`;
        }

        const alt    = props.alt_baro ?? 0;
        const vrt    = props.baro_rate ?? 0;
        const altStr = alt === 0 ? 'GND'
            : alt >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0')
            : alt.toLocaleString() + ' ft';
        const vrtArrow = vrt > 200 ? ' ↑' : vrt < -200 ? ' ↓' : '';
        const rows: [string, string][] = [
            ['ALT', altStr + vrtArrow],
            ['SPD', Math.round(props.gs ?? 0) + ' kt'],
            ['HDG', Math.round(props.track ?? 0) + '°'],
        ];
        if (props.t)      rows.push(['TYP', props.t]);
        if (props.r)      rows.push(['REG', props.r]);
        if (props.squawk) rows.push(['SQK', props.squawk]);
        const catLabel = this._categoryLabel(props.category);
        if (catLabel)     rows.push(['CAT', catLabel]);
        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`
        ).join('');
        return `<div style="background:rgb(10,13,20);color:#fff;font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;padding:6px 14px 9px;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600;font-size:15px;letter-spacing:.12em;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none;color:${callsignColor}">${callsign}</span>` +
            `<div style="display:flex;align-items:center;gap:0">${bellBtn}${trkBtn}</div></div>` +
            `<div style="pointer-events:none">` + rowsHTML + `</div></div>`;
    }

    private _buildTrackingFields(props: AircraftProperties): TrackingItemField[] {
        const alt      = props.alt_baro ?? 0;
        const vrt      = props.baro_rate ?? 0;
        const altStr   = alt === 0 ? 'GND'
            : alt >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0')
            : alt.toLocaleString() + ' ft';
        const vrtArrow = vrt > 200 ? ' ↑' : vrt < -200 ? ' ↓' : '';
        const isEmergency = !!(props.emergency && props.emergency !== 'none');
        const fields: TrackingItemField[] = [];
        if (props.r)       fields.push({ label: 'REG',      value: props.r });
        if (props.t)       fields.push({ label: 'TYPE',     value: props.t });
        fields.push({ label: 'ALT',  value: altStr + vrtArrow });
        fields.push({ label: 'GS',   value: Math.round(props.gs ?? 0) + ' kt' });
        fields.push({ label: 'HDG',  value: Math.round(props.track ?? 0) + '°' });
        if (props.squawk)  fields.push({ label: 'SQUAWK',   value: props.squawk });
        if (isEmergency)   fields.push({ label: 'EMRG',     value: props.emergency!.toUpperCase(), emrg: true });
        if (props.military) fields.push({ label: 'CLASS',   value: 'MILITARY' });
        const catLabel = this._categoryLabel(props.category);
        if (catLabel)      fields.push({ label: 'CATEGORY', value: catLabel });
        return fields;
    }

    // ---- Status bar ----

    private _showStatusBar(props: AircraftProperties): void {
        if (typeof window._Tracking === 'undefined') return;
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const isEmergency = !!(props.emergency && props.emergency !== 'none');
        window._Tracking.register({
            id:       'air',
            name:     isEmergency ? `⚠ ${callsign}` : callsign,
            domain:   'AIR',
            fields:   this._buildTrackingFields(props),
            onUntrack: () => this._handleUntrack(),
        });
        if (typeof window._FilterPanel !== 'undefined') window._FilterPanel.reposition();
    }

    private _hideStatusBar(): void {
        if (typeof window._Tracking !== 'undefined') window._Tracking.unregister('air');
        if (typeof window._FilterPanel !== 'undefined') window._FilterPanel.reposition();
    }

    private _updateStatusBar(): void {
        if (!this._followEnabled || !this._selectedHex) return;
        if (typeof window._Tracking === 'undefined') return;
        const aircraftFeature = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
        if (aircraftFeature) window._Tracking.updateFields('air', this._buildTrackingFields(aircraftFeature.properties));
    }

    private _handleUntrack(): void {
        this._followEnabled = false;
        if (this._tagHex) {
            if (this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                window._Notifications.update({ id: this._trackingNotifIds[this._tagHex], type: 'untrack', action: null });
                delete this._trackingNotifIds[this._tagHex];
            }
        }
        if (this._tagHex) this._notifEnabled.delete(this._tagHex);
        if (this._tagHex) {
            const taggedFeature = this._geojson.features.find(f => f.properties.hex === this._tagHex);
            if (taggedFeature) {
                const coords = this._interpolatedCoords(this._tagHex) || taggedFeature.geometry.coordinates;
                const newEl = document.createElement('div');
                newEl.innerHTML = this._buildTagHTML(taggedFeature.properties);
                this._wireTagButton(newEl);
                if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'top-left', offset: [14, -13] })
                    .setLngLat(coords).addTo(this.map);
            }
        }
        this._hideStatusBar();
        this._saveTrackingState();
        const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
        if (!is3D) this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }

    // ---- Tag button wiring ----

    private _wireTagButton(el: HTMLElement, overrideHex: string | null = null): void {
        const btn = el.querySelector('.tag-follow-btn');
        if (!btn) return;

        const bellBtn = el.querySelector('.tag-notif-btn') as HTMLElement | null;
        if (bellBtn) {
            bellBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            bellBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const hex = (bellBtn.dataset['hex'] || overrideHex || this._tagHex)!;
                if (!hex) return;
                const wasEnabled = this._notifEnabled.has(hex);
                const aircraftFeature = this._geojson.features.find(f => f.properties.hex === hex);
                const callsign = aircraftFeature ? ((aircraftFeature.properties.flight || '').trim() || (aircraftFeature.properties.r || '').trim() || hex) : hex;
                if (!this._trackingNotifIds) this._trackingNotifIds = {};
                if (wasEnabled) {
                    this._notifEnabled.delete(hex);
                    if (this._trackingNotifIds[hex]) {
                        window._Notifications.dismiss(this._trackingNotifIds[hex]);
                        delete this._trackingNotifIds[hex];
                    }
                    window._Notifications.add({ type: 'notif-off', title: callsign });
                } else {
                    this._notifEnabled.add(hex);
                    if (this._trackingNotifIds[hex]) window._Notifications.dismiss(this._trackingNotifIds[hex]);
                    this._trackingNotifIds[hex] = window._Notifications.add({
                        type: 'tracking', title: callsign,
                        action: { label: 'DISABLE NOTIFICATIONS', callback: () => {
                            this._notifEnabled.delete(hex);
                            if (this._trackingNotifIds) delete this._trackingNotifIds[hex];
                            this._rebuildTagForHex(hex);
                        }},
                    });
                }
                const nowEnabled = this._notifEnabled.has(hex);
                (bellBtn as HTMLElement).style.color = nowEnabled ? '#c8ff00' : 'rgba(255,255,255,0.3)';
                const slash = bellBtn.querySelector('line');
                if (slash) slash.setAttribute('display', nowEnabled ? 'none' : 'inline');
                this._rebuildTagForHex(hex);
            });
        }

        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        if (btn.textContent === 'TRACKING') {
            el.addEventListener('mouseenter', () => { (btn as HTMLElement).textContent = 'UNTRACK'; });
            el.addEventListener('mouseleave', () => { (btn as HTMLElement).textContent = 'TRACKING'; });
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const hex = overrideHex || this._tagHex;
            if (!hex) return;

            if (overrideHex && overrideHex !== this._selectedHex) {
                if (this._tagHex && this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                    window._Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                    delete this._trackingNotifIds[this._tagHex];
                }
                if (this._tagHex) this._notifEnabled.delete(this._tagHex);
                this._selectedHex = overrideHex;
                this._hideHoverTagNow();
                this._applySelection();
                this._followEnabled = true;
                this._notifEnabled.add(hex);
                const aircraftFeature = this._geojson.features.find(f => f.properties.hex === hex);
                if (aircraftFeature) {
                    const cs = (aircraftFeature.properties.flight || '').trim() || (aircraftFeature.properties.r || '').trim() || hex;
                    if (!this._trackingNotifIds) this._trackingNotifIds = {};
                    if (this._trackingNotifIds[hex]) window._Notifications.dismiss(this._trackingNotifIds[hex]);
                    this._trackingNotifIds[hex] = window._Notifications.add({ type: 'track', title: cs });
                    this._showStatusBar(aircraftFeature.properties);
                    const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
                    const coords = this._interpolatedCoords(hex) || aircraftFeature.geometry.coordinates;
                    this.map.easeTo({ center: coords, zoom: 16, ...(is3D ? { pitch: 45 } : {}), duration: 600 });
                    const newEl = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'left', offset: [14, 0] })
                        .setLngLat(coords).addTo(this.map);
                }
                this._saveTrackingState();
                return;
            }

            this._followEnabled = !this._followEnabled;
            if (!this._followEnabled && this._tagHex) {
                this._notifEnabled.delete(this._tagHex);
                if (this._trackingNotifIds && this._trackingNotifIds[this._tagHex]) {
                    window._Notifications.update({ id: this._trackingNotifIds[this._tagHex], type: 'untrack', action: null });
                    delete this._trackingNotifIds[this._tagHex];
                }
            }
            if (this._followEnabled && this._tagHex) {
                this._notifEnabled.add(this._tagHex);
                const trkF  = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                const trkCs = trkF ? ((trkF.properties.flight || '').trim() || (trkF.properties.r || '').trim() || this._tagHex) : this._tagHex!;
                if (!this._trackingNotifIds) this._trackingNotifIds = {};
                if (this._trackingNotifIds[this._tagHex]) window._Notifications.dismiss(this._trackingNotifIds[this._tagHex]);
                this._trackingNotifIds[this._tagHex] = window._Notifications.add({ type: 'track', title: trkCs });
            }
            if (this._tagHex) {
                const taggedFeature = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (taggedFeature) {
                    const coords = this._interpolatedCoords(this._tagHex) || taggedFeature.geometry.coordinates;
                    const newEl  = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(taggedFeature.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    const anchor = this._followEnabled ? 'left'  : 'top-left';
                    const offset: [number, number] = this._followEnabled ? [14, 0] : [14, -13];
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor, offset })
                        .setLngLat(coords).addTo(this.map);
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

    _rebuildTagForHex(hex: string): void {
        if (!hex || hex !== this._tagHex) return;
        const taggedFeature = this._geojson.features.find(f => f.properties.hex === hex);
        if (!taggedFeature) return;
        const coords = this._interpolatedCoords(hex) || taggedFeature.geometry.coordinates;
        const newEl  = document.createElement('div');
        newEl.innerHTML = this._buildTagHTML(taggedFeature.properties);
        this._wireTagButton(newEl);
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        const isTracked = this._followEnabled && hex === this._tagHex;
        const anchor    = isTracked ? 'left'  : 'top-left';
        const offset: [number, number] = isTracked ? [14, 0] : [14, -13];
        this._tagMarker = new maplibregl.Marker({ element: newEl, anchor, offset })
            .setLngLat(coords).addTo(this.map);
    }

    // ---- Tag show/hide ----

    private _showSelectedTag(feature: AircraftGeoFeature | null): void {
        this._hideSelectedTag();
        this._hideStatusBar();
        if (!feature || !this.map) return;
        this._followEnabled = false;
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        this._wireTagButton(el);
        const coords = this._interpolatedCoords(feature.properties.hex) || feature.geometry.coordinates;
        this._tagMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords).addTo(this.map);
        if (this._allHidden) el.style.visibility = 'hidden';
        this._tagHex = feature.properties.hex;
    }

    private _hideSelectedTag(): void {
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        if (this._tagHex && this._followEnabled) this._notifEnabled.delete(this._tagHex);
        this._tagHex = null;
        this._saveTrackingState();
    }

    // ---- Hover tag ----

    private _showHoverTag(feature: AircraftGeoFeature, fromLabel = false): void {
        if (!feature || !this.map) return;
        const hex = feature.properties.hex;
        if (hex === this._selectedHex) return;
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        const coords = this._interpolatedCoords(hex) || feature.geometry.coordinates;
        if (this._hoverHex === hex && this._hoverMarker) { this._hoverMarker.setLngLat(coords); return; }
        this._hideHoverTagNow();
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        el.style.pointerEvents = 'auto';
        el.addEventListener('mouseenter', () => {
            if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        });
        el.addEventListener('mouseleave', () => this._hideHoverTag());
        this._wireTagButton(el, hex);
        this._hoverMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords).addTo(this.map);
        this._hoverHex       = hex;
        this._hoverFromLabel = fromLabel;
        if (this._callsignMarkers[hex]) this._callsignMarkers[hex].getElement().style.visibility = 'hidden';
    }

    private _hideHoverTag(): void {
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 80);
    }

    private _hideHoverTagNow(): void {
        if (this._hoverHex && this._callsignMarkers[this._hoverHex]) {
            this._callsignMarkers[this._hoverHex].getElement().style.visibility = '';
        }
        if (this._hoverMarker) { this._hoverMarker.remove(); this._hoverMarker = null; }
        this._hoverHex       = null;
        this._hoverFromLabel = false;
    }

    // ---- Callsign label markers ----

    private _buildCallsignLabelEl(props: AircraftProperties): HTMLElement {
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const isEmerg  = props.squawkEmerg === 1;
        const el = document.createElement('div');
        el.style.cssText = [
            isEmerg ? 'background:rgba(180,0,0,0.85)' : 'background:rgba(0,0,0,0.5)',
            'color:#ffffff', "font-family:'Barlow Condensed','Barlow',sans-serif",
            'font-size:13px', 'font-weight:400', 'letter-spacing:.12em',
            'text-transform:uppercase', 'box-sizing:border-box',
            'display:flex', 'align-items:center', 'gap:5px',
            'padding:1px 8px', 'cursor:pointer', 'white-space:nowrap', 'user-select:none',
        ].join(';');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = callsign;
        nameSpan.style.cssText = isEmerg ? 'color:#ff4040 !important' : 'color:#ffffff !important';
        el.appendChild(nameSpan);
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
        if (isEmerg) {
            el.style.paddingRight = '0'; el.style.gap = '0';
            const badge = document.createElement('span');
            badge.className = 'sqk-badge';
            badge.textContent = props.squawk;
            const hasTypeBadge = props.military && props.t;
            badge.style.cssText = `background:#000;color:#ff2222 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px ${hasTypeBadge ? '0' : '8px'};`;
            el.appendChild(badge);
        }
        el.addEventListener('mouseenter', () => {
            const hoveredFeature = this._geojson.features.find(f => f.properties.hex === props.hex);
            if (hoveredFeature) this._showHoverTag(hoveredFeature, true);
        });
        el.addEventListener('mouseleave', () => this._hideHoverTag());
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectedHex = (props.hex === this._selectedHex) ? null : props.hex;
            this._hideHoverTag();
            this._applySelection();
        });
        return el;
    }

    setLabelsVisible(v: boolean): void {
        this.labelsVisible = v;
        if (!v) { this._clearCallsignMarkers(); }
        else    { this._updateCallsignMarkers(); }
    }

    private _updateCallsignMarkers(): void {
        if (!this.map || !this.labelsVisible) return;
        const features = this._geojson.features;
        const seen = new Set<string>();
        for (const f of features) {
            const hex = f.properties.hex;
            if (!hex) continue;
            seen.add(hex);
            const zoom     = this.map.getZoom();
            const isMil    = !!f.properties.military;
            const cat      = (f.properties.category || '').toUpperCase();
            const isGnd    = ['C1', 'C2'].includes(cat);
            const isTower  = ['C3', 'C4', 'C5'].includes(cat) || (f.properties.t || '').toUpperCase() === 'TWR';
            const iconVisible  = isGnd || isTower || (f.properties.alt_baro > 0) || (zoom >= 10);
            let typeVisible: boolean;
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
                if (this._callsignMarkers[hex]) { this._callsignMarkers[hex].remove(); delete this._callsignMarkers[hex]; }
                continue;
            }
            if (hex === this._selectedHex) {
                if (this._callsignMarkers[hex]) { this._callsignMarkers[hex].remove(); delete this._callsignMarkers[hex]; }
                continue;
            }
            const lngLat  = this._interpolatedCoords(hex) || f.geometry.coordinates;
            const pos2    = this._lastPositions[hex];
            const isDim   = pos2 ? (Date.now() - pos2.lastSeen) / 1000 >= 45 : false;
            if (this._callsignMarkers[hex]) {
                this._callsignMarkers[hex].setLngLat(lngLat);
                const labelEl = this._callsignMarkers[hex].getElement();
                const raw     = (f.properties.flight || '').trim() || (f.properties.r || '').trim() || f.properties.hex || '';
                const isEmerg = f.properties.squawkEmerg === 1;
                labelEl.style.background = isEmerg ? 'rgba(180,0,0,0.85)' : 'rgba(0,0,0,0.5)';
                labelEl.style.opacity    = isDim ? '0.3' : '1';
                const nameSpan = labelEl.querySelector('span:not(.sqk-badge):not(.mil-model-badge)') as HTMLElement || labelEl;
                nameSpan.textContent = raw || 'UNKNOWN';
                nameSpan.style.cssText = isDim ? 'color:rgba(255,255,255,0.45) !important' : 'color:#ffffff !important';
                if (f.properties.military) {
                    const isTracked = this._notifEnabled.has(hex);
                    const hasBadge  = !!f.properties.t;
                    if (hasBadge || isTracked) labelEl.style.paddingRight = '0';
                    else                        labelEl.style.paddingRight = '8px';
                    let modelBadge = labelEl.querySelector('.mil-model-badge') as HTMLElement | null;
                    if (hasBadge) {
                        if (!modelBadge) {
                            modelBadge = document.createElement('span');
                            modelBadge.className = 'mil-model-badge';
                            modelBadge.style.cssText = 'background:#4d6600;color:#c8ff00 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 5px;';
                            labelEl.insertBefore(modelBadge, labelEl.querySelector('.mil-trk-btn') || labelEl.querySelector('.sqk-badge') || null);
                        }
                        modelBadge.textContent = f.properties.t.toUpperCase();
                    } else if (modelBadge) { modelBadge.remove(); }
                    let trkBtn = labelEl.querySelector('.mil-trk-btn') as HTMLElement | null;
                    if (isTracked && !trkBtn) {
                        trkBtn = document.createElement('button');
                        trkBtn.className = 'mil-trk-btn';
                        trkBtn.textContent = 'TRACKING';
                        trkBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0 6px;color:#c8ff00;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:.1em;align-self:stretch;display:flex;align-items:center;white-space:nowrap;';
                        trkBtn.addEventListener('mouseenter', () => { (trkBtn as HTMLElement).textContent = 'UNTRACK'; });
                        trkBtn.addEventListener('mouseleave', () => { (trkBtn as HTMLElement).textContent = 'TRACKING'; });
                        trkBtn.addEventListener('click', (e) => { e.stopPropagation(); this._notifEnabled.delete(hex); this._updateCallsignMarkers(); });
                        labelEl.appendChild(trkBtn);
                    } else if (!isTracked && trkBtn) { trkBtn.remove(); }
                } else {
                    labelEl.querySelector('.mil-model-badge')?.remove();
                    labelEl.querySelector('.mil-trk-btn')?.remove();
                    if (!isEmerg) labelEl.style.paddingRight = '8px';
                }
                let badge = labelEl.querySelector('.sqk-badge') as HTMLElement | null;
                if (isEmerg) {
                    labelEl.style.paddingRight = '0'; labelEl.style.gap = '0';
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'sqk-badge';
                        badge.style.cssText = 'background:#000;color:#ff2222 !important;font-size:11px;font-weight:700;padding:0 6px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;margin:-1px 0 -1px 8px;';
                        labelEl.appendChild(badge);
                    }
                    badge.textContent = f.properties.squawk;
                } else if (badge) {
                    badge.remove(); labelEl.style.gap = '5px';
                    if (!labelEl.querySelector('.mil-model-badge') && !labelEl.querySelector('.mil-trk-btn')) {
                        labelEl.style.paddingRight = '8px';
                    }
                }
            } else {
                const labelEl = this._buildCallsignLabelEl(f.properties);
                if (isDim) {
                    labelEl.style.opacity = '0.3';
                    const nameSpan = labelEl.querySelector('span:not(.sqk-badge):not(.mil-model-badge)') as HTMLElement | null;
                    if (nameSpan) nameSpan.style.color = 'rgba(255,255,255,0.45)';
                }
                const marker = new maplibregl.Marker({ element: labelEl, anchor: 'left', offset: [14, 0] })
                    .setLngLat(lngLat).addTo(this.map);
                this._callsignMarkers[hex] = marker;
            }
        }
        for (const hex of Object.keys(this._callsignMarkers)) {
            if (!seen.has(hex)) { this._callsignMarkers[hex].remove(); delete this._callsignMarkers[hex]; }
        }
    }

    private _clearCallsignMarkers(): void {
        for (const marker of Object.values(this._callsignMarkers)) marker.remove();
        this._callsignMarkers = {};
    }

    // ---- Selection helpers ----

    _applySelection(): void {
        if (!this.map) return;
        this._applyTypeFilter();
        this._updateCallsignMarkers();
        if (this._selectedHex) {
            const selectedFeature = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
            this._showSelectedTag(selectedFeature || null);
        } else {
            this._hideSelectedTag();
            this._hideStatusBar();
        }
        this._rebuildTrails();
    }

    private _rebuildTrails(): void {
        const trailFeatures: TrailGeoFeature[] = [];
        if (this._selectedHex && this._trails[this._selectedHex]) {
            const points = this._trails[this._selectedHex];
            const pointCount = points.length;
            const selFeature = this._geojson.features.find(f => f.properties.hex === this._selectedHex);
            const isEmerg = selFeature && (
                selFeature.properties.squawkEmerg === 1 ||
                (selFeature.properties.emergency && selFeature.properties.emergency !== 'none')
            ) ? 1 : 0;
            for (let i = 0; i < pointCount; i++) {
                const trailPoint = points[i];
                trailFeatures.push({
                    type: 'Feature',
                    geometry:   { type: 'Point', coordinates: [trailPoint.lon, trailPoint.lat] },
                    properties: { alt: trailPoint.alt, opacity: (i + 1) / pointCount, emerg: isEmerg as 0 | 1 },
                });
            }
        }
        this._trailsGeojson = { type: 'FeatureCollection', features: trailFeatures };
        if (this.map && this.map.getSource('adsb-trails-source')) {
            (this.map.getSource('adsb-trails-source') as maplibregl.GeoJSONSource).setData(this._trailsGeojson as GeoJSON.GeoJSON);
        }
    }

    // ---- Position hold / stale removal ----

    private _deadReckon(lon: number, lat: number, trackDeg: number, gs: number, elapsedSec: number): [number, number] {
        const distNm  = gs * (elapsedSec / 3600);          // knots × hours = nm
        const angDist = distNm / 3440.065;                 // radians (Earth radius in nm)
        const bearRad = trackDeg * Math.PI / 180;
        const lat1    = lat * Math.PI / 180;
        const lon1    = lon * Math.PI / 180;
        const lat2    = Math.asin(
            Math.sin(lat1) * Math.cos(angDist) +
            Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearRad)
        );
        const lon2    = lon1 + Math.atan2(
            Math.sin(bearRad) * Math.sin(angDist) * Math.cos(lat1),
            Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
        );
        return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
    }

    private _interpolate(): void {
        if (!this.map || !this._geojson.features.length) return;
        const now = Date.now();
        const DIM_SEC = 45, REMOVE_SEC = 60;

        this._geojson.features = this._geojson.features.filter(f => {
            const pos = this._lastPositions[f.properties.hex];
            if (!pos) return true;
            const ageSec = (now - pos.lastSeen) / 1000;
            if (ageSec >= REMOVE_SEC) {
                const hex = f.properties.hex;
                if (hex && this._callsignMarkers[hex]) { this._callsignMarkers[hex].remove(); delete this._callsignMarkers[hex]; }
                delete this._lastPositions[hex];
                return false;
            }
            return true;
        });

        this._interpolatedFeatures = this._geojson.features.map(f => {
            const hex    = f.properties.hex;
            const pos    = this._lastPositions[hex];
            const ageSec = pos ? (now - pos.lastSeen) / 1000 : 0;
            let coords: [number, number];

            if (pos) {
                const elapsedSec = (now - pos.lastSeen) / 1000;
                if (pos.track != null && pos.gs > 0) {
                    // Dead-reckon forward from the last confirmed API fix on current heading.
                    // This runs continuously — no lerp window, no freeze, no backward jumps.
                    coords = this._deadReckon(pos.lon, pos.lat, pos.track, pos.gs, elapsedSec);
                } else {
                    // No speed/track data — hold at last known fix
                    coords = [pos.lon, pos.lat];
                }
            } else {
                coords = f.geometry.coordinates;
            }

            const stale = ageSec >= DIM_SEC ? 1 : 0;
            return { ...f, geometry: { type: 'Point' as const, coordinates: coords }, properties: { ...f.properties, stale } };
        });

        if (this.map.getSource('adsb-live')) {
            (this.map.getSource('adsb-live') as maplibregl.GeoJSONSource)
                .setData({ type: 'FeatureCollection', features: this._interpolatedFeatures } as GeoJSON.GeoJSON);
        }

        if (this._tagMarker && this._tagHex) {
            const interpolatedFeature = this._interpolatedFeatures.find(f => f.properties.hex === this._tagHex);
            if (interpolatedFeature) {
                this._tagMarker.setLngLat(interpolatedFeature.geometry.coordinates);
                if (this._followEnabled) {
                    const followPitch = typeof window._getTargetPitch === 'function' ? window._getTargetPitch() : 0;
                    this.map.easeTo({ center: interpolatedFeature.geometry.coordinates, pitch: followPitch, duration: 150, easing: t => t });
                }
            }
        }
        for (const f of this._interpolatedFeatures) {
            const hex = f.properties.hex;
            if (hex && this._callsignMarkers[hex]) this._callsignMarkers[hex].setLngLat(f.geometry.coordinates);
            if (hex && hex === this._hoverHex && this._hoverMarker) this._hoverMarker.setLngLat(f.geometry.coordinates);
        }
    }

    _interpolatedCoords(hex: string): [number, number] | null {
        if (this._interpolatedFeatures) {
            const interpolatedFeature = this._interpolatedFeatures.find(f => f.properties.hex === hex);
            if (interpolatedFeature) return interpolatedFeature.geometry.coordinates;
        }
        const aircraftFeature = this._geojson.features.find(f => f.properties.hex === hex);
        return aircraftFeature ? aircraftFeature.geometry.coordinates : null;
    }

    // ---- API fetch ----

    private async _fetch(): Promise<void> {
        if (!this.map || this._isFetching) return;
        this._isFetching = true;

        let lat: number | undefined, lon: number | undefined;
        const cached = localStorage.getItem('userLocation');
        if (cached) {
            try {
                const loc = JSON.parse(cached);
                if (Date.now() - (loc.ts || 0) < 10 * 60 * 1000) { lat = loc.latitude; lon = loc.longitude; }
            } catch(e) {}
        }
        if (lat === undefined) { const mapCenter = this.map.getCenter(); lat = mapCenter.lat; lon = mapCenter.lng; }

        try {
            const url  = `${origin}/api/air/adsb/point/${lat!.toFixed(4)}/${lon!.toFixed(4)}/250`;
            const resp = await fetch(url);
            if (!resp.ok) {
                if (resp.status === 429) {
                    this._isFetching = false; this._stopFetching();
                    setTimeout(() => { if (this.visible) this._startPolling(); }, 30000);
                    return;
                }
                // Transient error — don't clear planes immediately; interpolation will
                // fade and remove stale aircraft naturally. Only clear after 3 failures.
                this._fetchFailCount++;
                if (this._fetchFailCount >= 3) {
                    this._fetchFailCount = 0;
                    this._geojson = { type: 'FeatureCollection', features: [] };
                    this._lastPositions = {};
                    this._clearCallsignMarkers();
                    try { (this.map.getSource('adsb-live') as maplibregl.GeoJSONSource)
                        ?.setData(this._geojson as GeoJSON.GeoJSON); } catch(e) {}
                }
                this._isFetching = false; return;
            }
            this._fetchFailCount = 0;
            const data     = await resp.json();
            const aircraft = (data.ac || []) as AircraftApiEntry[];
            const seen     = new Set<string>();

            // Build a lookup of existing features so we can merge rather than replace.
            // Merging keeps aircraft visible between fetches (the API doesn't return every
            // aircraft every cycle) and avoids snapping positions back to raw API coords.
            const existingByHex = new Map<string, AircraftGeoFeature>();
            for (const f of this._geojson.features) {
                if (f.properties.hex) existingByHex.set(f.properties.hex, f);
            }

            const newFeatures: AircraftGeoFeature[] = [];

            for (const a of aircraft.filter(a => a.lat != null && a.lon != null && !['A0', 'B0', 'C0'].includes((a.category || '').toUpperCase()))) {
                const alt = this._parseAlt(a.alt_baro ?? null);
                const hex = a.hex || '';
                seen.add(hex);

                if (hex) {
                    if (!this._trails[hex]) this._trails[hex] = [];
                    const trail = this._trails[hex];
                    const last  = trail[trail.length - 1];
                    if (!last || last.lon !== a.lon || last.lat !== a.lat) {
                        trail.push({ lon: a.lon!, lat: a.lat!, alt });
                        if (trail.length > this._MAX_TRAIL) trail.shift();
                    }
                }

                if (hex) {
                    const lastSeen = Date.now();
                    const existing = this._lastPositions[hex];
                    if (!existing) {
                        this._lastPositions[hex] = { lon: a.lon!, lat: a.lat!, gs: a.gs ?? 0, track: a.track ?? null, lastSeen, prevLon: a.lon!, prevLat: a.lat!, prevSeen: lastSeen, interpLon: a.lon!, interpLat: a.lat! };
                    } else {
                        // Compute where the plane visually is right now (before updating the fix)
                        // and use that as the new dead-reckoning origin, so there is no backward jump.
                        const prevElapsed = (lastSeen - existing.lastSeen) / 1000;
                        const [curLon, curLat] = (existing.track != null && existing.gs > 0)
                            ? this._deadReckon(existing.lon, existing.lat, existing.track, existing.gs, prevElapsed)
                            : [existing.lon, existing.lat];
                        existing.lon      = curLon;
                        existing.lat      = curLat;
                        existing.gs       = a.gs ?? 0;
                        existing.track    = a.track ?? null;
                        existing.lastSeen = lastSeen;
                    }
                }

                if (hex) {
                    const prevAlt    = this._prevAlt[hex];
                    const gs         = a.gs ?? 0;
                    const justLanded = (prevAlt !== undefined && prevAlt > 0 && alt === 0);
                    if (justLanded) this._landedAt[hex] = Date.now();
                    if (alt === 0 && this._notifEnabled.has(hex)) this._seenOnGround[hex] = true;
                    const justDeparted = (
                        alt > 0 && gs > 0 &&
                        !this._hasDeparted[hex] &&
                        this._seenOnGround[hex] &&
                        this._notifEnabled.has(hex)
                    );
                    this._prevAlt[hex] = alt;
                    if (alt === 0) this._hasDeparted[hex] = false;

                    const _nearestAirport = (aLat: number, aLon: number) => {
                        let best: AirportProperties | null = null, bestDist = Infinity;
                        for (const f of AIRPORTS_DATA.features) {
                            const [fLon, fLat] = f.geometry.coordinates;
                            const dLat = (aLat - fLat) * Math.PI / 180;
                            const dLon = (aLon - fLon) * Math.PI / 180;
                            const a2 = Math.sin(dLat/2)**2 + Math.cos(fLat * Math.PI/180) * Math.cos(aLat * Math.PI/180) * Math.sin(dLon/2)**2;
                            const dist = 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
                            if (dist < bestDist) { bestDist = dist; best = f.properties; }
                        }
                        return best;
                    };

                    if (justDeparted) {
                        this._hasDeparted[hex] = true;
                        const callsign = (a.flight || '').trim() || (a.r || '').trim();
                        const apt      = _nearestAirport(a.lat!, a.lon!);
                        window._Notifications.add({ type: 'departure', title: callsign, ...(apt ? { detail: `${apt.name} (${apt.icao})` } : {}) });
                    }

                    if (justLanded && this._notifEnabled.has(hex)) {
                        const callsign = (a.flight || '').trim() || (a.r || '').trim();
                        const apt      = _nearestAirport(a.lat!, a.lon!);
                        window._Notifications.add({ type: 'flight', title: callsign, ...(apt ? { detail: `${apt.name} (${apt.icao})` } : {}) });
                        if (this._parkedTimers[hex]) clearTimeout(this._parkedTimers[hex]);
                        this._parkedTimers[hex] = setTimeout(() => {
                            delete this._parkedTimers[hex]; delete this._prevAlt[hex];
                            delete this._hasDeparted[hex]; delete this._trails[hex];
                            delete this._lastPositions[hex];
                            this._geojson = { type: 'FeatureCollection', features: this._geojson.features.filter(f => f.properties.hex !== hex) };
                            if (this._interpolatedFeatures) this._interpolatedFeatures = this._interpolatedFeatures.filter(f => f.properties.hex !== hex);
                            if (this._callsignMarkers[hex]) { this._callsignMarkers[hex].remove(); delete this._callsignMarkers[hex]; }
                            if (this._selectedHex === hex) {
                                this._selectedHex = null; this._followEnabled = false;
                                this._hideSelectedTag(); this._hideStatusBar();
                            }
                            this._rebuildTrails(); this._interpolate();
                        }, 60 * 1000);
                    }
                    if (alt > 0 && this._parkedTimers[hex]) { clearTimeout(this._parkedTimers[hex]); delete this._parkedTimers[hex]; }
                }

                const gs     = a.gs ?? 0;
                const hexInt = parseInt(hex, 16);
                const military = a.t !== 'LAAD'
                    && (a.military === true
                    || (hexInt >= 0x43C000 && hexInt <= 0x43FFFF)
                    || (hexInt >= 0xAE0000 && hexInt <= 0xAFFFFF));

                const coords = [a.lon!, a.lat!] as [number, number];

                newFeatures.push({
                    type: 'Feature' as const,
                    geometry:   { type: 'Point' as const, coordinates: coords },
                    properties: {
                        hex, flight: (a.flight || '').trim(), r: a.r || '', t: a.t || '',
                        alt_baro: alt, alt_geom: a.alt_geom ?? null, gs,
                        ias: a.ias ?? null, mach: a.mach ?? null,
                        track: a.track ?? 0, baro_rate: a.baro_rate ?? 0,
                        nav_altitude: a.nav_altitude_mcp ?? a.nav_altitude_fms ?? null,
                        nav_heading: a.nav_heading ?? null,
                        category: (a.category || '').toUpperCase(),
                        emergency: a.emergency || '', squawk: a.squawk || '',
                        squawkEmerg: this._emergencySquawks.has(a.squawk || '') ? 1 : 0,
                        rssi: a.rssi ?? null, military,
                        stale: 0,
                    } as AircraftProperties,
                });
                existingByHex.delete(hex);
            }

            // Keep aircraft that weren't in this response — _interpolate() will age them out
            // after REMOVE_SEC (60s). Don't delete them just because one fetch missed them.
            for (const [, f] of existingByHex) {
                if (this._lastPositions[f.properties.hex]) newFeatures.push(f);
            }

            this._geojson = { type: 'FeatureCollection', features: newFeatures };
            document.dispatchEvent(new CustomEvent('adsb-data-update'));

            // Only clean up state for aircraft whose _lastPositions have fully expired
            // (i.e. already removed by _interpolate). Don't wipe data for aircraft that
            // simply weren't in this particular response.
            for (const hex of Object.keys(this._prevAlt))    { if (!seen.has(hex) && !this._parkedTimers[hex] && !this._lastPositions[hex]) delete this._prevAlt[hex]; }
            for (const hex of Object.keys(this._hasDeparted)){ if (!seen.has(hex) && !this._lastPositions[hex]) delete this._hasDeparted[hex]; }
            for (const hex of Object.keys(this._prevSquawk)) { if (!seen.has(hex) && !this._lastPositions[hex]) delete this._prevSquawk[hex]; }

            for (const f of this._geojson.features) {
                const props  = f.properties;
                const hex    = props.hex;
                if (!hex) continue;
                const squawk  = props.squawk || '';
                const prev    = this._prevSquawk[hex];
                const isEmerg  = this._emergencySquawks.has(squawk);
                const wasEmerg = prev !== undefined && this._emergencySquawks.has(prev);
                if (squawk !== prev) {
                    if (isEmerg) {
                        const callsign = (props.flight || '').trim() || (props.r || '').trim() || hex;
                        const squawkLabels: Record<string, string> = { '7700': 'General Emergency', '7600': 'Radio Failure / Lost Comm', '7500': 'Hijacking / Unlawful Interference' };
                        const now2 = new Date();
                        const detail = [
                            `SQK ${squawk} — ${squawkLabels[squawk] || 'Emergency'}`,
                            props.alt_baro > 0 ? `ALT ${props.alt_baro.toLocaleString()} ft` : 'ON GROUND',
                            props.gs ? `GS ${Math.round(props.gs)} kt` : '',
                        ].filter(Boolean).join(' · ') +
                        `\n${now2.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}  ${now2.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
                        const coords = f.geometry.coordinates;
                        window._Notifications.add({ type: 'emergency', title: callsign, detail,
                            clickAction: () => { if (this.map) this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 9) }); },
                        });
                    } else if (wasEmerg) {
                        const callsign = (props.flight || '').trim() || (props.r || '').trim() || hex;
                        const now2 = new Date();
                        window._Notifications.add({ type: 'squawk-clr', title: callsign,
                            detail: `Squawk changed to ${squawk || '(none)'}  ·  ${now2.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}  ${now2.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`,
                        });
                    }
                    this._prevSquawk[hex] = squawk;
                }
            }

            this._lastFetchTime = Date.now();
            this._restoreTrackingState();
            this._rebuildTrails();
            if (this._tagHex && this._tagMarker) {
                const taggedFeature = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (taggedFeature) {
                    this._tagMarker.getElement().innerHTML = this._buildTagHTML(taggedFeature.properties);
                    this._wireTagButton(this._tagMarker.getElement());
                    this._updateStatusBar();
                } else { this._hideSelectedTag(); this._hideStatusBar(); }
            }
            this._updateCallsignMarkers();
            this._interpolate();
            this._raiseLayers();
            this._fetchFailCount = 0;

        } catch(e) {
            this._fetchFailCount++;
            if (this._fetchFailCount >= 3) {
                this._fetchFailCount = 0; this._isFetching = false; this._stopFetching();
                setTimeout(() => { if (this.visible) this._startPolling(); }, 30000);
                return;
            }
            console.warn('ADS-B fetch error:', e);
        } finally {
            this._isFetching = false;
        }
    }

    // ---- Layer z-order ----

    private _raiseLayers(): void {
        if (!this.map) return;
        ['adsb-trails', 'adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.moveLayer(id); } catch(e) {}
        });
    }

    // ---- Tracking state persistence ----

    private _saveTrackingState(): void {
        try {
            const activeHex = this._tagHex || (this._followEnabled ? this._selectedHex : null);
            if (activeHex && this._followEnabled) {
                const prevHex = (() => { try { return JSON.parse(localStorage.getItem('adsbTracking') || '{}').hex; } catch(e) { return null; } })();
                if (prevHex && prevHex !== activeHex) {
                    fetch(`/api/air/tracking/${encodeURIComponent(prevHex)}`, { method: 'DELETE' }).catch(() => {});
                }
                localStorage.setItem('adsbTracking', JSON.stringify({ hex: activeHex }));
                const f        = this._geojson.features.find(f => f.properties.hex === activeHex);
                const callsign = f ? ((f.properties.flight || '').trim() || (f.properties.r || '').trim() || '') : '';
                fetch('/api/air/tracking', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hex: activeHex, callsign, follow: true }),
                }).catch(() => {});
            } else {
                const prevHex = (() => { try { return JSON.parse(localStorage.getItem('adsbTracking') || '{}').hex; } catch(e) { return null; } })();
                localStorage.removeItem('adsbTracking');
                if (prevHex) fetch(`/api/air/tracking/${encodeURIComponent(prevHex)}`, { method: 'DELETE' }).catch(() => {});
            }
        } catch(e) {}
    }

    private _restoreTrackingState(): void {
        if (this._trackingRestored) return;
        this._trackingRestored = true;
        fetch('/api/air/tracking')
            .then(r => r.ok ? r.json() : [])
            .then((rows: { hex: string; follow: boolean }[]) => {
                const tracked = rows.find(r => r.follow);
                if (tracked) localStorage.setItem('adsbTracking', JSON.stringify({ hex: tracked.hex }));
                if (!this._doRestoreTracking()) this._trackingRestored = false;
            })
            .catch(() => { if (!this._doRestoreTracking()) this._trackingRestored = false; });
    }

    private _doRestoreTracking(): boolean {
        try {
            const saved = localStorage.getItem('adsbTracking');
            if (!saved) return true; // nothing to restore, consider done
            const { hex } = JSON.parse(saved);
            if (!hex) return true;
            const aircraftFeature = this._geojson.features.find(f => f.properties.hex === hex);
            if (!aircraftFeature) return false; // aircraft not yet in data — retry next fetch
            this._selectedHex = hex;
            this._applySelection();
            this._followEnabled = true;
            this._saveTrackingState();
            this._notifEnabled.add(hex);
            try {
                const persisted = JSON.parse(localStorage.getItem('notifications') || '[]');
                if (!this._trackingNotifIds) this._trackingNotifIds = {};
                const restoredIds: string[] = [];
                for (const item of persisted) {
                    if (item.type === 'tracking') {
                        this._trackingNotifIds[hex] = item.id;
                        window._Notifications.update({ id: item.id, action: {
                            label: 'DISABLE NOTIFICATIONS',
                            callback: () => {
                                this._notifEnabled.delete(hex);
                                if (this._trackingNotifIds) delete this._trackingNotifIds[hex];
                                this._rebuildTagForHex(hex);
                            },
                        }});
                        restoredIds.push(item.id);
                    }
                }
                if (restoredIds.length) window._Notifications.render(restoredIds);
            } catch(e) {}
            const coords = this._interpolatedCoords(hex) || f.geometry.coordinates;
            const newEl  = document.createElement('div');
            newEl.innerHTML = this._buildTagHTML(f.properties);
            this._wireTagButton(newEl);
            if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
            this._tagMarker = new maplibregl.Marker({ element: newEl, anchor: 'left', offset: [14, 0] })
                .setLngLat(coords).addTo(this.map);
            this._tagHex = hex;
            this._showStatusBar(f.properties);
            const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
            this.map.easeTo({ center: f.geometry.coordinates, zoom: 16, ...(is3D ? { pitch: 45 } : {}), duration: 600 });
            return true;
        } catch(e) { return false; }
    }

    // ---- Polling control ----

    private _startPolling(): void {
        if (this._pollInterval) return;
        if (Date.now() - this._lastFetchTime > 4000) this._fetch();
        this._pollInterval = setInterval(() => this._fetch(), 5000);
        if (!this._interpolateInterval) {
            this._interpolateInterval = setInterval(() => this._interpolate(), 100);
        }
    }

    private _stopPolling(): void {
        if (this._pollInterval)        { clearInterval(this._pollInterval);        this._pollInterval        = null; }
        if (this._interpolateInterval) { clearInterval(this._interpolateInterval); this._interpolateInterval = null; }
    }

    private _stopFetching(): void {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    }

    // ---- Visibility toggle ----

    toggle(): void {
        this.visible = !this.visible;
        if (this.visible) {
            this._startPolling();
        } else {
            this._stopPolling();
            this._selectedHex   = null;
            this._followEnabled = false;
            this._hideSelectedTag();
            this._hideHoverTag();
            this._hideStatusBar();
            for (const [hex, marker] of Object.entries(this._callsignMarkers)) {
                const aircraftFeature = this._geojson.features.find(f => f.properties.hex === hex);
                if (!aircraftFeature) continue;
                const cat     = (aircraftFeature.properties.category || '').toUpperCase();
                const isGnd   = ['C1', 'C2'].includes(cat);
                const isTower = ['C3', 'C4', 'C5'].includes(cat) || (aircraftFeature.properties.t || '').toUpperCase() === 'TWR';
                if (!isGnd && !isTower) { marker.remove(); delete this._callsignMarkers[hex]; }
            }
        }
        try { this.map.setLayoutProperty('adsb-trails', 'visibility', this.visible ? 'visible' : 'none'); } catch(e) {}
        this._applyTypeFilter();
        this.button.style.opacity = this.visible ? '1'       : '0.3';
        this.button.style.color   = this.visible ? '#c8ff00' : '#ffffff';
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(this.visible);
        _saveOverlayStates();
    }
}

// Instantiate and register with MapLibre.
adsbControl = new AdsbLiveControl();
map.addControl(adsbControl, 'top-right');

// Returns the effective mode for the 'air' domain by checking its sourceOverride,
// falling back to the app-level connectivityMode.
function _airEffectiveMode(): string {
    try {
        const override = localStorage.getItem('sentinel_air_sourceOverride') || 'auto';
        if (override !== 'auto') return override;
        return localStorage.getItem('sentinel_app_connectivityMode') || 'auto';
    } catch(e) { return 'auto'; }
}

// Clear aircraft immediately when switching to offline mode.
function _clearAdsbAircraft(): void {
    adsbControl['_stopPolling']();
    // Cancel pending timers.
    if (adsbControl['_hoverHideTimer']) { clearTimeout(adsbControl['_hoverHideTimer']); adsbControl['_hoverHideTimer'] = null; }
    for (const t of Object.values(adsbControl['_parkedTimers'] as Record<string, ReturnType<typeof setTimeout>>)) clearTimeout(t);
    adsbControl['_parkedTimers'] = {};
    // Remove all DOM markers.
    adsbControl['_clearCallsignMarkers']();
    adsbControl['_hideHoverTagNow']();
    if (adsbControl['_tagMarker']) { adsbControl['_tagMarker'].remove(); adsbControl['_tagMarker'] = null; }
    adsbControl['_tagHex'] = null;
    adsbControl['_hideStatusBar']();
    // Reset selection/tracking state.
    adsbControl['_selectedHex'] = null;
    adsbControl['_followEnabled'] = false;
    // Clear all aircraft data.
    adsbControl['_geojson'] = { type: 'FeatureCollection', features: [] };
    adsbControl['_trailsGeojson'] = { type: 'FeatureCollection', features: [] };
    adsbControl['_trails'] = {};
    adsbControl['_lastPositions'] = {};
    adsbControl['_interpolatedFeatures'] = [];
    adsbControl['_prevAlt'] = {};
    adsbControl['_hasDeparted'] = {};
    adsbControl['_seenOnGround'] = {};
    adsbControl['_landedAt'] = {};
    adsbControl['_prevSquawk'] = {};
    try { (map.getSource('adsb-live') as maplibregl.GeoJSONSource)?.setData(adsbControl['_geojson'] as GeoJSON.GeoJSON); } catch(e) {}
    try { (map.getSource('adsb-trails-source') as maplibregl.GeoJSONSource)?.setData(adsbControl['_trailsGeojson'] as GeoJSON.GeoJSON); } catch(e) {}
}

function _handleAirConnectivityChange(): void {
    const mode = _airEffectiveMode();
    if (mode === 'offgrid') {
        _clearAdsbAircraft();
    } else if (adsbControl.visible) {
        adsbControl['_stopPolling']();
        adsbControl['_startPolling']();
    }
}

window.addEventListener('sentinel:connectivityModeChanged', _handleAirConnectivityChange);
window.addEventListener('sentinel:sourceOverrideChanged', _handleAirConnectivityChange);


