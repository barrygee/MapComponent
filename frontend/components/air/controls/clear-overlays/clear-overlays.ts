// ============================================================
// CLEAR OVERLAYS CONTROL (✕ button)
// Toggles all overlays off in one click, then restores them.
// First click: saves all current states and hides everything.
// Second click: restores all overlays to their saved states.
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />

class ClearOverlaysControl extends SentinelControlBase {
    _cleared:    boolean;
    savedStates: OverlayStates | null;

    constructor() {
        super();
        this._cleared    = false;
        this.savedStates = null;
    }

    get buttonLabel(): string { return '✕'; }
    get buttonTitle(): string { return 'Toggle all overlays'; }

    protected onInit(): void {
        this.button.style.opacity   = '0.3';
        this.button.style.color     = '#ffffff';
        this.button.style.fontSize  = '14px';
    }

    protected handleClick(): void { this.toggle(); }

    toggle(): void {
        if (!this._cleared) {
            this._hideAllOverlays();
        } else {
            this._restoreAllOverlays();
        }
    }

    /**
     * Snapshot current states, then turn off every overlay.
     */
    _hideAllOverlays(): void {
        this.savedStates = {
            roads:      roadsControl      ? roadsControl.roadsVisible          : false,
            names:      namesControl      ? namesControl.namesVisible           : false,
            rings:      rangeRingsControl ? rangeRingsControl.ringsVisible      : false,
            aar:        aarControl        ? aarControl.visible                  : false,
            awacs:      awacsControl      ? awacsControl.visible                : false,
            airports:   airportsControl   ? airportsControl.visible             : false,
            militaryBases: militaryBasesControl ? militaryBasesControl.visible  : false,
            adsb:       adsbControl       ? adsbControl.visible                 : false,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible     : false,
        };

        if (roadsControl      && roadsControl.roadsVisible)      roadsControl.toggleRoads();
        if (namesControl      && namesControl.namesVisible)       namesControl.toggleNames();
        if (rangeRingsControl && rangeRingsControl.ringsVisible)  rangeRingsControl.toggleRings();
        if (aarControl        && aarControl.visible)              aarControl.toggle();
        if (awacsControl      && awacsControl.visible)            awacsControl.toggle();
        if (airportsControl   && airportsControl.visible)         airportsControl.toggle();
        if (militaryBasesControl && militaryBasesControl.visible) militaryBasesControl.toggle();

        if (adsbControl && adsbControl.visible) {
            adsbControl.setAllHidden(true);
            adsbControl.setLabelsVisible(false);
            const keepTrails = adsbControl._followEnabled && adsbControl._selectedHex;
            if (!keepTrails) {
                try { adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'none'); } catch (e) {}
            }
        }

        this._cleared = true;
        this.button.style.opacity = '1';
        this.button.style.color   = '#c8ff00';
    }

    /**
     * Restore every overlay to the state it was in before _hideAllOverlays().
     */
    _restoreAllOverlays(): void {
        if (!this.savedStates) { this._cleared = false; return; }
        const savedStates = this.savedStates;

        if (roadsControl      && savedStates.roads      && !roadsControl.roadsVisible)      roadsControl.toggleRoads();
        if (namesControl      && savedStates.names      && !namesControl.namesVisible)       namesControl.toggleNames();
        if (rangeRingsControl && savedStates.rings      && !rangeRingsControl.ringsVisible)  rangeRingsControl.toggleRings();
        if (aarControl        && savedStates.aar        && !aarControl.visible)              aarControl.toggle();
        if (awacsControl      && savedStates.awacs      && !awacsControl.visible)            awacsControl.toggle();
        if (airportsControl   && savedStates.airports   && !airportsControl.visible)         airportsControl.toggle();
        if (militaryBasesControl && savedStates.militaryBases && !militaryBasesControl.visible) militaryBasesControl.toggle();

        if (adsbControl && savedStates.adsb) {
            adsbControl.setAllHidden(false);
            try { adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'visible'); } catch (e) {}
            if (adsbLabelsControl) {
                adsbLabelsControl.labelsVisible        = savedStates.adsbLabels;
                adsbLabelsControl.button.style.opacity = savedStates.adsbLabels ? '1'       : '0.3';
                adsbLabelsControl.button.style.color   = savedStates.adsbLabels ? '#c8ff00' : '#ffffff';
                adsbControl.setLabelsVisible(savedStates.adsbLabels);
            }
            _saveOverlayStates();
        }

        this._cleared = false;
        this.button.style.opacity = '0.3';
        this.button.style.color   = '#ffffff';

        if (typeof _syncSideMenuForPlanes === 'function') _syncSideMenuForPlanes();
    }
}

clearControl = new ClearOverlaysControl();
map.addControl(clearControl, 'top-right');
