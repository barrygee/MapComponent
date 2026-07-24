import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSdrStore } from './sdr'

type SdrStore = ReturnType<typeof useSdrStore>

function stubFetch(payload: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => payload }))
}

describe('sdr store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('has the expected defaults', () => {
    const store = useSdrStore()
    expect(store.radios).toEqual([])
    expect(store.currentFreqHz).toBe(100_000_000)
    expect(store.currentMode).toBe('WFM')
    expect(store.sampleRate).toBe(2_048_000)
    expect(store.autoCenterWaterfallOnTune).toBe(true)
    expect(store.fullWaterfallUpdate).toBe(true)
    expect(store.snapToKnown).toBe(true)
    expect(store.showBandPlan).toBe(true)
    expect(store.showKnownFreqs).toBe(true)
    expect(store.resumeDelaySec).toBe(0)
    expect(store.viewZoom).toBe(1)
    expect(store.viewAutoScale).toBe(true)
  })

  // ── persisted boolean toggles (read on init) ───────────────────────────────
  const boolReads: Array<{ name: string; lsKey: string; read: (s: SdrStore) => boolean }> = [
    {
      name: 'autoCenter',
      lsKey: 'sdrAutoCenterWaterfallOnTune',
      read: (s) => s.autoCenterWaterfallOnTune,
    },
    { name: 'fullWaterfall', lsKey: 'sdrFullWaterfallUpdate', read: (s) => s.fullWaterfallUpdate },
    { name: 'snapToKnown', lsKey: 'sdrSnapToKnown', read: (s) => s.snapToKnown },
    { name: 'showBandPlan', lsKey: 'sdrShowBandPlan', read: (s) => s.showBandPlan },
    { name: 'showKnownFreqs', lsKey: 'sdrShowKnownFreqs', read: (s) => s.showKnownFreqs },
    { name: 'viewAutoScale', lsKey: 'sdrViewAutoScale', read: (s) => s.viewAutoScale },
  ]
  it.each(boolReads)('reads $name as false when stored as "0"', ({ lsKey, read }) => {
    localStorage.setItem(lsKey, '0')
    expect(read(useSdrStore())).toBe(false)
  })

  it('defaults all toggles to true when localStorage read throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const store = useSdrStore()
    expect(store.autoCenterWaterfallOnTune).toBe(true)
    expect(store.fullWaterfallUpdate).toBe(true)
    expect(store.snapToKnown).toBe(true)
    expect(store.showBandPlan).toBe(true)
    expect(store.showKnownFreqs).toBe(true)
    expect(store.viewAutoScale).toBe(true)
    expect(store.resumeDelaySec).toBe(0)
  })

  // ── simple boolean setters (set ref + persist, swallow failures) ───────────
  const boolSetters: Array<{
    name: string
    lsKey: string
    apply: (s: SdrStore, on: boolean) => void
    read: (s: SdrStore) => boolean
  }> = [
    {
      name: 'setFullWaterfallUpdate',
      lsKey: 'sdrFullWaterfallUpdate',
      apply: (s, on) => s.setFullWaterfallUpdate(on),
      read: (s) => s.fullWaterfallUpdate,
    },
    {
      name: 'setSnapToKnown',
      lsKey: 'sdrSnapToKnown',
      apply: (s, on) => s.setSnapToKnown(on),
      read: (s) => s.snapToKnown,
    },
    {
      name: 'setShowBandPlan',
      lsKey: 'sdrShowBandPlan',
      apply: (s, on) => s.setShowBandPlan(on),
      read: (s) => s.showBandPlan,
    },
    {
      name: 'setShowKnownFreqs',
      lsKey: 'sdrShowKnownFreqs',
      apply: (s, on) => s.setShowKnownFreqs(on),
      read: (s) => s.showKnownFreqs,
    },
  ]
  it.each(boolSetters)('$name updates the ref and persists', ({ lsKey, apply, read }) => {
    const store = useSdrStore()
    apply(store, false)
    expect(read(store)).toBe(false)
    expect(localStorage.getItem(lsKey)).toBe('0')
    apply(store, true)
    expect(localStorage.getItem(lsKey)).toBe('1')
  })
  it.each(boolSetters)('$name swallows write failures', ({ apply, read }) => {
    const store = useSdrStore()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => apply(store, false)).not.toThrow()
    expect(read(store)).toBe(false)
  })

  describe('setAutoCenterWaterfallOnTune', () => {
    it('persists the flag', () => {
      const store = useSdrStore()
      store.setAutoCenterWaterfallOnTune(false)
      expect(store.autoCenterWaterfallOnTune).toBe(false)
      expect(localStorage.getItem('sdrAutoCenterWaterfallOnTune')).toBe('0')
    })

    it('clears a non-zero tuning offset and re-tunes when turned on', () => {
      const store = useSdrStore()
      store.setTuningOffsetHz(5000)
      store.setAutoCenterWaterfallOnTune(true)
      expect(store.tuningOffsetHz).toBe(0)
      expect(store.tuneRequest?.hz).toBe(store.currentFreqHz)
    })

    it('does not re-tune when the offset is already zero', () => {
      const store = useSdrStore()
      store.setAutoCenterWaterfallOnTune(true)
      expect(store.tuneRequest).toBeNull()
    })

    it('swallows write failures', () => {
      const store = useSdrStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setAutoCenterWaterfallOnTune(false)).not.toThrow()
    })
  })

  // ── hydrate-from-DB for the boolean toggles ────────────────────────────────
  const hydrateBool: Array<{
    name: string
    dbKey: string
    hydrate: (s: SdrStore) => Promise<void>
    read: (s: SdrStore) => boolean
  }> = [
    {
      name: 'autoCenter',
      dbKey: 'autoCenterWaterfallOnTune',
      hydrate: (s) => s.hydrateAutoCenterFromDb(),
      read: (s) => s.autoCenterWaterfallOnTune,
    },
    {
      name: 'fullWaterfall',
      dbKey: 'fullWaterfallUpdate',
      hydrate: (s) => s.hydrateFullWaterfallUpdateFromDb(),
      read: (s) => s.fullWaterfallUpdate,
    },
    {
      name: 'snapToKnown',
      dbKey: 'snapToKnown',
      hydrate: (s) => s.hydrateSnapToKnownFromDb(),
      read: (s) => s.snapToKnown,
    },
    {
      name: 'showBandPlan',
      dbKey: 'showBandPlan',
      hydrate: (s) => s.hydrateShowBandPlanFromDb(),
      read: (s) => s.showBandPlan,
    },
    {
      name: 'showKnownFreqs',
      dbKey: 'showKnownFreqs',
      hydrate: (s) => s.hydrateShowKnownFreqsFromDb(),
      read: (s) => s.showKnownFreqs,
    },
  ]
  it.each(hydrateBool)(
    'hydrate $name applies a differing DB value',
    async ({ dbKey, hydrate, read }) => {
      stubFetch({ [dbKey]: false })
      const store = useSdrStore()
      await hydrate(store)
      expect(read(store)).toBe(false)
    },
  )
  it.each(hydrateBool)(
    'hydrate $name ignores a non-boolean DB value',
    async ({ dbKey, hydrate, read }) => {
      stubFetch({ [dbKey]: 'nope' })
      const store = useSdrStore()
      await hydrate(store)
      expect(read(store)).toBe(true)
    },
  )
  it.each(hydrateBool)(
    'hydrate $name returns early on a non-ok response',
    async ({ hydrate, read }) => {
      stubFetch({}, false)
      const store = useSdrStore()
      await hydrate(store)
      expect(read(store)).toBe(true)
    },
  )
  it.each(hydrateBool)('hydrate $name swallows fetch errors', async ({ hydrate, read }) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const store = useSdrStore()
    await expect(hydrate(store)).resolves.toBeUndefined()
    expect(read(store)).toBe(true)
  })

  // ── resume delay (numeric) ─────────────────────────────────────────────────
  describe('resumeDelaySec', () => {
    it('reads a valid stored value', () => {
      localStorage.setItem('sdrResumeDelaySec', '5')
      expect(useSdrStore().resumeDelaySec).toBe(5)
    })
    it('falls back to 0 for a negative or non-numeric stored value', () => {
      localStorage.setItem('sdrResumeDelaySec', '-3')
      expect(useSdrStore().resumeDelaySec).toBe(0)
      localStorage.clear()
      localStorage.setItem('sdrResumeDelaySec', 'abc')
      expect(useSdrStore().resumeDelaySec).toBe(0)
    })
    it('clamps and floors values on set', () => {
      const store = useSdrStore()
      store.setResumeDelaySec(7.9)
      expect(store.resumeDelaySec).toBe(7)
      expect(localStorage.getItem('sdrResumeDelaySec')).toBe('7')
      store.setResumeDelaySec(-1)
      expect(store.resumeDelaySec).toBe(0)
    })
    it('swallows write failures', () => {
      const store = useSdrStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setResumeDelaySec(3)).not.toThrow()
    })
    it('hydrates a valid value from the DB', async () => {
      stubFetch({ resumeDelaySec: 9 })
      const store = useSdrStore()
      await store.hydrateResumeDelaySecFromDb()
      expect(store.resumeDelaySec).toBe(9)
    })
    it('ignores an invalid DB value, non-ok, and errors', async () => {
      stubFetch({ resumeDelaySec: -1 })
      const store = useSdrStore()
      await store.hydrateResumeDelaySecFromDb()
      expect(store.resumeDelaySec).toBe(0)
      stubFetch({}, false)
      await store.hydrateResumeDelaySecFromDb()
      expect(store.resumeDelaySec).toBe(0)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      await expect(store.hydrateResumeDelaySecFromDb()).resolves.toBeUndefined()
    })
  })

  // ── view settings ──────────────────────────────────────────────────────────
  describe('view settings', () => {
    it('reads numeric view settings, falling back on bad values', () => {
      localStorage.setItem('sdrViewZoom', '4')
      localStorage.setItem('sdrViewZmin', 'NaNish')
      const store = useSdrStore()
      expect(store.viewZoom).toBe(4)
      expect(store.viewZmin).toBe(0) // fallback for non-finite
    })
    it('setViewSettings updates only the provided fields and persists', () => {
      const store = useSdrStore()
      store.setViewSettings({ zoom: 3 })
      expect(store.viewZoom).toBe(3)
      expect(store.viewZmin).toBe(0) // untouched
      store.setViewSettings({ zmin: -10, zmax: 5, autoScale: false })
      expect(store.viewZmin).toBe(-10)
      expect(store.viewZmax).toBe(5)
      expect(store.viewAutoScale).toBe(false)
      expect(localStorage.getItem('sdrViewAutoScale')).toBe('0')
    })
    it('swallows write failures', () => {
      const store = useSdrStore()
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => store.setViewSettings({ zoom: 2 })).not.toThrow()
    })
  })

  // ── session restore / persist ──────────────────────────────────────────────
  describe('session', () => {
    it('restores radio/freq/mode/playing from sessionStorage on init', () => {
      sessionStorage.setItem('sdrLastRadioId', '7')
      sessionStorage.setItem('sdrLastFreqHz', '88500000')
      sessionStorage.setItem('sdrLastMode', 'AM')
      sessionStorage.setItem('sdrPlaying', '1')
      const store = useSdrStore()
      expect(store.currentRadioId).toBe(7)
      expect(store.currentFreqHz).toBe(88500000)
      expect(store.currentMode).toBe('AM')
      expect(store.playing).toBe(true)
    })
    it('swallows sessionStorage read errors on init', () => {
      vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(() => useSdrStore()).not.toThrow()
    })
    it('setRadio persists the radio id', () => {
      const store = useSdrStore()
      store.setRadio(3)
      expect(store.currentRadioId).toBe(3)
      expect(sessionStorage.getItem('sdrLastRadioId')).toBe('3')
    })
    it('setFrequency persists without a radio id when none is set', () => {
      const store = useSdrStore()
      store.setFrequency(99_000_000)
      expect(store.currentFreqHz).toBe(99_000_000)
      expect(sessionStorage.getItem('sdrLastFreqHz')).toBe('99000000')
      expect(sessionStorage.getItem('sdrLastRadioId')).toBeNull()
    })
    it('setMode and setPlaying persist', () => {
      const store = useSdrStore()
      store.setMode('USB')
      store.setPlaying(true)
      expect(sessionStorage.getItem('sdrLastMode')).toBe('USB')
      expect(sessionStorage.getItem('sdrPlaying')).toBe('1')
    })
    it('swallows sessionStorage write errors', () => {
      const store = useSdrStore()
      vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(() => store.setRadio(1)).not.toThrow()
    })
  })

  // ── simple mirror setters + request channels ───────────────────────────────
  it('setConnected, setBandwidthHz, setTuningOffsetHz and setSpectrum update refs', () => {
    const store = useSdrStore()
    store.setConnected(true)
    expect(store.connected).toBe(true)
    store.setBandwidthHz(12345)
    expect(store.bwHz).toBe(12345)
    store.setTuningOffsetHz(250)
    expect(store.tuningOffsetHz).toBe(250)
    const frame = { bins: [1, 2], center_hz: 1, sample_rate: 2, ts: 3 }
    store.setSpectrum(frame)
    expect(store.lastSpectrum).toBe(frame)
  })

  it('requestTune/requestBandwidth/requestFftSize set monotonically-nonced requests', () => {
    const store = useSdrStore()
    store.requestTune(101_000_000)
    expect(store.tuneRequest).toMatchObject({ hz: 101_000_000, center: false })
    store.requestTune(102_000_000, true)
    expect(store.tuneRequest).toMatchObject({ hz: 102_000_000, center: true })
    expect(store.tuneRequest!.nonce).toBeGreaterThan(1)

    store.requestBandwidth(15000)
    expect(store.bwRequest).toMatchObject({ hz: 15000 })
    store.requestFftSize(4096)
    expect(store.fftSizeRequest).toMatchObject({ bins: 4096 })
  })

  // ── REST loaders ────────────────────────────────────────────────────────────
  const loaders: Array<{
    name: string
    load: (s: SdrStore) => Promise<void>
    read: (s: SdrStore) => unknown[]
  }> = [
    { name: 'loadRadios', load: (s) => s.loadRadios(), read: (s) => s.radios },
    { name: 'loadGroups', load: (s) => s.loadGroups(), read: (s) => s.groups },
    { name: 'loadFrequencies', load: (s) => s.loadFrequencies(), read: (s) => s.frequencies },
  ]
  it.each(loaders)('$name stores the fetched rows on success', async ({ load, read }) => {
    stubFetch([{ id: 1 }])
    const store = useSdrStore()
    await load(store)
    expect(read(store)).toEqual([{ id: 1 }])
  })
  it.each(loaders)('$name leaves state unchanged on a non-ok response', async ({ load, read }) => {
    stubFetch([{ id: 1 }], false)
    const store = useSdrStore()
    await load(store)
    expect(read(store)).toEqual([])
  })
  it.each(loaders)('$name swallows fetch errors', async ({ load, read }) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const store = useSdrStore()
    await expect(load(store)).resolves.toBeUndefined()
    expect(read(store)).toEqual([])
  })

  // ── digital decode ─────────────────────────────────────────────────────────
  describe('digital decode', () => {
    it('defaults digitalEnabled to false', () => {
      expect(useSdrStore().digitalEnabled).toBe(false)
    })

    it('reads digitalEnabled=true from localStorage on init', () => {
      localStorage.setItem('sdrDigitalEnabled', '1')
      expect(useSdrStore().digitalEnabled).toBe(true)
    })

    it('falls back to false when localStorage throws on read', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useSdrStore().digitalEnabled).toBe(false)
      spy.mockRestore()
    })

    it('setDigitalEnabled updates state and persists', () => {
      const store = useSdrStore()
      store.setDigitalEnabled(true)
      expect(store.digitalEnabled).toBe(true)
      expect(localStorage.getItem('sdrDigitalEnabled')).toBe('1')
      store.setDigitalEnabled(false)
      expect(localStorage.getItem('sdrDigitalEnabled')).toBe('0')
    })

    it('setDigitalEnabled swallows a localStorage write error', () => {
      const store = useSdrStore()
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full')
      })
      expect(() => store.setDigitalEnabled(true)).not.toThrow()
      expect(store.digitalEnabled).toBe(true)
      spy.mockRestore()
    })

    it('hydrateDigitalEnabledFromDb applies the DB default', async () => {
      stubFetch({ digitalDecodeDefault: true })
      const store = useSdrStore()
      await store.hydrateDigitalEnabledFromDb()
      expect(store.digitalEnabled).toBe(true)
    })

    it('hydrateDigitalEnabledFromDb ignores a non-ok response', async () => {
      stubFetch({ digitalDecodeDefault: true }, false)
      const store = useSdrStore()
      await store.hydrateDigitalEnabledFromDb()
      expect(store.digitalEnabled).toBe(false)
    })

    it('hydrateDigitalEnabledFromDb ignores a non-boolean value', async () => {
      stubFetch({ digitalDecodeDefault: 'yes' })
      const store = useSdrStore()
      await store.hydrateDigitalEnabledFromDb()
      expect(store.digitalEnabled).toBe(false)
    })

    it('hydrateDigitalEnabledFromDb swallows fetch errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const store = useSdrStore()
      await expect(store.hydrateDigitalEnabledFromDb()).resolves.toBeUndefined()
      expect(store.digitalEnabled).toBe(false)
    })

    it('pushDecodeEvent prepends call rows and caps the log at 200', () => {
      const store = useSdrStore()
      for (let index = 0; index < 205; index++) {
        store.pushDecodeEvent({ type: 'decode_event', talkgroup: index, ts: index })
      }
      expect(store.decodeEvents).toHaveLength(200)
      // Newest first → the last pushed (talkgroup 204) is at the head.
      expect(store.decodeEvents[0].talkgroup).toBe(204)
    })

    it('pushDecodeEventBatch is a no-op for an empty batch', () => {
      const store = useSdrStore()
      store.pushDecodeEventBatch([])
      expect(store.decodeEvents).toHaveLength(0)
      expect(store.decodeLogs).toHaveLength(0)
    })

    it('pushDecodeEventBatch folds a frame of events newest-first across both buffers', () => {
      const store = useSdrStore()
      // Arrival order (oldest → newest): a call row, two log lines, another row.
      store.pushDecodeEventBatch([
        { type: 'decode_event', talkgroup: 1, ts: 1 },
        { type: 'log', line: 'older', ts: 2 },
        { type: 'log', line: 'newer', ts: 3 },
        { type: 'decode_event', talkgroup: 2, ts: 4 },
      ])
      // Both buffers come out newest-first, regardless of interleaving.
      expect(store.decodeEvents.map((event) => event.talkgroup)).toEqual([2, 1])
      expect(store.decodeLogs).toEqual(['newer', 'older'])
    })

    it('pushDecodeEventBatch applies the last-in-batch indicator state', () => {
      const store = useSdrStore()
      store.pushDecodeEventBatch([
        { type: 'decode_event', mode: 'DMR', sync: true, ts: 1 },
        { type: 'decode_event', mode: 'P25', sync: false, ts: 2 },
      ])
      expect(store.decodedMode).toBe('P25')
      expect(store.decodeSync).toBe(false)
    })

    it('a trunk_event updates the follow indicators without adding a call row', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({
        type: 'trunk_event',
        tuned_hz: 451_500_000,
        is_control_channel: false,
        ts: 1,
      } as never)
      expect(store.trunkFollowedHz).toBe(451_500_000)
      expect(store.trunkOnControlChannel).toBe(false)
      // It is a state change, not a decoded call — no table row.
      expect(store.decodeEvents).toHaveLength(0)

      // A control-channel return with no tuned_hz keeps the last frequency but
      // flips the on-control flag (covers the non-number tuned_hz branch).
      store.pushDecodeEvent({ type: 'trunk_event', is_control_channel: true, ts: 2 } as never)
      expect(store.trunkFollowedHz).toBe(451_500_000)
      expect(store.trunkOnControlChannel).toBe(true)
    })

    it('pushDecodeEvent stamps ts when missing', () => {
      const store = useSdrStore()
      vi.spyOn(Date, 'now').mockReturnValue(12345)
      store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR' } as never)
      expect(store.decodeEvents[0].ts).toBe(12345)
    })

    it('pushDecodeEvent updates sync/reachability from any frame', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_event', sync: true, decoder_reachable: true, ts: 1 })
      expect(store.decodeSync).toBe(true)
      expect(store.decoderReachable).toBe(true)
    })

    it('pushDecodeEvent tracks the latest decoded mode', () => {
      const store = useSdrStore()
      expect(store.decodedMode).toBe('')
      store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
      expect(store.decodedMode).toBe('DMR')
      store.pushDecodeEvent({ type: 'decode_event', mode: 'P25', ts: 2 })
      expect(store.decodedMode).toBe('P25')
    })

    it('pushDecodeEvent records the backend-measured decoded-audio rate', () => {
      const store = useSdrStore()
      expect(store.decodedAudioRate).toBeNull()
      store.pushDecodeEvent({ type: 'decode_status', audio_sample_rate: 16000, ts: 1 })
      expect(store.decodedAudioRate).toBe(16000)
    })

    it('pushDecodeEvent leaves the decoded-audio rate untouched without the field', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_status', audio_sample_rate: 24000, ts: 1 })
      store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 2 })
      expect(store.decodedAudioRate).toBe(24000)
    })

    it('pushDecodeEvent leaves the decoded mode unchanged for a mode-less frame', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
      store.pushDecodeEvent({ type: 'decode_event', sync: true, ts: 2 })
      expect(store.decodedMode).toBe('DMR')
    })

    it('pushDecodeEvent routes a log frame to the log buffer, not the call rows', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'log', line: 'Sync: +DMR slot1 [slot2]', ts: 1 })
      expect(store.decodeLogs).toEqual(['Sync: +DMR slot1 [slot2]'])
      expect(store.decodeEvents).toHaveLength(0)
    })

    it('pushDecodeEvent keeps log lines newest-first', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'log', line: 'first', ts: 1 })
      store.pushDecodeEvent({ type: 'log', line: 'second', ts: 2 })
      expect(store.decodeLogs).toEqual(['second', 'first'])
    })

    it('pushDecodeEvent strips ANSI colour codes but keeps real bracketed tokens', () => {
      const store = useSdrStore()
      const esc = String.fromCharCode(27)
      store.pushDecodeEvent({
        type: 'log',
        line: `${esc}[33mSync: +DMR [slot2] | Color Code=02${esc}[0m  `,
        ts: 1,
      })
      // Colour codes gone, "[slot2]" preserved, trailing whitespace trimmed.
      expect(store.decodeLogs).toEqual(['Sync: +DMR [slot2] | Color Code=02'])
    })

    it('pushDecodeEvent drops a log line that is only ANSI codes', () => {
      const store = useSdrStore()
      const esc = String.fromCharCode(27)
      store.pushDecodeEvent({ type: 'log', line: `${esc}[0m${esc}[33m`, ts: 1 })
      expect(store.decodeLogs).toEqual([])
    })

    it('pushDecodeEvent ignores a log frame with no line', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'log', ts: 1 })
      expect(store.decodeLogs).toEqual([])
    })

    it('clearDecodeLogs empties the log buffer but keeps call rows', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_event', mode: 'DMR', ts: 1 })
      store.pushDecodeEvent({ type: 'log', line: 'a line', ts: 2 })
      store.clearDecodeLogs()
      expect(store.decodeLogs).toEqual([])
      expect(store.decodeEvents).toHaveLength(1)
    })

    it('pushDecodeEvent does not add a row for a decode_status frame', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_status', decoder_reachable: true, ts: 1 })
      expect(store.decodeEvents).toHaveLength(0)
      expect(store.decoderReachable).toBe(true)
    })

    it('setDecodeStatus updates only the provided fields', () => {
      const store = useSdrStore()
      store.setDecodeStatus({ decoder_reachable: true })
      expect(store.decoderReachable).toBe(true)
      expect(store.decodeSync).toBe(false)
      store.setDecodeStatus({ sync: true })
      expect(store.decodeSync).toBe(true)
    })

    it('clearDecode resets events, sync, reachability, mode and audio rate', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({
        type: 'decode_event',
        mode: 'DMR',
        sync: true,
        decoder_reachable: true,
        audio_sample_rate: 16000,
        ts: 1,
      })
      store.clearDecode()
      expect(store.decodeEvents).toEqual([])
      expect(store.decodeSync).toBe(false)
      expect(store.decoderReachable).toBe(false)
      expect(store.decodedMode).toBe('')
      expect(store.decodedAudioRate).toBeNull()
    })

    it('clearDecodeEvents empties the log but keeps live status', () => {
      const store = useSdrStore()
      store.pushDecodeEvent({ type: 'decode_event', decoder_reachable: true, ts: 1 })
      store.clearDecodeEvents()
      expect(store.decodeEvents).toEqual([])
      expect(store.decoderReachable).toBe(true)
    })
  })

  describe('trunk tracking feature flag', () => {
    it('defaults trunkTrackingEnabled to false', () => {
      expect(useSdrStore().trunkTrackingEnabled).toBe(false)
    })

    it('reads trunkTrackingEnabled=true from localStorage on init', () => {
      localStorage.setItem('sdrTrunkTrackingEnabled', '1')
      expect(useSdrStore().trunkTrackingEnabled).toBe(true)
    })

    it('falls back to false when localStorage throws on read', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useSdrStore().trunkTrackingEnabled).toBe(false)
      spy.mockRestore()
    })

    it('setTrunkTrackingEnabled updates state and persists both positions', () => {
      const store = useSdrStore()
      store.setTrunkTrackingEnabled(true)
      expect(store.trunkTrackingEnabled).toBe(true)
      expect(localStorage.getItem('sdrTrunkTrackingEnabled')).toBe('1')
      store.setTrunkTrackingEnabled(false)
      expect(store.trunkTrackingEnabled).toBe(false)
      expect(localStorage.getItem('sdrTrunkTrackingEnabled')).toBe('0')
    })

    it('setTrunkTrackingEnabled swallows a localStorage write error', () => {
      const store = useSdrStore()
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full')
      })
      expect(() => store.setTrunkTrackingEnabled(true)).not.toThrow()
      expect(store.trunkTrackingEnabled).toBe(true)
      spy.mockRestore()
    })

    it('disabling the feature does not itself clear an active follow (panel owns the stop)', () => {
      const store = useSdrStore()
      store.setTrunkTrackingEnabled(true)
      store.setTrunkEnabled(true)
      store.setTrunkTrackingEnabled(false)
      // The store leaves trunkEnabled alone so the SDR panel's watcher can send
      // the WS stop; clearing it here would skip that command.
      expect(store.trunkEnabled).toBe(true)
    })
  })

  describe('tuning ownership', () => {
    it('defaults to sole owner with no control channel', () => {
      const store = useSdrStore()
      expect(store.isOwner).toBe(true)
      expect(store.controlAvailable).toBe(false)
      expect(store.locked).toBe(false)
      expect(store.readOnly).toBe(false)
    })

    it('setOwnership mirrors the three flags', () => {
      const store = useSdrStore()
      store.setOwnership(false, true, true)
      expect(store.isOwner).toBe(false)
      expect(store.controlAvailable).toBe(true)
      expect(store.locked).toBe(true)
    })

    it('readOnly is true only when control is available, another owns it, and it is locked', () => {
      const store = useSdrStore()
      // Follower: control available, not owner, token held elsewhere.
      store.setOwnership(false, true, true)
      expect(store.readOnly).toBe(true)
      // Owner → never read-only.
      store.setOwnership(true, true, true)
      expect(store.readOnly).toBe(false)
      // Free token (not locked) → not read-only, a tune can claim it.
      store.setOwnership(false, true, false)
      expect(store.readOnly).toBe(false)
      // No control channel (direct rtl_tcp) → never read-only.
      store.setOwnership(false, false, true)
      expect(store.readOnly).toBe(false)
    })
  })

  describe('APRS decode', () => {
    it('defaults aprsEnabled to false and decodeStreamKind to voice', () => {
      const store = useSdrStore()
      expect(store.aprsEnabled).toBe(false)
      expect(store.decodeStreamKind).toBe('voice')
    })

    it('decodeDockOpen is true while either voice or APRS decode is on', () => {
      const store = useSdrStore()
      expect(store.decodeDockOpen).toBe(false)
      store.setDigitalEnabled(true)
      expect(store.decodeDockOpen).toBe(true)
      store.setDigitalEnabled(false)
      store.setAprsEnabled(true)
      expect(store.decodeDockOpen).toBe(true)
    })

    it('reads aprsEnabled=true from localStorage on init', () => {
      localStorage.setItem('sdrAprsEnabled', '1')
      expect(useSdrStore().aprsEnabled).toBe(true)
    })

    it('falls back to false when localStorage throws on read', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useSdrStore().aprsEnabled).toBe(false)
      spy.mockRestore()
    })

    it('setAprsEnabled updates state, flips decodeStreamKind, and persists', () => {
      const store = useSdrStore()
      store.setAprsEnabled(true)
      expect(store.aprsEnabled).toBe(true)
      expect(store.decodeStreamKind).toBe('aprs')
      expect(localStorage.getItem('sdrAprsEnabled')).toBe('1')
      store.setAprsEnabled(false)
      expect(localStorage.getItem('sdrAprsEnabled')).toBe('0')
      expect(store.decodeStreamKind).toBe('voice')
    })

    it('setAprsEnabled swallows a localStorage write error', () => {
      const store = useSdrStore()
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full')
      })
      expect(() => store.setAprsEnabled(true)).not.toThrow()
      expect(store.aprsEnabled).toBe(true)
      spy.mockRestore()
    })

    it('startAprs POSTs the radio + channel and returns ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)
      const store = useSdrStore()
      const result = await store.startAprs(7, 100, 15000)
      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sdr/aprs/start',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ radio_id: 7, offset_hz: 100, bw_hz: 15000 }),
        }),
      )
    })

    it('startAprs defaults offset/bandwidth to zero', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)
      await useSdrStore().startAprs(3)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sdr/aprs/start',
        expect.objectContaining({
          body: JSON.stringify({ radio_id: 3, offset_hz: 0, bw_hz: 0 }),
        }),
      )
    })

    it('startAprs returns false on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      expect(await useSdrStore().startAprs(1)).toBe(false)
    })

    it('startAprs returns false when the request throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(await useSdrStore().startAprs(1)).toBe(false)
    })

    it('stopAprs POSTs the radio and returns ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
      vi.stubGlobal('fetch', fetchMock)
      expect(await useSdrStore().stopAprs(9)).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sdr/aprs/stop',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ radio_id: 9 }) }),
      )
    })

    it('stopAprs returns false on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      expect(await useSdrStore().stopAprs(1)).toBe(false)
    })

    it('stopAprs returns false when the request throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      expect(await useSdrStore().stopAprs(1)).toBe(false)
    })
  })

  // Which radio decodes APRS decides which radio's audio is muted, so the id has
  // to be exact — a stale or missing one silences the wrong dongle.
  describe('APRS decoding radio', () => {
    it('defaults aprsRadioId to null', () => {
      expect(useSdrStore().aprsRadioId).toBe(null)
    })

    it('reads aprsRadioId from localStorage on init', () => {
      localStorage.setItem('sdrAprsRadioId', '4')
      expect(useSdrStore().aprsRadioId).toBe(4)
    })

    it('ignores a non-numeric cached aprsRadioId', () => {
      localStorage.setItem('sdrAprsRadioId', 'not-a-number')
      expect(useSdrStore().aprsRadioId).toBe(null)
    })

    it('falls back to null when localStorage throws on read', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useSdrStore().aprsRadioId).toBe(null)
      spy.mockRestore()
    })

    it('setAprsRadioId persists the id and removes it when cleared', () => {
      const store = useSdrStore()
      store.setAprsRadioId(6)
      expect(store.aprsRadioId).toBe(6)
      expect(localStorage.getItem('sdrAprsRadioId')).toBe('6')
      store.setAprsRadioId(null)
      expect(store.aprsRadioId).toBe(null)
      expect(localStorage.getItem('sdrAprsRadioId')).toBe(null)
    })

    it('setAprsRadioId swallows a localStorage write error', () => {
      const store = useSdrStore()
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full')
      })
      expect(() => store.setAprsRadioId(2)).not.toThrow()
      expect(store.aprsRadioId).toBe(2)
      spy.mockRestore()
    })

    it('startAprs records the decoding radio once the backend accepts it', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
      const store = useSdrStore()
      await store.startAprs(7)
      expect(store.aprsRadioId).toBe(7)
    })

    it('startAprs leaves the decoding radio unset when the backend refuses', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      const store = useSdrStore()
      await store.startAprs(7)
      expect(store.aprsRadioId).toBe(null)
    })

    it('stopAprs clears the decoding radio', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
      const store = useSdrStore()
      store.setAprsRadioId(7)
      await store.stopAprs(7)
      expect(store.aprsRadioId).toBe(null)
    })

    it('stopAprs clears the decoding radio even when the request fails', async () => {
      // The user asked decode to stop — audio must not stay muted regardless.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const store = useSdrStore()
      store.setAprsRadioId(7)
      await store.stopAprs(7)
      expect(store.aprsRadioId).toBe(null)
    })

    it('hydrateAprsFromDb adopts the radio the backend resumed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aprs_radio_id: 5 }) }),
      )
      const store = useSdrStore()
      await store.hydrateAprsFromDb()
      expect(store.aprsRadioId).toBe(5)
      expect(store.aprsEnabled).toBe(true)
    })

    it('hydrateAprsFromDb clears stale local state when nothing is decoding', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aprs_radio_id: null }) }),
      )
      const store = useSdrStore()
      store.setAprsRadioId(5)
      store.setAprsEnabled(true)
      await store.hydrateAprsFromDb()
      expect(store.aprsRadioId).toBe(null)
      expect(store.aprsEnabled).toBe(false)
    })

    it('hydrateAprsFromDb leaves state alone when it already agrees', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ aprs_radio_id: 5 }) }),
      )
      const store = useSdrStore()
      store.setAprsRadioId(5)
      store.setAprsEnabled(true)
      await store.hydrateAprsFromDb()
      expect(store.aprsRadioId).toBe(5)
      expect(store.aprsEnabled).toBe(true)
    })

    it('hydrateAprsFromDb ignores a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      const store = useSdrStore()
      store.setAprsRadioId(5)
      await store.hydrateAprsFromDb()
      expect(store.aprsRadioId).toBe(5)
    })

    it('hydrateAprsFromDb swallows fetch errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const store = useSdrStore()
      store.setAprsRadioId(5)
      await expect(store.hydrateAprsFromDb()).resolves.toBeUndefined()
      expect(store.aprsRadioId).toBe(5)
    })
  })

  describe('mute audio while decoding', () => {
    it('defaults to on so existing installs keep muting', () => {
      expect(useSdrStore().muteAudioWhileDecoding).toBe(true)
    })

    it('reads an explicit off from localStorage on init', () => {
      localStorage.setItem('sdrMuteAudioWhileDecoding', '0')
      expect(useSdrStore().muteAudioWhileDecoding).toBe(false)
    })

    it('falls back to on when localStorage throws on read', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      expect(useSdrStore().muteAudioWhileDecoding).toBe(true)
      spy.mockRestore()
    })

    it('setMuteAudioWhileDecoding updates state and persists', () => {
      const store = useSdrStore()
      store.setMuteAudioWhileDecoding(false)
      expect(store.muteAudioWhileDecoding).toBe(false)
      expect(localStorage.getItem('sdrMuteAudioWhileDecoding')).toBe('0')
      store.setMuteAudioWhileDecoding(true)
      expect(localStorage.getItem('sdrMuteAudioWhileDecoding')).toBe('1')
    })

    it('setMuteAudioWhileDecoding swallows a localStorage write error', () => {
      const store = useSdrStore()
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full')
      })
      expect(() => store.setMuteAudioWhileDecoding(false)).not.toThrow()
      expect(store.muteAudioWhileDecoding).toBe(false)
      spy.mockRestore()
    })

    it('hydrateMuteAudioWhileDecodingFromDb applies the stored value', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ ok: true, json: async () => ({ muteAudioWhileDecoding: false }) }),
      )
      const store = useSdrStore()
      await store.hydrateMuteAudioWhileDecodingFromDb()
      expect(store.muteAudioWhileDecoding).toBe(false)
    })

    it('hydrateMuteAudioWhileDecodingFromDb ignores a non-boolean value', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({ ok: true, json: async () => ({ muteAudioWhileDecoding: 'no' }) }),
      )
      const store = useSdrStore()
      await store.hydrateMuteAudioWhileDecodingFromDb()
      expect(store.muteAudioWhileDecoding).toBe(true)
    })

    it('hydrateMuteAudioWhileDecodingFromDb ignores a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
      const store = useSdrStore()
      store.setMuteAudioWhileDecoding(false)
      await store.hydrateMuteAudioWhileDecodingFromDb()
      expect(store.muteAudioWhileDecoding).toBe(false)
    })

    it('hydrateMuteAudioWhileDecodingFromDb swallows fetch errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const store = useSdrStore()
      await expect(store.hydrateMuteAudioWhileDecodingFromDb()).resolves.toBeUndefined()
      expect(store.muteAudioWhileDecoding).toBe(true)
    })
  })
})
