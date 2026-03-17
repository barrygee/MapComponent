"use strict";
// ============================================================
// SPACE OVERLAY STATE PERSISTENCE
// Saves and restores each space overlay's on/off state to localStorage
// so visibility choices survive page reloads.
// ============================================================

const _SPACE_OVERLAY_DEFAULTS = {
    iss: true,
    groundTrack: true,
    footprint: true,
    daynight: true,
};

/**
 * Load saved space overlay states from localStorage, merging over defaults.
 */
let _spaceOverlayStates = (() => {
    try {
        const saved = localStorage.getItem('spaceOverlayStates');
        return saved
            ? Object.assign({}, _SPACE_OVERLAY_DEFAULTS, JSON.parse(saved))
            : Object.assign({}, _SPACE_OVERLAY_DEFAULTS);
    } catch (e) {
        return Object.assign({}, _SPACE_OVERLAY_DEFAULTS);
    }
})();

/**
 * Persist the current visibility state of every space control to localStorage,
 * then fire-and-forget sync to the backend database.
 */
function _saveSpaceOverlayStates() {
    try {
        const current = {
            iss:        issControl      ? issControl.issVisible        : _spaceOverlayStates.iss,
            groundTrack: issControl     ? issControl.trackVisible      : _spaceOverlayStates.groundTrack,
            footprint:  issControl      ? issControl.footprintVisible  : _spaceOverlayStates.footprint,
            daynight:   daynightControl ? daynightControl.dnVisible    : _spaceOverlayStates.daynight,
        };
        localStorage.setItem('spaceOverlayStates', JSON.stringify(current));
        if (window._SettingsAPI) {
            window._SettingsAPI.put('space', 'spaceOverlayStates', current);
        }
    } catch (e) {}
}

/**
 * Sync space overlay states from the backend database (Phase 2 init).
 * Runs after controls are ready. On first run, migrates localStorage to backend.
 * On subsequent runs, restores from backend if available.
 */
async function _syncSpaceOverlayStatesFromBackend() {
    if (!window._SettingsAPI) return;
    const MIGRATED_FLAG = 'sentinel_settings_migrated_space';
    const existing = localStorage.getItem('spaceOverlayStates');

    if (!localStorage.getItem(MIGRATED_FLAG)) {
        // One-time migration: push existing localStorage value to backend
        if (existing) {
            try {
                await window._SettingsAPI.put('space', 'spaceOverlayStates', JSON.parse(existing));
            } catch (e) {}
        }
        localStorage.setItem(MIGRATED_FLAG, '1');
        return;
    }

    // Fetch from backend and apply if available
    const ns = await window._SettingsAPI.getNamespace('space');
    if (!ns || !ns.spaceOverlayStates) return;

    const backend = ns.spaceOverlayStates;
    _spaceOverlayStates = Object.assign({}, _SPACE_OVERLAY_DEFAULTS, backend);
    localStorage.setItem('spaceOverlayStates', JSON.stringify(_spaceOverlayStates));

    // Apply the restored states to live controls
    if (issControl) {
        if (issControl.issVisible       !== _spaceOverlayStates.iss)         issControl.toggleIss();
        if (issControl.trackVisible     !== _spaceOverlayStates.groundTrack) issControl.toggleTrack();
        if (issControl.footprintVisible !== _spaceOverlayStates.footprint)   issControl.toggleFootprint();
    }
    if (daynightControl && daynightControl.dnVisible !== _spaceOverlayStates.daynight) {
        daynightControl.toggleDaynight();
    }
}
