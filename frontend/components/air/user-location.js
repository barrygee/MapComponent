"use strict";
// ============================================================
// USER LOCATION MARKER
// Animated SVG marker showing the user's GPS position on the map.
//
// Handles:
//   - GPS watchPosition updates from boot.ts
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
//   - Reverse-geocode footer label update (Nominatim, throttled to once per 2 minutes)
//
// Depends on: map (global alias), maplibregl, rangeRingCenter, rangeRingsControl
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />
/**
 * Fly the map to the user's last known location.
 */
function goToUserLocation() {
    if (rangeRingCenter) {
        map.flyTo({ center: rangeRingCenter, zoom: 10 });
        if (_onGoToUserLocation)
            _onGoToUserLocation();
    }
    else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 10 });
            if (_onGoToUserLocation)
                _onGoToUserLocation();
        });
    }
}
// The single MapLibre Marker for the user's position
let userMarker = null;
function createUserMarkerElement(longitude, latitude) {
    const el = document.createElement('div');
    el.style.width = '60px';
    el.style.height = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.style.zIndex = '9999';
    el.classList.add('user-location-marker');
    const R = 13;
    const CIRC = +(2 * Math.PI * R).toFixed(2);
    const CY = 30;
    const BG_RIGHT = 97;
    const BG_Y1 = CY - R;
    const BG_Y2 = CY + R;
    const arcX1 = CY;
    const arcX2 = CY;
    el.innerHTML = `<svg viewBox="0 0 120 60" width="120" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <path class="marker-coord-bg"
              d="M ${arcX1},${BG_Y1} A ${R},${R} 0 0,1 ${CY + R},${CY} A ${R},${R} 0 0,1 ${arcX2},${BG_Y2} L ${BG_RIGHT},${BG_Y2} A ${R},${R} 0 0,0 ${BG_RIGHT},${BG_Y1} Z"
              fill="black" opacity="0.75"
              style="clip-path:inset(0 100% 0 0)"/>
        <circle class="marker-ring" cx="${CY}" cy="${CY}" r="${R}" fill="none" stroke="#c8ff00" stroke-width="1.8"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        <circle class="marker-dot" cx="${CY}" cy="${CY}" r="3.5" fill="white" opacity="0"/>
        <text x="52" y="26" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lat-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lat"></tspan>
        </text>
        <text x="52" y="39" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lon-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lon"></tspan>
        </text>
    </svg>`;
    const ring = el.querySelector('.marker-ring');
    const dot = el.querySelector('.marker-dot');
    const coordBg = el.querySelector('.marker-coord-bg');
    const latLabelEl = el.querySelector('.marker-lat-label');
    const lonLabelEl = el.querySelector('.marker-lon-label');
    const latEl = el.querySelector('.marker-lat');
    const lonEl = el.querySelector('.marker-lon');
    const LAT_LABEL = 'LAT ';
    const LON_LABEL = 'LON ';
    let timers = [];
    const after = (ms, fn) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    function cancelAllTimers() { timers.forEach(clearTimeout); timers = []; }
    function animateCoordCard(latText, lonText) {
        coordBg.style.clipPath = 'inset(0 100% 0 0)';
        coordBg.style.animation = 'none';
        void coordBg.offsetWidth;
        coordBg.style.animation = 'marker-coord-bg-in 0.3s ease-out forwards';
        coordBg.addEventListener('animationend', function lockBgOpen(e) {
            if (e.animationName !== 'marker-coord-bg-in')
                return;
            coordBg.removeEventListener('animationend', lockBgOpen);
            coordBg.style.animation = 'none';
            coordBg.style.clipPath = 'inset(0 0% 0 0)';
        });
        const latFull = LAT_LABEL + latText;
        const lonFull = LON_LABEL + lonText;
        let i = 0, j = 0;
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';
        function typeOneChar() {
            let more = false;
            if (i < latFull.length) {
                const ch = latFull.slice(0, ++i);
                latLabelEl.textContent = ch.slice(0, Math.min(i, LAT_LABEL.length));
                latEl.textContent = ch.slice(LAT_LABEL.length);
                more = true;
            }
            if (j < lonFull.length) {
                const ch = lonFull.slice(0, ++j);
                lonLabelEl.textContent = ch.slice(0, Math.min(j, LON_LABEL.length));
                lonEl.textContent = ch.slice(LON_LABEL.length);
                more = true;
            }
            if (more)
                after(65, typeOneChar);
            else
                scheduleCoordCardDismiss(latFull, lonFull);
        }
        after(300, typeOneChar);
    }
    function scheduleCoordCardDismiss(latFull, lonFull) {
        after(3000, () => {
            let i = latFull.length, j = lonFull.length;
            function eraseOneChar() {
                let more = false;
                if (i > 0) {
                    const ch = latFull.slice(0, --i);
                    latLabelEl.textContent = ch.slice(0, Math.min(i, LAT_LABEL.length));
                    latEl.textContent = ch.slice(LAT_LABEL.length);
                    more = true;
                }
                if (j > 0) {
                    const ch = lonFull.slice(0, --j);
                    lonLabelEl.textContent = ch.slice(0, Math.min(j, LON_LABEL.length));
                    lonEl.textContent = ch.slice(LON_LABEL.length);
                    more = true;
                }
                if (more) {
                    after(45, eraseOneChar);
                }
                else {
                    coordBg.style.clipPath = 'inset(0 0% 0 0)';
                    coordBg.style.animation = 'none';
                    void coordBg.offsetWidth;
                    coordBg.style.animation = 'marker-coord-bg-out 0.3s ease-in forwards';
                    coordBg.addEventListener('animationend', function lockBgClosed(e) {
                        if (e.animationName !== 'marker-coord-bg-out')
                            return;
                        coordBg.removeEventListener('animationend', lockBgClosed);
                        coordBg.style.animation = 'none';
                        coordBg.style.clipPath = 'inset(0 100% 0 0)';
                    });
                    after(300, () => {
                        dot.style.animation = 'none';
                        void dot.offsetWidth;
                        dot.style.animation = 'marker-dot-end-pulse 0.18s ease-in-out 3 forwards';
                        after(540, () => {
                            el.dataset['animDone'] = '1';
                            el.style.zIndex = '0';
                        });
                    });
                }
            }
            eraseOneChar();
        });
    }
    function runIntroAnimation() {
        cancelAllTimers();
        el.dataset['animDone'] = '0';
        el.style.zIndex = '9999';
        const latText = latitude !== undefined ? latitude.toFixed(3) : '';
        const lonText = longitude !== undefined ? longitude.toFixed(3) : '';
        ring.style.strokeDashoffset = String(CIRC);
        ring.style.animation = 'none';
        dot.style.opacity = '0';
        dot.style.animation = 'none';
        dot.style.fill = 'white';
        coordBg.style.animation = 'none';
        coordBg.style.clipPath = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';
        after(20, () => {
            ring.style.animation = 'marker-circle-draw 0.5s ease-out forwards';
        });
        after(550, () => {
            dot.style.opacity = '1';
            dot.style.animation = 'marker-dot-pulse 0.2s ease-in-out 2 forwards';
        });
        after(950, () => animateCoordCard(latText, lonText));
    }
    el.dataset['lat'] = latitude !== undefined ? latitude.toFixed(3) : '';
    el.dataset['lon'] = longitude !== undefined ? longitude.toFixed(3) : '';
    el.addEventListener('click', () => {
        cancelAllTimers();
        coordBg.style.animation = 'none';
        void coordBg.offsetWidth;
        coordBg.style.clipPath = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';
        animateCoordCard(el.dataset['lat'] || '', el.dataset['lon'] || '');
    });
    runIntroAnimation();
    el._replayIntro = runIntroAnimation;
    return el;
}
const setUserLocation = (function () {
    function fn(position) {
        const { longitude, latitude } = position.coords;
        const isFirstFix = !userMarker;
        console.log('[location] setUserLocation called', { longitude, latitude, isFirstFix, fromCache: !!position._fromCache });
        if (!position._fromCache && !position._manual) {
            try {
                const saved = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (saved && saved.manual)
                    return;
            }
            catch (e) { }
        }
        if (userMarker) {
            userMarker.setLngLat([longitude, latitude]);
            const el = userMarker.getElement();
            el.dataset['lat'] = latitude.toFixed(3);
            el.dataset['lon'] = longitude.toFixed(3);
            if (position._manual && typeof el._replayIntro === 'function') {
                el._replayIntro();
            }
        }
        else {
            userMarker = new maplibregl.Marker({
                element: createUserMarkerElement(longitude, latitude),
                anchor: 'center',
            }).setLngLat([longitude, latitude]).addTo(map);
        }
        if (isFirstFix && !position._fromCache) {
            map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10) });
        }
        rangeRingCenter = [longitude, latitude];
        if (rangeRingsControl)
            rangeRingsControl.updateCenter(longitude, latitude);
        if (!position._manual) {
            try {
                const existing = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (existing && existing.manual) {
                    // Never overwrite a manual pin with a GPS cache write
                }
                else {
                    localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
                }
            }
            catch (e) {
                localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
            }
        }
        localStorage.setItem('geolocationGranted', 'true');
        const now = Date.now();
        if (now - fn._lastGeocode > 2 * 60 * 1000) {
            fn._lastGeocode = now;
            fetch(`/api/air/geocode/reverse?lat=${latitude}&lon=${longitude}`)
                .then(r => r.json())
                .then((data) => {
                const country = data.address && data.address.country;
                if (country) {
                    const footerEl = document.getElementById('footer-location');
                    if (footerEl)
                        footerEl.textContent = country.toUpperCase();
                }
            })
                .catch(() => { });
        }
    }
    fn._lastGeocode = 0;
    return fn;
})();
// ============================================================
// CACHED LOCATION RESTORE
// ============================================================
const _cachedLocation = localStorage.getItem('userLocation');
if (_cachedLocation) {
    try {
        const parsed = JSON.parse(_cachedLocation);
        if (parsed.manual || Date.now() - (parsed.ts || 0) < 5 * 60 * 1000) {
            setUserLocation({ coords: { longitude: parsed.longitude, latitude: parsed.latitude }, _fromCache: true });
        }
        else {
            localStorage.removeItem('userLocation');
        }
    }
    catch (e) {
        localStorage.removeItem('userLocation');
    }
}
// ============================================================
// RIGHT-CLICK CONTEXT MENU
// ============================================================
(function () {
    let _activeMenu = null;
    function removeContextMenu() {
        if (_activeMenu) {
            _activeMenu.remove();
            _activeMenu = null;
        }
    }
    map.on('contextmenu', (e) => {
        removeContextMenu();
        const { lng, lat } = e.lngLat;
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
        menu.style.left = e.point.x + 'px';
        menu.style.top = e.point.y + 'px';
        const item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', () => { item.style.background = '#2a2a4e'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
            removeContextMenu();
            localStorage.setItem('userLocation', JSON.stringify({
                longitude: lng, latitude: lat, ts: Date.now(), manual: true,
            }));
            setUserLocation({ coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true });
        });
        menu.appendChild(item);
        map.getContainer().appendChild(menu);
        _activeMenu = menu;
        document.addEventListener('click', removeContextMenu, { once: true });
        document.addEventListener('keydown', removeContextMenu, { once: true });
        map.on('move', removeContextMenu);
        map.on('zoom', removeContextMenu);
    });
})();
//# sourceMappingURL=user-location.js.map