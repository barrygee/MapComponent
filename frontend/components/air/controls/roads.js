// ============================================================
// ROADS TOGGLE CONTROL
// Toggles 15 road-related MapLibre layer IDs on/off.
//
// Depends on: map (global alias), _overlayStates, _saveOverlayStates
// ============================================================

class RoadsToggleControl {
    constructor() {
        // Read persisted visibility state set by the previous session
        this.roadsVisible = _overlayStates.roads;
    }

    onAdd(map) {
        this.map = map;

        // Wrapper container required by the MapLibre control API
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        // Button element — lime when roads are visible, dimmed white when hidden
        this.button = document.createElement('button');
        this.button.className    = 'roads-toggle-btn';
        this.button.title        = 'Toggle road lines and names';
        this.button.textContent  = 'R';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:16px;color:#fff;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s;opacity:0.3';
        this.button.onclick      = () => this.toggleRoads();
        this.button.onmouseover  = () => { this.button.style.background = '#111'; };
        this.button.onmouseout   = () => { this.button.style.background = '#000'; };

        this.container.appendChild(this.button);

        // Apply initial visibility after the style is ready
        this.updateRoadsVisibility();
        // Re-apply after style reloads (handled by overlay-reinit.js — this once() is a safety net)
        this.map.once('style.load', () => this.updateRoadsVisibility());

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }

    /** Sync the button colour/opacity to the current roadsVisible state. */
    updateButtonState() {
        this.button.style.opacity = this.roadsVisible ? '1'        : '0.3';
        this.button.style.color   = this.roadsVisible ? '#c8ff00'  : '#ffffff';
    }

    /**
     * Apply the current roadsVisible state to all 15 road layer IDs.
     * Silently skips any layers that don't exist in the active style.
     */
    updateRoadsVisibility() {
        const visibility = this.roadsVisible ? 'visible' : 'none';
        const roadLayerIds = [
            'highway_path', 'highway_minor', 'highway_major_casing',
            'highway_major_inner', 'highway_major_subtle',
            'highway_motorway_casing', 'highway_motorway_inner',
            'highway_motorway_subtle', 'highway_name_motorway',
            'highway_name_other', 'highway_ref', 'tunnel_motorway_casing',
            'tunnel_motorway_inner', 'road_area_pier', 'road_pier',
        ];
        roadLayerIds.forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', visibility); } catch (e) {}
        });
        this.updateButtonState();
    }

    /** Toggle road visibility and persist the new state. */
    toggleRoads() {
        this.roadsVisible = !this.roadsVisible;
        this.updateRoadsVisibility();
        _saveOverlayStates();
    }
}

roadsControl = new RoadsToggleControl();
map.addControl(roadsControl, 'top-right');
