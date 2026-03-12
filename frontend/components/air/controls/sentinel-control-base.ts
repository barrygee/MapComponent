// ============================================================
// SENTINEL CONTROL BASE
// Abstract base class for all MapLibre custom controls.
// Provides shared button creation, hover styling, and
// active/inactive state colouring (lime / dimmed white).
//
// NOT loaded in index.html — used only by subclass .ts files.
// ============================================================

/// <reference types="maplibre-gl" />
/// <reference path="../../globals.d.ts" />
/// <reference path="../../types.ts" />

abstract class SentinelControlBase implements maplibregl.IControl {
    map!:       maplibregl.Map;
    protected container!: HTMLDivElement;
    button!:    HTMLButtonElement;

    /** Text or SVG HTML content shown inside the button. */
    abstract get buttonLabel(): string;
    /** Tooltip shown on hover. */
    abstract get buttonTitle(): string;
    /**
     * Called once after the button is created and added to the container.
     * Subclasses use this to call initLayers() or apply initial visibility.
     */
    protected abstract onInit(): void;
    /** Called when the user clicks the control button. */
    protected abstract handleClick(): void;

    onAdd(mapInstance: maplibregl.Map): HTMLElement {
        this.map = mapInstance;

        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl';
        this.container.style.cssText = 'background:#000;border-radius:0;margin-top:4px';

        this.button = document.createElement('button');
        this.button.title = this.buttonTitle;
        this.button.style.cssText =
            'width:29px;height:29px;border:none;background:#000;cursor:pointer;' +
            'font-size:16px;font-weight:bold;display:flex;align-items:center;' +
            'justify-content:center;transition:opacity 0.2s,color 0.2s';

        if (this.buttonLabel.startsWith('<')) {
            this.button.innerHTML = this.buttonLabel;
        } else {
            this.button.textContent = this.buttonLabel;
        }

        this.button.addEventListener('click', () => this.handleClick());
        this.button.addEventListener('mouseover', () => { this.button.style.background = '#111'; });
        this.button.addEventListener('mouseout',  () => { this.button.style.background = '#000'; });

        this.container.appendChild(this.button);
        this.onInit();
        return this.container;
    }

    onRemove(): void {
        this.container?.parentNode?.removeChild(this.container);
        this.map = undefined!;
    }

    /**
     * Set the button's visual state.
     * Active: lime colour, full opacity.
     * Inactive: white colour, dimmed opacity.
     */
    protected setButtonActive(active: boolean): void {
        this.button.style.opacity = active ? '1'       : '0.3';
        this.button.style.color   = active ? '#c8ff00' : '#ffffff';
    }
}
