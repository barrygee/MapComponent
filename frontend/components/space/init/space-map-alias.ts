// ============================================================
// SPACE MAP ALIAS
// Exposes the MapLibre GL map instance as a bare `map` global
// and sets the initial view to global zoom for the space domain.
//
// Must be loaded immediately after map.js (shared) and before any controls.
// ============================================================

/// <reference path="../globals.d.ts" />

// Unwrap the map instance from the public MapComponent API
// eslint-disable-next-line no-var
var map: maplibregl.Map = window.MapComponent.map;

// Set global view — centred on user's last known location if available, otherwise equator
const _cachedLoc = localStorage.getItem('userLocation');
let _initialCenter: [number, number] = [12, 20];
if (_cachedLoc) {
    try {
        const _parsed = JSON.parse(_cachedLoc) as { longitude: number; latitude: number };
        if (typeof _parsed.longitude === 'number' && typeof _parsed.latitude === 'number') {
            // Offset latitude southward so the user's location sits above centre,
            // giving a better sense of depth on the 3D globe
            _initialCenter = [_parsed.longitude, _parsed.latitude - 20];
        }
    } catch (_) {}
}
map.jumpTo({ center: _initialCenter, zoom: 10.0 });
