// ============================================================
// SIDE MENU
// Collapsible right-side overlay control panel.
// Contains: zoom/location nav buttons, overlay toggles,
//           3D view toggle, 3D controls widget, and filter button.
//
// Depends on (all globals):
//   map, adsbControl, adsbLabelsControl, rangeRingsControl,
//   airportsControl, militaryBasesControl, aarControl, awacsControl,
//   namesControl, roadsControl, clearControl, _FilterPanel
// ============================================================

/// <reference path="../globals.d.ts" />
/// <reference path="../types.ts" />

(function buildSideMenu() {

    // The native MapLibre ctrl-top-right container holds the hidden control buttons.
    // We wait for it to exist in the DOM, then hide it — our side menu replaces it visually.
    function hideMapLibreCtrlContainer() {
        const ctrlTopRight = document.querySelector('.maplibregl-ctrl-top-right') as HTMLElement | null;
        if (!ctrlTopRight) { setTimeout(hideMapLibreCtrlContainer, 50); return; }
        ctrlTopRight.style.display = 'none';
    }
    hideMapLibreCtrlContainer();

    let expanded = false;

    const panel = document.createElement('div');
    panel.id = 'side-menu';

    function makeGroup(id?: string): HTMLDivElement {
        const group = document.createElement('div');
        group.className = 'sm-group';
        if (id) group.id = id;
        return group;
    }

    const LOC_SVG   = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`;
    const PLANE_SVG = `<svg width="16" height="15" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="#ffffff"/><polyline points="10,0 0,0 0,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,0 56,0 56,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="10,52 0,52 0,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,52 56,52 56,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/></svg>`;

    function makeNavBtn(content: string, title: string, onClick: () => void, isHTML?: boolean): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className        = 'sm-nav-btn';
        btn.title            = title;
        btn.dataset['tooltip'] = title;
        if (isHTML) btn.innerHTML  = content;
        else        btn.textContent = content;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function makeOverlayBtn(
        icon: string,
        iconFontSize: string,
        label: string,
        getActive: () => boolean,
        doToggle: () => void,
        isHTML?: boolean,
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className       = 'sm-btn';
        btn.dataset['tooltip'] = label;

        const iconSpan = document.createElement('span');
        iconSpan.className  = 'sm-icon';
        if (isHTML) iconSpan.innerHTML  = icon;
        else        iconSpan.textContent = icon;
        iconSpan.style.fontSize = iconFontSize;

        const labelSpan = document.createElement('span');
        labelSpan.className  = 'sm-label';
        labelSpan.textContent = label;

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        function syncActiveClass() { btn.classList.toggle('active', getActive()); }

        btn.addEventListener('click', () => { doToggle(); syncActiveClass(); });
        syncActiveClass();
        return btn;
    }


    // ---- Group 1: expand / collapse toggle ----
    const toggleGroup = makeGroup('sm-group-toggle');
    const toggleBtn   = document.createElement('button');
    toggleBtn.id               = 'side-menu-toggle';
    toggleBtn.textContent      = '‹';
    toggleBtn.title            = 'Expand / collapse menu';
    toggleBtn.dataset['tooltip']  = 'EXPAND MENU';
    toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        panel.classList.toggle('expanded', expanded);
        toggleBtn.textContent       = expanded ? '›' : '‹';
        toggleBtn.dataset['tooltip'] = expanded ? 'COLLAPSE MENU' : 'EXPAND MENU';
    });
    toggleGroup.appendChild(toggleBtn);
    panel.appendChild(toggleGroup);


    // ---- Group 2: zoom in / zoom out / go to my location ----
    const navGroup = makeGroup('sm-group-nav');
    navGroup.appendChild(makeNavBtn('+', 'Zoom in',  () => map.zoomIn()));
    navGroup.appendChild(makeNavBtn('−', 'Zoom out', () => map.zoomOut()));

    const locBtn = makeNavBtn(LOC_SVG, 'Go to my location', () => goToUserLocation(), true);
    navGroup.appendChild(locBtn);

    let locActiveZoom: number | null = null;
    let locFlying     = false;

    function isUserLocationVisible(): boolean {
        if (!rangeRingCenter) return false;
        return map.getBounds().contains([rangeRingCenter[0], rangeRingCenter[1]] as maplibregl.LngLatLike);
    }

    function deactivateLocationBtn(): void {
        locBtn.classList.remove('active');
        locActiveZoom = null;
    }

    map.on('zoom', () => {
        if (locActiveZoom === null || locFlying) return;
        if (map.getZoom() <= locActiveZoom - 2) deactivateLocationBtn();
    });

    map.on('moveend', () => {
        if (locFlying) {
            locFlying     = false;
            locActiveZoom = map.getZoom();
            return;
        }
        if (locActiveZoom === null) return;
        if (!isUserLocationVisible()) deactivateLocationBtn();
    });

    _onGoToUserLocation = () => {
        locBtn.classList.add('active');
        locActiveZoom = null;
        locFlying     = true;
    };

    panel.appendChild(navGroup);


    // ---- Group 3: overlay toggles ----

    function toggleAdsb(): void {
        adsbControl!.toggle();
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(adsbControl!.visible);
    }

    const overlayGroup = makeGroup();

    const planesBtn = makeOverlayBtn(PLANE_SVG, '8px', 'PLANES',
        () => adsbControl ? adsbControl.visible : false,
        () => { toggleAdsb(); syncLabelsBtn(); syncFilterBtn(); },
        true);
    planesBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(planesBtn);

    const groundBtn = makeOverlayBtn('GND', '8px', 'GROUND VEHICLES',
        () => adsbControl ? !adsbControl._hideGroundVehicles : true,
        () => { if (adsbControl) adsbControl.setHideGroundVehicles(!adsbControl._hideGroundVehicles); });
    groundBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(groundBtn);

    const towerBtn = makeOverlayBtn('TWR', '8px', 'TOWERS',
        () => adsbControl ? !adsbControl._hideTowers : true,
        () => { if (adsbControl) adsbControl.setHideTowers(!adsbControl._hideTowers); });
    towerBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(towerBtn);

    const labelsBtn = makeOverlayBtn('CALL', '8px', 'CALLSIGNS',
        () => adsbLabelsControl ? adsbLabelsControl.labelsVisible : false,
        () => { if (adsbLabelsControl) adsbLabelsControl.toggle(); });
    labelsBtn.classList.add('sm-expanded-only');

    function syncLabelsBtn(): void {
        const planesOn = adsbControl ? (adsbControl.visible && !adsbControl._allHidden) : false;
        labelsBtn.classList.toggle('sm-planes-off', !planesOn);
        labelsBtn.classList.toggle('active',
            planesOn && adsbLabelsControl ? adsbLabelsControl.labelsVisible : false);
    }

    overlayGroup.appendChild(labelsBtn);
    labelsBtn.addEventListener('click', syncLabelsBtn);
    syncLabelsBtn();

    const ringsBtn = makeOverlayBtn('◎', '16px', 'RANGE RING',
        () => rangeRingsControl ? rangeRingsControl.ringsVisible : false,
        () => { if (rangeRingsControl) rangeRingsControl.toggleRings(); });
    overlayGroup.appendChild(ringsBtn);

    const aarBtn = makeOverlayBtn('=', '16px', 'A2A REFUELING',
        () => aarControl ? aarControl.visible : false,
        () => { if (aarControl) aarControl.toggle(); });
    overlayGroup.appendChild(aarBtn);

    const awacsBtn = makeOverlayBtn('○', '16px', 'AWACS',
        () => awacsControl ? awacsControl.visible : false,
        () => { if (awacsControl) awacsControl.toggle(); });
    overlayGroup.appendChild(awacsBtn);


    // ---- 3D view toggle ----
    let _tiltActive = localStorage.getItem('sentinel_3d') === '1';

    const CUBE_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="7,1 13,4.5 13,9.5 7,13 1,9.5 1,4.5" stroke="currentColor" stroke-width="1.2" fill="none"/><polyline points="7,1 7,7" stroke="currentColor" stroke-width="1.2"/><polyline points="1,4.5 7,7 13,4.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

    const tiltBtn = makeOverlayBtn(CUBE_SVG, '14px', '3D VIEW',
        () => _tiltActive,
        () => {
            _tiltActive = !_tiltActive;
            localStorage.setItem('sentinel_3d', _tiltActive ? '1' : '0');

            const panel3d = document.getElementById('map-3d-controls');
            if (panel3d) panel3d.style.display = _tiltActive ? 'grid' : 'none';

            const isFollowingAircraft = adsbControl !== null && adsbControl._followEnabled;

            if (_tiltActive) {
                _targetPitch = 45;
                if (isFollowingAircraft) {
                    const f = _getTrackedFeature();
                    map.easeTo({ pitch: 45, ...(f ? { center: f.geometry.coordinates as maplibregl.LngLatLike } : {}), duration: 600 });
                } else {
                    map.easeTo({ pitch: 45, duration: 400 });
                }
            } else {
                _targetPitch = 0;
                if (isFollowingAircraft) {
                    const f = _getTrackedFeature();
                    map.easeTo({ pitch: 0, bearing: 0, zoom: 14, ...(f ? { center: f.geometry.coordinates as maplibregl.LngLatLike } : {}), duration: 600 });
                } else {
                    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
                }
            }
        },
        true);

    overlayGroup.appendChild(tiltBtn);

    function _getTrackedFeature(): { geometry: { coordinates: number[] } } | null {
        const hex = adsbControl && adsbControl._tagHex;
        if (!hex || !adsbControl || !adsbControl._geojson) return null;
        return (adsbControl._geojson.features as Array<{ properties: { hex: string }; geometry: { coordinates: number[] } }>).find(f => f.properties.hex === hex) || null;
    }

    // ---- 3D state — exposed as window globals ----
    let _targetPitch       = _tiltActive ? 45 : 0;
    window._is3DActive     = () => _tiltActive;
    window._getTargetPitch = () => _targetPitch;
    window._setTargetPitch = (p: number) => { _targetPitch = p; };

    window._set3DActive = function (active: boolean, applyPitch?: boolean) {
        if (_tiltActive === active && !applyPitch) return;
        _tiltActive = active;
        localStorage.setItem('sentinel_3d', _tiltActive ? '1' : '0');
        const panel3d = document.getElementById('map-3d-controls');
        if (panel3d) panel3d.style.display = _tiltActive ? 'grid' : 'none';
        tiltBtn.classList.toggle('active', _tiltActive);
        if (applyPitch) {
            if (_tiltActive) {
                map.easeTo({ pitch: 45, duration: 400 });
            } else {
                map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
            }
        }
    };


    // ---- More overlay buttons (expanded-only) ----

    const cvlBtn = makeOverlayBtn('CVL', '8px', 'AIRPORTS',
        () => airportsControl ? airportsControl.visible : false,
        () => { if (airportsControl) airportsControl.toggle(); });
    cvlBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(cvlBtn);

    const milBtn = makeOverlayBtn('MIL', '8px', 'MILITARY BASES',
        () => militaryBasesControl ? militaryBasesControl.visible : false,
        () => { if (militaryBasesControl) militaryBasesControl.toggle(); });
    milBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(milBtn);

    const citiesBtn = makeOverlayBtn('N', '14px', 'LOCATIONS',
        () => namesControl ? namesControl.namesVisible : false,
        () => { if (namesControl) namesControl.toggleNames(); });
    citiesBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(citiesBtn);

    const roadsBtn = makeOverlayBtn('R', '14px', 'ROADS',
        () => roadsControl ? roadsControl.roadsVisible : false,
        () => { if (roadsControl) roadsControl.toggleRoads(); });
    roadsBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(roadsBtn);

    panel.appendChild(overlayGroup);


    // ---- Hide all layers button ----
    const clearGroup = makeGroup();
    clearGroup.appendChild(makeOverlayBtn('✕', '14px', 'HIDE LAYERS',
        () => clearControl ? clearControl._cleared : false,
        () => { if (clearControl) clearControl.toggle(); }));
    panel.appendChild(clearGroup);


    // ---- Filter button ----
    const FILTER_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="3.5" x2="14" y2="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="3.5" y1="7.5" x2="11.5" y2="7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="6" y1="11.5" x2="9" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const filterGroup = makeGroup();
    const filterBtn   = document.createElement('button');
    filterBtn.className       = 'sm-btn enabled';
    filterBtn.dataset['tooltip'] = 'FILTER';
    filterBtn.id              = 'sm-filter-btn';

    const filterIconSpan  = document.createElement('span');
    filterIconSpan.className = 'sm-icon';
    filterIconSpan.innerHTML = FILTER_SVG;

    const filterLabelSpan  = document.createElement('span');
    filterLabelSpan.className   = 'sm-label';
    filterLabelSpan.textContent = 'FILTER';

    filterBtn.appendChild(filterIconSpan);
    filterBtn.appendChild(filterLabelSpan);
    filterBtn.addEventListener('click', () => {
        if (window._FilterPanel) window._FilterPanel.toggle();
    });
    filterGroup.appendChild(filterBtn);
    panel.appendChild(filterGroup);

    function syncFilterBtn(): void {}
    syncFilterBtn();

    _syncSideMenuForPlanes = function () { syncLabelsBtn(); syncFilterBtn(); };

    document.body.appendChild(panel);


    // ---- 3D controls widget (fixed bottom-right) ----
    const ctrl3d = document.createElement('div');
    ctrl3d.id            = 'map-3d-controls';
    ctrl3d.style.display = 'none';

    function make3dBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className        = 'map-3d-btn';
        btn.dataset['tooltip'] = title;
        btn.textContent      = icon;
        btn.addEventListener('click', onClick);
        return btn;
    }

    ctrl3d.appendChild(document.createElement('span'));
    ctrl3d.appendChild(make3dBtn('↑', 'TILT UP', () => {
        const p = Math.min(map.getPitch() + 10, 85);
        if (window._setTargetPitch) window._setTargetPitch(p);
        map.easeTo({ pitch: p, duration: 300 });
    }));
    ctrl3d.appendChild(document.createElement('span'));

    ctrl3d.appendChild(make3dBtn('↺', 'ROTATE LEFT',  () => map.easeTo({ bearing: map.getBearing() - 15, duration: 300 })));
    ctrl3d.appendChild(make3dBtn('⌖', 'RESET BEARING', () => map.easeTo({ bearing: 0, duration: 400 })));
    ctrl3d.appendChild(make3dBtn('↻', 'ROTATE RIGHT', () => map.easeTo({ bearing: map.getBearing() + 15, duration: 300 })));

    ctrl3d.appendChild(document.createElement('span'));
    ctrl3d.appendChild(make3dBtn('↓', 'TILT DOWN', () => {
        const p = Math.max(map.getPitch() - 10, 0);
        if (window._setTargetPitch) window._setTargetPitch(p);
        map.easeTo({ pitch: p, duration: 300 });
    }));
    ctrl3d.appendChild(document.createElement('span'));

    document.body.appendChild(ctrl3d);

    if (_tiltActive) ctrl3d.style.display = 'grid';

})();
