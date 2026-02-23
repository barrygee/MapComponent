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
    zoom: 7,
    attributionControl: false,
    transformRequest: (url, resourceType) => {
        console.log(`Requesting ${resourceType}: ${url}`);
        return { url };
    }
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
        const { lines, labels } = buildRingsGeoJSON(center[0], center[1]);

        this.map.addSource('range-rings-lines', { type: 'geojson', data: lines });
        this.map.addSource('range-rings-labels', { type: 'geojson', data: labels });

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

        this.map.addLayer({
            id: 'range-rings-labels',
            type: 'symbol',
            source: 'range-rings-labels',
            layout: {
                'text-field': ['get', 'label'],
                'text-size': 11,
                'text-anchor': 'bottom',
                'text-font': ['Noto Sans Regular']
            },
            paint: {
                'text-color': 'rgba(255, 255, 255, 0.7)',
                'text-halo-color': 'rgba(0, 0, 0, 0.5)',
                'text-halo-width': 1
            }
        });
    }

    updateCenter(lng, lat) {
        if (!this.map || !this.map.getSource('range-rings-lines')) return;
        const { lines, labels } = buildRingsGeoJSON(lng, lat);
        this.map.getSource('range-rings-lines').setData(lines);
        this.map.getSource('range-rings-labels').setData(labels);
    }

    toggleRings() {
        this.ringsVisible = !this.ringsVisible;
        const v = this.ringsVisible ? 'visible' : 'none';
        try {
            this.map.setLayoutProperty('range-rings-lines', 'visibility', v);
            this.map.setLayoutProperty('range-rings-labels', 'visibility', v);
        } catch (e) {}
        this.button.style.opacity = this.ringsVisible ? '1' : '0.5';
    }
}

rangeRingsControl = new RangeRingsControl();
map.addControl(rangeRingsControl, 'top-right');

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
