"use strict";
// ============================================================
// SPACE PASSES PANEL  (_SpacePassesPanel IIFE)
// Lists upcoming satellite passes over the user's location.
// Content is injected into #msb-pane-passes in the map sidebar.
//
// PUBLIC API: init(), toggle(), open(), close()
// DOM: injected into #msb-pane-passes
// Depends on: spaceUserLocationCenter (global), issControl (global),
//             window._MapSidebar
// ============================================================
/// <reference path="../globals.d.ts" />
/// <reference path="../../types.ts" />
window._SpacePassesPanel = (() => {
    let _open = false;
    let _injected = false;
    let _clearPreviewTimer = null;
    // Currently expanded pass card norad id
    let _expandedNoradId = null;
    // Per-item state for sat info fetch / tick
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
    let _currentPasses = [];
    let _selectedCategories = new Set(['space_station', 'weather', 'amateur']);
    let _minEl = 35;
    let _hours = 24;
    let _filtersExpanded = false;
    let _refreshInterval = null;
    let _listTickInterval = null;
    let _locationPollInterval = null;
    let _fetchAbort = null;
    const _CATEGORY_ORDER = [
        'space_station', 'active', 'weather', 'navigation',
        'military', 'amateur', 'science', 'cubesat', 'unknown',
    ];
    const _CATEGORY_LABELS = {
        space_station: 'STATION',
        active: 'ACTIVE',
        weather: 'WEATHER',
        navigation: 'NAV',
        military: 'MIL',
        amateur: 'AMATEUR',
        science: 'SCI',
        cubesat: 'CUBE',
        unknown: 'UNKN',
    };
    const _CATEGORY_DISPLAY = {
        space_station: 'Space Station',
        active: 'Active',
        weather: 'Weather',
        navigation: 'Navigation',
        military: 'Military',
        amateur: 'Amateur',
        science: 'Science',
        cubesat: 'CubeSat',
        unknown: 'Unknown',
    };
    // ---- Helpers ----
    function _formatCountdown(msUntilAos) {
        const totalSec = Math.max(0, Math.floor(msUntilAos / 1000));
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
    // ---- Clear per-item accordion state ----
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
    // ---- Inject HTML into #msb-pane-passes ----
    function _injectHTML() {
        if (_injected)
            return;
        const pane = document.getElementById('msb-pane-passes');
        if (!pane)
            return;
        // ---- Filter toggle header ----
        const filterToggle = document.createElement('button');
        filterToggle.id = 'spp-filter-toggle';
        filterToggle.className = 'spp-filter-toggle';
        filterToggle.setAttribute('aria-expanded', 'false');
        const toggleLeft = document.createElement('span');
        toggleLeft.className = 'spp-filter-toggle-left';
        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'spp-filter-toggle-icon';
        toggleIcon.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'FILTERS';
        toggleLeft.appendChild(toggleIcon);
        toggleLeft.appendChild(toggleLabel);
        const toggleSummary = document.createElement('span');
        toggleSummary.id = 'spp-filter-summary';
        toggleSummary.className = 'spp-filter-summary';
        _updateFilterSummary(toggleSummary);
        filterToggle.appendChild(toggleLeft);
        filterToggle.appendChild(toggleSummary);
        // ---- Collapsible filter body ----
        const filterBody = document.createElement('div');
        filterBody.id = 'spp-filter-body';
        filterBody.className = 'spp-filter-body';
        // collapsed by default
        // Category section label
        const catSectionLabel = document.createElement('div');
        catSectionLabel.className = 'spp-section-label';
        catSectionLabel.textContent = 'SATELLITES';
        filterBody.appendChild(catSectionLabel);
        // Category toggles
        const cbContainer = document.createElement('div');
        cbContainer.id = 'spp-category-checkboxes';
        _CATEGORY_ORDER.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'spp-cat-btn' + (_selectedCategories.has(cat) ? ' active' : '');
            btn.dataset['cat'] = cat;
            btn.textContent = _CATEGORY_DISPLAY[cat] || cat;
            btn.addEventListener('click', () => {
                if (_selectedCategories.has(cat)) {
                    _selectedCategories.delete(cat);
                    btn.classList.remove('active');
                }
                else {
                    _selectedCategories.add(cat);
                    btn.classList.add('active');
                }
                _updateFilterSummary(document.getElementById('spp-filter-summary'));
                void _fetchPasses();
            });
            cbContainer.appendChild(btn);
        });
        filterBody.appendChild(cbContainer);
        // Elevation row
        const elevRow = document.createElement('div');
        elevRow.className = 'spp-filter-row';
        const elevLabel = document.createElement('span');
        elevLabel.className = 'spp-filter-label';
        elevLabel.textContent = 'MIN ELEVATION';
        const elevSlider = document.createElement('input');
        elevSlider.type = 'range';
        elevSlider.id = 'spp-elevation-slider';
        elevSlider.min = '0';
        elevSlider.max = '45';
        elevSlider.step = '5';
        elevSlider.value = String(_minEl);
        const elevValue = document.createElement('span');
        elevValue.id = 'spp-elevation-value';
        elevValue.className = 'spp-filter-value';
        elevValue.textContent = `${_minEl}°`;
        let _elDebounce = null;
        elevSlider.addEventListener('input', () => {
            _minEl = parseInt(elevSlider.value, 10);
            elevValue.textContent = `${_minEl}°`;
            _updateFilterSummary(document.getElementById('spp-filter-summary'));
            if (_elDebounce)
                clearTimeout(_elDebounce);
            _elDebounce = setTimeout(() => { _elDebounce = null; void _fetchPasses(); }, 500);
        });
        elevRow.appendChild(elevLabel);
        elevRow.appendChild(elevSlider);
        elevRow.appendChild(elevValue);
        filterBody.appendChild(elevRow);
        // Hours row
        const hoursRow = document.createElement('div');
        hoursRow.className = 'spp-filter-row';
        const hoursLabel = document.createElement('span');
        hoursLabel.className = 'spp-filter-label';
        hoursLabel.textContent = 'WINDOW';
        const hoursBtns = document.createElement('div');
        hoursBtns.id = 'spp-hours-btns';
        hoursBtns.className = 'spp-seg-btns';
        [6, 12, 24].forEach(h => {
            const btn = document.createElement('button');
            btn.className = 'spp-seg-btn' + (h === _hours ? ' active' : '');
            btn.dataset['hours'] = String(h);
            btn.textContent = `${h}H`;
            btn.addEventListener('click', () => {
                _hours = h;
                hoursBtns.querySelectorAll('.spp-seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _updateFilterSummary(document.getElementById('spp-filter-summary'));
                void _fetchPasses();
            });
            hoursBtns.appendChild(btn);
        });
        hoursRow.appendChild(hoursLabel);
        hoursRow.appendChild(hoursBtns);
        filterBody.appendChild(hoursRow);
        // Wire toggle
        filterToggle.addEventListener('click', () => {
            _filtersExpanded = !_filtersExpanded;
            filterBody.classList.toggle('expanded', _filtersExpanded);
            filterToggle.classList.toggle('expanded', _filtersExpanded);
            filterToggle.setAttribute('aria-expanded', String(_filtersExpanded));
        });
        // Status bar
        const statusBar = document.createElement('div');
        statusBar.id = 'spp-status-bar';
        // Pass list
        const list = document.createElement('div');
        list.id = 'spp-list';
        pane.appendChild(statusBar);
        pane.appendChild(list);
        // Filter toggle + body go into #map-sidebar (after panes) so they're
        // visible on all tabs, below the SATELLITE INFO panel
        const sidebar = document.getElementById('map-sidebar');
        const target = sidebar || pane;
        target.appendChild(filterToggle);
        target.appendChild(filterBody);
        _injected = true;
    }
    function _updateFilterSummary(el) {
        if (!el)
            return;
        const catCount = _selectedCategories.size;
        el.textContent = `${catCount} SAT TYPE${catCount !== 1 ? 'S' : ''} · ${_minEl}° · ${_hours}H`;
    }
    // ---- Fetch ----
    async function _fetchPasses() {
        if (_fetchAbort)
            _fetchAbort.abort();
        _fetchAbort = new AbortController();
        const abort = _fetchAbort;
        if (!spaceUserLocationCenter) {
            _showNoLocation();
            return;
        }
        const [lon, lat] = spaceUserLocationCenter;
        const cats = Array.from(_selectedCategories).join(',');
        if (!cats) {
            _showMessage('Select at least one satellite category.');
            return;
        }
        _setLoading(true);
        try {
            const url = `/api/space/passes?lat=${lat}&lon=${lon}&hours=${_hours}&min_el=${_minEl}&categories=${encodeURIComponent(cats)}&limit=100`;
            const resp = await fetch(url, { signal: abort.signal });
            if (abort.signal.aborted)
                return;
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                if (data.no_tle_data) {
                    _showMessage('No TLE data. Import satellites in Settings.');
                    return;
                }
                _showMessage(`Error ${resp.status} — ${data.error || 'Failed to load passes'}`);
                return;
            }
            const data = await resp.json();
            _currentPasses = data.passes || [];
            _renderPasses(_currentPasses);
            _updateStatusBar(data.satellite_count, data.computed_at);
        }
        catch (e) {
            if (e instanceof Error && e.name === 'AbortError')
                return;
            _showMessage('Network error — check connection and retry.');
        }
        finally {
            _setLoading(false);
        }
    }
    // ---- UI state helpers ----
    function _setLoading(on) {
        const status = document.getElementById('spp-status-bar');
        const filterBody = document.getElementById('spp-filter-body');
        if (!status)
            return;
        if (on) {
            status.textContent = 'COMPUTING PASSES…';
            status.classList.add('spp-loading');
            if (filterBody)
                filterBody.style.opacity = '0.5';
        }
        else {
            status.classList.remove('spp-loading');
            if (filterBody)
                filterBody.style.opacity = '';
        }
    }
    function _showNoLocation() {
        const list = document.getElementById('spp-list');
        if (!list)
            return;
        list.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'spp-message';
        msg.innerHTML = `<div>Set your location to calculate passes.</div><button class="spp-action-btn" id="spp-set-location-btn">SET LOCATION</button>`;
        list.appendChild(msg);
        const btn = document.getElementById('spp-set-location-btn');
        if (btn)
            btn.addEventListener('click', () => { if (typeof goToSpaceUserLocation === 'function')
                goToSpaceUserLocation(); });
        if (!_locationPollInterval) {
            let pollCount = 0;
            _locationPollInterval = setInterval(() => {
                pollCount++;
                if (spaceUserLocationCenter) {
                    clearInterval(_locationPollInterval);
                    _locationPollInterval = null;
                    void _fetchPasses();
                }
                else if (pollCount > 120) {
                    clearInterval(_locationPollInterval);
                    _locationPollInterval = null;
                }
            }, 500);
        }
    }
    function _showMessage(text) {
        const list = document.getElementById('spp-list');
        if (!list)
            return;
        list.innerHTML = `<div class="spp-message">${text}</div>`;
    }
    function _updateStatusBar(satCount, computedAt) {
        const status = document.getElementById('spp-status-bar');
        if (!status)
            return;
        const computedDate = new Date(computedAt);
        const timeStr = computedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        status.textContent = `${satCount} SATELLITES · UPDATED ${timeStr}`;
        status.classList.remove('spp-loading');
    }
    // ---- Collapse any currently expanded pass card ----
    function _collapseExpanded() {
        const list = document.getElementById('spp-list');
        if (!list)
            return;
        const expanded = list.querySelector('.spp-pass-card.spp-expanded');
        if (expanded) {
            expanded.classList.remove('spp-expanded');
            const body = expanded.querySelector('.spp-acc-body');
            if (body)
                body.remove();
        }
        _expandedNoradId = null;
        _clearItemState();
    }
    // ---- Build accordion body for a pass card ----
    function _buildPassAccordionBody(noradId, name) {
        const body = document.createElement('div');
        body.className = 'spp-acc-body';
        // Live telemetry
        const liveData = document.createElement('div');
        liveData.className = 'spp-acc-live';
        liveData.dataset['noradId'] = noradId;
        const fields = [
            ['ALT', 'spp-live-alt'],
            ['VEL', 'spp-live-vel'],
            ['HDG', 'spp-live-hdg'],
            ['LAT', 'spp-live-lat'],
            ['LON', 'spp-live-lon'],
        ];
        fields.forEach(([lbl, id]) => {
            const row = document.createElement('div');
            row.className = 'spp-acc-live-row';
            const labelEl = document.createElement('span');
            labelEl.className = 'spp-acc-live-label';
            labelEl.textContent = lbl;
            const valueEl = document.createElement('span');
            valueEl.className = 'spp-acc-live-value';
            valueEl.id = id;
            valueEl.textContent = '—';
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            liveData.appendChild(row);
        });
        // Track button
        const trackBtn = document.createElement('button');
        trackBtn.className = 'spp-acc-track-btn';
        trackBtn.textContent = 'TRACK SATELLITE';
        trackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (issControl)
                issControl.switchSatellite(noradId, name);
            close();
        });
        // Status
        const status = document.createElement('div');
        status.className = 'spp-acc-status';
        status.textContent = 'COMPUTING PASSES…';
        // Pass list (upcoming passes for this specific sat)
        const satPassList = document.createElement('div');
        satPassList.className = 'spp-acc-pass-list';
        satPassList.dataset['noradId'] = noradId;
        body.appendChild(liveData);
        body.appendChild(trackBtn);
        body.appendChild(status);
        body.appendChild(satPassList);
        return body;
    }
    function _renderSatPassesInAccordion(satPassList, statusEl, passes, computedAt) {
        const computedDate = new Date(computedAt);
        statusEl.textContent = `NEXT 24H · UPDATED ${computedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        statusEl.classList.remove('spp-acc-status-loading');
        satPassList.innerHTML = '';
        if (!passes.length) {
            satPassList.innerHTML = `<div class="spp-acc-no-passes">No passes in the next 24 hours.</div>`;
            return;
        }
        const now = Date.now();
        passes.forEach((pass, i) => {
            const card = document.createElement('div');
            card.className = 'spp-acc-pass-card';
            card.dataset['aosMs'] = String(pass.aos_unix_ms);
            card.dataset['losMs'] = String(pass.los_unix_ms);
            const isNow = now >= pass.aos_unix_ms && now <= pass.los_unix_ms;
            const num = document.createElement('div');
            num.className = 'spp-acc-pass-num';
            num.textContent = String(i + 1).padStart(2, '0');
            const times = document.createElement('div');
            times.className = 'spp-acc-pass-times';
            const aosRow = document.createElement('div');
            aosRow.className = 'spp-acc-pass-aos-row';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'spp-acc-pass-date';
            dateSpan.textContent = _formatDate(pass.aos_utc);
            const timeSpan = document.createElement('span');
            timeSpan.className = 'spp-acc-pass-time';
            timeSpan.textContent = _formatTime(pass.aos_utc);
            aosRow.appendChild(dateSpan);
            aosRow.appendChild(timeSpan);
            const losRow = document.createElement('div');
            losRow.className = 'spp-acc-pass-los';
            losRow.textContent = `LOS ${_formatTime(pass.los_utc)} · ${_formatDuration(pass.duration_s)}`;
            times.appendChild(aosRow);
            times.appendChild(losRow);
            const meta = document.createElement('div');
            meta.className = 'spp-acc-pass-meta';
            const countdown = document.createElement('div');
            countdown.className = 'spp-acc-pass-countdown' + (isNow ? ' spp-in-progress' : '');
            countdown.textContent = isNow ? 'NOW' : _formatCountdown(pass.aos_unix_ms - now);
            const maxElEl = document.createElement('div');
            maxElEl.className = 'spp-acc-pass-maxel';
            maxElEl.textContent = `MAX ${pass.max_elevation_deg.toFixed(1)}°`;
            meta.appendChild(countdown);
            meta.appendChild(maxElEl);
            card.appendChild(num);
            card.appendChild(times);
            card.appendChild(meta);
            satPassList.appendChild(card);
        });
        _startItemTick(satPassList);
    }
    function _startItemTick(satPassList) {
        if (_itemTickInterval)
            clearInterval(_itemTickInterval);
        _itemTickInterval = setInterval(() => {
            const now = Date.now();
            satPassList.querySelectorAll('.spp-acc-pass-card').forEach(el => {
                const aosMs = parseInt(el.dataset['aosMs'] || '0', 10);
                const losMs = parseInt(el.dataset['losMs'] || '0', 10);
                const cd = el.querySelector('.spp-acc-pass-countdown');
                if (!cd)
                    return;
                if (now >= aosMs && now <= losMs) {
                    cd.textContent = 'NOW';
                    cd.classList.add('spp-in-progress');
                }
                else if (now > losMs) {
                    cd.textContent = 'PASSED';
                    cd.classList.remove('spp-in-progress');
                }
                else {
                    cd.classList.remove('spp-in-progress');
                    cd.textContent = _formatCountdown(aosMs - now);
                }
            });
        }, 1000);
    }
    async function _fetchAndPopulateAccordion(noradId, body) {
        _clearItemState();
        _itemFetchAbort = new AbortController();
        const abort = _itemFetchAbort;
        const satPassList = body.querySelector('.spp-acc-pass-list');
        const statusEl = body.querySelector('.spp-acc-status');
        if (!satPassList || !statusEl)
            return;
        if (!spaceUserLocationCenter) {
            statusEl.textContent = 'SET LOCATION TO CALCULATE PASSES';
            return;
        }
        const [lon, lat] = spaceUserLocationCenter;
        statusEl.textContent = 'COMPUTING PASSES…';
        statusEl.classList.add('spp-acc-status-loading');
        try {
            const url = `/api/space/satellite/${encodeURIComponent(noradId)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`;
            const resp = await fetch(url, { signal: abort.signal });
            if (abort.signal.aborted)
                return;
            if (!resp.ok) {
                statusEl.textContent = 'COULD NOT LOAD PASSES';
                statusEl.classList.remove('spp-acc-status-loading');
                return;
            }
            const data = await resp.json();
            _renderSatPassesInAccordion(satPassList, statusEl, data.passes || [], data.computed_at);
        }
        catch (e) {
            if (e instanceof Error && e.name === 'AbortError')
                return;
            statusEl.textContent = 'NETWORK ERROR';
            statusEl.classList.remove('spp-acc-status-loading');
        }
    }
    // ---- Update live telemetry in expanded pass accordion ----
    function updateExpandedPosition(p) {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el)
                el.textContent = val;
        };
        set('spp-live-alt', `${p.alt_km} km`);
        set('spp-live-vel', `${p.velocity_kms} km/s`);
        set('spp-live-hdg', `${p.track_deg}°`);
        set('spp-live-lat', `${p.lat}°`);
        set('spp-live-lon', `${p.lon}°`);
    }
    // ---- Render ----
    function _renderPasses(passes) {
        const list = document.getElementById('spp-list');
        if (!list)
            return;
        list.innerHTML = '';
        _expandedNoradId = null;
        _clearItemState();
        if (!passes.length) {
            list.innerHTML = `<div class="spp-message">No passes found. Try broader categories, lower elevation, or longer window.</div>`;
            return;
        }
        const now = Date.now();
        passes.forEach(pass => {
            const card = document.createElement('div');
            card.className = 'spp-pass-card';
            card.dataset['noradId'] = pass.norad_id;
            card.dataset['aosMs'] = String(pass.aos_unix_ms);
            card.dataset['losMs'] = String(pass.los_unix_ms);
            const catLabel = pass.category
                ? (_CATEGORY_LABELS[pass.category] || pass.category.toUpperCase())
                : '';
            const isInProgress = now >= pass.aos_unix_ms && now <= pass.los_unix_ms;
            let aosText;
            if (isInProgress) {
                aosText = 'IN PROGRESS';
            }
            else {
                const msUntil = pass.aos_unix_ms - now;
                aosText = msUntil < 3600000
                    ? _formatCountdown(msUntil)
                    : new Date(pass.aos_unix_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            // Card header row (always visible)
            const cardHeader = document.createElement('div');
            cardHeader.className = 'spp-pass-card-header';
            const info = document.createElement('div');
            info.className = 'spp-pass-info';
            const primary = document.createElement('div');
            primary.className = 'spp-pass-primary';
            primary.textContent = pass.name || pass.norad_id;
            const secondary = document.createElement('div');
            secondary.className = 'spp-pass-secondary';
            secondary.textContent = catLabel ? `${catLabel} · NORAD ${pass.norad_id}` : `NORAD ${pass.norad_id}`;
            info.appendChild(primary);
            info.appendChild(secondary);
            const meta = document.createElement('div');
            meta.className = 'spp-pass-meta';
            const aosEl = document.createElement('div');
            aosEl.className = 'spp-pass-aos' + (isInProgress ? ' spp-in-progress' : '');
            aosEl.textContent = aosText;
            const detail = document.createElement('div');
            detail.className = 'spp-pass-detail';
            detail.textContent = `${_formatDuration(pass.duration_s)} · ${pass.max_elevation_deg.toFixed(1)}°`;
            meta.appendChild(aosEl);
            meta.appendChild(detail);
            const chevron = document.createElement('span');
            chevron.className = 'spp-pass-chevron';
            chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            cardHeader.appendChild(info);
            cardHeader.appendChild(meta);
            cardHeader.appendChild(chevron);
            card.appendChild(cardHeader);
            card.addEventListener('mouseenter', () => { _cancelClearPreview(); if (issControl)
                issControl.previewSatellite(pass.norad_id, pass.name || pass.norad_id); });
            card.addEventListener('mouseleave', () => { _scheduleClearPreview(); });
            card.addEventListener('click', () => {
                const isExpanded = card.classList.contains('spp-expanded');
                // Collapse whatever was open
                _collapseExpanded();
                if (!isExpanded) {
                    _expandedNoradId = pass.norad_id;
                    card.classList.add('spp-expanded');
                    const body = _buildPassAccordionBody(pass.norad_id, pass.name || pass.norad_id);
                    card.appendChild(body);
                    // Select the satellite for live telemetry
                    if (issControl)
                        issControl.switchSatellite(pass.norad_id, pass.name || pass.norad_id);
                    // Fetch sat-specific passes
                    void _fetchAndPopulateAccordion(pass.norad_id, body);
                    card.scrollIntoView({ block: 'nearest' });
                }
            });
            list.appendChild(card);
        });
        _startListCountdownTick();
    }
    function _startListCountdownTick() {
        if (_listTickInterval)
            clearInterval(_listTickInterval);
        _listTickInterval = setInterval(() => {
            const now = Date.now();
            document.querySelectorAll('.spp-pass-card').forEach(el => {
                const aosMs = parseInt(el.dataset['aosMs'] || '0', 10);
                const losMs = parseInt(el.dataset['losMs'] || '0', 10);
                const aosEl = el.querySelector('.spp-pass-aos');
                if (!aosEl)
                    return;
                if (now >= aosMs && now <= losMs) {
                    aosEl.textContent = 'IN PROGRESS';
                    aosEl.classList.add('spp-in-progress');
                }
                else {
                    aosEl.classList.remove('spp-in-progress');
                    const msUntil = aosMs - now;
                    if (msUntil < 0) {
                        aosEl.textContent = 'PASSED';
                    }
                    else if (msUntil < 3600000) {
                        aosEl.textContent = _formatCountdown(msUntil);
                    }
                }
            });
        }, 1000);
    }
    // ---- Public API ----
    function open() {
        _injectHTML();
        _open = true;
        if (window._MapSidebar) {
            window._MapSidebar.show();
            window._MapSidebar.switchTab('passes');
        }
        void _fetchPasses();
        if (_refreshInterval)
            clearInterval(_refreshInterval);
        _refreshInterval = setInterval(() => { void _fetchPasses(); }, 5 * 60 * 1000);
        if (!_listTickInterval)
            _startListCountdownTick();
    }
    function close() {
        _open = false;
        _collapseExpanded();
        if (_refreshInterval) {
            clearInterval(_refreshInterval);
            _refreshInterval = null;
        }
        if (_locationPollInterval) {
            clearInterval(_locationPollInterval);
            _locationPollInterval = null;
        }
        if (_fetchAbort) {
            _fetchAbort.abort();
            _fetchAbort = null;
        }
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
        const pane = document.getElementById('msb-pane-passes');
        if (pane) {
            _injectHTML();
            // Auto-populate immediately if location is available
            if (spaceUserLocationCenter)
                void _fetchPasses();
            else
                _showNoLocation();
        }
        else {
            document.addEventListener('DOMContentLoaded', () => {
                _injectHTML();
                if (spaceUserLocationCenter)
                    void _fetchPasses();
                else
                    _showNoLocation();
            });
        }
        // Re-fetch whenever the PASSES tab is activated
        document.addEventListener('click', (e) => {
            const targetElement = e.target;
            if (targetElement && targetElement.closest('.msb-tab') && targetElement.closest('.msb-tab').dataset['tab'] === 'passes') {
                if (_injected)
                    void _fetchPasses();
            }
        });
        // Forward live telemetry into the expanded pass accordion
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
