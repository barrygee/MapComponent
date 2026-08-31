import { describe, it, expect, beforeEach, vi } from 'vitest'

// Shared registry of every fake Marker the code under test constructs, so the
// spec can assert on the element/position passed to each one. Declared via
// vi.hoisted because the vi.mock factory below is hoisted above imports.
const markerRegistry = vi.hoisted(() => ({ instances: [] as FakeMarker[] }))

interface FakeMarker {
  options: { element: HTMLElement; anchor: string }
  getElement: () => HTMLElement
  setLngLat: ReturnType<typeof vi.fn>
  addTo: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

// The marker class must be a regular function, not an arrow — `new arrow()`
// throws, and UserLocationMarker swallows nothing here, but the convention keeps
// the mock callable with `new`.
vi.mock('maplibre-gl', () => {
  function Marker(this: FakeMarker, options: FakeMarker['options']) {
    this.options = options
    this.setLngLat = vi.fn().mockReturnThis()
    this.addTo = vi.fn().mockReturnThis()
    this.remove = vi.fn()
    this.getElement = () => this.options.element
    markerRegistry.instances.push(this)
  }
  return { default: { Marker } }
})

import { UserLocationMarker } from './UserLocationMarker'

// A stand-in for the MapLibre map — UserLocationMarker only ever stores and
// forwards the reference, so an opaque sentinel object is enough.
const fakeMap = { id: 'map' } as unknown as Parameters<UserLocationMarker['addTo']>[0]

describe('UserLocationMarker', () => {
  beforeEach(() => {
    markerRegistry.instances.length = 0
  })

  it('does not create a marker when update() is called before addTo()', () => {
    const marker = new UserLocationMarker()
    marker.update(1, 2)
    expect(markerRegistry.instances).toHaveLength(0)
  })

  it('creates a marker with the default css class on the first update', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    marker.update(2.35, 48.85)

    expect(markerRegistry.instances).toHaveLength(1)
    const created = markerRegistry.instances[0]!
    expect(created.options.anchor).toBe('center')
    expect(created.options.element.className).toBe('user-location-marker')
    // Lon/lat order is preserved as MapLibre expects ([lng, lat]).
    expect(created.setLngLat).toHaveBeenCalledWith([2.35, 48.85])
    expect(created.addTo).toHaveBeenCalledWith(fakeMap)
  })

  it('renders the animated SVG inside the marker element', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    marker.update(0, 0)
    const element = markerRegistry.instances[0]!.options.element
    expect(element.querySelector('svg')).not.toBeNull()
    expect(element.querySelectorAll('circle')).toHaveLength(2)
  })

  it('honours a custom css class', () => {
    const marker = new UserLocationMarker('space-user-location-marker')
    marker.addTo(fakeMap)
    marker.update(0, 0)
    expect(markerRegistry.instances[0]!.options.element.className).toBe(
      'space-user-location-marker',
    )
  })

  it('moves the existing marker on subsequent updates without recreating it', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    marker.update(1, 1)
    marker.update(3, 4)

    expect(markerRegistry.instances).toHaveLength(1)
    const created = markerRegistry.instances[0]!
    // First call from creation, second from the move.
    expect(created.setLngLat).toHaveBeenNthCalledWith(2, [3, 4])
  })

  it('remove() drops the rendered marker but lets a later update() recreate it', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    marker.update(1, 1)
    const first = markerRegistry.instances[0]!

    marker.remove()
    expect(first.remove).toHaveBeenCalledOnce()

    marker.update(5, 6)
    expect(markerRegistry.instances).toHaveLength(2)
    expect(markerRegistry.instances[1]!.setLngLat).toHaveBeenCalledWith([5, 6])
  })

  it('remove() is a no-op when no marker has been created yet', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    expect(() => marker.remove()).not.toThrow()
    expect(markerRegistry.instances).toHaveLength(0)
  })

  describe('setHidden', () => {
    it('hides and shows the rendered marker without discarding it', () => {
      const marker = new UserLocationMarker()
      marker.addTo(fakeMap)
      marker.update(1, 1)
      const element = markerRegistry.instances[0]!.options.element

      marker.setHidden(true)
      expect(element.style.display).toBe('none')
      marker.setHidden(false)
      expect(element.style.display).toBe('')
      // Hiding is not removing: the same marker is still the one on the map.
      expect(markerRegistry.instances).toHaveLength(1)
      expect(markerRegistry.instances[0]!.remove).not.toHaveBeenCalled()
    })

    it('is a safe no-op before the marker exists', () => {
      const marker = new UserLocationMarker()
      marker.addTo(fakeMap)
      expect(() => marker.setHidden(true)).not.toThrow()
      // …and the marker the next fix builds is visible, not born hidden.
      marker.update(1, 1)
      expect(markerRegistry.instances[0]!.options.element.style.display).toBe('')
    })
  })

  it('destroy() removes the marker and releases the map so updates stop', () => {
    const marker = new UserLocationMarker()
    marker.addTo(fakeMap)
    marker.update(1, 1)
    const first = markerRegistry.instances[0]!

    marker.destroy()
    expect(first.remove).toHaveBeenCalledOnce()

    // Map reference is gone — a further update must not build a new marker.
    marker.update(2, 2)
    expect(markerRegistry.instances).toHaveLength(1)
  })
})
