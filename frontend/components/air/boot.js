// ============================================================
// BOOT / PAGE INITIALISATION
// The final script in the air page load order.
// Runs once all controls and components have been constructed.
//
// Responsibilities:
//   1. Start the GPS watchPosition watcher
//   2. Restore 3D pitch state from localStorage
//   3. Initialise notifications, tracking, and filter panels
//   4. Register the global Ctrl+F / Cmd+F filter shortcut
//   5. Play the SENTINEL logo animation
//
// Dependencies (must be loaded before this file):
//   setUserLocation, _Notifications, _Tracking, _FilterPanel, map (global alias)
// ============================================================

// ---- 1. GPS watcher ----
// navigator.geolocation.watchPosition calls setUserLocation() each time the
// browser gets a new position fix (typically every few seconds).
if ('geolocation' in navigator) {
    console.log('[location] registering watchPosition');
    navigator.geolocation.watchPosition(
        setUserLocation, // success: update marker + range rings + geocode footer
        (error) => { console.error('[location] watchPosition error:', error.code, error.message); },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
    );
} else {
    console.warn('[location] geolocation not available in navigator');
}

// ---- 2. Restore 3D pitch ----
// Applied after the map has fully loaded (tiles rendered), not just style.load.
map.once('load', () => {
    if (typeof window._is3DActive === 'function' && window._is3DActive()) {
        map.easeTo({ pitch: 45, duration: 400 }); // restore persisted tilt
    }
});

// ---- 3. Panel initialisation ----
_Notifications.init(); // render persisted notifications and attach button handlers
_Tracking.init();      // attach tracking toggle button handler
_FilterPanel.init();   // attach filter panel and search input handlers

// ---- 4. Global filter shortcut ----
// Ctrl+F (Windows/Linux) or Cmd+F (Mac) opens the filter panel instead of the browser find bar.
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();        // suppress browser find bar
        _FilterPanel.toggle();
    }
});

// ---- 5. Logo animation ----
// Bracket draw-in (CSS) followed by a typewriter effect (JS) on #logo-text-el.
// Replays on logo click.
(function () {
    const logoSvg    = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    if (!logoSvg || !logoTextEl) return;

    let typeTimer  = null; // setTimeout handle for typewriter steps
    let blinkTimer = null; // setInterval handle for cursor blink

    /**
     * Play the full logo intro animation from the start.
     * Cancels any in-flight timers first so clicking the logo mid-animation restarts cleanly.
     */
    function playLogoAnimation() {
        clearTimeout(typeTimer);
        clearInterval(blinkTimer);
        logoTextEl.textContent = ''; // clear any partial text from a previous run

        // Restart CSS animations on corner brackets, bg pulse, and centre dot
        // by forcing a reflow between removing and restoring the animation property.
        const corners = logoSvg.querySelectorAll('.logo-corner');
        const bg      = logoSvg.querySelector('.logo-bg');
        const dot     = logoSvg.querySelector('.logo-dot');
        [...corners, bg, dot].forEach(el => {
            el.style.animation = 'none';
            el.getBoundingClientRect(); // reflow — forces browser to re-read style
            el.style.animation = '';   // restore original CSS animation
        });

        // Typewriter starts after brackets finish drawing (0.43 s) + 2 bg pulses (2×0.4 s) = ~1.23 s
        const WORD = 'SENTINEL';
        let i = 0;

        function typeNextChar() {
            if (i < WORD.length) {
                // Append next character with a blinking cursor at the end
                logoTextEl.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNextChar, 75); // 75 ms per character
            } else {
                // All characters typed — blink cursor 6 times then hold the final text
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoTextEl.textContent = WORD + (blinks % 2 === 0 ? '|' : ' ');
                    if (blinks >= 6) {
                        clearInterval(blinkTimer);
                        logoTextEl.textContent = WORD; // final resting state
                    }
                }, 300);
            }
        }

        typeTimer = setTimeout(typeNextChar, 1250); // delay until CSS animation finishes
    }

    playLogoAnimation(); // play on page load

    // Allow the user to replay the animation by clicking the logo
    logoSvg.style.cursor = 'pointer';
    logoSvg.addEventListener('click', playLogoAnimation);
})();
