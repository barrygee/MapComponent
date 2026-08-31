import { describe, it, expect } from 'vitest'
import { formatLatitude, formatLongitude, isValidLatLon } from './locationUtils'

describe('isValidLatLon', () => {
  it('accepts coordinates within bounds', () => {
    expect(isValidLatLon(51.5, -0.12)).toBe(true)
    expect(isValidLatLon(0, 0)).toBe(true)
  })

  it('accepts the exact boundary values', () => {
    expect(isValidLatLon(90, 180)).toBe(true)
    expect(isValidLatLon(-90, -180)).toBe(true)
  })

  it('rejects out-of-range latitude', () => {
    expect(isValidLatLon(90.1, 0)).toBe(false)
    expect(isValidLatLon(-90.1, 0)).toBe(false)
  })

  it('rejects out-of-range longitude', () => {
    expect(isValidLatLon(0, 180.1)).toBe(false)
    expect(isValidLatLon(0, -180.1)).toBe(false)
  })

  it('rejects NaN latitude or longitude', () => {
    expect(isValidLatLon(Number.NaN, 0)).toBe(false)
    expect(isValidLatLon(0, Number.NaN)).toBe(false)
  })
})

describe('formatLatitude', () => {
  it('writes a northern latitude with its hemisphere', () => {
    expect(formatLatitude(54.951186)).toBe('54.95119° N')
  })

  it('writes a southern latitude as a positive number south, not a minus', () => {
    expect(formatLatitude(-33.8688)).toBe('33.86880° S')
  })

  it('treats the equator as northern rather than printing a bare zero', () => {
    expect(formatLatitude(0)).toBe('0.00000° N')
  })

  it('pads and rounds to a fixed five places, so values line up in a column', () => {
    expect(formatLatitude(5.1)).toBe('5.10000° N')
    expect(formatLatitude(1.2345678)).toBe('1.23457° N')
  })

  it('handles the poles', () => {
    expect(formatLatitude(90)).toBe('90.00000° N')
    expect(formatLatitude(-90)).toBe('90.00000° S')
  })
})

describe('formatLongitude', () => {
  it('writes an eastern longitude with its hemisphere', () => {
    expect(formatLongitude(151.2093)).toBe('151.20930° E')
  })

  it('writes a western longitude as a positive number west, not a minus', () => {
    expect(formatLongitude(-1.532995)).toBe('1.53300° W')
  })

  it('treats the prime meridian as eastern rather than printing a bare zero', () => {
    expect(formatLongitude(0)).toBe('0.00000° E')
  })

  it('handles the antimeridian from either side', () => {
    expect(formatLongitude(180)).toBe('180.00000° E')
    expect(formatLongitude(-180)).toBe('180.00000° W')
  })
})
