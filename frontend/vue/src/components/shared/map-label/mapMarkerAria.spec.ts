import { describe, it, expect } from 'vitest'
import type maplibregl from 'maplibre-gl'
import { setMarkerAccessibleName } from './mapMarkerAria'

/** The part of MapLibre's Marker this helper touches, with `addTo`'s own
 *  overwrite of the element's name reproduced — that overwrite is the whole
 *  reason the helper exists. */
function fakeMarker(element: HTMLElement) {
  return {
    getElement: () => element,
    addTo() {
      element.setAttribute('aria-label', 'Map marker')
      return this
    },
  }
}

describe('setMarkerAccessibleName', () => {
  it('sets the accessible name on the marker element', () => {
    const element = document.createElement('button')
    const marker = fakeMarker(element)
    setMarkerAccessibleName(marker as unknown as maplibregl.Marker, 'Sentry Roof Pi')
    expect(element.getAttribute('aria-label')).toBe('Sentry Roof Pi')
  })

  it("restores a name MapLibre's addTo has overwritten with its generic one", () => {
    const element = document.createElement('button')
    element.setAttribute('aria-label', 'Sentry Roof Pi')
    const marker = fakeMarker(element)
    marker.addTo()
    expect(element.getAttribute('aria-label')).toBe('Map marker') // MapLibre stomped it
    setMarkerAccessibleName(marker as unknown as maplibregl.Marker, 'Sentry Roof Pi')
    expect(element.getAttribute('aria-label')).toBe('Sentry Roof Pi')
  })

  it('replaces any name already set, rather than appending', () => {
    const element = document.createElement('button')
    const marker = fakeMarker(element)
    setMarkerAccessibleName(marker as unknown as maplibregl.Marker, 'first')
    setMarkerAccessibleName(marker as unknown as maplibregl.Marker, 'second')
    expect(element.getAttribute('aria-label')).toBe('second')
  })
})
