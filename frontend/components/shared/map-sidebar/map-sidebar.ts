// ============================================================
// MAP SIDEBAR  (_MapSidebar IIFE)
// Fixed left-side overlay panel on air and space map pages.
// Houses the filter search box, alerts (notifications), and
// tracking tabs. Acts as a structural container — domain-specific
// content is injected by each domain's filter component.
//
// PUBLIC API:
//   init()                        — inject HTML, wire tabs
//   switchTab(tab)                — switch active tab ('search'|'alerts'|'tracking')
//   setAlertCount(n)              — update alerts tab badge
//   setTrackingCount(n)           — update tracking tab badge
//   getSearchPane()               — returns #msb-pane-search element
// ============================================================

/// <reference path="../globals.d.ts" />

type MapSidebarTab = 'search' | 'alerts' | 'tracking';

window._MapSidebar = (() => {

    const HTML =
        `<div id="map-sidebar">` +
            `<div id="map-sidebar-tabs">` +
                `<button class="msb-tab msb-tab-active" data-tab="search">SEARCH</button>` +
                `<button class="msb-tab" data-tab="alerts">ALERTS <span class="msb-tab-badge" id="msb-alerts-badge"></span></button>` +
                `<button class="msb-tab" data-tab="tracking">TRACKING <span class="msb-tab-badge" id="msb-tracking-badge"></span></button>` +
            `</div>` +
            `<div id="map-sidebar-panes">` +
                `<div class="msb-pane msb-pane-active" id="msb-pane-search"></div>` +
                `<div class="msb-pane" id="msb-pane-alerts">` +
                    `<div id="msb-alerts-empty">No alerts</div>` +
                `</div>` +
                `<div class="msb-pane" id="msb-pane-tracking">` +
                    `<div id="msb-tracking-empty"></div>` +
                `</div>` +
            `</div>` +
        `</div>`;

    // Inject sidebar HTML immediately so filter IIFEs (which run at script-load time)
    // can find #msb-pane-search when their scripts are loaded after map-sidebar.js.
    (function _injectNow() {
        if (document.getElementById('map-sidebar')) return;
        // Insert as first child of body so it renders behind overlays
        document.body.insertAdjacentHTML('afterbegin', HTML);
    })();

    // Wire the footer toggle button immediately — so it works on every page,
    // not just domains that call init(). Also restore open/closed state across navigation.
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('map-sidebar-btn');
        if (btn) btn.addEventListener('click', toggle);
        // Restore sidebar visibility from previous page if the user had it open
        try {
            if (sessionStorage.getItem(_SS_KEY) === '1') show();
        } catch (_e) {}
    });

    function _getTabs():     NodeListOf<HTMLElement> { return document.querySelectorAll<HTMLElement>('.msb-tab'); }
    function getSearchPane(): HTMLElement | null { return document.getElementById('msb-pane-search'); }

    function switchTab(tab: MapSidebarTab): void {
        const tabs  = _getTabs();
        const panes = document.querySelectorAll<HTMLElement>('.msb-pane');

        tabs.forEach(t  => t.classList.toggle('msb-tab-active',  t.dataset['tab'] === tab));
        panes.forEach(p => p.classList.toggle('msb-pane-active', p.id === `msb-pane-${tab}`));
    }

    function setAlertCount(n: number): void {
        const badge = document.getElementById('msb-alerts-badge');
        if (!badge) return;
        badge.textContent = n > 0 ? String(n) : '';
        badge.classList.toggle('msb-badge-active', n > 0);

        // Hide empty-state placeholder when there are alerts
        const empty = document.getElementById('msb-alerts-empty');
        if (empty) empty.style.display = n > 0 ? 'none' : '';
    }

    function setTrackingCount(n: number): void {
        const badge = document.getElementById('msb-tracking-badge');
        if (!badge) return;
        badge.textContent = n > 0 ? String(n) : '';
        badge.classList.toggle('msb-badge-active', n > 0);

        // Hide empty-state placeholder when tracking is active
        const empty = document.getElementById('msb-tracking-empty');
        if (empty) empty.style.display = n > 0 ? 'none' : '';
    }

    const _SS_KEY = 'sentinel_sidebar_open';

    function show(): void {
        const sidebar = document.getElementById('map-sidebar');
        const btn     = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn) return;
        sidebar.classList.remove('msb-hidden');
        btn.classList.add('msb-btn-active');
        try { sessionStorage.setItem(_SS_KEY, '1'); } catch (_e) {}
    }

    function hide(): void {
        const sidebar = document.getElementById('map-sidebar');
        const btn     = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn) return;
        sidebar.classList.add('msb-hidden');
        btn.classList.remove('msb-btn-active');
        try { sessionStorage.removeItem(_SS_KEY); } catch (_e) {}
    }

    function toggle(): void {
        const sidebar = document.getElementById('map-sidebar');
        const btn     = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn) return;
        const hidden = sidebar.classList.toggle('msb-hidden');
        btn.classList.toggle('msb-btn-active', !hidden);
        try { hidden ? sessionStorage.removeItem(_SS_KEY) : sessionStorage.setItem(_SS_KEY, '1'); } catch (_e) {}
    }

    function init(opts?: { alertsEmptyText?: string; trackingEmptyText?: string }): void {
        // Set domain-specific empty-state labels
        const alertsEmpty   = document.getElementById('msb-alerts-empty');
        const trackingEmpty = document.getElementById('msb-tracking-empty');
        if (alertsEmpty)   alertsEmpty.textContent   = (opts && opts.alertsEmptyText)   || 'No alerts';
        if (trackingEmpty) trackingEmpty.textContent = (opts && opts.trackingEmptyText) || 'No tracked items';

        // Wire tab clicks (called once from each domain's boot)
        const tabs = _getTabs();
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset['tab'] as MapSidebarTab | undefined;
                if (name) switchTab(name);
            });
        });

        // Mark sidebar as visible by default
        const btn = document.getElementById('map-sidebar-btn');
        if (btn) btn.classList.add('msb-btn-active');
    }

    return { init, switchTab, setAlertCount, setTrackingCount, getSearchPane, show, hide, toggle };
})();
