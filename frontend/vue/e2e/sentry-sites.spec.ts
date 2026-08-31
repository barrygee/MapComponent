import { test, expect, type Page } from '@playwright/test'
import { waitForShellHydration } from './support/hydrationGate'
import { installDefaultMocks } from './support/mockApi'
import { clearPersistedState } from './support/seedStore'

/**
 * Sentry sites on the domain maps (`SentrySitesControl`).
 *
 * These live in the browser suite rather than in vitest because what they check
 * is layout: where a marker actually lands on screen, and whether its details
 * panel can be opened by pointer. jsdom has neither a projection nor a layout
 * engine, so a unit test cannot see either — the marker-position bug these
 * guard against (a `position` declaration that took MapLibre's own positioning
 * away and left every marker after the first 60px down the page from its own
 * coordinates) passed the whole vitest suite.
 */

const SITES = [
  {
    id: 1,
    name: 'Gateshead',
    address: '192.168.5.67',
    port: 8000,
    reachable: true,
    latitude: 54.951186,
    longitude: -1.532995,
    updated_at: 1,
  },
  {
    id: 2,
    name: 'Barn Pi',
    address: '192.168.5.68',
    port: 8000,
    reachable: false,
    latitude: 52.5,
    longitude: -1.9,
    updated_at: 1,
  },
]

/** Largest gap tolerated between a marker's drawn centre and its true position,
 *  in pixels — allows for sub-pixel rounding, nothing more. */
const POSITION_TOLERANCE_PX = 2

/**
 * A blank but valid MapLibre style, stubbed in for the basemap.
 *
 * The real styles live under `/assets/`, which the FastAPI backend serves and
 * `vite preview` does not — so on a machine running the backend they arrive
 * through the dev proxy and everywhere else (CI included) they never load, the
 * map's `style.load` never fires, and no map control is ever created. Stubbing
 * the style makes that the same everywhere; these tests are about marker
 * placement, and the basemap underneath is irrelevant to it.
 */
const BLANK_MAP_STYLE = {
  version: 8,
  name: 'test-blank',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#2d3548' } }],
}

async function openMapWithSites(page: Page): Promise<void> {
  await clearPersistedState(page)
  await installDefaultMocks(page)
  await page.route('**/assets/fiord*.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(BLANK_MAP_STYLE) }),
  )
  await page.route('**/api/sdr/sentry-hosts/locations', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SITES) }),
  )
  await page.goto('/air/')
  await waitForShellHydration(page)
  await expect(page.locator('.sentry-map-marker')).toHaveCount(SITES.length)
}

/**
 * How far each marker's drawn ⊙ sits from where its coordinates project to, in
 * screen pixels, after jumping the map to `zoom`.
 */
async function markerOffsets(page: Page, zoom: number): Promise<{ dx: number; dy: number }[]> {
  return page.evaluate(
    async ({ sites, zoomLevel }) => {
      // The domain views assign the live map to `window.map`.
      const map = (window as unknown as { map: maplibregl.Map }).map
      map.jumpTo({ center: [sites[0]!.longitude, sites[0]!.latitude], zoom: zoomLevel })
      await new Promise((resolve) => setTimeout(resolve, 300))
      const container = map.getContainer().getBoundingClientRect()
      return [...document.querySelectorAll('.sentry-map-marker')].map((marker, index) => {
        const ring = marker.querySelector('svg circle')!.getBoundingClientRect()
        const site = sites[index]!
        const projected = map.project([site.longitude, site.latitude])
        return {
          dx: ring.left + ring.width / 2 - container.left - projected.x,
          dy: ring.top + ring.height / 2 - container.top - projected.y,
        }
      })
    },
    { sites: SITES, zoomLevel: zoom },
  )
}

test.describe('Sentry sites on the map', () => {
  test('every marker sits on its own coordinates, at every zoom', async ({ page }) => {
    await openMapWithSites(page)

    // Zoomed in and zoomed out: an offset in screen pixels is a small error up
    // close and a wild one from far away, which is how the original bug showed.
    for (const zoom of [11, 8, 5]) {
      const offsets = await markerOffsets(page, zoom)
      expect(offsets).toHaveLength(SITES.length)
      for (const [index, offset] of offsets.entries()) {
        expect(
          Math.abs(offset.dx),
          `marker ${index} horizontal offset at zoom ${zoom}`,
        ).toBeLessThan(POSITION_TOLERANCE_PX)
        expect(Math.abs(offset.dy), `marker ${index} vertical offset at zoom ${zoom}`).toBeLessThan(
          POSITION_TOLERANCE_PX,
        )
      }
    }
  })

  test('a site shows its details on hover, position included', async ({ page }) => {
    await openMapWithSites(page)
    const marker = page.locator('.sentry-map-marker').first()
    const details = page.locator('.sentry-map-marker-info').first()

    await expect(details).toBeHidden()
    await marker.hover()
    await expect(details).toBeVisible()
    // Case-insensitive: the name is uppercased by CSS, not in the DOM.
    await expect(details).toContainText(/gateshead/i)
    await expect(details).toContainText('192.168.5.67:8000')
    await expect(details).toContainText('54.95119° N')
    await expect(details).toContainText('1.53300° W')
  })

  test('clicking the marker opens that host in the SDR settings section', async ({ page }) => {
    await openMapWithSites(page)
    // The details panel starts at the mark's own centre with a circle masked out
    // of it, and a mask hides pixels without giving up pointer events — so this
    // also catches the panel swallowing a click meant for the mark.
    await page.locator('.sentry-map-marker').first().click()

    const settings = page.getByRole('dialog', { name: /settings/i })
    await expect(settings).toBeVisible()
    await expect(settings).toContainText('SDR SETTINGS')
  })

  test('a crowded map shows a count until it is zoomed in', async ({ page }) => {
    await openMapWithSites(page)
    // Far enough out that the two sites land on top of each other.
    await page.evaluate(() => {
      const map = (window as unknown as { map: maplibregl.Map }).map
      map.jumpTo({ center: [-1.7, 53.7], zoom: 2 })
    })
    const counts = page.locator('.sentry-cluster-marker')
    await expect(counts).toHaveCount(1)
    await expect(counts.first()).toHaveText('2')
    await expect(page.locator('.sentry-map-marker')).toHaveCount(0)

    // One click on the count is enough to take the group apart.
    await counts.first().click()
    await expect(page.locator('.sentry-map-marker')).toHaveCount(2)
    await expect(counts).toHaveCount(0)
  })
})
