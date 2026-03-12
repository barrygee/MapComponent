// ============================================================
// NOTIFICATIONS — Shared reusable panel component
// Manages the notification panel: add/update/dismiss/clearAll,
// bell pulse animation, unread badge, and localStorage persistence.
//
// Exposed as window._Notifications so any script can call
// _Notifications.add(...) without needing ES module imports.
//
// PUBLIC API:
//   add(opts)        — create a notification, returns its id
//   update(opts)     — mutate an existing notification in-place
//   dismiss(id)      — remove one notification with a fade animation
//   clearAll()       — remove all notifications
//   render([ids])    — re-render panel (optional: force-re-render specific ids)
//   toggle()         — open/close the panel
//   init()           — bootstrap on page load
//
// DOM elements used:
//   #notifications-panel, #notif-list, #notif-toggle-btn,
//   #notif-count, #notif-clear-all-btn, #notif-list-wrap,
//   #notif-scroll-hint, #notif-scroll-arrow
//
// Self-injects panel HTML if #notifications-panel is absent from the DOM
// (supports new section pages that lack the static HTML).
// ============================================================

window._Notifications = (() => {
    // localStorage key for the array of notification items
    const STORAGE_KEY = 'notifications';
    // localStorage key for the panel open/closed state
    const OPEN_KEY    = 'notificationsOpen';

    // In-memory action registries (not persisted — lost on reload by design)
    const _actions      = {}; // id → { label, callback } — bell-slash button on the notification
    const _clickActions = {}; // id → callback — fires when the notification body is clicked

    let _unreadCount = 0; // tracks notifications added while the panel was closed

    // ---- Panel HTML template ----
    // Injected at the end of <body> on pages that don't have it as static HTML.
    const PANEL_HTML =
        `<div id="notifications-panel">` +
            `<div id="notif-header">` +
                `<button id="notif-clear-all-btn" aria-label="Clear all notifications">CLEAR ALL</button>` +
                `<div id="notif-scroll-hint">MORE ` +
                    `<svg id="notif-scroll-arrow" width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">` +
                        `<polyline points="1,2.5 4,5.5 7,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
                    `</svg>` +
                `</div>` +
            `</div>` +
            `<div id="notif-list-wrap">` +
                `<div id="notif-list"></div>` +
            `</div>` +
        `</div>`;

    // ---- Storage helpers ----

    /** Load the persisted notification items array from localStorage. Returns [] on any error. */
    function _load() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    }

    /** Persist the notification items array to localStorage. Silently swallows quota errors. */
    function _save(items) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    }

    // ---- Formatting helpers ----

    /**
     * Format a Unix ms timestamp as HH:MM LOCAL for display in the panel.
     * @param {number} ts
     * @returns {string}  e.g. '14:32 LOCAL'
     */
    function _formatTimestamp(ts) {
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' LOCAL';
    }

    /**
     * Map a notification type string to its human-readable label shown in the panel header.
     * @param {string} type
     * @returns {string}
     */
    function _getLabelForType(type) {
        if (type === 'flight')     return 'LANDED';
        if (type === 'departure')  return 'DEPARTED';
        if (type === 'track')      return 'TRACKING';
        if (type === 'tracking')   return 'NOTIFICATIONS ON';
        if (type === 'notif-off')  return 'NOTIFICATIONS OFF';
        if (type === 'system')     return 'SYSTEM';
        if (type === 'message')    return 'MESSAGE';
        if (type === 'emergency')  return '⚠ EMERGENCY';
        if (type === 'squawk-clr') return 'SQUAWK CLEARED';
        return 'NOTICE'; // default fallback
    }

    // ---- DOM accessors ----
    // Small helpers to avoid duplicating getElementById calls throughout the module.

    /** @returns {HTMLElement|null} Outer panel wrapper #notifications-panel */
    function _getWrapper() { return document.getElementById('notifications-panel'); }
    /** @returns {HTMLElement|null} Scrollable inner list container #notif-list */
    function _getList()    { return document.getElementById('notif-list'); }
    /** @returns {HTMLElement|null} Footer bell toggle button #notif-toggle-btn */
    function _getBtn()     { return document.getElementById('notif-toggle-btn'); }
    /** @returns {HTMLElement|null} Unread count badge #notif-count */
    function _getCount()   { return document.getElementById('notif-count'); }

    // ---- Scroll indicator ----

    /**
     * Show or hide the "MORE ↓" scroll hint depending on whether the list overflows.
     * Flips the arrow to ↑ when the user has scrolled to the bottom.
     * Called after any render or scroll event.
     */
    function _updateScrollHint() {
        const list  = _getList();
        const hint  = document.getElementById('notif-scroll-hint');
        const arrow = document.getElementById('notif-scroll-arrow');
        if (!list || !hint || !arrow) return;

        const hiddenBelowFold = list.scrollHeight - list.clientHeight - list.scrollTop;
        const atBottom        = hiddenBelowFold <= 8; // 8px tolerance for fractional scroll
        const overflows       = list.scrollHeight > list.clientHeight + 1;

        if (!overflows) {
            hint.classList.remove('notif-scroll-hint-visible'); // nothing to scroll — hide hint
        } else {
            arrow.classList.toggle('notif-arrow-up', atBottom); // flip arrow at bottom
            hint.classList.add('notif-scroll-hint-visible');
        }
    }

    /**
     * Attach scroll and touch event listeners to the notification list wrapper.
     * Stops wheel/touch events from propagating to the map (which would zoom/pan the map).
     */
    function _initScrollListeners() {
        const list = _getList();
        if (!list) return;
        list.addEventListener('scroll', _updateScrollHint); // update hint as user scrolls

        const wrap = document.getElementById('notif-list-wrap');
        if (!wrap) return;

        // Mouse wheel: intercept and scroll the list manually to prevent map zoom
        wrap.addEventListener('wheel', (e) => {
            e.stopPropagation();
            e.preventDefault();
            list.scrollTop += e.deltaY;
        }, { passive: false });

        // Touch scroll: track touch start Y, then apply delta to list scrollTop
        let _touchStartY = 0;
        wrap.addEventListener('touchstart', (e) => {
            _touchStartY = e.touches[0].clientY;
            e.stopPropagation();
        }, { passive: true });
        wrap.addEventListener('touchmove', (e) => {
            const dy   = _touchStartY - e.touches[0].clientY;
            _touchStartY = e.touches[0].clientY;
            list.scrollTop += dy;
            e.stopPropagation();
            e.preventDefault(); // prevent map pan
        }, { passive: false });
    }

    // ---- SVG icon used in the bell-slash action button ----
    const _BELL_SLASH_SVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/><path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/><line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;

    /**
     * Build and return the DOM element for a single notification item.
     * Wires up dismiss, action (bell-slash), and body-click event handlers.
     * The element starts invisible and fades in via a double requestAnimationFrame.
     * @param {{ id: string, type: string, title: string, detail?: string, ts: number }} item
     * @returns {HTMLDivElement}
     */
    function _buildNotifElement(item) {
        const el = document.createElement('div');
        el.className    = 'notif-item';
        el.dataset.id   = item.id;
        el.dataset.type = item.type || 'system';

        const detail = item.detail || '';
        const action = _actions[item.id]; // optional bell-slash action button

        // Build inner HTML — conditionally includes the bell-slash button if an action is registered
        el.innerHTML =
            `<div class="notif-header">` +
            // Label: when an action exists, wraps two spans for hover-swap text
            (action
                ? `<span class="notif-label"><span class="notif-label-default">${_getLabelForType(item.type)}</span><span class="notif-label-disable">DISABLE NOTIFICATIONS</span></span>`
                : `<span class="notif-label">${_getLabelForType(item.type)}</span>`) +
            `<div style="display:flex;align-items:center;gap:8px">` +
            (action ? `<button class="notif-action" aria-label="Disable notifications">${_BELL_SLASH_SVG}</button>` : '') +
            `<button class="notif-dismiss" aria-label="Dismiss">✕</button>` +
            `</div>` +
            `</div>` +
            `<div class="notif-body">` +
            `<span class="notif-title">${item.title}</span>` +
            (detail ? `<span class="notif-detail">${detail}</span>` : '') +
            `<span class="notif-time">${_formatTimestamp(item.ts)}</span>` +
            `</div>`;

        // ✕ dismiss button — removes this notification
        el.querySelector('.notif-dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss(item.id);
        });

        // Bell-slash action button — fires the registered callback then dismisses
        if (action) {
            el.querySelector('.notif-action').addEventListener('click', (e) => {
                e.stopPropagation();
                action.callback();
                dismiss(item.id);
            });
        }

        // Body click — optional click action (e.g. fly to aircraft position)
        const clickAction = _clickActions[item.id];
        if (clickAction) {
            el.style.cursor = 'pointer';
            el.querySelector('.notif-body').addEventListener('click', (e) => {
                e.stopPropagation();
                clickAction();
            });
        }

        // Fade in: double rAF ensures the browser has painted the element as hidden first
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { el.classList.add('notif-visible'); });
        });

        return el;
    }

    // ---- Badge and button state ----

    /**
     * Refresh the unread count badge, its colour, and the toggle button's enabled state.
     * Badge turns green while there are unread notifications and the panel is closed.
     * Button is dimmed and disabled when there are zero notifications.
     */
    function _refreshBadge() {
        const total = _load().length;
        const el    = _getCount();

        if (el) {
            el.textContent = total > 99 ? '99+' : String(total); // cap display at "99+"
            // Green badge = there are unread items and the panel is closed
            if (_unreadCount > 0 && !_isPanelOpen()) {
                el.classList.add('notif-count-unread');
            } else {
                el.classList.remove('notif-count-unread');
            }
        }

        // "CLEAR ALL" button only shown when panel is open and has items
        const clearBtn = document.getElementById('notif-clear-all-btn');
        if (clearBtn) clearBtn.style.display = (total > 0 && _isPanelOpen()) ? 'block' : 'none';

        // Toggle button: dimmed and non-interactive when there are no notifications
        const toggleBtn = _getBtn();
        if (toggleBtn) {
            toggleBtn.disabled          = total === 0;
            toggleBtn.style.opacity     = total === 0 ? '0.35' : '';
            toggleBtn.style.pointerEvents = total === 0 ? 'none' : '';
        }
    }

    // ---- Render ----

    /**
     * Render all notification items into the panel list.
     * Preserves existing DOM nodes and only prepends newly added items,
     * so stable notifications don't flash/re-animate on each update.
     * @param {string[]} [forceIds]  Optional ids to force-re-render even if already in DOM
     */
    function render(forceIds) {
        const panel = _getList();
        if (!panel) return;

        const items = _load();
        const activeIds = new Set(items.map(i => i.id));

        // Remove DOM elements for notifications that have since been deleted from storage
        panel.querySelectorAll('.notif-item').forEach(el => {
            if (!activeIds.has(el.dataset.id)) el.remove();
        });

        // Remove force-re-render targets so they get rebuilt fresh below
        if (forceIds) {
            forceIds.forEach(id => {
                const el = panel.querySelector(`.notif-item[data-id="${id}"]`);
                if (el) el.remove();
            });
        }

        // Track which ids are already rendered (after potential removals above)
        const renderedIds = new Set([...panel.querySelectorAll('.notif-item')].map(el => el.dataset.id));

        // Iterate newest-first (reverse) so prepend() produces newest-at-top order
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (!renderedIds.has(item.id)) {
                panel.prepend(_buildNotifElement(item));
            }
        }

        _refreshBadge();
        _updateScrollHint();
    }

    // ---- Panel open/close ----

    /** @returns {boolean} True if the panel is currently open (reads localStorage) */
    function _isPanelOpen() {
        try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; }
    }

    /**
     * No-op placeholder kept for API compatibility.
     * The status bar is now positioned purely via CSS on #tracking-panel.
     */
    function _repositionBar() {}

    /**
     * Open or close the notification panel.
     * Opening: stops bell pulse, resets unread counter, closes Tracking panel (tab mutex).
     * Persists the open/closed state to localStorage.
     * @param {boolean} open
     */
    function _setPanelOpen(open) {
        try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}

        const wrapper = _getWrapper();
        const btn     = _getBtn();
        if (wrapper) wrapper.classList.toggle('notif-panel-open', open);
        if (btn)     btn.classList.toggle('notif-btn-active', open);

        if (open) {
            _stopBellPulse();   // stop animation when user opens the panel
            _unreadCount = 0;   // reset unread counter — all items are now "seen"
            // Tab mutex: close tracking panel when notifications open
            if (typeof _Tracking !== 'undefined') _Tracking.closePanel();
        }

        if (open) _updateScrollHint();
        _refreshBadge();
    }

    // ---- Bell pulse animation ----

    let _bellPulseTimer = null; // interval id for the repeating 15s pulse

    /**
     * Trigger a 3-pulse CSS animation on the bell button immediately,
     * then repeat every 15 s until the panel is opened.
     * Skips if the panel is already open.
     */
    function _pulseBell() {
        if (_isPanelOpen()) return; // panel already open — user can see the notifications
        const btn = _getBtn();
        if (!btn) return;

        // Restart the CSS animation by forcing a reflow between removing and adding the class
        btn.classList.remove('notif-btn-unread');
        void btn.offsetWidth; // reflow
        btn.classList.add('notif-btn-unread');

        // Schedule repeating pulses every 15 s (skips automatically if panel opens)
        if (!_bellPulseTimer) {
            _bellPulseTimer = setInterval(() => {
                if (_isPanelOpen()) { _stopBellPulse(); return; }
                const b = _getBtn();
                if (!b) return;
                b.classList.remove('notif-btn-unread');
                void b.offsetWidth;
                b.classList.add('notif-btn-unread');
            }, 15000);
        }
    }

    /**
     * Stop the repeating bell pulse and remove the pulse CSS class.
     * Called when the panel opens or all notifications are cleared.
     */
    function _stopBellPulse() {
        if (_bellPulseTimer) { clearInterval(_bellPulseTimer); _bellPulseTimer = null; }
        const btn = _getBtn();
        if (btn) { btn.classList.remove('notif-btn-unread'); void btn.offsetWidth; }
    }

    // ---- Public API ----

    /**
     * Create and add a new notification to the panel.
     * Also persists to localStorage and POSTs to /api/air/messages.
     *
     * @param {object} opts
     *   opts.type        — 'flight'|'departure'|'system'|'message'|'tracking'|'notif-off'|'emergency'|'squawk-clr'
     *   opts.title       — main notification text
     *   opts.detail      — (optional) secondary text shown below the title
     *   opts.action      — (optional) { label, callback } — enables bell-slash button
     *   opts.clickAction — (optional) callback fired when the notification body is clicked
     * @returns {string}  Unique notification id (use for update/dismiss)
     */
    function add(opts) {
        // Build the notification item object with a unique id
        const item = {
            id:     opts.type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type:   opts.type   || 'system',
            title:  opts.title  || '',
            detail: opts.detail || '',
            ts:     Date.now(),
        };

        // Register in-memory callbacks (not persisted)
        if (opts.action)      _actions[item.id]      = opts.action;
        if (opts.clickAction) _clickActions[item.id] = opts.clickAction;

        // Append to localStorage
        const items = _load();
        items.push(item);
        _save(items);

        // Persist to backend (best-effort — failures are silently ignored)
        fetch('/api/air/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg_id: item.id, type: item.type, title: item.title, detail: item.detail, ts: item.ts }),
        }).catch(() => {});

        // Track unread count (incremented when panel is closed)
        if (!_isPanelOpen()) _unreadCount++;

        render();        // add new element to DOM
        _pulseBell();    // alert user via button animation
        return item.id;
    }

    /**
     * Mutate an existing notification in-place (updates both storage and DOM).
     * Pass action: null to remove an existing action button.
     *
     * @param {object} opts
     *   opts.id      — notification id returned by add()
     *   opts.type    — (optional) new type
     *   opts.title   — (optional) new title text
     *   opts.detail  — (optional) new detail text
     *   opts.action  — (optional) new action | null to remove
     */
    function update(opts) {
        const items = _load();
        const item  = items.find(i => i.id === opts.id);
        if (!item) return;

        // Apply changes to the stored item
        if (opts.type   !== undefined) item.type   = opts.type;
        if (opts.title  !== undefined) item.title  = opts.title;
        if (opts.detail !== undefined) item.detail = opts.detail;
        if (opts.action !== undefined) {
            if (opts.action) _actions[item.id] = opts.action;
            else             delete _actions[item.id]; // null → remove action button
        }
        _save(items);

        // Patch the existing DOM element in-place instead of re-rendering the whole list
        const panel = _getList();
        if (!panel) return;
        const el = panel.querySelector(`.notif-item[data-id="${item.id}"]`);
        if (!el) return;

        el.dataset.type = item.type;

        // Update the label span
        const action   = _actions[item.id];
        const labelEl  = el.querySelector('.notif-label');
        if (action) {
            labelEl.innerHTML = `<span class="notif-label-default">${_getLabelForType(item.type)}</span><span class="notif-label-disable">DISABLE NOTIFICATIONS</span>`;
        } else {
            labelEl.textContent = _getLabelForType(item.type);
        }

        // Update title and detail text
        el.querySelector('.notif-title').textContent = item.title;
        const detailEl = el.querySelector('.notif-detail');
        if (detailEl) detailEl.textContent = item.detail;

        // Swap out the action button if needed
        const oldActionBtn = el.querySelector('.notif-action');
        if (oldActionBtn) oldActionBtn.remove();
        if (action) {
            const ab = document.createElement('button');
            ab.className = 'notif-action';
            ab.setAttribute('aria-label', 'Disable notifications');
            ab.innerHTML = _BELL_SLASH_SVG;
            ab.addEventListener('click', (e) => { e.stopPropagation(); action.callback(); dismiss(item.id); });
            el.querySelector('.notif-dismiss').insertAdjacentElement('beforebegin', ab);
        }
    }

    /**
     * Remove a notification by id with a CSS fade-out (220 ms), then delete from DOM and storage.
     * @param {string} id  Notification id returned by add()
     */
    function dismiss(id) {
        delete _actions[id];
        delete _clickActions[id];

        // Remove from localStorage immediately
        _save(_load().filter(i => i.id !== id));

        // Sync deletion to backend (best-effort)
        fetch(`/api/air/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});

        // Fade out the DOM element, then remove it after the animation completes
        const panel = _getList();
        if (panel) {
            const el = panel.querySelector(`.notif-item[data-id="${id}"]`);
            if (el) {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollHint(); _repositionBar(); }, 220);
            }
        }

        _refreshBadge();
        _repositionBar();
    }

    /**
     * Remove all notifications with a fade animation, reset unread count, and stop bell pulse.
     */
    function clearAll() {
        const items = _load();
        if (!items.length) return;

        // Clear all in-memory callback registries
        items.forEach(i => { delete _actions[i.id]; delete _clickActions[i.id]; });
        _save([]);

        // Sync bulk deletion to backend (best-effort)
        fetch('/api/air/messages', { method: 'DELETE' }).catch(() => {});

        _unreadCount = 0;

        // Fade out all visible elements
        const panel = _getList();
        if (panel) {
            panel.querySelectorAll('.notif-item').forEach(el => {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollHint(); }, 220);
            });
        }

        _refreshBadge();
        _stopBellPulse();
        setTimeout(_repositionBar, 230); // reposition after elements have been removed
    }

    /** Toggle the notification panel open/closed. */
    function toggle() {
        _setPanelOpen(!_isPanelOpen());
    }

    /**
     * Bootstrap the notification system on page load.
     * Injects panel HTML if absent (for new section pages),
     * restores panel open state, renders persisted notifications,
     * and attaches click handlers.
     */
    function init() {
        // Self-inject panel HTML if the page doesn't have it as static HTML
        if (!document.getElementById('notifications-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }

        _initScrollListeners();        // enable scroll-isolation and hint updates
        _setPanelOpen(_isPanelOpen()); // restore panel state from previous session
        render();                      // populate panel with persisted notifications

        // Wire footer bell button
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);

        // Wire "CLEAR ALL" button
        const clearBtn = document.getElementById('notif-clear-all-btn');
        if (clearBtn) clearBtn.addEventListener('click', clearAll);

        // Re-check bar position on window resize (no-op currently but kept for safety)
        window.addEventListener('resize', _repositionBar);
    }

    // Expose public API
    return { add, update, dismiss, clearAll, render, init, toggle, repositionBar: _repositionBar };
})();
