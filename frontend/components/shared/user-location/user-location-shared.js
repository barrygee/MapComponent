"use strict";
// ============================================================
// SHARED USER LOCATION LOGIC
// Provides GPS marker, localStorage cache/restore, and
// right-click context menu for both air and space domains.
//
// Call initUserLocation(config) once per domain to activate.
// ============================================================
/// <reference path="../globals.d.ts" />
// ── Internal helpers ──────────────────────────────────────────────────────────
function _createMarkerElement(markerClass) {
    const el = document.createElement('div');
    el.classList.add(markerClass);
    const cx = 30, cy = 30, r = 13;
    el.innerHTML = `<svg viewBox="0 0 60 60" width="60" height="60" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c8ff00" stroke-width="1.8"/>
        <circle cx="${cx}" cy="${cy}" r="3.5" fill="white"/>
    </svg>`;
    return el;
}
function _buildContextMenu(e, onSetLocation) {
    const { lng, lat } = e.lngLat;
    const menu = document.createElement('div');
    menu.classList.add('sentinel-context-menu');
    menu.style.left = e.point.x + 'px';
    menu.style.top = e.point.y + 'px';
    const item = document.createElement('div');
    item.classList.add('sentinel-context-menu-item');
    item.textContent = 'Set my location here';
    item.addEventListener('click', () => onSetLocation(lng, lat));
    menu.appendChild(item);
    return menu;
}
// ── Public factory ────────────────────────────────────────────────────────────
function initUserLocation(config) {
    let _marker = null;
    let _center = null;
    function _updateFooter(lat, lng) {
        const el = document.getElementById('footer-location');
        if (el)
            el.textContent = lat.toFixed(4) + ',  ' + lng.toFixed(4);
    }
    function setLocation(position) {
        const { longitude, latitude } = position.coords;
        const isFirstFix = !_marker;
        if (!position._fromCache && !position._manual) {
            try {
                const saved = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (saved && saved.manual)
                    return;
            }
            catch (e) { }
        }
        if (_marker) {
            _marker.setLngLat([longitude, latitude]);
        }
        else {
            _marker = new maplibregl.Marker({
                element: _createMarkerElement(config.markerClass),
                anchor: 'center',
            }).setLngLat([longitude, latitude]).addTo(map);
        }
        if (isFirstFix && !position._fromCache) {
            map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), config.flyToZoom) });
        }
        _center = [longitude, latitude];
        _updateFooter(latitude, longitude);
        if (config.onPositionSet)
            config.onPositionSet(longitude, latitude);
        if (!position._manual) {
            try {
                const existing = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (!(existing && existing.manual)) {
                    localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
                }
            }
            catch (e) {
                localStorage.setItem('userLocation', JSON.stringify({ longitude, latitude, ts: Date.now() }));
            }
        }
        localStorage.setItem('geolocationGranted', 'true');
    }
    function goToLocation() {
        if (_center) {
            map.flyTo({ center: _center, zoom: config.flyToZoom });
            if (config.onGoTo)
                config.onGoTo();
        }
        else if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: config.flyToZoom });
                if (config.onGoTo)
                    config.onGoTo();
            });
        }
    }
    function getCenter() {
        return _center;
    }
    // ── Cached location restore ───────────────────────────────────────────────
    const _cached = localStorage.getItem('userLocation');
    if (_cached) {
        try {
            const parsed = JSON.parse(_cached);
            if (parsed.manual || Date.now() - (parsed.ts || 0) < 5 * 60 * 1000) {
                setLocation({ coords: { longitude: parsed.longitude, latitude: parsed.latitude }, _fromCache: true });
            }
            else {
                localStorage.removeItem('userLocation');
            }
        }
        catch (e) {
            localStorage.removeItem('userLocation');
        }
    }
    // ── Right-click context menu ──────────────────────────────────────────────
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
            const menu = _buildContextMenu(e, (menuLng, menuLat) => {
                removeContextMenu();
                localStorage.setItem('userLocation', JSON.stringify({
                    longitude: menuLng, latitude: menuLat, ts: Date.now(), manual: true,
                }));
                setLocation({ coords: { longitude: menuLng, latitude: menuLat }, _fromCache: false, _manual: true });
                window.dispatchEvent(new CustomEvent('sentinel:locationChanged', {
                    detail: { longitude: menuLng, latitude: menuLat }
                }));
            });
            map.getContainer().appendChild(menu);
            _activeMenu = menu;
            document.addEventListener('click', removeContextMenu, { once: true });
            document.addEventListener('keydown', removeContextMenu, { once: true });
            map.on('move', removeContextMenu);
            map.on('zoom', removeContextMenu);
        });
    })();
    return { setLocation, goToLocation, getCenter };
}
