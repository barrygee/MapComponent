"use strict";
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
    // On the SDR page, sdr-boot.js handles the full panel.
    // We still run here to expose window._sdrLoadRadios, but skip socket management.
    const _isSdrDomain = () => document.body.dataset['domain'] === 'sdr';
    let _reconnectTimer = null;
    let _activeRadioId = null;
    let _radioCache = new Map();
    let _dataConfirmed = false;
    // Track whether this radio's backend session has been initialised.
    // Stored in sessionStorage so it survives page navigations within the same tab.
    function _markInitialised(radioId) { sessionStorage.setItem(`sdrInit_${radioId}`, '1'); }
    function _isInitialised(radioId) { return sessionStorage.getItem(`sdrInit_${radioId}`) === '1'; }
    function dispatchSignal(dbfs) {
        document.dispatchEvent(new CustomEvent('sdr-mini:signal', { detail: dbfs }));
    }
    function dispatchConnected(on) {
        document.dispatchEvent(new CustomEvent('sdr-mini:connected', { detail: on }));
    }
    async function openControlSocket(radioId) {
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
        if (_activeRadioId === radioId && _sdrSocket &&
            (_sdrSocket.readyState === WebSocket.CONNECTING || _sdrSocket.readyState === WebSocket.OPEN)) {
            return;
        }
        if (_sdrSocket) {
            _sdrSocket.close();
            _sdrSocket = null;
        }
        _activeRadioId = radioId;
        _sdrCurrentRadioId = radioId;
        sessionStorage.setItem('sdrLastRadioId', String(radioId));
        // Read saved settings — used for WS-level commands on first connect only
        let savedSettings = {};
        try {
            const raw = sessionStorage.getItem('sdrSettings');
            if (raw)
                savedSettings = JSON.parse(raw);
        }
        catch (_e) { }
        // POST to ensure the backend TCP connection is open before the WebSocket.
        // No settings are sent so the backend preserves whatever is currently configured.
        try {
            await fetch('/api/sdr/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ radio_id: radioId }),
            });
        }
        catch (_e) { /* non-fatal */ }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}`);
        _sdrSocket = ws;
        _dataConfirmed = false;
        ws.addEventListener('message', (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            switch (msg.type) {
                case 'status':
                    if (window._SdrAudio)
                        window._SdrAudio.setMode(msg.mode);
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
                    if (msg.bins?.length) {
                        let peak = -120;
                        const bins = msg.bins;
                        for (let i = 0; i < bins.length; i++)
                            if (bins[i] > peak)
                                peak = bins[i];
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
            const lastFreqHz = savedSettings.freqHz || parseInt(sessionStorage.getItem('sdrLastFreqHz') || '0', 10);
            const lastMode = savedSettings.mode || sessionStorage.getItem('sdrLastMode') || 'AM';
            // Only send radio commands on the very first connect in this browser session.
            // Page navigations reuse the same backend session — sending tune/mode would reset the radio.
            const isFirstConnect = !_isInitialised(radioId);
            if (isFirstConnect) {
                _markInitialised(radioId);
                if (lastFreqHz > 0)
                    ws.send(JSON.stringify({ cmd: 'tune', frequency_hz: lastFreqHz }));
                ws.send(JSON.stringify({ cmd: 'mode', mode: lastMode }));
                const gainAuto = savedSettings.gainAuto ?? false;
                const gainDb = savedSettings.gainDb ?? 30.0;
                ws.send(JSON.stringify({ cmd: 'gain', gain_db: gainAuto ? null : gainDb }));
                if (savedSettings.squelch != null)
                    ws.send(JSON.stringify({ cmd: 'squelch', squelch_dbfs: savedSettings.squelch }));
                if (savedSettings.bwHz != null)
                    ws.send(JSON.stringify({ cmd: 'sample_rate', rate_hz: savedSettings.bwHz }));
            }
            if (sessionStorage.getItem('sdrPlaying') === '1') {
                _sdrPlaying = true;
                if (window._SdrAudio) {
                    // Set mode and squelch before audio starts so demodulation is correct from first frame
                    window._SdrAudio.setMode(lastMode);
                    const bwHz = savedSettings.bwHz ?? parseInt(sessionStorage.getItem('sdrSettings') && JSON.parse(sessionStorage.getItem('sdrSettings')).bwHz || '200000', 10);
                    if (bwHz)
                        window._SdrAudio.setBandwidthHz(bwHz);
                    if (savedSettings.squelch != null)
                        window._SdrAudio.setSquelch(savedSettings.squelch);
                    window._SdrAudio.initAudio(radioId).catch(() => {
                        // Autoplay blocked — IQ socket still opens, audio needs user gesture
                        if (window._SdrAudio)
                            window._SdrAudio.start(radioId);
                    });
                }
            }
            else {
                if (window._SdrAudio)
                    window._SdrAudio.start(radioId);
            }
        });
        ws.addEventListener('close', () => {
            _sdrConnected = false;
            _dataConfirmed = false;
            dispatchConnected(false);
            if (_reconnectTimer)
                clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(() => {
                if (_sdrCurrentRadioId === radioId)
                    void openControlSocket(radioId);
            }, 500);
        });
        ws.addEventListener('error', () => {
            _sdrConnected = false;
            _dataConfirmed = false;
            dispatchConnected(false);
        });
    }
    // ── Radio selection events (fired by mini player when user hits play) ─────
    document.addEventListener('sdr-radio-selected', (e) => {
        if (_isSdrDomain()) return; // sdr-boot.js handles this on the SDR page
        const { radioId } = e.detail;
        if (radioId)
            void openControlSocket(radioId);
    });
    document.addEventListener('sdr-radio-deselected', () => {
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
        if (_sdrSocket) {
            _sdrSocket.close();
            _sdrSocket = null;
        }
        if (_activeRadioId != null)
            sessionStorage.removeItem(`sdrInit_${_activeRadioId}`);
        _activeRadioId = null;
        _sdrCurrentRadioId = null;
        sessionStorage.removeItem('sdrLastRadioId');
        if (window._SdrAudio)
            window._SdrAudio.stop();
        dispatchConnected(false);
    });
    // ── Load radios and restore last selection ────────────────────────────────
    const RADIOS_CACHE_KEY = 'sdrRadiosCache';
    function _applyRadios(radios) {
        _radioCache.clear();
        radios.forEach((r) => _radioCache.set(r.id, r));
        if (window._sdrPopulateRadios) {
            window._sdrPopulateRadios(radios);
        }
        if (_isSdrDomain()) return; // sdr-boot.js manages connections on the SDR page
        const savedId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
        if (savedId > 0) {
            const match = radios.find(r => r.id === savedId && r.enabled);
            if (match && _sdrCurrentRadioId !== match.id) {
                _sdrCurrentRadioId = match.id;
                void openControlSocket(match.id);
            }
        }
        else if (radios.length > 0) {
            const first = radios.find(r => r.enabled);
            if (first && !_sdrCurrentRadioId) {
                _sdrCurrentRadioId = first.id;
                _radioCache.set(first.id, first);
            }
        }
    }
    async function loadRadios() {
        // Use cached radio list immediately so the panel and connection start without
        // waiting for a network round-trip on every page navigation.
        try {
            const cached = sessionStorage.getItem(RADIOS_CACHE_KEY);
            if (cached) {
                _applyRadios(JSON.parse(cached));
            }
        }
        catch (_e) { }
        // Fetch fresh list in the background and update if anything changed.
        try {
            const res = await fetch('/api/sdr/radios');
            const radios = await res.json();
            sessionStorage.setItem(RADIOS_CACHE_KEY, JSON.stringify(radios));
            _applyRadios(radios);
        }
        catch (e) {
            console.warn('[SDR mini] Could not load radios:', e);
        }
    }
    // Expose so sdr-radio-tab can call after the panel is mounted
    window._sdrLoadRadios = loadRadios;
    // ── Reconnect when page becomes visible (navigation, tab switch, Safari BFCache) ──
    function _reconnectIfNeeded() {
        if (_sdrCurrentRadioId && !_sdrConnected) {
            void openControlSocket(_sdrCurrentRadioId);
        }
    }
    document.addEventListener('visibilitychange', () => {
        if (_isSdrDomain()) return;
        if (document.visibilityState === 'visible')
            _reconnectIfNeeded();
    });
    // pageshow fires on Safari after BFCache restore where visibilitychange may not fire
    window.addEventListener('pageshow', (e) => {
        if (e.persisted)
            _reconnectIfNeeded();
    });
})();
