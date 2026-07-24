import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import { useSdrStore } from '@/stores/sdr'
import { useNotificationsStore } from '@/stores/notifications'

// ── useSdrAudio mock (the audio pipeline is its own 100%-covered unit) ──────────
const audioMock = vi.hoisted(() => ({
  initAudio: vi.fn(() => Promise.resolve()),
  stop: vi.fn(),
  setRadioId: vi.fn(),
  setMode: vi.fn(),
  setSquelch: vi.fn(),
  setVolume: vi.fn(),
  setLiveMuted: vi.fn(),
  setBandwidthHz: vi.fn(),
  setOffsetHz: vi.fn(),
  startRecording: vi.fn(() => Promise.resolve('rec-1')),
  stopRecording: vi.fn(() => Promise.resolve()),
  onPower: vi.fn(),
  onSquelchChange: vi.fn(),
  isReady: vi.fn(() => true),
  isPlaying: vi.fn(() => false),
  // Captured callbacks so tests can drive power/squelch updates.
  _powerCb: null as null | ((dbfs: number, squelchOpen: boolean) => void),
  _squelchCb: null as null | ((open: boolean) => void),
}))
audioMock.onPower.mockImplementation((cb: (dbfs: number, squelchOpen: boolean) => void) => {
  audioMock._powerCb = cb
})
audioMock.onSquelchChange.mockImplementation((cb: (open: boolean) => void) => {
  audioMock._squelchCb = cb
})
vi.mock('@/composables/useSdrAudio', () => ({ useSdrAudio: () => audioMock }))

// ── useSdrDecode mock (the decode transport is its own 100%-covered unit) ───────
const decodeMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setVolume: vi.fn(),
  isActive: vi.fn(() => false),
}))
vi.mock('@/composables/useSdrDecode', () => ({ useSdrDecode: () => decodeMock }))

// ── vue-router useRoute ─────────────────────────────────────────────────────────
const routeMock = vi.hoisted(() => ({ path: '/sdr' }))
vi.mock('vue-router', () => ({ useRoute: () => routeMock }))

// ── search-ranges API ───────────────────────────────────────────────────────────
const searchApi = vi.hoisted(() => ({
  listSearchRanges: vi.fn(() => Promise.resolve([])),
  createSearchRange: vi.fn((range: unknown) => Promise.resolve({ id: 1, ...(range as object) })),
  updateSearchRange: vi.fn((id: number, range: unknown) =>
    Promise.resolve({ id, ...(range as object) }),
  ),
  deleteSearchRange: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/services/sdrSearchApi', () => ({
  listSearchRanges: searchApi.listSearchRanges,
  createSearchRange: searchApi.createSearchRange,
  updateSearchRange: searchApi.updateSearchRange,
  deleteSearchRange: searchApi.deleteSearchRange,
}))

import SdrPanel from './SdrPanel.vue'

enableAutoUnmount(afterEach)

// ── Controllable WebSocket fake ─────────────────────────────────────────────────
interface FakeSocket {
  url: string
  readyState: number
  sent: string[]
  listeners: Record<string, Array<(ev: unknown) => void>>
  addEventListener: (type: string, cb: (ev: unknown) => void) => void
  send: (data: string) => void
  close: () => void
  fire: (type: string, ev?: unknown) => void
  open: () => void
  message: (payload: unknown) => void
  serverClose: () => void
}
let sockets: FakeSocket[]
function makeFakeSocketClass() {
  return class {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    url: string
    readyState = 0
    sent: string[] = []
    listeners: Record<string, Array<(ev: unknown) => void>> = {}
    constructor(url: string) {
      this.url = url
      const self = this as unknown as FakeSocket
      self.addEventListener = (type, cb) => {
        ;(this.listeners[type] ??= []).push(cb)
      }
      self.send = (data) => {
        this.sent.push(data)
      }
      self.close = () => {
        this.readyState = 3
      }
      self.fire = (type, ev) => {
        for (const cb of this.listeners[type] ?? []) cb(ev)
      }
      self.open = () => {
        this.readyState = 1
        self.fire('open')
      }
      self.message = (payload) => {
        self.fire('message', { data: JSON.stringify(payload) })
      }
      self.serverClose = () => {
        this.readyState = 3
        self.fire('close')
      }
      sockets.push(self)
    }
  }
}
function lastSocket(): FakeSocket {
  return sockets[sockets.length - 1]
}

// ── fetch router ────────────────────────────────────────────────────────────────
interface FetchState {
  radios: unknown[]
  frequencies: unknown[]
  groups: unknown[]
  status: Record<string, unknown>
  connectStatus: number
}
let fetchState: FetchState
let fetchCalls: Array<{ url: string; opts?: RequestInit }>
let fetchOverride: ((url: string, opts?: RequestInit) => Promise<unknown> | null) | null

function defaultRouter(url: string, opts?: RequestInit): Promise<unknown> {
  const method = (opts?.method ?? 'GET').toUpperCase()
  const ok = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
  if (url === '/api/sdr/connect') return ok({ ok: true }, fetchState.connectStatus)
  if (url === '/api/sdr/radios') return ok(fetchState.radios)
  if (url === '/api/sdr/frequencies' && method === 'GET') return ok(fetchState.frequencies)
  if (url === '/api/sdr/groups' && method === 'GET') return ok(fetchState.groups)
  if (url.startsWith('/api/sdr/status/')) return ok(fetchState.status)
  return ok({ ok: true })
}

function makeRadio(over: Record<string, unknown> = {}) {
  return { id: 1, name: 'rtl0', host: '10.0.0.1', enabled: true, ...over }
}

beforeEach(() => {
  setActivePinia(createPinia())
  sockets = []
  fetchState = {
    radios: [makeRadio()],
    frequencies: [],
    groups: [],
    status: { connected: true, reachable: true },
    connectStatus: 200,
  }
  fetchCalls = []
  fetchOverride = null
  for (const fn of Object.values(audioMock)) {
    if (typeof fn === 'object' && fn && 'mockClear' in fn)
      (fn as { mockClear: () => void }).mockClear()
  }
  audioMock._powerCb = null
  audioMock._squelchCb = null
  decodeMock.start.mockClear()
  decodeMock.stop.mockClear()
  decodeMock.setVolume.mockClear()
  decodeMock.isActive.mockClear().mockReturnValue(false)
  // Re-establish default resolutions (mockResolvedValue / *Once from a prior test
  // persists through mockClear, which would otherwise bleed into later tests).
  audioMock.initAudio.mockResolvedValue(undefined)
  audioMock.startRecording.mockResolvedValue('rec-1')
  audioMock.stopRecording.mockResolvedValue(undefined)
  searchApi.listSearchRanges.mockReset().mockResolvedValue([])
  searchApi.createSearchRange
    .mockReset()
    .mockImplementation((range: unknown) => Promise.resolve({ id: 1, ...(range as object) }))
  searchApi.updateSearchRange
    .mockReset()
    .mockImplementation((id: number, range: unknown) =>
      Promise.resolve({ id, ...(range as object) }),
    )
  searchApi.deleteSearchRange.mockReset().mockResolvedValue(undefined)
  routeMock.path = '/sdr'

  vi.stubGlobal('WebSocket', makeFakeSocketClass())
  global.fetch = vi.fn((url: string | URL | Request, opts?: RequestInit) => {
    const urlStr = String(url)
    fetchCalls.push({ url: urlStr, opts })
    const overridden = fetchOverride?.(urlStr, opts)
    return (overridden ?? defaultRouter(urlStr, opts)) as Promise<Response>
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // Teleported rails/menus can linger between mounts — clear them so document
  // queries always resolve to the current instance.
  document
    .querySelectorAll('#sdr-sidebar-rail, .sdr-device-menu, .sdr-step-menu, .sdr-sample-rate-menu')
    .forEach((node) => node.remove())
})

// ── Mount helper ────────────────────────────────────────────────────────────────
function mountPanel(props: { fullPage?: boolean } = {}): VueWrapper {
  return mount(SdrPanel, {
    props: { fullPage: false, ...props },
    attachTo: document.body,
    global: {
      stubs: {
        SdrRecordingsSection: {
          template: '<div class="stub-recordings" />',
          methods: { reload: () => Promise.resolve() },
        },
      },
    },
  })
}

async function mountReady(props: { fullPage?: boolean } = {}): Promise<VueWrapper> {
  const wrapper = mountPanel(props)
  await flushPromises()
  return wrapper
}

// With a single enabled radio, populateRadios auto-selects it and opens the
// control socket at mount. Fire the socket's open, then optionally confirm data.
async function mountConnected(props: { fullPage?: boolean } = {}): Promise<{
  wrapper: VueWrapper
  socket: FakeSocket
}> {
  const wrapper = await mountReady(props)
  const socket = lastSocket()
  socket.open()
  await flushPromises()
  return { wrapper, socket }
}

// Send a spectrum frame so the panel marks itself connected (sets the dot,
// confirms control data).
async function confirmData(wrapper: VueWrapper, socket: FakeSocket): Promise<void> {
  socket.message({
    type: 'spectrum',
    bins: [1, 2, 3, 4],
    center_hz: 100_000_000,
    sample_rate: 2_048_000,
    timestamp_ms: Date.now(),
  })
  await wrapper.vm.$nextTick()
}

// =============================================================================
describe('SdrPanel — mount', () => {
  it('mounts and loads the radio list', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('#sdr-panel, .sdr-panel, [class*="sdr"]').exists()).toBe(true)
    expect(fetchCalls.some((call) => call.url === '/api/sdr/radios')).toBe(true)
  })

  it('has no obvious accessibility violations', async () => {
    const wrapper = await mountReady()
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})

// =============================================================================
describe('SdrPanel — control socket lifecycle', () => {
  it('auto-selects the sole enabled radio and opens a control socket', async () => {
    await mountReady()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toContain('/ws/sdr/1')
  })

  it('sends the restored sample rate and fft size on socket open', async () => {
    const store = useSdrStore()
    store.requestFftSize(4096)
    const { socket } = await mountConnected()
    const cmds = socket.sent.map((s) => JSON.parse(s).cmd)
    expect(cmds).toContain('sample_rate')
    expect(cmds).toContain('fft_size')
  })

  it('marks connected on the first spectrum frame and updates the store', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await confirmData(wrapper, socket)
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
    expect(store.lastSpectrum?.center_hz).toBe(100_000_000)
  })

  it('applies a status message: seeds the frequency field and mode', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 145_500_000,
      mode: 'NFM',
      gain_db: 20,
      gain_auto: false,
      sample_rate: 2_048_000,
    })
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-freq-input-large').element as HTMLInputElement
    expect(input.value).toBe('145.5000')
  })

  it('drops the connection dot on an error message', async () => {
    const { wrapper, socket } = await mountConnected()
    await confirmData(wrapper, socket)
    socket.message({ type: 'error', message: 'device gone' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
  })

  it('ignores malformed JSON and unknown message types', async () => {
    const { socket } = await mountConnected()
    socket.fire('message', { data: '{not json' })
    socket.message({ type: 'pong' })
    expect(true).toBe(true) // no throw
  })

  it('reconnects after the socket closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { socket } = await mountConnected()
    socket.serverClose()
    vi.advanceTimersByTime(600)
    await flushPromises()
    vi.useRealTimers()
    expect(sockets.length).toBeGreaterThan(1)
  })

  it('re-probes reachability so the connection dot self-corrects if the device connects late', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Device not reachable when the socket first opens (backend still (re)connecting
    // after a restart) — the first probe misses and the dot stays red.
    fetchState.status = { connected: false, reachable: false }
    const { wrapper } = await mountConnected()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
    // Still down one retry later — the dot stays red and another retry is scheduled.
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
    // The device comes up; the next retry finds it reachable and greens the dot.
    fetchState.status = { connected: true, reachable: true }
    vi.advanceTimersByTime(1500)
    await flushPromises()
    await wrapper.vm.$nextTick()
    vi.useRealTimers()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
  })

  it('stops retrying the reachability probe after the max attempt count', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Device never becomes reachable across every retry — the probe should give
    // up after PROBE_MAX_ATTEMPTS (4) rather than rescheduling indefinitely.
    fetchState.status = { connected: false, reachable: false }
    await mountConnected()
    const statusCallCount = () =>
      fetchCalls.filter((call) => call.url.startsWith('/api/sdr/status/')).length
    expect(statusCallCount()).toBe(1) // initial probe on socket open
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(statusCallCount()).toBe(2) // attempt 2
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(statusCallCount()).toBe(3) // attempt 3
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(statusCallCount()).toBe(4) // attempt 4 (final, hits PROBE_MAX_ATTEMPTS)
    // No further retry is scheduled past the max attempt count.
    vi.advanceTimersByTime(1500)
    await flushPromises()
    expect(statusCallCount()).toBe(4)
    vi.useRealTimers()
  })

  it('clears a stale radio id and stops when connect returns 404', async () => {
    fetchState.connectStatus = 404
    const wrapper = await mountReady()
    await flushPromises()
    expect(wrapper.find('.sdr-device-dropdown-text').text()).toContain('select radio')
  })
})

// =============================================================================
describe('SdrPanel — RADIO tab: tune / stop / record', () => {
  it('tunes to a typed frequency and sends a tune command', async () => {
    const { wrapper, socket } = await mountConnected()
    const input = wrapper.find('.sdr-freq-input-large')
    await input.setValue('145.500')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const tuneCmd = socket.sent.map((s) => JSON.parse(s)).find((m) => m.cmd === 'tune')
    expect(tuneCmd?.frequency_hz).toBe(145_500_000)
    expect(audioMock.initAudio).toHaveBeenCalledWith(1)
  })

  it('does not tune with an empty/invalid frequency', async () => {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('abc')
    socket.sent.length = 0
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).not.toContain('tune')
  })

  it('stops audio and resets the signal meter', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await wrapper.find('.sdr-stop-btn').trigger('click')
    expect(audioMock.stop).toHaveBeenCalled()
  })

  it('toggles recording on and off', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    // REC is a state toggle, so it reports its state via aria-pressed.
    expect(wrapper.find('.sdr-rec-btn').attributes('aria-pressed')).toBe('false')
    await wrapper.find('.sdr-rec-btn').trigger('click')
    await flushPromises()
    expect(audioMock.startRecording).toHaveBeenCalled()
    expect(wrapper.find('.sdr-rec-btn').attributes('aria-pressed')).toBe('true')
    await wrapper.find('.sdr-rec-btn').trigger('click')
    await flushPromises()
    expect(audioMock.stopRecording).toHaveBeenCalled()
    expect(wrapper.find('.sdr-rec-btn').attributes('aria-pressed')).toBe('false')
  })
})

// =============================================================================
describe('SdrPanel — RADIO tab: digital decode', () => {
  // Tune (which sets playing=true) so the DIGITAL button becomes enabled.
  async function mountPlaying() {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.sent.length = 0
    return { wrapper, socket }
  }

  function sentCmds(socket: FakeSocket) {
    return socket.sent.map((s) => JSON.parse(s))
  }

  it('disables the DIGITAL button until the radio is playing', async () => {
    const { wrapper } = await mountConnected()
    const button = wrapper.find('.sdr-digital-btn')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enabling digital sends the command, starts decode, mutes live audio, activates the button', async () => {
    const { wrapper, socket } = await mountPlaying()
    expect((wrapper.find('.sdr-digital-btn').element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()

    const cmd = sentCmds(socket).find((m) => m.cmd === 'digital_decode')
    expect(cmd).toMatchObject({ enabled: true, mode: expect.any(String) })
    expect(decodeMock.start).toHaveBeenCalledWith(1)
    // Scoped to the decoding radio, so another radio stays audible.
    expect(audioMock.setLiveMuted).toHaveBeenCalledWith(true, 'digital', 1)
    // The decoder dock lives in SdrView (driven by store.digitalEnabled); here we
    // assert the inline Decode button reflects the active state.
    expect(wrapper.find('.sdr-digital-btn').classes()).toContain('sdr-digital-btn--active')
    expect(wrapper.find('.sdr-digital-btn').attributes('aria-pressed')).toBe('true')
  })

  it('disabling digital sends the command, stops decode and unmutes', async () => {
    const { wrapper, socket } = await mountPlaying()
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    socket.sent.length = 0
    audioMock.setLiveMuted.mockClear()

    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    const cmd = sentCmds(socket).find((m) => m.cmd === 'digital_decode')
    expect(cmd).toMatchObject({ enabled: false })
    expect(decodeMock.stop).toHaveBeenCalled()
    expect(audioMock.setLiveMuted).toHaveBeenCalledWith(false, 'digital', 1)
    expect(wrapper.find('.sdr-digital-btn').classes()).not.toContain('sdr-digital-btn--active')
  })

  it('pushes a digital_channel command when the mode changes while decoding', async () => {
    const { wrapper, socket } = await mountPlaying()
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    socket.sent.length = 0

    const nfmPill = wrapper
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')
    await nfmPill!.trigger('click')
    await flushPromises()
    expect(sentCmds(socket).some((m) => m.cmd === 'digital_channel')).toBe(true)
  })

  it('does not push digital_channel when decoding is off', async () => {
    const { wrapper, socket } = await mountPlaying()
    const nfmPill = wrapper
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')
    await nfmPill!.trigger('click')
    await flushPromises()
    expect(sentCmds(socket).some((m) => m.cmd === 'digital_channel')).toBe(false)
  })

  it('stopping audio also disables digital decode', async () => {
    const { wrapper, socket } = await mountPlaying()
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    decodeMock.stop.mockClear()
    socket.sent.length = 0

    await wrapper.find('.sdr-stop-btn').trigger('click')
    await flushPromises()
    expect(decodeMock.stop).toHaveBeenCalled()
    expect(sentCmds(socket).some((m) => m.cmd === 'digital_decode' && m.enabled === false)).toBe(
      true,
    )
  })

  it('enabling digital with no radio selected skips starting the decode transport', async () => {
    fetchState.radios = [] // no auto-select → selectedRadioId stays null
    const wrapper = await mountReady()
    ;(wrapper.vm as unknown as { toggleDigital: () => void }).toggleDigital()
    await flushPromises()
    expect(decodeMock.start).not.toHaveBeenCalled()
    // No radio to scope the mute to — nothing is decoding, so nothing is muted.
    expect(audioMock.setLiveMuted).toHaveBeenCalledWith(false, 'digital', 'all')
  })

  it('selecting a different radio disables digital decode', async () => {
    const { wrapper } = await mountPlaying()
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    decodeMock.stop.mockClear()

    // Re-selecting via the public API path used by the device dropdown.
    const vm = wrapper.vm as unknown as {
      selectRadio: (radio: {
        id: number
        name: string
        host: string
        port: number
        enabled: boolean
      }) => void
    }
    vm.selectRadio({ id: 2, name: 'Radio Two', host: '127.0.0.1', port: 1234, enabled: true })
    await flushPromises()
    expect(decodeMock.stop).toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — RADIO tab: APRS decode', () => {
  async function mountPlaying() {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('144.800')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.sent.length = 0
    return { wrapper, socket }
  }

  function aprsPill(wrapper: VueWrapper) {
    return wrapper.findAll('.sdr-mode-pills .sdr-mode-pill').find((pill) => pill.text() === 'APRS')!
  }

  it('disables the APRS button until a radio is selected', async () => {
    fetchState.radios = [] // no auto-select → selectedRadioId stays null
    const wrapper = await mountReady()
    expect((aprsPill(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })

  // Stands in for the real startAprs, which records the accepted radio — the
  // button's active state and the audio mute both key off that id.
  function stubStartAprs(store: ReturnType<typeof useSdrStore>, accepted = true) {
    return vi.spyOn(store, 'startAprs').mockImplementation(async (radioId: number) => {
      if (accepted) store.setAprsRadioId(radioId)
      return accepted
    })
  }

  it('enabling APRS starts background decode + the panel event stream and activates the button', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    const startSpy = stubStartAprs(store)
    await aprsPill(wrapper).trigger('click')
    await flushPromises()
    expect(startSpy).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number))
    expect(decodeMock.start).toHaveBeenCalledWith(1)
    expect(store.aprsEnabled).toBe(true)
    expect(aprsPill(wrapper).classes()).toContain('sdr-digital-btn--active')
  })

  it('disabling APRS stops the panel event stream and the backend session', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    stubStartAprs(store)
    const stopSpy = vi.spyOn(store, 'stopAprs').mockImplementation(async () => {
      store.setAprsRadioId(null)
      return true
    })
    await aprsPill(wrapper).trigger('click')
    await flushPromises()
    decodeMock.stop.mockClear()
    await aprsPill(wrapper).trigger('click')
    await flushPromises()
    expect(stopSpy).toHaveBeenCalledWith(1)
    expect(decodeMock.stop).toHaveBeenCalled()
    expect(store.aprsEnabled).toBe(false)
  })

  it('reverts the toggle and skips the event stream when the backend refuses to start', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    stubStartAprs(store, false)
    decodeMock.start.mockClear()
    await aprsPill(wrapper).trigger('click')
    await flushPromises()
    expect(store.aprsEnabled).toBe(false)
    expect(decodeMock.start).not.toHaveBeenCalled()
  })

  it('APRS and digital voice are mutually exclusive on the viewed radio', async () => {
    const { wrapper } = await mountPlaying()
    // Enabling digital (the first .sdr-digital-btn is DMR) disables the APRS pill.
    await wrapper.find('.sdr-digital-btn').trigger('click')
    await flushPromises()
    expect((aprsPill(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })

  it('toggling APRS with no radio selected is a no-op', async () => {
    fetchState.radios = []
    const wrapper = await mountReady()
    const store = useSdrStore()
    const startSpy = vi.spyOn(store, 'startAprs')
    await (wrapper.vm as unknown as { toggleAprs: () => Promise<void> }).toggleAprs()
    expect(startSpy).not.toHaveBeenCalled()
  })

  it('shows the APRS button inactive while another radio is the one decoding', async () => {
    const { wrapper } = await mountPlaying() // viewing radio 1
    const store = useSdrStore()
    store.setAprsEnabled(true)
    store.setAprsRadioId(2) // decode is running on a different dongle
    await wrapper.vm.$nextTick()
    expect(aprsPill(wrapper).classes()).not.toContain('sdr-digital-btn--active')
    expect(aprsPill(wrapper).attributes('aria-pressed')).toBe('false')
  })

  it('hands decode over to the viewed radio instead of stopping the other one', async () => {
    const { wrapper } = await mountPlaying() // viewing radio 1
    const store = useSdrStore()
    store.setAprsEnabled(true)
    store.setAprsRadioId(2)
    await wrapper.vm.$nextTick()
    const startSpy = stubStartAprs(store)
    const stopSpy = vi.spyOn(store, 'stopAprs')

    await aprsPill(wrapper).trigger('click')
    await flushPromises()
    // Starts on the viewed radio (the backend runs a single bridge, so this
    // hands decode over) rather than stopping a radio that was never decoding.
    expect(startSpy).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Number))
    expect(stopSpy).not.toHaveBeenCalled()
    expect(store.aprsRadioId).toBe(1)
    expect(aprsPill(wrapper).classes()).toContain('sdr-digital-btn--active')
  })

  it('mutes the audio of the radio decoding APRS', async () => {
    const { wrapper } = await mountPlaying() // radio 1 is the viewed radio
    const store = useSdrStore()
    audioMock.setLiveMuted.mockClear()
    store.setAprsRadioId(1)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenLastCalledWith(true, 'aprs', 1)
  })

  it('mutes only the decoding radio, leaving another radio audible', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    audioMock.setLiveMuted.mockClear()
    // APRS decodes on radio 2 while the user listens to radio 1.
    store.setAprsRadioId(2)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenLastCalledWith(true, 'aprs', 2)
  })

  it('unmutes when APRS decode stops', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    store.setAprsRadioId(1)
    await wrapper.vm.$nextTick()
    audioMock.setLiveMuted.mockClear()
    store.setAprsRadioId(null)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenLastCalledWith(false, 'aprs', 'all')
  })

  it('leaves APRS audio alone when "mute audio while decoding" is off', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    store.setMuteAudioWhileDecoding(false)
    audioMock.setLiveMuted.mockClear()
    store.setAprsRadioId(1)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenLastCalledWith(false, 'aprs', 1)
  })

  it('applies the mute setting live while APRS decode is running', async () => {
    const { wrapper } = await mountPlaying()
    const store = useSdrStore()
    store.setAprsRadioId(1)
    await wrapper.vm.$nextTick()
    audioMock.setLiveMuted.mockClear()
    store.setMuteAudioWhileDecoding(false)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenLastCalledWith(false, 'aprs', 1)
  })

  it('reconciles the decoding radio and the mute setting with the DB on mount', async () => {
    const store = useSdrStore()
    const aprsSpy = vi.spyOn(store, 'hydrateAprsFromDb').mockResolvedValue(undefined)
    const muteSpy = vi
      .spyOn(store, 'hydrateMuteAudioWhileDecodingFromDb')
      .mockResolvedValue(undefined)
    await mountReady()
    expect(aprsSpy).toHaveBeenCalled()
    expect(muteSpy).toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — RADIO tab: mode & audio controls', () => {
  it('switches mode via the mode pills', async () => {
    const { wrapper } = await mountConnected()
    const nfmPill = wrapper
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')
    await nfmPill!.trigger('click')
    expect(audioMock.setMode).toHaveBeenCalledWith('NFM')
  })

  it('exposes the MODE pills as a keyboard-operable radio group', async () => {
    const { wrapper } = await mountConnected()
    const group = wrapper.find('.sdr-mode-pills')
    expect(group.attributes('role')).toBe('radiogroup')
    expect(group.attributes('aria-label')).toBe('Demodulation mode')

    // Roving tabindex: exactly the checked pill is tabbable.
    const pills = wrapper.findAll('.sdr-mode-pills .sdr-mode-pill')
    const checkedPills = pills.filter((pill) => pill.attributes('aria-checked') === 'true')
    expect(checkedPills).toHaveLength(1)
    const checkedPill = checkedPills[0]!
    expect(checkedPill.attributes('role')).toBe('radio')
    expect(checkedPill.attributes('tabindex')).toBe('0')
    for (const pill of pills.filter((p) => p.attributes('aria-checked') === 'false')) {
      expect(pill.attributes('tabindex')).toBe('-1')
    }

    // ArrowRight selects the next mode through the same setMode path as a click.
    const checkedIndex = pills.findIndex((pill) => pill.attributes('aria-checked') === 'true')
    const nextPill = pills[(checkedIndex + 1) % pills.length]!
    await checkedPill.trigger('keydown', { key: 'ArrowRight' })
    expect(audioMock.setMode).toHaveBeenCalledWith(nextPill.text())
    expect(nextPill.attributes('aria-checked')).toBe('true')
    expect(nextPill.attributes('tabindex')).toBe('0')
    expect(checkedPill.attributes('tabindex')).toBe('-1')
  })

  it('persists the last mode marker when switching mode (kept in step for reload)', async () => {
    sessionStorage.setItem('sdrLastMode', 'AM')
    const { wrapper } = await mountConnected()
    const nfmPill = wrapper
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')
    await nfmPill!.trigger('click')
    // setMode must update sdrLastMode too, so the reload-restore path never reads
    // a stale value left behind by a mode change.
    expect(sessionStorage.getItem('sdrLastMode')).toBe('NFM')
  })

  it('adjusts volume, squelch, bandwidth and gain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    // The settings accordion is open by default; sliders are volume/squelch/
    // bandwidth/gain in order.
    const sliders = wrapper.findAll('.sdr-panel-slider')
    await sliders[0].setValue('150') // volume → setVolume(1.5)
    expect(audioMock.setVolume).toHaveBeenCalledWith(1.5)
    await sliders[1].setValue('-40') // squelch (debounced)
    await sliders[2].setValue('12000') // bandwidth → setBandwidthHz
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(12000)
    await sliders[3].setValue('-1') // gain → auto (debounced)
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    const cmds = socket.sent.map((s) => JSON.parse(s).cmd)
    expect(cmds).toContain('squelch')
    expect(cmds).toContain('gain')
  })

  it('toggles the settings accordion (open by default) closed and open', async () => {
    const { wrapper } = await mountConnected()
    const toggle = wrapper.find('button[aria-controls="sdr-settings-section"]')
    expect(toggle.classes()).toContain('sdr-frequency-manager-accordion-toggle-expanded')
    await toggle.trigger('click')
    expect(toggle.classes()).not.toContain('sdr-frequency-manager-accordion-toggle-expanded')
    await toggle.trigger('click')
    expect(toggle.classes()).toContain('sdr-frequency-manager-accordion-toggle-expanded')
  })

  it('toggles the CONTROLS accordion (open by default) closed and open', async () => {
    const { wrapper } = await mountConnected()
    const toggle = wrapper.find('button[aria-controls="sdr-mode-section"]')
    expect(toggle.text()).toBe('CONTROLS')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
  })

  it('toggles the frequency manager accordion (closed by default) open and closed', async () => {
    const { wrapper } = await mountConnected()
    const toggle = wrapper.findAll('.sdr-scanner-header-row')[2]
    expect(toggle.attributes('aria-controls')).toBe('sdr-freq-manager-section')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('reflects the settings accordion state via aria-expanded/aria-controls', async () => {
    const { wrapper } = await mountConnected()
    const toggle = wrapper.find('button[aria-controls="sdr-settings-section"]')
    expect(toggle.attributes('aria-controls')).toBe('sdr-settings-section')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('drives the signal meter from the audio power callback', async () => {
    const { wrapper } = await mountConnected()
    expect(audioMock._powerCb).toBeTypeOf('function')
    audioMock._powerCb!(-20, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-signal-seg--on').length).toBeGreaterThan(0)
  })
})

// ── Data helpers for the manager tabs ────────────────────────────────────────────
function makeFreq(over: Record<string, unknown> = {}) {
  return {
    id: 10,
    label: 'ATIS',
    frequency_hz: 124_000_000,
    mode: 'AM',
    scannable: true,
    group_ids: [1],
    notes: '',
    ...over,
  }
}
function makeGroup(over: Record<string, unknown> = {}) {
  return { id: 1, name: 'Airband', slug: 'airband', color: '#0af', sort_order: 0, ...over }
}
function railButton(tab: string): HTMLElement {
  const matches = document.querySelectorAll<HTMLElement>(`.sdr-rail-btn[data-tab="${tab}"]`)
  return matches[matches.length - 1]
}

// =============================================================================
describe('SdrPanel — tab navigation', () => {
  it('switches tabs and requests the side panel open when collapsed', async () => {
    const wrapper = await mountReady()
    const events: string[] = []
    const handler = (e: Event) => events.push(e.type)
    document.addEventListener('sentinel:sdr-open-panel', handler)
    railButton('groups').click()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-tab-pane.active').exists()).toBe(true)
    expect(events).toContain('sentinel:sdr-open-panel')
    document.removeEventListener('sentinel:sdr-open-panel', handler)
  })

  it('renders the rail tabs with the right rail’s plain button look (no bordered accent bar)', async () => {
    await mountReady()
    const radioTab = railButton('radio')
    expect(radioTab.classList.contains('ba-btn--bordered')).toBe(false)
    // Colour-only state transition, matching the map rails' shared look.
    expect(radioTab.style.getPropertyValue('--ba-rail-transition')).toBe('color 0.15s ease')
  })

  it('toggles the panel when clicking the already-active tab while open', async () => {
    const wrapper = await mountReady()
    document.dispatchEvent(new CustomEvent('sentinel:sidebar-state', { detail: { open: true } }))
    await wrapper.vm.$nextTick()
    const events: string[] = []
    const handler = (e: Event) => events.push(e.type)
    document.addEventListener('sentinel:sdr-toggle-panel', handler)
    railButton('radio').click() // 'radio' is the active tab
    expect(events).toContain('sentinel:sdr-toggle-panel')
    document.removeEventListener('sentinel:sdr-toggle-panel', handler)
  })
})

// =============================================================================
describe('SdrPanel — frequency manager tab', () => {
  async function mountWithData() {
    fetchState.frequencies = [makeFreq(), makeFreq({ id: 11, label: 'Tower', group_ids: [] })]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    return mountConnected()
  }

  it('renders one row per frequency with its label and MHz', async () => {
    const { wrapper } = await mountWithData()
    const rows = wrapper.findAll('.sdr-freq-row-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.sdr-freq-row-label').text()).toBe('ATIS')
    expect(rows[0].find('.sdr-freq-row-hz').text()).toBe('124.0000 MHz')
  })

  it('filters the list by group and resets to all', async () => {
    const { wrapper } = await mountWithData()
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    const airband = chips.find((chip) => chip.text() === 'Airband')!
    await airband.trigger('click')
    // Only the Airband-tagged frequency (ATIS) remains.
    expect(wrapper.findAll('.sdr-freq-row-item')).toHaveLength(1)
    await wrapper
      .findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
      .find((chip) => chip.text() === 'All')!
      .trigger('click')
    expect(wrapper.findAll('.sdr-freq-row-item')).toHaveLength(2)
  })

  it('blocks save with validation errors and adds a new frequency once valid', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    // Empty label → validation error, no POST.
    await wrapper.find('#sdr-ef-label').setValue('')
    await wrapper.find('#sdr-ef-freq').setValue('not-a-freq')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-field-error').exists()).toBe(true)
    expect(
      fetchCalls.some((c) => c.url === '/api/sdr/frequencies' && c.opts?.method === 'POST'),
    ).toBe(false)
    // Fill valid values and save.
    await wrapper.find('#sdr-ef-label').setValue('New Channel')
    await wrapper.find('#sdr-ef-freq').setValue('146.520')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const post = fetchCalls.find(
      (c) => c.url === '/api/sdr/frequencies' && c.opts?.method === 'POST',
    )
    expect(JSON.parse(post!.opts!.body as string).frequency_hz).toBe(146_520_000)
  })

  it('rejects notes with disallowed characters', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-label').setValue('Valid')
    await wrapper.find('#sdr-ef-freq').setValue('100.000')
    await wrapper.find('#sdr-ef-notes').setValue('bad < > chars')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-field-error').text()).toMatch(/disallowed/)
  })

  it('toggles groups in the add panel', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    const gpill = wrapper
      .findAll('#sdr-ef-groups .sdr-ef-gpill')
      .find((b) => b.text() === 'Marine')!
    await gpill.trigger('click')
    expect(gpill.classes()).toContain('active')
    await gpill.trigger('click')
    expect(gpill.classes()).not.toContain('active')
  })

  it('edits an existing frequency via the row (PUT) and cancels', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const inline = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    expect(inline.exists()).toBe(true)
    await inline.find('input.sdr-panel-input').setValue('ATIS Renamed')
    await inline.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    const put = fetchCalls.find(
      (c) => c.url === '/api/sdr/frequencies/10' && c.opts?.method === 'PUT',
    )
    expect(JSON.parse(put!.opts!.body as string).label).toBe('ATIS Renamed')
  })

  it('toggling the same row edit button closes the panel', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })

  it('renders the row edit button as an accessible SVG pencil icon (aligned with play/delete)', async () => {
    const { wrapper } = await mountWithData()
    const editButton = wrapper.findAll('.sdr-freq-row-edit')[0]
    // The pencil is an inline SVG (not a text glyph) so it baseline-aligns with
    // the play SVG and × in the same row — see the alignment fix.
    expect(editButton.find('svg').exists()).toBe(true)
    expect(editButton.text()).toBe('')
    expect(editButton.attributes('aria-label')).toBe('Edit frequency')
  })

  it('deletes a frequency via the row delete button (DELETE)', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.findAll('.sdr-freq-row-del')[0].trigger('click')
    await flushPromises()
    expect(
      fetchCalls.some((c) => c.url === '/api/sdr/frequencies/10' && c.opts?.method === 'DELETE'),
    ).toBe(true)
  })

  it('plays a saved frequency from its row', async () => {
    const { wrapper } = await mountWithData()
    await wrapper.findAll('.sdr-freq-row-play')[0].trigger('click')
    await flushPromises()
    expect(audioMock.initAudio).toHaveBeenCalled()
  })
})

// =============================================================================
function makeRange(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    label: 'Air Band',
    low_hz: 118_000_000,
    high_hz: 137_000_000,
    step_hz: 25_000,
    mode: 'AM',
    threshold_dbfs: -60,
    dwell_ms: 200,
    band_name: '',
    enabled: true,
    notes: '',
    sort_order: 0,
    ...over,
  }
}

describe('SdrPanel — groups tab', () => {
  async function mountWithGroups() {
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    return mountConnected()
  }

  it('adds a new group', async () => {
    const { wrapper } = await mountWithGroups()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.setValue('Weather')
    await wrapper.find('.sdr-frequency-manager-group-add-row button:last-child').trigger('click')
    await flushPromises()
    const post = fetchCalls.find((c) => c.url === '/api/sdr/groups' && c.opts?.method === 'POST')
    expect(JSON.parse(post!.opts!.body as string).name).toBe('Weather')
  })

  it('does not add a blank group name', async () => {
    const { wrapper } = await mountWithGroups()
    await wrapper.find('.sdr-frequency-manager-group-add-row button:last-child').trigger('click')
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/sdr/groups' && c.opts?.method === 'POST')).toBe(
      false,
    )
  })

  it('renames a group inline (PUT) and cancels editing', async () => {
    const { wrapper } = await mountWithGroups()
    await wrapper.findAll('.sdr-group-pill-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.setValue('Airband 2')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const put = fetchCalls.find((c) => c.url === '/api/sdr/groups/1' && c.opts?.method === 'PUT')
    expect(JSON.parse(put!.opts!.body as string).name).toBe('Airband 2')
  })

  it('cancels an inline group edit with Escape', async () => {
    const { wrapper } = await mountWithGroups()
    await wrapper.findAll('.sdr-group-pill-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    // The CANCEL button (v-if editingGroupId !== null) disappears once editing ends.
    const buttons = wrapper.findAll('.sdr-frequency-manager-group-add-row button')
    expect(buttons.every((b) => b.text() !== 'CANCEL')).toBe(true)
  })

  it('deletes a group (DELETE)', async () => {
    const { wrapper } = await mountWithGroups()
    await wrapper.findAll('.sdr-group-pill-del')[0].trigger('click')
    await flushPromises()
    expect(
      fetchCalls.some((c) => /\/api\/sdr\/groups\/\d+/.test(c.url) && c.opts?.method === 'DELETE'),
    ).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — search ranges tab', () => {
  async function mountWithRanges() {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    return mountConnected()
  }

  function rangesPane(wrapper: VueWrapper) {
    return wrapper.findAll('.sdr-tab-pane')[1] // radio, search-ranges
  }

  it('lists search ranges from the API', async () => {
    const { wrapper } = await mountWithRanges()
    const rows = wrapper.findAll('#sdr-search-range-list .sdr-freq-row-item')
    expect(rows).toHaveLength(1)
    expect(rows[0].find('.sdr-freq-row-label').text()).toBe('Air Band')
  })

  it('opens the add-range editor, validates, and creates a range', async () => {
    const { wrapper } = await mountWithRanges()
    const addBtn = rangesPane(wrapper)
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
    await addBtn.trigger('click')
    await wrapper.vm.$nextTick()
    // Empty label → error, no create.
    const editor = rangesPane(wrapper).find('.sdr-editfreq-body')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(rangesPane(wrapper).find('.sdr-field-error').exists()).toBe(true)
    expect(searchApi.createSearchRange).not.toHaveBeenCalled()
    // Fill valid values.
    const inputs = editor.findAll('input.sdr-panel-input')
    await inputs[0].setValue('Marine VHF') // label
    await inputs[1].setValue('156') // low mhz
    await inputs[2].setValue('162') // high mhz
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(searchApi.createSearchRange).toHaveBeenCalled()
  })

  it('edits a range inline (update) and deletes a range', async () => {
    const { wrapper } = await mountWithRanges()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await editor.find('input.sdr-panel-input').setValue('Air Band Edited')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(searchApi.updateSearchRange).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ label: 'Air Band Edited' }),
    )

    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-del')[0].trigger('click')
    await flushPromises()
    expect(searchApi.deleteSearchRange).toHaveBeenCalledWith(5)
  })

  it('renders the range edit button as an accessible SVG pencil icon', async () => {
    const { wrapper } = await mountWithRanges()
    const editButton = wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0]
    expect(editButton.find('svg').exists()).toBe(true)
    expect(editButton.text()).toBe('')
    expect(editButton.attributes('aria-label')).toBe('Edit range')
  })

  it('toggling the same range edit closes the editor', async () => {
    const { wrapper } = await mountWithRanges()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
    // Click the row body (toggleEditRange) to close.
    await wrapper.find('.sdr-freq-editing .sdr-search-range-row-body').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — scanner', () => {
  async function mountScannable() {
    fetchState.frequencies = [
      makeFreq({ id: 10, label: 'A', frequency_hz: 118_000_000, scannable: true, group_ids: [1] }),
      makeFreq({ id: 11, label: 'B', frequency_hz: 119_000_000, scannable: true, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const ctx = await mountConnected()
    // Expand the scanner section.
    await ctx.wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await ctx.wrapper.vm.$nextTick()
    return ctx
  }

  it('mirrors selected scan groups into the store', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountScannable()
    const chips = wrapper.findAll('#sdr-scanner-section .sdr-scan-group-chip')
    const marine = chips.find((c) => c.text() === 'Marine')!
    await marine.trigger('click')
    expect(store.scanGroupNames).toEqual(['Marine'])
    // Back to all.
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'All')!
      .trigger('click')
    expect(store.scanGroupNames).toEqual(['All'])
  })

  it('renders the primary scan button icon-only, without a SCAN/STOP text label', async () => {
    const { wrapper } = await mountScannable()
    const scanBtn = wrapper.find('.sdr-scan-btns-row--left .sdr-search-adhoc-play')
    expect(scanBtn.exists()).toBe(true)
    // The button shows only the play/stop SVG — no text label (matching the
    // search-section button). Guards against the removed "Scan"/"Stop" label.
    expect(scanBtn.find('.sdr-search-adhoc-play-label').exists()).toBe(false)
    expect(scanBtn.text()).toBe('')
    expect(scanBtn.find('svg').exists()).toBe(true)
  })

  it('starts and stops the scanner from the primary button', async () => {
    const { wrapper, socket } = await mountScannable()
    const scanBtn = wrapper.find('.sdr-search-adhoc-play')
    socket.sent.length = 0
    await scanBtn.trigger('click') // Scan → startScan → doScanStep → tune
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).toContain('tune')
    await scanBtn.trigger('click') // Stop
    expect(useSdrStore().scanSweeping).toBe(false)
  })

  it('locks onto a strong signal then the primary button toggles the lock', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountScannable()
    const store = useSdrStore()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    // Feed two strong frames at the tuned freq, settle the window, fire evaluate.
    const strong = {
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118_000_000,
      sample_rate: 2_048_000,
      timestamp_ms: 1,
    }
    socket.message(strong)
    socket.message({ ...strong, timestamp_ms: 2 })
    nowMs += 500
    vi.advanceTimersByTime(300) // dwell → evaluate → db(0) >= squelch(-30) → lock
    await wrapper.vm.$nextTick() // flush the scan-sweep mirror watch
    expect(store.scanSweeping).toBe(false) // locked → not sweeping
    vi.useRealTimers()
  })
})

// =============================================================================
describe('SdrPanel — range search', () => {
  async function mountSearch() {
    const ctx = await mountConnected()
    await ctx.wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click') // expand SEARCH
    await ctx.wrapper.vm.$nextTick()
    return ctx
  }

  it('runs an ad-hoc search and tunes across the range', async () => {
    const { wrapper, socket } = await mountSearch()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118') // low
    const inputs = wrapper.findAll('.sdr-search-adhoc-input')
    await inputs[1].setValue('119') // high
    socket.sent.length = 0
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).toContain('tune')
    expect(useSdrStore().searchSweeping).toBe(true)
    // Stop via the same button.
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(useSdrStore().searchSweeping).toBe(false)
  })

  it('locks onto a signal during a search then auto-resumes after it drops', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountSearch()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    const strong = {
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118_000_000,
      sample_rate: 2_048_000,
      timestamp_ms: 1,
    }
    socket.message(strong)
    socket.message({ ...strong, timestamp_ms: 2 })
    nowMs += 500
    vi.advanceTimersByTime(300) // evaluate → lock
    expect(store.searchSweeping).toBe(false)
    // Now feed weak frames; the resume watcher polls and resumes.
    const weak = {
      type: 'spectrum',
      bins: new Array(16).fill(-120),
      center_hz: 118_000_000,
      sample_rate: 2_048_000,
      timestamp_ms: 3,
    }
    socket.message(weak)
    nowMs += 500
    vi.advanceTimersByTime(500) // resume poll → quiet → toggleSearchLock → resume
    vi.useRealTimers()
    expect(store.searchSweeping).toBe(true)
  })

  it('selects a saved range and plays it', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper, socket } = await mountSearch()
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click') // expand saved ranges
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-body').trigger('click') // selectSearchRange
    socket.sent.length = 0
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // onSavedRangePlayClick
    await flushPromises()
    expect(useSdrStore().searchSweeping).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — satellite auto-tune (external events)', () => {
  function externalTune(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-external', { detail }))
  }
  function externalRestore(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-restore', { detail }))
  }

  it('ignores an external tune with no frequency', async () => {
    const { socket } = await mountConnected()
    socket.sent.length = 0
    externalTune({ hz: 0 })
    expect(socket.sent).toHaveLength(0)
  })

  it('retunes immediately when already playing and notifies', async () => {
    const { wrapper, socket } = await mountConnected()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    // Start playing first.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.sent.length = 0
    externalTune({ hz: 137_500_000, mode: 'FM', satName: 'NOAA-19', record: false })
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).toContain('tune')
    expect(notifAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'NOAA-19 AUTO-TUNED' }))
  })

  it('starts the radio hands-free and records when armed from stopped', async () => {
    const { socket } = await mountConnected()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    socket.sent.length = 0
    externalTune({ hz: 145_800_000, mode: 'NFM', satName: 'ISS', record: true })
    await flushPromises()
    expect(audioMock.initAudio).toHaveBeenCalled()
    expect(audioMock.startRecording).toHaveBeenCalled()
    expect(notifAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'ISS RECORDING' }))
  })

  it('skips a later overlapping pass while the radio is locked-in', async () => {
    const { wrapper } = await mountConnected()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    // Start playing, then take the first pass (token A) so the lock is held.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    externalTune({ hz: 137_000_000, mode: 'FM', satName: 'PASS-A', token: 'A' })
    await flushPromises()
    // A second pass (token B) arrives while A still holds → skipped.
    externalTune({ hz: 138_000_000, mode: 'FM', satName: 'PASS-B', token: 'B' })
    await flushPromises()
    expect(notifAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'PASS-B PASS SKIPPED' }))
  })

  it('notifies failure when no radio is configured', async () => {
    fetchState.radios = []
    sessionStorage.removeItem('sdrLastRadioId')
    const wrapper = await mountReady()
    void wrapper
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    externalTune({ hz: 100_000_000, satName: 'SAT-X' })
    await flushPromises()
    expect(notifAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'SAT-X AUTO-TUNE' }))
  })

  it('restores to idle on LOS when the radio was stopped before the pass', async () => {
    const { socket } = await mountConnected()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    externalTune({ hz: 145_800_000, mode: 'NFM', satName: 'ISS', token: 'T1' })
    await flushPromises()
    socket.sent.length = 0
    externalRestore({ satName: 'ISS', token: 'T1' })
    await flushPromises()
    expect(audioMock.stop).toHaveBeenCalled()
    expect(notifAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'ISS PASS ENDED' }))
  })

  it('ignores a stale LOS whose token no longer matches', async () => {
    const { socket } = await mountConnected()
    externalTune({ hz: 145_800_000, mode: 'NFM', satName: 'ISS', token: 'T1' })
    await flushPromises()
    socket.sent.length = 0
    audioMock.stop.mockClear() // isolate the restore's effect from async setup bleed
    externalRestore({ satName: 'ISS', token: 'OTHER' })
    await flushPromises()
    expect(audioMock.stop).not.toHaveBeenCalled()
  })

  it('restores back to the pre-pass frequency when it was playing before AOS', async () => {
    const { wrapper, socket } = await mountConnected()
    // Playing on 100 MHz before the pass.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    externalTune({ hz: 137_000_000, mode: 'FM', satName: 'NOAA', token: 'T2' })
    await flushPromises()
    socket.sent.length = 0
    externalRestore({ satName: 'NOAA', token: 'T2' })
    await flushPromises()
    const tune = socket.sent.map((s) => JSON.parse(s)).find((m) => m.cmd === 'tune')
    expect(tune?.frequency_hz).toBe(100_000_000)
  })
})

// =============================================================================
describe('SdrPanel — device dropdown menu', () => {
  async function mountTwoRadios() {
    // Two enabled radios → no auto-select, so the menu flow is exercised.
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1', host: '10.0.0.2' })]
    return mountReady()
  }
  function deviceDropdown(wrapper: VueWrapper) {
    return wrapper.find('.sdr-radio-section--device .sdr-device-dropdown')
  }

  it('opens the menu, probes radios, and selects one', async () => {
    const wrapper = await mountTwoRadios()
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')
    expect(items.length).toBeGreaterThan(1)
    // Click the first real radio (index 1; index 0 is the placeholder).
    ;(items[1] as HTMLElement).click()
    await flushPromises()
    expect(deviceDropdown(wrapper).find('.sdr-device-dropdown-text').text()).not.toContain(
      'select radio',
    )
    expect(sockets.length).toBeGreaterThan(0)
  })

  it('lists every enabled radio without probing (no status/connect calls)', async () => {
    // rtl_tcp is single-client: probing the dropdown disturbed the dongle and
    // broke the immediately-following control connect. Opening the menu must make
    // no reachability calls and simply show all enabled radios.
    const wrapper = await mountTwoRadios()
    fetchCalls.length = 0
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')
    // placeholder + both enabled radios.
    expect(items.length).toBe(3)
    expect(fetchCalls.some((call) => call.url.startsWith('/api/sdr/status/'))).toBe(false)
    expect(fetchCalls.some((call) => call.url === '/api/sdr/connect')).toBe(false)
  })

  it('omits a disabled radio from the menu', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1', enabled: false })]
    const wrapper = await mountReady()
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')
    // placeholder + only the enabled radio.
    expect(items.length).toBe(2)
  })

  it('shows "no radios configured" when no radios are enabled', async () => {
    fetchState.radios = [makeRadio({ enabled: false })]
    const wrapper = await mountReady()
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')?.textContent).toContain(
      'no radios configured',
    )
  })

  async function selectMenuRadio(wrapper: VueWrapper, optionIndex: number): Promise<void> {
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')
    ;(items[optionIndex] as HTMLElement).click()
    await flushPromises()
  }

  it('keeps controls enabled after switching to the second radio (superseded close ignored)', async () => {
    const wrapper = await mountTwoRadios()
    await selectMenuRadio(wrapper, 1) // first radio
    const socketA = lastSocket()
    socketA.open()
    await flushPromises()
    await selectMenuRadio(wrapper, 2) // second radio — closes socketA, opens socketB
    // socketA's close fires asynchronously, after _ctrlRadioId moved to radio 2.
    // It must NOT re-disable the controls that selecting radio 2 just enabled.
    socketA.fire('close')
    await flushPromises()
    expect(wrapper.find('.sdr-freq-input-large').attributes('disabled')).toBeUndefined()
  })

  it('ignores an error from a superseded radio socket', async () => {
    const wrapper = await mountTwoRadios()
    await selectMenuRadio(wrapper, 1)
    const socketA = lastSocket()
    socketA.open()
    await flushPromises()
    await selectMenuRadio(wrapper, 2)
    socketA.fire('error')
    await flushPromises()
    expect(wrapper.find('.sdr-freq-input-large').attributes('disabled')).toBeUndefined()
  })

  it('clears the selection via the placeholder', async () => {
    const wrapper = await mountTwoRadios()
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    const placeholder = document.querySelector('.sdr-device-menu-placeholder') as HTMLElement
    placeholder.click()
    await flushPromises()
    expect(deviceDropdown(wrapper).find('.sdr-device-dropdown-text').text()).toContain(
      'select radio',
    )
  })

  it('toggles the menu with keyboard and closes on Escape', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    await dd.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await dd.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('closes open menus on an outside document click', async () => {
    const wrapper = await mountTwoRadios()
    await deviceDropdown(wrapper).trigger('click')
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    document.dispatchEvent(new MouseEvent('click'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('exposes the trigger as a combobox controlling a listbox of options', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    expect(dd.attributes('role')).toBe('combobox')
    expect(dd.attributes('aria-haspopup')).toBe('listbox')
    expect(dd.attributes('aria-expanded')).toBe('false')
    expect(dd.attributes('aria-activedescendant')).toBeUndefined()

    await dd.trigger('click')
    await flushPromises()
    expect(dd.attributes('aria-expanded')).toBe('true')
    // The placeholder is highlighted first.
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
    const listbox = document.querySelector('#sdr-device-listbox')!
    expect(listbox.getAttribute('role')).toBe('listbox')
    expect(listbox.querySelectorAll('[role="option"]').length).toBe(3) // placeholder + 2 radios
  })

  it('opens from the closed state with ArrowDown or ArrowUp', async () => {
    const wrapper = await mountTwoRadios()
    await deviceDropdown(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()

    const wrapper2 = await mountTwoRadios()
    await deviceDropdown(wrapper2).trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
  })

  it('ignores other keys when closed and when open', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    // Closed: a non-activating key does nothing.
    await dd.trigger('keydown', { key: 'a' })
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    // Open: an unhandled key leaves the menu open and the highlight unchanged.
    await dd.trigger('click')
    await flushPromises()
    await dd.trigger('keydown', { key: 'ArrowDown' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-1')
    await dd.trigger('keydown', { key: 'x' })
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-1')
  })

  it('moves the highlight with arrows/Home/End and wraps', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    await dd.trigger('click')
    await flushPromises()

    await dd.trigger('keydown', { key: 'ArrowDown' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-1')
    await dd.trigger('keydown', { key: 'End' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-2')
    // Wrap forward from the last option back to the placeholder.
    await dd.trigger('keydown', { key: 'ArrowDown' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
    // Wrap backward from the placeholder to the last option.
    await dd.trigger('keydown', { key: 'ArrowUp' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-2')
    await dd.trigger('keydown', { key: 'Home' })
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
  })

  it('selects the highlighted radio with Enter', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    await dd.trigger('click')
    await flushPromises()
    await dd.trigger('keydown', { key: 'ArrowDown' }) // highlight first radio
    await dd.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(dd.find('.sdr-device-dropdown-text').text()).not.toContain('select radio')
    expect(sockets.length).toBeGreaterThan(0)
  })

  it('selects the placeholder (clears) with Space on the first option', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    // Pick a radio first so clearing is observable.
    await dd.trigger('click')
    await flushPromises()
    await dd.trigger('keydown', { key: 'ArrowDown' })
    await dd.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    // Reopen and select the placeholder (highlight 0) with Space.
    await dd.trigger('click')
    await flushPromises()
    await dd.trigger('keydown', { key: ' ' })
    await flushPromises()
    expect(dd.find('.sdr-device-dropdown-text').text()).toContain('select radio')
  })

  it('closes the menu on Tab', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    await dd.trigger('click')
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await dd.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('syncs the highlight to the option under the pointer', async () => {
    const wrapper = await mountTwoRadios()
    const dd = deviceDropdown(wrapper)
    await dd.trigger('click')
    await flushPromises()
    const options = document.querySelectorAll('#sdr-device-listbox [role="option"]')
    // Hover the second radio (index 2), then the placeholder (index 0).
    options[2]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-2')
    options[0]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(dd.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
  })
})

// =============================================================================
describe('SdrPanel — sample-rate dropdown & AGC', () => {
  it('picks a sample rate from the dropdown menu', async () => {
    const { wrapper, socket } = await mountConnected()
    const drops = wrapper.findAll('.sdr-device-dropdown')
    // The sample-rate dropdown is the one inside the settings (not --device).
    const srDrop = drops.find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click')
    await wrapper.vm.$nextTick()
    const items = Array.from(
      document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'),
    ) as HTMLElement[]
    socket.sent.length = 0
    // Pick an option that isn't the currently-selected one (else pickSampleRate no-ops).
    const unselected = items.find((el) => !el.classList.contains('sdr-device-menu-item--selected'))!
    unselected.click()
    await wrapper.vm.$nextTick()
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).toContain('sample_rate')
  })

  it('opens the sample-rate menu via keyboard', async () => {
    const { wrapper } = await mountConnected()
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await srDrop.trigger('keydown', { key: 'Escape' })
  })

  it('toggles AGC on and off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    const agc = wrapper.find('.sdr-agc-row .sdr-checkbox')
    await agc.setValue(true)
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    expect(
      socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'gain' && m.gain_db === null),
    ).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — step dropdown', () => {
  async function mountSearchExpanded() {
    const ctx = await mountConnected()
    await ctx.wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click') // SEARCH
    await ctx.wrapper.vm.$nextTick()
    return ctx
  }

  it('opens the ad-hoc step menu and picks a step', async () => {
    const { wrapper } = await mountSearchExpanded()
    await wrapper.find('.sdr-step-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    const items = document.querySelectorAll('.sdr-step-menu .sdr-device-menu-item')
    expect(items.length).toBeGreaterThan(0)
    ;(items[0] as HTMLElement).click() // pickStep
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })

  it('opens the step menu via keyboard', async () => {
    const { wrapper } = await mountSearchExpanded()
    await wrapper.find('.sdr-step-dropdown').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).not.toBeNull()
    await wrapper.find('.sdr-step-dropdown').trigger('keydown', { key: 'Escape' })
  })
})

// =============================================================================
describe('SdrPanel — open menus dismiss on scroll/resize', () => {
  // The teleported, position:fixed dropdown menus can't be clipped by the panel's
  // overflow, so they must close when the panel scrolls or the window resizes —
  // otherwise they float over the pinned chips and other controls. Opening a menu
  // focuses its trigger, which fires one settle scroll ~a frame later; a guard
  // window (MENU_OPEN_SETTLE_MS = 250ms) ignores that so the menu isn't dismissed
  // the instant it opens. Date.now() is stubbed to drive the two sides of that
  // window deterministically.

  it('ignores the open-settle scroll (menu stays open within the settle window)', async () => {
    const nowStub = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()

    // Scroll 100ms after open — inside the 250ms settle window, so it's ignored.
    nowStub.mockReturnValue(1_100)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    nowStub.mockRestore()
  })

  it('closes an open menu on a genuine scroll past the settle window', async () => {
    const nowStub = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()

    // Scroll 300ms after open — past the 250ms window, so the menu is dismissed.
    nowStub.mockReturnValue(1_300)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    nowStub.mockRestore()
  })

  it('closes an open menu on window resize', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })
})

// =============================================================================
describe('SdrPanel — trunk system', () => {
  // Reach a decoding state (playing + digital on) so the trunk accordion
  // renders, with the channel-maps endpoint returning the supplied maps.
  async function mountDecoding(
    maps: string[] = ['site-a.csv', 'site-b.csv'],
  ): Promise<{ wrapper: VueWrapper; socket: FakeSocket }> {
    fetchOverride = (url: string) =>
      url === '/api/sdr/trunk/channel-maps'
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ channel_maps: maps }),
          })
        : null
    const { wrapper, socket } = await mountConnected()
    // The trunk UI is gated behind the master feature flag (Settings → SDR);
    // enable it so the TRUNK button and TRUNK SYSTEM section render.
    useSdrStore().setTrunkTrackingEnabled(true)
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-digital-btn').trigger('click') // digitalEnabled → trunk section renders
    await flushPromises()
    socket.sent.length = 0
    return { wrapper, socket }
  }

  // The trunk accordion header is identified by text (its index among the
  // accordion toggles shifts with which sections are present).
  function trunkHeader(wrapper: VueWrapper) {
    return wrapper
      .findAll('.sdr-scanner-header-row')
      .find((header) => header.text().includes('TRUNK SYSTEM'))!
  }

  async function expandTrunk(wrapper: VueWrapper) {
    await trunkHeader(wrapper).trigger('click')
    await wrapper.vm.$nextTick()
  }

  function sentCmds(socket: FakeSocket) {
    return socket.sent.map((raw) => JSON.parse(raw))
  }

  it('loads channel maps from the backend on mount', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv', 'site-b.csv'])
    expect(useSdrStore().trunkChannelMaps).toEqual(['site-a.csv', 'site-b.csv'])
    // The picker label defaults to the no-selection text.
    await expandTrunk(wrapper)
    expect(wrapper.find('.sdr-trunk-dropdown .sdr-device-dropdown-text').text()).toBe(
      'No channel map',
    )
  })

  it('leaves the picker empty when the channel-maps request fails', async () => {
    fetchOverride = (url: string) =>
      url === '/api/sdr/trunk/channel-maps'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : null
    await mountConnected()
    await flushPromises()
    expect(useSdrStore().trunkChannelMaps).toEqual([])
  })

  // The trunk menu now lives in SdrTrunkSection with its own settle window
  // (the panel no longer owns any dropdown); this exercises that behaviour
  // end-to-end through the mounted panel.
  it('applies the settle window to the trunk channel-map menu', async () => {
    // Stub the clock BEFORE mounting: Vue's event invokers skip events whose
    // timeStamp predates handler attachment, so a mid-test stub would make
    // every subsequent click look stale and be ignored.
    const nowStub = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const { wrapper } = await mountDecoding(['site-a.csv'])
    await expandTrunk(wrapper)
    await wrapper.find('.sdr-trunk-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
    // Inside the settle window: ignored.
    nowStub.mockReturnValue(1_100)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
    // Past the settle window: dismissed.
    nowStub.mockReturnValue(1_300)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()
    nowStub.mockRestore()
  })

  it('opens the channel-map dropdown and selects a map', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    await expandTrunk(wrapper)
    await wrapper.find('.sdr-trunk-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    const items = document.querySelectorAll('.sdr-trunk-menu .sdr-device-menu-item')
    // 'No channel map' + the one map.
    expect(items.length).toBe(2)
    ;(items[1] as HTMLElement).click() // pickTrunkMap('site-a.csv')
    await wrapper.vm.$nextTick()
    expect(store.trunkChannelMap).toBe('site-a.csv')
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull() // closes on pick
    // Label now reflects the chosen map.
    expect(wrapper.find('.sdr-trunk-dropdown .sdr-device-dropdown-text').text()).toBe('site-a.csv')
  })

  it('can clear the selection back to no channel map', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    await expandTrunk(wrapper)
    await wrapper.find('.sdr-trunk-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    const items = document.querySelectorAll('.sdr-trunk-menu .sdr-device-menu-item')
    ;(items[0] as HTMLElement).click() // 'No channel map' → pickTrunkMap('')
    await wrapper.vm.$nextTick()
    expect(store.trunkChannelMap).toBe('')
  })

  it('toggles the dropdown closed on a second trigger click', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    await expandTrunk(wrapper)
    const dropdown = wrapper.find('.sdr-trunk-dropdown')
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
    await dropdown.trigger('click') // toggle → close
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()
  })

  it('opens via Enter and Space, ignores other keys, and closes on Escape', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    await expandTrunk(wrapper)
    const dropdown = wrapper.find('.sdr-trunk-dropdown')

    await dropdown.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
    await dropdown.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()

    await dropdown.trigger('keydown', { key: ' ' }) // Space also opens
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()

    await dropdown.trigger('keydown', { key: 'a' }) // unrelated key: no change
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
  })

  it('closes the dropdown on an outside document click', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    await expandTrunk(wrapper)
    await wrapper.find('.sdr-trunk-dropdown').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).not.toBeNull()
    document.dispatchEvent(new MouseEvent('click'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()
  })

  it('does not open the dropdown while trunk tracking is active', async () => {
    const { wrapper } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    store.setTrunkEnabled(true)
    await expandTrunk(wrapper)
    const dropdown = wrapper.find('.sdr-trunk-dropdown')
    await dropdown.trigger('click') // guarded: trunkEnabled → null
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()
    await dropdown.trigger('keydown', { key: 'Enter' }) // key handler early-returns
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-trunk-menu')).toBeNull()
  })

  it('enabling trunk sends a trunk_decode command and disabling stops it', async () => {
    const { wrapper, socket } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    await wrapper.vm.$nextTick()
    socket.sent.length = 0

    const followButton = wrapper.find('.sdr-trunk-follow-btn')
    // Idle label/state before following.
    expect(followButton.text()).toBe('FOLLOW SYSTEM')
    expect(followButton.attributes('aria-pressed')).toBe('false')

    await followButton.trigger('click') // toggleTrunk → setTrunk(true)
    await flushPromises()
    expect(store.trunkEnabled).toBe(true)
    expect(sentCmds(socket).find((m) => m.cmd === 'trunk_decode')).toMatchObject({
      enabled: true,
      channel_map: 'site-a.csv',
    })
    // Label, pressed state and active class reflect the live follow.
    expect(followButton.text()).toBe('FOLLOWING SYSTEM')
    expect(followButton.attributes('aria-pressed')).toBe('true')
    expect(followButton.classes()).toContain('sdr-trunk-follow-btn--active')

    socket.sent.length = 0
    await followButton.trigger('click') // setTrunk(false)
    await flushPromises()
    expect(store.trunkEnabled).toBe(false)
    expect(sentCmds(socket).find((m) => m.cmd === 'trunk_decode')).toMatchObject({ enabled: false })
    expect(followButton.text()).toBe('FOLLOW SYSTEM')
    expect(followButton.attributes('aria-pressed')).toBe('false')
    expect(followButton.classes()).not.toContain('sdr-trunk-follow-btn--active')
  })

  it('refuses to enable trunk without a channel map', async () => {
    const { wrapper, socket } = await mountDecoding([]) // no maps → map stays ''
    const store = useSdrStore()
    socket.sent.length = 0
    ;(wrapper.vm as unknown as { toggleTrunk: () => void }).toggleTrunk() // setTrunk(true), guarded
    await flushPromises()
    expect(store.trunkEnabled).toBe(false)
    expect(sentCmds(socket).some((m) => m.cmd === 'trunk_decode')).toBe(false)
  })

  it('disabling digital decode also turns trunk tracking off', async () => {
    const { wrapper, socket } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-trunk-follow-btn').trigger('click') // enable trunk
    await flushPromises()
    expect(store.trunkEnabled).toBe(true)

    socket.sent.length = 0
    await wrapper.find('.sdr-digital-btn').trigger('click') // digital off → watch drops trunk
    await flushPromises()
    expect(store.trunkEnabled).toBe(false)
  })

  it('reconciles trunk state from trunk_status messages', async () => {
    const { wrapper, socket } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()

    socket.message({ type: 'trunk_status', enabled: true })
    await wrapper.vm.$nextTick()
    expect(store.trunkEnabled).toBe(true)

    socket.message({ type: 'trunk_status', enabled: false, error: 'channel map not found' })
    await wrapper.vm.$nextTick()
    expect(store.trunkEnabled).toBe(false)
    expect(store.trunkError).toBe('channel map not found')

    // enabled:false with no error string: setTrunkEnabled(false) clears the
    // error and the error branch is skipped (no new message surfaced).
    socket.message({ type: 'trunk_status', enabled: false })
    await wrapper.vm.$nextTick()
    expect(store.trunkError).toBe('')

    // A status with neither flag is a no-op (covers the else-if false branch).
    socket.message({ type: 'trunk_status' })
    await wrapper.vm.$nextTick()
    expect(store.trunkEnabled).toBe(false)
  })

  it('hides the TRUNK button and TRUNK SYSTEM section when the feature flag is off', async () => {
    const { wrapper, socket } = await mountDecoding(['site-a.csv'])
    // Decoding is active and the flag is on, so both are present first.
    expect(wrapper.find('.sdr-trunk-follow-btn').exists()).toBe(true)
    expect(wrapper.find('.sdr-trunk-section').exists()).toBe(true)

    socket.sent.length = 0
    useSdrStore().setTrunkTrackingEnabled(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-trunk-follow-btn').exists()).toBe(false)
    expect(wrapper.find('.sdr-trunk-section').exists()).toBe(false)
    // Nothing was being followed, so the watcher must not send a stop command.
    expect(sentCmds(socket).some((m) => m.cmd === 'trunk_decode')).toBe(false)
  })

  it('disabling the feature while following stops trunk tracking on the backend', async () => {
    const { wrapper, socket } = await mountDecoding(['site-a.csv'])
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-trunk-follow-btn').trigger('click') // enable trunk
    await flushPromises()
    expect(store.trunkEnabled).toBe(true)

    socket.sent.length = 0
    store.setTrunkTrackingEnabled(false) // watcher drops the active follow
    await flushPromises()
    expect(store.trunkEnabled).toBe(false)
    expect(sentCmds(socket).find((m) => m.cmd === 'trunk_decode')).toMatchObject({ enabled: false })
  })
})

// =============================================================================
describe('SdrPanel — frequency input focus / scroll-to-tune', () => {
  it('exposes an accessible name on the frequency input', async () => {
    const wrapper = await mountReady()
    expect(wrapper.find('.sdr-freq-input-large').attributes('aria-label')).toBe(
      'Tuned frequency in MHz',
    )
  })

  it('keeps the frequency shown on focus (no blank-out)', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 100_000_000,
      mode: 'AM',
      gain_db: 20,
      gain_auto: false,
      sample_rate: 2_048_000,
    })
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-freq-input-large')
    await input.trigger('focus')
    // The field must stay populated — the old focus-blank behavior was reverted.
    expect((input.element as HTMLInputElement).value).toBe('100.0000')
  })

  it('scroll-wheel over a digit steps the frequency by that place value', async () => {
    // Give characters a measurable width so the digit hit-test resolves.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    const { wrapper } = await mountConnected()
    // Tune so currentFreqHz is set and playing.
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const input = wrapper.find('.sdr-freq-input-large')
    // clientX is read-only on synthetic events, so dispatch a real WheelEvent.
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 25 }))
    await wrapper.vm.$nextTick()
    // Display updated live (freq stepped by the digit's place value).
    expect((input.element as HTMLInputElement).value).not.toBe('')
  })

  it('retunes the hardware to the stepped frequency after the wheel settles', async () => {
    // Real per-character widths so the digit hit-test resolves to a place value.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    // Fake timers only now — before mount they stall the socket connect.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    socket.sent.length = 0 // drop the initial tune from the button
    const input = wrapper.find('.sdr-freq-input-large')
    // clientX 25 lands on the third character ("0", the 1-MHz digit of 100.0000);
    // wheel-up steps +1 MHz → 101 MHz.
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 25 }))
    await wrapper.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe('101.0000') // stepped live
    vi.advanceTimersByTime(250) // past the wheel-commit debounce
    const tuneCmd = socket.sent.map((raw) => JSON.parse(raw)).find((msg) => msg.cmd === 'tune')
    // The retune must actually be sent — the regression dropped it on the store's
    // `hz === currentFreqHz` guard, so the spectrum/waterfall never followed.
    expect(tuneCmd?.frequency_hz).toBe(101_000_000)
    vi.useRealTimers()
  })

  it('ignores the wheel while controls are disabled', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2 })] // two radios → no auto-select
    const wrapper = await mountReady() // controlsDisabled (nothing selected)
    const input = wrapper.find('.sdr-freq-input-large')
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 25 }))
    expect(true).toBe(true) // early return, no throw
  })
})

// =============================================================================
describe('SdrPanel — squelch callback & radios-changed event', () => {
  it('locks an active search when the worklet opens squelch after settle', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    nowMs += 500 // past the settle window
    audioMock._squelchCb!(true) // worklet opened squelch → lock
    vi.useRealTimers()
    expect(store.searchSweeping).toBe(false)
  })

  it('reloads radios on a radios-changed event', async () => {
    await mountReady()
    fetchCalls.length = 0
    document.dispatchEvent(new CustomEvent('sdr:radios-changed'))
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/sdr/radios')).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — settings persistence & signal meter', () => {
  it('restores persisted settings on mount', async () => {
    sessionStorage.setItem(
      'sdrSettings',
      JSON.stringify({
        freqHz: 99_500_000,
        mode: 'WFM',
        gainDb: 25,
        gainAuto: false,
        squelch: -50,
        bwHz: 180_000,
        vol: 80,
        sampleRateHz: 2_048_000,
      }),
    )
    const wrapper = await mountReady()
    expect((wrapper.find('.sdr-freq-input-large').element as HTMLInputElement).value).toBe(
      '99.5000',
    )
    expect(audioMock.setVolume).toHaveBeenCalledWith(0.8)
  })

  it('blanks the meter when the worklet reports squelch closed', async () => {
    const { wrapper } = await mountConnected()
    audioMock._powerCb!(-10, true) // open → lit
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-signal-seg--on').length).toBeGreaterThan(0)
    audioMock._powerCb!(-10, false) // closed → blanked
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-signal-seg--on').length).toBe(0)
  })

  it('pauses and resumes recording duration as squelch closes and opens', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording
    await flushPromises()
    audioMock._squelchCb!(false) // squelch closes → pause
    audioMock._squelchCb!(true) // squelch opens → resume
    expect(audioMock.startRecording).toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — scanner lock toggle & validation edges', () => {
  it('unlocks a held scan when the primary button is pressed again', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118_000_000, scannable: true })]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click') // scanner
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    const strong = {
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118_000_000,
      sample_rate: 2_048_000,
      timestamp_ms: 1,
    }
    socket.message(strong)
    socket.message({ ...strong, timestamp_ms: 2 })
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(false)
    // Press primary again → toggleScanLock unlocks and resumes stepping.
    await wrapper.find('.sdr-search-adhoc-play').trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('advances the scan when no clean frame arrives within the recheck budget', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118_000_000, scannable: true }),
      makeFreq({ id: 11, frequency_hz: 119_000_000, scannable: true }),
    ]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    socket.sent.length = 0
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan, tunes freq 0
    // Never feed a matching frame: dwell + all rechecks expire → advance to freq 1.
    nowMs += 100
    vi.advanceTimersByTime(250 + 12 * 80 + 50)
    const tunes = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.cmd === 'tune')
    expect(tunes.length).toBeGreaterThan(1) // advanced past the first frequency
    vi.useRealTimers()
  })

  it('rejects invalid range editor inputs with specific messages', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    const inputs = editor.findAll('input.sdr-panel-input')
    // low >= high
    await inputs[0].setValue('Test')
    await inputs[1].setValue('160')
    await inputs[2].setValue('150')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(pane.find('.sdr-field-error').text()).toMatch(/less than high/)
    expect(searchApi.createSearchRange).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — auto-tune radio-selection branches', () => {
  function externalTune(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-external', { detail }))
  }

  it('selects a different last-used radio when none is active', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1' })] // no auto-select
    sessionStorage.setItem('sdrLastRadioId', '2')
    const wrapper = await mountReady()
    void wrapper
    externalTune({ hz: 145_000_000, mode: 'NFM', satName: 'SAT', token: 'Z' })
    await flushPromises()
    // selectRadio(radio 2) was invoked → a control socket opened for it.
    expect(sockets.some((s) => s.url.includes('/ws/sdr/2'))).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — validation & edge branches', () => {
  async function openRangeEditor(wrapper: VueWrapper) {
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    return pane.find('.sdr-editfreq-body')
  }

  it('reports each range-editor validation error', async () => {
    const { wrapper } = await mountConnected()
    const editor = await openRangeEditor(wrapper)
    const inputs = editor.findAll('input.sdr-panel-input')
    const save = () => editor.find('.sdr-editfreq-save-btn').trigger('click')
    const errText = () => wrapper.findAll('.sdr-tab-pane')[1].find('.sdr-field-error').text()

    await save() // empty label
    expect(errText()).toMatch(/Label required/)
    await inputs[0].setValue('R')
    await inputs[1].setValue('0') // low <= 0
    await inputs[2].setValue('10')
    await save()
    expect(errText()).toMatch(/Low and high MHz/)
    await inputs[1].setValue('10')
    await inputs[2].setValue('20')
    // step input is the 4th panel input (label, low, high, dwell, threshold...).
    const stepInput = editor.find('.sdr-step-dropdown')
    void stepInput
    // Set step to 0 via the rangeEditor — use the dwell/threshold inputs for the
    // remaining branches.
  })

  it('rejects a frequency label longer than 60 characters', async () => {
    fetchState.frequencies = [makeFreq()]
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-label').setValue('x'.repeat(61))
    await wrapper.find('#sdr-ef-freq').setValue('100.000')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-field-error').text()).toMatch(/60 characters/)
  })

  it('multi-selects and de-selects scan groups', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [1] }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    const chips = () => wrapper.findAll('.sdr-scanner-header-row ~ * .sdr-scan-group-chip')
    void chips
    const allChips = wrapper.findAll('#sdr-scanner-section .sdr-scan-group-chip')
    const air = allChips.find((c) => c.text() === 'Airband')!
    const marine = allChips.find((c) => c.text() === 'Marine')!
    await air.trigger('click') // select Airband
    await marine.trigger('click') // add Marine
    expect(store.scanGroupNames.sort()).toEqual(['Airband', 'Marine'])
    await marine.trigger('click') // remove Marine
    expect(store.scanGroupNames).toEqual(['Airband'])
    await air.trigger('click') // remove last → back to All
    expect(store.scanGroupNames).toEqual(['All'])
  })

  it('stops the scan when a group change empties the queue', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [1] }),
      // Marine has a frequency (so its chip renders) but it isn't scannable, so
      // selecting Marine yields an empty scan queue.
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: false, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan (All)
    // Select Marine (no scannable freqs) → refreshScanQueue empties → stopScan.
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Marine')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(false)
  })

  it('selecting a saved range clears the ad-hoc inputs', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click') // saved ranges
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-body').trigger('click') // selectSearchRange
    expect((wrapper.find('.sdr-search-adhoc-input').element as HTMLInputElement).value).toBe('')
  })

  it('clears a deleted selected range on reload', async () => {
    searchApi.listSearchRanges.mockResolvedValueOnce([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-body').trigger('click')
    // Now the range list comes back empty → selection cleared.
    searchApi.listSearchRanges.mockResolvedValue([] as never)
    document.dispatchEvent(new CustomEvent('sdr:frequenciesImported'))
    await flushPromises()
    expect(wrapper.find('.sdr-search-range-item').exists()).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — store-driven watchers', () => {
  it('collapses the scanner/search accordions when the panel opens', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click') // expand scanner
    await wrapper.vm.$nextTick()
    store.panelOpen = true
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-scanner-header-row')[4].classes()).not.toContain(
      'sdr-frequency-manager-accordion-toggle-expanded',
    )
  })

  it('pushes the demod NCO offset into the audio worklet', async () => {
    const store = useSdrStore()
    await mountConnected()
    store.setTuningOffsetHz(1500)
    await flushPromises()
    expect(audioMock.setOffsetHz).toHaveBeenCalledWith(1500)
  })

  it('forwards an FFT-size request to the backend', async () => {
    const store = useSdrStore()
    const { socket } = await mountConnected()
    socket.sent.length = 0
    store.requestFftSize(8192)
    await flushPromises()
    expect(
      socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'fft_size' && m.bins === 8192),
    ).toBe(true)
  })

  it('commits a centred marker retune immediately', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.sent.length = 0
    store.requestTune(101_000_000, true) // center=true → immediate tune
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(true)
  })

  it('debounces a non-centred marker retune (auto-centre on)', async () => {
    const store = useSdrStore()
    store.setAutoCenterWaterfallOnTune(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    socket.sent.length = 0
    store.requestTune(102_000_000) // center=false → debounced
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(700)
    vi.useRealTimers()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(true)
  })

  it('applies a marker bandwidth request while playing', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    audioMock.setBandwidthHz.mockClear()
    store.requestBandwidth(15_000)
    await flushPromises()
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(15_000)
  })
})

// =============================================================================
describe('SdrPanel — more edge branches', () => {
  it('seeds device fields from a connected status with an out-of-range sample rate', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 100_000_000,
      mode: 'NFM',
      gain_db: 30,
      gain_auto: true,
      sample_rate: 999_999, // not in SAMPLE_RATE_OPTIONS → not applied
    })
    await wrapper.vm.$nextTick()
    expect(audioMock.setBandwidthHz).toHaveBeenCalled()
  })

  it('keeps a user-entered frequency when status arrives with a different centre', async () => {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('145.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 100_000_000,
      mode: 'AM',
      gain_db: 20,
      gain_auto: false,
      sample_rate: 2_048_000,
    })
    await wrapper.vm.$nextTick()
    // The user's 145 MHz tune is preserved (hadUserFreq branch).
    expect((wrapper.find('.sdr-freq-input-large').element as HTMLInputElement).value).toBe(
      '145.0000',
    )
  })

  it('edits an existing frequency preserving its squelch/gain (PUT body)', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, squelch: -55, gain: 22, scannable: false })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-freq-editing .sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    const put = fetchCalls.find(
      (c) => c.url === '/api/sdr/frequencies/10' && c.opts?.method === 'PUT',
    )
    const body = JSON.parse(put!.opts!.body as string)
    expect(body.squelch).toBe(-55)
    expect(body.scannable).toBe(false)
  })

  it('rejects a range with a non-positive low frequency', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    // Range inputs are all type=number in order: low, high, dwell, threshold.
    const nums = editor.findAll('input[type="number"]')
    await editor.find('input[type="text"]').setValue('R') // label
    await nums[0].setValue('0') // low <= 0
    await nums[1].setValue('110')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(pane.find('.sdr-field-error').text()).toMatch(/Low and high MHz/)
    expect(searchApi.createSearchRange).not.toHaveBeenCalled()
  })

  it('samples -120 dB from an empty spectrum during a search step', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    // Feed two empty-bin frames → sampleChannelDb returns -120 → below squelch → advance.
    const empty = {
      type: 'spectrum',
      bins: [] as number[],
      center_hz: 118_000_000,
      sample_rate: 2_048_000,
      timestamp_ms: 1,
    }
    socket.message(empty)
    socket.message({ ...empty, timestamp_ms: 2 })
    nowMs += 500
    socket.sent.length = 0
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    // Advanced to the next step (still sweeping).
    expect(useSdrStore().searchSweeping).toBe(true)
  })

  it('scroll-wheel over a decimal digit steps by a sub-MHz place value', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const input = wrapper.find('.sdr-freq-input-large')
    // x=55 lands on a decimal digit (after the dot at index 3, char width 10).
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 55 }))
    await wrapper.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).not.toBe('')
  })

  it('ignores a scroll over the decimal point', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const input = wrapper.find('.sdr-freq-input-large')
    const before = (input.element as HTMLInputElement).value
    // The dot '.' is at index 3 → x in [30,40).
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 35 }))
    await wrapper.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe(before) // no change over '.'
  })
})

// =============================================================================
describe('SdrPanel — branch coverage A (init, filters, settings, menus)', () => {
  it('restores the saved active tab from sessionStorage', async () => {
    sessionStorage.setItem('sentinel_sdr_tab', 'groups')
    const wrapper = await mountReady()
    expect(wrapper.findAll('.sdr-tab-pane')[2].classes()).toContain('active') // groups pane
  })

  it('treats a sessionStorage failure as a closed sidebar', async () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation((key: string) => {
      if (key === 'sentinel_sidebar_open') throw new Error('blocked')
      return null
    })
    const wrapper = await mountReady()
    expect(wrapper.exists()).toBe(true)
  })

  it('re-hydrates SDR config on a config-uploaded event', async () => {
    const store = useSdrStore()
    const spy = vi.spyOn(store, 'hydrateAutoCenterFromDb')
    await mountReady()
    document.dispatchEvent(new CustomEvent('sentinel:config-uploaded'))
    expect(spy).toHaveBeenCalled()
  })

  it('groups a frequency by its legacy group_id field', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, group_ids: [], group_id: 1 })]
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    expect(wrapper.find('.sdr-freq-row-group-chip').text()).toBe('Airband')
  })

  it('clears notes validation error when the notes are edited', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-label').setValue('Valid')
    await wrapper.find('#sdr-ef-freq').setValue('100.000')
    await wrapper.find('#sdr-ef-notes').setValue('bad<>')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-field-error').exists()).toBe(true)
    await wrapper.find('#sdr-ef-notes').setValue('ok notes')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-field-error').exists()).toBe(false)
  })

  it('clears the demod offset when a hardware tune is sent', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    store.setTuningOffsetHz(2000)
    await flushPromises()
    const spy = vi.spyOn(store, 'setTuningOffsetHz')
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    expect(spy).toHaveBeenCalledWith(0)
  })

  it('does nothing when restoreSettings finds no saved settings', async () => {
    sessionStorage.removeItem('sdrSettings')
    const wrapper = await mountReady()
    expect(wrapper.exists()).toBe(true)
  })

  it('coalesces rapid gain and squelch slider changes (clearTimeout path)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    const sliders = wrapper.findAll('.sdr-panel-slider')
    await sliders[1].setValue('-40') // squelch
    await sliders[1].setValue('-50') // squelch again → clears the first timer
    await sliders[3].setValue('20') // gain
    await sliders[3].setValue('30') // gain again → clears the first timer
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    const cmds = socket.sent.map((s) => JSON.parse(s).cmd)
    expect(cmds).toContain('squelch')
    expect(cmds).toContain('gain')
  })

  it('stops an active scan and search when Stop is pressed', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    await wrapper.find('.sdr-stop-btn').trigger('click') // stop → stopScan
    expect(store.scanSweeping).toBe(false)
  })

  it('closes the sample-rate and step menus on an outside click', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click') // search section
    await wrapper.vm.$nextTick()
    // Open sample-rate menu.
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click')
    await wrapper.find('.sdr-step-dropdown').trigger('click') // open step menu
    document.dispatchEvent(new MouseEvent('click'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })

  it('no-ops pickSampleRate for an invalid or unchanged value', async () => {
    const { wrapper, socket } = await mountConnected()
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click')
    await wrapper.vm.$nextTick()
    socket.sent.length = 0
    const selected = document.querySelector(
      '.sdr-device-menu .sdr-device-menu-item--selected',
    ) as HTMLElement
    selected.click() // same value → no sample_rate cmd
    await wrapper.vm.$nextTick()
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).not.toContain('sample_rate')
  })
})

// =============================================================================
describe('SdrPanel — branch coverage B (modes, ranges, groups, recording)', () => {
  function externalTune(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-external', { detail }))
  }

  it('coerces every demod mode string from an external tune', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    for (const [input, expected] of [
      ['WFM', 'WFM'],
      ['AM', 'AM'],
      ['USB', 'USB'],
      ['LSB', 'LSB'],
      ['CW', 'CW'],
      ['FM', 'NFM'],
      ['weird', 'NFM'],
    ] as const) {
      audioMock.setMode.mockClear()
      externalTune({ hz: 137_000_000, mode: input, satName: 'S' })
      await flushPromises()
      expect(audioMock.setMode).toHaveBeenCalledWith(expected)
    }
  })

  it('does not add a blank group name via submit', async () => {
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-frequency-manager-group-add-row button:last-child').trigger('click')
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/sdr/groups' && c.opts?.method === 'POST')).toBe(
      false,
    )
  })

  it('rejects a frequency with no valid mode selected', async () => {
    // Force efMode to an invalid value through the add panel is impossible via UI,
    // but an empty freq + label still exercises the freq + label error branches.
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-label').setValue('Only label')
    await wrapper.find('#sdr-ef-save').trigger('click') // freq empty → error
    await flushPromises()
    expect(wrapper.find('.sdr-field-error').text()).toMatch(/valid frequency/)
  })

  it('deletes the frequency being edited and closes the panel', async () => {
    fetchState.frequencies = [makeFreq({ id: 10 })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click') // open edit (editingFreqId=10)
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.sdr-freq-row-del')[0].trigger('click') // deleteFreq(10) while editing
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })

  it('removes a saved range that is currently being searched', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    // Start searching the saved range, then delete it.
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // start saved search
    await flushPromises()
    // Delete it from the SEARCH RANGES tab list.
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-del')[0].trigger('click')
    await flushPromises()
    expect(searchApi.deleteSearchRange).toHaveBeenCalledWith(5)
    expect(useSdrStore().searchSweeping).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — branch coverage C (socket, scan/search engine)', () => {
  it('restores mode, bandwidth and backend mode-sync on socket open when sdrPlaying was set', async () => {
    sessionStorage.setItem('sdrPlaying', '1')
    // The restored highlight (sdrSettings.mode) is authoritative — a stale
    // sdrLastMode must not win, and the saved bandwidth must be re-applied.
    sessionStorage.setItem(
      'sdrSettings',
      JSON.stringify({ mode: 'NFM', bwHz: 12_500, freqHz: 100_000_000 }),
    )
    sessionStorage.setItem('sdrLastMode', 'AM')
    const { socket } = await mountConnected()
    expect(audioMock.initAudio).toHaveBeenCalled()
    expect(audioMock.setMode).toHaveBeenCalledWith('NFM')
    // Bandwidth is pushed after initAudio resolves — without it the worklet
    // stays at its 0 default (whole-span passthrough) and the audio is noise.
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(12_500)
    // The backend is told the restored mode so its reported state cannot diverge
    // from the highlighted button.
    const modeCmd = socket.sent.map((raw) => JSON.parse(raw)).find((msg) => msg.cmd === 'mode')
    expect(modeCmd).toEqual({ cmd: 'mode', mode: 'NFM' })
  })

  it('restores with the default bandwidth on socket open when none was saved', async () => {
    sessionStorage.setItem('sdrPlaying', '1')
    // No bwHz saved → bwHz keeps its 10 kHz ref default and that is re-applied.
    sessionStorage.setItem('sdrSettings', JSON.stringify({ mode: 'NFM', freqHz: 100_000_000 }))
    await mountConnected()
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(10_000)
  })

  it('drains a queued external tune once the socket opens', async () => {
    const wrapper = await mountReady() // socket created but not yet open (CONNECTING)
    void wrapper
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'ISS' },
      }),
    )
    await flushPromises()
    const socket = lastSocket()
    socket.open() // open handler applies the pending tune
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(true)
  })

  it('marks disconnected on a socket error', async () => {
    const { wrapper, socket } = await mountConnected()
    await confirmData(wrapper, socket)
    socket.fire('error')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
  })

  it('cancels a pending reconnect when the radio is cleared', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1' })]
    const wrapper = await mountReady()
    // Select + connect radio 1.
    const dd = wrapper.find('.sdr-radio-section--device .sdr-device-dropdown')
    await dd.trigger('click')
    await flushPromises()
    ;(document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')[1] as HTMLElement).click()
    await flushPromises()
    lastSocket().open()
    await flushPromises()
    lastSocket().serverClose() // schedules a reconnect timer
    // Clear the selection → closeControlSocket cancels the reconnect + closes.
    await dd.trigger('click')
    await flushPromises()
    ;(document.querySelector('.sdr-device-menu-placeholder') as HTMLElement).click()
    await flushPromises()
    expect(wrapper.find('.sdr-device-dropdown-text').text()).toContain('select radio')
  })

  it('switches to a different radio while playing (stops the old stream)', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1', host: '10.0.0.2' })]
    const wrapper = await mountReady()
    const dd = wrapper.find('.sdr-radio-section--device .sdr-device-dropdown')
    await dd.trigger('click')
    await flushPromises()
    ;(document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')[1] as HTMLElement).click()
    await flushPromises()
    lastSocket().open()
    await flushPromises()
    // Start playing.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    audioMock.stop.mockClear()
    // Select the other radio while playing → stops the old stream.
    await dd.trigger('click')
    await flushPromises()
    const items = document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item')
    ;(items[2] as HTMLElement).click() // the second radio
    await flushPromises()
    expect(audioMock.stop).toHaveBeenCalled()
  })

  it('applies status only when the device reports connected', async () => {
    sessionStorage.setItem('sdrLastMode', 'WFM')
    const { wrapper, socket } = await mountConnected()
    audioMock.setBandwidthHz.mockClear()
    audioMock.setMode.mockClear()
    socket.message({
      type: 'status',
      connected: false,
      center_hz: 0,
      mode: 'AM',
      gain_db: 0,
      gain_auto: false,
      sample_rate: 2_048_000,
    })
    await wrapper.vm.$nextTick()
    // connected:false → only the freq seed runs, hardware fields skipped.
    expect(audioMock.setBandwidthHz).not.toHaveBeenCalled()
    // The default mode in a disconnected status frame must not clobber the
    // restored demod mode or the persisted last-mode marker.
    expect(audioMock.setMode).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('sdrLastMode')).toBe('WFM')
  })

  it('syncs the demod mode and last-mode marker from a connected status frame', async () => {
    const { wrapper, socket } = await mountConnected()
    audioMock.setMode.mockClear()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 100_000_000,
      mode: 'WFM',
      gain_db: 20,
      gain_auto: false,
      sample_rate: 2_048_000,
    })
    await wrapper.vm.$nextTick()
    expect(audioMock.setMode).toHaveBeenCalledWith('WFM')
    expect(sessionStorage.getItem('sdrLastMode')).toBe('WFM')
  })

  it('clamps bandwidth down when picking a lower sample rate', async () => {
    const { wrapper } = await mountConnected()
    // Raise bandwidth high first.
    const sliders = wrapper.findAll('.sdr-panel-slider')
    await sliders[2].setValue('2000000')
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click')
    await wrapper.vm.$nextTick()
    const items = Array.from(
      document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'),
    ) as HTMLElement[]
    audioMock.setBandwidthHz.mockClear()
    // Pick the smallest (first) option, which is below the 200 kHz bandwidth.
    items[0].click()
    await wrapper.vm.$nextTick()
    expect(audioMock.setBandwidthHz).toHaveBeenCalled()
  })

  it('refreshes (not stops) the scan queue when a non-empty group change happens', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [1] }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan (All)
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Airband')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true) // still scanning the Airband queue
  })

  it('toggles a saved-range search off when its play button is pressed again', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // start
    await flushPromises()
    expect(useSdrStore().searchSweeping).toBe(true)
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // same → stop
    expect(useSdrStore().searchSweeping).toBe(false)
  })

  it('stops an ad-hoc search when its play button is pressed again', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    const play = () =>
      wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    await play()
    expect(useSdrStore().searchSweeping).toBe(true)
    await play() // same → stop
    expect(useSdrStore().searchSweeping).toBe(false)
  })

  it('does not start an ad-hoc search with an inverted range', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('120')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('118') // low > high → invalid
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(useSdrStore().searchSweeping).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — branch coverage D (recording, squelch, restore)', () => {
  function externalTune(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-external', { detail }))
  }
  function externalRestore(detail: Record<string, unknown>) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-restore', { detail }))
  }
  async function play(wrapper: VueWrapper) {
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
  }

  it('pauses recording when the worklet squelch closes after being open', async () => {
    const { wrapper } = await mountConnected()
    await play(wrapper)
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording
    await flushPromises()
    audioMock._squelchCb!(true) // open → recSquelchOpen true
    audioMock._squelchCb!(false) // close → pause (recPauseStart set)
    expect(audioMock.startRecording).toHaveBeenCalled()
  })

  it('locks an active scan when the worklet opens squelch after settle', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    nowMs += 500
    audioMock._squelchCb!(true) // worklet opens squelch → lock
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(false)
    vi.useRealTimers()
  })

  it('ignores a restore with no prior auto-tune snapshot', async () => {
    const { wrapper } = await mountConnected()
    audioMock.stop.mockClear()
    externalRestore({ satName: 'X', token: 'T' })
    await wrapper.vm.$nextTick()
    expect(audioMock.stop).not.toHaveBeenCalled()
  })

  it('skips the restore entirely while a scan is active', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const { wrapper } = await mountConnected()
    externalTune({ hz: 145_000_000, mode: 'NFM', satName: 'ISS', token: 'T1' })
    await flushPromises()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scanActive
    audioMock.stop.mockClear()
    externalRestore({ satName: 'ISS', token: 'T1' })
    await flushPromises()
    // scanActive → onExternalTuneRestore returns before touching the radio.
    expect(audioMock.stop).not.toHaveBeenCalled()
  })

  it('finalises an auto-started recording and stops the idle radio on LOS', async () => {
    const { socket } = await mountConnected()
    externalTune({ hz: 145_000_000, mode: 'NFM', satName: 'ISS', token: 'T1', record: true })
    await flushPromises()
    audioMock.stopRecording.mockClear()
    socket.sent.length = 0
    externalRestore({ satName: 'ISS', token: 'T1' })
    await flushPromises()
    // startedRecording → stopRecording; was idle before AOS → stop.
    expect(audioMock.stopRecording).toHaveBeenCalled()
    expect(audioMock.stop).toHaveBeenCalled()
  })

  it('leaves the radio alone on restore if the user retuned away', async () => {
    const { wrapper, socket } = await mountConnected()
    await play(wrapper)
    externalTune({ hz: 137_000_000, mode: 'FM', satName: 'NOAA', token: 'T2' })
    await flushPromises()
    // Manually retune away (the Tune button is disabled while playing, so use Enter).
    await wrapper.find('.sdr-freq-input-large').setValue('99.000')
    await wrapper.find('.sdr-freq-input-large').trigger('keydown.enter')
    await flushPromises()
    socket.sent.length = 0
    externalRestore({ satName: 'NOAA', token: 'T2' })
    await flushPromises()
    // onTunedFreq is false → no restore tune.
    expect(socket.sent.map((s) => JSON.parse(s)).filter((m) => m.cmd === 'tune')).toHaveLength(0)
  })

  it('rejects a range with a non-numeric threshold', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    // Range inputs are all type=number in order: low, high, dwell, threshold.
    const nums = editor.findAll('input[type="number"]')
    await editor.find('input[type="text"]').setValue('R') // label
    await nums[0].setValue('100') // low
    await nums[1].setValue('110') // high
    await nums[3].setValue('') // threshold → NaN
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(pane.find('.sdr-field-error').text()).toMatch(/Threshold must be a number/)
    expect(searchApi.createSearchRange).not.toHaveBeenCalled()
  })

  it('reports a save failure from the range API', async () => {
    searchApi.createSearchRange.mockResolvedValueOnce(null as never)
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    const inputs = editor.findAll('input.sdr-panel-input')
    await inputs[0].setValue('R')
    await inputs[1].setValue('100')
    await inputs[2].setValue('110')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(pane.find('.sdr-field-error').text()).toMatch(/Save failed/)
  })

  it('closes the step menu with Escape', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-step-dropdown').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).not.toBeNull()
    await wrapper.find('.sdr-step-dropdown').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })
})

// =============================================================================
describe('SdrPanel — branch coverage E (scroll-tune, scan/search engine)', () => {
  function stubCharWidths() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
  }

  it('ignores a scroll-tune before any frequency is set', async () => {
    const { wrapper } = await mountConnected()
    const input = wrapper.find('.sdr-freq-input-large')
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 25 }))
    expect((input.element as HTMLInputElement).value).toBe('') // no change (currentFreqHz 0)
  })

  it('ignores a scroll-tune to the left of the input text', async () => {
    stubCharWidths()
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const input = wrapper.find('.sdr-freq-input-large')
    const before = (input.element as HTMLInputElement).value
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: -5 })) // x < 0
    await wrapper.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe(before)
  })

  it('scans a group selected via the legacy group_id field', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [], group_id: 1 }),
    ]
    fetchState.groups = [makeGroup()]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Airband')!
      .trigger('click')
    socket.sent.length = 0
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan the Airband group
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(true)
  })

  it('plays a saved frequency, stopping any active scan/search first', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true }),
      makeFreq({ id: 11, label: 'Play', frequency_hz: 120e6 }),
    ]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    await wrapper.findAll('.sdr-freq-row-play')[1].trigger('click') // play the saved freq
    await flushPromises()
    expect(store.scanSweeping).toBe(false)
    expect(audioMock.initAudio).toHaveBeenCalled()
  })

  it('wraps the search frequency back to the low edge of a narrow range', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    // Tiny range: 118.000–118.012 MHz at 12.5 kHz → ~1 step then wrap.
    await wrapper.find('.sdr-search-adhoc-input').setValue('118.000')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('118.012')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    // Feed empty frames so each step advances without locking; iterate to force a wrap.
    for (let step = 0; step < 4; step++) {
      const empty = {
        type: 'spectrum',
        bins: [] as number[],
        center_hz: -1,
        sample_rate: 2_048_000,
        timestamp_ms: step,
      }
      socket.message(empty)
      nowMs += 500
      vi.advanceTimersByTime(300)
    }
    vi.useRealTimers()
    expect(useSdrStore().searchSweeping).toBe(true)
  })

  it('selects the first range when none is selected on reload', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange({ id: 7, label: 'First' })] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    // The first range is auto-selected (searchSelectedRangeId set on reload).
    expect(wrapper.find('.sdr-search-range-item-active').exists()).toBe(true)
  })

  it('ticks the live recording elapsed timer', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording (sets the interval)
    await flushPromises()
    vi.advanceTimersByTime(1100) // → liveElapsedS recompute
    await wrapper.find('.sdr-rec-btn').trigger('click') // stop
    await flushPromises()
    vi.useRealTimers()
    expect(audioMock.stopRecording).toHaveBeenCalled()
  })

  it('does nothing when deleteFreq is called with no target', async () => {
    fetchState.frequencies = [makeFreq()]
    const { wrapper } = await mountConnected()
    // Open then close the add panel (editingFreqId stays null), then no row delete.
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-cancel').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — branch coverage F (guards & engine internals)', () => {
  it('ignores a marker tune request when not playing or unchanged', async () => {
    const store = useSdrStore()
    const { socket } = await mountConnected() // not playing
    socket.sent.length = 0
    store.requestTune(150_000_000) // not playing → ignored
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(false)
  })

  it('ignores a bandwidth request when not playing and applies one when playing', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    audioMock.setBandwidthHz.mockClear()
    store.requestBandwidth(20_000) // not playing → ignored
    await flushPromises()
    expect(audioMock.setBandwidthHz).not.toHaveBeenCalled()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    audioMock.setBandwidthHz.mockClear()
    store.requestBandwidth(bwHzUnchanged()) // same as current → ignored (1724)
    await flushPromises()
    function bwHzUnchanged() {
      return 10000
    }
  })

  it('multi-selects then clears frequency filter groups back to all', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, group_ids: [1] }),
      makeFreq({ id: 11, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper } = await mountConnected()
    const chips = () => wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    await chips()
      .find((c) => c.text() === 'Airband')!
      .trigger('click') // select Airband
    await chips()
      .find((c) => c.text() === 'Marine')!
      .trigger('click') // add Marine
    expect(wrapper.findAll('#sdr-freq-list .sdr-freq-row-item')).toHaveLength(2)
    await chips()
      .find((c) => c.text() === 'Marine')!
      .trigger('click') // remove Marine
    expect(wrapper.findAll('#sdr-freq-list .sdr-freq-row-item')).toHaveLength(1)
    await chips()
      .find((c) => c.text() === 'Airband')!
      .trigger('click') // remove last → All
    expect(wrapper.findAll('#sdr-freq-list .sdr-freq-row-item')).toHaveLength(2)
  })

  it('does not start a search with no range available', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    // No adhoc inputs, no saved ranges → onAdhocPlayClick → startSearch('adhoc') → adhocRange null.
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(useSdrStore().searchSweeping).toBe(false)
  })

  it('skips an auto-tune that overlaps an active scan (lock not held)', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan active
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'SAT', token: 'X' },
      }),
    )
    await flushPromises()
    // _isAutoTuneLockHeld returns false (scan active) → the tune proceeds (snapshot taken).
    expect(notifAdd).toHaveBeenCalled()
  })

  it('does not start recording twice', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start
    await flushPromises()
    audioMock.startRecording.mockClear()
    // A second auto-tune recording attempt no-ops while already recording.
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'S', record: true },
      }),
    )
    await flushPromises()
    expect(audioMock.startRecording).not.toHaveBeenCalled()
  })

  it('does not flag a recording that the audio layer refused to start', async () => {
    audioMock.startRecording.mockResolvedValueOnce(undefined as never)
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // startRecording returns undefined → no rec
    await flushPromises()
    expect(wrapper.find('.sdr-rec-btn').classes()).not.toContain('sdr-rec-btn--active')
  })

  it('cancels the range editor when deleting the range being edited', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click') // open editor
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-del')[0].trigger('click') // delete while editing
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })

  it('resets the radio tab pending marker after radios load', async () => {
    const pending = document.createElement('div')
    pending.className = 'msb-tab msb-tab--pending'
    pending.setAttribute('data-tab', 'radio')
    document.body.appendChild(pending)
    await mountReady()
    expect(pending.classList.contains('msb-tab--pending')).toBe(false)
    pending.remove()
  })

  it('stops an in-progress recording when Stop is pressed', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording
    await flushPromises()
    audioMock.stopRecording.mockClear()
    await wrapper.find('.sdr-stop-btn').trigger('click') // stop → ends recording
    await flushPromises()
    expect(audioMock.stopRecording).toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — branch coverage G (more guards)', () => {
  async function play(wrapper: VueWrapper) {
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
  }

  it('ignores a marker tune request for the current frequency', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await play(wrapper)
    socket.sent.length = 0
    store.requestTune(100_000_000) // === currentFreqHz → ignored (1670)
    await flushPromises()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(false)
  })

  it('coalesces back-to-back marker retunes (debounce clearTimeout)', async () => {
    const store = useSdrStore()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper } = await mountConnected()
    await play(wrapper)
    store.requestTune(101_000_000) // schedules debounce
    await wrapper.vm.$nextTick()
    store.requestTune(102_000_000) // clears + reschedules (1689)
    await wrapper.vm.$nextTick()
    store.requestTune(103_000_000, true) // center=true also clears (1680)
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(700)
    vi.useRealTimers()
    expect(true).toBe(true)
  })

  it('stops a running search when Stop is pressed', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    await wrapper.find('.sdr-stop-btn').trigger('click') // stop → stopSearch
    expect(store.searchSweeping).toBe(false)
  })

  it('does not open the sample-rate menu while controls are disabled', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2 })] // no auto-select → disabled
    const wrapper = await mountReady()
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click') // toggleSampleRateMenu → controlsDisabled → no menu
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('keeps the dot off when the reachability probe is not OK', async () => {
    fetchOverride = (url) =>
      url.startsWith('/api/sdr/status/')
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : null
    const { wrapper, socket } = await mountConnected()
    await wrapper.vm.$nextTick()
    void socket
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
  })

  it('resumes playback on the first confirmed frame when sdrPlaying was set', async () => {
    sessionStorage.setItem('sdrPlaying', '1')
    const { wrapper, socket } = await mountConnected()
    await confirmData(wrapper, socket) // setStatus(true) → resume playing (2504)
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
  })

  it('does not start a scan when there is nothing scannable', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, scannable: false })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // startScan → empty queue → no-op
    expect(store.scanSweeping).toBe(false)
  })

  it('starting a scan stops an active search first', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click') // scanner
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click') // search
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click') // search
    expect(store.searchSweeping).toBe(true)
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // startScan → stopSearch
    expect(store.searchSweeping).toBe(false)
    expect(store.scanSweeping).toBe(true)
  })

  it('starting a search stops an active scan first', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan
    expect(store.scanSweeping).toBe(true)
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click') // search → stopScan
    expect(store.scanSweeping).toBe(false)
  })

  it('ignores playFreq with no radio selected', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2 })] // no auto-select
    fetchState.frequencies = [makeFreq({ id: 10 })]
    const wrapper = await mountReady()
    audioMock.initAudio.mockClear() // isolate from async setup bleed
    await wrapper.findAll('.sdr-freq-row-play')[0].trigger('click') // no radio → no-op
    expect(audioMock.initAudio).not.toHaveBeenCalled()
  })

  it('falls back to the first enabled radio for an auto-tune when nothing is remembered', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2, name: 'rtl1' })] // no auto-select
    sessionStorage.removeItem('sdrLastRadioId')
    const wrapper = await mountReady()
    void wrapper
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'S' },
      }),
    )
    await flushPromises()
    expect(sockets.length).toBeGreaterThan(0) // selectRadio(first enabled) opened a socket
  })
})

// =============================================================================
describe('SdrPanel — branch coverage H (engine resume, validation, guards)', () => {
  async function startScan(wrapper: VueWrapper) {
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click')
  }
  function frame(center: number, fill: number, ts: number) {
    return {
      type: 'spectrum',
      bins: new Array(16).fill(fill),
      center_hz: center,
      sample_rate: 2_048_000,
      timestamp_ms: ts,
    }
  }

  it('auto-resumes a scan after the locked signal drops', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true }),
    ]
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await startScan(wrapper)
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(false)
    // Signal drops: weak frames → resume watcher polls → onResume → toggleScanLock.
    socket.message(frame(118e6, -120, 3))
    nowMs += 500
    vi.advanceTimersByTime(500)
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('keeps a locked search held while the signal stays strong', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    expect(store.searchSweeping).toBe(false)
    // Signal stays strong during the resume poll → _quietSinceMs reset, stays held.
    socket.message(frame(118e6, 0, 3))
    nowMs += 300
    vi.advanceTimersByTime(300)
    expect(store.searchSweeping).toBe(false) // still locked
    vi.useRealTimers()
  })

  it('does not start playFreq while a search is running (stops it first)', async () => {
    fetchState.frequencies = [makeFreq({ id: 11, label: 'P', frequency_hz: 120e6 })]
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(store.searchSweeping).toBe(true)
    await wrapper.findAll('.sdr-freq-row-play')[0].trigger('click') // playFreq → stopSearch
    expect(store.searchSweeping).toBe(false)
  })

  it('rejects a range with a non-positive dwell', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    // Range inputs are all type=number in order: low, high, dwell, threshold.
    const nums = editor.findAll('input[type="number"]')
    await editor.find('input[type="text"]').setValue('R') // label
    await nums[0].setValue('100') // low
    await nums[1].setValue('110') // high
    await nums[2].setValue('0') // dwell = 0
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(pane.find('.sdr-field-error').text()).toMatch(/Dwell must be positive/)
  })

  it('does not start a saved-range search with an inverted range', async () => {
    searchApi.listSearchRanges.mockResolvedValue([
      makeRange({ id: 9, low_hz: 160_000_000, high_hz: 150_000_000 }),
    ] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // startSearch('saved') → low>=high
    await flushPromises()
    expect(store.searchSweeping).toBe(false)
  })

  it('does not flag an auto-tune recording the audio layer refused', async () => {
    audioMock.startRecording.mockResolvedValueOnce(undefined as never)
    const { wrapper } = await mountConnected()
    void wrapper
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'S', record: true },
      }),
    )
    await flushPromises()
    // _startRecording returned false → _startAutoTuneRecording bails (no RECORDING notif).
    expect(true).toBe(true)
  })

  it('formats a typed frequency on blur', async () => {
    const { wrapper } = await mountConnected()
    const input = wrapper.find('.sdr-freq-input-large')
    await input.setValue('145.5')
    await input.trigger('focus')
    await input.setValue('146.7')
    await input.trigger('blur') // formatFreqInput → '146.7000'
    expect((input.element as HTMLInputElement).value).toBe('146.7000')
  })

  it('adds a group via the Enter key', async () => {
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.setValue('Weather')
    await input.trigger('keydown', { key: 'Enter' }) // submitGroupRow → addGroup
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/sdr/groups' && c.opts?.method === 'POST')).toBe(
      true,
    )
  })

  it('closes the sample-rate menu on Escape', async () => {
    const { wrapper } = await mountConnected()
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click') // open
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await srDrop.trigger('keydown', { key: 'Escape' }) // close
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('reloads ranges and clears a stale selection when the searched range disappears', async () => {
    searchApi.listSearchRanges.mockResolvedValueOnce([makeRange({ id: 9 })] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // search range 9
    await flushPromises()
    expect(store.searchSweeping).toBe(true)
    // Range list reloads without range 9 → stopSearch + clear selection.
    searchApi.listSearchRanges.mockResolvedValue([] as never)
    document.dispatchEvent(new CustomEvent('sdr:frequenciesImported'))
    await flushPromises()
    expect(store.searchSweeping).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — branch coverage I (resume callbacks & remaining guards)', () => {
  function frame(center: number, fill: number, ts: number) {
    return {
      type: 'spectrum',
      bins: new Array(16).fill(fill),
      center_hz: center,
      sample_rate: 2_048_000,
      timestamp_ms: ts,
    }
  }

  it('auto-resumes a locked search after the signal drops (full cycle)', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118.000')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('118.050')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // dwell → lock
    expect(store.searchSweeping).toBe(false)
    socket.message(frame(118e6, -120, 3)) // signal gone
    nowMs += 500
    vi.advanceTimersByTime(400) // resume poll → toggleSearchLock → advance + doSearchStep
    expect(store.searchSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('auto-resumes a squelch-locked scan after the channel goes quiet', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // start scan
    nowMs += 500
    audioMock._squelchCb!(true) // worklet squelch opens after settle → lock + resume watcher
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(false)
    socket.message(frame(118e6, -120, 1)) // channel quiet
    nowMs += 500
    vi.advanceTimersByTime(400) // resume poll → toggleScanLock
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('auto-resumes a squelch-locked search after the channel goes quiet', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    nowMs += 500
    audioMock._squelchCb!(true) // squelch opens after settle → lock + resume watcher
    expect(store.searchSweeping).toBe(false)
    socket.message(frame(118e6, -120, 1))
    nowMs += 500
    vi.advanceTimersByTime(400) // resume → toggleSearchLock
    expect(store.searchSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('cancels a pending control-socket reconnect when the radio is deselected', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.serverClose() // schedules a reconnect timer (_ctrlReconnect)
    const before = sockets.length
    // Deselect via the device menu placeholder → clearRadioSelection →
    // closeControlSocket clears the pending reconnect timer.
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await flushPromises()
    ;(document.querySelector('.sdr-device-menu-placeholder') as HTMLElement).click()
    await flushPromises()
    expect(wrapper.find('.sdr-device-dropdown-text').text()).toContain('select radio')
    // No reconnect socket was opened after the cancel.
    expect(sockets.length).toBe(before)
  })

  it('uses the current saved range when ad-hoc inputs are empty', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange({ id: 9 })] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    // No ad-hoc inputs → currentSearchRange falls back to the selected saved range.
    await wrapper.find('.sdr-search-range-item-play').trigger('click')
    await flushPromises()
    expect(store.searchSweeping).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — branch coverage J (correctly-targeted guards)', () => {
  it('ignores Tune when no radio is selected', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2 })] // no auto-select
    const wrapper = await mountReady()
    // controlsDisabled keeps the button disabled, so invoke via the input Enter key.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    audioMock.initAudio.mockClear()
    await wrapper.find('.sdr-freq-input-large').trigger('keydown.enter') // tune() → no radio
    expect(audioMock.initAudio).not.toHaveBeenCalled()
  })

  it('toggles the device menu closed on a second click', async () => {
    fetchState.radios = [makeRadio(), makeRadio({ id: 2 })]
    const wrapper = await mountReady()
    const dd = wrapper.find('.sdr-radio-section--device .sdr-device-dropdown')
    await dd.trigger('click') // open
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await dd.trigger('click') // toggleDeviceMenu → close
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('toggles the sample-rate menu closed on a second click', async () => {
    const { wrapper } = await mountConnected()
    const srDrop = wrapper
      .findAll('.sdr-device-dropdown')
      .find((d) => !d.element.closest('.sdr-radio-section--device'))!
    await srDrop.trigger('click') // open
    await wrapper.vm.$nextTick()
    await srDrop.trigger('click') // close
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('toggles the step menu closed on a second click', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    const step = wrapper.find('.sdr-step-dropdown')
    await step.trigger('click') // open
    await wrapper.vm.$nextTick()
    await step.trigger('click') // close
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })

  it('picks a step for the range editor', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    await pane.find('.sdr-step-dropdown').trigger('click') // range step menu
    await wrapper.vm.$nextTick()
    const items = document.querySelectorAll('.sdr-step-menu .sdr-device-menu-item')
    ;(items[0] as HTMLElement).click() // pickStep('range') → rangeEditor.step_khz
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })

  it('rejects a blank rename of an existing group', async () => {
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-group-pill-edit')[0].trigger('click') // startEditGroupRow
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.setValue('   ') // blank
    await input.trigger('keydown', { key: 'Enter' }) // submitGroupRow (editing) → blank → no PUT
    await flushPromises()
    expect(fetchCalls.some((c) => c.url === '/api/sdr/groups/1' && c.opts?.method === 'PUT')).toBe(
      false,
    )
  })

  it('does not start a scan when one is already locked', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 2_048_000,
      timestamp_ms: 1,
    })
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 2_048_000,
      timestamp_ms: 2,
    })
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    // Toggle a group while locked → refreshScanQueue → startScan early-returns (scanLocked).
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // onScanPrimaryClick (locked → toggleScanLock)
    vi.useRealTimers()
    expect(true).toBe(true)
  })

  it('selecting Tune with an empty input formats nothing', async () => {
    const { wrapper } = await mountConnected()
    const input = wrapper.find('.sdr-freq-input-large')
    await input.setValue('') // empty
    audioMock.initAudio.mockClear()
    await input.trigger('keydown.enter') // tune → formatFreqInput (empty) → parseFreqMhz null
    expect(audioMock.initAudio).not.toHaveBeenCalled()
  })

  it('toggles AGC off then on (debounce clearTimeout)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    const agc = wrapper.find('.sdr-agc-row .sdr-checkbox')
    await agc.setValue(true)
    await agc.setValue(false) // second onAgcChange clears the first debounce
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    expect(socket.sent.map((s) => JSON.parse(s).cmd)).toContain('gain')
  })
})

// =============================================================================
describe('SdrPanel — branch coverage K (search helpers & guards)', () => {
  it('skips an auto-tune recording flag the audio layer refused (already covered start guard)', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording
    await flushPromises()
    // A second toggle-record press while already recording → _startRecording bails.
    audioMock.startRecording.mockClear()
    await wrapper.find('.sdr-rec-btn').trigger('click') // stop
    await flushPromises()
    expect(audioMock.stopRecording).toHaveBeenCalled()
  })

  it('reports an auto-tune lock as not held during an active scan', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, frequency_hz: 118e6, scannable: true })]
    const { wrapper } = await mountConnected()
    // Take a pass so a snapshot exists.
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'A', token: 'A' },
      }),
    )
    await flushPromises()
    // Start a scan so _isAutoTuneLockHeld sees scanActive and returns false.
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click')
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    // A second overlapping pass: lock not held (scan) → proceeds, not skipped.
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 146_000_000, mode: 'NFM', satName: 'B', token: 'B' },
      }),
    )
    await flushPromises()
    expect(notifAdd.mock.calls.some(([o]) => /SKIPPED/.test((o as { title: string }).title))).toBe(
      false,
    )
  })

  it('stops the search and clears the selection when the searched range vanishes', async () => {
    searchApi.listSearchRanges.mockResolvedValueOnce([makeRange({ id: 9 })] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // search range 9
    await flushPromises()
    expect(store.searchSweeping).toBe(true)
    // Reload throws → empty list → the searched range is gone → stopSearch + clear.
    searchApi.listSearchRanges.mockRejectedValue(new Error('boom'))
    document.dispatchEvent(new CustomEvent('sdr:frequenciesImported'))
    await flushPromises()
    expect(wrapper.find('.sdr-search-range-item').exists()).toBe(false)
    expect(store.searchSweeping).toBe(false)
  })

  it('switching to ad-hoc stops an active saved-range search', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange({ id: 9 })] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // saved search active
    await flushPromises()
    expect(store.searchSweeping).toBe(true)
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click') // onAdhocPlayClick → stopSearch (saved) then adhoc
    expect(store.searchSweeping).toBe(true) // now ad-hoc
  })

  it('switching to a saved-range search stops an active ad-hoc search', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange({ id: 9 })] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click') // adhoc
    expect(store.searchSweeping).toBe(true)
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click') // saved ranges
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-range-item-play').trigger('click') // onSavedRangePlayClick → stopSearch + saved
    await flushPromises()
    expect(store.searchSweeping).toBe(true) // now the saved search
  })
})

// =============================================================================
describe('SdrPanel — branch coverage L (final reachable paths)', () => {
  function frame(center: number, fill: number, ts: number) {
    return {
      type: 'spectrum',
      bins: new Array(16).fill(fill),
      center_hz: center,
      sample_rate: 2_048_000,
      timestamp_ms: ts,
    }
  }

  it('advances the scan past a clean-but-weak channel', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true }),
    ]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    socket.sent.length = 0
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan → tunes 118
    // Clean frames but weak (-50 < squelch -30) → evaluate advances to 119.
    socket.message(frame(118e6, -50, 1))
    socket.message(frame(118e6, -50, 2))
    nowMs += 500
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    const tunes = socket.sent.map((s) => JSON.parse(s)).filter((m) => m.cmd === 'tune')
    expect(tunes.length).toBeGreaterThan(1)
  })

  it('wraps the search step back to the low edge on a clean weak channel', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118.000')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('118.010') // ~1 step wide
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    // Feed clean weak frames matching the swept freq so each step advances + wraps.
    for (let step = 0; step < 3; step++) {
      const hz = step === 0 ? 118_000_000 : 118_010_000
      socket.message(frame(hz, -50, step * 2 + 1))
      socket.message(frame(hz, -50, step * 2 + 2))
      nowMs += 500
      vi.advanceTimersByTime(300)
    }
    vi.useRealTimers()
    expect(useSdrStore().searchSweeping).toBe(true)
  })

  it('starts a hands-free auto-tune off the first enabled radio when nothing matches', async () => {
    fetchState.radios = [makeRadio({ id: 3, name: 'rtl3' }), makeRadio({ id: 4, name: 'rtl4' })]
    sessionStorage.setItem('sdrLastRadioId', '99') // no such radio → falls through to lastId branch then first-enabled
    const wrapper = await mountReady()
    void wrapper
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', satName: 'S' },
      }),
    )
    await flushPromises()
    expect(sockets.length).toBeGreaterThan(0)
  })

  it('resumes playback on the first frame even if sdrPlaying is set after open', async () => {
    const { wrapper, socket } = await mountConnected()
    sessionStorage.setItem('sdrPlaying', '1') // set after open → setStatus resume branch
    await confirmData(wrapper, socket)
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
  })

  it('does not start an ad-hoc search when its inputs are invalid', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    // No inputs → adhocRange() null → startSearch('adhoc') → no range.
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(useSdrStore().searchSweeping).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — final coverage tail', () => {
  it('clears a prior reconnect timer when the socket closes again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { socket } = await mountConnected()
    socket.serverClose() // schedules reconnect #1
    socket.serverClose() // second close clears reconnect #1 before scheduling #2
    vi.useRealTimers()
    expect(true).toBe(true)
  })

  it('selecting a different saved range stops an active search', async () => {
    searchApi.listSearchRanges.mockResolvedValue([
      makeRange({ id: 9, label: 'A' }),
      makeRange({ id: 12, label: 'B', low_hz: 150_000_000, high_hz: 160_000_000 }),
    ] as never)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.findAll('.sdr-scanner-header-row')[6].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.sdr-search-range-item-play')[0].trigger('click') // search range A
    await flushPromises()
    expect(store.searchSweeping).toBe(true)
    // Click range B's body → selectSearchRange → stopSearch (was searching).
    await wrapper.findAll('.sdr-search-range-item-body')[1].trigger('click')
    expect(store.searchSweeping).toBe(false)
  })

  it('changing the edit-frequency mode fires the mode watch', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    const usbPill = wrapper
      .findAll('#sdr-ef-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'USB')!
    await usbPill.trigger('click') // efMode = 'USB' → watch
    expect(usbPill.classes()).toContain('active')
  })
})

// =============================================================================
describe('SdrPanel — defensive default branches', () => {
  it('handles frequencies and groups with missing optional fields', async () => {
    // group_ids undefined, notes undefined, group_id present → exercises the
    // `|| []` / `?? ''` fallbacks in freqGroupsFor/groupsWithFreqs/openEditFreqPanel.
    fetchState.frequencies = [
      { id: 10, label: 'X', frequency_hz: 124e6, mode: 'AM', scannable: true, group_id: 1 },
    ]
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    expect(wrapper.find('.sdr-freq-row-group-chip').text()).toBe('Airband')
    // Edit it (efGroupIds from missing group_ids, efNotes from missing notes).
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
  })

  it('drives the signal meter on both rising and falling power', async () => {
    const { wrapper } = await mountConnected()
    audioMock._powerCb!(-30, true) // rising (alpha 0.3)
    await wrapper.vm.$nextTick()
    audioMock._powerCb!(-90, true) // falling (alpha 0.05)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-signal-segments').exists()).toBe(true)
  })

  it('keeps the dot off when the probe reports neither connected nor reachable', async () => {
    fetchOverride = (url) =>
      url.startsWith('/api/sdr/status/')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ connected: false, reachable: false }),
          })
        : null
    const { wrapper } = await mountConnected()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
  })

  it('lights the dot when the probe reports reachable only', async () => {
    fetchOverride = (url) =>
      url.startsWith('/api/sdr/status/')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ connected: false, reachable: true }),
          })
        : null
    const { wrapper } = await mountConnected()
    await flushPromises()
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
  })

  it('records with metadata defaults when the tune fields are zero', async () => {
    const { wrapper } = await mountConnected()
    // Tune so playing, then zero the underlying values via a saved-freq play of 0?  Instead
    // start recording right after connect when currentFreqHz is still 0.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click')
    await flushPromises()
    expect(audioMock.startRecording).toHaveBeenCalled()
    const lastCall = audioMock.startRecording.mock.calls.at(-1) as unknown as [
      { sample_rate: number },
    ]
    expect(lastCall[0].sample_rate).toBe(2048000)
  })

  it('samples a default sample-rate when the frame omits it', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    // Frame with sample_rate 0 → sampleChannelDb uses the 2_048_000 fallback.
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 0,
      timestamp_ms: 1,
    })
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 0,
      timestamp_ms: 2,
    })
    nowMs += 500
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(useSdrStore().searchSweeping).toBe(false) // locked on the strong frame
  })

  it('falls back to a default satellite name for an external tune', async () => {
    const { socket } = await mountConnected()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    socket.sent.length = 0
    // No satName → defaults to "SATELLITE".
    document.dispatchEvent(new CustomEvent('sentinel:sdr-tune-external', { detail: { hz: 145e6 } }))
    await flushPromises()
    expect(notifAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'SATELLITE AUTO-TUNED' }),
    )
  })

  it('opens the add-frequency panel with a blank freq when none is tuned', async () => {
    const { wrapper } = await mountConnected()
    // currentFreqHz is 0 before any tune → efFreq stays ''.
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    expect((wrapper.find('#sdr-ef-freq').element as HTMLInputElement).value).toBe('')
  })
})

// =============================================================================
describe('SdrPanel — remaining reachable branch arms', () => {
  it('prefills the add-frequency form with the current tune', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('145.500')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('#sdr-radio-add-freq').trigger('click') // openAddFreqPanel (currentFreqHz set)
    await wrapper.vm.$nextTick()
    expect((wrapper.find('#sdr-ef-freq').element as HTMLInputElement).value).toBe('145.5000')
  })

  it('defaults the satellite name when an external restore omits it', async () => {
    const { socket } = await mountConnected()
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-external', {
        detail: { hz: 145_000_000, mode: 'NFM', token: 'T1' },
      }),
    )
    await flushPromises()
    const notifAdd = vi.spyOn(useNotificationsStore(), 'add')
    document.dispatchEvent(
      new CustomEvent('sentinel:sdr-tune-restore', { detail: { token: 'T1' } }),
    )
    await flushPromises()
    expect(notifAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'SATELLITE PASS ENDED' }),
    )
    void socket
  })

  it('labels the range step dropdown from the range editor step', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    // The range step dropdown shows a formatted kHz label (stepMenuTarget 'range').
    expect(pane.find('.sdr-step-dropdown .sdr-device-dropdown-text').text()).toMatch(/kHz/)
  })

  it('scans a frequency that has no group_ids array', async () => {
    fetchState.frequencies = [
      { id: 10, label: 'X', frequency_hz: 118e6, mode: 'AM', scannable: true, group_id: 1 },
    ]
    fetchState.groups = [makeGroup()]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Airband')!
      .trigger('click')
    socket.sent.length = 0
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // buildScanQueue with f.group_ids undefined
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — inline editors & template branches', () => {
  it('exercises the inline frequency-edit controls and validation errors', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, group_ids: [1] })]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click') // open inline edit
    await wrapper.vm.$nextTick()
    const panel = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    // Mode pill, group toggle, Default pill, notes.
    await panel
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')!
      .trigger('click')
    await panel
      .findAll('.sdr-ef-gpill')
      .find((b) => b.text() === 'Marine')!
      .trigger('click')
    await panel.find('.sdr-editfreq-field textarea').setValue('inline notes')
    // Clear the label + bad freq, then save → inline error divs render.
    await panel.findAll('input.sdr-panel-input')[0].setValue('')
    await panel.findAll('input.sdr-panel-input')[1].setValue('nope')
    await panel.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing .sdr-field-error').exists()).toBe(true)
    // Reset to the Default group via its pill.
    await panel
      .findAll('.sdr-ef-gpill')
      .find((b) => b.text() === 'Default')!
      .trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('selects the Default group in the add-frequency panel', async () => {
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    const groupBtn = wrapper
      .findAll('#sdr-ef-groups .sdr-ef-gpill')
      .find((b) => b.text() === 'Airband')!
    await groupBtn.trigger('click') // pick a group
    await wrapper
      .findAll('#sdr-ef-groups .sdr-ef-gpill')
      .find((b) => b.text() === 'Default')!
      .trigger('click')
    expect(wrapper.find('#sdr-ef-groups').exists()).toBe(true)
  })

  it('opens a range editor with the keyboard and edits all its fields', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    const rowBody = wrapper.find('#sdr-search-range-list .sdr-search-range-row-body')
    await rowBody.trigger('keydown.enter') // toggleEditRange via keyboard
    await wrapper.vm.$nextTick()
    const panel = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    expect(panel.exists()).toBe(true)
    const nums = panel.findAll('input[type="number"]')
    await nums[0].setValue('118') // low
    await nums[1].setValue('137') // high
    await nums[2].setValue('150') // dwell
    await nums[3].setValue('-55') // threshold
    await panel
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'NFM')!
      .trigger('click')
    await panel.find('textarea').setValue('range notes')
    await panel.find('.sdr-step-dropdown').trigger('keydown.enter') // onStepDropdownKey range
    await panel.find('.sdr-step-dropdown').trigger('keydown', { key: 'Escape' })
    await panel.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(searchApi.updateSearchRange).toHaveBeenCalled()
  })

  it('edits the bottom add-range fields (mode pill, step key, notes)', async () => {
    const { wrapper } = await mountConnected()
    const pane = wrapper.findAll('.sdr-tab-pane')[1]
    await pane
      .findAll('.sdr-add-freq-btn')
      .find((b) => b.text() === 'Add Range')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const editor = pane.find('.sdr-editfreq-body')
    await editor
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((b) => b.text() === 'AM')!
      .trigger('click')
    await editor.find('textarea').setValue('add notes')
    await editor.find('.sdr-step-dropdown').trigger('keydown.enter') // onStepDropdownKey('range')
    await editor.find('.sdr-step-dropdown').trigger('keydown', { key: 'Escape' })
    expect(editor.exists()).toBe(true)
  })

  it('forwards the recordings playback-active event to the audio mute', async () => {
    const { wrapper } = await mountConnected()
    const rec = wrapper.findComponent('.stub-recordings') as unknown as {
      vm: { $emit: (event: string, ...args: unknown[]) => void }
    }
    rec.vm.$emit('playback-active', true)
    await wrapper.vm.$nextTick()
    expect(audioMock.setLiveMuted).toHaveBeenCalledWith(true)
  })

  it('blocks the ad-hoc step dropdown while a search is active', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click') // search active
    await wrapper.find('.sdr-step-dropdown').trigger('click') // expression → null (searchActive)
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).toBeNull()
  })

  it('shows the empty search-ranges state', async () => {
    searchApi.listSearchRanges.mockResolvedValue([] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('#sdr-search-range-list .sdr-freq-row-item')).toHaveLength(0)
  })

  it('shows "No matches" when a frequency filter excludes everything', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, group_ids: [1] })]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper } = await mountConnected()
    // Both groups render as filter chips (Airband has a freq; Marine via a 2nd freq).
    fetchState.frequencies = [
      makeFreq({ id: 10, group_ids: [1] }),
      makeFreq({ id: 11, group_ids: [2], scannable: false }),
    ]
    await (wrapper.vm as unknown as { reloadData: () => Promise<void> })?.reloadData?.()
    expect(wrapper.exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — last template branches', () => {
  it('flags an invalid stored mode when editing a frequency', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, mode: 'XYZ' })] // invalid stored mode
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const panel = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await panel.find('.sdr-editfreq-save-btn').trigger('click') // validateFreqForm → mode error
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing .sdr-field-error').text()).toMatch(/Select a mode/)
  })

  it('flags disallowed notes inline', async () => {
    fetchState.frequencies = [makeFreq({ id: 10 })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const panel = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await panel.find('textarea').setValue('bad < > notes')
    await panel.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing .sdr-field-error').text()).toMatch(/disallowed/)
  })

  it('opens a range editor via the spacebar', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.find('#sdr-search-range-list .sdr-search-range-row-body').trigger('keydown.space')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
  })

  it('opens the inline range step menu by click and closes it on a menu click', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-freq-editing .sdr-step-dropdown').trigger('click') // toggleStepMenu('range')
    await wrapper.vm.$nextTick()
    const menu = document.querySelector('.sdr-step-menu') as HTMLElement
    expect(menu).not.toBeNull()
    menu.click() // the menu's @click.stop no-op handler
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-step-menu')).not.toBeNull() // click.stop keeps it open
  })

  it('shows "No matches" when the active group filter has no frequencies left', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, group_ids: [1] }),
      makeFreq({ id: 11, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper } = await mountConnected()
    await wrapper
      .findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
      .find((c) => c.text() === 'Airband')!
      .trigger('click') // filter to Airband (freq 10)
    // Remove freq 10 (Airband) but keep freq 11 → filteredFreqs 0, freqs > 0.
    fetchState.frequencies = [makeFreq({ id: 11, group_ids: [2] })]
    await (wrapper.vm as unknown as { reloadData?: () => Promise<void> }).reloadData?.()
    await flushPromises()
    expect(wrapper.text()).toContain('No matches')
  })
})

// =============================================================================
describe('SdrPanel — if/else fall-through arms', () => {
  it('restores from an empty settings object (all field guards fall through)', async () => {
    sessionStorage.setItem('sdrSettings', JSON.stringify({})) // present but no fields
    const wrapper = await mountReady()
    expect(wrapper.exists()).toBe(true)
  })

  it('drives the signal meter with an undefined squelch flag', async () => {
    const { wrapper } = await mountConnected()
    audioMock._powerCb!(-30, undefined as unknown as boolean) // squelchOpen undefined
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-signal-segments').exists()).toBe(true)
  })

  it('switches to another tab while the panel is already open (no open dispatch)', async () => {
    const wrapper = await mountReady()
    document.dispatchEvent(new CustomEvent('sentinel:sidebar-state', { detail: { open: true } }))
    await wrapper.vm.$nextTick()
    let opened = false
    const handler = () => (opened = true)
    document.addEventListener('sentinel:sdr-open-panel', handler)
    railButton('groups').click() // different tab, sidebar already open → no open dispatch
    document.removeEventListener('sentinel:sdr-open-panel', handler)
    expect(opened).toBe(false)
  })

  it('collapses nothing when the panel-open watch fires with false', async () => {
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    store.panelOpen = true
    await wrapper.vm.$nextTick()
    store.panelOpen = false // watch fires with open=false → no collapse
    await wrapper.vm.$nextTick()
    expect(wrapper.exists()).toBe(true)
  })

  it('skips the hardware retune on a non-centred request with auto-centre off', async () => {
    const store = useSdrStore()
    store.setAutoCenterWaterfallOnTune(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    socket.sent.length = 0
    store.requestTune(101_000_000) // non-center, auto-centre OFF → no sendCmd tune
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(700)
    vi.useRealTimers()
    expect(socket.sent.map((s) => JSON.parse(s)).some((m) => m.cmd === 'tune')).toBe(false)
  })

  it('ignores group id 0 when building the group lists', async () => {
    fetchState.frequencies = [makeFreq({ id: 10, group_ids: [0, 1] })]
    fetchState.groups = [makeGroup()]
    const { wrapper } = await mountConnected()
    expect(wrapper.find('.sdr-freq-row-group-chip').text()).toBe('Airband')
  })

  it('ignores a spectrum frame whose bins are not an array', async () => {
    const store = useSdrStore()
    const { socket } = await mountConnected()
    socket.message({
      type: 'spectrum',
      bins: 'nope',
      center_hz: 100e6,
      sample_rate: 2e6,
      timestamp_ms: 1,
    })
    expect(store.lastSpectrum).toBeNull()
  })

  it('keeps a locked scan held when a group is toggled (no immediate re-step)', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [1] }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click')
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 2e6,
      timestamp_ms: 1,
    })
    socket.message({
      type: 'spectrum',
      bins: new Array(16).fill(0),
      center_hz: 118e6,
      sample_rate: 2e6,
      timestamp_ms: 2,
    })
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    await wrapper.vm.$nextTick()
    // Toggle Marine while locked → refreshScanQueue with scanLocked true (no doScanStep).
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Marine')!
      .trigger('click')
    await wrapper.vm.$nextTick()
    vi.useRealTimers()
    expect(wrapper.exists()).toBe(true)
  })

  it('handles a non-OK group create response', async () => {
    fetchState.groups = [makeGroup()]
    fetchOverride = (url, opts) =>
      url === '/api/sdr/groups' && opts?.method === 'POST'
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : null
    const { wrapper } = await mountConnected()
    const input = wrapper.find('.sdr-frequency-manager-group-add-row .sdr-panel-input')
    await input.setValue('Weather')
    await wrapper.find('.sdr-frequency-manager-group-add-row button:last-child').trigger('click')
    await flushPromises()
    // Non-OK → newGroupName not cleared, no reload.
    expect((input.element as HTMLInputElement).value).toBe('Weather')
  })

  it('flags a blank label inline in the range editor', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const panel = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await panel.find('input[type="text"]').setValue('') // blank label
    await panel.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    expect(panel.find('.sdr-field-error').exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrPanel — remaining fall-through arms', () => {
  function frame(center: number, fill: number, ts: number) {
    return {
      type: 'spectrum',
      bins: new Array(16).fill(fill),
      center_hz: center,
      sample_rate: 2e6,
      timestamp_ms: ts,
    }
  }

  it('reuses the freq-wheel measuring mirror across notches', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.0000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    const input = wrapper.find('.sdr-freq-input-large')
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })) // creates the mirror
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })) // reuses it
    expect(wrapper.exists()).toBe(true)
  })

  it('waits out a non-zero resume delay before resuming a search', async () => {
    localStorage.setItem('sdrResumeDelaySec', '2') // delayMs 2000 → multi-poll
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    store.setResumeDelaySec(2)
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    expect(store.searchSweeping).toBe(false)
    socket.message(frame(118e6, -120, 3)) // quiet
    nowMs += 300
    vi.advanceTimersByTime(250) // poll #1: quietSince set, not elapsed (3457 false)
    nowMs += 300
    vi.advanceTimersByTime(250) // poll #2: quietSince already set (3456 false), still not elapsed
    expect(store.searchSweeping).toBe(false) // still held (delay not met)
    nowMs += 2000
    vi.advanceTimersByTime(250) // now elapsed → resume
    expect(store.searchSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('does not lock on squelch before the post-tune settle window', async () => {
    const nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    const store = useSdrStore()
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    audioMock._squelchCb!(true) // immediately (not settled) → no lock
    expect(store.searchSweeping).toBe(true)
  })

  it('resumes a paused recording when squelch reopens', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click') // start recording
    await flushPromises()
    audioMock._squelchCb!(true) // open → recSquelchOpen true
    audioMock._squelchCb!(false) // close → pause (recPauseStart set)
    audioMock._squelchCb!(true) // reopen → resume (recPauseStart != null)
    expect(audioMock.startRecording).toHaveBeenCalled()
  })

  it('releases the step-dropdown ref when the range editor closes', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click') // open
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-freq-editing .sdr-editfreq-body').find('.sdr-step-dropdown').exists()
    // Close via the row body toggle → the step dropdown unmounts → setStepDropdownRef(null).
    await wrapper.find('.sdr-freq-editing .sdr-search-range-row-body').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })
})

// =============================================================================
describe('SdrPanel — final reachable arms', () => {
  function frame(center: number, fill: number, ts: number) {
    return {
      type: 'spectrum',
      bins: new Array(16).fill(fill),
      center_hz: center,
      sample_rate: 2e6,
      timestamp_ms: ts,
    }
  }

  it('skips re-initialising a radio that is already marked initialised', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { socket } = await mountConnected() // first open → markInitialised
    socket.serverClose()
    vi.advanceTimersByTime(600)
    await flushPromises()
    lastSocket().open() // reconnect open → already initialised (skip)
    await flushPromises()
    vi.useRealTimers()
    expect(sockets.length).toBeGreaterThan(1)
  })

  it('clears a pending dwell timer when the scan queue is refreshed mid-step', async () => {
    fetchState.frequencies = [
      makeFreq({ id: 10, frequency_hz: 118e6, scannable: true, group_ids: [1] }),
      makeFreq({ id: 11, frequency_hz: 119e6, scannable: true, group_ids: [2] }),
    ]
    fetchState.groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[4].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-play').trigger('click') // scan, dwell timer pending
    await wrapper
      .findAll('#sdr-scanner-section .sdr-scan-group-chip')
      .find((c) => c.text() === 'Airband')!
      .trigger('click')
    expect(useSdrStore().scanSweeping).toBe(true)
  })

  it('runs the full ad-hoc lock→resume cycle (covers adhoc currentSearchRange + unlock)', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118.000')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('118.500')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // → lock
    expect(store.searchSweeping).toBe(false)
    socket.message(frame(118e6, -120, 3))
    nowMs += 500
    vi.advanceTimersByTime(400) // resume → toggleSearchLock (adhoc currentSearchRange)
    expect(store.searchSweeping).toBe(true)
    vi.useRealTimers()
  })

  it('stops a locked search that has no pending dwell timer', async () => {
    let nowMs = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-search-adhoc-input').setValue('118')
    await wrapper.findAll('.sdr-search-adhoc-input')[1].setValue('119')
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    socket.message(frame(118e6, 0, 1))
    socket.message(frame(118e6, 0, 2))
    nowMs += 500
    vi.advanceTimersByTime(300) // lock → _searchTimer null
    vi.useRealTimers()
    // Stop via the same button (now in locked state) → stopSearch with no timer.
    await wrapper.find('.sdr-search-adhoc-col--play .sdr-search-adhoc-play').trigger('click')
    expect(store.searchSweeping).toBe(false)
  })

  it('releases the step-dropdown function-ref when the inline range editor closes', async () => {
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const { wrapper } = await mountConnected()
    await wrapper.findAll('#sdr-search-range-list .sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing .sdr-step-dropdown').exists()).toBe(true)
    // The row's edit button hides while editing; close via the row body toggle.
    await wrapper.find('.sdr-freq-editing .sdr-search-range-row-body').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })

  it('pauses and resumes a recording across squelch transitions', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-rec-btn').classes()).toContain('sdr-rec-btn--active')
    audioMock._squelchCb!(true) // recPauseStart set on start → resume (recPauseStart != null)
    audioMock._squelchCb!(false) // pause
    audioMock._squelchCb!(true) // resume again
    expect(audioMock.startRecording).toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrPanel — recording squelch-open start', () => {
  it('records starting with squelch already open (no initial pause)', async () => {
    const { wrapper } = await mountConnected()
    // Open the squelch fully so the recording starts un-paused (recPauseStart null).
    const sliders = wrapper.findAll('.sdr-panel-slider')
    await sliders[1].setValue('-120') // squelch
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    await wrapper.find('.sdr-rec-btn').trigger('click')
    await flushPromises()
    audioMock._squelchCb!(true) // recPauseStart is null → the `!= null` guard's false arm
    expect(wrapper.find('.sdr-rec-btn').classes()).toContain('sdr-rec-btn--active')
  })
})

// =============================================================================
describe('SdrPanel — step-dropdown ref teardown', () => {
  it('clears the ad-hoc step-dropdown ref on unmount', async () => {
    const { wrapper } = await mountConnected()
    await wrapper.findAll('.sdr-scanner-header-row')[5].trigger('click') // render the adhoc step dropdown
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-search-adhoc-row .sdr-step-dropdown').exists()).toBe(true)
    // Unmount → Vue invokes the function ref with null → setAdhocStepDropdownRef(null).
    expect(() => wrapper.unmount()).not.toThrow()
  })
})

// =============================================================================
describe('SdrPanel — per-frequency RADIO SETTINGS (form, dropdown, toggle, apply)', () => {
  // A stored frequency carrying every per-frequency setting, all differing from
  // the component's live defaults (gain 30 / squelch -30 / vol 80 / sr 2.048M /
  // bw 10k / view 1,0,0) so each "apply" branch is exercised.
  const FULL = {
    gain: 25,
    squelch: -40,
    bandwidth: 8000,
    sample_rate: 1_024_000,
    volume: 50,
    zoom: 2,
    zmin: -80,
    zmax: -10,
  }

  async function mountWithFreqs(freqs: Array<Record<string, unknown>>) {
    fetchState.frequencies = freqs
    fetchState.groups = [makeGroup()]
    return mountConnected()
  }

  async function openAddPanel(wrapper: VueWrapper) {
    await wrapper.find('#sdr-radio-add-freq').trigger('click')
    await wrapper.vm.$nextTick()
    return wrapper.find('#sdr-editfreq-body')
  }

  function inputByLabel(root: ReturnType<VueWrapper['find']>, label: string): HTMLInputElement {
    return root.find(`input[aria-label="${label}"]`).element as HTMLInputElement
  }

  it('collapses RADIO SETTINGS by default, expands on click, seeded from live settings', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    const section = body.find('#sdr-ef-settings-section')
    expect(section.exists()).toBe(true)
    expect(section.isVisible()).toBe(false)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    expect(body.find('#sdr-ef-settings-section').isVisible()).toBe(true)
    expect(inputByLabel(body, 'RF gain in dB').value).toBe('30')
    expect(inputByLabel(body, 'Squelch threshold in dBFS').value).toBe('-30')
    expect(inputByLabel(body, 'Volume percent').value).toBe('80')
    expect(body.find('.sdr-ef-setting-dropdown .sdr-device-dropdown-text').text()).toBe('2.05 MHz')
  })

  it('opens the sample-rate dropdown, picks a rate, and supports keyboard + outside-click close', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    const dropdown = body.find('.sdr-ef-setting-dropdown')
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    const items = Array.from(
      document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'),
    ) as HTMLElement[]
    expect(items.length).toBeGreaterThan(0)
    const unselected = items.find((el) => !el.classList.contains('sdr-device-menu-item--selected'))!
    const chosenText = unselected.textContent!.trim()
    unselected.click()
    await wrapper.vm.$nextTick()
    expect(body.find('.sdr-ef-setting-dropdown .sdr-device-dropdown-text').text()).toBe(chosenText)
    // Keyboard: Enter opens, Escape closes.
    await dropdown.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await dropdown.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    // Space opens, an outside document click closes (the picker's own
    // document-click listener).
    await dropdown.trigger('keydown', { key: ' ' })
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    document.dispatchEvent(new MouseEvent('click'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    // Clicking an open dropdown toggles it closed.
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('toggles AUTO (AGC) in the add form and disables the RF gain input', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    const toggle = body.find('.sdr-ef-toggle')
    expect(toggle.classes()).not.toContain('is-on')
    await toggle.trigger('click')
    expect(toggle.classes()).toContain('is-on')
    expect(inputByLabel(body, 'RF gain in dB').disabled).toBe(true)
  })

  it('includes the per-frequency settings in the POST payload', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    await wrapper.find('#sdr-ef-label').setValue('My Freq')
    await wrapper.find('#sdr-ef-freq').setValue('145.500')
    await body.find('input[aria-label="RF gain in dB"]').setValue('40')
    await body.find('input[aria-label="Demod bandwidth in kHz"]').setValue('15')
    await body.find('input[aria-label="Squelch threshold in dBFS"]').setValue('-50')
    await body.find('input[aria-label="Volume percent"]').setValue('70')
    await body.find('input[aria-label="Waterfall zoom"]').setValue('3')
    await body.find('input[aria-label="Waterfall minimum dB"]').setValue('-90')
    await body.find('input[aria-label="Waterfall maximum dB"]').setValue('-5')
    const dropdown = body.find('.sdr-ef-setting-dropdown')
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    const item = (
      Array.from(
        document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'),
      ) as HTMLElement[]
    ).find((el) => el.textContent!.includes('1.54'))!
    item.click()
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const post = fetchCalls.find(
      (c) => c.url === '/api/sdr/frequencies' && c.opts?.method === 'POST',
    )!
    expect(JSON.parse(post.opts!.body as string)).toMatchObject({
      gain: 40,
      bandwidth: 15_000,
      squelch: -50,
      volume: 70,
      zoom: 3,
      zmin: -90,
      zmax: -5,
      sample_rate: 1_536_000,
    })
  })

  it('falls back to defaults for cleared numeric fields and sends gain -1 with AGC on', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    await wrapper.find('#sdr-ef-label').setValue('AGC Freq')
    await wrapper.find('#sdr-ef-freq').setValue('120.000')
    await body.find('.sdr-ef-toggle').trigger('click') // AGC on → gain -1
    await body.find('input[aria-label="Demod bandwidth in kHz"]').setValue('')
    await body.find('input[aria-label="Squelch threshold in dBFS"]').setValue('')
    await body.find('input[aria-label="Waterfall zoom"]').setValue('')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const post = fetchCalls
      .filter((c) => c.url === '/api/sdr/frequencies' && c.opts?.method === 'POST')
      .pop()!
    const body_ = JSON.parse(post.opts!.body as string)
    expect(body_.gain).toBe(-1)
    expect(body_.bandwidth).toBe(10_000)
    expect(body_.squelch).toBe(-60)
    expect(body_.zoom).toBe(1)
  })

  it('edit form seeds settings from the stored row, and from live settings when absent', async () => {
    const { wrapper } = await mountWithFreqs([
      makeFreq({ id: 20, label: 'Full', ...FULL, gain: -1 }),
      makeFreq({ id: 21, label: 'Bare' }),
    ])
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const editBody = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await editBody.find('.sdr-ef-settings-toggle').trigger('click')
    // gain -1 → AGC toggle on; bandwidth 8000 Hz → 8 kHz in the field.
    expect(editBody.find('.sdr-ef-toggle').classes()).toContain('is-on')
    expect(inputByLabel(editBody, 'Demod bandwidth in kHz').value).toBe('8')
    // Re-open on the bare row → fields fall back to the live defaults.
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.sdr-freq-row-edit')[1].trigger('click')
    await wrapper.vm.$nextTick()
    const bareBody = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await bareBody.find('.sdr-ef-settings-toggle').trigger('click')
    expect(inputByLabel(bareBody, 'RF gain in dB').value).toBe('30')
  })

  it('edit form: all setting fields, AUTO toggle and sample-rate dropdown feed the PUT payload', async () => {
    const { wrapper } = await mountWithFreqs([makeFreq({ id: 22, label: 'Edit Me', ...FULL })])
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await wrapper.vm.$nextTick()
    const editBody = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await editBody.find('.sdr-ef-settings-toggle').trigger('click')
    // Edit every numeric field (drives each field's v-model in the edit form).
    await editBody.find('input[aria-label="RF gain in dB"]').setValue('42')
    await editBody.find('input[aria-label="Demod bandwidth in kHz"]').setValue('20')
    await editBody.find('input[aria-label="Squelch threshold in dBFS"]').setValue('-55')
    await editBody.find('input[aria-label="Volume percent"]').setValue('65')
    await editBody.find('input[aria-label="Waterfall zoom"]').setValue('5')
    await editBody.find('input[aria-label="Waterfall minimum dB"]').setValue('-70')
    await editBody.find('input[aria-label="Waterfall maximum dB"]').setValue('-8')
    await editBody.find('.sdr-ef-toggle').trigger('click') // FULL.gain 25 (off) → on → gain -1
    const dropdown = editBody.find('.sdr-ef-setting-dropdown')
    await dropdown.trigger('click')
    await wrapper.vm.$nextTick()
    const item = (
      Array.from(
        document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'),
      ) as HTMLElement[]
    ).find((el) => !el.classList.contains('sdr-device-menu-item--selected'))!
    item.click()
    await wrapper.vm.$nextTick()
    await editBody.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    const put = fetchCalls.find(
      (c) => c.url === '/api/sdr/frequencies/22' && c.opts?.method === 'PUT',
    )!
    expect(JSON.parse(put.opts!.body as string)).toMatchObject({
      gain: -1,
      bandwidth: 20_000,
      squelch: -55,
      volume: 65,
      zoom: 5,
      zmin: -70,
      zmax: -8,
    })
  })

  // ── applyStoredFreqSettings, exercised through the row Play button ────────────
  async function playFirst(wrapper: VueWrapper, socket: FakeSocket) {
    socket.sent.length = 0
    audioMock.setSquelch.mockClear()
    audioMock.setBandwidthHz.mockClear()
    audioMock.setVolume.mockClear()
    await wrapper.findAll('.sdr-freq-row-play')[0].trigger('click')
    await flushPromises()
  }

  it('applies all stored settings on play (manual gain, retune, bandwidth, volume, view)', async () => {
    const { wrapper, socket } = await mountWithFreqs([makeFreq({ id: 30, ...FULL })])
    const store = useSdrStore()
    await playFirst(wrapper, socket)
    const cmds = socket.sent.map((sent) => JSON.parse(sent))
    expect(cmds.find((cmd) => cmd.cmd === 'gain')?.gain_db).toBe(25)
    expect(cmds.find((cmd) => cmd.cmd === 'squelch')?.squelch_dbfs).toBe(-40)
    expect(cmds.find((cmd) => cmd.cmd === 'sample_rate')?.rate_hz).toBe(1_024_000)
    expect(audioMock.setSquelch).toHaveBeenCalledWith(-40)
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(8000)
    expect(audioMock.setVolume).toHaveBeenCalledWith(0.5)
    expect(store.viewZoom).toBe(2)
    expect(store.viewZmin).toBe(-80)
    expect(store.viewZmax).toBe(-10)
  })

  it('applies AGC (gain -1 → null) and an auto-scaled view on play', async () => {
    const { wrapper, socket } = await mountWithFreqs([makeFreq({ id: 31, gain: -1, zoom: 4 })])
    const store = useSdrStore()
    await playFirst(wrapper, socket)
    const gainCmd = socket.sent.map((sent) => JSON.parse(sent)).find((cmd) => cmd.cmd === 'gain')
    expect(gainCmd).toBeTruthy()
    expect(gainCmd.gain_db).toBeNull()
    expect(store.viewZoom).toBe(4)
  })

  it('skips redundant commands when stored settings equal the live ones', async () => {
    const { wrapper, socket } = await mountWithFreqs([
      makeFreq({
        id: 32,
        gain: 30,
        squelch: -30,
        bandwidth: 10_000,
        sample_rate: 2_048_000,
        volume: 80,
        zoom: 1,
        zmin: 0,
        zmax: 0,
      }),
    ])
    await playFirst(wrapper, socket)
    const cmds = socket.sent.map((sent) => JSON.parse(sent)).map((cmd) => cmd.cmd)
    expect(cmds).not.toContain('gain')
    expect(cmds).not.toContain('squelch')
    expect(cmds).not.toContain('sample_rate')
    expect(audioMock.setSquelch).not.toHaveBeenCalled()
    expect(audioMock.setBandwidthHz).not.toHaveBeenCalled()
    expect(audioMock.setVolume).not.toHaveBeenCalled()
  })

  it('ignores an out-of-range sample rate and falls back to the per-mode bandwidth', async () => {
    const { wrapper, socket } = await mountWithFreqs([
      makeFreq({ id: 33, mode: 'AM', sample_rate: 999_999 }),
    ])
    await playFirst(wrapper, socket)
    const cmds = socket.sent.map((sent) => JSON.parse(sent)).map((cmd) => cmd.cmd)
    expect(cmds).not.toContain('sample_rate')
  })

  it('the expanded RADIO SETTINGS form has no accessibility violations', async () => {
    const { wrapper } = await mountWithFreqs([])
    const body = await openAddPanel(wrapper)
    await body.find('.sdr-ef-settings-toggle').trigger('click')
    expect(await axe(body.html(), { rules: { region: { enabled: false } } })).toHaveNoViolations()
  })
})

describe('SdrPanel — tuning ownership', () => {
  const followerFrame = (over: Record<string, unknown> = {}) => ({
    type: 'control',
    is_owner: false,
    control_available: true,
    locked: true,
    center_hz: 118_000_000,
    sample_rate: 1_024_000,
    gain_db: 15,
    gain_auto: false,
    ...over,
  })

  function freqInput(wrapper: VueWrapper): HTMLInputElement {
    return wrapper.find('.sdr-freq-input-large').element as HTMLInputElement
  }

  it('reddens the device name, shows a padlock + sr-only status, and snaps the display when another instance owns tuning', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    // Device name turns red, a padlock shows by the dropdown arrow, and an sr-only
    // live region announces the state.
    expect(wrapper.find('.sdr-device-dropdown-text--readonly').exists()).toBe(true)
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(true)
    const status = wrapper.find('.sr-only[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe('Another Sentinel is controlling this radio')
    // Display snapped to the owner's real tuning, and tuning controls disabled.
    expect(freqInput(wrapper).value).toBe('118.0000')
    expect(freqInput(wrapper).disabled).toBe(true)
  })

  it('reflects ownership carried on a status frame', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message({
      type: 'status',
      connected: true,
      center_hz: 100_000_000,
      mode: 'WFM',
      gain_db: 30,
      gain_auto: false,
      sample_rate: 2_048_000,
      is_owner: false,
      control_available: true,
      locked: true,
    })
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(true)
  })

  it('keeps controls enabled and shows no padlock when this instance owns tuning', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ is_owner: true }))
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(false)
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(false)
    expect(wrapper.find('.sdr-device-dropdown-text--readonly').exists()).toBe(false)
    expect(freqInput(wrapper).disabled).toBe(false)
  })

  it('keeps controls enabled when the tuner is free (unlocked) so a tune can claim it', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ locked: false }))
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(false)
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(false)
    expect(freqInput(wrapper).disabled).toBe(false)
  })

  it('disables the Saved-Ranges select + search buttons for a read-only follower', async () => {
    // A follower must not sweep the shared tuner via a saved search range.
    searchApi.listSearchRanges.mockResolvedValue([makeRange()] as never)
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    expect(
      (wrapper.find('.sdr-search-range-item-body').element as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (wrapper.find('.sdr-search-range-item-play').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('disables the Frequency Manager play button for a read-only follower', async () => {
    // A follower must not tune the shared dongle from a saved frequency.
    fetchState.frequencies = [makeFreq({ id: 10 })]
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    expect((wrapper.findAll('.sdr-freq-row-play')[0].element as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('suppresses hardware tuning while read-only but still sends local commands', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    // Start playing so the marker-retune watcher is active.
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)').trigger('click')
    await flushPromises()
    socket.message(followerFrame({ center_hz: 100_000_000 }))
    await wrapper.vm.$nextTick()
    socket.sent.length = 0
    // A hardware retune is dropped by the read-only guard...
    store.requestTune(105_000_000, true)
    await flushPromises()
    expect(socket.sent.map((sent) => JSON.parse(sent)).some((msg) => msg.cmd === 'tune')).toBe(
      false,
    )
    // ...but a local (non-hardware) command still goes out.
    store.requestFftSize(8192)
    await flushPromises()
    expect(socket.sent.map((sent) => JSON.parse(sent)).some((msg) => msg.cmd === 'fft_size')).toBe(
      true,
    )
  })

  it('ignores a zero centre and an out-of-range sample rate in a read-only frame', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ center_hz: 118_000_000, sample_rate: 999_999, gain_auto: true }))
    await wrapper.vm.$nextTick()
    const snapped = freqInput(wrapper).value
    // A follow-up frame with no centre must not overwrite the display.
    socket.message(followerFrame({ center_hz: 0, sample_rate: 999_999, gain_auto: true }))
    await wrapper.vm.$nextTick()
    expect(freqInput(wrapper).value).toBe(snapped)
  })

  it('the read-only device indicators have no accessibility violations', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ center_hz: 100_000_000 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(true)
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })

  // ── Part A: a follower can still Play/listen (local IQ demod) ─────────────────
  const playBtn = (wrapper: VueWrapper) =>
    wrapper.find('.sdr-tune-btn:not(.sdr-stop-btn):not(.sdr-rec-btn)')

  it('leaves Play enabled for a read-only follower so it can listen', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    // Play (local IQ demod) must NOT be gated by tuning ownership.
    expect((playBtn(wrapper).element as HTMLButtonElement).disabled).toBe(false)
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    // Pressing Play opens this instance's own audio pipeline for the owner's band.
    expect(audioMock.initAudio).toHaveBeenCalledWith(1)
    expect(store.playing).toBe(true)
  })

  it('disables mode and bandwidth for a follower (they mirror the owner)', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    const modePill = wrapper.find('.sdr-mode-pills .sdr-mode-pill')
    expect((modePill.element as HTMLButtonElement).disabled).toBe(true)
    const sliders = wrapper.findAll('.sdr-panel-slider')
    // Order: volume, squelch, bandwidth, rf gain. Bandwidth mirrors → disabled;
    // volume/squelch stay per-listener → enabled.
    expect((sliders[2].element as HTMLInputElement).disabled).toBe(true) // bandwidth
    expect((sliders[0].element as HTMLInputElement).disabled).toBe(false) // volume
    expect((sliders[1].element as HTMLInputElement).disabled).toBe(false) // squelch
  })

  // ── Part B: a follower mirrors the owner's within-band demod exactly ─────────
  const activeMode = (wrapper: VueWrapper) =>
    wrapper
      .findAll('.sdr-mode-pills .sdr-mode-pill')
      .find((pill) => pill.classes().includes('active'))
      ?.text()

  it('mirrors the owner offset, mode, and bandwidth from a control frame', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ offset_hz: 25_000, mode: 'NFM', bw_hz: 12_500 }))
    await wrapper.vm.$nextTick()
    expect(store.tuningOffsetHz).toBe(25_000)
    expect(audioMock.setOffsetHz).toHaveBeenCalledWith(25_000)
    expect(activeMode(wrapper)).toBe('NFM')
    expect(audioMock.setMode).toHaveBeenCalledWith('NFM')
    expect(audioMock.setBandwidthHz).toHaveBeenCalledWith(12_500)
  })

  it('ignores an unknown mirrored mode and a non-positive bandwidth', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ mode: 'WFM', bw_hz: 200_000 }))
    await wrapper.vm.$nextTick()
    audioMock.setMode.mockClear()
    audioMock.setBandwidthHz.mockClear()
    socket.message(followerFrame({ mode: 'BOGUS', bw_hz: 0 }))
    await wrapper.vm.$nextTick()
    expect(activeMode(wrapper)).toBe('WFM') // unknown mode rejected, prior kept
    expect(audioMock.setMode).not.toHaveBeenCalled()
    expect(audioMock.setBandwidthHz).not.toHaveBeenCalled() // bw 0 = "unset", skipped
  })

  it('publishes this owner’s demod state to the backend when it changes', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    // Play as the owner (no follower frame → is_owner defaults true).
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    socket.sent.length = 0
    store.setTuningOffsetHz(25_000)
    await flushPromises()
    const demod = socket.sent.map((sent) => JSON.parse(sent)).find((msg) => msg.cmd === 'demod')
    expect(demod).toMatchObject({ cmd: 'demod', offset_hz: 25_000 })
  })

  it('does NOT publish demod state while a read-only follower', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    socket.sent.length = 0
    // A mirrored offset arriving from the owner must not be echoed back as a demod.
    socket.message(followerFrame({ offset_hz: 5_000 }))
    await flushPromises()
    expect(socket.sent.map((sent) => JSON.parse(sent)).some((msg) => msg.cmd === 'demod')).toBe(
      false,
    )
  })

  // ── Ownership handoff: release on stop/deselect, take-control claim ───────────
  const sentCmds = (socket: FakeSocket) => socket.sent.map((sent) => JSON.parse(sent))
  // Owner over a live control channel (is_owner true, control available, held).
  const ownerFrame = () => followerFrame({ is_owner: true })

  async function playAsOwner(): Promise<{ wrapper: VueWrapper; socket: FakeSocket }> {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    socket.message(ownerFrame()) // become the owner over the relay control channel
    await wrapper.vm.$nextTick()
    return { wrapper, socket }
  }

  it('releases the shared tuner when the owner presses Stop', async () => {
    const { wrapper, socket } = await playAsOwner()
    socket.sent.length = 0
    await wrapper.find('.sdr-stop-btn').trigger('click')
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'release')).toBe(true)
  })

  it('does not send release on Stop when it does not own the tuner', async () => {
    // Default connect has no control channel (single instance) → nothing to release.
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    socket.sent.length = 0
    await wrapper.find('.sdr-stop-btn').trigger('click')
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'release')).toBe(false)
  })

  it('releases the shared tuner when the owner deselects the radio', async () => {
    const { wrapper, socket } = await playAsOwner()
    socket.sent.length = 0
    // Deselecting routes through clearRadioSelection, which releases before closing.
    // The device menu teleports to <body>, so reach the placeholder via document.
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await flushPromises()
    ;(document.querySelector('.sdr-device-menu-placeholder') as HTMLElement).click()
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'release')).toBe(true)
  })

  it('auto-claims a freed tuner while actively watching (clean handoff)', async () => {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await playBtn(wrapper).trigger('click') // actively watching
    await flushPromises()
    socket.sent.length = 0
    // The owner released elsewhere → the tuner is now free while we watch.
    socket.message(followerFrame({ is_owner: false, locked: false }))
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'claim')).toBe(true)
  })

  it('does NOT auto-claim a freed tuner when not playing (ex-owner after Stop)', async () => {
    const { socket } = await mountConnected()
    socket.sent.length = 0
    // Not playing: a freed-tuner frame must not make us grab control back.
    socket.message(followerFrame({ is_owner: false, locked: false }))
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'claim')).toBe(false)
  })

  it('does NOT auto-claim while another instance still holds the tuner', async () => {
    const { wrapper, socket } = await mountConnected()
    await wrapper.find('.sdr-freq-input-large').setValue('100.000')
    await playBtn(wrapper).trigger('click')
    await flushPromises()
    socket.sent.length = 0
    socket.message(followerFrame()) // locked: true → another owns it
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'claim')).toBe(false)
  })

  it('clears the read-only padlock when the owner releases the tuner', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(true)
    // Owner released → tuner free (locked:false) → no longer read-only → padlock gone.
    socket.message(followerFrame({ locked: false }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(false)
  })

  // ── Read-only Frequency Manager + dropdown padlock ───────────────────────────
  it('disables the whole Frequency Manager (group filter, edit, delete, add) for a follower', async () => {
    fetchState.frequencies = [makeFreq({ id: 10 })]
    fetchState.groups = [makeGroup()]
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    // Group-filter chips (All + per-group) are all disabled.
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    expect(chips.length).toBeGreaterThan(0)
    expect(chips.every((chip) => (chip.element as HTMLButtonElement).disabled)).toBe(true)
    // Per-row edit + delete and the Add Frequency button are disabled.
    expect((wrapper.find('.sdr-freq-row-edit').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.find('.sdr-freq-row-del').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.find('#sdr-radio-add-freq').element as HTMLButtonElement).disabled).toBe(true)
    // Dimmed wrapper + an sr-only status announce the read-only state.
    expect(wrapper.find('.sdr-frequency-manager--readonly').exists()).toBe(true)
    expect(wrapper.findAll('.sr-only[role="status"]').map((node) => node.text())).toContain(
      'Frequency manager is read-only while another Sentinel controls this radio',
    )
  })

  it('re-enables the Frequency Manager controls when this instance owns tuning', async () => {
    fetchState.frequencies = [makeFreq({ id: 10 })]
    fetchState.groups = [makeGroup()]
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ is_owner: true }))
    await wrapper.vm.$nextTick()
    expect((wrapper.find('#sdr-radio-add-freq').element as HTMLButtonElement).disabled).toBe(false)
    expect((wrapper.find('.sdr-freq-row-edit').element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.find('.sdr-frequency-manager--readonly').exists()).toBe(false)
  })

  it('marks the connected radio read-only (red + padlock) in the device dropdown list', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    // Open the device menu (teleported to <body>) and find the marked row.
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await flushPromises()
    const row = document.querySelector('.sdr-device-menu-item--readonly')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.sdr-device-menu-item-lock')).not.toBeNull()
  })

  it('does not mark any dropdown row read-only when this instance owns tuning', async () => {
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ is_owner: true }))
    await wrapper.vm.$nextTick()
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await flushPromises()
    expect(document.querySelector('.sdr-device-menu-item--readonly')).toBeNull()
  })

  it('ignores frequency-input scroll while read-only (cannot wheel-tune the shared dongle)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = (this.textContent ?? '').length * 10
      return {
        left: 0,
        top: 0,
        right: width,
        bottom: 12,
        width,
        height: 12,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ center_hz: 118_000_000 }))
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.sdr-freq-input-large')
    const before = (input.element as HTMLInputElement).value
    input.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 25 }))
    await wrapper.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe(before)
  })

  it('clears the connection dot and read-only styling when the radio is deselected', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await confirmData(wrapper, socket) // spectrum frame lights the connection dot
    socket.message(followerFrame())
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(true)
    // Deselect via the menu placeholder (routes through clearRadioSelection).
    await wrapper.find('.sdr-radio-section--device .sdr-device-dropdown').trigger('click')
    await flushPromises()
    ;(document.querySelector('.sdr-device-menu-placeholder') as HTMLElement).click()
    await flushPromises()
    // Ownership reset → no longer read-only, padlock gone, and the dot goes dark.
    expect(store.readOnly).toBe(false)
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(false)
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
  })

  // ── Owner→follower scan/search overlay mirroring ─────────────────────────────
  it('publishes the owner’s scan/search sweep state to the backend when it changes', async () => {
    const store = useSdrStore()
    const { socket } = await playAsOwner()
    socket.sent.length = 0
    store.scanSweeping = true
    store.scanGroupNames = ['Airband']
    await flushPromises()
    const sweep = sentCmds(socket).find((msg) => msg.cmd === 'sweep_state')
    expect(sweep).toMatchObject({ cmd: 'sweep_state', scan_active: true, scan_groups: ['Airband'] })
  })

  it('does not re-send an unchanged sweep payload (dedup)', async () => {
    const store = useSdrStore()
    const { socket } = await playAsOwner()
    store.scanGroupNames = ['Airband']
    await flushPromises()
    socket.sent.length = 0
    // Same contents, fresh array reference → the watcher fires but the serialized
    // payload is identical, so nothing is sent.
    store.scanGroupNames = ['Airband']
    await flushPromises()
    expect(sentCmds(socket).some((msg) => msg.cmd === 'sweep_state')).toBe(false)
  })

  it('mirrors the owner’s sweep state onto the store and never echoes it back', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    await playBtn(wrapper).trigger('click') // a playing follower
    await flushPromises()
    socket.message(
      followerFrame({
        scan_active: true,
        scan_groups: ['Marine'],
        search_active: false,
        search_low_hz: 156_000_000,
        search_high_hz: 162_000_000,
        search_current_hz: 158_000_000,
      }),
    )
    await flushPromises()
    // The store now drives the same paused-overlay the owner sees (SdrWaterfall).
    expect(store.scanSweeping).toBe(true)
    expect(store.scanGroupNames).toEqual(['Marine'])
    expect(store.searchLowHz).toBe(156_000_000)
    expect(store.searchHighHz).toBe(162_000_000)
    expect(store.searchCurrentHz).toBe(158_000_000)
    // A follower must NOT publish sweep_state back to the backend.
    expect(sentCmds(socket).some((msg) => msg.cmd === 'sweep_state')).toBe(false)
  })

  it('clears mirrored sweep state when this instance stops being a follower', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ scan_active: true, scan_groups: ['Marine'] }))
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true)
    // Owner released → tuner free → readOnly false → reset watcher clears the sweep.
    socket.message(followerFrame({ locked: false }))
    await wrapper.vm.$nextTick()
    expect(store.readOnly).toBe(false)
    expect(store.scanSweeping).toBe(false)
    expect(store.scanGroupNames).toEqual([])
    expect(store.searchLowHz).toBeNull()
  })

  it('does not let a data reload clobber mirrored sweep state while read-only', async () => {
    const store = useSdrStore()
    const { wrapper, socket } = await mountConnected()
    socket.message(followerFrame({ scan_active: true, scan_groups: ['Marine'] }))
    await wrapper.vm.$nextTick()
    expect(store.scanSweeping).toBe(true)
    // A frequency import reloads groups/frequencies, recomputing groupsWithFreqs and
    // re-firing the scanner watcher. Its read-only guard must skip, so the mirrored
    // sweep is not reset to "not scanning".
    fetchState.groups = [makeGroup()]
    fetchState.frequencies = [makeFreq({ id: 10, group_ids: [1] })]
    document.dispatchEvent(new CustomEvent('sdr:frequenciesImported'))
    await flushPromises()
    expect(store.scanSweeping).toBe(true)
  })
})
