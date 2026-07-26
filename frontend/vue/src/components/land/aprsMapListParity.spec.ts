import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

/**
 * The Land map and the FILTER pane's station list must always show the same set
 * of APRS stations: a station that stops beaconing drops off both at once, and
 * hiding the layer empties both.
 *
 * The per-unit specs cover each side on its own; this one drives the real map
 * control and the real pane against one store, which is the only place the two
 * can drift apart.
 */
const mocks = vi.hoisted(() => {
  const created = { markers: [] as { element: HTMLElement; removed: boolean }[] }
  class MockMarker {
    element: HTMLElement
    removed = false
    constructor(options: { element: HTMLElement }) {
      this.element = options.element
      created.markers.push(this)
    }
    setLngLat(): this {
      return this
    }
    addTo(): this {
      return this
    }
    remove(): this {
      this.removed = true
      return this
    }
  }
  class MockPopup {
    setLngLat(): this {
      return this
    }
    setHTML(): this {
      return this
    }
    addTo(): this {
      return this
    }
    remove(): this {
      return this
    }
  }
  return { created, MockMarker, MockPopup }
})
vi.mock('maplibre-gl', () => ({ default: { Marker: mocks.MockMarker, Popup: mocks.MockPopup } }))

import { AprsStationsControl } from './controls/aprs/AprsStationsControl'
import LandFilter from './LandFilter.vue'
import { useLandStore, type AprsStation } from '@/stores/land'

function station(overrides: Partial<AprsStation> = {}): AprsStation {
  return {
    callsign: 'M0ABC-9',
    latitude: 51.5,
    longitude: -0.1,
    symbol: '/>',
    comment: null,
    course: null,
    speed: null,
    altitude: null,
    path: null,
    raw: null,
    last_heard_ms: 1000,
    ...overrides,
  }
}

describe('APRS map/list parity', () => {
  let store: ReturnType<typeof useLandStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.created.markers.length = 0
    store = useLandStore()
    // The control polls on init; echo the current snapshot back so the poll
    // never clobbers what a test has set.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ stations: store.aprsStations }),
      })),
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  /** Callsigns currently plotted on the map. */
  function plotted(): string[] {
    return mocks.created.markers
      .filter((marker) => !marker.removed)
      .map((marker) => marker.element.dataset.callsign ?? '')
  }

  function mountBoth() {
    const control = new AprsStationsControl(store)
    const container = document.createElement('div')
    document.body.appendChild(container)
    control.onAdd({ getContainer: () => container } as never)
    const panel = mount(LandFilter)
    /** Callsigns currently listed in the side panel. */
    const listed = () => panel.findAll('.bfp-result-primary').map((row) => row.text())
    return { control, panel, listed }
  }

  it('shows the same stations on both surfaces', () => {
    store.aprsStations = [station({ callsign: 'A' }), station({ callsign: 'B' })]
    const { listed } = mountBoth()
    expect(plotted()).toEqual(['A', 'B'])
    expect(listed()).toEqual(['A', 'B'])
  })

  it('drops a station from both when it stops being heard', async () => {
    store.aprsStations = [station({ callsign: 'A' }), station({ callsign: 'B' })]
    const { listed } = mountBoth()

    // The retention window expires station A server-side, so the next snapshot
    // simply omits it.
    store.aprsStations = [station({ callsign: 'B' })]
    await flushPromises()

    expect(plotted()).toEqual(['B'])
    expect(listed()).toEqual(['B'])
  })

  it('adds a newly heard station to both', async () => {
    store.aprsStations = [station({ callsign: 'A' })]
    const { listed } = mountBoth()
    store.aprsStations = [station({ callsign: 'A' }), station({ callsign: 'NEW' })]
    await flushPromises()
    expect(plotted()).toEqual(['A', 'NEW'])
    expect(listed()).toEqual(['A', 'NEW'])
  })

  it('empties both when every station ages out', async () => {
    store.aprsStations = [station({ callsign: 'A' })]
    const { listed, panel } = mountBoth()
    store.aprsStations = []
    await flushPromises()
    expect(plotted()).toEqual([])
    expect(listed()).toEqual([])
    expect(panel.find('.bfp-no-results').text()).toBe('No APRS stations heard')
  })

  it('empties both when the APRS layer is toggled off, and restores both', async () => {
    store.aprsStations = [station({ callsign: 'A' })]
    const { control, listed } = mountBoth()

    control.handleClickPublic()
    await flushPromises()
    expect(plotted()).toEqual([])
    expect(listed()).toEqual([])

    control.handleClickPublic()
    await flushPromises()
    expect(plotted()).toEqual(['A'])
    expect(listed()).toEqual(['A'])
  })

  it('keeps both in step when the layer is hidden via setVisible', async () => {
    store.aprsStations = [station({ callsign: 'A' })]
    const { control, listed } = mountBoth()
    control.setVisible(false)
    await flushPromises()
    expect(plotted()).toEqual([])
    expect(listed()).toEqual([])
  })

  it('still lists every station in the accessible table while the layer is hidden', async () => {
    // The hidden table is the map's accessible equivalent for data that IS
    // being received; the layer toggle is a display choice, and a screen-reader
    // user should still be able to reach the station data.
    store.aprsStations = [station({ callsign: 'A' })]
    const { control } = mountBoth()
    control.setVisible(false)
    await flushPromises()
    const table = document.querySelector('[role="region"]')
    expect(table?.textContent).toContain('A')
  })
})
