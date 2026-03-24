"use strict";
// ============================================================
// UK AIRSPACE OVERLAY CONTROL
// Renders 1189 UK airspace zones from bundled OpenAIP GeoJSON.
// Covers: CTR, TMA, ATZ, MATZ, RESTRICTED, PROHIBITED, RMZ
// Styled by ICAO class and type.
//
// Data source: OpenAIP gb_airspace.geojson (bundled static asset)
//   Regenerate with: python3 fetch-gb-airspace.py
// Works online and offline.
//
// Depends on:
//   map (global alias), _overlayStates, _saveOverlayStates
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />
const AIRSPACE_SOURCE = 'airspace-source';
const AIRSPACE_LAYERS = ['airspace-fill', 'airspace-outline', 'airspace-labels'];
const AIRSPACE_FILTER = ['!=', ['get', 'type'], 'DANGER'];
// Outline colours by type
const AIRSPACE_LINE_COLOR = [
    'match', ['get', 'type'],
    'CTR', 'rgba( 80, 160, 255, 0.85)',
    'TMA', 'rgba( 80, 160, 255, 0.70)',
    'ATZ', 'rgba( 80, 200, 255, 0.80)',
    'MATZ', 'rgba(200, 255,   0, 0.75)',
    'RESTRICTED', 'rgba(255,  80,  80, 0.85)',
    'PROHIBITED', 'rgba(255,  40,  40, 1.00)',
    'RMZ', 'rgba(200, 100, 255, 0.75)',
    'rgba(180, 180, 180, 0.60)',
];
// Fill colours by type
const AIRSPACE_FILL_COLOR = [
    'match', ['get', 'type'],
    'CTR', 'rgba( 80, 160, 255, 0.03)',
    'TMA', 'rgba( 80, 160, 255, 0.02)',
    'ATZ', 'rgba( 80, 200, 255, 0.03)',
    'MATZ', 'rgba(200, 255,   0, 0.02)',
    'RESTRICTED', 'rgba(255,  80,  80, 0.03)',
    'PROHIBITED', 'rgba(255,  40,  40, 0.04)',
    'RMZ', 'rgba(200, 100, 255, 0.03)',
    'rgba(0, 0, 0, 0)',
];
const AIRSPACE_DASH = [
    'match', ['get', 'type'],
    'MATZ', ['literal', [4, 3]],
    'ATZ', ['literal', [6, 2]],
    ['literal', [1, 0]],
];
class AirspaceControl extends SentinelControlBase {
    constructor() {
        super();
        this.visible = _overlayStates.airspace ?? false;
    }
    get buttonLabel() { return 'AS'; }
    get buttonTitle() { return 'Toggle UK airspace'; }
    onInit() {
        this.setButtonActive(this.visible);
        if (this.map.isStyleLoaded()) {
            this.initLayers();
        }
        else {
            this.map.once('style.load', () => this.initLayers());
        }
    }
    handleClick() { }
    initLayers() {
        const vis = this.visible ? 'visible' : 'none';
        if (!this.map.getSource(AIRSPACE_SOURCE)) {
            this.map.addSource(AIRSPACE_SOURCE, {
                type: 'geojson',
                data: '/frontend/assets/gb_airspace.geojson',
            });
        }
        const beforeLayer = this.map.getLayer('aara-fill') ? 'aara-fill' : undefined;
        if (!this.map.getLayer('airspace-fill')) {
            this.map.addLayer({
                id: 'airspace-fill',
                type: 'fill',
                source: AIRSPACE_SOURCE,
                filter: AIRSPACE_FILTER,
                layout: { visibility: vis },
                paint: {
                    'fill-color': AIRSPACE_FILL_COLOR,
                    'fill-outline-color': 'rgba(0,0,0,0)',
                },
            }, beforeLayer);
        }
        if (!this.map.getLayer('airspace-outline')) {
            this.map.addLayer({
                id: 'airspace-outline',
                type: 'line',
                source: AIRSPACE_SOURCE,
                filter: AIRSPACE_FILTER,
                layout: { visibility: vis },
                paint: {
                    'line-color': AIRSPACE_LINE_COLOR,
                    'line-width': 1.2,
                    'line-dasharray': AIRSPACE_DASH,
                },
            }, beforeLayer);
        }
        if (!this.map.getLayer('airspace-labels')) {
            this.map.addLayer({
                id: 'airspace-labels',
                type: 'symbol',
                source: AIRSPACE_SOURCE,
                filter: AIRSPACE_FILTER,
                minzoom: 7,
                layout: {
                    visibility: vis,
                    'text-field': ['get', 'name'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': 10,
                    'text-anchor': 'center',
                    'symbol-placement': 'point',
                    'text-allow-overlap': false,
                },
                paint: {
                    'text-color': '#ffffff',
                },
            }, beforeLayer);
        }
    }
    toggle() {
        this.visible = !this.visible;
        const vis = this.visible ? 'visible' : 'none';
        AIRSPACE_LAYERS.forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', vis);
            }
            catch (_e) { }
        });
        this.setButtonActive(this.visible);
        _saveOverlayStates();
    }
    setVisible(v) {
        if (this.visible === v)
            return;
        this.visible = v;
        const vis = v ? 'visible' : 'none';
        AIRSPACE_LAYERS.forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', vis);
            }
            catch (_e) { }
        });
        this.setButtonActive(v);
    }
}
airspaceControl = new AirspaceControl();
map.addControl(airspaceControl, 'top-right');
