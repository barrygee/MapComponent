// ============================================================
// AIRPORTS TOGGLE CONTROL
// 26 UK/Ireland civil airports with HTML label markers,
// hover frequency panels, and a click-to-zoom status bar panel.
//
// Depends on:
//   map (global alias), maplibregl, _overlayStates, _saveOverlayStates,
//   _Tracking, window._is3DActive
// ============================================================

/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />
/// <reference path="../sentinel-control-base/sentinel-control-base.ts" />

const AIRPORTS_DATA: GeoJSON.FeatureCollection<GeoJSON.Point, AirportProperties> = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { icao: 'EGLL', iata: 'LHR', name: 'Heathrow',     bounds: [-0.5050, 51.4620, -0.4180, 51.4930], freqs: { tower: '118.500 / 118.700', radar: '119.725', approach: '119.725', atis: '113.750' } }, geometry: { type: 'Point', coordinates: [-0.4614, 51.4775] } },
        { type: 'Feature', properties: { icao: 'EGKK', iata: 'LGW', name: 'Gatwick',      bounds: [-0.2250, 51.1340, -0.1560, 51.1620], freqs: { tower: '124.225', radar: '126.825', approach: '126.825', atis: '136.525' } }, geometry: { type: 'Point', coordinates: [-0.1903, 51.1481] } },
        { type: 'Feature', properties: { icao: 'EGGW', iata: 'LTN', name: 'Luton',        bounds: [-0.4020, 51.8640, -0.3340, 51.8870], freqs: { tower: '132.550', radar: '129.550', approach: '129.550', atis: '120.575' } }, geometry: { type: 'Point', coordinates: [-0.3683, 51.8747] } },
        { type: 'Feature', properties: { icao: 'EGSS', iata: 'STN', name: 'Stansted',     bounds: [ 0.2000, 51.8720,  0.2720, 51.8980], freqs: { tower: '123.800', radar: '126.950', approach: '126.950', atis: '127.175' } }, geometry: { type: 'Point', coordinates: [ 0.2350, 51.8850] } },
        { type: 'Feature', properties: { icao: 'EGCC', iata: 'MAN', name: 'Manchester',   bounds: [-2.3180, 53.3440, -2.2340, 53.3880], freqs: { tower: '118.625', radar: '119.400', approach: '119.400', atis: '128.175' } }, geometry: { type: 'Point', coordinates: [-2.2749, 53.3650] } },
        { type: 'Feature', properties: { icao: 'EGNT', iata: 'NCL', name: 'Newcastle',    bounds: [-1.7280, 54.9970, -1.6540, 55.0380], freqs: { tower: '119.700', radar: '124.380', approach: '124.380', atis: '118.380' } }, geometry: { type: 'Point', coordinates: [-1.6917, 55.0375] } },
        { type: 'Feature', properties: { icao: 'EGPF', iata: 'GLA', name: 'Glasgow',      bounds: [-4.4810, 55.8530, -4.3870, 55.8920], freqs: { tower: '118.800', radar: '119.100', approach: '119.100', atis: '113.400' } }, geometry: { type: 'Point', coordinates: [-4.4330, 55.8719] } },
        { type: 'Feature', properties: { icao: 'EGPH', iata: 'EDI', name: 'Edinburgh',    bounds: [-3.4140, 55.9290, -3.3330, 55.9740], freqs: { tower: '118.700', radar: '121.200', approach: '121.200', atis: '132.075' } }, geometry: { type: 'Point', coordinates: [-3.3725, 55.9508] } },
        { type: 'Feature', properties: { icao: 'EGGD', iata: 'BRS', name: 'Bristol',      bounds: [-2.7620, 51.3670, -2.6780, 51.3990], freqs: { tower: '133.850', radar: '125.650', approach: '125.650', atis: '127.375' } }, geometry: { type: 'Point', coordinates: [-2.7191, 51.3827] } },
        { type: 'Feature', properties: { icao: 'EGBB', iata: 'BHX', name: 'Birmingham',   bounds: [-1.7890, 52.4340, -1.7100, 52.4750], freqs: { tower: '118.300', radar: '120.500', approach: '120.500', atis: '126.025' } }, geometry: { type: 'Point', coordinates: [-1.7480, 52.4539] } },
        { type: 'Feature', properties: { icao: 'EGAC', iata: 'BHD', name: 'Belfast City', bounds: [-5.9050, 54.6020, -5.8450, 54.6350], freqs: { tower: '122.825', radar: '130.800', approach: '130.850', atis: '124.575' } }, geometry: { type: 'Point', coordinates: [-5.8725, 54.6181] } },
        { type: 'Feature', properties: { icao: 'EGAA', iata: 'BFS', name: 'Aldergrove',   bounds: [-6.2640, 54.6310, -6.1720, 54.6870], freqs: { tower: '118.300', radar: '120.900', approach: '133.125', atis: '126.130' } }, geometry: { type: 'Point', coordinates: [-6.2158, 54.6575] } },
        { type: 'Feature', properties: { icao: 'EGNV', iata: 'MME', name: 'Teesside',     bounds: [-1.4700, 54.4920, -1.3900, 54.5280], freqs: { tower: '119.800', radar: '118.850', approach: '118.850', atis: '124.150' } }, geometry: { type: 'Point', coordinates: [-1.4294, 54.5092] } },
        { type: 'Feature', properties: { icao: 'EGGP', iata: 'LPL', name: 'Liverpool',    bounds: [-2.8940, 53.3100, -2.8080, 53.3590], freqs: { tower: '118.100', radar: '119.850', approach: '119.850', atis: '128.575' } }, geometry: { type: 'Point', coordinates: [-2.8497, 53.3336] } },
        { type: 'Feature', properties: { icao: 'EGNH', iata: 'BLK', name: 'Blackpool',    bounds: [-3.0620, 53.7550, -3.0000, 53.7900], freqs: { tower: '118.400', radar: '135.950', approach: '135.950', atis: '121.750' } }, geometry: { type: 'Point', coordinates: [-3.0286, 53.7717] } },
        { type: 'Feature', properties: { icao: 'EGNS', iata: 'IOM', name: 'Isle of Man',  bounds: [-4.6680, 54.0620, -4.5850, 54.1060], freqs: { tower: '118.900', radar: '120.850', approach: '120.850', atis: '118.525' } }, geometry: { type: 'Point', coordinates: [-4.6239, 54.0833] } },
        { type: 'Feature', properties: { icao: 'EGPK', iata: 'PIK', name: 'Prestwick',    bounds: [-4.6320, 55.4870, -4.5470, 55.5340], freqs: { tower: '118.150', radar: '120.550', approach: '120.550', atis: '127.125' } }, geometry: { type: 'Point', coordinates: [-4.5869, 55.5094] } },
        { type: 'Feature', properties: { icao: 'EGNM', iata: 'LBA', name: 'Leeds Bradford', bounds: [-1.6990, 53.8450, -1.6260, 53.8890], freqs: { tower: '120.300', radar: '134.575', approach: '134.575', atis: '118.025' } }, geometry: { type: 'Point', coordinates: [-1.6606, 53.8659] } },
        { type: 'Feature', properties: { icao: 'EIDW', iata: 'DUB', name: 'Dublin',        bounds: [-6.3200, 53.3890, -6.2210, 53.4560], freqs: { tower: '118.600', radar: '121.100', approach: '119.550', atis: '124.525' } }, geometry: { type: 'Point', coordinates: [-6.2700, 53.4213] } },
        { type: 'Feature', properties: { icao: 'EGPD', iata: 'ABZ', name: 'Aberdeen',      bounds: [-2.2220, 57.1900, -2.1710, 57.2170], freqs: { tower: '118.100', radar: '120.400', approach: '120.400', atis: '121.850' } }, geometry: { type: 'Point', coordinates: [-2.1978, 57.2019] } },
        { type: 'Feature', properties: { icao: 'EGPE', iata: 'INV', name: 'Inverness',     bounds: [-4.0650, 57.5350, -4.0280, 57.5440], freqs: { tower: '122.600', radar: '122.600', approach: '122.600', atis: '109.200' } }, geometry: { type: 'Point', coordinates: [-4.0475, 57.5425] } },
        { type: 'Feature', properties: { icao: 'EGHI', iata: 'SOU', name: 'Southampton',   bounds: [-1.3680, 50.9480, -1.3490, 50.9590], freqs: { tower: '118.200', radar: '128.850', approach: '128.850', atis: '113.350' } }, geometry: { type: 'Point', coordinates: [-1.3568, 50.9503] } },
        { type: 'Feature', properties: { icao: 'EGHH', iata: 'BOH', name: 'Bournemouth',   bounds: [-1.8470, 50.7760, -1.8240, 50.7820], freqs: { tower: '125.600', radar: '118.650', approach: '118.650', atis: '121.750' } }, geometry: { type: 'Point', coordinates: [-1.8425, 50.7800] } },
        { type: 'Feature', properties: { icao: 'EGMC', iata: 'SEN', name: 'Southend',      bounds: [ 0.6840,  51.5660,  0.7100,  51.5730], freqs: { tower: '127.725', radar: '130.775', approach: '130.775', atis: '121.800' } }, geometry: { type: 'Point', coordinates: [ 0.6956, 51.5714] } },
        { type: 'Feature', properties: { icao: 'EGSH', iata: 'NWI', name: 'Norwich',       bounds: [ 1.2680,  52.6710,  1.2850,  52.6780], freqs: { tower: '124.250', radar: '119.350', approach: '119.350', atis: '128.625' } }, geometry: { type: 'Point', coordinates: [ 1.2828, 52.6758] } },
        { type: 'Feature', properties: { icao: 'EGCN', iata: 'DSA', name: 'Doncaster',     bounds: [-1.0200,  53.4750, -0.9810,  53.4900], freqs: { tower: '128.775', radar: '126.225', approach: '126.225', atis: '121.775' } }, geometry: { type: 'Point', coordinates: [-1.0106, 53.4805] } },
        { type: 'Feature', properties: { icao: 'EGNJ', iata: 'HUY', name: 'Humberside',    bounds: [-0.3620,  53.5720, -0.3320,  53.5870], freqs: { tower: '124.900', radar: '119.125', approach: '119.125', atis: '124.675' } }, geometry: { type: 'Point', coordinates: [-0.3506, 53.5744] } },
    ],
};

class AirportsToggleControl extends SentinelControlBase {
    visible: boolean;
    private _markers:     maplibregl.Marker[] | null = null;
    private _hoverMarker: maplibregl.Marker | null   = null;

    constructor() {
        super();
        this.visible = _overlayStates.airports;
    }

    get buttonLabel(): string { return 'CVL'; }
    get buttonTitle(): string { return 'Toggle airports'; }

    protected onInit(): void {
        this.button.style.fontSize = '8px';
        this.setButtonActive(this.visible);
        if (this.map.isStyleLoaded()) {
            this.initLayers();
        } else {
            this.map.once('style.load', () => this.initLayers());
        }
    }

    protected handleClick(): void { this.toggle(); }

    onRemove(): void {
        if (this._markers) this._markers.forEach(m => m.remove());
        super.onRemove();
    }

    _buildFreqPanel(p: AirportProperties): string {
        const rows: [string, string][] = [
            ['TWR',  p.freqs.tower],
            ['RAD',  p.freqs.radar],
            ['APP',  p.freqs.approach],
            ['ATIS', p.freqs.atis],
        ];
        const rowsHTML = rows.map(([lbl, val]) =>
            `<div style="display:flex;gap:14px;line-height:1.8">` +
            `<span style="opacity:0.5;min-width:34px;letter-spacing:.05em">${lbl}</span>` +
            `<span>${val}</span></div>`
        ).join('');
        return `<div style="display:inline-block;background:rgba(0,0,0,0.7);color:#fff;` +
            `font-family:'Barlow Condensed','Barlow',sans-serif;font-size:14px;font-weight:400;` +
            `padding:6px 14px 9px;pointer-events:none;white-space:nowrap;user-select:none">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;` +
            `font-weight:600;font-size:15px;letter-spacing:.12em;` +
            `margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">` +
            `<span style="font-size:13px;font-weight:600;letter-spacing:.12em">${p.icao}</span>` +
            `<span style="font-size:11px;font-weight:400;opacity:0.5;letter-spacing:.08em">${p.name.toUpperCase()}</span>` +
            `</div>${rowsHTML}</div>`;
    }

    _buildAirportPanelHTML(p: AirportProperties, coords: LngLat): string {
        const lat = coords[1].toFixed(4);
        const lng = coords[0].toFixed(4);
        const fields: [string, string][] = [
            ['IATA',  p.iata           || '—'],
            ['LAT',   lat],
            ['LON',   lng],
            ['TWR',   p.freqs.tower    || '—'],
            ['RAD',   p.freqs.radar    || '—'],
            ['APP',   p.freqs.approach || '—'],
            ['ATIS',  p.freqs.atis     || '—'],
        ];
        const fieldsHTML = fields.map(([lbl, val]) =>
            `<div class="adsb-sb-field">` +
            `<span class="adsb-sb-label">${lbl}</span>` +
            `<span class="adsb-sb-value">${val}</span>` +
            `</div>`
        ).join('');
        return `<div class="adsb-sb-header">` +
            `<span class="adsb-sb-label-tag">AIRPORT</span>` +
            `<button class="adsb-sb-untrack-btn" id="apt-panel-close">CLOSE</button>` +
            `</div>` +
            `<div class="adsb-sb-header" style="border-top:none;border-bottom:1px solid rgba(255,255,255,0.08);height:auto;padding:8px 14px 9px">` +
            `<span class="adsb-sb-callsign" style="color:#ffffff">${p.icao}</span>` +
            `<span style="font-size:10px;font-weight:400;letter-spacing:0.08em;color:rgba(255,255,255,0.4)">${p.name.toUpperCase()}</span>` +
            `</div>` +
            `<div class="adsb-sb-fields">${fieldsHTML}</div>`;
    }

    _showAirportPanel(p: AirportProperties, coords: LngLat): void {
        let bar = document.getElementById('adsb-status-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'adsb-status-bar';
            const trackingPanel = document.getElementById('tracking-panel');
            if (trackingPanel) trackingPanel.appendChild(bar);
            else               document.body.appendChild(bar);
        }
        bar.dataset['apt'] = '1';
        bar.innerHTML      = this._buildAirportPanelHTML(p, coords);
        bar.classList.add('adsb-sb-visible');

        if (typeof window._Tracking !== 'undefined') { window._Tracking.setCount(1); window._Tracking.openPanel(); }

        bar.querySelector('#apt-panel-close')!.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            bar!.classList.remove('adsb-sb-visible');
            delete bar!.dataset['apt'];
            if (typeof window._Tracking !== 'undefined') { window._Tracking.setCount(0); window._Tracking.closePanel(); }
            const is3D = typeof window._is3DActive === 'function' && window._is3DActive();
            this.map.flyTo({ center: [-4.4815, 54.1453], zoom: 6, pitch: is3D ? 45 : 0, bearing: 0, duration: 800 });
        });
    }

    initLayers(): void {
        if (this.map.getSource('airports')) this.map.removeSource('airports');
        this.map.addSource('airports', { type: 'geojson', data: AIRPORTS_DATA });

        if (!this._markers) {
            this._hoverMarker = null;

            this._markers = AIRPORTS_DATA.features.map(f => {
                const p = f.properties;
                const coords = f.geometry.coordinates as LngLat;

                const el = document.createElement('div');
                el.style.cssText = 'padding:6px 16px 6px 0;cursor:pointer;pointer-events:auto;user-select:none';

                const label = document.createElement('div');
                label.style.cssText = "color:#fff;font-family:'Barlow Condensed','Barlow',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1.5;white-space:nowrap;pointer-events:none";
                label.innerHTML =
                    `<span class="apt-icao" style="color:#c8ff00">${p.icao}</span>` +
                    `<br><span class="apt-name" style="opacity:0.7;font-weight:400">${p.name.toUpperCase()}</span>`;
                el.appendChild(label);

                el.addEventListener('click', (e: Event) => {
                    e.stopPropagation();
                    const pitch = (typeof window._is3DActive === 'function' && window._is3DActive()) ? 45 : undefined;
                    const easeOpts: maplibregl.EaseToOptions = { center: coords, zoom: 13, duration: 800 };
                    if (pitch !== undefined) easeOpts.pitch = pitch;
                    this.map.easeTo(easeOpts);
                    this._showAirportPanel(p, coords);
                });

                let freqPanel: HTMLDivElement | null = null;
                el.addEventListener('mouseenter', () => {
                    if (!freqPanel) {
                        freqPanel = document.createElement('div');
                        freqPanel.innerHTML  = this._buildFreqPanel(p);
                        freqPanel.style.cssText = 'pointer-events:none;margin-top:4px';
                        el.appendChild(freqPanel);
                    }
                });
                el.addEventListener('mouseleave', () => {
                    if (freqPanel) { freqPanel.remove(); freqPanel = null; }
                });

                return new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [8, -6] })
                    .setLngLat(coords);
            });

            if (this.visible) this._markers.forEach(m => m.addTo(this.map));
        }
    }

    toggle(): void {
        this.visible = !this.visible;
        if (this._markers) {
            if (this.visible) {
                this._markers.forEach(m => m.addTo(this.map));
            } else {
                this._markers.forEach(m => m.remove());
                if (this._hoverMarker) { this._hoverMarker.remove(); this._hoverMarker = null; }
            }
        }
        this.setButtonActive(this.visible);
        _saveOverlayStates();
    }
}

airportsControl = new AirportsToggleControl();
map.addControl(airportsControl, 'top-right');
