// ============================================================
// ROOT GLOBALS — ambient declarations shared across ALL scripts
// (air, space, shared). Referenced via three-level relative path
// from any component: /// <reference path="../../globals.d.ts" />
// or deeper paths as needed.
// ============================================================

/// <reference types="maplibre-gl" />
/// <reference path="../types.ts" />

// ----- pmtiles (loaded as a script tag) -----
declare namespace pmtiles {
    class Protocol {
        tile: (params: unknown, abortController: AbortController) => Promise<unknown>;
    }
}

// ----- Settings API -----
interface SettingsAPI {
    getNamespace(ns: string): Promise<Record<string, unknown> | null>;
    put(ns: string, key: string, value: unknown): Promise<void>;
}

// ----- MapComponent public API -----
interface MapComponentAPI {
    map:                    maplibregl.Map;
    onStyleLoad(fn: () => void): void;
    isOnline():             boolean;
    generateGeodesicCircle(lng: number, lat: number, radiusNm: number): [number, number][];
    buildRingsGeoJSON(lng: number, lat: number): RingsGeoJSON;
    computeCentroid(coordinates: number[][][]): [number, number];
    computeTextRotate(coordinates: number[][][]): number;
    computeLongestEdge(coordinates: number[][][]): [[number, number], [number, number]];
    RING_DISTANCES_NM: readonly number[];
}

// ----- Window augmentation -----
interface Window {
    _SettingsAPI:    SettingsAPI;
    MapComponent:    MapComponentAPI;
    _Notifications:  NotificationsAPI;
    _Tracking:       TrackingAPI;
    _FilterPanel:       FilterPanelAPI;
    _SpaceFilterPanel:  SpaceFilterPanelAPI;
    _SettingsPanel:     SettingsPanelAPI;
    _is3DActive?:    () => boolean;
    setUserLocation?: (position: { coords: { longitude: number; latitude: number }; _fromCache?: boolean; _manual?: boolean }) => void;
}
