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
    let _reconnectTimer = null;
    let _activeRadioId = null;
    let _radioCache = new Map();
    let _dataConfirmed = false;
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
        const cfg = _radioCache.get(radioId);
        try {
            await fetch('/api/sdr/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    radio_id: radioId,
                    gain_db: cfg?.rf_gain ?? 30.0,
                    gain_auto: cfg?.agc ?? false,
                    sample_rate: cfg?.bandwidth ?? 2048000,
                }),
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
            if (window._SdrAudio)
                window._SdrAudio.start(radioId);
            const lastFreqHz = parseInt(sessionStorage.getItem('sdrLastFreqHz') || '0', 10);
            const lastMode = sessionStorage.getItem('sdrLastMode') || 'AM';
            if (lastFreqHz > 0) {
                ws.send(JSON.stringify({ cmd: 'tune', frequency_hz: lastFreqHz }));
                ws.send(JSON.stringify({ cmd: 'mode', mode: lastMode }));
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
            }, 3000);
        });
        ws.addEventListener('error', () => {
            _sdrConnected = false;
            _dataConfirmed = false;
            dispatchConnected(false);
        });
    }
    // ── Radio selection events (fired by mini player when user hits play) ─────
    document.addEventListener('sdr-radio-selected', (e) => {
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
        _activeRadioId = null;
        _sdrCurrentRadioId = null;
        sessionStorage.removeItem('sdrLastRadioId');
        if (window._SdrAudio)
            window._SdrAudio.stop();
        dispatchConnected(false);
    });
    // ── Load radios and restore last selection ────────────────────────────────
    async function loadRadios() {
        try {
            const res = await fetch('/api/sdr/radios');
            const radios = await res.json();
            _radioCache.clear();
            radios.forEach((r) => _radioCache.set(r.id, r));
            // Auto-select last used radio so the mini player works immediately
            const savedId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
            if (savedId > 0) {
                const match = radios.find(r => r.id === savedId && r.enabled);
                if (match) {
                    _radioCache.set(match.id, match);
                    // Don't auto-connect — wait for user to press play
                    _sdrCurrentRadioId = match.id;
                }
            }
            else if (radios.length > 0) {
                // Fall back to first enabled radio
                const first = radios.find(r => r.enabled);
                if (first) {
                    _sdrCurrentRadioId = first.id;
                    _radioCache.set(first.id, first);
                }
            }
            if (window._SdrMiniPlayer?.populateRadios) {
                window._SdrMiniPlayer.populateRadios(radios);
            }
        }
        catch (e) {
            console.warn('[SDR mini] Could not load radios:', e);
        }
    }
    // ── Reconnect on tab focus if socket dropped ──────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _sdrCurrentRadioId && !_sdrConnected) {
            void openControlSocket(_sdrCurrentRadioId);
        }
    });
    loadRadios();
})();
