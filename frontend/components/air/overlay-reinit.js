"use strict";
// ============================================================
// OVERLAY REINIT
// Registers a single style.load callback with MapComponent that
// re-initialises all overlay layers whenever the map style is switched
// (e.g. online ↔ offline style change).
//
// Must be loaded after all control instances have been constructed.
// ============================================================
/// <reference path="../globals.d.ts" />
window.MapComponent.onStyleLoad(function () {
    if (roadsControl)
        roadsControl.updateRoadsVisibility();
    if (namesControl)
        namesControl.applyNamesVisibility();
    if (rangeRingsControl)
        rangeRingsControl.initRings();
    if (aarControl)
        aarControl.initLayers();
    if (awacsControl)
        awacsControl.initLayers();
    if (airportsControl)
        airportsControl.initLayers();
    if (rafControl)
        rafControl.initLayers();
    if (adsbControl)
        adsbControl.initLayers();
});
//# sourceMappingURL=overlay-reinit.js.map