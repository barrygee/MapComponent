import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import LandFilter from './LandFilter.vue'
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
    last_heard_ms: new Date(2026, 6, 25, 21, 33, 47).getTime(),
    ...overrides,
  }
}

describe('LandFilter', () => {
  let store: ReturnType<typeof useLandStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    // The store polls on demand elsewhere; this pane only reads the snapshot.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) }),
    )
    store = useLandStore()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('station list', () => {
    it('lists every heard station by callsign, symbol and heard time', () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS', symbol: '/#' })]
      const wrapper = mount(LandFilter)
      const rows = wrapper.findAll('.bfp-result-item')
      expect(rows).toHaveLength(2)
      expect(rows[0]!.find('.bfp-result-primary').text()).toBe('M0ABC-9')
      expect(rows[0]!.find('.bfp-result-secondary').text()).toBe('Car · 21:33:47')
      expect(rows[1]!.find('.bfp-result-secondary').text()).toContain('Digipeater')
    })

    it('tells the operator when nothing has been heard', () => {
      expect(mount(LandFilter).find('.bfp-no-results').text()).toBe('No APRS stations heard')
    })

    it('distinguishes "nothing heard" from "nothing matches the search"', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      store.setSearchQuery('ZZZZ')
      await flushPromises()
      expect(wrapper.find('.bfp-no-results').text()).toBe('No stations match')
    })

    it('drops a station from the list as soon as it ages out of the snapshot', async () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(2)

      // The retention window expires the station server-side; the next poll
      // simply omits it, and the list must follow the map immediately.
      store.aprsStations = [station({ callsign: 'MB7UMS' })]
      await flushPromises()
      const rows = wrapper.findAll('.bfp-result-item')
      expect(rows).toHaveLength(1)
      expect(rows[0]!.find('.bfp-result-primary').text()).toBe('MB7UMS')
    })

    it('adds a newly heard station to the list', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      store.aprsStations = [station(), station({ callsign: 'NEW-1' })]
      await flushPromises()
      expect(wrapper.text()).toContain('NEW-1')
    })
  })

  describe('parity with the map', () => {
    it('empties the list when the APRS layer is hidden', async () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(2)

      // Hiding the layer clears the map, so the list must not keep listing
      // stations that are no longer plotted.
      store.setAprsLayerVisible(false)
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(0)
      expect(wrapper.find('.bfp-no-results').text()).toBe('APRS layer hidden')
    })

    it('restores the list when the layer is shown again', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      store.setAprsLayerVisible(false)
      await flushPromises()
      store.setAprsLayerVisible(true)
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
    })

    it('reports the layer as hidden even while a search is active', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      store.setSearchQuery('M0ABC')
      store.setAprsLayerVisible(false)
      await flushPromises()
      expect(wrapper.find('.bfp-no-results').text()).toBe('APRS layer hidden')
    })
  })

  describe('search', () => {
    beforeEach(() => {
      store.aprsStations = [
        station({ callsign: 'M0ABC-9', symbol: '/>', comment: 'rolling', path: 'WIDE1-1' }),
        station({ callsign: 'MB7UMS', symbol: '/#', comment: 'tyneside', path: 'WIDE2-2' }),
      ]
    })

    it('matches on callsign', async () => {
      const wrapper = mount(LandFilter)
      store.setSearchQuery('mb7')
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
      expect(wrapper.text()).toContain('MB7UMS')
    })

    it('matches on the decoded symbol type', async () => {
      const wrapper = mount(LandFilter)
      store.setSearchQuery('digipeater')
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
      expect(wrapper.text()).toContain('MB7UMS')
    })

    it('matches on comment and on path', async () => {
      const wrapper = mount(LandFilter)
      store.setSearchQuery('rolling')
      await flushPromises()
      expect(wrapper.text()).toContain('M0ABC-9')

      store.setSearchQuery('WIDE2')
      await flushPromises()
      expect(wrapper.text()).toContain('MB7UMS')
      expect(wrapper.text()).not.toContain('M0ABC-9')
    })

    it('ignores case and surrounding whitespace', async () => {
      const wrapper = mount(LandFilter)
      store.setSearchQuery('  MB7ums  ')
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
    })

    it('shows every station for an empty query', async () => {
      const wrapper = mount(LandFilter)
      store.setSearchQuery('')
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(2)
    })

    it('tolerates stations with no comment or path', async () => {
      store.aprsStations = [station({ comment: null, path: null })]
      const wrapper = mount(LandFilter)
      store.setSearchQuery('M0ABC')
      await flushPromises()
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
    })

    it('writes edits back to the store so the query survives navigation', async () => {
      const wrapper = mount(LandFilter)
      await wrapper.find('input').setValue('MB7')
      expect(store.searchQuery).toBe('MB7')
    })
  })

  describe('expanded station', () => {
    it('shows every APRS field, including the raw frame', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()

      const text = wrapper.find('.bfp-accordion-body').text()
      expect(text).toContain('M0ABC-9')
      expect(text).toContain('21:33:47')
      expect(text).toContain('51.50000')
      expect(text).toContain('-0.10000')
      expect(text).toContain('120 M')
      expect(text).toContain('90°')
      expect(text).toContain('30 KM/H')
      expect(text).toContain('WIDE1-1')
      expect(text).toContain('rolling')

      // The raw frame is reference material, so it starts collapsed.
      expect(wrapper.find('.land-filter-raw-body').exists()).toBe(false)
      await wrapper.find('.land-filter-raw-toggle').trigger('click')
      expect(wrapper.find('.land-filter-raw-body').text()).toBe('M0ABC-9>APRS:!x')
    })

    it('keeps the raw frame collapsed until asked for, and labels the control', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()

      const toggle = wrapper.find('.land-filter-raw-toggle')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.text()).toContain('RAW')

      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      // The control names the region it opens, for assistive tech.
      expect(toggle.attributes('aria-controls')).toBe(
        wrapper.find('.land-filter-raw-body').attributes('id'),
      )

      await toggle.trigger('click')
      expect(wrapper.find('.land-filter-raw-body').exists()).toBe(false)
    })

    it('does not collapse the station row when the raw frame is toggled', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()
      await wrapper.find('.land-filter-raw-toggle').trigger('click')
      // The toggle sits inside the row, whose own click collapses it.
      expect(store.searchExpandedCallsign).toBe('M0ABC-9')
      expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
    })

    it('closes the raw frame again when a different station is opened', async () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()
      await wrapper.find('.land-filter-raw-toggle').trigger('click')
      expect(wrapper.find('.land-filter-raw-body').exists()).toBe(true)

      store.setSearchExpandedCallsign('MB7UMS')
      await flushPromises()
      expect(wrapper.find('.land-filter-raw-body').exists()).toBe(false)
    })

    it('shows the symbol as its icon, still named for assistive tech', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()

      // The same glyph the map draws, rather than the word for it — but the
      // type is still announced, so nothing is lost by dropping the text.
      const symbol = wrapper.find('.bfp-accordion-body .aprs-symbol')
      expect(symbol.exists()).toBe(true)
      expect(symbol.attributes('aria-label')).toBe('Car')
      expect(wrapper.find('.bfp-accordion-body').text()).not.toContain('Car')
    })

    it('shows all fields even when they are hidden on the map label', async () => {
      // The accordion is the full record; the label fields are display-only.
      store.setAprsLabelFields({
        time: false,
        callsign: false,
        symbol: false,
        symbolText: false,
        latitude: false,
        longitude: false,
        course: false,
        speed: false,
        altitude: false,
        path: false,
        comment: false,
      })
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()
      const text = wrapper.find('.bfp-accordion-body').text()
      expect(text).toContain('30 KM/H')
      expect(text).toContain('WIDE1-1')
    })

    it('dashes the fields the packet did not carry', async () => {
      store.aprsStations = [
        station({
          course: null,
          speed: null,
          altitude: null,
          path: null,
          comment: null,
          raw: null,
        }),
      ]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()
      const text = wrapper.find('.bfp-accordion-body').text()
      expect(text).not.toContain('KM/H')
      expect(text.match(/—/g)!.length).toBeGreaterThanOrEqual(5)
      // …including the raw frame, once its disclosure is opened.
      await wrapper.find('.land-filter-raw-toggle').trigger('click')
      expect(wrapper.find('.land-filter-raw-body').text()).toBe('—')
    })

    it('records the expansion on the store so it survives a remount', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      expect(store.searchExpandedCallsign).toBe('M0ABC-9')

      const remounted = mount(LandFilter)
      await flushPromises()
      expect(remounted.find('.bfp-accordion-body').exists()).toBe(true)
    })

    it('collapses when the expanded station ages out', async () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      expect(store.searchExpandedCallsign).toBe('M0ABC-9')

      store.aprsStations = [station({ callsign: 'MB7UMS' })]
      await flushPromises()
      expect(store.searchExpandedCallsign).toBe('')
      expect(wrapper.find('.bfp-accordion-body').exists()).toBe(false)
    })

    it('keeps the expansion while the station is still being heard', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      store.aprsStations = [station({ latitude: 51.6 })]
      await flushPromises()
      expect(store.searchExpandedCallsign).toBe('M0ABC-9')
      expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
    })

    it('leaves an already-empty expansion alone when the list changes', async () => {
      store.aprsStations = [station()]
      mount(LandFilter)
      store.aprsStations = []
      await flushPromises()
      expect(store.searchExpandedCallsign).toBe('')
    })
  })

  describe('map hand-off', () => {
    it('expands the station clicked on the map', async () => {
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      document.dispatchEvent(
        new CustomEvent('aprs-station-selected', { detail: { callsign: 'MB7UMS' } }),
      )
      await flushPromises()
      expect(store.searchExpandedCallsign).toBe('MB7UMS')
      expect(wrapper.find('#land-filter-row-MB7UMS').classes()).toContain('bfp-expanded')
    })

    it('stops listening once the pane is unmounted', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      wrapper.unmount()
      document.dispatchEvent(
        new CustomEvent('aprs-station-selected', { detail: { callsign: 'M0ABC-9' } }),
      )
      await flushPromises()
      expect(store.searchExpandedCallsign).toBe('')
    })
  })

  it('uses the app accent, matching the Air and Space filter panes', () => {
    store.aprsStations = [station()]
    const wrapper = mount(LandFilter)
    expect(wrapper.find('.bfp-results').attributes('style')).toContain(
      '--bfp-accent: var(--color-accent)',
    )
  })

  describe('accessibility', () => {
    it('has no violations listing stations', async () => {
      // `region` is disabled: the pane is teleported into the sidebar's
      // landmark, which an isolated mount cannot provide.
      store.aprsStations = [station(), station({ callsign: 'MB7UMS' })]
      const wrapper = mount(LandFilter)
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('has no violations with a station expanded', async () => {
      store.aprsStations = [station()]
      const wrapper = mount(LandFilter)
      await wrapper.find('.bfp-result-item').trigger('click')
      await flushPromises()
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('names the search field for screen readers', () => {
      expect(mount(LandFilter).find('input').attributes('aria-label')).toBe(
        'Filter APRS stations by callsign, symbol, path or comment',
      )
    })
  })
})
