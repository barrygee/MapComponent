"use strict";
// ============================================================
// RESET VIEW CONTROL
// Fly-to-home button: centres the map on the Irish Sea / central UK
// at zoom 6, pitch 0, bearing 0.
//
// Depends on: map (global alias)
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />
const HOME_CENTER = [-4.4815, 54.1453];
const HOME_ZOOM = 6;
class ResetViewControl extends SentinelControlBase {
    get buttonLabel() {
        return `<svg viewBox="14 15 32 30" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
            <polyline points="21,17 16,17 16,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,17 44,17 44,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="21,43 16,43 16,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,43 44,43 44,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <rect x="28" y="28" width="4" height="4" fill="white"/>
        </svg>`;
    }
    get buttonTitle() { return 'Reset view to home'; }
    onInit() {
        // No layers to initialise — button only
    }
    handleClick() {
        this.map.flyTo({ center: HOME_CENTER, zoom: HOME_ZOOM, pitch: 0, bearing: 0 });
    }
}
map.addControl(new ResetViewControl(), 'top-right');
