// ============================================================
// ADS-B LABELS TOGGLE CONTROL
// Toggles the visibility of aircraft callsign label markers.
// Syncs with the main ADS-B toggle: labels are hidden when
// the ADS-B feed itself is disabled.
//
// Depends on: map (global alias), adsbControl, _overlayStates, _saveOverlayStates
// ============================================================

class AdsbLabelsToggleControl {
    constructor() {
        // Read persisted visibility state; default true if not yet saved
        this.labelsVisible = _overlayStates.adsbLabels ?? true;
    }

    onAdd(map) {
        this.map = map;

        this.container = document.createElement('div');
        this.container.className  = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        // Determine initial button state based on both ADS-B visibility and labels visibility
        const adsbIsOn = adsbControl ? adsbControl.visible : true;

        this.button = document.createElement('button');
        this.button.title       = 'Toggle aircraft labels';
        this.button.textContent = 'L';
        this.button.style.cssText = 'width:29px;height:29px;border:none;background:#000;cursor:pointer;font-size:16px;font-weight:bold;display:flex;align-items:center;justify-content:center;transition:opacity 0.2s,color 0.2s';
        // Labels button is only interactive when ADS-B is on
        this.button.style.opacity      = (adsbIsOn && this.labelsVisible) ? '1'       : '0.3';
        this.button.style.color        = (adsbIsOn && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        this.button.style.pointerEvents = adsbIsOn ? 'auto' : 'none';
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

    /** Toggle label visibility and tell the ADS-B control to show/hide callsign markers. */
    toggle() {
        this.labelsVisible = !this.labelsVisible;
        this.button.style.opacity = this.labelsVisible ? '1'       : '0.3';
        this.button.style.color   = this.labelsVisible ? '#c8ff00' : '#ffffff';
        if (adsbControl) adsbControl.setLabelsVisible(this.labelsVisible);
        _saveOverlayStates();
    }

    /**
     * Called by the ADS-B control (and side-menu.js) when the ADS-B feed is turned on/off.
     * Enables or disables the labels button to match the ADS-B state.
     * @param {boolean} adsbVisible  Whether the ADS-B feed is currently on
     */
    syncToAdsb(adsbVisible) {
        if (!this.button) return;
        this.button.style.pointerEvents = adsbVisible ? 'auto' : 'none';
        this.button.style.opacity       = (adsbVisible && this.labelsVisible) ? '1'       : '0.3';
        this.button.style.color         = (adsbVisible && this.labelsVisible) ? '#c8ff00' : '#ffffff';
        // Immediately apply current label visibility state to ADS-B markers
        if (adsbVisible) adsbControl.setLabelsVisible(this.labelsVisible);
    }
}

adsbLabelsControl = new AdsbLabelsToggleControl();
map.addControl(adsbLabelsControl, 'top-right');
