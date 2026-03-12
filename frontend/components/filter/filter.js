"use strict";
// ============================================================
// FILTER PANEL  (_FilterPanel IIFE)
// Real-time search across live aircraft, airports, and RAF bases.
// Integrated into the side menu; results wire directly to map selection/zoom.
//
// PUBLIC API: init(), toggle(), open(), close()
// DOM: #filter-panel, #filter-input, #filter-results, #filter-clear-btn, #filter-mode-bar
// Depends on: map (global alias), adsbControl, AIRPORTS_DATA, RAF_DATA,
//             airportsControl, rafControl, _syncSideMenuForPlanes
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />
window._FilterPanel = (() => {
    let _open = false;
    // ---- Inject panel HTML if not already present ----
    (function _injectHTML() {
        if (document.getElementById('filter-panel'))
            return;
        const panel = document.createElement('div');
        panel.id = 'filter-panel';
        panel.innerHTML =
            `<div id="filter-mode-bar">` +
                `<button class="filter-mode-btn active" data-mode="all">ALL</button>` +
                `<button class="filter-mode-btn" data-mode="civil">CIVIL</button>` +
                `<button class="filter-mode-btn" data-mode="mil">MILITARY</button>` +
                `<button class="filter-mode-btn" data-mode="none">HIDE ALL</button>` +
                `</div>` +
                `<div id="filter-input-wrap">` +
                `<svg id="filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
                `<line x1="1" y1="3" x2="12" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
                `<line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
                `<line x1="5" y1="10" x2="8" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
                `</svg>` +
                `<input id="filter-input" type="text" placeholder="CALLSIGN · ICAO · SQUAWK" autocomplete="off" spellcheck="false" />` +
                `<button id="filter-clear-btn" aria-label="Clear filter">✕</button>` +
                `</div>` +
                `<div id="filter-results"></div>`;
        document.body.appendChild(panel);
    })();
    function _getPanel() { return document.getElementById('filter-panel'); }
    function _getInput() { return document.getElementById('filter-input'); }
    function _getResults() { return document.getElementById('filter-results'); }
    function _getClearBtn() { return document.getElementById('filter-clear-btn'); }
    const _PLANE_ICON = `<svg width="11" height="11" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="currentColor"/></svg>`;
    const _AIRPORT_ICON = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.4"/><line x1="6.5" y1="2" x2="6.5" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="6.5" x2="11" y2="6.5" stroke="currentColor" stroke-width="1.2"/></svg>`;
    const _MIL_ICON = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6.5,1.5 12,11.5 1,11.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`;
    function _getAircraftData() {
        if (adsbControl && adsbControl._geojson) {
            return adsbControl._geojson.features;
        }
        return [];
    }
    function _matchesQuery(q, ...fields) {
        const lq = q.toLowerCase();
        return fields.some(f => f && f.toLowerCase().includes(lq));
    }
    function _search(query) {
        const q = query.trim();
        const results = [];
        if (!q)
            return results;
        const planes = _getAircraftData();
        for (const f of planes) {
            const p = f.properties;
            const callsign = (p.flight || '').trim();
            const hex = (p.hex || '').trim();
            const reg = (p.r || '').trim();
            const squawk = (p.squawk || '').trim();
            if (_matchesQuery(q, callsign, hex, reg, squawk)) {
                results.push({ kind: 'plane', feature: f, callsign, hex, reg, squawk, emergency: !!p.emergency && p.emergency !== 'none' });
            }
        }
        if (typeof AIRPORTS_DATA !== 'undefined') {
            for (const f of AIRPORTS_DATA.features) {
                const p = f.properties;
                if (_matchesQuery(q, p.icao, p.iata, p.name)) {
                    results.push({ kind: 'airport', feature: f, name: p.name, icao: p.icao, iata: p.iata });
                }
            }
        }
        if (typeof RAF_DATA !== 'undefined') {
            for (const f of RAF_DATA.features) {
                const p = f.properties;
                if (_matchesQuery(q, p.icao, p.name)) {
                    results.push({ kind: 'mil', feature: f, name: p.name, icao: p.icao });
                }
            }
        }
        return results;
    }
    function _selectPlane(feature) {
        if (!adsbControl)
            return;
        const p = feature.properties;
        const hex = p.hex;
        adsbControl._selectedHex = hex;
        adsbControl._applySelection();
        const coords = adsbControl._interpolatedCoords(hex) || feature.geometry.coordinates;
        map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 10), duration: 600 });
    }
    function _selectAirport(feature) {
        const p = feature.properties;
        const b = p.bounds;
        const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right');
        const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0;
        const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0;
        const pad = 80;
        const topExtra = Math.max(0, ctrlH / 2 - pad);
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW }, maxZoom: 13, duration: 800 });
        if (airportsControl) {
            airportsControl._showAirportPanel(p, feature.geometry.coordinates);
        }
    }
    function _selectMil(feature) {
        const p = feature.properties;
        const b = p.bounds;
        const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right');
        const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0;
        const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0;
        const pad = 80;
        const topExtra = Math.max(0, ctrlH / 2 - pad);
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW }, maxZoom: 13, duration: 800 });
        if (rafControl) {
            rafControl._showRAFPanel(p, feature.geometry.coordinates);
        }
    }
    function _renderResults(results, query) {
        const container = _getResults();
        if (!container)
            return;
        container.innerHTML = '';
        if (!query.trim())
            return;
        if (!results.length) {
            const el = document.createElement('div');
            el.className = 'filter-no-results';
            el.textContent = 'No results';
            container.appendChild(el);
            return;
        }
        const planes = results.filter(r => r.kind === 'plane');
        const airports = results.filter(r => r.kind === 'airport');
        const mil = results.filter(r => r.kind === 'mil');
        const _container = container;
        function addSection(label, items, renderFn) {
            if (!items.length)
                return;
            const lbl = document.createElement('div');
            lbl.className = 'filter-section-label';
            lbl.textContent = label;
            _container.appendChild(lbl);
            items.forEach(renderFn);
        }
        addSection('AIRCRAFT', planes, (r) => {
            const hex = r.hex;
            const item = document.createElement('div');
            item.className = 'filter-result-item';
            const icon = document.createElement('div');
            icon.className = 'filter-result-icon filter-icon-plane';
            icon.innerHTML = _PLANE_ICON;
            const info = document.createElement('div');
            info.className = 'filter-result-info';
            const primary = document.createElement('div');
            primary.className = 'filter-result-primary';
            primary.textContent = r.callsign || r.hex;
            const secondary = document.createElement('div');
            secondary.className = 'filter-result-secondary';
            const parts = [];
            if (r.hex)
                parts.push(r.hex.toUpperCase());
            if (r.reg)
                parts.push(r.reg);
            if (r.squawk)
                parts.push('SQK ' + r.squawk);
            secondary.textContent = parts.join(' · ');
            info.appendChild(primary);
            info.appendChild(secondary);
            const notifOn = adsbControl && adsbControl._notifEnabled && adsbControl._notifEnabled.has(hex);
            const bellBtn = document.createElement('button');
            bellBtn.className = 'filter-action-btn filter-bell-btn';
            bellBtn.setAttribute('aria-label', 'Toggle notifications');
            bellBtn.dataset['hex'] = hex;
            bellBtn.style.color = notifOn ? '#c8ff00' : 'rgba(255,255,255,0.3)';
            bellBtn.innerHTML =
                `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
                    `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
                    `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
                    (notifOn ? '' : `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`) +
                    `</svg>`;
            bellBtn.addEventListener('mousedown', e => e.stopPropagation());
            bellBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!adsbControl)
                    return;
                if (!adsbControl._notifEnabled)
                    adsbControl._notifEnabled = new Set();
                if (!adsbControl._trackingNotifIds)
                    adsbControl._trackingNotifIds = {};
                const f = adsbControl._geojson.features.find(f => f.properties.hex === hex);
                const fp = f ? f.properties : null;
                const callsign = fp ? ((fp.flight || '').trim() || (fp.r || '').trim() || hex) : hex;
                const wasOn = adsbControl._notifEnabled.has(hex);
                if (wasOn) {
                    adsbControl._notifEnabled.delete(hex);
                    if (adsbControl._trackingNotifIds[hex]) {
                        window._Notifications.dismiss(adsbControl._trackingNotifIds[hex]);
                        delete adsbControl._trackingNotifIds[hex];
                    }
                    window._Notifications.add({ type: 'notif-off', title: callsign });
                }
                else {
                    adsbControl._notifEnabled.add(hex);
                    if (adsbControl._trackingNotifIds[hex])
                        window._Notifications.dismiss(adsbControl._trackingNotifIds[hex]);
                    adsbControl._trackingNotifIds[hex] = window._Notifications.add({
                        type: 'tracking', title: callsign,
                        action: {
                            label: 'DISABLE NOTIFICATIONS',
                            callback: () => {
                                adsbControl._notifEnabled.delete(hex);
                                if (adsbControl._trackingNotifIds)
                                    delete adsbControl._trackingNotifIds[hex];
                                adsbControl._rebuildTagForHex(hex);
                            },
                        },
                    });
                }
                const nowOn = adsbControl._notifEnabled.has(hex);
                bellBtn.style.color = nowOn ? '#c8ff00' : 'rgba(255,255,255,0.3)';
                bellBtn.innerHTML =
                    `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">` +
                        `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor"/>` +
                        `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
                        (nowOn ? '' : `<line x1="1.5" y1="1.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>`) +
                        `</svg>`;
                adsbControl._rebuildTagForHex(hex);
            });
            const isTracked = adsbControl && adsbControl._followEnabled && adsbControl._tagHex === hex;
            const trkBtn = document.createElement('button');
            trkBtn.className = 'filter-action-btn filter-track-btn';
            trkBtn.textContent = isTracked ? 'TRACKING' : 'TRACK';
            trkBtn.style.color = isTracked ? '#c8ff00' : 'rgba(255,255,255,0.3)';
            trkBtn.addEventListener('mousedown', e => e.stopPropagation());
            trkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!adsbControl)
                    return;
                const f = adsbControl._geojson.features.find(f => f.properties.hex === hex);
                if (!f)
                    return;
                if (adsbControl._selectedHex !== hex) {
                    adsbControl._selectedHex = hex;
                    adsbControl._applySelection();
                }
                if (adsbControl._tagMarker) {
                    const tagTrackBtn = adsbControl._tagMarker.getElement().querySelector('.tag-follow-btn');
                    if (tagTrackBtn)
                        tagTrackBtn.click();
                }
                const coords = adsbControl._interpolatedCoords(hex) || f.geometry.coordinates;
                map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 10), duration: 600 });
            });
            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(bellBtn);
            item.appendChild(trkBtn);
            info.style.flex = '1';
            info.style.minWidth = '0';
            info.style.cursor = 'pointer';
            info.addEventListener('click', () => _selectPlane(r.feature));
            icon.style.cursor = 'pointer';
            icon.addEventListener('click', () => _selectPlane(r.feature));
            item._selectAction = () => _selectPlane(r.feature);
            container.appendChild(item);
        });
        addSection('AIRPORTS', airports, (r) => {
            const item = document.createElement('div');
            item.className = 'filter-result-item';
            const icon = document.createElement('div');
            icon.className = 'filter-result-icon filter-icon-airport';
            icon.innerHTML = _AIRPORT_ICON;
            const primary = document.createElement('div');
            primary.className = 'filter-result-primary';
            primary.textContent = r.icao;
            const secondary = document.createElement('div');
            secondary.className = 'filter-result-secondary';
            secondary.textContent = r.name.toUpperCase() + (r.iata ? ' · ' + r.iata : '');
            const badge = document.createElement('div');
            badge.className = 'filter-result-badge';
            badge.textContent = 'CVL';
            item.appendChild(icon);
            item.appendChild(primary);
            item.appendChild(secondary);
            item.appendChild(badge);
            item.addEventListener('click', () => _selectAirport(r.feature));
            item._selectAction = () => _selectAirport(r.feature);
            container.appendChild(item);
        });
        addSection('MILITARY', mil, (r) => {
            const item = document.createElement('div');
            item.className = 'filter-result-item';
            const icon = document.createElement('div');
            icon.className = 'filter-result-icon filter-icon-mil';
            icon.innerHTML = _MIL_ICON;
            const primary = document.createElement('div');
            primary.className = 'filter-result-primary';
            primary.textContent = r.icao || r.name.toUpperCase().slice(0, 6);
            const secondary = document.createElement('div');
            secondary.className = 'filter-result-secondary';
            secondary.textContent = r.name.toUpperCase();
            const badge = document.createElement('div');
            badge.className = 'filter-result-badge';
            badge.textContent = 'MIL';
            item.appendChild(icon);
            item.appendChild(primary);
            item.appendChild(secondary);
            item.appendChild(badge);
            item.addEventListener('click', () => _selectMil(r.feature));
            item._selectAction = () => _selectMil(r.feature);
            container.appendChild(item);
        });
    }
    function _repositionPanel() {
        const panel = _getPanel();
        if (panel)
            panel.style.bottom = '';
    }
    function _getFilterBtn() { return document.getElementById('sm-filter-btn'); }
    function open() {
        _open = true;
        const panel = _getPanel();
        if (panel)
            panel.classList.add('filter-panel-visible');
        _repositionPanel();
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
    }
    function close() {
        _open = false;
        const panel = _getPanel();
        if (panel)
            panel.classList.remove('filter-panel-visible');
        const btn = _getFilterBtn();
        if (btn) {
            btn.classList.remove('active');
            btn.classList.add('enabled');
        }
        _repositionPanel();
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
        input.addEventListener('input', () => {
            const q = input.value;
            if (clearBtn)
                clearBtn.classList.toggle('filter-clear-visible', q.length > 0);
            _renderResults(_search(q), q);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                close();
                return;
            }
            const container = _getResults();
            if (!container)
                return;
            const items = Array.from(container.querySelectorAll('.filter-result-item'));
            if (!items.length)
                return;
            const focused = container.querySelector('.filter-result-item.keyboard-focused');
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
                    if (focused._selectAction)
                        focused._selectAction();
                    input.focus();
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
                clearBtn.classList.remove('filter-clear-visible');
                const container = _getResults();
                if (container)
                    container.innerHTML = '';
                input.focus();
            });
        }
        const modeBar = document.getElementById('filter-mode-bar');
        if (modeBar) {
            modeBar.querySelectorAll('[data-mode]').forEach(btn => {
                const modeBtn = btn;
                if (modeBtn.dataset['mode'] === 'none') {
                    modeBtn.addEventListener('click', () => {
                        if (!adsbControl)
                            return;
                        const hiding = !adsbControl._allHidden;
                        modeBtn.textContent = hiding ? 'SHOW ALL' : 'HIDE ALL';
                        modeBtn.classList.toggle('active', hiding);
                        if (!hiding) {
                            adsbControl.setTypeFilter('all');
                            modeBar.querySelectorAll('[data-mode]:not([data-mode="none"])').forEach(b => {
                                b.classList.toggle('active', b.dataset['mode'] === 'all');
                            });
                        }
                        else {
                            modeBar.querySelectorAll('[data-mode]:not([data-mode="none"])').forEach(b => {
                                b.classList.remove('active');
                            });
                        }
                        adsbControl.setAllHidden(hiding);
                        if (_syncSideMenuForPlanes)
                            _syncSideMenuForPlanes();
                    });
                }
                else {
                    modeBtn.addEventListener('click', () => {
                        const mode = modeBtn.dataset['mode'];
                        if (!adsbControl)
                            return;
                        if (adsbControl._allHidden) {
                            adsbControl.setAllHidden(false);
                            const hideBtn = modeBar.querySelector('[data-mode="none"]');
                            if (hideBtn) {
                                hideBtn.textContent = 'HIDE ALL';
                                hideBtn.classList.remove('active');
                            }
                            if (_syncSideMenuForPlanes)
                                _syncSideMenuForPlanes();
                        }
                        adsbControl.setTypeFilter(mode);
                        modeBar.querySelectorAll('[data-mode]:not([data-mode="none"])').forEach(b => b.classList.toggle('active', b === modeBtn));
                    });
                }
            });
        }
    }
    return { open, close, toggle, init, reposition: _repositionPanel };
})();
//# sourceMappingURL=filter.js.map