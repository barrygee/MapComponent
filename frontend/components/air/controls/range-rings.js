// ============================================================
// RANGE RINGS CONTROL
// Draws five geodesic rings at 50/100/150/200/250 nm around the
// user's location. Centred on rangeRingCenter (updated by user-location.js).
//
// Depends on:
//   map (global alias), window.MapComponent.buildRingsGeoJSON,
//   rangeRingCenter, _overlayStates, _saveOverlayStates
// ============================================================

class RangeRingsControl {
    constructor() {
        // Read persisted visibility state from the previous session
        this.ringsVisible = _overlayStates.rings;
    }

    onAdd(map) {
        this.map = map;

        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        this.button = document.createElement('button');
        this.button.title       = 'Toggle range rings';
        this.button.textContent = '◎';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:16px;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s,color 0.2s';
        this.button.style.opacity = this.ringsVisible ? '1'       : '0.3';
        this.button.style.color   = this.ringsVisible ? '#c8ff00' : '#ffffff';
        this.button.onclick     = () => this.toggleRings();
        this.button.onmouseover = () => { this.button.style.background = '#111'; };
        this.button.onmouseout  = () => { this.button.style.background = '#000'; };

        this.container.appendChild(this.button);

        // Add the ring layer once the style is ready
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

    /**
     * Add the GeoJSON source and line layer for the range rings.
     * Uses rangeRingCenter if available, otherwise falls back to the current map centre.
     * Called once on first load and again by overlay-reinit.js after each style switch.
     */
    initRings() {
        const center = rangeRingCenter || [this.map.getCenter().lng, this.map.getCenter().lat];
        const { lines } = window.MapComponent.buildRingsGeoJSON(center[0], center[1]);

        // GeoJSON source — updated by updateCenter() when the user's position changes
        this.map.addSource('range-rings-lines', { type: 'geojson', data: lines });

        this.map.addLayer({
            id:     'range-rings-lines',
            type:   'line',
            source: 'range-rings-lines',
            layout: { visibility: this.ringsVisible ? 'visible' : 'none' },
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.40)', // semi-transparent white
                'line-width': 1,
                'line-dasharray': [4, 4],                  // dashed style
            },
        });
    }

    /**
     * Recentre the rings on a new position.
     * Called by setUserLocation() in user-location.js whenever the GPS position updates.
     * @param {number} lng
     * @param {number} lat
     */
    updateCenter(lng, lat) {
        if (!this.map || !this.map.getSource('range-rings-lines')) return;
        const { lines } = window.MapComponent.buildRingsGeoJSON(lng, lat);
        this.map.getSource('range-rings-lines').setData(lines); // update source data in-place
    }

    /** Toggle ring visibility and persist the new state. */
    toggleRings() {
        this.ringsVisible = !this.ringsVisible;
        const visibility = this.ringsVisible ? 'visible' : 'none';
        try { this.map.setLayoutProperty('range-rings-lines', 'visibility', visibility); } catch (e) {}
        // Sync button appearance
        this.button.style.opacity = this.ringsVisible ? '1'       : '0.3';
        this.button.style.color   = this.ringsVisible ? '#c8ff00' : '#ffffff';
        _saveOverlayStates();
    }
}

rangeRingsControl = new RangeRingsControl();
map.addControl(rangeRingsControl, 'top-right');
