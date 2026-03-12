// ============================================================
// NAMES TOGGLE CONTROL
// Toggles place_* and water_name MapLibre layers on/off.
//
// Depends on: map (global alias), _overlayStates, _saveOverlayStates
// ============================================================

class NamesToggleControl {
    constructor() {
        // Read persisted visibility state from the previous session
        this.namesVisible = _overlayStates.names;
    }

    onAdd(map) {
        this.map = map;

        // Wrapper container required by the MapLibre control API
        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        this.button = document.createElement('button');
        this.button.className   = 'names-toggle-btn';
        this.button.title       = 'Toggle city names';
        this.button.textContent = 'N';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:16px;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s,color 0.2s';
        this.button.style.opacity = this.namesVisible ? '1'       : '0.3';
        this.button.style.color   = this.namesVisible ? '#c8ff00' : '#ffffff';
        this.button.onclick     = () => this.toggleNames();
        this.button.onmouseover = () => { this.button.style.background = '#111'; };
        this.button.onmouseout  = () => { this.button.style.background = '#000'; };

        this.container.appendChild(this.button);

        // Apply initial visibility once the style is ready
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

    /**
     * Apply the current namesVisible state to all place name and water name layers.
     * Silently skips layers that don't exist in the active style.
     */
    applyNamesVisibility() {
        const visibility = this.namesVisible ? 'visible' : 'none';
        const nameLayers = [
            'place_suburb', 'place_village', 'place_town',
            'place_city', 'place_state', 'place_country',
            'place_country_other', 'water_name',
        ];
        nameLayers.forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', visibility); } catch (e) {}
        });
        // Sync button appearance
        this.button.style.opacity = this.namesVisible ? '1'       : '0.3';
        this.button.style.color   = this.namesVisible ? '#c8ff00' : '#ffffff';
    }

    /** Toggle name layer visibility and persist the new state. */
    toggleNames() {
        this.namesVisible = !this.namesVisible;
        this.applyNamesVisibility();
        _saveOverlayStates();
    }
}

namesControl = new NamesToggleControl();
map.addControl(namesControl, 'top-right');
