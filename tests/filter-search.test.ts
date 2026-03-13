/**
 * tests/filter-search.test.ts
 *
 * Tests for the search/filter helper functions extracted from
 * frontend/components/air/air-filter/air-filter.ts.
 *
 * The original file is an IIFE that builds DOM and wires up live global
 * state at evaluation time, so the pure helpers are re-implemented here
 * verbatim.  Any change to the originals must be reflected here.
 *
 * Covered helpers:
 *   _matchesQuery   — case-insensitive substring match across a set of fields
 *   _search (logic) — search across plane/airport/military results using _matchesQuery
 */

// ─── Re-implementations ───────────────────────────────────────────────────────

/**
 * Returns true when any of the provided field strings contains the query as a
 * case-insensitive substring.  Falsy/undefined fields are silently skipped.
 */
function _matchesQuery(query: string, ...fieldsToSearch: (string | undefined)[]): boolean {
    const lowercaseQuery = query.toLowerCase();
    return fieldsToSearch.some(
        field => field !== undefined && field !== '' && field.toLowerCase().includes(lowercaseQuery),
    );
}

// ─── Minimal type stubs for the search result union ──────────────────────────

interface PlaneResult {
    kind:      'plane';
    callsign:  string;
    hex:       string;
    reg:       string;
    squawk:    string;
    emergency: boolean;
}

interface AirportResult {
    kind: 'airport';
    name: string;
    icao: string;
    iata: string;
}

interface MilResult {
    kind: 'mil';
    name: string;
    icao: string;
}

type SearchResult = PlaneResult | AirportResult | MilResult;

/**
 * Perform the filter-panel search over a pre-built in-memory dataset.
 * This mirrors the logic in air-filter.ts _search() without touching any DOM
 * or global state.
 */
function searchInMemory(
    query:          string,
    planes:         PlaneResult[],
    airports:       AirportResult[],
    militaryBases:  MilResult[],
): SearchResult[] {
    const trimmedQuery = query.trim();
    const results: SearchResult[] = [];

    if (!trimmedQuery) return results;

    // Aircraft: match callsign, ICAO hex, registration, or squawk code
    for (const plane of planes) {
        if (_matchesQuery(trimmedQuery, plane.callsign, plane.hex, plane.reg, plane.squawk)) {
            results.push(plane);
        }
    }

    // Airports: match ICAO, IATA, or full name
    for (const airport of airports) {
        if (_matchesQuery(trimmedQuery, airport.icao, airport.iata, airport.name)) {
            results.push(airport);
        }
    }

    // Military bases: match ICAO or name
    for (const base of militaryBases) {
        if (_matchesQuery(trimmedQuery, base.icao, base.name)) {
            results.push(base);
        }
    }

    return results;
}

// ─── Sample datasets used across tests ───────────────────────────────────────

const samplePlanes: PlaneResult[] = [
    { kind: 'plane', callsign: 'BAW123',  hex: 'a1b2c3', reg: 'G-ABCD', squawk: '1234', emergency: false },
    { kind: 'plane', callsign: 'RYR456',  hex: 'd4e5f6', reg: 'EI-XYZ', squawk: '7700', emergency: true  },
    { kind: 'plane', callsign: 'EZY789',  hex: '111222', reg: 'G-EZXY', squawk: '4444', emergency: false },
    { kind: 'plane', callsign: '',         hex: 'deadbe', reg: 'G-UNKN', squawk: '0000', emergency: false },
];

const sampleAirports: AirportResult[] = [
    { kind: 'airport', name: 'London Heathrow Airport', icao: 'EGLL', iata: 'LHR' },
    { kind: 'airport', name: 'Manchester Airport',       icao: 'EGCC', iata: 'MAN' },
    { kind: 'airport', name: 'Edinburgh Airport',        icao: 'EGPH', iata: 'EDI' },
];

const sampleMilitaryBases: MilResult[] = [
    { kind: 'mil', name: 'RAF Lossiemouth', icao: 'EGQS' },
    { kind: 'mil', name: 'RAF Brize Norton', icao: 'EGVN' },
];

// ─── Tests: _matchesQuery ─────────────────────────────────────────────────────

describe('_matchesQuery — case-insensitive substring match across fields', () => {
    test('returns true when the query exactly matches one field (case-sensitive input)', () => {
        expect(_matchesQuery('BAW123', 'BAW123', 'other')).toBe(true);
    });

    test('returns true when the query is a substring of a field', () => {
        // "BAW" is a prefix substring of "BAW123"
        expect(_matchesQuery('BAW', 'BAW123')).toBe(true);
    });

    test('returns true for a case-insensitive match (lowercase query vs uppercase field)', () => {
        expect(_matchesQuery('baw123', 'BAW123')).toBe(true);
    });

    test('returns true for a case-insensitive match (uppercase query vs lowercase field)', () => {
        expect(_matchesQuery('HEATHROW', 'London Heathrow Airport')).toBe(true);
    });

    test('returns true when the match is on the second field', () => {
        expect(_matchesQuery('EGLL', 'London Heathrow', 'EGLL')).toBe(true);
    });

    test('returns true when the match is on the third field', () => {
        expect(_matchesQuery('LHR', 'London Heathrow', 'EGLL', 'LHR')).toBe(true);
    });

    test('returns false when no field contains the query as a substring', () => {
        expect(_matchesQuery('ZZZZZ', 'BAW123', 'EGLL', 'LHR')).toBe(false);
    });

    test('returns false when called with zero fields after the query', () => {
        expect(_matchesQuery('anything')).toBe(false);
    });

    test('treats undefined fields as non-matching (does not throw)', () => {
        expect(_matchesQuery('test', undefined, 'testvalue')).toBe(true);
        expect(_matchesQuery('test', undefined, undefined)).toBe(false);
    });

    test('returns false for an empty string field', () => {
        expect(_matchesQuery('test', '')).toBe(false);
    });

    test('matches a squawk code as an exact numeric string', () => {
        expect(_matchesQuery('7700', '7700')).toBe(true);
    });

    test('partial squawk code match (first two digits of 7700)', () => {
        expect(_matchesQuery('77', '7700')).toBe(true);
    });

    test('does not match when query is longer than the field', () => {
        expect(_matchesQuery('EGLLEXTRA', 'EGLL')).toBe(false);
    });

    test('handles multi-word query matching a substring of a field', () => {
        expect(_matchesQuery('heathrow airport', 'London Heathrow Airport')).toBe(true);
    });
});

// ─── Tests: searchInMemory (mirrors air-filter.ts _search logic) ──────────────

describe('searchInMemory — in-memory search across planes, airports, and military bases', () => {
    test('returns an empty array when the query is an empty string', () => {
        const results = searchInMemory('', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toEqual([]);
    });

    test('returns an empty array when the query is whitespace only', () => {
        const results = searchInMemory('   ', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toEqual([]);
    });

    test('returns an empty array when there are no matches in any category', () => {
        const results = searchInMemory('ZZZZZZ', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toEqual([]);
    });

    // ---- Plane searches ----

    test('finds an aircraft by its exact callsign', () => {
        const results = searchInMemory('BAW123', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect(results[0].kind).toBe('plane');
        expect((results[0] as PlaneResult).callsign).toBe('BAW123');
    });

    test('finds an aircraft by a partial callsign prefix (case-insensitive)', () => {
        const results = searchInMemory('ryr', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as PlaneResult).callsign).toBe('RYR456');
    });

    test('finds an aircraft by its ICAO hex code', () => {
        const results = searchInMemory('a1b2c3', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as PlaneResult).hex).toBe('a1b2c3');
    });

    test('finds an aircraft by its registration mark', () => {
        const results = searchInMemory('G-ABCD', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as PlaneResult).reg).toBe('G-ABCD');
    });

    test('finds an aircraft by its squawk code', () => {
        const results = searchInMemory('7700', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as PlaneResult).squawk).toBe('7700');
    });

    test('prefix "G-" matches multiple aircraft whose registration starts with G-', () => {
        // BAW123 has G-ABCD and EZY789 has G-EZXY — both start with "G-"
        const results = searchInMemory('G-', samplePlanes, sampleAirports, sampleMilitaryBases);
        const planeResults = results.filter(r => r.kind === 'plane');
        expect(planeResults.length).toBeGreaterThanOrEqual(2);
    });

    // ---- Airport searches ----

    test('finds an airport by its ICAO code (exact)', () => {
        const results = searchInMemory('EGLL', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect(results[0].kind).toBe('airport');
        expect((results[0] as AirportResult).icao).toBe('EGLL');
    });

    test('finds an airport by its IATA code (case-insensitive)', () => {
        const results = searchInMemory('lhr', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as AirportResult).iata).toBe('LHR');
    });

    test('finds an airport by a substring of its full name', () => {
        const results = searchInMemory('Manchester', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as AirportResult).name).toContain('Manchester');
    });

    test('partial name "Airport" matches all airports whose name contains the word Airport', () => {
        const results = searchInMemory('Airport', samplePlanes, sampleAirports, sampleMilitaryBases);
        const airportResults = results.filter(r => r.kind === 'airport');
        // "London Heathrow Airport" and "Manchester Airport" and "Edinburgh Airport" all match
        expect(airportResults.length).toBe(3);
    });

    // ---- Military base searches ----

    test('finds a military base by its ICAO code', () => {
        const results = searchInMemory('EGQS', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect(results[0].kind).toBe('mil');
        expect((results[0] as MilResult).icao).toBe('EGQS');
    });

    test('finds a military base by a partial name substring', () => {
        const results = searchInMemory('Lossiemouth', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(results).toHaveLength(1);
        expect((results[0] as MilResult).name).toContain('Lossiemouth');
    });

    test('prefix "RAF" matches all RAF bases in the dataset', () => {
        const results = searchInMemory('RAF', samplePlanes, sampleAirports, sampleMilitaryBases);
        const milResults = results.filter(r => r.kind === 'mil');
        expect(milResults.length).toBe(sampleMilitaryBases.length);
    });

    // ---- Cross-category searches ----

    test('a query that matches both a plane hex and an airport ICAO returns results from both', () => {
        // Insert a plane whose hex happens to share a substring with an airport ICAO
        const overlappingPlane: PlaneResult = {
            kind: 'plane', callsign: 'TEST', hex: 'egllxx',
            reg: 'G-TEST', squawk: '1111', emergency: false,
        };
        const results = searchInMemory(
            'egll',
            [overlappingPlane],
            sampleAirports,
            [],
        );
        const planeMatches   = results.filter(r => r.kind === 'plane');
        const airportMatches = results.filter(r => r.kind === 'airport');
        expect(planeMatches.length).toBeGreaterThanOrEqual(1);
        expect(airportMatches.length).toBeGreaterThanOrEqual(1);
    });

    test('returns results in the order: planes first, then airports, then military bases', () => {
        // Query "EG" matches: plane hex "deadbe" — no; airports EGLL/EGCC/EGPH — yes; bases EGQS/EGVN — yes
        const results = searchInMemory('EG', samplePlanes, sampleAirports, sampleMilitaryBases);
        // All results that are airports should appear before all results that are mil
        const firstMilIndex     = results.findIndex(r => r.kind === 'mil');
        const lastAirportIndex  = results.map(r => r.kind).lastIndexOf('airport');
        if (firstMilIndex !== -1 && lastAirportIndex !== -1) {
            expect(lastAirportIndex).toBeLessThan(firstMilIndex);
        }
    });

    test('query trimming: leading and trailing whitespace is stripped before matching', () => {
        const resultsWithWhitespace  = searchInMemory('  EGLL  ', samplePlanes, sampleAirports, sampleMilitaryBases);
        const resultsWithoutWhitespace = searchInMemory('EGLL',    samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(resultsWithWhitespace).toEqual(resultsWithoutWhitespace);
    });

    test('aircraft with an empty callsign are matched only when the hex, reg, or squawk matches', () => {
        // The fourth plane has callsign '' but hex 'deadbe', reg 'G-UNKN', squawk '0000'
        const resultsForHex    = searchInMemory('deadbe', samplePlanes, sampleAirports, sampleMilitaryBases);
        const hexMatches       = resultsForHex.filter(r => r.kind === 'plane');
        expect(hexMatches.length).toBe(1);

        // Searching for an empty string should not match the empty-callsign plane
        const resultsForEmpty  = searchInMemory('', samplePlanes, sampleAirports, sampleMilitaryBases);
        expect(resultsForEmpty).toHaveLength(0);
    });
});
