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
// ---- 0. No-URL overlay ----
(function () {
    const overlay = document.getElementById('no-url-overlay');
    const msgEl   = document.getElementById('no-url-overlay-msg');
    const btn     = document.getElementById('no-url-overlay-btn');
    if (!overlay || !msgEl || !btn) return;

    const ns = document.body.dataset.domain;
    if (!ns) return;

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
        const t = url.trim();
        return !t || /^https?:\/\/?$/.test(t) || /^http:\/\/localhost\/?$/.test(t);
    }

    function _hasUrl(mode) {
        try {
            if (mode === 'online') {
                const val = localStorage.getItem('sentinel_' + ns + '_onlineUrl') || '';
                return val.length > 0 && !_isPlaceholder(val);
            } else {
                const raw = localStorage.getItem('sentinel_' + ns + '_offlineSource');
                if (!raw) return false;
                const obj = JSON.parse(raw);
                const url = (obj && obj.url) || '';
                return url.length > 0 && !_isPlaceholder(url);
            }
        } catch (e) {}
        return false;
    }

    function _show() {
        const mode = _getActiveMode();
        const modeLabel = mode === 'online' ? 'Online' : 'Offline';
        const settingLabel = mode === 'online' ? 'Online Data Source' : 'Offline Data Source';
        msgEl.textContent = modeLabel + ' mode is active but no ' + settingLabel + ' URL has been set for '
            + ns.toUpperCase() + '. Configure a URL in settings or switch connectivity mode to continue.';
        btn.dataset.section = ns;
        overlay.classList.remove('hidden');
    }

    function _check() {
        const mode = _getActiveMode();
        if (!_hasUrl(mode)) {
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
                : 'sentinel_' + ns + '_offlineSource';
            var backendUrl = '';
            if (mode === 'online') {
                backendUrl = (data['onlineUrl'] || '') + '';
            } else {
                try {
                    var src = data['offlineSource'];
                    backendUrl = (src && typeof src === 'object' && src.url) ? src.url : '';
                } catch (e) {}
            }
            var backendValid = backendUrl.length > 0 && !_isPlaceholder(backendUrl);
            if (!backendValid) {
                try { localStorage.removeItem(lsKey); } catch (e) {}
                _show();
            } else {
                try { localStorage.setItem(lsKey, mode === 'online' ? backendUrl : JSON.stringify(data['offlineSource'])); } catch (e) {}
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

    window.addEventListener('sentinel:connectivityModeChanged', _check);
    window.addEventListener('sentinel:sourceOverrideChanged', _check);

    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setTimeout(_check, 100);
    });
    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'settings-apply-btn') setTimeout(_check, 100);
    });

    _checkWithBackend();
})();

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
// ---- 4. Global filter shortcut ----
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        window._FilterPanel.toggle();
    }
});
// ---- 5. Logo animation — loaded via shared/init/logo-animation.js ----
