// ============================================================
// TRACKING — Shared panel component
// Manages the tracking panel open/close state and aircraft count badge.
// Mutually exclusive with the Notifications panel (tab behaviour).
//
// Exposed as window._Tracking so any script can call
// _Tracking.openPanel() etc. without ES module imports.
//
// PUBLIC API:
//   openPanel()  — show panel; closes Notifications
//   closePanel() — hide panel
//   toggle()     — flip open/close
//   setCount(n)  — update aircraft count badge (0 disables the button)
//   init()       — attach click handler and initialise badge
//
// DOM elements used: #tracking-panel, #tracking-toggle-btn, #tracking-count
//
// Self-injects panel HTML if #tracking-panel is absent from the DOM.
// ============================================================

window._Tracking = (() => {
    let _count = 0; // current number of tracked aircraft

    // Panel HTML injected into pages that don't have it as static HTML.
    // #adsb-status-bar is the aircraft detail card rendered by adsb.js.
    const PANEL_HTML = `<div id="tracking-panel"><div id="adsb-status-bar"></div></div>`;

    // ---- DOM accessors ----
    /** @returns {HTMLElement|null} #tracking-panel */
    function _getPanel() { return document.getElementById('tracking-panel'); }
    /** @returns {HTMLElement|null} #tracking-toggle-btn */
    function _getBtn()   { return document.getElementById('tracking-toggle-btn'); }
    /** @returns {HTMLElement|null} #tracking-count badge span */
    function _getCount() { return document.getElementById('tracking-count'); }

    /** @returns {boolean} True if the panel has the .tracking-panel-open class */
    function _isPanelOpen() {
        const p = _getPanel();
        return p ? p.classList.contains('tracking-panel-open') : false;
    }

    /**
     * Refresh the count badge text, colour, and toggle button enabled state.
     * Badge turns green (.tracking-count-active) when count > 0 and panel is closed.
     * Button is dimmed and non-interactive when count === 0.
     */
    function _refreshBadge() {
        const el = _getCount();
        if (!el) return;

        el.textContent = _count > 0 ? String(_count) : ''; // empty string hides the badge visually

        // Green badge = tracking active and panel is closed (draws attention to new tracks)
        if (_count > 0 && !_isPanelOpen()) {
            el.classList.add('tracking-count-active');
        } else {
            el.classList.remove('tracking-count-active');
        }

        // Dim and disable the button when nothing is being tracked
        const btn = _getBtn();
        if (btn) {
            btn.disabled          = _count === 0;
            btn.style.opacity     = _count === 0 ? '0.35' : '';
            btn.style.pointerEvents = _count === 0 ? 'none' : '';
        }
    }

    /**
     * Update the tracked aircraft count and refresh the badge display.
     * @param {number} n  New count value (pass 0 to disable the button)
     */
    function setCount(n) {
        _count = n;
        _refreshBadge();
    }

    /**
     * Open the tracking panel and close the notifications panel (tab mutex).
     * Directly manipulates the notifications panel DOM rather than calling
     * _Notifications.toggle() to avoid circular dependencies.
     */
    function openPanel() {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.add('tracking-panel-open');
        if (btn)   btn.classList.add('tracking-btn-active');
        _refreshBadge();

        // Tab mutex: close notifications panel when tracking opens
        if (typeof _Notifications !== 'undefined') {
            const nw = document.getElementById('notifications-panel');
            const nb = document.getElementById('notif-toggle-btn');
            if (nw) nw.classList.remove('notif-panel-open');
            if (nb) nb.classList.remove('notif-btn-active');
            try { localStorage.setItem('notificationsOpen', '0'); } catch (e) {}
        }
    }

    /** Hide the tracking panel. */
    function closePanel() {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.remove('tracking-panel-open');
        if (btn)   btn.classList.remove('tracking-btn-active');
        _refreshBadge();
    }

    /** Toggle the tracking panel open/closed. */
    function toggle() {
        if (_isPanelOpen()) closePanel(); else openPanel();
    }

    /**
     * Bootstrap: inject panel HTML if absent, attach the toggle button click handler,
     * and initialise the badge. Called once from boot.js.
     */
    function init() {
        if (!document.getElementById('tracking-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);
        _refreshBadge();
    }

    return { openPanel, closePanel, toggle, init, setCount };
})();
