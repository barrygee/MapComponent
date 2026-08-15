import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrDecodeDock from './SdrDecodeDock.vue'
import { useSdrStore } from '@/stores/sdr'

function mountDock(): VueWrapper {
  return mount(SdrDecodeDock, { attachTo: document.body })
}

describe('SdrDecodeDock', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders both panels side by side, each accessibly named and showing its own empty state', () => {
    const wrapper = mountDock()
    const columns = wrapper.findAll('.sdr-decode-dock-column')
    expect(columns).toHaveLength(2)
    // Visible titles are removed; the columns keep accessible names via aria-label.
    // Logs sit on the left, decoded messages on the right.
    expect(columns[0].attributes('aria-label')).toBe('Decoder logs')
    expect(columns[1].attributes('aria-label')).toBe('Decoded messages')
    // Both empty states are visible simultaneously, one per column.
    expect(columns[0].find('.sdr-decode-empty').text()).toBe('No logs to display.')
    expect(columns[1].find('.sdr-decode-empty').text()).toBe('No messages to display.')
  })

  it('floats each column Clear button at the column top, not in a footer or the header', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: 'a log line', ts: 2 })
    await wrapper.vm.$nextTick()
    const columns = wrapper.findAll('.sdr-decode-dock-column')
    // Each column owns exactly one Clear button as a direct child (top-right
    // float), not wrapped in a footer and not nested in the status header.
    expect(columns[0].findAll('.sdr-decode-clear')).toHaveLength(1)
    expect(columns[1].findAll('.sdr-decode-clear')).toHaveLength(1)
    expect(wrapper.findAll('.sdr-decode-dock-column-footer')).toHaveLength(0)
    expect(wrapper.findAll('.sdr-decode-dock-column-header .sdr-decode-clear')).toHaveLength(0)
  })

  it('shows the messages column headings only once there are messages', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    // Empty: the heading row is hidden so the placeholder stands alone.
    expect(wrapper.find('.sdr-decode-table thead').exists()).toBe(false)
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
    await wrapper.vm.$nextTick()
    // With data: the six column labels appear, in order.
    const headings = wrapper.findAll('.sdr-decode-table thead th').map((heading) => heading.text())
    expect(headings).toEqual(['Time', 'Mode', 'Talkgroup', 'Source ID', 'CC', 'Sync'])
  })

  it('renders one table row per decoded event with its fields', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    store.pushDecodeEvent({
      type: 'decode_event',
      mode: 'P25',
      talkgroup: 1234,
      source: 9876,
      color_code: 1,
      sync: true,
      ts: Date.UTC(2026, 0, 1, 12, 0, 0),
    })
    await wrapper.vm.$nextTick()
    const cells = wrapper.findAll('tbody td').map((cell) => cell.text())
    expect(cells).toContain('P25')
    expect(cells).toContain('1234')
    expect(cells).toContain('9876')
    expect(cells).toContain('1')
    expect(cells).toContain('Yes')
  })

  it('renders dashes for missing fields, No for sync:false and dash for undefined sync', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    store.pushDecodeEvent({ type: 'decode_event', sync: false, ts: 1 })
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 2 })
    await wrapper.vm.$nextTick()
    const rows = wrapper.findAll('tbody tr')
    // Newest last: row 0 = sync:false (mode missing → —, No), row 1 = DMR
    // (sync undefined → —).
    expect(rows[0].findAll('td')[1].text()).toBe('—') // mode missing
    expect(rows[0].findAll('td')[5].text()).toBe('No')
    expect(rows[1].findAll('td')[5].text()).toBe('—') // sync undefined
  })

  it('renders raw log lines newest-last, with error lines flagged and a screen-reader prefix', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    store.pushDecodeEvent({ type: 'log', line: 'Sync: +DMR slot1 [slot2] | IDLE', ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: '-YSF DCH (CRC ERR)', ts: 2 })
    store.pushDecodeEvent({ type: 'log', line: 'Inferred header parameters', ts: 3 })
    await wrapper.vm.$nextTick()
    const lines = wrapper.findAll('.sdr-decode-log-line')
    // Newest-last in both DOM and visual order: oldest at the top, newest at the
    // bottom, matching the decoded-messages table above it.
    expect(lines[0].text()).toContain('Sync: +DMR')
    expect(lines[2].text()).toContain('Inferred header parameters')
    expect(lines[2].classes()).not.toContain('sdr-decode-log-line--error') // "Inferred" embeds err
    expect(lines[1].classes()).toContain('sdr-decode-log-line--error') // CRC ERR
    expect(lines[1].find('.sdr-sr-only').text()).toBe('Error:')
  })

  it('pins both columns to the bottom so the newest entry stays visible as data arrives', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    const bodies = wrapper
      .findAll('.sdr-decode-dock-body')
      .map((body) => body.element as HTMLElement)
    // jsdom does no layout, so fake a scrollable height to prove we scroll to it.
    Object.defineProperty(bodies[0], 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(bodies[1], 'scrollHeight', { configurable: true, value: 800 })
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: 'a log line', ts: 2 })
    await wrapper.vm.$nextTick() // watchers fire
    await wrapper.vm.$nextTick() // inner nextTick scroll runs
    expect(bodies[0].scrollTop).toBe(500)
    expect(bodies[1].scrollTop).toBe(800)
  })

  it('hides the messages Clear when empty and clears only events when shown', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    // No Clear button while the column is empty.
    expect(wrapper.findAll('.sdr-decode-clear')).toHaveLength(0)
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: 'a log line', ts: 2 })
    await wrapper.vm.$nextTick()
    // findAll order follows the template: [0] = logs column, [1] = messages column.
    const messagesClear = wrapper.findAll('.sdr-decode-clear')[1]
    await messagesClear.trigger('click')
    expect(store.decodeEvents).toEqual([])
    expect(store.decodeLogs).toHaveLength(1) // logs untouched
  })

  it('hides the logs Clear when empty and clears only logs when shown', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    expect(wrapper.findAll('.sdr-decode-clear')).toHaveLength(0)
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: 'a log line', ts: 2 })
    await wrapper.vm.$nextTick()
    const logsClear = wrapper.findAll('.sdr-decode-clear')[0]
    await logsClear.trigger('click')
    expect(store.decodeLogs).toEqual([])
    expect(store.decodeEvents).toHaveLength(1) // messages untouched
  })

  it('reflects the live status text and dot class', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    expect(wrapper.find('.sdr-decode-status').text()).toBe('Decoder offline')
    expect(wrapper.find('.sdr-decode-dot--offline').exists()).toBe(true)

    store.setDecodeStatus({ decoder_reachable: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-decode-status').text()).toBe('No sync')
    expect(wrapper.find('.sdr-decode-dot--idle').exists()).toBe(true)

    store.setDecodeStatus({ sync: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-decode-status').text()).toBe('Synced — decoding')
    expect(wrapper.find('.sdr-decode-dot--synced').exists()).toBe(true)
  })

  it('aligns to the open side panel when the sidebar is open at mount', () => {
    sessionStorage.setItem('sentinel_sidebar_open', '1')
    const wrapper = mountDock()
    expect(wrapper.find('.sdr-decode-dock').classes()).not.toContain('panel-closed')
  })

  it('is panel-closed when the sidebar is closed, and follows the sidebar-state event', async () => {
    const wrapper = mountDock()
    expect(wrapper.find('.sdr-decode-dock').classes()).toContain('panel-closed')
    document.dispatchEvent(new CustomEvent('sentinel:sidebar-state', { detail: { open: true } }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-decode-dock').classes()).not.toContain('panel-closed')
  })

  it('is dulled (not-playing) until the radio is tuned, then clears it', async () => {
    const store = useSdrStore()
    const wrapper = mountDock()
    // Radio stopped at mount → the decoder boxes are in the disabled state.
    expect(wrapper.find('.sdr-decode-dock').classes()).toContain('not-playing')
    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-decode-dock').classes()).not.toContain('not-playing')
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-decode-dock').classes()).toContain('not-playing')
  })

  it('stays active (not dulled) when APRS decode is on, even if the analog radio is stopped', async () => {
    const store = useSdrStore()
    store.setAprsEnabled(true)
    const wrapper = mountDock()
    // APRS runs in the background independent of the analog "playing" state, so
    // the dock must not be greyed out even though the radio is not tuned.
    expect(wrapper.find('.sdr-decode-dock').classes()).not.toContain('not-playing')
  })

  it('removes the sidebar-state listener on unmount', () => {
    const wrapper = mountDock()
    wrapper.unmount()
    // Dispatching after unmount must not throw (listener detached).
    expect(() =>
      document.dispatchEvent(new CustomEvent('sentinel:sidebar-state', { detail: { open: true } })),
    ).not.toThrow()
  })

  it('has no accessibility violations', async () => {
    const store = useSdrStore()
    store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', talkgroup: 1, ts: 1 })
    store.pushDecodeEvent({ type: 'log', line: 'Sync: +DMR slot1 [slot2] | IDLE', ts: 2 })
    const wrapper = mountDock()
    await wrapper.vm.$nextTick()
    expect(await axe(wrapper.element)).toHaveNoViolations()
  })

  describe('APRS mode', () => {
    it('shows APRS packet columns and empty state when the stream is APRS', () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      const headings = wrapper.findAll('.sdr-decode-table thead th')
      // Empty state hides the thead, so assert the empty message + that voice
      // headings are absent by checking the APRS empty text.
      expect(headings).toHaveLength(0)
      expect(wrapper.find('.sdr-decode-table .sdr-decode-empty').text()).toBe(
        'No packets to display.',
      )
    })

    it('renders APRS heading columns once packets arrive', async () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      store.pushDecodeEvent({
        type: 'aprs',
        from: 'M0ABC-9',
        latitude: 51.5,
        longitude: -0.1,
        ts: 1,
      })
      await wrapper.vm.$nextTick()
      const headings = wrapper.findAll('.sdr-decode-table thead th').map((th) => th.text())
      // Every parsed APRS field gets its own column, ending with the raw packet.
      expect(headings).toEqual([
        'Time',
        'Callsign',
        'Symbol',
        'Latitude',
        'Longitude',
        'Course',
        'Speed',
        'Altitude',
        'Path',
        'Comment',
        'Raw',
      ])
    })

    it('renders a packet row with every field populated, including the raw frame', async () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      store.pushDecodeEvent({
        type: 'aprs',
        from: 'M0ABC-9',
        symbol: '/>',
        latitude: 51.5,
        longitude: -0.1,
        course: 90,
        speed: 30,
        altitude: 120,
        path: 'WIDE1-1',
        comment: 'rolling',
        raw: 'M0ABC-9>APRS,WIDE1-1:!5130.00N/00006.00W>rolling',
        ts: 1,
      })
      await wrapper.vm.$nextTick()
      // The symbol renders as a decoded line-art icon, not the raw "/>" code.
      expect(wrapper.find('.sdr-decode-table tbody [role="img"]').attributes('aria-label')).toBe(
        'Car',
      )
      const cells = wrapper.findAll('.sdr-decode-table tbody td').map((td) => td.text())
      expect(cells).toContain('M0ABC-9')
      expect(cells).toContain('51.5000')
      expect(cells).toContain('-0.1000')
      expect(cells).toContain('90°')
      expect(cells).toContain('30 kn')
      expect(cells).toContain('120 ft')
      expect(cells).toContain('WIDE1-1')
      expect(cells).toContain('rolling')
      expect(cells).toContain('M0ABC-9>APRS,WIDE1-1:!5130.00N/00006.00W>rolling')
    })

    it('drops the raw-log column and sync indicator in APRS mode', () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      // Only the packet-table column remains — no separate raw-log column…
      expect(wrapper.findAll('.sdr-decode-dock-column')).toHaveLength(1)
      expect(wrapper.find('[aria-label="Decoder logs"]').exists()).toBe(false)
      // …and no "sync" status (a packet mode has no sync concept).
      expect(wrapper.find('.sdr-decode-status').exists()).toBe(false)
    })

    it('renders zero as a real measurement (course due north), not a dash', async () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      store.pushDecodeEvent({ type: 'aprs', from: 'M0ABC', course: 0, speed: 0, ts: 1 })
      await wrapper.vm.$nextTick()
      const cells = wrapper.findAll('.sdr-decode-table tbody td').map((td) => td.text())
      expect(cells).toContain('0°')
      expect(cells).toContain('0 kn')
    })

    it('shows a dash for every missing field on a bare packet', async () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      // A position-less, callsign-less frame → 10 fields render em-dashes
      // (callsign, symbol, lat, lon, course, speed, altitude, path, comment,
      // raw) — only Time is populated.
      store.pushDecodeEvent({ type: 'aprs', ts: 1 })
      await wrapper.vm.$nextTick()
      const cells = wrapper.findAll('.sdr-decode-table tbody td').map((td) => td.text())
      expect(cells.filter((text) => text === '—').length).toBe(10)
    })

    it('has no accessibility violations in APRS mode', async () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      const wrapper = mountDock()
      store.pushDecodeEvent({
        type: 'aprs',
        from: 'M0ABC-9',
        latitude: 51.5,
        longitude: -0.1,
        ts: 1,
      })
      store.pushDecodeEvent({ type: 'log', line: 'M0ABC-9>APRS:!x', ts: 2 })
      await wrapper.vm.$nextTick()
      expect(await axe(wrapper.element)).toHaveNoViolations()
    })
  })
})
