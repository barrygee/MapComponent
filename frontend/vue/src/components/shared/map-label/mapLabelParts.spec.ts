import { describe, it, expect } from 'vitest'
import {
  appendMirrored,
  createAccentBadge,
  createDimBadge,
  createDirectionArrowShape,
  createFilledDotShape,
  createGlyphSvg,
  createGlyphWell,
  createHollowDotShape,
  createLabelPill,
  createLocationPinShape,
  createNameSegment,
  isLeftFacing,
  MAP_LABEL_GLYPH_SIZE_PX,
  MAP_LABEL_SIZE_PX,
} from './mapLabelParts'

describe('mapLabelParts', () => {
  describe('createLabelPill', () => {
    it('builds a black stretch-aligned row at the standard label size', () => {
      const pill = createLabelPill()
      expect(pill.tagName).toBe('DIV')
      expect(pill.style.background).toBe('rgb(0, 0, 0)')
      expect(pill.style.display).toBe('flex')
      expect(pill.style.alignItems).toBe('stretch')
      expect(pill.style.minHeight).toBe(`${MAP_LABEL_SIZE_PX}px`)
      expect(pill.style.textTransform).toBe('uppercase')
    })

    it('takes an alarm background when one is supplied', () => {
      const pill = createLabelPill('rgba(180,0,0,0.85)')
      expect(pill.style.background).toBe('rgba(180, 0, 0, 0.85)')
    })
  })

  describe('createGlyphWell', () => {
    it('is a fixed-width square carrying the glyph markup', () => {
      const well = createGlyphWell('<svg id="glyph"></svg>')
      expect(well.style.width).toBe(`${MAP_LABEL_SIZE_PX}px`)
      expect(well.style.flexShrink).toBe('0')
      expect(well.querySelector('#glyph')).not.toBeNull()
    })

    it('keeps the class the air-domain CSS and e2e selectors depend on', () => {
      expect(createGlyphWell('').className).toBe('adsb-arrow-wrap')
    })

    it('is transparent by default and opaque when a background is given', () => {
      expect(createGlyphWell('').style.background).toBe('')
      expect(createGlyphWell('', '#000').style.background).toBe('rgb(0, 0, 0)')
    })
  })

  describe('createGlyphSvg', () => {
    it('is unrotated by default', () => {
      expect(createGlyphSvg('<circle/>')).toContain('rotate(0deg)')
    })

    it('applies the requested rotation about the shape centre', () => {
      const svg = createGlyphSvg('<circle/>', 275)
      expect(svg).toContain('rotate(275deg)')
      expect(svg).toContain('transform-origin:center')
    })

    it('lets a rotated shape overflow its viewBox rather than clipping it', () => {
      // A rotated arrowhead's corners fall outside the 12×12 box at some angles.
      expect(createGlyphSvg('<polygon/>', 45)).toContain('overflow:visible')
    })

    it('renders every domain’s glyph at the shared size', () => {
      // Air arrows and APRS symbols draw from this one constant, so they can
      // never end up different sizes on the same map.
      const svg = createGlyphSvg('<polygon/>')
      expect(svg).toContain(`width="${MAP_LABEL_GLYPH_SIZE_PX}"`)
      expect(svg).toContain(`height="${MAP_LABEL_GLYPH_SIZE_PX}"`)
      // Comfortably inside the well, which carries its own padding.
      expect(MAP_LABEL_GLYPH_SIZE_PX).toBeLessThan(MAP_LABEL_SIZE_PX)
    })

    it('embeds the shape markup it was given', () => {
      expect(createGlyphSvg('<polygon id="arrow"/>')).toContain('<polygon id="arrow"/>')
    })
  })

  describe('shapes', () => {
    it('draws the arrowhead pointing north so rotation maps to a bearing', () => {
      const shape = createDirectionArrowShape('#b07cff')
      // The apex (6,1) sits at top-centre of the 12×12 viewBox.
      expect(shape).toContain('points="6,1 10,11 6,8.5 2,11"')
      expect(shape).toContain('stroke="#b07cff"')
      expect(shape).toContain('fill="none"')
    })

    it('draws a hollow ring for targets without a heading', () => {
      const shape = createHollowDotShape('#00aaff')
      expect(shape).toContain('fill="none"')
      expect(shape).toContain('stroke="#00aaff"')
    })

    it('draws a map pin for a marker that points at a place', () => {
      // Matches LocationPinIcon.vue's teardrop-and-dot, scaled into the shared
      // 12-unit viewBox so the two read as the same icon.
      const shape = createLocationPinShape('#ffffff')
      expect(shape).toContain('stroke="#ffffff"')
      expect(shape).toContain('<circle cx="6" cy="4.5"')
      expect(shape).toContain('fill="none"')
    })

    it('draws a filled dot for static targets', () => {
      const shape = createFilledDotShape('#c8ff00')
      expect(shape).toContain('fill="#c8ff00"')
      expect(shape).toContain('stroke="none"')
    })
  })

  describe('createNameSegment', () => {
    it('renders the text and keeps the air-domain class name', () => {
      const segment = createNameSegment('TOM6EY', 'right')
      expect(segment.textContent).toBe('TOM6EY')
      expect(segment.className).toBe('adsb-label-name')
    })

    it('pads the outer edge more than the glyph edge, per side', () => {
      // Right-facing: glyph on the left, so the wide padding goes on the right.
      expect(createNameSegment('A', 'right').style.padding).toBe('3px 10px 3px 6px')
      expect(createNameSegment('A', 'left').style.padding).toBe('3px 6px 3px 12px')
    })

    it('balances both edges when the pill has no glyph to sit against', () => {
      expect(createNameSegment('A', 'standalone').style.padding).toBe('3px 10px 3px 12px')
    })

    it('trims the trailing edge to offset the label letter-spacing', () => {
      // The .12em tracking leaves a gap after the last character that the
      // leading edge has no counterpart for, so equal numbers would look
      // right-heavy. Every trailing edge is 2px narrower than its leading one.
      const standalone = createNameSegment('A', 'standalone').style
      expect(standalone.paddingRight).toBe('10px')
      expect(standalone.paddingLeft).toBe('12px')
      expect(createNameSegment('A', 'right').style.paddingRight).toBe('10px')
      expect(createNameSegment('A', 'left').style.paddingLeft).toBe('12px')
    })

    it('defaults to white and honours an override colour', () => {
      expect(createNameSegment('A', 'right').style.color).toBe('rgb(255, 255, 255)')
      expect(createNameSegment('A', 'right', '#ff4040').style.color).toBe('rgb(255, 64, 64)')
    })
  })

  describe('createDimBadge', () => {
    it('renders a dimmed label followed by its value', () => {
      const badge = createDimBadge('ALT', 'FL350', '#b07cff')
      expect(badge.textContent).toBe('ALTFL350')
      const [label, value] = Array.from(badge.querySelectorAll('span'))
      expect(label!.textContent).toBe('ALT')
      expect(label!.getAttribute('style')).toContain('opacity:0.45')
      expect(value!.textContent).toBe('FL350')
      expect(badge.style.color).toBe('rgb(176, 124, 255)')
    })
  })

  describe('createAccentBadge', () => {
    it('renders a filled chip in the given colours', () => {
      const badge = createAccentBadge('B738', '#002244', '#00aaff')
      expect(badge.textContent).toBe('B738')
      expect(badge.style.background).toBe('rgb(0, 34, 68)')
      expect(badge.style.color).toBe('rgb(0, 170, 255)')
    })
  })

  describe('isLeftFacing', () => {
    it('reads 1°–189° as travelling leftward', () => {
      expect(isLeftFacing(1)).toBe(true)
      expect(isLeftFacing(90)).toBe(true)
      expect(isLeftFacing(189)).toBe(true)
    })

    it('reads the remaining bearings as travelling rightward', () => {
      expect(isLeftFacing(0)).toBe(false)
      expect(isLeftFacing(190)).toBe(false)
      expect(isLeftFacing(275)).toBe(false)
      expect(isLeftFacing(359)).toBe(false)
    })

    it('normalises bearings outside 0–360, including negatives', () => {
      expect(isLeftFacing(450)).toBe(true) // 450 → 90
      expect(isLeftFacing(-90)).toBe(false) // -90 → 270
      expect(isLeftFacing(-270)).toBe(true) // -270 → 90
      expect(isLeftFacing(360)).toBe(false)
    })
  })

  describe('appendMirrored', () => {
    function segment(id: string): HTMLElement {
      const element = document.createElement('span')
      element.id = id
      return element
    }

    it('appends in the given order for a right-facing target', () => {
      const pill = createLabelPill()
      appendMirrored(pill, [segment('glyph'), segment('name'), segment('alt')], false)
      expect(Array.from(pill.children).map((child) => child.id)).toEqual(['glyph', 'name', 'alt'])
    })

    it('reverses the order for a left-facing target so the glyph leads', () => {
      const pill = createLabelPill()
      appendMirrored(pill, [segment('glyph'), segment('name'), segment('alt')], true)
      expect(Array.from(pill.children).map((child) => child.id)).toEqual(['alt', 'name', 'glyph'])
    })

    it('skips switched-off segments passed as null', () => {
      const pill = createLabelPill()
      appendMirrored(pill, [segment('glyph'), null, segment('alt')], false)
      expect(Array.from(pill.children).map((child) => child.id)).toEqual(['glyph', 'alt'])
    })

    it('leaves the caller list untouched when mirroring', () => {
      const pill = createLabelPill()
      const segments = [segment('glyph'), segment('name')]
      appendMirrored(pill, segments, true)
      expect(segments.map((each) => each!.id)).toEqual(['glyph', 'name'])
    })

    it('appends nothing for an empty list', () => {
      const pill = createLabelPill()
      appendMirrored(pill, [], false)
      expect(pill.children).toHaveLength(0)
    })
  })
})
