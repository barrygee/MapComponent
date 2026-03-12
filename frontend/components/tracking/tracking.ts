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

    const PANEL_HTML = `<div id="tracking-panel"><div id="adsb-status-bar"></div></div>`;

    function _getPanel(): HTMLElement | null { return document.getElementById('tracking-panel'); }
    function _getBtn():   HTMLElement | null { return document.getElementById('tracking-toggle-btn'); }
    function _getCount(): HTMLElement | null { return document.getElementById('tracking-count'); }

    function _isPanelOpen(): boolean {
        const p = _getPanel();
        return p ? p.classList.contains('tracking-panel-open') : false;
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
            btn.disabled            = _count === 0;
            btn.style.opacity       = _count === 0 ? '0.35' : '';
            btn.style.pointerEvents = _count === 0 ? 'none'  : '';
        }
    }

    function setCount(n: number): void {
        _count = n;
        _refreshBadge();
    }

    function openPanel(): void {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.add('tracking-panel-open');
        if (btn)   btn.classList.add('tracking-btn-active');
        _refreshBadge();

        // Tab mutex: close notifications panel when tracking opens
        if (typeof window._Notifications !== 'undefined') {
            const nw = document.getElementById('notifications-panel');
            const nb = document.getElementById('notif-toggle-btn');
            if (nw) nw.classList.remove('notif-panel-open');
            if (nb) nb.classList.remove('notif-btn-active');
            try { localStorage.setItem('notificationsOpen', '0'); } catch (e) {}
        }
    }

    function closePanel(): void {
        const panel = _getPanel();
        const btn   = _getBtn();
        if (panel) panel.classList.remove('tracking-panel-open');
        if (btn)   btn.classList.remove('tracking-btn-active');
        _refreshBadge();
    }

    function toggle(): void {
        if (_isPanelOpen()) closePanel(); else openPanel();
    }

    function init(): void {
        if (!document.getElementById('tracking-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);
        _refreshBadge();
    }

    return { openPanel, closePanel, toggle, init, setCount };
})();
