import { describe, it, expect } from 'vitest'
import { parseAlt, isMilitary, parseAircraftList, type AdsbApiEntry } from './adsbParse'

describe('parseAlt', () => {
  it('treats the literal "ground" string as zero altitude', () => {
    expect(parseAlt('ground')).toBe(0)
  })

  it('treats an empty string as zero altitude', () => {
    expect(parseAlt('')).toBe(0)
  })

  it('treats null and undefined as zero altitude', () => {
    expect(parseAlt(null)).toBe(0)
    expect(parseAlt(undefined)).toBe(0)
  })

  it('returns a numeric altitude unchanged', () => {
    expect(parseAlt(35000)).toBe(35000)
  })

  it('parses a numeric string altitude', () => {
    expect(parseAlt('12500')).toBe(12500)
  })

  it('falls back to zero when a string cannot be parsed as a number', () => {
    expect(parseAlt('not-a-number')).toBe(0)
  })

  it('clamps negative altitudes to zero', () => {
    expect(parseAlt(-200)).toBe(0)
  })
})

describe('isMilitary', () => {
  it('treats dbFlags bit 1 as military', () => {
    // 0x000001 is outside every allocation block, so only the flag can make it true.
    expect(isMilitary('000001', 1)).toBe(true)
  })

  it('reads bit 1 out of a dbFlags value carrying other bits', () => {
    // 9 = military (1) + LADD (8); LADD must not mask the military bit.
    expect(isMilitary('000001', 9)).toBe(true)
    // 8 = LADD alone — a civil privacy programme, not a military marker.
    expect(isMilitary('000001', 8)).toBe(false)
  })

  it('trusts dbFlags over the hex blocks in both directions', () => {
    // A military-block hex the database says is civil (e.g. a sold-off airframe).
    expect(isMilitary('ae0000', 0)).toBe(false)
    // A civil-block hex the database says is military — a US Army C172 on an
    // N-number. No allocation range can catch this; only dbFlags can.
    expect(isMilitary('aab198', 1)).toBe(true)
  })

  it('falls back to the allocation blocks when the feed omits dbFlags', () => {
    expect(isMilitary('43c000', undefined)).toBe(true)
    expect(isMilitary('43cfff', undefined)).toBe(true)
    expect(isMilitary('adf7c8', undefined)).toBe(true)
    expect(isMilitary('afffff', undefined)).toBe(true)
    expect(isMilitary('c0cdf9', undefined)).toBe(true)
  })

  it('excludes the civil UK range above the 0x43CFFF military block', () => {
    expect(isMilitary('43d000', undefined)).toBe(false)
    expect(isMilitary('400f1a', undefined)).toBe(false)
  })

  it('excludes hexes just outside a block boundary', () => {
    expect(isMilitary('43bfff', undefined)).toBe(false)
    expect(isMilitary('adf7c7', undefined)).toBe(false)
    expect(isMilitary('b00000', undefined)).toBe(false)
  })

  it('classifies a civil hex with no dbFlags as non-military', () => {
    expect(isMilitary('4ca123', undefined)).toBe(false)
  })

  it('treats an unparseable hex as non-military rather than NaN-matching a block', () => {
    expect(isMilitary('', undefined)).toBe(false)
    expect(isMilitary('zzzzzz', undefined)).toBe(false)
  })
})

describe('parseAircraftList', () => {
  const baseEntry = (overrides: Partial<AdsbApiEntry> = {}): AdsbApiEntry => ({
    hex: 'abc123',
    lat: 51.5,
    lon: -0.1,
    ...overrides,
  })

  it('maps a complete entry to a normalised aircraft, trimming the flight number', () => {
    const result = parseAircraftList([
      baseEntry({ flight: ' BAW123 ', r: 'G-ABCD', gs: 420, alt_baro: 36000, dbFlags: 0 }),
    ])
    expect(result).toEqual([
      {
        hex: 'abc123',
        lat: 51.5,
        lon: -0.1,
        alt: 36000,
        gs: 420,
        flight: 'BAW123',
        r: 'G-ABCD',
        military: false,
      },
    ])
  })

  it('skips entries missing latitude or longitude', () => {
    expect(parseAircraftList([{ hex: 'abc123', lat: 51.5 }])).toEqual([])
    expect(parseAircraftList([{ hex: 'abc123', lon: -0.1 }])).toEqual([])
  })

  it('drops ground-noise categories A0, B0 and C0 case-insensitively', () => {
    expect(parseAircraftList([baseEntry({ category: 'a0' })])).toEqual([])
    expect(parseAircraftList([baseEntry({ category: 'B0' })])).toEqual([])
    expect(parseAircraftList([baseEntry({ category: 'c0' })])).toEqual([])
  })

  it('skips entries with no hex identifier', () => {
    expect(parseAircraftList([{ hex: '', lat: 51.5, lon: -0.1 }])).toEqual([])
  })

  it('defaults missing ground speed, flight, registration and altitude fields', () => {
    const [aircraft] = parseAircraftList([{ hex: 'abc123', lat: 1, lon: 2 }])
    expect(aircraft).toMatchObject({ gs: 0, flight: '', r: '', alt: 0 })
  })

  it('derives the military flag from dbFlags when the feed supplies it', () => {
    const [aircraft] = parseAircraftList([{ hex: 'aab198', lat: 1, lon: 2, dbFlags: 1 }])
    expect(aircraft!.military).toBe(true)
  })

  it('falls back to the hex block when the feed omits dbFlags', () => {
    const [aircraft] = parseAircraftList([{ hex: '43c000', lat: 1, lon: 2 }])
    expect(aircraft!.military).toBe(true)
  })
})
