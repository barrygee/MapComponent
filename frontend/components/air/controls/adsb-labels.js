"use strict";
// ============================================================
// ADS-B LABELS TOGGLE CONTROL
// Toggles the visibility of aircraft callsign label markers.
// Syncs with the main ADS-B toggle: labels are hidden when
// the ADS-B feed itself is disabled.
//
// Depends on: map (global alias), adsbControl, _overlayStates, _saveOverlayStates
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="sentinel-control-base.ts" />
class AdsbLabelsToggleControl extends SentinelControlBase {
    constructor() {
        super();
        this.labelsVisible = _overlayStates.adsbLabels ?? true;
    }
    get buttonLabel() { return 'L'; }
    get buttonTitle() { return 'Toggle aircraft labels'; }
    onInit() {
        const adsbIsOn = adsbControl ? adsbControl.visible : true;
        this.button.style.opacity = (adsbIsOn && this.labelsVisible) ? '1' : '0.3';
        this.button.style.color = (adsbIsOn && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        this.button.style.pointerEvents = adsbIsOn ? 'auto' : 'none';
    }
    handleClick() { this.toggle(); }
    /** Toggle label visibility and tell the ADS-B control to show/hide callsign markers. */
    toggle() {
        this.labelsVisible = !this.labelsVisible;
        this.button.style.opacity = this.labelsVisible ? '1' : '0.3';
        this.button.style.color = this.labelsVisible ? '#c8ff00' : '#ffffff';
        if (adsbControl)
            adsbControl.setLabelsVisible(this.labelsVisible);
        _saveOverlayStates();
    }
    /**
     * Called by the ADS-B control when the ADS-B feed is turned on/off.
     * Enables or disables the labels button to match the ADS-B state.
     */
    syncToAdsb(adsbVisible) {
        if (!this.button)
            return;
        this.button.style.pointerEvents = adsbVisible ? 'auto' : 'none';
        this.button.style.opacity = (adsbVisible && this.labelsVisible) ? '1' : '0.3';
        this.button.style.color = (adsbVisible && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        if (adsbVisible && adsbControl)
            adsbControl.setLabelsVisible(this.labelsVisible);
    }
}
adsbLabelsControl = new AdsbLabelsToggleControl();
map.addControl(adsbLabelsControl, 'top-right');
//# sourceMappingURL=adsb-labels.js.map