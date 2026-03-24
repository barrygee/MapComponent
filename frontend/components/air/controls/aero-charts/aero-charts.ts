// ============================================================
// AERONAUTICAL CHARTS OVERLAY CONTROL
// Renders UK IFR chart data from bundled GeoJSON files:
//   gb_airways.geojson       — airway segments (LineString)
//
// Airways source: X-Plane earth_awy.dat (GPL v3)
//
// Two independently toggleable groups:
//   LOW   — airways below FL245 (solid cyan-blue, 2px)
//   HIGH  — airways FL245+      (dashed amber, 1.5px)
//
// Regenerate data with: python3 fetch-gb-aero.py
//
// Depends on:
//   map (global alias), _overlayStates, _saveOverlayStates
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />

const AERO_SOURCES = {
    airways: 'aero-airways-source',
} as const;

// Layer IDs grouped by toggle category
const AERO_LAYER_GROUPS = {
    low:  ['aero-airways-low',  'aero-airways-low-labels' ],
    high: ['aero-airways-high', 'aero-airways-high-labels'],
} as const;

type AeroGroup = keyof typeof AERO_LAYER_GROUPS;
const ALL_AERO_LAYERS = ([] as string[]).concat(...Object.values(AERO_LAYER_GROUPS));

// ---- Visual styles ----

// LOW airways: subtle white, dashed — like range rings
const AWY_LOW_LINE_COLOR  = 'rgba(255, 255, 255, 0.40)';
const AWY_LOW_TEXT_COLOR  = 'rgba(255, 255, 255, 0.50)';

// HIGH airways: lime accent, slightly more prominent
const AWY_HIGH_LINE_COLOR = 'rgba(200, 255, 0, 0.55)';
const AWY_HIGH_TEXT_COLOR = 'rgba(200, 255, 0, 0.65)';

class AeroChartsControl extends SentinelControlBase {
    visible:  boolean;
    showLow:  boolean;
    showHigh: boolean;

    constructor() {
        super();
        this.visible  = _overlayStates.aeroCharts ?? false;
        this.showLow  = true;
        this.showHigh = true;
    }

    get buttonLabel(): string { return 'IFR'; }
    get buttonTitle(): string { return 'Toggle aeronautical charts'; }

    protected onInit(): void {
        this.setButtonActive(this.visible);
        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }
    }

    protected handleClick(): void { /* handled by side menu */ }

    initLayers(): void {
        // --- Sources ---
        if (!this.map.getSource(AERO_SOURCES.airways)) {
            this.map.addSource(AERO_SOURCES.airways, {
                type: 'geojson',
                data: '/frontend/assets/gb_airways.geojson',
            });
        }

        // Insert below airspace so airspace overlays on top
        const beforeLayer = this.map.getLayer('airspace-fill') ? 'airspace-fill' : undefined;

        const visLow  = (this.visible && this.showLow)  ? 'visible' : 'none';
        const visHigh = (this.visible && this.showHigh) ? 'visible' : 'none';

        // ---- LOW airways (below FL245) — subtle dashed white, like range rings ----
        if (!this.map.getLayer('aero-airways-low')) {
            this.map.addLayer({
                id:     'aero-airways-low',
                type:   'line',
                source: AERO_SOURCES.airways,
                filter: ['==', ['get', 'level'], 'low'],
                layout: { visibility: visLow },
                paint: {
                    'line-color':     AWY_LOW_LINE_COLOR,
                    'line-width':     1,
                    'line-dasharray': [4, 4],
                },
            }, beforeLayer);
        }

        if (!this.map.getLayer('aero-airways-low-labels')) {
            this.map.addLayer({
                id:      'aero-airways-low-labels',
                type:    'symbol',
                source:  AERO_SOURCES.airways,
                filter:  ['==', ['get', 'level'], 'low'],
                minzoom: 7,
                layout: {
                    visibility:              visLow,
                    'symbol-placement':      'line',
                    'symbol-spacing':        280,
                    'text-field':            ['get', 'name'],
                    'text-font':             ['Noto Sans Regular'],
                    'text-size':             9,
                    'text-allow-overlap':    false,
                    'text-ignore-placement': false,
                },
                paint: {
                    'text-color':      AWY_LOW_TEXT_COLOR,
                    'text-halo-color': 'rgba(0, 0, 0, 0.75)',
                    'text-halo-width': 1.2,
                },
            }, beforeLayer);
        }

        // ---- HIGH airways (FL245+) — subtle lime, dashed ----
        if (!this.map.getLayer('aero-airways-high')) {
            this.map.addLayer({
                id:     'aero-airways-high',
                type:   'line',
                source: AERO_SOURCES.airways,
                filter: ['==', ['get', 'level'], 'high'],
                layout: { visibility: visHigh },
                paint: {
                    'line-color':     AWY_HIGH_LINE_COLOR,
                    'line-width':     1,
                    'line-dasharray': [6, 3],
                },
            }, beforeLayer);
        }

        if (!this.map.getLayer('aero-airways-high-labels')) {
            this.map.addLayer({
                id:      'aero-airways-high-labels',
                type:    'symbol',
                source:  AERO_SOURCES.airways,
                filter:  ['==', ['get', 'level'], 'high'],
                minzoom: 7,
                layout: {
                    visibility:              visHigh,
                    'symbol-placement':      'line',
                    'symbol-spacing':        280,
                    'text-field':            ['get', 'name'],
                    'text-font':             ['Noto Sans Regular'],
                    'text-size':             9,
                    'text-allow-overlap':    false,
                    'text-ignore-placement': false,
                },
                paint: {
                    'text-color':      AWY_HIGH_TEXT_COLOR,
                    'text-halo-color': 'rgba(0, 0, 0, 0.75)',
                    'text-halo-width': 1.2,
                },
            }, beforeLayer);
        }

    }

    private _applyGroupVisibility(group: AeroGroup): void {
        const show = this.visible && (group === 'low' ? this.showLow : this.showHigh);
        const vis = show ? 'visible' : 'none';
        AERO_LAYER_GROUPS[group].forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', vis); } catch (_e) {}
        });
    }

    toggleGroup(group: AeroGroup): void {
        if (group === 'low')  this.showLow  = !this.showLow;
        if (group === 'high') this.showHigh = !this.showHigh;
        // If overall hidden but something is being turned on, show the control
        if (!this.visible) {
            this.visible = true;
            this.setButtonActive(true);
            _saveOverlayStates();
        }
        this._applyGroupVisibility(group);
    }

    isGroupActive(group: AeroGroup): boolean {
        if (!this.visible) return false;
        if (group === 'low') return this.showLow;
        return this.showHigh;
    }

    toggle(): void {
        this.visible = !this.visible;
        ALL_AERO_LAYERS.forEach(id => {
            try {
                const vis = this.visible ? 'visible' : 'none';
                this.map.setLayoutProperty(id, 'visibility', vis);
            } catch (_e) {}
        });
        // Respect per-group flags when turning back on
        if (this.visible) {
            (['low', 'high'] as AeroGroup[]).forEach(g => this._applyGroupVisibility(g));
        }
        this.setButtonActive(this.visible);
        _saveOverlayStates();
    }

    setVisible(v: boolean): void {
        if (this.visible === v) return;
        this.visible = v;
        if (v) {
            (['low', 'high'] as AeroGroup[]).forEach(g => this._applyGroupVisibility(g));
        } else {
            ALL_AERO_LAYERS.forEach(id => {
                try { this.map.setLayoutProperty(id, 'visibility', 'none'); } catch (_e) {}
            });
        }
        this.setButtonActive(v);
    }
}

aeroChartsControl = new AeroChartsControl();
map.addControl(aeroChartsControl, 'top-right');
