// ============================================================
// SPACE BOOT / PAGE INITIALISATION
// The final script in the space page load order.
//
// Responsibilities:
//   1. Start the GPS watchPosition watcher
//   2. Initialise shared notification panel
//   3. Play the SENTINEL logo animation
// ============================================================

/// <reference path="../globals.d.ts" />

// ---- 1. GPS watcher ----
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        setSpaceUserLocation,
        (error) => { console.error('[space/location] watchPosition error:', error.code, error.message); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
} else {
    console.warn('[space/location] geolocation not available in navigator');
}

// ---- 1b. No-TLE overlay button ----
(function () {
    const btn = document.getElementById('no-tle-overlay-btn');
    if (btn) {
        btn.addEventListener('click', function () {
            if (window._SettingsPanel && window._SettingsPanel.openSection) {
                window._SettingsPanel.openSection('space');
            } else if (window._SettingsPanel) {
                window._SettingsPanel.open();
            }
        });
    }
})();

// ---- 2. Panel initialisation ----
if (typeof window._Notifications !== 'undefined') {
    window._Notifications.init();
}
if (typeof window._Tracking !== 'undefined') {
    window._Tracking.init();
}
if (typeof window._SpaceFilterPanel !== 'undefined') {
    window._SpaceFilterPanel.init();
}

// ---- 2b. Sync space overlay states from backend (after controls are ready) ----
map.once('load', function () {
    if (typeof _syncSpaceOverlayStatesFromBackend === 'function') {
        _syncSpaceOverlayStatesFromBackend();
    }
});

// ---- 3. Logo animation — loaded via shared/init/logo-animation.js ----
