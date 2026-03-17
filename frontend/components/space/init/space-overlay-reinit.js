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
        if (issControl.issVisible) {
            issControl._fetch();
            issControl._startPolling();
        }
    }
});
