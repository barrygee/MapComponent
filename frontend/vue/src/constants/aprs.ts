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
 * Fill behind the APRS symbol icon and its type chip.
 *
 * The same charcoal as the sidebar list the stations are listed in
 * (`#map-sidebar` in `MapSidebar.vue`, `rgba(21, 23, 29, 0.98)`), so a label
 * and its row read as one surface. Duplicated as a hex rather than read from
 * the custom property because marker elements are handed to MapLibre and live
 * outside the Vue tree; `aprsStyle.spec.ts` guards the two staying in step.
 */
export const APRS_BADGE_BACKGROUND = '#15171d'
