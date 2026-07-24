import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick, effectScope, type EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSdrDigitalDecode, type UseSdrDigitalDecodeOptions } from './useSdrDigitalDecode'
import { useSdrStore } from '@/stores/sdr'

let activeScope: EffectScope | null = null

function createHarness(overrides: Partial<UseSdrDigitalDecodeOptions> = {}) {
  const sendCmd = vi.fn()
  const startDecode = vi.fn()
  const stopDecode = vi.fn()
  const setLiveMuted = vi.fn()
  const options: UseSdrDigitalDecodeOptions = {
    sdrStore: () => useSdrStore(),
    sendCmd,
    selectedRadioId: ref<number | null>(3),
    bwHz: ref(12500),
    currentMode: ref('NFM'),
    startDecode,
    stopDecode,
    setLiveMuted,
    ...overrides,
  }
  activeScope = effectScope()
  const decode = activeScope.run(() => useSdrDigitalDecode(options))!
  return { options, decode, sendCmd, startDecode, stopDecode, setLiveMuted }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  activeScope?.stop()
  activeScope = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useSdrDigitalDecode — digital decode', () => {
  it('enabling digital starts the backend bridge, the decode sockets and mutes analog audio', () => {
    const { decode, sendCmd, startDecode, setLiveMuted } = createHarness()
    const store = useSdrStore()
    const clearDecodeSpy = vi.spyOn(store, 'clearDecode')
    decode.setDigital(true)
    expect(store.digitalEnabled).toBe(true)
    expect(clearDecodeSpy).toHaveBeenCalledTimes(1)
    expect(sendCmd).toHaveBeenCalledWith({
      cmd: 'digital_decode',
      enabled: true,
      offset_hz: store.tuningOffsetHz,
      bw_hz: 12500,
      mode: 'NFM',
    })
    expect(startDecode).toHaveBeenCalledWith(3)
    // Muted under the 'digital' reason and scoped to the decoding radio only.
    expect(setLiveMuted).toHaveBeenCalledWith(true, 'digital', 3)
  })

  it('enabling digital without a selected radio skips opening the decode sockets', () => {
    const { decode, startDecode } = createHarness({ selectedRadioId: ref<number | null>(null) })
    decode.setDigital(true)
    expect(startDecode).not.toHaveBeenCalled()
  })

  it('disabling digital stops the bridge, the sockets and unmutes analog audio', () => {
    const { decode, sendCmd, stopDecode, setLiveMuted } = createHarness()
    const store = useSdrStore()
    decode.setDigital(true)
    sendCmd.mockClear()
    decode.setDigital(false)
    expect(store.digitalEnabled).toBe(false)
    expect(sendCmd).toHaveBeenCalledWith({ cmd: 'digital_decode', enabled: false })
    expect(stopDecode).toHaveBeenCalledTimes(1)
    expect(setLiveMuted).toHaveBeenCalledWith(false, 'digital', 3)
  })

  it('toggleDigital flips the store state', () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    decode.toggleDigital()
    expect(store.digitalEnabled).toBe(true)
    decode.toggleDigital()
    expect(store.digitalEnabled).toBe(false)
  })

  it('leaves audio alone when "mute audio while decoding" is off', () => {
    const { decode, setLiveMuted } = createHarness()
    useSdrStore().setMuteAudioWhileDecoding(false)
    setLiveMuted.mockClear()
    decode.setDigital(true)
    expect(setLiveMuted).toHaveBeenCalledWith(false, 'digital', 3)
    expect(setLiveMuted).not.toHaveBeenCalledWith(true, 'digital', 3)
  })

  it('applies the mute setting live while decode is already running', async () => {
    const { decode, setLiveMuted } = createHarness()
    const store = useSdrStore()
    decode.setDigital(true)
    setLiveMuted.mockClear()

    store.setMuteAudioWhileDecoding(false)
    await nextTick()
    expect(setLiveMuted).toHaveBeenLastCalledWith(false, 'digital', 3)

    store.setMuteAudioWhileDecoding(true)
    await nextTick()
    expect(setLiveMuted).toHaveBeenLastCalledWith(true, 'digital', 3)
  })

  it('re-targets the mute at the radio in use when the selection changes', async () => {
    const selectedRadioId = ref<number | null>(3)
    const { decode, setLiveMuted } = createHarness({ selectedRadioId })
    decode.setDigital(true)
    setLiveMuted.mockClear()

    selectedRadioId.value = 7
    await nextTick()
    expect(setLiveMuted).toHaveBeenLastCalledWith(true, 'digital', 7)
  })

  it('falls back to the global target when no radio is selected', () => {
    const { decode, setLiveMuted } = createHarness({ selectedRadioId: ref<number | null>(null) })
    decode.setDigital(true)
    // Nothing to scope the mute to, and nothing decoding either — unmute globally.
    expect(setLiveMuted).toHaveBeenCalledWith(false, 'digital', 'all')
  })
})

describe('useSdrDigitalDecode — trunk tracking', () => {
  function enableDigitalWithMap(decode: ReturnType<typeof createHarness>['decode']) {
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    decode.setDigital(true)
  }

  it('canEnableTrunk requires digital decode running AND a chosen channel map', () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    expect(decode.canEnableTrunk.value).toBe(false) // neither
    store.setTrunkChannelMap('site-a.csv')
    expect(decode.canEnableTrunk.value).toBe(false) // map only
    decode.setDigital(true)
    expect(decode.canEnableTrunk.value).toBe(true) // both
  })

  it('setTrunk(true) is refused while trunking cannot be enabled', () => {
    const { decode, sendCmd } = createHarness()
    const store = useSdrStore()
    sendCmd.mockClear()
    decode.setTrunk(true)
    expect(store.trunkEnabled).toBe(false)
    expect(sendCmd).not.toHaveBeenCalled()
  })

  it('setTrunk(true) starts trunk mode with the chosen channel map', () => {
    const { decode, sendCmd } = createHarness()
    const store = useSdrStore()
    store.setTrunkError('previous failure')
    enableDigitalWithMap(decode)
    sendCmd.mockClear()
    decode.setTrunk(true)
    expect(store.trunkEnabled).toBe(true)
    expect(store.trunkError).toBe('') // cleared on every attempt
    expect(sendCmd).toHaveBeenCalledWith({
      cmd: 'trunk_decode',
      enabled: true,
      channel_map: 'site-a.csv',
      offset_hz: store.tuningOffsetHz,
      bw_hz: 12500,
    })
  })

  it('setTrunk(false) stops trunk mode on the backend', () => {
    const { decode, sendCmd } = createHarness()
    const store = useSdrStore()
    enableDigitalWithMap(decode)
    decode.setTrunk(true)
    sendCmd.mockClear()
    decode.setTrunk(false)
    expect(store.trunkEnabled).toBe(false)
    expect(sendCmd).toHaveBeenCalledWith({ cmd: 'trunk_decode', enabled: false })
  })

  it('toggleTrunk flips trunk state', () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    enableDigitalWithMap(decode)
    decode.toggleTrunk()
    expect(store.trunkEnabled).toBe(true)
    decode.toggleTrunk()
    expect(store.trunkEnabled).toBe(false)
  })

  it('the trunkChannelMap v-model writes through to the store', () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    decode.trunkChannelMap.value = 'site-b.csv'
    expect(store.trunkChannelMap).toBe('site-b.csv')
  })
})

describe('useSdrDigitalDecode — reconciliation watchers', () => {
  it('turning digital decode off drops an active trunk follow', async () => {
    const { decode, sendCmd } = createHarness()
    const store = useSdrStore()
    store.setTrunkChannelMap('site-a.csv')
    decode.setDigital(true)
    await nextTick()
    decode.setTrunk(true)
    sendCmd.mockClear()
    decode.setDigital(false)
    await nextTick()
    expect(store.trunkEnabled).toBe(false)
    expect(sendCmd).toHaveBeenCalledWith({ cmd: 'trunk_decode', enabled: false })
  })

  it('turning digital decode off without a follow sends no trunk command', async () => {
    const { decode, sendCmd } = createHarness()
    decode.setDigital(true)
    await nextTick()
    sendCmd.mockClear()
    decode.setDigital(false)
    await nextTick()
    expect(sendCmd.mock.calls.some(([payload]) => payload.cmd === 'trunk_decode')).toBe(false)
  })

  it('disabling the trunk-tracking feature drops an active follow', async () => {
    const { decode, sendCmd } = createHarness()
    const store = useSdrStore()
    store.setTrunkTrackingEnabled(true)
    await nextTick()
    store.setTrunkChannelMap('site-a.csv')
    decode.setDigital(true)
    decode.setTrunk(true)
    sendCmd.mockClear()
    store.setTrunkTrackingEnabled(false)
    await nextTick()
    expect(store.trunkEnabled).toBe(false)
    expect(sendCmd).toHaveBeenCalledWith({ cmd: 'trunk_decode', enabled: false })
  })

  it('pushes the new demod channel to the backend when bandwidth changes while decoding', async () => {
    const { options, decode, sendCmd } = createHarness()
    const store = useSdrStore()
    decode.setDigital(true)
    sendCmd.mockClear()
    options.bwHz.value = 25000
    await nextTick()
    expect(sendCmd).toHaveBeenCalledWith({
      cmd: 'digital_channel',
      offset_hz: store.tuningOffsetHz,
      bw_hz: 25000,
      mode: 'NFM',
    })
  })

  it('does not push channel changes while digital decode is off', async () => {
    const { options, sendCmd } = createHarness()
    options.bwHz.value = 25000
    await nextTick()
    expect(sendCmd).not.toHaveBeenCalled()
  })
})

describe('useSdrDigitalDecode — loadChannelMaps', () => {
  it('stores the channel-map filenames the backend offers', async () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ channel_maps: ['site-a.csv', 'site-b.csv'] }),
      }),
    )
    await decode.loadChannelMaps()
    expect(store.trunkChannelMaps).toEqual(['site-a.csv', 'site-b.csv'])
  })

  it('leaves the picker empty on a non-OK response', async () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await decode.loadChannelMaps()
    expect(store.trunkChannelMaps).toEqual([])
  })

  it('ignores a malformed payload (channel_maps not an array)', async () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ channel_maps: 'nope' }) }),
    )
    await decode.loadChannelMaps()
    expect(store.trunkChannelMaps).toEqual([])
  })

  it('leaves the picker empty when the fetch fails (offline)', async () => {
    const { decode } = createHarness()
    const store = useSdrStore()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await decode.loadChannelMaps()
    expect(store.trunkChannelMaps).toEqual([])
  })
})
