// Import PMTiles protocol
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

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
        this.roadsVisible = false; // Hidden by default
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.backgroundColor = '#252D3F';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';
        
        this.button = document.createElement('button');
        this.button.className = 'roads-toggle-btn';
        this.button.title = 'Toggle road lines and names';
        this.button.textContent = 'R';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#252D3F';
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
        this.button.onmouseover = () => this.button.style.backgroundColor = '#323B52';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#252D3F';
        
        this.container.appendChild(this.button);
        
        // Listen to zoom changes to update button state
        this.map.on('zoom', () => this.updateButtonState());
        
        // Set initial visibility based on zoom and toggle state
        this.updateRoadsVisibility();
        
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
        const zoomAllowsRoads = currentZoom >= 9;
        const shouldBeVisible = this.roadsVisible && zoomAllowsRoads;
        this.button.style.opacity = shouldBeVisible ? '1' : '0.5';
    }

    updateRoadsVisibility() {
        const currentZoom = this.map.getZoom();
        const zoomAllowsRoads = currentZoom >= 9;
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
        this.container.style.backgroundColor = '#252D3F';
        this.container.style.borderRadius = '4px';
        this.container.style.marginTop = '4px';
        
        this.button = document.createElement('button');
        this.button.className = 'names-toggle-btn';
        this.button.title = 'Toggle city names';
        this.button.textContent = 'N';
        this.button.style.width = '29px';
        this.button.style.height = '29px';
        this.button.style.border = 'none';
        this.button.style.backgroundColor = '#252D3F';
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
        this.button.onmouseover = () => this.button.style.backgroundColor = '#323B52';
        this.button.onmouseout = () => this.button.style.backgroundColor = '#252D3F';
        
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

let userMarker;

function setUserLocation(position) {
    const { longitude, latitude } = position.coords;

    // Add or update marker for user's location
    if (userMarker) {
        userMarker.setLngLat([longitude, latitude]);
    } else {
        userMarker = new maplibregl.Marker({ color: '#007bff' })
            .setLngLat([longitude, latitude])
            .addTo(map);
    }

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
