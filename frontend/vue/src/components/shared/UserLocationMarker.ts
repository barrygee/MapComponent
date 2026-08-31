import maplibregl from 'maplibre-gl'

/** The dot colour of the operator's own position — the app accent. */
export const LOCATION_MARKER_DOT_COLOR = '#c8ff00'

/**
 * The SENTINEL ⊙ logo mark as SVG markup (same ring/dot proportions as
 * `frontend/assets/logo.svg`): white ring, filled dot.
 *
 * The dasharray/dashoffset equal the ring's circumference (2π·13.1) so the
 * draw-in animation traces one full turn. The dot is deliberately static — no
 * pulse.
 *
 * Exported because the mark is not only the user's own position any more: the
 * Sentry sites plotted on every domain map (`SentrySitesControl`) are the same
 * mark, built here rather than copied so the two cannot drift apart. They differ
 * only in the dot's colour, which is what `dotColor` is for — the shape says
 * "a place Sentinel knows"; the colour says whose place it is.
 */
export function buildLocationMarkerSvg(dotColor: string = LOCATION_MARKER_DOT_COLOR): string {
  return `
        <svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" overflow="visible">
            <circle cx="30" cy="30" r="13.1"
                fill="none" stroke="#ffffff" stroke-width="2.2"
                stroke-dasharray="82.31" stroke-dashoffset="82.31"
                style="animation: marker-circle-draw 0.6s ease forwards" />
            <circle cx="30" cy="30" r="5.2" fill="${dotColor}" />
        </svg>`
}

function _buildElement(cssClass: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = cssClass
  wrapper.innerHTML = buildLocationMarkerSvg()
  return wrapper
}

export class UserLocationMarker {
  private _marker: maplibregl.Marker | null = null
  private _map: maplibregl.Map | null = null
  private _cssClass: string

  constructor(cssClass = 'user-location-marker') {
    this._cssClass = cssClass
  }

  addTo(map: maplibregl.Map): void {
    this._map = map
  }

  update(lon: number, lat: number): void {
    if (!this._map) return
    if (!this._marker) {
      const el = _buildElement(this._cssClass)
      this._marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(this._map)
    } else {
      this._marker.setLngLat([lon, lat])
    }
  }

  /**
   * Remove the rendered marker but keep the map reference, so a later
   * update() (e.g. a GPS fix after the config location was cleared) can
   * re-create it. Use destroy() for teardown that also drops the map.
   */
  remove(): void {
    this._marker?.remove()
    this._marker = null
  }

  /** Full teardown — removes the marker and releases the map reference. */
  destroy(): void {
    this.remove()
    this._map = null
  }
}
