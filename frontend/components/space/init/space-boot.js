"use strict";
// ============================================================
// SPACE BOOT / PAGE INITIALISATION
// The final script in the space page load order.
//
// Responsibilities:
//   1. Start the GPS watchPosition watcher
//   2. Initialise shared notification panel
//   3. Play the SENTINEL logo animation
// ============================================================

// ---- 1. GPS watcher ----
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        setSpaceUserLocation,
        function (error) { console.error('[space/location] watchPosition error:', error.code, error.message); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
    );
} else {
    console.warn('[space/location] geolocation not available in navigator');
}

// ---- 2. Panel initialisation ----
if (typeof window._Notifications !== 'undefined') {
    window._Notifications.init();
}

// ---- 2b. Sync space overlay states from backend (after controls are ready) ----
map.once('load', function () {
    if (typeof _syncSpaceOverlayStatesFromBackend === 'function') {
        _syncSpaceOverlayStatesFromBackend();
    }
});

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
