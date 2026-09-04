import { test, expect, type Page } from '@playwright/test'
import { waitForShellHydration } from './support/hydrationGate'
import { installDefaultMocks } from './support/mockApi'
import { clearPersistedState, seedAirReplayEnabled } from './support/seedStore'
import milClassificationFixture from './fixtures/adsb-mil-classification.json' with { type: 'json' }

/**
 * Air domain tests: map region, AirSideMenu expand/collapse, overlay buttons,
 * filter combobox, AIRCRAFT accordion, REPLAY tab gating.
 */

test.describe('Air domain', () => {
  test.beforeEach(async ({ page }) => {
    await clearPersistedState(page)
    await installDefaultMocks(page)
  })

  test('Air domain map has accessible region label', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    const mapRegion = page.getByRole('region', { name: /air domain map/i })
    await expect(mapRegion).toBeAttached()
  })

  test('AirSideMenu MAP LAYERS accordion expands on click', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // The rail no longer expands/collapses; overlays live in a MAP LAYERS
    // accordion that toggles on click (aria-expanded reflects the state).
    const layersButton = page.getByRole('button', { name: /map layers/i })
    await expect(layersButton).toBeVisible()
    await expect(layersButton).toHaveAttribute('aria-expanded', 'false')

    await layersButton.click()
    await expect(layersButton).toHaveAttribute('aria-expanded', 'true')
    // A grouped overlay toggle is now revealed. The panel keeps only the few
    // worth flipping mid-task — the rest moved to Settings > Map Layers.
    await expect(page.getByRole('button', { name: /^range ring$/i })).toBeVisible()

    await layersButton.click()
    await expect(layersButton).toHaveAttribute('aria-expanded', 'false')
  })

  test('AirSideMenu FILTER accordion exposes civil and military aircraft modes', async ({
    page,
  }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // The aircraft-filter modes live inside the FILTER accordion, revealed when
    // the FILTER icon is clicked.
    await page.getByRole('button', { name: /^filter aircraft$/i }).click()

    await expect(page.getByRole('button', { name: /civil aircraft only/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /military aircraft only/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /show all aircraft/i })).toBeVisible()
  })

  test('filter combobox is rendered in the SEARCH sidebar pane', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // Open the SEARCH pane
    // Use data-tab selector to avoid strict-mode ambiguity with the AirSideMenu
    // "Search" button which shares the same accessible name pattern
    await page.locator('[data-tab="search"]').click()
    await expect(page.locator('#msb-pane-search')).toBeVisible()

    // The filter input (combobox) should be present
    const filterInput = page.getByRole('combobox', {
      name: /filter aircraft by callsign/i,
    })
    await expect(filterInput).toBeVisible()
  })

  test('filter combobox shows results when data is stubbed', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    await page.locator('[data-tab="search"]').click()
    await expect(page.locator('#msb-pane-search')).toBeVisible()

    // Categories are single-select rail sub-tabs now. AirFilter reads aircraft from
    // the MapLibre adsbControl (no live control here), but the STATIC airports list
    // (AIRPORTS_DATA) is always available — switch to the airports sub-tab and search
    // "Heathrow" for a reliable, no-stub result row.
    await page.locator('.msb-rail-subbtn[data-filter-cat="airports"]').click()

    const filterInput = page.getByRole('combobox', {
      name: /filter aircraft by callsign/i,
    })
    await filterInput.fill('Heathrow')

    // The matching airport row appears in the airports category list.
    await expect(page.locator('.bfp-result-item').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('#filter-results')).toContainText('EGLL')
  })

  test('filter combobox shows "No results" for non-matching query', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    await page.locator('[data-tab="search"]').click()
    await expect(page.locator('#msb-pane-search')).toBeVisible()

    const filterInput = page.getByRole('combobox', {
      name: /filter aircraft by callsign/i,
    })
    await filterInput.fill('XYZZYNOTFOUND')

    await expect(page.locator('.bfp-no-results')).toBeVisible()
    await expect(page.locator('.bfp-no-results')).toContainText(/no results/i)
  })

  test('FILTER rail exposes single-select category sub-tabs', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    await page.locator('[data-tab="search"]').click()
    await expect(page.locator('#msb-pane-search')).toBeVisible()

    // The three air category sub-tabs render in the rail beneath the FILTER tab.
    await expect(page.locator('.msb-rail-subbtn[data-filter-cat="aircraft"]')).toBeVisible()
    await expect(page.locator('.msb-rail-subbtn[data-filter-cat="airports"]')).toBeVisible()
    await expect(page.locator('.msb-rail-subbtn[data-filter-cat="mil"]')).toBeVisible()

    // Selecting one marks it active (single-select), announced via aria-pressed.
    await page.locator('.msb-rail-subbtn[data-filter-cat="airports"]').click()
    await expect(page.locator('.msb-rail-subbtn[data-filter-cat="airports"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('REPLAY tab is absent from sidebar rail when replay is disabled', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // By default airReplayEnabled=false — the playback tab must not be visible
    await expect(page.locator('[data-tab="playback"]')).not.toBeVisible()
  })

  test('REPLAY tab appears in sidebar rail when replay is enabled', async ({ page }) => {
    await seedAirReplayEnabled(page, true)
    // Override the settings API so main.ts hydration doesn't re-set replay to false
    await page.route('/api/settings', (route) => {
      void route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          air: { enabled: true, replayEnabled: true },
          space: { enabled: true },
          sea: { enabled: true },
          land: { enabled: true },
          sdr: { enabled: true },
          app: {},
        }),
      })
    })
    await page.goto('/air/')
    await waitForShellHydration(page)

    await expect(page.locator('[data-tab="playback"]')).toBeVisible()
  })

  test('NoUrlOverlay hides when settings API returns a valid online URL', async ({ page }) => {
    // Provide a valid URL — no overlay should appear
    await page.route('/api/settings/air', (route) => {
      void route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ onlineDataSourceURL: 'http://192.168.1.1:8080/data/aircraft.json' }),
      })
    })

    await page.goto('/air/')
    await waitForShellHydration(page)

    // Overlay must not be visible
    await expect(page.locator('.no-url-overlay')).not.toBeVisible()
  })

  test('NoUrlOverlay shows when settings API returns no online URL', async ({ page }) => {
    await page.route('/api/settings/air', (route) => {
      void route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ onlineDataSourceURL: '' }),
      })
    })

    await page.goto('/air/')
    await waitForShellHydration(page)

    await expect(page.locator('.no-url-overlay')).toBeVisible({ timeout: 8000 })
  })

  // Regression test for the IconRail/IconRailAccordion touch-tooltip fix (see the
  // identical Space-domain test in space.spec.ts): IconRailAccordion is a
  // multi-root component, so Vue's scoped-CSS slot scope-id propagation doesn't
  // carry IconRail's `:slotted([data-tooltip])` suppression down into it — it
  // needs (and now has) its own copy of the rule for its own trigger/panel slot
  // content. jsdom can't evaluate media queries or pseudo-elements, so this can
  // only be verified in a real browser; it directly exercises both the rail's
  // own button (Zoom in) and an accordion sub-button (Range ring, inside the
  // MAP LAYERS panel).
  test('touch viewport suppresses the tooltip pseudo-element on rail and accordion buttons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/air/')
    await waitForShellHydration(page)

    await page.locator('#sm-layers-btn').click()
    const rangeRingButton = page.locator('button[data-tooltip="RANGE RING"]')
    await expect(rangeRingButton).toBeVisible()

    const zoomInTooltipDisplay = await page
      .locator('button[data-tooltip="ZOOM IN"]')
      .evaluate((button) => getComputedStyle(button, '::before').display)
    const rangeRingTooltipDisplay = await rangeRingButton.evaluate(
      (button) => getComputedStyle(button, '::before').display,
    )

    expect(zoomInTooltipDisplay).toBe('none')
    expect(rangeRingTooltipDisplay).toBe('none')
  })
})

/**
 * Military-vs-civil classification, end to end.
 *
 * The colour an aircraft renders in is the whole point of the distinction —
 * lime for military, blue for civil — and it is decided from the feed's
 * `dbFlags` marker. These tests drive that from a stubbed upstream response
 * through the real AdsbLiveControl to the rendered label, which is the one
 * path the unit tests cannot cover: they assert the classifier's return value,
 * not that the map paints it.
 *
 * Assertions read the arrow SVG's stroke rather than the MapLibre canvas.
 * Aircraft icons are drawn into WebGL and are unreadable from the DOM, but the
 * callsign label beside each one is a real DOM marker carrying the same colour.
 */
const MILITARY_LIME = '#c8ff00'
const CIVIL_BLUE = '#00aaff'

test.describe('Air domain aircraft classification', () => {
  test.beforeEach(async ({ page }) => {
    await clearPersistedState(page)
    await installDefaultMocks(page)
    // Registered after the defaults so this override wins (Playwright matches
    // most-recently-registered first) — the default stub serves an empty list.
    await page.route('**/api/air/adsb/point/**', (route) => {
      void route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(milClassificationFixture),
      })
    })
  })

  /** The arrow shape inside the callsign label for one aircraft. */
  const arrowShapeFor = (page: Page, callsign: string) =>
    page.locator('.maplibregl-marker').filter({ hasText: callsign }).locator('.adsb-arrow polygon')

  test('renders a military aircraft lime and a civil aircraft blue', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    await expect(arrowShapeFor(page, 'RCH456')).toHaveAttribute('stroke', MILITARY_LIME)
    await expect(arrowShapeFor(page, 'BAW123')).toHaveAttribute('stroke', CIVIL_BLUE)
  })

  test('classifies a military aircraft flying on a civil-block hex', async ({ page }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // PAT090 is a US Army C172 on an N-number: hex 0xAAB198 sits in a civil
    // allocation block, so no ICAO hex range can identify it. Only the feed's
    // dbFlags marker can, which is exactly what the classifier previously
    // ignored — this aircraft rendered civil blue.
    await expect(arrowShapeFor(page, 'PAT090')).toHaveAttribute('stroke', MILITARY_LIME)
  })

  test('gives a military aircraft its lime type badge and leaves a civil one without', async ({
    page,
  }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    const militaryLabel = page.locator('.maplibregl-marker').filter({ hasText: 'RCH456' })
    await expect(militaryLabel.locator('.mil-model-badge')).toHaveText('C17')

    const civilLabel = page.locator('.maplibregl-marker').filter({ hasText: 'BAW123' })
    await expect(civilLabel).toBeVisible()
    await expect(civilLabel.locator('.mil-model-badge')).toHaveCount(0)
  })

  test('the MILITARY filter mode hides civil aircraft and keeps military ones', async ({
    page,
  }) => {
    await page.goto('/air/')
    await waitForShellHydration(page)

    // Both are on the map before any filtering.
    await expect(arrowShapeFor(page, 'BAW123')).toHaveAttribute('stroke', CIVIL_BLUE)

    // The aircraft-filter modes live inside the FILTER accordion, revealed when
    // the FILTER icon is clicked.
    await page.getByRole('button', { name: /^filter aircraft$/i }).click()
    await page.getByRole('button', { name: /military aircraft only/i }).click()

    await expect(page.locator('.maplibregl-marker').filter({ hasText: 'BAW123' })).toHaveCount(0)
    await expect(arrowShapeFor(page, 'RCH456')).toHaveAttribute('stroke', MILITARY_LIME)
    await expect(arrowShapeFor(page, 'PAT090')).toHaveAttribute('stroke', MILITARY_LIME)
  })
})
