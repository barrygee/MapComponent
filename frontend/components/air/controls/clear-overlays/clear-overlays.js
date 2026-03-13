"use strict";
// ============================================================
// CLEAR OVERLAYS CONTROL (✕ button)
// Toggles all overlays off in one click, then restores them.
// First click: saves all current states and hides everything.
// Second click: restores all overlays to their saved states.
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="sentinel-control-base.ts" />
class ClearOverlaysControl extends SentinelControlBase {
    constructor() {
        super();
        this._cleared = false;
        this.savedStates = null;
    }
    get buttonLabel() { return '✕'; }
    get buttonTitle() { return 'Toggle all overlays'; }
    onInit() {
        this.button.style.opacity = '0.3';
        this.button.style.color = '#ffffff';
        this.button.style.fontSize = '14px';
    }
    handleClick() { this.toggle(); }
    toggle() {
        if (!this._cleared) {
            this._hideAllOverlays();
        }
        else {
            this._restoreAllOverlays();
        }
    }
    /**
     * Snapshot current states, then turn off every overlay.
     */
    _hideAllOverlays() {
        this.savedStates = {
            roads: roadsControl ? roadsControl.roadsVisible : false,
            names: namesControl ? namesControl.namesVisible : false,
            rings: rangeRingsControl ? rangeRingsControl.ringsVisible : false,
            aar: aarControl ? aarControl.visible : false,
            awacs: awacsControl ? awacsControl.visible : false,
            airports: airportsControl ? airportsControl.visible : false,
            raf: rafControl ? rafControl.visible : false,
            adsb: adsbControl ? adsbControl.visible : false,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible : false,
        };
        if (roadsControl && roadsControl.roadsVisible)
            roadsControl.toggleRoads();
        if (namesControl && namesControl.namesVisible)
            namesControl.toggleNames();
        if (rangeRingsControl && rangeRingsControl.ringsVisible)
            rangeRingsControl.toggleRings();
        if (aarControl && aarControl.visible)
            aarControl.toggle();
        if (awacsControl && awacsControl.visible)
            awacsControl.toggle();
        if (airportsControl && airportsControl.visible)
            airportsControl.toggle();
        if (rafControl && rafControl.visible)
            rafControl.toggle();
        if (adsbControl && adsbControl.visible) {
            adsbControl.setAllHidden(true);
            adsbControl.setLabelsVisible(false);
            const keepTrails = adsbControl._followEnabled && adsbControl._selectedHex;
            if (!keepTrails) {
                try {
                    adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'none');
                }
                catch (e) { }
            }
        }
        this._cleared = true;
        this.button.style.opacity = '1';
        this.button.style.color = '#c8ff00';
    }
    /**
     * Restore every overlay to the state it was in before _hideAllOverlays().
     */
    _restoreAllOverlays() {
        if (!this.savedStates) {
            this._cleared = false;
            return;
        }
        const s = this.savedStates;
        if (roadsControl && s.roads && !roadsControl.roadsVisible)
            roadsControl.toggleRoads();
        if (namesControl && s.names && !namesControl.namesVisible)
            namesControl.toggleNames();
        if (rangeRingsControl && s.rings && !rangeRingsControl.ringsVisible)
            rangeRingsControl.toggleRings();
        if (aarControl && s.aar && !aarControl.visible)
            aarControl.toggle();
        if (awacsControl && s.awacs && !awacsControl.visible)
            awacsControl.toggle();
        if (airportsControl && s.airports && !airportsControl.visible)
            airportsControl.toggle();
        if (rafControl && s.raf && !rafControl.visible)
            rafControl.toggle();
        if (adsbControl && s.adsb) {
            adsbControl.setAllHidden(false);
            try {
                adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'visible');
            }
            catch (e) { }
            if (adsbLabelsControl) {
                adsbLabelsControl.labelsVisible = s.adsbLabels;
                adsbLabelsControl.button.style.opacity = s.adsbLabels ? '1' : '0.3';
                adsbLabelsControl.button.style.color = s.adsbLabels ? '#c8ff00' : '#ffffff';
                adsbControl.setLabelsVisible(s.adsbLabels);
            }
            _saveOverlayStates();
        }
        this._cleared = false;
        this.button.style.opacity = '0.3';
        this.button.style.color = '#ffffff';
        if (typeof _syncSideMenuForPlanes === 'function')
            _syncSideMenuForPlanes();
    }
}
clearControl = new ClearOverlaysControl();
map.addControl(clearControl, 'top-right');
//# sourceMappingURL=clear-overlays.js.map