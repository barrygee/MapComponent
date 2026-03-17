"use strict";
// ============================================================
// SPACE GLOBALS
// Shared mutable variable declarations for all space control files.
//
// Must be loaded before any control file so that cross-references
// between controls can reference these variables at parse time.
// All variables start as null and are assigned when controls are added.
// ============================================================
/// <reference path="../globals.d.ts" />
// Control instances — assigned when controls are added to the map
let issControl = null;
let daynightControl = null;
// Side-menu sync callback — assigned by space-side-menu.ts IIFE on load
let _spaceSyncSideMenu = null;
// User location — set by space-user-location.ts
let spaceUserLocationCenter = null;
let _onGoToSpaceUserLocation = null;
