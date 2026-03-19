"use strict";
// ============================================================
// BOOT / PAGE INITIALISATION
// The final script in the air page load order.
//
// Responsibilities:
//   1. Start the GPS watchPosition watcher
//   2. Restore 3D pitch state from localStorage
//   3. Initialise notifications, tracking, and filter panels
//   4. Register the global Ctrl+F / Cmd+F filter shortcut
//   5. Play the SENTINEL logo animation
//
// Dependencies: setUserLocation, window._Notifications, window._Tracking,
//               window._FilterPanel, map (global alias)
// ============================================================
/// <reference path="../globals.d.ts" />
// ---- 1. GPS watcher ----
if ('geolocation' in navigator) {
    console.log('[location] registering watchPosition');
    navigator.geolocation.watchPosition(setUserLocation, (error) => { console.error('[location] watchPosition error:', error.code, error.message); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
}
else {
    console.warn('[location] geolocation not available in navigator');
}
// ---- 2. Restore 3D pitch ----
map.once('load', () => {
    if (typeof window._is3DActive === 'function' && window._is3DActive()) {
        map.easeTo({ pitch: 45, duration: 400 });
    }
});
// ---- 3. Panel initialisation ----
window._Notifications.init();
window._Tracking.init();
window._FilterPanel.init();
// ---- No-URL overlay ----
(function () {
    const overlay = document.getElementById('no-url-overlay');
    const msgEl   = document.getElementById('no-url-overlay-msg');
    const btn     = document.getElementById('no-url-overlay-btn');
    if (!overlay || !msgEl || !btn) return;
    const ns = document.body.dataset.domain || 'air';
    function _getActiveMode() {
        try {
            const override = localStorage.getItem('sentinel_' + ns + '_sourceOverride');
            if (override && override !== 'auto') return override;
        } catch (e) {}
        try { return localStorage.getItem('sentinel_app_connectivityMode') || 'online'; } catch (e) {}
        return 'online';
    }
    function _hasUrl(mode) {
        try {
            if (mode === 'online') return !!localStorage.getItem('sentinel_' + ns + '_onlineUrl');
            const raw = localStorage.getItem('sentinel_' + ns + '_offlineSource');
            if (!raw) return false;
            const obj = JSON.parse(raw);
            return !!(obj && obj.url);
        } catch (e) {}
        return false;
    }
    function _check() {
        const mode = _getActiveMode();
        if (!_hasUrl(mode)) {
            const modeLabel = mode === 'online' ? 'Online' : 'Offline';
            const settingLabel = mode === 'online' ? 'Online Data Source' : 'Offline Data Source';
            msgEl.textContent = modeLabel + ' mode is active but no ' + settingLabel + ' URL has been set for '
                + ns.toUpperCase() + '. Configure a URL in settings or switch connectivity mode to continue.';
            overlay.style.display = '';
        } else {
            overlay.style.display = 'none';
        }
    }
    btn.addEventListener('click', function () {
        if (window._SettingsPanel && window._SettingsPanel.openSection) {
            window._SettingsPanel.openSection(ns);
        } else if (window._SettingsPanel) {
            window._SettingsPanel.open();
        }
    });
    window.addEventListener('sentinel:connectivityModeChanged', _check);
    window.addEventListener('sentinel:sourceOverrideChanged', _check);
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') setTimeout(_check, 100); });
    document.addEventListener('click', function (e) { if (e.target && e.target.id === 'settings-apply-btn') setTimeout(_check, 100); });
    _check();
})();
// ---- 4. Global filter shortcut ----
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        window._FilterPanel.toggle();
    }
});
// ---- 5. Logo animation ----
(function () {
    const logoSvg = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    if (!logoSvg || !logoTextEl)
        return;
    let typeTimer = null;
    let blinkTimer = null;
    function playLogoAnimation() {
        if (typeTimer)
            clearTimeout(typeTimer);
        if (blinkTimer)
            clearInterval(blinkTimer);
        logoTextEl.textContent = '';
        const corners = logoSvg.querySelectorAll('.logo-corner');
        const bg = logoSvg.querySelector('.logo-bg');
        const dot = logoSvg.querySelector('.logo-dot');
        [...Array.from(corners), bg, dot].forEach(el => {
            if (!el)
                return;
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
            }
            else {
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
