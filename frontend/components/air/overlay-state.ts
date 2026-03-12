// ============================================================
// OVERLAY STATE PERSISTENCE
// Saves and restores each map overlay's on/off state to localStorage
// so visibility choices survive page reloads.
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

const _OVERLAY_DEFAULTS: OverlayStates = {
    roads:      true,
    names:      false,
    rings:      false,
    aar:        false,
    awacs:      false,
    airports:   true,
    raf:        false,
    adsb:       true,
    adsbLabels: true,
};

/**
 * Load saved overlay states from localStorage, merging over defaults.
 */
let _overlayStates: OverlayStates = (() => {
    try {
        const saved = localStorage.getItem('overlayStates');
        return saved
            ? Object.assign({}, _OVERLAY_DEFAULTS, JSON.parse(saved) as Partial<OverlayStates>)
            : Object.assign({}, _OVERLAY_DEFAULTS);
    } catch (e) {
        return Object.assign({}, _OVERLAY_DEFAULTS);
    }
})();

/**
 * Persist the current visibility state of every control to localStorage.
 */
function _saveOverlayStates(): void {
    try {
        localStorage.setItem('overlayStates', JSON.stringify({
            roads:      roadsControl      ? roadsControl.roadsVisible          : _overlayStates.roads,
            names:      namesControl      ? namesControl.namesVisible           : _overlayStates.names,
            rings:      rangeRingsControl ? rangeRingsControl.ringsVisible      : _overlayStates.rings,
            aar:        aarControl        ? aarControl.visible                  : _overlayStates.aar,
            awacs:      awacsControl      ? awacsControl.visible                : _overlayStates.awacs,
            airports:   airportsControl   ? airportsControl.visible             : _overlayStates.airports,
            raf:        rafControl        ? rafControl.visible                  : _overlayStates.raf,
            adsb:       adsbControl       ? adsbControl.visible                 : _overlayStates.adsb,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible     : _overlayStates.adsbLabels,
        }));
    } catch (e) {}
}
