"use strict";
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
    // Mount the SDR panel into the map-sidebar RADIO pane on non-SDR pages.
    // This function is called at shell load time AND exposed as window._mountSdrRadioTab
    // so the router can call it when navigating to a non-SDR domain from SDR.
    function mount() {
        // Skip on SDR page — sdr-boot.js builds the standalone panel there
        if (document.body.dataset['domain'] === 'sdr') return;
        const pane = document.getElementById('msb-pane-radio');
        if (!pane) return;
        // Only mount if the pane is empty (avoid double-mounting on repeat visits)
        if (pane.children.length > 0) return;
        if (typeof window._buildSdrPanel === 'function') {
            window._buildSdrPanel(pane);
        }
        if (typeof window._sdrLoadRadios === 'function') {
            window._sdrLoadRadios();
        }
    }
    window._mountSdrRadioTab = mount;
    // Mount after DOM is ready on initial page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
