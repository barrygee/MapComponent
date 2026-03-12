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

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

// Register the PMTiles protocol so MapLibre can load local .pmtiles tile archives
const _pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', _pmtilesProtocol.tile.bind(_pmtilesProtocol) as Parameters<typeof maplibregl.addProtocol>[1]);

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
const _OFFLINE_BOUNDS: [[number, number], [number, number]] = [[-20, 44], [32, 67]];

/**
 * Update the footer connection-status pill text and colour class.
 */
function _updateConnStatusPill(online: boolean): void {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className   = online ? 'conn-online' : 'conn-offline';
    el.textContent = online ? '● ONLINE' : '● OFFLINE';
}
_updateConnStatusPill(_mapIsOnline); // set pill immediately on load

/**
 * TransformStyleFunction passed to map.setStyle().
 * Rewrites root-relative sprite/glyphs paths to absolute origin URLs.
 */
function _fixStylePaths(_prev: maplibregl.StyleSpecification | undefined, next: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
    const origin = window.location.origin;
    if (typeof next.sprite === 'string' && next.sprite.startsWith('/')) next.sprite = origin + next.sprite;
    if (typeof next.glyphs  === 'string' && next.glyphs.startsWith('/'))  next.glyphs  = origin + next.glyphs;
    return next;
}

/**
 * Switch the MapLibre base style between the online (OSM tiles) and offline (PMTiles) versions.
 */
function _switchMapStyle(online: boolean): void {
    if (typeof _sentinelMap === 'undefined') return;
    _sentinelMap.setMinZoom(online ? 2 : 5);
    _sentinelMap.setMaxBounds(online ? null : _OFFLINE_BOUNDS);
    _sentinelMap.setStyle(
        online
            ? `${window.location.origin}/assets/fiord-online.json`
            : `${window.location.origin}/assets/fiord.json`,
        { transformStyle: _fixStylePaths },
    );
}

/**
 * Poll OSM to detect real internet access.
 */
function _checkInternetConnection(): void {
    fetch('https://tile.openstreetmap.org/favicon.ico', { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
        .then(() => {
            if (!_mapConnState) {
                _mapConnState = true;
                _updateConnStatusPill(true);
                _switchMapStyle(true);
                if (typeof window._Notifications !== 'undefined') {
                    window._Notifications.add({ type: 'system', title: 'ONLINE', detail: 'Connection restored' });
                }
            }
        })
        .catch(() => {
            if (_mapConnState) {
                _mapConnState = false;
                _updateConnStatusPill(false);
                _switchMapStyle(false);
                if (typeof window._Notifications !== 'undefined') {
                    window._Notifications.add({ type: 'system', title: 'OFFLINE', detail: 'Connection lost' });
                }
            }
        });
}

_checkInternetConnection();
setInterval(_checkInternetConnection, 2000);

window.addEventListener('online',  () => { _mapConnState = true;  _updateConnStatusPill(true);  _switchMapStyle(true); });
window.addEventListener('offline', () => { _mapConnState = false; _updateConnStatusPill(false); _switchMapStyle(false); });


// ============================================================
// GEOMETRY HELPERS
// ============================================================

const RING_DISTANCES_NM: readonly number[] = [50, 100, 150, 200, 250];

function _toRad(deg: number): number { return deg * Math.PI / 180; }
function _toDeg(rad: number): number { return rad * 180 / Math.PI; }

/**
 * Generate 181 geodesic (great-circle) points forming a circle on the Earth's surface.
 */
function generateGeodesicCircle(lng: number, lat: number, radiusNm: number): LngLat[] {
    const angularDistanceRad = radiusNm / 3440.065;
    const latRad = _toRad(lat);
    const lngRad = _toRad(lng);
    const points: LngLat[] = [];
    for (let i = 0; i <= 180; i++) {
        const bearingRad = _toRad(i * 2);
        const lat2 = Math.asin(Math.sin(latRad) * Math.cos(angularDistanceRad) + Math.cos(latRad) * Math.sin(angularDistanceRad) * Math.cos(bearingRad));
        const lng2 = lngRad + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistanceRad) * Math.cos(latRad), Math.cos(angularDistanceRad) - Math.sin(latRad) * Math.sin(lat2));
        points.push([_toDeg(lng2), _toDeg(lat2)]);
    }
    return points;
}

/**
 * Build GeoJSON FeatureCollections for all 5 range rings (50–250 nm) plus north-point labels.
 */
function buildRingsGeoJSON(lng: number, lat: number): RingsGeoJSON {
    const lines:  GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: 'FeatureCollection', features: [] };
    const labels: GeoJSON.FeatureCollection<GeoJSON.Point>      = { type: 'FeatureCollection', features: [] };
    const latR = _toRad(lat);
    const lngR = _toRad(lng);

    RING_DISTANCES_NM.forEach(nm => {
        const angularDistanceRad = nm / 3440.065;

        lines.features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: generateGeodesicCircle(lng, lat, nm) },
            properties: {},
        });

        const lat2 = Math.asin(Math.sin(latR) * Math.cos(angularDistanceRad) + Math.cos(latR) * Math.sin(angularDistanceRad));
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
 */
function computeCentroid(coordinates: number[][][]): LngLat {
    const ring = coordinates[0];
    let area = 0, centroidX = 0, centroidY = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const x0 = ring[i][0],     y0 = ring[i][1];
        const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
        const cross = x0 * y1 - x1 * y0;
        area      += cross;
        centroidX += (x0 + x1) * cross;
        centroidY += (y0 + y1) * cross;
    }
    area *= 0.5;
    return [centroidX / (6 * area), centroidY / (6 * area)];
}

/**
 * Compute the MapLibre text-rotate angle aligned with the polygon's longest edge.
 */
function computeTextRotate(coordinates: number[][][]): number {
    const ring = coordinates[0];
    let maxLen = -1, bearing = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
            bearing = Math.atan2(dLng * Math.cos(midLat * Math.PI / 180), dLat) * 180 / Math.PI;
        }
    }
    let textRotation = bearing - 90;
    if (textRotation >   90) textRotation -= 180;
    if (textRotation <= -90) textRotation += 180;
    return Math.round(textRotation * 10) / 10;
}

/**
 * Find the two endpoints of the polygon's longest edge.
 */
function computeLongestEdge(coordinates: number[][][]): [LngLat, LngLat] {
    const ring = coordinates[0];
    let maxLen = -1;
    let p0: LngLat = [ring[0][0], ring[0][1]];
    let p1: LngLat = [ring[1][0], ring[1][1]];
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            p0 = [ring[i][0], ring[i][1]];
            p1 = [ring[i + 1][0], ring[i + 1][1]];
        }
    }
    return [p0, p1];
}


// ============================================================
// MAP INITIALISATION
// ============================================================

const _mapOrigin   = window.location.origin;
const _mapStyleURL = _mapIsOnline
    ? `${_mapOrigin}/assets/fiord-online.json`
    : `${_mapOrigin}/assets/fiord.json`;

const _sentinelMap = new maplibregl.Map({
    container: 'map',
    style: _mapStyleURL,
    center: _mapIsOnline ? [-4.4815, 54.1453] : [-4.5481, 54.2361],
    zoom:     _mapIsOnline ? 6 : 5,
    minZoom:  _mapIsOnline ? 2 : 5,
    maxBounds: _mapIsOnline ? undefined : _OFFLINE_BOUNDS,
    attributionControl: false,
    fadeDuration: 0,
    cooperativeGestures: false,
    transformRequest: (url: string) => ({ url: url.startsWith('/') ? _mapOrigin + url : url }),
    transformStyle: _fixStylePaths,
} as unknown as maplibregl.MapOptions);
_sentinelMap.scrollZoom.enable();

// Style.load handler registration
const _styleLoadCallbacks: Array<() => void> = [];
let   _styleHasLoadedOnce = false;

_sentinelMap.on('style.load', () => {
    _sentinelMap.setMinZoom(_mapConnState ? 2 : 5);
    _sentinelMap.setMaxBounds(_mapConnState ? null : _OFFLINE_BOUNDS);

    const majorCities = [
        'Newcastle upon Tyne', 'Sunderland', 'Scarborough', 'Carlisle',
        'Edinburgh', 'Glasgow', 'Stranraer', 'Dumfries',
        'Belfast', 'Derry/Londonderry', 'Dublin',
        'Liverpool', 'Manchester', 'Preston', 'Birmingham', 'London',
        'York', 'Leeds', 'Plymouth', 'Inverness', 'Aberdeen',
        'Stirling', 'Dundee', 'Norwich', 'Armagh', 'Dungannon',
    ];

    function applyZoomDependentCityFilter(): void {
        const zoom = _sentinelMap.getZoom();
        try {
            const classExpr = ['coalesce', ['get', 'class'], ['get', 'kind_detail'], ['get', 'kind']] as unknown as maplibregl.ExpressionSpecification;
            if (zoom >= 7) {
                const cityMatch = ['match', ['get', 'name'], ...majorCities.flatMap(c => [c, true]), false] as unknown as maplibregl.ExpressionSpecification;
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false], cityMatch] as unknown as maplibregl.FilterSpecification);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false], cityMatch] as unknown as maplibregl.FilterSpecification);
            } else {
                _sentinelMap.setFilter('place_city', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['city'], true, false]] as unknown as maplibregl.FilterSpecification);
                _sentinelMap.setFilter('place_town', ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', classExpr, ['town'], true, false]] as unknown as maplibregl.FilterSpecification);
            }
        } catch (e) { /* layer may not exist in all style variants */ }
    }

    applyZoomDependentCityFilter();
    _sentinelMap.on('zoom', applyZoomDependentCityFilter);

    if (_styleHasLoadedOnce) {
        _styleLoadCallbacks.forEach(fn => {
            try { fn(); } catch (e) { console.error('style.load handler error:', e); }
        });
    }
    _styleHasLoadedOnce = true;
});

_sentinelMap.on('error', (e) => {
    const msg = (e as { error?: { message?: string } }).error?.message ?? '';
    if (
        msg.includes('Cannot remove non-existing layer') ||
        msg.includes('Cannot style non-existing layer') ||
        msg.includes('does not exist in the map')
    ) return;
    console.error('Map error:', e);
});

_sentinelMap.on('styleimagemissing', () => {});


// ============================================================
// PUBLIC API
// ============================================================
window.MapComponent = {
    map: _sentinelMap,
    onStyleLoad: (fn: () => void) => { _styleLoadCallbacks.push(fn); },
    isOnline: () => _mapConnState,
    generateGeodesicCircle,
    buildRingsGeoJSON,
    computeCentroid,
    computeTextRotate,
    computeLongestEdge,
    RING_DISTANCES_NM,
};
