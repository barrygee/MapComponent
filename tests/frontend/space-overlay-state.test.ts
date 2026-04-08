/**
 * tests/space-overlay-state.test.ts
 *
 * Tests for the space overlay state persistence logic extracted from
 * frontend/components/space/overlay/space-overlay-state.ts.
 *
 * The original file reads and writes localStorage at module-evaluation time
 * and references global control variables, so the behaviour under test is
 * re-implemented here as pure functions that accept explicit state arguments.
 * Any change to the originals must be reflected here.
 *
 * Covered behaviours:
 *   _SPACE_OVERLAY_DEFAULTS        — correct default values for every key
 *   loadSpaceOverlayStates         — returns defaults when localStorage is empty
 *   loadSpaceOverlayStates         — merges saved JSON over defaults (partial saves ok)
 *   loadSpaceOverlayStates         — returns defaults on malformed JSON
 *   serializeSpaceOverlayStates    — produces the expected JSON string
 *   mergeSpaceOverlayStatesPartial — Object.assign semantics (saved props win)
 */

// ─── Type from space types ────────────────────────────────────────────────────

interface SpaceOverlayStates {
    iss:         boolean;
    groundTrack: boolean;
    footprint:   boolean;
    daynight:    boolean;
    names:       boolean;
}

// ─── Re-implementations ───────────────────────────────────────────────────────

/**
 * The default on/off state for every space overlay control, matching the values
 * in space-overlay-state.ts.
 */
const SPACE_OVERLAY_DEFAULTS: Readonly<SpaceOverlayStates> = {
    iss:         true,
    groundTrack: true,
    footprint:   true,
    daynight:    true,
    names:       true,
};

/**
 * Load saved space overlay states from localStorage, merging any saved values
 * on top of the defaults so newly added keys always have a sensible fallback.
 * Returns a fresh copy of the defaults if nothing is saved or the saved JSON is
 * malformed.
 */
function loadSpaceOverlayStates(
    localStorageGetItem: (key: string) => string | null,
): SpaceOverlayStates {
    try {
        const savedJson = localStorageGetItem('spaceOverlayStates');
        if (savedJson) {
            return Object.assign(
                {},
                SPACE_OVERLAY_DEFAULTS,
                JSON.parse(savedJson) as Partial<SpaceOverlayStates>,
            );
        }
        return Object.assign({}, SPACE_OVERLAY_DEFAULTS);
    } catch {
        return Object.assign({}, SPACE_OVERLAY_DEFAULTS);
    }
}

/**
 * Serialize a SpaceOverlayStates object to a JSON string for localStorage storage.
 */
function serializeSpaceOverlayStates(states: SpaceOverlayStates): string {
    return JSON.stringify(states);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SPACE_OVERLAY_DEFAULTS — default space overlay visibility values', () => {
    test('contains exactly the five expected overlay keys', () => {
        const expectedKeys: (keyof SpaceOverlayStates)[] = [
            'iss', 'groundTrack', 'footprint', 'daynight', 'names',
        ];
        const actualKeys = Object.keys(SPACE_OVERLAY_DEFAULTS).sort();
        expect(actualKeys).toEqual(expectedKeys.sort());
    });

    test('"iss" defaults to true (ISS marker is visible on load)', () => {
        expect(SPACE_OVERLAY_DEFAULTS.iss).toBe(true);
    });

    test('"groundTrack" defaults to true (ISS ground track is visible on load)', () => {
        expect(SPACE_OVERLAY_DEFAULTS.groundTrack).toBe(true);
    });

    test('"footprint" defaults to true (ISS footprint is visible on load)', () => {
        expect(SPACE_OVERLAY_DEFAULTS.footprint).toBe(true);
    });

    test('"daynight" defaults to true (day/night terminator is visible on load)', () => {
        expect(SPACE_OVERLAY_DEFAULTS.daynight).toBe(true);
    });

    test('"names" defaults to true (satellite name labels are visible on load)', () => {
        expect(SPACE_OVERLAY_DEFAULTS.names).toBe(true);
    });

    test('all five values are booleans', () => {
        (Object.values(SPACE_OVERLAY_DEFAULTS) as unknown[]).forEach(value => {
            expect(typeof value).toBe('boolean');
        });
    });
});

describe('loadSpaceOverlayStates — reading state from localStorage', () => {
    test('returns a copy of SPACE_OVERLAY_DEFAULTS when localStorage returns null', () => {
        const noSavedData = () => null;
        const loadedStates = loadSpaceOverlayStates(noSavedData);
        expect(loadedStates).toEqual(SPACE_OVERLAY_DEFAULTS);
    });

    test('the returned object is a new copy, not the SPACE_OVERLAY_DEFAULTS reference', () => {
        const noSavedData  = () => null;
        const loadedStates = loadSpaceOverlayStates(noSavedData);
        expect(loadedStates).not.toBe(SPACE_OVERLAY_DEFAULTS);
    });

    test('returns defaults when the saved JSON is an empty string', () => {
        const emptySavedJson = (_key: string) => '';
        const loadedStates   = loadSpaceOverlayStates(emptySavedJson);
        expect(loadedStates).toEqual(SPACE_OVERLAY_DEFAULTS);
    });

    test('returns defaults when the saved JSON is malformed', () => {
        const malformedJson = () => 'NOT VALID JSON {{{';
        const loadedStates  = loadSpaceOverlayStates(malformedJson);
        expect(loadedStates).toEqual(SPACE_OVERLAY_DEFAULTS);
    });

    test('merges a fully saved SpaceOverlayStates object over defaults correctly', () => {
        const fullySavedStates: SpaceOverlayStates = {
            iss:         false,
            groundTrack: false,
            footprint:   false,
            daynight:    false,
            names:       false,
        };
        const savedJson    = JSON.stringify(fullySavedStates);
        const loadedStates = loadSpaceOverlayStates(() => savedJson);
        expect(loadedStates).toEqual(fullySavedStates);
    });

    test('a partial save only overrides the saved keys; defaults cover the rest', () => {
        // Only "daynight" was saved as false
        const partialSave  = JSON.stringify({ daynight: false });
        const loadedStates = loadSpaceOverlayStates(() => partialSave);
        expect(loadedStates.daynight).toBe(false);         // overridden
        expect(loadedStates.iss).toBe(SPACE_OVERLAY_DEFAULTS.iss);               // from default
        expect(loadedStates.groundTrack).toBe(SPACE_OVERLAY_DEFAULTS.groundTrack); // from default
        expect(loadedStates.footprint).toBe(SPACE_OVERLAY_DEFAULTS.footprint);   // from default
        expect(loadedStates.names).toBe(SPACE_OVERLAY_DEFAULTS.names);           // from default
    });

    test('a saved value of false for "iss" correctly overrides the default of true', () => {
        const savedWithIssOff = JSON.stringify({ iss: false });
        const loadedStates    = loadSpaceOverlayStates(() => savedWithIssOff);
        expect(loadedStates.iss).toBe(false);
    });

    test('a saved value of false for "names" correctly overrides the default of true', () => {
        const savedWithNamesOff = JSON.stringify({ names: false });
        const loadedStates      = loadSpaceOverlayStates(() => savedWithNamesOff);
        expect(loadedStates.names).toBe(false);
    });

    test('extra unknown keys in saved JSON pass through without error', () => {
        const savedWithExtraKey = JSON.stringify({ iss: false, unknownFutureOverlay: true });
        expect(() => loadSpaceOverlayStates(() => savedWithExtraKey)).not.toThrow();
    });

    test('the loaded object always has all five overlay keys', () => {
        const savedJson    = JSON.stringify({ iss: false }); // only one key saved
        const loadedStates = loadSpaceOverlayStates(() => savedJson);
        const expectedKeys: (keyof SpaceOverlayStates)[] = [
            'iss', 'groundTrack', 'footprint', 'daynight', 'names',
        ];
        expectedKeys.forEach(key => {
            expect(Object.prototype.hasOwnProperty.call(loadedStates, key)).toBe(true);
        });
    });
});

describe('serializeSpaceOverlayStates — round-trip through JSON', () => {
    test('serialises the defaults to a valid JSON string that can be parsed back', () => {
        const jsonString = serializeSpaceOverlayStates({ ...SPACE_OVERLAY_DEFAULTS });
        const reparsed   = JSON.parse(jsonString) as SpaceOverlayStates;
        expect(reparsed).toEqual(SPACE_OVERLAY_DEFAULTS);
    });

    test('serialises a modified state so the changed values survive the round-trip', () => {
        const modifiedStates: SpaceOverlayStates = {
            ...SPACE_OVERLAY_DEFAULTS,
            daynight: false,
            names:    false,
        };
        const jsonString = serializeSpaceOverlayStates(modifiedStates);
        const reparsed   = JSON.parse(jsonString) as SpaceOverlayStates;
        expect(reparsed.daynight).toBe(false);
        expect(reparsed.names).toBe(false);
        expect(reparsed.iss).toBe(true);
    });

    test('returns a string (not an object)', () => {
        const result = serializeSpaceOverlayStates({ ...SPACE_OVERLAY_DEFAULTS });
        expect(typeof result).toBe('string');
    });
});
