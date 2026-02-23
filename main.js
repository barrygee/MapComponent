// Import PMTiles protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

// --- Range rings ---
const RING_DISTANCES_NM = [50, 100, 150, 200, 250];
let rangeRingCenter = null;
let rangeRingsControl = null;

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

const origin = window.location.origin;

const map = new maplibregl.Map({
    container: 'map',
    style: `${origin}/assets/fiord.json`,
    center: [-4.4815, 54.1453],
    zoom: 6,
    minZoom: 2,
    attributionControl: false,
    transformRequest: (url) => ({ url })
});

map.on('style.load', () => {
    console.log('Style loaded successfully');
    
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
                
                const newFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['all', ['match', ['coalesce', ['get', 'kind_detail'], ['get', 'kind']], ['city'], true, false], ['>', ['get', 'population_rank'], 3]],
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
                    ['all', ['match', ['coalesce', ['get', 'kind_detail'], ['get', 'kind']], ['town'], true, false]],
                    townMatchExpression
                ];
                map.setFilter('place_town', townFilter);
            } else {
                // Show all cities and towns below zoom 7
                const baseFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['all', ['match', ['coalesce', ['get', 'kind_detail'], ['get', 'kind']], ['city'], true, false], ['>', ['get', 'population_rank'], 3]]
                ];
                map.setFilter('place_city', baseFilter);
                
                const townFilter = [
                    'all',
                    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
                    ['all', ['match', ['coalesce', ['get', 'kind_detail'], ['get', 'kind']], ['town'], true, false]]
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
});

map.on('error', (e) => {
    console.error('Map error:', e);
});

// Custom control for toggling roads
class RoadsToggleControl {
    constructor() {
        this.roadsVisible = true; // Visible by default
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#1c2538';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';
        
        this.button = document.createElement('button');
        this.button.className = 'roads-toggle-btn';
        this.button.title = 'Toggle road lines and names';
        this.button.textContent = 'R';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#1c2538';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.color = '#ffffff';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '0.5';
        this.button.onclick = () => this.toggleRoads();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#27324a';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#1c2538';
        
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
        const currentZoom = this.map.getZoom();
        const zoomAllowsRoads = true;
        const shouldBeVisible = this.roadsVisible && zoomAllowsRoads;
        this.button.style.opacity = shouldBeVisible ? '1' : '0.5';
    }

    updateRoadsVisibility() {
        const currentZoom = this.map.getZoom();
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
    }
}

const roadsControl = new RoadsToggleControl();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(roadsControl, 'top-right');

// Custom control for toggling city names
class NamesToggleControl {
    constructor() {
        this.namesVisible = true;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#1c2538';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';
        
        this.button = document.createElement('button');
        this.button.className = 'names-toggle-btn';
        this.button.title = 'Toggle city names';
        this.button.textContent = 'N';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#1c2538';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.color = '#ffffff';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '1';
        this.button.onclick = () => this.toggleNames();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#27324a';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#1c2538';
        
        this.container.appendChild(this.button);
        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    toggleNames() {
        this.namesVisible = !this.namesVisible;
        const visibility = this.namesVisible ? 'visible' : 'none';
        
        const nameLayerIds = [
            'place_suburb', 'place_village', 'place_town', 
            'place_city', 'place_state', 'place_country',
            'place_country_other', 'water_name'
        ];
        
        nameLayerIds.forEach(layerId => {
            try {
                this.map.setLayoutProperty(layerId, 'visibility', visibility);
            } catch (e) {
                // Layer might not exist, skip it
            }
        });
        
        this.button.style.opacity = this.namesVisible ? '1' : '0.5';
    }
}

const namesControl = new NamesToggleControl();
map.addControl(namesControl, 'top-right');

// Custom control for toggling range rings
class RangeRingsControl {
    constructor() {
        this.ringsVisible = true;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#1c2538';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle range rings';
        this.button.textContent = '◎';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#1c2538';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.color = '#ffffff';
        this.button.style.fontWeight = 'bold';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '1';
        this.button.onclick = () => this.toggleRings();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#27324a';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#1c2538';

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
            paint: {
                'line-color': 'rgba(0, 0, 0, 0.7)',
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
        this.button.style.opacity = this.ringsVisible ? '1' : '0.5';
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
        this.visible = false;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#1c2538';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';

        this.button = document.createElement('button');
        this.button.title = 'Toggle UK air-to-air refuelling areas';
        this.button.textContent = '⛽';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#1c2538';
        this.button.style.cursor = 'pointer';
        this.button.style.fontSize = '16px';
        this.button.style.color = '#ffffff';
        this.button.style.display = 'flex';
        this.button.style.alignItems = 'center';
        this.button.style.justifyContent = 'center';
        this.button.style.transition = 'opacity 0.2s';
        this.button.style.opacity = '0.5';
        this.button.onclick = () => this.toggle();
        this.button.onmouseover = () => this.button.style.backgroundColor = '#27324a';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#1c2538';

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
        this.map.addSource('aara-zones', { type: 'geojson', data: AARA_ZONES });

        this.map.addLayer({
            id: 'aara-fill',
            type: 'fill',
            source: 'aara-zones',
            layout: { visibility: 'none' },
            paint: { 'fill-color': 'rgba(255, 180, 0, 0.12)', 'fill-outline-color': 'rgba(0,0,0,0)' }
        });

        this.map.addLayer({
            id: 'aara-outline',
            type: 'line',
            source: 'aara-zones',
            layout: { visibility: 'none' },
            paint: { 'line-color': 'rgba(255, 180, 0, 0.75)', 'line-width': 1.5, 'line-dasharray': [6, 3] }
        });

        this.map.addLayer({
            id: 'aara-labels',
            type: 'symbol',
            source: 'aara-zones',
            layout: {
                visibility: 'none',
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-font': ['Noto Sans Bold'],
                'text-anchor': 'center'
            },
            paint: {
                'text-color': 'rgba(255, 180, 0, 0.9)',
                'text-halo-color': 'rgba(0, 0, 0, 0.7)',
                'text-halo-width': 1.5
            }
        });
    }

    toggle() {
        this.visible = !this.visible;
        const v = this.visible ? 'visible' : 'none';
        ['aara-fill', 'aara-outline', 'aara-labels'].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', v); } catch (e) {}
        });
        this.button.style.opacity = this.visible ? '1' : '0.5';
    }
}

map.addControl(new AARToggleControl(), 'top-right');
// --- End UK AARA ---

let userMarker;

function createMarkerElement() {
    const el = document.createElement('div');
    el.style.width = '1.5em';
    el.style.height = '1.5em';
    el.innerHTML = `<svg viewBox="0 0 20 20" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8" fill="black" stroke="white" stroke-width="2.5"/>
    </svg>`;
    return el;
}

function setUserLocation(position) {
    const { longitude, latitude } = position.coords;

    // Add or update marker for user's location
    if (userMarker) {
        userMarker.setLngLat([longitude, latitude]);
    } else {
        userMarker = new maplibregl.Marker({ element: createMarkerElement(), anchor: 'center' })
            .setLngLat([longitude, latitude])
            .addTo(map);
    }

    // Update range rings centre to user's location
    rangeRingCenter = [longitude, latitude];
    if (rangeRingsControl) rangeRingsControl.updateCenter(longitude, latitude);

    // Cache the coordinates and remember permission
    localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude }));
    localStorage.setItem('geolocationGranted', 'true');
}

// Check for cached location on load
const cachedLocation = localStorage.getItem('userLocation');
if (cachedLocation) {
    try {
        const { longitude, latitude } = JSON.parse(cachedLocation);
        setUserLocation({ coords: { longitude, latitude } });
    } catch (e) {
        console.error('Error parsing cached location:', e);
    }
}

// Only get user's current location if we don't have it yet
if ('geolocation' in navigator && !cachedLocation) {
    navigator.geolocation.getCurrentPosition(
        setUserLocation,
        (error) => {
            console.error('Error getting geolocation:', error);
        }
    );
}
