"use strict";
// ============================================================
// BOOT / PAGE INITIALISATION
// The final script in the air domain load order.
//
// Exposes:
//   window._domainMount()    — called by router on every air visit
//   window._domainTeardown() — called by router before leaving air
//
// Dependencies: window._Notifications, window._Tracking,
//               window._FilterPanel, window._MapSidebar, map (global alias)
// ============================================================
/// <reference path="../globals.d.ts" />

window._domainMount = function () {
    // ---- 0. Restore air side-menu visibility ----
    const sideMenu = document.getElementById('side-menu');
    if (sideMenu) sideMenu.style.display = '';

    // ---- 1. Restore 3D pitch ----
    if (map.isStyleLoaded()) {
        if (typeof window._is3DActive === 'function' && window._is3DActive()) {
            map.easeTo({ pitch: 45, duration: 400 });
        }
    } else {
        map.once('style.load', () => {
            if (typeof window._is3DActive === 'function' && window._is3DActive()) {
                map.easeTo({ pitch: 45, duration: 400 });
            }
        });
    }

    // ---- 2. Panel initialisation ----
    window._MapSidebar.init({ trackingEmptyText: 'No tracked aircraft' });
    window._Notifications.init();
    window._Tracking.init();
    window._FilterPanel.init();

    // ---- 3. Global filter shortcut (register only once) ----
    if (!window._airFilterShortcutRegistered) {
        window._airFilterShortcutRegistered = true;
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                window._FilterPanel.toggle();
            }
        });
    }
};

window._domainTeardown = function () {
    // Hide the air side-menu panel (persists on body between domain visits)
    const sideMenu = document.getElementById('side-menu');
    if (sideMenu) sideMenu.style.display = 'none';

    // Stop ADS-B polling and interpolation
    if (adsbControl && adsbControl._stopPolling) adsbControl._stopPolling();
    if (adsbControl && adsbControl._stopInterpolation) adsbControl._stopInterpolation();

    // Remove all air map controls
    [roadsControl, namesControl, rangeRingsControl, aarControl, awacsControl,
     airportsControl, militaryBasesControl, adsbControl, adsbLabelsControl, clearControl]
        .forEach(function (c) { if (c) { try { map.removeControl(c); } catch (e) {} } });

    // Remove layers first, then sources (MapLibre rejects removeSource while a layer uses it)
    ['adsb-trails', 'adsb-bracket', 'adsb-icons',
     'range-rings-lines',
     'awacs-fill', 'awacs-outline',
     'aara-fill', 'aara-outline']
        .forEach(function (id) { try { map.removeLayer(id); } catch (e) {} });
    ['adsb-live', 'adsb-trails-source',
     'range-rings-lines',
     'airports', 'military-bases',
     'awacs-orbits', 'aara-zones']
        .forEach(function (id) { try { map.removeSource(id); } catch (e) {} });

    // Clear the search pane so the next domain can inject its own filter UI
    const searchPane = document.getElementById('msb-pane-search');
    if (searchPane) searchPane.innerHTML = '';

    // Clear style-load callbacks so next domain starts clean
    if (window.MapComponent && window.MapComponent.clearStyleLoadCallbacks) {
        window.MapComponent.clearStyleLoadCallbacks();
    }
};

// Self-call on initial load (router calls _domainMount on repeat visits)
window._domainMount();
