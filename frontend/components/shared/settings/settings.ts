/* ============================================================
   SETTINGS PANEL — window._SettingsPanel
   ============================================================ */

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />

window._SettingsPanel = (function () {

    // ── State ────────────────────────────────────────────────
    let _open = false;
    let _activeSection = 'app';

    // Pending changes map: key → { commit: () => void }
    const _pending: Map<string, { commit: () => void }> = new Map();

    // ── Settings registry ────────────────────────────────────
    interface SettingItem {
        section:       string;
        sectionLabel:  string;
        id:            string;
        label:         string;
        desc:          string;
        groupLabel?:   string;
        renderControl: () => HTMLElement;
    }

    interface NavSection {
        key:   string;
        label: string;
    }

    const _settings: SettingItem[] = [
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'connectivity-mode',
            label:         'Connectivity Mode',
            desc:          'Use online or offline data sources across the app',
            renderControl: _renderConnectivityToggle,
        },
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'app-connectivity-probe',
            label:         'Connectivity Probe URL',
            desc:          'URL polled every 2 seconds to detect internet access',
            renderControl: function () { return _renderConnectivityProbeControl(); },
        },
{
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'location',
            label:         'My Location',
            desc:          'Set a fixed latitude / longitude for your position',
            renderControl: _renderLocationControl,
        },
        // AIR
        {
            section:       'air',
            sectionLabel:  'AIR',
            id:            'air-source-override',
            label:         'Source Override',
            desc:          'Override the app-level connectivity mode for this domain',
            renderControl: function () { return _renderSourceOverrideControl('air'); },
        },
        {
            section:       'air',
            sectionLabel:  'AIR',
            id:            'air-online-source',
            label:         'Online Data Source',
            desc:          'URL for live air data feed',
            renderControl: function () { return _renderOnlineSourceControl('air', 'https://api.airplanes.live/v2'); },
        },
        {
            section:       'air',
            sectionLabel:  'AIR',
            id:            'air-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for air data',
            renderControl: function () { return _renderOfflineSourceControl('air', ''); },
        },
        // SPACE
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-online-source',
            label:         'Online Data Source',
            desc:          'URL to fetch TLE data from — select a category and click UPDATE TLE',
            groupLabel:    'DATA SOURCES',
            renderControl: _renderSpaceOnlineSourceControl,
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-manual-tle',
            label:         'TLE Import',
            desc:          'Upload a .txt file of TLE data',
            renderControl: _renderSpaceManualTleControl,
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-tle-database',
            label:         'TLE Database',
            desc:          'Satellite count, sources, and per-category last-updated times',
            renderControl: _renderSpaceTleDatabaseControl,
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-tle-uncategorised',
            label:         'Uncategorised Satellites',
            desc:          'Assign categories to satellites imported without one',
            renderControl: _renderSpaceTleUncategorisedControl,
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-tle-satlist',
            label:         'Satellite List',
            desc:          'Full list of all TLE records stored in the database',
            renderControl: _renderSpaceTleSatListControl,
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-filter-hover-preview',
            label:         'Filter Hover Behaviour',
            desc:          'When hovering a satellite in the search results, choose whether the map stays in place or flies to that satellite',
            groupLabel:    'FILTER HOVER',
            renderControl: _renderSpaceHoverPreviewControl,
        },
        // SEA
        {
            section:       'sea',
            sectionLabel:  'SEA',
            id:            'sea-source-override',
            label:         'Source Override',
            desc:          'Override the app-level connectivity mode for this domain',
            renderControl: function () { return _renderSourceOverrideControl('sea'); },
        },
        {
            section:       'sea',
            sectionLabel:  'SEA',
            id:            'sea-online-source',
            label:         'Online Data Source',
            desc:          'URL for live sea data feed',
            renderControl: function () { return _renderOnlineSourceControl('sea', ''); },
        },
        {
            section:       'sea',
            sectionLabel:  'SEA',
            id:            'sea-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for sea data',
            renderControl: function () { return _renderOfflineSourceControl('sea', ''); },
        },
        // LAND
        {
            section:       'land',
            sectionLabel:  'LAND',
            id:            'land-source-override',
            label:         'Source Override',
            desc:          'Override the app-level connectivity mode for this domain',
            renderControl: function () { return _renderSourceOverrideControl('land'); },
        },
        {
            section:       'land',
            sectionLabel:  'LAND',
            id:            'land-online-source',
            label:         'Online Data Source',
            desc:          'URL for live land data feed',
            renderControl: function () { return _renderOnlineSourceControl('land', ''); },
        },
        {
            section:       'land',
            sectionLabel:  'LAND',
            id:            'land-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for land data',
            renderControl: function () { return _renderOfflineSourceControl('land', ''); },
        },
        // CONFIG
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'config-current',
            label:         'Application Config',
            desc:          'Settings currently stored in the database',
            renderControl: _renderConfigCurrentControl,
        },
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'config-upload',
            label:         'Upload New Application Config File',
            desc:          'Upload a JSON config file — preview its contents, then apply to replace all current settings',
            renderControl: _renderConfigUploadControl,
        },
    ];

    const _NAV_SECTIONS: NavSection[] = [
        { key: 'app',   label: 'App Settings' },
        { key: 'air',   label: 'AIR' },
        { key: 'space', label: 'SPACE' },
        { key: 'sea',   label: 'SEA' },
        { key: 'land',  label: 'LAND' },
        { key: 'sdr',    label: 'SDR' },
    ];

    // ── DOM injection ────────────────────────────────────────
    (function _injectHTML() {
        if (document.getElementById('settings-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'settings-panel';

        // Sidebar
        const sidebar = document.createElement('div');
        sidebar.id = 'settings-sidebar';
        _NAV_SECTIONS.forEach(function (s) {
            const item = document.createElement('div');
            item.className = 'settings-nav-item' + (s.key === 'app' ? ' active' : '');
            item.textContent = s.label;
            item.dataset['section'] = s.key;
            sidebar.appendChild(item);
        });

        // Content area
        const content = document.createElement('div');
        content.id = 'settings-content';

        // Section heading
        const sectionHeading = document.createElement('div');
        sectionHeading.id = 'settings-section-heading';
        sectionHeading.textContent = 'App Settings';

        // Search row
        const searchWrap = document.createElement('div');
        searchWrap.id = 'settings-search-wrap';
        searchWrap.innerHTML =
            '<div id="settings-search-inner">' +
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                    '<circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>' +
                    '<line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
                '</svg>' +
                '<input id="settings-search-input" type="text" placeholder="SEARCH SETTINGS" autocomplete="off" spellcheck="false">' +
                '<button id="settings-search-clear" aria-label="Clear search">' +
                    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                        '<line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                        '<line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                    '</svg>' +
                '</button>' +
            '</div>';

        // Body
        const body = document.createElement('div');
        body.id = 'settings-body';

        // Footer bar with Apply Changes button
        const footer = document.createElement('div');
        footer.id = 'settings-footer';

        const applyStatus = document.createElement('span');
        applyStatus.id = 'settings-apply-status';

        const applyBtn = document.createElement('button');
        applyBtn.id = 'settings-apply-btn';
        applyBtn.textContent = 'APPLY CHANGES';

        footer.appendChild(applyStatus);
        footer.appendChild(applyBtn);

        content.appendChild(sectionHeading);
        content.appendChild(searchWrap);
        content.appendChild(body);
        content.appendChild(footer);

        panel.appendChild(sidebar);
        panel.appendChild(content);
        document.body.appendChild(panel);
    })();

    // ── Apply button logic ────────────────────────────────────
    function _showApplyStatus(msg: string, isError: boolean): void {
        const status = document.getElementById('settings-apply-status');
        if (!status) return;
        status.textContent = msg;
        status.className = isError
            ? 'settings-apply-status--error'
            : 'settings-apply-status--ok';
        setTimeout(function () {
            status.textContent = '';
            status.className = '';
        }, 2500);
    }

    function _commitAll(): void {
        if (_pending.size === 0) {
            _showApplyStatus('NO CHANGES', false);
            return;
        }
        let hasError = false;
        _pending.forEach(function (entry) {
            try {
                entry.commit();
            } catch (e) {
                hasError = true;
            }
        });
        if (!hasError) {
            _pending.clear();
            _showApplyStatus('SAVED', false);
            setTimeout(function () { location.reload(); }, 800);
        } else {
            _showApplyStatus('ERROR', true);
        }
    }

    function _stagePending(id: string, commitFn: () => void): void {
        _pending.set(id, { commit: commitFn });
    }

    function _clearPendingForSection(sectionKey: string): void {
        const ids = _settings
            .filter(function (s) { return s.section === sectionKey; })
            .map(function (s) { return s.id; });
        ids.forEach(function (id) { _pending.delete(id); });
    }

    // ── Controls ─────────────────────────────────────────────

    function _renderConnectivityProbeControl(): HTMLElement {
        const LS_KEY = 'sentinel_app_connectivityProbeUrl';
        const SETTING_ID = 'app-connectivity-probe';

        const wrap = document.createElement('div');
        wrap.className = 'settings-datasource-wrap';

        const urlRow = document.createElement('div');
        urlRow.className = 'settings-datasource-row';

        const urlLabel = document.createElement('span');
        urlLabel.className = 'settings-datasource-label';
        urlLabel.textContent = 'URL';

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'settings-datasource-input';
        urlInput.placeholder = 'https://';
        urlInput.spellcheck = false;
        urlInput.autocomplete = 'off';

        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        wrap.appendChild(urlRow);

        // Load saved value
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (saved) urlInput.value = saved;
        } catch (e) {}

        // Reconcile with backend
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace('app').then(function (data) {
                if (!data || !data['connectivityProbeUrl']) return;
                const backendVal = data['connectivityProbeUrl'] as string;
                if (backendVal && !urlInput.value) {
                    urlInput.value = backendVal;
                    try { localStorage.setItem(LS_KEY, backendVal); } catch (e) {}
                }
            });
        }

        urlInput.addEventListener('input', function () {
            _stagePending(SETTING_ID, function () {
                const val = urlInput.value.trim();
                if (val) {
                    try { new URL(val); } catch (e) {
                        throw new Error('INVALID URL');
                    }
                    try { localStorage.setItem(LS_KEY, val); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put('app', 'connectivityProbeUrl', val);
                } else {
                    try { localStorage.removeItem(LS_KEY); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put('app', 'connectivityProbeUrl', '');
                }
            });
        });

        urlInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') _commitAll();
        });

        return wrap;
    }

    function _renderOnlineSourceControl(ns: string, defaultUrl?: string): HTMLElement {
        const LS_KEY = 'sentinel_' + ns + '_onlineUrl';
        const SETTING_ID = ns + '-online-source';

        const wrap = document.createElement('div');
        wrap.className = 'settings-datasource-wrap';

        const urlRow = document.createElement('div');
        urlRow.className = 'settings-datasource-row';

        const urlLabel = document.createElement('span');
        urlLabel.className = 'settings-datasource-label';
        urlLabel.textContent = 'URL';

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'settings-datasource-input';
        urlInput.placeholder = defaultUrl !== undefined ? defaultUrl : 'https://';
        urlInput.spellcheck = false;
        urlInput.autocomplete = 'off';

        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        wrap.appendChild(urlRow);

        const noDefault = defaultUrl === '';
        function _isOnlinePlaceholder(url: string): boolean {
            return !url.trim() || /^https?:\/\/?$/.test(url.trim());
        }

        // Load saved value
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (saved && !(noDefault && _isOnlinePlaceholder(saved))) {
                urlInput.value = saved;
            } else if (noDefault && saved && _isOnlinePlaceholder(saved)) {
                try { localStorage.removeItem(LS_KEY); } catch (e) {}
            }
        } catch (e) {}

        // Reconcile with backend (skip placeholder values like "https://")
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace(ns).then(function (data) {
                if (!data || !data['onlineUrl']) return;
                const backendVal = data['onlineUrl'] as string;
                if (backendVal && !_isOnlinePlaceholder(backendVal) && !urlInput.value) {
                    urlInput.value = backendVal;
                    try { localStorage.setItem(LS_KEY, backendVal); } catch (e) {}
                } else if (noDefault && backendVal && _isOnlinePlaceholder(backendVal)) {
                    try { localStorage.removeItem(LS_KEY); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put(ns, 'onlineUrl', '');
                }
            });
        }

        urlInput.addEventListener('input', function () {
            _stagePending(SETTING_ID, function () {
                const val = urlInput.value.trim();
                if (val) {
                    try { new URL(val); } catch (e) {
                        throw new Error('INVALID URL');
                    }
                    try { localStorage.setItem(LS_KEY, val); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put(ns, 'onlineUrl', val);
                } else {
                    try { localStorage.removeItem(LS_KEY); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put(ns, 'onlineUrl', '');
                }
            });
        });

        urlInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') _commitAll();
        });

        return wrap;
    }

    function _renderOfflineSourceControl(ns: string, defaultUrl?: string): HTMLElement {
        const LS_KEY = 'sentinel_' + ns + '_offlineSource';
        const SETTING_ID = ns + '-offline-source';

        const wrap = document.createElement('div');
        wrap.className = 'settings-datasource-wrap';

        // URL row
        const urlRow = document.createElement('div');
        urlRow.className = 'settings-datasource-row';
        const urlLabel = document.createElement('span');
        urlLabel.className = 'settings-datasource-label';
        urlLabel.textContent = 'URL';
        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'settings-datasource-input';
        urlInput.placeholder = defaultUrl !== undefined ? defaultUrl : 'http://localhost';
        urlInput.spellcheck = false;
        urlInput.autocomplete = 'off';
        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        wrap.appendChild(urlRow);

        // When defaultUrl is '' the field has no built-in default, so treat
        // placeholder-like values (http://localhost) as empty rather than real URLs.
        const noDefault = defaultUrl === '';
        function _isOfflinePlaceholder(url: string): boolean {
            const t = url.trim();
            return !t || /^http:\/\/localhost\/?$/.test(t);
        }

        // Load saved value
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const saved = JSON.parse(raw) as { url?: string };
                if (saved.url && !(noDefault && _isOfflinePlaceholder(saved.url))) {
                    urlInput.value = saved.url;
                } else if (noDefault && saved.url && _isOfflinePlaceholder(saved.url)) {
                    try { localStorage.removeItem(LS_KEY); } catch (e) {}
                }
            }
        } catch (e) {}

        // Reconcile with backend (skip placeholder values like "http://localhost")
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace(ns).then(function (data) {
                if (!data || !data['offlineSource']) return;
                const backendVal = data['offlineSource'] as { url?: string };
                if (backendVal.url && !_isOfflinePlaceholder(backendVal.url) && !urlInput.value) {
                    urlInput.value = backendVal.url;
                    try { localStorage.setItem(LS_KEY, JSON.stringify(backendVal)); } catch (e) {}
                } else if (noDefault && backendVal.url && _isOfflinePlaceholder(backendVal.url)) {
                    // Stale placeholder in DB — clear it
                    try { localStorage.removeItem(LS_KEY); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put(ns, 'offlineSource', { url: '' });
                } else if (!noDefault) {
                    try { localStorage.setItem(LS_KEY, JSON.stringify(backendVal)); } catch (e) {}
                }
            });
        }

        urlInput.addEventListener('input', function () {
            _stagePending(SETTING_ID, function () {
                const url = urlInput.value.trim();
                if (url) {
                    try { new URL(url); } catch (e) {
                        throw new Error('INVALID URL');
                    }
                }
                const val = { url };
                try { localStorage.setItem(LS_KEY, JSON.stringify(val)); } catch (e) {}
                if (window._SettingsAPI) window._SettingsAPI.put(ns, 'offlineSource', val);
            });
        });

        urlInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') _commitAll();
        });

        return wrap;
    }

    function _renderLocationControl(): HTMLElement {
        const STORAGE_KEY = 'userLocation';

        function _loadSaved(): { latitude: number; longitude: number } | null {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return null;
                return JSON.parse(raw) as { latitude: number; longitude: number };
            } catch (e) { return null; }
        }

        const wrap = document.createElement('div');
        wrap.className = 'settings-location-wrap';

        // Lat row
        const latRow = document.createElement('div');
        latRow.className = 'settings-location-row';
        const latLabel = document.createElement('span');
        latLabel.className = 'settings-location-label';
        latLabel.textContent = 'LAT';
        const latInput = document.createElement('input');
        latInput.type = 'text';
        latInput.className = 'settings-location-input';
        latInput.placeholder = '0.000';
        latInput.spellcheck = false;
        latRow.appendChild(latLabel);
        latRow.appendChild(latInput);

        // Lon row
        const lonRow = document.createElement('div');
        lonRow.className = 'settings-location-row';
        const lonLabel = document.createElement('span');
        lonLabel.className = 'settings-location-label';
        lonLabel.textContent = 'LON';
        const lonInput = document.createElement('input');
        lonInput.type = 'text';
        lonInput.className = 'settings-location-input';
        lonInput.placeholder = '0.000';
        lonInput.spellcheck = false;
        lonRow.appendChild(lonLabel);
        lonRow.appendChild(lonInput);

        wrap.appendChild(latRow);
        wrap.appendChild(lonRow);

        // Populate from saved location
        const saved = _loadSaved();
        if (saved) {
            latInput.value = saved.latitude.toFixed(5);
            lonInput.value = saved.longitude.toFixed(5);
        }

        // Reconcile with backend
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace('app').then(function (data) {
                if (!data || !data['location']) return;
                const loc = data['location'] as { latitude?: number; longitude?: number };
                if (!latInput.value && loc.latitude != null) latInput.value = loc.latitude.toFixed(5);
                if (!lonInput.value && loc.longitude != null) lonInput.value = loc.longitude.toFixed(5);
            });
        }

        function _stageLocation(): void {
            const lat = parseFloat(latInput.value);
            const lon = parseFloat(lonInput.value);
            if (!isNaN(lat) && lat >= -90 && lat <= 90 && !isNaN(lon) && lon >= -180 && lon <= 180) {
                window.dispatchEvent(new CustomEvent('sentinel:setUserLocation', {
                    detail: { longitude: lon, latitude: lat }
                }));
            }
            _stagePending('location', function () {
                const lat = parseFloat(latInput.value);
                const lon = parseFloat(lonInput.value);
                if (isNaN(lat) || lat < -90 || lat > 90) {
                    throw new Error('INVALID LAT');
                }
                if (isNaN(lon) || lon < -180 || lon > 180) {
                    throw new Error('INVALID LON');
                }
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({
                        longitude: lon, latitude: lat, ts: Date.now(), manual: true,
                    }));
                } catch (e) {}
                if (window._SettingsAPI) {
                    window._SettingsAPI.put('app', 'location', { latitude: lat, longitude: lon });
                }
            });
        }

        latInput.addEventListener('input', _stageLocation);
        lonInput.addEventListener('input', _stageLocation);

        latInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') _commitAll();
        });
        lonInput.addEventListener('keydown', function (e: KeyboardEvent) {
            if (e.key === 'Enter') _commitAll();
        });

        return wrap;
    }

    function _renderThemeToggle(): HTMLElement {
        const STORAGE_KEY = 'sentinel_theme';
        let saved = 'dark';
        try { saved = localStorage.getItem(STORAGE_KEY) || 'dark'; } catch (e) {}
        let isDark = saved !== 'light';

        const wrap = document.createElement('div');
        wrap.className = 'settings-theme-switch';

        const labelDark = document.createElement('span');
        labelDark.className = 'settings-theme-label';
        labelDark.textContent = 'DARK';

        const track = document.createElement('button');
        track.className = 'settings-theme-track' + (isDark ? ' is-dark' : '');
        track.setAttribute('role', 'switch');
        track.setAttribute('aria-checked', isDark ? 'true' : 'false');
        track.setAttribute('aria-label', 'Toggle dark mode');

        const thumb = document.createElement('span');
        thumb.className = 'settings-theme-thumb';
        track.appendChild(thumb);

        const labelLight = document.createElement('span');
        labelLight.className = 'settings-theme-label';
        labelLight.textContent = 'LIGHT';

        track.addEventListener('click', function () {
            isDark = !isDark;
            track.classList.toggle('is-dark', isDark);
            track.setAttribute('aria-checked', isDark ? 'true' : 'false');
            const mode = isDark ? 'dark' : 'light';
            // Theme applies immediately — no need to defer to Apply
            try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
            if (window._SettingsAPI) {
                window._SettingsAPI.put('app', 'theme', mode);
            }
        });

        // Phase 2: sync theme from backend (migration + restore)
        (function _syncThemeFromBackend() {
            if (!window._SettingsAPI) return;
            const MIGRATED_FLAG = 'sentinel_settings_migrated_theme';
            if (!localStorage.getItem(MIGRATED_FLAG)) {
                // One-time migration: push existing localStorage value to backend
                const existingMode = saved;
                window._SettingsAPI.put('app', 'theme', existingMode);
                localStorage.setItem(MIGRATED_FLAG, '1');
                return;
            }
            // Fetch from backend and reconcile
            window._SettingsAPI.getNamespace('app').then(function (ns) {
                if (!ns || !ns['theme']) return;
                const backendMode = ns['theme'] as string;
                const localMode = isDark ? 'dark' : 'light';
                if (backendMode !== localMode) {
                    isDark = backendMode === 'dark';
                    track.classList.toggle('is-dark', isDark);
                    track.setAttribute('aria-checked', isDark ? 'true' : 'false');
                    try { localStorage.setItem(STORAGE_KEY, backendMode); } catch (e) {}
                }
            });
        })();

        wrap.appendChild(labelDark);
        wrap.appendChild(track);
        wrap.appendChild(labelLight);

        return wrap;
    }

    // ── Config controls ───────────────────────────────────────

    function _renderConfigCurrentControl(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'settings-config-wrap';
        wrap.dataset['wide'] = 'true';

        const textarea = document.createElement('textarea');
        textarea.className = 'settings-config-preview settings-config-preview--textarea settings-config-preview--hidden';
        textarea.value = 'Loading…';
        textarea.spellcheck = false;
        textarea.autocomplete = 'off';

        const actionRow = document.createElement('div');
        actionRow.className = 'settings-config-action-row';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'settings-config-btn';
        toggleBtn.textContent = 'EDIT';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'settings-config-btn';
        exportBtn.textContent = 'EXPORT';

        const SS_KEY = 'sentinel_config_preview_visible';

        function autoSize() {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }

        // Restore visibility state across renders/reloads
        try {
            if (sessionStorage.getItem(SS_KEY) === '1') {
                textarea.classList.remove('settings-config-preview--hidden');
                toggleBtn.textContent = 'HIDE';
            }
        } catch (e) {}

        toggleBtn.addEventListener('click', function () {
            const hidden = textarea.classList.toggle('settings-config-preview--hidden');
            toggleBtn.textContent = hidden ? 'EDIT' : 'HIDE';
            try { sessionStorage.setItem(SS_KEY, hidden ? '0' : '1'); } catch (e) {}
            if (!hidden) autoSize();
        });

        textarea.addEventListener('input', function () {
            autoSize();
            _stagePending('config-current', function () {
                const content = textarea.value;
                try { JSON.parse(content); } catch (e) { throw new Error('Invalid JSON'); }
                const blob = new Blob([content], { type: 'application/json' });
                const file = new File([blob], 'sentinel_config.json', { type: 'application/json' });
                const formData = new FormData();
                formData.append('file', file);
                fetch('/api/settings/config/upload', { method: 'POST', body: formData })
                    .catch(function () {});
            });
        });

        wrap.appendChild(textarea);
        wrap.appendChild(actionRow);
        actionRow.appendChild(toggleBtn);
        actionRow.appendChild(exportBtn);

        // Export: download the current textarea content as JSON
        exportBtn.addEventListener('click', async function () {
            const content = textarea.value;
            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: 'sentinel_config.json',
                        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(content);
                    await writable.close();
                    return;
                } catch (err: any) {
                    if (err.name === 'AbortError') return; // user cancelled
                }
            }
            // Fallback for browsers without File System Access API
            const blob = new Blob([content], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sentinel_config.json';
            a.click();
            URL.revokeObjectURL(url);
        });

        fetch('/api/settings/config/preview')
            .then(function (res) { return res.json(); })
            .then(function (data) { textarea.value = JSON.stringify(data, null, 2); autoSize(); })
            .catch(function () { textarea.value = 'Failed to load config.'; autoSize(); });

        return wrap;
    }

    function _renderConfigUploadControl(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'settings-config-wrap';

        // File picker row
        const pickerRow = document.createElement('div');
        pickerRow.className = 'settings-config-picker-row';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.className = 'settings-config-file-input';
        fileInput.id = 'settings-config-file-input';

        const chooseLabel = document.createElement('label');
        chooseLabel.htmlFor = 'settings-config-file-input';
        chooseLabel.className = 'settings-config-btn';
        chooseLabel.textContent = 'CHOOSE FILE';

        const filenameSpan = document.createElement('span');
        filenameSpan.className = 'settings-config-filename';
        filenameSpan.textContent = 'No file selected';

        pickerRow.appendChild(fileInput);
        pickerRow.appendChild(chooseLabel);
        pickerRow.appendChild(filenameSpan);

        // Preview box — hidden until a file is chosen
        const pre = document.createElement('pre');
        pre.className = 'settings-config-preview settings-config-preview--hidden';

        // Action row
        const actionRow = document.createElement('div');
        actionRow.className = 'settings-config-action-row settings-config-action-row--hidden';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'settings-config-btn settings-config-upload-btn';
        applyBtn.textContent = 'APPLY CONFIG';

        const statusMsg = document.createElement('span');
        statusMsg.className = 'settings-config-status';

        actionRow.appendChild(applyBtn);
        actionRow.appendChild(statusMsg);

        wrap.appendChild(pickerRow);
        wrap.appendChild(pre);
        wrap.appendChild(actionRow);

        // Read and preview the chosen file locally (no upload yet)
        fileInput.addEventListener('change', function () {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            filenameSpan.textContent = file.name;
            statusMsg.textContent = '';
            statusMsg.className = 'settings-config-status';

            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const parsed = JSON.parse(reader.result as string);
                    pre.textContent = JSON.stringify(parsed, null, 2);
                    pre.classList.remove('settings-config-preview--hidden');
                    actionRow.classList.remove('settings-config-action-row--hidden');
                } catch (e) {
                    pre.textContent = 'Invalid JSON — cannot preview.';
                    pre.classList.remove('settings-config-preview--hidden');
                    actionRow.classList.add('settings-config-action-row--hidden');
                }
            };
            reader.readAsText(file);
        });

        // Apply the previewed config to the backend
        applyBtn.addEventListener('click', function () {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            applyBtn.disabled = true;
            statusMsg.textContent = 'Applying…';
            statusMsg.className = 'settings-config-status';

            const formData = new FormData();
            formData.append('file', file);

            fetch('/api/settings/config/upload', { method: 'POST', body: formData })
                .then(function (res) {
                    if (!res.ok) return res.json().then(function (e: { detail?: string }) { throw new Error(e.detail || 'Upload failed'); });
                    return res.json();
                })
                .then(function (data: { imported?: number }) {
                    statusMsg.textContent = 'APPLIED — ' + (data.imported ?? '?') + ' SETTINGS IMPORTED';
                    statusMsg.className = 'settings-config-status settings-config-status--ok';
                    applyBtn.disabled = false;
                    setTimeout(function () { location.reload(); }, 1200);
                })
                .catch(function (err: Error) {
                    statusMsg.textContent = err.message.toUpperCase();
                    statusMsg.className = 'settings-config-status settings-config-status--error';
                    applyBtn.disabled = false;
                });
        });

        return wrap;
    }

    function _renderConnectivityToggle(): HTMLElement {
        const LS_KEY = 'sentinel_app_connectivityMode';
        const DOMAIN_NAMESPACES = ['air', 'space', 'sea', 'land'];

        let saved = 'online';
        try { saved = localStorage.getItem(LS_KEY) || 'online'; } catch (e) {}
        let isOnline = saved !== 'offline';

        const wrap = document.createElement('div');
        wrap.className = 'settings-connectivity-wrap';

        const switchRow = document.createElement('div');
        switchRow.className = 'settings-connectivity-switch';

        const labelOffline = document.createElement('span');
        labelOffline.className = 'settings-connectivity-label';
        labelOffline.textContent = 'OFFLINE';

        const track = document.createElement('button');
        track.className = 'settings-connectivity-track' + (isOnline ? ' is-online' : '');
        track.setAttribute('role', 'switch');
        track.setAttribute('aria-checked', isOnline ? 'true' : 'false');
        track.setAttribute('aria-label', 'Toggle connectivity mode');

        const thumb = document.createElement('span');
        thumb.className = 'settings-connectivity-thumb';
        track.appendChild(thumb);

        const labelOnline = document.createElement('span');
        labelOnline.className = 'settings-connectivity-label';
        labelOnline.textContent = 'ONLINE';

        switchRow.appendChild(labelOffline);
        switchRow.appendChild(track);
        switchRow.appendChild(labelOnline);
        wrap.appendChild(switchRow);

        // Override summary — lists domains conflicting with the current app mode
        const overrideSummary = document.createElement('div');
        overrideSummary.className = 'settings-connectivity-override-summary';
        overrideSummary.style.display = 'none';
        wrap.appendChild(overrideSummary);

        function _refreshOverrideSummary(): void {
            const appMode = isOnline ? 'online' : 'offline';
            const conflicts = _getConflictingOverrides(appMode);
            if (conflicts.length === 0) {
                overrideSummary.style.display = 'none';
                overrideSummary.innerHTML = '';
                return;
            }
            overrideSummary.style.display = '';
            overrideSummary.innerHTML = '';

            const heading = document.createElement('div');
            heading.className = 'settings-conn-override-heading';
            heading.textContent = 'SECTION OVERRIDES';
            overrideSummary.appendChild(heading);

            conflicts.forEach(function ({ ns, override }) {
                const row = document.createElement('div');
                row.className = 'settings-conn-override-row';

                const nsLabel = document.createElement('span');
                nsLabel.className = 'settings-conn-override-ns';
                nsLabel.textContent = ns.toUpperCase();

                const arrow = document.createElement('span');
                arrow.className = 'settings-conn-override-arrow';
                arrow.textContent = '→';

                const val = document.createElement('span');
                val.className = 'settings-conn-override-val settings-conn-override-val--' + override;
                val.textContent = override.toUpperCase();

                row.appendChild(nsLabel);
                row.appendChild(arrow);
                row.appendChild(val);
                overrideSummary.appendChild(row);
            });
        }

        // Warning / confirm area (hidden until needed)
        const warning = document.createElement('div');
        warning.className = 'settings-connectivity-warning';
        warning.style.display = 'none';
        wrap.appendChild(warning);

        function _hasOverrides(): boolean {
            for (const ns of DOMAIN_NAMESPACES) {
                try {
                    const val = localStorage.getItem('sentinel_' + ns + '_sourceOverride');
                    if (val && val !== 'auto') return true;
                } catch (e) {}
            }
            return false;
        }

        function _applyMode(mode: string): void {
            isOnline = mode === 'online';
            track.classList.toggle('is-online', isOnline);
            track.setAttribute('aria-checked', isOnline ? 'true' : 'false');
            try { localStorage.setItem(LS_KEY, mode); } catch (e) {}
            if (window._SettingsAPI) window._SettingsAPI.put('app', 'connectivityMode', mode);
            window.dispatchEvent(new CustomEvent('sentinel:connectivityModeChanged', { detail: { mode } }));
            _refreshOverrideSummary();
        }

        function _resetAllOverrides(): void {
            for (const ns of DOMAIN_NAMESPACES) {
                try { localStorage.setItem('sentinel_' + ns + '_sourceOverride', 'auto'); } catch (e) {}
                if (window._SettingsAPI) window._SettingsAPI.put(ns, 'sourceOverride', 'auto');
            }
            _refreshOverrideSummary();
        }

        function _showWarning(pendingMode: string): void {
            warning.style.display = '';
            warning.innerHTML = '';

            const msg = document.createElement('span');
            msg.className = 'settings-connectivity-warning-msg';
            msg.textContent = 'Some domains have source overrides set. Switching to '
                + pendingMode.toUpperCase()
                + ' will reset all overrides to AUTO.';

            warning.appendChild(msg);
        }

        track.addEventListener('click', function () {
            const newMode = isOnline ? 'offline' : 'online';

            // Optimistically flip the toggle visually
            isOnline = !isOnline;
            track.classList.toggle('is-online', isOnline);
            track.setAttribute('aria-checked', isOnline ? 'true' : 'false');

            if (_hasOverrides()) {
                _showWarning(newMode);
                _resetAllOverrides();
            }
            _applyMode(newMode);
        });

        // Sync from backend on load
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace('app').then(function (data) {
                if (!data || !data['connectivityMode']) return;
                const backendMode = data['connectivityMode'] as string;
                const localMode = isOnline ? 'online' : 'offline';
                if (backendMode !== localMode) {
                    isOnline = backendMode === 'online';
                    track.classList.toggle('is-online', isOnline);
                    track.setAttribute('aria-checked', isOnline ? 'true' : 'false');
                    try { localStorage.setItem(LS_KEY, backendMode); } catch (e) {}
                }
                _refreshOverrideSummary();
            });
        }

        window.addEventListener('sentinel:sourceOverrideChanged', _refreshOverrideSummary);
        _refreshOverrideSummary();
        return wrap;
    }

    // ── Space TLE controls ───────────────────────────────────────────────────

    // Categories shown on import controls (URL fetch / file upload) — includes 'active'
    const _TLE_CATEGORIES: Array<{ value: string; label: string }> = [
        { value: 'active',        label: 'All Active (no category)' },
        { value: 'space_station', label: 'Space Stations' },
        { value: 'amateur',       label: 'Amateur Radio' },
        { value: 'weather',       label: 'Weather' },
        { value: 'military',      label: 'Military' },
        { value: 'navigation',    label: 'Navigation (GNSS)' },
        { value: 'science',       label: 'Science' },
        { value: 'cubesat',       label: 'CubeSats' },
        { value: 'unknown',       label: 'Unknown' },
    ];

    // Categories available for manual assignment — 'active' excluded (not a meaningful choice)
    const _TLE_ASSIGN_CATEGORIES: Array<{ value: string; label: string }> = _TLE_CATEGORIES.filter(
        function (c) { return c.value !== 'active'; }
    );


    const _CELESTRAK_URLS: Record<string, string> = {
        space_station: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
        amateur:       'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle',
        weather:       'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle',
        military:      'https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=tle',
        navigation:    'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=tle',
        science:       'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle',
        cubesat:       'https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle',
        active:        'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
        unknown:       'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
    };

    function _makeCategorySelect(
        includeBlank: boolean,
        list?: Array<{ value: string; label: string }>,
    ): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.className = 'tle-category-select';
        (list ?? _TLE_CATEGORIES).forEach(function (opt) {
            if (!includeBlank && opt.value === '') return;
            const el = document.createElement('option');
            el.value       = opt.value;
            el.textContent = opt.label;
            sel.appendChild(el);
        });
        return sel;
    }

    // Custom flat dropdown (div-based) — menu is appended to body to avoid stacking/overflow clipping
    function _makeCategoryDropdown(list?: Array<{ value: string; label: string }>): {
        el: HTMLElement;
        getValue: () => string;
        setValue: (val: string) => void;
        onChange: (cb: (val: string) => void) => void;
    } {
        const opts = list ?? _TLE_CATEGORIES;
        let _value = opts[0]?.value ?? '';
        let _open = false;
        let _changeCallbacks: Array<(v: string) => void> = [];

        const wrapper = document.createElement('div');
        wrapper.className = 'tle-dropdown';
        wrapper.tabIndex = 0;
        wrapper.dataset['selectedValue'] = _value;

        const selected = document.createElement('div');
        selected.className = 'tle-dropdown-selected';

        const selectedText = document.createElement('span');
        selectedText.className   = 'tle-dropdown-selected-text';
        selectedText.textContent = opts[0]?.label ?? '';
        if (_value) selectedText.classList.add('tle-dropdown-selected-text--chosen');

        const arrow = document.createElement('span');
        arrow.className = 'tle-dropdown-arrow';

        selected.appendChild(selectedText);
        selected.appendChild(arrow);
        wrapper.appendChild(selected);

        // Menu lives on body to escape any overflow/stacking context
        const menu = document.createElement('div');
        menu.className = 'tle-dropdown-menu';
        document.body.appendChild(menu);

        opts.forEach(function (opt) {
            const item = document.createElement('div');
            item.className = 'tle-dropdown-item';
            if (opt.value === '') item.classList.add('tle-dropdown-item--placeholder');
            item.textContent = opt.label;
            item.addEventListener('mousedown', function (e) {
                e.preventDefault();
                _value = opt.value;
                wrapper.dataset['selectedValue'] = _value;
                selectedText.textContent = opt.label;
                if (_value) selectedText.classList.add('tle-dropdown-selected-text--chosen');
                else selectedText.classList.remove('tle-dropdown-selected-text--chosen');
                _closeMenu();
                _changeCallbacks.forEach(function (cb) { cb(_value); });
            });
            menu.appendChild(item);
        });

        function _positionMenu(): void {
            const rect = wrapper.getBoundingClientRect();
            menu.style.top    = (rect.bottom + window.scrollY) + 'px';
            menu.style.left   = (rect.left + window.scrollX) + 'px';
            menu.style.width  = rect.width + 'px';
        }

        function _openMenu(): void {
            _open = true;
            wrapper.classList.add('tle-dropdown--open');
            menu.classList.add('tle-dropdown-menu--open');
            _positionMenu();
        }

        function _closeMenu(): void {
            _open = false;
            wrapper.classList.remove('tle-dropdown--open');
            menu.classList.remove('tle-dropdown-menu--open');
        }

        selected.addEventListener('mousedown', function (e) {
            e.preventDefault();
            if (_open) _closeMenu(); else _openMenu();
        });

        wrapper.addEventListener('blur', _closeMenu);

        document.addEventListener('mousedown', function (e) {
            if (!wrapper.contains(e.target as Node) && !menu.contains(e.target as Node)) {
                _closeMenu();
            }
        });

        function _setValue(val: string): void {
            const opt = opts.find(function (o) { return o.value === val; });
            _value = val;
            wrapper.dataset['selectedValue'] = _value;
            selectedText.textContent = opt?.label ?? val;
            if (_value) selectedText.classList.add('tle-dropdown-selected-text--chosen');
            else selectedText.classList.remove('tle-dropdown-selected-text--chosen');
        }

        return {
            el:       wrapper,
            getValue: function () { return _value; },
            setValue: _setValue,
            onChange: function (cb) { _changeCallbacks.push(cb); },
        };
    }

    function _makeTleStatusBadge(text: string, type: 'ok' | 'error' | 'info'): HTMLElement {
        const badge = document.createElement('span');
        badge.className = 'tle-status-badge tle-status-badge--' + type;
        badge.textContent = text;
        return badge;
    }

    function _fmtAge(ms: number): string {
        const secs = Math.floor((Date.now() - ms) / 1000);
        if (secs < 60)  return secs + 's ago';
        if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
        if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
        return Math.floor(secs / 86400) + 'd ago';
    }

    const _CAT_LABELS: Record<string, string> = {
        space_station: 'Space Stations',
        amateur:       'Amateur Radio',
        weather:       'Weather',
        military:      'Military',
        navigation:    'Navigation',
        science:       'Science',
        cubesat:       'CubeSats',
        active:        'Active',
        unknown:       'Unknown',
    };

    function _renderSpaceOnlineSourceControl(): HTMLElement {
        const LS_KEY = 'sentinel_space_onlineUrl';

        const wrap = document.createElement('div');
        wrap.className = 'settings-datasource-wrap tle-online-wrap';

        // URL row — matches existing datasource-row pattern
        const urlRow = document.createElement('div');
        urlRow.className = 'settings-datasource-row';

        const urlLabel = document.createElement('span');
        urlLabel.className   = 'settings-datasource-label';
        urlLabel.textContent = 'URL';

        const urlInput = document.createElement('input');
        urlInput.type         = 'url';
        urlInput.className    = 'settings-datasource-input';
        urlInput.placeholder  = 'https://celestrak.org/...';
        urlInput.spellcheck   = false;
        urlInput.autocomplete = 'off';

        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        wrap.appendChild(urlRow);

        // Category selector row — flat segmented style
        const catRow = document.createElement('div');
        catRow.className = 'tle-cat-row-ctrl';

        const catLabel = document.createElement('span');
        catLabel.className   = 'settings-datasource-label tle-inline-label';
        catLabel.textContent = 'CATEGORY';

        const catDrop = _makeCategoryDropdown();

        const updateBtn = document.createElement('button');
        updateBtn.className   = 'tle-action-btn tle-action-btn--primary';
        updateBtn.textContent = 'UPDATE TLE';
        updateBtn.disabled    = false;

        catDrop.onChange(function (val) { updateBtn.disabled = !val; });

        catRow.appendChild(catLabel);
        catRow.appendChild(catDrop.el);
        catRow.appendChild(updateBtn);
        wrap.appendChild(catRow);

        // Status line
        const statusLine = document.createElement('div');
        statusLine.className = 'tle-status-line';
        wrap.appendChild(statusLine);

        // Info toggle — shows Celestrak URLs for each category
        const infoRow = document.createElement('div');
        infoRow.className = 'tle-info-row';

        const infoHeader = document.createElement('div');
        infoHeader.className = 'tle-info-row-header';

        const infoLabel = document.createElement('span');
        infoLabel.className   = 'tle-info-label';
        infoLabel.textContent = 'View Celestrak source URLs';

        const infoChevron = document.createElement('span');
        infoChevron.className = 'tle-info-chevron';
        infoChevron.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1,2.5 4,5.5 7,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        infoHeader.appendChild(infoLabel);
        infoHeader.appendChild(infoChevron);

        const infoPanel = document.createElement('div');
        infoPanel.className = 'tle-info-panel';
        infoPanel.hidden    = true;

        // Per-category URLs — starts as a copy of the hardcoded defaults,
        // then overridden by space.onlineUrls from the backend config.
        const effectiveUrls: Record<string, string> = Object.assign({}, _CELESTRAK_URLS);

        function _buildInfoList(): void {
            infoList.innerHTML = '';
            _TLE_CATEGORIES.filter(function (c) { return c.value && effectiveUrls[c.value]; }).forEach(function (cat) {
                const item = document.createElement('div');
                item.className = 'tle-info-list-item';

                const labelEl = document.createElement('span');
                labelEl.className   = 'tle-info-list-label';
                labelEl.textContent = cat.label;

                const sepEl = document.createElement('span');
                sepEl.className   = 'tle-info-list-sep';
                sepEl.textContent = ':';

                const urlEl = document.createElement('a');
                urlEl.className   = 'tle-info-table-url';
                urlEl.textContent = effectiveUrls[cat.value]!;
                urlEl.href        = effectiveUrls[cat.value]!;
                urlEl.target      = '_blank';
                urlEl.rel         = 'noopener noreferrer';

                item.appendChild(labelEl);
                item.appendChild(sepEl);
                item.appendChild(urlEl);
                infoList.appendChild(item);
            });
        }

        const infoList = document.createElement('div');
        infoList.className = 'tle-info-list';
        _buildInfoList();

        infoPanel.appendChild(infoList);
        infoRow.appendChild(infoHeader);
        infoRow.appendChild(infoPanel);
        wrap.appendChild(infoRow);

        infoHeader.addEventListener('click', function () {
            const visible = !infoPanel.hidden;
            infoPanel.hidden = visible;
            infoChevron.classList.toggle('tle-info-chevron--open', !visible);
        });

        // Load saved URL, falling back to the default active URL
        // Migrate any stale uppercase FORMAT=TLE URLs to lowercase
        try {
            const saved = localStorage.getItem(LS_KEY);
            const migrated = saved ? saved.replace(/FORMAT=TLE\b/, 'FORMAT=tle').replace(/CATNR=25544/, 'GROUP=active') : null;
            if (migrated && migrated !== saved) localStorage.setItem(LS_KEY, migrated);
            urlInput.value = migrated || effectiveUrls['active']!;
        } catch (e) {
            urlInput.value = effectiveUrls['active']!;
        }

        // Reconcile with backend — apply onlineUrls overrides and onlineUrl fallback
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace('space').then(function (data) {
                if (!data) return;
                // Merge per-category URL overrides from config
                const configUrls = data['onlineUrls'];
                if (configUrls && typeof configUrls === 'object') {
                    Object.assign(effectiveUrls, configUrls as Record<string, string>);
                    _buildInfoList();
                    // Re-fill URL input if the current category is now overridden
                    const currentCat = catDrop.getValue();
                    if (currentCat && effectiveUrls[currentCat]) {
                        urlInput.value = effectiveUrls[currentCat]!;
                        try { localStorage.setItem(LS_KEY, urlInput.value); } catch (e) {}
                    }
                }
                // Fall back to legacy single onlineUrl if input is still empty
                const backendVal = data['onlineUrl'] as string | undefined;
                if (backendVal && !urlInput.value) {
                    urlInput.value = backendVal;
                    try { localStorage.setItem(LS_KEY, backendVal); } catch (e) {}
                }
            });
        }

        // Auto-fill URL when category changes
        catDrop.onChange(function (val) {
            urlInput.value = effectiveUrls[val] ?? '';
        });

        updateBtn.addEventListener('click', async function () {
            const url = urlInput.value.trim();
            if (!url) { statusLine.innerHTML = ''; statusLine.appendChild(_makeTleStatusBadge('Enter a URL first', 'error')); return; }
            // Persist URL on click
            try { localStorage.setItem(LS_KEY, url); } catch (e) {}
            if (window._SettingsAPI) window._SettingsAPI.put('space', 'onlineUrl', url);
            const category = catDrop.getValue() || null;
            updateBtn.textContent = 'UPDATING\u2026';
            updateBtn.disabled    = true;
            statusLine.innerHTML  = '';
            try {
                const resp = await fetch('/api/space/tle/fetch', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ url, category }),
                });
                const data = await resp.json() as { inserted?: number; updated?: number; error?: string };
                if (!resp.ok) throw new Error(data.error || resp.statusText);
                statusLine.appendChild(_makeTleStatusBadge(
                    `${(data.inserted ?? 0) + (data.updated ?? 0)} satellites loaded · ${data.inserted ?? 0} new · ${data.updated ?? 0} updated`,
                    'ok',
                ));
                document.dispatchEvent(new CustomEvent('tle:refreshStatus'));
            } catch (err) {
                statusLine.appendChild(_makeTleStatusBadge('Error: ' + (err as Error).message, 'error'));
            } finally {
                updateBtn.textContent = 'UPDATE TLE';
                updateBtn.disabled    = false;
            }
        });

        return wrap;
    }

    function _renderSpaceManualTleControl(): HTMLElement {
        // Single-column wrap that stretches wide — textarea is inline, below controls
        const wrap = document.createElement('div');
        wrap.className = 'tle-manual-wrap';
        wrap.dataset['wide'] = 'true';

        const fileRow = document.createElement('div');
        fileRow.className = 'tle-file-row';
        const fileInput = document.createElement('input');
        fileInput.type      = 'file';
        fileInput.accept    = '.tle,.txt';
        fileInput.className = 'tle-file-input';
        fileInput.id        = 'tle-file-input';
        const fileLabel = document.createElement('label');
        fileLabel.htmlFor     = 'tle-file-input';
        fileLabel.className   = 'tle-file-label';
        fileLabel.textContent = 'CHOOSE FILE';
        const fileNameSpan = document.createElement('span');
        fileNameSpan.className   = 'tle-file-name';
        fileNameSpan.textContent = 'No file selected';
        fileRow.appendChild(fileInput);
        fileRow.appendChild(fileLabel);
        fileRow.appendChild(fileNameSpan);
        wrap.appendChild(fileRow);

        const pasteCatRow = document.createElement('div');
        pasteCatRow.className = 'tle-cat-row-ctrl';
        const pasteCatLabel = document.createElement('span');
        pasteCatLabel.className   = 'settings-datasource-label tle-inline-label';
        pasteCatLabel.textContent = 'CATEGORY';
        const pasteCatDrop = _makeCategoryDropdown();
        const applyBtn = document.createElement('button');
        applyBtn.className   = 'tle-action-btn tle-action-btn--primary';
        applyBtn.textContent = 'UPDATE TLE';
        applyBtn.disabled    = true;
        pasteCatDrop.onChange(function (val) { applyBtn.disabled = !val; });
        pasteCatRow.appendChild(pasteCatLabel);
        pasteCatRow.appendChild(pasteCatDrop.el);
        pasteCatRow.appendChild(applyBtn);
        wrap.appendChild(pasteCatRow);

        const pasteStatus = document.createElement('div');
        pasteStatus.className = 'tle-status-line';
        wrap.appendChild(pasteStatus);

        // ── Event handlers ───────────────────────────────────────────────
        // File reader — reads file and posts directly to manual endpoint
        let _fileText = '';
        fileInput.addEventListener('change', function () {
            const file = fileInput.files?.[0];
            if (!file) return;
            fileNameSpan.textContent = file.name;
            const reader = new FileReader();
            reader.onload = function (e) { _fileText = (e.target?.result as string) ?? ''; };
            reader.readAsText(file);
        });

        applyBtn.addEventListener('click', async function () {
            if (!_fileText) { pasteStatus.innerHTML = ''; pasteStatus.appendChild(_makeTleStatusBadge('Choose a file first', 'error')); return; }
            const category = pasteCatDrop.getValue() || null;
            applyBtn.textContent  = 'UPDATING\u2026';
            applyBtn.disabled     = true;
            pasteStatus.innerHTML = '';
            try {
                const resp = await fetch('/api/space/tle/manual', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ text: _fileText, category }),
                });
                const data = await resp.json() as { inserted?: number; updated?: number; total?: number; error?: string };
                if (!resp.ok) throw new Error(data.error || resp.statusText);
                pasteStatus.appendChild(_makeTleStatusBadge(
                    `${data.total ?? 0} satellites processed · ${data.inserted ?? 0} new · ${data.updated ?? 0} updated`,
                    'ok',
                ));
                _fileText                = '';
                fileNameSpan.textContent = 'No file selected';
                fileInput.value          = '';
                document.dispatchEvent(new CustomEvent('tle:refreshStatus'));
            } catch (err) {
                pasteStatus.appendChild(_makeTleStatusBadge('Error: ' + (err as Error).message, 'error'));
            } finally {
                applyBtn.textContent = 'UPDATE TLE';
                applyBtn.disabled    = false;
            }
        });

        return wrap;
    }

    function _renderSpaceTleSatListControl(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'tle-satlist-wrap';
        wrap.dataset['wide'] = 'true';

        const body = document.createElement('div');
        body.className = 'tle-satlist-body';
        wrap.appendChild(body);

        // Search row
        const searchRow = document.createElement('div');
        searchRow.className = 'settings-datasource-row tle-satlist-search-row';
        const searchLabel = document.createElement('span');
        searchLabel.className   = 'settings-datasource-label';
        searchLabel.textContent = 'SEARCH';
        const searchInput = document.createElement('input');
        searchInput.type        = 'text';
        searchInput.className   = 'settings-datasource-input';
        searchInput.placeholder = 'Filter by name, NORAD ID or category\u2026';
        searchInput.spellcheck  = false;
        searchRow.appendChild(searchLabel);
        searchRow.appendChild(searchInput);
        body.appendChild(searchRow);

        // Table
        const table = document.createElement('div');
        table.className = 'tle-satlist-table';
        body.appendChild(table);

        const countLine = document.createElement('div');
        countLine.className   = 'tle-satlist-count';
        countLine.textContent = '';
        body.appendChild(countLine);

        type SatRow = { norad_id: string; name: string; category: string | null; name_source?: string | null; updated_at: number };
        let _allSats: SatRow[] = [];

        function _renderTable(sats: SatRow[]): void {
            table.innerHTML = '';
            sats.forEach(function (sat) {
                const row = document.createElement('div');
                row.className = 'tle-satlist-row';

                const nameEl = document.createElement('span');
                nameEl.className   = 'tle-satlist-name';
                nameEl.textContent = sat.name;
                if (sat.name_source === 'user') nameEl.classList.add('tle-satlist-name--user');

                const idEl = document.createElement('span');
                idEl.className   = 'tle-satlist-id';
                idEl.textContent = sat.norad_id;

                const catEl = document.createElement('span');
                catEl.className   = 'tle-satlist-cat';
                catEl.textContent = sat.category ? (_CAT_LABELS[sat.category] ?? sat.category) : '—';
                if (!sat.category) catEl.classList.add('tle-satlist-cat--none');

                const ageEl = document.createElement('span');
                ageEl.className   = 'tle-satlist-age';
                ageEl.textContent = sat.updated_at ? _fmtAge(sat.updated_at) : '—';

                row.appendChild(nameEl);
                row.appendChild(idEl);
                row.appendChild(catEl);
                row.appendChild(ageEl);
                table.appendChild(row);
            });
            countLine.textContent = `${sats.length} of ${_allSats.length} satellites`;
        }

        function _applyFilters(): void {
            const q = searchInput.value.trim().toLowerCase();
            _renderTable(_allSats.filter(function (s) {
                if (!q) return true;
                const catLabel = s.category ? (_CAT_LABELS[s.category] ?? s.category) : '';
                return s.name.toLowerCase().includes(q) || s.norad_id.includes(q) || catLabel.toLowerCase().includes(q);
            }));
        }

        async function _load(): Promise<void> {
            table.innerHTML = '<div class="tle-satlist-loading">Loading\u2026</div>';
            try {
                const resp = await fetch('/api/space/tle/list');
                if (!resp.ok) throw new Error(resp.statusText);
                const data = await resp.json() as { satellites: SatRow[] };
                _allSats = data.satellites;
                _applyFilters();
            } catch (err) {
                table.innerHTML = `<div class="tle-satlist-loading">Failed to load: ${(err as Error).message}</div>`;
            }
        }

        _load();

        // Refresh when TLE data changes
        document.addEventListener('tle:refreshStatus', function () {
            _load();
        });

        // Live search / category filter
        searchInput.addEventListener('input', _applyFilters);

        return wrap;
    }

    function _renderSpaceTleDatabaseControl(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'tle-db-wrap';

        const summary = document.createElement('div');
        summary.className   = 'tle-db-summary';
        summary.textContent = 'Loading\u2026';
        wrap.appendChild(summary);

        const catTable = document.createElement('div');
        catTable.className = 'tle-cat-table';
        wrap.appendChild(catTable);

        const clearBtn = document.createElement('button');
        clearBtn.className   = 'tle-action-btn tle-action-btn--danger';
        clearBtn.textContent = 'CLEAR ALL TLE DATA';
        wrap.appendChild(clearBtn);

        async function _load(): Promise<void> {
            try {
                const resp = await fetch('/api/space/tle/status');
                if (!resp.ok) throw new Error(resp.statusText);
                const data = await resp.json() as {
                    total: number;
                    uncategorised: number;
                    by_source: Record<string, number>;
                    by_category: Record<string, { count: number; last_updated: number }>;
                };

                const srcParts = Object.entries(data.by_source)
                    .map(([s, n]) => `${s} (${n})`).join(' · ');
                summary.textContent = `${data.total} satellites · ${srcParts || 'none'}`;

                catTable.innerHTML = '';
                const cats = Object.entries(data.by_category).sort((a, b) => a[0].localeCompare(b[0]));
                cats.forEach(function ([cat, info]) {
                    const row = document.createElement('div');
                    row.className = 'tle-cat-row';

                    const nameEl = document.createElement('span');
                    nameEl.className   = 'tle-cat-name';
                    nameEl.textContent = _CAT_LABELS[cat] ?? cat;

                    const countEl = document.createElement('span');
                    countEl.className   = 'tle-cat-count';
                    countEl.textContent = String(info.count);

                    const ageEl = document.createElement('span');
                    ageEl.className   = 'tle-cat-age';
                    ageEl.textContent = info.last_updated ? _fmtAge(info.last_updated) : '—';

                    row.appendChild(nameEl);
                    row.appendChild(countEl);
                    row.appendChild(ageEl);
                    catTable.appendChild(row);
                });
            } catch (err) {
                summary.textContent = 'Failed to load TLE status';
            }
        }

        _load();
        document.addEventListener('tle:refreshStatus', _load);

        let _confirmPending = false;
        clearBtn.addEventListener('click', async function () {
            if (!_confirmPending) {
                clearBtn.textContent  = 'CONFIRM — CLEAR ALL TLE DATA?';
                clearBtn.classList.add('tle-action-btn--confirm');
                _confirmPending = true;
                setTimeout(function () {
                    _confirmPending = false;
                    clearBtn.textContent = 'CLEAR ALL TLE DATA';
                    clearBtn.classList.remove('tle-action-btn--confirm');
                }, 4000);
                return;
            }
            clearBtn.textContent = 'CLEARING\u2026';
            clearBtn.disabled    = true;
            try {
                const resp = await fetch('/api/space/tle?confirm=true', { method: 'DELETE' });
                if (!resp.ok) throw new Error((await resp.json() as { error?: string }).error ?? resp.statusText);
                document.dispatchEvent(new CustomEvent('tle:refreshStatus'));
            } catch (err) {
                summary.textContent = 'Error: ' + (err as Error).message;
            } finally {
                _confirmPending      = false;
                clearBtn.textContent = 'CLEAR ALL TLE DATA';
                clearBtn.disabled    = false;
                clearBtn.classList.remove('tle-action-btn--confirm');
            }
        });

        return wrap;
    }

    function _renderSpaceTleUncategorisedControl(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'tle-uncat-wrap';

        const countLine = document.createElement('div');
        countLine.className   = 'tle-uncat-count';
        countLine.textContent = 'Loading\u2026';
        wrap.appendChild(countLine);

        const list = document.createElement('div');
        list.className = 'tle-uncat-list';
        wrap.appendChild(list);

        const saveAllBtn = document.createElement('button');
        saveAllBtn.className   = 'tle-action-btn';
        saveAllBtn.textContent = 'SAVE ALL';
        saveAllBtn.style.display = 'none';
        wrap.appendChild(saveAllBtn);

        async function _load(): Promise<void> {
            try {
                const resp = await fetch('/api/space/tle/uncategorised');
                if (!resp.ok) throw new Error(resp.statusText);
                const data = await resp.json() as { satellites: Array<{ norad_id: string; name: string }> };
                list.innerHTML = '';

                if (data.satellites.length === 0) {
                    countLine.textContent    = 'All satellites are categorised';
                    list.style.display       = 'none';
                    saveAllBtn.style.display = 'none';
                    return;
                }

                countLine.textContent    = `${data.satellites.length} satellites have no category`;
                saveAllBtn.style.display = '';

                data.satellites.forEach(function (sat) {
                    const row = document.createElement('div');
                    row.className = 'tle-uncat-row';
                    row.dataset['norad'] = sat.norad_id;

                    const nameEl = document.createElement('span');
                    nameEl.className   = 'tle-uncat-name';
                    nameEl.textContent = sat.name;

                    const idEl = document.createElement('span');
                    idEl.className   = 'tle-uncat-id';
                    idEl.textContent = sat.norad_id;

                    const uncatDrop = _makeCategoryDropdown(_TLE_ASSIGN_CATEGORIES);
                    uncatDrop.el.classList.add('tle-uncat-drop');
                    uncatDrop.el.dataset['selectedValue'] = '';

                    row.appendChild(nameEl);
                    row.appendChild(idEl);
                    row.appendChild(uncatDrop.el);
                    list.appendChild(row);
                });
            } catch (err) {
                countLine.textContent = 'Failed to load';
            }
        }

        _load();
        document.addEventListener('tle:refreshStatus', _load);

        async function _saveAll(): Promise<void> {
            const rows = list.querySelectorAll<HTMLElement>('.tle-uncat-row');
            const assignments: Array<{ norad_id: string; category: string }> = [];
            rows.forEach(function (row) {
                const drop = row.querySelector<HTMLElement>('.tle-uncat-drop');
                const val = drop?.dataset['selectedValue'];
                if (val) {
                    assignments.push({ norad_id: row.dataset['norad'] ?? '', category: val });
                }
            });
            if (!assignments.length) return;
            saveAllBtn.textContent = 'SAVING\u2026';
            saveAllBtn.disabled    = true;
            try {
                const resp = await fetch('/api/space/tle/category', {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ assignments }),
                });
                if (!resp.ok) throw new Error((await resp.json() as { error?: string }).error ?? resp.statusText);
                document.dispatchEvent(new CustomEvent('tle:refreshStatus'));
            } catch (err) {
                countLine.textContent = 'Error saving: ' + (err as Error).message;
            } finally {
                saveAllBtn.textContent = 'SAVE ALL';
                saveAllBtn.disabled    = false;
            }
        }

        saveAllBtn.addEventListener('click', _saveAll);

        return wrap;
    }

    function _renderSpaceHoverPreviewControl(): HTMLElement {
        const LS_KEY    = 'sentinel_space_filterHoverPreview';
        const SETTING_ID = 'space-filter-hover-preview';
        type HoverOpt = 'stay' | 'fly';
        const OPTIONS: Array<{ value: HoverOpt; label: string }> = [
            { value: 'stay', label: 'STAY IN PLACE' },
            { value: 'fly',  label: 'FLY TO SATELLITE' },
        ];

        let current: HoverOpt = 'stay';
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (saved === 'fly') current = 'fly';
        } catch (e) {}

        const wrap  = document.createElement('div');
        wrap.className = 'settings-source-override-wrap';

        const group = document.createElement('div');
        group.className = 'settings-source-override-group';

        function _setActive(val: HoverOpt): void {
            current = val;
            group.querySelectorAll<HTMLButtonElement>('.settings-source-override-btn').forEach(function (btn) {
                btn.classList.toggle('is-active', btn.dataset['value'] === val);
            });
        }

        OPTIONS.forEach(function (opt) {
            const btn = document.createElement('button');
            btn.className = 'settings-source-override-btn' + (current === opt.value ? ' is-active' : '');
            btn.textContent = opt.label;
            btn.dataset['value'] = opt.value;

            btn.addEventListener('click', function () {
                if (current === opt.value) return;
                _setActive(opt.value);
                _stagePending(SETTING_ID, function () {
                    try { localStorage.setItem(LS_KEY, current); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put('space', 'filterHoverPreview', current);
                });
            });

            group.appendChild(btn);
        });

        // Sync from backend
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace('space').then(function (data) {
                if (!data || !data['filterHoverPreview']) return;
                const val = data['filterHoverPreview'] as string;
                if (val === 'fly' || val === 'stay') {
                    _setActive(val as HoverOpt);
                    try { localStorage.setItem(LS_KEY, val); } catch (e) {}
                }
            });
        }

        wrap.appendChild(group);
        return wrap;
    }

    function _renderSourceOverrideControl(ns: string): HTMLElement {
        const LS_KEY = 'sentinel_' + ns + '_sourceOverride';
        const SETTING_ID = ns + '-source-override';
        const OPTIONS: Array<'auto' | 'online' | 'offline'> = ['auto', 'online', 'offline'];

        let current: string = 'auto';
        try { current = localStorage.getItem(LS_KEY) || 'auto'; } catch (e) {}

        const wrap = document.createElement('div');
        wrap.className = 'settings-source-override-wrap';

        const group = document.createElement('div');
        group.className = 'settings-source-override-group';

        const note = document.createElement('div');
        note.className = 'settings-source-override-note';
        note.style.display = current !== 'auto' ? '' : 'none';
        note.textContent = 'This overrides the app-level connectivity mode setting.';

        function _setActive(val: string): void {
            current = val;
            group.querySelectorAll<HTMLButtonElement>('.settings-source-override-btn').forEach(function (btn) {
                btn.classList.toggle('is-active', btn.dataset['value'] === val);
            });
            note.style.display = val !== 'auto' ? '' : 'none';
        }

        OPTIONS.forEach(function (opt) {
            const btn = document.createElement('button');
            btn.className = 'settings-source-override-btn' + (current === opt ? ' is-active' : '');
            btn.textContent = opt.toUpperCase();
            btn.dataset['value'] = opt;

            btn.addEventListener('click', function () {
                if (current === opt) return;
                _setActive(opt);
                _stagePending(SETTING_ID, function () {
                    try { localStorage.setItem(LS_KEY, current); } catch (e) {}
                    if (window._SettingsAPI) window._SettingsAPI.put(ns, 'sourceOverride', current);
                    window.dispatchEvent(new CustomEvent('sentinel:sourceOverrideChanged'));
                });
            });

            group.appendChild(btn);
        });

        // Sync from backend
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace(ns).then(function (data) {
                if (!data || !data['sourceOverride']) return;
                const backendVal = data['sourceOverride'] as string;
                if (backendVal && backendVal !== current) {
                    _setActive(backendVal);
                    try { localStorage.setItem(LS_KEY, backendVal); } catch (e) {}
                }
            });
        }

        wrap.appendChild(group);
        wrap.appendChild(note);
        return wrap;
    }

    // ── Override summary ─────────────────────────────────────
    const _OVERRIDE_NAMESPACES = ['air', 'space', 'sea', 'land'];

    /**
     * Returns domains whose sourceOverride conflicts with the current app connectivity mode.
     * A conflict is when sourceOverride is not 'auto' AND differs from the app mode.
     */
    function _getConflictingOverrides(appMode: string): Array<{ ns: string; override: string }> {
        const conflicts: Array<{ ns: string; override: string }> = [];
        for (const ns of _OVERRIDE_NAMESPACES) {
            let override = 'auto';
            try { override = localStorage.getItem('sentinel_' + ns + '_sourceOverride') || 'auto'; } catch (e) {}
            if (override !== 'auto' && override !== appMode) {
                conflicts.push({ ns, override });
            }
        }
        return conflicts;
    }

    // ── Rendering ────────────────────────────────────────────
    function _makeSettingRow(item: SettingItem): HTMLElement {
        const row = document.createElement('div');
        row.className = 'settings-item';

        const info = document.createElement('div');
        info.className = 'settings-item-info';

        const label = document.createElement('div');
        label.className = 'settings-item-label';
        label.textContent = item.label;

        info.appendChild(label);

        if (item.desc) {
            const desc = document.createElement('div');
            desc.className = 'settings-item-desc';
            desc.textContent = item.desc;
            info.appendChild(desc);
        }

        row.appendChild(info);

        if (item.renderControl) {
            const control = item.renderControl();
            // If the control signals it needs full width (e.g. two-column TLE panel)
            if ((control as HTMLElement).dataset['wide'] === 'true') {
                row.classList.add('settings-item--wide');
            }
            row.appendChild(control);
        }

        return row;
    }

    function _renderSection(sectionKey: string): void {
        const body = document.getElementById('settings-body');
        if (!body) return;
        body.innerHTML = '';

        // Clear pending changes from the previous section
        _pending.clear();

        const navSection = _NAV_SECTIONS.find(function (s) { return s.key === sectionKey; });
        const heading = document.getElementById('settings-section-heading');
        if (heading) {
            heading.textContent = navSection
                ? (navSection.key === 'app' ? navSection.label : navSection.label + ' SETTINGS')
                : sectionKey;
        }

        const items = _settings.filter(function (s) { return s.section === sectionKey; });

        if (!items.length) {
            const placeholder = document.createElement('div');
            placeholder.className = 'settings-empty';
            placeholder.textContent = 'Settings coming soon';
            body.appendChild(placeholder);
            return;
        }

        let lastGroup: string | undefined = undefined;
        items.forEach(function (item) {
            if (item.groupLabel !== undefined && item.groupLabel !== lastGroup) {
                const grpLabel = document.createElement('div');
                grpLabel.className = 'settings-group-label';
                if (lastGroup !== undefined) grpLabel.classList.add('settings-group-label--spaced');
                grpLabel.textContent = item.groupLabel;
                body.appendChild(grpLabel);
                lastGroup = item.groupLabel;
            }
            body.appendChild(_makeSettingRow(item));
        });
    }

    function _search(query: string): SettingItem[] | null {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        return _settings.filter(function (s) {
            return s.label.toLowerCase().indexOf(q) !== -1 ||
                   s.desc.toLowerCase().indexOf(q) !== -1 ||
                   s.sectionLabel.toLowerCase().indexOf(q) !== -1;
        });
    }

    function _renderSearchResults(results: SettingItem[]): void {
        const body = document.getElementById('settings-body');
        if (!body) return;
        body.innerHTML = '';
        const heading = document.getElementById('settings-section-heading');
        if (heading) heading.textContent = 'SEARCH RESULTS';

        if (!results.length) {
            const empty = document.createElement('div');
            empty.className = 'settings-empty';
            empty.textContent = 'No results found';
            body.appendChild(empty);
            return;
        }

        // Group by section
        const groups: Record<string, SettingItem[]> = {};
        const groupOrder: string[] = [];
        results.forEach(function (item) {
            if (!groups[item.section]) {
                groups[item.section] = [];
                groupOrder.push(item.section);
            }
            groups[item.section].push(item);
        });

        groupOrder.forEach(function (sectionKey) {
            const sectionItems = groups[sectionKey];
            const lbl = document.createElement('div');
            lbl.className = 'settings-section-label';
            lbl.textContent = sectionItems[0].sectionLabel;
            body.appendChild(lbl);
            sectionItems.forEach(function (item) {
                body.appendChild(_makeSettingRow(item));
            });
        });
    }

    // ── Open / close / toggle ────────────────────────────────
    function _updateFooterVisibility(_sectionKey: string): void {
        const footer = document.getElementById('settings-footer');
        if (footer) footer.style.display = '';
    }

    function open(): void {
        _open = true;
        // Close docs panel if open
        const docsPanel = document.getElementById('docs-panel');
        if (docsPanel && docsPanel.classList.contains('docs-panel-visible')) {
            docsPanel.classList.remove('docs-panel-visible');
            const docsBtn = document.getElementById('docs-btn');
            if (docsBtn) docsBtn.classList.remove('docs-btn-active');
        }
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.add('settings-panel-visible');
        const btn = document.getElementById('settings-btn');
        if (btn) btn.classList.add('settings-btn-active');
        _updateFooterVisibility(_activeSection);
        _renderSection(_activeSection);
        const input = document.getElementById('settings-search-input');
        if (input) (input as HTMLInputElement).focus();
    }

    function close(): void {
        _open = false;
        _pending.clear();
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.remove('settings-panel-visible');
        const btn = document.getElementById('settings-btn');
        if (btn) btn.classList.remove('settings-btn-active');
        const input = document.getElementById('settings-search-input') as HTMLInputElement | null;
        if (input) input.value = '';
        const clearBtn = document.getElementById('settings-search-clear');
        if (clearBtn) clearBtn.classList.remove('settings-search-clear-visible');
        const body = document.getElementById('settings-body');
        if (body) body.innerHTML = '';
    }

    function toggle(): void {
        if (_open) close(); else open();
    }

    // ── Init ────────────────────────────────────────────────
    function init(): void {
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', toggle);
        }

        const input    = document.getElementById('settings-search-input') as HTMLInputElement | null;
        const clearBtn = document.getElementById('settings-search-clear');

        if (input) {
            input.addEventListener('input', function () {
                const q = input.value;
                if (clearBtn) clearBtn.classList.toggle('settings-search-clear-visible', q.length > 0);
                const results = _search(q);
                if (results === null) {
                    _renderSection(_activeSection);
                } else {
                    _renderSearchResults(results);
                }
            });

            input.addEventListener('keydown', function (e: KeyboardEvent) {
                if (e.key === 'Escape') close();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (input) { input.value = ''; input.focus(); }
                clearBtn.classList.remove('settings-search-clear-visible');
                _renderSection(_activeSection);
            });
        }

        // Sidebar nav
        document.querySelectorAll<HTMLElement>('.settings-nav-item').forEach(function (el) {
            el.addEventListener('click', function () {
                _activeSection = el.dataset['section'] ?? 'app';
                document.querySelectorAll('.settings-nav-item').forEach(function (n) {
                    n.classList.remove('active');
                });
                el.classList.add('active');
                if (input) input.value = '';
                if (clearBtn) clearBtn.classList.remove('settings-search-clear-visible');
                const searchWrap = document.getElementById('settings-search-wrap');
                if (searchWrap) searchWrap.classList.toggle('settings-search-wrap--hidden', _activeSection !== 'app');
                _updateFooterVisibility(_activeSection);
                _renderSection(_activeSection);
            });
        });

        // Apply Changes button
        const applyBtn = document.getElementById('settings-apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', _commitAll);
        }

        // Sync location inputs when user pins a location via right-click on map
        window.addEventListener('sentinel:locationChanged', function (e: Event) {
            if (!_open || _activeSection !== 'app') return;
            const { longitude, latitude } = (e as CustomEvent).detail as { longitude: number; latitude: number };
            const rows = document.querySelectorAll<HTMLElement>('#settings-body .settings-location-row');
            const latInput = rows[0]?.querySelector('input');
            const lonInput = rows[1]?.querySelector('input');
            if (latInput) latInput.value = latitude.toFixed(5);
            if (lonInput) lonInput.value = longitude.toFixed(5);
            _pending.delete('location');
        });
    }

    function openSection(sectionKey: string): void {
        _activeSection = sectionKey;
        document.querySelectorAll('.settings-nav-item').forEach(function (el) {
            const item = el as HTMLElement;
            const isTarget = item.dataset['section'] === sectionKey;
            item.classList.toggle('active', isTarget);
        });
        const searchWrap = document.getElementById('settings-search-wrap');
        if (searchWrap) searchWrap.classList.toggle('settings-search-wrap--hidden', sectionKey !== 'app');
        open();
    }

    return { open, close, toggle, init, openSection };

})();
