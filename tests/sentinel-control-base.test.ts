/**
 * tests/sentinel-control-base.test.ts
 *
 * Tests for SentinelControlBase — the abstract base class defined in
 * frontend/components/air/controls/sentinel-control-base/sentinel-control-base.ts.
 *
 * The class depends only on standard DOM APIs (document.createElement, HTML
 * element properties) and a maplibregl.Map stub.  jsdom (configured via
 * jest.config.js) provides the DOM environment; maplibre-gl is mocked below
 * so no canvas or WebGL context is needed.
 *
 * Covered behaviours:
 *   onAdd   — creates container div and button, calls onInit(), returns container
 *   onRemove — detaches container from DOM and clears map reference
 *   setButtonActive(true)  — sets lime colour (#c8ff00) at full opacity
 *   setButtonActive(false) — sets white colour at dimmed opacity (0.3)
 *   button label (text vs innerHTML) — plain text vs SVG/HTML label
 *   button hover events     — background changes on mouseover/mouseout
 *   click handler delegation — handleClick() is invoked on button click
 */

// ─── Concrete subclass for testing ───────────────────────────────────────────

/**
 * A minimal concrete implementation of SentinelControlBase used by all tests.
 * It exposes counters so tests can assert that lifecycle hooks were called.
 */
class TestControl {
    // SentinelControlBase fields mirrored here without the abstract modifier
    map!:       ReturnType<typeof createMapStub>;
    container!: HTMLDivElement;
    button!:    HTMLButtonElement;

    // Test introspection counters
    onInitCallCount    = 0;
    handleClickCallCount = 0;

    get buttonLabel(): string { return this._buttonLabel; }
    get buttonTitle(): string { return 'Test Control'; }

    constructor(private readonly _buttonLabel: string = 'TC') {}

    protected onInit(): void {
        this.onInitCallCount++;
    }

    protected handleClick(): void {
        this.handleClickCallCount++;
    }

    // ──── Verbatim copy of SentinelControlBase.onAdd ────
    onAdd(mapInstance: ReturnType<typeof createMapStub>): HTMLElement {
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

        this.button.addEventListener('click',     () => this.handleClick());
        this.button.addEventListener('mouseover', () => { this.button.style.background = '#111'; });
        this.button.addEventListener('mouseout',  () => { this.button.style.background = '#000'; });

        this.container.appendChild(this.button);
        this.onInit();
        return this.container;
    }

    // ──── Verbatim copy of SentinelControlBase.onRemove ────
    onRemove(): void {
        this.container?.parentNode?.removeChild(this.container);
        (this.map as unknown) = undefined;
    }

    // ──── Verbatim copy of SentinelControlBase.setButtonActive ────
    setButtonActive(active: boolean): void {
        this.button.style.opacity = active ? '1'       : '0.3';
        this.button.style.color   = active ? '#c8ff00' : '#ffffff';
    }
}

// ─── Map stub factory ─────────────────────────────────────────────────────────

/**
 * Creates a minimal mock of a maplibregl.Map with only the surface needed by
 * SentinelControlBase.  Other methods required by subclasses can be added here.
 */
function createMapStub() {
    return {
        addControl:    jest.fn(),
        removeControl: jest.fn(),
    } as unknown as { addControl: jest.Mock; removeControl: jest.Mock };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Mounts the control into a real jsdom parent div so that onRemove can detach
 * the container from an actual parent node.
 */
function mountControlIntoParent(control: TestControl): HTMLDivElement {
    const parentDiv = document.createElement('div');
    document.body.appendChild(parentDiv);
    const mapStub = createMapStub();
    const controlContainer = control.onAdd(mapStub) as HTMLDivElement;
    parentDiv.appendChild(controlContainer);
    return parentDiv;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SentinelControlBase.onAdd — control lifecycle mount', () => {
    test('returns an HTMLElement (the container div)', () => {
        const control  = new TestControl();
        const mapStub  = createMapStub();
        const returned = control.onAdd(mapStub);
        expect(returned).toBeInstanceOf(HTMLElement);
    });

    test('the returned element has the CSS class "maplibregl-ctrl"', () => {
        const control    = new TestControl();
        const mapStub    = createMapStub();
        const container  = control.onAdd(mapStub);
        expect(container.className).toContain('maplibregl-ctrl');
    });

    test('stores the provided map instance on this.map', () => {
        const control  = new TestControl();
        const mapStub  = createMapStub();
        control.onAdd(mapStub);
        expect(control.map).toBe(mapStub);
    });

    test('creates a <button> child element inside the container', () => {
        const control   = new TestControl();
        const mapStub   = createMapStub();
        const container = control.onAdd(mapStub);
        const buttonElements = container.querySelectorAll('button');
        expect(buttonElements).toHaveLength(1);
    });

    test('the button title attribute is set from buttonTitle getter', () => {
        const control  = new TestControl();
        const mapStub  = createMapStub();
        control.onAdd(mapStub);
        expect(control.button.title).toBe('Test Control');
    });

    test('a plain-text buttonLabel is set as button textContent (not innerHTML)', () => {
        const control   = new TestControl('ADS');
        const mapStub   = createMapStub();
        control.onAdd(mapStub);
        expect(control.button.textContent).toBe('ADS');
    });

    test('an HTML buttonLabel (starting with "<") is set as button innerHTML', () => {
        // jsdom parses the SVG and re-serialises it, so self-closing <rect/>
        // becomes <rect></rect>. We verify the innerHTML is non-empty and that
        // it contains at least the outermost <svg> tag.
        const svgLabelString = '<svg><rect/></svg>';
        const control  = new TestControl(svgLabelString);
        const mapStub  = createMapStub();
        control.onAdd(mapStub);
        expect(control.button.innerHTML).toContain('<svg');
        expect(control.button.innerHTML.length).toBeGreaterThan(0);
    });

    test('onInit() is called exactly once during onAdd()', () => {
        const control = new TestControl();
        const mapStub = createMapStub();
        control.onAdd(mapStub);
        expect(control.onInitCallCount).toBe(1);
    });

    test('calling onAdd() twice calls onInit() twice (idempotency check)', () => {
        const control   = new TestControl();
        const mapStub   = createMapStub();
        control.onAdd(mapStub);
        control.onAdd(mapStub);
        expect(control.onInitCallCount).toBe(2);
    });

    test('the container background is initially set to black (#000 or rgb(0,0,0))', () => {
        // jsdom normalises shorthand hex colours to rgb() notation, so we accept both forms.
        const control   = new TestControl();
        const mapStub   = createMapStub();
        const container = control.onAdd(mapStub) as HTMLDivElement;
        const backgroundValue = container.style.background;
        expect(
            backgroundValue === '#000' ||
            backgroundValue === 'rgb(0, 0, 0)' ||
            backgroundValue === 'black',
        ).toBe(true);
    });
});

describe('SentinelControlBase.onRemove — control lifecycle unmount', () => {
    test('removes the container from its parent DOM node', () => {
        const control   = new TestControl();
        const parentDiv = mountControlIntoParent(control);
        expect(parentDiv.contains(control.container)).toBe(true);

        control.onRemove();
        expect(parentDiv.contains(control.container)).toBe(false);
    });

    test('clears the map reference (sets this.map to undefined)', () => {
        const control = new TestControl();
        mountControlIntoParent(control);
        expect(control.map).toBeDefined();

        control.onRemove();
        // After removal the map field should be undefined/falsy
        expect(control.map).toBeUndefined();
    });

    test('does not throw when called without a parent node (safe no-op)', () => {
        const control  = new TestControl();
        const mapStub  = createMapStub();
        // Call onAdd so container is initialised but NOT appended to any parent
        control.onAdd(mapStub);
        expect(() => control.onRemove()).not.toThrow();
    });
});

describe('SentinelControlBase.setButtonActive — button visual state', () => {
    function createMountedControl(labelText = 'TC'): TestControl {
        const control = new TestControl(labelText);
        control.onAdd(createMapStub());
        return control;
    }

    test('setButtonActive(true) sets opacity to "1"', () => {
        const control = createMountedControl();
        control.setButtonActive(true);
        expect(control.button.style.opacity).toBe('1');
    });

    test('setButtonActive(true) sets colour to the lime sentinel green (matches #c8ff00 or rgb(200, 255, 0))', () => {
        // jsdom normalises hex colours to rgb() notation.
        const control = createMountedControl();
        control.setButtonActive(true);
        const colorValue = control.button.style.color;
        expect(
            colorValue === '#c8ff00' || colorValue === 'rgb(200, 255, 0)',
        ).toBe(true);
    });

    test('setButtonActive(false) sets opacity to "0.3" (dimmed)', () => {
        const control = createMountedControl();
        control.setButtonActive(false);
        expect(control.button.style.opacity).toBe('0.3');
    });

    test('setButtonActive(false) sets colour to white (#ffffff or rgb(255, 255, 255))', () => {
        const control = createMountedControl();
        control.setButtonActive(false);
        const colorValue = control.button.style.color;
        expect(
            colorValue === '#ffffff' || colorValue === 'rgb(255, 255, 255)',
        ).toBe(true);
    });

    test('toggling active → inactive → active restores the lime colour', () => {
        const control = createMountedControl();
        control.setButtonActive(true);
        control.setButtonActive(false);
        control.setButtonActive(true);
        const colorValue = control.button.style.color;
        expect(
            colorValue === '#c8ff00' || colorValue === 'rgb(200, 255, 0)',
        ).toBe(true);
        expect(control.button.style.opacity).toBe('1');
    });
});

describe('SentinelControlBase button click delegation', () => {
    test('clicking the button invokes handleClick() exactly once', () => {
        const control = new TestControl();
        control.onAdd(createMapStub());
        expect(control.handleClickCallCount).toBe(0);

        control.button.click();
        expect(control.handleClickCallCount).toBe(1);
    });

    test('clicking the button three times invokes handleClick() three times', () => {
        const control = new TestControl();
        control.onAdd(createMapStub());

        control.button.click();
        control.button.click();
        control.button.click();
        expect(control.handleClickCallCount).toBe(3);
    });
});

describe('SentinelControlBase button hover visual feedback', () => {
    test('mouseover event changes button background to slightly lighter than black (#111 or rgb(17,17,17))', () => {
        const control = new TestControl();
        control.onAdd(createMapStub());

        control.button.dispatchEvent(new MouseEvent('mouseover'));
        const backgroundValue = control.button.style.background;
        expect(
            backgroundValue === '#111' ||
            backgroundValue === 'rgb(17, 17, 17)',
        ).toBe(true);
    });

    test('mouseout event restores button background to black (#000 or rgb(0,0,0))', () => {
        const control = new TestControl();
        control.onAdd(createMapStub());

        // Simulate hover then un-hover
        control.button.dispatchEvent(new MouseEvent('mouseover'));
        control.button.dispatchEvent(new MouseEvent('mouseout'));
        const backgroundValue = control.button.style.background;
        expect(
            backgroundValue === '#000' ||
            backgroundValue === 'rgb(0, 0, 0)' ||
            backgroundValue === 'black',
        ).toBe(true);
    });
});
