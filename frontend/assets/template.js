"use strict";
// ============================================================
// SHARED BOOT — non-air domain pages (SEA / LAND / SPACE)
//
// Responsibilities:
//   1. Initialise notifications and tracking panels
//   2. Play the SENTINEL logo animation
//
// Dependencies: window._Notifications, window._Tracking
// ============================================================

// ---- 1. Panel initialisation ----
window._Notifications.init();
window._Tracking.init();

// ---- 0. No-URL overlay ----
(function () {
    const overlay = document.getElementById('no-url-overlay');
    const msgEl   = document.getElementById('no-url-overlay-msg');
    const btn     = document.getElementById('no-url-overlay-btn');
    if (!overlay || !msgEl || !btn) return;

    const ns = document.body.dataset.domain; // e.g. 'land', 'sea', 'sdr'
    if (!ns) return;

    // SDR has no per-domain source settings — skip overlay check
    const DOMAINS_WITH_SOURCES = ['air', 'space', 'sea', 'land'];
    if (!DOMAINS_WITH_SOURCES.includes(ns)) return;

    function _getActiveMode() {
        // Per-domain override takes priority over app-level mode
        try {
            const override = localStorage.getItem('sentinel_' + ns + '_sourceOverride');
            if (override && override !== 'auto') return override;
        } catch (e) {}
        try {
            return localStorage.getItem('sentinel_app_connectivityMode') || 'online';
        } catch (e) {}
        return 'online';
    }

    function _isPlaceholder(url) {
        const trimmedUrl = url.trim();
        return !trimmedUrl || /^https?:\/\/?$/.test(trimmedUrl) || /^http:\/\/localhost\/?$/.test(trimmedUrl);
    }

    function _hasUrl(mode) {
        try {
            if (mode === 'online') {
                const savedUrl = localStorage.getItem('sentinel_' + ns + '_onlineUrl') || '';
                return savedUrl.length > 0 && !_isPlaceholder(savedUrl);
            } else {
                const raw = localStorage.getItem('sentinel_' + ns + '_offgridSource');
                if (!raw) return false;
                const sourceConfig = JSON.parse(raw);
                const url = (sourceConfig && sourceConfig.url) || '';
                return url.length > 0 && !_isPlaceholder(url);
            }
        } catch (e) {}
        return false;
    }

    function _show() {
        const mode = _getActiveMode();
        const modeLabel = mode === 'online' ? 'Online' : 'Off Grid';
        const settingLabel = mode === 'online' ? 'Online Data Source' : 'Off Grid Data Source';
        msgEl.textContent = modeLabel + ' mode is active but no ' + settingLabel + ' URL has been set for '
            + ns.toUpperCase() + '. Configure a URL in settings or switch connectivity mode to continue.';
        btn.dataset.section = ns;
        overlay.classList.remove('hidden');
    }

    function _check() {
        const mode = _getActiveMode();
        const hasUrl = _hasUrl(mode);

        if (!hasUrl) {
            _show();
        } else {
            overlay.classList.add('hidden');
        }
    }

    function _checkWithBackend() {
        const mode = _getActiveMode();
        if (!window._SettingsAPI) { _check(); return; }
        window._SettingsAPI.getNamespace(ns).then(function (data) {
            if (!data) { _check(); return; }
            var lsKey = mode === 'online'
                ? 'sentinel_' + ns + '_onlineUrl'
                : 'sentinel_' + ns + '_offgridSource';
            var backendUrl = '';
            if (mode === 'online') {
                backendUrl = (data['onlineUrl'] || '') + '';
            } else {
                try {
                    var src = data['offgridSource'];
                    backendUrl = (src && typeof src === 'object' && src.url) ? src.url : '';
                } catch (e) {}
            }
            var backendValid = backendUrl.length > 0 && !_isPlaceholder(backendUrl);
            if (!backendValid) {
                // Backend has no real URL — clear any stale localStorage value and show overlay
                try { localStorage.removeItem(lsKey); } catch (e) {}
                _show();
            } else {
                // Backend has a valid URL — sync to localStorage and hide overlay
                try { localStorage.setItem(lsKey, mode === 'online' ? backendUrl : JSON.stringify(data['offgridSource'])); } catch (e) {}
                overlay.classList.add('hidden');
            }
        }).catch(function () { _check(); });
    }

    btn.addEventListener('click', function () {
        if (window._SettingsPanel && window._SettingsPanel.openSection) {
            window._SettingsPanel.openSection(btn.dataset.section || ns);
        } else if (window._SettingsPanel) {
            window._SettingsPanel.open();
        }
    });

    // Re-check whenever connectivity or source settings change
    window.addEventListener('sentinel:connectivityModeChanged', _check);
    window.addEventListener('sentinel:sourceOverrideChanged', _check);

    // Re-check after settings applied or panel closed
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setTimeout(_check, 100);
    });
    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'settings-apply-btn') setTimeout(_check, 100);
    });

    _checkWithBackend();
})();

// ---- 2. Logo animation ----
(function () {
    const logoSvg = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    if (!logoSvg || !logoTextEl) return;

    let typeTimer = null;
    let blinkTimer = null;

    function playLogoAnimation() {
        if (typeTimer) clearTimeout(typeTimer);
        if (blinkTimer) clearInterval(blinkTimer);
        logoTextEl.textContent = '';

        const corners = logoSvg.querySelectorAll('.logo-corner');
        const bg = logoSvg.querySelector('.logo-bg');
        const dot = logoSvg.querySelector('.logo-dot');
        [...Array.from(corners), bg, dot].forEach(el => {
            if (!el) return;
            el.style.animation = 'none';
            el.getBoundingClientRect();
            el.style.animation = '';
        });

        const WORD = 'SENTINEL';
        let i = 0;

        function typeNextChar() {
            if (i < WORD.length) {
                logoTextEl.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNextChar, 75);
            } else {
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoTextEl.textContent = WORD + (blinks % 2 === 0 ? '|' : ' ');
                    if (blinks >= 6) {
                        clearInterval(blinkTimer);
                        logoTextEl.textContent = WORD;
                    }
                }, 300);
            }
        }

        typeTimer = setTimeout(typeNextChar, 1250);
    }

    playLogoAnimation();
    logoSvg.style.cursor = 'pointer';
    logoSvg.addEventListener('click', playLogoAnimation);
})();
