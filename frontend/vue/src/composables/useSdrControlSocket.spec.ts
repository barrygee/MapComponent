import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useSdrControlSocket, type UseSdrControlSocketOptions } from './useSdrControlSocket'
import { useSdrStore } from '@/stores/sdr'

/** Minimal WebSocket stand-in the composable can drive end to end. */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  private listeners: Record<string, Array<(event: unknown) => void>> = {}
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  send(payload: string) {
    this.sent.push(payload)
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
  emit(type: string, event: unknown = {}) {
    // A real WebSocket is CLOSED by the time its 'close' event dispatches.
    if (type === 'close') this.readyState = FakeWebSocket.CLOSED
    for (const listener of this.listeners[type] ?? []) listener(event)
  }
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit('open')
  }
  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!
  }
}

let connectStatus = 200
let connectBody: Record<string, unknown> = {}
let statusBody: Record<string, unknown> = { connected: false }
let statusOk = true
let statusRejects = false
const fetchMock = vi.fn(async (url: string) => {
  if (String(url).startsWith('/api/sdr/connect'))
    return { status: connectStatus, json: async () => connectBody }
  if (String(url).startsWith('/api/sdr/status/')) {
    if (statusRejects) throw new TypeError('offline')
    return { ok: statusOk, json: async () => statusBody }
  }
  throw new Error(`unexpected fetch ${url}`)
})

function createHarness(overrides: Partial<UseSdrControlSocketOptions> = {}) {
  const onSocketOpen = vi.fn()
  const onSocketMessage = vi.fn()
  const onSocketDown = vi.fn()
  const onRadioMissing = vi.fn()
  const onDeviceUnavailable = vi.fn()
  const onReachable = vi.fn()
  const options: UseSdrControlSocketOptions = {
    sdrStore: () => useSdrStore(),
    onSocketOpen,
    onSocketMessage,
    onSocketDown,
    onRadioMissing,
    onDeviceUnavailable,
    onReachable,
    isRadioStillSelected: () => true,
    isAlreadyConnected: () => false,
    ...overrides,
  }
  const socket = useSdrControlSocket(options)
  return {
    socket,
    onSocketOpen,
    onSocketMessage,
    onSocketDown,
    onRadioMissing,
    onDeviceUnavailable,
    onReachable,
  }
}

/** Opens the control socket for the given radio and fires its 'open' event. */
async function openAndConnect(socket: ReturnType<typeof createHarness>['socket'], radioId = 1) {
  const openPromise = socket.openControlSocket(radioId)
  await flushPromises()
  await openPromise
  FakeWebSocket.latest().open()
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('fetch', fetchMock)
  FakeWebSocket.instances = []
  fetchMock.mockClear()
  connectStatus = 200
  statusBody = { connected: false }
  statusOk = true
  statusRejects = false
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useSdrControlSocket — sendCmd', () => {
  it('sends JSON over an open socket', async () => {
    const { socket } = createHarness()
    await openAndConnect(socket)
    socket.sendCmd({ cmd: 'mode', mode: 'NFM' })
    expect(FakeWebSocket.latest().sent.map((raw) => JSON.parse(raw))).toContainEqual({
      cmd: 'mode',
      mode: 'NFM',
    })
  })

  it('suppresses hardware-tuning commands while a read-only follower', async () => {
    const { socket } = createHarness()
    await openAndConnect(socket)
    useSdrStore().setOwnership(false, true, true) // readOnly
    FakeWebSocket.latest().sent.length = 0
    socket.sendCmd({ cmd: 'tune', frequency_hz: 100_000_000 })
    socket.sendCmd({ cmd: 'gain', gain_db: 20 })
    socket.sendCmd({ cmd: 'sample_rate', rate_hz: 1_024_000 })
    expect(FakeWebSocket.latest().sent).toHaveLength(0)
  })

  it('still passes local/demod commands through while read-only', async () => {
    const { socket } = createHarness()
    await openAndConnect(socket)
    useSdrStore().setOwnership(false, true, true)
    FakeWebSocket.latest().sent.length = 0
    socket.sendCmd({ cmd: 'mode', mode: 'AM' })
    expect(FakeWebSocket.latest().sent).toHaveLength(1)
  })

  it('clears a non-zero demod NCO offset on any hardware tune', async () => {
    const { socket } = createHarness()
    const store = useSdrStore()
    await openAndConnect(socket)
    store.setTuningOffsetHz(5000)
    socket.sendCmd({ cmd: 'tune', frequency_hz: 100_000_000 })
    expect(store.tuningOffsetHz).toBe(0)
  })

  it('leaves a zero offset untouched and never clears it for non-tune commands', async () => {
    const { socket } = createHarness()
    const store = useSdrStore()
    await openAndConnect(socket)
    const setOffsetSpy = vi.spyOn(store, 'setTuningOffsetHz')
    socket.sendCmd({ cmd: 'tune', frequency_hz: 100_000_000 }) // offset already 0
    store.setTuningOffsetHz(5000)
    setOffsetSpy.mockClear()
    socket.sendCmd({ cmd: 'squelch', squelch_dbfs: -40 })
    expect(setOffsetSpy).not.toHaveBeenCalled()
    expect(store.tuningOffsetHz).toBe(5000)
  })
})

describe('useSdrControlSocket — open/close lifecycle', () => {
  it('POSTs /api/sdr/connect, remembers the radio id and opens the WS', async () => {
    const { socket, onSocketOpen } = createHarness()
    await openAndConnect(socket, 4)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sdr/connect',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ radio_id: 4 }) }),
    )
    expect(sessionStorage.getItem('sdrLastRadioId')).toBe('4')
    expect(FakeWebSocket.latest().url).toContain('/ws/sdr/4')
    expect(onSocketOpen).toHaveBeenCalledWith(4)
    expect(socket.isSocketOpen()).toBe(true)
    expect(socket.isSocketConnecting()).toBe(false)
  })

  it('a 404 from connect clears the stale radio id and reports the radio missing', async () => {
    connectStatus = 404
    const { socket, onRadioMissing } = createHarness()
    await socket.openControlSocket(9)
    await flushPromises()
    expect(sessionStorage.getItem('sdrLastRadioId')).toBeNull()
    expect(onRadioMissing).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(0) // never opened a WS
  })

  it('still opens the WS when the connect POST itself fails (offline backend)', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('offline')
    })
    const { socket } = createHarness()
    await socket.openControlSocket(1)
    await flushPromises()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('re-opening the same radio while its socket is CONNECTING or OPEN is a no-op', async () => {
    const { socket } = createHarness()
    await socket.openControlSocket(1)
    await flushPromises()
    expect(socket.isSocketConnecting()).toBe(true)
    await socket.openControlSocket(1) // CONNECTING — no-op
    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.latest().open()
    await socket.openControlSocket(1) // OPEN — no-op
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('switching radios closes the previous socket and opens a new one', async () => {
    const { socket } = createHarness()
    await openAndConnect(socket, 1)
    const firstSocket = FakeWebSocket.instances[0]!
    await openAndConnect(socket, 2)
    expect(firstSocket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.latest().url).toContain('/ws/sdr/2')
  })

  it('closeControlSocket tears down the socket, timers and the init marker', async () => {
    const { socket } = createHarness()
    await openAndConnect(socket, 5)
    socket.markInitialised(5)
    expect(socket.isInitialised(5)).toBe(true)
    socket.setDataConfirmed(true)
    socket.closeControlSocket()
    expect(FakeWebSocket.latest().readyState).toBe(FakeWebSocket.CLOSED)
    expect(socket.isInitialised(5)).toBe(false)
    expect(socket.isDataConfirmed()).toBe(false)
    expect(socket.isSocketOpen()).toBe(false)
  })

  it('closeControlSocket is safe with nothing open', () => {
    const { socket } = createHarness()
    expect(() => socket.closeControlSocket()).not.toThrow()
  })
})

describe('useSdrControlSocket — message dispatch', () => {
  it('JSON-parses frames and hands them to onSocketMessage', async () => {
    const { socket, onSocketMessage } = createHarness()
    await openAndConnect(socket)
    FakeWebSocket.latest().emit('message', { data: JSON.stringify({ type: 'pong' }) })
    expect(onSocketMessage).toHaveBeenCalledWith({ type: 'pong' })
  })

  it('silently drops malformed frames', async () => {
    const { socket, onSocketMessage } = createHarness()
    await openAndConnect(socket)
    FakeWebSocket.latest().emit('message', { data: 'not-json{' })
    expect(onSocketMessage).not.toHaveBeenCalled()
  })
})

describe('useSdrControlSocket — reconnect + supersede guards', () => {
  it('reconnects after a close with exponential backoff', async () => {
    vi.useFakeTimers()
    const { socket, onSocketDown } = createHarness()
    const openPromise = socket.openControlSocket(1)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await openPromise
    FakeWebSocket.latest().open()
    FakeWebSocket.latest().emit('close')
    expect(onSocketDown).toHaveBeenCalledTimes(1)
    // First retry after 500ms.
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(2)
    // The retry socket fails before opening (a successful open would reset the
    // backoff) — the next retry uses the doubled 1000ms delay, not 500ms.
    FakeWebSocket.latest().emit('close')
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('ignores close/error from a socket that was already switched away from', async () => {
    const { socket, onSocketDown } = createHarness()
    await openAndConnect(socket, 1)
    const staleSocket = FakeWebSocket.instances[0]!
    await openAndConnect(socket, 2)
    onSocketDown.mockClear()
    staleSocket.emit('close')
    staleSocket.emit('error')
    expect(onSocketDown).not.toHaveBeenCalled()
  })

  it('reports the drop for the current radio on an error event', async () => {
    const { socket, onSocketDown } = createHarness()
    await openAndConnect(socket, 1)
    FakeWebSocket.latest().emit('error')
    expect(onSocketDown).toHaveBeenCalledTimes(1)
  })
})

describe('useSdrControlSocket — reachability probe', () => {
  it('lights the dot when the status endpoint reports connected', async () => {
    statusBody = { connected: true }
    const { socket, onReachable } = createHarness()
    await openAndConnect(socket)
    expect(onReachable).toHaveBeenCalledTimes(1)
  })

  it('accepts the alternative reachable flag', async () => {
    statusBody = { connected: false, reachable: true }
    const { socket, onReachable } = createHarness()
    await openAndConnect(socket)
    expect(onReachable).toHaveBeenCalledTimes(1)
  })

  it('retries an unreachable radio a bounded number of times, then gives up', async () => {
    vi.useFakeTimers()
    statusBody = { connected: false }
    const { socket, onReachable } = createHarness()
    const openPromise = socket.openControlSocket(1)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await openPromise
    FakeWebSocket.latest().open()
    const statusCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sdr/status/')).length
    await vi.waitFor(() => expect(statusCalls()).toBe(1))
    // Probe retries every 1500ms up to 4 total attempts, then stops for good.
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    expect(statusCalls()).toBe(4)
    await vi.advanceTimersByTimeAsync(5000)
    expect(statusCalls()).toBe(4)
    expect(onReachable).not.toHaveBeenCalled()
  })

  it('a retry that finds the radio up lights the dot', async () => {
    vi.useFakeTimers()
    statusBody = { connected: false }
    const { socket, onReachable } = createHarness()
    const openPromise = socket.openControlSocket(1)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await openPromise
    FakeWebSocket.latest().open()
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sdr/status/')).length,
      ).toBe(1),
    )
    statusBody = { connected: true } // dongle came back before the retry
    await vi.advanceTimersByTimeAsync(1500)
    await vi.waitFor(() => expect(onReachable).toHaveBeenCalledTimes(1))
  })

  it('stops retrying once something else already lit the dot', async () => {
    vi.useFakeTimers()
    statusBody = { connected: false }
    const { socket } = createHarness({ isAlreadyConnected: () => true })
    const openPromise = socket.openControlSocket(1)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await openPromise
    FakeWebSocket.latest().open()
    const statusCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sdr/status/')).length
    await vi.waitFor(() => expect(statusCalls()).toBe(1))
    await vi.advanceTimersByTimeAsync(6000)
    expect(statusCalls()).toBe(1) // no retries scheduled
  })

  it('treats a failed status fetch as unreachable (and schedules a retry)', async () => {
    vi.useFakeTimers()
    statusRejects = true
    const { socket, onReachable } = createHarness()
    const openPromise = socket.openControlSocket(1)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    await openPromise
    FakeWebSocket.latest().open()
    const statusCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/sdr/status/')).length
    await vi.waitFor(() => expect(statusCalls()).toBe(1))
    await vi.advanceTimersByTimeAsync(1500)
    expect(statusCalls()).toBe(2)
    expect(onReachable).not.toHaveBeenCalled()
  })

  it('treats a non-OK status response as unreachable', async () => {
    statusOk = false
    const { socket, onReachable } = createHarness()
    await openAndConnect(socket)
    expect(onReachable).not.toHaveBeenCalled()
  })
})

describe('useSdrControlSocket — data-confirmed flag and init markers', () => {
  it('tracks the per-connection data-confirmed flag', () => {
    const { socket } = createHarness()
    expect(socket.isDataConfirmed()).toBe(false)
    socket.setDataConfirmed(true)
    expect(socket.isDataConfirmed()).toBe(true)
  })

  it('persists per-radio initialised markers in sessionStorage', () => {
    const { socket } = createHarness()
    expect(socket.isInitialised(3)).toBe(false)
    socket.markInitialised(3)
    expect(socket.isInitialised(3)).toBe(true)
    expect(sessionStorage.getItem('sdrInit_3')).toBe('1')
  })
})

describe('a radio whose device is unavailable', () => {
  /**
   * The refusal that used to retry for ever. `POST /api/sdr/connect` answers
   * 503 when the backend knows the device is unusable — unplugged, disabled, or
   * replugged into another socket — and retrying refuses identically every few
   * seconds, filling the console and never succeeding.
   */
  beforeEach(() => {
    connectStatus = 503
    connectBody = { detail: 'RTL-SDR V4 is unavailable. Device not found.' }
  })

  it('reports the reason instead of opening a socket', async () => {
    const { socket, onDeviceUnavailable } = createHarness()

    await socket.openControlSocket(1)
    await flushPromises()

    expect(onDeviceUnavailable).toHaveBeenCalledWith('RTL-SDR V4 is unavailable. Device not found.')
  })

  it('keeps the stored radio id, unlike a 404', async () => {
    // The radio still exists and its dongle may come back, so the operator's
    // selection is still meaningful — clearing it would lose their choice.
    const { socket } = createHarness()

    await socket.openControlSocket(7)
    await flushPromises()

    expect(sessionStorage.getItem('sdrLastRadioId')).toBe('7')
  })

  it('does not report the radio as missing', async () => {
    const { socket, onRadioMissing } = createHarness()

    await socket.openControlSocket(1)
    await flushPromises()

    expect(onRadioMissing).not.toHaveBeenCalled()
  })

  it('falls back when the error body is not JSON at all', async () => {
    // A proxy or gateway can answer 503 with HTML; the message still has to be
    // something, and it must not throw on the way.
    connectBody = {}
    fetchMock.mockImplementationOnce(async () => ({
      status: 503,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    }))
    const { socket, onDeviceUnavailable } = createHarness()

    await socket.openControlSocket(1)
    await flushPromises()

    expect(onDeviceUnavailable).toHaveBeenCalledWith('That radio is currently unavailable.')
  })

  it('falls back to a general message when the body carries no detail', async () => {
    connectBody = {}
    const { socket, onDeviceUnavailable } = createHarness()

    await socket.openControlSocket(1)
    await flushPromises()

    expect(onDeviceUnavailable).toHaveBeenCalledWith('That radio is currently unavailable.')
  })
})
