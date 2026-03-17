"use strict";
// ============================================================
// OVERLAY STATE PERSISTENCE
// Saves and restores each map overlay's on/off state to localStorage
// so visibility choices survive page reloads.
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />
const _OVERLAY_DEFAULTS = {
    roads: true,
    names: false,
    rings: false,
    aar: false,
    awacs: false,
    airports: true,
    militaryBases: false,
    adsb: true,
    adsbLabels: true,
};
/**
 * Load saved overlay states from localStorage, merging over defaults.
 */
let _overlayStates = (() => {
    try {
        const saved = localStorage.getItem('overlayStates');
        return saved
            ? Object.assign({}, _OVERLAY_DEFAULTS, JSON.parse(saved))
            : Object.assign({}, _OVERLAY_DEFAULTS);
    }
    catch (e) {
        return Object.assign({}, _OVERLAY_DEFAULTS);
    }
})();
/**
 * Persist the current visibility state of every control to localStorage,
 * then fire-and-forget sync to the backend database.
 */
function _saveOverlayStates() {
    try {
        const current = {
            roads: roadsControl ? roadsControl.roadsVisible : _overlayStates.roads,
            names: namesControl ? namesControl.namesVisible : _overlayStates.names,
            rings: rangeRingsControl ? rangeRingsControl.ringsVisible : _overlayStates.rings,
            aar: aarControl ? aarControl.visible : _overlayStates.aar,
            awacs: awacsControl ? awacsControl.visible : _overlayStates.awacs,
            airports: airportsControl ? airportsControl.visible : _overlayStates.airports,
            militaryBases: militaryBasesControl ? militaryBasesControl.visible : _overlayStates.militaryBases,
            adsb: adsbControl ? adsbControl.visible : _overlayStates.adsb,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible : _overlayStates.adsbLabels,
        };
        localStorage.setItem('overlayStates', JSON.stringify(current));
        if (window._SettingsAPI) {
            window._SettingsAPI.put('air', 'overlayStates', current);
        }
    }
    catch (e) { }
}
/**
 * Sync overlay states from the backend database (Phase 2 init).
 * Runs after controls are ready. On first run, migrates localStorage to backend.
 * On subsequent runs, restores from backend if available.
 */
async function _syncOverlayStatesFromBackend() {
    if (!window._SettingsAPI)
        return;
    const MIGRATED_FLAG = 'sentinel_settings_migrated_air';
    const existing = localStorage.getItem('overlayStates');
    if (!localStorage.getItem(MIGRATED_FLAG)) {
        // One-time migration: push existing localStorage value to backend
        if (existing) {
            try {
                await window._SettingsAPI.put('air', 'overlayStates', JSON.parse(existing));
            }
            catch (e) { }
        }
        localStorage.setItem(MIGRATED_FLAG, '1');
        return;
    }
    // Fetch from backend and apply if it differs from current localStorage
    const ns = await window._SettingsAPI.getNamespace('air');
    if (!ns || !ns.overlayStates)
        return;
    const backend = ns.overlayStates;
    _overlayStates = Object.assign({}, _OVERLAY_DEFAULTS, backend);
    localStorage.setItem('overlayStates', JSON.stringify(_overlayStates));
    // Apply the restored states to live controls
    if (roadsControl && roadsControl.roadsVisible !== _overlayStates.roads)
        roadsControl.toggleRoads();
    if (namesControl && namesControl.namesVisible !== _overlayStates.names)
        namesControl.toggleNames();
    if (rangeRingsControl && rangeRingsControl.ringsVisible !== _overlayStates.rings)
        rangeRingsControl.toggleRings();
    if (aarControl && aarControl.visible !== _overlayStates.aar)
        aarControl.toggle();
    if (awacsControl && awacsControl.visible !== _overlayStates.awacs)
        awacsControl.toggle();
    if (airportsControl && airportsControl.visible !== _overlayStates.airports)
        airportsControl.toggle();
    if (militaryBasesControl && militaryBasesControl.visible !== _overlayStates.militaryBases)
        militaryBasesControl.toggle();
    if (adsbControl && adsbControl.visible !== _overlayStates.adsb)
        adsbControl.toggle();
    if (adsbLabelsControl && adsbLabelsControl.labelsVisible !== _overlayStates.adsbLabels)
        adsbLabelsControl.toggle();
}
