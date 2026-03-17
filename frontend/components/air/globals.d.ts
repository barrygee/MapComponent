// ============================================================
// AIR GLOBALS — ambient declarations for all air component scripts.
// Referenced via: /// <reference path="../globals.d.ts" />
// (from files in frontend/components/air/**)
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../../types.ts" />

// ----- Overlay state functions -----
declare function _saveOverlayStates(): void;
declare function _syncOverlayStatesFromBackend(): Promise<void>;

