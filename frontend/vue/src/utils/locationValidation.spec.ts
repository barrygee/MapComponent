import { describe, it, expect } from 'vitest'
import {
  MAXIMUM_LATITUDE,
  MAXIMUM_LONGITUDE,
  MINIMUM_LATITUDE,
  MINIMUM_LONGITUDE,
  parseCoordinate,
  validateCoordinatePair,
  validateLatitude,
  validateLongitude,
} from './locationValidation'

describe('parseCoordinate', () => {
  it('returns null for an empty field', () => {
    expect(parseCoordinate('')).toBeNull()
  })

  it('treats a whitespace-only field as empty rather than as nonsense', () => {
    expect(parseCoordinate('   ')).toBeNull()
  })

  it('parses a decimal coordinate, including a negative one', () => {
    expect(parseCoordinate('54.95149')).toBe(54.95149)
    expect(parseCoordinate('-1.53587')).toBe(-1.53587)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseCoordinate('  12.5  ')).toBe(12.5)
  })

  it('returns NaN for text that is not a number, distinguishing it from blank', () => {
    expect(parseCoordinate('abc')).toBeNaN()
  })

  it('rejects a half-parsed entry that parseFloat would have accepted', () => {
    // The reason this module uses Number() rather than parseFloat: parseFloat
    // returns 54.9 here, silently discarding the rest of what was typed.
    expect(parseCoordinate('54.9 north')).toBeNaN()
  })
})

describe('validateLatitude', () => {
  it('accepts null, because an empty field means "no position"', () => {
    expect(validateLatitude(null)).toBeNull()
  })

  it('accepts a value inside the range', () => {
    expect(validateLatitude(54.95149)).toBeNull()
  })

  it('accepts both bounds', () => {
    expect(validateLatitude(MINIMUM_LATITUDE)).toBeNull()
    expect(validateLatitude(MAXIMUM_LATITUDE)).toBeNull()
  })

  it('rejects a value above the maximum', () => {
    expect(validateLatitude(90.1)).toBe('Latitude must be between -90 and 90.')
  })

  it('rejects a value below the minimum', () => {
    expect(validateLatitude(-90.1)).toBe('Latitude must be between -90 and 90.')
  })

  it('rejects NaN with the "must be a number" message, not the range one', () => {
    expect(validateLatitude(NaN)).toBe(
      'Latitude must be a number in decimal degrees, e.g. 54.95149.',
    )
  })

  it('rejects Infinity, which is neither a range failure nor a valid number', () => {
    expect(validateLatitude(Infinity)).toBe(
      'Latitude must be a number in decimal degrees, e.g. 54.95149.',
    )
  })
})

describe('validateLongitude', () => {
  it('accepts null', () => {
    expect(validateLongitude(null)).toBeNull()
  })

  it('accepts a value inside the range', () => {
    expect(validateLongitude(-1.53587)).toBeNull()
  })

  it('accepts both bounds', () => {
    expect(validateLongitude(MINIMUM_LONGITUDE)).toBeNull()
    expect(validateLongitude(MAXIMUM_LONGITUDE)).toBeNull()
  })

  it('rejects a value above the maximum', () => {
    expect(validateLongitude(180.1)).toBe('Longitude must be between -180 and 180.')
  })

  it('rejects a value below the minimum', () => {
    expect(validateLongitude(-180.1)).toBe('Longitude must be between -180 and 180.')
  })

  it('rejects NaN', () => {
    expect(validateLongitude(NaN)).toBe(
      'Longitude must be a number in decimal degrees, e.g. 54.95149.',
    )
  })

  it('accepts a latitude-range value, which is why the pair rule cannot catch a swap', () => {
    // 54.95 is a valid longitude. Nothing here can tell it was meant as a
    // latitude — the guard against that is the operator reading the hints.
    expect(validateLongitude(54.95)).toBeNull()
  })
})

describe('validateCoordinatePair', () => {
  it('accepts both coordinates present', () => {
    expect(validateCoordinatePair(54.95149, -1.53587)).toBeNull()
  })

  it('accepts both absent, which is how a position is removed', () => {
    expect(validateCoordinatePair(null, null)).toBeNull()
  })

  it('rejects a longitude with no latitude, naming the missing field', () => {
    expect(validateCoordinatePair(null, -1.53587)).toBe(
      'Enter a latitude too, or clear both to remove your position.',
    )
  })

  it('rejects a latitude with no longitude, naming the missing field', () => {
    expect(validateCoordinatePair(54.95149, null)).toBe(
      'Enter a longitude too, or clear both to remove your position.',
    )
  })

  it('treats 0 as present, not as a missing coordinate', () => {
    // Null Island is a real coordinate pair, and a falsy-check bug here would
    // reject it as "half a position".
    expect(validateCoordinatePair(0, 0)).toBeNull()
    expect(validateCoordinatePair(0, null)).toBe(
      'Enter a longitude too, or clear both to remove your position.',
    )
  })
})
