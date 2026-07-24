import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

export interface SdrRadio {
  id: number
  name: string
  host: string
  port: number
  enabled: boolean
  description?: string
}

export interface SdrFrequencyGroup {
  id: number
  name: string
  slug: string
  color: string
  sort_order: number
}

export interface SdrStoredFrequency {
  id: number
  // Legacy single-group id (kept for callers that only need one group);
  // `group_ids` is the current many-to-many representation returned by the
  // backend and is what the Frequency Manager's group filtering/editing uses.
  group_id: number | null
  group_ids?: number[]
  label: string
  frequency_hz: number
  mode: string
  // Per-frequency tuning settings, applied when the frequency is clicked or a
  // scan stops on it. bandwidth/sample_rate may be null (fall back to the live
  // / per-mode default); the rest carry concrete values.
  squelch?: number
  gain?: number
  bandwidth?: number | null
  sample_rate?: number | null
  volume?: number
  zoom?: number
  zmin?: number
  zmax?: number
  scannable?: boolean
  notes?: string
}

export type SdrMode = 'NFM' | 'WFM' | 'AM' | 'USB' | 'LSB' | 'CW'

export type SdrTab = 'radio' | 'search-ranges' | 'groups' | 'recordings'

export interface SdrSpectrumFrame {
  bins: number[]
  center_hz: number
  sample_rate: number
  ts: number
}

// A decoded digital event relayed from the dsd-fme sidecar via the backend.
// All call fields are optional — a single dsd-fme log line may carry any subset.
export interface DecodeEvent {
  type: string
  mode?: string
  talkgroup?: number
  source?: number
  color_code?: number
  sync?: boolean
  decoder_reachable?: boolean
  vocoder?: string
  // Measured playback rate (Hz) for decoded voice, reported by the backend on
  // `decode_status` frames (see DigitalDecodeBridge._measure_audio_rate). The
  // decode-audio player schedules PCM at this rate. Present once measured.
  audio_sample_rate?: number
  // Present only on `type: "log"` frames — one raw dsd-fme output line.
  line?: string
  // Present only on `type: "trunk_event"` frames (trunk tracking): the absolute
  // frequency the decoder just retuned to, and whether that is the control
  // channel (a return) rather than a call's voice channel.
  tuned_hz?: number
  is_control_channel?: boolean
  // Present only on `type: "aprs"` frames (APRS packet decode). The source
  // callsign, decoded position, and optional movement/status fields; the same
  // shape the Land map plots. `raw` is the TNC2 packet the fix was parsed from.
  from?: string
  latitude?: number
  longitude?: number
  symbol?: string
  comment?: string
  course?: number
  speed?: number
  altitude?: number
  path?: string
  raw?: string
  ts: number
}

// Cap the in-memory decoded-event log so a long session can't grow unbounded.
const DECODE_EVENTS_MAX = 200

// Cap the raw dsd-fme log buffer. Lines arrive far faster than call rows (the
// control channel emits many status lines per second), so this is kept tighter
// to bound memory and the rendered list.
const DECODE_LOGS_MAX = 300

// dsd-fme colourises its output with ANSI CSI escape sequences. Strip them so the
// log view shows clean text instead of "[33m"/"[0m" litter. Anchored on the ESC
// control char so real bracketed tokens (e.g. "[slot2]") are never touched.
// eslint-disable-next-line no-control-regex -- matching the ESC control char is the intent
const ANSI_ESCAPE_PATTERN = /\[[0-9;]*[A-Za-z]/g
function stripAnsi(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '').trimEnd()
}

export const useSdrStore = defineStore('sdr', () => {
  const radios = ref<SdrRadio[]>([])
  const groups = ref<SdrFrequencyGroup[]>([])
  const frequencies = ref<SdrStoredFrequency[]>([])
  const currentRadioId = ref<number | null>(null)
  const playing = ref(false)
  const connected = ref(false)
  // Tuning ownership when sharing one dongle across Sentinel instances via the
  // relay control channel. `controlAvailable` is false for a direct rtl_tcp / a
  // relay without the control channel, where tuning is always allowed; in that
  // case `isOwner` stays true so the UI behaves exactly as a single instance.
  // A read-only follower is `controlAvailable && !isOwner && locked` — `locked`
  // (the token is held by *some* instance) distinguishes "another instance is
  // tuning" (read-only) from "the token is free" (a tune attempt can claim it),
  // so a follower is never stuck read-only after the owner leaves.
  const isOwner = ref(true)
  const controlAvailable = ref(false)
  const locked = ref(false)
  const currentFreqHz = ref(100_000_000)
  const currentMode = ref<SdrMode>('WFM')
  const currentGain = ref(30)
  const currentSquelch = ref(-60)
  const panelOpen = ref(false)
  const sampleRate = ref(2_048_000)

  // Which tab the SDR side panel is showing (RADIO / FREQUENCY MANAGER / …).
  // Mirrored here from SdrPanel so siblings — notably the footer's tuned-
  // frequency indicator — can tell the RADIO tab (where the panel already shows
  // the frequency) apart from the other tabs (where the footer should show it).
  const activeTab = ref<SdrTab>('radio')
  function setActiveTab(tab: SdrTab) {
    activeTab.value = tab
  }

  // Demod (audio filter) bandwidth mirror. The authoritative copy is the local
  // `bwHz` ref in SdrPanel.vue; the panel pushes it here so the spectrum/
  // waterfall marker (a sibling component) can read it. NOT the device
  // sample_rate / FFT span.
  const bwHz = ref(10000)

  // Marker → panel request channel. SdrWaterfall and SdrPanel are siblings;
  // only the panel owns the control websocket. When the user drags the marker,
  // the waterfall calls requestTune/requestBandwidth and the panel (which
  // watches these) runs its existing debounced sendCmd path. The nonce makes an
  // identical repeat value (e.g. nudge back to the same freq) still fire the
  // watcher — a plain ref would not re-trigger on an unchanged value.
  // `center: true` forces the panel to retune the HARDWARE centre even when
  // autoCenterWaterfallOnTune is OFF — used by the freq-axis drag-pan, which
  // means "move the hardware centre" regardless of the click-to-tune preference.
  const tuneRequest = shallowRef<{ hz: number; nonce: number; center?: boolean } | null>(null)
  const bwRequest = shallowRef<{ hz: number; nonce: number } | null>(null)
  // Waterfall → panel: request a backend FFT bin count (matches the canvas's
  // device-pixel width so the waterfall isn't blurry on HiDPI / wide displays).
  const fftSizeRequest = shallowRef<{ bins: number; nonce: number } | null>(null)
  let _tuneNonce = 0
  let _bwNonce = 0
  let _fftNonce = 0

  // Auto-centre toggle (user preference; lives in the `sdr` settings namespace,
  // edited from Settings → SDR → WATERFALL). localStorage is a fast-path cache
  // so the very first click after load behaves correctly before the async
  // settings fetch resolves; SdrAutoCenterControl reconciles it with the DB.
  //  ON  → clicking the spectrum/waterfall retunes the hardware so the clicked
  //        freq becomes the new span centre (display recenters).
  //  OFF → clicking moves the demod target (tuning bar) to the clicked freq
  //        WITHOUT retuning the hardware; the display stays put and the audio
  //        follows via an NCO offset (see useSdrAudio.setOffsetHz).
  function _readAutoCenterWaterfallOnTune(): boolean {
    try {
      return localStorage.getItem('sdrAutoCenterWaterfallOnTune') !== '0'
    } catch {
      return true
    }
  }
  const autoCenterWaterfallOnTune = ref<boolean>(_readAutoCenterWaterfallOnTune())
  // Set the toggle. When turning it ON while the demod sits off-centre, retune
  // the hardware to the current demod freq so the display recenters on it and
  // the NCO offset clears (otherwise the bar would stay off-centre with a stale
  // offset). Pure cache write here — DB persistence is the control's job.
  function setAutoCenterWaterfallOnTune(on: boolean) {
    autoCenterWaterfallOnTune.value = on
    try {
      localStorage.setItem('sdrAutoCenterWaterfallOnTune', on ? '1' : '0')
    } catch {}
    if (on && tuningOffsetHz.value !== 0) {
      tuningOffsetHz.value = 0
      requestTune(currentFreqHz.value)
    }
  }
  // Re-read autoCenterWaterfallOnTune from the persisted DB config and apply it
  // to this live store. Called when the config JSON editor (Settings → App
  // Settings → Application Config) uploads a new config: that replaces the DB
  // settings, but this store still holds its localStorage-cached value, so
  // without this the running SDR UI would ignore the edit until reload. Keeps
  // the JSON editor, the WATERFALL toggle and the live behaviour in sync.
  async function hydrateAutoCenterFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.autoCenterWaterfallOnTune
      if (typeof v === 'boolean' && v !== autoCenterWaterfallOnTune.value) {
        setAutoCenterWaterfallOnTune(v)
      }
    } catch {
      /* offline / transient — keep current value */
    }
  }

  // "Full waterfall update" toggle (matches SDR++ User Guide v1.1 p. 34). When
  // ON, the waterfall history is reset whenever a viewing parameter (Zoom)
  // changes, so new rows fill the narrower viewport cleanly instead of the
  // pre-zoom rows staying horizontally-stretched. Default ON in Sentinel
  // (SDR++'s own default is OFF, but Sentinel users see a cleaner zoom UX).
  function _readFullWaterfallUpdate(): boolean {
    try {
      return localStorage.getItem('sdrFullWaterfallUpdate') !== '0'
    } catch {
      return true
    }
  }
  const fullWaterfallUpdate = ref<boolean>(_readFullWaterfallUpdate())
  function setFullWaterfallUpdate(on: boolean) {
    fullWaterfallUpdate.value = on
    try {
      localStorage.setItem('sdrFullWaterfallUpdate', on ? '1' : '0')
    } catch {}
  }
  // Mirror of hydrateAutoCenterFromDb — keeps the live toggle in sync after a
  // config JSON upload replaces the DB row.
  async function hydrateFullWaterfallUpdateFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.fullWaterfallUpdate
      if (typeof v === 'boolean' && v !== fullWaterfallUpdate.value) {
        setFullWaterfallUpdate(v)
      }
    } catch {
      /* offline / transient — keep current value */
    }
  }

  // Snap-to-known-frequency toggle. When ON, clicking a known-frequency marker in
  // the spectrum jumps to it, and dragging the tuner bar snaps to a nearby known
  // frequency. Same persistence pattern as fullWaterfallUpdate (localStorage for
  // instant restore, DB hydrate on config upload). Default ON.
  function _readSnapToKnown(): boolean {
    try {
      return localStorage.getItem('sdrSnapToKnown') !== '0'
    } catch {
      return true
    }
  }
  const snapToKnown = ref<boolean>(_readSnapToKnown())
  function setSnapToKnown(on: boolean) {
    snapToKnown.value = on
    try {
      localStorage.setItem('sdrSnapToKnown', on ? '1' : '0')
    } catch {}
  }
  async function hydrateSnapToKnownFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.snapToKnown
      if (typeof v === 'boolean' && v !== snapToKnown.value) {
        setSnapToKnown(v)
      }
    } catch {
      /* offline / transient — keep current value */
    }
  }

  // Waterfall overlay visibility toggles (bandplan strip and known-frequency
  // labels). Same persistence pattern as fullWaterfallUpdate: localStorage for
  // instant restore, DB hydrate on config upload. Default ON.
  function _readShowBandPlan(): boolean {
    try {
      return localStorage.getItem('sdrShowBandPlan') !== '0'
    } catch {
      return true
    }
  }
  const showBandPlan = ref<boolean>(_readShowBandPlan())
  function setShowBandPlan(on: boolean) {
    showBandPlan.value = on
    try {
      localStorage.setItem('sdrShowBandPlan', on ? '1' : '0')
    } catch {}
  }
  async function hydrateShowBandPlanFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.showBandPlan
      if (typeof v === 'boolean' && v !== showBandPlan.value) setShowBandPlan(v)
    } catch {
      /* offline / transient */
    }
  }

  function _readShowKnownFreqs(): boolean {
    try {
      return localStorage.getItem('sdrShowKnownFreqs') !== '0'
    } catch {
      return true
    }
  }
  const showKnownFreqs = ref<boolean>(_readShowKnownFreqs())
  function setShowKnownFreqs(on: boolean) {
    showKnownFreqs.value = on
    try {
      localStorage.setItem('sdrShowKnownFreqs', on ? '1' : '0')
    } catch {}
  }
  async function hydrateShowKnownFreqsFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.showKnownFreqs
      if (typeof v === 'boolean' && v !== showKnownFreqs.value) setShowKnownFreqs(v)
    } catch {
      /* offline / transient */
    }
  }

  // Resume delay (seconds) for scan + search auto-resume. When the radio locks
  // on a signal during scan/search, it waits until the signal drops below its
  // threshold AND this many seconds have elapsed before continuing. 0 → resume
  // immediately on drop. Persisted in the `sdr` settings namespace; localStorage
  // is a fast-path cache for instant restore.
  function _readResumeDelaySec(): number {
    try {
      const raw = localStorage.getItem('sdrResumeDelaySec')
      const n = raw == null ? 0 : parseInt(raw, 10)
      return isFinite(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  }
  const resumeDelaySec = ref<number>(_readResumeDelaySec())
  function setResumeDelaySec(v: number) {
    const clamped = isFinite(v) && v >= 0 ? Math.floor(v) : 0
    resumeDelaySec.value = clamped
    try {
      localStorage.setItem('sdrResumeDelaySec', String(clamped))
    } catch {}
  }
  async function hydrateResumeDelaySecFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.resumeDelaySec
      if (typeof v === 'number' && v >= 0 && v !== resumeDelaySec.value) {
        setResumeDelaySec(v)
      }
    } catch {
      /* offline / transient */
    }
  }

  // Waterfall view settings (Zoom / Max / Min sliders in SdrWaterfall). These
  // live in the store — not as plain local refs in the component — so they
  // survive the component being torn down and rebuilt when the user navigates
  // away from the SDR section and back. SdrWaterfall seeds its local working
  // copies from these on mount and writes back on every slider change. zmin/
  // zmax of 0/0 means "unset" (use the device default range); autoScale true
  // means the Min/Max sliders haven't been touched. Persisted in localStorage
  // (like the SDR toggle preferences above) so they also survive a full page
  // reload / tab close, not just in-app navigation.
  function _readNum(key: string, fallback: number): number {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      const n = parseFloat(raw)
      return isFinite(n) ? n : fallback
    } catch {
      return fallback
    }
  }
  const viewZoom = ref(_readNum('sdrViewZoom', 1))
  const viewZmin = ref(_readNum('sdrViewZmin', 0))
  const viewZmax = ref(_readNum('sdrViewZmax', 0))
  const viewAutoScale = ref<boolean>(
    (() => {
      try {
        return localStorage.getItem('sdrViewAutoScale') !== '0'
      } catch {
        return true
      }
    })(),
  )
  function setViewSettings(s: {
    zoom?: number
    zmin?: number
    zmax?: number
    autoScale?: boolean
  }) {
    if (s.zoom !== undefined) viewZoom.value = s.zoom
    if (s.zmin !== undefined) viewZmin.value = s.zmin
    if (s.zmax !== undefined) viewZmax.value = s.zmax
    if (s.autoScale !== undefined) viewAutoScale.value = s.autoScale
    try {
      localStorage.setItem('sdrViewZoom', String(viewZoom.value))
      localStorage.setItem('sdrViewZmin', String(viewZmin.value))
      localStorage.setItem('sdrViewZmax', String(viewZmax.value))
      localStorage.setItem('sdrViewAutoScale', viewAutoScale.value ? '1' : '0')
    } catch {}
  }

  // Current demod offset from the hardware centre frequency (Hz). 0 when
  // auto-centre is ON or the marker sits at centre. The waterfall reads this to
  // place the tuning bar at currentFreqHz + tuningOffsetHz; the panel pushes it
  // into the audio NCO. Plain ref — only changes on a click/retune, not per
  // frame.
  const tuningOffsetHz = ref(0)
  function setTuningOffsetHz(hz: number) {
    tuningOffsetHz.value = hz
  }

  // ── Digital decode (dsd-fme sidecar) ──────────────────────────────────────
  // User toggle for digital-mode decoding. Persisted in the `sdr` settings
  // namespace; localStorage is a fast-path cache (same pattern as the waterfall
  // toggles) so the button reflects the last state instantly on load, then the
  // DB hydrate reconciles it. Default OFF.
  function _readDigitalEnabled(): boolean {
    try {
      return localStorage.getItem('sdrDigitalEnabled') === '1'
    } catch {
      return false
    }
  }
  const digitalEnabled = ref<boolean>(_readDigitalEnabled())
  function setDigitalEnabled(on: boolean) {
    digitalEnabled.value = on
    try {
      localStorage.setItem('sdrDigitalEnabled', on ? '1' : '0')
    } catch {}
  }
  async function hydrateDigitalEnabledFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const v = data?.digitalDecodeDefault
      if (typeof v === 'boolean' && v !== digitalEnabled.value) setDigitalEnabled(v)
    } catch {
      /* offline / transient — keep current value */
    }
  }

  // ── APRS decode (Direwolf sidecar) ─────────────────────────────────────────
  // APRS packet decode runs in the BACKGROUND, independent of the SDR view and
  // of digital-voice decode (it can run concurrently on a second dongle). So it
  // is controlled over HTTP (start/stop endpoints) rather than the spectrum
  // WebSocket, and the enabled radio is persisted server-side (resumes on
  // restart). The local flag mirrors the viewed radio's APRS state so the toggle
  // reflects it instantly; localStorage is the fast-path cache, like the digital
  // toggle. Default OFF.
  function _readAprsEnabled(): boolean {
    try {
      return localStorage.getItem('sdrAprsEnabled') === '1'
    } catch {
      return false
    }
  }
  const aprsEnabled = ref<boolean>(_readAprsEnabled())
  function setAprsEnabled(on: boolean) {
    aprsEnabled.value = on
    try {
      localStorage.setItem('sdrAprsEnabled', on ? '1' : '0')
    } catch {}
  }

  // Which radio is decoding APRS (null = none). The backend runs at most one
  // APRS bridge (get_or_create_aprs_bridge stops any other) and persists the
  // radio in `sdr/aprs_radio_id`, so this mirrors it. Needed because APRS decode
  // mutes ONLY its own radio's audio — another radio the user is listening to
  // must stay audible. localStorage is the fast-path cache (same pattern as
  // aprsEnabled) so the mute is right on the first frame after a reload.
  function _readAprsRadioId(): number | null {
    try {
      const raw = parseInt(localStorage.getItem('sdrAprsRadioId') || '', 10)
      return Number.isFinite(raw) ? raw : null
    } catch {
      return null
    }
  }
  const aprsRadioId = ref<number | null>(_readAprsRadioId())
  function setAprsRadioId(radioId: number | null) {
    aprsRadioId.value = radioId
    try {
      if (radioId == null) localStorage.removeItem('sdrAprsRadioId')
      else localStorage.setItem('sdrAprsRadioId', String(radioId))
    } catch {}
  }

  /**
   * Reconcile the APRS decode state with the database. The backend resumes the
   * persisted APRS radio on startup (resume_persisted_aprs), so after a reload
   * the DB — not localStorage — is the truth about which radio is decoding.
   */
  async function hydrateAprsFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const persistedRadioId = data?.aprs_radio_id
      const nextRadioId = typeof persistedRadioId === 'number' ? persistedRadioId : null
      if (nextRadioId !== aprsRadioId.value) setAprsRadioId(nextRadioId)
      if ((nextRadioId !== null) !== aprsEnabled.value) setAprsEnabled(nextRadioId !== null)
    } catch {
      /* offline / transient — keep the cached value */
    }
  }

  // ── Decode audio muting ───────────────────────────────────────────────────
  // Settings → SDR → DECODING → "Mute Audio While Decoding". When ON (the
  // default, and the behaviour before this setting existed) the analog audio of
  // a radio is muted while that radio decodes digital voice or APRS — the raw
  // channel is noise to the ear. Lives in the `sdr` settings namespace;
  // localStorage is the fast-path cache so the first render after load is
  // correct before the async settings fetch resolves. Absent/invalid ⇒ ON, so
  // existing installs keep muting.
  function _readMuteAudioWhileDecoding(): boolean {
    try {
      return localStorage.getItem('sdrMuteAudioWhileDecoding') !== '0'
    } catch {
      return true
    }
  }
  const muteAudioWhileDecoding = ref<boolean>(_readMuteAudioWhileDecoding())
  function setMuteAudioWhileDecoding(on: boolean) {
    muteAudioWhileDecoding.value = on
    try {
      localStorage.setItem('sdrMuteAudioWhileDecoding', on ? '1' : '0')
    } catch {}
  }
  async function hydrateMuteAudioWhileDecodingFromDb(): Promise<void> {
    try {
      const res = await fetch('/api/settings/sdr')
      if (!res.ok) return
      const data = await res.json()
      const persisted = data?.muteAudioWhileDecoding
      if (typeof persisted === 'boolean' && persisted !== muteAudioWhileDecoding.value) {
        setMuteAudioWhileDecoding(persisted)
      }
    } catch {
      /* offline / transient — keep the cached value */
    }
  }

  // Which decoded-event stream the dock is showing for the viewed radio. APRS
  // when APRS decode is on (its packet table + raw log), otherwise the voice
  // call table. Drives the dock's column layout.
  const decodeStreamKind = computed<'voice' | 'aprs'>(() => (aprsEnabled.value ? 'aprs' : 'voice'))

  // Whether the decoder dock (panels below the waterfall) should be shown: true
  // while EITHER voice or APRS decode is active. The waterfall also raises its
  // bottom by the dock height when this is true.
  const decodeDockOpen = computed<boolean>(() => digitalEnabled.value || aprsEnabled.value)

  // Start background APRS decode on a radio. Persists server-side and keeps
  // feeding the Land map even when another radio is viewed. Returns success.
  async function startAprs(radioId: number, offsetHz = 0, bwHz = 0): Promise<boolean> {
    try {
      const res = await fetch('/api/sdr/aprs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_id: radioId, offset_hz: offsetHz, bw_hz: bwHz }),
      })
      // Track the decoding radio only once the backend has accepted it, so a
      // failed start never mutes a radio that isn't decoding.
      if (res.ok) setAprsRadioId(radioId)
      return res.ok
    } catch {
      return false
    }
  }

  // Stop background APRS decode on a radio and clear the persisted choice.
  async function stopAprs(radioId: number): Promise<boolean> {
    try {
      const res = await fetch('/api/sdr/aprs/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_id: radioId }),
      })
      return res.ok
    } catch {
      return false
    } finally {
      // Clear regardless of the response: the user asked for decode to stop, so
      // the audio must not stay muted even if the backend call failed.
      setAprsRadioId(null)
    }
  }

  // ── Trunk tracking (dsd-fme follows control-channel grants) ────────────────
  // Master feature flag for the whole trunk-tracking surface (opt-in, default
  // OFF — same shape as air.replayEnabled). When OFF the TRUNK button and the
  // TRUNK SYSTEM channel-map picker are hidden in the SDR panel and the "Trunk
  // Channel Maps (JSON)" config row is hidden in Settings. Lives in the `sdr`
  // settings namespace; localStorage is a fast-path cache so the first render
  // after load is correct before the async settings fetch resolves
  // (SdrTrunkTrackingToggleControl reconciles it with the DB).
  function _readTrunkTrackingEnabled(): boolean {
    try {
      return localStorage.getItem('sdrTrunkTrackingEnabled') === '1'
    } catch {
      return false
    }
  }
  const trunkTrackingEnabled = ref<boolean>(_readTrunkTrackingEnabled())
  function setTrunkTrackingEnabled(on: boolean) {
    trunkTrackingEnabled.value = on
    try {
      localStorage.setItem('sdrTrunkTrackingEnabled', on ? '1' : '0')
    } catch {}
    // Stopping an active follow when the feature is switched off is left to the
    // SDR panel (it watches this flag and owns the WS connection that tells
    // dsd-fme to drop trunk mode) — same split as the digital-decode toggle.
    // Clearing trunkEnabled here would pre-empt that watcher and skip the WS
    // command, leaving the backend following with no UI.
  }

  // Whether trunk tracking is active. Not auto-persisted: trunking rides on an
  // active decode session and a chosen channel map, so it is always started
  // explicitly rather than restored on load.
  const trunkEnabled = ref(false)
  function setTrunkEnabled(on: boolean) {
    trunkEnabled.value = on
    if (!on) {
      trunkFollowedHz.value = null
      trunkOnControlChannel.value = false
      trunkError.value = ''
    }
  }

  // The selected channel-map CSV filename. Persisted as a convenience so the last
  // system is preselected next time (it does not enable trunking on its own).
  function _readTrunkChannelMap(): string {
    try {
      return localStorage.getItem('sdrTrunkChannelMap') ?? ''
    } catch {
      return ''
    }
  }
  const trunkChannelMap = ref<string>(_readTrunkChannelMap())
  function setTrunkChannelMap(name: string) {
    trunkChannelMap.value = name
    try {
      localStorage.setItem('sdrTrunkChannelMap', name)
    } catch {}
  }

  // CSV filenames offered in the channel-map picker, fetched from the backend.
  const trunkChannelMaps = ref<string[]>([])
  function setTrunkChannelMaps(names: string[]) {
    trunkChannelMaps.value = names
  }

  // Live trunk indicators: the frequency currently followed and whether it is the
  // control channel (vs an active call's voice channel). Reset per session.
  const trunkFollowedHz = ref<number | null>(null)
  const trunkOnControlChannel = ref(false)
  // Last trunk error surfaced by the backend (e.g. missing channel map).
  const trunkError = ref('')
  function setTrunkError(message: string) {
    trunkError.value = message
  }

  // Live decoded-event log (newest first), plus the latest sync / decoder
  // reachability state. Non-persisted — this is live session data.
  const decodeEvents = ref<DecodeEvent[]>([])
  const decodeSync = ref(false)
  const decoderReachable = ref(false)
  // Most-recently decoded protocol (e.g. "DMR", "P25"), upper-cased by the
  // sidecar parser. Drives the decoded-voice playback sample rate, which differs
  // per mode (dsd-fme upsamples most modes' UDP audio to 48 kHz but emits DMR at
  // native 8 kHz). Empty until the first mode-bearing event arrives.
  const decodedMode = ref('')

  // Backend-measured playback sample rate (Hz) for decoded voice. Null until the
  // backend has measured dsd-fme's actual UDP output rate (see
  // DigitalDecodeBridge._measure_audio_rate); the decode-audio player falls back
  // to a default until then. Measured per session, so it is reset on clear.
  const decodedAudioRate = ref<number | null>(null)

  // Raw dsd-fme output lines (newest first), shown in the Decoder log view.
  // Non-persisted live session data, like decodeEvents.
  const decodeLogs = ref<string[]>([])

  // Ingest a batch of decoded frames from the decode WebSocket in a SINGLE
  // reactive update. A busy control channel emits dozens of dsd-fme log lines a
  // second; folding a whole frame's worth of messages into one mutation (one
  // array rebuild per buffer, not one per message) is what keeps the decoder
  // dock from re-rendering on every message and starving the spectrum/waterfall
  // and decoded-audio scheduling on the shared main thread. Events arrive
  // oldest-first; both buffers are kept newest-first and capped.
  //
  // Per frame: sync/reachability/mode fields update the live indicators
  // (last-in-batch wins, matching sequential arrival) regardless of frame type;
  // `type: "log"` frames carry a raw dsd-fme line and go only to the log buffer;
  // `decode_status` frames update indicators only; every other frame is a call
  // row.
  function pushDecodeEventBatch(events: DecodeEvent[]) {
    if (events.length === 0) return
    const freshLogs: string[] = []
    const freshRows: DecodeEvent[] = []
    for (const event of events) {
      if (typeof event.decoder_reachable === 'boolean')
        decoderReachable.value = event.decoder_reachable
      if (typeof event.sync === 'boolean') decodeSync.value = event.sync
      if (event.mode) decodedMode.value = event.mode
      if (typeof event.audio_sample_rate === 'number')
        decodedAudioRate.value = event.audio_sample_rate
      if (event.type === 'log') {
        const cleaned = event.line ? stripAnsi(event.line) : ''
        if (cleaned) freshLogs.push(cleaned)
        continue
      }
      if (event.type === 'decode_status') continue
      if (event.type === 'trunk_event') {
        // Trunk retune: update the "currently following" indicators only — it is
        // a state change (which channel we are on), not a decoded call row.
        if (typeof event.tuned_hz === 'number') trunkFollowedHz.value = event.tuned_hz
        trunkOnControlChannel.value = event.is_control_channel === true
        continue
      }
      freshRows.push({ ...event, ts: event.ts || Date.now() })
    }
    // Reverse so the batch's newest frame lands at the front, then prepend the
    // existing (already newest-first) buffer and cap.
    if (freshLogs.length > 0)
      decodeLogs.value = [...freshLogs.reverse(), ...decodeLogs.value].slice(0, DECODE_LOGS_MAX)
    if (freshRows.length > 0)
      decodeEvents.value = [...freshRows.reverse(), ...decodeEvents.value].slice(
        0,
        DECODE_EVENTS_MAX,
      )
  }

  // Ingest a single decoded frame. Thin wrapper over pushDecodeEventBatch so the
  // routing/capping logic lives in one place; the WebSocket path batches a
  // frame's worth of events via pushDecodeEventBatch directly.
  function pushDecodeEvent(event: DecodeEvent) {
    pushDecodeEventBatch([event])
  }

  function setDecodeStatus(status: { decoder_reachable?: boolean; sync?: boolean }) {
    if (typeof status.decoder_reachable === 'boolean')
      decoderReachable.value = status.decoder_reachable
    if (typeof status.sync === 'boolean') decodeSync.value = status.sync
  }

  // Reset the live decode state — called when digital decode is disabled or the
  // radio changes, so a new session starts clean.
  function clearDecode() {
    decodeEvents.value = []
    decodeLogs.value = []
    decodeSync.value = false
    decoderReachable.value = false
    decodedMode.value = ''
    decodedAudioRate.value = null
    trunkFollowedHz.value = null
    trunkOnControlChannel.value = false
  }

  // Clear only the event log (the user's "clear" button), leaving the live
  // sync / reachability indicators intact since the decoder is still connected.
  function clearDecodeEvents() {
    decodeEvents.value = []
  }

  // Clear only the raw log buffer (the log view's own "clear" button).
  function clearDecodeLogs() {
    decodeLogs.value = []
  }

  // Latest spectrum frame from the control WebSocket. Non-persisted; held as a
  // single ref (the bins array is NOT deep-tracked — consumers read it
  // imperatively in their render/push loop). See SdrWaterfall.vue.
  // shallowRef: a fresh frame (with a 1024-number array) arrives ~12x/sec.
  // A deep `ref` would proxy that array every frame; shallowRef makes the
  // assignment O(1) while the watch still fires on identity change.
  const lastSpectrum = shallowRef<SdrSpectrumFrame | null>(null)

  function setSpectrum(frame: SdrSpectrumFrame) {
    lastSpectrum.value = frame
  }

  // True only while a range search is actively stepping (sweeping). The
  // waterfall reads this to freeze rendering while the centre frequency is
  // jumping every dwell_ms — painting those frames produces meaningless noise.
  const searchSweeping = ref(false)
  // Range bounds + current step for the search overlay shown by SdrWaterfall.
  // Panel writes these as the sweep advances; null when not searching.
  const searchLowHz = ref<number | null>(null)
  const searchHighHz = ref<number | null>(null)
  const searchCurrentHz = ref<number | null>(null)

  // True while the scanner is actively stepping between saved frequencies and
  // has not yet locked on an active signal. Drives the same paused/holding
  // overlay used during search sweeps. Group names label which groups are in
  // the scan queue (or a single "All" entry when every scannable freq is in).
  const scanSweeping = ref(false)
  const scanGroupNames = ref<string[]>([])

  function _restoreSession() {
    try {
      const id = sessionStorage.getItem('sdrLastRadioId')
      if (id) currentRadioId.value = parseInt(id)
      const freq = sessionStorage.getItem('sdrLastFreqHz')
      if (freq) currentFreqHz.value = parseInt(freq)
      const mode = sessionStorage.getItem('sdrLastMode') as SdrMode | null
      if (mode) currentMode.value = mode
      playing.value = sessionStorage.getItem('sdrPlaying') === '1'
    } catch {}
  }

  function _persistSession() {
    try {
      if (currentRadioId.value !== null)
        sessionStorage.setItem('sdrLastRadioId', String(currentRadioId.value))
      sessionStorage.setItem('sdrLastFreqHz', String(currentFreqHz.value))
      sessionStorage.setItem('sdrLastMode', currentMode.value)
      sessionStorage.setItem('sdrPlaying', playing.value ? '1' : '0')
    } catch {}
  }

  function setRadio(id: number) {
    currentRadioId.value = id
    _persistSession()
  }

  function setFrequency(hz: number) {
    currentFreqHz.value = hz
    _persistSession()
  }

  function setMode(mode: SdrMode) {
    currentMode.value = mode
    _persistSession()
  }

  function setPlaying(val: boolean) {
    playing.value = val
    _persistSession()
  }

  // Panel → store mirror of the device reachability dot. The authoritative copy
  // is the local `connected` ref in SdrPanel.vue; the panel pushes it here so
  // other components (e.g. the air-domain airport list) can gate SDR tuning on
  // whether a radio is actually connected.
  function setConnected(val: boolean) {
    connected.value = val
  }

  // Panel → store mirror of tuning ownership (from the WS status/control frames).
  // Drives the read-only follower UI: when another instance owns the shared
  // dongle, tuning controls are disabled and a banner is shown.
  function setOwnership(owner: boolean, available: boolean, isLocked: boolean) {
    isOwner.value = owner
    controlAvailable.value = available
    locked.value = isLocked
  }

  // True only when the relay control channel is active, another instance holds the
  // tuning token, and we are not it — i.e. this instance is a read-only follower.
  const readOnly = computed(() => controlAvailable.value && !isOwner.value && locked.value)

  // Panel → store mirror of the demod bandwidth.
  function setBandwidthHz(hz: number) {
    bwHz.value = hz
  }

  // Marker → panel: request a device retune (panel applies it, debounced).
  // center=true forces a hardware-centre retune even with auto-centre OFF
  // (the freq-axis drag-pan sets this; click-to-tune leaves it undefined).
  function requestTune(hz: number, center = false) {
    tuneRequest.value = { hz, nonce: ++_tuneNonce, center }
  }

  // Marker → panel: request a demod-bandwidth change (audio filter only).
  function requestBandwidth(hz: number) {
    bwRequest.value = { hz, nonce: ++_bwNonce }
  }

  // Waterfall → panel: ask the backend to switch FFT size.
  function requestFftSize(bins: number) {
    fftSizeRequest.value = { bins, nonce: ++_fftNonce }
  }

  // Fetch the configured SDR radios and replace `radios` with the result. This
  // is the single owner of that list — SdrPanel (radio dropdown/auto-select)
  // and any other consumer read `radios` rather than loading it themselves.
  // Silently keeps the previous value on a network error or non-2xx response
  // (offline/transient failure), matching the rest of this store's fetch
  // helpers — callers that need to react to failure should check whether the
  // list actually changed.
  async function loadRadios() {
    try {
      const res = await fetch('/api/sdr/radios')
      if (res.ok) radios.value = await res.json()
    } catch {}
  }

  // Fetch the saved frequency groups and replace `groups`. Single owner of
  // group data — see loadRadios for the error-handling rationale.
  async function loadGroups() {
    try {
      const res = await fetch('/api/sdr/groups')
      if (res.ok) groups.value = await res.json()
    } catch {}
  }

  // Fetch the saved (Frequency Manager) frequencies and replace `frequencies`.
  // Single owner of frequency data — both SdrPanel's Frequency Manager UI and
  // SdrWaterfall's known-frequency markers read this same list, so it now
  // carries the full backend shape (group_ids, notes, per-frequency tuning
  // settings) rather than a slimmed-down mirror. See loadRadios for the
  // error-handling rationale.
  async function loadFrequencies() {
    try {
      const res = await fetch('/api/sdr/frequencies')
      if (res.ok) frequencies.value = await res.json()
    } catch {}
  }

  /**
   * The groups a stored frequency belongs to. Merges the current many-to-many
   * `group_ids` with the legacy single `group_id` (0 / null mean "Default",
   * i.e. no group).
   */
  function freqGroupsFor(freq: SdrStoredFrequency): SdrFrequencyGroup[] {
    const ids = new Set<number>((freq.group_ids || []).filter((id) => id !== 0))
    if (freq.group_id != null && freq.group_id !== 0) ids.add(freq.group_id)
    return groups.value.filter((group) => ids.has(group.id))
  }

  /**
   * Groups that currently have at least one stored frequency, sorted
   * case-insensitively by name. Drives the RADIO tab's scan-group chips and
   * the Frequency Manager's group filter.
   */
  const groupsWithFreqs = computed<SdrFrequencyGroup[]>(() => {
    const idsWithFreqs = new Set<number>()
    frequencies.value.forEach((freq) => {
      ;(freq.group_ids || []).forEach((id) => {
        if (id !== 0) idsWithFreqs.add(id)
      })
      if (freq.group_id != null && freq.group_id !== 0) idsWithFreqs.add(freq.group_id)
    })
    return groups.value
      .filter((group) => idsWithFreqs.has(group.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  })

  _restoreSession()

  return {
    radios,
    groups,
    frequencies,
    freqGroupsFor,
    groupsWithFreqs,
    currentRadioId,
    playing,
    connected,
    isOwner,
    controlAvailable,
    locked,
    readOnly,
    setOwnership,
    currentFreqHz,
    currentMode,
    currentGain,
    currentSquelch,
    panelOpen,
    sampleRate,
    activeTab,
    setActiveTab,
    lastSpectrum,
    searchSweeping,
    searchLowHz,
    searchHighHz,
    searchCurrentHz,
    scanSweeping,
    scanGroupNames,
    bwHz,
    tuneRequest,
    bwRequest,
    fftSizeRequest,
    autoCenterWaterfallOnTune,
    setAutoCenterWaterfallOnTune,
    hydrateAutoCenterFromDb,
    fullWaterfallUpdate,
    setFullWaterfallUpdate,
    hydrateFullWaterfallUpdateFromDb,
    snapToKnown,
    setSnapToKnown,
    hydrateSnapToKnownFromDb,
    showBandPlan,
    setShowBandPlan,
    hydrateShowBandPlanFromDb,
    showKnownFreqs,
    setShowKnownFreqs,
    hydrateShowKnownFreqsFromDb,
    resumeDelaySec,
    setResumeDelaySec,
    hydrateResumeDelaySecFromDb,
    viewZoom,
    viewZmin,
    viewZmax,
    viewAutoScale,
    setViewSettings,
    tuningOffsetHz,
    setTuningOffsetHz,
    digitalEnabled,
    setDigitalEnabled,
    hydrateDigitalEnabledFromDb,
    aprsEnabled,
    setAprsEnabled,
    aprsRadioId,
    setAprsRadioId,
    hydrateAprsFromDb,
    muteAudioWhileDecoding,
    setMuteAudioWhileDecoding,
    hydrateMuteAudioWhileDecodingFromDb,
    decodeStreamKind,
    decodeDockOpen,
    startAprs,
    stopAprs,
    decodeEvents,
    decodeLogs,
    decodeSync,
    decoderReachable,
    decodedMode,
    decodedAudioRate,
    pushDecodeEvent,
    pushDecodeEventBatch,
    setDecodeStatus,
    clearDecode,
    clearDecodeEvents,
    clearDecodeLogs,
    trunkTrackingEnabled,
    setTrunkTrackingEnabled,
    trunkEnabled,
    setTrunkEnabled,
    trunkChannelMap,
    setTrunkChannelMap,
    trunkChannelMaps,
    setTrunkChannelMaps,
    trunkFollowedHz,
    trunkOnControlChannel,
    trunkError,
    setTrunkError,
    setRadio,
    setFrequency,
    setMode,
    setPlaying,
    setConnected,
    setSpectrum,
    setBandwidthHz,
    requestTune,
    requestBandwidth,
    requestFftSize,
    loadRadios,
    loadGroups,
    loadFrequencies,
  }
})
