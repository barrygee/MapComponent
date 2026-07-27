import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'

// ---- Module mocks ------------------------------------------------------------
// The per-satellite pass-notification store is covered by its own spec; here its
// read/write functions are injectable test doubles so each armed/record/bell
// branch is controllable.
vi.mock('./controls/satellite/passNotifStore', () => ({
  isPassNotifEnabled: vi.fn(() => false),
  isAutoTuneEnabled: vi.fn(() => false),
  setAutoTuneEnabled: vi.fn(),
  isRecordOnPassEnabled: vi.fn(() => false),
  setRecordOnPassEnabled: vi.fn(),
  getAllPassNotifs: vi.fn(() => ({})),
}))

// The notifications store calls playNotificationSound() on add(); stub it so the
// audio path doesn't run under jsdom.
vi.mock('@/composables/useNotificationSound', () => ({
  playNotificationSound: vi.fn(),
}))

import SpaceFilter from './SpaceFilter.vue'
import { useNotificationsStore } from '../../stores/notifications'
import { useSpaceStore } from '@/stores/space'
import {
  isPassNotifEnabled,
  isAutoTuneEnabled,
  setAutoTuneEnabled,
  isRecordOnPassEnabled,
  setRecordOnPassEnabled,
  getAllPassNotifs,
} from './controls/satellite/passNotifStore'

enableAutoUnmount(afterEach)

// ---- Satellite-entry fixture -------------------------------------------------
interface SatFixture {
  norad_id: string
  name: string
  category: string | null
  updated_at?: number | null
  uplink_hz?: number | null
  uplink_mode?: string | null
  downlink_hz?: number | null
  downlink_mode?: string | null
  ctcss_hz?: number | null
  transponder_type?: string | null
  beacon_hz?: number | null
  packet_info?: string | null
  radio_status?: string | null
  radio_notes?: string | null
}

function makeSat(overrides: Partial<SatFixture> = {}): SatFixture {
  return {
    norad_id: '25544',
    name: 'ISS (ZARYA)',
    category: 'space_station',
    updated_at: null,
    ...overrides,
  }
}

const NOW = Date.now()

interface AccPassFixture {
  aos_utc: string
  los_utc: string
  aos_unix_ms: number
  los_unix_ms: number
  duration_s: number
  max_elevation_deg: number
  max_el_utc: string
  sky_track?: Array<{ az: number; el: number }>
}

function makeAccPass(overrides: Partial<AccPassFixture> = {}): AccPassFixture {
  const aos = NOW + 1_200_000
  const los = NOW + 1_500_000
  return {
    aos_utc: new Date(aos).toISOString(),
    los_utc: new Date(los).toISOString(),
    aos_unix_ms: aos,
    los_unix_ms: los,
    duration_s: 300,
    max_elevation_deg: 33.3,
    max_el_utc: new Date(aos + 150_000).toISOString(),
    ...overrides,
  }
}

// ---- Fetch test double -------------------------------------------------------
interface FetchResult {
  ok: boolean
  status: number
  body: unknown
}
let listResult: FetchResult
let accResult: FetchResult
let fetchOverride: ((url: string, opts?: RequestInit) => Promise<unknown>) | null

function makeResponse(result: FetchResult): Promise<unknown> {
  return Promise.resolve({
    ok: result.ok,
    status: result.status,
    json: () => Promise.resolve(result.body),
  })
}

function defaultRouter(url: string): Promise<unknown> {
  if (url.includes('/api/space/tle/list')) return makeResponse(listResult)
  if (url.includes('/api/space/satellite/') && url.includes('/passes'))
    return makeResponse(accResult)
  // notifications-store traffic (/api/air/messages) and anything else
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
}

// ---- Fake SatelliteControl ---------------------------------------------------
function makeFakeControl(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    switchSatellite: vi.fn(),
    stopFollowing: vi.fn(),
    previewSatellite: vi.fn(),
    clearPreview: vi.fn(),
    togglePassNotifications: vi.fn(),
    followedNoradId: null,
    passNotificationsEnabled: false,
    activeNoradId: '00000',
    ...overrides,
  }
}

// ---- Mount helpers -----------------------------------------------------------
interface MountOpts {
  control?: ReturnType<typeof makeFakeControl> | null
  getUserLocation?: () => [number, number] | null
}

function mountFilter(opts: MountOpts = {}): VueWrapper {
  setActivePinia(createPinia())
  const control = opts.control === undefined ? makeFakeControl() : opts.control
  return mount(SpaceFilter, {
    props: {
      satelliteControl: control as never,
      getUserLocation: opts.getUserLocation ?? (() => [10, 50] as [number, number]),
    },
  })
}

// Mount and flush the onMounted loadSatellites() so the list renders.
async function mountReady(opts: MountOpts = {}): Promise<VueWrapper> {
  const wrapper = mountFilter(opts)
  await flushPromises()
  await wrapper.vm.$nextTick()
  return wrapper
}

// Expand the first result item and flush the accordion fetch.
async function expandFirstItem(wrapper: VueWrapper): Promise<void> {
  await wrapper.find('.bfp-result-item').trigger('click')
  await flushPromises()
  await wrapper.vm.$nextTick()
}

// The FILTER rail sub-tabs are single-select: only the active category's sats
// render. Switch the store's selected category and flush the re-render.
async function setCategory(wrapper: VueWrapper, cat: string): Promise<void> {
  useSpaceStore().setSpaceFilterCategory(cat)
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isPassNotifEnabled).mockReturnValue(false)
  vi.mocked(isAutoTuneEnabled).mockReturnValue(false)
  vi.mocked(isRecordOnPassEnabled).mockReturnValue(false)
  vi.mocked(getAllPassNotifs).mockReturnValue({})
  fetchOverride = null
  listResult = { ok: true, status: 200, body: { satellites: [makeSat()] } }
  accResult = {
    ok: true,
    status: 200,
    body: { passes: [makeAccPass()], computed_at: new Date().toISOString() },
  }
  global.fetch = vi.fn((url: string | URL | Request, opts?: RequestInit) =>
    (fetchOverride ?? defaultRouter)(String(url), opts),
  ) as unknown as typeof fetch
})

// =============================================================================
describe('SpaceFilter — loading & list rendering', () => {
  it('shows the loading placeholder before the database resolves', () => {
    // Hold the list fetch open so the not-yet-loaded state is observable.
    fetchOverride = () => new Promise(() => {})
    const wrapper = mountFilter()
    expect(wrapper.find('.bfp-no-results').text()).toBe('Loading satellite database…')
    wrapper.unmount()
  })

  it('renders a satellite result once the database loads', async () => {
    const wrapper = await mountReady()
    expect(global.fetch).toHaveBeenCalledWith('/api/space/tle/list')
    const item = wrapper.find('.bfp-result-item')
    expect(item.exists()).toBe(true)
    expect(item.find('.bfp-result-primary').text()).toBe('ISS (ZARYA)')
    expect(item.find('.bfp-result-secondary').text()).toBe('STATION · NORAD 25544')
  })

  it('falls back to the norad id and a NORAD-only secondary when fields are missing', async () => {
    listResult.body = { satellites: [makeSat({ name: '', norad_id: '40069', category: null })] }
    const wrapper = await mountReady()
    expect(wrapper.find('.bfp-result-primary').text()).toBe('40069')
    expect(wrapper.find('.bfp-result-secondary').text()).toBe('NORAD 40069')
  })

  it('publishes an unknown-in-order category and renders its sats when selected', async () => {
    // A category present on a sat but not in SATELLITE_CATEGORY_ORDER is not offered
    // as a sub-tab (the rail only lists ordered categories), so nothing renders.
    listResult.body = { satellites: [makeSat({ category: 'odd_cat' })] }
    const wrapper = await mountReady()
    expect(useSpaceStore().spaceAvailableCategories).toEqual([])
    expect(wrapper.find('.bfp-result-item').exists()).toBe(false)
  })

  it('shows "No satellites found" when the loaded database is empty', async () => {
    listResult.body = { satellites: [] }
    const wrapper = await mountReady()
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('treats a missing satellites array as empty', async () => {
    listResult.body = {}
    const wrapper = await mountReady()
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('marks the database loaded (no error) when the list request is non-OK', async () => {
    listResult = { ok: false, status: 500, body: {} }
    const wrapper = await mountReady()
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('marks the database loaded when the list request rejects', async () => {
    fetchOverride = (url) =>
      url.includes('/tle/list') ? Promise.reject(new Error('offline')) : defaultRouter(url)
    const wrapper = await mountReady()
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('caps each category section at 20 satellites', async () => {
    listResult.body = {
      satellites: Array.from({ length: 25 }, (_, index) =>
        makeSat({ norad_id: String(10000 + index), name: `SAT ${index}` }),
      ),
    }
    const wrapper = await mountReady()
    expect(wrapper.findAll('.bfp-result-item')).toHaveLength(20)
  })
})

// =============================================================================
describe('SpaceFilter — search, grouping & query clearing', () => {
  function multiSat() {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '25544', name: 'ISS (ZARYA)', category: 'space_station' }),
        makeSat({ norad_id: '33591', name: 'NOAA 19', category: 'weather' }),
        makeSat({ norad_id: '28654', name: 'NOAA 18', category: 'weather' }),
        makeSat({ norad_id: '99999', name: 'MYSTERY', category: null }),
      ],
    }
  }

  it('publishes the available categories in canonical order and shows the first by default', async () => {
    multiSat()
    const wrapper = await mountReady()
    // unknown is last in SATELLITE_CATEGORY_ORDER; the null-category sat maps to it.
    expect(useSpaceStore().spaceAvailableCategories).toEqual([
      'space_station',
      'weather',
      'unknown',
    ])
    // Default selection is the first available category → only the ISS renders.
    expect(useSpaceStore().spaceFilterCategory).toBe('space_station')
    expect(wrapper.findAll('.bfp-result-primary').map((node) => node.text())).toEqual([
      'ISS (ZARYA)',
    ])
  })

  it('filters by satellite name substring within the active category', async () => {
    multiSat()
    const wrapper = await mountReady()
    await setCategory(wrapper, 'weather')
    await wrapper.find('#space-filter-input').setValue('noaa')
    await wrapper.vm.$nextTick()
    const names = wrapper
      .findAll('.bfp-result-primary')
      .map((node) => node.text())
      .sort()
    expect(names).toEqual(['NOAA 18', 'NOAA 19'])
  })

  it('filters by norad id substring', async () => {
    multiSat()
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').setValue('25544')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
    expect(wrapper.find('.bfp-result-primary').text()).toBe('ISS (ZARYA)')
  })

  it('filters by category alias and sorts prefix matches ahead of category-only matches', async () => {
    // Both satellites are in the SAME category group, so the match-score sort is
    // observable in DOM order (grouping re-buckets across categories otherwise).
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '2', name: 'NOAA 19', category: 'weather' }), // category-only match
        makeSat({ norad_id: '1', name: 'WEATHERBIRD', category: 'weather' }), // name-prefix match
      ],
    }
    const wrapper = await mountReady()
    // "weather" is a category alias (matches both) AND a name prefix of WEATHERBIRD.
    await wrapper.find('#space-filter-input').setValue('weather')
    await wrapper.vm.$nextTick()
    const names = wrapper.findAll('.bfp-result-primary').map((node) => node.text())
    // Name-prefix match (score 1) sorts ahead of the category-only match (score 4).
    expect(names).toEqual(['WEATHERBIRD', 'NOAA 19'])
  })

  it('shows "No satellites found" when the query matches nothing', async () => {
    multiSat()
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').setValue('zzzznomatch')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('scores an exact name match ahead of a substring match within a group', async () => {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'XISSX', category: 'space_station' }), // substring (score 2)
        makeSat({ norad_id: '2', name: 'ISS', category: 'space_station' }), // exact (score 0)
      ],
    }
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').setValue('iss')
    await wrapper.vm.$nextTick()
    const names = wrapper.findAll('.bfp-result-primary').map((node) => node.text())
    expect(names).toEqual(['ISS', 'XISSX'])
  })

  it('scores a norad-id-only hit (3) below a name substring hit (2)', async () => {
    // Two results in one group so the match-score comparator actually runs: ALPHA
    // matches '123' only via its norad id (score 3); SAT123 matches by name (score 2).
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '12345', name: 'ALPHA', category: 'active' }), // norad-only → 3
        makeSat({ norad_id: '99999', name: 'SAT123', category: 'active' }), // name substring → 2
      ],
    }
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').setValue('123')
    await wrapper.vm.$nextTick()
    const names = wrapper.findAll('.bfp-result-primary').map((node) => node.text())
    expect(names).toEqual(['SAT123', 'ALPHA'])
  })

  it('does not treat a single-character query as a category alias', async () => {
    // A 1-char query is below the category-alias threshold, so only name/norad
    // substring matching applies.
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'MILSTAR', category: 'military' }),
        makeSat({ norad_id: '2', name: 'NOAA', category: 'weather' }),
      ],
    }
    const wrapper = await mountReady()
    await setCategory(wrapper, 'military')
    await wrapper.find('#space-filter-input').setValue('m') // 'm' must NOT alias to 'military'
    await wrapper.vm.$nextTick()
    const names = wrapper.findAll('.bfp-result-primary').map((node) => node.text())
    // MILSTAR matches 'm' by name; the alias threshold (≥2 chars) pulls in nothing
    // extra by category.
    expect(names).toEqual(['MILSTAR'])
  })

  it('clears the query via the clear button and restores the category list', async () => {
    multiSat()
    const wrapper = await mountReady()
    await setCategory(wrapper, 'weather') // two NOAA sats
    await wrapper.find('#space-filter-input').setValue('19') // narrows to NOAA 19
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.bfp-result-item')).toHaveLength(1)
    expect(wrapper.find('#space-filter-clear-btn').classes()).toContain('bfp-clear-visible')
    await wrapper.find('#space-filter-clear-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect((wrapper.find('#space-filter-input').element as HTMLInputElement).value).toBe('')
    // Both weather sats visible again.
    expect(wrapper.findAll('.bfp-result-item')).toHaveLength(2)
  })
})

// =============================================================================
describe('SpaceFilter — category sub-tabs (single-select)', () => {
  function multiSat() {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '25544', name: 'ISS (ZARYA)', category: 'space_station' }),
        makeSat({ norad_id: '33591', name: 'NOAA 19', category: 'weather' }),
      ],
    }
  }

  it('renders only the selected category and switches with the store', async () => {
    multiSat()
    const wrapper = await mountReady()
    // Default: first available category (space_station) → ISS only.
    expect(wrapper.findAll('.bfp-result-primary').map((node) => node.text())).toEqual([
      'ISS (ZARYA)',
    ])
    await setCategory(wrapper, 'weather')
    expect(wrapper.findAll('.bfp-result-primary').map((node) => node.text())).toEqual(['NOAA 19'])
  })

  it('shows the no-results state when the selected category has no matching sats', async () => {
    multiSat()
    const wrapper = await mountReady()
    // A stale/invalid selection with data present renders no rows for that category.
    useSpaceStore().setSpaceFilterCategory('navigation')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bfp-result-item').exists()).toBe(false)
    expect(wrapper.find('.bfp-no-results').text()).toBe('No satellites found')
  })

  it('repairs the selected category to the first available when data changes', async () => {
    // Selected category persists as 'navigation' but the loaded set has none.
    localStorage.setItem('sentinel_space_filterCategory', '"navigation"')
    multiSat()
    const wrapper = await mountReady()
    // The availability watcher resets it to the first available category.
    expect(useSpaceStore().spaceFilterCategory).toBe('space_station')
    wrapper.unmount()
  })
})

// =============================================================================
describe('SpaceFilter — keyboard navigation', () => {
  function multiSat() {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'ALPHA', category: 'active' }),
        makeSat({ norad_id: '2', name: 'BRAVO', category: 'active' }),
        makeSat({ norad_id: '3', name: 'CHARLIE', category: 'active' }),
      ],
    }
  }

  it('moves focus down and wraps to the first item from the end', async () => {
    multiSat()
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // → ALPHA
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.bfp-result-item')[0].classes()).toContain('bfp-keyboard-focused')
    await input.trigger('keydown', { key: 'ArrowDown' }) // → BRAVO
    await input.trigger('keydown', { key: 'ArrowDown' }) // → CHARLIE
    await input.trigger('keydown', { key: 'ArrowDown' }) // wraps → ALPHA
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.bfp-result-item')[0].classes()).toContain('bfp-keyboard-focused')
  })

  it('moves focus up and clears focus when stepping above the first item', async () => {
    multiSat()
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // ALPHA
    await input.trigger('keydown', { key: 'ArrowDown' }) // BRAVO
    await input.trigger('keydown', { key: 'ArrowUp' }) // → ALPHA
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.bfp-result-item')[0].classes()).toContain('bfp-keyboard-focused')
    await input.trigger('keydown', { key: 'ArrowUp' }) // → none
    await wrapper.vm.$nextTick()
    expect(
      wrapper
        .findAll('.bfp-result-item')
        .some((node) => node.classes().includes('bfp-keyboard-focused')),
    ).toBe(false)
  })

  it('opens the focused item on Enter', async () => {
    multiSat()
    const control = makeFakeControl()
    const wrapper = await mountReady({ control })
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // focus ALPHA
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(control.switchSatellite).toHaveBeenCalledWith('1', 'ALPHA')
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
  })

  it('opens the first item on Enter when nothing is focused', async () => {
    multiSat()
    const control = makeFakeControl()
    const wrapper = await mountReady({ control })
    await wrapper.find('#space-filter-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(control.switchSatellite).toHaveBeenCalledWith('1', 'ALPHA')
  })

  it('drops a focus the query filtered away, so Enter opens the first remaining row', async () => {
    multiSat()
    const control = makeFakeControl()
    const wrapper = await mountReady({ control })
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // focus ALPHA (norad 1)
    await wrapper.vm.$nextTick()
    // Filter to BRAVO only. The focused ALPHA is gone from the list, so the
    // virtual focus goes with it rather than lingering on a row that is no
    // longer there — Enter then acts on the first row still shown.
    await input.setValue('bravo')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bfp-keyboard-focused').exists()).toBe(false)
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(control.switchSatellite).toHaveBeenCalledWith('2', 'BRAVO')
  })

  it('clears the query on Escape', async () => {
    multiSat()
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').setValue('alpha')
    await wrapper.vm.$nextTick()
    await wrapper.find('#space-filter-input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect((wrapper.find('#space-filter-input').element as HTMLInputElement).value).toBe('')
  })

  it('ignores arrow keys when there are no visible items', async () => {
    listResult.body = { satellites: [] }
    const wrapper = await mountReady()
    // No throw, focus stays null.
    await wrapper.find('#space-filter-input').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.bfp-no-results').exists()).toBe(true)
  })

  it('does nothing on an unhandled key', async () => {
    multiSat()
    const wrapper = await mountReady()
    await wrapper.find('#space-filter-input').trigger('keydown', { key: 'a' })
    await wrapper.vm.$nextTick()
    expect(
      wrapper
        .findAll('.bfp-result-item')
        .some((node) => node.classes().includes('bfp-keyboard-focused')),
    ).toBe(false)
  })
})

// =============================================================================
describe('SpaceFilter — combobox / listbox semantics', () => {
  function multiSat() {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'ALPHA', category: 'active' }),
        makeSat({ norad_id: '2', name: 'BRAVO', category: 'active' }),
      ],
    }
  }

  it('marks the input as a combobox controlling the listbox', async () => {
    multiSat()
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-autocomplete')).toBe('list')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe('space-filter-listbox')
  })

  it('makes the results scroll container a keyboard-focusable named group', async () => {
    // WCAG 2.1.1 / axe scrollable-region-focusable: options are driven from the
    // combobox via aria-activedescendant (never tabbable), so the overflowing
    // scroll container itself must take a tab stop for keyboard scrolling.
    multiSat()
    const wrapper = await mountReady()
    const results = wrapper.find('#space-filter-results')
    expect(results.attributes('tabindex')).toBe('0')
    expect(results.attributes('role')).toBe('group')
    expect(results.attributes('aria-label')).toBe('Filter results')
  })

  it('exposes each row as an option the listbox owns via aria-owns', async () => {
    multiSat()
    const wrapper = await mountReady()
    const listbox = wrapper.find('#space-filter-listbox')
    expect(listbox.attributes('role')).toBe('listbox')
    const owned = listbox.attributes('aria-owns') ?? ''
    expect(owned).toContain('space-filter-opt-1')
    expect(owned).toContain('space-filter-opt-2')
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(options[0].attributes('id')).toBe('space-filter-opt-1')
    expect(options[0].attributes('aria-selected')).toBe('false')
  })

  it('hides the listbox and reports collapsed when there are no results', async () => {
    listResult.body = { satellites: [] }
    const wrapper = await mountReady()
    expect(wrapper.find('#space-filter-listbox').exists()).toBe(false)
    const input = wrapper.find('#space-filter-input')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(input.attributes('aria-controls')).toBeUndefined()
  })

  it('points aria-activedescendant at the focused option and marks it selected', async () => {
    multiSat()
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // focus ALPHA
    await wrapper.vm.$nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('space-filter-opt-1')
    expect(wrapper.find('#space-filter-opt-1').attributes('aria-selected')).toBe('true')
  })

  it('drops aria-activedescendant when the focused row is switched out of view', async () => {
    multiSat()
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input')
    await input.trigger('keydown', { key: 'ArrowDown' }) // focus ALPHA
    await wrapper.vm.$nextTick()
    expect(input.attributes('aria-activedescendant')).toBe('space-filter-opt-1')
    // Switch to a category with no loaded sats — the focused option is no longer rendered.
    await setCategory(wrapper, 'weather')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    // With no options rendered the listbox is gone too.
    expect(wrapper.find('#space-filter-listbox').exists()).toBe(false)
  })
})

// =============================================================================
describe('SpaceFilter — accordion expand/collapse', () => {
  it('expands an item on click, selecting the satellite and fetching its passes', async () => {
    const control = makeFakeControl()
    const wrapper = await mountReady({ control })
    await expandFirstItem(wrapper)
    expect(wrapper.find('.bfp-result-item').classes()).toContain('bfp-expanded')
    expect(control.switchSatellite).toHaveBeenCalledWith('25544', 'ISS (ZARYA)')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/space/satellite/25544/passes'),
      expect.anything(),
    )
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
  })

  it('collapses an already-expanded item when clicked again', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
    await wrapper.find('.bfp-result-item').trigger('click')
    await flushPromises()
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(false)
  })

  it('works without a satellite control (null-prop path)', async () => {
    const wrapper = await mountReady({ control: null })
    await expandFirstItem(wrapper)
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
  })

  it('renders live telemetry from a sat-position-update with look-angles', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '25544',
          position: {
            alt_km: 420,
            velocity_kms: 7.66,
            track_deg: 51,
            lat: 12,
            lon: 34,
            az: 180,
            el: 45,
          },
        },
      }),
    )
    await wrapper.vm.$nextTick()
    const values = wrapper.findAll('.ba-data-cell-value').map((cell) => cell.text())
    expect(values).toContain('12°')
    expect(values).toContain('420 km')
  })

  it('ignores a sat-position-update for a different satellite', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '99999',
          position: { alt_km: 1, velocity_kms: 1, track_deg: 1, lat: 1, lon: 1 },
        },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ba-data-cell-value').text()).toBe('—')
  })

  it('ignores a sat-position-update when nothing is expanded', async () => {
    const wrapper = await mountReady()
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '25544',
          position: { alt_km: 1, velocity_kms: 1, track_deg: 1, lat: 1, lon: 1 },
        },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(false)
  })

  it('updates telemetry but hides the live marker when look-angles are absent', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '25544',
          position: { alt_km: 410, velocity_kms: 7.6, track_deg: 50, lat: 5, lon: 6 },
        },
      }),
    )
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '25544',
          position: { alt_km: 410, velocity_kms: 7.6, track_deg: 50, lat: 5, lon: 6, az: 90 },
        },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.ba-data-cell-value').map((cell) => cell.text())).toContain('410 km')
  })

  it('shows COULD NOT LOAD PASSES when the accordion fetch is non-OK', async () => {
    accResult = { ok: false, status: 500, body: {} }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-status').text()).toBe('COULD NOT LOAD PASSES')
  })

  it('shows NETWORK ERROR when the accordion fetch rejects', async () => {
    const wrapper = await mountReady()
    fetchOverride = (url) => {
      if (url.includes('/satellite/') && url.includes('/passes'))
        return Promise.reject(new Error('down'))
      return defaultRouter(url)
    }
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-status').text()).toBe('NETWORK ERROR')
  })

  it('silently ignores an AbortError from the accordion fetch', async () => {
    const wrapper = await mountReady()
    fetchOverride = (url) => {
      if (url.includes('/satellite/') && url.includes('/passes')) {
        const abortError = new Error('aborted')
        abortError.name = 'AbortError'
        return Promise.reject(abortError)
      }
      return defaultRouter(url)
    }
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-status').text()).toBe('COMPUTING PASSES…')
  })

  it('shows the set-location prompt in the accordion when location is unavailable', async () => {
    let location: [number, number] | null = [10, 50]
    const wrapper = await mountReady({ getUserLocation: () => location })
    location = null
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-status').text()).toBe('SET LOCATION TO CALCULATE PASSES')
  })

  it('defaults the accordion list to empty when the response omits passes', async () => {
    accResult.body = { computed_at: new Date().toISOString() }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-status').text()).toContain('NEXT 24H')
    expect(wrapper.find('.sfr-acc-no-passes').exists()).toBe(true)
  })

  it('aborts an in-flight accordion fetch when another item is opened', async () => {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'ALPHA', category: 'active' }),
        makeSat({ norad_id: '2', name: 'BRAVO', category: 'active' }),
      ],
    }
    const wrapper = await mountReady()
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    await expandFirstItem(wrapper) // opens ALPHA (itemFetchAbort set)
    await wrapper.findAll('.bfp-result-item')[1].trigger('click') // collapse ALPHA + open BRAVO
    await flushPromises()
    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })

  it('bails out of the accordion fetch if its signal was aborted mid-flight', async () => {
    listResult.body = {
      satellites: [
        makeSat({ norad_id: '1', name: 'ALPHA', category: 'active' }),
        makeSat({ norad_id: '2', name: 'BRAVO', category: 'active' }),
      ],
    }
    const wrapper = await mountReady()
    // Hold ALPHA's accordion fetch open so it is still in flight when BRAVO opens.
    let release: (value: unknown) => void = () => {}
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let accCalls = 0
    fetchOverride = (url) => {
      if (url.includes('/satellite/') && url.includes('/passes')) {
        accCalls++
        if (accCalls === 1) return gate.then(() => makeResponse(accResult))
        return makeResponse(accResult)
      }
      return defaultRouter(url)
    }
    const items = wrapper.findAll('.bfp-result-item')
    await items[0].trigger('click') // open ALPHA → gated fetch #1 (itemFetchAbort = ctrl1)
    await items[1].trigger('click') // collapse ALPHA (aborts ctrl1) + open BRAVO → fetch #2
    release(null) // fetch #1 resolves into an aborted signal → returns early
    await flushPromises()
    await wrapper.vm.$nextTick()
    // BRAVO is the open accordion; ALPHA's late resolve did not clobber it.
    expect(wrapper.findAll('.bfp-result-item')[1].classes()).toContain('bfp-expanded')
  })
})

// =============================================================================
describe('SpaceFilter — persisted expansion restore', () => {
  it('re-opens the satellite left expanded once the database loads', async () => {
    const control = makeFakeControl()
    const wrapper = mountFilter({ control })
    const spaceStore = useSpaceStore()
    spaceStore.searchExpandedNorad = '25544'
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
    expect(control.switchSatellite).toHaveBeenCalledWith('25544', 'ISS (ZARYA)')
  })

  it('clears a stale persisted id when that satellite is gone from the database', async () => {
    const wrapper = mountFilter()
    const spaceStore = useSpaceStore()
    spaceStore.searchExpandedNorad = '00000' // not in the loaded list
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(spaceStore.searchExpandedNorad).toBe('')
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(false)
  })

  it('restores to the "unknown" category when the restored satellite has no category', async () => {
    const control = makeFakeControl()
    listResult.body = {
      satellites: [makeSat({ norad_id: '99999', name: 'MYSTERY', category: null })],
    }
    const wrapper = mountFilter({ control })
    const spaceStore = useSpaceStore()
    spaceStore.searchExpandedNorad = '99999'
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(spaceStore.spaceFilterCategory).toBe('unknown')
    expect(wrapper.find('.bfp-accordion-body').exists()).toBe(true)
  })
})

// =============================================================================
describe('SpaceFilter — hover preview', () => {
  it('previews on mouse enter and clears (debounced) on mouse leave', async () => {
    vi.useFakeTimers()
    const control = makeFakeControl()
    const wrapper = mountFilter({ control })
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    const item = wrapper.find('.bfp-result-item')
    await item.trigger('mouseenter')
    expect(control.previewSatellite).toHaveBeenCalledWith('25544', 'ISS (ZARYA)')
    await item.trigger('mouseleave')
    expect(control.clearPreview).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(control.clearPreview).toHaveBeenCalled()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('cancels a pending clear when re-entering before it fires', async () => {
    vi.useFakeTimers()
    const control = makeFakeControl()
    const wrapper = mountFilter({ control })
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    const item = wrapper.find('.bfp-result-item')
    await item.trigger('mouseleave') // schedules clear
    await item.trigger('mouseenter') // cancels it
    await vi.advanceTimersByTimeAsync(100)
    expect(control.clearPreview).not.toHaveBeenCalled()
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('clears a pending preview timer when leaving twice in a row', async () => {
    vi.useFakeTimers()
    const control = makeFakeControl()
    const wrapper = mountFilter({ control })
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    const item = wrapper.find('.bfp-result-item')
    await item.trigger('mouseleave')
    await item.trigger('mouseleave') // sees pending timer → clears + reschedules
    await vi.advanceTimersByTimeAsync(50)
    expect(control.clearPreview).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not throw on hover without a control', async () => {
    const wrapper = await mountReady({ control: null })
    const item = wrapper.find('.bfp-result-item')
    await item.trigger('mouseenter')
    await item.trigger('mouseleave')
    expect(wrapper.exists()).toBe(true)
  })
})

// =============================================================================
describe('SpaceFilter — track & pass-notification buttons', () => {
  it('tracks the satellite when TRACK SATELLITE is clicked', async () => {
    const control = makeFakeControl()
    const wrapper = await mountReady({ control })
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-track-btn').trigger('click')
    expect(control.switchSatellite).toHaveBeenLastCalledWith('25544', 'ISS (ZARYA)', true)
  })

  it('untracks when already following', async () => {
    const control = makeFakeControl({ followedNoradId: '25544' })
    const wrapper = await mountReady({ control })
    await expandFirstItem(wrapper)
    const trackBtn = wrapper.find('.sfr-acc-track-btn')
    expect(trackBtn.attributes('aria-label')).toBe('Untrack satellite')
    expect(trackBtn.classes()).toContain('sfr-acc-track-btn--active')
    await trackBtn.trigger('click')
    expect(control.stopFollowing).toHaveBeenCalled()
  })

  it('reflects satellite-follow-changed events', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('satellite-follow-changed', {
        detail: { noradId: '25544', following: true },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-track-btn').attributes('aria-label')).toBe('Untrack satellite')
    document.dispatchEvent(
      new CustomEvent('satellite-follow-changed', {
        detail: { noradId: '25544', following: false },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-track-btn').attributes('aria-label')).toBe('Track satellite')
  })

  it('toggles pass notifications, switching satellite first when not active', async () => {
    const control = makeFakeControl({ activeNoradId: '00000' })
    const wrapper = await mountReady({ control })
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-notif-btn').trigger('click')
    expect(control.switchSatellite).toHaveBeenLastCalledWith('25544', 'ISS (ZARYA)')
    expect(control.togglePassNotifications).toHaveBeenCalled()
  })

  it('does not switch satellite when notif toggled for the already-active sat', async () => {
    const control = makeFakeControl({ activeNoradId: '25544' })
    const wrapper = await mountReady({ control })
    await expandFirstItem(wrapper)
    control.switchSatellite.mockClear()
    await wrapper.find('.sfr-acc-notif-btn').trigger('click')
    expect(control.switchSatellite).not.toHaveBeenCalled()
    expect(control.togglePassNotifications).toHaveBeenCalled()
  })

  it('does nothing on notif toggle when no control is present', async () => {
    const wrapper = await mountReady({ control: null })
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-notif-btn').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('reflects satellite-pass-notif-changed: enable then disable for the same sat', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('satellite-pass-notif-changed', {
        detail: { noradId: '25544', enabled: true },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-notif-btn').classes()).toContain('sfr-acc-notif-btn--active')
    document.dispatchEvent(
      new CustomEvent('satellite-pass-notif-changed', {
        detail: { noradId: '25544', enabled: false },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-notif-btn').classes()).not.toContain('sfr-acc-notif-btn--active')
  })

  it('leaves notif state untouched when a disable event names a different sat', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    document.dispatchEvent(
      new CustomEvent('satellite-pass-notif-changed', {
        detail: { noradId: '25544', enabled: true },
      }),
    )
    await wrapper.vm.$nextTick()
    document.dispatchEvent(
      new CustomEvent('satellite-pass-notif-changed', {
        detail: { noradId: '99999', enabled: false },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-notif-btn').classes()).toContain('sfr-acc-notif-btn--active')
  })

  it('opens with notifications pre-armed when the store reports them enabled', async () => {
    vi.mocked(isPassNotifEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-notif-btn').classes()).toContain('sfr-acc-notif-btn--active')
  })

  it('seeds notif state from the control when pass notifications are already on at mount', async () => {
    const control = makeFakeControl({ passNotificationsEnabled: true, activeNoradId: '25544' })
    const wrapper = await mountReady({ control })
    expect(wrapper.find('.bfp-result-item').exists()).toBe(true)
  })

  it('uses the norad id for an unnamed sat across hover, track and notif', async () => {
    const control = makeFakeControl({ activeNoradId: '00000' })
    listResult.body = { satellites: [makeSat({ name: '', norad_id: '40069', category: 'active' })] }
    const wrapper = await mountReady({ control })
    const item = wrapper.find('.bfp-result-item')
    await item.trigger('mouseenter')
    expect(control.previewSatellite).toHaveBeenCalledWith('40069', '40069')
    await expandFirstItem(wrapper)
    expect(control.switchSatellite).toHaveBeenCalledWith('40069', '40069') // openAccordion
    await wrapper.find('.sfr-acc-track-btn').trigger('click')
    expect(control.switchSatellite).toHaveBeenLastCalledWith('40069', '40069', true) // trackSat
    control.switchSatellite.mockClear()
    await wrapper.find('.sfr-acc-notif-btn').trigger('click')
    expect(control.switchSatellite).toHaveBeenCalledWith('40069', '40069') // togglePassNotif
  })
})

// =============================================================================
describe('SpaceFilter — radio section', () => {
  function radioSat(extra: Partial<SatFixture> = {}) {
    listResult.body = {
      satellites: [
        makeSat({
          uplink_hz: 145_000_000,
          uplink_mode: 'FM',
          downlink_hz: 1_200_000_000,
          downlink_mode: 'USB',
          ctcss_hz: 88.5,
          transponder_type: 'Linear',
          beacon_hz: 5_000,
          radio_status: 'ACTIVE',
          packet_info: '9600 baud; FSK',
          radio_notes: 'note one; note two',
          ...extra,
        }),
      ],
    }
  }

  it('formats frequencies across GHz/MHz/kHz, with modes, ctcss, transponder and status', async () => {
    radioSat()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const text = wrapper.find('.sfr-acc-section--radio').text()
    expect(text).toContain('1.200 GHz')
    expect(text).toContain('145.000 MHz')
    expect(text).toContain('5.000 kHz')
    expect(text).toContain('· FM')
    expect(text).toContain('· USB')
    expect(text).toContain('88.5 Hz')
    expect(text).toContain('Linear')
    expect(text).toContain('Active')
  })

  it('renders a sub-kHz frequency in plain Hz', async () => {
    radioSat({ uplink_hz: 500, downlink_hz: undefined, beacon_hz: undefined })
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-section--radio').text()).toContain('500 Hz')
  })

  it('splits packet info and radio notes into list items', async () => {
    radioSat()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const items = wrapper.findAll('.sfr-acc-radio-list li').map((li) => li.text())
    expect(items).toEqual(expect.arrayContaining(['9600 baud', 'FSK', 'note one', 'note two']))
  })

  it('omits the radio section when the satellite has no radio info', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-section--radio').exists()).toBe(false)
  })
})

// =============================================================================
describe('SpaceFilter — auto-tune & record', () => {
  function downlinkSat() {
    listResult.body = {
      satellites: [makeSat({ downlink_hz: 437_000_000, downlink_mode: 'FM' })],
    }
  }

  it('arms auto-tune, persisting the setting and adding an alert card', async () => {
    downlinkSat()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-autotune-btn').trigger('click')
    expect(setAutoTuneEnabled).toHaveBeenCalledWith(
      '25544',
      true,
      expect.objectContaining({ name: 'ISS (ZARYA)', downlinkHz: 437_000_000, downlinkMode: 'FM' }),
    )
    const store = useNotificationsStore()
    expect(store.items.some((item) => item.type === 'autotune' && item.noradId === '25544')).toBe(
      true,
    )
  })

  it('arms auto-tune for an unnamed sat with no downlink mode', async () => {
    listResult.body = {
      satellites: [makeSat({ name: '', norad_id: '40069', downlink_hz: 437_000_000 })],
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-autotune-btn').trigger('click')
    const call = vi.mocked(setAutoTuneEnabled).mock.calls[0]
    expect(call[2]).toMatchObject({ name: '40069', downlinkHz: 437_000_000 })
    expect(call[2]?.downlinkMode).toBeUndefined()
  })

  it('disarms auto-tune and dismisses its alert card', async () => {
    downlinkSat()
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const store = useNotificationsStore()
    store.add({
      type: 'autotune',
      title: 'ISS (ZARYA)',
      detail: 'Auto-tune on pass enabled',
      noradId: '25544',
      satName: 'ISS (ZARYA)',
    })
    await wrapper.find('.sfr-acc-autotune-btn').trigger('click')
    expect(setAutoTuneEnabled).toHaveBeenCalledWith('25544', false, expect.anything())
    expect(store.items.some((item) => item.type === 'autotune' && item.noradId === '25544')).toBe(
      false,
    )
  })

  it('disables the record button until auto-tune is armed', async () => {
    downlinkSat()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-record-btn').attributes('disabled')).toBeDefined()
  })

  it('arms record while auto-tune is on, folding into the existing alert card', async () => {
    downlinkSat()
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const store = useNotificationsStore()
    const existingId = store.add({
      type: 'autotune',
      title: 'ISS (ZARYA)',
      detail: 'Auto-tune on pass enabled',
      noradId: '25544',
      satName: 'ISS (ZARYA)',
    })
    await wrapper.find('.sfr-acc-record-btn').trigger('click')
    expect(setRecordOnPassEnabled).toHaveBeenCalledWith('25544', true, { name: 'ISS (ZARYA)' })
    expect(store.items.find((item) => item.id === existingId)!.detail).toBe(
      'Auto-tune and record on pass enabled',
    )
  })

  it('adds a fresh armed card if record is toggled with no existing card', async () => {
    downlinkSat()
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const store = useNotificationsStore()
    expect(store.items).toHaveLength(0)
    await wrapper.find('.sfr-acc-record-btn').trigger('click')
    const card = store.items.find((item) => item.type === 'autotune' && item.noradId === '25544')!
    expect(card.detail).toBe('Auto-tune and record on pass enabled')
  })

  it('records an unnamed sat using the norad id as the name', async () => {
    listResult.body = {
      satellites: [makeSat({ name: '', norad_id: '40069', downlink_hz: 437_000_000 })],
    }
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await wrapper.find('.sfr-acc-record-btn').trigger('click')
    expect(setRecordOnPassEnabled).toHaveBeenCalledWith('40069', true, { name: '40069' })
  })

  it('disarms record, reverting the card detail to auto-tune only', async () => {
    downlinkSat()
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    vi.mocked(isRecordOnPassEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const store = useNotificationsStore()
    const id = store.add({
      type: 'autotune',
      title: 'ISS (ZARYA)',
      detail: 'Auto-tune and record on pass enabled',
      noradId: '25544',
      satName: 'ISS (ZARYA)',
    })
    expect(wrapper.find('.sfr-acc-record-btn').classes()).toContain('sfr-acc-record-btn--active')
    await wrapper.find('.sfr-acc-record-btn').trigger('click')
    expect(setRecordOnPassEnabled).toHaveBeenCalledWith('25544', false, expect.anything())
    expect(store.items.find((item) => item.id === id)!.detail).toBe('Auto-tune on pass enabled')
  })

  it('does not render auto-tune/record buttons for a sat without a downlink', async () => {
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-autotune-btn').exists()).toBe(false)
    expect(wrapper.find('.sfr-acc-record-btn').exists()).toBe(false)
  })
})

// =============================================================================
describe('SpaceFilter — auto-tune lock-in conflict', () => {
  // The expanded sat's own passes come from the accordion fetch; OTHER armed sats'
  // passes are fetched lazily via refreshArmedPasses (one fetch per armed id).
  function armConflictScenario() {
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    // ISS's own accordion passes overlap METEOR's window below.
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW + 100_000, los_unix_ms: NOW + 400_000 })],
      computed_at: new Date().toISOString(),
    }
    // Two armed sats: the expanded ISS (25544) + the other one (40069 / METEOR).
    vi.mocked(getAllPassNotifs).mockReturnValue({
      '25544': { name: 'ISS' },
      '40069': { name: 'METEOR' },
    } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    // The lazy armed-passes fetch for METEOR returns an overlapping window.
    fetchOverride = (url) => {
      if (url.includes('/satellite/40069/passes')) {
        return makeResponse({
          ok: true,
          status: 200,
          body: { passes: [{ aos_unix_ms: NOW + 200_000, los_unix_ms: NOW + 500_000 }] },
        })
      }
      return defaultRouter(url)
    }
  }

  it('warns when another armed sat overlaps the expanded sat', async () => {
    armConflictScenario()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    const warn = wrapper.find('.sfr-acc-autotune-warn')
    expect(warn.exists()).toBe(true)
    expect(warn.text()).toContain('Overlaps METEOR')
  })

  it('evaluates every armed-pass case: past, non-overlapping (both arms) and overlapping', async () => {
    // Expanded ISS has one future pass; several other armed sats exercise each arm
    // of the overlap test.
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW + 100_000, los_unix_ms: NOW + 400_000 })],
      computed_at: new Date().toISOString(),
    }
    vi.mocked(getAllPassNotifs).mockReturnValue({
      '25544': { name: 'ISS' },
      '40069': { name: 'METEOR' }, // overlaps
      '11111': { name: 'AFTER' }, // starts after mine ends → second && arm false
      '22222': { name: 'BEFORE' }, // ends before mine starts → first && arm false
      '33333': { name: 'PAST' }, // already LOS'd → skipped by the time guard
      '44444': { name: 'EMPTY' }, // armed sat the fetch returns no passes for
    } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    // Each other armed sat's lazy passes fetch returns a tailored window.
    const armedPassesById: Record<string, Array<{ aos_unix_ms: number; los_unix_ms: number }>> = {
      '40069': [{ aos_unix_ms: NOW + 200_000, los_unix_ms: NOW + 500_000 }],
      '11111': [{ aos_unix_ms: NOW + 450_000, los_unix_ms: NOW + 600_000 }],
      '22222': [{ aos_unix_ms: NOW + 10_000, los_unix_ms: NOW + 50_000 }],
      '33333': [{ aos_unix_ms: NOW - 500_000, los_unix_ms: NOW - 100_000 }],
    }
    fetchOverride = (url) => {
      const match = url.match(/\/satellite\/(\d+)\/passes/)
      if (match) {
        const id = match[1]
        if (id === '25544') return makeResponse(accResult)
        if (id === '44444') return makeResponse({ ok: true, status: 200, body: {} }) // no `passes`
        return makeResponse({
          ok: true,
          status: 200,
          body: { passes: armedPassesById[id] ?? [] },
        })
      }
      return defaultRouter(url)
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    // Only METEOR genuinely overlaps → it is the surfaced conflict.
    expect(wrapper.find('.sfr-acc-autotune-warn').text()).toContain('Overlaps METEOR')
  })

  it('refreshes conflict data on a satellite-auto-tune-changed event', async () => {
    armConflictScenario()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    document.dispatchEvent(
      new CustomEvent('satellite-auto-tune-changed', {
        detail: { noradId: '25544', enabled: true },
      }),
    )
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(true)
  })

  it('drops conflict data when the expanded sat is disarmed via the event', async () => {
    armConflictScenario()
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(true)
    // Now report the expanded sat as no longer armed; the event clears armedPasses.
    vi.mocked(isAutoTuneEnabled).mockImplementation((id: string) => id !== '25544')
    document.dispatchEvent(
      new CustomEvent('satellite-auto-tune-changed', {
        detail: { noradId: '25544', enabled: false },
      }),
    )
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(false)
  })

  it('clears armed-pass data when arming a sat with no other armed sats', async () => {
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    vi.mocked(getAllPassNotifs).mockReturnValue({ '25544': { name: 'ISS' } } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    // Only one armed sat → no conflict warning.
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(false)
  })

  it('clears armed-pass data when arming with no location', async () => {
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    vi.mocked(getAllPassNotifs).mockReturnValue({
      '25544': { name: 'ISS' },
      '40069': { name: 'METEOR' },
    } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    // Location present for the list/accordion, gone by the time arming refreshes.
    let location: [number, number] | null = [10, 50]
    const wrapper = await mountReady({ getUserLocation: () => location })
    location = null
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(false)
  })

  it('recovers from a failing armed-passes fetch without a conflict warning', async () => {
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW + 100_000, los_unix_ms: NOW + 400_000 })],
      computed_at: new Date().toISOString(),
    }
    vi.mocked(getAllPassNotifs).mockReturnValue({
      '25544': { name: 'ISS' },
      '40069': { name: 'METEOR' },
    } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    fetchOverride = (url) => {
      if (url.includes('/satellite/40069/passes')) return Promise.reject(new Error('down'))
      return defaultRouter(url)
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(false)
  })

  it('ignores a non-OK armed-passes response (treated as no passes)', async () => {
    listResult.body = {
      satellites: [makeSat({ norad_id: '25544', name: 'ISS', downlink_hz: 437_000_000 })],
    }
    vi.mocked(getAllPassNotifs).mockReturnValue({
      '25544': { name: 'ISS' },
      '40069': { name: 'METEOR' },
    } as never)
    vi.mocked(isAutoTuneEnabled).mockReturnValue(true)
    fetchOverride = (url) => {
      if (url.includes('/satellite/40069/passes'))
        return makeResponse({ ok: false, status: 500, body: {} })
      return defaultRouter(url)
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-autotune-warn').exists()).toBe(false)
  })
})

// =============================================================================
describe('SpaceFilter — polar plot & upcoming-passes section', () => {
  it('plots the next pass with a sky track and shows its max elevation', async () => {
    accResult.body = {
      passes: [
        makeAccPass({
          aos_unix_ms: NOW + 1_200_000,
          los_unix_ms: NOW + 1_500_000,
          max_elevation_deg: 62.4,
          sky_track: [
            { az: 10, el: 0 },
            { az: 90, el: 45 },
            { az: 170, el: 5 },
          ],
        }),
      ],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.findComponent({ name: 'SatPolarPlot' }).exists()).toBe(true)
    expect(wrapper.find('.sfr-acc-polar-title').text()).toContain('NEXT PASS')
    expect(wrapper.find('.sfr-acc-polar-maxel').text()).toBe('MAX 62°')
  })

  it('labels a currently-in-progress pass as CURRENT PASS and shows the live marker', async () => {
    accResult.body = {
      passes: [
        makeAccPass({
          aos_unix_ms: NOW - 60_000,
          los_unix_ms: NOW + 120_000,
          sky_track: [
            { az: 0, el: 0 },
            { az: 90, el: 30 },
          ],
        }),
      ],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-polar-title').text()).toContain('CURRENT PASS')
    document.dispatchEvent(
      new CustomEvent('sat-position-update', {
        detail: {
          noradId: '25544',
          position: { alt_km: 400, velocity_kms: 7, track_deg: 90, lat: 0, lon: 0, az: 45, el: 20 },
        },
      }),
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'SatPolarPlot' }).props('live')).toEqual({
      az: 45,
      el: 20,
    })
  })

  it('shows the NO UPCOMING placeholder when there is no plottable pass', async () => {
    accResult.body = { passes: [], computed_at: new Date().toISOString() }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-polar-empty').text()).toBe('NO UPCOMING PASS TO PLOT')
  })

  it('shows the NO UPCOMING placeholder when all passes are in the past', async () => {
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW - 600_000, los_unix_ms: NOW - 300_000 })],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(wrapper.find('.sfr-acc-polar-title').text()).toContain('NEXT PASS')
    expect(wrapper.find('.sfr-acc-polar-empty').text()).toBe('NO UPCOMING PASS TO PLOT')
  })

  it('renders upcoming-pass cards with date/time/countdown/max-el', async () => {
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW + 1_200_000, los_unix_ms: NOW + 1_500_000 })],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const passCard = wrapper.find('.sfr-acc-pass-card')
    expect(passCard.exists()).toBe(true)
    expect(passCard.find('.sfr-acc-pass-countdown').text()).toContain('IN ')
    expect(passCard.find('.sfr-acc-pass-maxel').text()).toBe('MAX 33.3°')
  })

  it('labels an in-progress upcoming pass as NOW', async () => {
    accResult.body = {
      passes: [makeAccPass({ aos_unix_ms: NOW - 30_000, los_unix_ms: NOW + 90_000 })],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    const countdown = wrapper.find('.sfr-acc-pass-countdown')
    expect(countdown.text()).toBe('NOW')
    expect(countdown.classes()).toContain('sfr-in-progress')
  })

  it('ticks the accordion + countdown intervals each second while expanded', async () => {
    // Use fake timers from mount so both setInterval timers are created under fake
    // control and actually fire when advanced.
    vi.useFakeTimers()
    const wrapper = mountFilter()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises() // loadSatellites
    await wrapper.find('.bfp-result-item').trigger('click')
    await flushPromises() // accordion fetch → startItemTick under fake timers
    await wrapper.vm.$nextTick()
    await vi.advanceTimersByTimeAsync(1000) // fires countdownTick (with passes) + itemTickInterval
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sfr-acc-pass-card').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('ticks the countdown interval with nothing expanded (empty-accordion branch)', async () => {
    vi.useFakeTimers()
    const wrapper = mountFilter()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000) // countdownTick fires while accordionPasses is empty
    expect(wrapper.find('.bfp-result-item').exists()).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })
})

// =============================================================================
describe('SpaceFilter — settings-panel-closed lazy load', () => {
  it('loads the database on settings-panel-closed if it was not yet loaded', async () => {
    // First load fails (non-OK) but still sets loaded=true, so we force the
    // not-loaded path by holding the initial load open.
    let release: (value: unknown) => void = () => {}
    let calls = 0
    fetchOverride = (url) => {
      if (url.includes('/tle/list')) {
        calls++
        if (calls === 1) {
          return new Promise((resolve) => {
            release = () => resolve(makeResponse(listResult))
          })
        }
        return makeResponse(listResult)
      }
      return defaultRouter(url)
    }
    const wrapper = mountFilter()
    await wrapper.vm.$nextTick()
    // Still loading (first fetch pending) → onSettingsPanelClosed sees loaded=false.
    document.dispatchEvent(new CustomEvent('settings-panel-closed'))
    await flushPromises()
    release(null)
    await flushPromises()
    expect(calls).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })

  it('does not reload on settings-panel-closed once already loaded', async () => {
    const wrapper = await mountReady()
    const listCallsBefore = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/tle/list')).length
    document.dispatchEvent(new CustomEvent('settings-panel-closed'))
    await flushPromises()
    const listCallsAfter = vi
      .mocked(global.fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/tle/list')).length
    expect(listCallsAfter).toBe(listCallsBefore)
    wrapper.unmount()
  })
})

// =============================================================================
describe('SpaceFilter — lifecycle & focus', () => {
  it('exposes a focus() method that focuses the input', async () => {
    const wrapper = await mountReady()
    const input = wrapper.find('#space-filter-input').element as HTMLInputElement
    const focusSpy = vi.spyOn(input, 'focus')
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(focusSpy).toHaveBeenCalled()
  })

  it('tears down the countdown tick, item interval, abort and preview timer on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    const wrapper = await mountReady()
    await expandFirstItem(wrapper) // starts the item tick + sets itemFetchAbort
    await wrapper.find('.bfp-result-item').trigger('mouseleave') // schedules a preview clear
    wrapper.unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })
})

// =============================================================================
describe('SpaceFilter — accessibility', () => {
  it('has no axe violations in the loaded list', async () => {
    const wrapper = await mountReady()
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })

  it('has no axe violations with an expanded radio + auto-tune accordion', async () => {
    listResult.body = {
      satellites: [
        makeSat({
          uplink_hz: 145_000_000,
          downlink_hz: 437_000_000,
          downlink_mode: 'FM',
          radio_status: 'ACTIVE',
          packet_info: '9600 baud',
        }),
      ],
    }
    accResult.body = {
      passes: [
        makeAccPass({
          sky_track: [
            { az: 0, el: 0 },
            { az: 90, el: 30 },
          ],
        }),
      ],
      computed_at: new Date().toISOString(),
    }
    const wrapper = await mountReady()
    await expandFirstItem(wrapper)
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
