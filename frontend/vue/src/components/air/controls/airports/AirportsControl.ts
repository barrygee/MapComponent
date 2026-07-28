import maplibregl from 'maplibre-gl'
import { SentinelControlBase } from '../sentinel-control-base/SentinelControlBase'
import type { AirStore } from '../types'

type LngLat = [number, number]

export interface AirportProperties {
  icao: string
  iata: string
  name: string
  bounds: [number, number, number, number]
  freqs: { tower: string; radar: string; approach: string; atis: string }
}

export const AIRPORTS_DATA: GeoJSON.FeatureCollection<GeoJSON.Point, AirportProperties> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        icao: 'EGLL',
        iata: 'LHR',
        name: 'Heathrow',
        bounds: [-0.505, 51.462, -0.418, 51.493],
        freqs: {
          tower: '118.500 / 118.700',
          radar: '119.725',
          approach: '119.725',
          atis: '113.750',
        },
      },
      geometry: { type: 'Point', coordinates: [-0.4614, 51.4775] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGKK',
        iata: 'LGW',
        name: 'Gatwick',
        bounds: [-0.225, 51.134, -0.156, 51.162],
        freqs: { tower: '124.225', radar: '126.825', approach: '126.825', atis: '136.525' },
      },
      geometry: { type: 'Point', coordinates: [-0.1903, 51.1481] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGGW',
        iata: 'LTN',
        name: 'Luton',
        bounds: [-0.402, 51.864, -0.334, 51.887],
        freqs: { tower: '132.550', radar: '129.550', approach: '129.550', atis: '120.575' },
      },
      geometry: { type: 'Point', coordinates: [-0.3683, 51.8747] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGSS',
        iata: 'STN',
        name: 'Stansted',
        bounds: [0.2, 51.872, 0.272, 51.898],
        freqs: { tower: '123.800', radar: '126.950', approach: '126.950', atis: '127.175' },
      },
      geometry: { type: 'Point', coordinates: [0.235, 51.885] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGCC',
        iata: 'MAN',
        name: 'Manchester',
        bounds: [-2.318, 53.344, -2.234, 53.388],
        freqs: { tower: '118.625', radar: '119.400', approach: '119.400', atis: '128.175' },
      },
      geometry: { type: 'Point', coordinates: [-2.2749, 53.365] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNT',
        iata: 'NCL',
        name: 'Newcastle',
        bounds: [-1.728, 54.997, -1.654, 55.038],
        freqs: { tower: '119.700', radar: '124.380', approach: '124.380', atis: '118.380' },
      },
      geometry: { type: 'Point', coordinates: [-1.6917, 55.0375] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGPF',
        iata: 'GLA',
        name: 'Glasgow',
        bounds: [-4.481, 55.853, -4.387, 55.892],
        freqs: { tower: '118.800', radar: '119.100', approach: '119.100', atis: '113.400' },
      },
      geometry: { type: 'Point', coordinates: [-4.433, 55.8719] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGPH',
        iata: 'EDI',
        name: 'Edinburgh',
        bounds: [-3.414, 55.929, -3.333, 55.974],
        freqs: { tower: '118.700', radar: '121.200', approach: '121.200', atis: '132.075' },
      },
      geometry: { type: 'Point', coordinates: [-3.3725, 55.9508] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGGD',
        iata: 'BRS',
        name: 'Bristol',
        bounds: [-2.762, 51.367, -2.678, 51.399],
        freqs: { tower: '133.850', radar: '125.650', approach: '125.650', atis: '127.375' },
      },
      geometry: { type: 'Point', coordinates: [-2.7191, 51.3827] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGBB',
        iata: 'BHX',
        name: 'Birmingham',
        bounds: [-1.789, 52.434, -1.71, 52.475],
        freqs: { tower: '118.300', radar: '120.500', approach: '120.500', atis: '126.025' },
      },
      geometry: { type: 'Point', coordinates: [-1.748, 52.4539] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGAC',
        iata: 'BHD',
        name: 'Belfast City',
        bounds: [-5.905, 54.602, -5.845, 54.635],
        freqs: { tower: '122.825', radar: '130.800', approach: '130.850', atis: '124.575' },
      },
      geometry: { type: 'Point', coordinates: [-5.8725, 54.6181] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGAA',
        iata: 'BFS',
        name: 'Aldergrove',
        bounds: [-6.264, 54.631, -6.172, 54.687],
        freqs: { tower: '118.300', radar: '120.900', approach: '133.125', atis: '126.130' },
      },
      geometry: { type: 'Point', coordinates: [-6.2158, 54.6575] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNV',
        iata: 'MME',
        name: 'Teesside',
        bounds: [-1.47, 54.492, -1.39, 54.528],
        freqs: { tower: '119.800', radar: '118.850', approach: '118.850', atis: '124.150' },
      },
      geometry: { type: 'Point', coordinates: [-1.4294, 54.5092] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGGP',
        iata: 'LPL',
        name: 'Liverpool',
        bounds: [-2.894, 53.31, -2.808, 53.359],
        freqs: { tower: '118.100', radar: '119.850', approach: '119.850', atis: '128.575' },
      },
      geometry: { type: 'Point', coordinates: [-2.8497, 53.3336] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNH',
        iata: 'BLK',
        name: 'Blackpool',
        bounds: [-3.062, 53.755, -3.0, 53.79],
        freqs: { tower: '118.400', radar: '135.950', approach: '135.950', atis: '121.750' },
      },
      geometry: { type: 'Point', coordinates: [-3.0286, 53.7717] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNS',
        iata: 'IOM',
        name: 'Isle of Man',
        bounds: [-4.668, 54.062, -4.585, 54.106],
        freqs: { tower: '118.900', radar: '120.850', approach: '120.850', atis: '118.525' },
      },
      geometry: { type: 'Point', coordinates: [-4.6239, 54.0833] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGPK',
        iata: 'PIK',
        name: 'Prestwick',
        bounds: [-4.632, 55.487, -4.547, 55.534],
        freqs: { tower: '118.150', radar: '120.550', approach: '120.550', atis: '127.125' },
      },
      geometry: { type: 'Point', coordinates: [-4.5869, 55.5094] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNM',
        iata: 'LBA',
        name: 'Leeds Bradford',
        bounds: [-1.699, 53.845, -1.626, 53.889],
        freqs: { tower: '120.300', radar: '134.575', approach: '134.575', atis: '118.025' },
      },
      geometry: { type: 'Point', coordinates: [-1.6606, 53.8659] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EIDW',
        iata: 'DUB',
        name: 'Dublin',
        bounds: [-6.32, 53.389, -6.221, 53.456],
        freqs: { tower: '118.600', radar: '121.100', approach: '119.550', atis: '124.525' },
      },
      geometry: { type: 'Point', coordinates: [-6.27, 53.4213] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGPD',
        iata: 'ABZ',
        name: 'Aberdeen',
        bounds: [-2.222, 57.19, -2.171, 57.217],
        freqs: { tower: '118.100', radar: '120.400', approach: '120.400', atis: '121.850' },
      },
      geometry: { type: 'Point', coordinates: [-2.1978, 57.2019] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGPE',
        iata: 'INV',
        name: 'Inverness',
        bounds: [-4.065, 57.535, -4.028, 57.544],
        freqs: { tower: '122.600', radar: '122.600', approach: '122.600', atis: '109.200' },
      },
      geometry: { type: 'Point', coordinates: [-4.0475, 57.5425] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGHI',
        iata: 'SOU',
        name: 'Southampton',
        bounds: [-1.368, 50.948, -1.349, 50.959],
        freqs: { tower: '118.200', radar: '128.850', approach: '128.850', atis: '113.350' },
      },
      geometry: { type: 'Point', coordinates: [-1.3568, 50.9503] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGHH',
        iata: 'BOH',
        name: 'Bournemouth',
        bounds: [-1.847, 50.776, -1.824, 50.782],
        freqs: { tower: '125.600', radar: '118.650', approach: '118.650', atis: '121.750' },
      },
      geometry: { type: 'Point', coordinates: [-1.8425, 50.78] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGMC',
        iata: 'SEN',
        name: 'Southend',
        bounds: [0.684, 51.566, 0.71, 51.573],
        freqs: { tower: '127.725', radar: '130.775', approach: '130.775', atis: '121.800' },
      },
      geometry: { type: 'Point', coordinates: [0.6956, 51.5714] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGSH',
        iata: 'NWI',
        name: 'Norwich',
        bounds: [1.268, 52.671, 1.285, 52.678],
        freqs: { tower: '124.250', radar: '119.350', approach: '119.350', atis: '128.625' },
      },
      geometry: { type: 'Point', coordinates: [1.2828, 52.6758] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGCN',
        iata: 'DSA',
        name: 'Doncaster',
        bounds: [-1.02, 53.475, -0.981, 53.49],
        freqs: { tower: '128.775', radar: '126.225', approach: '126.225', atis: '121.775' },
      },
      geometry: { type: 'Point', coordinates: [-1.0106, 53.4805] },
    },
    {
      type: 'Feature',
      properties: {
        icao: 'EGNJ',
        iata: 'HUY',
        name: 'Humberside',
        bounds: [-0.362, 53.572, -0.332, 53.587],
        freqs: { tower: '124.900', radar: '119.125', approach: '119.125', atis: '124.675' },
      },
      geometry: { type: 'Point', coordinates: [-0.3506, 53.5744] },
    },
  ],
}

export class AirportsToggleControl extends SentinelControlBase {
  visible: boolean
  private _markers: maplibregl.Marker[] | null = null
  private _hoverMarker: maplibregl.Marker | null = null
  private _airStore: AirStore

  constructor(airStore: AirStore) {
    super()
    this._airStore = airStore
    this.visible = airStore.overlayStates.airports
  }

  get buttonLabel(): string {
    return 'CVL'
  }
  get buttonTitle(): string {
    return 'Toggle airports'
  }

  protected onInit(): void {
    this.button.style.fontSize = '8px'
    this.setButtonActive(this.visible)
    if (this.map.isStyleLoaded()) {
      this.initLayers()
    } else {
      this.map.once('style.load', () => this.initLayers())
    }
  }

  protected handleClick(): void {
    this.toggle()
  }

  onRemove(): void {
    if (this._markers) this._markers.forEach((m) => m.remove())
    super.onRemove()
  }

  initLayers(): void {
    if (this.map.getSource('airports')) this.map.removeSource('airports')
    this.map.addSource('airports', { type: 'geojson', data: AIRPORTS_DATA })

    if (!this._markers) {
      this._hoverMarker = null

      this._markers = AIRPORTS_DATA.features.map((f) => {
        const airportProperties = f.properties
        const coords = f.geometry.coordinates as LngLat

        const el = document.createElement('div')
        el.style.cssText =
          'padding:6px 16px 6px 0;cursor:pointer;pointer-events:auto;user-select:none'

        const label = document.createElement('div')
        label.style.cssText =
          "color:#fff;font-family:'Barlow Condensed','Barlow',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1.5;white-space:nowrap;pointer-events:none"
        label.innerHTML =
          `<span class="apt-icao" style="color:#fff">${airportProperties.icao}</span>` +
          `<br><span class="apt-name" style="opacity:0.7;font-weight:400">${airportProperties.name.toUpperCase()}</span>`
        el.appendChild(label)

        // Clicking an airport opens its accordion in the side-panel SEARCH
        // list (AirFilter listens for this) — no on-map panel is shown.
        el.addEventListener('click', (e: Event) => {
          e.stopPropagation()
          document.dispatchEvent(
            new CustomEvent('air-open-airport', {
              detail: { icao: airportProperties.icao },
            }),
          )
        })

        return new maplibregl.Marker({
          element: el,
          anchor: 'top-left',
          offset: [8, -6],
        }).setLngLat(coords)
      })

      if (this.visible) this._markers.forEach((m) => m.addTo(this.map))
    }
  }

  toggle(): void {
    this.visible = !this.visible
    if (this._markers) {
      if (this.visible) {
        this._markers.forEach((m) => m.addTo(this.map))
      } else {
        this._markers.forEach((m) => m.remove())
        if (this._hoverMarker) {
          this._hoverMarker.remove()
          this._hoverMarker = null
        }
      }
    }
    this.setButtonActive(this.visible)
    this._airStore.setOverlay('airports', this.visible)
  }
}
