"use strict";
// ============================================================
// SDR BOOT
// Final initialisation — runs after all other SDR scripts are loaded.
// Responsibilities:
//   1. Hide the shared #map-sidebar (not used on SDR page)
//   2. Re-wire #map-sidebar-btn to toggle the SDR panel
//   3. Load available radios and populate the controls select
//   4. Load stored frequencies and groups into the panel
//   5. Restore last active radio+frequency from sessionStorage
//   6. Open WebSocket when a radio is selected
//   7. Route incoming WebSocket messages to display + controls
// ============================================================
/// <reference path="./globals.d.ts" />
(function sdrBoot() {
    // ── Hide the shared map sidebar ───────────────────────────────────────────
    function hideMsbOnce() {
        const msb = document.getElementById('map-sidebar');
        if (msb) {
            msb.style.display = 'none';
        }
        else {
            setTimeout(hideMsbOnce, 50);
        }
    }
    hideMsbOnce();
    // ── Re-wire the footer sidebar toggle button ──────────────────────────────
    function rewireSidebarBtn() {
        const btn = document.getElementById('map-sidebar-btn');
        if (!btn) {
            setTimeout(rewireSidebarBtn, 100);
            return;
        }
        // Remove existing listeners by cloning
        const clone = btn.cloneNode(true);
        btn.parentNode.replaceChild(clone, btn);
        clone.addEventListener('click', () => {
            window._SdrPanel.toggle();
            clone.classList.toggle('msb-btn-active', window._SdrPanel.isVisible());
        });
        // Reflect initial state
        clone.classList.toggle('msb-btn-active', window._SdrPanel.isVisible());
    }
    rewireSidebarBtn();
    // ── WebSocket management ──────────────────────────────────────────────────
    let _reconnectTimer = null;
    let _currentRadioId = null;
    function openSocket(radioId) {
        if (_sdrSocket) {
            _sdrSocket.close();
            _sdrSocket = null;
        }
        _currentRadioId = radioId;
        _sdrCurrentRadioId = radioId;
        sessionStorage.setItem('sdrLastRadioId', String(radioId));
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/sdr/${radioId}`);
        _sdrSocket = ws;
        // Show the display area as active
        const content = document.getElementById('sdr-content');
        if (content)
            content.classList.remove('sdr-no-signal');
        ws.addEventListener('message', (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            // Forward all non-spectrum messages to the test log
            const log = window._sdrTestLog;
            if (log && msg.type !== 'spectrum') {
                log(`← ${JSON.stringify(msg)}`, msg.type === 'error' ? 'err' : 'ok');
            }
            switch (msg.type) {
                case 'spectrum':
                    if (window._SdrDisplay)
                        window._SdrDisplay.renderFrame(msg);
                    if (window._SdrAudio)
                        window._SdrAudio.pushFrame(msg);
                    break;
                case 'status':
                    if (window._SdrControls)
                        window._SdrControls.applyStatus(msg);
                    if (window._SdrDisplay)
                        window._SdrDisplay.setFreqMarker(msg.center_hz);
                    if (window._SdrAudio)
                        window._SdrAudio.setMode(msg.mode);
                    sessionStorage.setItem('sdrLastFreqHz', String(msg.center_hz));
                    sessionStorage.setItem('sdrLastMode', msg.mode);
                    break;
                case 'error':
                    console.warn('[SDR] error', msg.code, msg.message);
                    if (window._SdrControls)
                        window._SdrControls.setStatus(false);
                    break;
                case 'pong':
                    break;
            }
        });
        ws.addEventListener('open', () => {
            _sdrConnected = true;
            if (window._SdrControls)
                window._SdrControls.setStatus(true);
            if (window._SdrAudio)
                window._SdrAudio.start(radioId); // opens IQ socket only
            // Restore last frequency if available
            const lastHz = parseInt(sessionStorage.getItem('sdrLastFreqHz') || '0', 10);
            const lastMode = sessionStorage.getItem('sdrLastMode') || 'AM';
            if (lastHz > 0) {
                ws.send(JSON.stringify({ cmd: 'tune', frequency_hz: lastHz }));
                ws.send(JSON.stringify({ cmd: 'mode', mode: lastMode }));
            }
        });
        ws.addEventListener('close', () => {
            _sdrConnected = false;
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
            // Auto-reconnect after 3s if the radio selection hasn't changed
            if (_reconnectTimer)
                clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(() => {
                if (_sdrCurrentRadioId === radioId) {
                    openSocket(radioId);
                }
            }, 3000);
        });
        ws.addEventListener('error', () => {
            _sdrConnected = false;
            if (window._SdrControls)
                window._SdrControls.setStatus(false);
        });
    }
    // ── Load radios ───────────────────────────────────────────────────────────
    async function loadRadios() {
        try {
            const res = await fetch('/api/sdr/radios');
            const radios = await res.json();
            if (window._sdrPopulateRadios) {
                window._sdrPopulateRadios(radios);
            }
            // Auto-select last used radio
            const lastId = parseInt(sessionStorage.getItem('sdrLastRadioId') || '0', 10);
            const match = radios.find(r => r.id === lastId && r.enabled);
            if (match) {
                const sel = document.getElementById('sdr-radio-select');
                if (sel)
                    sel.value = String(match.id);
                openSocket(match.id);
            }
        }
        catch (e) {
            console.warn('[SDR] Could not load radios:', e);
        }
    }
    // ── Listen for radio selection change ─────────────────────────────────────
    document.addEventListener('sdr-radio-selected', (e) => {
        const detail = e.detail;
        if (detail.radioId)
            openSocket(detail.radioId);
    });
    // ── Load stored frequencies into panel ────────────────────────────────────
    async function loadFrequencies() {
        try {
            const [gRes, fRes] = await Promise.all([
                fetch('/api/sdr/groups'),
                fetch('/api/sdr/frequencies'),
            ]);
            const groups = await gRes.json();
            const freqs = await fRes.json();
            if (window._SdrPanel)
                window._SdrPanel.refresh(groups, freqs);
        }
        catch (e) {
            console.warn('[SDR] Could not load frequencies:', e);
        }
    }
    // ── Panel initial state ───────────────────────────────────────────────────
    const panelOpen = sessionStorage.getItem('sdrPanelOpen') !== '0';
    if (panelOpen) {
        window._SdrPanel.show();
    }
    else {
        window._SdrPanel.hide();
    }
    // Show no-signal placeholder until first frame arrives
    const content = document.getElementById('sdr-content');
    if (content)
        content.classList.add('sdr-no-signal');
    // ── Page visibility — pause/resume data stream ────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && _sdrCurrentRadioId && !_sdrConnected) {
            openSocket(_sdrCurrentRadioId);
        }
    });
    // Audio is started manually via the AUDIO button in sdr-controls
    // ── Boot sequence ─────────────────────────────────────────────────────────
    loadRadios();
    loadFrequencies();
})();
