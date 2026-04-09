// ============================================================
// SDR RADIO TAB
// Mounts the SDR panel content into the map-sidebar RADIO pane
// on non-SDR pages (air, space, sea, land).
//
// sdr-panel.js must be loaded before this script.
// Depends on: sdr-globals.js, sdr-panel.js, sdr-audio.js, sdr-mini-boot.js
// ============================================================

/// <reference path="./globals.d.ts" />

(function initSdrRadioTab() {

    // Only run on non-SDR pages
    if (document.body.dataset['domain'] === 'sdr') return;

    function mount() {
        const pane = document.getElementById('msb-pane-radio');
        if (!pane) return;

        // _buildSdrPanel is exposed by sdr-panel.js on non-SDR pages
        if (typeof (window as any)._buildSdrPanel === 'function') {
            (window as any)._buildSdrPanel(pane);
        }

        // sdr-mini-boot may have loaded radios before the panel was mounted;
        // populate the newly-built dropdown with the cached list now.
        const cached = (window as any)._sdrCachedRadios;
        if (cached && typeof (window as any)._sdrPopulateRadios === 'function') {
            (window as any)._sdrPopulateRadios(cached);
        }
    }

    // Mount after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

})();
