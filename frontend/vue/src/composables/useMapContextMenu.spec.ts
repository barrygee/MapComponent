import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Map as MapLibreGlMap, MapMouseEvent } from 'maplibre-gl'
import { useMapContextMenu } from './useMapContextMenu'

function fakeMouseEvent(lng: number, lat: number): MapMouseEvent {
  return {
    lngLat: { lng, lat },
    originalEvent: { clientX: 100, clientY: 100 },
  } as unknown as MapMouseEvent
}

function fakeMap(): MapLibreGlMap {
  return { on: vi.fn(), off: vi.fn() } as unknown as MapLibreGlMap
}

describe('useMapContextMenu', () => {
  let rafCallback: FrameRequestCallback | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    rafCallback = null
    // Capture the rAF callback so the repositioning logic can be driven by hand.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('show renders a menu with N/E coordinates for positive lat/lng', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(2.35, 48.85))
    const el = document.body.firstElementChild as HTMLElement
    expect(el).toBeTruthy()
    expect(el.textContent).toContain('SET LOCATION')
    expect(el.textContent).toContain('N')
    expect(el.textContent).toContain('E')
  })

  it('show renders S/W coordinates for negative lat/lng', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(-58.38, -34.6))
    const el = document.body.firstElementChild as HTMLElement
    expect(el.textContent).toContain('S')
    expect(el.textContent).toContain('W')
  })

  it('show replaces any existing menu', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(1, 1))
    menu.show(fakeMouseEvent(2, 2))
    expect(document.body.children).toHaveLength(1)
  })

  it('remove deletes the menu and is a no-op when none exists', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(1, 1))
    menu.remove()
    expect(document.body.children).toHaveLength(0)
    expect(() => menu.remove()).not.toThrow()
  })

  it('the SET LOCATION button dispatches an event and closes the menu on click', () => {
    const menu = useMapContextMenu()
    const onSet = vi.fn()
    window.addEventListener('sentinel:setUserLocation', onSet)
    menu.show(fakeMouseEvent(2.35, 48.85))
    const button = document.body.querySelector('div > div') as HTMLElement
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSet).toHaveBeenCalledOnce()
    const detail = (onSet.mock.calls[0]![0] as CustomEvent).detail
    expect(detail).toEqual({ longitude: 2.35, latitude: 48.85 })
    expect(document.body.children).toHaveLength(0)
    window.removeEventListener('sentinel:setUserLocation', onSet)
  })

  describe('keyboard operability', () => {
    it('makes every item a named, focusable button', () => {
      const menu = useMapContextMenu()
      menu.show(fakeMouseEvent(1, 1))
      for (const item of [...document.body.firstElementChild!.children] as HTMLElement[]) {
        // A bare div with a click handler is reachable by mouse alone.
        expect(item.getAttribute('role')).toBe('button')
        expect(item.tabIndex).toBe(0)
        expect(item.getAttribute('aria-label')).toBeTruthy()
      }
    })

    it.each(['Enter', ' '])('activates an item on %s', (key) => {
      const menu = useMapContextMenu()
      const onSet = vi.fn()
      window.addEventListener('sentinel:setUserLocation', onSet)
      menu.show(fakeMouseEvent(2.35, 48.85))

      const item = document.body.firstElementChild!.children[0] as HTMLElement
      item.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

      expect(onSet).toHaveBeenCalledOnce()
      expect(document.body.children).toHaveLength(0)
      window.removeEventListener('sentinel:setUserLocation', onSet)
    })

    it('ignores other keys', () => {
      const menu = useMapContextMenu()
      menu.show(fakeMouseEvent(1, 1))
      const item = document.body.firstElementChild!.children[0] as HTMLElement
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      expect(document.body.children).toHaveLength(1)
    })
  })

  it('the button adjusts opacity on hover', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(1, 1))
    const button = document.body.querySelector('div > div') as HTMLElement
    button.dispatchEvent(new MouseEvent('mouseenter'))
    expect(button.style.opacity).toBe('0.85')
    button.dispatchEvent(new MouseEvent('mouseleave'))
    expect(button.style.opacity).toBe('')
  })

  it('repositions the menu when it would overflow the viewport', () => {
    const menu = useMapContextMenu()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      right: 99999,
      bottom: 99999,
      width: 200,
      height: 80,
    } as DOMRect)
    menu.show(fakeMouseEvent(1, 1))
    const el = document.body.firstElementChild as HTMLElement
    rafCallback?.(0)
    // left/top were recomputed off the right/bottom edges.
    expect(el.style.left).toBeTruthy()
    expect(el.style.top).toBeTruthy()
  })

  it('leaves the menu position unchanged when it fits in the viewport', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(1, 1))
    const el = document.body.firstElementChild as HTMLElement
    const leftBefore = el.style.left
    const topBefore = el.style.top
    // jsdom's getBoundingClientRect returns zeros → no overflow → no move.
    rafCallback?.(0)
    expect(el.style.left).toBe(leftBefore)
    expect(el.style.top).toBe(topBefore)
  })

  it('the rAF reposition is a no-op if the menu was removed first', () => {
    const menu = useMapContextMenu()
    menu.show(fakeMouseEvent(1, 1))
    menu.remove()
    expect(() => rafCallback?.(0)).not.toThrow()
  })

  describe('attach / detach', () => {
    it('attach wires map and document listeners; Escape closes the menu', () => {
      const menu = useMapContextMenu()
      const map = fakeMap()
      menu.attach(map)
      expect(map.on).toHaveBeenCalledTimes(4)
      menu.show(fakeMouseEvent(1, 1))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(document.body.children).toHaveLength(0)
    })

    it('a non-Escape key does not close the menu', () => {
      const menu = useMapContextMenu()
      menu.attach(fakeMap())
      menu.show(fakeMouseEvent(1, 1))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      expect(document.body.children).toHaveLength(1)
    })

    it('detach removes the menu and unbinds the map handlers', () => {
      const menu = useMapContextMenu()
      const map = fakeMap()
      menu.attach(map)
      menu.show(fakeMouseEvent(1, 1))
      menu.detach(map)
      expect(map.off).toHaveBeenCalledTimes(4)
      expect(document.body.children).toHaveLength(0)
    })

    it('detach tolerates a null map', () => {
      const menu = useMapContextMenu()
      menu.attach(fakeMap())
      expect(() => menu.detach(null)).not.toThrow()
    })
  })
})
