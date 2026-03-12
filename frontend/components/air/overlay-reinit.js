// ============================================================
// OVERLAY REINIT
// Registers a single style.load callback with MapComponent that
// re-initialises all overlay layers whenever the map style is switched
// (e.g. online ↔ offline style change).
//
// Style switches wipe all custom sources and layers, so each control
// exposes an init/reinit method that re-adds its layers from scratch.
//
// Must be loaded after all control instances have been constructed.
// ============================================================

window.MapComponent.onStyleLoad(function () {
    // Each guard (if control) prevents errors on pages where a control wasn't added
    if (roadsControl)      roadsControl.updateRoadsVisibility();  // re-apply road layer visibility
    if (namesControl)      namesControl.applyNamesVisibility();   // re-apply name layer visibility
    if (rangeRingsControl) rangeRingsControl.initRings();         // re-add range ring source + layer
    if (aarControl)        aarControl.initLayers();               // re-add AARA polygon layers
    if (awacsControl)      awacsControl.initLayers();             // re-add AWACS orbit layers
    if (airportsControl)   airportsControl.initLayers();          // re-add airport markers
    if (rafControl)        rafControl.initLayers();               // re-add RAF base markers
    if (adsbControl)       adsbControl.initLayers();              // re-add ADS-B sprite + trail layers
});
