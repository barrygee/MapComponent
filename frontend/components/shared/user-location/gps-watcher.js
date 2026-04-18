"use strict";
// ============================================================
// GPS WATCHER — singleton, loaded once in the shell.
// Fires window event 'sentinel:gpsPosition' on each position update.
// Domain user-location modules listen for this event instead of
// registering their own watchPosition calls.
// ============================================================
(function () {
    if (!('geolocation' in navigator)) {
        console.warn('[GPS] geolocation not available');
        return;
    }
    if (window._gpsWatchId != null) return; // already started
    console.log('[GPS] registering singleton watchPosition');
    window._gpsWatchId = navigator.geolocation.watchPosition(
        function (pos) {
            window.dispatchEvent(new CustomEvent('sentinel:gpsPosition', { detail: pos }));
        },
        function (err) {
            console.error('[GPS] watchPosition error:', err.code, err.message);
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
    );
})();
