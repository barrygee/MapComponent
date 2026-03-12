// ============================================================
// OVERLAY STATE PERSISTENCE
// Saves and restores each map overlay's on/off state to localStorage
// so visibility choices survive page reloads.
//
// _OVERLAY_DEFAULTS  — default visibility on first load (no localStorage entry)
// _overlayStates     — live state object, read by controls at construction time
// _saveOverlayStates — called by each control after a toggle to persist the new state
//
// localStorage key: 'overlayStates'
// ============================================================

// First-load defaults — all controls start with these values before any user interaction
const _OVERLAY_DEFAULTS = {
    roads:      true,   // road layer visible by default
    names:      false,  // place names hidden by default
    rings:      false,  // range rings hidden by default
    aar:        false,  // A2A refuelling areas hidden by default
    awacs:      false,  // AWACS orbits hidden by default
    airports:   true,   // civil airports visible by default
    raf:        false,  // RAF bases hidden by default
    adsb:       true,   // live ADS-B feed visible by default
    adsbLabels: true,   // aircraft callsign labels visible by default
};

/**
 * Load saved overlay states from localStorage, merging over defaults.
 * IIFE — executes once at startup and never re-runs.
 * @type {object}  Live state object shared with all controls.
 */
const _overlayStates = (() => {
    try {
        const saved = localStorage.getItem('overlayStates');
        // Merge saved values over defaults so new keys added to defaults take effect
        return saved
            ? Object.assign({}, _OVERLAY_DEFAULTS, JSON.parse(saved))
            : Object.assign({}, _OVERLAY_DEFAULTS);
    } catch (e) {
        return Object.assign({}, _OVERLAY_DEFAULTS); // parse error — start fresh
    }
})();

/**
 * Persist the current visibility state of every control to localStorage.
 * Falls back to the cached _overlayStates value if a control instance is not yet available.
 * Called by each control after the user toggles it.
 */
function _saveOverlayStates() {
    try {
        localStorage.setItem('overlayStates', JSON.stringify({
            roads:      roadsControl      ? roadsControl.roadsVisible       : _overlayStates.roads,
            names:      namesControl      ? namesControl.namesVisible        : _overlayStates.names,
            rings:      rangeRingsControl ? rangeRingsControl.ringsVisible   : _overlayStates.rings,
            aar:        aarControl        ? aarControl.visible               : _overlayStates.aar,
            awacs:      awacsControl      ? awacsControl.visible             : _overlayStates.awacs,
            airports:   airportsControl   ? airportsControl.visible          : _overlayStates.airports,
            raf:        rafControl        ? rafControl.visible               : _overlayStates.raf,
            adsb:       adsbControl       ? adsbControl.visible              : _overlayStates.adsb,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible  : _overlayStates.adsbLabels,
        }));
    } catch (e) {} // localStorage quota or security error — silently ignore
}
