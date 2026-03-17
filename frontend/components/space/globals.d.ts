// ============================================================
// SPACE — Ambient global declarations
// Declares the global `let` variables shared across space script files.
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />

// ----- Space overlay state -----
interface SpaceOverlayStates {
    iss:         boolean;
    groundTrack: boolean;
    footprint:   boolean;
    daynight:    boolean;
}

// ----- Overlay state helpers (functions declared in space-overlay-state.ts) -----
declare function _saveSpaceOverlayStates(): void;
declare function _syncSpaceOverlayStatesFromBackend(): Promise<void>;

// ----- User location functions -----
declare function setSpaceUserLocation(position: GeolocationPosition | {
    coords: { longitude: number; latitude: number };
    _fromCache?: boolean;
    _manual?: boolean;
}): void;
declare function goToSpaceUserLocation(): void;
