// ============================================================
// DAY/NIGHT CONTROL
// Fetches the solar terminator from the backend and renders a
// semi-transparent dark polygon over the night side of the Earth.
//
// Polls /api/space/daynight every 60 seconds.
// Depends on: map (global alias), SentinelControlBase, _spaceOverlayStates
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../../air/controls/sentinel-control-base/sentinel-control-base.ts" />

class DaynightControl extends SentinelControlBase {
    dnVisible:     boolean;
    _pollInterval: ReturnType<typeof setInterval> | null;
    _geojson:      GeoJSON.Feature | null;

    constructor() {
        super();
        this.dnVisible     = _spaceOverlayStates.daynight;
        this._pollInterval = null;
        this._geojson      = null;
    }

    get buttonLabel(): string {
        return `<svg width="13" height="14" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 2C10 2 5 6.5 5 12s5 10 10 10c-6 0-11-4.5-11-10S9 2 15 2z" fill="#ffffff"/>
        </svg>`;
    }
    get buttonTitle(): string { return 'Toggle day/night shading'; }

    protected onInit(): void {
        this.setButtonActive(this.dnVisible);
        // initLayers + fetch are handled by space-overlay-reinit.ts via MapComponent.onStyleLoad,
        // which fires immediately if the style is already loaded, or on next style.load otherwise.
        this._pollInterval = setInterval(() => this._fetch(), 60000);
    }

    protected handleClick(): void { this.toggleDaynight(); }

    initLayers(): void {
        // Remove existing layers/sources if present (e.g. after style reload)
        ['daynight-fill'].forEach(id => {
            try { this.map.removeLayer(id); } catch (e) {}
        });
        try { if (this.map.getSource('daynight-source')) this.map.removeSource('daynight-source'); } catch (e) {}

        const emptyGeoJSON: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} };
        this.map.addSource('daynight-source', {
            type: 'geojson',
            data: this._geojson ?? emptyGeoJSON,
        });

        this.map.addLayer({
            id: 'daynight-fill',
            type: 'fill',
            source: 'daynight-source',
            layout: { visibility: this.dnVisible ? 'visible' : 'none' },
            paint: {
                'fill-color': 'rgba(10, 10, 60, 0.18)',
                'fill-outline-color': 'rgba(10, 10, 60, 0.18)',
                'fill-opacity': 1,
            },
        });
    }

    async _fetch(): Promise<void> {
        try {
            const resp = await fetch('/api/space/daynight');
            if (!resp.ok) return;
            const data = await resp.json() as GeoJSON.Feature;
            this._geojson = data;
            const src = this.map && this.map.getSource('daynight-source') as maplibregl.GeoJSONSource | undefined;
            if (src) src.setData(data);
        } catch (e) {
            // Silently ignore fetch errors — old data remains displayed
        }
    }

    toggleDaynight(): void {
        this.dnVisible = !this.dnVisible;
        try {
            this.map.setLayoutProperty('daynight-fill', 'visibility', this.dnVisible ? 'visible' : 'none');
        } catch (e) {}
        this.setButtonActive(this.dnVisible);
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
        _saveSpaceOverlayStates();
    }

    onRemove(): void {
        if (this._pollInterval) clearInterval(this._pollInterval);
        super.onRemove();
    }
}

daynightControl = new DaynightControl();
map.addControl(daynightControl, 'top-right');
