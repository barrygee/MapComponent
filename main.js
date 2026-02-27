// Import PMTiles protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

// --- Connectivity detection ---
// navigator.onLine reflects the OS network stack. The browser fires
// 'online'/'offline' events when connectivity changes; the footer updates
// immediately and the map style is swapped to match without a full reload.
const _isOnline = navigator.onLine;

function _setConnStatus(online) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className = online ? 'conn-online' : 'conn-offline';
    el.textContent = online ? '● ONLINE' : '● OFFLINE';
}
_setConnStatus(_isOnline);

window.addEventListener('online',  () => { _connState = true;  _setConnStatus(true);  _switchStyle(true);  });
window.addEventListener('offline', () => { _connState = false; _setConnStatus(false); _switchStyle(false); });

// Poll real internet connectivity every 2 s and also check immediately on load.
// mode:'no-cors' resolves for any reachable server; rejects only on network failure.
let _connState = _isOnline;
function _checkConn() {
    fetch('https://tile.openstreetmap.org/favicon.ico', { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
        .then(() => {
            if (!_connState) { _connState = true;  _setConnStatus(true);  _switchStyle(true);  }
        })
        .catch(() => {
            if (_connState)  { _connState = false; _setConnStatus(false); _switchStyle(false); }
        });
}
_checkConn(); // immediate check on page load
setInterval(_checkConn, 2000);

const _OFFLINE_BOUNDS = [[-20, 44], [32, 67]];

function _switchStyle(online) {
    if (typeof map === 'undefined') return;
    map.setMinZoom(online ? 2 : 5);
    map.setMaxBounds(online ? null : _OFFLINE_BOUNDS);
    map.setStyle(online
        ? `${window.location.origin}/assets/fiord-online.json`
        : `${window.location.origin}/assets/fiord.json`
    );
}
// --- End connectivity detection ---

// --- Range rings ---
const RING_DISTANCES_NM = [50, 100, 150, 200, 250];
let rangeRingCenter = null;
let rangeRingsControl = null;
let adsbLabelsControl = null;

function _toRad(deg) { return deg * Math.PI / 180; }
function _toDeg(rad) { return rad * 180 / Math.PI; }

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
        // Label at north (bearing 0)
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d));
        labels.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [_toDeg(lngR), _toDeg(lat2)] },
            properties: { label: nm + ' nm' }
        });
    });
    return { lines, labels };
}
// --- End range rings helpers ---

// Compute the area-weighted centroid of a polygon ring, returned as [lng, lat].
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

// Compute the MapLibre text-rotate value that aligns a label with the
// long axis of a polygon.  Returns a value in (-90, 90] degrees.
function computeTextRotate(coordinates) {
    const ring = coordinates[0];
    let maxLen = -1, bearing = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            // Clockwise bearing from north, corrected for Mercator cos(lat) scaling
            const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
            bearing = Math.atan2(dLng * Math.cos(midLat * Math.PI / 180), dLat) * 180 / Math.PI;
        }
    }
    // Convert bearing to text-rotate, keeping in (-90, 90] so text reads left-to-right
    let rot = bearing - 90;
    if (rot >  90) rot -= 180;
    if (rot <= -90) rot += 180;
    return Math.round(rot * 10) / 10;
}

const origin = window.location.origin;

const _styleURL = _isOnline
    ? `${origin}/assets/fiord-online.json`
    : `${origin}/assets/fiord.json`;

const map = new maplibregl.Map({
    container: 'map',
    style: _styleURL,
    center: _isOnline ? [-4.4815, 54.1453] : [-4.5481, 54.2361],
    zoom: _isOnline ? 6 : 5,
    minZoom: _isOnline ? 2 : 5,
    maxBounds: _isOnline ? null : _OFFLINE_BOUNDS,
    attributionControl: false,
    fadeDuration: 0,
    transformRequest: (url) => ({ url })
});

let _styleLoadedOnce = false;

map.on('style.load', () => {
    console.log('Style loaded successfully');
    map.setMinZoom(_connState ? 2 : 5);
    map.setMaxBounds(_connState ? null : _OFFLINE_BOUNDS);

    // Define cities to show at zoom 1-8
    const majorCities = [
        'Newcastle upon Tyne',
        'Sunderland',
        'Scarborough',
        'Carlisle',
        'Edinburgh',
        'Glasgow',
        'Stranraer',
        'Dumfries',
        'Belfast',
        'Derry/Londonderry',
        'Dublin',
        'Liverpool',
        'Manchester',
        'Preston',
        'Birmingham',
        'London',
        'York',
        'Leeds',
        'Plymouth',
        'Inverness',
        'Aberdeen',
        'Stirling',
        'Dundee',
        'Norwich',
        'Armagh',
        'Dungannon'
    ];
    
    // Function to update city and town filter based on zoom level
    function updateCityFilter() {
        const currentZoom = map.getZoom();
        
        try {
            if (currentZoom >= 7) {
                // Only show major cities and towns at zoom 7 and above
                const matchExpression = ['match', ['get', 'name']];
                majorCities.forEach(city => {
                    matchExpression.push(city);
                    matchExpression.push(true);
                });
                matchExpression.push(false); // Default: false (hide if not in list)
                
                // class (OFM/online schema) or kind_detail/kind (offline UK pmtiles schema)
                const classExpr = ['coalesce', ['get', 'class'], ['get', 'kind_detail'], ['get', 'kind']];
                const newFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['match', classExpr, ['city'], true, false],
                    matchExpression
                ];
                map.setFilter('place_city', newFilter);

                // Apply same filter to place_town
                const townMatchExpression = ['match', ['get', 'name']];
                majorCities.forEach(city => {
                    townMatchExpression.push(city);
                    townMatchExpression.push(true);
                });
                townMatchExpression.push(false);

                const townFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['match', classExpr, ['town'], true, false],
                    townMatchExpression
                ];
                map.setFilter('place_town', townFilter);
            } else {
                // Show all cities and towns below zoom 7
                const classExpr = ['coalesce', ['get', 'class'], ['get', 'kind_detail'], ['get', 'kind']];
                const baseFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['match', classExpr, ['city'], true, false]
                ];
                map.setFilter('place_city', baseFilter);

                const townFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['match', classExpr, ['town'], true, false]
                ];
                map.setFilter('place_town', townFilter);
            }
        } catch (e) {
            console.error('Error updating city filter:', e);
        }
    }
    
    // Update on first load
    updateCityFilter();

    // Update filter when zoom changes
    map.on('zoom', updateCityFilter);

    // After a style switch (setStyle), re-initialise custom overlay layers.
    // Guard with _styleLoadedOnce so we don't double-init on the very first load
    // (controls register their own map.once('style.load') during onAdd).
    if (_styleLoadedOnce) {
        if (roadsControl)      roadsControl.updateRoadsVisibility();
        if (namesControl)      namesControl.applyNamesVisibility();
        if (rangeRingsControl) rangeRingsControl.initRings();
        if (aarControl)        aarControl.initLayers();
        if (awacsControl)      awacsControl.initLayers();
        if (airportsControl)   airportsControl.initLayers();
        if (rafControl)        rafControl.initLayers();
        if (adsbControl)       adsbControl.initLayers();
    }
    _styleLoadedOnce = true;
});

map.on('error', (e) => {
    console.error('Map error:', e);
});


// --- Overlay state persistence ---
// Defaults: everything ON on first load; subsequent loads restore last state.
const _OVERLAY_DEFAULTS = { roads: true, names: true, rings: true, aar: true, awacs: true, airports: true, raf: true, adsb: true, adsbLabels: true };
const _overlayStates = (() => {
    try {
        const saved = localStorage.getItem('overlayStates');
        return saved ? Object.assign({}, _OVERLAY_DEFAULTS, JSON.parse(saved)) : Object.assign({}, _OVERLAY_DEFAULTS);
    } catch (e) { return Object.assign({}, _OVERLAY_DEFAULTS); }
})();
function _saveOverlayStates() {
    try {
        localStorage.setItem('overlayStates', JSON.stringify({
            roads: roadsControl ? roadsControl.roadsVisible : _overlayStates.roads,
            names: namesControl ? namesControl.namesVisible : _overlayStates.names,
            rings: rangeRingsControl ? rangeRingsControl.ringsVisible : _overlayStates.rings,
            aar: aarControl ? aarControl.visible : _overlayStates.aar,
            awacs: awacsControl ? awacsControl.visible : _overlayStates.awacs,
            airports: airportsControl ? airportsControl.visible : _overlayStates.airports,
            raf: rafControl ? rafControl.visible : _overlayStates.raf,
            adsb: adsbControl ? adsbControl.visible : _overlayStates.adsb,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible : _overlayStates.adsbLabels,
        }));
    } catch (e) {}
}
// --- End overlay state persistence ---


// Custom control for toggling roads
class RoadsToggleControl {
    constructor() {
        this.roadsVisible = _overlayStates.roads;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';
        
        this.button = document.createElement('button');
        this.button.className = 'roads-toggle-btn';
        this.button.title = 'Toggle road lines and names';
        this.button.textContent = 'R';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.color = '#ffffff';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '0.3';
        this.button.onclick = () => this.toggleRoads();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';
        
        this.container.appendChild(this.button);
        
        // Listen to zoom changes to update button state
        this.map.on('zoom', () => this.updateButtonState());

        // Set initial visibility based on zoom and toggle state
        this.updateRoadsVisibility();

        // Re-apply visibility after style loads (initial call may fail if style not loaded)
        this.map.once('style.load', () => this.updateRoadsVisibility());

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    updateButtonState() {
        const zoomAllowsRoads = true;
        const shouldBeVisible = this.roadsVisible && zoomAllowsRoads;
        this.button.style.opacity = shouldBeVisible ? '1' : '0.3';
        this.button.style.color = shouldBeVisible ? '#c8ff00' : '#ffffff';
    }

    updateRoadsVisibility() {
        const zoomAllowsRoads = true;
        const visibility = (this.roadsVisible && zoomAllowsRoads) ? 'visible' : 'none';
        
        const roadLayerIds = [
            'highway_path', 'highway_minor', 'highway_major_casing', 
            'highway_major_inner', 'highway_major_subtle',
            'highway_motorway_casing', 'highway_motorway_inner', 
            'highway_motorway_subtle', 'highway_name_motorway', 
            'highway_name_other', 'highway_ref', 'tunnel_motorway_casing',
            'tunnel_motorway_inner', 'road_area_pier', 'road_pier'
        ];
        
        roadLayerIds.forEach(layerId => {
            try {
                this.map.setLayoutProperty(layerId, 'visibility', visibility);
            } catch (e) {
                // Layer might not exist, skip it
            }
        });
        
        this.updateButtonState();
    }

    toggleRoads() {
        this.roadsVisible = !this.roadsVisible;
        this.updateRoadsVisibility();
        _saveOverlayStates();
    }
}

// --- Home / reset view ---
class ResetViewControl {
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Reset view to home';
        this.button.innerHTML = `<svg viewBox="14 15 32 30" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
            <polyline points="21,17 16,17 16,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,17 44,17 44,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="21,43 16,43 16,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,43 44,43 44,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <rect x="28" y="28" width="4" height="4" fill="white"/>
        </svg>`;
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.onclick = () => {
            this.map.flyTo({ center: [-4.4815, 54.1453], zoom: 6 });
        };
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);
        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }
}
// --- End home / reset view ---

// --- Airports ---
// bounds: [minLng, minLat, maxLng, maxLat] covering full runway extent
// freqs: { tower, radar, approach, atis }
const AIRPORTS_DATA = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { icao: 'EGLL', iata: 'LHR', name: 'Heathrow',     bounds: [-0.5050, 51.4620, -0.4180, 51.4930], freqs: { tower: '118.500 / 118.700', radar: '119.725', approach: '119.725', atis: '113.750' } }, geometry: { type: 'Point', coordinates: [-0.4614, 51.4775] } },
        { type: 'Feature', properties: { icao: 'EGKK', iata: 'LGW', name: 'Gatwick',      bounds: [-0.2250, 51.1340, -0.1560, 51.1620], freqs: { tower: '124.225', radar: '126.825', approach: '126.825', atis: '136.525' } }, geometry: { type: 'Point', coordinates: [-0.1903, 51.1481] } },
        { type: 'Feature', properties: { icao: 'EGGW', iata: 'LTN', name: 'Luton',        bounds: [-0.4020, 51.8640, -0.3340, 51.8870], freqs: { tower: '132.550', radar: '129.550', approach: '129.550', atis: '120.575' } }, geometry: { type: 'Point', coordinates: [-0.3683, 51.8747] } },
        { type: 'Feature', properties: { icao: 'EGSS', iata: 'STN', name: 'Stansted',     bounds: [ 0.2000, 51.8720,  0.2720, 51.8980], freqs: { tower: '123.800', radar: '126.950', approach: '126.950', atis: '127.175' } }, geometry: { type: 'Point', coordinates: [ 0.2350, 51.8850] } },
        { type: 'Feature', properties: { icao: 'EGCC', iata: 'MAN', name: 'Manchester',   bounds: [-2.3180, 53.3440, -2.2340, 53.3880], freqs: { tower: '118.625', radar: '119.400', approach: '119.400', atis: '128.175' } }, geometry: { type: 'Point', coordinates: [-2.2749, 53.3650] } },
        { type: 'Feature', properties: { icao: 'EGNT', iata: 'NCL', name: 'Newcastle',    bounds: [-1.7280, 54.9970, -1.6540, 55.0380], freqs: { tower: '119.700', radar: '124.375', approach: '124.375', atis: '119.025' } }, geometry: { type: 'Point', coordinates: [-1.6917, 55.0375] } },
        { type: 'Feature', properties: { icao: 'EGPF', iata: 'GLA', name: 'Glasgow',      bounds: [-4.4810, 55.8530, -4.3870, 55.8920], freqs: { tower: '118.800', radar: '119.100', approach: '119.100', atis: '113.400' } }, geometry: { type: 'Point', coordinates: [-4.4330, 55.8719] } },
        { type: 'Feature', properties: { icao: 'EGPH', iata: 'EDI', name: 'Edinburgh',    bounds: [-3.4140, 55.9290, -3.3330, 55.9740], freqs: { tower: '118.700', radar: '121.200', approach: '121.200', atis: '132.075' } }, geometry: { type: 'Point', coordinates: [-3.3725, 55.9508] } },
        { type: 'Feature', properties: { icao: 'EGGD', iata: 'BRS', name: 'Bristol',      bounds: [-2.7620, 51.3670, -2.6780, 51.3990], freqs: { tower: '133.850', radar: '125.650', approach: '125.650', atis: '127.375' } }, geometry: { type: 'Point', coordinates: [-2.7191, 51.3827] } },
        { type: 'Feature', properties: { icao: 'EGBB', iata: 'BHX', name: 'Birmingham',   bounds: [-1.7890, 52.4340, -1.7100, 52.4750], freqs: { tower: '118.300', radar: '120.500', approach: '120.500', atis: '126.025' } }, geometry: { type: 'Point', coordinates: [-1.7480, 52.4539] } },
        { type: 'Feature', properties: { icao: 'EGAC', iata: 'BHD', name: 'Belfast City', bounds: [-5.9050, 54.6020, -5.8450, 54.6350], freqs: { tower: '130.750', radar: '130.750', approach: '130.750', atis: '120.900' } }, geometry: { type: 'Point', coordinates: [-5.8725, 54.6181] } },
        { type: 'Feature', properties: { icao: 'EGAA', iata: 'BFS', name: 'Aldergrove',   bounds: [-6.2640, 54.6310, -6.1720, 54.6870], freqs: { tower: '118.300', radar: '120.900', approach: '120.900', atis: '109.600' } }, geometry: { type: 'Point', coordinates: [-6.2158, 54.6575] } },
        { type: 'Feature', properties: { icao: 'EGNV', iata: 'MME', name: 'Teesside',     bounds: [-1.4700, 54.4920, -1.3900, 54.5280], freqs: { tower: '119.800', radar: '118.850', approach: '118.850', atis: '124.150' } }, geometry: { type: 'Point', coordinates: [-1.4294, 54.5092] } },
        { type: 'Feature', properties: { icao: 'EGGP', iata: 'LPL', name: 'Liverpool',    bounds: [-2.8940, 53.3100, -2.8080, 53.3590], freqs: { tower: '118.100', radar: '119.850', approach: '119.850', atis: '128.575' } }, geometry: { type: 'Point', coordinates: [-2.8497, 53.3336] } },
        { type: 'Feature', properties: { icao: 'EGNH', iata: 'BLK', name: 'Blackpool',    bounds: [-3.0620, 53.7550, -3.0000, 53.7900], freqs: { tower: '118.400', radar: '135.950', approach: '135.950', atis: '121.750' } }, geometry: { type: 'Point', coordinates: [-3.0286, 53.7717] } },
        { type: 'Feature', properties: { icao: 'EGNS', iata: 'IOM', name: 'Isle of Man',  bounds: [-4.6680, 54.0620, -4.5850, 54.1060], freqs: { tower: '118.900', radar: '120.850', approach: '120.850', atis: '118.525' } }, geometry: { type: 'Point', coordinates: [-4.6239, 54.0833] } },
        { type: 'Feature', properties: { icao: 'EGPK', iata: 'PIK', name: 'Prestwick',    bounds: [-4.6320, 55.4870, -4.5470, 55.5340], freqs: { tower: '118.150', radar: '120.550', approach: '120.550', atis: '127.125' } }, geometry: { type: 'Point', coordinates: [-4.5869, 55.5094] } },
        { type: 'Feature', properties: { icao: 'EGNM', iata: 'LBA', name: 'Leeds Bradford', bounds: [-1.6990, 53.8450, -1.6260, 53.8890], freqs: { tower: '120.300', radar: '134.575', approach: '134.575', atis: '118.025' } }, geometry: { type: 'Point', coordinates: [-1.6606, 53.8659] } },
        { type: 'Feature', properties: { icao: 'EIDW', iata: 'DUB', name: 'Dublin',        bounds: [-6.3200, 53.3890, -6.2210, 53.4560], freqs: { tower: '118.600', radar: '121.100', approach: '119.550', atis: '124.525' } }, geometry: { type: 'Point', coordinates: [-6.2700, 53.4213] } },
        { type: 'Feature', properties: { icao: 'EGPD', iata: 'ABZ', name: 'Aberdeen',      bounds: [-2.2220, 57.1900, -2.1710, 57.2170], freqs: { tower: '118.100', radar: '120.400', approach: '120.400', atis: '121.850' } }, geometry: { type: 'Point', coordinates: [-2.1978, 57.2019] } },
        { type: 'Feature', properties: { icao: 'EGPE', iata: 'INV', name: 'Inverness',     bounds: [-4.0650, 57.5350, -4.0280, 57.5440], freqs: { tower: '122.600', radar: '122.600', approach: '122.600', atis: '109.200' } }, geometry: { type: 'Point', coordinates: [-4.0475, 57.5425] } },
        { type: 'Feature', properties: { icao: 'EGHI', iata: 'SOU', name: 'Southampton',   bounds: [-1.3680, 50.9480, -1.3490, 50.9590], freqs: { tower: '118.200', radar: '128.850', approach: '128.850', atis: '113.350' } }, geometry: { type: 'Point', coordinates: [-1.3568, 50.9503] } },
        { type: 'Feature', properties: { icao: 'EGHH', iata: 'BOH', name: 'Bournemouth',   bounds: [-1.8470, 50.7760, -1.8240, 50.7820], freqs: { tower: '125.600', radar: '118.650', approach: '118.650', atis: '121.750' } }, geometry: { type: 'Point', coordinates: [-1.8425, 50.7800] } },
        { type: 'Feature', properties: { icao: 'EGMC', iata: 'SEN', name: 'Southend',      bounds: [ 0.6840,  51.5660,  0.7100,  51.5730], freqs: { tower: '127.725', radar: '130.775', approach: '130.775', atis: '121.800' } }, geometry: { type: 'Point', coordinates: [ 0.6956, 51.5714] } },
        { type: 'Feature', properties: { icao: 'EGSH', iata: 'NWI', name: 'Norwich',       bounds: [ 1.2680,  52.6710,  1.2850,  52.6780], freqs: { tower: '124.250', radar: '119.350', approach: '119.350', atis: '128.625' } }, geometry: { type: 'Point', coordinates: [ 1.2828, 52.6758] } },
        { type: 'Feature', properties: { icao: 'EGCN', iata: 'DSA', name: 'Doncaster',     bounds: [-1.0200,  53.4750, -0.9810,  53.4900], freqs: { tower: '128.775', radar: '126.225', approach: '126.225', atis: '121.775' } }, geometry: { type: 'Point', coordinates: [-1.0106, 53.4805] } },
        { type: 'Feature', properties: { icao: 'EGNJ', iata: 'HUY', name: 'Humberside',    bounds: [-0.3620,  53.5720, -0.3320,  53.5870], freqs: { tower: '124.900', radar: '119.125', approach: '119.125', atis: '124.675' } }, geometry: { type: 'Point', coordinates: [-0.3506, 53.5744] } },
    ]
};

class AirportsToggleControl {
    constructor() {
        this.visible = _overlayStates.airports;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle airports';
        this.button.textContent = 'CVL';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '8px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout  = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }

        return this.container;
    }

    onRemove() {
        if (this._markers) this._markers.forEach(m => m.remove());
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    _buildFreqPanel(p) {
        const rows = [
            ['TWR', p.freqs.tower],
            ['RAD', p.freqs.radar],
            ['APP', p.freqs.approach],
            ['ATIS', p.freqs.atis],
        ];
        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`
        ).join('');
        return `<div style="` +
            `display:inline-block;` +
            `background:rgba(0,0,0,0.7);color:#fff;` +
            `font-family:'Barlow Condensed','Barlow',sans-serif;` +
            `font-size:14px;font-weight:400;` +
            `padding:6px 14px 9px;` +
            `pointer-events:none;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;` +
            `font-weight:600;font-size:15px;letter-spacing:.12em;` +
            `margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:600;letter-spacing:.12em">${p.icao}</span>` +
            `<span style="font-size:11px;font-weight:400;opacity:0.5;letter-spacing:.08em">${p.name.toUpperCase()}</span>` +
            `</div>${rowsHTML}</div>`;
    }

    _buildAirportPanelHTML(p, coords) {
        const lat = coords[1].toFixed(4);
        const lng = coords[0].toFixed(4);
        const fields = [
            ['IATA',  p.iata  || '—'],
            ['LAT',   lat],
            ['LON',   lng],
            ['TWR',   p.freqs.tower    || '—'],
            ['RAD',   p.freqs.radar    || '—'],
            ['APP',   p.freqs.approach || '—'],
            ['ATIS',  p.freqs.atis     || '—'],
        ];
        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`
        ).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-callsign" style="color:#c8ff00">${p.icao}</span>` +
            `<span class="adsb-sb-hex">${p.name.toUpperCase()}</span>` +
            `<button class="adsb-sb-untrack-btn" id="apt-panel-close">CLOSE</button>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    _showAirportPanel(p, coords) {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            document.body.appendChild(bar);
        }
        bar.dataset.apt = '1';
        bar.innerHTML = this._buildAirportPanelHTML(p, coords);
        bar.classList.add('adsb-sb-visible');
        bar.querySelector('#apt-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            bar.classList.remove('adsb-sb-visible');
            delete bar.dataset.apt;
            this.map.flyTo({ center: [-4.4815, 54.1453], zoom: 6, duration: 800 });
        });
    }

    initLayers() {
        const vis = this.visible ? 'visible' : 'none';

        if (this.map.getSource('airports')) {
            this.map.removeLayer('airports-circle');
            this.map.removeSource('airports');
        }

        this.map.addSource('airports', { type: 'geojson', data: AIRPORTS_DATA });

        this.map.addLayer({
            id: 'airports-circle',
            type: 'circle',
            source: 'airports',
            layout: { visibility: vis },
            paint: {
                'circle-radius': 3,
                'circle-color': '#ffffff',
                'circle-opacity': 1,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000000',
                'circle-stroke-opacity': 0.7
            }
        });

        // Create HTML label markers once — they survive style changes as DOM nodes
        if (!this._markers) {
            this._hoverMarker = null;

            this._markers = AIRPORTS_DATA.features.map(f => {
                const p = f.properties;
                // Outer wrapper — large hit area, anchored top-left to the coordinate
                const el = document.createElement('div');
                el.style.cssText = [
                    'padding:6px 16px 6px 0',
                    'cursor:pointer',
                    'pointer-events:auto',
                    'user-select:none',
                ].join(';');

                const label = document.createElement('div');
                label.style.cssText = [
                    'color:#ffffff',
                    "font-family:'Barlow Condensed','Barlow',monospace",
                    'font-size:10px',
                    'font-weight:700',
                    'letter-spacing:.08em',
                    'line-height:1.5',
                    'white-space:nowrap',
                    'pointer-events:none',
                ].join(';');
                label.innerHTML =
                    `<span class="apt-icao" style="color:#c8ff00">${p.icao}</span>` +
                    `<br><span class="apt-name" style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`;
                el.appendChild(label);

                // Click — zoom to runway bounds with 25% padding
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const b = p.bounds; // [minLng, minLat, maxLng, maxLat]
                    // Measure the right-side control panel width so we can compensate
                    // for the asymmetric viewport and keep the airport truly centred.
                    const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right');
                    const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0;
                    const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0;
                    const pad = 80;
                    // Offset top padding by half the controls panel height so the
                    // airport sits in the true vertical centre of the remaining space.
                    const topExtra = Math.max(0, ctrlH / 2 - pad);
                    this.map.fitBounds(
                        [[b[0], b[1]], [b[2], b[3]]],
                        {
                            padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW },
                            maxZoom: 13,
                            duration: 800,
                        }
                    );
                    this._showAirportPanel(p, f.geometry.coordinates);
                });

                // Hover — show frequency panel inline inside the wrapper
                let freqPanel = null;
                el.addEventListener('mouseenter', () => {
                    if (!freqPanel) {
                        freqPanel = document.createElement('div');
                        freqPanel.innerHTML = this._buildFreqPanel(p);
                        freqPanel.style.cssText = 'pointer-events:none;margin-top:4px;';
                        el.appendChild(freqPanel);
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (freqPanel) { freqPanel.remove(); freqPanel = null; }
                });

                return new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [8, -6] })
                    .setLngLat(f.geometry.coordinates);
            });
            if (this.visible) this._markers.forEach(m => m.addTo(this.map));
        }
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        try { this.map.setLayoutProperty('airports-circle', 'visibility', v); } catch (e) {}
        if (this._markers) {
            if (this.visible) this._markers.forEach(m => m.addTo(this.map));
            else {
                this._markers.forEach(m => m.remove());
                if (this._hoverMarker) { this._hoverMarker.remove(); this._hoverMarker = null; }
            }
        }
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

let airportsControl = new AirportsToggleControl();
// --- End Airports ---

// --- RAF Bases ---
const RAF_DATA = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { icao: 'EGUB', name: 'RAF Benson',       bounds: [-1.1200, 51.6020, -1.0720, 51.6300] }, geometry: { type: 'Point', coordinates: [ -1.0972,  51.6164] } },
        { type: 'Feature', properties: { icao: 'EGIZ', name: 'RAF Boulmer',      bounds: [-1.6300, 55.4100, -1.5820, 55.4350] }, geometry: { type: 'Point', coordinates: [ -1.6061,  55.4222] } },
        { type: 'Feature', properties: { icao: 'EGVN', name: 'RAF Brize Norton', bounds: [-1.6280, 51.7250, -1.5400, 51.7750] }, geometry: { type: 'Point', coordinates: [ -1.5836,  51.7500] } },
        { type: 'Feature', properties: { icao: 'EGXC', name: 'RAF Coningsby',    bounds: [-0.2100, 53.0700, -0.1200, 53.1160] }, geometry: { type: 'Point', coordinates: [ -0.1664,  53.0930] } },
        { type: 'Feature', properties: { icao: 'EGSC', name: 'RAF Cosford',      bounds: [-2.3300, 52.6250, -2.2800, 52.6550] }, geometry: { type: 'Point', coordinates: [ -2.3056,  52.6403] } },
        { type: 'Feature', properties: { icao: 'EGYC', name: 'RAF Cranwell',     bounds: [-0.5300, 53.0100, -0.4350, 53.0500] }, geometry: { type: 'Point', coordinates: [ -0.4833,  53.0303] } },
        { type: 'Feature', properties: { icao: '',     name: 'RAF Fylingdales',  bounds: [-0.7000, 54.3450, -0.6400, 54.3750] }, geometry: { type: 'Point', coordinates: [ -0.6706,  54.3606] } },
        { type: 'Feature', properties: { icao: 'EGXH', name: 'RAF Honington',    bounds: [  0.7400, 52.3250,  0.8050, 52.3600] }, geometry: { type: 'Point', coordinates: [  0.7731,  52.3425] } },
        { type: 'Feature', properties: { icao: 'EGGE', name: 'RAF Leeming',      bounds: [-1.5750, 54.2750, -1.4950, 54.3250] }, geometry: { type: 'Point', coordinates: [ -1.5353,  54.2992] } },
        { type: 'Feature', properties: { icao: 'EGQL', name: 'RAF Lossiemouth',  bounds: [-3.4000, 57.6800, -3.2800, 57.7300] }, geometry: { type: 'Point', coordinates: [ -3.3392,  57.7053] } },
        { type: 'Feature', properties: { icao: 'EGYM', name: 'RAF Marham',       bounds: [  0.5100, 52.6250,  0.5900, 52.6700] }, geometry: { type: 'Point', coordinates: [  0.5506,  52.6481] } },
        { type: 'Feature', properties: { icao: 'EGWU', name: 'RAF Northolt',     bounds: [-0.4550, 51.5350, -0.3820, 51.5700] }, geometry: { type: 'Point', coordinates: [ -0.4183,  51.5530] } },
        { type: 'Feature', properties: { icao: 'EGVO', name: 'RAF Odiham',       bounds: [-1.0350, 51.2150, -0.9720, 51.2530] }, geometry: { type: 'Point', coordinates: [ -1.0036,  51.2341] } },
        { type: 'Feature', properties: { icao: 'EGOS', name: 'RAF Shawbury',     bounds: [-2.6950, 52.7800, -2.6350, 52.8150] }, geometry: { type: 'Point', coordinates: [ -2.6650,  52.7983] } },
        { type: 'Feature', properties: { icao: 'EGOM', name: 'RAF Spadeadam',    bounds: [-2.6000, 54.8750, -2.4950, 54.9250] }, geometry: { type: 'Point', coordinates: [ -2.5467,  54.9003] } },
        { type: 'Feature', properties: { icao: 'EGOV', name: 'RAF Valley',       bounds: [-4.5750, 53.2250, -4.4950, 53.2700] }, geometry: { type: 'Point', coordinates: [ -4.5353,  53.2481] } },
        { type: 'Feature', properties: { icao: 'EGXW', name: 'RAF Waddington',   bounds: [-0.5600, 53.1450, -0.4850, 53.1880] }, geometry: { type: 'Point', coordinates: [ -0.5228,  53.1664] } },
        { type: 'Feature', properties: { icao: 'EGXT', name: 'RAF Wittering',    bounds: [-0.5100, 52.5900, -0.4450, 52.6350] }, geometry: { type: 'Point', coordinates: [ -0.4767,  52.6128] } },
        { type: 'Feature', properties: { icao: 'EGOW', name: 'RAF Woodvale',     bounds: [-3.0800, 53.5650, -3.0250, 53.5980] }, geometry: { type: 'Point', coordinates: [ -3.0517,  53.5811] } },
        { type: 'Feature', properties: { icao: 'EGUY', name: 'RAF Wyton',        bounds: [-0.1400, 52.3400, -0.0800, 52.3750] }, geometry: { type: 'Point', coordinates: [ -0.1097,  52.3572] } },
        { type: 'Feature', properties: { icao: 'EGUY', name: 'RAF Alconbury',    bounds: [-0.1100, 52.3450, -0.0480, 52.3800] }, geometry: { type: 'Point', coordinates: [ -0.0781,  52.3636] } },
        { type: 'Feature', properties: { icao: 'EGVA', name: 'RAF Fairford',     bounds: [-1.8300, 51.6600, -1.7500, 51.7050] }, geometry: { type: 'Point', coordinates: [ -1.7900,  51.6822] } },
        { type: 'Feature', properties: { icao: 'EGUL', name: 'RAF Lakenheath',   bounds: [  0.5250, 52.3900,  0.5950, 52.4300] }, geometry: { type: 'Point', coordinates: [  0.5611,  52.4094] } },
        { type: 'Feature', properties: { icao: 'EGUN', name: 'RAF Mildenhall',   bounds: [  0.4550, 52.3400,  0.5180, 52.3850] }, geometry: { type: 'Point', coordinates: [  0.4864,  52.3619] } },
    ]
};

class RAFToggleControl {
    constructor() {
        this.visible = _overlayStates.raf;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle RAF bases';
        this.button.textContent = 'MIL';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '8px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout  = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }

        return this.container;
    }

    onRemove() {
        if (this._markers) this._markers.forEach(m => m.remove());
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    initLayers() {
        const vis = this.visible ? 'visible' : 'none';

        if (this.map.getSource('raf-bases')) {
            this.map.removeLayer('raf-circle');
            this.map.removeSource('raf-bases');
        }

        this.map.addSource('raf-bases', { type: 'geojson', data: RAF_DATA });

        this.map.addLayer({
            id: 'raf-circle',
            type: 'circle',
            source: 'raf-bases',
            layout: { visibility: vis },
            paint: {
                'circle-radius': 3,
                'circle-color': '#ffffff',
                'circle-opacity': 1,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000000',
                'circle-stroke-opacity': 0.7
            }
        });

        // Create HTML label markers once — they survive style changes as DOM nodes
        if (!this._markers) {
            this._markers = RAF_DATA.features.map(f => {
                const p = f.properties;

                const el = document.createElement('div');
                el.style.cssText = [
                    'padding:6px 16px 6px 0',
                    'cursor:pointer',
                    'pointer-events:auto',
                    'user-select:none',
                ].join(';');

                const label = document.createElement('div');
                label.style.cssText = [
                    'color:#ffffff',
                    "font-family:'Barlow Condensed','Barlow',monospace",
                    'font-size:10px',
                    'font-weight:700',
                    'letter-spacing:.08em',
                    'line-height:1.5',
                    'white-space:nowrap',
                    'pointer-events:none',
                ].join(';');
                label.innerHTML = p.icao
                    ? `<span style="color:#c8ff00">${p.icao}</span><br><span style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`
                    : `<span style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`;
                el.appendChild(label);

                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const b = p.bounds;
                    const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right');
                    const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0;
                    const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0;
                    const pad = 80;
                    const topExtra = Math.max(0, ctrlH / 2 - pad);
                    this.map.fitBounds(
                        [[b[0], b[1]], [b[2], b[3]]],
                        {
                            padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW },
                            maxZoom: 13,
                            duration: 800,
                        }
                    );
                    this._showRAFPanel(p, f.geometry.coordinates);
                });

                let freqPanel = null;
                el.addEventListener('mouseenter', () => {
                    if (!freqPanel) {
                        freqPanel = document.createElement('div');
                        freqPanel.style.cssText = 'pointer-events:none;margin-top:4px;';
                        freqPanel.innerHTML = `<div style="display:inline-block;background:rgba(0,0,0,0.7);color:#fff;` +
                            `font-family:'Barlow Condensed','Barlow',sans-serif;font-size:12px;font-weight:400;` +
                            `padding:5px 12px 7px;white-space:nowrap;user-select:none">` +
                            `<span style="opacity:0.5;letter-spacing:.05em">CLICK TO ZOOM</span></div>`;
                        el.appendChild(freqPanel);
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (freqPanel) { freqPanel.remove(); freqPanel = null; }
                });

                return new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [8, -6] })
                    .setLngLat(f.geometry.coordinates);
            });
            if (this.visible) this._markers.forEach(m => m.addTo(this.map));
        }
    }

    _buildRAFPanelHTML(p, coords) {
        const lat = coords[1].toFixed(4);
        const lng = coords[0].toFixed(4);
        const fields = [
            ['ICAO', p.icao || '—'],
            ['LAT',  lat],
            ['LON',  lng],
        ];
        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`
        ).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-callsign" style="color:#ffffff">${p.name.toUpperCase()}</span>` +
            `<button class="adsb-sb-untrack-btn" id="apt-panel-close">CLOSE</button>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    _showRAFPanel(p, coords) {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            document.body.appendChild(bar);
        }
        bar.dataset.apt = '1';
        bar.innerHTML = this._buildRAFPanelHTML(p, coords);
        bar.classList.add('adsb-sb-visible');
        bar.querySelector('#apt-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            bar.classList.remove('adsb-sb-visible');
            delete bar.dataset.apt;
            this.map.flyTo({ center: [-4.4815, 54.1453], zoom: 6, duration: 800 });
        });
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        try { this.map.setLayoutProperty('raf-circle', 'visibility', v); } catch (e) {}
        if (this._markers) {
            if (this.visible) this._markers.forEach(m => m.addTo(this.map));
            else              this._markers.forEach(m => m.remove());
        }
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

let rafControl = new RAFToggleControl();
// --- End RAF Bases ---

const roadsControl = new RoadsToggleControl();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new ResetViewControl(), 'top-right');
map.addControl(airportsControl, 'top-right');
map.addControl(rafControl, 'top-right');
map.addControl(roadsControl, 'top-right');


// Custom control for toggling city names
class NamesToggleControl {
    constructor() {
        this.namesVisible = _overlayStates.names;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.className = 'names-toggle-btn';
        this.button.title = 'Toggle city names';
        this.button.textContent = 'N';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.namesVisible ? '1' : '0.3';
        this.button.style.color = this.namesVisible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggleNames();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.applyNamesVisibility();
        } else {
            this.map.once('style.load', () => this.applyNamesVisibility());
        }

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    applyNamesVisibility() {
        const visibility = this.namesVisible ? 'visible' : 'none';
        const nameLayerIds = [
            'place_suburb', 'place_village', 'place_town',
            'place_city', 'place_state', 'place_country',
            'place_country_other', 'water_name'
        ];
        nameLayerIds.forEach(layerId => {
            try { this.map.setLayoutProperty(layerId, 'visibility', visibility); } catch (e) {}
        });
        this.button.style.opacity = this.namesVisible ? '1' : '0.3';
        this.button.style.color = this.namesVisible ? '#c8ff00' : '#ffffff';
    }

    toggleNames() {
        this.namesVisible = !this.namesVisible;
        this.applyNamesVisibility();
        _saveOverlayStates();
    }
}

const namesControl = new NamesToggleControl();
map.addControl(namesControl, 'top-right');


// Custom control for toggling range rings
class RangeRingsControl {
    constructor() {
        this.ringsVisible = _overlayStates.rings;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle range rings';
        this.button.textContent = '◎';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.ringsVisible ? '1' : '0.3';
        this.button.style.color = this.ringsVisible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggleRings();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.initRings();
        } else {
            this.map.once('style.load', () => this.initRings());
        }

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    initRings() {
        const center = rangeRingCenter || [this.map.getCenter().lng, this.map.getCenter().lat];
        const { lines } = buildRingsGeoJSON(center[0], center[1]);

        this.map.addSource('range-rings-lines', { type: 'geojson', data: lines });

        this.map.addLayer({
            id: 'range-rings-lines',
            type: 'line',
            source: 'range-rings-lines',
            layout: { visibility: this.ringsVisible ? 'visible' : 'none' },
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.18)',
                'line-width': 1,
                'line-dasharray': [4, 4]
            }
        });
    }

    updateCenter(lng, lat) {
        if (!this.map || !this.map.getSource('range-rings-lines')) return;
        const { lines } = buildRingsGeoJSON(lng, lat);
        this.map.getSource('range-rings-lines').setData(lines);
    }

    toggleRings() {
        this.ringsVisible = !this.ringsVisible;
        const v = this.ringsVisible ? 'visible' : 'none';
        try {
            this.map.setLayoutProperty('range-rings-lines', 'visibility', v);
        } catch (e) {}
        this.button.style.opacity = this.ringsVisible ? '1' : '0.3';
        this.button.style.color = this.ringsVisible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

rangeRingsControl = new RangeRingsControl();
map.addControl(rangeRingsControl, 'top-right');


// --- UK Air-to-Air Refuelling Areas (AARA) ---
const AARA_ZONES = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { name: 'AARA 1' }, geometry: { type: 'Polygon', coordinates: [[[-5.088365074181951,56.352238138492652],[-5.083764117213293,58.198396030948764],[-4.498163476713844,58.199659308641031],[-4.501404626758562,56.353744806541627],[-5.088365074181951,56.352238138492652]]] } },
        { type: 'Feature', properties: { name: 'AARA 2' }, geometry: { type: 'Polygon', coordinates: [[[0.076165363129638,59.471475898875568],[1.249977565369342,58.216920064522611],[0.683275823963647,58.065557613164508],[-0.510337170153988,59.318757432483984],[0.076165363129638,59.471475898875568]]] } },
        { type: 'Feature', properties: { name: 'AARA 3' }, geometry: { type: 'Polygon', coordinates: [[[2.763000169003503,56.410619614838616],[2.209197365754767,56.279540764525699],[0.833059793352215,57.887285079580522],[1.399380500103327,58.016976192554168],[2.763000169003503,56.410619614838616]]] } },
        { type: 'Feature', properties: { name: 'AARA 4' }, geometry: { type: 'Polygon', coordinates: [[[0.009888430453203,58.265001156921009],[0.245796401944195,57.962325382630432],[-1.48364629778834,57.586930017142379],[-1.713880123074511,57.885253852909756],[0.009888430453203,58.265001156921009]]] } },
        { type: 'Feature', properties: { name: 'AARA 5' }, geometry: { type: 'Polygon', coordinates: [[[1.648983233398319,55.700676076537725],[-0.266887922167109,55.716078010470717],[-0.249117785975959,56.05038664738899],[1.662807756310284,56.034020637899118],[1.648983233398319,55.700676076537725]]] } },
        { type: 'Feature', properties: { name: 'AARA 6' }, geometry: { type: 'Polygon', coordinates: [[[-0.888979216020673,54.685946295198093],[0.182428715729185,55.273420859516349],[0.615963571344907,55.000071180741919],[-0.42298296504882,54.399497542849417],[-0.888979216020673,54.685946295198093]]] } },
        { type: 'Feature', properties: { name: 'AARA 7' }, geometry: { type: 'Polygon', coordinates: [[[1.272194965444774,55.432271193080879],[2.981004479153495,55.002651035410231],[2.747163949550223,54.706050815046268],[1.026489842043924,55.137705793609207],[1.272194965444774,55.432271193080879]]] } },
        { type: 'Feature', properties: { name: 'AARA 8' }, geometry: { type: 'Polygon', coordinates: [[[0.646941706944172,53.267412628917178],[0.712941143792015,53.601038264679062],[2.49380611035347,53.451909143285022],[2.43027881134743,53.115238166804289],[0.646941706944172,53.267412628917178]]] } },
        { type: 'Feature', properties: { name: 'AARA 9' }, geometry: { type: 'Polygon', coordinates: [[[1.829801445849836,52.351593506021096],[1.832409169093755,52.668276984034001],[2.930839086765627,52.668728995449065],[2.662423325481778,52.346988817527794],[1.829801445849836,52.351593506021096]]] } },
        { type: 'Feature', properties: { name: 'AARA 10' }, geometry: { type: 'Polygon', coordinates: [[[-6.970582353354921,49.930187391178599],[-5.103551287431372,50.50873700417862],[-3.874332370448257,50.866775646014553],[-2.37767324305086,51.281683706901582],[-2.085079378774364,50.997600428328148],[-3.970074063135879,50.462998998344311],[-5.028174846663031,50.156055342535147],[-6.737269651042581,49.619307493381363],[-6.970582353354921,49.930187391178599]]] } },
        { type: 'Feature', properties: { name: 'AARA 11' }, geometry: { type: 'Polygon', coordinates: [[[-7.880583842363537,50.022940834503068],[-5.679004826372461,50.38118279720608],[-5.554682505855889,50.051300064529627],[-7.750727229788486,49.698193576565941],[-7.880583842363537,50.022940834503068]]] } },
        { type: 'Feature', properties: { name: 'AARA 12' }, geometry: { type: 'Polygon', coordinates: [[[-7.923778253456494,50.47642087194707],[-6.494485147102645,50.79708351437867],[-4.920935599925038,51.113438376857083],[-4.767679676475997,50.796877478848963],[-6.194606322717566,50.508514434236638],[-7.747809022378675,50.164036885157806],[-7.923778253456494,50.47642087194707]]] } },
        { type: 'Feature', properties: { name: 'AARA 13' }, geometry: { type: 'Polygon', coordinates: [[[-4.401595340401299,54.633188384147367],[-4.112366634756508,54.703326969135802],[-3.721158207149685,53.986234093288466],[-3.988165775285808,53.93397357863104],[-4.401595340401299,54.633188384147367]]] } },
        { type: 'Feature', properties: { name: 'AARA 14' }, geometry: { type: 'Polygon', coordinates: [[[-7.079642619439505,57.419213963635116],[-6.485810132507429,57.314292297450301],[-7.289368481965108,55.775330773683073],[-7.884826433877417,55.874332245930304],[-7.079642619439505,57.419213963635116]]] } }
    ]
};

class AARToggleControl {
    constructor() {
        this.visible = _overlayStates.aar;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle UK air-to-air refuelling areas';
        this.button.textContent = '=';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }

        return this.container;
    }

    onRemove() {
        if (this._labelMarkers) this._labelMarkers.forEach(m => m.remove());
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    initLayers() {
        const aarVis = this.visible ? 'visible' : 'none';

        this.map.addSource('aara-zones', { type: 'geojson', data: AARA_ZONES });

        this.map.addLayer({
            id: 'aara-fill',
            type: 'fill',
            source: 'aara-zones',
            layout: { visibility: aarVis },
            paint: { 'fill-color': 'rgba(200, 255, 0, 0.04)', 'fill-outline-color': 'rgba(0,0,0,0)' }
        });

        this.map.addLayer({
            id: 'aara-outline',
            type: 'line',
            source: 'aara-zones',
            layout: { visibility: aarVis },
            paint: { 'line-color': 'rgba(200, 255, 0, 0.75)', 'line-width': 1.5, 'line-dasharray': [6, 3] }
        });

        // Create HTML label markers once — DOM nodes survive style changes
        if (!this._labelMarkers) {
            this._labelMarkers = AARA_ZONES.features.map(f => {
                const coords = computeCentroid(f.geometry.coordinates);
                const rotate = computeTextRotate(f.geometry.coordinates);
                // MapLibre sets its positioning transform on the outer element —
                // put the rotation on an inner child so it isn't overwritten.
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'pointer-events:none;';
                const label = document.createElement('div');
                label.style.cssText = `color:#ffffff;font-family:monospace;font-size:10px;white-space:nowrap;text-align:center;transform:rotate(${rotate}deg);`;
                label.textContent = f.properties.name;
                wrapper.appendChild(label);
                return new maplibregl.Marker({ element: wrapper, anchor: 'center' })
                    .setLngLat(coords);
            });
            if (this.visible) this._labelMarkers.forEach(m => m.addTo(this.map));
        }
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        ['aara-fill', 'aara-outline'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', v); } catch (e) {}
        });
        if (this._labelMarkers) {
            if (this.visible) this._labelMarkers.forEach(m => m.addTo(this.map));
            else              this._labelMarkers.forEach(m => m.remove());
        }
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

const aarControl = new AARToggleControl();
map.addControl(aarControl, 'top-right');
// --- End UK AARA ---


// --- UK AWACS Orbits ---
const AWACS_ORBITS = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-7.0,51.166222],[-7.069101,51.16241],[-7.136069,51.151093],[-7.19884,51.13262],[-7.255485,51.10756],[-7.304272,51.076685],[-7.34372,51.040942],[-7.372641,51.00143],[-7.390178,50.959355],[-7.395828,50.916001],[-7.389452,50.872688],[-7.371276,50.830729],[-7.341882,50.791394],[-7.302182,50.75587],[-7.253395,50.725227],[-7.197001,50.700385],[-7.134704,50.68209],[-7.068375,50.670889],[-7.0,50.667118],[-6.931625,50.670889],[-6.865296,50.68209],[-6.802999,50.700385],[-6.746605,50.725227],[-6.697818,50.75587],[-6.658118,50.791394],[-6.628724,50.830729],[-6.610548,50.872688],[-6.604172,50.916001],[-6.609822,50.959355],[-6.627359,51.00143],[-6.65628,51.040942],[-6.695728,51.076685],[-6.744515,51.10756],[-6.80116,51.13262],[-6.863931,51.151093],[-6.930899,51.16241],[-7.0,51.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-6.5,51.166222],[-6.569101,51.16241],[-6.636069,51.151093],[-6.69884,51.13262],[-6.755485,51.10756],[-6.804272,51.076685],[-6.84372,51.040942],[-6.872641,51.00143],[-6.890178,50.959355],[-6.895828,50.916001],[-6.889452,50.872688],[-6.871276,50.830729],[-6.841882,50.791394],[-6.802182,50.75587],[-6.753395,50.725227],[-6.697001,50.700385],[-6.634704,50.68209],[-6.568375,50.670889],[-6.5,50.667118],[-6.431625,50.670889],[-6.365296,50.68209],[-6.302999,50.700385],[-6.246605,50.725227],[-6.197818,50.75587],[-6.158118,50.791394],[-6.128724,50.830729],[-6.110548,50.872688],[-6.104172,50.916001],[-6.109822,50.959355],[-6.127359,51.00143],[-6.15628,51.040942],[-6.195728,51.076685],[-6.244515,51.10756],[-6.30116,51.13262],[-6.363931,51.151093],[-6.430899,51.16241],[-6.5,51.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-6.0,51.166222],[-6.069101,51.16241],[-6.136069,51.151093],[-6.19884,51.13262],[-6.255485,51.10756],[-6.304272,51.076685],[-6.34372,51.040942],[-6.372641,51.00143],[-6.390178,50.959355],[-6.395828,50.916001],[-6.389452,50.872688],[-6.371276,50.830729],[-6.341882,50.791394],[-6.302182,50.75587],[-6.253395,50.725227],[-6.197001,50.700385],[-6.134704,50.68209],[-6.068375,50.670889],[-6.0,50.667118],[-5.931625,50.670889],[-5.865296,50.68209],[-5.802999,50.700385],[-5.746605,50.725227],[-5.697818,50.75587],[-5.658118,50.791394],[-5.628724,50.830729],[-5.610548,50.872688],[-5.604172,50.916001],[-5.609822,50.959355],[-5.627359,51.00143],[-5.65628,51.040942],[-5.695728,51.076685],[-5.744515,51.10756],[-5.80116,51.13262],[-5.863931,51.151093],[-5.930899,51.16241],[-6.0,51.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 04' }, geometry: { type: 'Polygon', coordinates: [[[-7.0,50.666222],[-7.068362,50.662411],[-7.134615,50.651095],[-7.196717,50.632623],[-7.25276,50.607565],[-7.301031,50.576692],[-7.340063,50.540951],[-7.368681,50.50144],[-7.386038,50.459366],[-7.391635,50.416013],[-7.385333,50.372699],[-7.367355,50.330739],[-7.338276,50.291403],[-7.298999,50.255877],[-7.250729,50.225232],[-7.19493,50.200388],[-7.133289,50.182091],[-7.067657,50.17089],[-7.0,50.167118],[-6.932343,50.17089],[-6.866711,50.182091],[-6.80507,50.200388],[-6.749271,50.225232],[-6.701001,50.255877],[-6.661724,50.291403],[-6.632645,50.330739],[-6.614667,50.372699],[-6.608365,50.416013],[-6.613962,50.459366],[-6.631319,50.50144],[-6.659937,50.540951],[-6.698969,50.576692],[-6.74724,50.607565],[-6.803283,50.632623],[-6.865385,50.651095],[-6.931638,50.662411],[-7.0,50.666222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 05' }, geometry: { type: 'Polygon', coordinates: [[[-6.5,50.666222],[-6.568362,50.662411],[-6.634615,50.651095],[-6.696717,50.632623],[-6.75276,50.607565],[-6.801031,50.576692],[-6.840063,50.540951],[-6.868681,50.50144],[-6.886038,50.459366],[-6.891635,50.416013],[-6.885333,50.372699],[-6.867355,50.330739],[-6.838276,50.291403],[-6.798999,50.255877],[-6.750729,50.225232],[-6.69493,50.200388],[-6.633289,50.182091],[-6.567657,50.17089],[-6.5,50.167118],[-6.432343,50.17089],[-6.366711,50.182091],[-6.30507,50.200388],[-6.249271,50.225232],[-6.201001,50.255877],[-6.161724,50.291403],[-6.132645,50.330739],[-6.114667,50.372699],[-6.108365,50.416013],[-6.113962,50.459366],[-6.131319,50.50144],[-6.159937,50.540951],[-6.198969,50.576692],[-6.24724,50.607565],[-6.303283,50.632623],[-6.365385,50.651095],[-6.431638,50.662411],[-6.5,50.666222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 06' }, geometry: { type: 'Polygon', coordinates: [[[-6.0,50.666222],[-6.068362,50.662411],[-6.134615,50.651095],[-6.196717,50.632623],[-6.25276,50.607565],[-6.301031,50.576692],[-6.340063,50.540951],[-6.368681,50.50144],[-6.386038,50.459366],[-6.391635,50.416013],[-6.385333,50.372699],[-6.367355,50.330739],[-6.338276,50.291403],[-6.298999,50.255877],[-6.250729,50.225232],[-6.19493,50.200388],[-6.133289,50.182091],[-6.067657,50.17089],[-6.0,50.167118],[-5.932343,50.17089],[-5.866711,50.182091],[-5.80507,50.200388],[-5.749271,50.225232],[-5.701001,50.255877],[-5.661724,50.291403],[-5.632645,50.330739],[-5.614667,50.372699],[-5.608365,50.416013],[-5.613962,50.459366],[-5.631319,50.50144],[-5.659937,50.540951],[-5.698969,50.576692],[-5.74724,50.607565],[-5.803283,50.632623],[-5.865385,50.651095],[-5.931638,50.662411],[-6.0,50.666222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 07' }, geometry: { type: 'Polygon', coordinates: [[[-7.0,50.166222],[-7.067645,50.162411],[-7.133203,50.151096],[-7.194654,50.132626],[-7.250112,50.10757],[-7.29788,50.076698],[-7.336508,50.04096],[-7.364833,50.00145],[-7.382015,49.959377],[-7.387559,49.916024],[-7.381329,49.87271],[-7.363544,49.830749],[-7.334771,49.791411],[-7.295905,49.755884],[-7.248137,49.725237],[-7.192917,49.700391],[-7.131913,49.682093],[-7.066959,49.67089],[-7.0,49.667118],[-6.933041,49.67089],[-6.868087,49.682093],[-6.807083,49.700391],[-6.751863,49.725237],[-6.704095,49.755884],[-6.665229,49.791411],[-6.636456,49.830749],[-6.618671,49.87271],[-6.612441,49.916024],[-6.617985,49.959377],[-6.635167,50.00145],[-6.663492,50.04096],[-6.70212,50.076698],[-6.749888,50.10757],[-6.805346,50.132626],[-6.866797,50.151096],[-6.932355,50.162411],[-7.0,50.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 08' }, geometry: { type: 'Polygon', coordinates: [[[-6.5,50.166222],[-6.567645,50.162411],[-6.633203,50.151096],[-6.694654,50.132626],[-6.750112,50.10757],[-6.79788,50.076698],[-6.836508,50.04096],[-6.864833,50.00145],[-6.882015,49.959377],[-6.887559,49.916024],[-6.881329,49.87271],[-6.863544,49.830749],[-6.834771,49.791411],[-6.795905,49.755884],[-6.748137,49.725237],[-6.692917,49.700391],[-6.631913,49.682093],[-6.566959,49.67089],[-6.5,49.667118],[-6.433041,49.67089],[-6.368087,49.682093],[-6.307083,49.700391],[-6.251863,49.725237],[-6.204095,49.755884],[-6.165229,49.791411],[-6.136456,49.830749],[-6.118671,49.87271],[-6.112441,49.916024],[-6.117985,49.959377],[-6.135167,50.00145],[-6.163492,50.04096],[-6.20212,50.076698],[-6.249888,50.10757],[-6.305346,50.132626],[-6.366797,50.151096],[-6.432355,50.162411],[-6.5,50.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 09' }, geometry: { type: 'Polygon', coordinates: [[[-6.0,50.166222],[-6.067645,50.162411],[-6.133203,50.151096],[-6.194654,50.132626],[-6.250112,50.10757],[-6.29788,50.076698],[-6.336508,50.04096],[-6.364833,50.00145],[-6.382015,49.959377],[-6.387559,49.916024],[-6.381329,49.87271],[-6.363544,49.830749],[-6.334771,49.791411],[-6.295905,49.755884],[-6.248137,49.725237],[-6.192917,49.700391],[-6.131913,49.682093],[-6.066959,49.67089],[-6.0,49.667118],[-5.933041,49.67089],[-5.868087,49.682093],[-5.807083,49.700391],[-5.751863,49.725237],[-5.704095,49.755884],[-5.665229,49.791411],[-5.636456,49.830749],[-5.618671,49.87271],[-5.612441,49.916024],[-5.617985,49.959377],[-5.635167,50.00145],[-5.663492,50.04096],[-5.70212,50.076698],[-5.749888,50.10757],[-5.805346,50.132626],[-5.866797,50.151096],[-5.932355,50.162411],[-6.0,50.166222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-4.25,51.582882],[-4.319732,51.57907],[-4.387312,51.567752],[-4.450655,51.549278],[-4.507816,51.524216],[-4.557045,51.493339],[-4.596848,51.457595],[-4.626027,51.418081],[-4.643719,51.376005],[-4.649414,51.332651],[-4.642975,51.289338],[-4.62463,51.24738],[-4.594966,51.208046],[-4.554904,51.172524],[-4.505675,51.141883],[-4.448773,51.117043],[-4.385915,51.098749],[-4.318989,51.087549],[-4.25,51.083778],[-4.181011,51.087549],[-4.114085,51.098749],[-4.051227,51.117043],[-3.994325,51.141883],[-3.945096,51.172524],[-3.905034,51.208046],[-3.87537,51.24738],[-3.857025,51.289338],[-3.850586,51.332651],[-3.856281,51.376005],[-3.873973,51.418081],[-3.903152,51.457595],[-3.942955,51.493339],[-3.992184,51.524216],[-4.049345,51.549278],[-4.112688,51.567752],[-4.180268,51.57907],[-4.25,51.582882]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-3.966667,51.599642],[-4.022475,51.596595],[-4.076565,51.587551],[-4.127274,51.572785],[-4.173049,51.552754],[-4.212491,51.528071],[-4.2444,51.499493],[-4.267817,51.467896],[-4.282043,51.434244],[-4.286665,51.399564],[-4.281565,51.36491],[-4.266919,51.331335],[-4.243191,51.299853],[-4.211115,51.271418],[-4.171674,51.246886],[-4.126065,51.226997],[-4.075667,51.212348],[-4.021997,51.203378],[-3.966667,51.200358],[-3.911337,51.203378],[-3.857667,51.212348],[-3.807269,51.226997],[-3.76166,51.246886],[-3.722219,51.271418],[-3.690143,51.299853],[-3.666415,51.331335],[-3.651769,51.36491],[-3.646669,51.399564],[-3.651291,51.434244],[-3.665517,51.467896],[-3.688934,51.499493],[-3.720843,51.528071],[-3.760285,51.552754],[-3.80606,51.572785],[-3.856769,51.587551],[-3.910859,51.596595],[-3.966667,51.599642]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-4.5,51.449642],[-4.555624,51.446595],[-4.609536,51.437551],[-4.66008,51.422786],[-4.705705,51.402755],[-4.745017,51.378072],[-4.776823,51.349495],[-4.800164,51.317898],[-4.814345,51.284247],[-4.818953,51.249567],[-4.813871,51.214913],[-4.799274,51.181337],[-4.775624,51.149855],[-4.743653,51.121419],[-4.704341,51.096887],[-4.65888,51.076997],[-4.608646,51.062348],[-4.55515,51.053378],[-4.5,51.050358],[-4.44485,51.053378],[-4.391354,51.062348],[-4.34112,51.076997],[-4.295659,51.096887],[-4.256347,51.121419],[-4.224376,51.149855],[-4.200726,51.181337],[-4.186129,51.214913],[-4.181047,51.249567],[-4.185655,51.284247],[-4.199836,51.317898],[-4.223177,51.349495],[-4.254983,51.378072],[-4.294295,51.402755],[-4.33992,51.422786],[-4.390464,51.437551],[-4.444376,51.446595],[-4.5,51.449642]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[0.113889,52.882972],[0.056444,52.879925],[0.000768,52.870878],[-0.051427,52.85611],[-0.098539,52.836075],[-0.139129,52.811388],[-0.171964,52.782808],[-0.196055,52.751208],[-0.210685,52.717554],[-0.215431,52.682874],[-0.210171,52.64822],[-0.195088,52.614646],[-0.170661,52.583168],[-0.137647,52.554736],[-0.097056,52.530208],[-0.050123,52.510322],[0.001736,52.495675],[0.056959,52.486708],[0.113889,52.483688],[0.170819,52.486708],[0.226042,52.495675],[0.277901,52.510322],[0.324834,52.530208],[0.365425,52.554736],[0.398439,52.583168],[0.422866,52.614646],[0.437949,52.64822],[0.443209,52.682874],[0.438463,52.717554],[0.423833,52.751208],[0.399742,52.782808],[0.366907,52.811388],[0.326317,52.836075],[0.279205,52.85611],[0.22701,52.870878],[0.171334,52.879925],[0.113889,52.882972]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[0.863889,52.813565],[0.811315,52.810773],[0.760358,52.802483],[0.712584,52.788951],[0.669456,52.770591],[0.632293,52.747968],[0.602224,52.721775],[0.580154,52.692813],[0.566741,52.661967],[0.562376,52.630177],[0.567172,52.598411],[0.580964,52.567631],[0.603316,52.538771],[0.633535,52.512703],[0.670698,52.490213],[0.713676,52.471978],[0.761168,52.458547],[0.811746,52.450324],[0.863889,52.447555],[0.916032,52.450324],[0.96661,52.458547],[1.014102,52.471978],[1.05708,52.490213],[1.094243,52.512703],[1.124462,52.538771],[1.146814,52.567631],[1.160606,52.598411],[1.165402,52.630177],[1.161037,52.661967],[1.147624,52.692813],[1.125554,52.721775],[1.095485,52.747968],[1.058322,52.770591],[1.015194,52.788951],[0.96742,52.802483],[0.916463,52.810773],[0.863889,52.813565]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[1.080556,52.796895],[1.028002,52.794103],[0.977065,52.785813],[0.929309,52.772281],[0.886198,52.753921],[0.849049,52.731298],[0.818991,52.705105],[0.796929,52.676143],[0.783521,52.645297],[0.779158,52.613508],[0.783952,52.581741],[0.797739,52.550962],[0.820082,52.522101],[0.85029,52.496033],[0.887438,52.473543],[0.9304,52.455308],[0.977874,52.441877],[1.028433,52.433654],[1.080556,52.430885],[1.132679,52.433654],[1.183238,52.441877],[1.230712,52.455308],[1.273674,52.473543],[1.310822,52.496033],[1.34103,52.522101],[1.363373,52.550962],[1.37716,52.581741],[1.381954,52.613508],[1.377591,52.645297],[1.364183,52.676143],[1.342121,52.705105],[1.312063,52.731298],[1.274914,52.753921],[1.231803,52.772281],[1.184047,52.785813],[1.13311,52.794103],[1.080556,52.796895]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-1.391667,54.502445],[-1.446391,54.499652],[-1.49943,54.49136],[-1.549153,54.477825],[-1.594037,54.459461],[-1.632709,54.436834],[-1.663995,54.410636],[-1.686952,54.381671],[-1.700896,54.350823],[-1.705424,54.319033],[-1.700419,54.287267],[-1.686054,54.25649],[-1.662786,54.227633],[-1.631334,54.201569],[-1.592662,54.179083],[-1.547945,54.160852],[-1.498532,54.147424],[-1.445913,54.139203],[-1.391667,54.136435],[-1.337421,54.139203],[-1.284802,54.147424],[-1.235389,54.160852],[-1.190672,54.179083],[-1.152,54.201569],[-1.120548,54.227633],[-1.09728,54.25649],[-1.082915,54.287267],[-1.07791,54.319033],[-1.082438,54.350823],[-1.096382,54.381671],[-1.119339,54.410636],[-1.150625,54.436834],[-1.189297,54.459461],[-1.234181,54.477825],[-1.283904,54.49136],[-1.336943,54.499652],[-1.391667,54.502445]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-0.958333,54.141312],[-1.017509,54.138264],[-1.074862,54.129216],[-1.128627,54.114445],[-1.177153,54.094406],[-1.218957,54.069716],[-1.252771,54.041132],[-1.277574,54.009529],[-1.292631,53.975874],[-1.297506,53.941192],[-1.292076,53.90654],[-1.276531,53.872968],[-1.251365,53.841492],[-1.217359,53.813064],[-1.175554,53.788539],[-1.127221,53.768656],[-1.073819,53.754013],[-1.016954,53.745047],[-0.958333,53.742028],[-0.899712,53.745047],[-0.842847,53.754013],[-0.789445,53.768656],[-0.741112,53.788539],[-0.699307,53.813064],[-0.665301,53.841492],[-0.640135,53.872968],[-0.62459,53.90654],[-0.61916,53.941192],[-0.624035,53.975874],[-0.639092,54.009529],[-0.663895,54.041132],[-0.697709,54.069716],[-0.739513,54.094406],[-0.788039,54.114445],[-0.841804,54.129216],[-0.899157,54.138264],[-0.958333,54.141312]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-2.15,55.732915],[-2.221826,55.729356],[-2.291431,55.718788],[-2.356667,55.701537],[-2.415527,55.678137],[-2.46621,55.649309],[-2.507177,55.615939],[-2.537196,55.579052],[-2.55538,55.539776],[-2.561211,55.499311],[-2.554548,55.458887],[-2.535633,55.419731],[-2.505071,55.383028],[-2.463815,55.349883],[-2.413132,55.321294],[-2.35456,55.298118],[-2.289867,55.281051],[-2.220994,55.270603],[-2.15,55.267085],[-2.079006,55.270603],[-2.010133,55.281051],[-1.94544,55.298118],[-1.886868,55.321294],[-1.836185,55.349883],[-1.794929,55.383028],[-1.764367,55.419731],[-1.745452,55.458887],[-1.738789,55.499311],[-1.74462,55.539776],[-1.762804,55.579052],[-1.792823,55.615939],[-1.83379,55.649309],[-1.884473,55.678137],[-1.943333,55.701537],[-2.008569,55.718788],[-2.078174,55.729356],[-2.15,55.732915]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[2.55,55.749642],[2.488408,55.746593],[2.428715,55.737542],[2.372761,55.722767],[2.322262,55.702724],[2.278764,55.678028],[2.243587,55.649439],[2.21779,55.617833],[2.202139,55.584175],[2.197084,55.549493],[2.202752,55.514841],[2.218942,55.481272],[2.245139,55.4498],[2.280529,55.421376],[2.324028,55.396857],[2.374313,55.376979],[2.429868,55.362339],[2.489021,55.353376],[2.55,55.350358],[2.610979,55.353376],[2.670132,55.362339],[2.725687,55.376979],[2.775972,55.396857],[2.819471,55.421376],[2.854861,55.4498],[2.881058,55.481272],[2.897248,55.514841],[2.902916,55.549493],[2.897861,55.584175],[2.88221,55.617833],[2.856413,55.649439],[2.821236,55.678028],[2.777738,55.702724],[2.727239,55.722767],[2.671285,55.737542],[2.611592,55.746593],[2.55,55.749642]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[3.35,55.582972],[3.28867,55.579923],[3.229231,55.570872],[3.173513,55.556098],[3.123228,55.536055],[3.079913,55.51136],[3.044884,55.482772],[3.019195,55.451166],[3.003608,55.417508],[2.998573,55.382826],[3.004215,55.348174],[3.020335,55.314605],[3.04642,55.283132],[3.08166,55.254708],[3.124975,55.230188],[3.17505,55.21031],[3.230371,55.19567],[3.289276,55.186706],[3.35,55.183688],[3.410724,55.186706],[3.469629,55.19567],[3.52495,55.21031],[3.575025,55.230188],[3.61834,55.254708],[3.65358,55.283132],[3.679665,55.314605],[3.695785,55.348174],[3.701427,55.382826],[3.696392,55.417508],[3.680805,55.451166],[3.655116,55.482772],[3.620087,55.51136],[3.576772,55.536055],[3.526487,55.556098],[3.470769,55.570872],[3.41133,55.579923],[3.35,55.582972]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[3.1,55.749462],[3.007616,55.744878],[2.918103,55.731269],[2.834235,55.709056],[2.758601,55.678929],[2.693521,55.64182],[2.640971,55.598875],[2.602525,55.551416],[2.57931,55.500897],[2.571974,55.448863],[2.58068,55.396898],[2.605101,55.346577],[2.644442,55.29942],[2.697468,55.256846],[2.762548,55.220132],[2.837706,55.190376],[2.920679,55.168466],[3.008987,55.155053],[3.1,55.150538],[3.191013,55.155053],[3.279321,55.168466],[3.362294,55.190376],[3.437452,55.220132],[3.502532,55.256846],[3.555558,55.29942],[3.594899,55.346577],[3.61932,55.396898],[3.628026,55.448863],[3.62069,55.500897],[3.597475,55.551416],[3.559029,55.598875],[3.506479,55.64182],[3.441399,55.678929],[3.365765,55.709056],[3.281897,55.731269],[3.192384,55.744878],[3.1,55.749462]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-9.0,56.849406],[-9.105645,56.844306],[-9.207995,56.829167],[-9.303869,56.804459],[-9.390299,56.770952],[-9.464631,56.729686],[-9.524608,56.681937],[-9.568439,56.629178],[-9.594846,56.57303],[-9.603101,56.515209],[-9.593035,56.457477],[-9.565035,56.401582],[-9.520023,56.349212],[-9.459417,56.30194],[-9.385084,56.261181],[-9.299283,56.22815],[-9.204592,56.203831],[-9.103833,56.188945],[-9.0,56.183934],[-8.896167,56.188945],[-8.795408,56.203831],[-8.700717,56.22815],[-8.614916,56.261181],[-8.540583,56.30194],[-8.479977,56.349212],[-8.434965,56.401582],[-8.406965,56.457477],[-8.396899,56.515209],[-8.405154,56.57303],[-8.431561,56.629178],[-8.475392,56.681937],[-8.535369,56.729686],[-8.609701,56.770952],[-8.696131,56.804459],[-8.792005,56.829167],[-8.894355,56.844306],[-9.0,56.849406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-8.0,56.782736],[-8.105457,56.777637],[-8.207626,56.762497],[-8.30333,56.73779],[-8.389607,56.704284],[-8.463809,56.663018],[-8.523682,56.61527],[-8.567437,56.562511],[-8.5938,56.506364],[-8.602042,56.448543],[-8.591997,56.39081],[-8.564048,56.334916],[-8.519116,56.282545],[-8.458617,56.235272],[-8.384415,56.194512],[-8.298764,56.161481],[-8.204237,56.137162],[-8.103653,56.122276],[-8.0,56.117264],[-7.896347,56.122276],[-7.795763,56.137162],[-7.701236,56.161481],[-7.615585,56.194512],[-7.541383,56.235272],[-7.480884,56.282545],[-7.435952,56.334916],[-7.408003,56.39081],[-7.397958,56.448543],[-7.4062,56.506364],[-7.432563,56.562511],[-7.476318,56.61527],[-7.536191,56.663018],[-7.610393,56.704284],[-7.69667,56.73779],[-7.792374,56.762497],[-7.894543,56.777637],[-8.0,56.782736]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-9.0,56.249406],[-9.103983,56.244307],[-9.204727,56.229171],[-9.299099,56.204468],[-9.384179,56.170966],[-9.457357,56.129705],[-9.51641,56.081962],[-9.559573,56.029207],[-9.585588,55.973062],[-9.593735,55.915242],[-9.583845,55.857509],[-9.556298,55.801611],[-9.511997,55.749236],[-9.452339,55.701959],[-9.379161,55.661194],[-9.294685,55.628158],[-9.201451,55.603835],[-9.10224,55.588946],[-9.0,55.583934],[-8.89776,55.588946],[-8.798549,55.603835],[-8.705315,55.628158],[-8.620839,55.661194],[-8.547661,55.701959],[-8.488003,55.749236],[-8.443702,55.801611],[-8.416155,55.857509],[-8.406265,55.915242],[-8.414412,55.973062],[-8.440427,56.029207],[-8.48359,56.081962],[-8.542643,56.129705],[-8.615821,56.170966],[-8.700901,56.204468],[-8.795273,56.229171],[-8.896017,56.244307],[-9.0,56.249406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 04' }, geometry: { type: 'Polygon', coordinates: [[[-7.833333,56.249406],[-7.937316,56.244307],[-8.03806,56.229171],[-8.132432,56.204468],[-8.217512,56.170966],[-8.29069,56.129705],[-8.349743,56.081962],[-8.392906,56.029207],[-8.418921,55.973062],[-8.427068,55.915242],[-8.417178,55.857509],[-8.389631,55.801611],[-8.34533,55.749236],[-8.285672,55.701959],[-8.212494,55.661194],[-8.128018,55.628158],[-8.034784,55.603835],[-7.935573,55.588946],[-7.833333,55.583934],[-7.731093,55.588946],[-7.631882,55.603835],[-7.538648,55.628158],[-7.454172,55.661194],[-7.380994,55.701959],[-7.321336,55.749236],[-7.277035,55.801611],[-7.249488,55.857509],[-7.239598,55.915242],[-7.247745,55.973062],[-7.27376,56.029207],[-7.316923,56.081962],[-7.375976,56.129705],[-7.449154,56.170966],[-7.534234,56.204468],[-7.628606,56.229171],[-7.72935,56.244307],[-7.833333,56.249406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-0.25,57.499406],[-0.357519,57.494305],[-0.461683,57.479163],[-0.559251,57.45445],[-0.647203,57.420937],[-0.722837,57.379664],[-0.783856,57.331909],[-0.828439,57.279146],[-0.855288,57.222994],[-0.863664,57.165173],[-0.853399,57.107442],[-0.824889,57.05155],[-0.779073,56.999185],[-0.717398,56.951919],[-0.641764,56.911166],[-0.554468,56.878141],[-0.458132,56.853827],[-0.355629,56.838944],[-0.25,56.833934],[-0.144371,56.838944],[-0.041868,56.853827],[0.054468,56.878141],[0.141764,56.911166],[0.217398,56.951919],[0.279073,56.999185],[0.324889,57.05155],[0.353399,57.107442],[0.363664,57.165173],[0.355288,57.222994],[0.328439,57.279146],[0.283856,57.331909],[0.222837,57.379664],[0.147203,57.420937],[0.059251,57.45445],[-0.038317,57.479163],[-0.142481,57.494305],[-0.25,57.499406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-0.733333,56.849406],[-0.838978,56.844306],[-0.941328,56.829167],[-1.037202,56.804459],[-1.123632,56.770952],[-1.197964,56.729686],[-1.257941,56.681937],[-1.301772,56.629178],[-1.328179,56.57303],[-1.336434,56.515209],[-1.326368,56.457477],[-1.298368,56.401582],[-1.253356,56.349212],[-1.19275,56.30194],[-1.118417,56.261181],[-1.032616,56.22815],[-0.937925,56.203831],[-0.837166,56.188945],[-0.733333,56.183934],[-0.6295,56.188945],[-0.528741,56.203831],[-0.43405,56.22815],[-0.348249,56.261181],[-0.273916,56.30194],[-0.21331,56.349212],[-0.168298,56.401582],[-0.140298,56.457477],[-0.130232,56.515209],[-0.138487,56.57303],[-0.164894,56.629178],[-0.208725,56.681937],[-0.268702,56.729686],[-0.343034,56.770952],[-0.429464,56.804459],[-0.525338,56.829167],[-0.627688,56.844306],[-0.733333,56.849406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[0.4,56.849406],[0.294355,56.844306],[0.192005,56.829167],[0.096131,56.804459],[0.009701,56.770952],[-0.064631,56.729686],[-0.124608,56.681937],[-0.168439,56.629178],[-0.194846,56.57303],[-0.203101,56.515209],[-0.193035,56.457477],[-0.165035,56.401582],[-0.120023,56.349212],[-0.059417,56.30194],[0.014916,56.261181],[0.100717,56.22815],[0.195408,56.203831],[0.296167,56.188945],[0.4,56.183934],[0.503833,56.188945],[0.604592,56.203831],[0.699283,56.22815],[0.785084,56.261181],[0.859417,56.30194],[0.920023,56.349212],[0.965035,56.401582],[0.993035,56.457477],[1.003101,56.515209],[0.994846,56.57303],[0.968439,56.629178],[0.924608,56.681937],[0.864631,56.729686],[0.790299,56.770952],[0.703869,56.804459],[0.607995,56.829167],[0.505645,56.844306],[0.4,56.849406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-2.866667,57.616222],[-2.947568,57.612405],[-3.025961,57.601072],[-3.099422,57.582575],[-3.165685,57.557485],[-3.222721,57.526578],[-3.268798,57.490807],[-3.302534,57.45127],[-3.322936,57.40918],[-3.329427,57.365821],[-3.321859,57.322514],[-3.300511,57.280571],[-3.266073,57.24126],[-3.219622,57.205766],[-3.162585,57.175153],[-3.096696,57.150341],[-3.023938,57.132069],[-2.946491,57.120884],[-2.866667,57.117118],[-2.786843,57.120884],[-2.709396,57.132069],[-2.636638,57.150341],[-2.570749,57.175153],[-2.513712,57.205766],[-2.467261,57.24126],[-2.432823,57.280571],[-2.411475,57.322514],[-2.403907,57.365821],[-2.410398,57.40918],[-2.4308,57.45127],[-2.464536,57.490807],[-2.510613,57.526578],[-2.567649,57.557485],[-2.633912,57.582575],[-2.707373,57.601072],[-2.785766,57.612405],[-2.866667,57.616222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-3.833333,57.499552],[-3.913975,57.495735],[-3.992118,57.484403],[-4.065344,57.465906],[-4.131397,57.440817],[-4.188252,57.409911],[-4.234184,57.37414],[-4.267815,57.334604],[-4.288154,57.292514],[-4.294627,57.249155],[-4.287085,57.205847],[-4.265807,57.163904],[-4.231479,57.124593],[-4.185176,57.089098],[-4.128321,57.058485],[-4.062639,57.033672],[-3.99011,57.0154],[-3.912907,57.004214],[-3.833333,57.000448],[-3.753759,57.004214],[-3.676556,57.0154],[-3.604027,57.033672],[-3.538345,57.058485],[-3.48149,57.089098],[-3.435187,57.124593],[-3.400859,57.163904],[-3.379581,57.205847],[-3.372039,57.249155],[-3.378512,57.292514],[-3.398851,57.334604],[-3.432482,57.37414],[-3.478414,57.409911],[-3.535269,57.440817],[-3.601322,57.465906],[-3.674548,57.484403],[-3.752691,57.495735],[-3.833333,57.499552]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-3.416667,56.882882],[-3.495974,56.879066],[-3.572825,56.867735],[-3.644842,56.849241],[-3.709807,56.824155],[-3.76573,56.793252],[-3.810913,56.757485],[-3.844,56.717951],[-3.864016,56.675863],[-3.870395,56.632505],[-3.86299,56.589196],[-3.842071,56.547251],[-3.808314,56.507937],[-3.762775,56.472439],[-3.706851,56.441823],[-3.642243,56.417007],[-3.570896,56.398732],[-3.494948,56.387545],[-3.416667,56.383778],[-3.338386,56.387545],[-3.262438,56.398732],[-3.191091,56.417007],[-3.126483,56.441823],[-3.070559,56.472439],[-3.02502,56.507937],[-2.991263,56.547251],[-2.970344,56.589196],[-2.962939,56.632505],[-2.969318,56.675863],[-2.989334,56.717951],[-3.022421,56.757485],[-3.067604,56.793252],[-3.123527,56.824155],[-3.188492,56.849241],[-3.260509,56.867735],[-3.33736,56.879066],[-3.416667,56.882882]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-2.416667,58.982882],[-2.500754,58.979064],[-2.582231,58.967727],[-2.658576,58.949223],[-2.727434,58.924126],[-2.786694,58.893211],[-2.834556,58.857432],[-2.869587,58.817889],[-2.890757,58.775795],[-2.897471,58.732435],[-2.889578,58.689129],[-2.86737,58.64719],[-2.83157,58.607885],[-2.783297,58.572399],[-2.724037,58.541795],[-2.655589,58.516989],[-2.580014,58.498724],[-2.499574,58.487542],[-2.416667,58.483778],[-2.33376,58.487542],[-2.25332,58.498724],[-2.177745,58.516989],[-2.109297,58.541795],[-2.050037,58.572399],[-2.001764,58.607885],[-1.965964,58.64719],[-1.943756,58.689129],[-1.935863,58.732435],[-1.942577,58.775795],[-1.963747,58.817889],[-1.998778,58.857432],[-2.04664,58.893211],[-2.1059,58.924126],[-2.174758,58.949223],[-2.251103,58.967727],[-2.33258,58.979064],[-2.416667,58.982882]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-1.166667,58.982882],[-1.250754,58.979064],[-1.332231,58.967727],[-1.408576,58.949223],[-1.477434,58.924126],[-1.536694,58.893211],[-1.584556,58.857432],[-1.619587,58.817889],[-1.640757,58.775795],[-1.647471,58.732435],[-1.639578,58.689129],[-1.61737,58.64719],[-1.58157,58.607885],[-1.533297,58.572399],[-1.474037,58.541795],[-1.405589,58.516989],[-1.330014,58.498724],[-1.249574,58.487542],[-1.166667,58.483778],[-1.08376,58.487542],[-1.00332,58.498724],[-0.927745,58.516989],[-0.859297,58.541795],[-0.800037,58.572399],[-0.751764,58.607885],[-0.715964,58.64719],[-0.693756,58.689129],[-0.685863,58.732435],[-0.692577,58.775795],[-0.713747,58.817889],[-0.748778,58.857432],[-0.79664,58.893211],[-0.8559,58.924126],[-0.924758,58.949223],[-1.001103,58.967727],[-1.08258,58.979064],[-1.166667,58.982882]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-2.25,58.349552],[-2.332574,58.345734],[-2.412587,58.334399],[-2.487562,58.315899],[-2.555188,58.290805],[-2.613392,58.259894],[-2.660407,58.224119],[-2.694823,58.184579],[-2.715628,58.142486],[-2.722237,58.099127],[-2.714498,58.05582],[-2.692699,58.013879],[-2.657545,57.974572],[-2.610138,57.939081],[-2.551933,57.908474],[-2.4847,57.883665],[-2.410463,57.865396],[-2.331444,57.854213],[-2.25,57.850448],[-2.168556,57.854213],[-2.089537,57.865396],[-2.0153,57.883665],[-1.948067,57.908474],[-1.889862,57.939081],[-1.842455,57.974572],[-1.807301,58.013879],[-1.785502,58.05582],[-1.777763,58.099127],[-1.784372,58.142486],[-1.805177,58.184579],[-1.839593,58.224119],[-1.886608,58.259894],[-1.944812,58.290805],[-2.012438,58.315899],[-2.087413,58.334399],[-2.167426,58.345734],[-2.25,58.349552]]] } },
        { type: 'Feature', properties: { name: 'Lobe 04' }, geometry: { type: 'Polygon', coordinates: [[[-0.833333,58.349552],[-0.915907,58.345734],[-0.99592,58.334399],[-1.070895,58.315899],[-1.138521,58.290805],[-1.196725,58.259894],[-1.24374,58.224119],[-1.278156,58.184579],[-1.298961,58.142486],[-1.30557,58.099127],[-1.297831,58.05582],[-1.276032,58.013879],[-1.240878,57.974572],[-1.193471,57.939081],[-1.135266,57.908474],[-1.068033,57.883665],[-0.993796,57.865396],[-0.914777,57.854213],[-0.833333,57.850448],[-0.751889,57.854213],[-0.67287,57.865396],[-0.598633,57.883665],[-0.5314,57.908474],[-0.473195,57.939081],[-0.425788,57.974572],[-0.390634,58.013879],[-0.368835,58.05582],[-0.361096,58.099127],[-0.367705,58.142486],[-0.38851,58.184579],[-0.422926,58.224119],[-0.469941,58.259894],[-0.528145,58.290805],[-0.595771,58.315899],[-0.670746,58.334399],[-0.750759,58.345734],[-0.833333,58.349552]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-9.0,59.966066],[-9.115421,59.960961],[-9.227232,59.945805],[-9.331944,59.921072],[-9.42631,59.887533],[-9.507428,59.846234],[-9.572835,59.798454],[-9.620583,59.745671],[-9.649288,59.689507],[-9.658168,59.631681],[-9.647056,59.573955],[-9.61639,59.518077],[-9.567186,59.465732],[-9.501004,59.418491],[-9.419885,59.377764],[-9.326294,59.344764],[-9.223038,59.32047],[-9.11319,59.3056],[-9.0,59.300594],[-8.88681,59.3056],[-8.776962,59.32047],[-8.673706,59.344764],[-8.580115,59.377764],[-8.498996,59.418491],[-8.432814,59.465732],[-8.38361,59.518077],[-8.352944,59.573955],[-8.341832,59.631681],[-8.350712,59.689507],[-8.379417,59.745671],[-8.427165,59.798454],[-8.492572,59.846234],[-8.57369,59.887533],[-8.668056,59.921072],[-8.772768,59.945805],[-8.884579,59.960961],[-9.0,59.966066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-7.0,59.966066],[-7.115421,59.960961],[-7.227232,59.945805],[-7.331944,59.921072],[-7.42631,59.887533],[-7.507428,59.846234],[-7.572835,59.798454],[-7.620583,59.745671],[-7.649288,59.689507],[-7.658168,59.631681],[-7.647056,59.573955],[-7.61639,59.518077],[-7.567186,59.465732],[-7.501004,59.418491],[-7.419885,59.377764],[-7.326294,59.344764],[-7.223038,59.32047],[-7.11319,59.3056],[-7.0,59.300594],[-6.88681,59.3056],[-6.776962,59.32047],[-6.673706,59.344764],[-6.580115,59.377764],[-6.498996,59.418491],[-6.432814,59.465732],[-6.38361,59.518077],[-6.352944,59.573955],[-6.341832,59.631681],[-6.350712,59.689507],[-6.379417,59.745671],[-6.427165,59.798454],[-6.492572,59.846234],[-6.57369,59.887533],[-6.668056,59.921072],[-6.772768,59.945805],[-6.884579,59.960961],[-7.0,59.966066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-9.0,59.066066],[-9.112382,59.060962],[-9.221253,59.045812],[-9.323219,59.021086],[-9.415119,58.987558],[-9.494129,58.946268],[-9.55785,58.898498],[-9.604382,58.845722],[-9.632375,58.789563],[-9.641063,58.731739],[-9.630278,58.674011],[-9.600441,58.618128],[-9.552541,58.565775],[-9.488091,58.518524],[-9.40908,58.477787],[-9.317908,58.444778],[-9.217312,58.420476],[-9.110285,58.405602],[-9.0,58.400594],[-8.889715,58.405602],[-8.782688,58.420476],[-8.682092,58.444778],[-8.59092,58.477787],[-8.511909,58.518524],[-8.447459,58.565775],[-8.399559,58.618128],[-8.369722,58.674011],[-8.358937,58.731739],[-8.367625,58.789563],[-8.395618,58.845722],[-8.44215,58.898498],[-8.505871,58.946268],[-8.584881,58.987558],[-8.676781,59.021086],[-8.778747,59.045812],[-8.887618,59.060962],[-9.0,59.066066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 04' }, geometry: { type: 'Polygon', coordinates: [[[-7.0,59.066066],[-7.112382,59.060962],[-7.221253,59.045812],[-7.323219,59.021086],[-7.415119,58.987558],[-7.494129,58.946268],[-7.55785,58.898498],[-7.604382,58.845722],[-7.632375,58.789563],[-7.641063,58.731739],[-7.630278,58.674011],[-7.600441,58.618128],[-7.552541,58.565775],[-7.488091,58.518524],[-7.40908,58.477787],[-7.317908,58.444778],[-7.217312,58.420476],[-7.110285,58.405602],[-7.0,58.400594],[-6.889715,58.405602],[-6.782688,58.420476],[-6.682092,58.444778],[-6.59092,58.477787],[-6.511909,58.518524],[-6.447459,58.565775],[-6.399559,58.618128],[-6.369722,58.674011],[-6.358937,58.731739],[-6.367625,58.789563],[-6.395618,58.845722],[-6.44215,58.898498],[-6.505871,58.946268],[-6.584881,58.987558],[-6.676781,59.021086],[-6.778747,59.045812],[-6.887618,59.060962],[-7.0,59.066066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[-5.25,60.749406],[-5.368227,60.744299],[-5.482753,60.729138],[-5.590002,60.704398],[-5.686644,60.670851],[-5.769707,60.629543],[-5.83667,60.581754],[-5.885538,60.528964],[-5.914899,60.472795],[-5.923956,60.414968],[-5.912541,60.357244],[-5.881107,60.301371],[-5.830699,60.249033],[-5.762917,60.2018],[-5.679854,60.161082],[-5.58403,60.128091],[-5.478321,60.103803],[-5.365869,60.088938],[-5.25,60.083934],[-5.134131,60.088938],[-5.021679,60.103803],[-4.91597,60.128091],[-4.820146,60.161082],[-4.737083,60.2018],[-4.669301,60.249033],[-4.618893,60.301371],[-4.587459,60.357244],[-4.576044,60.414968],[-4.585101,60.472795],[-4.614462,60.528964],[-4.66333,60.581754],[-4.730293,60.629543],[-4.813356,60.670851],[-4.909998,60.704398],[-5.017247,60.729138],[-5.131773,60.744299],[-5.25,60.749406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[-3.166667,60.766066],[-3.284956,60.760959],[-3.399541,60.745798],[-3.506845,60.721058],[-3.603537,60.687511],[-3.686643,60.646202],[-3.75364,60.598413],[-3.802532,60.545623],[-3.831907,60.489454],[-3.840968,60.431627],[-3.829547,60.373903],[-3.798096,60.31803],[-3.747662,60.265692],[-3.679845,60.218459],[-3.596739,60.177742],[-3.500866,60.144751],[-3.395104,60.120463],[-3.282595,60.105598],[-3.166667,60.100594],[-3.050739,60.105598],[-2.93823,60.120463],[-2.832468,60.144751],[-2.736595,60.177742],[-2.653489,60.218459],[-2.585672,60.265692],[-2.535238,60.31803],[-2.503787,60.373903],[-2.492366,60.431627],[-2.501427,60.489454],[-2.530802,60.545623],[-2.579694,60.598413],[-2.646691,60.646202],[-2.729797,60.687511],[-2.826489,60.721058],[-2.933793,60.745798],[-3.048378,60.760959],[-3.166667,60.766066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[-1.083333,60.749406],[-1.20156,60.744299],[-1.316086,60.729138],[-1.423335,60.704398],[-1.519977,60.670851],[-1.60304,60.629543],[-1.670003,60.581754],[-1.718871,60.528964],[-1.748232,60.472795],[-1.757289,60.414968],[-1.745874,60.357244],[-1.71444,60.301371],[-1.664032,60.249033],[-1.59625,60.2018],[-1.513187,60.161082],[-1.417363,60.128091],[-1.311654,60.103803],[-1.199202,60.088938],[-1.083333,60.083934],[-0.967464,60.088938],[-0.855012,60.103803],[-0.749303,60.128091],[-0.653479,60.161082],[-0.570416,60.2018],[-0.502634,60.249033],[-0.452226,60.301371],[-0.420792,60.357244],[-0.409377,60.414968],[-0.418434,60.472795],[-0.447795,60.528964],[-0.496663,60.581754],[-0.563626,60.629543],[-0.646689,60.670851],[-0.743331,60.704398],[-0.85058,60.729138],[-0.965106,60.744299],[-1.083333,60.749406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 04' }, geometry: { type: 'Polygon', coordinates: [[[-5.25,60.249406],[-5.366418,60.2443],[-5.479194,60.229142],[-5.584807,60.204407],[-5.679982,60.170866],[-5.761791,60.129563],[-5.827751,60.08178],[-5.875897,60.028994],[-5.904835,59.972828],[-5.913778,59.915002],[-5.902559,59.857277],[-5.87162,59.8014],[-5.821988,59.749058],[-5.755238,59.70182],[-5.673428,59.661096],[-5.579044,59.628099],[-5.474916,59.603807],[-5.364142,59.588939],[-5.25,59.583934],[-5.135858,59.588939],[-5.025084,59.603807],[-4.920956,59.628099],[-4.826572,59.661096],[-4.744762,59.70182],[-4.678012,59.749058],[-4.62838,59.8014],[-4.597441,59.857277],[-4.586222,59.915002],[-4.595165,59.972828],[-4.624103,60.028994],[-4.672249,60.08178],[-4.738209,60.129563],[-4.820018,60.170866],[-4.915193,60.204407],[-5.020806,60.229142],[-5.133582,60.2443],[-5.25,60.249406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 05' }, geometry: { type: 'Polygon', coordinates: [[[-3.166667,60.266066],[-3.283144,60.26096],[-3.395977,60.245802],[-3.501644,60.221067],[-3.596867,60.187525],[-3.678717,60.146222],[-3.74471,60.098439],[-3.792879,60.045653],[-3.821831,59.989487],[-3.830779,59.931661],[-3.819553,59.873936],[-3.788597,59.81806],[-3.738941,59.765717],[-3.672156,59.718479],[-3.590306,59.677756],[-3.495874,59.644759],[-3.391694,59.620467],[-3.280866,59.605599],[-3.166667,59.600594],[-3.052468,59.605599],[-2.94164,59.620467],[-2.83746,59.644759],[-2.743028,59.677756],[-2.661178,59.718479],[-2.594393,59.765717],[-2.544737,59.81806],[-2.513781,59.873936],[-2.502555,59.931661],[-2.511503,59.989487],[-2.540455,60.045653],[-2.588624,60.098439],[-2.654617,60.146222],[-2.736467,60.187525],[-2.83169,60.221067],[-2.937357,60.245802],[-3.05019,60.26096],[-3.166667,60.266066]]] } },
        { type: 'Feature', properties: { name: 'Lobe 06' }, geometry: { type: 'Polygon', coordinates: [[[-1.083333,60.249406],[-1.199751,60.2443],[-1.312527,60.229142],[-1.41814,60.204407],[-1.513315,60.170866],[-1.595124,60.129563],[-1.661084,60.08178],[-1.70923,60.028994],[-1.738168,59.972828],[-1.747111,59.915002],[-1.735892,59.857277],[-1.704953,59.8014],[-1.655321,59.749058],[-1.58857,59.70182],[-1.506761,59.661096],[-1.412377,59.628099],[-1.308249,59.603807],[-1.197475,59.588939],[-1.083333,59.583934],[-0.969191,59.588939],[-0.858417,59.603807],[-0.754289,59.628099],[-0.659905,59.661096],[-0.578096,59.70182],[-0.511345,59.749058],[-0.461713,59.8014],[-0.430774,59.857277],[-0.419555,59.915002],[-0.428498,59.972828],[-0.457436,60.028994],[-0.505582,60.08178],[-0.571542,60.129563],[-0.653351,60.170866],[-0.748526,60.204407],[-0.854139,60.229142],[-0.966915,60.2443],[-1.083333,60.249406]]] } },
        { type: 'Feature', properties: { name: 'Lobe 01' }, geometry: { type: 'Polygon', coordinates: [[[1.133333,55.666222],[1.056509,55.662407],[0.982062,55.651079],[0.912294,55.63259],[0.849352,55.60751],[0.795164,55.576614],[0.751374,55.540853],[0.719299,55.501324],[0.699884,55.459239],[0.69368,55.415882],[0.700834,55.372572],[0.721084,55.330624],[0.75378,55.291305],[0.797899,55.255801],[0.852088,55.225178],[0.9147,55.200356],[0.983848,55.182076],[1.057459,55.170886],[1.133333,55.167118],[1.209207,55.170886],[1.282818,55.182076],[1.351966,55.200356],[1.414578,55.225178],[1.468767,55.255801],[1.512886,55.291305],[1.545582,55.330624],[1.565832,55.372572],[1.572986,55.415882],[1.566782,55.459239],[1.547367,55.501324],[1.515292,55.540853],[1.471502,55.576614],[1.417314,55.60751],[1.354372,55.63259],[1.284604,55.651079],[1.210157,55.662407],[1.133333,55.666222]]] } },
        { type: 'Feature', properties: { name: 'Lobe 02' }, geometry: { type: 'Polygon', coordinates: [[[0.5,55.032882],[0.424394,55.029067],[0.351128,55.017741],[0.282464,54.999255],[0.220515,54.974178],[0.167178,54.943285],[0.124074,54.907526],[0.092496,54.868],[0.073376,54.825917],[0.067259,54.78256],[0.074289,54.73925],[0.094212,54.6973],[0.126386,54.657979],[0.169808,54.622471],[0.223145,54.591846],[0.284776,54.56702],[0.352845,54.548738],[0.425308,54.537546],[0.5,54.533778],[0.574692,54.537546],[0.647155,54.548738],[0.715224,54.56702],[0.776855,54.591846],[0.830192,54.622471],[0.873614,54.657979],[0.905788,54.6973],[0.925711,54.73925],[0.932741,54.78256],[0.926624,54.825917],[0.907504,54.868],[0.875926,54.907526],[0.832822,54.943285],[0.779485,54.974178],[0.717536,54.999255],[0.648872,55.017741],[0.575606,55.029067],[0.5,55.032882]]] } },
        { type: 'Feature', properties: { name: 'Lobe 03' }, geometry: { type: 'Polygon', coordinates: [[[1.45,55.199552],[1.374078,55.195737],[1.300506,55.184411],[1.231556,55.165923],[1.169349,55.140846],[1.115792,55.109952],[1.072509,55.074193],[1.040802,55.034666],[1.021606,54.992582],[1.015466,54.949225],[1.022529,54.905915],[1.042536,54.863966],[1.074846,54.824645],[1.118448,54.789139],[1.172006,54.758514],[1.233892,54.733689],[1.30224,54.715408],[1.375001,54.704216],[1.45,54.700448],[1.524999,54.704216],[1.59776,54.715408],[1.666108,54.733689],[1.727994,54.758514],[1.781552,54.789139],[1.825154,54.824645],[1.857464,54.863966],[1.877471,54.905915],[1.884534,54.949225],[1.878394,54.992582],[1.859198,55.034666],[1.827491,55.074193],[1.784208,55.109952],[1.730651,55.140846],[1.668444,55.165923],[1.599494,55.184411],[1.525922,55.195737],[1.45,55.199552]]] } }
    ]
};

class AWACSToggleControl {
    constructor() {
        this.visible = _overlayStates.awacs;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle UK AWACS orbits';
        this.button.textContent = '○';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    initLayers() {
        this.map.addSource('awacs-orbits', { type: 'geojson', data: AWACS_ORBITS });

        const awacsVis = this.visible ? 'visible' : 'none';

        this.map.addLayer({
            id: 'awacs-fill',
            type: 'fill',
            source: 'awacs-orbits',
            layout: { visibility: awacsVis },
            paint: { 'fill-color': 'rgba(200, 255, 0, 0.04)', 'fill-outline-color': 'rgba(0,0,0,0)' }
        });

        this.map.addLayer({
            id: 'awacs-outline',
            type: 'line',
            source: 'awacs-orbits',
            layout: { visibility: awacsVis },
            paint: { 'line-color': 'rgba(200, 255, 0, 0.75)', 'line-width': 1.5 }
        });
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        ['awacs-fill', 'awacs-outline'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', v); } catch (e) {}
        });
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

const awacsControl = new AWACSToggleControl();
map.addControl(awacsControl, 'top-right');
// --- End UK AWACS Orbits ---


// --- ADS-B Live Feed ---
// Aircraft symbol drawn programmatically — traditional ATC radar blip (filled triangle)

class AdsbLiveControl {
    constructor() {
        this.visible = _overlayStates.adsb;
        this._pollInterval = null;
        this._geojson = { type: 'FeatureCollection', features: [] };
        this._trails = {};
        this._trailsGeojson = { type: 'FeatureCollection', features: [] };
        this._MAX_TRAIL = 100;
        this._selectedHex = null;
        this._eventsAdded = false;
        this._lastPositions = {};   // hex -> { lon, lat, gs, track, ts }
        this._interpolateInterval = null;
        this._spriteReady = Promise.resolve();
        this._tagMarker = null;   // MapLibre Marker showing selected-aircraft data tag
        this._tagHex    = null;
        this._followEnabled = false;
        this._hoverMarker = null; // MapLibre Marker showing hovered-aircraft data tag
        this._hoverHex    = null;
        this._callsignMarkers = {};  // hex -> MapLibre Marker (HTML callsign label)
        this.labelsVisible = _overlayStates.adsbLabels ?? true;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle live ADS-B aircraft';
        this.button.textContent = 'ADS';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '8px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout  = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);

        // Pre-fetch ADS-B data immediately so planes are ready to display as
        // soon as the map style finishes loading, rather than waiting for the
        // first poll to complete after layers are initialised.
        if (this.visible) this._fetch();

        // Wait for sprite before initialising layers — sprite is local so loads fast
        this._spriteReady.then(() => {
            if (!this.map) return;
            console.time('[ADSB] style.load → initLayers');
            if (this.map.isStyleLoaded()) {
                console.log('[ADSB] style already loaded, calling initLayers immediately');
                this.initLayers();
            } else {
                console.log('[ADSB] waiting for style.load...');
                this.map.once('style.load', () => {
                    console.timeEnd('[ADSB] style.load → initLayers');
                    this.initLayers();
                });
            }
        });

        return this.container;
    }

    onRemove() {
        this._stopPolling();
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    _parseAlt(alt_baro) {
        if (alt_baro === 'ground' || alt_baro === '' || alt_baro == null) return 0;
        return typeof alt_baro === 'number' ? alt_baro : parseFloat(alt_baro) || 0;
    }

    // Small solid directional triangle pointing north — rotated by icon-rotate
    // to match aircraft track. S=64 canvas, pixelRatio 2 → 32px logical.
    _createRadarBlip(color = '#ffffff') {
        const S  = 64;
        const cx = S / 2, cy = S / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        ctx.beginPath();
        ctx.moveTo(cx,      cy - 10);  // apex — points north
        ctx.lineTo(cx + 7,  cy + 8);   // bottom-right
        ctx.lineTo(cx - 7,  cy + 8);   // bottom-left
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.fill();

        return ctx.getImageData(0, 0, S, S);
    }

    // Axis-aligned bracket corners matching the location marker style.
    // S=64 canvas, pixelRatio 2 → 32px logical, bracket centred at (32,32).
    _createBracket() {
        const S   = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        // Map location-marker SVG coords (viewBox 14 15 32 30) to canvas 2:1 scale
        // SVG bracket: x=[16,44], y=[17,43]; arms 5 SVG units → 10 canvas px
        const x1 = 4, y1 = 4, x2 = 60, y2 = 56, arm = 10;

        ctx.strokeStyle = '#c8ff00';
        ctx.lineWidth   = 3;       // 1.5 logical, matching location marker
        ctx.lineCap     = 'square';

        // Top-left
        ctx.beginPath(); ctx.moveTo(x1 + arm, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 + arm); ctx.stroke();
        // Top-right
        ctx.beginPath(); ctx.moveTo(x2 - arm, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + arm); ctx.stroke();
        // Bottom-left
        ctx.beginPath(); ctx.moveTo(x1 + arm, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - arm); ctx.stroke();
        // Bottom-right
        ctx.beginPath(); ctx.moveTo(x2 - arm, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - arm); ctx.stroke();

        return ctx.getImageData(0, 0, S, S);
    }

    // Solid filled lime-green rectangle for military aircraft markers.
    _createMilBracket() {
        const S = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');
        const x1 = 4, y1 = 4, x2 = 60, y2 = 56;
        ctx.fillStyle = '#c8ff00';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        return ctx.getImageData(0, 0, S, S);
    }

    _registerIcons() {
        if (this.map.hasImage('adsb-bracket'))     this.map.removeImage('adsb-bracket');
        if (this.map.hasImage('adsb-bracket-mil')) this.map.removeImage('adsb-bracket-mil');
        if (this.map.hasImage('adsb-blip'))        this.map.removeImage('adsb-blip');
        if (this.map.hasImage('adsb-blip-mil'))    this.map.removeImage('adsb-blip-mil');
        this.map.addImage('adsb-bracket',     this._createBracket(),            { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-bracket-mil', this._createMilBracket(),         { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-blip',        this._createRadarBlip('#ffffff'), { pixelRatio: 2, sdf: false });
        this.map.addImage('adsb-blip-mil',    this._createRadarBlip('#000000'), { pixelRatio: 2, sdf: false });
    }

    initLayers() {
        console.log('[ADSB] initLayers called, geojson features:', this._geojson.features.length);
        const vis = this.visible ? 'visible' : 'none';

        ['adsb-icons', 'adsb-bracket', 'adsb-trails'].forEach(id => {
            try { this.map.removeLayer(id); } catch(e) {}
        });
        this._clearCallsignMarkers();
        ['adsb-live', 'adsb-trails-source'].forEach(id => {
            if (this.map.getSource(id)) this.map.removeSource(id);
        });

        this._registerIcons();

        // Position-history dots for selected aircraft (rendered behind icons)
        this.map.addSource('adsb-trails-source', { type: 'geojson', data: this._trailsGeojson });
        this.map.addLayer({
            id: 'adsb-trails',
            type: 'circle',
            source: 'adsb-trails-source',
            layout: { visibility: vis },
            paint: {
                'circle-radius': 2.5,
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-width': 0,
                'circle-color': '#c8ff00',
            }
        });

        // Aircraft positions
        this.map.addSource('adsb-live', { type: 'geojson', data: this._geojson });

        // Bracket corners — viewport-aligned (never rotate), always visible
        this.map.addLayer({
            id: 'adsb-bracket',
            type: 'symbol',
            source: 'adsb-live',
            filter: ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            layout: {
                visibility: vis,
                'icon-image': ['case', ['boolean', ['get', 'military'], false], 'adsb-bracket-mil', 'adsb-bracket'],
                'icon-size': 0.75,
                'icon-rotation-alignment': 'viewport',
                'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
            paint: {
                'icon-opacity': 1,
                'icon-opacity-transition': { duration: 0 },
            }
        });

        // Directional triangle — rotates with aircraft track, always visible
        this.map.addLayer({
            id: 'adsb-icons',
            type: 'symbol',
            source: 'adsb-live',
            filter: ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]],
            layout: {
                visibility: vis,
                'icon-image': ['case', ['boolean', ['get', 'military'], false], 'adsb-blip-mil', 'adsb-blip'],
                'icon-size': 0.75,
                'icon-rotate': ['get', 'track'],
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
            paint: {
                'icon-opacity': 1,
                'icon-opacity-transition': { duration: 0 },
            }
        });

        // Click/hover handlers — added once only to avoid duplicates on style reload
        if (!this._eventsAdded) {
            this._eventsAdded = true;

            const handleAircraftClick = (e) => {
                if (e.originalEvent._adsbHandled) return; // dedupe: bracket + icons both fire for same click
                if (!e.features || !e.features.length) return;
                const hex = e.features[0].properties.hex;
                this._selectedHex = (hex === this._selectedHex) ? null : hex;
                this._hideHoverTag(); // hover tag replaced by selected tag
                this._applySelection();
                e.originalEvent._adsbHandled = true;
            };

            this.map.on('click', 'adsb-bracket', handleAircraftClick);
            this.map.on('click', 'adsb-icons',  handleAircraftClick);

            this.map.on('click', (e) => {
                if (e.originalEvent._adsbHandled) return;
                if (this._followEnabled) return; // don't deselect while tracking
                if (this._selectedHex) {
                    this._selectedHex = null;
                    this._applySelection();
                }
            });

            const handleHoverEnter = (e) => {
                this.map.getCanvas().style.cursor = 'pointer';
                if (!e.features || !e.features.length) return;
                const hex = e.features[0].properties.hex;
                const f = this._geojson.features.find(f => f.properties.hex === hex);
                if (f) this._showHoverTag(f);
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

        // Start polling only once the map source exists so the first fetch
        // can immediately display planes rather than silently dropping data.
        if (this.visible && !this._pollInterval) this._startPolling();
    }

    _buildTagHTML(props) {
        const raw      = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';

        // Tracking mode only applies to the specific plane being tracked.
        const isTracked  = this._followEnabled && props.hex === this._tagHex;
        const trkColor   = isTracked ? '#c8ff00' : 'rgba(255,255,255,0.3)';
        const trkBtnText = isTracked ? 'TRACKING' : 'TRACK';
        const trkBtn = `<button class="tag-follow-btn" style="` +
            `background:none;border:none;cursor:pointer;padding:8px 12px;` +
            `color:${trkColor};font-family:'Barlow Condensed','Barlow',sans-serif;` +
            `font-size:10px;font-weight:700;letter-spacing:.1em;line-height:1;` +
            `touch-action:manipulation;-webkit-tap-highlight-color:transparent">${trkBtnText}</button>`;

        // When tracking, show only callsign + button — data is in the status bar below.
        if (isTracked) {
            return `<div style="` +
                `background:rgba(0,0,0,0.7);` +
                `border:1px solid rgba(255,255,255,0.15);` +
                `color:#fff;` +
                `font-family:'Barlow Condensed','Barlow',sans-serif;` +
                `font-size:13px;font-weight:400;` +
                `padding:1px 8px;` +
                `white-space:nowrap;user-select:none">` +
                `<div style="display:flex;align-items:center;gap:12px">` +
                `<span style="font-size:13px;font-weight:400;letter-spacing:.12em;color:#fff;pointer-events:none">${callsign}</span>` +
                `${trkBtn}</div></div>`;
        }

        const alt      = props.alt_baro ?? 0;
        const vrt      = props.baro_rate ?? 0;
        const altStr   = alt === 0 ? 'GND'
            : alt >= 18000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0')
            : alt.toLocaleString() + ' ft';
        const vrtArrow = vrt >  200 ? ' ↑' : vrt < -200 ? ' ↓' : '';
        const spdStr   = Math.round(props.gs ?? 0) + ' kt';
        const hdgStr   = Math.round(props.track ?? 0) + '°';
        const rows = [
            ['ALT', altStr + vrtArrow],
            ['SPD', spdStr],
            ['HDG', hdgStr],
        ];
        if (props.t) rows.push(['TYP', props.t]);
        if (props.r) rows.push(['REG', props.r]);
        if (props.squawk) rows.push(['SQK', props.squawk]);

        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`
        ).join('');

        return `<div style="` +
            `background:rgba(0,0,0,0.7);` +
            `color:#fff;` +
            `font-family:'Barlow Condensed','Barlow',sans-serif;` +
            `font-size:14px;font-weight:400;` +
            `padding:6px 14px 9px;` +
            `white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;` +
            `font-weight:600;font-size:15px;letter-spacing:.12em;` +
            `margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:400;pointer-events:none">${callsign}</span>${trkBtn}</div>` +
            `<div style="pointer-events:none">` + rowsHTML + `</div></div>`;
    }

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

        const fields = [];
        if (props.r)            fields.push(['REG',     props.r]);
        if (props.t)            fields.push(['TYPE',    props.t]);
        fields.push(['ALT',     altStr + vrtArrow]);
        if (props.alt_geom != null) fields.push(['ALT GEO', props.alt_geom.toLocaleString() + ' ft']);
        fields.push(['V/S',     vrtStr]);
        fields.push(['GS',      Math.round(props.gs ?? 0) + ' kt']);
        if (props.ias != null)  fields.push(['IAS',     Math.round(props.ias) + ' kt']);
        if (props.mach != null) fields.push(['MACH',    'M' + props.mach.toFixed(2)]);
        fields.push(['HDG',     Math.round(props.track ?? 0) + '°']);
        if (props.nav_altitude != null) fields.push(['NAV ALT', props.nav_altitude.toLocaleString() + ' ft']);
        if (props.nav_heading  != null) fields.push(['NAV HDG', Math.round(props.nav_heading) + '°']);
        if (props.squawk)       fields.push(['SQUAWK',  props.squawk]);
        if (props.category)     fields.push(['CAT',     props.category]);
        if (props.emergency && props.emergency !== 'none') fields.push(['EMRG', props.emergency.toUpperCase()]);
        if (props.rssi != null) fields.push(['RSSI',    props.rssi.toFixed(1) + ' dBFS']);
        if (props.military)     fields.push(['CLASS',   'MILITARY']);

        const isEmergency = props.emergency && props.emergency !== 'none';
        const headerColor = isEmergency ? '#ff4040' : '#c8ff00';

        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value${lbl === 'EMRG' ? ' adsb-sb-emrg' : ''}">${val}</span>` +
            `</div>`
        ).join('');

        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-callsign" style="color:${headerColor}">${callsign}</span>` +
            `<button class="adsb-sb-untrack-btn">UNTRACK</button>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    _showStatusBar(props) {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            document.body.appendChild(bar);
        }
        delete bar.dataset.apt;
        bar.innerHTML = this._buildStatusBarHTML(props);
        bar.classList.add('adsb-sb-visible');
        this._wireStatusBarUntrack(bar);
    }

    _hideStatusBar() {
        const bar = document.getElementById('adsb-status-bar');
        if (bar) bar.classList.remove('adsb-sb-visible');
    }

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

    _wireStatusBarUntrack(bar) {
        const btn = bar.querySelector('.adsb-sb-untrack-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._followEnabled = false;
            // Rebuild the tag marker without tracking state
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
        });
    }

    _wireTagButton(el) {
        const btn = el.querySelector('.tag-follow-btn');
        if (!btn) return;

        // MapLibre calls e.preventDefault() on every mousedown on the marker element,
        // which suppresses the subsequent click event. Stop propagation from the button
        // so MapLibre's mousedown handler never sees presses originating here.
        btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });

        // Hover over the whole label: swap TRACKING ↔ UNTRACK
        if (btn.textContent === 'TRACKING') {
            el.addEventListener('mouseenter', () => { btn.textContent = 'UNTRACK'; });
            el.addEventListener('mouseleave', () => { btn.textContent = 'TRACKING'; });
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._followEnabled = !this._followEnabled;

            // Re-create the marker so the anchor updates (top-left for data box, left for tracking).
            if (this._tagHex) {
                const f = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                    if (f) {
                    const coords = this._interpolatedCoords(this._tagHex) || f.geometry.coordinates;
                    const newEl = document.createElement('div');
                    newEl.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(newEl);
                    if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
                    const anchor = this._followEnabled ? 'left' : 'top-left';
                    const offset = this._followEnabled ? [14, 0] : [14, -13];
                    this._tagMarker = new maplibregl.Marker({ element: newEl, anchor, offset })
                        .setLngLat(coords)
                        .addTo(this.map);
                    if (this._followEnabled) {
                        this._showStatusBar(f.properties);
                        this.map.easeTo({ center: f.geometry.coordinates, duration: 400 });
                    } else {
                        this._hideStatusBar();
                    }
                }
            }
        });
    }

    _showSelectedTag(feature) {
        this._hideSelectedTag();
        this._hideStatusBar();
        if (!feature || !this.map) return;
        this._followEnabled = false;
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        this._wireTagButton(el);
        const coords = this._interpolatedCoords(feature.properties.hex) || feature.geometry.coordinates;
        // Data box: top-left aligned. Tracking label: vertically centred (left anchor).
        const anchor = this._followEnabled ? 'left' : 'top-left';
        this._tagMarker = new maplibregl.Marker({ element: el, anchor, offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
        this._tagHex = feature.properties.hex;
    }

    _hideSelectedTag() {
        if (this._tagMarker) { this._tagMarker.remove(); this._tagMarker = null; }
        this._tagHex = null;
    }

    _showHoverTag(feature, fromLabel = false) {
        if (!feature || !this.map) return;
        const hex = feature.properties.hex;
        // Don't show hover tag over the already-selected plane
        if (hex === this._selectedHex) return;
        // Cancel any pending hide
        if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
        // Already showing hover tag for this plane — just update position
        const coords = this._interpolatedCoords(hex) || feature.geometry.coordinates;
        if (this._hoverHex === hex && this._hoverMarker) {
            this._hoverMarker.setLngLat(coords);
            return;
        }
        this._hideHoverTagNow();
        const el = document.createElement('div');
        el.innerHTML = this._buildTagHTML(feature.properties);
        // When triggered from the label, enable pointer events on the data box so
        // the cursor moving onto it keeps the box alive (no flicker).
        el.style.pointerEvents = fromLabel ? 'auto' : 'none';
        if (fromLabel) {
            el.addEventListener('mouseenter', () => {
                if (this._hoverHideTimer) { clearTimeout(this._hoverHideTimer); this._hoverHideTimer = null; }
            });
            el.addEventListener('mouseleave', () => this._hideHoverTag());
        }
        this._hoverMarker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [14, -13] })
            .setLngLat(coords)
            .addTo(this.map);
        this._hoverHex = hex;
        this._hoverFromLabel = fromLabel;
        // Hide the callsign label in both cases — data box covers its position.
        if (this._callsignMarkers[hex]) {
            this._callsignMarkers[hex].getElement().style.visibility = 'hidden';
        }
    }

    _hideHoverTag() {
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer);
        this._hoverHideTimer = setTimeout(() => {
            this._hoverHideTimer = null;
            this._hideHoverTagNow();
        }, 80);
    }

    _hideHoverTagNow() {
        // Always restore the callsign label
        if (this._hoverHex && this._callsignMarkers[this._hoverHex]) {
            this._callsignMarkers[this._hoverHex].getElement().style.visibility = '';
        }
        if (this._hoverMarker) { this._hoverMarker.remove(); this._hoverMarker = null; }
        this._hoverHex = null;
        this._hoverFromLabel = false;
    }

    // Build a simple HTML callsign label element styled like the selected popup header.
    _buildCallsignLabelEl(props) {
        const raw = (props.flight || '').trim() || (props.r || '').trim() || (props.hex || '').trim();
        const callsign = raw || 'UNKNOWN';
        const color = props.military ? '#ffffff' : '#ffffff';
        const el = document.createElement('div');
        el.style.cssText = [
            'background:rgba(0,0,0,0.5)',
            `color:${color}`,
            "font-family:'Barlow Condensed','Barlow',sans-serif",
            'font-size:13px',
            'font-weight:400',
            'letter-spacing:.12em',
            'box-sizing:border-box',
            'display:flex',
            'align-items:center',
            'padding:1px 8px',
            'cursor:pointer',
            'white-space:nowrap',
            'user-select:none',
        ].join(';');
        el.textContent = callsign;
        el.addEventListener('mouseenter', () => {
            const f = this._geojson.features.find(f => f.properties.hex === props.hex);
            if (f) this._showHoverTag(f, true);
        });
        el.addEventListener('mouseleave', () => {
            this._hideHoverTag();
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const hex = props.hex;
            this._selectedHex = (hex === this._selectedHex) ? null : hex;
            this._hideHoverTag();
            this._applySelection();
        });
        return el;
    }

    setLabelsVisible(v) {
        this.labelsVisible = v;
        if (!v) {
            this._clearCallsignMarkers();
        } else {
            this._updateCallsignMarkers();
        }
    }

    // Create/update HTML callsign markers for all non-selected aircraft.
    _updateCallsignMarkers() {
        if (!this.map || !this.labelsVisible) return;
        const features = this._geojson.features;
        const seen = new Set();

        for (const f of features) {
            const hex = f.properties.hex;
            if (!hex) continue;
            seen.add(hex);

            // Only show label if the icon is visible (mirrors the layer filter).
            const zoom = this.map.getZoom();
            const iconVisible = (f.properties.alt_baro > 0) || (zoom >= 10);
            if (!iconVisible) {
                if (this._callsignMarkers[hex]) {
                    this._callsignMarkers[hex].remove();
                    delete this._callsignMarkers[hex];
                }
                continue;
            }

            // Selected aircraft uses the full popup instead.
            if (hex === this._selectedHex) {
                if (this._callsignMarkers[hex]) {
                    this._callsignMarkers[hex].remove();
                    delete this._callsignMarkers[hex];
                }
                continue;
            }

            const lngLat = this._interpolatedCoords(hex) || f.geometry.coordinates;

            if (this._callsignMarkers[hex]) {
                this._callsignMarkers[hex].setLngLat(lngLat);
                // Refresh text and colour in case callsign/military flag changed.
                const labelEl = this._callsignMarkers[hex].getElement();
                const raw = (f.properties.flight || '').trim() || (f.properties.r || '').trim() || f.properties.hex || '';
                labelEl.textContent = raw || 'UNKNOWN';
                labelEl.style.color = f.properties.military ? '#ffffff' : '#ffffff';
            } else {
                const labelEl = this._buildCallsignLabelEl(f.properties);
                const marker = new maplibregl.Marker({ element: labelEl, anchor: 'left', offset: [14, 0] })
                    .setLngLat(lngLat)
                    .addTo(this.map);
                this._callsignMarkers[hex] = marker;
            }
        }

        // Remove markers for aircraft that have left the feed.
        for (const hex of Object.keys(this._callsignMarkers)) {
            if (!seen.has(hex)) {
                this._callsignMarkers[hex].remove();
                delete this._callsignMarkers[hex];
            }
        }
    }

    _clearCallsignMarkers() {
        for (const marker of Object.values(this._callsignMarkers)) marker.remove();
        this._callsignMarkers = {};
    }

    _applySelection() {
        if (!this.map) return;

        const baseFilter = ['any', ['>', ['get', 'alt_baro'], 0], ['>=', ['zoom'], 10]];
        // Bracket and directional arrow always visible for all planes
        try { this.map.setFilter('adsb-bracket', baseFilter); } catch(e) {}
        try { this.map.setFilter('adsb-icons',   baseFilter); } catch(e) {}

        // HTML callsign markers — selected aircraft gets the full popup instead.
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

    _rebuildTrails() {
        const trailFeatures = [];
        if (this._selectedHex && this._trails[this._selectedHex]) {
            const points = this._trails[this._selectedHex];
            const n = points.length;
            for (let i = 0; i < n; i++) {
                const p = points[i];
                trailFeatures.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                    properties: {
                        alt:     p.alt,
                        opacity: (i + 1) / n,   // oldest = near 0, newest = 1.0
                    }
                });
            }
        }
        this._trailsGeojson = { type: 'FeatureCollection', features: trailFeatures };
        if (this.map && this.map.getSource('adsb-trails-source')) {
            this.map.getSource('adsb-trails-source').setData(this._trailsGeojson);
        }
    }

    // Dead-reckoning: runs every second, extrapolates positions between API polls
    // using each aircraft's ground speed and track so movement looks continuous.
    _interpolate() {
        if (!this.map || !this._geojson.features.length) return;
        const now = Date.now();
        // 1 knot = 1 nm/hr; 1 nm = 1/60 degree latitude
        const NM_DEG = 1 / 60;
        const HR_SEC = 3600;

        this._interpolatedFeatures = this._geojson.features.map(f => {
            const pos = this._lastPositions[f.properties.hex];
            if (!pos || pos.gs < 10) return f; // don't move slow/parked aircraft
            const dt = (now - pos.ts) / 1000; // seconds since last real fix
            if (dt <= 0 || dt > 30) return f;  // don't extrapolate beyond 30 s
            const trackRad = pos.track * Math.PI / 180;
            const nmPerSec = pos.gs / HR_SEC;
            const dLat = nmPerSec * Math.cos(trackRad) * NM_DEG * dt;
            const dLon = nmPerSec * Math.sin(trackRad) * NM_DEG * dt / Math.cos(pos.lat * Math.PI / 180);
            return {
                ...f,
                geometry: { type: 'Point', coordinates: [pos.lon + dLon, pos.lat + dLat] }
            };
        });

        const interpolated = { type: 'FeatureCollection', features: this._interpolatedFeatures };

        if (this.map.getSource('adsb-live')) {
            this.map.getSource('adsb-live').setData(interpolated);
            console.log('[ADSB] _interpolate: setData called with', interpolated.features.length, 'features');
        } else {
            console.log('[ADSB] _interpolate: source not ready yet');
        }

        // Keep tag and callsign markers on interpolated positions.
        if (this._tagMarker && this._tagHex) {
            const f = this._interpolatedFeatures.find(f => f.properties.hex === this._tagHex);
            if (f) {
                this._tagMarker.setLngLat(f.geometry.coordinates);
                if (this._followEnabled) {
                    this.map.easeTo({ center: f.geometry.coordinates, duration: 1100, easing: t => t });
                }
            }
        }
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

    // Returns the interpolated coordinates for a given hex, falling back to raw API coords.
    _interpolatedCoords(hex) {
        if (this._interpolatedFeatures) {
            const f = this._interpolatedFeatures.find(f => f.properties.hex === hex);
            if (f) return f.geometry.coordinates;
        }
        const f = this._geojson.features.find(f => f.properties.hex === hex);
        return f ? f.geometry.coordinates : null;
    }

    async _fetch() {
        if (!this.map) return;
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
            lat = c.lat;
            lon = c.lng;
        }
        try {
            const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/250`;
            console.time('[ADSB] API fetch');
            const resp = await fetch(url);
            console.timeEnd('[ADSB] API fetch');
            if (!resp.ok) return;
            const data = await resp.json();
            console.log('[ADSB] aircraft count:', (data.ac || []).length);
            const aircraft = data.ac || [];
            const seen = new Set();

            this._geojson = {
                type: 'FeatureCollection',
                features: aircraft
                    .filter(a => a.lat != null && a.lon != null)
                    .map(a => {
                        const alt = this._parseAlt(a.alt_baro);
                        const hex = a.hex || '';
                        seen.add(hex);

                        // Update trail history and store real position for interpolation
                        if (hex) {
                            if (!this._trails[hex]) this._trails[hex] = [];
                            const trail = this._trails[hex];
                            const last = trail[trail.length - 1];
                            const posChanged = !last || last.lon !== a.lon || last.lat !== a.lat;
                            if (posChanged) {
                                trail.push({ lon: a.lon, lat: a.lat, alt });
                                if (trail.length > this._MAX_TRAIL) trail.shift();
                            }
                            // Only reset the interpolation clock when the API gives us a
                            // genuinely new position. If the same fix comes back again,
                            // keep the existing entry so the extrapolation clock keeps
                            // running forward and the plane doesn't snap backwards.
                            if (posChanged || !this._lastPositions[hex]) {
                                const ageSec = a.seen_pos ?? a.seen ?? 0;
                                this._lastPositions[hex] = {
                                    lon: a.lon, lat: a.lat,
                                    gs: a.gs ?? 0, track: a.track ?? 0,
                                    ts: Date.now() - ageSec * 1000
                                };
                            } else {
                                // Position unchanged — update speed/track in case they
                                // changed, but leave lon/lat/ts alone.
                                this._lastPositions[hex].gs = a.gs ?? 0;
                                this._lastPositions[hex].track = a.track ?? 0;
                            }
                        }

                        const gs = a.gs ?? 0;
                        const hexInt = parseInt(hex, 16);
                        const military = a.military === true
                            || (hexInt >= 0x43C000 && hexInt <= 0x43FFFF)  // UK military
                            || (hexInt >= 0xAE0000 && hexInt <= 0xAFFFFF); // US military

                        return {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
                            properties: {
                                hex,
                                flight:       (a.flight || '').trim(),
                                r:            a.r || '',
                                t:            a.t || '',
                                alt_baro:     alt,
                                alt_geom:     a.alt_geom ?? null,
                                gs,
                                ias:          a.ias ?? null,
                                mach:         a.mach ?? null,
                                track:        a.track ?? 0,
                                baro_rate:    a.baro_rate ?? 0,
                                nav_altitude: a.nav_altitude_mcp ?? a.nav_altitude_fms ?? null,
                                nav_heading:  a.nav_heading ?? null,
                                category:     a.category || '',
                                emergency:    a.emergency || '',
                                squawk:       a.squawk || '',
                                rssi:         a.rssi ?? null,
                                military,
                            }
                        };
                    })
            };

            // Remove stale aircraft data
            for (const hex of Object.keys(this._trails)) {
                if (!seen.has(hex)) delete this._trails[hex];
            }
            for (const hex of Object.keys(this._lastPositions)) {
                if (!seen.has(hex)) delete this._lastPositions[hex];
            }

            // Don't push raw API coords to the map — let _interpolate() be the sole
            // writer so there's no backward snap when new data arrives.
            this._interpolate();

            // Rebuild trail and refresh data tag for selected aircraft
            this._rebuildTrails();
            if (this._tagHex && this._tagMarker) {
                const f = this._geojson.features.find(f => f.properties.hex === this._tagHex);
                if (f) {
                    const el = this._tagMarker.getElement();
                    el.innerHTML = this._buildTagHTML(f.properties);
                    this._wireTagButton(el);
                    this._updateStatusBar();
                } else {
                    this._hideSelectedTag();   // aircraft left the area
                    this._hideStatusBar();
                }
            }
            // Refresh HTML callsign markers for all aircraft.
            this._updateCallsignMarkers();
            // Keep ADS-B layers above all other map layers
            this._raiseLayers();
        } catch(e) {
            console.warn('ADS-B fetch error:', e);
        }
    }

    // Raise all ADS-B layers to the top of the map layer stack.
    _raiseLayers() {
        if (!this.map) return;
        ['adsb-trails', 'adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.moveLayer(id); } catch(e) {}
        });
    }

    _startPolling() {
        this._fetch();
        this._pollInterval = setInterval(() => this._fetch(), 5000);
        this._interpolateInterval = setInterval(() => this._interpolate(), 1000);
    }

    _stopPolling() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
        if (this._interpolateInterval) { clearInterval(this._interpolateInterval); this._interpolateInterval = null; }
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        ['adsb-trails', 'adsb-bracket', 'adsb-icons'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', v); } catch(e) {}
        });
        if (this.visible) {
            this._startPolling();
        } else {
            this._stopPolling();
            this._selectedHex = null;
            this._followEnabled = false;
            this._hideSelectedTag();
            this._hideHoverTag();
            this._hideStatusBar();
            this._clearCallsignMarkers();
        }
        this.button.style.opacity = this.visible ? '1' : '0.3';
        this.button.style.color = this.visible ? '#c8ff00' : '#ffffff';
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(this.visible);
        _saveOverlayStates();
    }
}

let adsbControl = new AdsbLiveControl();
map.addControl(adsbControl, 'top-right');

// --- ADS-B Label Toggle ---
class AdsbLabelsToggleControl {
    constructor() {
        this.labelsVisible = _overlayStates.adsbLabels ?? true;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle aircraft labels';
        this.button.textContent = 'L';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s, color 0.2s';
        const adsbOn = adsbControl ? adsbControl.visible : true;
        this.button.style.opacity = (adsbOn && this.labelsVisible) ? '1' : '0.3';
        this.button.style.color = (adsbOn && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        this.button.style.pointerEvents = adsbOn ? 'auto' : 'none';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => { this.button.style.backgroundColor = '#111111'; };
        this.button.onmouseout  = () => { this.button.style.backgroundColor = '#000000'; };

        this.container.appendChild(this.button);
        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    toggle() {
        this.labelsVisible = !this.labelsVisible;
        this.button.style.opacity = this.labelsVisible ? '1' : '0.3';
        this.button.style.color = this.labelsVisible ? '#c8ff00' : '#ffffff';
        if (adsbControl) adsbControl.setLabelsVisible(this.labelsVisible);
        _saveOverlayStates();
    }

    syncToAdsb(adsbVisible) {
        if (!this.button) return;
        if (adsbVisible) this.labelsVisible = false;
        this.button.style.pointerEvents = adsbVisible ? 'auto' : 'none';
        this.button.style.opacity = (adsbVisible && this.labelsVisible) ? '1' : '0.3';
        this.button.style.color = (adsbVisible && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        if (adsbVisible) adsbControl.setLabelsVisible(false);
    }
}
adsbLabelsControl = new AdsbLabelsToggleControl();
map.addControl(adsbLabelsControl, 'top-right');
// --- End ADS-B Label Toggle ---
// --- End ADS-B Live Feed ---


// --- Clear all overlays ---
class ClearOverlaysControl {
    constructor() {
        this.cleared = false;
        this.savedStates = null;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#000000';
        this.container.style.borderRadius = '0';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle all overlays';
        this.button.textContent = '✕';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#000000';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '14px';
        this.button.style.color = '#ffffff';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '0.3';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#111111';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#000000';

        this.container.appendChild(this.button);
        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    toggle() {
        if (!this.cleared) {
            this.savedStates = {
                roads: roadsControl ? roadsControl.roadsVisible : false,
                names: namesControl ? namesControl.namesVisible : false,
                rings: rangeRingsControl ? rangeRingsControl.ringsVisible : false,
                aar: aarControl ? aarControl.visible : false,
                awacs: awacsControl ? awacsControl.visible : false,
                airports: airportsControl ? airportsControl.visible : false,
                raf: rafControl ? rafControl.visible : false,
                adsb: adsbControl ? adsbControl.visible : false,
            };
            if (roadsControl && roadsControl.roadsVisible) roadsControl.toggleRoads();
            if (namesControl && namesControl.namesVisible) namesControl.toggleNames();
            if (rangeRingsControl && rangeRingsControl.ringsVisible) rangeRingsControl.toggleRings();
            if (aarControl && aarControl.visible) aarControl.toggle();
            if (awacsControl && awacsControl.visible) awacsControl.toggle();
            if (airportsControl && airportsControl.visible) airportsControl.toggle();
            if (rafControl && rafControl.visible) rafControl.toggle();
            if (adsbControl && adsbControl.visible) adsbControl.toggle();
            this.cleared = true;
            this.button.style.opacity = '1';
            this.button.style.color = '#c8ff00';
        } else {
            if (this.savedStates) {
                if (roadsControl && this.savedStates.roads && !roadsControl.roadsVisible) roadsControl.toggleRoads();
                if (namesControl && this.savedStates.names && !namesControl.namesVisible) namesControl.toggleNames();
                if (rangeRingsControl && this.savedStates.rings && !rangeRingsControl.ringsVisible) rangeRingsControl.toggleRings();
                if (aarControl && this.savedStates.aar && !aarControl.visible) aarControl.toggle();
                if (awacsControl && this.savedStates.awacs && !awacsControl.visible) awacsControl.toggle();
                if (airportsControl && this.savedStates.airports && !airportsControl.visible) airportsControl.toggle();
                if (rafControl && this.savedStates.raf && !rafControl.visible) rafControl.toggle();
                if (adsbControl && this.savedStates.adsb && !adsbControl.visible) adsbControl.toggle();
            }
            this.cleared = false;
            this.button.style.opacity = '0.3';
            this.button.style.color = '#ffffff';
        }
    }
}

const clearControl = new ClearOverlaysControl();
map.addControl(clearControl, 'top-right');
// --- End clear all overlays ---


// --- Side Menu ---
// Build a single collapsible panel that wraps all the right-side controls.
// Each control is still added to the map (it manages layers/sources), but its
// maplibre container is hidden. The side menu calls through to the controls'
// own toggle methods and mirrors their active state.

// Callback set by the side-menu IIFE to activate the location button.
let _onGoToUserLocation = null;

(function buildSideMenu() {
    // Hide the maplibre ctrl-top-right container (controls still manage their layers).
    function hideCtrlContainers() {
        const ctrlTopRight = document.querySelector('.maplibregl-ctrl-top-right');
        if (!ctrlTopRight) { setTimeout(hideCtrlContainers, 50); return; }
        ctrlTopRight.style.display = 'none';
    }
    hideCtrlContainers();

    let expanded = false;

    const panel = document.createElement('div');
    panel.id = 'side-menu';

    // ---- Helper: create a .sm-group wrapper ----
    function makeGroup(id) {
        const g = document.createElement('div');
        g.className = 'sm-group';
        if (id) g.id = id;
        return g;
    }

    // ---- Helper: nav button (zoom / location) ----
    const LOC_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`;
    // SVG replicates the canvas marker exactly. Canvas coords: bracket x=4..60 y=4..56 arm=10,
    // triangle cx=32 cy=32 apex=(32,22) base=(25,40)+(39,40). ViewBox offset by (4,4) → 0 0 56 52.
    const PLANE_SVG = `<svg width="16" height="15" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,14 40,40 28,33 16,40" fill="#ffffff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" transform="rotate(-45 28 27)"/><polyline points="10,0 0,0 0,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,0 56,0 56,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="10,52 0,52 0,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,52 56,52 56,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/></svg>`;

    function makeNavBtn(content, title, onClick, isHTML) {
        const btn = document.createElement('button');
        btn.className = 'sm-nav-btn';
        btn.title = title;
        btn.dataset.tooltip = title;
        if (isHTML) btn.innerHTML = content;
        else btn.textContent = content;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ---- Helper: overlay toggle button ----
    // iconFontSize: CSS font-size string for the icon span (matches original per-button sizes)
    // isHTML: if true, icon is set as innerHTML (for SVG icons)
    function makeOverlayBtn(icon, iconFontSize, label, getActive, doToggle, isHTML) {
        const btn = document.createElement('button');
        btn.className = 'sm-btn';
        btn.dataset.tooltip = label;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'sm-icon';
        if (isHTML) iconSpan.innerHTML = icon;
        else iconSpan.textContent = icon;
        iconSpan.style.fontSize = iconFontSize;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'sm-label';
        labelSpan.textContent = label;

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        function sync() { btn.classList.toggle('active', getActive()); }

        btn.addEventListener('click', () => { doToggle(); sync(); });
        sync();
        return btn;
    }


    // ---- Group 1: expand toggle ----
    const toggleGroup = makeGroup('sm-group-toggle');
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'side-menu-toggle';
    toggleBtn.textContent = '‹';
    toggleBtn.title = 'Expand / collapse menu';
    toggleBtn.dataset.tooltip = 'EXPAND MENU';
    toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        panel.classList.toggle('expanded', expanded);
        toggleBtn.textContent = expanded ? '›' : '‹';
    });
    toggleGroup.appendChild(toggleBtn);
    panel.appendChild(toggleGroup);

    // ---- Group 2: zoom + location (horizontal in expanded) ----
    const navGroup = makeGroup('sm-group-nav');
    navGroup.appendChild(makeNavBtn('+', 'Zoom in', () => map.zoomIn()));
    navGroup.appendChild(makeNavBtn('−', 'Zoom out', () => map.zoomOut()));
    const locBtn = makeNavBtn(LOC_SVG, 'Go to my location', goToUserLocation, true);
    navGroup.appendChild(locBtn);

    // Deactivate location button when zoom drops 2+ levels from when it was activated,
    // or when the user location marker leaves the viewport.
    let locActiveZoom = null;
    let locFlying = false;

    function isUserLocationInView() {
        if (!rangeRingCenter) return false;
        const bounds = map.getBounds();
        const [lng, lat] = rangeRingCenter;
        return bounds.contains([lng, lat]);
    }

    function deactivateLocBtn() {
        locBtn.classList.remove('active');
        locActiveZoom = null;
    }

    map.on('zoom', () => {
        if (locActiveZoom === null || locFlying) return;
        if (map.getZoom() <= locActiveZoom - 2) deactivateLocBtn();
    });

    map.on('moveend', () => {
        if (locFlying) {
            locFlying = false;
            locActiveZoom = map.getZoom();
            return;
        }
        if (locActiveZoom === null) return;
        if (!isUserLocationInView()) deactivateLocBtn();
    });

    _onGoToUserLocation = () => {
        locBtn.classList.add('active');
        locActiveZoom = null;
        locFlying = true;
    };
    panel.appendChild(navGroup);

    // ---- Groups 3+: overlays in original addControl order ----
    // Original order: Reset, CVL, MIL, R, N, ◎, =, ○, ADS, L, ✕
    function adsbToggle() {
        adsbControl.toggle();
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(adsbControl.visible);
    }

    const overlayGroup = makeGroup();
    overlayGroup.appendChild(makeOverlayBtn('CVL', '8px',  'AIRPORTS',       () => airportsControl ? airportsControl.visible : false,         () => { if (airportsControl) airportsControl.toggle(); }));
    overlayGroup.appendChild(makeOverlayBtn('MIL', '8px',  'MILITARY BASES', () => rafControl ? rafControl.visible : false,                   () => { if (rafControl) rafControl.toggle(); }));
    const roadsBtn = makeOverlayBtn('R', '14px', 'ROADS',  () => roadsControl ? roadsControl.roadsVisible : false, () => { if (roadsControl) roadsControl.toggleRoads(); });
    roadsBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(roadsBtn);
    const citiesBtn = makeOverlayBtn('N', '14px', 'CITIES', () => namesControl ? namesControl.namesVisible : false, () => { if (namesControl) namesControl.toggleNames(); });
    citiesBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(citiesBtn);
    overlayGroup.appendChild(makeOverlayBtn('◎',   '16px', 'RANGE RINGS',    () => rangeRingsControl ? rangeRingsControl.ringsVisible : false, () => { if (rangeRingsControl) rangeRingsControl.toggleRings(); }));
    overlayGroup.appendChild(makeOverlayBtn('=',   '16px', 'A2A REFUELING',  () => aarControl ? aarControl.visible : false,                   () => { if (aarControl) aarControl.toggle(); }));
    overlayGroup.appendChild(makeOverlayBtn('○',   '16px', 'AWACS',          () => awacsControl ? awacsControl.visible : false,               () => { if (awacsControl) awacsControl.toggle(); }));
    const labelsBtn = makeOverlayBtn('LBL', '8px', 'PLANE LABELS', () => adsbLabelsControl ? adsbLabelsControl.labelsVisible : false, () => { if (adsbLabelsControl) adsbLabelsControl.toggle(); });
    function syncLabelsBtn() {
        const planesOn = adsbControl ? adsbControl.visible : false;
        labelsBtn.classList.toggle('sm-planes-off', !planesOn);
        labelsBtn.classList.toggle('active', planesOn && adsbLabelsControl ? adsbLabelsControl.labelsVisible : false);
    }
    overlayGroup.appendChild(makeOverlayBtn(PLANE_SVG, '8px', 'PLANES', () => adsbControl ? adsbControl.visible : false, () => { adsbToggle(); syncLabelsBtn(); }, true));
    overlayGroup.appendChild(labelsBtn);
    labelsBtn.addEventListener('click', syncLabelsBtn);
    syncLabelsBtn();
    panel.appendChild(overlayGroup);

    const clearGroup = makeGroup();
    clearGroup.appendChild(makeOverlayBtn('✕', '14px', 'CLEAR ALL', () => clearControl ? clearControl.cleared : false, () => { if (clearControl) clearControl.toggle(); }));
    panel.appendChild(clearGroup);

    document.body.appendChild(panel);
})();

// Helper: fly to user's geolocation (uses rangeRingCenter which is kept live)
function goToUserLocation() {
    if (rangeRingCenter) {
        map.flyTo({ center: rangeRingCenter, zoom: 10 });
        if (_onGoToUserLocation) _onGoToUserLocation();
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 10 });
            if (_onGoToUserLocation) _onGoToUserLocation();
        });
    }
}
// --- End Side Menu ---


let userMarker;

function createMarkerElement(longitude, latitude) {
    const el = document.createElement('div');
    el.style.width = '60px';
    el.style.height = '60px';
    el.style.overflow = 'visible';
    const latText = latitude !== undefined ? latitude.toFixed(3) : '';
    const lonText = longitude !== undefined ? longitude.toFixed(3) : '';
    el.classList.add('user-location-marker');
    el.innerHTML = `<svg viewBox="0 0 110 60" width="110" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <circle class="marker-bg" cx="30" cy="30" r="13" fill="#c8ff00" fill-opacity="0"/>
        <circle class="marker-corner" cx="30" cy="30" r="13" fill="none" stroke="#c8ff00" stroke-width="1.8"/>
        <circle class="marker-dot" cx="30" cy="30" r="3.5" fill="white" opacity="0"/>
        <text x="52" y="28" fill="white" font-size="7.5" font-family="monospace" class="marker-lat"></text>
        <text x="52" y="38" fill="white" font-size="7.5" font-family="monospace" class="marker-lon"></text>
    </svg>`;

    const circle  = el.querySelector('.marker-corner');
    const bg      = el.querySelector('.marker-bg');
    const dot     = el.querySelector('.marker-dot');
    const latEl   = el.querySelector('.marker-lat');
    const lonEl   = el.querySelector('.marker-lon');

    // Circle fades in
    circle.style.opacity = '0';
    circle.style.animation = 'logo-dot-in 0.22s ease-out 0s forwards';
    // Background pulses twice after circle appears
    bg.style.animation = 'logo-bg-pulse 0.4s ease-in-out 0.28s 2 both';
    // Dot fades in
    dot.style.animation = 'logo-dot-in 0.15s ease-out 0.22s forwards';

    // Coordinates type in after draw + pulse sequence.
    // animDone gates setUserLocation updates until the animation finishes.
    el.dataset.animDone = '0';
    let i = 0, j = 0;
    function step() {
        let more = false;
        if (i < latText.length) { latEl.textContent = latText.slice(0, ++i); more = true; }
        if (j < lonText.length) { lonEl.textContent = lonText.slice(0, ++j); more = true; }
        if (more) {
            setTimeout(step, 75);
        } else {
            el.dataset.animDone = '1';
        }
    }
    setTimeout(step, 1250);

    return el;
}

function setUserLocation(position) {
    const { longitude, latitude } = position.coords;

    // Add or update marker for user's location
    if (userMarker) {
        userMarker.setLngLat([longitude, latitude]);
        const el = userMarker.getElement();
        const latEl = el.querySelector('.marker-lat');
        const lonEl = el.querySelector('.marker-lon');
        if (el.dataset.animDone === '1') {
            if (latEl) latEl.textContent = latitude.toFixed(3);
            if (lonEl) lonEl.textContent = longitude.toFixed(3);
        }
    } else {
        userMarker = new maplibregl.Marker({ element: createMarkerElement(longitude, latitude), anchor: 'center' })
            .setLngLat([longitude, latitude])
            .addTo(map);
    }

    // Update range rings centre to user's location
    rangeRingCenter = [longitude, latitude];
    if (rangeRingsControl) rangeRingsControl.updateCenter(longitude, latitude);

    // Cache the coordinates with a timestamp
    localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
    localStorage.setItem('geolocationGranted', 'true');

    // Update footer country via reverse geocoding (throttled to once per 2 minutes)
    const now = Date.now();
    if (now - setUserLocation._lastGeocode > 2 * 60 * 1000) {
        setUserLocation._lastGeocode = now;
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
            headers: { 'Accept-Language': 'en' }
        })
            .then(r => r.json())
            .then(data => {
                const country = data.address && data.address.country;
                if (country) {
                    const el = document.getElementById('footer-location');
                    if (el) el.textContent = country.toUpperCase();
                }
            })
            .catch(() => {});
    }
}
setUserLocation._lastGeocode = 0;

// Load cached location if less than 5 minutes old
const cachedLocation = localStorage.getItem('userLocation');
if (cachedLocation) {
    try {
        const { longitude, latitude, ts } = JSON.parse(cachedLocation);
        if (Date.now() - (ts || 0) < 5 * 60 * 1000) {
            setUserLocation({ coords: { longitude, latitude } });
        } else {
            localStorage.removeItem('userLocation');
        }
    } catch (e) {
        localStorage.removeItem('userLocation');
    }
}

// Continuously watch for location changes
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        setUserLocation,
        (error) => { console.error('Error getting geolocation:', error); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
    );
}

// --- Logo animation (bracket draw-in + typewriter) ---
(function () {
    const logoSvg    = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    if (!logoSvg || !logoTextEl) return;

    let typeTimer  = null;
    let blinkTimer = null;

    function playLogoAnimation() {
        // Cancel any in-flight timers from a previous run
        clearTimeout(typeTimer);
        clearInterval(blinkTimer);

        // Reset text
        logoTextEl.textContent = '';

        // Restart CSS animations on corners, bg pulse, and dot by forcing a reflow
        const corners = logoSvg.querySelectorAll('.logo-corner');
        const bg      = logoSvg.querySelector('.logo-bg');
        const dot     = logoSvg.querySelector('.logo-dot');
        [...corners, bg, dot].forEach(el => {
            el.style.animation = 'none';
            el.getBoundingClientRect(); // force reflow
            el.style.animation = '';
        });

        // Typewriter — starts after corners draw (0.43s) + 2 bg pulses (2×0.4s) = 1.23s
        const WORD = 'SENTINEL';
        let i = 0;
        function typeNext() {
            if (i < WORD.length) {
                logoTextEl.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNext, 75);
            } else {
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoTextEl.textContent = WORD + (blinks % 2 === 0 ? '|' : ' ');
                    if (blinks >= 6) {
                        clearInterval(blinkTimer);
                        logoTextEl.textContent = WORD;
                    }
                }, 300);
            }
        }
        typeTimer = setTimeout(typeNext, 1250);
    }

    // Play on load
    playLogoAnimation();

    // Replay on click
    logoSvg.style.cursor = 'pointer';
    logoSvg.addEventListener('click', playLogoAnimation);
})();
