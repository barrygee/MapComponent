// ============================================================
// SAT INFO PANEL  (_SatInfoPanel IIFE)
// Collapsible panel injected at the bottom of #map-sidebar
// (outside the pane container so it appears on every tab).
// Auto-expands when a satellite is selected, showing upcoming
// passes for that satellite over the user's location.
//
// Structure (appended to #map-sidebar):
//   #sip-toggle        — clickable header row
//   #sip-body          — collapsible content (passes list)
//
// PUBLIC API: init(), show(noradId, name), close()
// Depends on: spaceUserLocationCenter (global), window._MapSidebar
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../../types.ts" />

window._SatInfoPanel = (() => {

    let _injected        = false;
    let _expanded        = false;
    let _currentNoradId: string | null = null;
    let _fetchAbort: AbortController | null = null;
    let _tickInterval:   ReturnType<typeof setInterval> | null = null;
    let _locationPoll:   ReturnType<typeof setInterval> | null = null;

    interface SatPass {
        aos_utc:           string;
        los_utc:           string;
        aos_unix_ms:       number;
        los_unix_ms:       number;
        duration_s:        number;
        max_elevation_deg: number;
        max_el_utc:        string;
    }

    interface PassesApiResponse {
        passes:      SatPass[];
        computed_at: string;
        error?:      string;
    }

    // ---- Helpers ----

    function _formatCountdown(ms: number): string {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
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

    function _formatTime(utc: string): string {
        return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function _formatDate(utc: string): string {
        return new Date(utc).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ---- DOM helpers ----

    function _getToggle()  { return document.getElementById('sip-toggle'); }
    function _getBody()    { return document.getElementById('sip-body'); }
    function _getList()    { return document.getElementById('sip-list'); }
    function _getStatus()  { return document.getElementById('sip-status'); }
    function _getNameEl()  { return document.getElementById('sip-sat-name'); }
    function _getNoradEl() { return document.getElementById('sip-sat-norad'); }

    // ---- Inject HTML into #map-sidebar (before panes, always visible) ----

    function _injectHTML(): void {
        if (_injected) return;
        const sidebar = document.getElementById('map-sidebar');
        if (!sidebar) return;

        // Toggle header
        const toggle = document.createElement('button');
        toggle.id        = 'sip-toggle';
        toggle.className = 'sip-toggle sip-hidden';
        toggle.setAttribute('aria-expanded', 'false');

        const toggleLeft = document.createElement('span');
        toggleLeft.className = 'sip-toggle-left';

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'sip-toggle-icon';
        toggleIcon.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        const toggleLabel = document.createElement('span');
        toggleLabel.className = 'sip-toggle-label';
        toggleLabel.textContent = 'SELECTED SATELLITE INFO';

        toggleLeft.appendChild(toggleIcon);
        toggleLeft.appendChild(toggleLabel);

        // Right side: sat name + norad (shown when collapsed)
        const toggleRight = document.createElement('span');
        toggleRight.className = 'sip-toggle-right';

        const satName = document.createElement('span');
        satName.id        = 'sip-sat-name';
        satName.className = 'sip-sat-name';
        satName.textContent = '';

        const satNorad = document.createElement('span');
        satNorad.id        = 'sip-sat-norad';
        satNorad.className = 'sip-sat-norad';
        satNorad.textContent = '';

        toggleRight.appendChild(satName);
        toggleRight.appendChild(satNorad);

        toggle.appendChild(toggleLeft);
        toggle.appendChild(toggleRight);

        // Collapsible body
        const body = document.createElement('div');
        body.id        = 'sip-body';
        body.className = 'sip-body sip-hidden';

        // Sat name header inside body (shown when expanded)
        const bodyHeader = document.createElement('div');
        bodyHeader.id        = 'sip-body-header';
        bodyHeader.className = 'sip-body-header';

        const bodyName = document.createElement('div');
        bodyName.id        = 'sip-body-name';
        bodyName.className = 'sip-body-name';
        bodyName.textContent = '';

        const bodyNorad = document.createElement('div');
        bodyNorad.id        = 'sip-body-norad';
        bodyNorad.className = 'sip-body-norad';
        bodyNorad.textContent = '';

        bodyHeader.appendChild(bodyName);
        bodyHeader.appendChild(bodyNorad);

        // Live telemetry section
        const liveData = document.createElement('div');
        liveData.id        = 'sip-live-data';
        liveData.className = 'sip-live-data';

        const fields: [string, string][] = [
            ['ALT', '—'],
            ['VEL', '—'],
            ['HDG', '—'],
            ['LAT', '—'],
            ['LON', '—'],
        ];
        fields.forEach(([lbl]) => {
            const row = document.createElement('div');
            row.className = 'sip-live-row';
            const labelEl = document.createElement('span');
            labelEl.className = 'sip-live-label';
            labelEl.textContent = lbl;
            const valueEl = document.createElement('span');
            valueEl.className  = 'sip-live-value';
            valueEl.id         = `sip-live-${lbl.toLowerCase()}`;
            valueEl.textContent = '—';
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            liveData.appendChild(row);
        });

        // Status bar
        const status = document.createElement('div');
        status.id        = 'sip-status';
        status.className = 'sip-status';

        // Pass list
        const list = document.createElement('div');
        list.id        = 'sip-list';
        list.className = 'sip-list';

        body.appendChild(bodyHeader);
        body.appendChild(liveData);
        body.appendChild(status);
        body.appendChild(list);

        // Wire toggle click
        toggle.addEventListener('click', () => {
            _expanded = !_expanded;
            body.classList.toggle('sip-expanded', _expanded);
            toggle.classList.toggle('sip-expanded', _expanded);
            toggle.setAttribute('aria-expanded', String(_expanded));
        });

        // Insert sat-info toggle/body immediately after #map-sidebar-panes so it
        // appears above the FILTERS section (which space-passes appends after panes).
        const panesEl = sidebar.querySelector('#map-sidebar-panes');
        if (panesEl && panesEl.nextSibling) {
            sidebar.insertBefore(toggle, panesEl.nextSibling);
            sidebar.insertBefore(body, toggle.nextSibling);
        } else {
            sidebar.appendChild(toggle);
            sidebar.appendChild(body);
        }

        _injected = true;
    }

    // ---- Fetch ----

    async function _fetchPasses(noradId: string): Promise<void> {
        if (_fetchAbort) _fetchAbort.abort();
        _fetchAbort = new AbortController();
        const abort = _fetchAbort;

        if (!spaceUserLocationCenter) {
            _showNoLocation();
            return;
        }

        const [lon, lat] = spaceUserLocationCenter;
        _setStatus('COMPUTING PASSES…', true);

        try {
            const url = `/api/space/satellite/${encodeURIComponent(noradId)}/passes?lat=${lat}&lon=${lon}&hours=24&min_el=0`;
            const resp = await fetch(url, { signal: abort.signal });
            if (abort.signal.aborted) return;
            if (!resp.ok) { _showMessage('Could not load passes.'); return; }
            const data = await resp.json() as PassesApiResponse;
            _renderPasses(data.passes || [], data.computed_at);
        } catch (e: unknown) {
            if (e instanceof Error && e.name === 'AbortError') return;
            _showMessage('Network error.');
        }
    }

    // ---- UI helpers ----

    function _setStatus(text: string, loading = false): void {
        const el = _getStatus();
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('sip-loading', loading);
    }

    function _showMessage(text: string): void {
        const list = _getList();
        if (list) list.innerHTML = `<div class="sip-message">${text}</div>`;
        _setStatus('', false);
    }

    function _showNoLocation(): void {
        const list = _getList();
        if (!list) return;
        list.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'sip-message';
        msg.innerHTML = `<div>Set your location to calculate passes.</div><button class="sip-action-btn" id="sip-set-loc-btn">SET LOCATION</button>`;
        list.appendChild(msg);
        const btn = document.getElementById('sip-set-loc-btn');
        if (btn) btn.addEventListener('click', () => { if (typeof goToSpaceUserLocation === 'function') goToSpaceUserLocation(); });
        if (!_locationPoll) {
            let n = 0;
            _locationPoll = setInterval(() => {
                n++;
                if (spaceUserLocationCenter && _currentNoradId) {
                    clearInterval(_locationPoll!); _locationPoll = null;
                    void _fetchPasses(_currentNoradId);
                } else if (n > 120) { clearInterval(_locationPoll!); _locationPoll = null; }
            }, 500);
        }
    }

    // ---- Render ----

    function _renderPasses(passes: SatPass[], computedAt: string): void {
        const list = _getList();
        if (!list) return;

        const computedDate = new Date(computedAt);
        _setStatus(`NEXT 24H · UPDATED ${computedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, false);

        list.innerHTML = '';
        if (!passes.length) {
            list.innerHTML = `<div class="sip-message">No passes in the next 24 hours.</div>`;
            return;
        }

        const now = Date.now();
        passes.forEach((pass, i) => {
            const card = document.createElement('div');
            card.className = 'sip-pass-card';
            card.dataset['aosMs'] = String(pass.aos_unix_ms);
            card.dataset['losMs'] = String(pass.los_unix_ms);

            const isNow = now >= pass.aos_unix_ms && now <= pass.los_unix_ms;

            const num = document.createElement('div');
            num.className = 'sip-pass-num';
            num.textContent = String(i + 1).padStart(2, '0');

            const times = document.createElement('div');
            times.className = 'sip-pass-times';

            const aosRow = document.createElement('div');
            aosRow.className = 'sip-pass-aos-row';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'sip-pass-date';
            dateSpan.textContent = _formatDate(pass.aos_utc);

            const timeSpan = document.createElement('span');
            timeSpan.className = 'sip-pass-time';
            timeSpan.textContent = _formatTime(pass.aos_utc);

            aosRow.appendChild(dateSpan);
            aosRow.appendChild(timeSpan);

            const losRow = document.createElement('div');
            losRow.className = 'sip-pass-los';
            losRow.textContent = `LOS ${_formatTime(pass.los_utc)} · ${_formatDuration(pass.duration_s)}`;

            times.appendChild(aosRow);
            times.appendChild(losRow);

            const meta = document.createElement('div');
            meta.className = 'sip-pass-meta';

            const countdown = document.createElement('div');
            countdown.className = 'sip-pass-countdown' + (isNow ? ' sip-in-progress' : '');
            countdown.textContent = isNow ? 'NOW' : _formatCountdown(pass.aos_unix_ms - now);

            const maxEl = document.createElement('div');
            maxEl.className = 'sip-pass-maxel';
            maxEl.textContent = `MAX ${pass.max_elevation_deg.toFixed(1)}°`;

            meta.appendChild(countdown);
            meta.appendChild(maxEl);

            card.appendChild(num);
            card.appendChild(times);
            card.appendChild(meta);
            list.appendChild(card);
        });

        _startTick();
    }

    function _startTick(): void {
        if (_tickInterval) clearInterval(_tickInterval);
        _tickInterval = setInterval(() => {
            const now = Date.now();
            document.querySelectorAll<HTMLElement>('.sip-pass-card').forEach(el => {
                const aosMs = parseInt(el.dataset['aosMs'] || '0', 10);
                const losMs = parseInt(el.dataset['losMs'] || '0', 10);
                const cd = el.querySelector('.sip-pass-countdown') as HTMLElement | null;
                if (!cd) return;
                if (now >= aosMs && now <= losMs) {
                    cd.textContent = 'NOW';
                    cd.classList.add('sip-in-progress');
                } else if (now > losMs) {
                    cd.textContent = 'PASSED';
                    cd.classList.remove('sip-in-progress');
                } else {
                    cd.classList.remove('sip-in-progress');
                    cd.textContent = _formatCountdown(aosMs - now);
                }
            });
        }, 1000);
    }

    // ---- Public API ----

    function show(noradId: string, name: string): void {
        _injectHTML();
        _currentNoradId = noradId;

        // Update all name labels
        const nameEl    = _getNameEl();
        const noradEl   = _getNoradEl();
        const bodyName  = document.getElementById('sip-body-name');
        const bodyNorad = document.getElementById('sip-body-norad');
        if (nameEl)    nameEl.textContent    = name;
        if (noradEl)   noradEl.textContent   = `NORAD ${noradId}`;
        if (bodyName)  bodyName.textContent  = name;
        if (bodyNorad) bodyNorad.textContent = `NORAD ${noradId}`;

        // Auto-expand — but don't switch tabs
        _expanded = true;
        const body   = _getBody();
        const toggle = _getToggle();
        if (toggle) { toggle.classList.remove('sip-hidden'); toggle.classList.add('sip-expanded'); toggle.setAttribute('aria-expanded', 'true'); }
        if (body)   { body.classList.remove('sip-hidden'); body.classList.add('sip-expanded'); }

        // Show sidebar (whatever tab is active stays active)
        if (window._MapSidebar) window._MapSidebar.show();

        // Clear old tick
        if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }

        // Fetch passes
        if (spaceUserLocationCenter) void _fetchPasses(noradId);
        else _showNoLocation();
    }

    function close(): void {
        _currentNoradId = null;
        if (_fetchAbort)   { _fetchAbort.abort(); _fetchAbort = null; }
        if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
        if (_locationPoll) { clearInterval(_locationPoll); _locationPoll = null; }
        const toggle = _getToggle();
        const body   = _getBody();
        if (toggle) toggle.classList.add('sip-hidden');
        if (body)   body.classList.add('sip-hidden');
    }

    function updatePosition(p: { alt_km: number; velocity_kms: number; track_deg: number; lat: number; lon: number }): void {
        const set = (id: string, val: string) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        set('sip-live-alt', `${p.alt_km} km`);
        set('sip-live-vel', `${p.velocity_kms} km/s`);
        set('sip-live-hdg', `${p.track_deg}°`);
        set('sip-live-lat', `${p.lat}°`);
        set('sip-live-lon', `${p.lon}°`);

        // Broadcast to inline accordions in search and passes panels
        document.dispatchEvent(new CustomEvent('sat-position-update', {
            detail: { noradId: _currentNoradId, position: p }
        }));
    }

    function init(): void {
        const sidebar = document.getElementById('map-sidebar');
        if (sidebar) _injectHTML();
        else document.addEventListener('DOMContentLoaded', () => { _injectHTML(); });

        // Update internal state (for telemetry broadcast) when a satellite is selected,
        // but do NOT auto-show the panel — inline accordions handle display now.
        document.addEventListener('satellite-selected', (e: Event) => {
            const { noradId, name } = (e as CustomEvent<{ noradId: string; name: string }>).detail;
            _currentNoradId = noradId;
            // Update name labels in case panel is manually opened
            const nameEl    = _getNameEl();
            const noradEl   = _getNoradEl();
            const bodyName  = document.getElementById('sip-body-name');
            const bodyNorad = document.getElementById('sip-body-norad');
            if (nameEl)    nameEl.textContent    = name;
            if (noradEl)   noradEl.textContent   = `NORAD ${noradId}`;
            if (bodyName)  bodyName.textContent  = name;
            if (bodyNorad) bodyNorad.textContent = `NORAD ${noradId}`;
        });
    }

    return { init, show, close, updatePosition };

})();
