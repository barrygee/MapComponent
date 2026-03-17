/* ============================================================
   SETTINGS PANEL — window._SettingsPanel
   ============================================================ */
window._SettingsPanel = (function () {

    // ── State ────────────────────────────────────────────────
    var _open = false;
    var _activeSection = 'app';

    // ── Settings registry ────────────────────────────────────
    // Each entry: { section, sectionLabel, id, label, desc, renderControl }
    var _settings = [
        {
            section: 'app',
            sectionLabel: 'App Settings',
            id: 'theme',
            label: 'Theme',
            desc: 'Light, dark, or match system preference',
            renderControl: _renderThemeToggle
        }
    ];

    var _NAV_SECTIONS = [
        { key: 'app',   label: 'App Settings' },
        { key: 'air',   label: 'AIR' },
        { key: 'space', label: 'SPACE' },
        { key: 'sea',   label: 'SEA' },
        { key: 'land',  label: 'LAND' },
        { key: 'sdr',   label: 'SDR' }
    ];

    // ── DOM injection ────────────────────────────────────────
    (function _injectHTML() {
        if (document.getElementById('settings-panel')) return;

        var panel = document.createElement('div');
        panel.id = 'settings-panel';

        // Sidebar
        var sidebar = document.createElement('div');
        sidebar.id = 'settings-sidebar';
        _NAV_SECTIONS.forEach(function (s) {
            var item = document.createElement('div');
            item.className = 'settings-nav-item' + (s.key === 'app' ? ' active' : '');
            item.textContent = s.label;
            item.dataset.section = s.key;
            sidebar.appendChild(item);
        });

        // Content area
        var content = document.createElement('div');
        content.id = 'settings-content';

        // Search row
        var searchWrap = document.createElement('div');
        searchWrap.id = 'settings-search-wrap';
        searchWrap.innerHTML =
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
            '</button>';

        // Body
        var body = document.createElement('div');
        body.id = 'settings-body';

        content.appendChild(searchWrap);
        content.appendChild(body);

        panel.appendChild(sidebar);
        panel.appendChild(content);
        document.body.appendChild(panel);
    })();

    // ── Controls ─────────────────────────────────────────────
    function _renderThemeToggle() {
        var STORAGE_KEY = 'sentinel_theme';
        var saved = 'dark';
        try { saved = localStorage.getItem(STORAGE_KEY) || 'dark'; } catch (e) {}

        var wrap = document.createElement('div');
        wrap.className = 'settings-theme-toggle';

        ['light', 'dark', 'system'].forEach(function (mode) {
            var btn = document.createElement('button');
            btn.className = 'settings-theme-btn' + (mode === saved ? ' active' : '');
            btn.textContent = mode.toUpperCase();
            btn.dataset.mode = mode;
            btn.addEventListener('click', function () {
                wrap.querySelectorAll('.settings-theme-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
            });
            wrap.appendChild(btn);
        });

        return wrap;
    }

    // ── Rendering ────────────────────────────────────────────
    function _makeSettingRow(item) {
        var row = document.createElement('div');
        row.className = 'settings-item';

        var info = document.createElement('div');
        info.className = 'settings-item-info';

        var label = document.createElement('div');
        label.className = 'settings-item-label';
        label.textContent = item.label;

        info.appendChild(label);

        if (item.desc) {
            var desc = document.createElement('div');
            desc.className = 'settings-item-desc';
            desc.textContent = item.desc;
            info.appendChild(desc);
        }

        row.appendChild(info);

        if (item.renderControl) {
            var control = item.renderControl();
            row.appendChild(control);
        }

        return row;
    }

    function _renderSection(sectionKey) {
        var body = document.getElementById('settings-body');
        if (!body) return;
        body.innerHTML = '';

        var items = _settings.filter(function (s) { return s.section === sectionKey; });

        if (!items.length) {
            var placeholder = document.createElement('div');
            placeholder.className = 'settings-empty';
            placeholder.textContent = 'Settings coming soon';
            body.appendChild(placeholder);
            return;
        }

        var label = document.createElement('div');
        label.className = 'settings-section-label';
        label.textContent = _NAV_SECTIONS.find(function (s) { return s.key === sectionKey; }).label;
        body.appendChild(label);

        items.forEach(function (item) {
            body.appendChild(_makeSettingRow(item));
        });
    }

    function _search(query) {
        var q = query.trim().toLowerCase();
        if (!q) return null;
        return _settings.filter(function (s) {
            return s.label.toLowerCase().indexOf(q) !== -1 ||
                   s.desc.toLowerCase().indexOf(q) !== -1 ||
                   s.sectionLabel.toLowerCase().indexOf(q) !== -1;
        });
    }

    function _renderSearchResults(results) {
        var body = document.getElementById('settings-body');
        if (!body) return;
        body.innerHTML = '';

        if (!results.length) {
            var empty = document.createElement('div');
            empty.className = 'settings-empty';
            empty.textContent = 'No results found';
            body.appendChild(empty);
            return;
        }

        // Group by section
        var groups = {};
        var groupOrder = [];
        results.forEach(function (item) {
            if (!groups[item.section]) {
                groups[item.section] = [];
                groupOrder.push(item.section);
            }
            groups[item.section].push(item);
        });

        groupOrder.forEach(function (sectionKey) {
            var sectionItems = groups[sectionKey];
            var lbl = document.createElement('div');
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
        var panel = document.getElementById('settings-panel');
        if (panel) panel.classList.add('settings-panel-visible');
        var btn = document.getElementById('settings-btn');
        if (btn) btn.classList.add('settings-btn-active');
        _renderSection(_activeSection);
        var input = document.getElementById('settings-search-input');
        if (input) input.focus();
    }

    function close() {
        _open = false;
        var panel = document.getElementById('settings-panel');
        if (panel) panel.classList.remove('settings-panel-visible');
        var btn = document.getElementById('settings-btn');
        if (btn) btn.classList.remove('settings-btn-active');
        var input = document.getElementById('settings-search-input');
        if (input) input.value = '';
        var clearBtn = document.getElementById('settings-search-clear');
        if (clearBtn) clearBtn.classList.remove('settings-search-clear-visible');
        var body = document.getElementById('settings-body');
        if (body) body.innerHTML = '';
    }

    function toggle() {
        if (_open) close(); else open();
    }

    // ── Init ────────────────────────────────────────────────
    function init() {
        var settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', toggle);
        }

        var input = document.getElementById('settings-search-input');
        var clearBtn = document.getElementById('settings-search-clear');

        if (input) {
            input.addEventListener('input', function () {
                var q = input.value;
                if (clearBtn) clearBtn.classList.toggle('settings-search-clear-visible', q.length > 0);
                var results = _search(q);
                if (results === null) {
                    _renderSection(_activeSection);
                } else {
                    _renderSearchResults(results);
                }
            });

            input.addEventListener('keydown', function (e) {
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
        document.querySelectorAll('.settings-nav-item').forEach(function (el) {
            el.addEventListener('click', function () {
                _activeSection = el.dataset.section;
                document.querySelectorAll('.settings-nav-item').forEach(function (n) {
                    n.classList.remove('active');
                });
                el.classList.add('active');
                if (input) { input.value = ''; }
                if (clearBtn) clearBtn.classList.remove('settings-search-clear-visible');
                _renderSection(_activeSection);
            });
        });
    }

    return { open: open, close: close, toggle: toggle, init: init };

})();
