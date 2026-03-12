// ============================================================
// SIDE MENU
// Collapsible right-side overlay control panel.
// Contains: zoom/location nav buttons, overlay toggles,
//           3D view toggle, 3D controls widget, and filter button.
//
// Depends on (all globals):
//   map, adsbControl, adsbLabelsControl, rangeRingsControl,
//   airportsControl, rafControl, aarControl, awacsControl,
//   namesControl, roadsControl, clearControl, _FilterPanel
// ============================================================

(function buildSideMenu() {

    // The native MapLibre ctrl-top-right container holds the hidden control buttons.
    // We wait for it to exist in the DOM, then hide it — our side menu replaces it visually.
    function hideMapLibreCtrlContainer() {
        const ctrlTopRight = document.querySelector('.maplibregl-ctrl-top-right');
        if (!ctrlTopRight) { setTimeout(hideMapLibreCtrlContainer, 50); return; } // retry until present
        ctrlTopRight.style.display = 'none';
    }
    hideMapLibreCtrlContainer();

    let expanded = false; // current expand/collapse state of the side menu panel

    // Root panel element appended to <body>
    const panel = document.createElement('div');
    panel.id = 'side-menu';

    // ---- Helper: create a .sm-group wrapper ----
    // Groups of related buttons share a visual divider.
    function makeGroup(id) {
        const g = document.createElement('div');
        g.className = 'sm-group';
        if (id) g.id = id;
        return g;
    }

    // ---- SVG icons used by nav buttons ----
    // Location button: lime circle with white centre dot (matches user marker design)
    const LOC_SVG   = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`;
    // Plane button: white aircraft silhouette with lime corner brackets
    const PLANE_SVG = `<svg width="16" height="15" viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="28,18 35,36 28,33 21,36" fill="#ffffff"/><polyline points="10,0 0,0 0,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,0 56,0 56,10" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="10,52 0,52 0,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/><polyline points="46,52 56,52 56,42" stroke="rgba(200,255,0,0.75)" stroke-width="3" stroke-linecap="square"/></svg>`;

    /**
     * Create a simple nav/action button (zoom in/out, location).
     * @param {string|HTML} content  Button label or SVG HTML
     * @param {string}      title    Tooltip text
     * @param {function}    onClick  Click handler
     * @param {boolean}     isHTML   If true, content is set as innerHTML
     * @returns {HTMLButtonElement}
     */
    function makeNavBtn(content, title, onClick, isHTML) {
        const btn = document.createElement('button');
        btn.className        = 'sm-nav-btn';
        btn.title            = title;
        btn.dataset.tooltip  = title;
        if (isHTML) btn.innerHTML  = content;
        else        btn.textContent = content;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /**
     * Create an overlay toggle button with icon + label.
     * The button adds/removes the 'active' class whenever the toggle fires.
     * @param {string|HTML} icon        Icon text or SVG HTML
     * @param {string}      iconFontSize CSS font-size string for the icon span
     * @param {string}      label       Visible tooltip label
     * @param {function}    getActive   Returns the current active state (boolean)
     * @param {function}    doToggle    Called when the button is clicked
     * @param {boolean}     isHTML      If true, icon is set as innerHTML
     * @returns {HTMLButtonElement}
     */
    function makeOverlayBtn(icon, iconFontSize, label, getActive, doToggle, isHTML) {
        const btn = document.createElement('button');
        btn.className       = 'sm-btn';
        btn.dataset.tooltip = label;

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

        // Sync the 'active' class immediately to reflect the current toggle state
        function syncActiveClass() { btn.classList.toggle('active', getActive()); }

        btn.addEventListener('click', () => { doToggle(); syncActiveClass(); });
        syncActiveClass(); // initial state
        return btn;
    }


    // ---- Group 1: expand / collapse toggle ----
    const toggleGroup = makeGroup('sm-group-toggle');
    const toggleBtn   = document.createElement('button');
    toggleBtn.id               = 'side-menu-toggle';
    toggleBtn.textContent      = '‹';
    toggleBtn.title            = 'Expand / collapse menu';
    toggleBtn.dataset.tooltip  = 'EXPAND MENU';
    toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        panel.classList.toggle('expanded', expanded);
        toggleBtn.textContent     = expanded ? '›' : '‹';
        toggleBtn.dataset.tooltip = expanded ? 'COLLAPSE MENU' : 'EXPAND MENU';
    });
    toggleGroup.appendChild(toggleBtn);
    panel.appendChild(toggleGroup);


    // ---- Group 2: zoom in / zoom out / go to my location ----
    const navGroup = makeGroup('sm-group-nav');
    navGroup.appendChild(makeNavBtn('+', 'Zoom in',  () => map.zoomIn()));
    navGroup.appendChild(makeNavBtn('−', 'Zoom out', () => map.zoomOut()));

    // Location button — flies to user's GPS position
    const locBtn = makeNavBtn(LOC_SVG, 'Go to my location', () => goToUserLocation(), true);
    navGroup.appendChild(locBtn);

    // ---- Location button active-state logic ----
    // The button shows as active while the map is centred on the user's location.
    // It deactivates if the user zooms out 2+ levels or pans the marker off-screen.
    let locActiveZoom = null; // zoom level when the fly-to completed
    let locFlying     = false; // true during the flyTo animation

    /** Check whether the user location marker is within the current viewport. */
    function isUserLocationVisible() {
        if (!rangeRingCenter) return false;
        return map.getBounds().contains([rangeRingCenter[0], rangeRingCenter[1]]);
    }

    /** Remove the active highlight from the location button and clear the saved zoom. */
    function deactivateLocationBtn() {
        locBtn.classList.remove('active');
        locActiveZoom = null;
    }

    // Deactivate when the user zooms out significantly from where they landed
    map.on('zoom', () => {
        if (locActiveZoom === null || locFlying) return;
        if (map.getZoom() <= locActiveZoom - 2) deactivateLocationBtn();
    });

    // Deactivate when the user pans the location marker out of view
    map.on('moveend', () => {
        if (locFlying) {
            // The flyTo just landed — record the arrival zoom and clear the flying flag
            locFlying     = false;
            locActiveZoom = map.getZoom();
            return;
        }
        if (locActiveZoom === null) return;
        if (!isUserLocationVisible()) deactivateLocationBtn();
    });

    // Called by user-location.js goToUserLocation() after the flyTo starts
    _onGoToUserLocation = () => {
        locBtn.classList.add('active'); // highlight button during flight
        locActiveZoom = null;           // will be set on moveend
        locFlying     = true;           // suppress zoom deactivation during flight
    };

    panel.appendChild(navGroup);


    // ---- Group 3: overlay toggles ----

    // Toggle ADS-B + sync labels and filter button state
    function toggleAdsb() {
        adsbControl.toggle();
        if (adsbLabelsControl) adsbLabelsControl.syncToAdsb(adsbControl.visible);
    }

    const overlayGroup = makeGroup();

    // PLANES — toggles the live ADS-B aircraft feed
    const planesBtn = makeOverlayBtn(PLANE_SVG, '8px', 'PLANES',
        () => adsbControl ? adsbControl.visible : false,
        () => { toggleAdsb(); syncLabelsBtn(); syncFilterBtn(); },
        true);
    planesBtn.classList.add('sm-expanded-only'); // only visible when menu is expanded
    overlayGroup.appendChild(planesBtn);

    // GROUND VEHICLES — hides/shows C1/C2 category aircraft (ground vehicles)
    const groundBtn = makeOverlayBtn('GND', '8px', 'GROUND VEHICLES',
        () => adsbControl ? !adsbControl._hideGroundVehicles : true,
        () => { if (adsbControl) adsbControl.setHideGroundVehicles(!adsbControl._hideGroundVehicles); });
    groundBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(groundBtn);

    // TOWERS — hides/shows C3/C4/C5 and TWR type (obstructions/towers)
    const towerBtn = makeOverlayBtn('TWR', '8px', 'TOWERS',
        () => adsbControl ? !adsbControl._hideTowers : true,
        () => { if (adsbControl) adsbControl.setHideTowers(!adsbControl._hideTowers); });
    towerBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(towerBtn);

    // CALLSIGNS — toggles aircraft callsign label markers
    const labelsBtn = makeOverlayBtn('CALL', '8px', 'CALLSIGNS',
        () => adsbLabelsControl ? adsbLabelsControl.labelsVisible : false,
        () => { if (adsbLabelsControl) adsbLabelsControl.toggle(); });
    labelsBtn.classList.add('sm-expanded-only');

    /**
     * Sync the callsigns button state.
     * Dims the button and removes active class when the planes overlay is off.
     */
    function syncLabelsBtn() {
        const planesOn = adsbControl ? (adsbControl.visible && !adsbControl._allHidden) : false;
        labelsBtn.classList.toggle('sm-planes-off', !planesOn); // dim when planes hidden
        labelsBtn.classList.toggle('active',
            planesOn && adsbLabelsControl ? adsbLabelsControl.labelsVisible : false);
    }

    overlayGroup.appendChild(labelsBtn);
    labelsBtn.addEventListener('click', syncLabelsBtn); // re-sync after each click
    syncLabelsBtn(); // initial sync

    // RANGE RINGS — geodesic 50/100/150/200/250 nm circles around user location
    const ringsBtn = makeOverlayBtn('◎', '16px', 'RANGE RING',
        () => rangeRingsControl ? rangeRingsControl.ringsVisible : false,
        () => { if (rangeRingsControl) rangeRingsControl.toggleRings(); });
    overlayGroup.appendChild(ringsBtn);

    // A2A REFUELLING — AARA polygon zones
    const aarBtn = makeOverlayBtn('=', '16px', 'A2A REFUELING',
        () => aarControl ? aarControl.visible : false,
        () => { if (aarControl) aarControl.toggle(); });
    overlayGroup.appendChild(aarBtn);

    // AWACS — AWACS orbit zone polygons
    const awacsBtn = makeOverlayBtn('○', '16px', 'AWACS',
        () => awacsControl ? awacsControl.visible : false,
        () => { if (awacsControl) awacsControl.toggle(); });
    overlayGroup.appendChild(awacsBtn);


    // ---- 3D view toggle ----
    // Persisted to localStorage key 'sentinel_3d' (value '1' = active).
    let _tiltActive = localStorage.getItem('sentinel_3d') === '1';

    const CUBE_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="7,1 13,4.5 13,9.5 7,13 1,9.5 1,4.5" stroke="currentColor" stroke-width="1.2" fill="none"/><polyline points="7,1 7,7" stroke="currentColor" stroke-width="1.2"/><polyline points="1,4.5 7,7 13,4.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

    const tiltBtn = makeOverlayBtn(CUBE_SVG, '14px', '3D VIEW',
        () => _tiltActive,
        () => {
            _tiltActive = !_tiltActive;
            localStorage.setItem('sentinel_3d', _tiltActive ? '1' : '0');

            // Show/hide the 3D controls widget
            const panel3d = document.getElementById('map-3d-controls');
            if (panel3d) panel3d.style.display = _tiltActive ? 'grid' : 'none';

            const isFollowingAircraft = typeof adsbControl !== 'undefined' && adsbControl._followEnabled;

            if (_tiltActive) {
                _targetPitch = 45;
                if (isFollowingAircraft) {
                    // Tilt while keeping the tracked aircraft centred
                    const f = _getTrackedFeature();
                    map.easeTo({ pitch: 45, ...(f ? { center: f.geometry.coordinates } : {}), duration: 600 });
                } else {
                    map.easeTo({ pitch: 45, duration: 400 });
                }
            } else {
                _targetPitch = 0;
                if (isFollowingAircraft) {
                    // Return to flat while keeping the tracked aircraft centred
                    const f = _getTrackedFeature();
                    map.easeTo({ pitch: 0, bearing: 0, zoom: 14, ...(f ? { center: f.geometry.coordinates } : {}), duration: 600 });
                } else {
                    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
                }
            }
        },
        true);

    overlayGroup.appendChild(tiltBtn);

    /** Helper: find the GeoJSON feature for the currently tracked aircraft (if any). */
    function _getTrackedFeature() {
        const hex = adsbControl && adsbControl._tagHex;
        if (!hex || !adsbControl._geojson) return null;
        return adsbControl._geojson.features.find(f => f.properties.hex === hex) || null;
    }

    // ---- 3D state — exposed as window globals so other controls can read them ----
    let _targetPitch       = _tiltActive ? 45 : 0;
    window._is3DActive     = () => _tiltActive;
    window._getTargetPitch = () => _targetPitch;
    window._setTargetPitch = (p) => { _targetPitch = p; };

    /**
     * Programmatically set the 3D active state.
     * Called by adsb.js when auto-enabling 3D on aircraft follow.
     * @param {boolean} active     New 3D state
     * @param {boolean} applyPitch If true, animate the map pitch to match the new state
     */
    window._set3DActive = function (active, applyPitch) {
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

    // AIRPORTS — civil airport markers and frequency panels
    const cvlBtn = makeOverlayBtn('CVL', '8px', 'AIRPORTS',
        () => airportsControl ? airportsControl.visible : false,
        () => { if (airportsControl) airportsControl.toggle(); });
    cvlBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(cvlBtn);

    // MILITARY BASES — RAF/USAF base markers
    const milBtn = makeOverlayBtn('MIL', '8px', 'MILITARY BASES',
        () => rafControl ? rafControl.visible : false,
        () => { if (rafControl) rafControl.toggle(); });
    milBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(milBtn);

    // LOCATIONS — city/town name labels
    const citiesBtn = makeOverlayBtn('N', '14px', 'LOCATIONS',
        () => namesControl ? namesControl.namesVisible : false,
        () => { if (namesControl) namesControl.toggleNames(); });
    citiesBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(citiesBtn);

    // ROADS — road network lines and labels
    const roadsBtn = makeOverlayBtn('R', '14px', 'ROADS',
        () => roadsControl ? roadsControl.roadsVisible : false,
        () => { if (roadsControl) roadsControl.toggleRoads(); });
    roadsBtn.classList.add('sm-expanded-only');
    overlayGroup.appendChild(roadsBtn);

    panel.appendChild(overlayGroup);


    // ---- Hide all layers button ----
    const clearGroup = makeGroup();
    clearGroup.appendChild(makeOverlayBtn('✕', '14px', 'HIDE LAYERS',
        () => clearControl ? clearControl.cleared : false,
        () => { if (clearControl) clearControl.toggle(); }));
    panel.appendChild(clearGroup);


    // ---- Filter button ----
    const FILTER_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="3.5" x2="14" y2="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="3.5" y1="7.5" x2="11.5" y2="7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="6" y1="11.5" x2="9" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const filterGroup = makeGroup();
    const filterBtn   = document.createElement('button');
    filterBtn.className       = 'sm-btn enabled';
    filterBtn.dataset.tooltip = 'FILTER';
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
        if (typeof _FilterPanel !== 'undefined') _FilterPanel.toggle();
    });
    filterGroup.appendChild(filterBtn);
    panel.appendChild(filterGroup);

    /** No-op kept for API call sites. Future: highlight when a filter is active. */
    function syncFilterBtn() {}
    syncFilterBtn();

    // Expose callback so adsb.js can trigger a side-menu sync after ADS-B state changes
    _syncSideMenuForPlanes = function () { syncLabelsBtn(); syncFilterBtn(); };

    document.body.appendChild(panel);


    // ---- 3D controls widget (fixed bottom-right) ----
    // A 3×3 grid: tilt up/down, rotate left/right/reset.
    const ctrl3d = document.createElement('div');
    ctrl3d.id            = 'map-3d-controls';
    ctrl3d.style.display = 'none'; // hidden until 3D mode is enabled

    /**
     * Create a single button in the 3D controls grid.
     * @param {string}   icon     Button label character
     * @param {string}   title    Tooltip
     * @param {function} onClick
     * @returns {HTMLButtonElement}
     */
    function make3dBtn(icon, title, onClick) {
        const btn = document.createElement('button');
        btn.className        = 'map-3d-btn';
        btn.dataset.tooltip  = title;
        btn.textContent      = icon;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // Grid layout (3×3):
    //  [empty]  [↑ tilt up]  [empty]
    //  [↺ left] [⌖ reset]    [↻ right]
    //  [empty]  [↓ tilt down][empty]
    ctrl3d.appendChild(document.createElement('span')); // top-left placeholder
    ctrl3d.appendChild(make3dBtn('↑', 'TILT UP', () => {
        const p = Math.min(map.getPitch() + 10, 85);
        if (typeof window._setTargetPitch === 'function') window._setTargetPitch(p);
        map.easeTo({ pitch: p, duration: 300 });
    }));
    ctrl3d.appendChild(document.createElement('span')); // top-right placeholder

    ctrl3d.appendChild(make3dBtn('↺', 'ROTATE LEFT',  () => map.easeTo({ bearing: map.getBearing() - 15, duration: 300 })));
    ctrl3d.appendChild(make3dBtn('⌖', 'RESET BEARING', () => map.easeTo({ bearing: 0, duration: 400 })));
    ctrl3d.appendChild(make3dBtn('↻', 'ROTATE RIGHT', () => map.easeTo({ bearing: map.getBearing() + 15, duration: 300 })));

    ctrl3d.appendChild(document.createElement('span')); // bottom-left placeholder
    ctrl3d.appendChild(make3dBtn('↓', 'TILT DOWN', () => {
        const p = Math.max(map.getPitch() - 10, 0);
        if (typeof window._setTargetPitch === 'function') window._setTargetPitch(p);
        map.easeTo({ pitch: p, duration: 300 });
    }));
    ctrl3d.appendChild(document.createElement('span')); // bottom-right placeholder

    document.body.appendChild(ctrl3d);

    // Restore 3D widget visibility immediately (pitch is applied after map load in boot.js)
    if (_tiltActive) ctrl3d.style.display = 'grid';

})();
