import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Cross-file design-token invariants that no component test can see.
 *
 * The SENTINEL logo mark's outer ring and its wordmark are one colour — white
 * — but the logo is a standalone SVG whose wordmark is outlined paths, so the
 * ring stroke and the path fill are two separate literals in the same file.
 * Recolour one without the other and it goes red.
 */
describe('design tokens', () => {
  it('keeps the logo mark’s outer ring the same white as the wordmark', () => {
    // Paths resolve from the vitest root (frontend/vue) up to the repo-level
    // frontend/assets — import.meta.url is http-scheme under jsdom, so it
    // can't be used to locate the files.
    const logoSvg = readFileSync(resolve(process.cwd(), '../../frontend/assets/logo.svg'), 'utf8')

    // The mark's ring is the only stroked circle in the logo; the wordmark is
    // the only <path>.
    const logoRingStroke = logoSvg.match(/<circle[^>]*stroke="(#[0-9a-fA-F]{6})"/)?.[1]
    const wordmarkFill = logoSvg.match(/<path[^>]*fill="(#[0-9a-fA-F]{6})"/)?.[1]

    expect(logoRingStroke).toBeDefined()
    expect(wordmarkFill).toBeDefined()
    expect(logoRingStroke?.toLowerCase()).toBe('#ffffff')
    expect(logoRingStroke?.toLowerCase()).toBe(wordmarkFill?.toLowerCase())
  })

  it('keeps the favicon’s ring the same white as the logo mark', () => {
    // The favicon is the same ⊙ mark on a tile; the raster variants
    // (favicon-16/32.png, favicon.ico, apple-touch-icon.png) are generated
    // from this SVG, so guarding the source covers them.
    const faviconSvg = readFileSync(
      resolve(process.cwd(), '../../frontend/assets/favicon.svg'),
      'utf8',
    )

    // The ring is the only stroked circle; the inner dot is filled, not stroked.
    const faviconRingStroke = faviconSvg.match(/<circle[^>]*stroke="(#[0-9a-fA-F]{6})"/)?.[1]

    expect(faviconRingStroke).toBeDefined()
    expect(faviconRingStroke?.toLowerCase()).toBe('#ffffff')
  })
})
