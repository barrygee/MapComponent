import maplibregl from 'maplibre-gl'

export abstract class SentinelControlBase implements maplibregl.IControl {
    map!: maplibregl.Map
    protected container!: HTMLDivElement
    button!: HTMLButtonElement

    abstract get buttonLabel(): string
    abstract get buttonTitle(): string
    protected abstract onInit(): void
    protected abstract handleClick(): void
    handleClickPublic(): void { this.handleClick() }

    onAdd(mapInstance: maplibregl.Map): HTMLElement {
        this.map = mapInstance

        this.container = document.createElement('div')
        this.container.className = 'maplibregl-ctrl'
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px'

        this.button = document.createElement('button')
        this.button.title = this.buttonTitle
        this.button.style.cssText =
            'width:29px;height:29px;border:none;background:#000;cursor:pointer;' +
            'font-size:16px;font-weight:bold;display:flex;align-items:center;' +
            'justify-content:center;transition:opacity 0.2s,color 0.2s'

        if (this.buttonLabel.startsWith('<')) {
            this.button.innerHTML = this.buttonLabel
        } else {
            this.button.textContent = this.buttonLabel
        }

        this.button.addEventListener('click', () => this.handleClick())
        this.button.addEventListener('mouseover', () => { this.button.style.background = '#111' })
        this.button.addEventListener('mouseout',  () => { this.button.style.background = '#000' })

        this.container.appendChild(this.button)
        this.onInit()
        return this.container
    }

    onRemove(): void {
        this.container?.parentNode?.removeChild(this.container)
        this.map = undefined!
    }

    protected setButtonActive(active: boolean): void {
        if (!this.button) return
        this.button.style.opacity = active ? '1'       : '0.3'
        this.button.style.color   = active ? '#c8ff00' : '#ffffff'
    }
}
