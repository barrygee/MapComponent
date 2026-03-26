// ============================================================
// SPACE SIDE MENU
// Collapsible right-side overlay control panel for the space domain.
// Contains: zoom nav buttons and overlay toggles for
//           ISS, ground track, footprint, day/night, and filter.
//
// Depends on (globals): map, issControl, daynightControl,
//                        window._SpaceFilterPanel
// ============================================================

/// <reference path="../globals.d.ts" />

(function buildSpaceSideMenu() {
    function hideMapLibreCtrlContainer() {
        const ctrlTopRight = document.querySelector('.maplibregl-ctrl-top-right');
        if (!ctrlTopRight) {
            setTimeout(hideMapLibreCtrlContainer, 50);
            return;
        }
        (ctrlTopRight as HTMLElement).style.display = 'none';
    }
    hideMapLibreCtrlContainer();

    let expanded = false;
    const panel = document.createElement('div');
    panel.id = 'space-side-menu';

    function makeGroup(id: string): HTMLDivElement {
        const group = document.createElement('div');
        group.className = 'sm-group';
        group.id = id;
        return group;
    }

    // SVG icons
    const SAT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="10" width="4" height="4" fill="#c8ff00"/>
        <rect x="2" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
        <rect x="15" y="10" width="7" height="4" fill="rgba(200,255,0,0.5)"/>
        <line x1="12" y1="2" x2="12" y2="8" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
        <line x1="12" y1="16" x2="12" y2="22" stroke="rgba(200,255,0,0.5)" stroke-width="1.5"/>
    </svg>`;

    const TRACK_SVG = `<svg width="16" height="14" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 14 C6 10, 10 6, 14 6 S20 8 22 4" stroke="#ffffff" stroke-width="2" stroke-dasharray="3,2" fill="none"/>
        <path d="M2 14 C6 10, 10 6, 14 6 S20 8 22 4" stroke="#c8ff00" stroke-width="2" fill="none" stroke-dashoffset="5" stroke-dasharray="3,20"/>
    </svg>`;

    const FOOTPRINT_SVG = `<svg width="16" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="rgba(200,255,0,0.6)" stroke-width="1.5" stroke-dasharray="3,2" fill="none"/>
        <circle cx="12" cy="12" r="2" fill="#c8ff00"/>
    </svg>`;

    const MOON_SVG = `<svg width="13" height="14" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 2C10 2 5 6.5 5 12s5 10 10 10c-6 0-11-4.5-11-10S9 2 15 2z" fill="#ffffff"/>
    </svg>`;

    const LOC_SVG = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7.5" stroke="#c8ff00" stroke-width="1.8"/><circle cx="10" cy="10" r="2" fill="white"/></svg>`;

    function makeNavBtn(content: string, title: string, onClick: () => void, isHTML: boolean): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'sm-nav-btn';
        btn.title = title;
        btn.dataset['tooltip'] = title;
        if (isHTML) btn.innerHTML = content;
        else btn.textContent = content;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function makeOverlayBtn(
        icon: string,
        iconFontSize: string,
        label: string,
        getActive: () => boolean,
        doToggle: () => void,
        isHTML: boolean,
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'sm-btn';
        btn.dataset['tooltip'] = label;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'sm-icon';
        if (isHTML) iconSpan.innerHTML = icon;
        else iconSpan.textContent = icon;
        iconSpan.style.fontSize = iconFontSize;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'sm-label';
        labelSpan.textContent = label;

        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);

        function syncActiveClass() { btn.classList.toggle('active', getActive()); }
        btn.addEventListener('click', () => { doToggle(); syncActiveClass(); });
        syncActiveClass();
        return btn;
    }

    // ---- Group 1: expand / collapse toggle ----
    const toggleGroup = makeGroup('ssm-group-toggle');
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'space-side-menu-toggle';
    toggleBtn.textContent = '‹';
    toggleBtn.title = 'Expand / collapse menu';
    toggleBtn.dataset['tooltip'] = 'EXPAND MENU';
    toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        panel.classList.toggle('expanded', expanded);
        toggleBtn.textContent = expanded ? '›' : '‹';
        toggleBtn.dataset['tooltip'] = expanded ? 'COLLAPSE MENU' : 'EXPAND MENU';
    });
    toggleGroup.appendChild(toggleBtn);
    panel.appendChild(toggleGroup);

    // ---- Group 2: zoom in / zoom out / go to location ----
    const navGroup = makeGroup('ssm-group-nav');
    navGroup.appendChild(makeNavBtn('+', 'Zoom in', () => map.zoomIn(), false));
    navGroup.appendChild(makeNavBtn('−', 'Zoom out', () => map.zoomOut(), false));

    const locBtn = makeNavBtn(LOC_SVG, 'Go to my location', () => goToSpaceUserLocation(), true);
    navGroup.appendChild(locBtn);

    // Activate locBtn after flying to location; deactivate on pan/zoom-out
    _onGoToSpaceUserLocation = function () {
        locBtn.classList.add('active');
        const startZoom = map.getZoom();
        function deactivate() {
            locBtn.classList.remove('active');
            map.off('moveend', onMoveEnd);
            map.off('zoom', onZoom);
        }
        function onZoom() {
            if (map.getZoom() < startZoom - 2) deactivate();
        }
        function onMoveEnd() { deactivate(); }
        map.once('moveend', function () {
            map.on('moveend', onMoveEnd);
            map.on('zoom', onZoom);
        });
    };

    panel.appendChild(navGroup);

    // ---- Group 3: ISS + ground track + footprint ----
    const issGroup = makeGroup('ssm-group-iss');

    // ISS toggle
    const issBtn = makeOverlayBtn(SAT_SVG, '16px', 'ISS',
        () => issControl ? issControl.issVisible : false,
        () => { if (issControl) issControl.toggleIss(); _saveSpaceOverlayStates(); },
        true,
    );
    issGroup.appendChild(issBtn);

    // Ground track toggle
    const trackBtn = makeOverlayBtn(TRACK_SVG, '14px', 'GROUND TRACK',
        () => issControl ? issControl.trackVisible : false,
        () => { if (issControl) issControl.toggleTrack(); _saveSpaceOverlayStates(); },
        true,
    );
    issGroup.appendChild(trackBtn);

    // Footprint toggle
    const footprintBtn = makeOverlayBtn(FOOTPRINT_SVG, '14px', 'FOOTPRINT',
        () => issControl ? issControl.footprintVisible : false,
        () => { if (issControl) issControl.toggleFootprint(); _saveSpaceOverlayStates(); },
        true,
    );
    issGroup.appendChild(footprintBtn);

    panel.appendChild(issGroup);

    // ---- Group 4: day/night ----
    const dnGroup = makeGroup('ssm-group-daynight');
    const dnBtn = makeOverlayBtn(MOON_SVG, '14px', 'DAY / NIGHT',
        () => daynightControl ? daynightControl.dnVisible : false,
        () => { if (daynightControl) daynightControl.toggleDaynight(); _saveSpaceOverlayStates(); },
        true,
    );
    dnGroup.appendChild(dnBtn);
    panel.appendChild(dnGroup);

    // ---- Group 5: satellite filter ----
    const FILTER_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="3.5" x2="14" y2="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="3.5" y1="7.5" x2="11.5" y2="7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="6" y1="11.5" x2="9" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const filterGroup = makeGroup('ssm-group-filter');
    const filterBtn   = document.createElement('button');
    filterBtn.className          = 'sm-btn enabled';
    filterBtn.id                 = 'ssm-filter-btn';
    filterBtn.dataset['tooltip'] = 'FILTER';

    const filterIconSpan = document.createElement('span');
    filterIconSpan.className = 'sm-icon';
    filterIconSpan.innerHTML = FILTER_SVG;

    const filterLabelSpan = document.createElement('span');
    filterLabelSpan.className   = 'sm-label';
    filterLabelSpan.textContent = 'FILTER';

    filterBtn.appendChild(filterIconSpan);
    filterBtn.appendChild(filterLabelSpan);
    filterBtn.addEventListener('click', () => {
        if (window._SpaceFilterPanel) window._SpaceFilterPanel.toggle();
    });
    filterGroup.appendChild(filterBtn);
    panel.appendChild(filterGroup);

    document.body.appendChild(panel);

    // Expose sync function so controls can refresh button active states
    _spaceSyncSideMenu = function () {
        issBtn.classList.toggle('active',        issControl      ? issControl.issVisible        : false);
        trackBtn.classList.toggle('active',      issControl      ? issControl.trackVisible      : false);
        footprintBtn.classList.toggle('active',  issControl      ? issControl.footprintVisible  : false);
        dnBtn.classList.toggle('active',         daynightControl ? daynightControl.dnVisible    : false);
    };
})();
