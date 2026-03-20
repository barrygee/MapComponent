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
    navigator.geolocation.watchPosition(
        setUserLocation,
        (error) => { console.error('[location] watchPosition error:', error.code, error.message); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
} else {
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
document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        window._FilterPanel.toggle();
    }
});

// ---- 5. Logo animation — loaded via shared/init/logo-animation.js ----
