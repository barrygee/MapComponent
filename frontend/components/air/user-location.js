// ============================================================
// USER LOCATION MARKER
// Animated SVG marker showing the user's GPS position on the map.
//
// Handles:
//   - GPS watchPosition updates from boot.js
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
//   - Reverse-geocode footer label update (Nominatim, throttled to once per 2 minutes)
//
// Depends on: map (global alias), maplibregl, rangeRingCenter, rangeRingsControl, _Notifications
// ============================================================

/**
 * Fly the map to the user's last known location.
 * Uses rangeRingCenter (kept live by setUserLocation) if available,
 * otherwise falls back to a fresh getCurrentPosition call.
 * Also fires _onGoToUserLocation to activate the side-menu location button.
 */
function goToUserLocation() {
    if (rangeRingCenter) {
        // Use the cached centre — faster and avoids a permission prompt
        map.flyTo({ center: rangeRingCenter, zoom: 10 });
        if (_onGoToUserLocation) _onGoToUserLocation();
    } else if (navigator.geolocation) {
        // No cached position — request a fresh one
        navigator.geolocation.getCurrentPosition(pos => {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 10 });
            if (_onGoToUserLocation) _onGoToUserLocation();
        });
    }
}

// The single MapLibre Marker for the user's position (null until first GPS fix or cache restore)
let userMarker;

// ============================================================
// MARKER ELEMENT BUILDER
// Creates the animated SVG div element used as the marker's DOM content.
// The animation sequence: circle draws on → dot pulses → coord card types in → fades out.
// ============================================================

/**
 * Build the animated SVG marker element for a given position.
 * The element exposes el._replayIntro() to re-trigger the animation on demand.
 * @param {number} longitude
 * @param {number} latitude
 * @returns {HTMLDivElement}
 */
function createUserMarkerElement(longitude, latitude) {
    const el = document.createElement('div');
    el.style.width    = '60px';
    el.style.height   = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.style.zIndex   = '9999';
    el.classList.add('user-location-marker');

    // Circle geometry constants
    const R    = 13;                              // ring radius (px)
    const CIRC = +(2 * Math.PI * R).toFixed(2);  // circumference ≈ 81.68 — used for stroke-dasharray draw-on

    const CY      = 30;           // circle vertical centre in the viewBox
    const BG_RIGHT = 97;          // right edge of the coordinate background pill
    const BG_Y1   = CY - R;      // top edge of the background (= 17)
    const BG_Y2   = CY + R;      // bottom edge (= 43)
    // At the tangent points the arc x = CY (the concave edge follows the circle)
    const arcX1 = CY;
    const arcX2 = CY;

    el.innerHTML = `<svg viewBox="0 0 120 60" width="120" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <!-- Coordinate background: left edge is concave (matches circle), right edge is pill-capped -->
        <path class="marker-coord-bg"
              d="M ${arcX1},${BG_Y1} A ${R},${R} 0 0,1 ${CY + R},${CY} A ${R},${R} 0 0,1 ${arcX2},${BG_Y2} L ${BG_RIGHT},${BG_Y2} A ${R},${R} 0 0,0 ${BG_RIGHT},${BG_Y1} Z"
              fill="black" opacity="0.75"
              style="clip-path:inset(0 100% 0 0)"/>
        <!-- Outer ring — draws on via stroke-dashoffset animation -->
        <circle class="marker-ring" cx="${CY}" cy="${CY}" r="${R}" fill="none" stroke="#c8ff00" stroke-width="1.8"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        <!-- Centre dot — pulses in after the ring is complete -->
        <circle class="marker-dot" cx="${CY}" cy="${CY}" r="3.5" fill="white" opacity="0"/>
        <!-- Latitude line: label tspan (lime) + value tspan (white) -->
        <text x="52" y="26" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lat-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lat"></tspan>
        </text>
        <!-- Longitude line -->
        <text x="52" y="39" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lon-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lon"></tspan>
        </text>
    </svg>`;

    // Cache references to animated elements
    const ring        = el.querySelector('.marker-ring');
    const dot         = el.querySelector('.marker-dot');
    const coordBg     = el.querySelector('.marker-coord-bg');
    const latLabelEl  = el.querySelector('.marker-lat-label');
    const lonLabelEl  = el.querySelector('.marker-lon-label');
    const latEl       = el.querySelector('.marker-lat');
    const lonEl       = el.querySelector('.marker-lon');

    const LAT_LABEL = 'LAT ';
    const LON_LABEL = 'LON ';

    // Timer management — track all pending timeouts so they can be cancelled on re-trigger
    let timers = [];
    const after = (ms, fn) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    function cancelAllTimers() { timers.forEach(clearTimeout); timers = []; }

    /**
     * Animate the coordinate card in:
     *   1. Slide the background pill in from the right (0.3 s CSS)
     *   2. Type both lat+lon lines simultaneously at 65 ms/character
     *   3. After 3 s hold, erase characters then slide background out
     * @param {string} latText  Formatted latitude (e.g. "53.421")
     * @param {string} lonText  Formatted longitude (e.g. "-1.889")
     */
    function animateCoordCard(latText, lonText) {
        // Step 1: slide background in using CSS keyframe animation
        coordBg.style.clipPath  = 'inset(0 100% 0 0)';
        coordBg.style.animation = 'none';
        coordBg.offsetWidth;     // force reflow to restart animation
        coordBg.style.animation = 'marker-coord-bg-in 0.3s ease-out forwards';
        // Lock the final clip-path state via inline style so MapLibre repaints can't reset it
        coordBg.addEventListener('animationend', function lockBgOpen(e) {
            if (e.animationName !== 'marker-coord-bg-in') return;
            coordBg.removeEventListener('animationend', lockBgOpen);
            coordBg.style.animation = 'none';
            coordBg.style.clipPath  = 'inset(0 0% 0 0)';
        });

        // Step 2: type both lines in parallel, one character at a time
        const latFull = LAT_LABEL + latText;
        const lonFull = LON_LABEL + lonText;
        let i = 0, j = 0;

        // Reset all text content before starting
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';

        function typeOneChar() {
            let more = false;
            if (i < latFull.length) {
                const ch = latFull.slice(0, ++i);
                latLabelEl.textContent = ch.slice(0, Math.min(i, LAT_LABEL.length)); // lime label portion
                latEl.textContent      = ch.slice(LAT_LABEL.length);                  // white value portion
                more = true;
            }
            if (j < lonFull.length) {
                const ch = lonFull.slice(0, ++j);
                lonLabelEl.textContent = ch.slice(0, Math.min(j, LON_LABEL.length));
                lonEl.textContent      = ch.slice(LON_LABEL.length);
                more = true;
            }
            if (more) after(65, typeOneChar); // 65 ms per character step
            else      scheduleCoordCardDismiss(latFull, lonFull); // typing done
        }
        after(300, typeOneChar); // start typing after bg slide-in completes (~0.3 s)
    }

    /**
     * Hold the coord card for 3 s then erase it character-by-character, slide background out,
     * and end with a 3× dot pulse to signal the animation is complete.
     * @param {string} latFull  Full lat string (label + value)
     * @param {string} lonFull  Full lon string
     */
    function scheduleCoordCardDismiss(latFull, lonFull) {
        after(3000, () => {
            let i = latFull.length, j = lonFull.length;

            function eraseOneChar() {
                let more = false;
                if (i > 0) {
                    const ch = latFull.slice(0, --i);
                    latLabelEl.textContent = ch.slice(0, Math.min(i, LAT_LABEL.length));
                    latEl.textContent      = ch.slice(LAT_LABEL.length);
                    more = true;
                }
                if (j > 0) {
                    const ch = lonFull.slice(0, --j);
                    lonLabelEl.textContent = ch.slice(0, Math.min(j, LON_LABEL.length));
                    lonEl.textContent      = ch.slice(LON_LABEL.length);
                    more = true;
                }
                if (more) {
                    after(45, eraseOneChar); // 45 ms per erase step (slightly faster than type)
                } else {
                    // All text erased — slide background out
                    coordBg.style.clipPath  = 'inset(0 0% 0 0)';
                    coordBg.style.animation = 'none';
                    coordBg.offsetWidth;
                    coordBg.style.animation = 'marker-coord-bg-out 0.3s ease-in forwards';
                    // Lock closed state
                    coordBg.addEventListener('animationend', function lockBgClosed(e) {
                        if (e.animationName !== 'marker-coord-bg-out') return;
                        coordBg.removeEventListener('animationend', lockBgClosed);
                        coordBg.style.animation = 'none';
                        coordBg.style.clipPath  = 'inset(0 100% 0 0)';
                    });
                    // After background disappears, pulse the dot 3× as a "done" signal
                    after(300, () => {
                        dot.style.animation = 'none';
                        dot.offsetWidth;
                        dot.style.animation = 'marker-dot-end-pulse 0.18s ease-in-out 3 forwards';
                        after(540, () => {
                            el.dataset.animDone = '1'; // signals to other code that animation finished
                            el.style.zIndex = '0';     // lower z-index after animation so it doesn't occlude other markers
                        });
                    });
                }
            }
            eraseOneChar();
        });
    }

    /**
     * Run the full intro animation sequence from the beginning:
     *   circle draws on (0.5 s) → dot pulses twice (0.4 s) → coord card animates
     */
    function runIntroAnimation() {
        cancelAllTimers();
        el.dataset.animDone = '0';
        el.style.zIndex     = '9999'; // bring to front during animation

        const latText = longitude !== undefined ? latitude.toFixed(3)  : '';
        const lonText = longitude !== undefined ? longitude.toFixed(3) : '';

        // Reset all animation state before replaying
        ring.style.strokeDashoffset = String(CIRC);
        ring.style.animation        = 'none';
        dot.style.opacity           = '0';
        dot.style.animation         = 'none';
        dot.style.fill              = 'white';
        coordBg.style.animation     = 'none';
        coordBg.style.clipPath      = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';

        // Step 1: draw the ring on over 0.5 s
        after(20, () => {
            ring.style.animation = 'marker-circle-draw 0.5s ease-out forwards';
        });

        // Step 2: pulse the centre dot twice (0.2 s each = 0.4 s total, starts after ring)
        after(550, () => {
            dot.style.opacity  = '1';
            dot.style.animation = 'marker-dot-pulse 0.2s ease-in-out 2 forwards';
        });

        // Step 3: start the coord card sequence after both ring + dot animations
        after(950, () => animateCoordCard(latText, lonText));
    }

    // Store formatted coords as data attributes for the click-to-replay handler
    el.dataset.lat = latitude  !== undefined ? latitude.toFixed(3)  : '';
    el.dataset.lon = longitude !== undefined ? longitude.toFixed(3) : '';

    // Click on the marker replays just the coord card (not the full intro)
    el.addEventListener('click', () => {
        cancelAllTimers();
        // Reset coord area back to hidden state
        coordBg.style.animation = 'none';
        coordBg.offsetWidth;
        coordBg.style.clipPath = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';
        animateCoordCard(el.dataset.lat || '', el.dataset.lon || '');
    });

    runIntroAnimation(); // play on creation

    // Expose method so setUserLocation can re-trigger the intro after a manual pin
    el._replayIntro = runIntroAnimation;

    return el;
}

// ============================================================
// SET USER LOCATION
// Called by watchPosition (boot.js) and by the right-click context menu.
// Updates or creates the map marker, updates range rings, caches coordinates.
// ============================================================

/**
 * Place or move the user location marker to the given coordinates.
 * Guards against overwriting a manual pin with a background GPS update.
 * @param {{ coords: { longitude: number, latitude: number }, _fromCache?: boolean, _manual?: boolean }} position
 */
function setUserLocation(position) {
    const { longitude, latitude } = position.coords;
    const isFirstFix = !userMarker; // true if no marker has been created yet

    console.log('[location] setUserLocation called', { longitude, latitude, isFirstFix, fromCache: !!position._fromCache });

    // Don't overwrite a manually-pinned location with a background GPS update
    if (!position._fromCache && !position._manual) {
        try {
            const saved = JSON.parse(localStorage.getItem('userLocation') || 'null');
            if (saved && saved.manual) return; // manual pin takes priority — bail out
        } catch (e) {}
    }

    // Update existing marker position, or create a new one
    if (userMarker) {
        userMarker.setLngLat([longitude, latitude]);
        const el = userMarker.getElement();
        el.dataset.lat = latitude.toFixed(3);   // keep data attributes current for click replay
        el.dataset.lon = longitude.toFixed(3);
        if (position._manual && typeof el._replayIntro === 'function') {
            el._replayIntro(); // replay intro animation when user manually sets a new pin
        }
    } else {
        userMarker = new maplibregl.Marker({
            element: createUserMarkerElement(longitude, latitude),
            anchor: 'center',
        }).setLngLat([longitude, latitude]).addTo(map);
    }

    // On the very first live GPS fix, fly to the position so the marker is visible
    if (isFirstFix && !position._fromCache) {
        map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10) });
    }

    // Update range rings to be centred on the user's position
    rangeRingCenter = [longitude, latitude];
    if (rangeRingsControl) rangeRingsControl.updateCenter(longitude, latitude);

    // Persist the position to localStorage for future page loads
    if (!position._manual) {
        try {
            const existing = JSON.parse(localStorage.getItem('userLocation') || 'null');
            if (existing && existing.manual) {
                // Never overwrite a manual pin with a GPS cache write
            } else {
                localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
            }
        } catch (e) {
            localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
        }
    }
    localStorage.setItem('geolocationGranted', 'true'); // used to skip the permission prompt hint

    // Update footer country label via reverse geocode (throttled: once per 2 minutes)
    const now = Date.now();
    if (now - setUserLocation._lastGeocode > 2 * 60 * 1000) {
        setUserLocation._lastGeocode = now;
        fetch(`/api/air/geocode/reverse?lat=${latitude}&lon=${longitude}`)
            .then(r => r.json())
            .then(data => {
                const country = data.address && data.address.country;
                if (country) {
                    const el = document.getElementById('footer-location');
                    if (el) el.textContent = country.toUpperCase();
                }
            })
            .catch(() => {}); // geocode failures are non-fatal
    }
}
setUserLocation._lastGeocode = 0; // static property — persists across calls for throttle check

// ============================================================
// CACHED LOCATION RESTORE
// On page load, attempt to restore the user's last-known position from localStorage.
// Manual pins persist indefinitely; GPS cache expires after 5 minutes.
// ============================================================

const _cachedLocation = localStorage.getItem('userLocation');
if (_cachedLocation) {
    try {
        const { longitude, latitude, ts, manual } = JSON.parse(_cachedLocation);
        if (manual || Date.now() - (ts || 0) < 5 * 60 * 1000) {
            // Valid cache — place the marker without flying to it (_fromCache: true)
            setUserLocation({ coords: { longitude, latitude }, _fromCache: true });
        } else {
            localStorage.removeItem('userLocation'); // GPS cache expired — discard
        }
    } catch (e) {
        localStorage.removeItem('userLocation'); // corrupt data — discard
    }
}

// ============================================================
// RIGHT-CLICK CONTEXT MENU
// Right-clicking on the map shows a single-item menu to manually pin the location.
// Dismisses on any click, keypress, or map move.
// ============================================================

(function () {
    let _activeMenu = null; // reference to the currently visible context menu div

    /** Remove the active context menu from the DOM. */
    function removeContextMenu() {
        if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
    }

    map.on('contextmenu', (e) => {
        removeContextMenu(); // dismiss any previous menu

        const { lng, lat } = e.lngLat;

        // Build the context menu div
        const menu = document.createElement('div');
        menu.style.cssText = [
            'position:absolute',
            'background:#1a1a2e',
            'border:1px solid #444',
            'border-radius:4px',
            'padding:4px 0',
            'font-family:monospace',
            'font-size:12px',
            'color:#fff',
            'z-index:9999',
            'box-shadow:0 2px 8px rgba(0,0,0,.6)',
            'min-width:180px',
            'cursor:default',
        ].join(';');

        // Position the menu at the pixel coordinates of the right-click
        menu.style.left = e.point.x + 'px';
        menu.style.top  = e.point.y + 'px';

        // Single menu item: set location
        const item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', () => { item.style.background = '#2a2a4e'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
            removeContextMenu();
            // Save as a manual override (no expiry — persists until cleared or overwritten)
            localStorage.setItem('userLocation', JSON.stringify({
                longitude: lng, latitude: lat, ts: Date.now(), manual: true,
            }));
            setUserLocation({ coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true });
        });

        menu.appendChild(item);
        map.getContainer().appendChild(menu);
        _activeMenu = menu;

        // Auto-dismiss on any subsequent user interaction
        document.addEventListener('click',   removeContextMenu, { once: true });
        document.addEventListener('keydown', removeContextMenu, { once: true });
        map.on('move', removeContextMenu);
        map.on('zoom', removeContextMenu);
    });
})();
