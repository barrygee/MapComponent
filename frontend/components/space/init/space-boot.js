"use strict";
// ============================================================
// SPACE BOOT / PAGE INITIALISATION
// The final script in the space domain load order.
//
// Exposes:
//   window._domainMount()    — called by router on every space visit
//   window._domainTeardown() — called by router before leaving space
//
// Dependencies: window._MapSidebar, window._Notifications, window._Tracking,
//               window._SpaceFilterPanel, window._SpacePassesPanel,
//               window._SatInfoPanel, map (global alias)
// ============================================================
/// <reference path="../globals.d.ts" />

// Starfield move handler reference — stored so it can be removed on teardown
var _starfieldMoveHandler = null;

// ---- Starfield setup (called on each space domain mount) ----
function _startStarfield() {
    var canvasEl = document.getElementById('space-starfield');
    if (!canvasEl) return;
    var canvas = canvasEl;
    var ctxOrNull = canvas.getContext('2d');
    if (!ctxOrNull) return;
    var ctx = ctxOrNull;
    var STAR_COUNT = 320;
    var stars = [];
    var canvasWidth = 0, canvasHeight = 0;
    var offsetX = 0, offsetY = 0;

    function _resize() {
        canvasWidth = canvas.width = window.innerWidth;
        canvasHeight = canvas.height = window.innerHeight;
    }
    function _seed() {
        stars = [];
        for (var i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: Math.random() * canvasWidth,
                y: Math.random() * canvasHeight,
                r: Math.random() * 1.1 + 0.2,
                a: Math.random() * 0.55 + 0.15,
            });
        }
    }
    function _draw() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        for (var s of stars) {
            var px = ((s.x + offsetX) % canvasWidth + canvasWidth) % canvasWidth;
            var py = ((s.y + offsetY) % canvasHeight + canvasHeight) % canvasHeight;
            ctx.beginPath();
            ctx.arc(px, py, s.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,' + s.a + ')';
            ctx.fill();
        }
    }

    _resize();
    _seed();
    _draw();

    var _resizeHandler = function () { _resize(); _seed(); _draw(); };
    // Remove any previous listener before adding the new one (repeat mount guard)
    if (canvas._resizeHandler) window.removeEventListener('resize', canvas._resizeHandler);
    window.addEventListener('resize', _resizeHandler);

    var _lastBearing = 0;
    var _lastCenter = null;
    _starfieldMoveHandler = function () {
        var bearing = map.getBearing();
        var center = map.getCenter();
        var deltaBearing = bearing - _lastBearing;
        var deltaLng = _lastCenter ? (center.lng - _lastCenter.lng) : 0;
        var deltaLat = _lastCenter ? (center.lat - _lastCenter.lat) : 0;
        offsetX += deltaBearing * 1.4 - deltaLng * 1.8;
        offsetY += deltaLat * 1.8;
        _lastBearing = bearing;
        _lastCenter = center;
        _draw();
    };
    map.on('move', _starfieldMoveHandler);

    // Store resize handler on the canvas so teardown can remove it
    canvas._resizeHandler = _resizeHandler;
}

window._domainMount = function () {
    // ---- 0. Restore space side-menu visibility ----
    const spaceSideMenu = document.getElementById('space-side-menu');
    if (spaceSideMenu) spaceSideMenu.style.display = '';

    // ---- 1. No-TLE overlay button (guard duplicate) ----
    if (!window._spaceNoTleWired) {
        window._spaceNoTleWired = true;
        var btn = document.getElementById('no-tle-overlay-btn');
        if (btn) {
            btn.addEventListener('click', function () {
                if (window._SettingsPanel && window._SettingsPanel.openSection) {
                    window._SettingsPanel.openSection('space');
                } else if (window._SettingsPanel) {
                    window._SettingsPanel.open();
                }
            });
        }
    }

    // ---- 2. Panel initialisation ----
    if (typeof window._MapSidebar !== 'undefined') {
        window._MapSidebar.init({ trackingEmptyText: 'No tracked satellites' });
    }
    if (typeof window._Notifications !== 'undefined') {
        window._Notifications.init();
    }
    if (typeof window._Tracking !== 'undefined') {
        window._Tracking.init();
    }
    if (typeof window._SpaceFilterPanel !== 'undefined') {
        window._SpaceFilterPanel.init();
    }
    if (typeof window._SpacePassesPanel !== 'undefined') {
        window._SpacePassesPanel.init();
    }
    if (typeof window._SatInfoPanel !== 'undefined') {
        window._SatInfoPanel.init();
    }

    // ---- 2b. Re-add controls and re-init layers on each mount ----
    // Scripts load once (router caches them), so controls are removed on teardown
    // but not re-constructed. Re-add them here so this.map is set, then init layers.
    if (daynightControl && !daynightControl.map) {
        map.addControl(daynightControl, 'top-right');
        daynightControl.initLayers();
        daynightControl._fetch();
    }
    if (issControl && !issControl.map) {
        map.addControl(issControl, 'top-right');
        issControl.initLayers();
        if (!issControl.issVisible) issControl.toggleIss();
        issControl._fetch();
        issControl._startPolling();
    }
    if (spaceNamesControl && !spaceNamesControl.map) {
        map.addControl(spaceNamesControl, 'top-right');
        spaceNamesControl.applyNamesVisibility();
    }
    if (typeof _spaceGlobeActive !== 'undefined' && _spaceGlobeActive) {
        try { map.setProjection({ type: 'globe' }); } catch (e) {}
    }

    // ---- 2c. Sync space overlay states from backend (after controls are ready) ----
    if (map.isStyleLoaded()) {
        if (typeof _syncSpaceOverlayStatesFromBackend === 'function') {
            _syncSpaceOverlayStatesFromBackend();
        }
    } else {
        map.once('style.load', function () {
            if (typeof _syncSpaceOverlayStatesFromBackend === 'function') {
                _syncSpaceOverlayStatesFromBackend();
            }
        });
    }

    // ---- 3. Starfield backdrop ----
    _startStarfield();
};

window._domainTeardown = function () {
    // Stop starfield parallax map listener
    if (_starfieldMoveHandler) {
        map.off('move', _starfieldMoveHandler);
        _starfieldMoveHandler = null;
    }
    // Remove starfield resize listener
    var canvasEl = document.getElementById('space-starfield');
    if (canvasEl && canvasEl._resizeHandler) {
        window.removeEventListener('resize', canvasEl._resizeHandler);
        canvasEl._resizeHandler = null;
    }

    // Hide the space side-menu panel
    const spaceSideMenu = document.getElementById('space-side-menu');
    if (spaceSideMenu) spaceSideMenu.style.display = 'none';

    // Stop ISS polling before removing controls
    if (issControl && issControl._stopPolling) issControl._stopPolling();

    // Remove space map layers/sources so they don't bleed into other domains
    ['iss-track-orbit1', 'iss-track-orbit2', 'iss-track-past', 'iss-track-future',
     'iss-footprint-fill', 'iss-footprint',
     'iss-footprint-fill-outer', 'iss-footprint-fill-mid', 'iss-footprint-fill-inner', 'iss-footprint-fill-core',
     'iss-bracket', 'iss-icon', 'daynight-fill'].forEach(function (id) {
        try { map.removeLayer(id); } catch (e) {}
    });
    ['iss-track-source', 'iss-footprint-source', 'iss-live', 'daynight-source'].forEach(function (id) {
        try { if (map.getSource(id)) map.removeSource(id); } catch (e) {}
    });

    // Remove space controls from the map
    [daynightControl, issControl, spaceNamesControl].forEach(function (c) {
        if (c) { try { map.removeControl(c); } catch (e) {} }
    });

    // Clear the search pane so the next domain can inject its own filter UI
    const searchPane = document.getElementById('msb-pane-search');
    if (searchPane) searchPane.innerHTML = '';

    // Reset globe projection to mercator so other domains render correctly
    try { map.setProjection({ type: 'mercator' }); } catch (e) {}

    // Clear style-load callbacks so the next domain starts clean
    if (window.MapComponent && window.MapComponent.clearStyleLoadCallbacks) {
        window.MapComponent.clearStyleLoadCallbacks();
    }
};

// Register with router so repeated visits call the correct handlers
if (typeof window._registerDomain === 'function') {
    window._registerDomain('space', window._domainMount, window._domainTeardown);
}

// Self-call on initial load (router calls _domainMount on repeat visits)
window._domainMount();
