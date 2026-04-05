"use strict";
// ============================================================
// SDR BOOT
// Final initialisation — runs after all other SDR scripts are loaded.
// Responsibilities:
//   1. Hide the shared #map-sidebar (not used on SDR page)
//   2. Re-wire #map-sidebar-btn to toggle the SDR panel
//   3. Load available radios, populate the panel dropdown, restore last selection
//   4. Load stored frequencies and groups into the panel
//   5. Open WebSocket when a radio is selected
//   6. Route incoming WebSocket messages to controls + audio
// ============================================================
/// <reference path="./globals.d.ts" />
(function sdrBoot() {
    // ── Hide the shared map sidebar ───────────────────────────────────────────
    function hideMapSidebar() {
        const sidebar = document.getElementById('map-sidebar');
        if (sidebar) {
            sidebar.style.display = 'none';
        }
        else {
            setTimeout(hideMapSidebar, 50);
        }
    }
    hideMapSidebar();
    // ── Re-wire the footer sidebar toggle button ──────────────────────────────
    function rewireSidebarToggleBtn() {
        const btn = document.getElementById('map-sidebar-btn');
        if (!btn) {
            setTimeout(rewireSidebarToggleBtn, 100);
            return;
        }
        // Replace to remove any existing listeners
        const fresh = btn.cloneNode(true);
        btn.parentNode.replaceChild(fresh, btn);
        fresh.addEventListener('click', () => {
            window._SdrPanel.toggle();
            fresh.classList.toggle('msb-btn-active', window._SdrPanel.isVisible());
        });
        fresh.classList.toggle('msb-btn-active', window._SdrPanel.isVisible());
    }
    rewireSidebarToggleBtn();
    // ── WebSocket management ──────────────────────���───────────────────────────
    let _reconnectTimer = null;
    let _activeRadioId = null;
    let _radioCache = new Map();
    async function openControlSocket(radioId) {
        if (_reconnectTimer) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
        // Don't open a duplicate socket for the same radio
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
        // POST stored defaults to configure the backend connection before opening the WebSocket
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
        catch (_e) { /* non-fatal — WS will still attempt connection */ }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}`);
        _sdrSocket = ws;
        let _dataConfirmed = false;
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
                    if (window._SdrControls)
                        window._SdrControls.applyStatus(msg);
                    if (window._SdrAudio)
                        window._SdrAudio.setMode(msg.mode);
                    // Only persist frequency if the user hasn't tuned manually this session
                    if (!sessionStorage.getItem('sdrLastFreqHz') || !_sdrCurrentFreqHz) {
                        sessionStorage.setItem('sdrLastFreqHz', String(msg.center_hz));
                    }
                    sessionStorage.setItem('sdrLastMode', msg.mode);
                    break;
                case 'spectrum':
                    // Only mark connected once real data arrives from the device
                    if (!_dataConfirmed) {
                        _dataConfirmed = true;
                        if (window._SdrControls)
                            window._SdrControls.setStatus(true);
                    }
                    break;
                case 'error':
                    console.warn('[SDR] error', msg.code, msg.message);
                    _dataConfirmed = false;
                    if (window._SdrControls)
                        window._SdrControls.setStatus(false);
                    if (msg.code === 'CONNECT_FAILED') {
                        console.error(`[SDR] Cannot reach rtl_tcp — check host/port in Settings. ${msg.message}`);
                    }
                    break;
                case 'pong':
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
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
            if (_reconnectTimer)
                clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(() => {
                if (_sdrCurrentRadioId === radioId)
                    void openControlSocket(radioId);
            }, 3000);
        });
        ws.addEventListener('error', () => {
            _sdrConnected = false;
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
        });
    }
    // ── Load radios and restore last selection ────────────────────────────────
    async function loadRadios() {
        try {
            const res = await fetch('/api/sdr/radios');
            const radios = await res.json();
            _radioCache.clear();
            radios.forEach((r) => _radioCache.set(r.id, r));
            if (window._sdrPopulateRadios) {
                window._sdrPopulateRadios(radios);
            }
            // Restore last selected radio from sessionStorage
            const savedRadioId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
            if (savedRadioId > 0) {
                const match = radios.find(r => r.id === savedRadioId && r.enabled);
                if (match) {
                    document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId: match.id } }));
                }
            }
        }
        catch (e) {
            console.warn('[SDR] Could not load radios:', e);
        }
    }
    // ── Reload radios when the settings panel changes the device list ─────────
    document.addEventListener('sdr:radios-changed', loadRadios);
    // ── Listen for radio selection / deselection ──────────────────────────────
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
        if (window._SdrControls)
            window._SdrControls.setStatus(false);
    });
    // ── Load stored frequencies and groups into the panel ─────────────────────
    async function loadFrequencies() {
        try {
            const [groupsRes, freqsRes] = await Promise.all([
                fetch('/api/sdr/groups'),
                fetch('/api/sdr/frequencies'),
            ]);
            const groups = await groupsRes.json();
            const freqs = await freqsRes.json();
            if (window._SdrPanel)
                window._SdrPanel.refresh(groups, freqs);
        }
        catch (e) {
            console.warn('[SDR] Could not load frequencies:', e);
        }
    }
    // ── Panel initial visibility ───────────────────────────────────────────────
    const panelShouldBeOpen = sessionStorage.getItem('sdrPanelOpen') !== '0';
    if (panelShouldBeOpen) {
        window._SdrPanel.show();
    }
    else {
        window._SdrPanel.hide();
    }
    // ── Page visibility — reconnect if socket dropped while hidden ────────────
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _sdrCurrentRadioId && !_sdrConnected) {
            openControlSocket(_sdrCurrentRadioId);
        }
    });
    // ── Boot sequence ─────────────────────────────────────────────────────────
    loadRadios();
    loadFrequencies();
})();
