// ============================================================
// NAMES TOGGLE CONTROL
// Toggles place_* and water_name MapLibre layers on/off.
//
// Depends on: map (global alias), _overlayStates, _saveOverlayStates
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />

class NamesToggleControl extends SentinelControlBase {
    namesVisible: boolean;

    constructor() {
        super();
        this.namesVisible = _overlayStates.names;
    }

    get buttonLabel(): string { return 'N'; }
    get buttonTitle(): string { return 'Toggle city names'; }

    protected onInit(): void {
        this.setButtonActive(this.namesVisible);
        if (this.map.isStyleLoaded()) {
            this.applyNamesVisibility();
        } else {
            this.map.once('style.load', () => this.applyNamesVisibility());
        }
    }

    protected handleClick(): void { this.toggleNames(); }

    /**
     * Apply the current namesVisible state to all place name and water name layers.
     */
    applyNamesVisibility(): void {
        const visibility = this.namesVisible ? 'visible' : 'none';
        const nameLayers = [
            'place_suburb', 'place_village', 'place_town',
            'place_city', 'place_state', 'place_country',
            'place_country_other', 'water_name',
        ];
        nameLayers.forEach(id => {
            try { this.map.setLayoutProperty(id, 'visibility', visibility); } catch (e) {}
        });
        this.setButtonActive(this.namesVisible);
    }

    /** Toggle name layer visibility and persist the new state. */
    toggleNames(): void {
        this.namesVisible = !this.namesVisible;
        this.applyNamesVisibility();
        _saveOverlayStates();
    }
}

namesControl = new NamesToggleControl();
map.addControl(namesControl, 'top-right');
