// ============================================================
// NOTIFICATIONS — Shared reusable component
// Manages the notification panel: add/update/dismiss/clearAll,
// bell pulse animation, unread badge, localStorage persistence.
//
// Exposed as window._Notifications so main.js (classic script)
// can call _Notifications.add(...) without any import changes.
//
// PUBLIC API:
//   add(opts)        — create notification, returns id
//   update(opts)     — mutate existing notification in-place
//   dismiss(id)      — remove one with fade animation
//   clearAll()       — remove all notifications
//   render([ids])    — re-render panel (optional force-ids array)
//   toggle()         — open/close panel
//   init()           — bootstrap on page load
//
// DOM elements: #notifications-panel, #notif-list, #notif-toggle-btn,
//               #notif-count, #notif-clear-all-btn, #notif-list-wrap,
//               #notif-scroll-hint, #notif-scroll-arrow
//
// Self-injects panel HTML if #notifications-panel does not exist
// (for new section pages that don't have it in static HTML).
// ============================================================

window._Notifications = (() => {
    const STORAGE_KEY  = 'notifications';
    const OPEN_KEY     = 'notificationsOpen';
    const _actions      = {};  // id -> { label, callback } — not persisted
    const _clickActions = {};  // id -> callback — fires when the notification body is clicked
    let _unreadCount   = 0;

    // ---- panel HTML template (self-injected on new section pages) ----
    const PANEL_HTML =
        `<div id="notifications-panel">` +
            `<div id="notif-header">` +
                `<button id="notif-clear-all-btn" aria-label="Clear all notifications">CLEAR ALL</button>` +
                `<div id="notif-scroll-hint">MORE <svg id="notif-scroll-arrow" width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1,2.5 4,5.5 7,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>` +
            `</div>` +
            `<div id="notif-list-wrap">` +
                `<div id="notif-list"></div>` +
            `</div>` +
        `</div>`;

    // ---- storage ----
    /** @returns {object[]} Notification items from localStorage ([] on error) */
    function _load() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    }

    /**
     * Persist notification items array to localStorage.
     * @param {object[]} items
     */
    function _save(items) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    }

    // ---- helpers ----
    /**
     * Format a Unix timestamp as HH:MM LOCAL.
     * @param {number} ts - Unix millisecond timestamp
     * @returns {string} e.g. '14:32 LOCAL'
     */
    function _formatTime(ts) {
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' LOCAL';
    }

    /**
     * Map a notification type string to its display label.
     * @param {string} type - 'flight'|'departure'|'track'|'tracking'|'notif-off'|'system'|'message'|'emergency'|'squawk-clr'
     * @returns {string} Human-readable label
     */
    function _labelForType(type) {
        if (type === 'flight')     return 'LANDED';
        if (type === 'departure')  return 'DEPARTED';
        if (type === 'track')      return 'TRACKING';
        if (type === 'tracking')   return 'NOTIFICATIONS ON';
        if (type === 'notif-off')  return 'NOTIFICATIONS OFF';
        if (type === 'system')     return 'SYSTEM';
        if (type === 'message')    return 'MESSAGE';
        if (type === 'emergency')  return '⚠ EMERGENCY';
        if (type === 'squawk-clr') return 'SQUAWK CLEARED';
        return 'NOTICE';
    }

    // ---- DOM accessors ----
    /** @returns {HTMLElement|null} Outer panel wrapper #notifications-panel */
    function _getWrapper() { return document.getElementById('notifications-panel'); }
    /** @returns {HTMLElement|null} Inner list container #notif-list */
    function _getPanel()   { return document.getElementById('notif-list'); }
    /** @returns {HTMLElement|null} Footer bell toggle button #notif-toggle-btn */
    function _getBtn()     { return document.getElementById('notif-toggle-btn'); }
    /** @returns {HTMLElement|null} Unread count badge #notif-count */
    function _getCount()   { return document.getElementById('notif-count'); }

    // ---- scroll indicator ----
    /**
     * Show or hide the scroll-hint arrow based on whether the list overflows.
     * Arrow direction flips when the user is already at the bottom.
     * Side effects: toggles .notif-scroll-hint-visible / .notif-arrow-up on DOM elements
     */
    function _updateScrollIndicator() {
        const list  = _getPanel();
        const hint  = document.getElementById('notif-scroll-hint');
        const arrow = document.getElementById('notif-scroll-arrow');
        if (!list || !hint || !arrow) return;
        const hiddenBelow = list.scrollHeight - list.clientHeight - list.scrollTop;
        const atBottom    = hiddenBelow <= 8;
        const canScroll   = list.scrollHeight > list.clientHeight + 1;
        if (!canScroll) {
            hint.classList.remove('notif-scroll-hint-visible');
        } else {
            arrow.classList.toggle('notif-arrow-up', atBottom);
            hint.classList.add('notif-scroll-hint-visible');
        }
    }

    /**
     * Attach scroll / wheel / touch event listeners to the panel list wrapper.
     * Prevents map zoom/pan while the user scrolls the notification list.
     * Side effects: adds wheel + touchstart + touchmove listeners to #notif-list-wrap
     */
    function _initScrollBtns() {
        const list = _getPanel();
        if (!list) return;
        list.addEventListener('scroll', _updateScrollIndicator);
        const wrap = document.getElementById('notif-list-wrap');
        if (wrap) {
            wrap.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); list.scrollTop += e.deltaY; }, { passive: false });

            // Touch scrolling — prevent map zoom/pan while scrolling the list
            let _touchStartY = 0;
            wrap.addEventListener('touchstart', (e) => {
                _touchStartY = e.touches[0].clientY;
                e.stopPropagation();
            }, { passive: true });
            wrap.addEventListener('touchmove', (e) => {
                const dy = _touchStartY - e.touches[0].clientY;
                _touchStartY = e.touches[0].clientY;
                list.scrollTop += dy;
                e.stopPropagation();
                e.preventDefault();
            }, { passive: false });
        }
    }

    /**
     * Build the DOM element for a single notification item.
     * Attaches dismiss, action (bell-slash), and body-click handlers.
     * @param {{ id: string, type: string, title: string, detail?: string, ts: number }} item
     * @returns {HTMLDivElement} Fully wired notification element (initially invisible; fades in via rAF)
     */
    function _renderItem(item) {
        const el = document.createElement('div');
        el.className = 'notif-item';
        el.dataset.id   = item.id;
        el.dataset.type = item.type || 'system';

        const detail = item.detail || '';
        const action = _actions[item.id];

        const bellSlashSVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/><path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/><line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;

        el.innerHTML =
            `<div class="notif-header">` +
            (action
                ? `<span class="notif-label"><span class="notif-label-default">${_labelForType(item.type)}</span><span class="notif-label-disable">DISABLE NOTIFICATIONS</span></span>`
                : `<span class="notif-label">${_labelForType(item.type)}</span>`) +
            `<div style="display:flex;align-items:center;gap:8px">` +
            (action ? `<button class="notif-action" aria-label="Disable notifications">${bellSlashSVG}</button>` : '') +
            `<button class="notif-dismiss" aria-label="Dismiss">✕</button>` +
            `</div>` +
            `</div>` +
            `<div class="notif-body">` +
            `<span class="notif-title">${item.title}</span>` +
            (detail ? `<span class="notif-detail">${detail}</span>` : '') +
            `<span class="notif-time">${_formatTime(item.ts)}</span>` +
            `</div>`;

        el.querySelector('.notif-dismiss').addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss(item.id);
        });

        if (action) {
            el.querySelector('.notif-action').addEventListener('click', (e) => {
                e.stopPropagation();
                action.callback();
                dismiss(item.id);
            });
        }

        const clickAction = _clickActions[item.id];
        if (clickAction) {
            el.style.cursor = 'pointer';
            el.querySelector('.notif-body').addEventListener('click', (e) => {
                e.stopPropagation();
                clickAction();
            });
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => { el.classList.add('notif-visible'); });
        });

        return el;
    }

    // ---- count label ----
    /**
     * Refresh the unread badge text, highlight colour, and button disabled state.
     * Badge shows green (#notif-count-unread) when unread > 0 and panel is closed.
     * Button is disabled/dimmed when there are zero notifications.
     * Side effects: mutates badge text, class, button opacity/pointer-events
     */
    function _updateCount() {
        const total = _load().length;
        const el = _getCount();
        if (el) {
            el.textContent = total > 99 ? '99+' : String(total);
            // Green when there are unread notifications while panel is closed,
            // grey when panel is open or all notifications have been seen.
            if (_unreadCount > 0 && !_isOpen()) {
                el.classList.add('notif-count-unread');
            } else {
                el.classList.remove('notif-count-unread');
            }
        }
        const btn = document.getElementById('notif-clear-all-btn');
        if (btn) btn.style.display = (total > 0 && _isOpen()) ? 'block' : 'none';
        const toggleBtn = _getBtn();
        if (toggleBtn) {
            toggleBtn.disabled = total === 0;
            toggleBtn.style.opacity = total === 0 ? '0.35' : '';
            toggleBtn.style.pointerEvents = total === 0 ? 'none' : '';
        }
    }

    // ---- render ----
    /**
     * Render all notification items into the panel list.
     * Preserves existing DOM nodes; prepends newly added items to avoid re-rendering stable items.
     * @param {string[]} [forceIds] - Optional array of ids to force-re-render even if already in DOM
     * Side effects: mutates #notif-list innerHTML; calls _updateCount, _updateScrollIndicator
     */
    function render(forceIds) {
        const panel = _getPanel();
        if (!panel) return;
        const items = _load();
        const existingIds = new Set(items.map(i => i.id));
        panel.querySelectorAll('.notif-item').forEach(el => {
            if (!existingIds.has(el.dataset.id)) el.remove();
        });
        // If forceIds is provided, remove those elements so they get re-rendered fresh
        if (forceIds) {
            forceIds.forEach(id => {
                const el = panel.querySelector(`.notif-item[data-id="${id}"]`);
                if (el) el.remove();
            });
        }
        const renderedIds = new Set([...panel.querySelectorAll('.notif-item')].map(el => el.dataset.id));
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (!renderedIds.has(item.id)) {
                panel.prepend(_renderItem(item));
            }
        }
        _updateCount();
        _updateScrollIndicator();
    }

    // ---- public API ----

    /**
     * Create a new notification and add it to the panel.
     * @param {{ type: string, title: string, detail?: string, action?: {label: string, callback: function}, clickAction?: function }} opts
     *   type        — 'flight'|'departure'|'system'|'message'|'tracking'|'notif-off'|'emergency'|'squawk-clr'
     *   title       — main notification text
     *   detail      — optional secondary text
     *   action      — optional bell-slash button: clicking fires callback then dismisses
     *   clickAction — optional: fires when the notification body is clicked
     * @returns {string} Unique notification id (used for update/dismiss)
     * Side effects: localStorage write, DOM render, bell pulse, badge update
     */
    function add(opts) {
        const item = {
            id:     opts.type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type:   opts.type   || 'system',
            title:  opts.title  || '',
            detail: opts.detail || '',
            ts:     Date.now(),
        };
        if (opts.action) _actions[item.id] = opts.action;
        if (opts.clickAction) _clickActions[item.id] = opts.clickAction;
        const items = _load();
        items.push(item);
        _save(items);
        fetch('/api/air/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg_id: item.id, type: item.type, title: item.title, detail: item.detail, ts: item.ts }),
        }).catch(() => {});
        if (!_isOpen()) _unreadCount++;
        render();
        _pulseBell();
        return item.id;
    }

    /**
     * Mutate an existing notification in-place (updates both localStorage and DOM).
     * @param {{ id: string, type?: string, title?: string, detail?: string, action?: object|null }} opts
     *   Pass action: null to remove an existing action button.
     * Side effects: localStorage update, partial DOM re-render of the matching .notif-item
     */
    function update(opts) {
        const items = _load();
        const item = items.find(i => i.id === opts.id);
        if (!item) return;
        if (opts.type   !== undefined) item.type   = opts.type;
        if (opts.title  !== undefined) item.title  = opts.title;
        if (opts.detail !== undefined) item.detail = opts.detail;
        if (opts.action !== undefined) {
            if (opts.action) _actions[item.id] = opts.action;
            else             delete _actions[item.id];
        }
        _save(items);
        // Re-render the DOM element in-place
        const panel = _getPanel();
        if (panel) {
            const el = panel.querySelector(`.notif-item[data-id="${item.id}"]`);
            if (el) {
                el.dataset.type = item.type;
                const action = _actions[item.id];
                const labelEl = el.querySelector('.notif-label');
                if (action) {
                    labelEl.innerHTML = `<span class="notif-label-default">${_labelForType(item.type)}</span><span class="notif-label-disable">DISABLE NOTIFICATIONS</span>`;
                } else {
                    labelEl.textContent = _labelForType(item.type);
                }
                el.querySelector('.notif-title').textContent = item.title;
                const detailEl = el.querySelector('.notif-detail');
                if (detailEl) detailEl.textContent = item.detail;
                const oldAction = el.querySelector('.notif-action');
                if (oldAction) oldAction.remove();
                if (action) {
                    const bellSlashSVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/><path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/><line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;
                    const ab = document.createElement('button');
                    ab.className = 'notif-action';
                    ab.setAttribute('aria-label', 'Disable notifications');
                    ab.innerHTML = bellSlashSVG;
                    ab.addEventListener('click', (e) => { e.stopPropagation(); action.callback(); dismiss(item.id); });
                    el.querySelector('.notif-dismiss').insertAdjacentElement('beforebegin', ab);
                }
            }
        }
    }

    /**
     * Remove a notification by id with a CSS fade-out animation (220 ms).
     * @param {string} id - Notification id returned by add()
     * Side effects: localStorage delete, DOM element removal after animation, badge update
     */
    function dismiss(id) {
        delete _actions[id];
        delete _clickActions[id];
        _save(_load().filter(i => i.id !== id));
        fetch(`/api/air/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        const panel = _getPanel();
        if (panel) {
            const el = panel.querySelector(`.notif-item[data-id="${id}"]`);
            if (el) {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollIndicator(); _repositionBar(); }, 220);
            }
        }
        _updateCount();
        _repositionBar();
    }

    /**
     * Remove all notifications with fade-out animation, reset unread count, stop bell pulse.
     * Side effects: clears localStorage 'notifications', animates all panel items out, calls _stopBellPulse
     */
    function clearAll() {
        const items = _load();
        if (!items.length) return;
        items.forEach(i => { delete _actions[i.id]; delete _clickActions[i.id]; });
        _save([]);
        fetch('/api/air/messages', { method: 'DELETE' }).catch(() => {});
        _unreadCount = 0;
        const panel = _getPanel();
        if (panel) {
            panel.querySelectorAll('.notif-item').forEach(el => {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollIndicator(); }, 220);
            });
        }
        _updateCount();
        _stopBellPulse();
        setTimeout(_repositionBar, 230);
    }

    // ---- panel open/close ----
    /** @returns {boolean} True if the notifications panel is currently open (reads localStorage) */
    function _isOpen() {
        try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; }
    }

    /** No-op: status bar is now positioned entirely via CSS on #tracking-panel. */
    function _repositionBar() {
        // Status bar is now positioned via the #tracking-panel CSS — no repositioning needed.
    }

    /**
     * Open or close the notification panel, persisting the state to localStorage.
     * Opening: stops bell pulse, resets unread count, closes Tracking panel (tab mutex).
     * @param {boolean} open
     * Side effects: toggles .notif-panel-open / .notif-btn-active, localStorage write,
     *               calls _Tracking.closePanel() if opening
     */
    function _setOpen(open) {
        try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
        const wrapper = _getWrapper();
        const btn     = _getBtn();
        if (wrapper) wrapper.classList.toggle('notif-panel-open', open);
        if (btn)     btn.classList.toggle('notif-btn-active', open);
        if (open) {
            // Stop repeating pulse when panel is opened and clear unread count
            _stopBellPulse();
            _unreadCount = 0;
            // Close tracking panel when notifications open (tab behaviour)
            if (typeof _Tracking !== 'undefined') _Tracking.closePanel();
        }
        if (open) _updateScrollIndicator();
        _updateCount();
        requestAnimationFrame(_repositionBar);
    }

    let _bellPulseInterval = null;

    /**
     * Trigger one 3-pulse CSS animation on the bell button immediately, then repeat every 15 s
     * until the panel is opened. Skips if panel is already open.
     * Side effects: adds/removes .notif-btn-unread class; sets _bellPulseInterval
     */
    function _pulseBell() {
        if (_isOpen()) return;
        const btn = _getBtn();
        if (!btn) return;
        // Trigger one 3-pulse burst immediately
        btn.classList.remove('notif-btn-unread');
        void btn.offsetWidth; // reflow to restart animation
        btn.classList.add('notif-btn-unread');
        // Repeat every 15 seconds until panel is opened
        if (!_bellPulseInterval) {
            _bellPulseInterval = setInterval(() => {
                if (_isOpen()) { _stopBellPulse(); return; }
                const b = _getBtn();
                if (!b) return;
                b.classList.remove('notif-btn-unread');
                void b.offsetWidth;
                b.classList.add('notif-btn-unread');
            }, 15000);
        }
    }

    /**
     * Stop the repeating bell pulse animation and remove the pulse class immediately.
     * Side effects: clears _bellPulseInterval, removes .notif-btn-unread from button
     */
    function _stopBellPulse() {
        if (_bellPulseInterval) { clearInterval(_bellPulseInterval); _bellPulseInterval = null; }
        const btn = _getBtn();
        if (btn) { btn.classList.remove('notif-btn-unread'); void btn.offsetWidth; }
    }

    /** Toggle the notification panel open/closed. */
    function toggle() {
        _setOpen(!_isOpen());
    }

    /**
     * Bootstrap the notification system on page load.
     * Injects panel HTML if not already in the DOM (for new section pages).
     * Restores panel open state, renders persisted notifications, attaches button handlers.
     * Side effects: calls _initScrollBtns, _setOpen, render; attaches click handlers to
     *               #notif-toggle-btn and #notif-clear-all-btn; adds window resize listener
     */
    function init() {
        // Self-inject panel HTML if not already present (for new section pages)
        if (!document.getElementById('notifications-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }
        _initScrollBtns();
        _setOpen(_isOpen()); // restore panel state
        render();
        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);
        const clearBtn = document.getElementById('notif-clear-all-btn');
        if (clearBtn) clearBtn.addEventListener('click', clearAll);
        window.addEventListener('resize', _repositionBar);
    }

    return { add, update, dismiss, clearAll, render, init, toggle, repositionBar: _repositionBar };
})();
