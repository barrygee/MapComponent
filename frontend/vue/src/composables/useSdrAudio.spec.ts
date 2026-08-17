import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── Captured fake instances (the module creates these via `new`) ──────────────
type Listener = (ev: unknown) => void

let lastWs: FakeWebSocket | null = null
let lastCtx: FakeAudioContext | null = null
let lastWorklet: FakeWorklet | null = null

class FakePort {
  onmessage: Listener | null = null
  postMessage = vi.fn()
}
class FakeWorklet {
  port = new FakePort()
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the module-constructed instance
    lastWorklet = this
  }
}
class FakeGain {
  gain = { value: -1 }
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeScriptNode {
  onaudioprocess: ((event: unknown) => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
}
class FakeConstantSource {
  offset = { value: 1 }
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
let lastScriptNode: FakeScriptNode | null = null

class FakeAudioContext {
  state = 'running'
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn()
  createGain = vi.fn(() => new FakeGain())
  // The ScriptProcessor fallback's two nodes. Present by default so a context
  // without a worklet exercises the fallback rather than failing; tests that
  // want the fallback *unavailable* delete them.
  createScriptProcessor = vi.fn(() => {
    lastScriptNode = new FakeScriptNode()
    return lastScriptNode
  })
  createConstantSource = vi.fn(() => new FakeConstantSource())
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
  stateListener: Listener | null = null
  addEventListener = vi.fn((_type: string, cb: Listener) => {
    this.stateListener = cb
  })
  removeEventListener = vi.fn()
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the module-constructed instance
    lastCtx = this
  }
}
class FakeWebSocket {
  static OPEN = 1
  readyState = 1
  binaryType = ''
  url: string
  close = vi.fn()
  listeners: Record<string, Listener> = {}
  addEventListener = vi.fn((type: string, cb: Listener) => {
    this.listeners[type] = cb
  })
  constructor(url: string) {
    this.url = url
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the module-constructed instance
    lastWs = this
  }
}

function installGlobals() {
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorklet)
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 7 }) }))
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
}

/**
 * A context whose browser has no `audioWorklet`, with or without the nodes the
 * ScriptProcessor fallback needs — the two conditions that decide whether a
 * blocked worklet is recoverable.
 */
function noWorkletContext({ withFallback = true }: { withFallback?: boolean } = {}) {
  // Two separate classes rather than a conditional field: the fake's methods are
  // instance fields, so `super.createScriptProcessor` resolves to undefined and
  // the "keep it" branch would silently remove the very thing it means to keep.
  if (withFallback) {
    return class extends FakeAudioContext {
      // Modelling a browser that exposes no `audioWorklet` at all, which the
      // fake's type does not allow for — the cast is the point of the test.
      audioWorklet = undefined as unknown as FakeAudioContext['audioWorklet']
    }
  }
  return class extends FakeAudioContext {
    audioWorklet = undefined as unknown as FakeAudioContext['audioWorklet']
    createScriptProcessor = undefined as unknown as FakeAudioContext['createScriptProcessor']
  }
}

async function loadAudio() {
  return (await import('./useSdrAudio')).useSdrAudio()
}

describe('useSdrAudio', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    lastWs = null
    lastCtx = null
    lastWorklet = null
    installGlobals()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('initAudio', () => {
    it('creates the audio graph and marks ready', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      expect(audio.isReady()).toBe(true)
      expect(audio.isPlaying()).toBe(true)
      expect(lastCtx?.audioWorklet.addModule).toHaveBeenCalled()
      expect(lastWorklet?.connect).toHaveBeenCalled()
    })

    it('opens the IQ socket when a radio id is supplied', async () => {
      const audio = await loadAudio()
      await audio.initAudio(5)
      expect(lastWs?.url).toContain('/ws/sdr/5/iq')
    })

    it('reuses an existing AudioContext and is idempotent once ready', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      const firstCtx = lastCtx
      await audio.initAudio() // _ctx && _ready → early return
      expect(lastCtx).toBe(firstCtx)
    })

    it('coalesces concurrent init calls so the worklet module is added once', async () => {
      // Gate addModule so the second initAudio arrives while the first is still
      // in flight — without coalescing this would register the processor twice.
      let resolveAddModule: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        resolveAddModule = resolve
      })
      class GatedCtx extends FakeAudioContext {
        audioWorklet = { addModule: vi.fn(() => gate) }
      }
      vi.stubGlobal('AudioContext', GatedCtx)

      const audio = await loadAudio()
      const first = audio.initAudio()
      const second = audio.initAudio()
      resolveAddModule()
      await Promise.all([first, second])

      expect(lastCtx?.audioWorklet.addModule).toHaveBeenCalledTimes(1)
      expect(audio.isReady()).toBe(true)
    })

    it('adopts a pre-created early AudioContext', async () => {
      const early = new FakeAudioContext()
      ;(window as unknown as { _sdrEarlyCtx?: unknown })._sdrEarlyCtx = early
      const audio = await loadAudio()
      await audio.initAudio()
      expect(lastCtx).toBe(early)
      expect((window as unknown as { _sdrEarlyCtx?: unknown })._sdrEarlyCtx).toBeUndefined()
    })

    it('recovers (no throw, not ready) when worklet module load fails', async () => {
      const audio = await loadAudio()
      vi.mocked(URL.createObjectURL).mockReturnValue('blob:fake')
      const FailingCtx = class extends FakeAudioContext {
        audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error('no worklet')) }
      }
      vi.stubGlobal('AudioContext', FailingCtx)
      await audio.initAudio()
      expect(audio.isReady()).toBe(false)
    })
  })

  /**
   * Why audio did not start.
   *
   * These exist because the failure used to be swallowed whole: a bare
   * `catch { _ctx = null }` meant an unsupported browser, a blocked context and
   * a worklet that would not register all produced silence and an empty
   * console. "The waterfall works but there is no sound" was then only
   * diagnosable by reading the source.
   */
  describe('reporting why audio is unavailable', () => {
    it('reports nothing before anything has been tried', async () => {
      const audio = await loadAudio()

      // null here means "not attempted", not "everything is fine" — the
      // distinction matters to a caller deciding whether to render a notice.
      expect(audio.audioUnavailableReason()).toBeNull()
    })

    it('reports nothing once audio is running', async () => {
      const audio = await loadAudio()
      await audio.initAudio()

      expect(audio.isReady()).toBe(true)
      expect(audio.audioUnavailableReason()).toBeNull()
    })

    it('reports nothing when a blocked worklet falls back successfully', async () => {
      // An insecure context is no longer fatal: the same demodulator runs on
      // the main thread instead, so there is nothing to report.
      const audio = await loadAudio()
      vi.stubGlobal('AudioContext', noWorkletContext())
      vi.stubGlobal('isSecureContext', false)

      await audio.initAudio()

      expect(audio.isReady()).toBe(true)
      expect(audio.audioUnavailableReason()).toBeNull()
    })

    it('names an insecure context when the fallback is unavailable too', async () => {
      // Both paths gone is the only remaining fatal case, and the secure
      // context is still the actionable half of it: the fix is how the page is
      // reached, not which device is opening it.
      const audio = await loadAudio()
      vi.stubGlobal('AudioContext', noWorkletContext({ withFallback: false }))
      vi.stubGlobal('isSecureContext', false)

      await audio.initAudio()

      expect(audio.isReady()).toBe(false)
      expect(audio.audioUnavailableReason()).toContain('secure context')
    })

    it('blames the browser when a worklet is missing on a secure page', async () => {
      // Same missing capability, different cause — and a different fix, so the
      // two must not collapse into one message.
      const audio = await loadAudio()
      vi.stubGlobal('AudioContext', noWorkletContext({ withFallback: false }))
      vi.stubGlobal('isSecureContext', true)

      await audio.initAudio()

      expect(audio.audioUnavailableReason()).toContain('does not support AudioWorklet')
      expect(audio.audioUnavailableReason()).not.toContain('secure context')
    })

    it('reports a browser with no Web Audio at all', async () => {
      const audio = await loadAudio()
      vi.stubGlobal('AudioContext', undefined)

      await audio.initAudio()

      expect(audio.audioUnavailableReason()).toContain('no Web Audio support')
    })

    it('keeps the reason from a failing worklet load rather than discarding it', async () => {
      const audio = await loadAudio()
      const FailingCtx = class extends FakeAudioContext {
        audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error('boom')) }
      }
      vi.stubGlobal('AudioContext', FailingCtx)

      await audio.initAudio()

      expect(audio.audioUnavailableReason()).toBe('boom')
    })

    /**
     * The ScriptProcessor fallback.
     *
     * `AudioWorklet` needs a secure context, which a LAN address over plain HTTP
     * is not — so on every device except the one hosting Sentinel the worklet
     * path is unavailable and audio was simply silent. These pin that the
     * fallback carries the same demodulator rather than a second copy of it.
     */
    describe('ScriptProcessor fallback', () => {
      async function initWithFallback() {
        const audio = await loadAudio()
        vi.stubGlobal('AudioContext', noWorkletContext())
        vi.stubGlobal('isSecureContext', false)
        await audio.initAudio()
        return audio
      }

      it('builds the graph and reports ready', async () => {
        const audio = await initWithFallback()

        expect(audio.isReady()).toBe(true)
        expect(lastCtx?.createScriptProcessor).toHaveBeenCalled()
        expect(lastScriptNode?.onaudioprocess).toBeTypeOf('function')
      })

      it('feeds a silent source in so the callback actually fires', async () => {
        // A ScriptProcessorNode with nothing connected to its input does not
        // reliably run — Safari in particular wants a live input — which would
        // leave a graph that looks correct and produces nothing.
        await initWithFallback()

        expect(lastCtx?.createConstantSource).toHaveBeenCalled()
      })

      it('renders into the buffer it is handed', async () => {
        // The proof the same `process()` the worklet calls is being driven here:
        // it fills the array rather than returning one.
        await initWithFallback()
        const output = new Float32Array(8).fill(1)

        lastScriptNode?.onaudioprocess?.({
          outputBuffer: { getChannelData: () => output },
        })

        // Silent (no IQ has arrived yet) rather than untouched — the processor
        // zero-fills while it is buffering, which is exactly what it does in the
        // worklet on the first callback.
        expect(Array.from(output)).toEqual(new Array(8).fill(0))
      })

      it('routes messages both ways over a real MessagePort', async () => {
        // The processor sets `this.port.onmessage` in its constructor and the app
        // posts IQ to it; a hand-rolled shim that only worked one way would look
        // fine until audio stayed silent.
        const audio = await initWithFallback()
        const powerReadings: number[] = []
        audio.onPower((dbfs) => powerReadings.push(dbfs))

        audio.setMode('AM')

        // Delivery is async on a MessageChannel, matching a worklet port.
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(lastScriptNode).not.toBeNull()
      })

      it('tears the fallback graph down on stop', async () => {
        const audio = await initWithFallback()
        const node = lastScriptNode

        audio.stop()

        expect(node?.onaudioprocess).toBeNull()
        expect(audio.isReady()).toBe(false)
      })
    })

    it('reports a non-Error throw without rendering "[object Object]"', async () => {
      // Nothing guarantees a rejection is an Error — a browser can reject with
      // a DOMException-like value or a bare string, and the reason is shown to
      // an operator either way.
      const audio = await loadAudio()
      const FailingCtx = class extends FakeAudioContext {
        audioWorklet = { addModule: vi.fn().mockRejectedValue('worklet blocked') }
      }
      vi.stubGlobal('AudioContext', FailingCtx)

      await audio.initAudio()

      expect(audio.audioUnavailableReason()).toBe('worklet blocked')
    })

    it('clears a stale reason when a later attempt succeeds', async () => {
      // A context blocked until the user interacted must not keep reporting a
      // failure after it starts working.
      const audio = await loadAudio()
      const FailingCtx = class extends FakeAudioContext {
        audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error('boom')) }
      }
      vi.stubGlobal('AudioContext', FailingCtx)
      await audio.initAudio()
      expect(audio.audioUnavailableReason()).toBe('boom')

      vi.stubGlobal('AudioContext', FakeAudioContext)
      await audio.initAudio()

      expect(audio.isReady()).toBe(true)
      expect(audio.audioUnavailableReason()).toBeNull()
    })
  })

  describe('worklet port messages', () => {
    it('routes power and squelch messages to the registered callbacks', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      const onPower = vi.fn()
      const onSquelch = vi.fn()
      audio.onPower(onPower)
      audio.onSquelchChange(onSquelch)
      lastWorklet!.port.onmessage!({ data: { type: 'power', dbfs: -42, squelchOpen: true } })
      lastWorklet!.port.onmessage!({ data: { type: 'squelch_change', open: true } })
      expect(onPower).toHaveBeenCalledWith(-42, true)
      expect(onSquelch).toHaveBeenCalledWith(true)
    })

    it('ignores empty messages', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      expect(() => lastWorklet!.port.onmessage!({ data: null })).not.toThrow()
    })
  })

  describe('IQ socket', () => {
    it('forwards a valid IQ frame to the worklet on message', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      lastWs!.listeners.open!({})
      const buf = new ArrayBuffer(8 + 4) // 4-byte header pad + 2 IQ pairs
      new DataView(buf).setUint32(0, 2048000, true)
      lastWorklet!.port.postMessage.mockClear()
      lastWs!.listeners.message!({ data: buf })
      expect(lastWorklet!.port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'iq', sample_rate: 2048000 }),
        expect.any(Array),
      )
    })

    it('drops malformed or too-short messages', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      lastWorklet!.port.postMessage.mockClear()
      lastWs!.listeners.message!({ data: 'not-a-buffer' })
      lastWs!.listeners.message!({ data: new ArrayBuffer(4) }) // < 9 bytes
      expect(lastWorklet!.port.postMessage).not.toHaveBeenCalled()
    })

    it('schedules a reconnect on close for the active radio', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio(3)
      const firstWs = lastWs
      lastWs!.listeners.close!({})
      vi.advanceTimersByTime(500)
      expect(lastWs).not.toBe(firstWs) // reconnected
      vi.useRealTimers()
    })
  })

  describe('controls', () => {
    it('setMode/setSquelch/setBandwidthHz/setOffsetHz post to the worklet and store', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastWorklet!.port.postMessage.mockClear()
      audio.setMode('USB')
      audio.setSquelch(-50)
      audio.setBandwidthHz(12000)
      audio.setOffsetHz(5000)
      expect(lastWorklet!.port.postMessage).toHaveBeenCalledWith({
        type: 'bw',
        bandwidth_hz: 12000,
      })
      expect(lastWorklet!.port.postMessage).toHaveBeenCalledWith({
        type: 'offset',
        offset_hz: 5000,
      })
    })

    it('setVolume clamps to [0, 2] and applies gain', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      audio.setVolume(5)
      expect(lastWorklet).toBeTruthy()
      // The gain node value reflects the clamped volume.
      audio.setVolume(-1)
      audio.setLiveMuted(true)
      audio.setLiveMuted(false)
      expect(() => audio.setVolume(1)).not.toThrow()
    })

    it('setBandwidthHz/setOffsetHz are no-ops with no worklet', async () => {
      const audio = await loadAudio()
      expect(() => {
        audio.setBandwidthHz(1)
        audio.setOffsetHz(1)
      }).not.toThrow()
    })

    it('setRadioId opens a socket only when ready', async () => {
      const audio = await loadAudio()
      audio.setRadioId(9) // not ready → no socket
      expect(lastWs).toBeNull()
      await audio.initAudio()
      audio.setRadioId(9)
      expect(lastWs?.url).toContain('/ws/sdr/9/iq')
    })
  })

  describe('recording', () => {
    it('returns null when not ready', async () => {
      const audio = await loadAudio()
      expect(await audio.startRecording({})).toBeNull()
    })

    it('starts a recording and returns the id', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      const id = await audio.startRecording({ frequency_hz: 100e6 })
      expect(id).toBe(7)
      expect(lastWorklet!.port.postMessage).toHaveBeenCalledWith({ type: 'rec_start' })
    })

    it('returns null when the start request fails', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      expect(await audio.startRecording({})).toBeNull()
    })

    it('stopRecording returns null when not recording', async () => {
      const audio = await loadAudio()
      expect(await audio.stopRecording({})).toBeNull()
    })

    it('deletes an empty recording (no chunks)', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio()
      await audio.startRecording({})
      const deleteFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', deleteFetch)
      const promise = audio.stopRecording({})
      await vi.advanceTimersByTimeAsync(400)
      expect(await promise).toBeNull()
      expect(deleteFetch).toHaveBeenCalledWith(expect.stringContaining('/recordings/'), {
        method: 'DELETE',
      })
      vi.useRealTimers()
    })

    it('uploads a WAV when chunks were collected', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio()
      await audio.startRecording({})
      // Simulate a recorded pcm chunk arriving from the worklet.
      lastWorklet!.port.onmessage!({
        data: { type: 'pcm_chunk', samples: new Float32Array([0.5, -2]) },
      })
      const uploadFetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
      vi.stubGlobal('fetch', uploadFetch)
      const promise = audio.stopRecording({ frequency_hz: 100e6, mode: 'AM' })
      await vi.advanceTimersByTimeAsync(400)
      expect(await promise).toEqual({ saved: true })
      expect(uploadFetch).toHaveBeenCalledWith('/api/sdr/recordings/stop', expect.any(Object))
      vi.useRealTimers()
    })

    it('returns null and cleans up when the upload fails', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio()
      await audio.startRecording({})
      lastWorklet!.port.onmessage!({
        data: { type: 'pcm_chunk', samples: new Float32Array([0.1]) },
      })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
      const promise = audio.stopRecording({})
      await vi.advanceTimersByTimeAsync(400)
      expect(await promise).toBeNull()
      vi.useRealTimers()
    })
  })

  describe('stop', () => {
    it('tears down the socket, worklet, gain and context', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      const ctx = lastCtx
      const worklet = lastWorklet
      audio.stop()
      expect(audio.isReady()).toBe(false)
      expect(audio.isPlaying()).toBe(false)
      expect(worklet?.disconnect).toHaveBeenCalled()
      expect(ctx?.close).toHaveBeenCalled()
    })

    it('is safe to call when nothing was initialised', async () => {
      const audio = await loadAudio()
      expect(() => audio.stop()).not.toThrow()
    })
  })

  describe('lifecycle and edge cases', () => {
    it('resumes a suspended context on a user gesture and resets the worklet', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastCtx!.state = 'suspended'
      lastWorklet!.port.postMessage.mockClear()
      window.dispatchEvent(new Event('pointerdown'))
      await Promise.resolve()
      expect(lastCtx!.resume).toHaveBeenCalled()
    })

    it('ignores a gesture when the context is already running', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastCtx!.resume.mockClear()
      window.dispatchEvent(new Event('keydown'))
      expect(lastCtx!.resume).not.toHaveBeenCalled()
    })

    it('removes gesture listeners once the context reaches running', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastCtx!.state = 'running'
      expect(() => lastCtx!.stateListener?.({})).not.toThrow()
      expect(lastCtx!.removeEventListener).toHaveBeenCalled()
    })

    it('on pageshow restore, resumes and reopens the socket', async () => {
      const audio = await loadAudio()
      await audio.initAudio(2)
      audio.stop() // closes socket, but _radioId stays
      lastCtx = null
      const restored = await loadAudio() // fresh module to exercise pageshow on a clean state
      await restored.initAudio(2)
      lastCtx!.state = 'suspended'
      lastWs = null
      const event = Object.assign(new Event('pageshow'), { persisted: true })
      window.dispatchEvent(event)
      expect(lastCtx!.resume).toHaveBeenCalled()
    })

    it('the socket error handler is a no-op', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      expect(() => lastWs!.listeners.error?.({})).not.toThrow()
    })

    it('does not reconnect a closed socket when the radio has changed', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio(3)
      const oldWs = lastWs!
      audio.setRadioId(4) // _radioId now 4, opens a new socket
      const newWs = lastWs
      oldWs.listeners.close!({}) // close fires for radio 3
      vi.advanceTimersByTime(30000)
      expect(lastWs).toBe(newWs) // no reconnect for the stale radio
      vi.useRealTimers()
    })

    it('applies the muted gain value when muted before init', async () => {
      const audio = await loadAudio()
      audio.setVolume(0.5) // no gain yet → applyGain no-op
      audio.setLiveMuted(true)
      await audio.initAudio()
      expect(audio.isReady()).toBe(true)
    })

    it('uses wss when served over https', async () => {
      const audio = await loadAudio()
      vi.stubGlobal('location', { protocol: 'https:', host: 'example.com' })
      await audio.initAudio(1)
      expect(lastWs!.url.startsWith('wss://')).toBe(true)
    })

    it('stopRecording tolerates a torn-down worklet', async () => {
      vi.useFakeTimers()
      const audio = await loadAudio()
      await audio.initAudio()
      await audio.startRecording({})
      audio.stop() // nulls the worklet while _isRecording stays true
      const deleteFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', deleteFetch)
      const promise = audio.stopRecording({})
      await vi.advanceTimersByTimeAsync(400)
      expect(await promise).toBeNull()
      vi.useRealTimers()
    })

    it('swallows a resume rejection during init', async () => {
      const RejectingCtx = class extends FakeAudioContext {
        resume = vi.fn().mockRejectedValue(new Error('blocked'))
      }
      vi.stubGlobal('AudioContext', RejectingCtx)
      const audio = await loadAudio()
      await audio.initAudio()
      await Promise.resolve()
      expect(audio.isReady()).toBe(true)
    })

    it('swallows a resume rejection on a gesture', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastCtx!.state = 'suspended'
      lastCtx!.resume = vi.fn().mockRejectedValue(new Error('blocked'))
      window.dispatchEvent(new Event('touchend'))
      await Promise.resolve()
      expect(lastCtx!.resume).toHaveBeenCalled()
    })

    it('resumes (swallowing rejection) when the socket opens with a suspended context', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      lastCtx!.state = 'suspended'
      lastCtx!.resume = vi.fn().mockRejectedValue(new Error('blocked'))
      lastWs!.listeners.open!({})
      await Promise.resolve()
      expect(lastCtx!.resume).toHaveBeenCalled()
    })

    it('keeps gesture listeners while the context is not yet running', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      lastCtx!.state = 'suspended'
      lastCtx!.removeEventListener.mockClear()
      lastCtx!.stateListener?.({})
      expect(lastCtx!.removeEventListener).not.toHaveBeenCalled()
    })

    it('ignores a non-restored pageshow', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      const event = Object.assign(new Event('pageshow'), { persisted: false })
      expect(() => window.dispatchEvent(event)).not.toThrow()
    })

    it('the socket open handler is inert after teardown', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      const ws = lastWs!
      audio.stop() // _ctx and _worklet are now null
      expect(() => ws.listeners.open!({})).not.toThrow()
    })

    it('the statechange handler is inert after teardown', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      const ctx = lastCtx!
      audio.stop()
      expect(() => ctx.stateListener?.({})).not.toThrow()
    })

    it('resets the worklet when init finds an already-open socket', async () => {
      const audio = await loadAudio()
      await audio.initAudio(1)
      audio.stop() // worklet null, socket closed, but _radioId stays
      // pageshow reopens the socket without a worklet (ctx was closed).
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
      expect(lastWs).toBeTruthy()
      lastWorklet = null
      await audio.initAudio() // creates a worklet; finds the open socket → resets it
      expect(lastWorklet!.port.postMessage).toHaveBeenCalledWith({ type: 'reset' })
    })
  })

  // The mute registry is keyed by owner AND radio: independent owners must not
  // lift each other's mute, and a decode running on one radio must never silence
  // another radio the user is listening to.
  describe('live mute', () => {
    /** The gain node the module created most recently. */
    function currentGain(): FakeGain {
      return lastCtx!.createGain.mock.results.at(-1)!.value as FakeGain
    }

    it('mutes the radio being driven and restores the volume on unmute', async () => {
      const audio = await loadAudio()
      await audio.initAudio(3)
      audio.setVolume(0.8)
      expect(currentGain().gain.value).toBe(0.8)

      audio.setLiveMuted(true, 'aprs', 3)
      expect(currentGain().gain.value).toBe(0)
      expect(audio.isRadioLiveMuted(3)).toBe(true)

      audio.setLiveMuted(false, 'aprs', 3)
      expect(currentGain().gain.value).toBe(0.8)
      expect(audio.isRadioLiveMuted(3)).toBe(false)
    })

    it('leaves a radio audible while a DIFFERENT radio is muted', async () => {
      const audio = await loadAudio()
      await audio.initAudio(2)
      audio.setVolume(0.5)

      // APRS decoding on radio 5 while the user listens to radio 2.
      audio.setLiveMuted(true, 'aprs', 5)
      expect(currentGain().gain.value).toBe(0.5)
      expect(audio.isRadioLiveMuted(5)).toBe(true)
      expect(audio.isRadioLiveMuted(2)).toBe(false)
    })

    it("the 'all' target mutes whichever radio is audible", async () => {
      const audio = await loadAudio()
      await audio.initAudio(4)
      audio.setVolume(1)
      audio.setLiveMuted(true) // recording playback — defaults to 'playback'/'all'
      expect(currentGain().gain.value).toBe(0)
      expect(audio.isRadioLiveMuted(4)).toBe(true)
      expect(audio.isRadioLiveMuted(99)).toBe(true)
      expect(audio.isRadioLiveMuted(null)).toBe(true)
    })

    it('a radio-scoped mute does not apply when no radio is being driven', async () => {
      const audio = await loadAudio()
      await audio.initAudio()
      audio.setLiveMuted(true, 'aprs', 6)
      expect(audio.isRadioLiveMuted(null)).toBe(false)
      expect(currentGain().gain.value).toBe(1)
    })

    it('one owner unmuting does not lift another owner’s mute', async () => {
      const audio = await loadAudio()
      await audio.initAudio(3)
      audio.setVolume(1)
      audio.setLiveMuted(true, 'aprs', 3)
      audio.setLiveMuted(true) // a recording starts playing back

      audio.setLiveMuted(false) // playback ends — APRS still wants silence
      expect(currentGain().gain.value).toBe(0)

      audio.setLiveMuted(false, 'aprs', 3)
      expect(currentGain().gain.value).toBe(1)
    })

    it('keeps a radio muted while any of its owners still wants it', async () => {
      const audio = await loadAudio()
      await audio.initAudio(3)
      audio.setVolume(1)
      audio.setLiveMuted(true, 'digital', 3)
      audio.setLiveMuted(true, 'aprs', 3) // second owner on the SAME radio

      audio.setLiveMuted(false, 'digital', 3)
      expect(currentGain().gain.value).toBe(0)

      audio.setLiveMuted(false, 'aprs', 3)
      expect(currentGain().gain.value).toBe(1)
    })

    it('moving an owner to another radio releases the previous one', async () => {
      const audio = await loadAudio()
      await audio.initAudio(3)
      audio.setVolume(1)
      audio.setLiveMuted(true, 'aprs', 3)
      expect(currentGain().gain.value).toBe(0)

      // APRS decode restarts on radio 7 — radio 3 must become audible again.
      audio.setLiveMuted(true, 'aprs', 7)
      expect(currentGain().gain.value).toBe(1)
      expect(audio.isRadioLiveMuted(3)).toBe(false)
      expect(audio.isRadioLiveMuted(7)).toBe(true)
    })

    it('applies an existing mute to the gain node created at init', async () => {
      const audio = await loadAudio()
      audio.setVolume(0.9) // no gain node yet → applyGain is a no-op
      audio.setLiveMuted(true, 'aprs', 8)
      await audio.initAudio(8)
      expect(currentGain().gain.value).toBe(0)
    })

    it('re-evaluates the mute when the driven radio changes', async () => {
      const audio = await loadAudio()
      await audio.initAudio(3)
      audio.setVolume(1)
      audio.setLiveMuted(true, 'aprs', 4) // muted radio is not the one playing
      expect(currentGain().gain.value).toBe(1)

      audio.setRadioId(4)
      expect(currentGain().gain.value).toBe(0)
    })
  })
})
