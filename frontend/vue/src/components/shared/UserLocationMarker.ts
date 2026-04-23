import maplibregl from 'maplibre-gl'

function _buildElement(cssClass: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = cssClass
    wrapper.innerHTML = `
        <svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" overflow="visible">
            <circle cx="30" cy="30" r="14"
                fill="none" stroke="#c8ff00" stroke-width="2"
                stroke-dasharray="87.96" stroke-dashoffset="87.96"
                style="animation: marker-circle-draw 0.6s ease forwards" />
            <circle cx="30" cy="30" r="4"
                fill="white"
                style="animation: marker-dot-pulse 2s ease-in-out 0.6s infinite" />
        </svg>`
    return wrapper
}

export class UserLocationMarker {
    private _marker: maplibregl.Marker | null = null
    private _map: maplibregl.Map | null = null
    private _cssClass: string

    constructor(cssClass = 'user-location-marker') {
        this._cssClass = cssClass
    }

    addTo(map: maplibregl.Map): void {
        this._map = map
    }

    update(lon: number, lat: number): void {
        if (!this._map) return
        if (!this._marker) {
            const el = _buildElement(this._cssClass)
            this._marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([lon, lat])
                .addTo(this._map)
        } else {
            this._marker.setLngLat([lon, lat])
        }
    }

    remove(): void {
        this._marker?.remove()
        this._marker = null
        this._map = null
    }
}
