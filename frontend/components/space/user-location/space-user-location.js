"use strict";
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
/**
 * Fly the map to the user's last known location.
 */
function goToSpaceUserLocation() {
    if (spaceUserLocationCenter) {
        map.flyTo({ center: spaceUserLocationCenter, zoom: 5 });
        if (_onGoToSpaceUserLocation)
            _onGoToSpaceUserLocation();
    }
    else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function (pos) {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 5 });
            if (_onGoToSpaceUserLocation)
                _onGoToSpaceUserLocation();
        });
    }
}
// The single MapLibre Marker for the user's position
let _spaceUserMarker = null;
// ============================================================
// MARKER ELEMENT BUILDER
// ============================================================
function _createSpaceUserMarkerElement() {
    const el = document.createElement('div');
    el.style.width = '60px';
    el.style.height = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.style.zIndex = '9999';
    el.classList.add('space-user-location-marker');
    const circleRadius = 13;
    const circleCircumference = +(2 * Math.PI * circleRadius).toFixed(2);
    const cx = 30, cy = 30;
    el.innerHTML = `<svg viewBox="0 0 60 60" width="60" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <circle class="marker-ring" cx="${cx}" cy="${cy}" r="${circleRadius}" fill="none" stroke="#c8ff00" stroke-width="1.8"
                stroke-dasharray="${circleCircumference}" stroke-dashoffset="${circleCircumference}"/>
        <circle class="marker-dot" cx="${cx}" cy="${cy}" r="3.5" fill="white" opacity="0"/>
    </svg>`;
    const ring = el.querySelector('.marker-ring');
    const dot = el.querySelector('.marker-dot');
    let timers = [];
    function after(ms, fn) { const t = setTimeout(fn, ms); timers.push(t); return t; }
    function cancelAllTimers() { timers.forEach(clearTimeout); timers = []; }
    function runIntroAnimation() {
        cancelAllTimers();
        el.dataset['animDone'] = '0';
        el.style.zIndex = '9999';
        ring.style.strokeDashoffset = String(circleCircumference);
        ring.style.animation = 'none';
        dot.style.opacity = '0';
        dot.style.animation = 'none';
        dot.style.fill = 'white';
        after(20, function () {
            ring.style.animation = 'marker-circle-draw 0.5s ease-out forwards';
        });
        after(550, function () {
            dot.style.opacity = '1';
            dot.style.animation = 'marker-dot-pulse 0.2s ease-in-out 2 forwards';
        });
        after(950, function () {
            dot.style.animation = 'none';
            void dot.offsetWidth;
            dot.style.animation = 'marker-dot-end-pulse 0.18s ease-in-out 3 forwards';
            after(540, function () {
                el.dataset['animDone'] = '1';
                el.style.zIndex = '0';
            });
        });
    }
    runIntroAnimation();
    el._replayIntro = runIntroAnimation;
    return el;
}
// ============================================================
// SET USER LOCATION
// ============================================================
function setSpaceUserLocation(position) {
    const { longitude, latitude } = position.coords;
    const isFirstFix = !_spaceUserMarker;
    if (!position._fromCache && !position._manual) {
        try {
            const saved = JSON.parse(localStorage.getItem('userLocation') || 'null');
            if (saved && saved.manual)
                return;
        }
        catch (e) { }
    }
    if (_spaceUserMarker) {
        _spaceUserMarker.setLngLat([longitude, latitude]);
        if (position._manual) {
            const el = _spaceUserMarker.getElement();
            if (typeof el._replayIntro === 'function') el._replayIntro();
        }
    }
    else {
        _spaceUserMarker = new maplibregl.Marker({
            element: _createSpaceUserMarkerElement(),
            anchor: 'center',
        }).setLngLat([longitude, latitude]).addTo(map);
    }
    if (isFirstFix && !position._fromCache) {
        map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 5) });
    }
    spaceUserLocationCenter = [longitude, latitude];
    const _footerLocEl = document.getElementById('footer-location');
    if (_footerLocEl)
        _footerLocEl.textContent = latitude.toFixed(4) + ',  ' + longitude.toFixed(4);
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
}
// ============================================================
// CACHED LOCATION RESTORE
// ============================================================
(function () {
    const cached = localStorage.getItem('userLocation');
    if (!cached)
        return;
    try {
        const parsed = JSON.parse(cached);
        if (parsed.manual || Date.now() - (parsed.ts || 0) < 5 * 60 * 1000) {
            setSpaceUserLocation({ coords: { longitude: parsed.longitude, latitude: parsed.latitude }, _fromCache: true });
        }
        else {
            localStorage.removeItem('userLocation');
        }
    }
    catch (e) {
        localStorage.removeItem('userLocation');
    }
})();
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
    map.on('contextmenu', function (e) {
        removeContextMenu();
        const { lng, lat } = e.lngLat;
        const menu = document.createElement('div');
        menu.style.cssText = [
            'position:absolute',
            'background:#000',
            'border:none',
            'padding:4px 0',
            'font-family:\'Barlow\',\'Helvetica Neue\',Arial,sans-serif',
            'font-size:10px',
            'font-weight:600',
            'letter-spacing:0.16em',
            'text-transform:uppercase',
            'color:rgba(255,255,255,0.75)',
            'z-index:9999',
            'min-width:180px',
            'cursor:default',
        ].join(';');
        menu.style.left = e.point.x + 'px';
        menu.style.top = e.point.y + 'px';
        const item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:8px 16px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', function () { item.style.background = 'rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave', function () { item.style.background = ''; });
        item.addEventListener('click', function () {
            removeContextMenu();
            localStorage.setItem('userLocation', JSON.stringify({
                longitude: lng, latitude: lat, ts: Date.now(), manual: true,
            }));
            setSpaceUserLocation({ coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true });
            window.dispatchEvent(new CustomEvent('sentinel:locationChanged', {
                detail: { longitude: lng, latitude: lat }
            }));
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
window.addEventListener('sentinel:setUserLocation', function (e) {
    const detail = e.detail;
    setSpaceUserLocation({ coords: { longitude: detail.longitude, latitude: detail.latitude }, _fromCache: false, _manual: true });
});
