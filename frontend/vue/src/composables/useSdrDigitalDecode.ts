import { computed, watch, type Ref } from 'vue'
import type { useSdrStore } from '@/stores/sdr'
import type { LiveMuteReason, LiveMuteTarget } from '@/composables/useSdrAudio'

/**
 * Digital decode (dsd-fme sidecar) engine, extracted from SdrPanel.vue's
 * engine spine. Owns the DIGITAL toggle's engine side: the backend decode
 * commands, the decode-socket + analog-mute choreography, and the watchers
 * that keep decode and channel state consistent.
 */
export interface UseSdrDigitalDecodeOptions {
  /** Lazy accessor for the SDR store (the panel's shared instance). */
  sdrStore: () => ReturnType<typeof useSdrStore>
  /** Sends a control-socket command (the panel's single command chokepoint). */
  sendCmd: (commandPayload: object) => void
  /** The selected radio id, if any (the decode socket needs it to start). */
  selectedRadioId: Ref<number | null>
  /** Demod audio bandwidth in Hz (forwarded to the server-side demod). */
  bwHz: Ref<number>
  /** Active demodulator mode (forwarded to the server-side demod). */
  currentMode: Ref<string>
  /** useSdrDecode's start — opens the decode + decoded-audio sockets. */
  startDecode: (radioId: number) => void
  /** useSdrDecode's stop — closes the decode sockets. */
  stopDecode: () => void
  /** Mutes/unmutes the analog audio path (digital channels are noise to the ear). */
  setLiveMuted: (muted: boolean, reason?: LiveMuteReason, target?: LiveMuteTarget) => void
}

/**
 * Wires the digital decode engine onto the injected command chokepoint and
 * tuner refs. Everything returned keeps the exact semantics the panel had
 * inline.
 */
export function useSdrDigitalDecode(options: UseSdrDigitalDecodeOptions) {
  const {
    sdrStore: _sdrStore,
    sendCmd,
    selectedRadioId,
    bwHz,
    currentMode,
    startDecode,
    stopDecode,
    setLiveMuted,
  } = options

  // Mirrors the store toggle so the DIGITAL button reflects (and survives) it.
  const digitalEnabled = computed(() => _sdrStore().digitalEnabled)

  /**
   * Mute the analog audio of the radio that is decoding — and only that radio,
   * so a second dongle tuned to a voice channel stays audible. Honours the
   * "Mute Audio While Decoding" setting, and re-runs whenever the setting, the
   * toggle or the decoding radio changes so a change applies mid-decode.
   */
  function applyDigitalMute() {
    const shouldMute =
      digitalEnabled.value && _sdrStore().muteAudioWhileDecoding && selectedRadioId.value != null
    setLiveMuted(shouldMute, 'digital', selectedRadioId.value ?? 'all')
  }
  watch(
    [digitalEnabled, () => _sdrStore().muteAudioWhileDecoding, selectedRadioId],
    applyDigitalMute,
  )

  // Turn digital decoding on/off while the radio is running. Enabling tells the
  // backend to start the decode bridge (via the control socket), opens the decode
  // + decoded-audio sockets, and mutes this radio's analog audio (the digital
  // channel is just noise to the ear) unless the user has turned that setting
  // off. Disabling reverses all of it.
  function setDigital(on: boolean) {
    _sdrStore().setDigitalEnabled(on)
    if (on) {
      _sdrStore().clearDecode()
      sendCmd({
        cmd: 'digital_decode',
        enabled: true,
        offset_hz: _sdrStore().tuningOffsetHz,
        bw_hz: bwHz.value,
        mode: currentMode.value,
      })
      if (selectedRadioId.value != null) startDecode(selectedRadioId.value)
      applyDigitalMute()
    } else {
      sendCmd({ cmd: 'digital_decode', enabled: false })
      stopDecode()
      applyDigitalMute()
      _sdrStore().clearDecode()
    }
  }

  function toggleDigital() {
    setDigital(!_sdrStore().digitalEnabled)
  }

  // When the user retunes the demod offset or changes bandwidth while decoding,
  // push the new channel to the backend so the server-side demod follows it
  // without restarting the session.
  watch([() => _sdrStore().tuningOffsetHz, bwHz, currentMode], () => {
    if (!_sdrStore().digitalEnabled) return
    sendCmd({
      cmd: 'digital_channel',
      offset_hz: _sdrStore().tuningOffsetHz,
      bw_hz: bwHz.value,
      mode: currentMode.value,
    })
  })

  return {
    digitalEnabled,
    setDigital,
    toggleDigital,
  }
}
