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

describe('useSdrDigitalDecode — reconciliation watchers', () => {
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
