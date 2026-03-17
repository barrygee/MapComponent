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

// ----- Space control class shapes (defined in control files) -----
declare class IssControl extends SentinelControlBase {
    issVisible:       boolean;
    trackVisible:     boolean;
    footprintVisible: boolean;
    initLayers(): void;
    _fetch(): Promise<void>;
    _startPolling(): void;
    toggleIss(): void;
    toggleTrack(): void;
    toggleFootprint(): void;
}

declare class DaynightControl extends SentinelControlBase {
    dnVisible: boolean;
    initLayers(): void;
    _fetch(): Promise<void>;
    toggleDaynight(): void;
}

// ----- Control instances (declared in space-globals.ts) -----
declare let issControl:        IssControl        | null;
declare let daynightControl:   DaynightControl   | null;

// ----- Side-menu sync callback -----
declare let _spaceSyncSideMenu: (() => void) | null;

// ----- User location -----
declare let spaceUserLocationCenter: [number, number] | null;
declare let _onGoToSpaceUserLocation: (() => void) | null;

// ----- Overlay state helpers -----
declare let _spaceOverlayStates: SpaceOverlayStates;
declare function _saveSpaceOverlayStates(): void;
declare function _syncSpaceOverlayStatesFromBackend(): Promise<void>;

// ----- User location functions -----
declare function setSpaceUserLocation(position: GeolocationPosition | {
    coords: { longitude: number; latitude: number };
    _fromCache?: boolean;
    _manual?: boolean;
}): void;
declare function goToSpaceUserLocation(): void;
