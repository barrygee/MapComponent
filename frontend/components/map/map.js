// ============================================================
// MAP COMPONENT
// Initialises MapLibre GL, handles online/offline style switching,
// and provides geometry helpers used by overlay controls.
//
// Exposes window.MapComponent:
//   map                  — the MapLibre GL Map instance
//   onStyleLoad(fn)      — register a callback to run after every style reload
//   isOnline()           — returns current connectivity state (boolean)
//   buildRingsGeoJSON    — builds GeoJSON for 50–250 nm range rings
//   generateGeodesicCircle — generates a single geodesic ring of points
//   computeCentroid      — area-weighted centroid of a GeoJSON polygon ring
//   computeTextRotate    — bearing aligned to the polygon's longest edge
//   computeLongestEdge   — endpoints of the polygon's longest edge
//   RING_DISTANCES_NM    — [50, 100, 150, 200, 250]
// ============================================================

// Register the PMTiles protocol so MapLibre can load local .pmtiles tile archives
const _pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', _pmtilesProtocol.tile.bind(_pmtilesProtocol));

// ============================================================
// CONNECTIVITY DETECTION
// Polls a real HTTP endpoint every 2 s to test actual internet
// access (navigator.onLine can stay true on a captive portal).
// On change: updates the footer pill, switches map style, notifies.
// ============================================================

// Seed connectivity state from the browser's best guess on page load
const _mapIsOnline  = navigator.onLine;
let   _mapConnState = _mapIsOnline;

// Viewport bounds used for the offline (PMTiles) style — covers UK/Ireland/Europe
const _OFFLINE_BOUNDS = [[-20, 44], [32, 67]];

/**
 * Update the footer connection-status pill text and colour class.
 * @param {boolean} online
 */
function _updateConnStatusPill(online) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className  = online ? 'conn-online' : 'conn-offline';
    el.textContent = online ? '● ONLINE' : '● OFFLINE';
}
_updateConnStatusPill(_mapIsOnline); // set pill immediately on load

/**
 * TransformStyleFunction passed to map.setStyle().
 * Rewrites root-relative sprite/glyphs paths to absolute origin URLs
 * so they work regardless of how the app is served.
 * @param {object} _prev - previous style (unused)
 * @param {object} next  - incoming style object (mutated in-place)
 * @returns {object} the (possibly modified) next style
 */
function _fixStylePaths(_prev, next) {
    const origin = window.location.origin;
    if (next.sprite && next.sprite.startsWith('/')) next.sprite = origin + next.sprite;
    if (next.glyphs  && next.glyphs.startsWith('/'))  next.glyphs  = origin + next.glyphs;
    return next;
}

/**
 * Switch the MapLibre base style between the online (OSM tiles) and offline (PMTiles) versions.
 * Also adjusts minZoom and maxBounds to reflect the available tile data.
 * @param {boolean} online
 */
function _switchMapStyle(online) {
    if (typeof _sentinelMap === 'undefined') return;
    _sentinelMap.setMinZoom(online ? 2 : 5);                     // offline tiles only cover from zoom 5
    _sentinelMap.setMaxBounds(online ? null : _OFFLINE_BOUNDS);  // constrain pan when offline
    _sentinelMap.setStyle(
        online
            ? `${window.location.origin}/assets/fiord-online.json`
            : `${window.location.origin}/assets/fiord.json`,
        { transformStyle: _fixStylePaths },
    );
}

/**
 * Poll OSM to detect real internet access.
 * Uses a HEAD request with no-cors so the fetch resolves (not rejects)
 * even without a CORS header — any response means we're online.
 * Fires every 2 s via setInterval; also called once immediately on load.
 */
function _checkInternetConnection() {
    fetch('https://tile.openstreetmap.org/favicon.ico', { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
        .then(() => {
            if (!_mapConnState) {
                // Came back online — update state, pill, style, and notify
                _mapConnState = true;
                _updateConnStatusPill(true);
                _switchMapStyle(true);
                if (typeof _Notifications !== 'undefined') {
                    _Notifications.add({ type: 'system', title: 'ONLINE', detail: 'Connection restored' });
                }
            }
        })
        .catch(() => {
            if (_mapConnState) {
                // Went offline — update state, pill, style, and notify
                _mapConnState = false;
                _updateConnStatusPill(false);
                _switchMapStyle(false);
                if (typeof _Notifications !== 'undefined') {
                    _Notifications.add({ type: 'system', title: 'OFFLINE', detail: 'Connection lost' });
                }
            }
        });
}

_checkInternetConnection();                           // run once immediately
setInterval(_checkInternetConnection, 2000);          // then every 2 s

// Also react to browser-level online/offline events as a fast-path
window.addEventListener('online',  () => { _mapConnState = true;  _updateConnStatusPill(true);  _switchMapStyle(true); });
window.addEventListener('offline', () => { _mapConnState = false; _updateConnStatusPill(false); _switchMapStyle(false); });


// ============================================================
// GEOMETRY HELPERS
// Pure math functions for geodesic range rings and polygon labels.
// All exposed on window.MapComponent for use by overlay controls.
// ============================================================

// Nautical-mile distances used for the five range rings
const RING_DISTANCES_NM = [50, 100, 150, 200, 250];

// Degree ↔ radian conversion helpers
function _toRad(deg) { return deg * Math.PI / 180; }
function _toDeg(rad) { return rad * 180 / Math.PI; }

/**
 * Generate 181 geodesic (great-circle) points forming a circle on the Earth's surface.
 * Used to draw accurate range rings that curve with the Earth.
 * @param {number} lng         Centre longitude (degrees)
 * @param {number} lat         Centre latitude (degrees)
 * @param {number} radiusNm    Radius in nautical miles
 * @returns {[number, number][]}  Array of [lng, lat] coordinate pairs
 */
function generateGeodesicCircle(lng, lat, radiusNm) {
    const d    = radiusNm / 3440.065; // convert nm to radians (Earth radius ≈ 3440.065 nm)
    const latR = _toRad(lat);
    const lngR = _toRad(lng);
    const pts  = [];
    for (let i = 0; i <= 180; i++) {
        const b    = _toRad(i * 2); // bearing stepping 0°→360° in 2° increments
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(b));
        const lng2 = lngR + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat2));
        pts.push([_toDeg(lng2), _toDeg(lat2)]);
    }
    return pts;
}

/**
 * Build GeoJSON FeatureCollections for all 5 range rings (50–250 nm) plus north-point labels.
 * @param {number} lng  Centre longitude
 * @param {number} lat  Centre latitude
 * @returns {{ lines: FeatureCollection, labels: FeatureCollection }}
 */
function buildRingsGeoJSON(lng, lat) {
    const lines  = { type: 'FeatureCollection', features: [] };
    const labels = { type: 'FeatureCollection', features: [] };
    const latR   = _toRad(lat);
    const lngR   = _toRad(lng);

    RING_DISTANCES_NM.forEach(nm => {
        const d = nm / 3440.065; // nm → radians

        // LineString ring for this distance
        lines.features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: generateGeodesicCircle(lng, lat, nm) },
            properties: {},
        });

        // Point label placed at the true north intercept of the ring
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d));
        labels.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [_toDeg(lngR), _toDeg(lat2)] },
            properties: { label: nm + ' nm' },
        });
    });

    return { lines, labels };
}

/**
 * Compute the area-weighted centroid of a GeoJSON polygon ring (shoelace formula).
 * Used to place AARA / AWACS zone labels at the visual centre of each polygon.
 * @param {number[][][]} coordinates  GeoJSON polygon coordinates array
 * @returns {[number, number]}         [lng, lat] centroid
 */
function computeCentroid(coordinates) {
    const ring = coordinates[0]; // outer ring only
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const x0 = ring[i][0],     y0 = ring[i][1];
        const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
        const cross = x0 * y1 - x1 * y0; // shoelace cross-product term
        area += cross;
        cx   += (x0 + x1) * cross;
        cy   += (y0 + y1) * cross;
    }
    area *= 0.5;
    return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Compute the MapLibre text-rotate angle aligned with the polygon's longest edge.
 * Rotated labels follow the natural orientation of elongated zones.
 * @param {number[][][]} coordinates  GeoJSON polygon coordinates array
 * @returns {number}  Rotation angle in degrees (clamped to –90…90 for readability)
 */
function computeTextRotate(coordinates) {
    const ring = coordinates[0];
    let maxLen = -1, bearing = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
            // Bearing of this edge in degrees (corrected for latitude foreshortening)
            bearing = Math.atan2(dLng * Math.cos(midLat * Math.PI / 180), dLat) * 180 / Math.PI;
        }
    }
    // Convert edge bearing to a text-rotate value (labels read left-to-right)
    let rot = bearing - 90;
    if (rot >   90) rot -= 180;
    if (rot <= -90) rot += 180;
    return Math.round(rot * 10) / 10; // one decimal place is sufficient
}

/**
 * Find the two endpoints of the polygon's longest edge.
 * Used to position the AWACS orbit label along the longest straight segment.
 * @param {number[][][]} coordinates  GeoJSON polygon coordinates array
 * @returns {[[number,number],[number,number]]}  [startPoint, endPoint]
 */
function computeLongestEdge(coordinates) {
    const ring = coordinates[0];
    let maxLen = -1, p0 = ring[0], p1 = ring[1];
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) { maxLen = len; p0 = ring[i]; p1 = ring[i + 1]; }
    }
    return [p0, p1];
}


// ============================================================
// MAP INITIALISATION
// Create the MapLibre GL map instance with appropriate initial state
// depending on whether the browser is currently online or offline.
// ============================================================

const _mapOrigin   = window.location.origin;
const _mapStyleURL = _mapIsOnline
    ? `${_mapOrigin}/assets/fiord-online.json`   // OSM raster tiles
    : `${_mapOrigin}/assets/fiord.json`;          // local PMTiles

const _sentinelMap = new maplibregl.Map({
    container: 'map',             // DOM element id that will contain the canvas
    style: _mapStyleURL,
    center: _mapIsOnline ? [-4.4815, 54.1453] : [-4.5481, 54.2361],  // Irish Sea / central UK
    zoom:     _mapIsOnline ? 6 : 5,
    minZoom:  _mapIsOnline ? 2 : 5,                // offline tiles only available from zoom 5
    maxBounds: _mapIsOnline ? null : _OFFLINE_BOUNDS,
    attributionControl: false,    // custom attribution not needed for this use case
    fadeDuration: 0,              // instant tile transitions (reduces flicker on style switch)
    cooperativeGestures: false,   // allow normal scroll-to-zoom without modifier key
    // Rewrite root-relative tile URLs to absolute ones at request time
    transformRequest: (url) => ({ url: url.startsWith('/') ? _mapOrigin + url : url }),
    transformStyle:   _fixStylePaths,
});
_sentinelMap.scrollZoom.enable();

// ---- Style.load handler registration ----
// Overlay controls register post-style-reload callbacks via MapComponent.onStyleLoad(fn).
// This keeps map.js decoupled from knowing which controls exist.
const _styleLoadCallbacks = [];  // array of functions to call after each style reload
let   _styleHasLoadedOnce = false;

_sentinelMap.on('style.load', () => {
    // Re-apply connectivity-dependent constraints after each style change
    _sentinelMap.setMinZoom(_mapConnState ? 2 : 5);
    _sentinelMap.setMaxBounds(_mapConnState ? null : _OFFLINE_BOUNDS);

    // List of major cities shown at zoom < 7 to avoid clutter
    const majorCities = [
        'Newcastle upon Tyne', 'Sunderland', 'Scarborough', 'Carlisle',
        'Edinburgh', 'Glasgow', 'Stranraer', 'Dumfries',
        'Belfast', 'Derry/Londonderry', 'Dublin',
        'Liverpool', 'Manchester', 'Preston', 'Birmingham', 'London',
        'York', 'Leeds', 'Plymouth', 'Inverness', 'Aberdeen',
        'Stirling', 'Dundee', 'Norwich', 'Armagh', 'Dungannon',
    ];

    /**
     * Apply zoom-dependent city label filters.
     * Below zoom 7: show all cities/towns.
     * At zoom 7+: only show the named major cities to avoid overcrowding.
     */
    function applyZoomDependentCityFilter() {
        const zoom = _sentinelMap.getZoom();
        try {
            // Normalised class expression across different style schemas
            const classExpr = ['coalesce', ['get', 'class'], ['get', 'kind_detail'], ['get', 'kind']];
            if (zoom >= 7) {
                // Only the major city list
                const cityMatch = ['match', ['get', 'name'], ...majorCities.flatMap(c => [c, true]), false];
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false], cityMatch]);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false], cityMatch]);
            } else {
                // All cities and towns
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false]]);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false]]);
            }
        } catch (e) { /* layer may not exist in all style variants — safe to ignore */ }
    }

    applyZoomDependentCityFilter();
    _sentinelMap.on('zoom', applyZoomDependentCityFilter); // re-run whenever the user zooms

    // Fire registered overlay re-init callbacks (skip on the very first load — overlays init themselves)
    if (_styleHasLoadedOnce) {
        _styleLoadCallbacks.forEach(fn => {
            try { fn(); } catch (e) { console.error('style.load handler error:', e); }
        });
    }
    _styleHasLoadedOnce = true;
});

// Suppress noisy MapLibre errors caused by layer/source removal during style switches
_sentinelMap.on('error', (e) => {
    const msg = e?.error?.message || '';
    if (
        msg.includes('Cannot remove non-existing layer') ||
        msg.includes('Cannot style non-existing layer') ||
        msg.includes('does not exist in the map')
    ) return; // expected during style transitions — not actionable
    console.error('Map error:', e);
});

// Suppress missing-image warnings for sprite icons not present in the active style
_sentinelMap.on('styleimagemissing', () => {});


// ============================================================
// PUBLIC API
// window.MapComponent is the single entry point for all other
// scripts that need the map instance or geometry helpers.
// ============================================================
window.MapComponent = {
    /** The MapLibre GL Map instance — use this for all layer/source operations. */
    map: _sentinelMap,

    /**
     * Register a callback to be fired after every style reload.
     * Overlay controls use this to re-add their layers after a style switch.
     * @param {function} fn - called with no arguments after each style.load
     */
    onStyleLoad: function (fn) { _styleLoadCallbacks.push(fn); },

    /** @returns {boolean} Whether the app currently has an internet connection */
    isOnline: function () { return _mapConnState; },

    // Geometry helpers — see JSDoc above for each function's contract
    generateGeodesicCircle,
    buildRingsGeoJSON,
    computeCentroid,
    computeTextRotate,
    computeLongestEdge,
    RING_DISTANCES_NM,
};
