"use strict";
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
let rangeRingCenter = null;
// Control instances — assigned in the order controls are added to the map
let rangeRingsControl = null;
let adsbLabelsControl = null;
let roadsControl = null;
let namesControl = null;
let airportsControl = null;
let rafControl = null;
let aarControl = null;
let awacsControl = null;
let adsbControl = null;
let clearControl = null;
// Side-menu callbacks — assigned by the side-menu.ts IIFE on load.
let _syncSideMenuForPlanes = null;
let _onGoToUserLocation = null;
//# sourceMappingURL=air-globals.js.map