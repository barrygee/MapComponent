// ============================================================
// TRACKING — Shared panel component
// Manages the tracking panel open/close state and aircraft count badge.
// Mutually exclusive with the Notifications panel (tab behaviour).
//
// Exposed as window._Tracking so any script can call
// _Tracking.openPanel() etc. without ES module imports.
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

window._Tracking = ((): TrackingAPI => {
    let _count = 0;

    function _getBtn():   HTMLElement | null { return document.getElementById('tracking-toggle-btn'); }
    function _getCount(): HTMLElement | null { return document.getElementById('tracking-count'); }

    function _isPanelOpen(): boolean {
        const btn = _getBtn();
        return btn ? btn.classList.contains('tracking-btn-active') : false;
    }

    function _refreshBadge(): void {
        const el = _getCount();
        if (!el) return;

        el.textContent = _count > 0 ? String(_count) : '';

        if (_count > 0 && !_isPanelOpen()) {
            el.classList.add('tracking-count-active');
        } else {
            el.classList.remove('tracking-count-active');
        }

        const btn = _getBtn() as HTMLButtonElement | null;
        if (btn) {
            btn.disabled            = false;
            btn.style.opacity       = '';
            btn.style.pointerEvents = '';
        }

        // Update sidebar tab badge
        if (typeof window._MapSidebar !== 'undefined') {
            window._MapSidebar.setTrackingCount(_count);
        }
    }

    function setCount(n: number): void {
        _count = n;
        _refreshBadge();
    }

    function openPanel(): void {
        const btn = _getBtn();
        if (btn) btn.classList.add('tracking-btn-active');

        // Ensure sidebar is visible and switch to tracking tab
        if (typeof window._MapSidebar !== 'undefined') { window._MapSidebar.show(); window._MapSidebar.switchTab('tracking'); }

        // Tab mutex: close notifications panel when tracking opens
        if (typeof window._Notifications !== 'undefined') {
            const nb = document.getElementById('notif-toggle-btn');
            if (nb) nb.classList.remove('notif-btn-active');
            try { localStorage.setItem('notificationsOpen', '0'); } catch (e) {}
        }

        _refreshBadge();
    }

    function closePanel(): void {
        const btn = _getBtn();
        if (btn) btn.classList.remove('tracking-btn-active');
        // Hide sidebar only if notifications panel is also closed
        const notifOpen = typeof window._Notifications !== 'undefined' && window._Notifications.isPanelOpen();
        if (!notifOpen && typeof window._MapSidebar !== 'undefined') window._MapSidebar.hide();
        _refreshBadge();
    }

    function toggle(): void {
        if (_isPanelOpen()) closePanel(); else openPanel();
    }

    function init(): void {
        // Inject status bar into the sidebar tracking pane if needed
        const pane = document.getElementById('msb-pane-tracking');
        if (pane && !document.getElementById('adsb-status-bar')) {
            const empty = document.getElementById('msb-tracking-empty');
            if (empty) empty.remove();
            pane.insertAdjacentHTML('afterbegin', `<div id="adsb-status-bar"></div>`);
        }
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);
        _refreshBadge();
    }

    return { openPanel, closePanel, toggle, init, setCount, isPanelOpen: _isPanelOpen };
})();
