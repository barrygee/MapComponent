"use strict";
// ============================================================
// SHARED DOMAIN BOOT — sea / land / (also loaded by air)
//
// Exposes:
//   window._domainMount()    — called by router on every visit
//   window._domainTeardown() — called by router before leaving
//
// Dependencies: window._Notifications, window._Tracking
// ============================================================

// ---- Logo animation — runs once on initial shell load ----
(function () {
    if (window._logoAnimationRegistered) return;
    window._logoAnimationRegistered = true;

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

// ---- No-URL overlay check (runs per domain mount) ----
// Exposed on window so sea/land handlers in router.js can call it on repeat visits.
window._runNoUrlCheck = function _runNoUrlCheck(ns) {
    const overlay = document.getElementById('no-url-overlay');
    const msgEl   = document.getElementById('no-url-overlay-msg');
    const btn     = document.getElementById('no-url-overlay-btn');
    if (!overlay || !msgEl || !btn) return;

    // SDR has no per-domain source settings — skip overlay check
    const DOMAINS_WITH_SOURCES = ['air', 'space', 'sea', 'land'];
    if (!DOMAINS_WITH_SOURCES.includes(ns)) return;

    function _getActiveMode() {
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
                try { localStorage.removeItem(lsKey); } catch (e) {}
                _show();
            } else {
                try { localStorage.setItem(lsKey, mode === 'online' ? backendUrl : JSON.stringify(data['offgridSource'])); } catch (e) {}
                overlay.classList.add('hidden');
            }
        }).catch(function () { _check(); });
    }

    // Wire settings button (guard duplicate).
    // Event listeners use window._runNoUrlCheck with the live domain so they
    // always recheck the domain currently displayed, not the one at wire-time.
    if (!btn._noUrlWired) {
        btn._noUrlWired = true;
        btn.addEventListener('click', function () {
            if (window._SettingsPanel && window._SettingsPanel.openSection) {
                window._SettingsPanel.openSection(btn.dataset.section || document.body.dataset.domain);
            } else if (window._SettingsPanel) {
                window._SettingsPanel.open();
            }
        });
        function _recheckCurrent() {
            var d = document.body.dataset.domain;
            if (d && typeof window._runNoUrlCheck === 'function') window._runNoUrlCheck(d);
        }
        window.addEventListener('sentinel:connectivityModeChanged', _recheckCurrent);
        window.addEventListener('sentinel:sourceOverrideChanged', _recheckCurrent);
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') setTimeout(_recheckCurrent, 100);
        });
        document.addEventListener('click', function (e) {
            if (e.target && e.target.id === 'settings-apply-btn') setTimeout(_recheckCurrent, 100);
        });
    }

    _checkWithBackend();
};

// If a domain boot already set _domainMount (e.g. air/boot.js), compose with it.
// Otherwise define it fresh (sea/land have no other boot).
(function () {
    const _prevMount = typeof window._domainMount === 'function' ? window._domainMount : null;
    const _prevTeardown = typeof window._domainTeardown === 'function' ? window._domainTeardown : null;

    window._domainMount = function () {
        if (_prevMount) _prevMount();
        const ns = document.body.dataset.domain;
        // Only init notifications/tracking if prev mount didn't already do it
        if (!_prevMount) {
            if (typeof window._Notifications !== 'undefined') window._Notifications.init();
            if (typeof window._Tracking !== 'undefined') window._Tracking.init();
        }
        if (ns) _runNoUrlCheck(ns);
    };

    window._domainTeardown = function () {
        if (_prevTeardown) _prevTeardown();
        if (window.MapComponent && window.MapComponent.clearStyleLoadCallbacks) {
            window.MapComponent.clearStyleLoadCallbacks();
        }
    };

    // Register the composed handlers for the current domain with the router.
    // Runs once per domain's script load — captures air+template compose for air,
    // or the fresh template-only functions for sea/land.
    if (typeof window._registerDomain === 'function') {
        var _d = document.body.dataset.domain;
        if (_d) window._registerDomain(_d, window._domainMount, window._domainTeardown);
    }

    // Self-call only for domains with no prior boot (sea/land).
    // For air, boot.js already self-called _domainMount(); calling again would double-mount.
    if (!_prevMount) {
        window._domainMount();
    }
})();
