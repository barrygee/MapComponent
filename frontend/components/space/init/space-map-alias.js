"use strict";
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
var map = window.MapComponent.map;
// Set global view — centred on equator, zoomed in enough for the full globe to fill the window with margin
map.jumpTo({ center: [12, 20], zoom: 1.5 });
