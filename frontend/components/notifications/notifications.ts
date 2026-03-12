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
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

window._Notifications = ((): NotificationsAPI => {
    const STORAGE_KEY = 'notifications';
    const OPEN_KEY    = 'notificationsOpen';

    const _actions:      Record<string, NotificationAction> = {};
    const _clickActions: Record<string, () => void>         = {};

    let _unreadCount = 0;

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

    function _load(): StoredNotificationItem[] {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? (JSON.parse(saved) as StoredNotificationItem[]) : [];
        } catch (e) { return []; }
    }

    function _save(items: StoredNotificationItem[]): void {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    }

    // ---- Formatting helpers ----

    function _formatTimestamp(ts: number): string {
        const date = new Date(ts);
        return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') + ' LOCAL';
    }

    function _getLabelForType(type: string): string {
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
    function _getWrapper(): HTMLElement | null { return document.getElementById('notifications-panel'); }
    function _getList():    HTMLElement | null { return document.getElementById('notif-list'); }
    function _getBtn():     HTMLElement | null { return document.getElementById('notif-toggle-btn'); }
    function _getCount():   HTMLElement | null { return document.getElementById('notif-count'); }

    // ---- Scroll indicator ----

    function _updateScrollHint(): void {
        const list  = _getList();
        const hint  = document.getElementById('notif-scroll-hint');
        const arrow = document.getElementById('notif-scroll-arrow');
        if (!list || !hint || !arrow) return;

        const hiddenBelowFold = list.scrollHeight - list.clientHeight - list.scrollTop;
        const atBottom        = hiddenBelowFold <= 8;
        const overflows       = list.scrollHeight > list.clientHeight + 1;

        if (!overflows) {
            hint.classList.remove('notif-scroll-hint-visible');
        } else {
            arrow.classList.toggle('notif-arrow-up', atBottom);
            hint.classList.add('notif-scroll-hint-visible');
        }
    }

    function _initScrollListeners(): void {
        const list = _getList();
        if (!list) return;
        list.addEventListener('scroll', _updateScrollHint);

        const wrap = document.getElementById('notif-list-wrap');
        if (!wrap) return;

        wrap.addEventListener('wheel', (e: WheelEvent) => {
            e.stopPropagation();
            e.preventDefault();
            list.scrollTop += e.deltaY;
        }, { passive: false });

        let _touchStartY = 0;
        wrap.addEventListener('touchstart', (e: TouchEvent) => {
            _touchStartY = e.touches[0].clientY;
            e.stopPropagation();
        }, { passive: true });
        wrap.addEventListener('touchmove', (e: TouchEvent) => {
            const dy   = _touchStartY - e.touches[0].clientY;
            _touchStartY = e.touches[0].clientY;
            list.scrollTop += dy;
            e.stopPropagation();
            e.preventDefault();
        }, { passive: false });
    }

    const _BELL_SLASH_SVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/><path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/><line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>`;

    function _buildNotifElement(item: StoredNotificationItem): HTMLDivElement {
        const el = document.createElement('div');
        el.className    = 'notif-item';
        el.dataset['id']   = item.id;
        el.dataset['type'] = item.type || 'system';

        const detail = item.detail || '';
        const action = _actions[item.id];

        el.innerHTML =
            `<div class="notif-header">` +
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

        el.querySelector('.notif-dismiss')!.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            dismiss(item.id);
        });

        if (action) {
            el.querySelector('.notif-action')!.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                action.callback();
                dismiss(item.id);
            });
        }

        const clickAction = _clickActions[item.id];
        if (clickAction) {
            el.style.cursor = 'pointer';
            el.querySelector('.notif-body')!.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                clickAction();
            });
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => { el.classList.add('notif-visible'); });
        });

        return el;
    }

    // ---- Badge and button state ----

    function _refreshBadge(): void {
        const total = _load().length;
        const el    = _getCount();

        if (el) {
            el.textContent = total > 99 ? '99+' : String(total);
            if (_unreadCount > 0 && !_isPanelOpen()) {
                el.classList.add('notif-count-unread');
            } else {
                el.classList.remove('notif-count-unread');
            }
        }

        const clearBtn = document.getElementById('notif-clear-all-btn') as HTMLButtonElement | null;
        if (clearBtn) clearBtn.style.display = (total > 0 && _isPanelOpen()) ? 'block' : 'none';

        const toggleBtn = _getBtn() as HTMLButtonElement | null;
        if (toggleBtn) {
            toggleBtn.disabled            = total === 0;
            toggleBtn.style.opacity       = total === 0 ? '0.35' : '';
            toggleBtn.style.pointerEvents = total === 0 ? 'none'  : '';
        }
    }

    // ---- Render ----

    function render(forceIds?: string[]): void {
        const panel = _getList();
        if (!panel) return;

        const items    = _load();
        const activeIds = new Set(items.map(i => i.id));

        panel.querySelectorAll<HTMLElement>('.notif-item').forEach(el => {
            if (!activeIds.has(el.dataset['id'] ?? '')) el.remove();
        });

        if (forceIds) {
            forceIds.forEach(id => {
                const el = panel.querySelector<HTMLElement>(`.notif-item[data-id="${id}"]`);
                if (el) el.remove();
            });
        }

        const renderedIds = new Set(
            [...panel.querySelectorAll<HTMLElement>('.notif-item')].map(el => el.dataset['id'] ?? '')
        );

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

    function _isPanelOpen(): boolean {
        try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; }
    }

    function _repositionBar(): void {}

    function _setPanelOpen(open: boolean): void {
        try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}

        const wrapper = _getWrapper();
        const btn     = _getBtn();
        if (wrapper) wrapper.classList.toggle('notif-panel-open', open);
        if (btn)     btn.classList.toggle('notif-btn-active', open);

        if (open) {
            _stopBellPulse();
            _unreadCount = 0;
            if (typeof window._Tracking !== 'undefined') window._Tracking.closePanel();
        }

        if (open) _updateScrollHint();
        _refreshBadge();
    }

    // ---- Bell pulse animation ----

    let _bellPulseTimer: ReturnType<typeof setInterval> | null = null;

    function _pulseBell(): void {
        if (_isPanelOpen()) return;
        const btn = _getBtn();
        if (!btn) return;

        btn.classList.remove('notif-btn-unread');
        void btn.offsetWidth;
        btn.classList.add('notif-btn-unread');

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

    function _stopBellPulse(): void {
        if (_bellPulseTimer) { clearInterval(_bellPulseTimer); _bellPulseTimer = null; }
        const btn = _getBtn();
        if (btn) { btn.classList.remove('notif-btn-unread'); void btn.offsetWidth; }
    }

    // ---- Public API ----

    function add(opts: NotificationAddOptions): string {
        const item: StoredNotificationItem = {
            id:     opts.type + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type:   opts.type   ?? 'system',
            title:  opts.title  ?? '',
            detail: opts.detail ?? '',
            ts:     Date.now(),
        };

        if (opts.action)      _actions[item.id]      = opts.action;
        if (opts.clickAction) _clickActions[item.id] = opts.clickAction;

        const items = _load();
        items.push(item);
        _save(items);

        fetch('/api/air/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg_id: item.id, type: item.type, title: item.title, detail: item.detail, ts: item.ts }),
        }).catch(() => {});

        if (!_isPanelOpen()) _unreadCount++;

        render();
        _pulseBell();
        return item.id;
    }

    function update(opts: NotificationUpdateOptions): void {
        const items = _load();
        const item  = items.find(i => i.id === opts.id);
        if (!item) return;

        if (opts.type   !== undefined) item.type   = opts.type   ?? item.type;
        if (opts.title  !== undefined) item.title  = opts.title  ?? item.title;
        if (opts.detail !== undefined) item.detail = opts.detail ?? item.detail;
        if (opts.action !== undefined) {
            if (opts.action) _actions[item.id] = opts.action;
            else             delete _actions[item.id];
        }
        _save(items);

        const panel = _getList();
        if (!panel) return;
        const el = panel.querySelector<HTMLElement>(`.notif-item[data-id="${item.id}"]`);
        if (!el) return;

        el.dataset['type'] = item.type;

        const action  = _actions[item.id];
        const labelEl = el.querySelector('.notif-label');
        if (labelEl) {
            if (action) {
                labelEl.innerHTML = `<span class="notif-label-default">${_getLabelForType(item.type)}</span><span class="notif-label-disable">DISABLE NOTIFICATIONS</span>`;
            } else {
                labelEl.textContent = _getLabelForType(item.type);
            }
        }

        const titleEl = el.querySelector('.notif-title');
        if (titleEl) titleEl.textContent = item.title;
        const detailEl = el.querySelector('.notif-detail');
        if (detailEl) detailEl.textContent = item.detail;

        const oldActionBtn = el.querySelector('.notif-action');
        if (oldActionBtn) oldActionBtn.remove();
        if (action) {
            const ab = document.createElement('button');
            ab.className = 'notif-action';
            ab.setAttribute('aria-label', 'Disable notifications');
            ab.innerHTML = _BELL_SLASH_SVG;
            ab.addEventListener('click', (e: Event) => { e.stopPropagation(); action.callback(); dismiss(item.id); });
            el.querySelector('.notif-dismiss')!.insertAdjacentElement('beforebegin', ab);
        }
    }

    function dismiss(id: string): void {
        delete _actions[id];
        delete _clickActions[id];

        _save(_load().filter(i => i.id !== id));

        fetch(`/api/air/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});

        const panel = _getList();
        if (panel) {
            const el = panel.querySelector<HTMLElement>(`.notif-item[data-id="${id}"]`);
            if (el) {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollHint(); _repositionBar(); }, 220);
            }
        }

        _refreshBadge();
        _repositionBar();
    }

    function clearAll(): void {
        const items = _load();
        if (!items.length) return;

        items.forEach(i => { delete _actions[i.id]; delete _clickActions[i.id]; });
        _save([]);

        fetch('/api/air/messages', { method: 'DELETE' }).catch(() => {});

        _unreadCount = 0;

        const panel = _getList();
        if (panel) {
            panel.querySelectorAll<HTMLElement>('.notif-item').forEach(el => {
                el.classList.remove('notif-visible');
                setTimeout(() => { el.remove(); _updateScrollHint(); }, 220);
            });
        }

        _refreshBadge();
        _stopBellPulse();
        setTimeout(_repositionBar, 230);
    }

    function toggle(): void {
        _setPanelOpen(!_isPanelOpen());
    }

    function init(): void {
        if (!document.getElementById('notifications-panel')) {
            document.body.insertAdjacentHTML('beforeend', PANEL_HTML);
        }

        _initScrollListeners();
        _setPanelOpen(_isPanelOpen());
        render();

        const btn = _getBtn();
        if (btn) btn.addEventListener('click', toggle);

        const clearBtn = document.getElementById('notif-clear-all-btn');
        if (clearBtn) clearBtn.addEventListener('click', clearAll);

        window.addEventListener('resize', _repositionBar);
    }

    return { add, update, dismiss, clearAll, render, init, toggle, repositionBar: _repositionBar };
})();
