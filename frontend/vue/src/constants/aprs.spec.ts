import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { APRS_ACCENT_COLOR, APRS_BADGE_BACKGROUND } from './aprs'

/**
 * Cross-file invariants for the APRS label palette that no component test can
 * see — the same guard `assets/designTokens.spec.ts` provides for the button
 * grey and the logo mark.
 *
 * Marker elements are handed to MapLibre and live outside the Vue tree, so they
 * cannot read a CSS custom property; the values here are duplicated out of
 * necessity. Recolour one side without the other and this goes red.
 */
describe('APRS label palette', () => {
  it('matches the sidebar list background it is meant to sit with', () => {
    const sidebarCss = readFileSync(
      resolve(process.cwd(), 'src/components/shared/MapSidebar.vue'),
      'utf8',
    )
    // #map-sidebar is the panel the stations are listed in.
    const panelBackground = sidebarCss
      .match(/#map-sidebar\s*\{[^}]*\}/)?.[0]
      .match(/background:\s*rgba\((\d+),\s*(\d+),\s*(\d+)/)
    expect(panelBackground).not.toBeNull()

    const [red, green, blue] = panelBackground!.slice(1, 4).map(Number)
    const asHex = `#${[red, green, blue].map((channel) => channel!.toString(16).padStart(2, '0')).join('')}`
    expect(APRS_BADGE_BACKGROUND).toBe(asHex)
  })

  it('keeps label text and glyphs white, so colour stays meaningful on the maps', () => {
    // The Air domain uses hue to signal military / civil / emergency; Land must
    // not introduce a competing accent.
    expect(APRS_ACCENT_COLOR).toBe('#ffffff')
  })
})
