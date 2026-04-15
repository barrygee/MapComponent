// ============================================================
// SDR MINI BOOT
// Lightweight boot for the mini player on non-SDR pages.
// Handles:
//   - Loading available radios and auto-selecting the last used
//   - Opening the WebSocket on demand (when user tunes via mini player)
//   - Routing spectrum/status messages to the mini player
//
// Does NOT touch the SDR panel or map sidebar.
// ============================================================

/// <reference path="./globals.d.ts" />

(function sdrMiniBoot() {

    // Skip on the SDR page — sdr-boot.js handles the full panel there
    if (document.body.dataset['domain'] === 'sdr') return;

    let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let _activeRadioId:  number | null = null;
    let _radioCache:     Map<number, SdrRadio> = new Map();
    let _dataConfirmed = false;

    function dispatchSignal(dbfs: number) {
        document.dispatchEvent(new CustomEvent('sdr-mini:signal', { detail: dbfs }));
    }

    function dispatchConnected(on: boolean) {
        document.dispatchEvent(new CustomEvent('sdr-mini:connected', { detail: on }));
    }

    async function openControlSocket(radioId: number) {
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        if (_activeRadioId === radioId && _sdrSocket &&
            (_sdrSocket.readyState === WebSocket.CONNECTING || _sdrSocket.readyState === WebSocket.OPEN)) {
            return;
        }
        if (_sdrSocket) { _sdrSocket.close(); _sdrSocket = null; }

        _activeRadioId     = radioId;
        _sdrCurrentRadioId = radioId;
        sessionStorage.setItem('sdrLastRadioId', String(radioId));

        // Prefer user-adjusted settings saved across navigation; fall back to device defaults
        const cfg = _radioCache.get(radioId);
        let savedSettings: { gainDb?: number; gainAuto?: boolean; squelch?: number; bwHz?: number; mode?: string; freqHz?: number } = {};
        try {
            const raw = sessionStorage.getItem('sdrSettings');
            if (raw) savedSettings = JSON.parse(raw);
        } catch (_e) {}

        const gainDb     = savedSettings.gainDb     ?? cfg?.rf_gain   ?? 30.0;
        const gainAuto   = savedSettings.gainAuto   ?? cfg?.agc       ?? false;
        const sampleRate = savedSettings.bwHz       ?? cfg?.bandwidth ?? 2_048_000;

        try {
            await fetch('/api/sdr/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    radio_id:    radioId,
                    gain_db:     gainAuto ? null : gainDb,
                    gain_auto:   gainAuto,
                    sample_rate: sampleRate,
                }),
            });
        } catch (_e) { /* non-fatal */ }

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws    = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}`);
        _sdrSocket  = ws;
        _dataConfirmed = false;

        ws.addEventListener('message', (ev: MessageEvent) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }

            switch (msg.type) {
                case 'status':
                    if (window._SdrAudio) window._SdrAudio.setMode(msg.mode);
                    // Only update sessionStorage freq/mode if user hasn't set their own
                    if (!sessionStorage.getItem('sdrLastFreqHz') || !_sdrCurrentFreqHz) {
                        sessionStorage.setItem('sdrLastFreqHz', String(msg.center_hz));
                    }
                    sessionStorage.setItem('sdrLastMode', msg.mode);
                    break;
                case 'spectrum':
                    if (!_dataConfirmed) {
                        _dataConfirmed = true;
                        dispatchConnected(true);
                    }
                    if ((msg as any).bins?.length) {
                        let peak = -120;
                        const bins = (msg as any).bins as number[];
                        for (let i = 0; i < bins.length; i++) if (bins[i] > peak) peak = bins[i];
                        dispatchSignal(peak);
                    }
                    break;
                case 'error':
                    console.warn('[SDR mini] error', msg.code, msg.message);
                    _dataConfirmed = false;
                    dispatchConnected(false);
                    break;
            }
        });

        ws.addEventListener('open', () => {
            if (window._SdrAudio) window._SdrAudio.start(radioId);
            const lastFreqHz = savedSettings.freqHz || parseInt(sessionStorage.getItem('sdrLastFreqHz') || '0', 10);
            const lastMode   = savedSettings.mode   || sessionStorage.getItem('sdrLastMode') || 'AM';
            if (lastFreqHz > 0) ws.send(JSON.stringify({ cmd: 'tune', frequency_hz: lastFreqHz }));
            ws.send(JSON.stringify({ cmd: 'mode', mode: lastMode }));
            ws.send(JSON.stringify({ cmd: 'gain', gain_db: gainAuto ? null : gainDb }));
            if (savedSettings.squelch != null) ws.send(JSON.stringify({ cmd: 'squelch', squelch_dbfs: savedSettings.squelch }));
            if (savedSettings.bwHz    != null) ws.send(JSON.stringify({ cmd: 'sample_rate', rate_hz: savedSettings.bwHz }));
            // Sync _sdrPlaying global with persisted session state
            if (sessionStorage.getItem('sdrPlaying') === '1') {
                _sdrPlaying = true;
            }
        });

        ws.addEventListener('close', () => {
            _sdrConnected = false;
            _dataConfirmed = false;
            dispatchConnected(false);
            if (_reconnectTimer) clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(() => {
                if (_sdrCurrentRadioId === radioId) void openControlSocket(radioId);
            }, 3000);
        });

        ws.addEventListener('error', () => {
            _sdrConnected = false;
            _dataConfirmed = false;
            dispatchConnected(false);
        });
    }

    // ── Radio selection events (fired by mini player when user hits play) ─────

    document.addEventListener('sdr-radio-selected', (e: Event) => {
        const { radioId } = (e as CustomEvent).detail as { radioId: number };
        if (radioId) void openControlSocket(radioId);
    });

    document.addEventListener('sdr-radio-deselected', () => {
        if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
        if (_sdrSocket)      { _sdrSocket.close(); _sdrSocket = null; }
        _activeRadioId     = null;
        _sdrCurrentRadioId = null;
        sessionStorage.removeItem('sdrLastRadioId');
        if (window._SdrAudio) window._SdrAudio.stop();
        dispatchConnected(false);
    });

    // ── Load radios and restore last selection ────────────────────────────────

    async function loadRadios() {
        try {
            const res    = await fetch('/api/sdr/radios');
            const radios: SdrRadio[] = await res.json();
            _radioCache.clear();
            radios.forEach((r: SdrRadio) => _radioCache.set(r.id, r));

            // Populate dropdown — panel is guaranteed to be mounted before this is called
            if ((window as any)._sdrPopulateRadios) {
                (window as any)._sdrPopulateRadios(radios);
            }

            // Auto-connect to the last used radio
            const savedId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
            if (savedId > 0) {
                const match = radios.find(r => r.id === savedId && r.enabled);
                if (match) {
                    _sdrCurrentRadioId = match.id;
                    void openControlSocket(match.id);
                }
            } else if (radios.length > 0) {
                const first = radios.find(r => r.enabled);
                if (first) {
                    _sdrCurrentRadioId = first.id;
                    _radioCache.set(first.id, first);
                }
            }
        } catch (e) {
            console.warn('[SDR mini] Could not load radios:', e);
        }
    }

    // Expose so sdr-radio-tab can call after the panel is mounted
    (window as any)._sdrLoadRadios = loadRadios;

    // ── Reconnect on tab focus if socket dropped ──────────────────────────────

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _sdrCurrentRadioId && !_sdrConnected) {
            void openControlSocket(_sdrCurrentRadioId);
        }
    });

})();
