import { describe, it, expect } from 'vitest'
import { axe } from 'jest-axe'
import {
  buildCountMarker,
  COUNT_MARKER_CENTRE_PX,
  COUNT_MARKER_RING_PX,
  COUNT_MARKER_SIZE_PX,
  formatCount,
  groupByProximity,
  type ClusterablePoint,
  type ScreenPosition,
} from './mapCluster'

interface TestPoint extends ClusterablePoint {
  key: string
}

/** Build the points + projected positions `groupByProximity` takes, from a map
 *  of key → screen position. */
function pointsAt(positions: Record<string, [number, number]>): {
  points: TestPoint[]
  screen: Map<string, ScreenPosition>
} {
  const screen = new Map<string, ScreenPosition>()
  const points = Object.entries(positions).map(([key, [x, y]]) => {
    screen.set(key, { x, y })
    return { key }
  })
  return { points, screen }
}

const OPTIONS = {
  ariaLabel: '3 things here',
  className: 'test-cluster',
  countClassName: 'test-cluster-count',
  ringColor: 'rgba(0, 0, 0, 0.5)',
  fillColor: '#000000',
  textColor: '#c8ff00',
}

describe('groupByProximity', () => {
  it('returns no groups for no points', () => {
    expect(groupByProximity([], new Map(), 30)).toEqual([])
  })

  it('leaves points further apart than the radius in groups of their own', () => {
    const { points, screen } = pointsAt({ a: [0, 0], b: [500, 500] })
    const clusters = groupByProximity(points, screen, 30)
    expect(clusters).toHaveLength(2)
    expect(clusters.map((cluster) => cluster.key)).toEqual(['a', 'b'])
    expect(clusters[0]!.members).toEqual([{ key: 'a' }])
    expect(clusters[0]!.position).toEqual({ x: 0, y: 0 })
  })

  it('groups points closer together than the radius', () => {
    const { points, screen } = pointsAt({ a: [0, 0], b: [10, 10] })
    const clusters = groupByProximity(points, screen, 30)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.members.map((member) => member.key)).toEqual(['a', 'b'])
    // The group takes the first member's identity and position.
    expect(clusters[0]!.key).toBe('a')
    expect(clusters[0]!.position).toEqual({ x: 0, y: 0 })
  })

  it('chains single-linkage: A near B and B near C makes one group', () => {
    // A↔C is 40px apart — beyond the radius — but B bridges them.
    const { points, screen } = pointsAt({ a: [0, 0], b: [20, 0], c: [40, 0] })
    const clusters = groupByProximity(points, screen, 30)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.members.map((member) => member.key)).toEqual(['a', 'b', 'c'])
  })

  it('merges the groups a later point bridges, leaving no duplicate group', () => {
    // A and C start as separate groups; B, arriving last, touches both.
    const { points, screen } = pointsAt({ a: [0, 0], c: [40, 0], b: [20, 0] })
    const clusters = groupByProximity(points, screen, 30)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.key).toBe('a')
    expect(clusters[0]!.members.map((member) => member.key).sort()).toEqual(['a', 'b', 'c'])
  })

  it('treats a point exactly at the radius as too far to group (exclusive bound)', () => {
    const { points, screen } = pointsAt({ a: [0, 0], b: [30, 0] })
    expect(groupByProximity(points, screen, 30)).toHaveLength(2)
    // …and a hair inside it as close enough.
    const near = pointsAt({ a: [0, 0], b: [29.9, 0] })
    expect(groupByProximity(near.points, near.screen, 30)).toHaveLength(1)
  })

  it('groups coincident points', () => {
    const { points, screen } = pointsAt({ a: [12, 12], b: [12, 12] })
    expect(groupByProximity(points, screen, 30)).toHaveLength(1)
  })
})

describe('formatCount', () => {
  it('shows the figure itself up to the cap', () => {
    expect(formatCount(1)).toBe('1')
    expect(formatCount(99)).toBe('99')
  })

  it('caps anything past the cap at "99+"', () => {
    expect(formatCount(100)).toBe('99+')
    expect(formatCount(4321)).toBe('99+')
  })
})

describe('buildCountMarker', () => {
  it('draws the count on a button carrying the given name and classes', () => {
    const marker = buildCountMarker({ ...OPTIONS, count: 3 })
    expect(marker.tagName).toBe('BUTTON')
    expect(marker.getAttribute('type')).toBe('button')
    expect(marker.className).toBe('test-cluster')
    expect(marker.getAttribute('aria-label')).toBe('3 things here')
    const centre = marker.querySelector('.test-cluster-count')
    expect(centre?.textContent).toBe('3')
  })

  it('sizes the ring so it meets the centre exactly', () => {
    const marker = buildCountMarker({ ...OPTIONS, count: 2 })
    const centre = marker.querySelector<HTMLElement>('.test-cluster-count')!
    expect(marker.style.width).toBe(`${COUNT_MARKER_SIZE_PX}px`)
    expect(marker.style.height).toBe(marker.style.width) // square, so the ring is a circle
    expect(centre.style.width).toBe(`${COUNT_MARKER_CENTRE_PX}px`)
    expect(COUNT_MARKER_SIZE_PX - COUNT_MARKER_RING_PX * 2).toBe(COUNT_MARKER_CENTRE_PX)
  })

  it("paints the caller's colours, and no fill of its own behind the ring", () => {
    const marker = buildCountMarker({ ...OPTIONS, count: 5 })
    const centre = marker.querySelector<HTMLElement>('.test-cluster-count')!
    expect(marker.style.border).toContain('rgba(0, 0, 0, 0.5)')
    // No backing disc behind the ring: `background:none` leaves no colour, so
    // the map shows through the ring rather than a filled circle.
    expect(marker.style.backgroundColor).toBe('')
    expect(centre.style.background).toBe('rgb(0, 0, 0)')
    expect(centre.style.color).toBe('rgb(200, 255, 0)')
  })

  it('drops to a smaller face for a three-character count', () => {
    const twoChars = buildCountMarker({ ...OPTIONS, count: 42 })
    const threeChars = buildCountMarker({ ...OPTIONS, count: 100 })
    expect(twoChars.querySelector<HTMLElement>('.test-cluster-count')!.style.fontSize).toBe('13px')
    expect(threeChars.querySelector<HTMLElement>('.test-cluster-count')!.style.fontSize).toBe(
      '10px',
    )
  })

  it('keeps the true figure in the accessible name when the face is capped', () => {
    const marker = buildCountMarker({ ...OPTIONS, count: 250, ariaLabel: '250 things here' })
    expect(marker.querySelector('.test-cluster-count')!.textContent).toBe('99+')
    expect(marker.getAttribute('aria-label')).toBe('250 things here')
  })

  it('has no accessibility violations', async () => {
    const host = document.createElement('div')
    host.appendChild(buildCountMarker({ ...OPTIONS, count: 3 }))
    expect(await axe(host)).toHaveNoViolations()
  })
})
