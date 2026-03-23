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

    // Cached satellite list fetched from the API
    interface SatEntry {
        norad_id:   string;
        name:       string;
        category:   string | null;
        updated_at: number | null;
    }
    let _satellites: SatEntry[] = [];
    let _loaded = false;

    // ---- Inject panel HTML ----
    (function _injectHTML() {
        if (document.getElementById('space-filter-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'space-filter-panel';
        panel.innerHTML =
            `<div id="space-filter-input-wrap">` +
                `<svg id="space-filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
                    `<circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/>` +
                    `<line x1="8.5" y1="8.5" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
                `</svg>` +
                `<input id="space-filter-input" type="text" placeholder="SATELLITE NAME · NORAD ID · CATEGORY" autocomplete="off" spellcheck="false" />` +
                `<button id="space-filter-clear-btn" aria-label="Clear filter">✕</button>` +
            `</div>` +
            `<div id="space-filter-results"></div>`;
        document.body.appendChild(panel);
    })();

    function _getPanel()   { return document.getElementById('space-filter-panel'); }
    function _getInput()   { return document.getElementById('space-filter-input')      as HTMLInputElement | null; }
    function _getResults() { return document.getElementById('space-filter-results'); }
    function _getClearBtn(){ return document.getElementById('space-filter-clear-btn'); }

    const _SAT_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="4" height="4" fill="currentColor"/><rect x="2" y="10" width="7" height="4" fill="currentColor" opacity="0.5"/><rect x="15" y="10" width="7" height="4" fill="currentColor" opacity="0.5"/><line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" stroke-width="1.5" opacity="0.5"/><line x1="12" y1="16" x2="12" y2="22" stroke="currentColor" stroke-width="1.5" opacity="0.5"/></svg>`;

    const _CATEGORY_LABELS: Record<string, string> = {
        space_station: 'STATION',
        amateur:       'AMATEUR',
        weather:       'WEATHER',
        military:      'MIL',
        navigation:    'NAV',
        science:       'SCI',
        cubesat:       'CUBE',
        active:        'ACTIVE',
        unknown:       'UNKN',
    };

    function _categoryBadge(cat: string | null): string {
        if (!cat) return '';
        return _CATEGORY_LABELS[cat] || cat.toUpperCase().slice(0, 6);
    }

    function _matchesQuery(query: string, ...fields: (string | undefined | null)[]): boolean {
        const lq = query.toLowerCase();
        return fields.some(f => f && f.toLowerCase().includes(lq));
    }

    // Maps human-readable aliases to category keys so "space station" matches space_station, etc.
    const _CATEGORY_ALIASES: Record<string, string[]> = {
        space_station: ['space station', 'station', 'iss'],
        amateur:       ['amateur', 'ham'],
        weather:       ['weather', 'met'],
        military:      ['military', 'mil', 'defense', 'defence'],
        navigation:    ['navigation', 'nav', 'gps', 'gnss'],
        science:       ['science', 'sci', 'research'],
        cubesat:       ['cubesat', 'cube', 'smallsat'],
        active:        ['active'],
        unknown:       ['unknown', 'unkn'],
    };

    function _categoryForQuery(query: string): string | null {
        const lq = query.toLowerCase().trim();
        if (lq.length < 2) return null;
        for (const [cat, aliases] of Object.entries(_CATEGORY_ALIASES)) {
            if (aliases.some(a => a === lq || a.startsWith(lq) || lq.startsWith(a))) return cat;
        }
        return null;
    }

    function _search(query: string): SatEntry[] {
        const q = query.trim();
        if (!q) return [];
        const matchedCategory = _categoryForQuery(q);
        return _satellites.filter(s =>
            _matchesQuery(q, s.name, s.norad_id) ||
            (matchedCategory !== null && s.category === matchedCategory)
        );
    }

    function _renderResults(results: SatEntry[], query: string): void {
        const container = _getResults();
        if (!container) return;
        container.innerHTML = '';

        if (!query.trim()) return;

        if (!_loaded) {
            const el = document.createElement('div');
            el.className = 'space-filter-no-results';
            el.textContent = 'Loading satellite database…';
            container.appendChild(el);
            return;
        }

        if (!results.length) {
            const el = document.createElement('div');
            el.className = 'space-filter-no-results';
            el.textContent = 'No satellites found';
            container.appendChild(el);
            return;
        }

        // Cap display to 50 results for performance
        const display = results.slice(0, 50);

        const lbl = document.createElement('div');
        lbl.className = 'space-filter-section-label';
        lbl.textContent = `SATELLITES${results.length > 50 ? ' (showing 50 of ' + results.length + ')' : ''}`;
        container.appendChild(lbl);

        display.forEach(sat => {
            const item = document.createElement('div') as HTMLDivElement & { _selectAction?: () => void };
            item.className = 'space-filter-result-item';

            const icon = document.createElement('div');
            icon.className = 'space-filter-result-icon';
            icon.innerHTML = _SAT_ICON;

            const info = document.createElement('div');
            info.className = 'space-filter-result-info';

            const primary = document.createElement('div');
            primary.className = 'space-filter-result-primary';
            primary.textContent = sat.name || sat.norad_id;

            const secondary = document.createElement('div');
            secondary.className = 'space-filter-result-secondary';
            secondary.textContent = 'NORAD ' + sat.norad_id;

            info.appendChild(primary);
            info.appendChild(secondary);

            const badge = document.createElement('div');
            badge.className = 'space-filter-result-badge';
            badge.textContent = _categoryBadge(sat.category);

            // SELECT button — switches the active satellite on the map
            const selectBtn = document.createElement('button');
            selectBtn.className = 'space-filter-action-btn space-filter-select-btn';
            selectBtn.textContent = 'SELECT';

            const doSelect = () => {
                if (issControl) {
                    issControl.switchSatellite(sat.norad_id, sat.name || sat.norad_id);
                }
                close();
            };

            selectBtn.addEventListener('mousedown', e => e.stopPropagation());
            selectBtn.addEventListener('click', (e) => { e.stopPropagation(); doSelect(); });

            item.addEventListener('mouseenter', () => {
                if (issControl) issControl.previewSatellite(sat.norad_id);
            });
            item.addEventListener('mouseleave', () => {
                if (issControl) issControl.clearPreview();
            });

            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(badge);
            item.appendChild(selectBtn);

            info.style.flex = '1';
            info.style.minWidth = '0';
            info.style.cursor = 'pointer';
            info.addEventListener('click', doSelect);
            icon.style.cursor = 'pointer';
            icon.addEventListener('click', doSelect);
            item._selectAction = doSelect;

            container.appendChild(item);
        });
    }

    async function _loadSatellites(): Promise<void> {
        try {
            const resp = await fetch('/api/space/tle/list');
            if (!resp.ok) return;
            const data = await resp.json() as { satellites?: SatEntry[] };
            if (data.satellites) {
                _satellites = data.satellites;
                _loaded = true;
            }
        } catch (_e) {
            // Fail silently — panel will show empty results
        }
    }

    function _getFilterBtn() { return document.getElementById('ssm-filter-btn'); }

    function open(): void {
        _open = true;
        const panel = _getPanel();
        if (panel) panel.classList.add('space-filter-panel-visible');
        const btn = _getFilterBtn();
        if (btn) { btn.classList.add('active'); btn.classList.remove('enabled'); }
        const input = _getInput();
        if (input) { input.focus(); input.select(); }
        // Refresh satellite list on open so it stays up to date
        void _loadSatellites();
    }

    function close(): void {
        _open = false;
        const panel = _getPanel();
        if (panel) panel.classList.remove('space-filter-panel-visible');
        const btn = _getFilterBtn();
        if (btn) { btn.classList.remove('active'); btn.classList.add('enabled'); }
        // Ensure any active preview is cleared when the panel closes
        if (issControl) issControl.clearPreview();
    }

    function toggle(): void {
        if (_open) close();
        else       open();
    }

    function init(): void {
        const input    = _getInput();
        const clearBtn = _getClearBtn();
        if (!input) return;

        // Pre-load satellite list on init
        void _loadSatellites();

        input.addEventListener('input', () => {
            const val = input.value;
            if (clearBtn) clearBtn.classList.toggle('space-filter-clear-visible', val.length > 0);
            _renderResults(_search(val), val);
        });

        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') { close(); return; }
            const container = _getResults();
            if (!container) return;
            const items = Array.from(container.querySelectorAll('.space-filter-result-item')) as (HTMLElement & { _selectAction?: () => void })[];
            if (!items.length) return;
            const focused = container.querySelector('.space-filter-result-item.keyboard-focused') as (HTMLElement & { _selectAction?: () => void }) | null;
            const idx = focused ? items.indexOf(focused) : -1;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (focused) focused.classList.remove('keyboard-focused');
                const next = items[idx + 1] || items[0];
                next.classList.add('keyboard-focused');
                next.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (idx <= 0) {
                    if (focused) focused.classList.remove('keyboard-focused');
                } else {
                    if (focused) focused.classList.remove('keyboard-focused');
                    const prev = items[idx - 1];
                    prev.classList.add('keyboard-focused');
                    prev.scrollIntoView({ block: 'nearest' });
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (focused) {
                    if (focused._selectAction) focused._selectAction();
                } else {
                    items[0].classList.add('keyboard-focused');
                    items[0].scrollIntoView({ block: 'nearest' });
                }
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                input.value = '';
                clearBtn.classList.remove('space-filter-clear-visible');
                const container = _getResults();
                if (container) container.innerHTML = '';
                input.focus();
            });
        }

        // Close on outside click
        document.addEventListener('mousedown', (e) => {
            if (!_open) return;
            const panel = _getPanel();
            const btn   = _getFilterBtn();
            if (panel && !panel.contains(e.target as Node) && (!btn || !btn.contains(e.target as Node))) {
                close();
            }
        });
    }

    return { open, close, toggle, init };
})();
