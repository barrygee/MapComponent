// Shared parsing for the /api/air/adsb/point/{lat}/{lon}/{radius} response.
//
// Both AdsbLiveControl (rendering) and the app-level background alerts service
// (useAirAlertsService) consume this endpoint. Keeping the altitude parsing and
// military classification here ensures both interpret the raw feed identically —
// previously this logic was inline in AdsbLiveControl only.

export interface AdsbApiEntry {
  hex?: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | string
  alt_geom?: number
  gs?: number
  ias?: number
  mach?: number
  track?: number
  baro_rate?: number
  nav_altitude_mcp?: number
  nav_altitude_fms?: number
  nav_heading?: number
  category?: string
  emergency?: string
  squawk?: string
  rssi?: number
  // Bitfield from the aircraft database the upstream joins onto the live feed:
  // 1 = military, 2 = interesting, 4 = PIA, 8 = LADD. This — not a `military`
  // boolean — is how adsb.lol/airplanes.live and a readsb build with the
  // aircraft DB report military status.
  dbFlags?: number
}

// Normalised aircraft used by detection logic (landing/departure + overhead).
export interface ParsedAircraft {
  hex: string
  lat: number
  lon: number
  alt: number
  gs: number
  flight: string
  r: string
  military: boolean
}

export function parseAlt(alt_baro: number | string | null | undefined): number {
  if (alt_baro === 'ground' || alt_baro === '' || alt_baro == null) return 0
  const alt = typeof alt_baro === 'number' ? alt_baro : parseFloat(alt_baro as string) || 0
  return alt < 0 ? 0 : alt
}

// Bit 1 of `dbFlags` is the upstream aircraft database's military marker.
const DB_FLAG_MILITARY = 1

// Fallback military ICAO 24-bit allocation blocks, used only when the feed
// carries no `dbFlags` (a bare readsb with no aircraft database attached).
//
// This is the allocation list shared by tar1090 and Virtual Radar Server. It is
// a heuristic and always will be: it cannot catch a military aircraft flying on
// a civil registration — a US Army C172 on an N-number sits in a civil block —
// which is precisely why `dbFlags` is preferred whenever the feed provides it.
const MILITARY_HEX_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0a4000, 0x0a4fff], // Algeria
  [0x33ff00, 0x33ffff], // Italy
  [0x350000, 0x37ffff], // Spain
  [0x3a8000, 0x3affff], // France
  [0x3b0000, 0x3bffff], // France
  [0x3ea000, 0x3ebfff], // Germany
  [0x3f4000, 0x3fbfff], // Germany
  [0x400000, 0x40003f], // United Kingdom
  [0x43c000, 0x43cfff], // United Kingdom
  [0x447000, 0x447fff], // Belgium
  [0x44f000, 0x44ffff], // Belgium
  [0x457000, 0x457fff], // Bulgaria
  [0x45f400, 0x45f4ff], // Denmark
  [0x468000, 0x4683ff], // Greece
  [0x473c00, 0x473c0f], // Hungary
  [0x478100, 0x4781ff], // Norway
  [0x480000, 0x480fff], // Netherlands
  [0x48d800, 0x48d87f], // Poland
  [0x497c00, 0x497cff], // Portugal
  [0x498420, 0x49842f], // Portugal
  [0x4b7000, 0x4b7fff], // Switzerland
  [0x4b8200, 0x4b82ff], // Turkey
  [0x506f00, 0x506fff], // Slovenia
  [0x70c070, 0x70c07f], // Oman
  [0x710258, 0x71028f], // Saudi Arabia
  [0x710380, 0x71039f], // Saudi Arabia
  [0x738a00, 0x738aff], // Israel
  [0x7c822e, 0x7c84ff], // Australia
  [0x7c8800, 0x7c88ff], // Australia
  [0x7c9000, 0x7c9fff], // Australia
  [0x7cf800, 0x7cfaff], // Australia
  [0x800200, 0x8002ff], // India
  [0xadf7c8, 0xafffff], // United States
  [0xc0cdf9, 0xc3ffff], // Canada
  [0xe40000, 0xe41fff], // Brazil
]

/**
 * Classify one aircraft as military, driving the lime-vs-blue colour the map,
 * labels and filter rail all key off.
 *
 * The upstream's own `dbFlags` marker is authoritative when present — it comes
 * from a curated aircraft database, so it catches military airframes on civil
 * registrations that no ICAO hex range can. The allocation-block scan is only
 * a fallback for feeds that omit `dbFlags`.
 *
 * @param hex ICAO 24-bit address as a hex string.
 * @param dbFlags Upstream database bitfield, when the feed supplies one.
 */
export function isMilitary(hex: string, dbFlags: number | undefined): boolean {
  if (typeof dbFlags === 'number') return (dbFlags & DB_FLAG_MILITARY) !== 0
  const hexInt = parseInt(hex, 16)
  if (Number.isNaN(hexInt)) return false
  return MILITARY_HEX_BLOCKS.some(([first, last]) => hexInt >= first && hexInt <= last)
}

// Map the raw API `ac` array to normalised aircraft, applying the same filters
// AdsbLiveControl uses (must have lat/lon; drop category A0/B0/C0 ground noise).
export function parseAircraftList(ac: AdsbApiEntry[]): ParsedAircraft[] {
  const out: ParsedAircraft[] = []
  for (const a of ac) {
    if (a.lat == null || a.lon == null) continue
    if (['A0', 'B0', 'C0'].includes((a.category || '').toUpperCase())) continue
    const hex = a.hex || ''
    if (!hex) continue
    out.push({
      hex,
      lat: a.lat,
      lon: a.lon,
      alt: parseAlt(a.alt_baro ?? null),
      gs: a.gs ?? 0,
      flight: (a.flight || '').trim(),
      r: a.r || '',
      military: isMilitary(hex, a.dbFlags),
    })
  }
  return out
}
