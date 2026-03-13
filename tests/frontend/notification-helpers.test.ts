/**
 * tests/notification-helpers.test.ts
 *
 * Tests for the pure helper functions extracted from
 * frontend/components/shared/notifications/notifications.ts.
 *
 * Because the original file immediately bootstraps DOM state and registers
 * event listeners as a side-effect of module evaluation (it is an IIFE that
 * assigns to window._Notifications), the helpers are re-implemented verbatim
 * here. Any change to the originals must be reflected here.
 *
 * Covered helpers:
 *   _formatTimestamp  — format a Unix-ms timestamp as "HH:MM LOCAL"
 *   _getLabelForType  — map a NotificationType string to its display label
 */

// ─── Re-implementations ───────────────────────────────────────────────────────

/**
 * Format a Unix-millisecond timestamp as a zero-padded "HH:MM LOCAL" string
 * using the local wall-clock time (same logic as in notifications.ts).
 */
function _formatTimestamp(timestampMs: number): string {
    const date = new Date(timestampMs);
    return (
        String(date.getHours()).padStart(2, '0') +
        ':' +
        String(date.getMinutes()).padStart(2, '0') +
        ' LOCAL'
    );
}

/**
 * Map a notification type identifier to the human-readable label shown in the
 * notification panel header.  Falls back to "NOTICE" for unknown types.
 */
function _getLabelForType(notificationType: string): string {
    if (notificationType === 'flight')     return 'LANDED';
    if (notificationType === 'departure')  return 'DEPARTED';
    if (notificationType === 'track')      return 'TRACKING';
    if (notificationType === 'tracking')   return 'NOTIFICATIONS ON';
    if (notificationType === 'notif-off')  return 'NOTIFICATIONS OFF';
    if (notificationType === 'system')     return 'SYSTEM';
    if (notificationType === 'message')    return 'MESSAGE';
    if (notificationType === 'emergency')  return '⚠ EMERGENCY';
    if (notificationType === 'squawk-clr') return 'SQUAWK CLEARED';
    return 'NOTICE';
}

// ─── Tests: _formatTimestamp ──────────────────────────────────────────────────

describe('_formatTimestamp — Unix-ms to "HH:MM LOCAL" string', () => {
    test('output always ends with the " LOCAL" suffix', () => {
        // Use an arbitrary timestamp; the suffix must always be present
        const arbitraryTimestampMs = 1_700_000_000_000;
        const formattedTime = _formatTimestamp(arbitraryTimestampMs);
        expect(formattedTime).toMatch(/ LOCAL$/);
    });

    test('output matches the pattern HH:MM LOCAL (two-digit hour, colon, two-digit minute)', () => {
        const arbitraryTimestampMs = 1_700_000_000_000;
        const formattedTime = _formatTimestamp(arbitraryTimestampMs);
        // Pattern: exactly two digits, colon, exactly two digits, space, "LOCAL"
        expect(formattedTime).toMatch(/^\d{2}:\d{2} LOCAL$/);
    });

    test('hours component is zero-padded to two digits for single-digit hours', () => {
        // Construct a Date object whose local time has a single-digit hour.
        // We freeze a specific date: 2024-01-15 at 03:07 local time.
        // Rather than hardcoding a TZ-dependent timestamp, we derive it from
        // the Date constructor so the test is timezone-agnostic.
        const dateWithSingleDigitHour = new Date(2024, 0, 15, 3, 7, 0, 0);
        const formattedTime = _formatTimestamp(dateWithSingleDigitHour.getTime());
        const hourPart = formattedTime.split(':')[0];
        expect(hourPart).toHaveLength(2);
        expect(hourPart).toBe('03');
    });

    test('minutes component is zero-padded to two digits for single-digit minutes', () => {
        const dateWithSingleDigitMinute = new Date(2024, 0, 15, 14, 5, 0, 0);
        const formattedTime = _formatTimestamp(dateWithSingleDigitMinute.getTime());
        const minutePart = formattedTime.split(':')[1].replace(' LOCAL', '');
        expect(minutePart).toHaveLength(2);
        expect(minutePart).toBe('05');
    });

    test('correctly formats midnight (00:00 LOCAL)', () => {
        // Build a Date at midnight local time
        const midnightDate = new Date(2024, 5, 1, 0, 0, 0, 0);
        const formattedTime = _formatTimestamp(midnightDate.getTime());
        expect(formattedTime).toBe('00:00 LOCAL');
    });

    test('correctly formats 23:59', () => {
        const lastMinuteOfDayDate = new Date(2024, 5, 1, 23, 59, 0, 0);
        const formattedTime = _formatTimestamp(lastMinuteOfDayDate.getTime());
        expect(formattedTime).toBe('23:59 LOCAL');
    });

    test('correctly formats an hour-on-the-hour time such as 12:00', () => {
        const noonDate = new Date(2024, 5, 1, 12, 0, 0, 0);
        const formattedTime = _formatTimestamp(noonDate.getTime());
        expect(formattedTime).toBe('12:00 LOCAL');
    });

    test('the hours and minutes parsed back from the output match the original Date object', () => {
        const testDate   = new Date(2024, 3, 20, 9, 47, 0, 0);
        const formatted  = _formatTimestamp(testDate.getTime());
        const [hourStr, rest] = formatted.split(':');
        const minuteStr  = rest.split(' ')[0];
        expect(parseInt(hourStr,   10)).toBe(testDate.getHours());
        expect(parseInt(minuteStr, 10)).toBe(testDate.getMinutes());
    });
});

// ─── Tests: _getLabelForType ──────────────────────────────────────────────────

describe('_getLabelForType — notification type to display label mapping', () => {
    test('"flight" maps to "LANDED"', () => {
        expect(_getLabelForType('flight')).toBe('LANDED');
    });

    test('"departure" maps to "DEPARTED"', () => {
        expect(_getLabelForType('departure')).toBe('DEPARTED');
    });

    test('"track" maps to "TRACKING"', () => {
        expect(_getLabelForType('track')).toBe('TRACKING');
    });

    test('"tracking" maps to "NOTIFICATIONS ON"', () => {
        expect(_getLabelForType('tracking')).toBe('NOTIFICATIONS ON');
    });

    test('"notif-off" maps to "NOTIFICATIONS OFF"', () => {
        expect(_getLabelForType('notif-off')).toBe('NOTIFICATIONS OFF');
    });

    test('"system" maps to "SYSTEM"', () => {
        expect(_getLabelForType('system')).toBe('SYSTEM');
    });

    test('"message" maps to "MESSAGE"', () => {
        expect(_getLabelForType('message')).toBe('MESSAGE');
    });

    test('"emergency" maps to "⚠ EMERGENCY" (includes warning emoji)', () => {
        const emergencyLabel = _getLabelForType('emergency');
        expect(emergencyLabel).toBe('⚠ EMERGENCY');
        expect(emergencyLabel).toContain('⚠');
    });

    test('"squawk-clr" maps to "SQUAWK CLEARED"', () => {
        expect(_getLabelForType('squawk-clr')).toBe('SQUAWK CLEARED');
    });

    test('an unknown type falls back to "NOTICE"', () => {
        expect(_getLabelForType('unknown-type')).toBe('NOTICE');
    });

    test('an empty string type falls back to "NOTICE"', () => {
        expect(_getLabelForType('')).toBe('NOTICE');
    });

    test('a partially matching string such as "sys" does NOT match "system" and returns "NOTICE"', () => {
        // The matching is exact (===), not partial
        expect(_getLabelForType('sys')).toBe('NOTICE');
    });

    test('case-sensitive: "SYSTEM" (uppercase) does NOT match "system" and returns "NOTICE"', () => {
        expect(_getLabelForType('SYSTEM')).toBe('NOTICE');
    });

    test('every defined NotificationType returns a non-empty string', () => {
        // Exhaustive check across all defined types from types.ts
        const allDefinedTypes = [
            'flight', 'departure', 'system', 'message',
            'tracking', 'track', 'notif-off', 'emergency', 'squawk-clr',
        ];
        allDefinedTypes.forEach(notificationType => {
            const label = _getLabelForType(notificationType);
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
        });
    });
});
