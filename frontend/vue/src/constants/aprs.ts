/**
 * Shared APRS presentation constants for the Land domain.
 *
 * APRS map labels are deliberately monochrome — white glyph and text on the
 * pill's black, with the symbol chip in the app's standard grey. The Air domain
 * uses colour to carry meaning (lime for military, blue for civil, red for an
 * emergency squawk), so leaving Land uncoloured keeps colour meaningful rather
 * than decorative. Contrast is 21:1 for the text and 13:1 for the chip.
 */

/** Glyph and text colour for APRS station labels on the map. */
export const APRS_ACCENT_COLOR = '#ffffff'

/**
 * Fill behind the APRS symbol-type chip. Matches `--color-button-bg` in
 * `frontend/assets/template.css` — the shared grey used by the map rails —
 * since a marker element lives outside Vue and can't read the custom property.
 */
export const APRS_BADGE_BACKGROUND = '#26292e'
