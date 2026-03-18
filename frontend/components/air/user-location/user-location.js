"use strict";
// ============================================================
// USER LOCATION MARKER
// Animated SVG marker showing the user's GPS position on the map.
//
// Handles:
//   - GPS watchPosition updates from boot.ts
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
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
function createUserMarkerElement() {
    const el = document.createElement('div');
    el.style.width = '60px';
    el.style.height = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.classList.add('user-location-marker');
    const cx = 30, cy = 30, r = 13;
    el.innerHTML = `<svg viewBox="0 0 60 60" width="60" height="60" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c8ff00" stroke-width="1.8"/>
        <circle cx="${cx}" cy="${cy}" r="3.5" fill="white"/>
    </svg>`;
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
        }
        else {
            userMarker = new maplibregl.Marker({
                element: createUserMarkerElement(),
                anchor: 'center',
            }).setLngLat([longitude, latitude]).addTo(map);
        }
        if (isFirstFix && !position._fromCache) {
            map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10) });
        }
        rangeRingCenter = [longitude, latitude];
        if (rangeRingsControl)
            rangeRingsControl.updateCenter(longitude, latitude);
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
    return fn;
})();
window.setUserLocation = setUserLocation;
window.addEventListener('sentinel:setUserLocation', function (e) {
    const detail = e.detail;
    setUserLocation({ coords: { longitude: detail.longitude, latitude: detail.latitude }, _fromCache: false, _manual: true });
});
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
            'box-shadow:0 4px 20px rgba(0,0,0,0.9)',
            'min-width:180px',
            'cursor:default',
        ].join(';');
        menu.style.left = e.point.x + 'px';
        menu.style.top = e.point.y + 'px';
        const item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:8px 16px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
            removeContextMenu();
            localStorage.setItem('userLocation', JSON.stringify({
                longitude: lng, latitude: lat, ts: Date.now(), manual: true,
            }));
            setUserLocation({ coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true });
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
