/**
 * Shared building blocks for Sentinel's on-map data labels ("pills").
 *
 * Every domain draws the same chrome — a black flex row of stretch-height
 * segments in condensed uppercase type, led by a glyph well that sits on the
 * leading edge of travel, with the remaining segments mirrored when the target
 * is heading left. Only the *data* differs: aircraft show callsign/type/altitude
 * from ADS-B, APRS stations show callsign/symbol/path from their beacon.
 *
 * This module owns the presentation and the direction handling; each domain's
 * control composes its own segments from these parts. It deliberately knows
 * nothing about aircraft, stations, or any store.
 *
 * Styling is applied as inline `cssText` rather than classes because these
 * elements are handed to MapLibre `Marker`s, which live outside the Vue
 * component tree (and therefore outside scoped-style rewriting).
 */

/** Height of the pill and the square glyph well, in pixels. */
export const MAP_LABEL_SIZE_PX = 26

/** Rendered size of the glyph inside the well, in pixels. Every domain draws at
 *  this size so an aircraft arrow and an APRS symbol read as one icon family.
 *  Sized against the label's 14px type rather than the 26px well, which carries
 *  its own padding. */
export const MAP_LABEL_GLYPH_SIZE_PX = 15

/** Shared type stack for every label segment. */
const MAP_LABEL_FONT_STACK = "'Barlow Condensed','Barlow',sans-serif"

/**
 * Which side of the pill a segment sits on, relative to the glyph well —
 * or `standalone` when there is no glyph and both edges are outer edges.
 */
export type MapLabelSide = 'left' | 'right' | 'standalone'

/**
 * Create the pill container: the black, stretch-aligned flex row that holds
 * every other segment.
 *
 * @param background - Row background; defaults to solid black. Callers override
 *   it to signal an alarm state (e.g. an emergency squawk).
 */
export function createLabelPill(background = '#000000'): HTMLDivElement {
  const pill = document.createElement('div')
  pill.style.cssText = [
    `background:${background}`,
    'color:#ffffff',
    `font-family:${MAP_LABEL_FONT_STACK}`,
    'font-size:14px',
    'font-weight:400',
    'letter-spacing:.12em',
    'text-transform:uppercase',
    'box-sizing:border-box',
    'display:flex',
    'align-items:stretch',
    'gap:0',
    'padding:0',
    'cursor:pointer',
    'white-space:nowrap',
    'user-select:none',
    `min-height:${MAP_LABEL_SIZE_PX}px`,
    `min-width:${MAP_LABEL_SIZE_PX}px`,
  ].join(';')
  return pill
}

/**
 * Wrap glyph markup in the square well that leads the pill.
 *
 * @param glyphMarkup - Inner markup, normally the output of {@link createGlyphSvg}.
 * @param background - Well background; defaults to transparent so the pill's own
 *   background shows through.
 */
export function createGlyphWell(glyphMarkup: string, background = 'none'): HTMLSpanElement {
  const well = document.createElement('span')
  // The class is load-bearing for existing air-domain CSS and e2e selectors.
  well.className = 'adsb-arrow-wrap'
  well.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `width:${MAP_LABEL_SIZE_PX}px`,
    'align-self:stretch',
    'flex-shrink:0',
    ...(background === 'none' ? [] : [`background:${background}`]),
  ].join(';')
  well.innerHTML = glyphMarkup
  return well
}

/**
 * Wrap a shape in the label's standard glyph `<svg>`, optionally rotated.
 *
 * `overflow:visible` matters: a rotated arrow's corners fall outside the 12×12
 * viewBox at some angles and would otherwise be clipped.
 *
 * @param shapeMarkup - SVG shape markup drawn in a 12×12 viewBox.
 * @param rotationDeg - Clockwise rotation applied about the shape's centre.
 */
export function createGlyphSvg(shapeMarkup: string, rotationDeg = 0): string {
  return (
    `<svg class="adsb-arrow" width="${MAP_LABEL_GLYPH_SIZE_PX}" height="${MAP_LABEL_GLYPH_SIZE_PX}" viewBox="0 0 12 12" ` +
    `style="transform:rotate(${rotationDeg}deg);transform-origin:center;transform-box:fill-box;` +
    `display:block;overflow:visible;flex-shrink:0" xmlns="http://www.w3.org/2000/svg">` +
    `${shapeMarkup}</svg>`
  )
}

/**
 * The directional arrowhead used for anything with a heading — aircraft track,
 * APRS course. Points north at 0°, so {@link createGlyphSvg} can rotate it
 * straight to the reported bearing.
 */
export function createDirectionArrowShape(color: string): string {
  return (
    `<polygon points="6,1 10,11 6,8.5 2,11" fill="none" stroke="${color}" ` +
    `stroke-width="1.5" stroke-linejoin="round"/>`
  )
}

/** A hollow ring, for targets that report a position but no meaningful heading. */
export function createHollowDotShape(color: string): string {
  return `<circle cx="6" cy="6" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/>`
}

/**
 * A map pin, for a marker that points at a place rather than a target — e.g.
 * the site marker shared by several co-located stations.
 *
 * The same teardrop-and-dot glyph as `LocationPinIcon.vue`, scaled from that
 * component's 24-unit viewBox into the 12-unit one these shapes use, so the two
 * read as the same icon wherever they appear together.
 */
export function createLocationPinShape(color: string): string {
  return (
    `<path d="M6 10.5s3.5-3.25 3.5-6a3.5 3.5 0 1 0-7 0c0 2.75 3.5 6 3.5 6Z" ` +
    `fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<circle cx="6" cy="4.5" r="1.15" fill="${color}"/>`
  )
}

/** A filled dot, for static targets (ground structures, fixed stations). */
export function createFilledDotShape(color: string): string {
  return `<circle cx="6" cy="6" r="3.5" fill="${color}" stroke="none"/>`
}

/**
 * The identity segment — callsign or station name — in the label's plain style.
 *
 * @param side - Which side of the glyph well the segment sits on; the outer edge
 *   gets the wider padding so the text never crowds the pill's end. `standalone`
 *   centres the text for a pill with no glyph, where both edges are outer.
 */
export function createNameSegment(
  text: string,
  side: MapLabelSide,
  color = '#ffffff',
): HTMLSpanElement {
  const segment = document.createElement('span')
  // Load-bearing for existing air-domain CSS and e2e selectors.
  segment.className = 'adsb-label-name'
  segment.textContent = text
  segment.style.cssText = `color:${color} !important;padding:${namePadding(side)};display:flex;align-items:center;`
  return segment
}

/**
 * Padding for a name segment.
 *
 * The trailing edge is set narrower than the leading one because the label's
 * `.12em` letter-spacing adds a gap after the final character (~1.7px at 14px)
 * that the leading edge has no counterpart for — matching the two numbers would
 * make the right side visibly heavier than the left.
 */
function namePadding(side: MapLabelSide): string {
  if (side === 'left') return '3px 6px 3px 12px'
  if (side === 'right') return '3px 10px 3px 6px'
  return '3px 10px 3px 12px'
}

/**
 * A labelled data segment — a dimmed field name followed by its value, e.g.
 * `ALT FL350`. The workhorse for optional telemetry fields.
 */
export function createDimBadge(label: string, value: string, color: string): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.style.cssText =
    `background:#000000;color:${color} !important;font-size:12px;font-weight:700;` +
    `padding:0 7px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;gap:4px;`
  badge.innerHTML =
    `<span style="opacity:0.45;font-weight:600;font-size:10px;letter-spacing:.12em">${label}</span>` +
    `<span>${value}</span>`
  return badge
}

/**
 * A solid, colour-filled chip used for the target's classification — aircraft
 * type for ADS-B, symbol type for APRS. Its fill is what makes a domain (or a
 * civil/military split) recognisable at a glance.
 */
export function createAccentBadge(
  text: string,
  background: string,
  color: string,
): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.textContent = text
  badge.style.cssText =
    `background:${background};color:${color} !important;font-size:12px;font-weight:700;` +
    `padding:0 7px;letter-spacing:.05em;align-self:stretch;display:flex;align-items:center;`
  return badge
}

/**
 * Whether a target on this bearing is travelling leftward across the screen, in
 * which case the pill is mirrored so the glyph stays on the leading edge and the
 * data trails behind it.
 *
 * Due north (0°) and due south (180°) are ambiguous; 0° reads as right-facing
 * and 180° as left-facing, matching the long-standing air-domain behaviour.
 */
export function isLeftFacing(bearing: number): boolean {
  const normalised = ((bearing % 360) + 360) % 360
  return normalised >= 1 && normalised <= 189
}

/**
 * Append segments to the pill in leading-edge order.
 *
 * `segments` is given as it reads for a right-facing target — glyph well first,
 * then each field outward. For a left-facing target the same list is appended in
 * reverse, which mirrors the pill about the glyph. Nulls are skipped so callers
 * can express "this field is switched off, or has no value" inline.
 */
export function appendMirrored(
  pill: HTMLElement,
  segments: Array<HTMLElement | null>,
  leftFacing: boolean,
): void {
  const ordered = leftFacing ? [...segments].reverse() : segments
  for (const segment of ordered) {
    if (segment) pill.appendChild(segment)
  }
}
