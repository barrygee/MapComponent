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
            id:            'theme',
            label:         'Theme',
            desc:          'Switch between light and dark mode',
            renderControl: _renderThemeToggle,
        },
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'location',
            label:         'My Location',
            desc:          'Set a fixed latitude / longitude for your position',
            renderControl: _renderLocationControl,
        },
        {
            section:       'app',
            sectionLabel:  'App Settings',
            id:            'app-connectivity-probe',
            label:         'Connectivity Probe URL',
            desc:          'URL polled every 2 s to detect internet access',
            renderControl: function () { return _renderConnectivityProbeControl(); },
        },
        // AIR
        {
            section:       'air',
            sectionLabel:  'AIR',
            id:            'air-online-source',
            label:         'Online Data Source',
            desc:          'URL for live air data feed',
            renderControl: function () { return _renderOnlineSourceControl('air'); },
        },
        {
            section:       'air',
            sectionLabel:  'AIR',
            id:            'air-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for air data',
            renderControl: function () { return _renderOfflineSourceControl('air'); },
        },
        // SPACE
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-online-source',
            label:         'Online Data Source',
            desc:          'URL for live space data feed',
            renderControl: function () { return _renderOnlineSourceControl('space'); },
        },
        {
            section:       'space',
            sectionLabel:  'SPACE',
            id:            'space-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for space data',
            renderControl: function () { return _renderOfflineSourceControl('space'); },
        },
        // SEA
        {
            section:       'sea',
            sectionLabel:  'SEA',
            id:            'sea-online-source',
            label:         'Online Data Source',
            desc:          'URL for live sea data feed',
            renderControl: function () { return _renderOnlineSourceControl('sea'); },
        },
        {
            section:       'sea',
            sectionLabel:  'SEA',
            id:            'sea-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for sea data',
            renderControl: function () { return _renderOfflineSourceControl('sea'); },
        },
        // LAND
        {
            section:       'land',
            sectionLabel:  'LAND',
            id:            'land-online-source',
            label:         'Online Data Source',
            desc:          'URL for live land data feed',
            renderControl: function () { return _renderOnlineSourceControl('land'); },
        },
        {
            section:       'land',
            sectionLabel:  'LAND',
            id:            'land-offline-source',
            label:         'Offline Data Source',
            desc:          'Local server URL and port for land data',
            renderControl: function () { return _renderOfflineSourceControl('land'); },
        },
    ];

    const _NAV_SECTIONS: NavSection[] = [
        { key: 'app',   label: 'App Settings' },
        { key: 'air',   label: 'AIR' },
        { key: 'space', label: 'SPACE' },
        { key: 'sea',   label: 'SEA' },
        { key: 'land',  label: 'LAND' },
        { key: 'sdr',   label: 'SDR' },
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

    function _renderOnlineSourceControl(ns: string): HTMLElement {
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
            window._SettingsAPI.getNamespace(ns).then(function (data) {
                if (!data || !data['onlineUrl']) return;
                const backendVal = data['onlineUrl'] as string;
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

    function _renderOfflineSourceControl(ns: string): HTMLElement {
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
        urlInput.placeholder = 'http://localhost';
        urlInput.spellcheck = false;
        urlInput.autocomplete = 'off';
        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlInput);
        wrap.appendChild(urlRow);

        // Load saved value
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const saved = JSON.parse(raw) as { url?: string };
                if (saved.url) urlInput.value = saved.url;
            }
        } catch (e) {}

        // Reconcile with backend
        if (window._SettingsAPI) {
            window._SettingsAPI.getNamespace(ns).then(function (data) {
                if (!data || !data['offlineSource']) return;
                const backendVal = data['offlineSource'] as { url?: string };
                if (!urlInput.value && backendVal.url) urlInput.value = backendVal.url;
                try { localStorage.setItem(LS_KEY, JSON.stringify(backendVal)); } catch (e) {}
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
                window.dispatchEvent(new CustomEvent('sentinel:setUserLocation', {
                    detail: { longitude: lon, latitude: lat }
                }));
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

        items.forEach(function (item) {
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
    function open(): void {
        _open = true;
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.add('settings-panel-visible');
        const btn = document.getElementById('settings-btn');
        if (btn) btn.classList.add('settings-btn-active');
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

    return { open, close, toggle, init };

})();
