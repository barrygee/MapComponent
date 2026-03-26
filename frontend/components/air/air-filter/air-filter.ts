// ============================================================
// FILTER PANEL  (_FilterPanel IIFE)
// Real-time search across live aircraft, airports, and military bases.
// Integrated into the side menu; results wire directly to map selection/zoom.
//
// PUBLIC API: init(), toggle(), open(), close()
// DOM: #filter-panel, #filter-input, #filter-results, #filter-clear-btn, #filter-mode-bar
// Depends on: map (global alias), adsbControl, AIRPORTS_DATA, MILITARY_BASES_DATA,
//             airportsControl, militaryBasesControl, _syncSideMenuForPlanes
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />

window._FilterPanel = (() => {
    let _open = false;

    // ---- Inject filter HTML into the map sidebar search pane ----
    (function _injectHTML() {
        if (document.getElementById('filter-input-wrap')) return;
        const html =
            `<div id="filter-input-wrap">` +
                `<svg id="filter-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
                    `<circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.3"/>` +
                    `<line x1="8.5" y1="8.5" x2="12" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
                `</svg>` +
                `<input id="filter-input" type="text" placeholder="CALLSIGN · ICAO · SQUAWK" autocomplete="off" spellcheck="false" />` +
                `<button id="filter-clear-btn" aria-label="Clear filter">✕</button>` +
            `</div>` +
            `<div id="filter-results"></div>`;
        const pane = document.getElementById('msb-pane-search');
        if (pane) {
            pane.insertAdjacentHTML('afterbegin', html);
        } else {
            // Fallback: sidebar not yet available — retry on DOMContentLoaded
            document.addEventListener('DOMContentLoaded', () => {
                const p = document.getElementById('msb-pane-search');
                if (p && !document.getElementById('filter-input-wrap')) p.insertAdjacentHTML('afterbegin', html);
            });
        }
    })();

    function _getPanel()   { return document.getElementById('msb-pane-search'); }
    function _getInput()   { return document.getElementById('filter-input')   as HTMLInputElement | null; }
    function _getResults() { return document.getElementById('filter-results'); }
    function _getClearBtn(){ return document.getElementById('filter-clear-btn'); }

    const _PLANE_ICON   = `<svg width="11" height="11" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="currentColor"/></svg>`;
    const _AIRPORT_ICON = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.4"/><line x1="6.5" y1="2" x2="6.5" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="6.5" x2="11" y2="6.5" stroke="currentColor" stroke-width="1.2"/></svg>`;
    const _MIL_ICON     = `<svg width="11" height="11" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6.5,1.5 12,11.5 1,11.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`;

    interface PlaneResult {
        kind: 'plane';
        feature: GeoJSON.Feature;
        callsign: string;
        hex: string;
        reg: string;
        squawk: string;
        emergency: boolean;
    }
    interface AirportResult {
        kind: 'airport';
        feature: GeoJSON.Feature;
        name: string;
        icao: string;
        iata: string;
    }
    interface MilResult {
        kind: 'mil';
        feature: GeoJSON.Feature;
        name: string;
        icao: string;
    }
    type SearchResult = PlaneResult | AirportResult | MilResult;

    function _getAircraftData(): GeoJSON.Feature[] {
        if (adsbControl && adsbControl._geojson) {
            return adsbControl._geojson.features as GeoJSON.Feature[];
        }
        return [];
    }

    function _matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
        const lowerQuery = query.toLowerCase();
        return fields.some(field => field && field.toLowerCase().includes(lowerQuery));
    }

    function _search(query: string): SearchResult[] {
        const trimmedQuery = query.trim();
        const results: SearchResult[] = [];

        if (!trimmedQuery) return results;

        const planes = _getAircraftData();
        for (const feature of planes) {
            const props = feature.properties as AircraftProperties;
            const callsign = (props.flight || '').trim();
            const hex      = (props.hex || '').trim();
            const reg      = (props.r || '').trim();
            const squawk   = (props.squawk || '').trim();
            if (_matchesQuery(trimmedQuery, callsign, hex, reg, squawk)) {
                results.push({ kind: 'plane', feature, callsign, hex, reg, squawk, emergency: !!props.emergency && props.emergency !== 'none' });
            }
        }

        if (typeof AIRPORTS_DATA !== 'undefined') {
            for (const feature of AIRPORTS_DATA.features) {
                const props = feature.properties as AirportProperties;
                if (_matchesQuery(trimmedQuery, props.icao, props.iata, props.name)) {
                    results.push({ kind: 'airport', feature: feature as GeoJSON.Feature, name: props.name, icao: props.icao, iata: props.iata });
                }
            }
        }

        if (typeof MILITARY_BASES_DATA !== 'undefined') {
            for (const feature of MILITARY_BASES_DATA.features) {
                const props = feature.properties as MilitaryBaseProperties;
                if (_matchesQuery(trimmedQuery, props.icao, props.name)) {
                    results.push({ kind: 'mil', feature: feature as GeoJSON.Feature, name: props.name, icao: props.icao });
                }
            }
        }

        return results;
    }

    function _selectPlane(feature: GeoJSON.Feature): void {
        if (!adsbControl) return;
        const props = feature.properties as AircraftProperties;
        const hex = props.hex;
        adsbControl._selectedHex = hex;
        adsbControl._applySelection();
        const coords = adsbControl._interpolatedCoords(hex) || (feature.geometry as GeoJSON.Point).coordinates;
        map.easeTo({ center: coords as maplibregl.LngLatLike, zoom: Math.max(map.getZoom(), 10), duration: 600 });
    }

    /** Fit the map to a bounding box, offsetting padding to account for the top-right control panel. */
    function _fitBoundsWithControlPadding(bounds: number[]): void {
        const ctrlPanel = document.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null;
        const ctrlW = ctrlPanel ? ctrlPanel.offsetWidth : 0;
        const ctrlH = ctrlPanel ? ctrlPanel.offsetHeight : 0;
        const pad = 80;
        const topExtra = Math.max(0, ctrlH / 2 - pad);
        map.fitBounds(
            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            { padding: { top: pad + topExtra, bottom: pad, left: pad, right: pad + ctrlW }, maxZoom: 13, duration: 800 }
        );
    }

    function _selectAirport(feature: GeoJSON.Feature): void {
        const props = feature.properties as AirportProperties;
        _fitBoundsWithControlPadding(props.bounds);
        if (airportsControl) {
            airportsControl._showAirportPanel(props, (feature.geometry as GeoJSON.Point).coordinates as LngLat, true);
        }
    }

    function _selectMil(feature: GeoJSON.Feature): void {
        const props = feature.properties as MilitaryBaseProperties;
        _fitBoundsWithControlPadding(props.bounds);
        if (militaryBasesControl) {
            militaryBasesControl._showMilitaryBasesPanel(props, (feature.geometry as GeoJSON.Point).coordinates as LngLat);
        }
    }

    function _renderResults(results: SearchResult[], query: string): void {
        const container = _getResults();
        if (!container) return;
        container.innerHTML = '';

        if (!query.trim()) return;

        if (!results.length) {
            const el = document.createElement('div');
            el.className = 'filter-no-results';
            el.textContent = 'No results';
            container.appendChild(el);
            return;
        }

        const planes         = results.filter(r => r.kind === 'plane')   as PlaneResult[];
        const airports       = results.filter(r => r.kind === 'airport') as AirportResult[];
        const militaryBases  = results.filter(r => r.kind === 'mil')     as MilResult[];

        function addSection<T>(label: string, items: T[], renderFn: (r: T) => void) {
            if (!items.length) return;
            const lbl = document.createElement('div');
            lbl.className = 'filter-section-label';
            lbl.textContent = label;
            container.appendChild(lbl);
            items.forEach(renderFn);
        }

        addSection('AIRCRAFT', planes, (r) => {
            const hex = r.hex;
            const item = document.createElement('div') as HTMLDivElement & { _selectAction?: () => void };
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
            const parts: string[] = [];
            if (r.hex)    parts.push(r.hex.toUpperCase());
            if (r.reg)    parts.push(r.reg);
            if (r.squawk) parts.push('SQK ' + r.squawk);
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
                if (!adsbControl) return;
                if (!adsbControl._notifEnabled) adsbControl._notifEnabled = new Set();
                if (!adsbControl._trackingNotifIds) adsbControl._trackingNotifIds = {};
                const matchedFeature = (adsbControl._geojson.features as GeoJSON.Feature[]).find(f => (f.properties as AircraftProperties).hex === hex);
                const matchedProps = matchedFeature ? matchedFeature.properties as AircraftProperties : null;
                const callsign = matchedProps ? ((matchedProps.flight || '').trim() || (matchedProps.r || '').trim() || hex) : hex;
                const wasOn = adsbControl._notifEnabled.has(hex);
                if (wasOn) {
                    adsbControl._notifEnabled.delete(hex);
                    if (adsbControl._trackingNotifIds[hex]) {
                        window._Notifications.dismiss(adsbControl._trackingNotifIds[hex]);
                        delete adsbControl._trackingNotifIds[hex];
                    }
                    window._Notifications.add({ type: 'notif-off', title: callsign });
                } else {
                    adsbControl._notifEnabled.add(hex);
                    if (adsbControl._trackingNotifIds[hex]) window._Notifications.dismiss(adsbControl._trackingNotifIds[hex]);
                    adsbControl._trackingNotifIds[hex] = window._Notifications.add({
                        type: 'tracking', title: callsign,
                        action: {
                            label: 'DISABLE NOTIFICATIONS',
                            callback: () => {
                                adsbControl!._notifEnabled.delete(hex);
                                if (adsbControl!._trackingNotifIds) delete adsbControl!._trackingNotifIds[hex];
                                adsbControl!._rebuildTagForHex(hex);
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
                if (!adsbControl) return;
                const matchedFeature = (adsbControl._geojson.features as GeoJSON.Feature[]).find(f => (f.properties as AircraftProperties).hex === hex);
                if (!matchedFeature) return;

                if (adsbControl._selectedHex !== hex) {
                    adsbControl._selectedHex = hex;
                    adsbControl._applySelection();
                }

                if (adsbControl._tagMarker) {
                    const tagTrackBtn = adsbControl._tagMarker.getElement().querySelector('.tag-follow-btn') as HTMLButtonElement | null;
                    if (tagTrackBtn) tagTrackBtn.click();
                }

                const coords = adsbControl._interpolatedCoords(hex) || (matchedFeature.geometry as GeoJSON.Point).coordinates;
                map.easeTo({ center: coords as maplibregl.LngLatLike, zoom: Math.max(map.getZoom(), 10), duration: 600 });
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
            const item = document.createElement('div') as HTMLDivElement & { _selectAction?: () => void };
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

        addSection('MILITARY', militaryBases, (r) => {
            const item = document.createElement('div') as HTMLDivElement & { _selectAction?: () => void };
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

    function _repositionPanel(): void {}

    function _getFilterBtn() { return document.getElementById('sm-filter-btn'); }

    function open(): void {
        _open = true;
        if (typeof window._MapSidebar !== 'undefined') { window._MapSidebar.show(); window._MapSidebar.switchTab('search'); }
        const btn = _getFilterBtn();
        if (btn) { btn.classList.add('active'); btn.classList.remove('enabled'); }
        const input = _getInput();
        if (input) { input.focus(); input.select(); }
    }

    function close(): void {
        _open = false;
        const btn = _getFilterBtn();
        if (btn) { btn.classList.remove('active'); btn.classList.add('enabled'); }
    }

    function toggle(): void {
        if (_open) close();
        else       open();
    }

    function _saveAdsbFilter(): void {
        try {
            localStorage.setItem('adsbFilter', JSON.stringify({
                typeFilter: adsbControl ? adsbControl._typeFilter : 'all',
                allHidden:  adsbControl ? adsbControl._allHidden  : false,
            }));
        } catch (e) {}
    }

    function init(): void {
        const input    = _getInput();
        const clearBtn = _getClearBtn();
        if (!input) return;

        input.addEventListener('input', () => {
            const inputValue = input.value;
            if (clearBtn) clearBtn.classList.toggle('filter-clear-visible', inputValue.length > 0);
            _renderResults(_search(inputValue), inputValue);
        });

        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') { close(); return; }
            const container = _getResults();
            if (!container) return;
            const items = Array.from(container.querySelectorAll('.filter-result-item')) as (HTMLElement & { _selectAction?: () => void })[];
            if (!items.length) return;
            const focused = container.querySelector('.filter-result-item.keyboard-focused') as (HTMLElement & { _selectAction?: () => void }) | null;
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
                    input.focus();
                } else {
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
                if (container) container.innerHTML = '';
                input.focus();
            });
        }

        // ---- Restore persisted filter state ----
        try {
            const saved = localStorage.getItem('adsbFilter');
            if (saved) {
                const { typeFilter, allHidden } = JSON.parse(saved) as { typeFilter: string; allHidden: boolean };
                if (adsbControl) {
                    if (allHidden) {
                        adsbControl.setAllHidden(true);
                    } else if (typeFilter && typeFilter !== 'all') {
                        adsbControl.setTypeFilter(typeFilter as 'civil' | 'mil');
                    }
                    if (_syncSideMenuForPlanes) _syncSideMenuForPlanes();
                }
            }
        } catch (e) {}
    }

    return { open, close, toggle, init, reposition: _repositionPanel, saveAdsbFilter: _saveAdsbFilter };
})();
