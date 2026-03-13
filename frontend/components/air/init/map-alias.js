"use strict";
// ============================================================
// MAP ALIAS
// Exposes the MapLibre GL map instance as a bare `map` global
// so all air control files can write `map.addLayer(...)` etc.
// without needing to know about the MapComponent wrapper.
//
// Must be loaded immediately after map.js (and before any controls).
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />
// Unwrap the map instance from the public MapComponent API
const map = window.MapComponent.map;
//# sourceMappingURL=map-alias.js.map