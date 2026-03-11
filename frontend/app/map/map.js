// ============================================================
// MAP — Shared map component
// Initialises MapLibre GL, handles online/offline style switching,
// and provides geometry helpers used by overlay controls.
//
// Exposes window.MapComponent:
//   map           — the MapLibre GL Map instance
//   onStyleLoad   — register a callback to run after every style.load
//   isOnline()    — current connectivity state
//
// Usage on section pages (loaded before section-specific scripts):
//   <script src="./assets/pmtiles.js"></script>
//   <script src="./assets/maplibre-gl.js"></script>
//   <script src="./frontend/app/map/map.js"></script>
//
// NOTE: On index.html, map.js is NOT loaded — the map init and all
// overlay re-init logic remains in main.js. Map.js is for new
// section pages that need a clean map without the AIR overlays.
// ============================================================

// ---- PMTiles protocol ----
const _pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', _pmtilesProtocol.tile.bind(_pmtilesProtocol));

// ============================================================
// CONNECTIVITY DETECTION
// Polls real internet connectivity independently of navigator.onLine.
// Drives map style switching (online/offline) and fires notifications.
// ============================================================

const _mapIsOnline = navigator.onLine;
let _mapConnState = _mapIsOnline;
const _OFFLINE_BOUNDS = [[-20, 44], [32, 67]];

/**
 * Update the footer connection-status pill.
 * @param {boolean} online
 */
function _mapSetConnStatus(online) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className = online ? 'conn-online' : 'conn-offline';
    el.textContent = online ? '● ONLINE' : '● OFFLINE';
}
_mapSetConnStatus(_mapIsOnline);

/**
 * TransformStyleFunction passed to map.setStyle().
 * Rewrites root-relative sprite/glyphs paths to absolute URLs.
 */
function _mapTransformStyle(_prev, next) {
    const o = window.location.origin;
    if (next.sprite && next.sprite.startsWith('/')) next.sprite = o + next.sprite;
    if (next.glyphs  && next.glyphs.startsWith('/'))  next.glyphs  = o + next.glyphs;
    return next;
}

/**
 * Switch the MapLibre style between online and offline.
 * @param {boolean} online
 */
function _mapSwitchStyle(online) {
    if (typeof _sentinelMap === 'undefined') return;
    _sentinelMap.setMinZoom(online ? 2 : 5);
    _sentinelMap.setMaxBounds(online ? null : _OFFLINE_BOUNDS);
    _sentinelMap.setStyle(
        online
            ? `${window.location.origin}/assets/fiord-online.json`
            : `${window.location.origin}/assets/fiord.json`,
        { transformStyle: _mapTransformStyle }
    );
}

/**
 * Poll OSM favicon to detect real internet connectivity.
 * Fires every 2s via setInterval and immediately on page load.
 */
function _mapCheckConn() {
    fetch('https://tile.openstreetmap.org/favicon.ico', { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
        .then(() => {
            if (!_mapConnState) {
                _mapConnState = true;
                _mapSetConnStatus(true);
                _mapSwitchStyle(true);
                if (typeof _Notifications !== 'undefined') {
                    _Notifications.add({ type: 'system', title: 'ONLINE', detail: 'Connection restored' });
                }
            }
        })
        .catch(() => {
            if (_mapConnState) {
                _mapConnState = false;
                _mapSetConnStatus(false);
                _mapSwitchStyle(false);
                if (typeof _Notifications !== 'undefined') {
                    _Notifications.add({ type: 'system', title: 'OFFLINE', detail: 'Connection lost' });
                }
            }
        });
}
_mapCheckConn();
setInterval(_mapCheckConn, 2000);

window.addEventListener('online',  () => { _mapConnState = true;  _mapSetConnStatus(true);  _mapSwitchStyle(true); });
window.addEventListener('offline', () => { _mapConnState = false; _mapSetConnStatus(false); _mapSwitchStyle(false); });


// ============================================================
// GEOMETRY HELPERS
// Pure math utilities for geodesic range rings and polygon labels.
// ============================================================

const RING_DISTANCES_NM = [50, 100, 150, 200, 250];

function _toRad(deg) { return deg * Math.PI / 180; }
function _toDeg(rad) { return rad * 180 / Math.PI; }

/**
 * Generate 181 geodesic points forming a great-circle around a centre.
 * @param {number} lng @param {number} lat @param {number} radiusNm
 * @returns {[number, number][]}
 */
function generateGeodesicCircle(lng, lat, radiusNm) {
    const d = radiusNm / 3440.065;
    const latR = _toRad(lat);
    const lngR = _toRad(lng);
    const pts = [];
    for (let i = 0; i <= 180; i++) {
        const b = _toRad(i * 2);
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(b));
        const lng2 = lngR + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat2));
        pts.push([_toDeg(lng2), _toDeg(lat2)]);
    }
    return pts;
}

/**
 * Build GeoJSON FeatureCollections for 5 range rings (50–250 nm) and their north-point labels.
 * @param {number} lng @param {number} lat
 * @returns {{ lines: FeatureCollection, labels: FeatureCollection }}
 */
function buildRingsGeoJSON(lng, lat) {
    const lines = { type: 'FeatureCollection', features: [] };
    const labels = { type: 'FeatureCollection', features: [] };
    const latR = _toRad(lat);
    const lngR = _toRad(lng);
    RING_DISTANCES_NM.forEach(nm => {
        const d = nm / 3440.065;
        lines.features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: generateGeodesicCircle(lng, lat, nm) },
            properties: {}
        });
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d));
        labels.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [_toDeg(lngR), _toDeg(lat2)] },
            properties: { label: nm + ' nm' }
        });
    });
    return { lines, labels };
}

/**
 * Compute the area-weighted centroid of a GeoJSON polygon ring (shoelace formula).
 * @param {number[][][]} coordinates @returns {[number, number]} [lng, lat]
 */
function computeCentroid(coordinates) {
    const ring = coordinates[0];
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const x0 = ring[i][0],     y0 = ring[i][1];
        const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx   += (x0 + x1) * cross;
        cy   += (y0 + y1) * cross;
    }
    area *= 0.5;
    return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Compute the MapLibre text-rotate angle aligned with the longest edge of a polygon.
 * @param {number[][][]} coordinates @returns {number} degrees
 */
function computeTextRotate(coordinates) {
    const ring = coordinates[0];
    let maxLen = -1, bearing = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
            bearing = Math.atan2(dLng * Math.cos(midLat * Math.PI / 180), dLat) * 180 / Math.PI;
        }
    }
    let rot = bearing - 90;
    if (rot >  90) rot -= 180;
    if (rot <= -90) rot += 180;
    return Math.round(rot * 10) / 10;
}

/**
 * Find the two endpoints of the longest edge of a polygon ring.
 * @param {number[][][]} coordinates @returns {[[number,number],[number,number]]}
 */
function computeLongestEdge(coordinates) {
    const ring = coordinates[0];
    let maxLen = -1, p0 = ring[0], p1 = ring[1];
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) { maxLen = len; p0 = ring[i]; p1 = ring[i + 1]; }
    }
    return [p0, p1];
}


// ============================================================
// MAP INITIALISATION
// ============================================================

const _mapOrigin = window.location.origin;
const _mapStyleURL = _mapIsOnline
    ? `${_mapOrigin}/assets/fiord-online.json`
    : `${_mapOrigin}/assets/fiord.json`;

const _sentinelMap = new maplibregl.Map({
    container: 'map',
    style: { version: 8, sources: {}, layers: [] }, // blank stub; real style applied below
    center: _mapIsOnline ? [-4.4815, 54.1453] : [-4.5481, 54.2361],
    zoom: _mapIsOnline ? 6 : 5,
    minZoom: _mapIsOnline ? 2 : 5,
    maxBounds: _mapIsOnline ? null : _OFFLINE_BOUNDS,
    attributionControl: false,
    fadeDuration: 0,
    cooperativeGestures: false,
    transformRequest: (url) => ({ url: url.startsWith('/') ? _mapOrigin + url : url })
});
_sentinelMap.scrollZoom.enable();
_sentinelMap.setStyle(_mapStyleURL, { transformStyle: _mapTransformStyle });

// ---- style.load handler registration ----
// Overlay controls register callbacks via MapComponent.onStyleLoad(fn).
// This decouples map.js from knowing which overlay controls exist.
const _styleLoadHandlers = [];
let _mapStyleLoadedOnce = false;

_sentinelMap.on('style.load', () => {
    _sentinelMap.setMinZoom(_mapConnState ? 2 : 5);
    _sentinelMap.setMaxBounds(_mapConnState ? null : _OFFLINE_BOUNDS);

    // City/town label zoom filtering
    const majorCities = [
        'Newcastle upon Tyne', 'Sunderland', 'Scarborough', 'Carlisle',
        'Edinburgh', 'Glasgow', 'Stranraer', 'Dumfries',
        'Belfast', 'Derry/Londonderry', 'Dublin',
        'Liverpool', 'Manchester', 'Preston', 'Birmingham', 'London',
        'York', 'Leeds', 'Plymouth', 'Inverness', 'Aberdeen',
        'Stirling', 'Dundee', 'Norwich', 'Armagh', 'Dungannon'
    ];

    function _updateCityFilter() {
        const zoom = _sentinelMap.getZoom();
        try {
            const classExpr = ['coalesce', ['get', 'class'], ['get', 'kind_detail'], ['get', 'kind']];
            if (zoom >= 7) {
                const cityMatch = ['match', ['get', 'name'], ...majorCities.flatMap(c => [c, true]), false];
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false], cityMatch]);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false], cityMatch]);
            } else {
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false]]);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false]]);
            }
        } catch (e) { /* layer may not exist in all styles */ }
    }

    _updateCityFilter();
    _sentinelMap.on('zoom', _updateCityFilter);

    // Fire registered overlay re-init callbacks (skip on very first load)
    if (_mapStyleLoadedOnce) {
        _styleLoadHandlers.forEach(fn => { try { fn(); } catch (e) { console.error('style.load handler error:', e); } });
    }
    _mapStyleLoadedOnce = true;
});

_sentinelMap.on('error', (e) => {
    const msg = e?.error?.message || '';
    if (msg.includes('Cannot remove non-existing layer') ||
        msg.includes('Cannot style non-existing layer') ||
        msg.includes('does not exist in the map')) return;
    console.error('Map error:', e);
});

_sentinelMap.on('styleimagemissing', () => {});


// ============================================================
// PUBLIC API
// window.MapComponent exposes the map and the style.load hook
// to overlay controls and section-specific scripts.
// ============================================================
window.MapComponent = {
    /** The MapLibre GL Map instance */
    map: _sentinelMap,

    /**
     * Register a callback to be fired after every style reload
     * (i.e. on each call to map.setStyle()). Use this to re-init
     * overlay layers after a style switch.
     * @param {function} fn - callback with no arguments
     */
    onStyleLoad: function (fn) { _styleLoadHandlers.push(fn); },

    /** @returns {boolean} Current connectivity state */
    isOnline: function () { return _mapConnState; },

    // Geometry helpers available to overlay controls
    generateGeodesicCircle,
    buildRingsGeoJSON,
    computeCentroid,
    computeTextRotate,
    computeLongestEdge,
    RING_DISTANCES_NM,
};
