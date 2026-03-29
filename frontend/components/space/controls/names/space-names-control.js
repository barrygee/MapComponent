"use strict";
// ============================================================
// SPACE NAMES TOGGLE CONTROL
// Toggles place_* and water_name MapLibre layers on/off.
//
// Depends on: map (global alias), _spaceOverlayStates, _saveSpaceOverlayStates
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../../air/controls/sentinel-control-base/sentinel-control-base.ts" />
class SpaceNamesToggleControl extends SentinelControlBase {
    constructor() {
        super();
        this.namesVisible = _spaceOverlayStates.names;
    }
    get buttonLabel() { return 'N'; }
    get buttonTitle() { return 'Toggle city names'; }
    onInit() {
        this.setButtonActive(this.namesVisible);
        if (this.map.isStyleLoaded()) {
            this.applyNamesVisibility();
        }
        else {
            this.map.once('style.load', () => this.applyNamesVisibility());
        }
    }
    handleClick() { this.toggleNames(); }
    applyNamesVisibility() {
        const globeMode = typeof _spaceGlobeActive !== 'undefined' && _spaceGlobeActive;
        const countryLayers = ['place_country', 'place_country_other'];
        const detailLayers = ['place_suburb', 'place_village', 'place_town', 'place_city', 'place_state', 'water_name'];
        const countryVis = this.namesVisible ? 'visible' : 'none';
        const detailVis = (this.namesVisible && !globeMode) ? 'visible' : 'none';
        countryLayers.forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', countryVis);
            }
            catch (e) { }
        });
        detailLayers.forEach(id => {
            try {
                this.map.setLayoutProperty(id, 'visibility', detailVis);
            }
            catch (e) { }
        });
        this.setButtonActive(this.namesVisible);
    }
    toggleNames() {
        this.namesVisible = !this.namesVisible;
        this.applyNamesVisibility();
        _saveSpaceOverlayStates();
    }
}
spaceNamesControl = new SpaceNamesToggleControl();
map.addControl(spaceNamesControl, 'top-right');
