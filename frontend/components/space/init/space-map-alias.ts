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

// Set global view — centred on equator, zoomed out to show full Earth
map.jumpTo({ center: [12, 20], zoom: 2 });
