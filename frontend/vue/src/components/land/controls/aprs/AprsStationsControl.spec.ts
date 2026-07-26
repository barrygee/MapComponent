import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { axe } from 'jest-axe'

// ── maplibre-gl mock: record created markers/popups so the control's DOM/
//    lifecycle effects can be asserted without a real map. The classes live in
//    vi.hoisted so they exist when the (hoisted) vi.mock factory runs. ──────────
interface RecordedMarker {
  element: HTMLElement
  anchor: string | undefined
  offset: [number, number] | undefined
  lngLat: [number, number] | null
  removed: boolean
}
interface RecordedPopup {
  html: string
  removed: boolean
}

const mocks = vi.hoisted(() => {
  const created = { markers: [] as RecordedMarker[], popups: [] as RecordedPopup[] }
  class MockMarker {
    element: HTMLElement
    anchor: string | undefined
    offset: [number, number] | undefined
    lngLat: [number, number] | null = null
    removed = false
    constructor(options: { element: HTMLElement; anchor?: string; offset?: [number, number] }) {
      this.element = options.element
      this.anchor = options.anchor
      this.offset = options.offset
      created.markers.push(this)
    }
    setLngLat(coords: [number, number]): this {
      this.lngLat = coords
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
    html = ''
    removed = false
    constructor() {
      created.popups.push(this)
    }
    setLngLat(): this {
      return this
    }
    setHTML(html: string): this {
      this.html = html
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
  return { created, MockMarker, MockPopup }
})

const created = mocks.created

vi.mock('maplibre-gl', () => ({ default: { Marker: mocks.MockMarker, Popup: mocks.MockPopup } }))

import {
  AprsStationsControl,
  withStackIndices,
  formatAltitude,
  formatCourse,
  formatHeardTime,
  formatSpeed,
  truncate,
} from './AprsStationsControl'
import { useLandStore, type AprsStation } from '@/stores/land'

function station(overrides: Partial<AprsStation> = {}): AprsStation {
  return {
    callsign: 'M0ABC-9',
    latitude: 51.5,
    longitude: -0.1,
    symbol: '/>',
    comment: 'rolling',
    course: 90,
    speed: 30,
    altitude: 120,
    path: 'WIDE1-1',
    raw: 'M0ABC-9>APRS:!x',
    last_heard_ms: 1000,
    ...overrides,
  }
}

function makeFakeMap() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { getContainer: () => container, _container: container }
}

describe('AprsStationsControl', () => {
  let store: ReturnType<typeof useLandStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    created.markers.length = 0
    created.popups.length = 0
    // The control starts polling on init; stub fetch so the store never hits the
    // network, and spy on the polling methods to assert lifecycle wiring.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) }),
    )
    store = useLandStore()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function addControl() {
    const control = new AprsStationsControl(store)
    const map = makeFakeMap()
    control.onAdd(map as never)
    return { control, map }
  }

  it('starts polling and plots existing stations on add', () => {
    const startSpy = vi.spyOn(store, 'startAprsPolling')
    store.aprsStations = [station()]
    addControl()
    expect(startSpy).toHaveBeenCalledOnce()
    expect(created.markers).toHaveLength(1)
    expect(created.markers[0].element.textContent).toContain('M0ABC-9')
    expect(created.markers[0].lngLat).toEqual([-0.1, 51.5])
  })

  it('renders a hidden accessible data table of stations', () => {
    store.aprsStations = [station()]
    const { map } = addControl()
    const region = map._container.querySelector('[role="region"]')
    expect(region?.getAttribute('aria-label')).toBe('APRS stations')
    expect(region?.querySelector('caption')?.textContent).toBe('APRS stations heard')
    expect(region?.textContent).toContain('M0ABC-9')
  })

  it('shows an empty a11y message when nothing is heard', () => {
    const { map } = addControl()
    const region = map._container.querySelector('[role="region"]')
    expect(region?.textContent).toContain('No APRS stations heard.')
    expect(created.markers).toHaveLength(0)
  })

  it('adds, moves, and removes markers as the station list changes', async () => {
    addControl()
    store.aprsStations = [station({ callsign: 'A' })]
    await nextTick()
    expect(created.markers.filter((marker) => !marker.removed)).toHaveLength(1)

    // Same callsign, new position → existing marker moved, not re-created.
    const before = created.markers.length
    store.aprsStations = [station({ callsign: 'A', latitude: 52 })]
    await nextTick()
    expect(created.markers).toHaveLength(before) // no new marker
    expect(created.markers[created.markers.length - 1].lngLat).toEqual([-0.1, 52])

    // Station disappears → its marker is removed.
    store.aprsStations = []
    await nextTick()
    expect(created.markers.every((marker) => marker.removed)).toBe(true)
  })

  it('opens a popup with details when a marker is clicked', () => {
    store.aprsStations = [station({ comment: 'hi', course: 90, speed: 30 })]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(created.popups).toHaveLength(1)
    const html = created.popups[0].html
    expect(html).toContain('M0ABC-9')
    expect(html).toContain('51.5000, -0.1000')
    expect(html).toContain('hi')
    expect(html).toContain('Course 90° · Speed 30 KM/H')
    expect(html).toContain('Heard')
  })

  it('omits movement and comment rows when absent, keeping partial movement', () => {
    store.aprsStations = [station({ comment: null, course: 45, speed: null })]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    const html = created.popups[0].html
    // Only course present → speed shown as em-dash (no "kn"); no comment line.
    expect(html).toContain('Course 45° · Speed —')
    expect(html).not.toContain('rolling')
  })

  it('shows a dash for course when only speed is present', () => {
    store.aprsStations = [station({ course: null, speed: 20 })]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(created.popups[0].html).toContain('Course — · Speed 20 KM/H')
  })

  it('omits the movement row entirely when neither course nor speed is present', () => {
    store.aprsStations = [station({ course: null, speed: null })]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(created.popups[0].html).not.toContain('Course')
  })

  it('closes a previous popup before opening a new one', () => {
    store.aprsStations = [station()]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(created.popups).toHaveLength(2)
    expect(created.popups[0].removed).toBe(true) // first popup closed
  })

  it('escapes HTML in callsign/comment to prevent injection', () => {
    store.aprsStations = [station({ callsign: 'X&<Y>', comment: '<script>' })]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(created.popups[0].html).toContain('X&amp;&lt;Y&gt;')
    expect(created.popups[0].html).not.toContain('<script>')
  })

  it('setVisible hides and shows stations, and is a no-op when unchanged', () => {
    store.aprsStations = [station()]
    const { control } = addControl()
    expect(created.markers.filter((marker) => !marker.removed)).toHaveLength(1)
    control.setVisible(false)
    expect(created.markers.every((marker) => marker.removed)).toBe(true)
    const beforeNoop = created.markers.length
    control.setVisible(false) // already hidden → no re-render
    expect(created.markers.length).toBe(beforeNoop)
    control.setVisible(true)
    expect(created.markers.filter((marker) => !marker.removed).length).toBeGreaterThan(0)
  })

  it('toggles station visibility on button click', () => {
    store.aprsStations = [station()]
    const { control } = addControl()
    expect(created.markers.filter((marker) => !marker.removed)).toHaveLength(1)
    control.handleClickPublic() // hide
    expect(created.markers.every((marker) => marker.removed)).toBe(true)
    control.handleClickPublic() // show again
    expect(created.markers.filter((marker) => !marker.removed).length).toBeGreaterThan(0)
  })

  it('stops polling and tears down markers, popup, and a11y region on remove', () => {
    const stopSpy = vi.spyOn(store, 'stopAprsPolling')
    store.aprsStations = [station()]
    const { control, map } = addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    control.onRemove()
    expect(stopSpy).toHaveBeenCalledOnce()
    expect(created.markers.every((marker) => marker.removed)).toBe(true)
    expect(created.popups[0].removed).toBe(true)
    expect(map._container.querySelector('[role="region"]')).toBeNull()
  })

  it('removes cleanly when no popup was ever opened', () => {
    store.aprsStations = [station()]
    const { control, map } = addControl()
    // No marker click → no popup; onRemove must still tear everything down.
    expect(() => control.onRemove()).not.toThrow()
    expect(created.popups).toHaveLength(0)
    expect(map._container.querySelector('[role="region"]')).toBeNull()
  })

  it('exposes a descriptive accessible name on its button', () => {
    const { control } = addControl()
    expect(control.button.getAttribute('aria-label')).toBe('Toggle APRS stations')
  })

  it('the accessible station table has no accessibility violations', async () => {
    store.aprsStations = [station()]
    const { map } = addControl()
    const region = map._container.querySelector('[role="region"]') as HTMLElement
    expect(await axe(region)).toHaveNoViolations()
  })

  // ── label pill ──────────────────────────────────────────────────────────────

  describe('label pill', () => {
    /** Enable every label field so a full pill renders. */
    function allFieldsOn() {
      store.setAprsLabelFields({
        time: true,
        callsign: true,
        symbol: true,
        symbolText: true,
        latitude: true,
        longitude: true,
        course: true,
        speed: true,
        altitude: true,
        path: true,
        comment: true,
      })
    }

    it('shows the icon and callsign by default, without the symbol name', () => {
      store.aprsStations = [station()]
      addControl()
      const pill = created.markers[0].element
      expect(pill.textContent).toContain('M0ABC-9')
      expect(pill.querySelector('.adsb-arrow-wrap')).not.toBeNull()
      // The symbol's name is its own field, off by default.
      expect(pill.textContent).not.toContain('Car')
    })

    it('draws the symbol name chip in white on the app grey when that field is on', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbolText: true })
      store.aprsStations = [station()]
      addControl()
      const pill = created.markers[0].element
      expect(pill.textContent).toContain('Car') // '/>' decodes to the car symbol
      const chip = Array.from(pill.querySelectorAll('span')).find(
        (span) => span.textContent === 'Car',
      )
      // Monochrome by design: Air uses colour to mean military/civil/emergency,
      // so Land labels stay white and grey rather than adding a fourth hue.
      expect(chip!.style.color).toBe('rgb(255, 255, 255)')
      expect(chip!.style.background).toBe('rgb(38, 41, 46)')
    })

    it('draws the glyph and dim field labels in white', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, speed: true })
      store.aprsStations = [station({ course: 275, speed: 30 })]
      addControl()
      const pill = created.markers[0].element
      expect(pill.querySelector('.adsb-arrow polygon')!.getAttribute('stroke')).toBe('#ffffff')
      const speedBadge = Array.from(pill.querySelectorAll('span')).find((span) =>
        span.textContent?.startsWith('SPD'),
      )
      expect(speedBadge!.style.color).toBe('rgb(255, 255, 255)')
    })

    it('hides the leading icon when the Symbol field is switched off', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbol: false })
      store.aprsStations = [station()]
      addControl()
      const pill = created.markers[0].element
      expect(pill.querySelector('.adsb-arrow-wrap')).toBeNull()
      // The rest of the label is unaffected.
      expect(pill.textContent).toContain('M0ABC-9')
    })

    it('balances the callsign padding when there is no icon beside it', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbol: false })
      store.aprsStations = [station()]
      addControl()
      const name = created.markers[0].element.querySelector('.adsb-label-name') as HTMLElement
      // Both edges are outer edges here, so neither gets the tight glyph-side
      // padding that would leave the label looking lopsided.
      expect(name.style.paddingLeft).toBe('12px')
      expect(name.style.paddingRight).toBe('10px')
    })

    it('keeps the callsign tight against the icon when one is shown', () => {
      store.aprsStations = [station({ course: 275 })]
      addControl()
      const name = created.markers[0].element.querySelector('.adsb-label-name') as HTMLElement
      expect(name.style.paddingLeft).toBe('6px')
      expect(name.style.paddingRight).toBe('10px')
    })

    it('keeps the icon when only the symbol name is switched off, and vice versa', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbol: true, symbolText: false })
      store.aprsStations = [station()]
      addControl()
      expect(created.markers[0].element.querySelector('.adsb-arrow-wrap')).not.toBeNull()

      created.markers.length = 0
      store.setAprsLabelFields({ ...store.aprsLabelFields, symbol: false, symbolText: true })
      store.aprsStations = [station({ callsign: 'OTHER-1' })]
      addControl()
      const pill = created.markers[0].element
      expect(pill.querySelector('.adsb-arrow-wrap')).toBeNull()
      expect(pill.textContent).toContain('Car')
    })

    it('leads with a course arrow rotated to the reported course', () => {
      store.aprsStations = [station({ course: 275 })]
      addControl()
      const glyph = created.markers[0].element.querySelector('.adsb-arrow')
      expect(glyph!.getAttribute('style')).toContain('rotate(275deg)')
      expect(glyph!.innerHTML).toContain('polygon')
    })

    it('falls back to the station symbol glyph when no course is reported', () => {
      store.aprsStations = [station({ course: null, symbol: '/#' })]
      addControl()
      const well = created.markers[0].element.querySelector('.adsb-arrow-wrap')!
      // A symbol icon, not a direction arrow — an arrow would assert a heading
      // the beacon never sent.
      expect(well.querySelector('.adsb-arrow')).toBeNull()
      expect(well.querySelector('svg')!.getAttribute('aria-label')).toBe('Digipeater')
    })

    it('anchors by the leading edge so the glyph stays over the fix', () => {
      store.aprsStations = [station({ callsign: 'LEFT', course: 90 })]
      addControl()
      expect(created.markers[0].anchor).toBe('right')

      created.markers.length = 0
      store.aprsStations = [station({ callsign: 'RIGHT', course: 275 })]
      addControl()
      expect(created.markers[0].anchor).toBe('left')
    })

    it('treats a station with no course as right-facing', () => {
      store.aprsStations = [station({ course: null })]
      addControl()
      expect(created.markers[0].anchor).toBe('left')
      expect(created.markers[0].element.dataset.dir).toBe('right')
    })

    it('mirrors the segment order for a left-facing station', () => {
      allFieldsOn()
      store.aprsStations = [station({ course: 90 })]
      addControl()
      const pill = created.markers[0].element
      expect(pill.dataset.dir).toBe('left')
      // Glyph well last (leading edge on the left of travel), callsign next to
      // it — the exact reverse of the right-facing order below.
      expect(pill.lastElementChild!.className).toBe('adsb-arrow-wrap')
      expect((pill.lastElementChild!.previousElementSibling as HTMLElement).textContent).toBe(
        'M0ABC-9',
      )
    })

    it('puts the glyph first for a right-facing station', () => {
      allFieldsOn()
      store.aprsStations = [station({ course: 275 })]
      addControl()
      const pill = created.markers[0].element
      expect(pill.firstElementChild!.className).toBe('adsb-arrow-wrap')
    })

    it('renders every enabled field with its unit', () => {
      allFieldsOn()
      store.aprsStations = [
        station({ course: 275, speed: 48, altitude: 122, last_heard_ms: 0, path: 'WIDE1-1' }),
      ]
      addControl()
      const text = created.markers[0].element.textContent!
      expect(text).toContain('CRS')
      expect(text).toContain('275°')
      expect(text).toContain('48 KM/H') // aprslib normalises speed to km/h
      expect(text).toContain('122 M') // …and altitude to metres
      expect(text).toContain('51.5000')
      expect(text).toContain('-0.1000')
      expect(text).toContain('WIDE1-1')
      expect(text).toContain('rolling')
      expect(text).toContain('TIME')
    })

    it('omits an enabled field the packet did not carry', () => {
      allFieldsOn()
      store.aprsStations = [station({ speed: null, altitude: null, path: null, comment: null })]
      addControl()
      const text = created.markers[0].element.textContent!
      expect(text).not.toContain('SPD')
      expect(text).not.toContain('ALT')
      expect(text).not.toContain('PATH')
      expect(text).not.toContain('CMT')
      // The fields that ARE present still render.
      expect(text).toContain('CRS')
    })

    it('omits a disabled field even when the packet carried it', () => {
      store.setAprsLabelFields({
        ...store.aprsLabelFields,
        speed: false,
        callsign: false,
        symbolText: false,
      })
      store.aprsStations = [station({ speed: 30 })]
      addControl()
      const text = created.markers[0].element.textContent!
      expect(text).not.toContain('SPD')
      expect(text).not.toContain('M0ABC-9')
      expect(text).not.toContain('Car')
    })

    it('still draws the direction glyph when every text field is switched off', () => {
      store.setAprsLabelFields({
        time: false,
        callsign: false,
        symbol: true,
        symbolText: false,
        latitude: false,
        longitude: false,
        course: false,
        speed: false,
        altitude: false,
        path: false,
        comment: false,
      })
      store.aprsStations = [station({ course: 90 })]
      addControl()
      const pill = created.markers[0].element
      expect(pill.textContent).toBe('')
      expect(pill.querySelector('.adsb-arrow')).not.toBeNull()
    })

    it('truncates a long comment so one chatty station cannot span the viewport', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, comment: true })
      store.aprsStations = [station({ comment: 'x'.repeat(80) })]
      addControl()
      const text = created.markers[0].element.textContent!
      expect(text).toContain('…')
      expect(text).not.toContain('x'.repeat(80))
    })

    it('escapes HTML in label field values', () => {
      store.setAprsLabelFields({ ...store.aprsLabelFields, comment: true })
      store.aprsStations = [station({ comment: '<img src=x>' })]
      addControl()
      const pill = created.markers[0].element
      // Escaped, so the tag is inert text rather than an injected element.
      expect(pill.querySelector('img')).toBeNull()
      expect(pill.textContent).toContain('<img src=x>')
    })

    it('carries an accessible name naming the station and its symbol', () => {
      store.aprsStations = [station()]
      addControl()
      expect(created.markers[0].element.getAttribute('aria-label')).toBe(
        'APRS station M0ABC-9, Car',
      )
    })

    it('redraws labels when the operator changes the enabled fields', async () => {
      store.aprsStations = [station()]
      addControl()
      expect(created.markers[0].element.textContent).not.toContain('SPD')
      const before = created.markers.length
      store.setAprsLabelFields({ ...store.aprsLabelFields, speed: true })
      await nextTick()
      expect(created.markers.length).toBeGreaterThan(before)
      const latest = created.markers[created.markers.length - 1]
      expect(latest.element.textContent).toContain('SPD')
    })
  })

  // ── marker churn ────────────────────────────────────────────────────────────

  describe('marker updates', () => {
    it('does not re-plot a station when the snapshot repeats its position', async () => {
      addControl()
      store.aprsStations = [station()]
      await nextTick()
      const marker = created.markers[created.markers.length - 1]
      const plotted = marker.lngLat
      marker.lngLat = null // detect any further setLngLat call

      // Same fix arriving again on the next poll must not move the marker.
      store.aprsStations = [station()]
      await nextTick()
      expect(marker.lngLat).toBeNull()
      expect(plotted).toEqual([-0.1, 51.5])
    })

    it('moves the marker when a genuinely new fix arrives', async () => {
      addControl()
      store.aprsStations = [station()]
      await nextTick()
      const marker = created.markers[created.markers.length - 1]
      store.aprsStations = [station({ longitude: -0.2 })]
      await nextTick()
      expect(marker.lngLat).toEqual([-0.2, 51.5])
    })

    it('rebuilds the marker when the station turns across the facing threshold', async () => {
      addControl()
      store.aprsStations = [station({ course: 90 })]
      await nextTick()
      const before = created.markers.length
      expect(created.markers[before - 1].anchor).toBe('right')

      store.aprsStations = [station({ course: 275 })]
      await nextTick()
      // A new marker: MapLibre fixes the anchor at construction.
      expect(created.markers.length).toBeGreaterThan(before)
      expect(created.markers[created.markers.length - 1].anchor).toBe('left')
      expect(created.markers[before - 1].removed).toBe(true)
    })

    it('redraws when a hidden-field value changes only if it is displayed', async () => {
      addControl()
      store.aprsStations = [station({ speed: 10 })]
      await nextTick()
      const before = created.markers.length
      // Speed is switched off by default → a speed change is invisible, so the
      // marker must not churn.
      store.aprsStations = [station({ speed: 99 })]
      await nextTick()
      expect(created.markers.length).toBe(before)
    })

    it('redraws when the symbol changes for a station with no course', async () => {
      addControl()
      store.aprsStations = [station({ course: null, symbol: '/>' })]
      await nextTick()
      const before = created.markers.length
      // The glyph well shows the symbol when there is no course, so it must
      // follow a symbol change even though the chip text is what usually does.
      store.aprsStations = [station({ course: null, symbol: '/#' })]
      await nextTick()
      expect(created.markers.length).toBeGreaterThan(before)
    })
  })

  describe('co-sited stations', () => {
    it('offsets superimposed labels so each station stays readable', () => {
      // Two stations on one mast: without an offset the second label would sit
      // exactly on the first and the map would look like it holds one station.
      store.aprsStations = [
        station({ callsign: 'MB7IAE-L', latitude: 54.898666, longitude: -2.243833 }),
        station({ callsign: 'M0UKB-L', latitude: 54.898666, longitude: -2.243833 }),
      ]
      addControl()
      expect(created.markers).toHaveLength(2)
      const offsets = created.markers.map((marker) => marker.offset)
      expect(offsets).toContainEqual([0, 0])
      expect(offsets).toContainEqual([0, 30])
    })

    it('plots a lone station on its true position', () => {
      store.aprsStations = [station()]
      addControl()
      expect(created.markers[0].offset).toEqual([0, 0])
    })

    it('rebuilds a stack when another station joins the same site', async () => {
      store.aprsStations = [station({ callsign: 'ZZZ', latitude: 54.9, longitude: -1.5 })]
      addControl()
      expect(created.markers[created.markers.length - 1].offset).toEqual([0, 0])

      // A new station sorts ahead of it, so ZZZ must step down the stack.
      store.aprsStations = [
        station({ callsign: 'ZZZ', latitude: 54.9, longitude: -1.5 }),
        station({ callsign: 'AAA', latitude: 54.9, longitude: -1.5 }),
      ]
      await nextTick()
      const live = created.markers.filter((marker) => !marker.removed)
      expect(live).toHaveLength(2)
      expect(live.map((marker) => marker.offset)).toEqual(
        expect.arrayContaining([
          [0, 0],
          [0, 30],
        ]),
      )
    })
  })

  // ── side-panel hand-off ─────────────────────────────────────────────────────

  it('announces the clicked station so the side panel can expand its row', () => {
    const listener = vi.fn()
    document.addEventListener('aprs-station-selected', listener)
    store.aprsStations = [station()]
    addControl()
    created.markers[0].element.dispatchEvent(new Event('click'))
    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ callsign: 'M0ABC-9' })
    document.removeEventListener('aprs-station-selected', listener)
  })

  // ── accessible table ────────────────────────────────────────────────────────

  it('lists every field in the accessible table regardless of label settings', () => {
    // All label fields are off except the defaults; the table is the accessible
    // equivalent of the map and must not lose data to a display preference.
    store.aprsStations = [station({ course: 90, speed: 30, altitude: 120, last_heard_ms: 0 })]
    const { map } = addControl()
    const region = map._container.querySelector('[role="region"]')!
    const headers = Array.from(region.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual([
      'Callsign',
      'Symbol',
      'Time',
      'Position',
      'Course',
      'Speed',
      'Altitude',
      'Path',
      'Comment',
    ])
    const cells = Array.from(region.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells).toContain('Car')
    expect(cells).toContain('90°')
    expect(cells).toContain('30 KM/H')
    expect(cells).toContain('120 M')
    expect(cells).toContain('WIDE1-1')
  })

  it('leaves table cells blank for fields the packet omitted', () => {
    store.aprsStations = [station({ course: null, speed: null, altitude: null, path: null })]
    const { map } = addControl()
    const cells = Array.from(map._container.querySelectorAll('[role="region"] td')) as HTMLElement[]
    expect(cells[4]!.textContent).toBe('')
    expect(cells[5]!.textContent).toBe('')
    expect(cells[6]!.textContent).toBe('')
    expect(cells[7]!.textContent).toBe('')
  })
})

// ── exported formatters ───────────────────────────────────────────────────────

describe('APRS field formatters', () => {
  it('formatHeardTime renders 24-hour local wall time', () => {
    const heard = new Date(2026, 6, 25, 21, 33, 47).getTime()
    expect(formatHeardTime(heard)).toBe('21:33:47')
  })

  it('formatCourse rounds to whole degrees, or null when unreported', () => {
    expect(formatCourse(274.6)).toBe('275°')
    expect(formatCourse(0)).toBe('0°')
    expect(formatCourse(null)).toBeNull()
  })

  it('formatSpeed labels km/h — the unit aprslib normalises to', () => {
    expect(formatSpeed(48.4)).toBe('48 KM/H')
    expect(formatSpeed(0)).toBe('0 KM/H')
    expect(formatSpeed(null)).toBeNull()
  })

  it('formatAltitude labels metres — likewise already converted', () => {
    expect(formatAltitude(121.9)).toBe('122 M')
    expect(formatAltitude(0)).toBe('0 M')
    expect(formatAltitude(null)).toBeNull()
  })

  describe('truncate', () => {
    it('returns short text unchanged, trimmed', () => {
      expect(truncate('  WIDE1-1  ')).toBe('WIDE1-1')
    })

    it('treats null, empty and whitespace-only text as absent', () => {
      expect(truncate(null)).toBeNull()
      expect(truncate('')).toBeNull()
      expect(truncate('   ')).toBeNull()
    })

    it('keeps text at exactly the limit intact', () => {
      const exact = 'x'.repeat(24)
      expect(truncate(exact)).toBe(exact)
    })

    it('clips text over the limit and marks it with an ellipsis', () => {
      const clipped = truncate('y'.repeat(25))!
      expect(clipped).toHaveLength(24)
      expect(clipped.endsWith('…')).toBe(true)
    })
  })
})

// ── co-sited stations ─────────────────────────────────────────────────────────

describe('withStackIndices', () => {
  /** Stack position by callsign, for readable assertions. */
  function stackIndexByCallsign(stations: AprsStation[]): Map<string, number> {
    return new Map(
      withStackIndices(stations).map(({ station, stackIndex }) => [station.callsign, stackIndex]),
    )
  }

  function at(callsign: string, latitude: number, longitude: number): AprsStation {
    return {
      callsign,
      latitude,
      longitude,
      symbol: '/>',
      comment: null,
      course: null,
      speed: null,
      altitude: null,
      path: null,
      raw: null,
      last_heard_ms: 0,
    }
  }

  it('gives every station index 0 when none share a site', () => {
    const indices = stackIndexByCallsign([at('A', 54.9, -1.5), at('B', 55.2, -1.9)])
    expect(indices.get('A')).toBe(0)
    expect(indices.get('B')).toBe(0)
  })

  it('stacks stations beaconing identical coordinates', () => {
    // Real case: a repeater and a gateway on one mast.
    const indices = stackIndexByCallsign([
      at('MB7IAE-L', 54.898666, -2.243833),
      at('M0UKB-L', 54.898666, -2.243833),
    ])
    expect(indices.get('M0UKB-L')).toBe(0)
    expect(indices.get('MB7IAE-L')).toBe(1)
  })

  it('treats stations within ~110 m as one site', () => {
    // GB3CD/GB3CD-R/MB7VU-10 sit metres apart; their labels would still collide.
    const indices = stackIndexByCallsign([
      at('GB3CD', 54.735166, -1.7448333),
      at('GB3CD-R', 54.735166, -1.7448333),
      at('MB7VU-10', 54.735166, -1.745),
    ])
    expect([...indices.values()].sort()).toEqual([0, 1, 2])
  })

  it('keeps stations far enough apart on their own true positions', () => {
    const indices = stackIndexByCallsign([at('A', 54.9, -1.5), at('B', 54.9, -1.51)])
    expect(indices.get('A')).toBe(0)
    expect(indices.get('B')).toBe(0)
  })

  it('orders a stack by callsign, so it is stable across polls', () => {
    const first = stackIndexByCallsign([at('ZZZ', 54.9, -1.5), at('AAA', 54.9, -1.5)])
    // Same stations, opposite arrival order → identical stack positions.
    const second = stackIndexByCallsign([at('AAA', 54.9, -1.5), at('ZZZ', 54.9, -1.5)])
    expect(first.get('AAA')).toBe(0)
    expect(first.get('ZZZ')).toBe(1)
    expect(second).toEqual(first)
  })

  it('handles an empty snapshot', () => {
    expect(stackIndexByCallsign([]).size).toBe(0)
  })
})
