"use strict";
// ============================================================
// TRACKING — Shared panel component
// Manages the tracking panel: register/unregister tracked items
// from any domain (air, space, sea, land) and renders them all
// in a unified list inside #msb-pane-tracking.
// Mirrors the Notifications panel pattern.
//
// Cross-section persistence: display state (name, domain, fields)
// is saved to localStorage so items from other sections remain
// visible when navigating between pages. The owning domain's
// register() call re-attaches the live onUntrack callback;
// items from unloaded domains are shown read-only (no untrack).
//
// One item per domain — register() with an existing domain ID
// replaces the previous entry (only one aircraft/sat can be
// tracked per section since the map follows it).
//
// PUBLIC API:
//   register(opts)           — add/replace a tracked item
//   unregister(id)           — remove a tracked item
//   updateFields(id, fields) — update live data for an item
//   openPanel()              — open tracking tab in sidebar
//   closePanel()             — close tracking panel
//   toggle()                 — toggle open/close
//   setCount(n)              — no-op (badge derived from registry)
//   init()                   — bootstrap on page load
//   isPanelOpen()            — check open state
//
// Exposed as window._Tracking so any script can call
// _Tracking.register() etc. without ES module imports.
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />
window._Tracking = (() => {
    const STORAGE_KEY = 'trackingItems';
    // Live registry: id → full opts including onUntrack callback
    const _live = new Map();
    function _loadStored() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            return s ? JSON.parse(s) : [];
        }
        catch (e) {
            return [];
        }
    }
    function _saveStored() {
        // Merge live items into stored list — preserve items from other sections
        const existing = _loadStored().filter(s => !_live.has(s.id));
        const live = [];
        _live.forEach(opts => live.push({ id: opts.id, name: opts.name, domain: opts.domain, fields: opts.fields }));
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...live]));
        }
        catch (e) { }
    }
    function _clearStored(id) {
        const items = _loadStored().filter(i => i.id !== id);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        }
        catch (e) { }
    }
    // ---- DOM helpers ----
    function _getBtn() { return document.getElementById('tracking-toggle-btn'); }
    function _getCount() { return document.getElementById('tracking-count'); }
    function _getPane() { return document.getElementById('msb-pane-tracking'); }
    function _isPanelOpen() {
        const btn = _getBtn();
        return btn ? btn.classList.contains('tracking-btn-active') : false;
    }
    function _totalCount() {
        // Live items + stored items from other sections not yet in live registry
        const stored = _loadStored();
        const extra = stored.filter(s => !_live.has(s.id)).length;
        return _live.size + extra;
    }
    function _refreshBadge() {
        const n = _totalCount();
        const el = _getCount();
        if (el) {
            el.textContent = n > 0 ? String(n) : '';
            if (n > 0 && !_isPanelOpen()) {
                el.classList.add('tracking-count-active');
            }
            else {
                el.classList.remove('tracking-count-active');
            }
        }
        const btn = _getBtn();
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        }
    }
    // ---- Render ----
    function _buildFieldsHTML(fields) {
        return fields.map(f => `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${f.label}</span>` +
            `<span class="adsb-sb-value${f.emrg ? ' adsb-sb-emrg' : ''}">${f.value}</span>` +
            `</div>`).join('');
    }
    function _buildItemHTML(id, name, domain, fields, hasUntrack) {
        return `<div class="adsb-sb-name-row">` +
            `<div class="tracking-item-header">` +
            `<span class="adsb-sb-domain-label">${domain}</span>` +
            `<span class="adsb-sb-callsign">${name}</span>` +
            `</div>` +
            (hasUntrack ? `<button class="adsb-sb-untrack-btn" aria-label="Untrack">&#x2715;</button>` : '') +
            `</div>` +
            `<div class="adsb-sb-fields">${_buildFieldsHTML(fields)}</div>`;
    }
    function _render() {
        const pane = _getPane();
        if (!pane)
            return;
        // Build full set: live items + stored items from other sections
        const stored = _loadStored();
        const allIds = new Set();
        _live.forEach((_, id) => allIds.add(id));
        stored.forEach(s => allIds.add(s.id));
        // Show/hide empty placeholder
        const empty = document.getElementById('msb-tracking-empty');
        if (empty)
            empty.style.display = allIds.size > 0 ? 'none' : '';
        // Remove DOM entries no longer in either registry
        pane.querySelectorAll('.tracking-item').forEach(el => {
            if (!allIds.has(el.dataset['trackingId'] ?? ''))
                el.remove();
        });
        const renderedIds = new Set([...pane.querySelectorAll('.tracking-item')].map(el => el.dataset['trackingId'] ?? ''));
        // Add live items
        _live.forEach((opts) => {
            if (!renderedIds.has(opts.id)) {
                const el = document.createElement('div');
                el.className = 'tracking-item';
                el.dataset['trackingId'] = opts.id;
                el.innerHTML = _buildItemHTML(opts.id, opts.name, opts.domain, opts.fields, true);
                _wireUntrack(el, opts);
                pane.appendChild(el);
            }
        });
        // Add stored (read-only) items from unloaded sections
        stored.forEach(s => {
            if (_live.has(s.id))
                return; // live version takes precedence
            if (!renderedIds.has(s.id)) {
                const el = document.createElement('div');
                el.className = 'tracking-item tracking-item-readonly';
                el.dataset['trackingId'] = s.id;
                el.innerHTML = _buildItemHTML(s.id, s.name, s.domain, s.fields, true);
                _wireUntrack(el, { ...s, onUntrack: () => unregister(s.id) });
                pane.appendChild(el);
            }
        });
        _refreshBadge();
    }
    function _wireUntrack(el, opts) {
        const btn = el.querySelector('.adsb-sb-untrack-btn');
        if (!btn)
            return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onUntrack();
        });
    }
    // ---- Public API ----
    function register(opts) {
        // Replace any existing entry for this domain — one item per section
        _live.set(opts.id, opts);
        // Update DOM: remove stale entry (stored read-only or old live) and re-render
        const pane = _getPane();
        if (pane) {
            const existing = pane.querySelector(`.tracking-item[data-tracking-id="${opts.id}"]`);
            if (existing)
                existing.remove();
        }
        _saveStored();
        _render();
        openPanel();
    }
    function unregister(id) {
        _live.delete(id);
        _clearStored(id);
        const pane = _getPane();
        if (pane) {
            const el = pane.querySelector(`.tracking-item[data-tracking-id="${id}"]`);
            if (el)
                el.remove();
        }
        const empty = document.getElementById('msb-tracking-empty');
        if (empty)
            empty.style.display = _totalCount() === 0 ? '' : 'none';
        _refreshBadge();
    }
    function updateFields(id, fields) {
        const opts = _live.get(id);
        if (!opts)
            return;
        opts.fields = fields;
        _saveStored();
        const pane = _getPane();
        if (!pane)
            return;
        const el = pane.querySelector(`.tracking-item[data-tracking-id="${id}"]`);
        if (!el)
            return;
        const fieldsEl = el.querySelector('.adsb-sb-fields');
        if (fieldsEl)
            fieldsEl.innerHTML = _buildFieldsHTML(fields);
    }
    // Legacy no-op — badge is derived from registry
    function setCount(_n) { }
    function openPanel() {
        const btn = _getBtn();
        if (btn)
            btn.classList.add('tracking-btn-active');
        if (typeof window._MapSidebar !== 'undefined') {
            window._MapSidebar.show();
            window._MapSidebar.switchTab('tracking');
        }
        if (typeof window._Notifications !== 'undefined') {
            const nb = document.getElementById('notif-toggle-btn');
            if (nb)
                nb.classList.remove('notif-btn-active');
            try {
                localStorage.setItem('notificationsOpen', '0');
            }
            catch (e) { }
        }
        _refreshBadge();
    }
    function closePanel() {
        const wasOpen = _isPanelOpen();
        const btn = _getBtn();
        if (btn)
            btn.classList.remove('tracking-btn-active');
        if (wasOpen && typeof window._MapSidebar !== 'undefined') {
            const trackingPane = document.getElementById('msb-pane-tracking');
            const trackingTabActive = trackingPane ? trackingPane.classList.contains('msb-pane-active') : false;
            const notifOpen = typeof window._Notifications !== 'undefined' && window._Notifications.isPanelOpen();
            if (!notifOpen && trackingTabActive)
                window._MapSidebar.hide();
        }
        _refreshBadge();
    }
    function toggle() {
        if (_isPanelOpen())
            closePanel();
        else
            openPanel();
    }
    function init() {
        const btn = _getBtn();
        if (btn)
            btn.addEventListener('click', toggle);
        // Restore stored items from other sections as read-only display cards
        _render();
        _refreshBadge();
    }
    return { openPanel, closePanel, toggle, init, setCount, isPanelOpen: _isPanelOpen, register, unregister, updateFields };
})();
