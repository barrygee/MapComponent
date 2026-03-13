/**
 * tests/geometry-helpers.test.ts
 *
 * Tests for the pure geometry helper functions found in
 * frontend/components/shared/map/map.ts.
 *
 * Because these functions depend only on Math, they are extracted verbatim
 * here rather than importing the original file (which bootstraps MapLibre GL
 * and registers protocols at module-evaluation time, requiring a full browser
 * environment). Any change to the originals must be reflected here.
 *
 * Covered functions:
 *   _toRad              — degrees → radians
 *   _toDeg              — radians → degrees
 *   generateGeodesicCircle  — 181-point great-circle ring
 *   buildRingsGeoJSON       — GeoJSON FeatureCollections for 5 range rings
 *   computeCentroid         — shoelace area-weighted centroid
 *   computeTextRotate       — MapLibre text-rotate bearing for longest edge
 *   computeLongestEdge      — endpoints of polygon's longest edge
 */

// ─── Re-implementation of the pure helpers under test ─────────────────────────
// Copied verbatim from frontend/components/shared/map/map.ts so that the tests
// run in plain Node without a MapLibre / pmtiles dependency.

type LngLat = [number, number];

/** Constant array of ring distances (nautical miles) used by buildRingsGeoJSON. */
const RING_DISTANCES_NM: readonly number[] = [50, 100, 150, 200, 250];

/** Convert degrees to radians. */
function _toRad(degrees: number): number {
    return degrees * Math.PI / 180;
}

/** Convert radians to degrees. */
function _toDeg(radians: number): number {
    return radians * 180 / Math.PI;
}

/**
 * Generate 181 geodesic (great-circle) points forming a circle on the
 * Earth's surface centred at (lng, lat) with the given radius in nautical miles.
 * The Earth's radius used is 3440.065 nm (mean spherical radius).
 */
function generateGeodesicCircle(
    lng: number,
    lat: number,
    radiusNm: number,
): LngLat[] {
    const angularDistanceRad = radiusNm / 3440.065;
    const latRad = _toRad(lat);
    const lngRad = _toRad(lng);
    const points: LngLat[] = [];
    for (let i = 0; i <= 180; i++) {
        const bearingRad = _toRad(i * 2);
        const lat2 = Math.asin(
            Math.sin(latRad) * Math.cos(angularDistanceRad) +
            Math.cos(latRad) * Math.sin(angularDistanceRad) * Math.cos(bearingRad),
        );
        const lng2 =
            lngRad +
            Math.atan2(
                Math.sin(bearingRad) * Math.sin(angularDistanceRad) * Math.cos(latRad),
                Math.cos(angularDistanceRad) - Math.sin(latRad) * Math.sin(lat2),
            );
        points.push([_toDeg(lng2), _toDeg(lat2)]);
    }
    return points;
}

interface RingsGeoJSON {
    lines:  { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: LngLat[] }; properties: Record<string, unknown> }> };
    labels: { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: LngLat }; properties: { label: string } }> };
}

/**
 * Build GeoJSON FeatureCollections for all 5 range rings (50–250 nm) plus
 * north-point labels for each ring.
 */
function buildRingsGeoJSON(lng: number, lat: number): RingsGeoJSON {
    const lines:  RingsGeoJSON['lines']  = { type: 'FeatureCollection', features: [] };
    const labels: RingsGeoJSON['labels'] = { type: 'FeatureCollection', features: [] };
    const latR = _toRad(lat);
    const lngR = _toRad(lng);

    RING_DISTANCES_NM.forEach(nm => {
        const angularDistanceRad = nm / 3440.065;

        lines.features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: generateGeodesicCircle(lng, lat, nm) },
            properties: {},
        });

        const lat2 = Math.asin(
            Math.sin(latR) * Math.cos(angularDistanceRad) +
            Math.cos(latR) * Math.sin(angularDistanceRad),
        );
        labels.features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [_toDeg(lngR), _toDeg(lat2)] },
            properties: { label: nm + ' nm' },
        });
    });

    return { lines, labels };
}

/**
 * Compute the area-weighted centroid of a GeoJSON polygon ring using the
 * shoelace (surveyor's) formula.
 * coordinates[0] is the outer ring; additional rings (holes) are ignored.
 */
function computeCentroid(coordinates: number[][][]): LngLat {
    const ring = coordinates[0];
    let area = 0, centroidX = 0, centroidY = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const x0 = ring[i][0],     y0 = ring[i][1];
        const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
        const cross = x0 * y1 - x1 * y0;
        area      += cross;
        centroidX += (x0 + x1) * cross;
        centroidY += (y0 + y1) * cross;
    }
    area *= 0.5;
    return [centroidX / (6 * area), centroidY / (6 * area)];
}

/**
 * Compute the MapLibre text-rotate angle (degrees) aligned with the
 * polygon's longest edge, normalised to the range (-90, 90].
 */
function computeTextRotate(coordinates: number[][][]): number {
    const ring = coordinates[0];
    let maxLen = -1, bearing = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
            bearing = Math.atan2(dLng * Math.cos(midLat * Math.PI / 180), dLat) * 180 / Math.PI;
        }
    }
    let textRotation = bearing - 90;
    if (textRotation >   90) textRotation -= 180;
    if (textRotation <= -90) textRotation += 180;
    return Math.round(textRotation * 10) / 10;
}

/**
 * Find the two endpoints [p0, p1] of the polygon's longest edge.
 */
function computeLongestEdge(coordinates: number[][][]): [LngLat, LngLat] {
    const ring = coordinates[0];
    let maxLen = -1;
    let p0: LngLat = [ring[0][0], ring[0][1]];
    let p1: LngLat = [ring[1][0], ring[1][1]];
    for (let i = 0; i < ring.length - 1; i++) {
        const dLng = ring[i + 1][0] - ring[i][0];
        const dLat = ring[i + 1][1] - ring[i][1];
        const len  = Math.sqrt(dLng * dLng + dLat * dLat);
        if (len > maxLen) {
            maxLen = len;
            p0 = [ring[i][0],     ring[i][1]];
            p1 = [ring[i + 1][0], ring[i + 1][1]];
        }
    }
    return [p0, p1];
}

// ─── Helpers used in multiple tests ───────────────────────────────────────────

/**
 * Calculate the Haversine distance in nautical miles between two [lng, lat] points.
 * Used to verify that geodesic circle points are approximately the right distance
 * from the centre.
 */
function haversineDistanceNm(
    [lng1, lat1]: LngLat,
    [lng2, lat2]: LngLat,
): number {
    const R  = 3440.065; // Earth radius in nm
    const φ1 = _toRad(lat1), φ2 = _toRad(lat2);
    const Δφ = _toRad(lat2 - lat1);
    const Δλ = _toRad(lng2 - lng1);
    const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

// ------------------------------------------------------------------ _toRad / _toDeg
describe('_toRad — degree-to-radian conversion', () => {
    test('converts 0 degrees to 0 radians', () => {
        expect(_toRad(0)).toBe(0);
    });

    test('converts 180 degrees to π radians', () => {
        expect(_toRad(180)).toBeCloseTo(Math.PI, 10);
    });

    test('converts 360 degrees to 2π radians', () => {
        expect(_toRad(360)).toBeCloseTo(2 * Math.PI, 10);
    });

    test('converts 90 degrees to π/2 radians', () => {
        expect(_toRad(90)).toBeCloseTo(Math.PI / 2, 10);
    });

    test('converts negative degrees correctly (−90° → −π/2)', () => {
        expect(_toRad(-90)).toBeCloseTo(-Math.PI / 2, 10);
    });

    test('is the exact inverse of _toDeg for an arbitrary value', () => {
        const originalDegrees = 137.5;
        expect(_toRad(_toDeg(_toRad(originalDegrees)))).toBeCloseTo(
            _toRad(originalDegrees),
            10,
        );
    });
});

describe('_toDeg — radian-to-degree conversion', () => {
    test('converts 0 radians to 0 degrees', () => {
        expect(_toDeg(0)).toBe(0);
    });

    test('converts π radians to 180 degrees', () => {
        expect(_toDeg(Math.PI)).toBeCloseTo(180, 10);
    });

    test('converts 2π radians to 360 degrees', () => {
        expect(_toDeg(2 * Math.PI)).toBeCloseTo(360, 10);
    });

    test('converts negative radians correctly (−π → −180°)', () => {
        expect(_toDeg(-Math.PI)).toBeCloseTo(-180, 10);
    });
});

// ------------------------------------------------------------------ generateGeodesicCircle
describe('generateGeodesicCircle — great-circle ring generation', () => {
    // The UK's approximate centre is a realistic input for most tests.
    const ukCentreLng = -2.5;
    const ukCentreLat = 54.0;
    const radiusOneHundredNm = 100;

    test('returns exactly 181 points (bearings 0° through 360° in 2° steps)', () => {
        const circlePoints = generateGeodesicCircle(
            ukCentreLng,
            ukCentreLat,
            radiusOneHundredNm,
        );
        expect(circlePoints).toHaveLength(181);
    });

    test('every point in the circle is a [lng, lat] tuple with two numeric elements', () => {
        const circlePoints = generateGeodesicCircle(
            ukCentreLng,
            ukCentreLat,
            radiusOneHundredNm,
        );
        circlePoints.forEach((point, pointIndex) => {
            expect(point).toHaveLength(2);
            expect(typeof point[0]).toBe('number');
            expect(typeof point[1]).toBe('number');
            // NaN would indicate a math error
            expect(Number.isFinite(point[0])).toBe(true);
            expect(Number.isFinite(point[1])).toBe(true);
        });
    });

    test(
        'every point in the circle is within 0.5 nm of the requested radius ' +
        '(haversine check against the centre)',
        () => {
            const centre: LngLat = [ukCentreLng, ukCentreLat];
            const circlePoints   = generateGeodesicCircle(
                ukCentreLng,
                ukCentreLat,
                radiusOneHundredNm,
            );
            const toleranceNm = 0.5;
            circlePoints.forEach(point => {
                const actualDistanceNm = haversineDistanceNm(centre, point);
                expect(Math.abs(actualDistanceNm - radiusOneHundredNm)).toBeLessThan(
                    toleranceNm,
                );
            });
        },
    );

    test('first and last points are equal (the ring closes on itself)', () => {
        const circlePoints = generateGeodesicCircle(
            ukCentreLng,
            ukCentreLat,
            radiusOneHundredNm,
        );
        const firstPoint = circlePoints[0];
        const lastPoint  = circlePoints[circlePoints.length - 1];
        expect(firstPoint[0]).toBeCloseTo(lastPoint[0], 6);
        expect(firstPoint[1]).toBeCloseTo(lastPoint[1], 6);
    });

    test('a very small radius (1 nm) still produces 181 finite points', () => {
        const tinyRadiusNm = 1;
        const circlePoints = generateGeodesicCircle(0, 0, tinyRadiusNm);
        expect(circlePoints).toHaveLength(181);
        circlePoints.forEach(point => {
            expect(Number.isFinite(point[0])).toBe(true);
            expect(Number.isFinite(point[1])).toBe(true);
        });
    });

    test('a large radius (250 nm) still produces 181 finite points', () => {
        const largeRadiusNm = 250;
        const circlePoints  = generateGeodesicCircle(
            ukCentreLng,
            ukCentreLat,
            largeRadiusNm,
        );
        expect(circlePoints).toHaveLength(181);
        circlePoints.forEach(point => {
            expect(Number.isFinite(point[0])).toBe(true);
            expect(Number.isFinite(point[1])).toBe(true);
        });
    });

    test('circles centred at the equator (lat = 0) produce valid coordinates', () => {
        const circlePoints = generateGeodesicCircle(0, 0, radiusOneHundredNm);
        expect(circlePoints).toHaveLength(181);
        circlePoints.forEach(point => {
            // Latitude values must remain within [-90, 90]
            expect(point[1]).toBeGreaterThanOrEqual(-90);
            expect(point[1]).toBeLessThanOrEqual(90);
        });
    });

    test('circles centred at a negative longitude produce valid coordinates', () => {
        const circlePoints = generateGeodesicCircle(-10, 51, radiusOneHundredNm);
        circlePoints.forEach(point => {
            expect(Number.isFinite(point[0])).toBe(true);
            expect(Number.isFinite(point[1])).toBe(true);
        });
    });
});

// ------------------------------------------------------------------ buildRingsGeoJSON
describe('buildRingsGeoJSON — range-ring GeoJSON construction', () => {
    const centreLng = -4.5;
    const centreLat = 54.2;

    test('returns an object with exactly "lines" and "labels" keys', () => {
        const ringsGeoJSON = buildRingsGeoJSON(centreLng, centreLat);
        expect(Object.keys(ringsGeoJSON).sort()).toEqual(['labels', 'lines']);
    });

    test('lines FeatureCollection has exactly 5 features (one per ring distance)', () => {
        const { lines } = buildRingsGeoJSON(centreLng, centreLat);
        expect(lines.type).toBe('FeatureCollection');
        expect(lines.features).toHaveLength(RING_DISTANCES_NM.length); // 5
    });

    test('labels FeatureCollection has exactly 5 features (one per ring distance)', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        expect(labels.type).toBe('FeatureCollection');
        expect(labels.features).toHaveLength(RING_DISTANCES_NM.length); // 5
    });

    test('each line feature contains a LineString geometry with 181 coordinates', () => {
        const { lines } = buildRingsGeoJSON(centreLng, centreLat);
        lines.features.forEach((lineFeature, featureIndex) => {
            expect(lineFeature.geometry.type).toBe('LineString');
            expect(lineFeature.geometry.coordinates).toHaveLength(181);
        });
    });

    test('each label feature contains a Point geometry', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        labels.features.forEach(labelFeature => {
            expect(labelFeature.geometry.type).toBe('Point');
            expect(labelFeature.geometry.coordinates).toHaveLength(2);
        });
    });

    test('label text values match the expected "N nm" pattern for each ring distance', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        const expectedLabels = RING_DISTANCES_NM.map(nm => `${nm} nm`);
        const actualLabels   = labels.features.map(f => f.properties.label);
        expect(actualLabels).toEqual(expectedLabels);
    });

    test('label points are directly north of the centre (same longitude)', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        labels.features.forEach(labelFeature => {
            // The label is placed at bearing 0° (true north), so longitude equals centre lng
            expect(labelFeature.geometry.coordinates[0]).toBeCloseTo(centreLng, 6);
        });
    });

    test('label latitudes are north of the centre (larger latitude value)', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        labels.features.forEach(labelFeature => {
            expect(labelFeature.geometry.coordinates[1]).toBeGreaterThan(centreLat);
        });
    });

    test('label latitudes increase with ring distance (outer rings are further north)', () => {
        const { labels } = buildRingsGeoJSON(centreLng, centreLat);
        for (let i = 1; i < labels.features.length; i++) {
            const previousRingLat = labels.features[i - 1].geometry.coordinates[1];
            const currentRingLat  = labels.features[i].geometry.coordinates[1];
            expect(currentRingLat).toBeGreaterThan(previousRingLat);
        }
    });
});

// ------------------------------------------------------------------ computeCentroid
describe('computeCentroid — shoelace-formula area-weighted centroid', () => {
    test('centroid of a unit square centred at the origin is [0, 0]', () => {
        // A counter-clockwise unit square: corners at (±0.5, ±0.5), ring closed
        const unitSquareRing = [
            [-0.5, -0.5],
            [ 0.5, -0.5],
            [ 0.5,  0.5],
            [-0.5,  0.5],
            [-0.5, -0.5], // closing vertex
        ];
        const [centroidLng, centroidLat] = computeCentroid([unitSquareRing]);
        expect(centroidLng).toBeCloseTo(0, 10);
        expect(centroidLat).toBeCloseTo(0, 10);
    });

    test('centroid of a square translated to (10, 20) is at (10, 20)', () => {
        // Square corners translated so the centre sits at exactly (10, 20)
        const translatedSquareRing = [
            [9.5, 19.5],
            [10.5, 19.5],
            [10.5, 20.5],
            [9.5, 20.5],
            [9.5, 19.5],
        ];
        const [centroidLng, centroidLat] = computeCentroid([translatedSquareRing]);
        expect(centroidLng).toBeCloseTo(10, 8);
        expect(centroidLat).toBeCloseTo(20, 8);
    });

    test('centroid of an axis-aligned rectangle lies at its geometric centre', () => {
        // Rectangle spanning [2, 4] in x and [6, 10] in y — centre is (3, 8)
        const rectangleRing = [
            [2, 6],
            [4, 6],
            [4, 10],
            [2, 10],
            [2, 6],
        ];
        const [centroidLng, centroidLat] = computeCentroid([rectangleRing]);
        expect(centroidLng).toBeCloseTo(3, 8);
        expect(centroidLat).toBeCloseTo(8, 8);
    });

    test('centroid of an equilateral triangle is at the average of its vertices', () => {
        // Triangle with vertices at (0,0), (6,0), (3, 3√3 ≈ 5.196)
        // Centroid should be at (3, √3 ≈ 1.732)
        const triHeight = Math.sqrt(3) * 3;
        const triangleRing = [
            [0, 0],
            [6, 0],
            [3, triHeight],
            [0, 0],
        ];
        const [centroidLng, centroidLat] = computeCentroid([triangleRing]);
        expect(centroidLng).toBeCloseTo(3, 5);
        expect(centroidLat).toBeCloseTo(triHeight / 3, 5);
    });

    test('returns a tuple with exactly two numeric elements', () => {
        const ring = [[0,0],[1,0],[1,1],[0,1],[0,0]];
        const centroid = computeCentroid([ring]);
        expect(centroid).toHaveLength(2);
        expect(typeof centroid[0]).toBe('number');
        expect(typeof centroid[1]).toBe('number');
    });
});

// ------------------------------------------------------------------ computeTextRotate
describe('computeTextRotate — bearing aligned to polygon longest edge', () => {
    test('result is always in the half-open interval (−90°, 90°]', () => {
        // Test with several polygon orientations to verify the normalisation clamp
        const polygonRings = [
            // Horizontal rectangle — longest edge is horizontal, expect ≈ 0°
            [[[0,0],[10,0],[10,1],[0,1],[0,0]]],
            // Vertical rectangle — longest edge is vertical, expect ≈ 0° (90−90=0)
            [[[0,0],[1,0],[1,10],[0,10],[0,0]]],
            // Diagonal rectangle tilted ~45°
            [[[0,0],[5,5],[6,4],[1,-1],[0,0]]],
        ];
        polygonRings.forEach(coordinates => {
            const rotation = computeTextRotate(coordinates);
            expect(rotation).toBeGreaterThan(-90);
            expect(rotation).toBeLessThanOrEqual(90);
        });
    });

    test('horizontal rectangle produces a rotation close to 0°', () => {
        // Longest edge runs along the x-axis → bearing ≈ 90° → rotation ≈ 90 − 90 = 0°
        const horizontalRectangleRing = [[[0,0],[10,0],[10,1],[0,1],[0,0]]];
        const rotation = computeTextRotate(horizontalRectangleRing);
        expect(Math.abs(rotation)).toBeLessThan(5); // should be ≈ 0°
    });

    test('returns a number rounded to one decimal place', () => {
        const rectangleRing = [[[0,0],[3,0],[3,1],[0,1],[0,0]]];
        const rotation = computeTextRotate(rectangleRing);
        // Verify no more than one decimal digit of precision
        const roundedToOneDecimal = Math.round(rotation * 10) / 10;
        expect(rotation).toBe(roundedToOneDecimal);
    });

    test('result is a finite number for any valid closed polygon ring', () => {
        const squareRing = [[[0,0],[1,0],[1,1],[0,1],[0,0]]];
        const rotation   = computeTextRotate(squareRing);
        expect(Number.isFinite(rotation)).toBe(true);
    });
});

// ------------------------------------------------------------------ computeLongestEdge
describe('computeLongestEdge — endpoints of polygon longest edge', () => {
    test('identifies the longest edge of a rectangle where one edge is clearly longest', () => {
        // Rectangle: width = 10 units, height = 1 unit
        // The longest edges are the top and bottom (length 10); the first one
        // found (index 0→1) should be returned.
        const wideRectangleRing = [[[0,0],[10,0],[10,1],[0,1],[0,0]]];
        const [edgeStart, edgeEnd] = computeLongestEdge(wideRectangleRing);
        // The bottom edge from (0,0) to (10,0) has length 10
        expect(edgeStart).toEqual([0, 0]);
        expect(edgeEnd).toEqual([10, 0]);
    });

    test('returns an array of exactly two [lng, lat] tuples', () => {
        const squareRing = [[[0,0],[1,0],[1,1],[0,1],[0,0]]];
        const longestEdge = computeLongestEdge(squareRing);
        expect(longestEdge).toHaveLength(2);
        expect(longestEdge[0]).toHaveLength(2);
        expect(longestEdge[1]).toHaveLength(2);
    });

    test('each endpoint element is a finite number', () => {
        const triangleRing = [[[0,0],[5,0],[2.5,4],[0,0]]];
        const [p0, p1] = computeLongestEdge(triangleRing);
        [p0, p1].forEach(point => {
            expect(Number.isFinite(point[0])).toBe(true);
            expect(Number.isFinite(point[1])).toBe(true);
        });
    });

    test('longest edge of a tall rectangle is correctly identified as the vertical side', () => {
        // Rectangle: width = 1, height = 10 — the tall sides are longest
        const tallRectangleRing = [[[0,0],[1,0],[1,10],[0,10],[0,0]]];
        const [edgeStart, edgeEnd] = computeLongestEdge(tallRectangleRing);
        // Edge from (1,0)→(1,10) has length 10 and occurs at index 1→2
        expect(edgeStart).toEqual([1, 0]);
        expect(edgeEnd).toEqual([1, 10]);
    });

    test('when all edges are equal length (square) the first edge is returned', () => {
        // All edges of a unit square have length 1; the first one (0→1) should win.
        const unitSquareRing = [[[0,0],[1,0],[1,1],[0,1],[0,0]]];
        const [edgeStart, edgeEnd] = computeLongestEdge(unitSquareRing);
        expect(edgeStart).toEqual([0, 0]);
        expect(edgeEnd).toEqual([1, 0]);
    });

    test('diagonal edge is correctly identified when it is the longest', () => {
        // Triangle with vertices (0,0), (3,0), (0,4).
        // Edges: bottom=3, left=4, hypotenuse=5. Hypotenuse wins.
        const rightTriangleRing = [[[0,0],[3,0],[0,4],[0,0]]];
        const [edgeStart, edgeEnd] = computeLongestEdge(rightTriangleRing);
        expect(edgeStart).toEqual([3, 0]);
        expect(edgeEnd).toEqual([0, 4]);
    });
});

// ------------------------------------------------------------------ RING_DISTANCES_NM
describe('RING_DISTANCES_NM — ring distance constant array', () => {
    test('contains exactly 5 distances', () => {
        expect(RING_DISTANCES_NM).toHaveLength(5);
    });

    test('distances are [50, 100, 150, 200, 250] in ascending order', () => {
        expect(Array.from(RING_DISTANCES_NM)).toEqual([50, 100, 150, 200, 250]);
    });

    test('all values are positive integers', () => {
        RING_DISTANCES_NM.forEach(distanceNm => {
            expect(distanceNm).toBeGreaterThan(0);
            expect(Number.isInteger(distanceNm)).toBe(true);
        });
    });
});
