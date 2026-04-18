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
//
// In SPA mode:
//   window._domainMount()    — called by router on every SDR visit
//   window._domainTeardown() — called by router before leaving SDR
//                              (does NOT stop audio — radio keeps playing)
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
    // ── Restore default sidebar button wiring (called on teardown) ────────────
    function restoreSidebarToggleBtn() {
        const btn = document.getElementById('map-sidebar-btn');
        if (!btn) return;
        const fresh = btn.cloneNode(true);
        btn.parentNode.replaceChild(fresh, btn);
        fresh.addEventListener('click', () => {
            if (window._MapSidebar) window._MapSidebar.toggle();
        });
    }
    // ── WebSocket management ──────────────────────────────────────────────────
    let _reconnectTimer = null;
    let _activeRadioId = null;
    let _radioCache = new Map();
    // Track whether this radio's backend session has been initialised.
    // Stored in sessionStorage so it survives page navigations within the same tab.
    function _markInitialised(radioId) { sessionStorage.setItem(`sdrInit_${radioId}`, '1'); }
    function _isInitialised(radioId) { return sessionStorage.getItem(`sdrInit_${radioId}`) === '1'; }
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
        // POST to ensure the backend TCP connection is open before the WebSocket.
        // No settings are sent so the backend preserves whatever is currently configured.
        try {
            await fetch('/api/sdr/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ radio_id: radioId }),
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
                    // Drive signal bar from spectrum only when actively playing
                    if (window._SdrControls && _sdrPlaying && msg.bins?.length) {
                        let peak = -120;
                        const bins = msg.bins;
                        for (let i = 0; i < bins.length; i++)
                            if (bins[i] > peak)
                                peak = bins[i];
                        window._SdrControls.updateSignalBar(peak);
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
            const lastFreqHz = parseInt(sessionStorage.getItem('sdrLastFreqHz') || '0', 10);
            const lastMode = sessionStorage.getItem('sdrLastMode') || 'AM';
            // Only send radio commands on the very first connect in this browser session.
            // Page navigations reuse the same backend session — sending tune/mode would reset the radio.
            if (!_isInitialised(radioId)) {
                _markInitialised(radioId);
                if (lastFreqHz > 0) {
                    ws.send(JSON.stringify({ cmd: 'tune', frequency_hz: lastFreqHz }));
                    ws.send(JSON.stringify({ cmd: 'mode', mode: lastMode }));
                }
            }
            if (sessionStorage.getItem('sdrPlaying') === '1') {
                _sdrPlaying = true;
                if (window._SdrAudio) {
                    // Set mode before audio starts so demodulation is correct from first frame
                    window._SdrAudio.setMode(lastMode);
                    window._SdrAudio.initAudio(radioId).catch(() => {
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
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
            if (_reconnectTimer)
                clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(() => {
                if (_sdrCurrentRadioId === radioId)
                    void openControlSocket(radioId);
            }, 500);
        });
        ws.addEventListener('error', () => {
            _sdrConnected = false;
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
        });
    }
    // ── Load radios and restore last selection ────────────────────────────────
    const RADIOS_CACHE_KEY = 'sdrRadiosCache';
    function _applyRadios(radios) {
        _radioCache.clear();
        radios.forEach((r) => _radioCache.set(r.id, r));
        if (window._sdrPopulateRadios) {
            window._sdrPopulateRadios(radios);
        }
        const savedRadioId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
        if (savedRadioId > 0) {
            const match = radios.find(r => r.id === savedRadioId && r.enabled);
            if (match) {
                document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId: match.id } }));
            }
        }
    }
    async function loadRadios() {
        // Use cached radio list immediately so the panel populates without a network wait.
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
        if (_activeRadioId != null)
            sessionStorage.removeItem(`sdrInit_${_activeRadioId}`);
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
    // ── Reconnect when page becomes visible (tab switch, Safari BFCache) ──────
    function _reconnectIfNeeded() {
        if (_sdrCurrentRadioId && !_sdrConnected) {
            void openControlSocket(_sdrCurrentRadioId);
        }
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
            _reconnectIfNeeded();
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted)
            _reconnectIfNeeded();
    });

    // ── Per-visit mount: UI setup for each SDR domain entry ──────────────────
    window._domainMount = function () {
        // Build or restore the standalone SDR panel.
        // In SPA mode sdr-panel.js may have loaded while domain was not 'sdr',
        // so buildSdrPanel() was not auto-invoked — call it if not yet built.
        const existingPanel = document.getElementById('sdr-panel');
        if (!existingPanel && typeof buildSdrPanel === 'function') {
            buildSdrPanel();
        } else if (existingPanel) {
            existingPanel.style.display = '';
        }

        hideMapSidebar();
        rewireSidebarToggleBtn();

        // Restore panel visibility
        const panelShouldBeOpen = sessionStorage.getItem('sdrPanelOpen') !== '0';
        if (window._SdrPanel) {
            if (panelShouldBeOpen) {
                window._SdrPanel.show();
            } else {
                window._SdrPanel.hide();
            }
        }

        // Reconnect control socket if a radio was previously selected
        if (_sdrCurrentRadioId && !_sdrConnected) {
            void openControlSocket(_sdrCurrentRadioId);
        }
    };

    // ── Teardown: restore shell state when leaving SDR ────────────────────────
    window._domainTeardown = function () {
        // Show the map sidebar again for other domains
        const sidebar = document.getElementById('map-sidebar');
        if (sidebar) sidebar.style.display = '';

        // Hide the standalone SDR panel (it lives on body, not inside #sdr-root)
        const sdrPanel = document.getElementById('sdr-panel');
        if (sdrPanel) sdrPanel.style.display = 'none';

        // Restore the sidebar toggle button to its default wiring
        restoreSidebarToggleBtn();

        // Mount the SDR radio tab into the map-sidebar RADIO pane for the arriving domain
        // (deferred so body[data-domain] is updated by the router before mount checks it)
        setTimeout(function () {
            if (typeof window._mountSdrRadioTab === 'function') window._mountSdrRadioTab();
        }, 0);

        // Do NOT stop audio — radio keeps playing seamlessly across domains
    };

    // Register with router so repeated visits call the correct handlers
    if (typeof window._registerDomain === 'function') {
        window._registerDomain('sdr', window._domainMount, window._domainTeardown);
    }

    // ── One-time setup on first SDR visit ─────────────────────────────────────
    loadRadios();
    loadFrequencies();

    // Mount UI for this first visit
    window._domainMount();
})();
