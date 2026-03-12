// ============================================================
// RESET VIEW CONTROL
// Fly-to-home button: centres the map on the Irish Sea / central UK
// at zoom 6, pitch 0, bearing 0.
//
// Depends on: map (global alias)
// ============================================================

// Home position — Irish Sea / central UK, chosen as a good overview of the coverage area
const HOME_CENTER = [-4.4815, 54.1453];
const HOME_ZOOM   = 6;

class ResetViewControl {
    onAdd(map) {
        this.map = map;

        // Wrapper container required by the MapLibre control API
        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        // Button uses the SENTINEL corner-bracket SVG as its icon
        this.button = document.createElement('button');
        this.button.title     = 'Reset view to home';
        this.button.innerHTML = `<svg viewBox="14 15 32 30" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
            <!-- Four corner brackets forming the SENTINEL logo shape -->
            <polyline points="21,17 16,17 16,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,17 44,17 44,22" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="21,43 16,43 16,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <polyline points="39,43 44,43 44,38" fill="none" stroke="#c8ff00" stroke-width="2" stroke-linecap="square"/>
            <!-- Centre dot -->
            <rect x="28" y="28" width="4" height="4" fill="white"/>
        </svg>`;
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s';
        this.button.onclick     = () => {
            // Return to home position with flat pitch and north-up bearing
            this.map.flyTo({ center: HOME_CENTER, zoom: HOME_ZOOM, pitch: 0, bearing: 0 });
        };
        this.button.onmouseover = () => { this.button.style.background = '#111'; };
        this.button.onmouseout  = () => { this.button.style.background = '#000'; };

        this.container.appendChild(this.button);
        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = undefined;
    }
}

// Register with MapLibre — this control is not stored in a global because it has no
// stateful toggle (no visibility to restore or save).
map.addControl(new ResetViewControl(), 'top-right');
