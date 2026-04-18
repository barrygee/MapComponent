"use strict";
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
window._MapSidebar = (() => {
    function HTML(activeTab) {
        function tabCls(t) { return 'msb-tab' + (t === activeTab ? ' msb-tab-active' : ''); }
        function paneCls(t) { return 'msb-pane' + (t === activeTab ? ' msb-pane-active' : ''); }
        return (`<div id="map-sidebar">` +
            `<div id="map-sidebar-tabs">` +
            `<button class="${tabCls('search')}" data-tab="search">SEARCH</button>` +
            `<button class="${tabCls('alerts')}" data-tab="alerts">ALERTS <span class="msb-tab-badge" id="msb-alerts-badge"></span></button>` +
            `<button class="${tabCls('tracking')}" data-tab="tracking">TRACKING <span class="msb-tab-badge" id="msb-tracking-badge"></span></button>` +
            `<button class="${tabCls('passes')}" data-tab="passes">PASSES</button>` +
            `<button class="${tabCls('radio')} msb-tab--pending" data-tab="radio">RADIO</button>` +
            `</div>` +
            `<div id="map-sidebar-panes">` +
            `<div class="${paneCls('search')}" id="msb-pane-search"></div>` +
            `<div class="${paneCls('alerts')}" id="msb-pane-alerts">` +
            `<div id="msb-alerts-empty">No alerts</div>` +
            `</div>` +
            `<div class="${paneCls('tracking')}" id="msb-pane-tracking">` +
            `<div id="msb-tracking-empty"></div>` +
            `</div>` +
            `<div class="${paneCls('passes')}" id="msb-pane-passes"></div>` +
            `<div class="msb-pane-radio ${paneCls('radio')}" id="msb-pane-radio"></div>` +
            `</div>` +
            `</div>`);
    }
    const _SS_KEY = 'sentinel_sidebar_open';
    const _SS_TAB_KEY = 'sentinel_sidebar_tab';
    // Inject sidebar HTML immediately so filter IIFEs (which run at script-load time)
    // can find #msb-pane-search when their scripts are loaded after map-sidebar.js.
    // Read the saved tab now so the correct tab is active from the first paint — no flash.
    // Only restore 'radio' across sections — other tabs (e.g. passes) are domain-specific.
    (function _injectNow() {
        if (document.getElementById('map-sidebar'))
            return;
        let initialTab = 'search';
        try {
            const saved = sessionStorage.getItem(_SS_TAB_KEY);
            if (saved === 'radio')
                initialTab = 'radio';
        }
        catch (_e) { }
        const html = HTML(initialTab);
        document.body.insertAdjacentHTML('afterbegin', html);
    })();
    // Wire the footer toggle button immediately — so it works on every page,
    // not just domains that call init(). Also restore open/closed state across navigation.
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('map-sidebar-btn');
        if (btn)
            btn.addEventListener('click', toggle);
        // Restore sidebar visibility — show if it was open, hide if it was closed
        try {
            if (sessionStorage.getItem(_SS_KEY) === '1')
                show();
            else
                hide();
        }
        catch (_e) { }
    });
    function _getTabs() { return document.querySelectorAll('.msb-tab'); }
    function getSearchPane() { return document.getElementById('msb-pane-search'); }
    function switchTab(tab) {
        const tabs = _getTabs();
        const panes = document.querySelectorAll('.msb-pane');
        tabs.forEach(t => t.classList.toggle('msb-tab-active', t.dataset['tab'] === tab));
        panes.forEach(p => p.classList.toggle('msb-pane-active', p.id === `msb-pane-${tab}`));
        try {
            if (tab === 'radio')
                sessionStorage.setItem(_SS_TAB_KEY, tab);
            else
                sessionStorage.removeItem(_SS_TAB_KEY);
        }
        catch (_e) { }
        document.dispatchEvent(new CustomEvent('msb-tab-switch', { detail: { tab } }));
    }
    function setAlertCount(n) {
        const badge = document.getElementById('msb-alerts-badge');
        if (!badge)
            return;
        badge.textContent = n > 0 ? String(n) : '';
        badge.classList.toggle('msb-badge-active', n > 0);
        // Hide empty-state placeholder when there are alerts
        const empty = document.getElementById('msb-alerts-empty');
        if (empty)
            empty.style.display = n > 0 ? 'none' : '';
    }
    function setTrackingCount(n) {
        const badge = document.getElementById('msb-tracking-badge');
        if (!badge)
            return;
        badge.textContent = n > 0 ? String(n) : '';
        badge.classList.toggle('msb-badge-active', n > 0);
        // Hide empty-state placeholder when tracking is active
        const empty = document.getElementById('msb-tracking-empty');
        if (empty)
            empty.style.display = n > 0 ? 'none' : '';
    }
    function show() {
        const sidebar = document.getElementById('map-sidebar');
        const btn = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn)
            return;
        sidebar.classList.remove('msb-hidden');
        btn.classList.add('msb-btn-active');
        try {
            sessionStorage.setItem(_SS_KEY, '1');
        }
        catch (_e) { }
    }
    function hide() {
        const sidebar = document.getElementById('map-sidebar');
        const btn = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn)
            return;
        sidebar.classList.add('msb-hidden');
        btn.classList.remove('msb-btn-active');
        try {
            sessionStorage.removeItem(_SS_KEY);
        }
        catch (_e) { }
    }
    function toggle() {
        const sidebar = document.getElementById('map-sidebar');
        const btn = document.getElementById('map-sidebar-btn');
        if (!sidebar || !btn)
            return;
        const hidden = sidebar.classList.toggle('msb-hidden');
        btn.classList.toggle('msb-btn-active', !hidden);
        try {
            hidden ? sessionStorage.removeItem(_SS_KEY) : sessionStorage.setItem(_SS_KEY, '1');
        }
        catch (_e) { }
    }
    let _tabsWired = false;
    function init(opts) {
        // Set domain-specific empty-state labels
        const alertsEmpty = document.getElementById('msb-alerts-empty');
        const trackingEmpty = document.getElementById('msb-tracking-empty');
        if (alertsEmpty)
            alertsEmpty.textContent = (opts && opts.alertsEmptyText) || 'No alerts';
        if (trackingEmpty)
            trackingEmpty.textContent = (opts && opts.trackingEmptyText) || 'No tracked items';
        // Wire tab clicks only once — subsequent domain visits must not re-add listeners
        if (_tabsWired) return;
        _tabsWired = true;
        const tabs = _getTabs();
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset['tab'];
                if (name)
                    switchTab(name);
            });
        });
    }
    function openRadioTab() {
        show();
        switchTab('radio');
    }
    return { init, switchTab, openRadioTab, setAlertCount, setTrackingCount, getSearchPane, show, hide, toggle };
})();
