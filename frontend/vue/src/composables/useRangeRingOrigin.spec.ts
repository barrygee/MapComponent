import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import type { SentrySite } from '@/services/sentryApi'

vi.mock('@/services/settingsApi', () => ({
  put: vi.fn(() => Promise.resolve()),
  getNamespace: vi.fn(() => Promise.resolve(null)),
  del: vi.fn(),
  getAll: vi.fn(),
}))

const SETTING_KEY = 'sentinel_range_ring_origin'
const CACHE_KEY = 'sentinel_range_ring_sentry'
const LOCATION_KEY = 'sentinel_user_location'

function site(overrides: Partial<SentrySite> = {}): SentrySite {
  return {
    id: 1,
    name: 'Gateshead',
    address: '192.168.1.60',
    port: 8000,
    reachable: true,
    latitude: 54.95,
    longitude: -1.53,
    updated_at: null,
    ...overrides,
  }
}

interface SetupOptions {
  /** Raw value to seed into the stored-setting key (stringified for you). */
  storedSetting?: unknown
  /** Raw value to seed into the stored sentry-position cache. */
  storedCache?: unknown
  userLocation?: { lat: number; lon: number } | null
  sites?: SentrySite[]
  sitesLoaded?: boolean
}

/**
 * Load a pristine copy of the composable.
 *
 * Its state is module-level and shared app-wide by design, so every test needs
 * its own module graph — including pinia and the store, which must come from
 * the same graph or `setActivePinia` would apply to a different copy of pinia
 * than the composable resolves.
 */
async function setup(options: SetupOptions = {}) {
  localStorage.clear()
  if (options.storedSetting !== undefined) {
    localStorage.setItem(SETTING_KEY, JSON.stringify(options.storedSetting))
  }
  if (options.storedCache !== undefined) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(options.storedCache))
  }
  if (options.userLocation) {
    localStorage.setItem(
      LOCATION_KEY,
      JSON.stringify({
        latitude: options.userLocation.lat,
        longitude: options.userLocation.lon,
        ts: Date.now(),
        manual: true,
      }),
    )
  }

  vi.resetModules()
  const { setActivePinia, createPinia } = await import('pinia')
  setActivePinia(createPinia())

  const { useSentrySitesStore } = await import('@/stores/sentrySites')
  const sentrySitesStore = useSentrySitesStore()
  sentrySitesStore.sites = options.sites ?? []
  sentrySitesStore.loaded = options.sitesLoaded ?? false

  // Re-imported per graph: vi.mock's factory re-runs on reset, so the spies the
  // composable calls are not the ones this file imported at the top.
  const settingsApi = await import('@/services/settingsApi')
  const composable = await import('./useRangeRingOrigin')
  return { ...composable, api: composable.useRangeRingOrigin(), sentrySitesStore, settingsApi }
}

const readStoredSetting = () => JSON.parse(localStorage.getItem(SETTING_KEY) ?? 'null')
const readStoredCache = () => JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')

describe('useRangeRingOrigin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('resolving the origin', () => {
    it('centres on the operator when the choice is "user" and a location exists', async () => {
      const { api } = await setup({ userLocation: { lat: 51.5, lon: -0.12 } })
      expect(api.origin.value).toEqual({
        longitude: -0.12,
        latitude: 51.5,
        label: 'MY LOCATION',
        kind: 'user',
        degraded: false,
      })
    })

    it('resolves to nothing when the choice is "user" and no location is set', async () => {
      const { api } = await setup({ userLocation: null })
      // Null is what keeps the rings hidden — the pre-existing rule, now with
      // three ways of being satisfied rather than one.
      expect(api.origin.value).toBeNull()
    })

    it('centres on a pinned Sentry, naming it in upper case', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site()],
        sitesLoaded: true,
      })
      expect(api.origin.value).toMatchObject({
        longitude: -1.53,
        latitude: 54.95,
        label: 'GATESHEAD',
        kind: 'sentry',
        degraded: false,
      })
    })

    it('marks a Sentry that is off air as degraded but keeps drawing it', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site({ reachable: false })],
        sitesLoaded: true,
      })
      // A receiver going quiet does not move it: the rings hold position.
      expect(api.origin.value).toMatchObject({ degraded: true, latitude: 54.95 })
    })

    it('falls back to the cached position while the first poll is outstanding', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
        storedCache: { id: 7, longitude: 2, latitude: 49, name: 'COASTAL' },
        sites: [],
        sitesLoaded: false,
      })
      expect(api.origin.value).toMatchObject({
        longitude: 2,
        latitude: 49,
        label: 'COASTAL',
        degraded: true,
      })
    })

    it.each([
      ['an empty name', { id: 7, longitude: 2, latitude: 49, name: '' }],
      ['no name key at all', { id: 7, longitude: 2, latitude: 49 }],
    ])('labels a cached Sentry generically when the cache carries %s', async (_case, cache) => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
        storedCache: cache,
      })
      expect(api.origin.value).toMatchObject({ label: 'SENTRY' })
    })

    it('resolves to nothing for a pinned Sentry with no live or cached position', async () => {
      const { api } = await setup({ storedSetting: { kind: 'sentry', sentryHostId: 7 } })
      expect(api.origin.value).toBeNull()
    })

    it('ignores a cache belonging to a different host', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
        storedCache: { id: 99, longitude: 2, latitude: 49, name: 'OTHER' },
      })
      expect(api.origin.value).toBeNull()
    })

    it('falls back to the operator when a legacy custom point is stored', async () => {
      // The custom kind was removed; a value saved by an older build must
      // degrade to the default rather than leaving the rings unresolvable.
      const { api } = await setup({
        storedSetting: { kind: 'custom', latitude: 52.04, longitude: -0.75 },
        userLocation: { lat: 51.5, lon: -0.12 },
      })
      expect(api.setting.value).toEqual({ kind: 'user', sentryHostId: null })
      expect(api.origin.value).toMatchObject({ kind: 'user', latitude: 51.5 })
    })

    it('follows the operator live once the choice is "user"', async () => {
      const { api } = await setup({ userLocation: { lat: 51.5, lon: -0.12 } })
      window.dispatchEvent(
        new CustomEvent('sentinel:setUserLocation', {
          detail: { longitude: 1.5, latitude: 48.5, persist: false },
        }),
      )
      await nextTick()
      expect(api.origin.value).toMatchObject({ longitude: 1.5, latitude: 48.5 })
    })

    it('follows a pinned Sentry when the host reports a new position', async () => {
      const { api, sentrySitesStore } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site()],
        sitesLoaded: true,
      })
      sentrySitesStore.sites = [site({ latitude: 55.5, longitude: -2.5 })]
      await nextTick()
      // Pinning by id, not by coordinate, is what makes the rings track a Pi
      // that moves.
      expect(api.origin.value).toMatchObject({ latitude: 55.5, longitude: -2.5 })
    })
  })

  describe('reading malformed stored state', () => {
    it('falls back to the default for a non-object setting', async () => {
      const { api } = await setup({ storedSetting: 'nonsense' })
      expect(api.setting.value.kind).toBe('user')
    })

    it('falls back to the default for a null setting', async () => {
      const { api } = await setup({ storedSetting: null })
      expect(api.setting.value.kind).toBe('user')
    })

    it('falls back when a sentry setting carries no usable host id', async () => {
      const { api } = await setup({ storedSetting: { kind: 'sentry', sentryHostId: 'abc' } })
      expect(api.setting.value.kind).toBe('user')
    })

    it('falls back when the stored setting is not valid JSON', async () => {
      localStorage.clear()
      localStorage.setItem(SETTING_KEY, '{oops')
      vi.resetModules()
      const { setActivePinia, createPinia } = await import('pinia')
      setActivePinia(createPinia())
      const composable = await import('./useRangeRingOrigin')
      expect(composable.useRangeRingOrigin().setting.value.kind).toBe('user')
    })

    it('ignores a cache with a non-integer id or an impossible position', async () => {
      const withBadId = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
        storedCache: { id: 'seven', longitude: 2, latitude: 49, name: 'X' },
      })
      expect(withBadId.api.origin.value).toBeNull()

      const withBadPosition = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
        storedCache: { id: 7, longitude: 999, latitude: 49, name: 'X' },
      })
      expect(withBadPosition.api.origin.value).toBeNull()
    })

    it('ignores a cache that is not valid JSON', async () => {
      localStorage.clear()
      localStorage.setItem(SETTING_KEY, JSON.stringify({ kind: 'sentry', sentryHostId: 7 }))
      localStorage.setItem(CACHE_KEY, '{oops')
      vi.resetModules()
      const { setActivePinia, createPinia } = await import('pinia')
      setActivePinia(createPinia())
      const composable = await import('./useRangeRingOrigin')
      expect(composable.useRangeRingOrigin().origin.value).toBeNull()
    })

    it('survives a localStorage that refuses to be read', async () => {
      // A usable choice is stored first, so this goes red if the throwing read
      // is not actually reached: without the spy the setting would load as
      // 'sentry', and without the catch the import would throw.
      localStorage.clear()
      localStorage.setItem(SETTING_KEY, JSON.stringify({ kind: 'sentry', sentryHostId: 7 }))
      const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('private mode')
      })
      vi.resetModules()
      const { setActivePinia, createPinia } = await import('pinia')
      setActivePinia(createPinia())
      const composable = await import('./useRangeRingOrigin')

      expect(composable.useRangeRingOrigin().setting.value.kind).toBe('user')

      getItem.mockRestore()
    })
  })

  describe('choosing an origin', () => {
    it('stores the operator as the origin in memory and locally, at once', async () => {
      const { api, settingsApi } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
      })
      api.selectUserOrigin()
      expect(api.setting.value.kind).toBe('user')
      expect(readStoredSetting()).toMatchObject({ kind: 'user' })
      // The config write is staged by the Settings control for APPLY CHANGES,
      // so choosing does not write it here — see persistOriginToConfig.
      expect(settingsApi.put).not.toHaveBeenCalled()
    })

    it('pins a Sentry by id', async () => {
      const { api } = await setup({ sites: [site()], sitesLoaded: true })
      api.selectSentryOrigin(1)
      expect(api.setting.value).toMatchObject({ kind: 'sentry', sentryHostId: 1 })
      expect(readStoredSetting()).toMatchObject({ kind: 'sentry', sentryHostId: 1 })
    })

    it('persistOriginToConfig writes the current choice to the config database', async () => {
      const { api, settingsApi } = await setup()
      api.selectSentryOrigin(7)

      await api.persistOriginToConfig()

      expect(settingsApi.put).toHaveBeenCalledWith('app', 'rangeRingOrigin', {
        kind: 'sentry',
        sentryHostId: 7,
      })
    })

    it('keeps the in-memory choice when localStorage refuses the write', async () => {
      const { api } = await setup()
      const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('private mode')
      })
      api.selectSentryOrigin(7)
      // A private-mode browser still gets working rings for this session.
      expect(api.setting.value).toMatchObject({ kind: 'sentry', sentryHostId: 7 })
      setItem.mockRestore()
    })
  })

  describe('caching the pinned Sentry position', () => {
    it('records the live position so a reload draws before the first poll', async () => {
      await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site()],
        sitesLoaded: true,
      })
      expect(readStoredCache()).toEqual({
        id: 1,
        longitude: -1.53,
        latitude: 54.95,
        name: 'GATESHEAD',
      })
    })

    it('does not overwrite the cache from a degraded (stale) position', async () => {
      await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        storedCache: { id: 1, longitude: 9, latitude: 9, name: 'OLD' },
        sites: [site({ reachable: false })],
        sitesLoaded: true,
      })
      expect(readStoredCache()).toMatchObject({ name: 'OLD' })
    })

    it('does not cache anything while the choice is not a Sentry', async () => {
      await setup({ userLocation: { lat: 51.5, lon: -0.12 } })
      expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    })
  })

  describe('when the pinned Sentry is removed from the fleet', () => {
    it('falls back to the operator and says why, once', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        storedCache: { id: 1, longitude: -1.53, latitude: 54.95, name: 'GATESHEAD' },
        sites: [],
        sitesLoaded: true,
      })
      expect(api.setting.value.kind).toBe('user')
      expect(api.notice.value).toBe('GATESHEAD was removed — rings re-centred on your location.')
      expect(localStorage.getItem(CACHE_KEY)).toBe('null')
    })

    it('names the site generically when nothing was cached', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [],
        sitesLoaded: true,
      })
      expect(api.notice.value).toBe(
        'The Sentry site was removed — rings re-centred on your location.',
      )
    })

    it('waits for a list it has actually seen before concluding anything', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [],
        sitesLoaded: false,
      })
      // "No sites" and "not asked yet" are different facts; only the first is
      // grounds for dropping the operator's choice.
      expect(api.setting.value.kind).toBe('sentry')
      expect(api.notice.value).toBeNull()
    })

    it('leaves a still-present Sentry alone', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site()],
        sitesLoaded: true,
      })
      expect(api.setting.value.kind).toBe('sentry')
      expect(api.notice.value).toBeNull()
    })

    it('says nothing when the choice was never a Sentry', async () => {
      const { api } = await setup({ sites: [], sitesLoaded: true })
      expect(api.notice.value).toBeNull()
    })

    it('reacts to a host disappearing while the app is running', async () => {
      const { api, sentrySitesStore } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [site()],
        sitesLoaded: true,
      })
      sentrySitesStore.sites = []
      await nextTick()
      expect(api.setting.value.kind).toBe('user')
      expect(api.notice.value).toContain('was removed')
    })

    it('clearNotice dismisses the explanation once it has been read', async () => {
      const { api } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 1 },
        sites: [],
        sitesLoaded: true,
      })
      api.clearNotice()
      expect(api.notice.value).toBeNull()
    })
  })

  describe('hydrateFromConfig', () => {
    it('adopts the config value and mirrors it locally', async () => {
      const { api, settingsApi } = await setup()
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        rangeRingOrigin: { kind: 'sentry', sentryHostId: 7 },
      })
      await api.hydrateFromConfig()
      expect(api.setting.value).toMatchObject({ kind: 'sentry', sentryHostId: 7 })
      expect(readStoredSetting()).toMatchObject({ kind: 'sentry' })
    })

    it('leaves the local choice alone when the config is unreachable', async () => {
      const { api, settingsApi } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
      })
      vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
      await api.hydrateFromConfig()
      // Offline-friendly, matching useUserLocation: no key is not "cleared".
      expect(api.setting.value.kind).toBe('sentry')
    })

    it('leaves the local choice alone when the config has no such key', async () => {
      const { api, settingsApi } = await setup({
        storedSetting: { kind: 'sentry', sentryHostId: 7 },
      })
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({ location: {} })
      await api.hydrateFromConfig()
      expect(api.setting.value.kind).toBe('sentry')
    })

    it('degrades a malformed config value to the default rather than throwing', async () => {
      const { api, settingsApi } = await setup()
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({ rangeRingOrigin: 42 })
      await api.hydrateFromConfig()
      expect(api.setting.value.kind).toBe('user')
    })
  })

  describe('shared state', () => {
    it('hands every caller the same origin ref', async () => {
      const composable = await setup()
      const first = composable.api
      const second = composable.useRangeRingOrigin()
      // Two maps and the Settings panel must never disagree about the centre.
      expect(second.origin).toBe(first.origin)
      expect(second.setting).toBe(first.setting)
    })
  })
})
