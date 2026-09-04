import { computed, effectScope, ref, watch, type ComputedRef, type Ref } from 'vue'
import * as settingsApi from '@/services/settingsApi'
import { isValidLatLon } from '@/utils/locationUtils'
import { siteLabel } from '@/utils/sentrySiteLabel'
import { useUserLocation } from '@/composables/useUserLocation'
import { useSentrySitesStore } from '@/stores/sentrySites'

/**
 * The **ring origin** — the point range rings are drawn around.
 *
 * The rings were previously hard-wired to the operator's own ⊙ position and
 * hidden whenever there wasn't one, which made the toggle dead on a console
 * with no location set and left no way to ask "what is within 100 NM of *that*
 * receiver?" without overwriting your own position to find out. Rings are not
 * "distance from you"; they are distance from a chosen point, and this module
 * is that choice: shared app-wide (like `useUserLocation`, which it composes),
 * persisted, and resolved live against the Sentry fleet.
 *
 * Kinds:
 *  - `user`   — follows the ⊙ marker. The default, and the pre-existing behaviour.
 *  - `sentry` — pinned to one host **by id**, so the rings follow if the Pi moves.
 */

/** Which kind of point the rings are centred on. */
export type RingOriginKind = 'user' | 'sentry'

/** The operator's stored choice — what to centre on, not where that currently is. */
export interface RingOriginSetting {
  kind: RingOriginKind
  /** Which Sentry host, when `kind` is `sentry`. */
  sentryHostId: number | null
}

/** The choice resolved against live data — where the rings actually go. */
export interface ResolvedRingOrigin {
  longitude: number
  latitude: number
  /** Display name for the map label and the picker, e.g. `MY LOCATION`. */
  label: string
  kind: RingOriginKind
  /**
   * True when the point is a Sentry's last known position rather than a live
   * one — the host is off air, or has dropped out of the fleet list. The rings
   * stay where they are (a receiver going quiet does not move it) but say so.
   */
  degraded: boolean
}

const SETTING_LS_KEY = 'sentinel_range_ring_origin'
const SENTRY_CACHE_LS_KEY = 'sentinel_range_ring_sentry'
const SETTINGS_NAMESPACE = 'app'
const SETTINGS_KEY = 'rangeRingOrigin'

/** The default: rings around your own position, exactly as before this existed. */
const DEFAULT_SETTING: RingOriginSetting = {
  kind: 'user',
  sentryHostId: null,
}

/**
 * The chosen Sentry's last seen position and name, cached locally.
 *
 * Sites arrive from a poll that only starts when a map mounts, so on a cold
 * start there is a window with a pinned host id and nothing to draw. Seeding
 * from the last known position closes it, and doubles as what stays on screen
 * when the host later goes off air.
 */
interface SentryPositionCache {
  id: number
  longitude: number
  latitude: number
  name: string
}

function _readSetting(): RingOriginSetting {
  try {
    const raw = localStorage.getItem(SETTING_LS_KEY)
    return raw ? _coerceSetting(JSON.parse(raw)) : { ...DEFAULT_SETTING }
  } catch {
    return { ...DEFAULT_SETTING }
  }
}

/**
 * Narrow arbitrary stored/served JSON to a usable setting.
 *
 * Anything that does not describe a drawable origin degrades to the default
 * rather than throwing: this value comes from localStorage and from a config
 * file an operator can hand-edit, and a malformed one must not take the map
 * down with it.
 */
function _coerceSetting(value: unknown): RingOriginSetting {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_SETTING }
  const raw = value as Record<string, unknown>
  const kind = raw.kind
  if (kind === 'sentry') {
    const sentryHostId = Number(raw.sentryHostId)
    if (!Number.isInteger(sentryHostId)) return { ...DEFAULT_SETTING }
    return { kind: 'sentry', sentryHostId }
  }
  // Anything else — including the `custom` kind this once supported — falls
  // back to following the operator's own position.
  return { ...DEFAULT_SETTING }
}

function _readSentryCache(): SentryPositionCache | null {
  try {
    const raw = localStorage.getItem(SENTRY_CACHE_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SentryPositionCache>
    if (!Number.isInteger(parsed.id)) return null
    if (!isValidLatLon(Number(parsed.latitude), Number(parsed.longitude))) return null
    return {
      id: parsed.id as number,
      longitude: parsed.longitude as number,
      latitude: parsed.latitude as number,
      name: String(parsed.name ?? ''),
    }
  } catch {
    return null
  }
}

function _write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private-mode storage failure — the in-memory value still stands */
  }
}

// Module-level shared state: every map and the Settings panel read the same
// choice, so they can never disagree about where the rings are centred.
const _setting = ref<RingOriginSetting>(_readSetting())
const _sentryCache = ref<SentryPositionCache | null>(_readSentryCache())
/**
 * A one-off explanation for a change the operator did not make — today only
 * "the Sentry you pinned was removed". Held rather than shouted through the
 * alerts panel, which is for surveillance events, not UI bookkeeping.
 */
const _notice = ref<string | null>(null)

// Detached scope: the shared computed must outlive whichever component happens
// to call the composable first. Created inside a component's own scope it would
// be disposed on that component's unmount and quietly stop updating.
const _scope = effectScope(true)
let _origin: ComputedRef<ResolvedRingOrigin | null> | null = null

function _initShared(): void {
  if (_origin) return
  _scope.run(() => {
    const { location } = useUserLocation()
    const sentrySitesStore = useSentrySitesStore()

    _origin = computed<ResolvedRingOrigin | null>(() => {
      const setting = _setting.value

      if (setting.kind === 'sentry') {
        const site = sentrySitesStore.sites.find(
          (candidate) => candidate.id === setting.sentryHostId,
        )
        if (site) {
          return {
            longitude: site.longitude,
            latitude: site.latitude,
            label: siteLabel(site).toUpperCase(),
            kind: 'sentry',
            // Off air: the rings hold at its last reported position, and say so.
            degraded: !site.reachable,
          }
        }
        // Not in the list — either the poll hasn't answered yet or the host has
        // gone. Both draw the cached position; only the second resets the
        // choice, which the removed-host watcher below decides once the list is known.
        const cached = _sentryCache.value
        if (cached && cached.id === setting.sentryHostId) {
          return {
            longitude: cached.longitude,
            latitude: cached.latitude,
            label: cached.name || 'SENTRY',
            kind: 'sentry',
            degraded: true,
          }
        }
        return null
      }

      const userLocation = location.value
      if (!userLocation) return null
      return {
        longitude: userLocation.lon,
        latitude: userLocation.lat,
        label: 'MY LOCATION',
        kind: 'user',
        degraded: false,
      }
    })

    // Keep the cached position of the pinned host current, so a reload draws
    // the rings before the first poll answers.
    watch(
      () => (_setting.value.kind === 'sentry' ? _origin!.value : null),
      (resolved) => {
        if (!resolved || resolved.degraded) return
        const cache: SentryPositionCache = {
          id: _setting.value.sentryHostId as number,
          longitude: resolved.longitude,
          latitude: resolved.latitude,
          name: resolved.label,
        }
        _sentryCache.value = cache
        _write(SENTRY_CACHE_LS_KEY, cache)
      },
      { immediate: true },
    )

    // The one case where the app changes the choice on the operator's behalf:
    // the pinned host is no longer in a list we have actually seen, so the
    // reference cannot resolve to anything. Fall back and say why, once.
    watch(
      () => [sentrySitesStore.loaded, sentrySitesStore.sites, _setting.value] as const,
      ([loaded, sites, setting]) => {
        if (!loaded || setting.kind !== 'sentry') return
        if (sites.some((candidate) => candidate.id === setting.sentryHostId)) return
        const name = _sentryCache.value?.name ?? 'The Sentry site'
        _notice.value = `${name} was removed — rings re-centred on your location.`
        _sentryCache.value = null
        _write(SENTRY_CACHE_LS_KEY, null)
        setOrigin({ ...DEFAULT_SETTING })
        void persistOriginToConfig()
      },
      { immediate: true },
    )
  })
}

/**
 * Adopt a new choice in memory and in localStorage, so the rings move at once
 * and survive a reload even with the backend unreachable — the offline case
 * Sentinel is built for.
 *
 * Deliberately does NOT write the config database: that write is staged by the
 * Settings control so APPLY CHANGES commits it and reports what it did, rather
 * than the panel finding nothing pending and saying "NO CHANGES".
 */
export function setOrigin(next: RingOriginSetting): void {
  const coerced = _coerceSetting(next)
  _setting.value = coerced
  _write(SETTING_LS_KEY, coerced)
}

/** Write the current choice to the config database. Staged for APPLY CHANGES. */
export function persistOriginToConfig(): Promise<void> {
  return settingsApi.put(SETTINGS_NAMESPACE, SETTINGS_KEY, _setting.value)
}

/** Centre the rings on the operator's own position (the default). */
export function selectUserOrigin(): void {
  setOrigin({ ...DEFAULT_SETTING })
}

/** Centre the rings on one Sentry host, tracked by id. */
export function selectSentryOrigin(sentryHostId: number): void {
  setOrigin({ kind: 'sentry', sentryHostId })
}

/**
 * Reconcile with the config's `app.rangeRingOrigin` on startup, so the choice
 * follows the operator to another browser. A missing key leaves the local
 * choice alone — the same offline-friendly rule `useUserLocation` follows.
 */
async function hydrateFromConfig(): Promise<void> {
  const data = await settingsApi.getNamespace(SETTINGS_NAMESPACE)
  if (!data || !(SETTINGS_KEY in data)) return
  const coerced = _coerceSetting(data[SETTINGS_KEY])
  _setting.value = coerced
  _write(SETTING_LS_KEY, coerced)
}

/** Dismiss the "your Sentry was removed" explanation once it has been read. */
function clearNotice(): void {
  _notice.value = null
}

/**
 * The shared ring origin. `origin` is null when the choice cannot currently be
 * drawn (no location set, or a pinned host with no position yet) — which is
 * exactly when the rings must stay hidden.
 */
export function useRangeRingOrigin(): {
  setting: Ref<RingOriginSetting>
  origin: ComputedRef<ResolvedRingOrigin | null>
  notice: Ref<string | null>
  setOrigin: typeof setOrigin
  persistOriginToConfig: typeof persistOriginToConfig
  selectUserOrigin: typeof selectUserOrigin
  selectSentryOrigin: typeof selectSentryOrigin
  hydrateFromConfig: typeof hydrateFromConfig
  clearNotice: typeof clearNotice
} {
  _initShared()
  return {
    setting: _setting,
    origin: _origin!,
    notice: _notice,
    setOrigin,
    persistOriginToConfig,
    selectUserOrigin,
    selectSentryOrigin,
    hydrateFromConfig,
    clearNotice,
  }
}
