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
        navigator.geolocation.getCurrentPosition(function (pos) {
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 10 });
            if (_onGoToUserLocation)
                _onGoToUserLocation();
        });
    }
}
// The single MapLibre Marker for the user's position
var userMarker = null;
function createUserMarkerElement(longitude, latitude, skipIntro) {
    if (skipIntro === void 0) { skipIntro = false; }
    var el = document.createElement('div');
    el.style.width = '60px';
    el.style.height = '60px';
    el.style.overflow = 'visible';
    el.style.position = 'relative';
    el.style.zIndex = '9999';
    el.classList.add('user-location-marker');
    var circleRadius = 13;
    var circleCircumference = +(2 * Math.PI * circleRadius).toFixed(2);
    var circleCenterX = 30;
    var circleCenterY = 30;
    el.innerHTML = "<svg viewBox=\"0 0 60 60\" width=\"60\" height=\"60\" xmlns=\"http://www.w3.org/2000/svg\" style=\"overflow:visible\">\n        <circle class=\"marker-ring\" cx=\"".concat(circleCenterX, "\" cy=\"").concat(circleCenterY, "\" r=\"").concat(circleRadius, "\" fill=\"none\" stroke=\"#c8ff00\" stroke-width=\"1.8\"\n                stroke-dasharray=\"").concat(circleCircumference, "\" stroke-dashoffset=\"").concat(circleCircumference, "\"/>\n        <circle class=\"marker-dot\" cx=\"").concat(circleCenterX, "\" cy=\"").concat(circleCenterY, "\" r=\"3.5\" fill=\"white\" opacity=\"0\"/>\n    </svg>");
    var ring = el.querySelector('.marker-ring');
    var dot = el.querySelector('.marker-dot');
    var timers = [];
    var after = function (ms, fn) { var t = setTimeout(fn, ms); timers.push(t); return t; };
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
    if (!skipIntro)
        runIntroAnimation();
    else {
        el.dataset['animDone'] = '1';
        el.style.zIndex = '0';
    }
    el._replayIntro = runIntroAnimation;
    return el;
}
var setUserLocation = (function () {
    function fn(position) {
        var _a = position.coords, longitude = _a.longitude, latitude = _a.latitude;
        var isFirstFix = !userMarker;
        console.log('[location] setUserLocation called', { longitude: longitude, latitude: latitude, isFirstFix: isFirstFix, fromCache: !!position._fromCache });
        if (!position._fromCache && !position._manual) {
            try {
                var saved = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (saved && saved.manual)
                    return;
            }
            catch (e) { }
        }
        if (userMarker) {
            userMarker.setLngLat([longitude, latitude]);
            var el = userMarker.getElement();
            el.dataset['lat'] = latitude.toFixed(3);
            el.dataset['lon'] = longitude.toFixed(3);
            if (position._manual && typeof el._replayIntro === 'function') {
                el._replayIntro();
            }
        }
        else {
            userMarker = new maplibregl.Marker({
                element: createUserMarkerElement(longitude, latitude, !!position._fromCache),
                anchor: 'center',
            }).setLngLat([longitude, latitude]).addTo(map);
        }
        if (isFirstFix && !position._fromCache) {
            map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 10) });
        }
        rangeRingCenter = [longitude, latitude];
        if (rangeRingsControl)
            rangeRingsControl.updateCenter(longitude, latitude);
        var _footerLocEl = document.getElementById('footer-location');
        if (_footerLocEl)
            _footerLocEl.textContent = latitude.toFixed(4) + ',  ' + longitude.toFixed(4);
        if (!position._manual) {
            try {
                var existing = JSON.parse(localStorage.getItem('userLocation') || 'null');
                if (existing && existing.manual) {
                    // Never overwrite a manual pin with a GPS cache write
                }
                else {
                    localStorage.setItem('userLocation', JSON.stringify({ longitude: longitude, latitude: latitude, ts: Date.now() }));
                }
            }
            catch (e) {
                localStorage.setItem('userLocation', JSON.stringify({ longitude: longitude, latitude: latitude, ts: Date.now() }));
            }
        }
        localStorage.setItem('geolocationGranted', 'true');
    }
    return fn;
})();
window.setUserLocation = setUserLocation;
window.addEventListener('sentinel:setUserLocation', function (e) {
    var detail = e.detail;
    setUserLocation({ coords: { longitude: detail.longitude, latitude: detail.latitude }, _fromCache: false, _manual: true });
});
// ============================================================
// CACHED LOCATION RESTORE
// ============================================================
var _cachedLocation = localStorage.getItem('userLocation');
if (_cachedLocation) {
    try {
        var parsed = JSON.parse(_cachedLocation);
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
    var _activeMenu = null;
    function removeContextMenu() {
        if (_activeMenu) {
            _activeMenu.remove();
            _activeMenu = null;
        }
    }
    map.on('contextmenu', function (e) {
        removeContextMenu();
        var _a = e.lngLat, lng = _a.lng, lat = _a.lat;
        var menu = document.createElement('div');
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
        var item = document.createElement('div');
        item.textContent = 'Set my location here';
        item.style.cssText = 'padding:8px 16px;cursor:pointer;white-space:nowrap;';
        item.addEventListener('mouseenter', function () { item.style.background = 'rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave', function () { item.style.background = ''; });
        item.addEventListener('click', function () {
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
