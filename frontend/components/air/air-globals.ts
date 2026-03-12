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

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

// Range-ring state — the user's current position, updated by user-location.ts
let rangeRingCenter:   LngLat | null = null;

// Control instances — assigned in the order controls are added to the map
let rangeRingsControl: RangeRingsControl      | null = null;
let adsbLabelsControl: AdsbLabelsToggleControl | null = null;

let roadsControl:    RoadsToggleControl    | null = null;
let namesControl:    NamesToggleControl    | null = null;
let airportsControl: AirportsToggleControl | null = null;
let rafControl:      RAFToggleControl      | null = null;
let aarControl:      AARToggleControl      | null = null;
let awacsControl:    AWACSToggleControl    | null = null;
let adsbControl:     AdsbLiveControl       | null = null;
let clearControl:    ClearOverlaysControl  | null = null;

// Side-menu callbacks — assigned by the side-menu.ts IIFE on load.
let _syncSideMenuForPlanes: (() => void) | null = null;
let _onGoToUserLocation:    (() => void) | null = null;
