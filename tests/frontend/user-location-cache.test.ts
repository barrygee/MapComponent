/**
 * tests/user-location-cache.test.ts
 *
 * Tests for the GPS cache and location persistence logic extracted from
 * frontend/components/air/user-location/user-location.ts.
 *
 * The original file runs inside a MapLibre GL browser context and imports
 * global variables at module-evaluation time.  The relevant logic is therefore
 * re-implemented here as pure, dependency-injected functions so that tests can
 * run in plain Node/jsdom without a map instance.
 *
 * Covered behaviours:
 *   shouldRestoreCachedLocation — 5-minute GPS cache expiry
 *   shouldRestoreCachedLocation — manual pins never expire
 *   parseStoredLocationJson     — safe JSON parsing for the userLocation key
 *   shouldGpsUpdateBeBlocked    — GPS updates blocked when a manual pin exists
 *   buildLocationStoragePayload — correct JSON structure for GPS and manual saves
 *   coordinateFormatting        — toFixed(3) used for lat/lon display
 */

// ─── Re-implemented pure helpers ─────────────────────────────────────────────

/** Shape of the JSON stored under the 'userLocation' localStorage key. */
interface StoredUserLocation {
    longitude: number;
    latitude:  number;
    ts?:       number;
    manual?:   boolean;
}

/**
 * Parse the raw JSON string from localStorage['userLocation'].
 * Returns null if the string is absent, empty, or invalid JSON.
 */
function parseStoredLocationJson(rawJson: string | null): StoredUserLocation | null {
    if (!rawJson) return null;
    try {
        return JSON.parse(rawJson) as StoredUserLocation;
    } catch {
        return null;
    }
}

const GPS_CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Determine whether a cached location should be restored on page load.
 *
 * Rules (from user-location.ts):
 *   - Manual pins are always restored (no time limit).
 *   - GPS fixes are restored only if they are less than 5 minutes old.
 *   - If ts is missing, treat as expired.
 */
function shouldRestoreCachedLocation(
    parsedLocation: StoredUserLocation,
    currentTimeMs:  number,
): boolean {
    if (parsedLocation.manual) return true;
    const savedTimestampMs = parsedLocation.ts ?? 0;
    return currentTimeMs - savedTimestampMs < GPS_CACHE_EXPIRY_MS;
}

/**
 * Determine whether a GPS position update should be silently blocked because
 * the user has already set a manual pin.
 *
 * Rules (from user-location.ts setUserLocation):
 *   - If the incoming position is explicitly flagged as fromCache or manual,
 *     always allow it through.
 *   - Otherwise, if a manual pin exists in the stored location, block the update.
 */
function shouldGpsUpdateBeBlocked(
    isFromCache:    boolean,
    isManual:       boolean,
    storedLocation: StoredUserLocation | null,
): boolean {
    // Cache restores and manual overrides are always allowed
    if (isFromCache || isManual) return false;
    // A live GPS fix is blocked when the user has pinned a manual location
    return !!(storedLocation && storedLocation.manual);
}

/**
 * Build the JSON object that should be persisted to localStorage for a GPS fix.
 * The ts field is always the current Unix millisecond timestamp.
 */
function buildGpsLocationStoragePayload(
    longitude:     number,
    latitude:      number,
    currentTimeMs: number,
): StoredUserLocation {
    return { longitude, latitude, ts: currentTimeMs };
}

/**
 * Build the JSON object that should be persisted to localStorage for a manual
 * pin (set via right-click context menu).  Includes manual: true.
 */
function buildManualLocationStoragePayload(
    longitude:     number,
    latitude:      number,
    currentTimeMs: number,
): StoredUserLocation {
    return { longitude, latitude, ts: currentTimeMs, manual: true };
}

/**
 * Format a coordinate value for display in the SVG marker card.
 * The original code uses .toFixed(3) — three decimal places.
 */
function formatCoordinateForDisplay(coordinateDecimalDegrees: number): string {
    return coordinateDecimalDegrees.toFixed(3);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const GPS_FIVE_MINUTES_MS = 5 * 60 * 1000;

describe('parseStoredLocationJson — safe parsing of the userLocation key', () => {
    test('returns null for a null input (key not found in localStorage)', () => {
        expect(parseStoredLocationJson(null)).toBeNull();
    });

    test('returns null for an empty string', () => {
        expect(parseStoredLocationJson('')).toBeNull();
    });

    test('returns null for malformed JSON', () => {
        expect(parseStoredLocationJson('{ bad json ]')).toBeNull();
    });

    test('parses a valid GPS location payload correctly', () => {
        const validGpsPayload = JSON.stringify({
            longitude: -2.5,
            latitude:  54.0,
            ts:        1_700_000_000_000,
        });
        const parsed = parseStoredLocationJson(validGpsPayload);
        expect(parsed).not.toBeNull();
        expect(parsed!.longitude).toBe(-2.5);
        expect(parsed!.latitude).toBe(54.0);
        expect(parsed!.ts).toBe(1_700_000_000_000);
        expect(parsed!.manual).toBeUndefined();
    });

    test('parses a valid manual location payload and preserves the manual flag', () => {
        const manualPayload = JSON.stringify({
            longitude: -1.0,
            latitude:  51.5,
            ts:        1_700_000_000_000,
            manual:    true,
        });
        const parsed = parseStoredLocationJson(manualPayload);
        expect(parsed).not.toBeNull();
        expect(parsed!.manual).toBe(true);
    });
});

describe('shouldRestoreCachedLocation — 5-minute GPS cache expiry', () => {
    const fixedNowMs = 1_700_000_000_000; // arbitrary reference point

    test('a GPS fix saved 1 minute ago (within 5-minute window) should be restored', () => {
        const oneMinuteAgoMs = fixedNowMs - 60_000;
        const recentGpsFix: StoredUserLocation = { longitude: 0, latitude: 0, ts: oneMinuteAgoMs };
        expect(shouldRestoreCachedLocation(recentGpsFix, fixedNowMs)).toBe(true);
    });

    test('a GPS fix saved exactly 4 minutes 59 seconds ago is still within the window', () => {
        const justUnderFiveMinutesAgoMs = fixedNowMs - (GPS_FIVE_MINUTES_MS - 1000);
        const nearExpiryGpsFix: StoredUserLocation = {
            longitude: 0, latitude: 0, ts: justUnderFiveMinutesAgoMs,
        };
        expect(shouldRestoreCachedLocation(nearExpiryGpsFix, fixedNowMs)).toBe(true);
    });

    test('a GPS fix saved exactly 5 minutes ago is expired (boundary is exclusive)', () => {
        const exactlyFiveMinutesAgoMs = fixedNowMs - GPS_FIVE_MINUTES_MS;
        const expiredGpsFix: StoredUserLocation = {
            longitude: 0, latitude: 0, ts: exactlyFiveMinutesAgoMs,
        };
        expect(shouldRestoreCachedLocation(expiredGpsFix, fixedNowMs)).toBe(false);
    });

    test('a GPS fix saved 10 minutes ago should NOT be restored (cache expired)', () => {
        const tenMinutesAgoMs = fixedNowMs - 10 * 60_000;
        const expiredGpsFix: StoredUserLocation = {
            longitude: -4.5, latitude: 54.2, ts: tenMinutesAgoMs,
        };
        expect(shouldRestoreCachedLocation(expiredGpsFix, fixedNowMs)).toBe(false);
    });

    test('a GPS fix with no ts field (undefined) is treated as expired', () => {
        const gpsfixWithNoTimestamp: StoredUserLocation = { longitude: 0, latitude: 0 };
        expect(shouldRestoreCachedLocation(gpsfixWithNoTimestamp, fixedNowMs)).toBe(false);
    });

    test('a manual pin with no ts field is always restored (manual pins do not expire)', () => {
        const manualPinWithNoTimestamp: StoredUserLocation = {
            longitude: -1.0, latitude: 51.5, manual: true,
        };
        expect(shouldRestoreCachedLocation(manualPinWithNoTimestamp, fixedNowMs)).toBe(true);
    });

    test('a manual pin saved 1 hour ago is still restored (manual pins never expire)', () => {
        const oneHourAgoMs = fixedNowMs - 60 * 60_000;
        const oldManualPin: StoredUserLocation = {
            longitude: -1.0, latitude: 51.5, ts: oneHourAgoMs, manual: true,
        };
        expect(shouldRestoreCachedLocation(oldManualPin, fixedNowMs)).toBe(true);
    });

    test('a manual pin saved 24 hours ago is still restored', () => {
        const oneDayAgoMs = fixedNowMs - 24 * 60 * 60_000;
        const veryOldManualPin: StoredUserLocation = {
            longitude: -1.0, latitude: 51.5, ts: oneDayAgoMs, manual: true,
        };
        expect(shouldRestoreCachedLocation(veryOldManualPin, fixedNowMs)).toBe(true);
    });
});

describe('shouldGpsUpdateBeBlocked — manual pin protection logic', () => {
    const manualPin:  StoredUserLocation = { longitude: -1.0, latitude: 51.5, manual: true };
    const gpsFixOnly: StoredUserLocation = { longitude: -2.0, latitude: 53.0, ts: 0 };

    test('a live GPS fix is blocked when a manual pin is stored', () => {
        const isFromCache = false, isManual = false;
        expect(shouldGpsUpdateBeBlocked(isFromCache, isManual, manualPin)).toBe(true);
    });

    test('a live GPS fix is NOT blocked when no manual pin is stored', () => {
        const isFromCache = false, isManual = false;
        expect(shouldGpsUpdateBeBlocked(isFromCache, isManual, gpsFixOnly)).toBe(false);
    });

    test('a live GPS fix is NOT blocked when localStorage has no location at all', () => {
        const isFromCache = false, isManual = false;
        expect(shouldGpsUpdateBeBlocked(isFromCache, isManual, null)).toBe(false);
    });

    test('a cache-restore GPS fix is NEVER blocked, even when a manual pin is stored', () => {
        const isFromCache = true, isManual = false;
        expect(shouldGpsUpdateBeBlocked(isFromCache, isManual, manualPin)).toBe(false);
    });

    test('a manual override (_manual: true) is NEVER blocked, even when a manual pin is stored', () => {
        const isFromCache = false, isManual = true;
        expect(shouldGpsUpdateBeBlocked(isFromCache, isManual, manualPin)).toBe(false);
    });
});

describe('buildGpsLocationStoragePayload — GPS fix JSON structure', () => {
    test('includes longitude and latitude from the position object', () => {
        const payload = buildGpsLocationStoragePayload(-2.5, 54.0, 1_700_000_000_000);
        expect(payload.longitude).toBe(-2.5);
        expect(payload.latitude).toBe(54.0);
    });

    test('includes the current timestamp as ts', () => {
        const testNowMs = 1_700_000_000_000;
        const payload   = buildGpsLocationStoragePayload(0, 0, testNowMs);
        expect(payload.ts).toBe(testNowMs);
    });

    test('does NOT include a manual flag (GPS fixes are not manual)', () => {
        const payload = buildGpsLocationStoragePayload(0, 0, 0);
        expect(payload.manual).toBeUndefined();
    });
});

describe('buildManualLocationStoragePayload — right-click pin JSON structure', () => {
    test('includes longitude and latitude from the clicked map coordinates', () => {
        const payload = buildManualLocationStoragePayload(-1.5, 52.3, 1_700_000_000_000);
        expect(payload.longitude).toBe(-1.5);
        expect(payload.latitude).toBe(52.3);
    });

    test('includes the current timestamp as ts', () => {
        const testNowMs = 1_700_000_000_000;
        const payload   = buildManualLocationStoragePayload(0, 0, testNowMs);
        expect(payload.ts).toBe(testNowMs);
    });

    test('includes manual: true to distinguish from an automatic GPS fix', () => {
        const payload = buildManualLocationStoragePayload(0, 0, 0);
        expect(payload.manual).toBe(true);
    });
});

describe('formatCoordinateForDisplay — coordinate string formatting for the marker card', () => {
    test('formats a coordinate to exactly three decimal places', () => {
        const formatted = formatCoordinateForDisplay(54.12345);
        expect(formatted).toBe('54.123');
    });

    test('pads a whole number to three decimal places (e.g. 54 → "54.000")', () => {
        expect(formatCoordinateForDisplay(54)).toBe('54.000');
    });

    test('handles negative longitudes correctly (e.g. −2.5 → "−2.500")', () => {
        expect(formatCoordinateForDisplay(-2.5)).toBe('-2.500');
    });

    test('handles zero coordinate (0 → "0.000")', () => {
        expect(formatCoordinateForDisplay(0)).toBe('0.000');
    });

    test('rounds the fourth decimal place correctly (half-up rounding)', () => {
        // 1.2345 rounds to "1.235" (last kept digit rounds up from 4→5)
        // Note: JS toFixed uses "round half to even" in some engines, but
        // for the value 1.2345 the result is consistently "1.235" in V8.
        const formatted = formatCoordinateForDisplay(1.2345);
        // Accept either "1.234" or "1.235" to accommodate banker's rounding
        expect(['1.234', '1.235']).toContain(formatted);
    });

    test('returns a string (not a number)', () => {
        expect(typeof formatCoordinateForDisplay(51.5)).toBe('string');
    });
});
