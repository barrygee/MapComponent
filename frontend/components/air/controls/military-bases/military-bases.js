"use strict";
// ============================================================
// MILITARY BASES TOGGLE CONTROL
// 24 RAF/USAF bases in the UK with HTML label markers,
// hover "click to zoom" panels, and a click-to-zoom status bar panel.
//
// Depends on:
//   map (global alias), maplibregl, _overlayStates, _saveOverlayStates,
//   _Tracking, window._is3DActive
// ============================================================
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="sentinel-control-base.ts" />
const MILITARY_BASES_DATA = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { icao: 'EGUB', name: 'RAF Benson', bounds: [-1.1200, 51.6020, -1.0720, 51.6300] }, geometry: { type: 'Point', coordinates: [-1.0972, 51.6164] } },
        { type: 'Feature', properties: { icao: 'EGIZ', name: 'RAF Boulmer', bounds: [-1.6300, 55.4100, -1.5820, 55.4350] }, geometry: { type: 'Point', coordinates: [-1.6061, 55.4222] } },
        { type: 'Feature', properties: { icao: 'EGVN', name: 'RAF Brize Norton', bounds: [-1.6280, 51.7250, -1.5400, 51.7750] }, geometry: { type: 'Point', coordinates: [-1.5836, 51.7500] } },
        { type: 'Feature', properties: { icao: 'EGXC', name: 'RAF Coningsby', bounds: [-0.2100, 53.0700, -0.1200, 53.1160] }, geometry: { type: 'Point', coordinates: [-0.1664, 53.0930] } },
        { type: 'Feature', properties: { icao: 'EGSC', name: 'RAF Cosford', bounds: [-2.3300, 52.6250, -2.2800, 52.6550] }, geometry: { type: 'Point', coordinates: [-2.3056, 52.6403] } },
        { type: 'Feature', properties: { icao: 'EGYC', name: 'RAF Cranwell', bounds: [-0.5300, 53.0100, -0.4350, 53.0500] }, geometry: { type: 'Point', coordinates: [-0.4833, 53.0303] } },
        { type: 'Feature', properties: { icao: '', name: 'RAF Fylingdales', bounds: [-0.7000, 54.3450, -0.6400, 54.3750] }, geometry: { type: 'Point', coordinates: [-0.6706, 54.3606] } },
        { type: 'Feature', properties: { icao: 'EGXH', name: 'RAF Honington', bounds: [0.7400, 52.3250, 0.8050, 52.3600] }, geometry: { type: 'Point', coordinates: [0.7731, 52.3425] } },
        { type: 'Feature', properties: { icao: 'EGGE', name: 'RAF Leeming', bounds: [-1.5750, 54.2750, -1.4950, 54.3250] }, geometry: { type: 'Point', coordinates: [-1.5353, 54.2992] } },
        { type: 'Feature', properties: { icao: 'EGQL', name: 'RAF Lossiemouth', bounds: [-3.4000, 57.6800, -3.2800, 57.7300] }, geometry: { type: 'Point', coordinates: [-3.3392, 57.7053] } },
        { type: 'Feature', properties: { icao: 'EGYM', name: 'RAF Marham', bounds: [0.5100, 52.6250, 0.5900, 52.6700] }, geometry: { type: 'Point', coordinates: [0.5506, 52.6481] } },
        { type: 'Feature', properties: { icao: 'EGWU', name: 'RAF Northolt', bounds: [-0.4550, 51.5350, -0.3820, 51.5700] }, geometry: { type: 'Point', coordinates: [-0.4183, 51.5530] } },
        { type: 'Feature', properties: { icao: 'EGVO', name: 'RAF Odiham', bounds: [-1.0350, 51.2150, -0.9720, 51.2530] }, geometry: { type: 'Point', coordinates: [-1.0036, 51.2341] } },
        { type: 'Feature', properties: { icao: 'EGOS', name: 'RAF Shawbury', bounds: [-2.6950, 52.7800, -2.6350, 52.8150] }, geometry: { type: 'Point', coordinates: [-2.6650, 52.7983] } },
        { type: 'Feature', properties: { icao: 'EGOM', name: 'RAF Spadeadam', bounds: [-2.6000, 54.8750, -2.4950, 54.9250] }, geometry: { type: 'Point', coordinates: [-2.5467, 54.9003] } },
        { type: 'Feature', properties: { icao: 'EGOV', name: 'RAF Valley', bounds: [-4.5750, 53.2250, -4.4950, 53.2700] }, geometry: { type: 'Point', coordinates: [-4.5353, 53.2481] } },
        { type: 'Feature', properties: { icao: 'EGXW', name: 'RAF Waddington', bounds: [-0.5600, 53.1450, -0.4850, 53.1880] }, geometry: { type: 'Point', coordinates: [-0.5228, 53.1664] } },
        { type: 'Feature', properties: { icao: 'EGXT', name: 'RAF Wittering', bounds: [-0.5100, 52.5900, -0.4450, 52.6350] }, geometry: { type: 'Point', coordinates: [-0.4767, 52.6128] } },
        { type: 'Feature', properties: { icao: 'EGOW', name: 'RAF Woodvale', bounds: [-3.0800, 53.5650, -3.0250, 53.5980] }, geometry: { type: 'Point', coordinates: [-3.0517, 53.5811] } },
        { type: 'Feature', properties: { icao: 'EGUY', name: 'RAF Wyton', bounds: [-0.1400, 52.3400, -0.0800, 52.3750] }, geometry: { type: 'Point', coordinates: [-0.1097, 52.3572] } },
        { type: 'Feature', properties: { icao: 'EGUY', name: 'RAF Alconbury', bounds: [-0.1100, 52.3450, -0.0480, 52.3800] }, geometry: { type: 'Point', coordinates: [-0.0781, 52.3636] } },
        { type: 'Feature', properties: { icao: 'EGVA', name: 'RAF Fairford', bounds: [-1.8300, 51.6600, -1.7500, 51.7050] }, geometry: { type: 'Point', coordinates: [-1.7900, 51.6822] } },
        { type: 'Feature', properties: { icao: 'EGUL', name: 'RAF Lakenheath', bounds: [0.5250, 52.3900, 0.5950, 52.4300] }, geometry: { type: 'Point', coordinates: [0.5611, 52.4094] } },
        { type: 'Feature', properties: { icao: 'EGUN', name: 'RAF Mildenhall', bounds: [0.4550, 52.3400, 0.5180, 52.3850] }, geometry: { type: 'Point', coordinates: [0.4864, 52.3619] } },
    ],
};
class MilitaryBasesToggleControl extends SentinelControlBase {
    constructor() {
        super();
        this._markers = null;
        this.visible = _overlayStates.militaryBases;
    }
    get buttonLabel() { return 'MIL'; }
    get buttonTitle() { return 'Toggle military bases'; }
    onInit() {
        this.button.style.fontSize = '8px';
        this.setButtonActive(this.visible);
    }
    handleClick() { this.toggle(); }
    onRemove() {
        if (this._markers)
            this._markers.forEach(m => m.remove());
        super.onRemove();
    }
    _buildMilitaryBasesPanelHTML(p, coords) {
        const lat = coords[1].toFixed(4);
        const lng = coords[0].toFixed(4);
        const fields = [
            ['ICAO', p.icao || '—'],
            ['LAT', lat],
            ['LON', lng],
        ];
        const fieldsHTML = fields.map(([lbl, val]) => `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-label-tag">MIL BASE</span>` +
            `<button class="adsb-sb-untrack-btn" id="apt-panel-close">CLOSE</button>` +
            `</div>` +
            `<div class="adsb-sb-header" style="border-top:none;border-bottom:1px solid rgba(255,255,255,0.08);height:auto;padding:8px 14px 9px">` +
            `<span class="adsb-sb-callsign" style="color:#ffffff">${p.name.toUpperCase()}</span>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }
    _showMilitaryBasesPanel(p, coords) {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            const trackingPanel = document.getElementById('tracking-panel');
            if (trackingPanel)
                trackingPanel.appendChild(bar);
            else
                document.body.appendChild(bar);
        }
        bar.dataset['apt'] = '1';
        bar.innerHTML = this._buildMilitaryBasesPanelHTML(p, coords);
        bar.classList.add('adsb-sb-visible');
        if (typeof window._Tracking !== 'undefined') {
            window._Tracking.setCount(1);
            window._Tracking.openPanel();
        }
        bar.querySelector('#apt-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            bar.classList.remove('adsb-sb-visible');
            delete bar.dataset['apt'];
            if (typeof window._Tracking !== 'undefined') {
                window._Tracking.setCount(0);
                window._Tracking.closePanel();
            }
            const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
            this.map.flyTo({ center: [-4.4815, 54.1453], zoom: 6, pitch: is3D ? 45 : 0, bearing: 0, duration: 800 });
        });
    }
    initLayers() {
        if (this.map.getSource('military-bases'))
            this.map.removeSource('military-bases');
        this.map.addSource('military-bases', { type: 'geojson', data: MILITARY_BASES_DATA });
        if (!this._markers) {
            this._markers = MILITARY_BASES_DATA.features.map(f => {
                const p = f.properties;
                const coords = f.geometry.coordinates;
                const el = document.createElement('div');
                el.style.cssText = 'padding:6px 16px 6px 0;cursor:pointer;pointer-events:auto;user-select:none';
                const label = document.createElement('div');
                label.style.cssText = "color:#fff;font-family:'Barlow Condensed','Barlow',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1.5;white-space:nowrap;pointer-events:none";
                label.innerHTML = p.icao
                    ? `<span style="color:#c8ff00">${p.icao}</span><br><span style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`
                    : `<span style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`;
                el.appendChild(label);
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pitch = (typeof window._is3DActive === 'function' && window._is3DActive()) ? 45 : undefined;
                    const easeOpts = { center: coords, zoom: 16, duration: 800 };
                    if (pitch !== undefined)
                        easeOpts.pitch = pitch;
                    this.map.easeTo(easeOpts);
                    this._showMilitaryBasesPanel(p, coords);
                });
                let hintPanel = null;
                el.addEventListener('mouseenter', () => {
                    if (!hintPanel) {
                        hintPanel = document.createElement('div');
                        hintPanel.style.cssText = 'pointer-events:none;margin-top:4px';
                        hintPanel.innerHTML =
                            `<div style="display:inline-block;background:rgba(0,0,0,0.7);color:#fff;` +
                                `font-family:'Barlow Condensed','Barlow',sans-serif;font-size:12px;font-weight:400;` +
                                `padding:5px 12px 7px;white-space:nowrap;user-select:none">` +
                                `<span style="opacity:0.5;letter-spacing:.05em">CLICK TO ZOOM</span></div>`;
                        el.appendChild(hintPanel);
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (hintPanel) {
                        hintPanel.remove();
                        hintPanel = null;
                    }
                });
                return new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [8, -6] })
                    .setLngLat(coords);
            });
            if (this.visible)
                this._markers.forEach(m => m.addTo(this.map));
        }
    }
    toggle() {
        this.visible = !this.visible;
        if (this._markers) {
            if (this.visible)
                this._markers.forEach(m => m.addTo(this.map));
            else
                this._markers.forEach(m => m.remove());
        }
        this.setButtonActive(this.visible);
        _saveOverlayStates();
    }
}
militaryBasesControl = new MilitaryBasesToggleControl();
map.addControl(militaryBasesControl, 'top-right');
