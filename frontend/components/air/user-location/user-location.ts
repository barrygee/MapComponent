// ============================================================
// AIR USER LOCATION MARKER
// Thin wrapper around the shared user-location module.
//
// Handles:
//   - GPS watchPosition updates from boot.ts
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
//   - Air-domain range ring center updates
//
// Depends on: map (global alias), maplibregl, rangeRingCenter, rangeRingsControl
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

const _airUserLocation = initUserLocation({
    markerClass: 'user-location-marker',
    flyToZoom: 10,
    onGoTo: () => { if (_onGoToUserLocation) _onGoToUserLocation(); },
    onPositionSet: (lng: number, lat: number) => {
        rangeRingCenter = [lng, lat];
        if (rangeRingsControl) rangeRingsControl.updateCenter(lng, lat);
    },
});

/**
 * Fly the map to the user's last known location.
 */
function goToUserLocation(): void {
    _airUserLocation.goToLocation();
}

const setUserLocation = _airUserLocation.setLocation;
(window as any).setUserLocation = setUserLocation;

window.addEventListener('sentinel:setUserLocation', function (e: Event) {
    const detail = (e as CustomEvent).detail as { longitude: number; latitude: number };
    setUserLocation({ coords: { longitude: detail.longitude, latitude: detail.latitude }, _fromCache: false, _manual: true });
});
