"use strict";
// ============================================================
// ROADS TOGGLE CONTROL
// Toggles 15 road-related MapLibre layer IDs on/off.
//
// Depends on: map (global alias), _overlayStates, _saveOverlayStates
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="sentinel-control-base.ts" />
class RoadsToggleControl extends SentinelControlBase {
    constructor() {
        super();
        this.roadsVisible = _overlayStates.roads;
    }
    get buttonLabel() { return 'R'; }
    get buttonTitle() { return 'Toggle road lines and names'; }
    onInit() {
        this.updateRoadsVisibility();
        this.map.once('style.load', () => this.updateRoadsVisibility());
    }
    handleClick() { this.toggleRoads(); }
    /** Sync the button colour/opacity to the current roadsVisible state. */
    updateButtonState() {
        this.button.style.opacity = this.roadsVisible ? '1' : '0.3';
        this.button.style.color = this.roadsVisible ? '#c8ff00' : '#ffffff';
    }
    /**
     * Apply the current roadsVisible state to all 15 road layer IDs.
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
            try {
                this.map.setLayoutProperty(id, 'visibility', visibility);
            }
            catch (e) { }
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
//# sourceMappingURL=roads.js.map