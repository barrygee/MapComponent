/**
 * Shared proximity clustering for map markers.
 *
 * Two map layers now face the same problem — APRS stations on Land, and Sentry
 * sites on every domain map: several points close enough together that their
 * markers land on top of each other and the map reads as holding fewer things
 * than it does. Both answer it the same way, with one numbered marker standing
 * for the huddle that opens when clicked, so the grouping rule and the marker
 * that draws it live here rather than in either caller.
 *
 * Deliberately screen-space, not geographic: whether two markers collide is a
 * question about pixels at the current zoom, so callers project their points
 * and pass the results in.
 */

/** A point that can be clustered: anything with a stable key. */
export interface ClusterablePoint {
  /** Identity of the point, stable across polls. */
  key: string
}

/** Where a point landed on screen, in pixels. */
export interface ScreenPosition {
  x: number
  y: number
}

/** A group of points whose markers would land on top of each other. */
export interface PointCluster<TPoint extends ClusterablePoint> {
  /** Identity of the group — the first member's key, stable while its membership is. */
  key: string
  /** The points in the group, in the order they were given. */
  members: TPoint[]
  /** Where the count sits — the first member's position. */
  position: ScreenPosition
}

/**
 * Gather points into groups by how close they are on screen.
 *
 * Single-linkage within `radiusPx`: if A is beside B and B beside C, the three
 * are one huddle and belong under one count. The radius is the caller's to
 * choose, and should be the count marker's own width — that keeps each group to
 * what a single marker can honestly cover, and stops two counts landing on top
 * of each other.
 */
export function groupByProximity<TPoint extends ClusterablePoint>(
  points: TPoint[],
  positions: Map<string, ScreenPosition>,
  radiusPx: number,
): PointCluster<TPoint>[] {
  const isNear = (left: TPoint, right: TPoint): boolean => {
    const from = positions.get(left.key)!
    const to = positions.get(right.key)!
    return Math.hypot(from.x - to.x, from.y - to.y) < radiusPx
  }

  const clusters: PointCluster<TPoint>[] = []
  for (const point of points) {
    const touching = clusters.filter((cluster) =>
      cluster.members.some((member) => isNear(member, point)),
    )
    if (touching.length === 0) {
      clusters.push({ key: point.key, members: [point], position: positions.get(point.key)! })
      continue
    }
    // The point bridges every group it touches, so they all become one.
    const [first, ...rest] = touching as [PointCluster<TPoint>, ...PointCluster<TPoint>[]]
    first.members.push(point)
    for (const merged of rest) {
      first.members.push(...merged.members)
      clusters.splice(clusters.indexOf(merged), 1)
    }
  }
  return clusters
}

/**
 * Largest count shown as a number; beyond it the marker reads "99+".
 *
 * The marker is a fixed circle, so the text has to fit it — and past a hundred
 * the exact figure tells an operator nothing the "+" does not. Capping the
 * displayed text rather than the group keeps every point inside one marker;
 * splitting a huddle into several 99s would just stack markers on one spot.
 */
const MAX_DISPLAYED_COUNT = 99

/** Text for a count marker, capped so it always fits the circle. */
export function formatCount(count: number): string {
  return count > MAX_DISPLAYED_COUNT ? `${MAX_DISPLAYED_COUNT}+` : String(count)
}

/** Width of the ring around a count marker, in pixels. */
export const COUNT_MARKER_RING_PX = 6

/** Diameter of the filled centre the count sits on, in pixels. */
export const COUNT_MARKER_CENTRE_PX = 20

/** Diameter of a count marker, in pixels — the ring's outer edge. Derived, so
 *  the ring always meets the centre exactly: no gap, whatever the two are set
 *  to. */
export const COUNT_MARKER_SIZE_PX = COUNT_MARKER_CENTRE_PX + COUNT_MARKER_RING_PX * 2

/** How the caller wants its count marker to look and be announced. */
export interface CountMarkerOptions {
  /** How many points the marker stands for. Announced in full, drawn capped. */
  count: number
  /** The marker's accessible name — it is the only thing on the map
   *  representing those points, so it has to say what they are. */
  ariaLabel: string
  /** Class hook for the caller's own styling and for tests to find it by. */
  className: string
  /** Class for the inner count disc — its own hook, since a layer's marker and
   *  its count are styled separately. */
  countClassName: string
  /** Ring colour. Semitransparent by convention, so a group never blanks out
   *  the ground it stands over. */
  ringColor: string
  /** Fill of the centre disc the count sits on. */
  fillColor: string
  /** Colour of the count itself. */
  textColor: string
}

/**
 * The marker standing for a group of points too close together to draw apart.
 *
 * Built like the user-location marker — a broad ring sitting flush against a
 * filled centre — so a marker that stands for a place reads the same wherever
 * it appears. Colours are the caller's, since what the group *is* differs
 * between layers.
 *
 * A `<button>`, unlike a plain label: it takes pointer events so a click can
 * zoom in to reveal what it stands for, and it is reachable and operable from
 * the keyboard.
 */
export function buildCountMarker(options: CountMarkerOptions): HTMLElement {
  const text = formatCount(options.count)
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.className = options.className
  // The name carries the true figure even when the face is capped: a screen
  // reader has room for it where the circle does not.
  marker.setAttribute('aria-label', options.ariaLabel)
  marker.style.cssText = [
    `width:${COUNT_MARKER_SIZE_PX}px`,
    `height:${COUNT_MARKER_SIZE_PX}px`,
    'box-sizing:border-box',
    'padding:0',
    `border:${COUNT_MARKER_RING_PX}px solid ${options.ringColor}`,
    'border-radius:50%',
    // No fill of its own: the ring is the border alone, and it blends with the
    // map behind it rather than with a backing disc.
    'background:none',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'pointer-events:auto',
  ].join(';')

  const centre = document.createElement('span')
  centre.className = options.countClassName
  centre.style.cssText = [
    `width:${COUNT_MARKER_CENTRE_PX}px`,
    `height:${COUNT_MARKER_CENTRE_PX}px`,
    'border-radius:50%',
    `background:${options.fillColor}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `color:${options.textColor}`,
    "font-family:'Barlow Condensed','Barlow',sans-serif",
    // Three characters ("99+") need a smaller face to keep clear of the disc's
    // edge; one or two have room at full size.
    `font-size:${text.length > 2 ? 10 : 13}px`,
    // The same weight a map label carries, so a count reads as part of the same
    // set rather than as an alert.
    'font-weight:400',
    'letter-spacing:.04em',
    // The count is centred on the disc rather than filling it, so it never
    // touches the edge however many digits it runs to.
    'line-height:1',
  ].join(';')
  centre.textContent = text
  marker.appendChild(centre)
  return marker
}
