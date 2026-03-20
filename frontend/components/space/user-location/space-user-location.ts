// ============================================================
// SPACE USER LOCATION MARKER
// Thin wrapper around the shared user-location module.
//
// Handles:
//   - GPS watchPosition updates from space-boot.ts
//   - Cached location restore on page load (5-minute expiry for GPS, no expiry for manual)
//   - Manual location override via right-click context menu
//
// Depends on: map (global alias), maplibregl, spaceUserLocationCenter
// ============================================================

/// <reference path="../globals.d.ts" />

const _spaceUserLocation = initUserLocation({
    markerClass: 'space-user-location-marker',
    flyToZoom: 5,
    onGoTo: () => { if (_onGoToSpaceUserLocation) _onGoToSpaceUserLocation(); },
    onPositionSet: (lng: number, lat: number) => {
        spaceUserLocationCenter = [lng, lat];
    },
});

/**
 * Fly the map to the user's last known location.
 */
function goToSpaceUserLocation(): void {
    _spaceUserLocation.goToLocation();
}

function setSpaceUserLocation(position: { coords: { longitude: number; latitude: number }; _fromCache?: boolean; _manual?: boolean }): void {
    _spaceUserLocation.setLocation(position);
}

window.addEventListener('sentinel:setUserLocation', function (e: Event) {
    const detail = (e as CustomEvent).detail as { longitude: number; latitude: number };
    setSpaceUserLocation({ coords: { longitude: detail.longitude, latitude: detail.latitude }, _fromCache: false, _manual: true });
});
