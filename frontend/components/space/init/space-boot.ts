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
if (typeof window._MapSidebar !== 'undefined') {
    window._MapSidebar.init({ trackingEmptyText: 'No tracked satellites' });
}
if (typeof window._Notifications !== 'undefined') {
    window._Notifications.init();
}
if (typeof window._Tracking !== 'undefined') {
    window._Tracking.init();
}
if (typeof window._SpaceFilterPanel !== 'undefined') {
    window._SpaceFilterPanel.init();
}
if (typeof window._SpacePassesPanel !== 'undefined') {
    window._SpacePassesPanel.init();
}
if (typeof window._SatInfoPanel !== 'undefined') {
    window._SatInfoPanel.init();
}

// ---- 2b. Sync space overlay states from backend (after controls are ready) ----
map.once('load', function () {
    if (typeof _syncSpaceOverlayStatesFromBackend === 'function') {
        _syncSpaceOverlayStatesFromBackend();
    }
});

// ---- 3. Logo animation — loaded via shared/init/logo-animation.js ----

// ---- 4. Starfield backdrop ----
(function () {
    const canvas = document.getElementById('space-starfield') as HTMLCanvasElement | null;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Star { x: number; y: number; r: number; a: number; }

    const STAR_COUNT = 320;
    let stars: Star[] = [];
    let W = 0, H = 0;
    // parallax offset driven by map bearing / pitch
    let offsetX = 0, offsetY = 0;

    function _resize(): void {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function _seed(): void {
        stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: Math.random() * 1.1 + 0.2,
                a: Math.random() * 0.55 + 0.15,
            });
        }
    }

    function _draw(): void {
        ctx.clearRect(0, 0, W, H);
        for (const s of stars) {
            const px = ((s.x + offsetX) % W + W) % W;
            const py = ((s.y + offsetY) % H + H) % H;
            ctx.beginPath();
            ctx.arc(px, py, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${s.a})`;
            ctx.fill();
        }
    }

    _resize();
    _seed();
    _draw();

    window.addEventListener('resize', () => { _resize(); _seed(); _draw(); });

    // Shift stars on map move/rotate for parallax effect
    let _lastBearing = 0;
    let _lastCenter: maplibregl.LngLat | null = null;
    map.on('move', () => {
        const bearing = map.getBearing();
        const center  = map.getCenter();
        const db = bearing - _lastBearing;
        const dlng = _lastCenter ? (center.lng - _lastCenter.lng) : 0;
        const dlat = _lastCenter ? (center.lat - _lastCenter.lat) : 0;
        // Bearing change → rotate star field; pan → translate gently
        offsetX += db * 1.4 - dlng * 1.8;
        offsetY += dlat * 1.8;
        _lastBearing = bearing;
        _lastCenter  = center;
        _draw();
    });
})();
