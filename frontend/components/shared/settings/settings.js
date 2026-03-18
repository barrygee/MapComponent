"use strict";
/* ============================================================
   SETTINGS PANEL — window._SettingsPanel
   ============================================================ */
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
window._SettingsPanel = (function () {
    // ── State ────────────────────────────────────────────────
    let _open = false;
    let _activeSection = 'app';
    const _settings = [
        {
            section: 'app',
            sectionLabel: 'App Settings',
            id: 'location',
            label: 'My Location',
            desc: 'Set your latitude and longitude. Overrides GPS and persists across reloads.',
            renderControl: _renderLocationControl,
        },
    ];
    const _NAV_SECTIONS = [
        { key: 'app', label: 'App Settings' },
        { key: 'air', label: 'AIR' },
        { key: 'space', label: 'SPACE' },
        { key: 'sea', label: 'SEA' },
        { key: 'land', label: 'LAND' },
        { key: 'sdr', label: 'SDR' },
    ];
    // ── DOM injection ────────────────────────────────────────
    (function _injectHTML() {
        if (document.getElementById('settings-panel'))
            return;
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
        content.appendChild(searchWrap);
        content.appendChild(body);
        panel.appendChild(sidebar);
        panel.appendChild(content);
        document.body.appendChild(panel);
    })();
    // ── Location helpers ─────────────────────────────────────
    function _readStoredLocation() {
        try {
            const raw = localStorage.getItem('userLocation');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') return parsed;
        } catch (e) {}
        return null;
    }

    function _dispatchLocation(lat, lng) {
        const payload = { longitude: lng, latitude: lat, ts: Date.now(), manual: true };
        localStorage.setItem('userLocation', JSON.stringify(payload));
        const pos = { coords: { longitude: lng, latitude: lat }, _fromCache: false, _manual: true };
        if (typeof setUserLocation === 'function') setUserLocation(pos);
        if (typeof setSpaceUserLocation === 'function') setSpaceUserLocation(pos);
        _updateFooterLocation(lat, lng);
    }

    function _updateFooterLocation(lat, lng) {
        const el = document.getElementById('footer-location');
        if (!el) return;
        el.textContent = lat.toFixed(4) + ',  ' + lng.toFixed(4);
    }

    function _renderLocationControl() {
        const stored = _readStoredLocation();

        const wrap = document.createElement('div');
        wrap.className = 'settings-location-wrap';

        // Lat row
        const latRow = document.createElement('div');
        latRow.className = 'settings-location-row';
        const latLabel = document.createElement('label');
        latLabel.className = 'settings-location-label';
        latLabel.textContent = 'LAT';
        const latInput = document.createElement('input');
        latInput.type = 'text';
        latInput.className = 'settings-location-input';
        latInput.placeholder = '0.0000';
        latInput.setAttribute('inputmode', 'decimal');
        latInput.value = stored ? stored.latitude.toFixed(4) : '';
        latRow.appendChild(latLabel);
        latRow.appendChild(latInput);

        // Lng row
        const lngRow = document.createElement('div');
        lngRow.className = 'settings-location-row';
        const lngLabel = document.createElement('label');
        lngLabel.className = 'settings-location-label';
        lngLabel.textContent = 'LON';
        const lngInput = document.createElement('input');
        lngInput.type = 'text';
        lngInput.className = 'settings-location-input';
        lngInput.placeholder = '0.0000';
        lngInput.setAttribute('inputmode', 'decimal');
        lngInput.value = stored ? stored.longitude.toFixed(4) : '';
        lngRow.appendChild(lngLabel);
        lngRow.appendChild(lngInput);

        // Status / apply row
        const actionRow = document.createElement('div');
        actionRow.className = 'settings-location-action-row';
        const statusEl = document.createElement('span');
        statusEl.className = 'settings-location-status';
        const applyBtn = document.createElement('button');
        applyBtn.className = 'settings-location-apply';
        applyBtn.textContent = 'APPLY';
        actionRow.appendChild(statusEl);
        actionRow.appendChild(applyBtn);

        function _setStatus(msg, isError) {
            statusEl.textContent = msg;
            statusEl.classList.toggle('settings-location-status--error', !!isError);
            statusEl.classList.toggle('settings-location-status--ok', !isError && !!msg);
        }

        function _apply() {
            const lat = parseFloat(latInput.value);
            const lng = parseFloat(lngInput.value);
            if (isNaN(lat) || lat < -90 || lat > 90) { _setStatus('Latitude must be −90 to 90', true); return; }
            if (isNaN(lng) || lng < -180 || lng > 180) { _setStatus('Longitude must be −180 to 180', true); return; }
            _dispatchLocation(lat, lng);
            latInput.value = lat.toFixed(4);
            lngInput.value = lng.toFixed(4);
            _setStatus('Saved', false);
            setTimeout(function () { _setStatus('', false); }, 2000);
        }

        applyBtn.addEventListener('click', _apply);
        [latInput, lngInput].forEach(function (inp) {
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') _apply();
            });
        });

        wrap.appendChild(latRow);
        wrap.appendChild(lngRow);
        wrap.appendChild(actionRow);
        return wrap;
    }

    // ── Rendering ────────────────────────────────────────────
    function _makeSettingRow(item) {
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
    function _renderSection(sectionKey) {
        const body = document.getElementById('settings-body');
        if (!body)
            return;
        body.innerHTML = '';
        const items = _settings.filter(function (s) { return s.section === sectionKey; });
        if (!items.length) {
            const placeholder = document.createElement('div');
            placeholder.className = 'settings-empty';
            placeholder.textContent = 'Settings coming soon';
            body.appendChild(placeholder);
            return;
        }
        const labelEl = document.createElement('div');
        labelEl.className = 'settings-section-label';
        const navSection = _NAV_SECTIONS.find(function (s) { return s.key === sectionKey; });
        labelEl.textContent = navSection ? navSection.label : sectionKey;
        body.appendChild(labelEl);
        items.forEach(function (item) {
            body.appendChild(_makeSettingRow(item));
        });
    }
    function _search(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return null;
        return _settings.filter(function (s) {
            return s.label.toLowerCase().indexOf(q) !== -1 ||
                s.desc.toLowerCase().indexOf(q) !== -1 ||
                s.sectionLabel.toLowerCase().indexOf(q) !== -1;
        });
    }
    function _renderSearchResults(results) {
        const body = document.getElementById('settings-body');
        if (!body)
            return;
        body.innerHTML = '';
        if (!results.length) {
            const empty = document.createElement('div');
            empty.className = 'settings-empty';
            empty.textContent = 'No results found';
            body.appendChild(empty);
            return;
        }
        // Group by section
        const groups = {};
        const groupOrder = [];
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
    function open() {
        _open = true;
        const panel = document.getElementById('settings-panel');
        if (panel)
            panel.classList.add('settings-panel-visible');
        const btn = document.getElementById('settings-btn');
        if (btn)
            btn.classList.add('settings-btn-active');
        _renderSection(_activeSection);
        const input = document.getElementById('settings-search-input');
        if (input)
            input.focus();
    }
    function close() {
        _open = false;
        const panel = document.getElementById('settings-panel');
        if (panel)
            panel.classList.remove('settings-panel-visible');
        const btn = document.getElementById('settings-btn');
        if (btn)
            btn.classList.remove('settings-btn-active');
        const input = document.getElementById('settings-search-input');
        if (input)
            input.value = '';
        const clearBtn = document.getElementById('settings-search-clear');
        if (clearBtn)
            clearBtn.classList.remove('settings-search-clear-visible');
        const body = document.getElementById('settings-body');
        if (body)
            body.innerHTML = '';
    }
    function toggle() {
        if (_open)
            close();
        else
            open();
    }
    // ── Init ────────────────────────────────────────────────
    function init() {
        // Populate footer location from stored value on load
        (function () {
            const stored = _readStoredLocation();
            if (stored) _updateFooterLocation(stored.latitude, stored.longitude);
        })();

        // Keep footer in sync when location is set by map right-click in any domain
        window.addEventListener('storage', function (e) {
            if (e.key !== 'userLocation') return;
            const stored = _readStoredLocation();
            if (stored) _updateFooterLocation(stored.latitude, stored.longitude);
        });

        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', toggle);
        }
        const input = document.getElementById('settings-search-input');
        const clearBtn = document.getElementById('settings-search-clear');
        if (input) {
            input.addEventListener('input', function () {
                const q = input.value;
                if (clearBtn)
                    clearBtn.classList.toggle('settings-search-clear-visible', q.length > 0);
                const results = _search(q);
                if (results === null) {
                    _renderSection(_activeSection);
                }
                else {
                    _renderSearchResults(results);
                }
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Escape')
                    close();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (input) {
                    input.value = '';
                    input.focus();
                }
                clearBtn.classList.remove('settings-search-clear-visible');
                _renderSection(_activeSection);
            });
        }
        // Sidebar nav
        document.querySelectorAll('.settings-nav-item').forEach(function (el) {
            el.addEventListener('click', function () {
                _activeSection = el.dataset['section'] ?? 'app';
                document.querySelectorAll('.settings-nav-item').forEach(function (n) {
                    n.classList.remove('active');
                });
                el.classList.add('active');
                if (input)
                    input.value = '';
                if (clearBtn)
                    clearBtn.classList.remove('settings-search-clear-visible');
                _renderSection(_activeSection);
            });
        });
    }
    return { open, close, toggle, init };
})();
