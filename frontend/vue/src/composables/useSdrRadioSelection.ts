import { ref, type Ref } from 'vue'
import type { useSdrStore, SdrRadio } from '@/stores/sdr'

/**
 * Radio selection + auto-select (extracted from SdrPanel.vue's engine spine —
 * behaviour byte-identical): the device-dropdown display state, manual
 * select/deselect (with the shared-tuner release and socket/audio
 * choreography), the radio-list load with its sessionStorage cache, and the
 * remembered/sole-enabled auto-select that makes the panel usable without a
 * manual dropdown pick.
 */
export interface UseSdrRadioSelectionOptions {
  /** Lazy accessor for the SDR store (the panel's shared instance). */
  sdrStore: () => ReturnType<typeof useSdrStore>
  /** The selected radio id (panel-owned; every subsystem reads it). */
  selectedRadioId: Ref<number | null>
  /** True while no usable radio is selected (disables the tuner controls). */
  controlsDisabled: Ref<boolean>
  /** True while audio/spectrum is streaming. */
  playing: Ref<boolean>
  /** Flips the playing flag (+ its sessionStorage marker). */
  setPlayingState: (on: boolean) => void
  /** Marks the device connected/disconnected (drives the connection dot). */
  setStatus: (isConnected: boolean) => void
  /** Stops the demod audio path (useSdrAudio.stop). */
  stopAudio: () => void
  /** Turns digital decode off (it cannot survive a radio switch). */
  setDigital: (on: boolean) => void
  /** Releases the shared tuner if this instance holds it. */
  releaseOwnershipIfHeld: () => void
  /** Opens the control socket for a radio (useSdrControlSocket). */
  openControlSocket: (radioId: number) => Promise<void>
  /** Closes the control socket (useSdrControlSocket). */
  closeControlSocket: () => void
}

/**
 * Wires radio selection onto the injected socket/audio/state chokepoints.
 * Everything returned keeps the exact semantics the panel had inline.
 */
export function useSdrRadioSelection(options: UseSdrRadioSelectionOptions) {
  const {
    sdrStore: _sdrStore,
    selectedRadioId,
    controlsDisabled,
    playing,
    setPlayingState,
    setStatus,
    stopAudio,
    setDigital,
    releaseOwnershipIfHeld,
    openControlSocket,
    closeControlSocket,
  } = options

  // The combobox UI (listbox menu, keyboard nav, padlock rows) lives in
  // SdrDeviceSelector.vue; it emits `select` into selectRadio() below. The panel
  // keeps the engine-written display state it passes down as props.
  const radiosLoading = ref(true)
  const deviceDropdownLabel = ref('loading…')

  function clearRadioSelection() {
    // Release the shared tuner before dropping the socket, so deselecting a radio
    // frees it for another instance immediately (rather than waiting for the backend
    // idle-release grace period).
    releaseOwnershipIfHeld()
    selectedRadioId.value = null
    deviceDropdownLabel.value = '— select radio —'
    setPlayingState(false)
    // Clear the connection dot: closeControlSocket() drops the socket but never marks
    // us disconnected, so without this the dot stays green after deselecting.
    setStatus(false)
    controlsDisabled.value = true
    // Reset tuning ownership to the single-instance default, otherwise readOnly stays
    // true and the deselected radio keeps its read-only styling (red label + padlock).
    _sdrStore().setOwnership(true, false, false)
    closeControlSocket()
    stopAudio()
  }

  function selectRadio(r: SdrRadio | null) {
    // Belt and braces with the dropdown's own guard: a reserved radio is locked
    // out of the panel until it is deselected in Settings.
    if (r && _sdrStore().radioReservation(r.id) !== null) return
    if (_sdrStore().digitalEnabled) setDigital(false)
    if (!r) {
      clearRadioSelection()
      return
    }
    if (playing.value) {
      stopAudio()
      setPlayingState(false)
      setStatus(false)
    }
    selectedRadioId.value = r.id
    deviceDropdownLabel.value = r.name
    sessionStorage.setItem('sdrLastRadioId', String(r.id))
    controlsDisabled.value = false
    void openControlSocket(r.id)
  }

  // ── Populate radios (called externally via event / boot) ────────────────────

  const RADIOS_CACHE_KEY2 = 'sdrRadiosCache'

  function populateRadios(radios: SdrRadio[]) {
    // Writes straight into the store — it owns `radios` (see loadRadios below and
    // stores/sdr.ts) — so `knownRadios` (a computed reading the store) reflects it
    // immediately, without a separate local copy to keep in sync.
    _sdrStore().radios = radios
    radiosLoading.value = false
    try {
      sessionStorage.setItem(RADIOS_CACHE_KEY2, JSON.stringify(radios))
    } catch (_) {}
    const savedId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '', 10)
    // A radio reserved as a domain receiver (AIR's ADS-B source, LAND's APRS
    // decoder) is not available here, so it can neither be remembered into the
    // panel nor auto-selected as "the only one" — doing either would retune a
    // dongle another domain depends on.
    const isSelectable = (radio: SdrRadio) =>
      radio.enabled && _sdrStore().radioReservation(radio.id) === null
    const savedRadio = savedId ? radios.find((r) => r.id === savedId && isSelectable(r)) : undefined
    // Pick a radio to make the panel usable without a manual dropdown selection:
    //   1. the remembered radio (if still present + enabled), else
    //   2. the sole enabled radio — when there's exactly one, there's nothing to
    //      disambiguate, so auto-select it (fixes "freshly added SDR leaves the
    //      whole radio panel locked / no way to type a frequency").
    // With two or more enabled radios and nothing remembered we can't guess which
    // one the user wants, so fall back to the "select radio" placeholder.
    const enabledRadios = radios.filter(isSelectable)
    const autoRadio = savedRadio ?? (enabledRadios.length === 1 ? enabledRadios[0] : undefined)
    if (autoRadio) {
      selectedRadioId.value = autoRadio.id
      deviceDropdownLabel.value = autoRadio.name
      sessionStorage.setItem('sdrLastRadioId', String(autoRadio.id))
      controlsDisabled.value = false
      void openControlSocket(autoRadio.id)
    } else {
      deviceDropdownLabel.value = '— select radio —'
    }
    const radioTabBtn = document.querySelector<HTMLElement>('.msb-tab[data-tab="radio"]')
    if (radioTabBtn) radioTabBtn.classList.remove('msb-tab--pending')
  }

  async function loadRadios() {
    try {
      const cached = sessionStorage.getItem(RADIOS_CACHE_KEY2)
      if (cached) populateRadios(JSON.parse(cached))
    } catch (_) {}
    // Fetching itself is now owned by the store (loadRadios) so SdrPanel isn't
    // the only place that knows how to load the radio list; this panel just
    // drives the load and runs its own selection/UI side effects afterward.
    // loadRadios() only replaces `radios` on a successful (2xx) response and
    // silently keeps the previous value otherwise, so re-running selection here
    // unconditionally is safe: on failure it just re-applies the same (cached or
    // empty) list, and openControlSocket() no-ops if already connect(ing) to the
    // same radio.
    await _sdrStore().loadRadios()
    populateRadios(_sdrStore().radios)
  }

  return {
    radiosLoading,
    deviceDropdownLabel,
    clearRadioSelection,
    selectRadio,
    populateRadios,
    loadRadios,
  }
}
