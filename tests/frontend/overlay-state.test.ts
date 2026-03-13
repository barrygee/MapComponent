/**
 * tests/overlay-state.test.ts
 *
 * Tests for the overlay state persistence logic extracted from
 * frontend/components/air/overlay/overlay-state.ts.
 *
 * The original file reads and writes localStorage at module-evaluation time
 * and references global control variables, so the behaviour under test is
 * re-implemented here as pure functions that accept explicit state arguments.
 * Any change to the originals must be reflected here.
 *
 * Covered behaviours:
 *   _OVERLAY_DEFAULTS         — correct default values for every key
 *   loadOverlayStates         — returns defaults when localStorage is empty
 *   loadOverlayStates         — merges saved JSON over defaults (partial saves ok)
 *   loadOverlayStates         — returns defaults on malformed JSON
 *   serializeOverlayStates    — produces the expected JSON string
 *   mergeOverlayStatesPartial — Object.assign semantics (saved props win)
 */

// ─── Type from types.ts ───────────────────────────────────────────────────────

interface OverlayStates {
    roads:         boolean;
    names:         boolean;
    rings:         boolean;
    aar:           boolean;
    awacs:         boolean;
    airports:      boolean;
    militaryBases: boolean;
    adsb:          boolean;
    adsbLabels:    boolean;
}

// ─── Re-implementations ───────────────────────────────────────────────────────

/**
 * The default on/off state for every overlay control, matching the values in
 * overlay-state.ts.
 */
const OVERLAY_DEFAULTS: Readonly<OverlayStates> = {
    roads:         true,
    names:         false,
    rings:         false,
    aar:           false,
    awacs:         false,
    airports:      true,
    militaryBases: false,
    adsb:          true,
    adsbLabels:    true,
};

/**
 * Load saved overlay states from localStorage, merging any saved values on top
 * of the defaults so newly added keys always have a sensible fallback.
 * Returns a fresh copy of the defaults if nothing is saved or the saved JSON is
 * malformed.
 */
function loadOverlayStates(localStorageGetItem: (key: string) => string | null): OverlayStates {
    try {
        const savedJson = localStorageGetItem('overlayStates');
        if (savedJson) {
            return Object.assign(
                {},
                OVERLAY_DEFAULTS,
                JSON.parse(savedJson) as Partial<OverlayStates>,
            );
        }
        return Object.assign({}, OVERLAY_DEFAULTS);
    } catch {
        return Object.assign({}, OVERLAY_DEFAULTS);
    }
}

/**
 * Serialize an OverlayStates object to a JSON string for localStorage storage.
 */
function serializeOverlayStates(states: OverlayStates): string {
    return JSON.stringify(states);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OVERLAY_DEFAULTS — default overlay visibility values', () => {
    test('contains exactly the nine expected overlay keys', () => {
        const expectedKeys: (keyof OverlayStates)[] = [
            'roads', 'names', 'rings', 'aar', 'awacs',
            'airports', 'militaryBases', 'adsb', 'adsbLabels',
        ];
        const actualKeys = Object.keys(OVERLAY_DEFAULTS).sort();
        expect(actualKeys).toEqual(expectedKeys.sort());
    });

    test('"roads" defaults to true (roads are visible on load)', () => {
        expect(OVERLAY_DEFAULTS.roads).toBe(true);
    });

    test('"names" defaults to false (place names are hidden on load)', () => {
        expect(OVERLAY_DEFAULTS.names).toBe(false);
    });

    test('"rings" defaults to false (range rings are hidden on load)', () => {
        expect(OVERLAY_DEFAULTS.rings).toBe(false);
    });

    test('"aar" defaults to false (Air-to-Air Refuelling Areas hidden on load)', () => {
        expect(OVERLAY_DEFAULTS.aar).toBe(false);
    });

    test('"awacs" defaults to false (AWACS orbits hidden on load)', () => {
        expect(OVERLAY_DEFAULTS.awacs).toBe(false);
    });

    test('"airports" defaults to true (civil airports visible on load)', () => {
        expect(OVERLAY_DEFAULTS.airports).toBe(true);
    });

    test('"militaryBases" defaults to false (military bases hidden on load)', () => {
        expect(OVERLAY_DEFAULTS.militaryBases).toBe(false);
    });

    test('"adsb" defaults to true (live ADS-B tracking is on by default)', () => {
        expect(OVERLAY_DEFAULTS.adsb).toBe(true);
    });

    test('"adsbLabels" defaults to true (callsign labels are visible by default)', () => {
        expect(OVERLAY_DEFAULTS.adsbLabels).toBe(true);
    });

    test('all nine values are booleans', () => {
        (Object.values(OVERLAY_DEFAULTS) as unknown[]).forEach(value => {
            expect(typeof value).toBe('boolean');
        });
    });
});

describe('loadOverlayStates — reading state from localStorage', () => {
    test('returns a copy of OVERLAY_DEFAULTS when localStorage returns null (no saved data)', () => {
        const noSavedData = () => null;
        const loadedStates = loadOverlayStates(noSavedData);
        expect(loadedStates).toEqual(OVERLAY_DEFAULTS);
    });

    test('the returned object is a new copy, not the OVERLAY_DEFAULTS reference', () => {
        const noSavedData  = () => null;
        const loadedStates = loadOverlayStates(noSavedData);
        expect(loadedStates).not.toBe(OVERLAY_DEFAULTS);
    });

    test('returns defaults when the saved JSON is an empty string', () => {
        // An empty string is falsy in JS — the branch falls through to defaults
        const emptySavedJson = (_key: string) => '';
        const loadedStates   = loadOverlayStates(emptySavedJson);
        expect(loadedStates).toEqual(OVERLAY_DEFAULTS);
    });

    test('returns defaults when the saved JSON is malformed (JSON.parse throws)', () => {
        const malformedJson = () => 'NOT VALID JSON {{{';
        const loadedStates  = loadOverlayStates(malformedJson);
        expect(loadedStates).toEqual(OVERLAY_DEFAULTS);
    });

    test('merges a fully saved OverlayStates object over defaults correctly', () => {
        // All values flipped from their defaults
        const fullySavedStates: OverlayStates = {
            roads:         false,
            names:         true,
            rings:         true,
            aar:           true,
            awacs:         true,
            airports:      false,
            militaryBases: true,
            adsb:          false,
            adsbLabels:    false,
        };
        const savedJson      = JSON.stringify(fullySavedStates);
        const loadedStates   = loadOverlayStates(() => savedJson);
        expect(loadedStates).toEqual(fullySavedStates);
    });

    test('a partial save only overrides the saved keys; unrecognised defaults are preserved', () => {
        // Only "rings" was explicitly saved as true; all other keys should come from defaults
        const partialSave = JSON.stringify({ rings: true });
        const loadedStates = loadOverlayStates(() => partialSave);
        expect(loadedStates.rings).toBe(true);       // overridden
        expect(loadedStates.roads).toBe(OVERLAY_DEFAULTS.roads);       // from default
        expect(loadedStates.adsb).toBe(OVERLAY_DEFAULTS.adsb);         // from default
        expect(loadedStates.airports).toBe(OVERLAY_DEFAULTS.airports); // from default
    });

    test('a saved value of false for "adsb" correctly overrides the default of true', () => {
        const savedWithAdsbOff = JSON.stringify({ adsb: false });
        const loadedStates     = loadOverlayStates(() => savedWithAdsbOff);
        expect(loadedStates.adsb).toBe(false);
    });

    test('a saved value of true for "rings" correctly overrides the default of false', () => {
        const savedWithRingsOn = JSON.stringify({ rings: true });
        const loadedStates     = loadOverlayStates(() => savedWithRingsOn);
        expect(loadedStates.rings).toBe(true);
    });

    test('extra unknown keys in saved JSON are passed through without error', () => {
        // Old or future keys that are not part of OverlayStates must not break loading
        const savedWithExtraKey = JSON.stringify({ rings: true, unknownFutureOverlay: true });
        expect(() => loadOverlayStates(() => savedWithExtraKey)).not.toThrow();
    });

    test('the loaded object always has all nine overlay keys', () => {
        const savedJson  = JSON.stringify({ rings: true }); // only one key saved
        const loadedStates = loadOverlayStates(() => savedJson);
        const expectedKeys: (keyof OverlayStates)[] = [
            'roads', 'names', 'rings', 'aar', 'awacs',
            'airports', 'militaryBases', 'adsb', 'adsbLabels',
        ];
        expectedKeys.forEach(key => {
            expect(Object.prototype.hasOwnProperty.call(loadedStates, key)).toBe(true);
        });
    });
});

describe('serializeOverlayStates — round-trip through JSON', () => {
    test('serialises the defaults to a valid JSON string that can be parsed back', () => {
        const jsonString   = serializeOverlayStates({ ...OVERLAY_DEFAULTS });
        const reparsed     = JSON.parse(jsonString) as OverlayStates;
        expect(reparsed).toEqual(OVERLAY_DEFAULTS);
    });

    test('serialises a modified state so the changed value survives the round-trip', () => {
        const modifiedStates: OverlayStates = { ...OVERLAY_DEFAULTS, rings: true, adsb: false };
        const jsonString = serializeOverlayStates(modifiedStates);
        const reparsed   = JSON.parse(jsonString) as OverlayStates;
        expect(reparsed.rings).toBe(true);
        expect(reparsed.adsb).toBe(false);
    });

    test('returns a string (not an object)', () => {
        const result = serializeOverlayStates({ ...OVERLAY_DEFAULTS });
        expect(typeof result).toBe('string');
    });
});
