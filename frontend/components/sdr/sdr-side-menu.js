"use strict";
// ============================================================
// SDR SIDE MENU
// Collapsible right-side overlay control panel for the SDR domain.
// Follows the exact same pattern as space-side-menu.ts.
//
// Groups:
//   Toggle — expand/collapse
//   Actions — SCAN, LOCK
//   Bookmarks — ADD FREQ
//   Settings — open settings panel
// ============================================================
/// <reference path="./globals.d.ts" />
(function buildSdrSideMenu() {
    let expanded = false;
    const panel = document.createElement('div');
    panel.id = 'sdr-side-menu';
    function makeGroup(id) {
        const g = document.createElement('div');
        g.className = 'sm-group';
        g.id = id;
        return g;
    }
    // ── SVG icons ─────────────────────────────────────────────────────────────
    const EXPAND_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 3L5 6L8 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    const SCAN_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/>
        <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
    </svg>`;
    const LOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    const ADD_FREQ_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M7 20h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2"/>
    </svg>`;
    const SETTINGS_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M17.66 6.34l1.41-1.41M4.93 19.07l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
    // ── Make button helper ────────────────────────────────────────────────────
    function makeBtn(id, icon, label, tooltip) {
        const btn = document.createElement('button');
        btn.className = 'sm-btn';
        btn.id = id;
        btn.dataset.tooltip = tooltip;
        btn.innerHTML = `<span class="sm-icon">${icon}</span><span class="sm-label">${label}</span>`;
        return btn;
    }
    // ── Groups ────────────────────────────────────────────────────────────────
    // Group: toggle
    const gToggle = makeGroup('ssdr-group-toggle');
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'sdr-side-menu-toggle';
    toggleBtn.dataset.tooltip = 'Expand';
    toggleBtn.innerHTML = EXPAND_SVG;
    gToggle.appendChild(toggleBtn);
    // Group: scan + lock
    const gActions = makeGroup('ssdr-group-actions');
    const btnScan = makeBtn('ssdr-btn-scan', SCAN_SVG, 'SCAN', 'Toggle scan');
    const btnLock = makeBtn('ssdr-btn-lock', LOCK_SVG, 'LOCK', 'Lock frequency');
    gActions.appendChild(btnScan);
    gActions.appendChild(btnLock);
    // Group: add freq
    const gBookmarks = makeGroup('ssdr-group-bookmarks');
    const btnAddFreq = makeBtn('ssdr-btn-add-freq', ADD_FREQ_SVG, 'ADD FREQ', 'Save current frequency');
    gBookmarks.appendChild(btnAddFreq);
    // Group: settings
    const gSettings = makeGroup('ssdr-group-settings');
    const btnSettings = makeBtn('ssdr-btn-settings', SETTINGS_SVG, 'SETTINGS', 'Open settings');
    gSettings.appendChild(btnSettings);
    panel.appendChild(gToggle);
    panel.appendChild(gActions);
    panel.appendChild(gBookmarks);
    panel.appendChild(gSettings);
    document.body.appendChild(panel);
    // ── Toggle expand/collapse ────────────────────────────────────────────────
    function setExpanded(v) {
        expanded = v;
        panel.classList.toggle('expanded', v);
        toggleBtn.dataset.tooltip = v ? 'Collapse' : 'Expand';
        toggleBtn.innerHTML = v
            ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 3L7 6L4 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
            : EXPAND_SVG;
    }
    toggleBtn.addEventListener('click', () => setExpanded(!expanded));
    // ── Scan toggle ───────────────────────────────────────────────────────────
    btnScan.addEventListener('click', () => {
        if (_sdrScanActive) {
            // Stop scan
            _sdrScanActive = false;
            btnScan.classList.remove('active');
            if (window._SdrPanel)
                window._SdrPanel.setScanStatus(false, null);
            // Trigger stop in panel
            const stopBtn = document.getElementById('sdr-scan-stop');
            if (stopBtn)
                stopBtn.click();
        }
        else {
            // Start scan
            btnScan.classList.add('active');
            const startBtn = document.getElementById('sdr-scan-start');
            if (startBtn)
                startBtn.click();
        }
    });
    // ── Lock frequency ────────────────────────────────────────────────────────
    btnLock.addEventListener('click', () => {
        _sdrScanLocked = !_sdrScanLocked;
        btnLock.classList.toggle('active', _sdrScanLocked);
        btnLock.dataset.tooltip = _sdrScanLocked ? 'Unlock frequency' : 'Lock frequency';
    });
    // ── Add frequency ─────────────────────────────────────────────────────────
    btnAddFreq.addEventListener('click', async () => {
        if (!_sdrCurrentFreqHz)
            return;
        const label = prompt(`Save frequency ${(_sdrCurrentFreqHz / 1e6).toFixed(4)} MHz\n\nEnter a label:`);
        if (!label)
            return;
        try {
            await fetch('/api/sdr/frequencies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label,
                    frequency_hz: _sdrCurrentFreqHz,
                    mode: _sdrCurrentMode,
                    squelch: _sdrCurrentSquelch,
                    gain: _sdrCurrentGain,
                    scannable: true,
                }),
            });
            // Refresh panel
            if (window._sdrPanelReload)
                window._sdrPanelReload();
        }
        catch (_) { }
    });
    // ── Settings ──────────────────────────────────────────────────────────────
    btnSettings.addEventListener('click', () => {
        // Open the shared settings panel if available
        const settingsBtn = document.querySelector('#settings-btn, [data-action="settings"]');
        if (settingsBtn)
            settingsBtn.click();
    });
})();
