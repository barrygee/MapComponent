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
    let _clearPreviewTimer: ReturnType<typeof setTimeout> | null = null;

    function _scheduleClearPreview(): void {
        if (_clearPreviewTimer) clearTimeout(_clearPreviewTimer);
        _clearPreviewTimer = setTimeout(() => {
            _clearPreviewTimer = null;
            if (issControl) issControl.clearPreview();
        }, 50);
    }

    function _cancelClearPreview(): void {
        if (_clearPreviewTimer) { clearTimeout(_clearPreviewTimer); _clearPreviewTimer = null; }
    }
    let _currentPasses: SatPass[] = [];
    let _selectedCategories: Set<string> = new Set(['space_station', 'weather', 'amateur']);
    let _minEl: number = 35;
    let _hours: number = 24;
    let _filtersExpanded: boolean = false;
    let _refreshInterval: ReturnType<typeof setInterval> | null = null;
    let _tickInterval: ReturnType<typeof setInterval> | null = null;
    let _locationPollInterval: ReturnType<typeof setInterval> | null = null;
    let _fetchAbort: AbortController | null = null;

    interface SatPass {
        norad_id:          string;
        name:              string;
        category:          string | null;
        aos_utc:           string;
        los_utc:           string;
        aos_unix_ms:       number;
        los_unix_ms:       number;
        duration_s:        number;
        max_elevation_deg: number;
        max_el_utc:        string;
    }

    interface PassesApiResponse {
        passes:          SatPass[];
        obs_lat:         number;
        obs_lon:         number;
        lookahead_hours: number;
        satellite_count: number;
        computed_at:     string;
        error?:          string;
    }

    const _CATEGORY_ORDER = [
        'space_station', 'active', 'weather', 'navigation',
        'military', 'amateur', 'science', 'cubesat', 'unknown',
    ];

    const _CATEGORY_LABELS: Record<string, string> = {
        space_station: 'STATION',
        active:        'ACTIVE',
        weather:       'WEATHER',
        navigation:    'NAV',
        military:      'MIL',
        amateur:       'AMATEUR',
        science:       'SCI',
        cubesat:       'CUBE',
        unknown:       'UNKN',
    };

    const _CATEGORY_DISPLAY: Record<string, string> = {
        space_station: 'Space Station',
        active:        'Active',
        weather:       'Weather',
        navigation:    'Navigation',
        military:      'Military',
        amateur:       'Amateur',
        science:       'Science',
        cubesat:       'CubeSat',
        unknown:       'Unknown',
    };

    // ---- Helpers ----

    function _formatCountdown(msUntilAos: number): string {
        const totalSec = Math.max(0, Math.floor(msUntilAos / 1000));
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        if (hours > 0) return `IN ${hours}h ${minutes}m`;
        if (minutes > 0) return `IN ${minutes}m ${seconds}s`;
        return `IN ${seconds}s`;
    }

    function _formatDuration(sec: number): string {
        const minutes = Math.floor(sec / 60);
        const seconds = sec % 60;
        return `${minutes}m ${seconds}s`;
    }

    // ---- Inject HTML into #msb-pane-passes ----

    function _injectHTML(): void {
        if (_injected) return;
        const pane = document.getElementById('msb-pane-passes');
        if (!pane) return;

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
                } else {
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

        let _elDebounce: ReturnType<typeof setTimeout> | null = null;
        elevSlider.addEventListener('input', () => {
            _minEl = parseInt(elevSlider.value, 10);
            elevValue.textContent = `${_minEl}°`;
            _updateFilterSummary(document.getElementById('spp-filter-summary'));
            if (_elDebounce) clearTimeout(_elDebounce);
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

        ([6, 12, 24] as const).forEach(h => {
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

    function _updateFilterSummary(el: HTMLElement | null): void {
        if (!el) return;
        const catCount = _selectedCategories.size;
        el.textContent = `${catCount} SAT TYPE${catCount !== 1 ? 'S' : ''} · ${_minEl}° · ${_hours}H`;
    }

    // ---- Fetch ----

    async function _fetchPasses(): Promise<void> {
        if (_fetchAbort) _fetchAbort.abort();
        _fetchAbort = new AbortController();
        const abort = _fetchAbort;

        if (!spaceUserLocationCenter) {
            _showNoLocation();
            return;
        }
        const [lon, lat] = spaceUserLocationCenter;
        const cats = Array.from(_selectedCategories).join(',');
        if (!cats) { _showMessage('Select at least one satellite category.'); return; }

        _setLoading(true);
        try {
            const url = `/api/space/passes?lat=${lat}&lon=${lon}&hours=${_hours}&min_el=${_minEl}&categories=${encodeURIComponent(cats)}&limit=100`;
            const resp = await fetch(url, { signal: abort.signal });
            if (abort.signal.aborted) return;
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({})) as { error?: string; no_tle_data?: boolean };
                if (data.no_tle_data) { _showMessage('No TLE data. Import satellites in Settings.'); return; }
                _showMessage(`Error ${resp.status} — ${data.error || 'Failed to load passes'}`);
                return;
            }
            const data = await resp.json() as PassesApiResponse;
            _currentPasses = data.passes || [];
            _renderPasses(_currentPasses);
            _updateStatusBar(data.satellite_count, data.computed_at);
        } catch (e: unknown) {
            if (e instanceof Error && e.name === 'AbortError') return;
            _showMessage('Network error — check connection and retry.');
        } finally {
            _setLoading(false);
        }
    }

    // ---- UI state helpers ----

    function _setLoading(on: boolean): void {
        const status     = document.getElementById('spp-status-bar');
        const filterBody = document.getElementById('spp-filter-body');
        if (!status) return;
        if (on) {
            status.textContent = 'COMPUTING PASSES…';
            status.classList.add('spp-loading');
            if (filterBody) filterBody.style.opacity = '0.5';
        } else {
            status.classList.remove('spp-loading');
            if (filterBody) filterBody.style.opacity = '';
        }
    }

    function _showNoLocation(): void {
        const list = document.getElementById('spp-list');
        if (!list) return;
        list.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'spp-message';
        msg.innerHTML = `<div>Set your location to calculate passes.</div><button class="spp-action-btn" id="spp-set-location-btn">SET LOCATION</button>`;
        list.appendChild(msg);
        const btn = document.getElementById('spp-set-location-btn');
        if (btn) btn.addEventListener('click', () => { if (typeof goToSpaceUserLocation === 'function') goToSpaceUserLocation(); });
        if (!_locationPollInterval) {
            let pollCount = 0;
            _locationPollInterval = setInterval(() => {
                pollCount++;
                if (spaceUserLocationCenter) {
                    clearInterval(_locationPollInterval!);
                    _locationPollInterval = null;
                    void _fetchPasses();
                } else if (pollCount > 120) {
                    clearInterval(_locationPollInterval!);
                    _locationPollInterval = null;
                }
            }, 500);
        }
    }

    function _showMessage(text: string): void {
        const list = document.getElementById('spp-list');
        if (!list) return;
        list.innerHTML = `<div class="spp-message">${text}</div>`;
    }

    function _updateStatusBar(satCount: number, computedAt: string): void {
        const status = document.getElementById('spp-status-bar');
        if (!status) return;
        const computedDate = new Date(computedAt);
        const timeStr = computedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        status.textContent = `${satCount} SATELLITES · UPDATED ${timeStr}`;
        status.classList.remove('spp-loading');
    }

    // ---- Render ----

    function _renderPasses(passes: SatPass[]): void {
        const list = document.getElementById('spp-list');
        if (!list) return;
        list.innerHTML = '';

        if (!passes.length) {
            list.innerHTML = `<div class="spp-message">No passes found. Try broader categories, lower elevation, or longer window.</div>`;
            return;
        }

        const now = Date.now();
        passes.forEach(pass => {
            const card = document.createElement('div');
            card.className = 'spp-pass-card';
            card.dataset['noradId'] = pass.norad_id;
            card.dataset['aosMs']   = String(pass.aos_unix_ms);
            card.dataset['losMs']   = String(pass.los_unix_ms);

            const catLabel = pass.category
                ? (_CATEGORY_LABELS[pass.category] || pass.category.toUpperCase())
                : '';

            const isInProgress = now >= pass.aos_unix_ms && now <= pass.los_unix_ms;
            let aosText: string;
            if (isInProgress) {
                aosText = 'IN PROGRESS';
            } else {
                const msUntil = pass.aos_unix_ms - now;
                aosText = msUntil < 3600_000
                    ? _formatCountdown(msUntil)
                    : new Date(pass.aos_unix_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

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

            card.appendChild(info);
            card.appendChild(meta);

            card.addEventListener('mouseenter', () => { _cancelClearPreview(); if (issControl) issControl.previewSatellite(pass.norad_id, pass.name || pass.norad_id); });
            card.addEventListener('mouseleave', () => { _scheduleClearPreview(); });
            card.addEventListener('click', () => {
                if (issControl) issControl.switchSatellite(pass.norad_id, pass.name || pass.norad_id);
                close();
            });

            list.appendChild(card);
        });

        _startCountdownTick();
    }

    function _startCountdownTick(): void {
        if (_tickInterval) clearInterval(_tickInterval);
        _tickInterval = setInterval(() => {
            const now = Date.now();
            document.querySelectorAll<HTMLElement>('.spp-pass-card').forEach(el => {
                const aosMs = parseInt(el.dataset['aosMs'] || '0', 10);
                const losMs = parseInt(el.dataset['losMs'] || '0', 10);
                const aosEl = el.querySelector('.spp-pass-aos') as HTMLElement | null;
                if (!aosEl) return;
                if (now >= aosMs && now <= losMs) {
                    aosEl.textContent = 'IN PROGRESS';
                    aosEl.classList.add('spp-in-progress');
                } else {
                    aosEl.classList.remove('spp-in-progress');
                    const msUntil = aosMs - now;
                    if (msUntil < 0) {
                        aosEl.textContent = 'PASSED';
                    } else if (msUntil < 3600_000) {
                        aosEl.textContent = _formatCountdown(msUntil);
                    }
                }
            });
        }, 1000);
    }

    // ---- Public API ----

    function open(): void {
        _injectHTML();
        _open = true;
        if (window._MapSidebar) { window._MapSidebar.show(); window._MapSidebar.switchTab('passes'); }
        void _fetchPasses();
        if (_refreshInterval) clearInterval(_refreshInterval);
        _refreshInterval = setInterval(() => { void _fetchPasses(); }, 5 * 60 * 1000);
        if (!_tickInterval) _startCountdownTick();
    }

    function close(): void {
        _open = false;
        if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
        if (_locationPollInterval) { clearInterval(_locationPollInterval); _locationPollInterval = null; }
        if (_fetchAbort) { _fetchAbort.abort(); _fetchAbort = null; }
        _cancelClearPreview();
        if (issControl) issControl.clearPreview();
    }

    function toggle(): void {
        if (_open) close(); else open();
    }

    function init(): void {
        const pane = document.getElementById('msb-pane-passes');
        if (pane) {
            _injectHTML();
            // Auto-populate immediately if location is available
            if (spaceUserLocationCenter) void _fetchPasses();
            else _showNoLocation();
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                _injectHTML();
                if (spaceUserLocationCenter) void _fetchPasses();
                else _showNoLocation();
            });
        }

        // Re-fetch whenever the PASSES tab is activated
        document.addEventListener('click', (e: MouseEvent) => {
            const targetElement = e.target as HTMLElement | null;
            if (targetElement && targetElement.closest('.msb-tab') && (targetElement.closest('.msb-tab') as HTMLElement).dataset['tab'] === 'passes') {
                if (_injected) void _fetchPasses();
            }
        });
    }

    return { open, close, toggle, init };

})();
