import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { axe } from 'jest-axe'

// ── maplibre-gl mock: record the markers the control creates, so its
//    DOM and lifecycle effects can be asserted without a real map. The classes
//    live in vi.hoisted so they exist when the (hoisted) vi.mock factory runs. ─
interface RecordedMarker {
  element: HTMLElement
  anchor: string | undefined
  lngLat: [number, number] | null
  removed: boolean
}
const mocks = vi.hoisted(() => {
  const created = { markers: [] as RecordedMarker[] }
  class MockMarker {
    element: HTMLElement
    anchor: string | undefined
    lngLat: [number, number] | null = null
    removed = false
    constructor(options: { element: HTMLElement; anchor?: string }) {
      this.element = options.element
      this.anchor = options.anchor
      created.markers.push(this)
    }
    setLngLat(coords: [number, number]): this {
      this.lngLat = coords
      return this
    }
    getElement(): HTMLElement {
      return this.element
    }
    addTo(): this {
      // MapLibre's own Marker.addTo replaces whatever accessible name the
      // element carried with its generic one — reproduced here because putting
      // the real name back is behaviour this control is responsible for.
      this.element.setAttribute('aria-label', 'Map marker')
      return this
    }
    remove(): this {
      this.removed = true
      return this
    }
  }
  return { created, MockMarker }
})

const created = mocks.created

vi.mock('maplibre-gl', () => ({ default: { Marker: mocks.MockMarker } }))

import { SentrySitesControl, siteLabel } from './SentrySitesControl'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useSettingsStore } from '@/stores/settings'
import type { SentrySite } from '@/services/sentryApi'

function site(overrides: Partial<SentrySite> = {}): SentrySite {
  return {
    id: 1,
    name: 'Roof Pi',
    address: '192.168.1.60',
    port: 8000,
    reachable: true,
    latitude: 51.5,
    longitude: -0.1,
    updated_at: 1000,
    ...overrides,
  }
}

function makeFakeMap() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const handlers: Record<string, (() => void)[]> = {}
  return {
    getContainer: () => container,
    _container: container,
    // Scaled so any two distinct fixture positions land far apart — clustering
    // tests set positions deliberately close.
    project: ([lon, lat]: [number, number]) => ({ x: lon * 1_000_000, y: -lat * 1_000_000 }),
    zoom: 6,
    getZoom(): number {
      return this.zoom
    },
    easeTo: vi.fn(),
    on: (event: string, handler: () => void) => {
      ;(handlers[event] ??= []).push(handler)
    },
    off: (event: string, handler: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((each) => each !== handler)
    },
    /** Fire a map event, as MapLibre does once a pan or zoom settles. */
    _emit: (event: string) => (handlers[event] ?? []).forEach((handler) => handler()),
    _handlerCount: (event: string) => (handlers[event] ?? []).length,
  }
}

/** Markers still on the map (a rebuilt marker leaves its removed predecessor in
 *  the recorded list). */
function liveMarkers(): RecordedMarker[] {
  return created.markers.filter((marker) => !marker.removed)
}

/** The site markers among them — the ⊙ marks, as opposed to the counts. */
function siteMarkers(): RecordedMarker[] {
  return liveMarkers().filter((marker) => marker.element.className.startsWith('sentry-map-marker'))
}

/** The ⊙ button inside a site marker — what a pointer or the keyboard acts on. */
function markButton(marker: RecordedMarker): HTMLButtonElement {
  return marker.element.querySelector<HTMLButtonElement>('.sentry-map-marker-mark')!
}

/** One site marker's details panel. */
function flyout(marker: RecordedMarker): HTMLElement {
  return marker.element.querySelector<HTMLElement>('.sentry-map-marker-info')!
}

/** Whether a marker's details are latched open (hover and focus are CSS, and
 *  jsdom has no layout to assert them through). */
function isLatchedOpen(marker: RecordedMarker): boolean {
  return marker.element.classList.contains('sentry-map-marker--open')
}

function clusterMarkers(): RecordedMarker[] {
  return liveMarkers().filter((marker) => marker.element.className === 'sentry-cluster-marker')
}

describe('SentrySitesControl', () => {
  let sitesStore: ReturnType<typeof useSentrySitesStore>
  let settingsStore: ReturnType<typeof useSettingsStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    created.markers.length = 0
    // The control starts the store polling on init; stub fetch so it never hits
    // the network.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    sitesStore = useSentrySitesStore()
    settingsStore = useSettingsStore()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.documentElement.style.removeProperty('--nav-height')
    document.body.innerHTML = ''
  })

  function addControl() {
    const control = new SentrySitesControl(sitesStore, settingsStore)
    const map = makeFakeMap()
    control.onAdd(map as never)
    return { control, map }
  }

  describe('lifecycle', () => {
    it('starts polling and plots the sites already known on add', () => {
      const startSpy = vi.spyOn(sitesStore, 'startPolling')
      sitesStore.sites = [site()]
      addControl()
      expect(startSpy).toHaveBeenCalledOnce()
      expect(siteMarkers()).toHaveLength(1)
      expect(siteMarkers()[0]!.lngLat).toEqual([-0.1, 51.5])
      expect(siteMarkers()[0]!.anchor).toBe('center')
    })

    it('stops polling and tears down markers, details and the a11y region on remove', () => {
      const stopSpy = vi.spyOn(sitesStore, 'stopPolling')
      sitesStore.sites = [site()]
      const { control, map } = addControl()
      const marker = siteMarkers()[0]!
      markButton(marker).dispatchEvent(new Event('click'))
      control.onRemove()
      expect(stopSpy).toHaveBeenCalledOnce()
      expect(created.markers.every((each) => each.removed)).toBe(true)
      expect(isLatchedOpen(marker)).toBe(false)
      expect(map._container.querySelector('[role="region"]')).toBeNull()
      expect(map._handlerCount('moveend')).toBe(0)
    })

    it('stops listening for Escape on remove', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      sitesStore.sites = [site()]
      const { control } = addControl()
      control.onRemove()
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
      // …and the handler that went is the one that was registered, so a later
      // Escape cannot reach a control whose map is gone.
      const registered = removeSpy.mock.calls.find(([event]) => event === 'keydown')![1]
      expect(typeof registered).toBe('function')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(() => (registered as EventListener)(new KeyboardEvent('keydown'))).not.toThrow()
    })

    it('tears down the count markers too, not only the site marks', () => {
      sitesStore.sites = [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 0.000_01, latitude: 0 }),
      ]
      const { control } = addControl()
      expect(clusterMarkers()).toHaveLength(1)
      control.onRemove()
      expect(clusterMarkers()).toHaveLength(0)
      expect(created.markers.every((marker) => marker.removed)).toBe(true)
    })

    it('re-groups the sites when a map movement settles', () => {
      sitesStore.sites = [site()]
      const { map } = addControl()
      const before = created.markers.length
      map._emit('moveend')
      // Nothing changed, so the existing marker is kept rather than rebuilt.
      expect(created.markers).toHaveLength(before)
      expect(siteMarkers()).toHaveLength(1)
    })

    it('exposes a descriptive accessible name on its button', () => {
      const { control } = addControl()
      expect(control.buttonTitle).toBe('Toggle Sentry sites')
      expect(control.button.getAttribute('aria-label')).toBe('Toggle Sentry sites')
      expect(control.buttonLabel).toContain('<svg')
    })
  })

  describe('plotting sites', () => {
    it('draws each site with the ⊙ mark, its centre dot blacked out', () => {
      sitesStore.sites = [site()]
      addControl()
      const mark = markButton(siteMarkers()[0]!)
      expect(mark.tagName).toBe('BUTTON')
      expect(mark.innerHTML).toContain('r="5.2" fill="#000000"') // the blacked-out centre
      expect(mark.innerHTML).toContain('#ffffff') // the shared white ring
      // Never the operator's own accent dot — that is what tells the two apart.
      expect(mark.innerHTML).not.toContain('#c8ff00')
    })

    it("names the mark for assistive tech, and takes MapLibre's generic name off the container", () => {
      sitesStore.sites = [site()]
      addControl()
      const marker = siteMarkers()[0]!
      expect(markButton(marker).getAttribute('aria-label')).toBe('Sentry Roof Pi — show details')
      // ARIA prohibits aria-label on a container with no role, and MapLibre
      // stamps one on as it adds the marker.
      expect(marker.element.hasAttribute('aria-label')).toBe(false)
    })

    it('falls back to address:port for a host with no name', () => {
      sitesStore.sites = [site({ name: null })]
      addControl()
      expect(markButton(siteMarkers()[0]!).getAttribute('aria-label')).toBe(
        'Sentry 192.168.1.60:8000 — show details',
      )
    })

    it('treats a blank name as no name at all', () => {
      expect(siteLabel(site({ name: '   ' }))).toBe('192.168.1.60:8000')
      expect(siteLabel(site({ name: 'Roof Pi' }))).toBe('Roof Pi')
    })

    it('moves an existing marker rather than rebuilding it when a site is re-sited', async () => {
      sitesStore.sites = [site()]
      addControl()
      const before = created.markers.length
      sitesStore.sites = [site({ latitude: 52 })]
      await nextTick()
      expect(created.markers).toHaveLength(before) // same marker, moved
      expect(siteMarkers()[0]!.lngLat).toEqual([-0.1, 52])
    })

    it('removes the marker for a host that is deregistered or disabled', async () => {
      sitesStore.sites = [site()]
      addControl()
      sitesStore.sites = []
      await nextTick()
      expect(siteMarkers()).toHaveLength(0)
      expect(created.markers.every((marker) => marker.removed)).toBe(true)
    })

    it('plots nothing when no host reports a position', () => {
      addControl()
      expect(created.markers).toHaveLength(0)
    })
  })

  describe('crowded sites', () => {
    /** Two sites close enough on screen to collapse into one count, plus a third
     *  well clear of them. */
    function crowdedSites(): SentrySite[] {
      return [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 0.000_01, latitude: 0 }),
        site({ id: 3, name: 'C', longitude: 5, latitude: 5 }),
      ]
    }

    it('collapses overlapping sites into one count and leaves the rest as marks', () => {
      sitesStore.sites = crowdedSites()
      addControl()
      expect(clusterMarkers()).toHaveLength(1)
      expect(siteMarkers()).toHaveLength(1) // the one clear of the others
      const count = clusterMarkers()[0]!.element
      expect(count.querySelector('.sentry-cluster-count')!.textContent).toBe('2')
      expect(count.getAttribute('aria-label')).toBe('2 Sentry sites here — zoom in to see them')
    })

    it('never counts a lone site — a "1" says less than the mark it replaced', () => {
      sitesStore.sites = [site()]
      addControl()
      expect(clusterMarkers()).toHaveLength(0)
      expect(siteMarkers()).toHaveLength(1)
    })

    it('zooms in on the group when its count is clicked, capped at the reveal ceiling', () => {
      sitesStore.sites = crowdedSites()
      const { map } = addControl()
      clusterMarkers()[0]!.element.dispatchEvent(new Event('click'))
      expect(map.easeTo).toHaveBeenCalledWith({
        center: [0, 0],
        zoom: 9, // 6 + the 3-level step
        duration: 300,
      })
    })

    it('never zooms past the ceiling, however far in the map already is', () => {
      sitesStore.sites = crowdedSites()
      const { map } = addControl()
      map.zoom = 13
      map._emit('moveend')
      clusterMarkers()[0]!.element.dispatchEvent(new Event('click'))
      expect(map.easeTo).toHaveBeenCalledWith(
        expect.objectContaining({ zoom: 14 }), // capped, not 16
      )
    })

    it('keeps a count marker while its membership holds, and rebuilds it when it changes', async () => {
      sitesStore.sites = crowdedSites()
      addControl()
      const firstCount = clusterMarkers()[0]!
      // Same two sites, one of them re-sited a hair — still one group of two.
      sitesStore.sites = [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 0.000_02, latitude: 0 }),
        site({ id: 3, name: 'C', longitude: 5, latitude: 5 }),
      ]
      await nextTick()
      expect(clusterMarkers()[0]).toBe(firstCount) // kept, not rebuilt
      // A third site joins the huddle → the face has to change, so it is rebuilt.
      sitesStore.sites = [
        ...crowdedSites(),
        site({ id: 4, name: 'D', longitude: 0.000_02, latitude: 0 }),
      ]
      await nextTick()
      expect(firstCount.removed).toBe(true)
      expect(clusterMarkers()[0]!.element.querySelector('.sentry-cluster-count')!.textContent).toBe(
        '3',
      )
    })

    it('takes a group apart again when the sites in it separate', async () => {
      sitesStore.sites = crowdedSites()
      addControl()
      expect(clusterMarkers()).toHaveLength(1)
      sitesStore.sites = [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 9, latitude: 9 }),
        site({ id: 3, name: 'C', longitude: 5, latitude: 5 }),
      ]
      await nextTick()
      expect(clusterMarkers()).toHaveLength(0)
      expect(siteMarkers()).toHaveLength(3)
    })
  })

  describe("a site's details", () => {
    function addSite(overrides: Partial<SentrySite> = {}) {
      sitesStore.sites = [site(overrides)]
      const added = addControl()
      const marker = siteMarkers()[0]!
      return { ...added, marker, panel: flyout(marker) }
    }

    it('sits inside the marker, so it travels with it rather than being placed', () => {
      const { marker, panel } = addSite()
      // Built into the marker element itself: no separate popup is created, and
      // nothing has to be re-anchored when the map moves.
      expect(marker.element.contains(panel)).toBe(true)
      expect(marker.element.children).toHaveLength(2) // the mark, then its details
    })

    it('shows the name, where it answers, and a reachability dot', () => {
      const { panel } = addSite()
      expect(panel.querySelector('.sentry-map-marker-name')!.textContent).toBe('Roof Pi')
      expect(panel.querySelector('.sentry-map-marker-meta')!.textContent).toContain(
        '192.168.1.60:8000',
      )
      const dot = panel.querySelector('.sentry-map-marker-status')!
      expect(dot.classList.contains('sentry-map-marker-status--online')).toBe(true)
    })

    it('never leaves the status to colour alone', () => {
      const { panel } = addSite()
      const dot = panel.querySelector<HTMLElement>('.sentry-map-marker-status')!
      expect(dot.title).toBe('Online')
      expect(dot.querySelector('.sr-only')!.textContent).toBe('Online')
    })

    it('marks a host that is off the network as off air, not as missing', () => {
      const { panel } = addSite({ reachable: false })
      const dot = panel.querySelector<HTMLElement>('.sentry-map-marker-status')!
      expect(dot.classList.contains('sentry-map-marker-status--offair')).toBe(true)
      expect(dot.title).toBe('Off air')
      expect(dot.querySelector('.sr-only')!.textContent).toBe('Off air')
    })

    it('names an unlabelled host by where it answers', () => {
      const { panel } = addSite({ name: null })
      expect(panel.querySelector('.sentry-map-marker-name')!.textContent).toBe('192.168.1.60:8000')
    })

    it('is closed until the operator asks for it', () => {
      const { marker } = addSite()
      expect(isLatchedOpen(marker)).toBe(false)
      expect(markButton(marker).getAttribute('aria-expanded')).toBe('false')
    })

    it('latches open on press, and closed again on a second press', () => {
      const { marker } = addSite()
      markButton(marker).dispatchEvent(new Event('click'))
      expect(isLatchedOpen(marker)).toBe(true)
      expect(markButton(marker).getAttribute('aria-expanded')).toBe('true')
      markButton(marker).dispatchEvent(new Event('click'))
      expect(isLatchedOpen(marker)).toBe(false)
      expect(markButton(marker).getAttribute('aria-expanded')).toBe('false')
    })

    it('points the mark at the details it opens, for assistive tech', () => {
      const { marker, panel } = addSite({ id: 7 })
      expect(panel.id).toBe('sentry-site-flyout-7')
      expect(markButton(marker).getAttribute('aria-controls')).toBe(panel.id)
    })

    it('closes whichever panel was open when another is pressed', () => {
      sitesStore.sites = [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 5, latitude: 5 }),
      ]
      addControl()
      const [first, second] = siteMarkers() as [RecordedMarker, RecordedMarker]
      markButton(first).dispatchEvent(new Event('click'))
      markButton(second).dispatchEvent(new Event('click'))
      expect(isLatchedOpen(first)).toBe(false)
      expect(isLatchedOpen(second)).toBe(true)
    })

    it('closes on Escape', () => {
      const { marker } = addSite()
      markButton(marker).dispatchEvent(new Event('click'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(isLatchedOpen(marker)).toBe(false)
    })

    it('ignores other keys', () => {
      const { marker } = addSite()
      markButton(marker).dispatchEvent(new Event('click'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      expect(isLatchedOpen(marker)).toBe(true)
    })

    it('closes with the site when it leaves the map', async () => {
      const { marker } = addSite()
      markButton(marker).dispatchEvent(new Event('click'))
      sitesStore.sites = []
      await nextTick()
      expect(isLatchedOpen(marker)).toBe(false)
    })

    it('MORE opens that host in the SDR settings section and closes the details', () => {
      const { marker, panel } = addSite({ id: 7 })
      markButton(marker).dispatchEvent(new Event('click'))
      const more = panel.querySelector<HTMLButtonElement>('.sentry-map-marker-more')!
      expect(more.textContent).toBe('MORE')
      expect(more.getAttribute('aria-label')).toBe('Open Roof Pi in Settings')
      more.dispatchEvent(new Event('click'))
      expect(settingsStore.open).toBe(true)
      expect(settingsStore.activeSection).toBe('sdr')
      expect(settingsStore.focusSentryHostId).toBe(7)
      expect(isLatchedOpen(marker)).toBe(false)
    })

    it('has no accessibility violations', async () => {
      const { marker } = addSite()
      markButton(marker).dispatchEvent(new Event('click'))
      const host = document.createElement('div')
      host.appendChild(marker.element)
      // `region` is off: this is a map marker in isolation, not a page — the
      // landmark it belongs to is the map container itself.
      expect(await axe(host, { rules: { region: { enabled: false } } })).toHaveNoViolations()
    })
  })

  describe('visibility', () => {
    it('hides and shows the sites, and is a no-op when already in that state', () => {
      sitesStore.sites = [site()]
      const { control } = addControl()
      expect(siteMarkers()).toHaveLength(1)
      control.setVisible(false)
      expect(siteMarkers()).toHaveLength(0)
      const afterHide = created.markers.length
      control.setVisible(false) // already hidden → no re-render
      expect(created.markers).toHaveLength(afterHide)
      control.setVisible(true)
      expect(siteMarkers()).toHaveLength(1)
    })

    it('toggles the sites on button click', () => {
      sitesStore.sites = [site()]
      const { control } = addControl()
      control.handleClickPublic()
      expect(siteMarkers()).toHaveLength(0)
      control.handleClickPublic()
      expect(siteMarkers()).toHaveLength(1)
    })

    it('closes an open details panel when the sites are hidden', () => {
      sitesStore.sites = [site()]
      const { control } = addControl()
      const marker = siteMarkers()[0]!
      markButton(marker).dispatchEvent(new Event('click'))
      control.setVisible(false)
      expect(isLatchedOpen(marker)).toBe(false)
    })

    it('keeps the accessible table while the sites are hidden', () => {
      sitesStore.sites = [site()]
      const { control, map } = addControl()
      control.setVisible(false)
      // The map layer is off, but the sites are still the fleet's own state and
      // stay listed for a screen-reader user.
      expect(map._container.querySelector('[role="region"]')!.textContent).toContain('Roof Pi')
    })
  })

  describe('the accessible equivalent', () => {
    it('lists every site with its address, status and position', () => {
      sitesStore.sites = [site(), site({ id: 2, name: 'Barn Pi', reachable: false })]
      const { map } = addControl()
      const region = map._container.querySelector('[role="region"]')!
      expect(region.getAttribute('aria-label')).toBe('Sentry sites')
      expect(region.querySelector('caption')!.textContent).toBe('Sentry sites on this map')
      expect(region.textContent).toContain('Roof Pi')
      expect(region.textContent).toContain('192.168.1.60:8000')
      expect(region.textContent).toContain('Online')
      expect(region.textContent).toContain('Off air')
      expect(region.textContent).toContain('51.5000')
      expect(region.textContent).toContain('-0.1000')
      expect(region.querySelectorAll('tbody tr')).toHaveLength(2)
    })

    it('says so plainly when no host reports a position', () => {
      const { map } = addControl()
      expect(map._container.querySelector('[role="region"]')!.textContent).toContain(
        'No Sentry sites reporting a position.',
      )
    })

    it('lists sites collapsed into a count, which the map itself cannot show', () => {
      sitesStore.sites = [
        site({ id: 1, name: 'A', longitude: 0, latitude: 0 }),
        site({ id: 2, name: 'B', longitude: 0.000_01, latitude: 0 }),
      ]
      const { map } = addControl()
      expect(clusterMarkers()).toHaveLength(1)
      const region = map._container.querySelector('[role="region"]')!
      expect(region.querySelectorAll('tbody tr')).toHaveLength(2)
    })

    it('escapes a name set on the Pi rather than letting it write markup', () => {
      sitesStore.sites = [site({ name: '<img src=x onerror="alert(1)">&"' })]
      const { map } = addControl()
      const region = map._container.querySelector('[role="region"]')!
      expect(region.querySelector('img')).toBeNull()
      expect(region.querySelector('tbody td')!.textContent).toBe('<img src=x onerror="alert(1)">&"')
    })

    it('has no accessibility violations', async () => {
      sitesStore.sites = [site()]
      const { map } = addControl()
      const region = map._container.querySelector('[role="region"]')!
      expect(await axe(region)).toHaveNoViolations()
    })
  })
})
