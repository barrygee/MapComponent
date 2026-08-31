import type maplibregl from 'maplibre-gl'

/**
 * Give a marker back the accessible name its element was built with.
 *
 * `Marker.addTo()` overwrites the element's `aria-label` with MapLibre's own
 * generic string ("Map marker"), discarding whatever the caller set — so every
 * marker whose element carries a real name has to restore it *after* it is
 * added, or a screen reader hears a map full of identical "Map marker"s.
 *
 * Only for markers that are genuinely their own object to a screen-reader user
 * (a Sentry site, a count standing for several). A marker whose element already
 * exposes its own text needs no name of its own.
 */
export function setMarkerAccessibleName(marker: maplibregl.Marker, name: string): void {
  marker.getElement().setAttribute('aria-label', name)
}
