"use strict";
// ============================================================
// SPACE FILTER PANEL  (_SpaceFilterPanel IIFE)
// Real-time search across satellites stored in the TLE database.
// Integrated into the space side menu; selecting a result flies
// to the satellite's current position (if ISS control is active)
// or zooms to an info panel for other satellites.
//
// PUBLIC API: init(), toggle(), open(), close()
// DOM: #space-filter-panel, #space-filter-input,
//      #space-filter-results, #space-filter-clear-btn
// Depends on: map (global alias), issControl
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../../types.ts" />
window._SpaceFilterPanel = (() => {
    let _open = false;
    let _clearPreviewTimer = null;
    // Currently expanded item in the search list
    let _expandedNoradId = null;
    // Per-item state for passes fetch / tick
    let _itemFetchAbort = null;
    let _itemTickInterval = null;
    function _scheduleClearPreview() {
        if (_clearPreviewTimer)
            clearTimeout(_clearPreviewTimer);
        _clearPreviewTimer = setTimeout(() => {
            _clearPreviewTimer = null;
            if (issControl)
                issControl.clearPreview();
        }, 50);
    }
    function _cancelClearPreview() {
        if (_clearPreviewTimer) {
            clearTimeout(_clearPreviewTimer);
            _clearPreviewTimer = null;
        }
    }
    let _satellites = [];
    let _loaded = false;
    // ---- Inject filter HTML into the map sidebar search pane ----
    (function _injectHTML() {
        if (document.getElementById('space-filter-input-wrap'))
            return;
        const html = `<div id="space-filter-input-wrap">` +
            `<svg id="space-filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
            `<circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/>` +
            `<line x1="8.5" y1="8.5" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
            `</svg>` +
            `<input id="space-filter-input" type="text" placeholder="SATELLITE NAME · NORAD ID · CATEGORY" autocomplete="off" spellcheck="false" />` +
            `<button id="space-filter-clear-btn" aria-label="Clear filter">✕</button>` +
            `</div>` +
            `<div id="space-filter-results"></div>`;
        const pane = document.getElementById('msb-pane-search');
        if (pane) {
            pane.insertAdjacentHTML('afterbegin', html);
        }
        else {
            document.addEventListener('DOMContentLoaded', () => {
                const searchPane = document.getElementById('msb-pane-search');
                if (searchPane && !document.getElementById('space-filter-input-wrap'))
                    searchPane.insertAdjacentHTML('afterbegin', html);
            });
        }
    })();
    function _getPanel() { return document.getElementById('msb-pane-search'); }
    function _getInput() { return document.getElementById('space-filter-input'); }
    function _getResults() { return document.getElementById('space-filter-results'); }
    function _getClearBtn() { return document.getElementById('space-filter-clear-btn'); }
    const _CATEGORY_LABELS = {
        space_station: 'STATION',
        amateur: 'AMATEUR',
        weather: 'WEATHER',
        military: 'MIL',
        navigation: 'NAV',
        science: 'SCI',
        cubesat: 'CUBE',
        active: 'ACTIVE',
        unknown: 'UNKN',
    };
    function _matchesQuery(query, ...fields) {
        const lq = query.toLowerCase();
        return fields.some(f => f && f.toLowerCase().includes(lq));
    }
    // Maps human-readable aliases to category keys so "space station" matches space_station, etc.
    const _CATEGORY_ALIASES = {
        space_station: ['space station', 'station', 'iss'],
        amateur: ['amateur', 'ham'],
        weather: ['weather', 'met'],
        military: ['military', 'mil', 'defense', 'defence'],
        navigation: ['navigation', 'nav', 'gps', 'gnss'],
        science: ['science', 'sci', 'research'],
        cubesat: ['cubesat', 'cube', 'smallsat'],
        active: ['active'],
        unknown: ['unknown', 'unkn'],
    };
    function _categoryForQuery(query) {
        const lq = query.toLowerCase().trim();
        if (lq.length < 2)
            return null;
        for (const [cat, aliases] of Object.entries(_CATEGORY_ALIASES)) {
            if (aliases.some(a => a === lq || a.startsWith(lq) || lq.startsWith(a)))
                return cat;
        }
        return null;
    }
    function _search(query) {
        const searchQuery = query.trim();
        if (!searchQuery)
            return null; // null = show all
        const matchedCategory = _categoryForQuery(searchQuery);
        return _satellites.filter(s => _matchesQuery(searchQuery, s.name, s.norad_id) ||
            (matchedCategory !== null && s.category === matchedCategory));
    }
    const _CATEGORY_ORDER = [
        'space_station', 'active', 'weather', 'navigation',
        'military', 'amateur', 'science', 'cubesat', 'unknown',
    ];
    const _CATEGORY_SECTION_LABELS = {
        space_station: 'SPACE STATION',
        amateur: 'AMATEUR',
        weather: 'WEATHER',
        military: 'MILITARY',
        navigation: 'NAVIGATION',
        science: 'SCIENCE',
        cubesat: 'CUBESAT',
        active: 'ACTIVE',
        unknown: 'UNKNOWN',
    };
    // ---- Helpers ----
    function _formatCountdown(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        if (hours > 0)
            return `IN ${hours}h ${minutes}m`;
        if (minutes > 0)
            return `IN ${minutes}m ${seconds}s`;
        return `IN ${seconds}s`;
    }
    function _formatDuration(sec) {
        const minutes = Math.floor(sec / 60);
        const seconds = sec % 60;
        return `${minutes}m ${seconds}s`;
    }
    function _formatTime(utc) {
        return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function _formatDate(utc) {
        return new Date(utc).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    // ---- Stop any in-progress accordion content fetch/tick ----
    function _clearItemState() {
        if (_itemFetchAbort) {
            _itemFetchAbort.abort();
            _itemFetchAbort = null;
        }
        if (_itemTickInterval) {
            clearInterval(_itemTickInterval);
            _itemTickInterval = null;
        }
    }
    // ---- Render the expanded accordion body for a sat item ----
    function _buildAccordionBody(noradId, name) {
        const body = document.createElement('div');
        body.className = 'sfr-accordion-body';
        // Live telemetry
        const liveData = document.createElement('div');
        liveData.className = 'sfr-acc-live';
        liveData.dataset['noradId'] = noradId;
        const fields = [
            ['ALT', 'sfr-live-alt'],
            ['VEL', 'sfr-live-vel'],
            ['HDG', 'sfr-live-hdg'],
            ['LAT', 'sfr-live-lat'],
            ['LON', 'sfr-live-lon'],
        ];
        fields.forEach(([lbl, id]) => {
            const row = document.createElement('div');
            row.className = 'sfr-acc-live-row';
            const labelEl = document.createElement('span');
            labelEl.className = 'sfr-acc-live-label';
            labelEl.textContent = lbl;
            const valueEl = document.createElement('span');
            valueEl.className = 'sfr-acc-live-value';
            valueEl.id = id;
            valueEl.textContent = '—';
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            liveData.appendChild(row);
        });
        // Track button
        const trackBtn = document.createElement('button');
        trackBtn.className = 'sfr-acc-track-btn';
        trackBtn.textContent = 'TRACK SATELLITE';
        trackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (issControl)
                issControl.switchSatellite(noradId, name);
            close();
        });
        // Status
        const status = document.createElement('div');
        status.className = 'sfr-acc-status';
        status.textContent = 'COMPUTING PASSES…';
        // Pass list
        const passList = document.createElement('div');
        passList.className = 'sfr-acc-pass-list';
        passList.dataset['noradId'] = noradId;
        body.appendChild(liveData);
        body.appendChild(trackBtn);
        body.appendChild(status);
        body.appendChild(passList);
        return body;
    }
    function _renderAccordionPasses(passList, statusEl, passes, computedAt) {
        const computedDate = new Date(computedAt);
        statusEl.textContent = `NEXT 24H · UPDATED ${computedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        statusEl.classList.remove('sfr-acc-status-loading');
        passList.innerHTML = '';
        if (!passes.length) {
            passList.innerHTML = `<div class="sfr-acc-no-passes">No passes in the next 24 hours.</div>`;
            return;
        }
        const now = Date.now();
        passes.forEach((pass, i) => {
            const card = document.createElement('div');
            card.className = 'sfr-acc-pass-card';
            card.dataset['aosMs'] = String(pass.aos_unix_ms);
            card.dataset['losMs'] = String(pass.los_unix_ms);
            const isNow = now >= pass.aos_unix_ms && now <= pass.los_unix_ms;
            const num = document.createElement('div');
            num.className = 'sfr-acc-pass-num';
            num.textContent = String(i + 1).padStart(2, '0');
            const times = document.createElement('div');
            times.className = 'sfr-acc-pass-times';
            const aosRow = document.createElement('div');
            aosRow.className = 'sfr-acc-pass-aos-row';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'sfr-acc-pass-date';
            dateSpan.textContent = _formatDate(pass.aos_utc);
            const timeSpan = document.createElement('span');
            timeSpan.className = 'sfr-acc-pass-time';
            timeSpan.textContent = _formatTime(pass.aos_utc);
            aosRow.appendChild(dateSpan);
            aosRow.appendChild(timeSpan);
            const losRow = document.createElement('div');
            losRow.className = 'sfr-acc-pass-los';
            losRow.textContent = `LOS ${_formatTime(pass.los_utc)} · ${_formatDuration(pass.duration_s)}`;
            times.appendChild(aosRow);
            times.appendChild(losRow);
            const meta = document.createElement('div');
            meta.className = 'sfr-acc-pass-meta';
            const countdown = document.createElement('div');
            countdown.className = 'sfr-acc-pass-countdown' + (isNow ? ' sfr-in-progress' : '');
            countdown.textContent = isNow ? 'NOW' : _formatCountdown(pass.aos_unix_ms - now);
            const maxEl = document.createElement('div');
            maxEl.className = 'sfr-acc-pass-maxel';
            maxEl.textContent = `MAX ${pass.max_elevation_deg.toFixed(1)}°`;
            meta.appendChild(countdown);
            meta.appendChild(maxEl);
            card.appendChild(num);
            card.appendChild(times);
            card.appendChild(meta);
            passList.appendChild(card);
        });
        _startItemTick(passList);
    }
    function _startItemTick(passList) {
        if (_itemTickInterval)
            clearInterval(_itemTickInterval);
        _itemTickInterval = setInterval(() => {
            const now = Date.now();
            passList.querySelectorAll('.sfr-acc-pass-card').forEach(el => {
                const aosMs = parseInt(el.dataset['aosMs'] || '0', 10);
                const losMs = parseInt(el.dataset['losMs'] || '0', 10);
                const cd = el.querySelector('.sfr-acc-pass-countdown');
                if (!cd)
                    return;
                if (now >= aosMs && now <= losMs) {
                    cd.textContent = 'NOW';
                    cd.classList.add('sfr-in-progress');
                }
                else if (now > losMs) {
                    cd.textContent = 'PASSED';
                    cd.classList.remove('sfr-in-progress');
                }
                else {
                    cd.classList.remove('sfr-in-progress');
                    cd.textContent = _formatCountdown(aosMs - now);
                }
            });
        }, 1000);
    }
    async function _fetchAndPopulateAccordion(noradId, body) {
        _clearItemState();
        _itemFetchAbort = new AbortController();
        const abort = _itemFetchAbort;
        const passList = body.querySelector('.sfr-acc-pass-list');
        const statusEl = body.querySelector('.sfr-acc-status');
        if (!passList || !statusEl)
            return;
        if (!spaceUserLocationCenter) {
            statusEl.textContent = 'SET LOCATION TO CALCULATE PASSES';
            return;
        }
        const [lon, lat] = spaceUserLocationCenter;
        statusEl.textContent = 'COMPUTING PASSES…';
        statusEl.classList.add('sfr-acc-status-loading');
        try {
            const url = `/api/space/satellite/${encodeURIComponent(noradId)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`;
            const resp = await fetch(url, { signal: abort.signal });
            if (abort.signal.aborted)
                return;
            if (!resp.ok) {
                statusEl.textContent = 'COULD NOT LOAD PASSES';
                statusEl.classList.remove('sfr-acc-status-loading');
                return;
            }
            const data = await resp.json();
            _renderAccordionPasses(passList, statusEl, data.passes || [], data.computed_at);
        }
        catch (e) {
            if (e instanceof Error && e.name === 'AbortError')
                return;
            statusEl.textContent = 'NETWORK ERROR';
            statusEl.classList.remove('sfr-acc-status-loading');
        }
    }
    // ---- Collapse any currently expanded item ----
    function _collapseExpanded() {
        const container = _getResults();
        if (!container)
            return;
        const expanded = container.querySelector('.space-filter-result-item.sfr-expanded');
        if (expanded) {
            expanded.classList.remove('sfr-expanded');
            const body = expanded.querySelector('.sfr-accordion-body');
            if (body)
                body.remove();
        }
        _expandedNoradId = null;
        _clearItemState();
    }
    // ---- Update live telemetry in expanded accordion ----
    function updateExpandedPosition(p) {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el)
                el.textContent = val;
        };
        set('sfr-live-alt', `${p.alt_km} km`);
        set('sfr-live-vel', `${p.velocity_kms} km/s`);
        set('sfr-live-hdg', `${p.track_deg}°`);
        set('sfr-live-lat', `${p.lat}°`);
        set('sfr-live-lon', `${p.lon}°`);
    }
    function _renderSatItem(sat, container) {
        const item = document.createElement('div');
        item.className = 'space-filter-result-item';
        item.dataset['noradId'] = sat.norad_id;
        const info = document.createElement('div');
        info.className = 'space-filter-result-info';
        const primary = document.createElement('div');
        primary.className = 'space-filter-result-primary';
        primary.textContent = sat.name || sat.norad_id;
        const secondary = document.createElement('div');
        secondary.className = 'space-filter-result-secondary';
        const catLabel = sat.category ? (_CATEGORY_LABELS[sat.category] || sat.category.toUpperCase()) : '';
        secondary.textContent = catLabel ? `${catLabel} · NORAD ${sat.norad_id}` : `NORAD ${sat.norad_id}`;
        info.appendChild(primary);
        info.appendChild(secondary);
        const chevron = document.createElement('span');
        chevron.className = 'sfr-item-chevron';
        chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        item.addEventListener('mouseenter', () => {
            _cancelClearPreview();
            if (issControl)
                issControl.previewSatellite(sat.norad_id, sat.name || sat.norad_id);
        });
        item.addEventListener('mouseleave', () => { _scheduleClearPreview(); });
        item.addEventListener('click', () => {
            const isExpanded = item.classList.contains('sfr-expanded');
            // Collapse whatever was open
            _collapseExpanded();
            if (!isExpanded) {
                // Expand this item
                _expandedNoradId = sat.norad_id;
                item.classList.add('sfr-expanded');
                const body = _buildAccordionBody(sat.norad_id, sat.name || sat.norad_id);
                item.appendChild(body);
                // Select the satellite for tracking / live telemetry
                if (issControl)
                    issControl.switchSatellite(sat.norad_id, sat.name || sat.norad_id);
                // Fetch passes into the accordion
                void _fetchAndPopulateAccordion(sat.norad_id, body);
                item.scrollIntoView({ block: 'nearest' });
            }
        });
        item.appendChild(info);
        item.appendChild(chevron);
        container.appendChild(item);
    }
    function _renderResults(results, query) {
        const container = _getResults();
        if (!container)
            return;
        container.innerHTML = '';
        _expandedNoradId = null;
        _clearItemState();
        if (!_loaded) {
            const el = document.createElement('div');
            el.className = 'space-filter-no-results';
            el.textContent = 'Loading satellite database…';
            container.appendChild(el);
            return;
        }
        // null means no query — show all satellites grouped
        const list = results === null ? _satellites : results;
        if (!list.length) {
            const el = document.createElement('div');
            el.className = 'space-filter-no-results';
            el.textContent = 'No satellites found';
            container.appendChild(el);
            return;
        }
        // Group by category, preserving defined order then any extras
        const groups = new Map();
        for (const cat of _CATEGORY_ORDER)
            groups.set(cat, []);
        for (const sat of list) {
            const key = sat.category || 'unknown';
            if (!groups.has(key))
                groups.set(key, []);
            groups.get(key).push(sat);
        }
        const CAP_PER_GROUP = 20;
        groups.forEach((sats, cat) => {
            if (!sats.length)
                return;
            const display = sats.slice(0, CAP_PER_GROUP);
            const catLabel = _CATEGORY_SECTION_LABELS[cat] || cat.replace(/_/g, ' ').toUpperCase();
            const lbl = document.createElement('div');
            lbl.className = 'space-filter-section-label';
            lbl.textContent = catLabel;
            container.appendChild(lbl);
            display.forEach(sat => { _renderSatItem(sat, container); });
        });
    }
    async function _loadSatellites() {
        try {
            const resp = await fetch('/api/space/tle/list');
            if (!resp.ok)
                return;
            const data = await resp.json();
            if (data.satellites) {
                _satellites = data.satellites;
                _loaded = true;
            }
        }
        catch (_e) {
            // Fail silently — panel will show empty results
        }
    }
    function _getFilterBtn() { return document.getElementById('ssm-filter-btn'); }
    function open() {
        _open = true;
        if (typeof window._MapSidebar !== 'undefined') {
            window._MapSidebar.show();
            window._MapSidebar.switchTab('search');
        }
        const btn = _getFilterBtn();
        if (btn) {
            btn.classList.add('active');
            btn.classList.remove('enabled');
        }
        const input = _getInput();
        if (input) {
            input.focus();
            input.select();
        }
        // Populate results (shows list if loaded, "Loading…" if still fetching)
        _renderResults(null, '');
    }
    function close() {
        _open = false;
        _collapseExpanded();
        const btn = _getFilterBtn();
        if (btn) {
            btn.classList.remove('active');
            btn.classList.add('enabled');
        }
        // Ensure any active preview is cleared when the panel closes
        _cancelClearPreview();
        if (issControl)
            issControl.clearPreview();
    }
    function toggle() {
        if (_open)
            close();
        else
            open();
    }
    function init() {
        const input = _getInput();
        const clearBtn = _getClearBtn();
        if (!input)
            return;
        // Pre-load satellite list on init; render immediately if search tab is already active
        void _loadSatellites().then(() => {
            const pane = document.getElementById('msb-pane-search');
            if (pane && pane.classList.contains('msb-pane-active')) {
                _open = true;
                _renderResults(_search(input.value), input.value);
            }
        });
        // Populate results whenever the search tab becomes active
        document.addEventListener('msb-tab-switch', (e) => {
            const { tab } = e.detail;
            if (tab === 'search') {
                _open = true;
                _renderResults(_search(input.value), input.value);
            }
        });
        // When settings panel closes, auto-reload satellite data if it was empty
        document.addEventListener('settings-panel-closed', () => {
            if (_satellites.length > 0)
                return;
            void _loadSatellites().then(() => {
                if (!_loaded)
                    return;
                _open = true;
                _renderResults(_search(input.value), input.value);
            });
        });
        input.addEventListener('input', () => {
            const val = input.value;
            if (clearBtn)
                clearBtn.classList.toggle('space-filter-clear-visible', val.length > 0);
            _renderResults(_search(val), val);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            const container = _getResults();
            if (!container)
                return;
            const items = Array.from(container.querySelectorAll('.space-filter-result-item'));
            if (!items.length)
                return;
            const focused = container.querySelector('.space-filter-result-item.keyboard-focused');
            const idx = focused ? items.indexOf(focused) : -1;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (focused)
                    focused.classList.remove('keyboard-focused');
                const next = items[idx + 1] || items[0];
                next.classList.add('keyboard-focused');
                next.scrollIntoView({ block: 'nearest' });
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (idx <= 0) {
                    if (focused)
                        focused.classList.remove('keyboard-focused');
                }
                else {
                    if (focused)
                        focused.classList.remove('keyboard-focused');
                    const prev = items[idx - 1];
                    prev.classList.add('keyboard-focused');
                    prev.scrollIntoView({ block: 'nearest' });
                }
            }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (focused) {
                    focused.click();
                }
                else {
                    items[0].classList.add('keyboard-focused');
                    items[0].scrollIntoView({ block: 'nearest' });
                }
            }
        });
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                clearBtn.classList.remove('space-filter-clear-visible');
                _renderResults(null, '');
                input.focus();
            });
        }
        // Forward live telemetry into the expanded search accordion
        document.addEventListener('sat-position-update', (e) => {
            if (!_expandedNoradId)
                return;
            const { noradId, position } = e.detail;
            if (noradId !== _expandedNoradId)
                return;
            updateExpandedPosition(position);
        });
    }
    return { open, close, toggle, init };
})();
