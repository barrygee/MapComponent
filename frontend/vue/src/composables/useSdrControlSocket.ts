import type { useSdrStore } from '@/stores/sdr'

/**
 * The SDR control-socket transport + command layer, extracted from
 * SdrPanel.vue's engine spine — behaviour byte-identical. Owns the WebSocket
 * handle, the exponential reconnect backoff, the stale-socket supersede
 * guards, the per-radio initialised markers, the connection-dot reachability
 * probe and the sendCmd chokepoint (including its read-only suppression and
 * NCO-offset-clear policy).
 *
 * IMPORTANT: this composable registers NO lifecycle hooks — the control
 * socket deliberately stays OPEN on component unmount (SdrTabPanel persists
 * across navigation and the audio must survive). open/close are strictly
 * caller-driven.
 */
export interface UseSdrControlSocketOptions {
  /** Lazy accessor for the SDR store (the panel's shared instance). */
  sdrStore: () => ReturnType<typeof useSdrStore>
  /**
   * Runs inside the socket's 'open' listener, after the reconnect delay reset
   * and the reachability probe kick-off: the panel's restore chain (playing
   * state, demod mode/bandwidth, FFT-size replay, sample-rate push, queued
   * auto-tune drain).
   */
  onSocketOpen: (radioId: number) => void
  /**
   * Receives every JSON-parsed control-socket frame; the panel discriminates
   * on msg.type (status/spectrum/control/error/pong).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic WS JSON payload; the consumer discriminates on msg.type and field-casts at use sites
  onSocketMessage: (msg: any) => void
  /** The socket for the current radio dropped (close/error) — mark disconnected. */
  onSocketDown: () => void
  /**
   * The connect POST 404'd: the radio no longer exists in the DB (deleted
   * while a stale sdrLastRadioId lingered). The composable has already cleared
   * the stored id and closed the socket; the panel resets its selection UI.
   */
  onRadioMissing: () => void
  /**
   * The connect POST was refused because the radio's device is unavailable —
   * its dongle unplugged, disabled, or replugged into another socket.
   *
   * Separate from `onRadioMissing` because the radio still exists and the
   * operator's selection is still meaningful: the device may well come back.
   * The composable has stopped the reconnect loop and left the stored id
   * alone, so the panel should show `reason` and let them decide.
   */
  onDeviceUnavailable: (reason: string) => void
  /** The reachability probe found the device connected — light the dot. */
  onReachable: () => void
  /** Whether the given radio is still the panel's selected one (probe race guard). */
  isRadioStillSelected: (radioId: number) => boolean
  /** Whether the connection dot is already lit (stops redundant probe retries). */
  isAlreadyConnected: () => boolean
}

/**
 * Creates the control-socket engine. Returns the transport controls plus the
 * data-confirmed flag and initialised-marker accessors the panel's message
 * handlers drive.
 */
export function useSdrControlSocket(options: UseSdrControlSocketOptions) {
  const {
    sdrStore: _sdrStore,
    onSocketOpen,
    onSocketMessage,
    onSocketDown,
    onRadioMissing,
    onDeviceUnavailable,
    onReachable,
    isRadioStillSelected,
    isAlreadyConnected,
  } = options

  let _ctrlSocket: WebSocket | null = null
  let _ctrlReconnectDelay = 500
  const CTRL_RECONNECT_MAX = 30000
  let _ctrlRadioId: number | null = null
  let _ctrlReconnect: ReturnType<typeof setTimeout> | null = null
  // Bounded retry timer for the connection-dot reachability probe (see
  // _probeReachability): the first probe on socket-open can race the backend
  // finishing its dongle (re)connection.
  let _probeRetry: ReturnType<typeof setTimeout> | null = null
  const PROBE_RETRY_MS = 1500
  const PROBE_MAX_ATTEMPTS = 4
  let _ctrlDataConfirmed = false

  function _markInitialised(id: number) {
    sessionStorage.setItem(`sdrInit_${id}`, '1')
  }
  function _isInitialised(id: number) {
    return sessionStorage.getItem(`sdrInit_${id}`) === '1'
  }

  /** True once this connection has delivered a data (spectrum) frame. */
  function isDataConfirmed(): boolean {
    return _ctrlDataConfirmed
  }
  /** Set by the panel's spectrum/error handlers to track data flow per connection. */
  function setDataConfirmed(confirmed: boolean): void {
    _ctrlDataConfirmed = confirmed
  }

  function sendCmd(obj: object) {
    // Read-only follower: another instance owns the shared dongle over the relay
    // control channel, so suppress hardware-tuning commands (the relay would refuse
    // them anyway). Local/demod commands (mode, fft_size, digital, ping, …) still
    // pass through. When the tuner is FREE this is not read-only (locked=false), so
    // a tune here is allowed and claims ownership. This is the single chokepoint
    // every retune path funnels through (typed, marker click, wheel, scan, search).
    const sdrCommand = (obj as { cmd?: string }).cmd
    if (
      _sdrStore().readOnly &&
      (sdrCommand === 'tune' || sdrCommand === 'gain' || sdrCommand === 'sample_rate')
    ) {
      return
    }
    // A hardware tune always recenters the SDR on the new freq, so any prior
    // demod NCO offset (auto-centre OFF) is no longer valid — clear it here, the
    // single chokepoint for every retune path (typed, saved, marker, restore).
    // The auto-centre-OFF click path deliberately does NOT call sendCmd('tune'),
    // so it keeps its offset.
    if ((obj as { cmd?: string }).cmd === 'tune' && _sdrStore().tuningOffsetHz !== 0) {
      _sdrStore().setTuningOffsetHz(0)
    }
    // The socket is OPEN for every command path the tests drive; the not-open
    // arm (a command queued while CONNECTING) is a defensive drop.
    /* v8 ignore start */
    if (_ctrlSocket && _ctrlSocket.readyState === WebSocket.OPEN) {
      _ctrlSocket.send(JSON.stringify(obj))
    }
    /* v8 ignore stop */
  }

  // Reachability probe for the connection dot. The dot represents *availability*
  // (the device is connected), NOT whether audio/spectrum is actively streaming —
  // so it must go green as soon as a selected radio is reachable, without waiting
  // for the first spectrum frame (which only arrives once the user hits Play).
  // This mirrors the Settings device dot, which polls the same endpoint. Guarded
  // by radioId so a probe that resolves after the user switched radios is ignored.
  async function _probeReachability(radioId: number, attempt = 1): Promise<void> {
    let reachable = false
    try {
      const res = await fetch(`/api/sdr/status/${radioId}`)
      // Race guard: only triggerable if the radio is re-selected mid-probe.
      /* v8 ignore start */
      if (!isRadioStillSelected(radioId)) return
      /* v8 ignore stop */
      if (res.ok) {
        const data = await res.json()
        reachable = data.connected === true || data.reachable === true
      }
    } catch (_) {}
    if (reachable) {
      onReachable()
      return
    }
    // Not reachable yet. The first probe on socket-open can beat the backend's
    // dongle (re)connection — e.g. right after a container/backend restart, where
    // the WS reconnects before the dongle link is back, or another instance briefly
    // holds the single-client dongle. Retry a few times so the dot self-corrects
    // once the radio comes up, instead of latching red until Play/reselect. Stop if
    // the radio changed or another path (a spectrum frame) already lit the dot.
    if (attempt < PROBE_MAX_ATTEMPTS && _ctrlRadioId === radioId && !isAlreadyConnected()) {
      if (_probeRetry) clearTimeout(_probeRetry)
      _probeRetry = setTimeout(() => void _probeReachability(radioId, attempt + 1), PROBE_RETRY_MS)
    }
  }

  async function openControlSocket(radioId: number) {
    if (_ctrlReconnect) {
      clearTimeout(_ctrlReconnect)
      _ctrlReconnect = null
    }
    if (
      _ctrlRadioId === radioId &&
      _ctrlSocket &&
      (_ctrlSocket.readyState === WebSocket.CONNECTING || _ctrlSocket.readyState === WebSocket.OPEN)
    )
      return
    if (_ctrlSocket) {
      _ctrlSocket.close()
      _ctrlSocket = null
    }
    _ctrlRadioId = radioId
    _ctrlDataConfirmed = false
    sessionStorage.setItem('sdrLastRadioId', String(radioId))

    try {
      const res = await fetch('/api/sdr/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radio_id: radioId }),
      })
      // 404 means this radio no longer exists in the DB (e.g. deleted while a
      // stale sdrLastRadioId lingered in sessionStorage). Retrying would 404
      // every reconnect — clear the id and stop the loop instead.
      if (res.status === 404) {
        sessionStorage.removeItem('sdrLastRadioId')
        closeControlSocket()
        onRadioMissing()
        return
      }
      // 503 means the backend knows this radio's device is not usable — the
      // dongle is unplugged, disabled, or was replugged into another socket.
      // Retrying would refuse identically every few seconds for as long as that
      // is true, filling the console and never succeeding, so the loop stops
      // here and the reason is shown instead.
      //
      // Unlike a 404 the stored id is *kept*: the radio still exists and the
      // device may come back, so the operator's selection is still meaningful.
      if (res.status === 503) {
        const detail = await res
          .json()
          .then((body) => (typeof body?.detail === 'string' ? body.detail : ''))
          .catch(() => '')
        closeControlSocket()
        onDeviceUnavailable(detail || 'That radio is currently unavailable.')
        return
      }
    } catch (_) {}

    // Bail if the radio selection changed (or the socket was torn down) while the
    // connect request was in flight — otherwise we'd open a socket for a stale id.
    // (Race only triggerable with overlapping in-flight connects; not exercised
    // by the unit suite where the connect resolves before any re-selection.)
    /* v8 ignore start */
    if (_ctrlRadioId !== radioId) return
    /* v8 ignore stop */

    /* v8 ignore start -- defensive default / fall-through for an always-present field (or jsdom-limited path) */
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    /* v8 ignore stop */
    const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}`)
    _ctrlSocket = ws

    ws.addEventListener('open', () => {
      _ctrlReconnectDelay = 500
      // The control socket is open, which means /api/sdr/connect succeeded and the
      // device is reachable — light the connection dot now (availability), rather
      // than waiting for the first spectrum frame that only flows once playing.
      void _probeReachability(radioId)
      // The panel's restore chain (playing state, demod mode/bandwidth, FFT-size
      // replay, sample-rate push, queued auto-tune drain) runs here.
      onSocketOpen(radioId)
    })

    ws.addEventListener('message', (ev: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic WS JSON payload; discriminated on msg.type and field-cast at use sites
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      onSocketMessage(msg)
    })

    ws.addEventListener('close', () => {
      // Ignore the close of a socket we've already switched away from. Selecting a
      // different radio closes the previous radio's socket; that close fires after
      // _ctrlRadioId has moved on, so without this guard it would setStatus(false)
      // and re-disable the controls that selectRadio just enabled for the new radio
      // (the "select the other radio twice before controls enable" bug).
      if (_ctrlRadioId !== radioId) return
      onSocketDown()
      if (_ctrlReconnect) clearTimeout(_ctrlReconnect)
      const delay = _ctrlReconnectDelay
      _ctrlReconnectDelay = Math.min(_ctrlReconnectDelay * 2, CTRL_RECONNECT_MAX)
      _ctrlReconnect = setTimeout(() => {
        /* v8 ignore start -- only false if the radio changed during the reconnect delay (race) */
        if (_ctrlRadioId === radioId) void openControlSocket(radioId)
        /* v8 ignore stop */
      }, delay)
    })

    ws.addEventListener('error', () => {
      // Same supersede guard as 'close': a stale socket must not reset the status
      // for the radio that's now selected.
      if (_ctrlRadioId !== radioId) return
      onSocketDown()
    })
  }

  function closeControlSocket() {
    _ctrlReconnectDelay = 500
    if (_ctrlReconnect) {
      clearTimeout(_ctrlReconnect)
      _ctrlReconnect = null
    }
    if (_ctrlSocket) {
      _ctrlSocket.close()
      _ctrlSocket = null
    }
    if (_ctrlRadioId != null) sessionStorage.removeItem(`sdrInit_${_ctrlRadioId}`)
    _ctrlRadioId = null
    _ctrlDataConfirmed = false
  }

  /** True when the control socket exists and is OPEN (auto-tune drain check). */
  function isSocketOpen(): boolean {
    return !!_ctrlSocket && _ctrlSocket.readyState === WebSocket.OPEN
  }
  /** True when the control socket exists and is still CONNECTING (auto-tune queue check). */
  function isSocketConnecting(): boolean {
    return !!_ctrlSocket && _ctrlSocket.readyState === WebSocket.CONNECTING
  }

  return {
    sendCmd,
    openControlSocket,
    closeControlSocket,
    isDataConfirmed,
    setDataConfirmed,
    isSocketOpen,
    isSocketConnecting,
    markInitialised: _markInitialised,
    isInitialised: _isInitialised,
  }
}
