// ============================================================
// CLEAR OVERLAYS CONTROL (✕ button)
// Toggles all overlays off in one click, then restores them.
// First click: saves all current states and hides everything.
// Second click: restores all overlays to their saved states.
//
// Depends on:
//   map (global alias),
//   roadsControl, namesControl, rangeRingsControl, aarControl,
//   awacsControl, airportsControl, rafControl, adsbControl,
//   adsbLabelsControl, _saveOverlayStates, _syncSideMenuForPlanes
// ============================================================

class ClearOverlaysControl {
    constructor() {
        this.cleared     = false; // true = all overlays currently hidden
        this.savedStates = null;  // snapshot of each control's state before clearing
    }

    onAdd(map) {
        this.map = map;

        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        // Dimmed white at rest; turns lime when "cleared" (all hidden)
        this.button = document.createElement('button');
        this.button.title       = 'Toggle all overlays';
        this.button.textContent = '✕';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:14px;color:#fff;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s;opacity:0.3';
        this.button.onclick     = () => this.toggle();
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

    toggle() {
        if (!this.cleared) {
            this._hideAllOverlays();
        } else {
            this._restoreAllOverlays();
        }
    }

    /**
     * Snapshot current states, then turn off every overlay.
     * ADS-B is handled specially: setAllHidden() keeps the poll running but hides the icons.
     */
    _hideAllOverlays() {
        // Capture current state of every control before hiding
        this.savedStates = {
            roads:      roadsControl      ? roadsControl.roadsVisible       : false,
            names:      namesControl      ? namesControl.namesVisible        : false,
            rings:      rangeRingsControl ? rangeRingsControl.ringsVisible   : false,
            aar:        aarControl        ? aarControl.visible               : false,
            awacs:      awacsControl      ? awacsControl.visible             : false,
            airports:   airportsControl   ? airportsControl.visible          : false,
            raf:        rafControl        ? rafControl.visible               : false,
            adsb:       adsbControl       ? adsbControl.visible              : false,
            adsbLabels: adsbLabelsControl ? adsbLabelsControl.labelsVisible  : false,
        };

        // Turn off each overlay that is currently on
        if (roadsControl      && roadsControl.roadsVisible)      roadsControl.toggleRoads();
        if (namesControl      && namesControl.namesVisible)       namesControl.toggleNames();
        if (rangeRingsControl && rangeRingsControl.ringsVisible)  rangeRingsControl.toggleRings();
        if (aarControl        && aarControl.visible)              aarControl.toggle();
        if (awacsControl      && awacsControl.visible)            awacsControl.toggle();
        if (airportsControl   && airportsControl.visible)         airportsControl.toggle();
        if (rafControl        && rafControl.visible)              rafControl.toggle();

        if (adsbControl && adsbControl.visible) {
            // setAllHidden(true) hides icons without stopping the poll
            // so aircraft data stays current when we restore
            adsbControl.setAllHidden(true);
            adsbControl.setLabelsVisible(false);
            // Keep trails visible if we're actively following an aircraft
            const keepTrails = adsbControl._followEnabled && adsbControl._selectedHex;
            if (!keepTrails) {
                try { adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'none'); } catch (e) {}
            }
        }

        this.cleared = true;
        this.button.style.opacity = '1';
        this.button.style.color   = '#c8ff00'; // lime = active / cleared state
    }

    /**
     * Restore every overlay to the state it was in before _hideAllOverlays().
     */
    _restoreAllOverlays() {
        if (!this.savedStates) { this.cleared = false; return; }
        const s = this.savedStates;

        // Re-enable each overlay only if it was on before clearing
        if (roadsControl      && s.roads      && !roadsControl.roadsVisible)      roadsControl.toggleRoads();
        if (namesControl      && s.names      && !namesControl.namesVisible)       namesControl.toggleNames();
        if (rangeRingsControl && s.rings      && !rangeRingsControl.ringsVisible)  rangeRingsControl.toggleRings();
        if (aarControl        && s.aar        && !aarControl.visible)              aarControl.toggle();
        if (awacsControl      && s.awacs      && !awacsControl.visible)            awacsControl.toggle();
        if (airportsControl   && s.airports   && !airportsControl.visible)         airportsControl.toggle();
        if (rafControl        && s.raf        && !rafControl.visible)              rafControl.toggle();

        if (adsbControl && s.adsb) {
            adsbControl.setAllHidden(false); // un-hide aircraft icons
            try { adsbControl.map.setLayoutProperty('adsb-trails', 'visibility', 'visible'); } catch (e) {}
            if (adsbLabelsControl) {
                // Restore the exact labels state that was saved
                adsbLabelsControl.labelsVisible        = s.adsbLabels;
                adsbLabelsControl.button.style.opacity = s.adsbLabels ? '1'       : '0.3';
                adsbLabelsControl.button.style.color   = s.adsbLabels ? '#c8ff00' : '#ffffff';
                adsbControl.setLabelsVisible(s.adsbLabels);
            }
            _saveOverlayStates();
        }

        this.cleared = false;
        this.button.style.opacity = '0.3';   // back to dimmed white
        this.button.style.color   = '#ffffff';

        // Sync the side-menu PLANES/CALLSIGN button active states
        if (typeof _syncSideMenuForPlanes === 'function') _syncSideMenuForPlanes();
    }
}

clearControl = new ClearOverlaysControl();
map.addControl(clearControl, 'top-right');
