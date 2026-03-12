// ============================================================
// SENTINEL — Ambient global declarations
// Teaches TypeScript about window.* assignments and the global
// `let`/`const`/`function` declarations that span script files.
// ============================================================

/// <reference types="maplibre-gl" />

// ---- Window interface extensions ----
interface Window {
    MapComponent:    MapComponentAPI;
    _Notifications:  NotificationsAPI;
    _Tracking:       TrackingAPI;
    _FilterPanel:    FilterPanelAPI;
    _adsb:           AdsbLiveControl | undefined;
    _is3DActive:     (() => boolean) | undefined;
    _getTargetPitch: (() => number)  | undefined;
    _setTargetPitch: ((p: number) => void) | undefined;
    _set3DActive:    ((active: boolean, applyPitch?: boolean) => void) | undefined;
}

// ---- Globals provided by external scripts (pmtiles, maplibre) ----
declare namespace pmtiles {
    class Protocol {
        tile: (params: unknown, callback: unknown) => unknown;
    }
}
declare const maplibregl: typeof import('maplibre-gl');

// Bring maplibre-gl types into a global namespace so that script files
// can use maplibregl.Map, maplibregl.Marker etc. as type annotations.
// Using inline import() types avoids making this file a module.
declare namespace maplibregl {
    type Map                     = import('maplibre-gl').Map;
    type Marker                  = import('maplibre-gl').Marker;
    type IControl                = import('maplibre-gl').IControl;
    type LngLatLike              = import('maplibre-gl').LngLatLike;
    type StyleSpecification      = import('maplibre-gl').StyleSpecification;
    type FilterSpecification     = import('maplibre-gl').FilterSpecification;
    type ExpressionSpecification = import('maplibre-gl').ExpressionSpecification;
    type GeoJSONSource           = import('maplibre-gl').GeoJSONSource;
    type MapOptions              = import('maplibre-gl').MapOptions;
    type MarkerOptions           = import('maplibre-gl').MarkerOptions;
    type AddProtocolAction       = import('maplibre-gl').AddProtocolAction;
    type GetResourceResponse<T>  = import('maplibre-gl').GetResourceResponse<T>;
    type TransformStyleFunction  = import('maplibre-gl').TransformStyleFunction;
    type MapLayerMouseEvent      = import('maplibre-gl').MapLayerMouseEvent;
    type MapMouseEvent           = import('maplibre-gl').MapMouseEvent;
    type EaseToOptions           = import('maplibre-gl').EaseToOptions;
}

// ---- Dataset constants (declared in their respective control files) ----
// These are const declarations in their respective .ts files — no declare needed here.
