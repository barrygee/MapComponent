"use strict";
// ============================================================
// RANGE RINGS CONTROL
// Draws five geodesic rings at 50/100/150/200/250 nm around the
// user's location. Centred on rangeRingCenter (updated by user-location.ts).
//
// Depends on:
//   map (global alias), window.MapComponent.buildRingsGeoJSON,
//   rangeRingCenter, _overlayStates, _saveOverlayStates
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />
class RangeRingsControl extends SentinelControlBase {
    constructor() {
        super();
        this.ringsVisible = _overlayStates.rings;
    }
    get buttonLabel() { return '◎'; }
    get buttonTitle() { return 'Toggle range rings'; }
    onInit() {
        this.setButtonActive(this.ringsVisible);
        if (this.map.isStyleLoaded()) {
            this.initRings();
        }
        else {
            this.map.once('style.load', () => this.initRings());
        }
    }
    handleClick() { this.toggleRings(); }
    /**
     * Add the GeoJSON source and line layer for the range rings.
     */
    initRings() {
        const center = rangeRingCenter ?? [this.map.getCenter().lng, this.map.getCenter().lat];
        const { lines } = window.MapComponent.buildRingsGeoJSON(center[0], center[1]);
        this.map.addSource('range-rings-lines', { type: 'geojson', data: lines });
        this.map.addLayer({
            id: 'range-rings-lines',
            type: 'line',
            source: 'range-rings-lines',
            layout: { visibility: this.ringsVisible ? 'visible' : 'none' },
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.40)',
                'line-width': 1,
                'line-dasharray': [4, 4],
            },
        });
    }
    /**
     * Recentre the rings on a new position.
     * Called by setUserLocation() in user-location.ts.
     */
    updateCenter(lng, lat) {
        if (!this.map || !this.map.getSource('range-rings-lines'))
            return;
        const { lines } = window.MapComponent.buildRingsGeoJSON(lng, lat);
        this.map.getSource('range-rings-lines').setData(lines);
    }
    /** Toggle ring visibility and persist the new state. */
    toggleRings() {
        this.ringsVisible = !this.ringsVisible;
        const visibility = this.ringsVisible ? 'visible' : 'none';
        try {
            this.map.setLayoutProperty('range-rings-lines', 'visibility', visibility);
        }
        catch (e) { }
        this.setButtonActive(this.ringsVisible);
        _saveOverlayStates();
    }
}
rangeRingsControl = new RangeRingsControl();
map.addControl(rangeRingsControl, 'top-right');
