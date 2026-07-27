// APRS symbol decoding → line-art icons in Sentinel's icon style (24×24 viewBox,
// no fill, currentColor stroke, round caps/joins — matching the side-panel button
// icons and the map marker family).
//
// An APRS symbol is a two-character code: a *table* char ('/' primary, '\'
// alternate, or an overlay digit/letter) followed by a *symbol* char that
// carries the meaning (e.g. '/>' = car, '/_' = weather station, '/#' =
// digipeater). We key on the symbol char, which is what distinguishes the common
// station types; unrecognised symbols fall back to a generic beacon dot.

export interface AprsSymbolIcon {
  /** Human-readable station type (accessible name + tooltip). */
  label: string
  /** Inner SVG markup, wrapped by the renderer in a stroke-styled <svg>. */
  paths: string
  /**
   * Where the artwork actually sits in the 24-unit viewBox, when that isn't its
   * centre — a truck drawn along the bottom, an aircraft pushed to one side.
   * Taken from each icon's rendered bounding box; {@link aprsSymbolIcon} shifts
   * the artwork by the difference so every symbol is centred in its well.
   *
   * Recorded per icon rather than corrected in the coordinates so the drawings
   * stay legible to edit, and rather than measured at run time because the icons
   * render inside MapLibre markers, where nothing can measure them first.
   */
  centre?: readonly [number, number]
}

/** Generic beacon used when the symbol is unknown (a filled dot inside a ring). */
export const FALLBACK_SYMBOL: AprsSymbolIcon = {
  label: 'Station',
  paths:
    '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />' +
    '<circle cx="12" cy="12" r="7" opacity="0.5" />',
}

// Keyed by the APRS symbol char (the 2nd char of the code). Several codes share
// an icon (trucks, aircraft, antennas, gateways).
const SYMBOLS: Record<string, AprsSymbolIcon> = {
  // ── vehicles ──────────────────────────────────────────────────────────────
  '>': {
    centre: [12.0, 14.1],
    label: 'Car',
    paths:
      '<path d="M2.5 14.5l1.8-4.3A2 2 0 0 1 6.1 9h9.4a2 2 0 0 1 1.7 1l2.3 4.5M2.5 14.5h19M2.5 14.5v3H4M21.5 14.5v3H20" />' +
      '<circle cx="7" cy="17.5" r="1.7" /><circle cx="16.5" cy="17.5" r="1.7" />',
  },
  '<': {
    centre: [12.0, 14.0],
    label: 'Motorcycle',
    paths:
      '<circle cx="6" cy="16" r="3" /><circle cx="18" cy="16" r="3" />' +
      '<path d="M6 16l4-5h4l2 5M9.5 11h5M14 11l1.5-2H18" />',
  },
  b: {
    centre: [12.0, 13.1],
    label: 'Bicycle',
    paths:
      '<circle cx="6" cy="16" r="3.2" /><circle cx="18" cy="16" r="3.2" />' +
      '<path d="M6 16l4-6 4 6M10 10l4 6M9 8h2.5M14 10l1.5-3H18" />',
  },
  k: {
    centre: [11.25, 13.3],
    label: 'Truck',
    paths:
      '<path d="M2.5 8h10v8.5h-10z" /><path d="M12.5 11h4l3.5 3.5v2h-7.5z" />' +
      '<circle cx="6" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" />',
  },
  u: {
    centre: [11.25, 13.3],
    label: 'Truck',
    paths:
      '<path d="M2.5 8h10v8.5h-10z" /><path d="M12.5 11h4l3.5 3.5v2h-7.5z" />' +
      '<circle cx="6" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" />',
  },
  v: {
    centre: [8.75, 13.05],
    label: 'Van',
    paths:
      '<path d="M2.5 8h12.5a2 2 0 0 1 2 2v6.5h-16.5z" />' +
      '<circle cx="6.5" cy="16.5" r="1.6" /><circle cx="14.5" cy="16.5" r="1.6" />',
  },
  U: {
    label: 'Bus',
    paths:
      '<rect x="3" y="6" width="18" height="11" rx="2" /><path d="M3 13h18M7.5 6v3M12 6v3M16.5 6v3" />' +
      '<circle cx="7.5" cy="18" r="1.3" /><circle cx="16.5" cy="18" r="1.3" />',
  },
  a: {
    centre: [11.25, 13.75],
    label: 'Ambulance',
    paths:
      '<path d="M2.5 9h10v7.5h-10z" /><path d="M12.5 11h4l3.5 3.5v2h-7.5z" />' +
      '<circle cx="6" cy="17" r="1.5" /><circle cx="16.5" cy="17" r="1.5" />' +
      '<path d="M5.5 11.5v3M4 13h3" />',
  },
  R: {
    centre: [11.0, 12.95],
    label: 'Recreational vehicle',
    paths:
      '<rect x="2.5" y="7" width="17" height="9.5" rx="1.5" /><path d="M14 7v9.5M6 10h5v3H6z" />' +
      '<circle cx="7" cy="17.5" r="1.4" /><circle cx="16" cy="17.5" r="1.4" />',
  },
  j: {
    centre: [12.0, 12.8],
    label: 'Jeep',
    paths:
      '<path d="M2.5 10h19l-1 5h-17z" /><path d="M5 10l1.5-3h11L19 10M8 10v5M13 10v5" />' +
      '<circle cx="7" cy="17" r="1.6" /><circle cx="16" cy="17" r="1.6" />',
  },

  // ── aircraft & marine ──────────────────────────────────────────────────────
  "'": {
    centre: [10.0, 11.7],
    label: 'Aircraft',
    paths:
      '<path d="M12 2.5l1.1 7.2 6.9 4-.2 1.8-7.5-2.1.3 4.3 2.2 1.7-.2 1.5-4.6-1.3-4.6 1.3-.2-1.5 2.2-1.7.3-4.3-7.5 2.1-.2-1.8 6.9-4L12 2.5z" />',
  },
  '^': {
    centre: [10.0, 11.7],
    label: 'Large aircraft',
    paths:
      '<path d="M12 2.5l1.1 7.2 6.9 4-.2 1.8-7.5-2.1.3 4.3 2.2 1.7-.2 1.5-4.6-1.3-4.6 1.3-.2-1.5 2.2-1.7.3-4.3-7.5 2.1-.2-1.8 6.9-4L12 2.5z" />',
  },
  g: {
    centre: [12.0, 13.0],
    label: 'Glider',
    paths: '<path d="M3 8h18l-8 3M12 11v7M9 18h6" />',
  },
  X: {
    label: 'Helicopter',
    paths:
      '<path d="M4 7.5h16M12 5.5v2" /><ellipse cx="11" cy="13" rx="5" ry="3" />' +
      '<path d="M16 13h3.5M11 16v3h4M19.5 7.5v6" />',
  },
  s: {
    centre: [12.0, 13.5],
    label: 'Boat',
    paths: '<path d="M3 15h18l-2.2 4H5.2z" /><path d="M6.5 15v-4h8.5l3 4M9.5 11V8h4" />',
  },
  Y: {
    centre: [10.75, 12.0],
    label: 'Sailboat',
    paths:
      '<path d="M4 17h13.5l-1.5 3H5.5z" /><path d="M11 15V4l6 11z" /><path d="M11 15H7l1.2-3H11" />',
  },

  // ── infrastructure & people ────────────────────────────────────────────────
  '-': {
    label: 'Home station',
    paths: '<path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" />',
  },
  '#': {
    label: 'Digipeater',
    paths:
      '<path d="M12 4v16M8.5 20h7" /><path d="M8.5 8a5 5 0 0 1 7 0M6 6a8 8 0 0 1 12 0" />' +
      '<circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none" />',
  },
  r: {
    label: 'Repeater',
    paths:
      '<path d="M12 4v16M8.5 20h7" /><path d="M8.5 8a5 5 0 0 1 7 0M6 6a8 8 0 0 1 12 0" />' +
      '<circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none" />',
  },
  n: {
    label: 'Node',
    paths:
      '<path d="M12 4v16M8.5 20h7" /><path d="M8.5 8a5 5 0 0 1 7 0M6 6a8 8 0 0 1 12 0" />' +
      '<circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none" />',
  },
  y: {
    label: 'Yagi antenna',
    paths: '<path d="M4 12h16M8 8v8M12 6v12M16 9v6M20 11v2" />',
  },
  '&': {
    label: 'Gateway',
    paths:
      '<circle cx="12" cy="12" r="8" /><path d="M4 12h16" />' +
      '<path d="M12 4c2.6 2.4 2.6 13.2 0 16M12 4c-2.6 2.4-2.6 13.2 0 16" />',
  },
  I: {
    label: 'Internet gateway',
    paths:
      '<circle cx="12" cy="12" r="8" /><path d="M4 12h16" />' +
      '<path d="M12 4c2.6 2.4 2.6 13.2 0 16M12 4c-2.6 2.4-2.6 13.2 0 16" />',
  },
  i: {
    label: 'Internet gateway',
    paths:
      '<circle cx="12" cy="12" r="8" /><path d="M4 12h16" />' +
      '<path d="M12 4c2.6 2.4 2.6 13.2 0 16M12 4c-2.6 2.4-2.6 13.2 0 16" />',
  },
  _: {
    centre: [11.83, 13.28],
    label: 'Weather station',
    paths:
      '<path d="M8 16h8a3.2 3.2 0 0 0 .4-6.4A4.5 4.5 0 0 0 8 8.5 3.5 3.5 0 0 0 8 16z" />' +
      '<path d="M9 19l-.6 1.5M13 19l-.6 1.5" />',
  },
  W: {
    centre: [11.83, 13.28],
    label: 'Weather service',
    paths:
      '<path d="M8 16h8a3.2 3.2 0 0 0 .4-6.4A4.5 4.5 0 0 0 8 8.5 3.5 3.5 0 0 0 8 16z" />' +
      '<path d="M9 19l-.6 1.5M13 19l-.6 1.5" />',
  },
  O: {
    centre: [12.0, 11.0],
    label: 'Balloon',
    paths:
      '<path d="M12 3a6 6 0 0 1 6 6c0 3.6-3 6.2-6 8-3-1.8-6-4.4-6-8a6 6 0 0 1 6-6z" />' +
      '<path d="M10.5 16.5l.7 2.5h1.6l.7-2.5M10.5 19h3" />',
  },
  h: {
    label: 'Hospital',
    paths: '<rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" />',
  },
  '!': {
    label: 'Police',
    paths:
      '<path d="M12 3l7 2.5v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10v-5L12 3z" />' +
      '<path d="M9.5 12l1.7 1.7 3.3-3.4" />',
  },
  ':': {
    centre: [12.0, 9.0],
    label: 'Fire',
    paths:
      '<path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3.2 2-4.2.3 1 .9 1.6 1.6 1.9C15 6.2 12 5 12 3z" />',
  },
  f: {
    centre: [11.25, 13.3],
    label: 'Fire truck',
    paths:
      '<path d="M2.5 8h10v8.5h-10z" /><path d="M12.5 11h4l3.5 3.5v2h-7.5z" />' +
      '<circle cx="6" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" />' +
      '<path d="M4.5 11h6" />',
  },
  '[': {
    label: 'Person',
    paths:
      '<circle cx="12" cy="5.5" r="2" /><path d="M12 8v6M12 10l-3.5 2M12 10l3.5 1M12 14l-2.5 5M12 14l2.5 5" />',
  },
  L: {
    label: 'Computer user',
    paths: '<path d="M5 6h14v9H5z" /><path d="M3 18h18l-1.5-3H4.5z" />',
  },
  l: {
    label: 'Laptop',
    paths: '<path d="M5 6h14v9H5z" /><path d="M3 18h18l-1.5-3H4.5z" />',
  },
  $: {
    label: 'Phone',
    paths: '<rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 18h3" />',
  },
}

/** Middle of the 24-unit viewBox every icon is drawn in. */
const ICON_VIEWBOX_CENTRE = 12

/**
 * Shift an icon's artwork so it sits centred in the viewBox.
 *
 * Icons that are already centred are returned untouched, so the common case
 * adds no wrapper element.
 */
function centreArtwork(icon: AprsSymbolIcon): AprsSymbolIcon {
  if (!icon.centre) return icon
  const shiftX = Math.round((ICON_VIEWBOX_CENTRE - icon.centre[0]) * 100) / 100
  const shiftY = Math.round((ICON_VIEWBOX_CENTRE - icon.centre[1]) * 100) / 100
  return { ...icon, paths: `<g transform="translate(${shiftX},${shiftY})">${icon.paths}</g>` }
}

/**
 * Resolve an APRS symbol code to its icon, falling back to a generic beacon.
 *
 * The returned artwork is centred: every consumer draws the icon inside a
 * square — a map label's glyph well, the decode table's cell — where an icon
 * sitting low or off to one side reads as a mistake.
 */
export function aprsSymbolIcon(symbol: string | null | undefined): AprsSymbolIcon {
  if (!symbol) return FALLBACK_SYMBOL
  const code = symbol.length >= 2 ? symbol[1] : symbol[0]
  return centreArtwork(SYMBOLS[code] ?? FALLBACK_SYMBOL)
}

export interface AprsSymbolSvgOptions {
  size?: number
  color?: string
  strokeWidth?: number
}

/**
 * Build a complete, self-contained SVG string for an APRS symbol — used for the
 * map markers (DOM string). ``color`` drives both stroke and any filled parts
 * (via ``currentColor``). The table uses the :class:`SdrAprsSymbol` component
 * instead, which inherits colour from the surrounding text.
 */
export function aprsSymbolSvg(
  symbol: string | null | undefined,
  options: AprsSymbolSvgOptions = {},
): string {
  const { size = 20, color = 'currentColor', strokeWidth = 1.8 } = options
  const icon = aprsSymbolIcon(symbol)
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `style="color:${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ` +
    `role="img" aria-label="${icon.label}">${icon.paths}</svg>`
  )
}
