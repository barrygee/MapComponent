"use strict";
// ============================================================
// SPACE OVERLAY REINIT
// Registers a style.load callback with MapComponent that
// re-initialises all space overlay layers whenever the map style
// is switched (e.g. online ↔ offline style change).
//
// Must be loaded after all space control instances have been constructed.
// ============================================================
/// <reference path="../globals.d.ts" />
window.MapComponent.onStyleLoad(function () {
    if (daynightControl) {
        daynightControl.initLayers();
        daynightControl._fetch();
    }
    if (issControl) {
        issControl.initLayers();
        // Always show and track ISS on load
        if (!issControl.issVisible)
            issControl.toggleIss();
        issControl._fetch();
        issControl._startPolling();
    }
    if (spaceNamesControl) {
        spaceNamesControl.applyNamesVisibility();
    }
    if (typeof _spaceGlobeActive !== 'undefined' && _spaceGlobeActive) {
        try {
            map.setProjection({ type: 'globe' });
        }
        catch (e) { /* ignore */ }
    }
});
