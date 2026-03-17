// ============================================================
// SPACE USER LOCATION MARKER
// Animated SVG marker showing the user's GPS position on the space map.
//
// Handles:
//   - GPS watchPosition updates from space-boot.ts
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
//
// Depends on: map (global alias), maplibregl, spaceUserLocationCenter
// ============================================================

/// <reference path="../globals.d.ts" />

interface SpaceUserPosition {
    coords: { longitude: number; latitude: number };
    _fromCache?: boolean;
    _manual?: boolean;
}

/**
 * Fly the map to the user's last known location.
 */
function goToSpaceUserLocation(): void {
    if (spaceUserLocationCenter) {
        map.flyTo({ center: spaceUserLocationCenter, zoom: 5 });
        if (_onGoToSpaceUserLocation) _onGoToSpaceUserLocation();
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 5 });
            if (_onGoToSpaceUserLocation) _onGoToSpaceUserLocation();
        });
    }
}

// The single MapLibre Marker for the user's position
let _spaceUserMarker: maplibregl.Marker | null = null;

// ============================================================
// MARKER ELEMENT BUILDER
// ============================================================

function _createSpaceUserMarkerElement(longitude: number | undefined, latitude: number | undefined): HTMLDivElement {
    const el = document.createElement('div');
    el.style.width    = '60px';
    el.style.height   = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.style.zIndex   = '9999';
    el.classList.add('space-user-location-marker');

    const circleRadius        = 13;
    const circleCircumference = +(2 * Math.PI * circleRadius).toFixed(2);
    const circleCenterX       = 30;
    const circleCenterY       = 30;
    const coordBgRightEdge    = 97;
    const coordBgTopY         = circleCenterY - circleRadius;
    const coordBgBottomY      = circleCenterY + circleRadius;

    el.innerHTML = `<svg viewBox="0 0 120 60" width="120" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <path class="marker-coord-bg"
              d="M ${circleCenterX},${coordBgTopY} A ${circleRadius},${circleRadius} 0 0,1 ${circleCenterX + circleRadius},${circleCenterY} A ${circleRadius},${circleRadius} 0 0,1 ${circleCenterX},${coordBgBottomY} L ${coordBgRightEdge},${coordBgBottomY} A ${circleRadius},${circleRadius} 0 0,0 ${coordBgRightEdge},${coordBgTopY} Z"
              fill="black" opacity="0.75"
              style="clip-path:inset(0 100% 0 0)"/>
        <circle class="marker-ring" cx="${circleCenterX}" cy="${circleCenterY}" r="${circleRadius}" fill="none" stroke="#c8ff00" stroke-width="1.8"
                stroke-dasharray="${circleCircumference}" stroke-dashoffset="${circleCircumference}"/>
        <circle class="marker-dot" cx="${circleCenterX}" cy="${circleCenterY}" r="3.5" fill="white" opacity="0"/>
        <text x="52" y="26" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lat-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lat"></tspan>
        </text>
        <text x="52" y="39" fill="white" font-size="7.5" font-family="monospace">
            <tspan class="marker-lon-label" fill="#c8ff00" font-size="6"></tspan><tspan class="marker-lon"></tspan>
        </text>
    </svg>`;

    const ring       = el.querySelector('.marker-ring')       as SVGCircleElement;
    const dot        = el.querySelector('.marker-dot')        as SVGCircleElement;
    const coordBg    = el.querySelector('.marker-coord-bg')   as SVGPathElement;
    const latLabelEl = el.querySelector('.marker-lat-label')  as SVGTSpanElement;
    const lonLabelEl = el.querySelector('.marker-lon-label')  as SVGTSpanElement;
    const latEl      = el.querySelector('.marker-lat')        as SVGTSpanElement;
    const lonEl      = el.querySelector('.marker-lon')        as SVGTSpanElement;

    const LAT_LABEL = 'LAT ';
    const LON_LABEL = 'LON ';

    let timers: ReturnType<typeof setTimeout>[] = [];
    function after(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
        const t = setTimeout(fn, ms); timers.push(t); return t;
    }
    function cancelAllTimers() { timers.forEach(clearTimeout); timers = []; }

    function animateCoordCard(latText: string, lonText: string) {
        coordBg.style.clipPath  = 'inset(0 100% 0 0)';
        coordBg.style.animation = 'none';
        void (coordBg as unknown as HTMLElement).offsetWidth;
        coordBg.style.animation = 'marker-coord-bg-in 0.3s ease-out forwards';
        coordBg.addEventListener('animationend', function lockBgOpen(e: AnimationEvent) {
            if (e.animationName !== 'marker-coord-bg-in') return;
            coordBg.removeEventListener('animationend', lockBgOpen);
            coordBg.style.animation = 'none';
            coordBg.style.clipPath  = 'inset(0 0% 0 0)';
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
                latEl.textContent      = ch.slice(LAT_LABEL.length);
                more = true;
            }
            if (j < lonFull.length) {
                const ch = lonFull.slice(0, ++j);
                lonLabelEl.textContent = ch.slice(0, Math.min(j, LON_LABEL.length));
                lonEl.textContent      = ch.slice(LON_LABEL.length);
                more = true;
            }
            if (more) after(65, typeOneChar);
            else      scheduleCoordCardDismiss(latFull, lonFull);
        }
        after(300, typeOneChar);
    }

    function scheduleCoordCardDismiss(latFull: string, lonFull: string) {
        after(3000, function () {
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
                    after(45, eraseOneChar);
                } else {
                    coordBg.style.clipPath  = 'inset(0 0% 0 0)';
                    coordBg.style.animation = 'none';
                    void (coordBg as unknown as HTMLElement).offsetWidth;
                    coordBg.style.animation = 'marker-coord-bg-out 0.3s ease-in forwards';
                    coordBg.addEventListener('animationend', function lockBgClosed(e: AnimationEvent) {
                        if (e.animationName !== 'marker-coord-bg-out') return;
                        coordBg.removeEventListener('animationend', lockBgClosed);
                        coordBg.style.animation = 'none';
                        coordBg.style.clipPath  = 'inset(0 100% 0 0)';
                    });
                    after(300, function () {
                        dot.style.animation = 'none';
                        void (dot as unknown as HTMLElement).offsetWidth;
                        dot.style.animation = 'marker-dot-end-pulse 0.18s ease-in-out 3 forwards';
                        after(540, function () {
                            el.dataset['animDone'] = '1';
                            el.style.zIndex = '0';
                        });
                    });
                }
            }
            eraseOneChar();
        });
    }

    function runIntroAnimation(): void {
        cancelAllTimers();
        el.dataset['animDone'] = '0';
        el.style.zIndex     = '9999';

        const latText = latitude  !== undefined ? latitude.toFixed(3)  : '';
        const lonText = longitude !== undefined ? longitude.toFixed(3) : '';

        ring.style.strokeDashoffset = String(circleCircumference);
        ring.style.animation        = 'none';
        dot.style.opacity           = '0';
        dot.style.animation         = 'none';
        dot.style.fill              = 'white';
        coordBg.style.animation     = 'none';
        coordBg.style.clipPath      = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';

        after(20, function () {
            ring.style.animation = 'marker-circle-draw 0.5s ease-out forwards';
        });
        after(550, function () {
            dot.style.opacity   = '1';
            dot.style.animation = 'marker-dot-pulse 0.2s ease-in-out 2 forwards';
        });
        after(950, function () { animateCoordCard(latText, lonText); });
    }

    el.dataset['lat'] = latitude  !== undefined ? latitude.toFixed(3)  : '';
    el.dataset['lon'] = longitude !== undefined ? longitude.toFixed(3) : '';

    el.addEventListener('click', function () {
        cancelAllTimers();
        coordBg.style.animation = 'none';
        void (coordBg as unknown as HTMLElement).offsetWidth;
        coordBg.style.clipPath = 'inset(0 100% 0 0)';
        latLabelEl.textContent = lonLabelEl.textContent = latEl.textContent = lonEl.textContent = '';
        animateCoordCard(el.dataset['lat'] || '', el.dataset['lon'] || '');
    });

    runIntroAnimation();
    (el as HTMLDivElement & { _replayIntro: () => void })._replayIntro = runIntroAnimation;

    return el;
}

// ============================================================
// SET USER LOCATION
// ============================================================

function setSpaceUserLocation(position: SpaceUserPosition): void {
    const { longitude, latitude } = position.coords;
    const isFirstFix = !_spaceUserMarker;

    if (!position._fromCache && !position._manual) {
        try {
            const saved = JSON.parse(localStorage.getItem('userLocation') || 'null') as { manual?: boolean } | null;
            if (saved && saved.manual) return;
        } catch (e) {}
    }

    if (_spaceUserMarker) {
        _spaceUserMarker.setLngLat([longitude, latitude]);
        const el = _spaceUserMarker.getElement() as HTMLDivElement & { _replayIntro?: () => void };
        el.dataset['lat'] = latitude.toFixed(3);
        el.dataset['lon'] = longitude.toFixed(3);
        if (position._manual && typeof el._replayIntro === 'function') {
            el._replayIntro();
        }
    } else {
        _spaceUserMarker = new maplibregl.Marker({
            element: _createSpaceUserMarkerElement(longitude, latitude),
            anchor: 'center',
        }).setLngLat([longitude, latitude]).addTo(map);
    }

    if (isFirstFix && !position._fromCache) {
        map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 5) });
    }

    spaceUserLocationCenter = [longitude, latitude];

    if (!position._manual) {
        try {
            const existing = JSON.parse(localStorage.getItem('userLocation') || 'null') as { manual?: boolean } | null;
            if (existing && existing.manual) {
                // Never overwrite a manual pin with a GPS cache write
            } else {
                localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
            }
        } catch (e) {
            localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
        }
    }
    localStorage.setItem('geolocationGranted', 'true');
}

// ============================================================
// CACHED LOCATION RESTORE
// ============================================================

(function () {
    const cached = localStorage.getItem('userLocation');
    if (!cached) return;
    try {
        const parsed = JSON.parse(cached) as { longitude: number; latitude: number; ts?: number; manual?: boolean };
        if (parsed.manual || Date.now() - (parsed.ts || 0) < 5 * 60 * 1000) {
            setSpaceUserLocation({ coords: { longitude: parsed.longitude, latitude: parsed.latitude }, _fromCache: true });
        } else {
            localStorage.removeItem('userLocation');
        }
    } catch (e) {
        localStorage.removeItem('userLocation');
    }
})();

// ============================================================
// RIGHT-CLICK CONTEXT MENU
// ============================================================

(function () {
    let _activeMenu: HTMLDivElement | null = null;

    function removeContextMenu() {
        if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
    }

    map.on('contextmenu', function (e: maplibregl.MapMouseEvent) {
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
        menu.style.top  = e.point.y + 'px';

        const item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:6px 14px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', function () { item.style.background = '#2a2a4e'; });
        item.addEventListener('mouseleave', function () { item.style.background = ''; });
        item.addEventListener('click', function () {
            removeContextMenu();
            localStorage.setItem('userLocation', JSON.stringify({
                longitude: lng, latitude: lat, ts: Date.now(), manual: true,
            }));
            setSpaceUserLocation({ coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true });
        });

        menu.appendChild(item);
        map.getContainer().appendChild(menu);
        _activeMenu = menu;

        document.addEventListener('click',   removeContextMenu, { once: true });
        document.addEventListener('keydown', removeContextMenu, { once: true });
        map.on('move', removeContextMenu);
        map.on('zoom', removeContextMenu);
    });
})();
