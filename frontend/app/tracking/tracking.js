// ============================================================
// TRACKING — Shared reusable component
// Manages the tracking panel open/close state and aircraft count badge.
// Panel is mutually exclusive with the Notifications panel (tab behaviour).
//
// Exposed as window._Tracking so main.js (classic script) can call
// _Tracking.openPanel() etc. without any import changes.
//
// PUBLIC API:
//   openPanel()  — show panel; closes Notifications
//   closePanel() — hide panel
//   toggle()     — flip open/close
//   setCount(n)  — update aircraft count badge (0 = disables button)
//   init()       — attach click handler to tracking button
//
// DOM elements: #tracking-panel, #tracking-toggle-btn, #tracking-count
//
// Self-injects panel HTML if #tracking-panel does not exist
// (for new section pages that don't have it in static HTML).
// ============================================================

window._Tracking = (() => {
    let _count = 0;

    // ---- panel HTML template (self-injected on new section pages) ----
    const PANEL_HTML = `<div id="tracking-panel"><div id="adsb-status-bar"></div></div>`;

    /** @returns {HTMLElement|null} #tracking-panel */
    function _getPanel()  { return document.getElementById('tracking-panel'); }
    /** @returns {HTMLElement|null} #tracking-toggle-btn */
    function _getBtn()    { return document.getElementById('tracking-toggle-btn'); }
    /** @returns {HTMLElement|null} #tracking-count badge */
    function _getCount()  { return document.getElementById('tracking-count'); }

    /** @returns {boolean} True if #tracking-panel has .tracking-panel-open class */
    function _isOpen() {
        const p = _getPanel();
        return p ? p.classList.contains('tracking-panel-open') : false;
    }

    /**
     * Refresh the count badge text, highlight colour, and button disabled state.
     * Badge shows green (.tracking-count-active) when count > 0 and panel is closed.
     * Button is disabled/dimmed when count === 0.
     */
    function _updateCount() {
        const el = _getCount();
        if (!el) return;
        el.textContent = _count > 0 ? String(_count) : '';
        if (_count > 0 && !_isOpen()) {
            el.classList.add('tracking-count-active');
        } else {
            el.classList.remove('tracking-count-active');
        }
        const btn = _getBtn();
        if (btn) {
            btn.disabled = _count === 0;
            btn.style.opacity = _count === 0 ? '0.35' : '';
            btn.style.pointerEvents = _count === 0 ? 'none' : '';
        }
    }

    /**
     * Update the tracked aircraft count and refresh the badge.
     * @param {number} n - new count (0 disables the button)
     */
    function setCount(n) {
        _count = n;
        _updateCount();
    }

    /**
     * Open the tracking panel and close the notifications panel (tab mutex).
     * Side effects: adds .tracking-panel-open / .tracking-btn-active; removes notif panel classes;
     *               writes 'notificationsOpen'='0' to localStorage
     */
    function openPanel() {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.add('tracking-panel-open');
        if (btn)   btn.classList.add('tracking-btn-active');
        _updateCount();
        // Close notifications when tracking opens (tab behaviour)
        if (typeof _Notifications !== 'undefined') {
            const nw = document.getElementById('notifications-panel');
            const nb = document.getElementById('notif-toggle-btn');
            if (nw) nw.classList.remove('notif-panel-open');
            if (nb) nb.classList.remove('notif-btn-active');
            try { localStorage.setItem('notificationsOpen', '0'); } catch (e) {}
        }
    }

    /** Hide the tracking panel. Side effects: removes .tracking-panel-open / .tracking-btn-active */
    function closePanel() {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.remove('tracking-panel-open');
        if (btn)   btn.classList.remove('tracking-btn-active');
        _updateCount();
    }

    /** Toggle the tracking panel open/closed. */
    function toggle() {
        if (_isOpen()) closePanel(); else openPanel();
    }

    /**
     * Bootstrap: injects panel HTML if not already present, attaches click listener,
     * and initialises badge. Called once from boot sequence.
     */
    function init() {
        // Self-inject panel HTML if not already present (for new section pages)
        if (!document.getElementById('tracking-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);
        _updateCount();
    }

    return { openPanel, closePanel, toggle, init, setCount };
})();
