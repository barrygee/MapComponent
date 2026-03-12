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

// ---- 5. Logo animation ----
(function () {
    const logoSvg    = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    if (!logoSvg || !logoTextEl) return;

    let typeTimer:  ReturnType<typeof setTimeout>  | null = null;
    let blinkTimer: ReturnType<typeof setInterval> | null = null;

    function playLogoAnimation(): void {
        if (typeTimer)  clearTimeout(typeTimer);
        if (blinkTimer) clearInterval(blinkTimer);
        logoTextEl!.textContent = '';

        const corners = logoSvg!.querySelectorAll('.logo-corner');
        const bg      = logoSvg!.querySelector('.logo-bg');
        const dot     = logoSvg!.querySelector('.logo-dot');
        [...Array.from(corners), bg, dot].forEach(el => {
            if (!el) return;
            (el as HTMLElement).style.animation = 'none';
            (el as HTMLElement).getBoundingClientRect();
            (el as HTMLElement).style.animation = '';
        });

        const WORD = 'SENTINEL';
        let i = 0;

        function typeNextChar(): void {
            if (i < WORD.length) {
                logoTextEl!.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNextChar, 75);
            } else {
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoTextEl!.textContent = WORD + (blinks % 2 === 0 ? '|' : ' ');
                    if (blinks >= 6) {
                        clearInterval(blinkTimer!);
                        logoTextEl!.textContent = WORD;
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
