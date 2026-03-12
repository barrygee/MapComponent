// ============================================================
// AIR GLOBALS
// Shared mutable variable declarations for all air control files.
//
// Must be loaded before any control file so that cross-references
// between controls (e.g. adsbControl ↔ adsbLabelsControl) can
// reference these variables at parse time without a ReferenceError.
//
// All variables start as null and are assigned by each control's
// constructor when map.addControl() is called.
// ============================================================

// Range-ring state — the user's current position, updated by user-location.js
let rangeRingCenter   = null; // [lng, lat] | null

// Control instances — assigned in the order controls are added to the map
let rangeRingsControl = null; // RangeRingsControl
let adsbLabelsControl = null; // AdsbLabelsToggleControl

let roadsControl    = null;   // RoadsToggleControl
let namesControl    = null;   // NamesToggleControl
let airportsControl = null;   // AirportsToggleControl
let rafControl      = null;   // RAFToggleControl
let aarControl      = null;   // AARToggleControl
let awacsControl    = null;   // AWACSToggleControl
let adsbControl     = null;   // AdsbLiveControl
let clearControl    = null;   // ClearOverlaysControl

// Side-menu callbacks — assigned by the side-menu.js IIFE on load.
// Called by adsb.js and clear-overlays.js to sync button active states.
let _syncSideMenuForPlanes = null; // () => void — syncs PLANES/CALLSIGN button states
let _onGoToUserLocation    = null; // () => void — activates the location button highlight
