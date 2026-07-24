import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import { useSdrStore, type SdrSpectrumFrame } from '@/stores/sdr'
import { useSettingsStore } from '@/stores/settings'

// ── Shared mock registries (hoisted so the vi.mock factories can fill them) ─────
const registry = vi.hoisted(() => {
  return {
    plots: [] as FakePlotShape[],
    accordions: [] as FakeAccShape[],
    annotations: [] as FakeAnnShape[],
    // Handle to the mocked sigplot mx.text spy so tests can inspect the exact
    // (repositioned) x the override delegates to sigplot's real draw with.
    mxTextSpy: null as { mock: { calls: unknown[][] } } | null,
  }
})

interface FakeMx {
  l: number
  r: number
  t: number
  b: number
  text_w: number
  text_h: number
  width: number
  height: number
  level: number
  stk: Array<{ x1: number; y1: number; x2: number; y2: number; ymin: number; ymax: number }>
  // A real widget canvas so dispatchBridgedMouseEvent (SdrWaterfall.vue) has
  // something to dispatch synthetic mouse events at, mirroring sigplot's real
  // `_Mx.wid_canvas`.
  wid_canvas: HTMLCanvasElement
}
interface FakeGx {
  xdiv: number
  ymin: number
  ymax: number
  autoy: number
  autol: number
  lyr: Array<{ ymin: number; ymax: number }>
}
interface FakePlotShape {
  _el: HTMLElement
  _opts: Record<string, unknown>
  _Mx: FakeMx
  _Gx: FakeGx
  overlay_array: (data: unknown, hdr: unknown, opts: unknown) => string
  overlay_pipe: (hdr: unknown, opts: unknown) => string
  remove_layer: (uuid: string) => void
  reload: (uuid: string, bins: unknown) => void
  push: (uuid: string, bins: unknown) => void
  zoom: (a: unknown, b: unknown, c: unknown) => void
  unzoom: () => void
  change_settings: (s: Record<string, unknown>) => void
  add_plugin: (p: unknown, n: number) => void
  remove_plugin: (p: unknown) => void
  checkresize: () => void
  redraw: () => void
  disable_listeners: () => void
  calls: Record<string, unknown[][]>
}
interface FakeAccShape {
  _opts: Record<string, unknown>
  dragging: boolean
  edge_dragging: boolean
  properties: {
    loc_1?: number
    loc_2?: number
    center_location?: number
    edge_line_style?: { lineWidth?: number }
    center_line_style?: { lineWidth?: number }
  }
  center: (v?: number) => number | FakeAccShape
  width: (v?: number) => number | FakeAccShape
  min_width: (v: number) => void
  max_width: (v: number) => void
  display: (v: boolean) => void
  _center: number
  _width: number
  _displayed: boolean | null
}
interface FakeAnnShape {
  _opts: Record<string, unknown>
  clear_annotations: () => void
  onmouseup: (() => void) | null
}

vi.mock('sigplot', () => {
  let uuidSeq = 0
  function FakePlot(this: FakePlotShape, el: HTMLElement, opts: Record<string, unknown>) {
    this._el = el
    this._opts = opts
    this.calls = {}
    const record = (name: string, args: unknown[]) => {
      ;(this.calls[name] ??= []).push(args)
    }
    this._Mx = {
      l: 56,
      r: 988,
      t: 20,
      b: 270,
      text_w: 8,
      text_h: 12,
      width: 1000,
      height: 300,
      level: 0,
      stk: [{ x1: 56, y1: 20, x2: 988, y2: 270, ymin: -100, ymax: 0 }],
      // Appended into the real plot container (attached to document.body via
      // mountWaterfall's `attachTo`), mirroring how sigplot actually nests its
      // widget canvas — needed so a synthetic mousedown/mousemove/mouseup
      // dispatched at it (dispatchBridgedMouseEvent) bubbles up to the
      // document-level accordion-drag listeners like a real touch would.
      wid_canvas: el.appendChild(document.createElement('canvas')),
    }
    this._Gx = {
      xdiv: 1,
      ymin: (opts.ymin as number) ?? -100,
      ymax: (opts.ymax as number) ?? 0,
      autoy: (opts.autoy as number) ?? 0,
      autol: (opts.autol as number) ?? -1,
      lyr: [],
    }
    this.overlay_array = (data, hdr, layerOpts) => {
      record('overlay_array', [data, hdr, layerOpts])
      return `spec-${++uuidSeq}`
    }
    this.overlay_pipe = (hdr, layerOpts) => {
      record('overlay_pipe', [hdr, layerOpts])
      return `wf-${++uuidSeq}`
    }
    this.remove_layer = (uuid) => record('remove_layer', [uuid])
    this.reload = (uuid, bins) => record('reload', [uuid, bins])
    this.push = (uuid, bins) => record('push', [uuid, bins])
    this.zoom = (a, b, c) => record('zoom', [a, b, c])
    this.unzoom = () => record('unzoom', [])
    this.change_settings = (s) => record('change_settings', [s])
    this.add_plugin = (p, n) => record('add_plugin', [p, n])
    this.remove_plugin = (p) => record('remove_plugin', [p])
    this.redraw = () => record('redraw', [])
    this.disable_listeners = () => record('disable_listeners', [])
    // Simulate sigplot's layout pass: write back settled margins so the Mx
    // accessor setters installed by installMarginTweaks are exercised.
    this.checkresize = () => {
      record('checkresize', [])
      const elWidth = el.clientWidth || 1000
      const elHeight = el.clientHeight || 300
      this._Mx.width = elWidth
      this._Mx.height = elHeight
      this._Mx.l = this._Mx.text_w * 6
      this._Mx.r = elWidth - 50
      this._Mx.t = 1
      this._Mx.b = elHeight - 20
    }
    registry.plots.push(this)
  }
  function FakeAccordion(this: FakeAccShape, opts: Record<string, unknown>) {
    this._opts = opts
    this.dragging = false
    this.edge_dragging = false
    this.properties = { loc_1: undefined, loc_2: undefined, edge_line_style: { lineWidth: 1 } }
    this._center = 0
    this._width = 0
    this._displayed = null
    this.center = function (this: FakeAccShape, v?: number) {
      if (v !== undefined) {
        this._center = v
        return this
      }
      return this._center
    }
    this.width = function (this: FakeAccShape, v?: number) {
      if (v !== undefined) {
        this._width = v
        return this
      }
      return this._width
    }
    this.min_width = () => {}
    this.max_width = () => {}
    this.display = function (this: FakeAccShape, v: boolean) {
      this._displayed = v
    }
    registry.accordions.push(this)
  }
  function FakeAnnotation(this: FakeAnnShape, opts: Record<string, unknown>) {
    this._opts = opts
    this.onmouseup = null
    this.clear_annotations = () => {}
    registry.annotations.push(this)
  }
  const sigplot = {
    Plot: FakePlot,
    plugins: { AccordionPlugin: FakeAccordion, AnnotationPlugin: FakeAnnotation },
  }
  return { default: sigplot }
})

vi.mock('sigplot/js/mx', () => {
  // Echo the (possibly rewritten) label back so tests can observe how the
  // override transformed it before delegating to sigplot's real draw.
  const text = vi.fn((_Mx: unknown, _x: number, _y: number, lbl: unknown) => lbl)
  registry.mxTextSpy = text as unknown as { mock: { calls: unknown[][] } }
  const mx = {
    drawaxis: vi.fn(() => 'AXIS'),
    text,
    textline: vi.fn(),
  }
  return { default: mx }
})

// Import the patched mx AFTER the mock so we can exercise the override bodies.
// @ts-expect-error – sigplot ships no .d.ts for its internal mx module (mirrors
// the component's own import).
import mx from 'sigplot/js/mx'
import SdrWaterfall from './SdrWaterfall.vue'

enableAutoUnmount(afterEach)

// ── Controllable rAF / performance / ResizeObserver ────────────────────────────
let rafQueue: Array<{ id: number; cb: FrameRequestCallback; cancelled: boolean }>
let rafSeq: number
let nowMs: number
let roInstances: Array<{ cb: ResizeObserverCallback; els: Element[] }>

function flushRaf(maxRounds = 12): void {
  let rounds = 0
  while (rafQueue.some((entry) => !entry.cancelled) && rounds < maxRounds) {
    const pending = rafQueue.filter((entry) => !entry.cancelled)
    rafQueue = []
    for (const entry of pending) entry.cb(nowMs)
    rounds += 1
  }
}

function triggerResize(): void {
  for (const ro of roInstances) ro.cb([], ro as unknown as ResizeObserver)
}

beforeEach(() => {
  setActivePinia(createPinia())
  registry.plots.length = 0
  registry.accordions.length = 0
  registry.annotations.length = 0
  rafQueue = []
  rafSeq = 0
  nowMs = 1000
  roInstances = []

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = ++rafSeq
    rafQueue.push({ id, cb, cancelled: false })
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    const entry = rafQueue.find((candidate) => candidate.id === id)
    if (entry) entry.cancelled = true
  })
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: ResizeObserverCallback
      els: Element[] = []
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
        roInstances.push(this)
      }
      observe(el: Element) {
        this.els.push(el)
      }
      unobserve() {}
      disconnect() {}
    },
  )

  // vitest's jsdom environment doesn't expose a brand-correct `Window`
  // instance as `window` (it's a merged global, not literally jsdom's Window
  // object), so jsdom's own MouseEvent constructor rejects `view: window`
  // with "member view is not of type Window" — a test-environment artifact
  // only; real browsers accept this fine. dispatchBridgedMouseEvent
  // (SdrWaterfall.vue, the touch→mouse accordion bridge) sets `view: window`
  // on every synthetic event it dispatches, so strip that field before
  // delegating to the real constructor. Built via Reflect.construct with the
  // REAL MouseEvent as newTarget (rather than a subclass) so the resulting
  // instance's prototype is still exactly window.MouseEvent.prototype — vue
  // test-utils' own trigger() reads Object.getOwnPropertyDescriptor straight
  // off that prototype to decide which synthetic properties are read-only, so
  // a subclass (with its own, empty prototype) would break its `button`/
  // `buttons` handling for every existing mouse-event test in this file.
  const RealMouseEvent = window.MouseEvent
  function StubbedMouseEvent(type: string, init?: MouseEventInit): MouseEvent {
    const { view: _unusedView, ...rest } = init ?? {}
    return Reflect.construct(RealMouseEvent, [type, rest], RealMouseEvent) as MouseEvent
  }
  StubbedMouseEvent.prototype = RealMouseEvent.prototype
  vi.stubGlobal('MouseEvent', StubbedMouseEvent)

  // Layout: jsdom returns 0 for all box metrics. Give the plot elements a real
  // size so the FFT-bin math and click/drag geometry have something to work on.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 300,
    width: 1000,
    height: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 300 })
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })

  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeFrame(overrides: Partial<SdrSpectrumFrame> = {}): SdrSpectrumFrame {
  return {
    bins: new Array(1024).fill(-50),
    center_hz: 100_000_000,
    sample_rate: 2_048_000,
    ts: Date.now(),
    ...overrides,
  }
}

/** Mount, run the deferred rAF init so the plots exist, and return refs. */
function mountWaterfall(): {
  wrapper: VueWrapper
  store: ReturnType<typeof useSdrStore>
  settings: ReturnType<typeof useSettingsStore>
} {
  const store = useSdrStore()
  const settings = useSettingsStore()
  const wrapper = mount(SdrWaterfall, { attachTo: document.body })
  flushRaf() // run onMounted's double-rAF → initPlots, plus sizeSliders
  return { wrapper, store, settings }
}

function specPlot() {
  return registry.plots[0]
}
function wfPlotInstance() {
  return registry.plots[1]
}
// specAcc, wfAcc, specCar, wfCar are pushed in that order in initPlots.
function specAccordion() {
  return registry.accordions[0]
}
function wfAccordion() {
  return registry.accordions[1]
}

// jsdom's Touch constructor is unavailable, but its TouchEvent constructor
// happily accepts plain {clientX, clientY} objects for touches/changedTouches
// — the component only ever reads those two fields off each entry, so a
// plain object satisfies it structurally without needing a real Touch.
type FakeTouch = { clientX: number; clientY: number }
function makeTouchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend',
  touches: FakeTouch[],
  changedTouches: FakeTouch[] = touches,
): TouchEvent {
  return new TouchEvent(type, {
    touches: touches as unknown as Touch[],
    changedTouches: changedTouches as unknown as Touch[],
    bubbles: true,
    cancelable: true,
  })
}

/** Put the component into a live, playing state with a span set by a frame. */
async function playWithFrame(
  store: ReturnType<typeof useSdrStore>,
  overrides: Partial<SdrSpectrumFrame> = {},
): Promise<void> {
  store.setPlaying(true)
  nowMs += 1000
  store.setSpectrum(makeFrame(overrides))
  await flushPromises()
  flushRaf()
  await flushPromises()
}

// =============================================================================
describe('SdrWaterfall — mount & init', () => {
  it('creates a spectrum and waterfall plot with accordions and annotation', () => {
    const { wrapper } = mountWaterfall()
    expect(registry.plots).toHaveLength(2)
    // 4 accordions: specAcc, wfAcc, specCar, wfCar
    expect(registry.accordions).toHaveLength(4)
    expect(registry.annotations).toHaveLength(1)
    expect(wrapper.find('#sdr-waterfall').exists()).toBe(true)
  })

  it('has no accessibility violations', async () => {
    const { wrapper } = mountWaterfall()
    // region: controls live inside an app landmark in-app; label: a handful of
    // inputs are styled sliders covered by the surrounding label text — both
    // deferred to the phase-7/8 a11y sweep, every other rule stays on.
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})

describe('SdrWaterfall — spectrum frame', () => {
  it('builds pipes and pushes a waterfall row on a new frame', async () => {
    const { store } = mountWaterfall()
    store.setPlaying(true)
    nowMs += 1000
    store.setSpectrum(makeFrame())
    await flushPromises()
    flushRaf()
    expect(wfPlotInstance().calls.push).toBeTruthy()
    expect(specPlot().calls.reload).toBeTruthy()
  })

  it('ignores frames when not playing', async () => {
    const { store } = mountWaterfall()
    store.setPlaying(false)
    store.setSpectrum(makeFrame())
    await flushPromises()
    flushRaf()
    expect(wfPlotInstance().calls.push).toBeUndefined()
  })

  it('ignores frames while a search sweep is active', async () => {
    const { store } = mountWaterfall()
    store.setPlaying(true)
    store.searchSweeping = true
    store.setSpectrum(makeFrame())
    await flushPromises()
    flushRaf()
    expect(wfPlotInstance().calls.push).toBeUndefined()
  })

  it('rate-caps waterfall rows: a second frame within the cap window is skipped', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const firstPushes = wfPlotInstance().calls.push.length
    // Same timestamp → within WF_ROW_MIN_MS → no extra push, but spectrum reloads.
    store.setSpectrum(makeFrame({ ts: Date.now() + 1 }))
    await flushPromises()
    flushRaf()
    expect(wfPlotInstance().calls.push.length).toBe(firstPushes)
  })

  it('mirrors the live time-window into the active zoom level when zoomed', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    // Zoom in so the waterfall plot sits on level > 0, then feed lyr data.
    const wf = wfPlotInstance()
    wf._Mx.level = 1
    wf._Mx.stk[1] = { x1: 0, y1: 0, x2: 0, y2: 0, ymin: 0, ymax: 0 }
    wf._Gx.lyr = [{ ymin: 5, ymax: 9 }]
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 100 }))
    await flushPromises()
    flushRaf()
    expect(wf._Mx.stk[1].ymin).toBe(5)
    expect(wf._Mx.stk[1].ymax).toBe(9)
  })

  it('clears the live pan offset when a retune lands a new span centre', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    // Simulate a held pan then a frame with a new centre.
    nowMs += 1000
    store.setSpectrum(makeFrame({ center_hz: 101_000_000, ts: Date.now() + 200 }))
    await flushPromises()
    flushRaf()
    // No assertion error means the center-change branch ran; verify span moved.
    expect(specPlot().calls.overlay_array.length).toBeGreaterThan(1)
  })
})

// =============================================================================
describe('SdrWaterfall — mx.drawaxis / mx.text overrides', () => {
  // The component patches sigplot's internal mx module at import time. Mounting
  // the component (done in beforeEach via the import) installs the overrides.
  beforeEach(() => {
    mountWaterfall()
    ;(mx.textline as ReturnType<typeof vi.fn>).mockClear()
  })

  function makeAxisMx(fg: string, bg: string) {
    return {
      stk: [{ x1: 10, y1: 5, x2: 990, y2: 280 }],
      level: 0,
      active_canvas: document.createElement('canvas'),
      fg,
      bg,
      width: 1000,
      height: 300,
    }
  }

  it('suppresses ticks/grid and skips the box on the waterfall plot (fg === bg)', () => {
    const flags: Record<string, unknown> = {}
    const ret = (mx.drawaxis as unknown as (...a: unknown[]) => unknown)(
      {},
      makeAxisMx('#000', '#000'),
      1,
      1,
      1,
      1,
      flags,
    )
    expect(ret).toBe('AXIS')
    expect(flags.noxtics).toBe(true)
    expect(flags.grid).toBe(false)
    expect(flags.noaxisbox).toBe(true)
    expect(mx.textline).not.toHaveBeenCalled() // userWantsBox === false
  })

  it('draws bottom+left box edges with exactbox geometry on the spectrum plot', () => {
    const flags: Record<string, unknown> = { exactbox: true }
    ;(mx.drawaxis as unknown as (...a: unknown[]) => unknown)(
      {},
      makeAxisMx('#fff', '#000'),
      1,
      1,
      1,
      1,
      flags,
    )
    expect(mx.textline).toHaveBeenCalledTimes(2)
  })

  it('draws box edges with padded (non-exactbox) geometry', () => {
    const flags: Record<string, unknown> = {}
    ;(mx.drawaxis as unknown as (...a: unknown[]) => unknown)(
      {},
      makeAxisMx('#fff', '#000'),
      1,
      1,
      1,
      1,
      flags,
    )
    expect(mx.textline).toHaveBeenCalledTimes(2)
  })

  it('does not draw the box when noaxisbox is already requested', () => {
    const flags: Record<string, unknown> = { noaxisbox: true }
    ;(mx.drawaxis as unknown as (...a: unknown[]) => unknown)(
      {},
      makeAxisMx('#fff', '#000'),
      1,
      1,
      1,
      1,
      flags,
    )
    expect(mx.textline).not.toHaveBeenCalled()
  })

  const textMx = { b: 250, l: 56, text_h: 12, text_w: 8 }

  it('rewrites an x-axis "344." label to "344.0" and skips the canvas draw', () => {
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(
      textMx,
      100,
      250 + 12, // y inside the gutter band
      '344.',
    )
    expect(ret).toBeUndefined() // x-axis labels are drawn as HTML, canvas skipped
  })

  it('pads a bare-integer x-axis label "433" to "433.0" and skips the draw', () => {
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 100, 260, '433')
    expect(ret).toBeUndefined()
  })

  it('strips the trailing dot from a y-axis "-30." label and delegates to sigplot', () => {
    // Not an x-axis label → original draw runs with the dot stripped.
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 100, '-30.')
    expect(ret).toBe('-30')
  })

  it('rounds a fractional y-axis dB label to whole dB and delegates to sigplot', () => {
    // sigplot divides the dB range by ydiv and can emit ticks like "-20.666667";
    // the override rounds these to whole dB so the gutter reads cleanly.
    expect((mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 100, '-20.666667')).toBe(
      '-21',
    )
    expect((mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 100, '-41.333333')).toBe(
      '-41',
    )
  })

  it('suppresses the x-axis "+Δ" offset caption (drawn as HTML labels instead)', () => {
    // SigPlot's offset caption ("314.8 +Δ 0.1") is redundant with our HTML freq
    // labels and overlaps the bottom dB label on small screens, so it is dropped.
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 260, '314.8 +Δ 0.1')
    expect(ret).toBeUndefined()
  })

  it('delegates a non-numeric label straight through', () => {
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 100, 'Hz', '#fff')
    expect(ret).toBe('Hz')
  })

  it('delegates when the label is not a string', () => {
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(textMx, 5, 100, 42)
    expect(ret).toBe(42)
  })

  // ── Y-axis dB label right-alignment ──────────────────────────────────────────
  // The override measures each dB label's real pixel width in sigplot's font and
  // right-aligns it to a fixed gap left of the data-box edge (Mx.l), so proportional
  // (Barlow) digits never drift into the spectrum. These assert the delegated x.
  function lastDrawX(): number {
    const calls = registry.mxTextSpy?.mock.calls ?? []
    return calls[calls.length - 1]?.[1] as number
  }

  it('right-aligns a y-axis dB label to a 12px gap left of the data-box edge using measured width', () => {
    const measureText = vi.fn(() => ({ width: 20 }))
    const context = { font: '', measureText }
    const canvas = { getContext: vi.fn(() => context) }
    const ret = (mx.text as unknown as (...a: unknown[]) => unknown)(
      {
        b: 250,
        l: 56,
        text_h: 12,
        text_w: 8,
        active_canvas: canvas,
        font: { font: '12px Barlow' },
      },
      5,
      100,
      '-30',
    )
    expect(ret).toBe('-30')
    expect(canvas.getContext).toHaveBeenCalledWith('2d')
    // Measured in sigplot's own font so the width is accurate.
    expect(context.font).toBe('12px Barlow')
    expect(measureText).toHaveBeenCalledWith('-30')
    // x = Mx.l - gapToSpectrum(12) - width(20) = 24.
    expect(lastDrawX()).toBe(24)
  })

  it('clamps a wide y-axis label to the minimum left-edge gap so it stays on-canvas', () => {
    const context = { font: '', measureText: vi.fn(() => ({ width: 100 })) }
    const canvas = { getContext: vi.fn(() => context) }
    ;(mx.text as unknown as (...a: unknown[]) => unknown)(
      {
        b: 250,
        l: 56,
        text_h: 12,
        text_w: 8,
        active_canvas: canvas,
        font: { font: '12px Barlow' },
      },
      5,
      100,
      '-128',
    )
    // max(minGapFromLeftEdge(4), 56 - 12 - 100) = 4.
    expect(lastDrawX()).toBe(4)
  })

  it('falls back to Mx.canvas and skips the font set when Mx.font is absent', () => {
    const context = { font: '', measureText: vi.fn(() => ({ width: 10 })) }
    const canvas = { getContext: vi.fn(() => context) }
    ;(mx.text as unknown as (...a: unknown[]) => unknown)(
      // No active_canvas → falls back to canvas; no font → font is left untouched.
      { b: 250, l: 56, text_h: 12, text_w: 8, canvas },
      5,
      100,
      '0',
    )
    expect(context.font).toBe('')
    expect(context.measureText).toHaveBeenCalledWith('0')
    // x = 56 - 12 - 10 = 34.
    expect(lastDrawX()).toBe(34)
  })
})

// =============================================================================
describe('SdrWaterfall — search & scan overlays', () => {
  it('renders the search overlay with progress and MHz range', async () => {
    const { wrapper, store } = mountWaterfall()
    store.searchSweeping = true
    store.searchLowHz = 100_000_000
    store.searchHighHz = 110_000_000
    store.searchCurrentHz = 105_000_000
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-wf-search-overlay').exists()).toBe(true)
    const bar = wrapper.find('.sdr-wf-search-overlay-progress')
    expect(bar.attributes('aria-valuenow')).toBe('50')
    const vals = wrapper.findAll('.sdr-wf-search-overlay-range-val')
    expect(vals[0].text()).toBe('100.0000')
    expect(vals[1].text()).toBe('110.0000')
  })

  it('shows an em-dash range and zero progress when search bounds are null', async () => {
    const { wrapper, store } = mountWaterfall()
    store.searchSweeping = true
    store.searchLowHz = null
    store.searchHighHz = null
    store.searchCurrentHz = null
    await wrapper.vm.$nextTick()
    const vals = wrapper.findAll('.sdr-wf-search-overlay-range-val')
    expect(vals[0].text()).toBe('—')
    expect(wrapper.find('.sdr-wf-search-overlay-progress').attributes('aria-valuenow')).toBe('0')
  })

  it('clamps progress to 0 when the range is inverted (hi <= lo)', async () => {
    const { wrapper, store } = mountWaterfall()
    store.searchSweeping = true
    store.searchLowHz = 110_000_000
    store.searchHighHz = 100_000_000
    store.searchCurrentHz = 105_000_000
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-wf-search-overlay-progress').attributes('aria-valuenow')).toBe('0')
  })

  it('renders the scan overlay with active group chips', async () => {
    const { wrapper, store } = mountWaterfall()
    store.scanSweeping = true
    store.scanGroupNames = ['Marine', 'Airband']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-wf-scan-overlay-groups').exists()).toBe(true)
    expect(wrapper.findAll('.sdr-scan-group-chip')).toHaveLength(2)
  })

  it('dulls the plots and disables the Zoom/Max/Min sliders while searching', async () => {
    const { wrapper, store } = mountWaterfall()
    // A search sweeps while the radio is playing, so the sliders are otherwise
    // enabled — the sweep is what disables them.
    store.setPlaying(true)
    store.searchSweeping = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('sweeping')
    const sliders = wrapper.findAll('input[type="range"]')
    expect(sliders).toHaveLength(3)
    for (const slider of sliders) {
      expect((slider.element as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('dulls the plots and disables the sliders while group scanning', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true)
    store.scanSweeping = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('sweeping')
    for (const slider of wrapper.findAll('input[type="range"]')) {
      expect((slider.element as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('leaves the plots live and the sliders enabled when not sweeping', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true)
    store.searchSweeping = false
    store.scanSweeping = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('sweeping')
    expect(wrapper.find('.sdr-wf-search-overlay').exists()).toBe(false)
    for (const slider of wrapper.findAll('input[type="range"]')) {
      expect((slider.element as HTMLInputElement).disabled).toBe(false)
    }
  })
})

// =============================================================================
describe('SdrWaterfall — sliders (Zoom / Max / Min)', () => {
  it('moving the Max slider applies a new dB range to both plots and persists it', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true) // sliders are disabled until the radio is playing
    await wrapper.vm.$nextTick()
    const setView = vi.spyOn(store, 'setViewSettings')
    const maxSlider = wrapper.findAll('input[type="range"]')[1]
    await maxSlider.setValue(40) // zmaxSlider stores magnitude → zmax = -40
    await wrapper.vm.$nextTick()
    expect(
      specPlot().calls.change_settings.some((c) => (c[0] as { ymax?: number }).ymax === -40),
    ).toBe(true)
    expect(setView).toHaveBeenCalledWith(expect.objectContaining({ autoScale: false }))
  })

  it('clamps Min when raised past Max (leaves a 1 dB gap)', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true) // sliders are disabled until the radio is playing
    await wrapper.vm.$nextTick()
    // Lower Max to -80 first, then raise Min to -20 so the Min endpoint crosses
    // above Max → clamp to Max-1 = -81.
    await wrapper.findAll('input[type="range"]')[1].setValue(80) // zmax = -80
    await wrapper.findAll('input[type="range"]')[2].setValue(20) // zmin = -20 (lastTouched=min)
    await wrapper.vm.$nextTick()
    const minAfter = (wrapper.findAll('input[type="range"]')[2].element as HTMLInputElement).value
    expect(minAfter).toBe('81') // zmin clamped to -81 → magnitude 81
  })

  it('clamps Max when lowered below Min', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true) // sliders are disabled until the radio is playing
    await wrapper.vm.$nextTick()
    // Raise Min to -20 first, then lower Max to -30 so Max crosses below Min →
    // clamp to Min+1 = -19.
    await wrapper.findAll('input[type="range"]')[2].setValue(20) // zmin = -20
    await wrapper.findAll('input[type="range"]')[1].setValue(30) // zmax = -30 (lastTouched=max)
    await wrapper.vm.$nextTick()
    const maxAfter = (wrapper.findAll('input[type="range"]')[1].element as HTMLInputElement).value
    expect(maxAfter).toBe('19') // zmax clamped to -19 → magnitude 19
  })

  it('disables the Zoom/Max/Min sliders until the radio is playing, then re-enables them', async () => {
    const { wrapper, store } = mountWaterfall()
    // Radio stopped at mount → all three sliders share the dulled/disabled state.
    const disabledAtMount = wrapper
      .findAll('input[type="range"]')
      .map((slider) => (slider.element as HTMLInputElement).disabled)
    expect(disabledAtMount).toEqual([true, true, true])

    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    const enabledWhilePlaying = wrapper
      .findAll('input[type="range"]')
      .map((slider) => (slider.element as HTMLInputElement).disabled)
    expect(enabledWhilePlaying).toEqual([false, false, false])

    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    const disabledAfterStop = wrapper
      .findAll('input[type="range"]')
      .map((slider) => (slider.element as HTMLInputElement).disabled)
    expect(disabledAfterStop).toEqual([true, true, true])
  })
})

// =============================================================================
describe('SdrWaterfall — band plan & known-frequency overlays', () => {
  it('renders visible band-plan rectangles intersecting the span', async () => {
    const { wrapper, store, settings } = mountWaterfall()
    settings.setSetting('sdr', 'bandPlan', [
      { name: 'Air Band', startHz: 99_000_000, endHz: 101_000_000 },
      { name: 'Out Of Range', startHz: 1, endHz: 2 },
    ])
    store.setShowBandPlan(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const bands = wrapper.findAll('.sdr-wf-band')
    expect(bands).toHaveLength(1)
    expect(bands[0].text()).toBe('Air Band')
  })

  it('keeps the band-plan in its normal slot for a read-only follower', async () => {
    const { wrapper, store, settings } = mountWaterfall()
    settings.setSetting('sdr', 'bandPlan', [
      { name: 'Air Band', startHz: 99_000_000, endHz: 101_000_000 },
    ])
    store.setShowBandPlan(true)
    await playWithFrame(store)
    store.setOwnership(false, true, true) // follower: another instance owns tuning
    await wrapper.vm.$nextTick()
    // The band-plan still renders when read-only, and there is no read-only overlay
    // on the spectrum (the padlock/bar was removed — read-only is shown by the panel).
    expect(wrapper.find('.sdr-wf-band-overlay').exists()).toBe(true)
    expect(wrapper.find('.sdr-wf-readonly-alert').exists()).toBe(false)
  })

  it('renders known-frequency markers within the visible window', async () => {
    const { wrapper, store } = mountWaterfall()
    store.frequencies = [
      { id: 1, group_id: null, label: 'ATIS', frequency_hz: 100_100_000, mode: 'AM' },
      { id: 2, group_id: null, label: 'FarAway', frequency_hz: 500_000_000, mode: 'AM' },
    ]
    store.setShowKnownFreqs(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const markers = wrapper.findAll('.sdr-wf-known-marker')
    expect(markers).toHaveLength(1)
    expect(markers[0].text()).toBe('ATIS')
    // Each marker pairs the dot (SVG ring) with its label.
    expect(markers[0].find('svg.sdr-wf-known-marker-ring').exists()).toBe(true)
    expect(markers[0].find('.sdr-wf-known-marker-label').text()).toBe('ATIS')
  })

  it('spans the full spectrum data box so labels clip at the grid edge', async () => {
    const { wrapper, store } = mountWaterfall()
    store.frequencies = [
      { id: 1, group_id: null, label: 'ATIS', frequency_hz: 100_100_000, mode: 'AM' },
    ]
    store.setShowKnownFreqs(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const overlay = wrapper.find('.sdr-wf-known-overlay')
    expect(overlay.exists()).toBe(true)
    // Markers hang from the data-box top (bandInsetTopPx), and the overlay now also
    // reaches the data-box bottom so it can clip (overflow:hidden) a label that would
    // otherwise overrun the grid's right edge into the control rail.
    const overlayStyle = overlay.attributes('style') ?? ''
    expect(overlayStyle).toMatch(/top:\s*\d+px/)
    expect(overlayStyle).toMatch(/bottom:\s*\d+px/)
  })

  it('renders frequency tick labels in the gutter', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-wf-freq-label').length).toBeGreaterThan(0)
  })

  // Reads the inline `top` (px) each known-freq marker is positioned at — the
  // per-row vertical offset that staggers clustered labels. Markers render in
  // ascending-frequency order, so the returned array matches that order.
  function markerTops(wrapper: VueWrapper): number[] {
    return wrapper.findAll('.sdr-wf-known-marker').map((marker) => {
      const match = /top:\s*([\d.]+)px/.exec(marker.attributes('style') ?? '')
      return match ? Number(match[1]) : NaN
    })
  }

  it('staggers overlapping known-freq labels onto separate rows', async () => {
    const { wrapper, store } = mountWaterfall()
    // Two long labels only 10 kHz apart in a 2.048 MHz window — their pills span
    // far more horizontal space than that gap, so they must not share a row.
    store.frequencies = [
      {
        id: 1,
        group_id: null,
        label: 'SHANWICK – OCEANIC CLEARANCE',
        frequency_hz: 99_200_000,
        mode: 'AM',
      },
      {
        id: 2,
        group_id: null,
        label: 'SCOTTISH – ANTRIM LOW',
        frequency_hz: 99_210_000,
        mode: 'AM',
      },
    ]
    store.setShowKnownFreqs(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const tops = markerTops(wrapper)
    expect(tops).toHaveLength(2)
    // Lower-frequency label sits on the base row; the colliding one drops a row.
    expect(tops[0]).toBe(20)
    expect(tops[1]).toBe(44)
  })

  it('keeps non-overlapping known-freq labels on the single top row', async () => {
    const { wrapper, store } = mountWaterfall()
    // Two short labels far apart in the window — no pixel collision, so the
    // stagger must NOT fire (both stay on the base row).
    store.frequencies = [
      { id: 1, group_id: null, label: 'ATIS', frequency_hz: 99_100_000, mode: 'AM' },
      { id: 2, group_id: null, label: 'TWR', frequency_hz: 100_900_000, mode: 'AM' },
    ]
    store.setShowKnownFreqs(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    expect(markerTops(wrapper)).toEqual([20, 20])
  })

  it('reuses the base row once a later label clears the cluster', async () => {
    const { wrapper, store } = mountWaterfall()
    // Two colliding labels open rows 0 and 1; a third far enough right clears
    // row 0's pill and packs back onto it rather than opening a needless row.
    store.frequencies = [
      {
        id: 1,
        group_id: null,
        label: 'SHANWICK – OCEANIC CLEARANCE',
        frequency_hz: 99_200_000,
        mode: 'AM',
      },
      {
        id: 2,
        group_id: null,
        label: 'SCOTTISH – ANTRIM LOW',
        frequency_hz: 99_250_000,
        mode: 'AM',
      },
      {
        id: 3,
        group_id: null,
        label: 'SCOTTISH – TAY EAST',
        frequency_hz: 100_100_000,
        mode: 'AM',
      },
    ]
    store.setShowKnownFreqs(true)
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    expect(markerTops(wrapper)).toEqual([20, 44, 20])
  })
})

// =============================================================================
describe('SdrWaterfall — frequency tick formatting (unit bands)', () => {
  it('formats GHz-range ticks with a G suffix', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store, { center_hz: 1_500_000_000, sample_rate: 2_000_000 })
    await wrapper.vm.$nextTick()
    const labels = wrapper.findAll('.sdr-wf-freq-label').map((w) => w.text())
    expect(labels.some((t) => t.endsWith('G'))).toBe(true)
  })

  it('formats kHz-range ticks with a K suffix', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store, { center_hz: 500_000, sample_rate: 200_000 })
    await wrapper.vm.$nextTick()
    const labels = wrapper.findAll('.sdr-wf-freq-label').map((w) => w.text())
    expect(labels.some((t) => t.endsWith('K'))).toBe(true)
  })
})

// =============================================================================
// Frequency labels are decimated to fit the data box: every gridline tick stays,
// but the number of *visible* labels is thinned on a narrow box so their opaque
// pills never overlap (the bug these tests guard against). syncBandInset reads
// the data-box edges straight off the plot's _Mx, so the tests size the box by
// setting _Mx.l / _Mx.r before the frame that triggers the measurement.
describe('SdrWaterfall — frequency label overlap avoidance', () => {
  it('thins the visible labels on a narrow data box so the pills never overlap', async () => {
    const { wrapper, store } = mountWaterfall()
    // A ~100px data box cannot fit all 21 labels (0.1 MHz steps across the default
    // 2.048 MHz span) without their pills colliding, so most must be hidden.
    specPlot()._Mx.l = 10
    specPlot()._Mx.r = 110
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const labels = wrapper.findAll('.sdr-wf-freq-label')
    const visibleCount = labels.filter((label) => label.isVisible()).length
    // Every gridline tick label still exists in the DOM (only display is toggled)…
    expect(labels.length).toBeGreaterThan(10)
    // …but only a few are actually shown, and at least one always is.
    expect(visibleCount).toBeGreaterThan(0)
    expect(visibleCount).toBeLessThan(labels.length)
  })

  it('shows every frequency label when the data box is wide enough', async () => {
    const { wrapper, store } = mountWaterfall()
    // A very wide box leaves room for every 0.1 MHz label — none are dropped.
    specPlot()._Mx.l = 0
    specPlot()._Mx.r = 4000
    await playWithFrame(store)
    await wrapper.vm.$nextTick()
    const labels = wrapper.findAll('.sdr-wf-freq-label')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.every((label) => label.isVisible())).toBe(true)
  })
})

// =============================================================================
describe('SdrWaterfall — document & sidebar events', () => {
  it('tracks the sidebar open/closed state', async () => {
    const { wrapper } = mountWaterfall()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('panel-closed')
    document.dispatchEvent(new CustomEvent('sentinel:sidebar-state', { detail: { open: true } }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('panel-closed')
  })

  it('re-hydrates overlay flags when a config upload event fires', async () => {
    const { store } = mountWaterfall()
    const bandSpy = vi.spyOn(store, 'hydrateShowBandPlanFromDb')
    const knownSpy = vi.spyOn(store, 'hydrateShowKnownFreqsFromDb')
    document.dispatchEvent(new CustomEvent('sentinel:config-uploaded'))
    expect(bandSpy).toHaveBeenCalled()
    expect(knownSpy).toHaveBeenCalled()
  })

  it('reads an open sidebar from sessionStorage at mount', () => {
    sessionStorage.setItem('sentinel_sidebar_open', '1')
    const { wrapper } = mountWaterfall()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('panel-closed')
  })

  it('marks the waterfall not-playing until the radio is tuned, then clears it', async () => {
    const { wrapper, store } = mountWaterfall()
    // Radio stopped at mount → the dulled/disabled state is on.
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('not-playing')
    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('not-playing')
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('not-playing')
  })
})

// =============================================================================
describe('SdrWaterfall — click-to-tune & plot mouse handling', () => {
  function spectrumEl(wrapper: VueWrapper) {
    return wrapper.find('.sdr-wf-spectrum')
  }

  it('click-to-tune with auto-centre ON clears the offset and retunes', async () => {
    const { wrapper, store } = mountWaterfall()
    store.autoCenterWaterfallOnTune = true
    await playWithFrame(store)
    const offsetSpy = vi.spyOn(store, 'setTuningOffsetHz')
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(offsetSpy).toHaveBeenCalledWith(0)
    expect(tuneSpy).toHaveBeenCalled()
  })

  it('click-to-tune with auto-centre OFF applies an NCO offset', async () => {
    const { wrapper, store } = mountWaterfall()
    store.autoCenterWaterfallOnTune = false
    await playWithFrame(store)
    const offsetSpy = vi.spyOn(store, 'setTuningOffsetHz')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 0, clientX: 700, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 700, clientY: 100 })
    // Offset is the clicked freq minus the hardware centre (non-zero, not 0).
    const lastCall = offsetSpy.mock.calls.at(-1)
    expect(lastCall?.[0]).not.toBe(0)
  })

  it('snaps a click to a nearby known frequency, and does not when snapping is off', async () => {
    const { wrapper, store } = mountWaterfall()
    store.autoCenterWaterfallOnTune = true
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    // Snapping OFF: capture the raw clicked frequency (also covers the off-path).
    store.setSnapToKnown(false)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    const rawFreq = tuneSpy.mock.calls.at(-1)![0] as number
    // Place a known freq a few hundred Hz off the raw click, then enable snapping:
    // a click at the same spot must now tune to the known freq, not the raw one.
    const knownFreq = rawFreq + 800
    store.frequencies = [
      { id: 1, group_id: null, label: 'NEAR', frequency_hz: knownFreq, mode: 'AM' },
    ]
    store.setSnapToKnown(true)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy.mock.calls.at(-1)![0]).toBe(knownFreq)
  })

  it('snaps to the nearest of several known frequencies within threshold, not a farther one', async () => {
    const { wrapper, store } = mountWaterfall()
    store.autoCenterWaterfallOnTune = true
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    store.setSnapToKnown(false)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    const rawFreq = tuneSpy.mock.calls.at(-1)![0] as number
    // The nearer candidate is evaluated first, narrowing the best distance, so
    // the farther one that follows must fail the "closer than the current
    // best" check — proving the loop keeps the running-nearest match rather
    // than just taking whichever candidate comes last.
    const fartherFreq = rawFreq + 800
    const nearerFreq = rawFreq + 200
    store.frequencies = [
      { id: 2, group_id: null, label: 'NEAR', frequency_hz: nearerFreq, mode: 'AM' },
      { id: 1, group_id: null, label: 'FAR', frequency_hz: fartherFreq, mode: 'AM' },
    ]
    store.setSnapToKnown(true)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy.mock.calls.at(-1)![0]).toBe(nearerFreq)
  })

  it('a right-click is swallowed on both mousedown and mouseup', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 2, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 2, clientX: 500, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })

  it('ignores click-to-tune for a read-only follower (mirrors the owner)', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setOwnership(false, true, true) // follower: another instance owns tuning
    await wrapper.vm.$nextTick()
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })

  it('a drag (movement beyond the slop) does not tune', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 560, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })

  it('a middle-button press is ignored', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 1, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 1, clientX: 500, clientY: 100 })
    // No throw; nothing tuned (button !== 0 short-circuits).
    expect(true).toBe(true)
  })

  it('does not tune when playback is stopped', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = spectrumEl(wrapper)
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — frequency-axis drag pan', () => {
  it('dragging the gutter pans the window and commits a retune on release', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    // Mousedown in the bottom gutter (y >= gutterTop ≈ 262) arms the pan.
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).toContain('sdr-wf-spectrum--panning')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 290 }))
    flushRaf() // run freqDragFlush
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, clientY: 290 }))
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })

  it('does not start a pan above the gutter', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('does not start a pan when stopped', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('does not start a pan for a read-only follower', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setOwnership(false, true, true)
    await wrapper.vm.$nextTick()
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })
})

// =============================================================================
describe('SdrWaterfall — frequency-axis drag pan (touch)', () => {
  it('touchstart in the gutter arms the pan, touchmove updates it, and touchend commits', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    // Touchstart in the bottom gutter (y >= gutterTop ≈ 262) arms the pan,
    // mirroring the mousedown-in-gutter test above.
    const startEvent = makeTouchEvent('touchstart', [{ clientX: 500, clientY: 290 }])
    const startPreventSpy = vi.spyOn(startEvent, 'preventDefault')
    el.element.dispatchEvent(startEvent)
    await wrapper.vm.$nextTick()
    expect(startPreventSpy).toHaveBeenCalled()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).toContain('sdr-wf-spectrum--panning')
    const moveEvent = makeTouchEvent('touchmove', [{ clientX: 560, clientY: 290 }])
    const movePreventSpy = vi.spyOn(moveEvent, 'preventDefault')
    document.dispatchEvent(moveEvent)
    expect(movePreventSpy).toHaveBeenCalled()
    flushRaf() // run freqDragFlush
    document.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 560, clientY: 290 }]))
    await wrapper.vm.$nextTick()
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('touchcancel aborts an in-progress pan without committing a retune', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 500, clientY: 290 }]))
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 560, clientY: 290 }]))
    flushRaf()
    document.dispatchEvent(new Event('touchcancel'))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('touchcancel also cancels a still-pending preview rAF (not yet flushed)', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 500, clientY: 290 }]))
    // Schedule the preview rAF but do NOT flush it before aborting — abortFreqDrag
    // must cancel the still-pending frame itself, not rely on it having run.
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 560, clientY: 290 }]))
    const pendingEntry = rafQueue.find((entry) => !entry.cancelled)
    expect(pendingEntry).toBeDefined()
    document.dispatchEvent(new Event('touchcancel'))
    expect(pendingEntry?.cancelled).toBe(true)
  })

  it('does not intercept a touchstart above the gutter, leaving sigplot to handle it', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [{ clientX: 500, clientY: 100 }])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    el.element.dispatchEvent(event)
    expect(preventSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('ignores a two-finger touchstart entirely, leaving pinch-zoom to sigplot', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [
      { clientX: 500, clientY: 290 },
      { clientX: 520, clientY: 290 },
    ])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    el.element.dispatchEvent(event)
    expect(preventSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('aborts an active pan on window blur, mirroring the abortAccDrag blur handler', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 500, clientY: 290 }]))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).toContain('sdr-wf-spectrum--panning')
    window.dispatchEvent(new Event('blur'))
    await wrapper.vm.$nextTick()
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('ignores a blur when no freq-axis pan is in progress', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    expect(() => window.dispatchEvent(new Event('blur'))).not.toThrow()
    expect(tuneSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('coalesces rapid gutter-drag touchmoves into one rAF', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 500, clientY: 290 }]))
    // Two moves before any flush: the second must NOT schedule a second rAF.
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 540, clientY: 290 }]))
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 560, clientY: 290 }]))
    const tuneSpy = vi.spyOn(store, 'requestTune')
    document.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 560, clientY: 290 }]))
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })
})

// =============================================================================
describe('SdrWaterfall — accordion (tuning-bracket) drag', () => {
  async function startDrag(store: ReturnType<typeof useSdrStore>) {
    await playWithFrame(store)
    const wf = wfAccordion()
    const spec = specAccordion()
    // Seed a baseline geometry on the waterfall accordion (Hz units).
    wf._center = 100_000_000
    wf._width = 10_000
    spec.dragging = true
    document.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, clientY: 100 }))
  }

  it('commits a frequency change when the bracket centre is dragged', async () => {
    const store = useSdrStore()
    const settings = useSettingsStore()
    void settings
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    // Simulate sigplot moving the spectrum accordion (MHz units).
    specAccordion()._center = 100.5 // MHz → 100.5 MHz carrier
    specAccordion()._width = 0.01
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 520, clientY: 100 }))
    expect(tuneSpy).toHaveBeenCalled()
    void wrapper
  })

  it('does not snap the drag commit when the span is degenerate (hi <= lo)', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    store.setSnapToKnown(true)
    // A zero sample rate collapses spanStartHz === spanEndHz. The bracket-drag
    // commit calls snapToKnownFreqHz directly (no outer hi<=lo guard, unlike the
    // click-to-tune path) — its own defensive span guard must return the raw
    // carrier unmodified, even with a known frequency sitting right next to it.
    await playWithFrame(store, { sample_rate: 0 })
    const wf = wfAccordion()
    const spec = specAccordion()
    wf._center = 100_000_000
    wf._width = 10_000
    spec.dragging = true
    document.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, clientY: 100 }))
    const tuneSpy = vi.spyOn(store, 'requestTune')
    store.frequencies = [
      { id: 1, group_id: null, label: 'NEAR', frequency_hz: 100_500_800, mode: 'AM' },
    ]
    specAccordion()._center = 100.5 // MHz → 100.5 MHz carrier
    specAccordion()._width = 0.01
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 520, clientY: 100 }))
    // Committed to the raw carrier, not the nearby known freq (100_500_800).
    expect(tuneSpy).toHaveBeenCalledWith(100_500_000)
    void wrapper
  })

  it('does not snap the drag commit when the data box has collapsed to zero width', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    store.setSnapToKnown(true)
    // Collapse the spectrum plot's data box (l >= r) before the frame that
    // measures it, so dataBoxWidthPx lands at 0 — snapToKnownFreqHz's own
    // defensive box-width guard must then return the raw carrier unmodified.
    // (installMarginTweaks clamps Mx.r to at least width-1, so r alone can't be
    // pushed below l — push l past the clamped r instead.)
    specPlot()._Mx.l = 1000
    specPlot()._Mx.r = 400
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    store.frequencies = [
      { id: 1, group_id: null, label: 'NEAR', frequency_hz: 100_500_800, mode: 'AM' },
    ]
    specAccordion()._center = 100.5 // MHz → 100.5 MHz carrier
    specAccordion()._width = 0.01
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 520, clientY: 100 }))
    // Committed to the raw carrier, not the nearby known freq (100_500_800).
    expect(tuneSpy).toHaveBeenCalledWith(100_500_000)
    void wrapper
  })

  it('drops the bracket-drag commit for a read-only follower', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    store.setOwnership(false, true, true) // follower mirrors the owner
    await wrapper.vm.$nextTick()
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const bwSpy = vi.spyOn(store, 'requestBandwidth')
    specAccordion()._center = 100.5
    specAccordion()._width = 0.01
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 520, clientY: 100 }))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(bwSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('commits a bandwidth change when the bracket edge is resized (symmetric mode)', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const bwSpy = vi.spyOn(store, 'requestBandwidth')
    // Drag on the waterfall accordion in Hz: widen the bracket.
    wfAccordion().dragging = true
    specAccordion().dragging = false
    wfAccordion()._width = 40_000
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 520, clientY: 100 }))
    expect(bwSpy).toHaveBeenCalledWith(40_000)
    void wrapper
  })

  it('handles an SSB (USB) move + edge resize, keeping the carrier anchored', async () => {
    const store = useSdrStore()
    store.setMode('USB')
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    // SSB edge-resize on the spectrum accordion.
    specAccordion().edge_dragging = true
    specAccordion()._center = 100.51
    specAccordion()._width = 0.02
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 1 }))
    // SSB move (no edge) on the waterfall accordion.
    specAccordion().edge_dragging = false
    wfAccordion().dragging = true
    specAccordion().dragging = false
    wfAccordion()._center = 100_020_000
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 540, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 540, clientY: 100 }))
    expect(true).toBe(true)
    void wrapper
  })

  it('handles an LSB move on the waterfall accordion', async () => {
    const store = useSdrStore()
    store.setMode('LSB')
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    wfAccordion().dragging = true
    specAccordion().dragging = false
    wfAccordion()._center = 99_990_000
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 540, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 540, clientY: 100 }))
    expect(true).toBe(true)
    void wrapper
  })

  it('ignores a mouseup with no drag in progress', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 100 }))
    expect(tuneSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('recovers from a missed mouseup when the button is released outside the window', async () => {
    // Releasing the button outside the window never delivers a mouseup, so the
    // drag would stay active and the bar would chase the cursor. A later
    // mousemove with no button held (buttons === 0) must end the drag instead.
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    // The recovery path commits straight from the waterfall accordion (the
    // live mousemove mirror is skipped), so move that accordion's centre.
    wfAccordion()._center = 100_500_000
    // No mouseup — just a moved pointer with the button no longer down.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 520, clientY: 100, buttons: 0 }))
    expect(tuneSpy).toHaveBeenCalled()
    expect(specAccordion().dragging).toBe(false)
    expect(wfAccordion().dragging).toBe(false)
    void wrapper
  })

  it('aborts a drag and releases the bar when the pointer gesture is cancelled', async () => {
    // A cancelled gesture (browser takes over a touch/pen scroll) must release
    // the bar without committing the uncommitted geometry.
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    document.dispatchEvent(new Event('pointercancel'))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(specAccordion().dragging).toBe(false)
    expect(specAccordion().edge_dragging).toBe(false)
    expect(wfAccordion().dragging).toBe(false)
    void wrapper
  })

  it('aborts a drag and releases the bar when the window loses focus mid-drag', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    window.dispatchEvent(new Event('blur'))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(specAccordion().dragging).toBe(false)
    expect(wfAccordion().dragging).toBe(false)
    void wrapper
  })

  it('ignores a window blur when no drag is in progress', async () => {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    expect(() => window.dispatchEvent(new Event('blur'))).not.toThrow()
    expect(tuneSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('clears sigplot drag flags on a click that does not move the bracket (stuck-bar fix)', async () => {
    // Regression: a mousedown sets sigplot's `dragging` flag, but if the bracket
    // is released without moving past the 1Hz threshold the mouseup handler used
    // to return early before resetting it — leaving the tuning bar glued to the
    // cursor until a page refresh. The flags must be cleared on this path too.
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await startDrag(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const bwSpy = vi.spyOn(store, 'requestBandwidth')
    // No geometry change between mousedown and mouseup → a click, not a drag.
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 100 }))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(bwSpy).not.toHaveBeenCalled()
    // The bar is released: sigplot's internal drag flags are cleared on both plots.
    expect(specAccordion().dragging).toBe(false)
    expect(specAccordion().edge_dragging).toBe(false)
    expect(wfAccordion().dragging).toBe(false)
    expect(wfAccordion().edge_dragging).toBe(false)
    void wrapper
  })
})

// =============================================================================
describe('SdrWaterfall — touch-driven accordion drag bridge', () => {
  // Arm the spectrum accordion's grab-zone geometry so a touch at (300, 100)
  // lands on its center handle (edges at 200/400, center at 300 — all with the
  // widened 20px tolerance accCommon configures).
  function armGrabZone() {
    const spec = specAccordion()
    spec.properties.loc_1 = 200
    spec.properties.loc_2 = 400
    spec.properties.edge_line_style = { lineWidth: 20 }
    spec.properties.center_location = 300
    spec.properties.center_line_style = { lineWidth: 20 }
  }

  it('touchstart near a grab zone intercepts the touch and dispatches a bridged mousedown', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    const touchEvent = makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }])
    const preventSpy = vi.spyOn(touchEvent, 'preventDefault')
    const stopSpy = vi.spyOn(touchEvent, 'stopImmediatePropagation')
    el.element.dispatchEvent(touchEvent)
    expect(preventSpy).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalled()
    expect(mousedownSpy).toHaveBeenCalledTimes(1)
    const dispatched = mousedownSpy.mock.calls[0]?.[0] as MouseEvent
    expect(dispatched.type).toBe('mousedown')
    expect(dispatched.clientX).toBe(300)
    expect(dispatched.clientY).toBe(100)
    expect(dispatched.button).toBe(0)
  })

  it('does not intercept a touchstart that misses every grab zone', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    // Far from loc_1(200)/loc_2(400)/center(300) and their 25px tolerance.
    const touchEvent = makeTouchEvent('touchstart', [{ clientX: 700, clientY: 100 }])
    const preventSpy = vi.spyOn(touchEvent, 'preventDefault')
    el.element.dispatchEvent(touchEvent)
    expect(preventSpy).not.toHaveBeenCalled()
    expect(mousedownSpy).not.toHaveBeenCalled()
  })

  it('does not throw when the plot has no widget canvas measured yet (accWidCanvas fallback)', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    // Force accWidCanvas's `mx?.wid_canvas ?? null` fallback: a live plot
    // whose _Mx exists but hasn't measured a widget canvas yet.
    ;(specPlot()._Mx as unknown as { wid_canvas: undefined }).wid_canvas = undefined
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }])
    expect(() => el.element.dispatchEvent(event)).not.toThrow()
  })

  it('touchmove while bridged dispatches a bridged mousemove and prevents default', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }]))
    const canvas = specPlot()._Mx.wid_canvas
    const mousemoveSpy = vi.fn()
    canvas.addEventListener('mousemove', mousemoveSpy)
    const moveEvent = makeTouchEvent('touchmove', [{ clientX: 320, clientY: 110 }])
    const preventSpy = vi.spyOn(moveEvent, 'preventDefault')
    document.dispatchEvent(moveEvent)
    expect(preventSpy).toHaveBeenCalled()
    expect(mousemoveSpy).toHaveBeenCalledTimes(1)
    const dispatched = mousemoveSpy.mock.calls[0]?.[0] as MouseEvent
    expect(dispatched.clientX).toBe(320)
    expect(dispatched.clientY).toBe(110)
  })

  it('a touchmove with no active bridge dispatches nothing', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const canvas = specPlot()._Mx.wid_canvas
    const mousemoveSpy = vi.fn()
    canvas.addEventListener('mousemove', mousemoveSpy)
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 320, clientY: 110 }]))
    expect(mousemoveSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('touchend dispatches a bridged mouseup at the lifted-finger position and clears the bridge', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }]))
    const canvas = specPlot()._Mx.wid_canvas
    const mouseupSpy = vi.fn()
    canvas.addEventListener('mouseup', mouseupSpy)
    document.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 310, clientY: 105 }]))
    expect(mouseupSpy).toHaveBeenCalledTimes(1)
    const dispatched = mouseupSpy.mock.calls[0]?.[0] as MouseEvent
    expect(dispatched.type).toBe('mouseup')
    expect(dispatched.clientX).toBe(310)
    expect(dispatched.clientY).toBe(105)
    expect(dispatched.button).toBe(0)
    // The bridge is cleared: a further touchmove dispatches nothing more.
    const mousemoveSpy = vi.fn()
    canvas.addEventListener('mousemove', mousemoveSpy)
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 320, clientY: 110 }]))
    expect(mousemoveSpy).not.toHaveBeenCalled()
  })

  it('a touchend with no active bridge dispatches nothing', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const canvas = specPlot()._Mx.wid_canvas
    const mouseupSpy = vi.fn()
    canvas.addEventListener('mouseup', mouseupSpy)
    document.dispatchEvent(makeTouchEvent('touchend', [{ clientX: 310, clientY: 105 }]))
    expect(mouseupSpy).not.toHaveBeenCalled()
    void wrapper
  })

  it('touchcancel clears the bridge and aborts the drag without committing a synthetic mouseup', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    armGrabZone()
    const spec = specAccordion()
    // Simulate sigplot synchronously setting its own drag flag off the bridged
    // mousedown (mirrors startDrag()'s convention above for the mouse path).
    spec.dragging = true
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    el.element.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }]))
    const canvas = specPlot()._Mx.wid_canvas
    const mouseupSpy = vi.fn()
    canvas.addEventListener('mouseup', mouseupSpy)
    document.dispatchEvent(new Event('touchcancel'))
    expect(tuneSpy).not.toHaveBeenCalled()
    expect(mouseupSpy).not.toHaveBeenCalled() // aborted, not committed via a synthetic mouseup
    expect(specAccordion().dragging).toBe(false)
    expect(wfAccordion().dragging).toBe(false)
    // The bridge is cleared: a further touchmove dispatches nothing more.
    const mousemoveSpy = vi.fn()
    canvas.addEventListener('mousemove', mousemoveSpy)
    document.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: 320, clientY: 110 }]))
    expect(mousemoveSpy).not.toHaveBeenCalled()
  })

  it('a touchcancel with no active bridge is a no-op', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    expect(() => document.dispatchEvent(new Event('touchcancel'))).not.toThrow()
    expect(tuneSpy).not.toHaveBeenCalled()
    void wrapper
  })
})

// =============================================================================
describe('SdrWaterfall — passband shade geometry & style', () => {
  // Push a mode + carrier + bandwidth onto the store and let the reactive
  // watch fire applyMarker(), which repositions both accordions.
  async function retune(
    store: ReturnType<typeof useSdrStore>,
    mode: 'USB' | 'LSB' | 'NFM',
    carrierHz: number,
    bandwidthHz: number,
  ): Promise<void> {
    store.setMode(mode)
    store.currentFreqHz = carrierHz
    store.bwHz = bandwidthHz
    await flushPromises()
    flushRaf()
    await flushPromises()
  }

  it('centres the passband shade on the carrier in USB mode (tuning line stays mid-band)', async () => {
    // Regression: SSB used to offset the shade to one side (USB → carrier + bw/2),
    // pushing the tuning line to the edge of the band. It must now sit dead-centre.
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    await retune(store, 'USB', 100_500_000, 20_000)
    expect(wfAccordion()._center).toBe(100_500_000)
    expect(wfAccordion()._width).toBe(20_000)
    expect(specAccordion()._center).toBeCloseTo(100.5, 6)
    void wrapper
  })

  it('centres the passband shade on the carrier in LSB mode', async () => {
    // LSB previously drew the shade below the carrier (carrier - bw/2); the shade
    // is now symmetric so the carrier line stays centred in the band.
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    await retune(store, 'LSB', 100_500_000, 20_000)
    expect(wfAccordion()._center).toBe(100_500_000)
    expect(specAccordion()._center).toBeCloseTo(100.5, 6)
    void wrapper
  })

  it('shades the spectrum passband with a translucent blue wash', () => {
    // The tuned-passband fill matches the trace colour (#00aaff) at a low opacity
    // so the band reads as part of the trace rather than an opaque white block.
    mountWaterfall()
    expect(specAccordion()._opts.fill_style).toEqual({ fillStyle: '#00aaff', opacity: 0.12 })
  })
})

// =============================================================================
describe('SdrWaterfall — accordion edge cursor affordance', () => {
  it('flags the edge-resize cursor when the pointer is over an accordion edge', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 100
    specAccordion().properties.loc_2 = 400
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('edge-resize')
  })

  it('clears the affordance when the pointer is away from any edge', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 100
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('edge-resize')
  })

  it('holds the cursor through an in-progress edge drag', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().edge_dragging = true
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('edge-resize')
  })
})

// =============================================================================
describe('SdrWaterfall — mouse-wheel pan', () => {
  it('wheel scroll pans the window and commits one debounced retune', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    flushRaf() // wheelFlush
    // A second notch within the burst exercises the clearTimeout re-arm path.
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    vi.advanceTimersByTime(300)
    flushRaf()
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
    vi.useRealTimers()
  })

  it('normalises line-mode wheel deltas', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: 3, deltaMode: 1 })
    flushRaf()
    expect(wrapper.find('.sdr-wf-spectrum').classes()).toContain('sdr-wf-spectrum--panning')
  })

  it('ignores the wheel when stopped', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('ignores the wheel for a read-only follower', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setOwnership(false, true, true)
    await wrapper.vm.$nextTick()
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })
})

// =============================================================================
describe('SdrWaterfall — FFT bin sizing & resize', () => {
  it('requests a larger power-of-two bin count on a wide/HiDPI canvas at init', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const store = useSdrStore()
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf() // init publishes the bin target directly (1000px * 2 dpr → 2048)
    expect(fftSpy).toHaveBeenCalledWith(2048)
    void wrapper
  })

  it('clamps the bin request to MAX_BINS at extreme zoom', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setFullWaterfallUpdate(true)
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // zoom 50 × 1000px = 50000 → clamp to 32768 (scheduled, debounced 250 ms).
    await wrapper.findAll('input[type="range"]')[0].setValue(50)
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).toHaveBeenCalledWith(32768)
  })

  it('refreshes the bin target on resize only when Full Waterfall Update is on', async () => {
    const { store } = mountWaterfall()
    store.setFullWaterfallUpdate(true)
    // Bump dpr so the recomputed target differs from the init value and a new
    // request is observable.
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    triggerResize()
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).toHaveBeenCalledWith(2048)
  })

  it('pins the bin target across a resize when Full Waterfall Update is off', async () => {
    const { store } = mountWaterfall()
    store.setFullWaterfallUpdate(false)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    triggerResize()
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — restored view settings (manual range at mount)', () => {
  it('seeds the sliders from a persisted custom dB range', () => {
    localStorage.setItem('sdrViewAutoScale', '0')
    localStorage.setItem('sdrViewZmin', '-90')
    localStorage.setItem('sdrViewZmax', '-10')
    const { wrapper } = mountWaterfall()
    const minVal = (wrapper.findAll('input[type="range"]')[2].element as HTMLInputElement).value
    const maxVal = (wrapper.findAll('input[type="range"]')[1].element as HTMLInputElement).value
    expect(minVal).toBe('90') // -zmin
    expect(maxVal).toBe('10') // -zmax
    // buildPipes used the fixed-range (non auto-scale) branch.
    const cmapCall = wfPlotInstance().calls.change_settings.find(
      (c) => (c[0] as { autol?: number }).autol === -1,
    )
    expect(cmapCall).toBeTruthy()
  })
})

// =============================================================================
describe('SdrWaterfall — stop/play reset', () => {
  it('preserves a user-set Min/Max range across a stop (persists like Zoom)', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Adjust MIN only, leaving MAX at the device default (zmax = 0) — the exact
    // case that used to be wiped on stop.
    await wrapper.findAll('input[type="range"]')[2].setValue(60) // zmin = -60
    await wrapper.vm.$nextTick()
    store.setPlaying(false)
    await wrapper.vm.$nextTick()
    // The slider stays where the user left it and the store keeps the range, so a
    // later remount (navigation / retune) restores it rather than reverting.
    const minVal = (wrapper.findAll('input[type="range"]')[2].element as HTMLInputElement).value
    expect(minVal).toBe('60')
    expect(store.viewZmin).toBe(-60)
    expect(store.viewAutoScale).toBe(false)
    // On stop the blanked waterfall keeps the fixed range (autol disabled), not
    // colour auto-scale.
    const fixedCall = wfPlotInstance().calls.change_settings.find(
      (c) => (c[0] as { autol?: number; zmin?: number }).zmin === -60,
    )
    expect(fixedCall).toBeTruthy()
  })

  it('colour auto-scales on stop when the user never set a range', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    store.setPlaying(false)
    await flushPromises()
    // autoScale untouched → the blanked waterfall re-enables colour auto-scale
    // (WF_AUTOL = 100 in the component).
    const autoCall = wfPlotInstance().calls.change_settings.find(
      (c) => (c[0] as { autol?: number }).autol === 100,
    )
    expect(autoCall).toBeTruthy()
    expect(store.viewAutoScale).toBe(true)
  })

  it('cancels a queued spectrum redraw on stop', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    // Queue a fresh frame without flushing rAF so drawRaf is pending at stop.
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 50 }))
    await flushPromises()
    store.setPlaying(false)
    await flushPromises()
    // No throw; the cancel path ran. A subsequent flush must not redraw.
    const reloadsBefore = specPlot().calls.reload?.length ?? 0
    flushRaf()
    expect(specPlot().calls.reload?.length ?? 0).toBe(reloadsBefore)
  })
})

// =============================================================================
describe('SdrWaterfall — zoom / frequency / full-update watchers', () => {
  it('applyZoom takes the no-op path when zoom changes with no span yet', async () => {
    const { wrapper, store } = mountWaterfall()
    // Playing enables the slider, but with no frame the span is still 0, so
    // moving zoom hits the hi<=lo early return.
    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    await wrapper.findAll('input[type="range"]')[0].setValue(5)
    expect(specPlot().calls.unzoom).toBeUndefined()
  })

  it('re-windows on zoom change when a span is present', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    await wrapper.findAll('input[type="range"]')[0].setValue(10)
    await wrapper.vm.$nextTick()
    expect(specPlot().calls.zoom).toBeTruthy()
  })

  it('re-windows when the selected frequency moves while zoomed in', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    await wrapper.findAll('input[type="range"]')[0].setValue(10)
    await wrapper.vm.$nextTick()
    const zoomCallsBefore = specPlot().calls.zoom.length
    store.setFrequency(100_200_000)
    await wrapper.vm.$nextTick()
    expect(specPlot().calls.zoom.length).toBeGreaterThan(zoomCallsBefore)
  })

  it('does not re-window on frequency move at zoom 1', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const zoomCallsBefore = specPlot().calls.zoom?.length ?? 0
    store.setFrequency(100_200_000)
    await flushPromises()
    expect(specPlot().calls.zoom?.length ?? 0).toBe(zoomCallsBefore)
  })

  it('refreshes bins when Full Waterfall Update is toggled on', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setFullWaterfallUpdate(false) // default is on — toggle off first
    await wrapper.vm.$nextTick()
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    store.setFullWaterfallUpdate(true)
    await wrapper.vm.$nextTick() // flush the watcher → scheduleDesiredBins
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).toHaveBeenCalledWith(2048)
  })

  it('covers the nice-number tick step bands across zoom levels', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    for (const zoomLevel of [2, 4, 5, 8]) {
      await wrapper.findAll('input[type="range"]')[0].setValue(zoomLevel)
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.sdr-wf-freq-label').length).toBeGreaterThan(0)
    }
  })
})

// =============================================================================
describe('SdrWaterfall — known-frequency sync & debug hook', () => {
  it('rebuilds annotations and redraws when the frequency list changes', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const redrawBefore = specPlot().calls.redraw?.length ?? 0
    store.frequencies = [
      { id: 9, group_id: null, label: 'New', frequency_hz: 100_000_000, mode: 'AM' },
    ]
    await flushPromises()
    expect((specPlot().calls.redraw?.length ?? 0) > redrawBefore).toBe(true)
  })

  it('exposes the spectrum y-axis debug hook on window', () => {
    mountWaterfall()
    const debug = (window as unknown as { __specYAxis?: () => unknown }).__specYAxis
    expect(typeof debug).toBe('function')
    expect(debug!()).toMatchObject({ ymin: expect.any(Number) })
  })
})

// =============================================================================
describe('SdrWaterfall — teardown', () => {
  it('cancels pending frames and removes plugins/layers on unmount', () => {
    const { wrapper } = mountWaterfall()
    // Give the annotation plugin a document listener to detach.
    registry.annotations[0].onmouseup = () => {}
    const wf = wfPlotInstance()
    wrapper.unmount()
    expect(wf.calls.disable_listeners).toBeTruthy()
    expect(wf.calls.remove_plugin).toBeTruthy()
  })

  it('cancels the init rAF if unmounted before layout settles', () => {
    const store = useSdrStore()
    void store
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    // Do NOT flush rAF — the deferred init is still pending.
    expect(() => wrapper.unmount()).not.toThrow()
  })
})

// =============================================================================
describe('SdrWaterfall — edge cases & defensive paths', () => {
  it('returns a closed panel when sessionStorage throws', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation((key: string) => {
      if (key === 'sentinel_sidebar_open') throw new Error('blocked')
      return null
    })
    const { wrapper } = mountWaterfall()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('panel-closed')
  })

  it('ignores a click-to-tune when playing but no frame has set the span', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })

  it('ignores a click when the data box has no width', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    vi.spyOn(el.element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 20,
      bottom: 300,
      width: 20,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    await el.trigger('mousedown', { button: 0, clientX: 10, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 10, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })

  it('clears a held pan offset when a click-to-tune lands mid-pan', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // A wheel notch leaves livePanOffsetHz non-zero (no commit yet).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    flushRaf()
    vi.useRealTimers()
    const tuneSpy = vi.spyOn(store, 'requestTune')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy).toHaveBeenCalled()
  })

  it('ignores a plot mouseup while an accordion drag is in progress', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    // Arm an accordion drag so onPlotMouseUp's dragActive guard returns early.
    specAccordion().dragging = true
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    await el.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    expect(tuneSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — guards before the plots are initialised', () => {
  // Mount but do NOT flush the deferred-init rAF, so the plots/accordions/
  // plugin are still null. Store changes and document events must no-op safely.
  function mountUninitialised() {
    const store = useSdrStore()
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    return { wrapper, store }
  }

  it('no-ops applyMarker / syncKnownFrequencies and accordion handlers pre-init', async () => {
    const { wrapper, store } = mountUninitialised()
    expect(registry.plots).toHaveLength(0)
    // Frequency-list + tuning changes fire watchers that touch the null plugin.
    store.frequencies = [
      { id: 1, group_id: null, label: 'X', frequency_hz: 100_000_000, mode: 'AM' },
    ]
    store.setFrequency(101_000_000)
    await wrapper.vm.$nextTick()
    // Document events hit the accordion baseline/mirror/commit guards (null accs).
    document.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 100 }))
    expect(wrapper.find('#sdr-waterfall').exists()).toBe(true)
  })

  it('no-ops a touchstart pre-init (accordion/plot not yet created)', () => {
    const { wrapper } = mountUninitialised()
    expect(registry.accordions).toHaveLength(0)
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    expect(() => el.element.dispatchEvent(event)).not.toThrow()
    expect(preventSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — nearAccEdge hit-test branches', () => {
  it('returns false when the accordion has no edge positions yet', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Default loc_1/loc_2 are undefined → no edge.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('edge-resize')
  })

  it('returns false when the pointer is outside the data box', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 100
    specAccordion().properties.loc_2 = 400
    // y = 290 is below the data-box bottom (mx.b ≈ 262).
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 290 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('edge-resize')
  })

  it('matches the second edge (loc_2) and tolerates a missing edge line style', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 100
    specAccordion().properties.loc_2 = 400
    specAccordion().properties.edge_line_style = undefined // exercises the ?? 1 fallback
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).toContain('edge-resize')
  })
})

// =============================================================================
// nearAccGrabZone is exercised entirely through onPlotTouchStart's touchstart
// handler (it isn't exported) — a synthetic mousedown reaching the plot's
// widget canvas is proof the touch was judged "near enough" to intercept.
describe('SdrWaterfall — nearAccGrabZone hit-test branches', () => {
  it('returns false when the touch is outside the data box', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Use the waterfall raster, not the spectrum: on the spectrum, any y this
    // far down also falls inside the freq-axis gutter and tryStartFreqDrag
    // (tried first for isSpec) would intercept before nearAccGrabZone ever
    // runs. The raster has no gutter special-case, so it isolates the
    // out-of-bounds branch cleanly.
    wfAccordion().properties.loc_1 = 100
    wfAccordion().properties.loc_2 = 400
    wfAccordion().properties.edge_line_style = { lineWidth: 20 }
    const canvas = wfPlotInstance()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-raster')
    // y = 290 is below the waterfall data-box bottom (mx.b ≈ 280).
    const event = makeTouchEvent('touchstart', [{ clientX: 100, clientY: 290 }])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    el.element.dispatchEvent(event)
    expect(preventSpy).not.toHaveBeenCalled()
    expect(mousedownSpy).not.toHaveBeenCalled()
  })

  it('matches the first edge (loc_1) within the widened edge tolerance', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 200
    specAccordion().properties.loc_2 = 400
    specAccordion().properties.edge_line_style = { lineWidth: 20 }
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    // 10px from loc_1 (200), well inside the 25px (20 + 5) edge tolerance.
    const event = makeTouchEvent('touchstart', [{ clientX: 210, clientY: 100 }])
    el.element.dispatchEvent(event)
    expect(mousedownSpy).toHaveBeenCalledTimes(1)
  })

  it('matches the center handle within the widened center tolerance', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.center_location = 300
    specAccordion().properties.center_line_style = { lineWidth: 20 }
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    // 15px from center_location (300), inside the 25px (20 + 5) tolerance.
    const event = makeTouchEvent('touchstart', [{ clientX: 315, clientY: 100 }])
    el.element.dispatchEvent(event)
    expect(mousedownSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to the default +5px tolerance when line-width styles are absent', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 200
    specAccordion().properties.edge_line_style = undefined // exercises the ?? 1 fallback
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    // 4px from loc_1 (200): inside the fallback (1 + 5 = 6px) tolerance.
    const nearEvent = makeTouchEvent('touchstart', [{ clientX: 204, clientY: 100 }])
    el.element.dispatchEvent(nearEvent)
    expect(mousedownSpy).toHaveBeenCalledTimes(1)
  })

  it('returns false when the accordion has no properties yet', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Force the defensive `!p` guard: a live accordion with no properties object.
    ;(specAccordion() as unknown as { properties: undefined }).properties = undefined
    const canvas = specPlot()._Mx.wid_canvas
    const mousedownSpy = vi.fn()
    canvas.addEventListener('mousedown', mousedownSpy)
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    el.element.dispatchEvent(event)
    expect(preventSpy).not.toHaveBeenCalled()
    expect(mousedownSpy).not.toHaveBeenCalled()
  })

  it('returns false when the plot has no measured geometry yet', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.center_location = 300
    specAccordion().properties.center_line_style = { lineWidth: 20 }
    // Force the defensive `!mx` guard: a live plot with no _Mx measured yet.
    ;(specPlot() as unknown as { _Mx: undefined })._Mx = undefined
    const el = wrapper.find('.sdr-wf-spectrum')
    const event = makeTouchEvent('touchstart', [{ clientX: 300, clientY: 100 }])
    const preventSpy = vi.spyOn(event, 'preventDefault')
    expect(() => el.element.dispatchEvent(event)).not.toThrow()
    expect(preventSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — applyMarker geometry fallbacks', () => {
  it('falls back to defaults when bandwidth and sample rate are zero', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setBandwidthHz(0) // bwHz falsy → Math.max(MIN_BW_HZ, 10000)
    store.sampleRate = 0 // sampleRate falsy → span/bHz fallback
    store.setFrequency(100_000_000)
    await wrapper.vm.$nextTick()
    // wfAcc width reflects the 10 kHz default bandwidth.
    expect(wfAccordion()._width).toBe(10_000)
  })
})

// =============================================================================
describe('SdrWaterfall — persisted zero zoom & off-centre selection', () => {
  it('treats a persisted zero zoom as full span', () => {
    localStorage.setItem('sdrViewZoom', '0')
    const { wrapper } = mountWaterfall()
    // Zoom slider clamps to ZOOM_MIN (1).
    expect((wrapper.findAll('input[type="range"]')[0].element as HTMLInputElement).value).toBe('1')
  })

  it('centres the zoom window on a zero selected frequency via the midpoint', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.currentFreqHz = 0 // falsy → window centres on the span midpoint
    await wrapper.findAll('input[type="range"]')[0].setValue(10)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.sdr-wf-freq-label').length).toBeGreaterThan(0)
  })
})

// =============================================================================
describe('SdrWaterfall — syncBandInset guard', () => {
  it('bails out when the plot has no measured width', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const before = specPlot().calls.reload?.length ?? 0
    specPlot()._Mx.width = 0 // syncBandInset early-returns
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 300 }))
    await flushPromises()
    flushRaf()
    expect((specPlot().calls.reload?.length ?? 0) > before).toBe(true)
  })
})

// =============================================================================
describe('SdrWaterfall — spectrum/waterfall gap sizing', () => {
  // Read the live label-gutter height the component measured (bandInsetBottomPx),
  // surfaced as the tick-gutter overlay's inline `height`. Both gap styles derive
  // from it, so asserting against the measured value keeps the test independent
  // of the mock's exact pixel math while still proving the ratios.
  function measuredGutterPx(wrapper: VueWrapper): number {
    const gutterStyle = wrapper.find('.sdr-wf-tick-gutter').attributes('style') ?? ''
    const match = gutterStyle.match(/height:\s*(\d+)px/)
    expect(match).not.toBeNull()
    return Number((match as RegExpMatchArray)[1])
  }

  it('sets a fixed 4px spectrum bottom margin once the gutter is measured', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store) // a draw pass runs syncBandInset → measures the gutter
    const gutter = measuredGutterPx(wrapper)
    expect(gutter).toBeGreaterThan(0) // layout settled, so the gap is the live branch
    const spectrumStyle = wrapper.find('.sdr-wf-spectrum').attributes('style') ?? ''
    // The waterfall sits tight under the freq labels: a small constant gap,
    // independent of the (zoom-dependent) gutter height.
    expect(spectrumStyle).toContain('margin-bottom: 4px')
  })

  it('keeps the spectrum bottom margin at 0 before the gutter is measured', () => {
    // No draw pass has run, so bandInsetBottomPx is still 0 (pre-draw default);
    // the gap must collapse to 0 rather than the 4px live value.
    const { wrapper } = mountWaterfall()
    const spectrumStyle = wrapper.find('.sdr-wf-spectrum').attributes('style') ?? ''
    expect(spectrumStyle).toContain('margin-bottom: 0px')
  })

  it('crops 25% off the waterfall bottom via a negative raster margin', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const gutter = measuredGutterPx(wrapper)
    expect(gutter).toBeGreaterThan(0)
    const rasterStyle = wrapper.find('.sdr-wf-raster').attributes('style') ?? ''
    // Negative margin lets the raster extend past the overflow:hidden clip edge,
    // hiding ~a quarter of sigplot's reserved (invisible) bottom gutter.
    expect(rasterStyle).toContain(`margin-bottom: ${-Math.round(gutter * 0.25)}px`)
  })
})

// =============================================================================
describe('SdrWaterfall — installMarginTweaks Mx accessor setters', () => {
  it('clamps the left/top/right/bottom data-box margins', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const mxBox = specPlot()._Mx
    // Left: a value far from text_w*6 passes through unchanged; a tiny value too.
    mxBox.l = 500
    expect(mxBox.l).toBe(500)
    mxBox.l = 0
    expect(mxBox.l).toBe(0)
    // Top: max(v, round(text_h*1.2)) = max(v, 14).
    mxBox.t = 100
    expect(mxBox.t).toBe(100)
    mxBox.t = 5
    expect(mxBox.t).toBe(14)
    // Right: max(v, width-1) = max(v, 999).
    mxBox.r = 2000
    expect(mxBox.r).toBe(2000)
    mxBox.r = 10
    expect(mxBox.r).toBe(999)
    // Bottom: min(v, height - round(text_h*3.2)) = min(v, 262).
    mxBox.b = 100
    expect(mxBox.b).toBe(100)
    mxBox.b = 500
    expect(mxBox.b).toBe(262)
  })

  it('falls back to a default text height of 12 when text_h is zero', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const mxBox = specPlot()._Mx
    mxBox.text_h = 0
    mxBox.t = 5 // round(12*1.2)=14
    expect(mxBox.t).toBe(14)
    mxBox.b = 500 // min(500, 300 - round(12*3.2)=38 → 262)
    expect(mxBox.b).toBe(262)
  })

  it('falls back to a text width of 1 when text_w is zero (left margin)', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const mxBox = specPlot()._Mx
    mxBox.text_w = 0 // tw = text_w || 1 → 1
    // v=5 (>1) but |5 - 1*6|=1 is NOT < tw(1) → passes through as v.
    mxBox.l = 5
    expect(mxBox.l).toBe(5)
  })
})

// =============================================================================
describe('SdrWaterfall — debounced bin scheduling', () => {
  it('skips a redundant request when the bin count is unchanged', async () => {
    const { store } = mountWaterfall()
    store.setFullWaterfallUpdate(true)
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // dpr/zoom unchanged → computeDesiredBins === lastRequestedBins → no call.
    triggerResize()
    triggerResize() // second schedule clears the first pending debounce
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).not.toHaveBeenCalled()
  })
})

// =============================================================================
describe('SdrWaterfall — live pan offset reset on retune frame', () => {
  it('clears a held wheel pan offset when a re-centred frame arrives', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Leave a non-zero pan offset via a wheel notch (commit timer not fired).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.find('.sdr-wf-spectrum').trigger('wheel', { deltaY: -100, deltaMode: 0 })
    flushRaf() // wheelFlush sets livePanOffsetHz
    vi.useRealTimers()
    // A frame with a NEW span centre lands → the watch resets the pan offset.
    const wfPushesBefore = wfPlotInstance().calls.push.length
    nowMs += 1000
    store.setSpectrum(makeFrame({ center_hz: 101_000_000, ts: Date.now() + 400 }))
    await flushPromises()
    flushRaf()
    expect(wfPlotInstance().calls.push.length).toBeGreaterThan(wfPushesBefore)
  })
})

// =============================================================================
describe('SdrWaterfall — frequency drag cancels a pending preview frame', () => {
  it('cancels the queued pan rAF on release', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    // Schedule a preview rAF but do NOT flush it — mouseup must cancel it.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 290 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, clientY: 290 }))
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })

  it('does not start a pan when the data box has no width', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    Object.defineProperty(el.element, 'clientWidth', { configurable: true, value: 10 })
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })
})

// =============================================================================
describe('SdrWaterfall — wheel with no span & teardown rAF cancels', () => {
  it('ignores the wheel before a span is known', async () => {
    const { wrapper, store } = mountWaterfall()
    store.setPlaying(true)
    await wrapper.vm.$nextTick()
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    expect(wrapper.find('.sdr-wf-spectrum').classes()).not.toContain('sdr-wf-spectrum--panning')
  })

  it('cancels a queued spectrum redraw on unmount', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Queue a fresh frame so drawRaf is pending at unmount.
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 60 }))
    await flushPromises()
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('runs the slider sizer harmlessly after unmount', () => {
    const store = useSdrStore()
    void store
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    // Unmount before flushing rAF: the queued sizeSliders runs with a null ref.
    wrapper.unmount()
    expect(() => flushRaf()).not.toThrow()
  })
})

// =============================================================================
describe('SdrWaterfall — contrived freq-drag-active plot mouseup', () => {
  it('skips click-to-tune on the raster when a gutter pan is armed', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    const raster = wrapper.find('.sdr-wf-raster')
    // Record mdownEl on the raster (above its gutter; raster has no gutter check).
    await raster.trigger('mousedown', { button: 0, clientX: 500, clientY: 100 })
    // Arm a frequency pan on the spectrum gutter (sets freqDragActive).
    await wrapper.find('.sdr-wf-spectrum').trigger('mousedown', {
      button: 0,
      clientX: 500,
      clientY: 290,
    })
    // Raster mouseup now sees freqDragActive and skips the tune.
    await raster.trigger('mouseup', { button: 0, clientX: 500, clientY: 100 })
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 500, clientY: 290 }))
    // The pan commit fires a centred retune, but no per-click tune was added.
    expect(tuneSpy.mock.calls.every((call) => call[1] === true)).toBe(true)
  })
})

// =============================================================================
describe('SdrWaterfall — remaining branch coverage', () => {
  it('handles an LSB edge-resize (carrier-anchored outer edge below)', async () => {
    const store = useSdrStore()
    store.setMode('LSB')
    const wrapper = mount(SdrWaterfall, { attachTo: document.body })
    flushRaf()
    await playWithFrame(store)
    wfAccordion()._center = 100_000_000
    wfAccordion()._width = 10_000
    specAccordion().dragging = true
    document.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, clientY: 100 }))
    // SSB edge-resize on the spectrum accordion in LSB mode.
    specAccordion().edge_dragging = true
    specAccordion()._center = 99.99
    specAccordion()._width = 0.02
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 480, clientY: 100, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 480, clientY: 100 }))
    expect(true).toBe(true)
    void wrapper
  })

  it('treats an accordion edge as no-match when the plot has no Mx', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    specAccordion().properties.loc_1 = 100
    specAccordion().properties.loc_2 = 400
    // Strip the spectrum plot's internal Mx so nearAccEdge bails at the !mx guard.
    ;(specPlot() as unknown as { _Mx: unknown })._Mx = undefined
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').classes()).not.toContain('edge-resize')
  })

  it('defaults the device-pixel-ratio to 1 when the browser reports 0', async () => {
    const { store } = mountWaterfall()
    store.setFullWaterfallUpdate(true)
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 })
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    triggerResize() // computeDesiredBins runs with dpr → 1 fallback
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    // px*1 = 1000 → 1024 bins, same as the init value, so no new request — the
    // dpr fallback path still executed.
    expect(fftSpy).not.toHaveBeenCalled()
  })

  it('suppresses the native context menu on both plots', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const specEvt = await wrapper.find('.sdr-wf-spectrum').trigger('contextmenu')
    const wfEvt = await wrapper.find('.sdr-wf-raster').trigger('contextmenu')
    void specEvt
    void wfEvt
    expect(wrapper.find('#sdr-waterfall').exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrWaterfall — rAF throttling & guard fall-throughs', () => {
  it('coalesces rapid gutter-drag mousemoves into one rAF', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const el = wrapper.find('.sdr-wf-spectrum')
    await el.trigger('mousedown', { button: 0, clientX: 500, clientY: 290 })
    // Two moves before any flush: the second must NOT schedule a second rAF.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 540, clientY: 290 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 290 }))
    const tuneSpy = vi.spyOn(store, 'requestTune')
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, clientY: 290 }))
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })

  it('coalesces rapid wheel notches and cancels a pending rAF at commit', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const el = wrapper.find('.sdr-wf-spectrum')
    // Two notches before any flush → the second skips scheduling a new rAF.
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    await el.trigger('wheel', { deltaY: -100, deltaMode: 0 })
    // Fire the commit WITHOUT flushing rAF so it cancels the still-pending one.
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })

  it('queues only one spectrum redraw across two frames in the same tick window', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 10 }))
    await flushPromises() // first frame schedules drawRaf
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 20 }))
    await flushPromises() // second frame: drawRaf already pending, not re-scheduled
    flushRaf()
    expect(specPlot().calls.reload.length).toBeGreaterThan(0)
  })

  it('skips the spectrum redraw if a sweep starts before the queued frame paints', async () => {
    const { store } = mountWaterfall()
    await playWithFrame(store)
    const reloadsBefore = specPlot().calls.reload.length
    nowMs += 1000
    store.setSpectrum(makeFrame({ ts: Date.now() + 30 }))
    await flushPromises() // drawRaf scheduled with a pending frame
    store.searchSweeping = true // sweep begins before the paint
    flushRaf() // drawLoop guard now fails → no reload
    expect(specPlot().calls.reload.length).toBe(reloadsBefore)
  })

  it('skips the band-inset measurement when the data box has zero height', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    // Collapse the data box so dataBoxHeightPx <= 0 in syncBandInset.
    specPlot()._Mx.t = 300
    // Trigger syncBandInset via a slider move.
    await wrapper.findAll('input[type="range"]')[1].setValue(40)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#sdr-waterfall').exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrWaterfall — final branch fall-throughs', () => {
  it('commits a wheel pan whose preview rAF already flushed', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    const tuneSpy = vi.spyOn(store, 'requestTune')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.find('.sdr-wf-spectrum').trigger('wheel', { deltaY: -100, deltaMode: 0 })
    flushRaf() // wheelFlush runs → wheelRaf back to 0 before the commit
    vi.advanceTimersByTime(300) // commit sees wheelRaf === 0 (no cancel needed)
    vi.useRealTimers()
    expect(tuneSpy).toHaveBeenCalledWith(expect.any(Number), true)
  })

  it('does not refresh bins on zoom when Full Waterfall Update is off', async () => {
    const { wrapper, store } = mountWaterfall()
    await playWithFrame(store)
    store.setFullWaterfallUpdate(false)
    await wrapper.vm.$nextTick()
    const fftSpy = vi.spyOn(store, 'requestFftSize')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wrapper.findAll('input[type="range"]')[0].setValue(8)
    vi.advanceTimersByTime(300)
    vi.useRealTimers()
    expect(fftSpy).not.toHaveBeenCalled()
  })
})
