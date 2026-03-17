"use strict";
// ============================================================
// DAY/NIGHT CONTROL
// Fetches the solar terminator from the backend and renders a
// semi-transparent dark polygon over the night side of the Earth.
//
// Polls /api/space/daynight every 60 seconds.
// Depends on: map (global alias), SentinelControlBase, _spaceOverlayStates
// ============================================================

class DaynightControl extends SentinelControlBase {
    constructor() {
        super();
        this.dnVisible = _spaceOverlayStates.daynight;
        this._pollInterval = null;
        this._geojson = null;
    }

    get buttonLabel() {
        return `<svg width="13" height="14" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 2C10 2 5 6.5 5 12s5 10 10 10c-6 0-11-4.5-11-10S9 2 15 2z" fill="#ffffff"/>
        </svg>`;
    }
    get buttonTitle() { return 'Toggle day/night shading'; }

    onInit() {
        this.setButtonActive(this.dnVisible);
        if (this.map.isStyleLoaded()) {
            this.initLayers();
            this._fetch();
        }
        // Style-reload reinit is handled by space-overlay-reinit.js via MapComponent.onStyleLoad
        this._pollInterval = setInterval(() => this._fetch(), 60000);
    }

    handleClick() { this.toggleDaynight(); }

    initLayers() {
        // Remove existing layers/sources if present (e.g. after style reload)
        ['daynight-fill'].forEach(id => {
            try { this.map.removeLayer(id); } catch (e) {}
        });
        try { if (this.map.getSource('daynight-source')) this.map.removeSource('daynight-source'); } catch (e) {}

        const emptyGeoJSON = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } };
        this.map.addSource('daynight-source', {
            type: 'geojson',
            data: this._geojson || emptyGeoJSON,
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

    async _fetch() {
        try {
            const resp = await fetch('/api/space/daynight');
            if (!resp.ok) return;
            const data = await resp.json();
            this._geojson = data;
            const src = this.map && this.map.getSource('daynight-source');
            if (src) src.setData(data);
        } catch (e) {
            // Silently ignore fetch errors — old data remains displayed
        }
    }

    toggleDaynight() {
        this.dnVisible = !this.dnVisible;
        try {
            this.map.setLayoutProperty('daynight-fill', 'visibility', this.dnVisible ? 'visible' : 'none');
        } catch (e) {}
        this.setButtonActive(this.dnVisible);
        if (typeof _spaceSyncSideMenu === 'function') _spaceSyncSideMenu();
        _saveSpaceOverlayStates();
    }

    onRemove() {
        if (this._pollInterval) clearInterval(this._pollInterval);
        super.onRemove();
    }
}

daynightControl = new DaynightControl();
map.addControl(daynightControl, 'top-right');
