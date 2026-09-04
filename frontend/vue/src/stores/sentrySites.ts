import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listSentrySites, type SentrySite } from '@/services/sentryApi'

/**
 * How often the site list is refreshed while a map is open, in ms.
 *
 * Slow on purpose: a Sentry is a fixed installation, so this poll is watching
 * for hosts being added, removed or going off the air, not for movement. The
 * backend serves the list from its poller cache, so a tick costs no round trip
 * to any Pi.
 */
const SENTRY_SITE_POLL_INTERVAL_MS = 15_000

/**
 * The Sentry hosts that report where they are — the cross-cutting state behind
 * the Sentry markers on every domain map (`SentrySitesControl`).
 *
 * A store rather than per-map component state because all four domain maps plot
 * the same fleet: an operator switching from AIR to LAND should find the sites
 * already there, not wait out another fetch. Polling is ref-counted so the last
 * map to unmount stops it.
 */
export const useSentrySitesStore = defineStore('sentrySites', () => {
  /** Every enabled Sentry host with a known position, newest snapshot wins. */
  const sites = ref<SentrySite[]>([])
  /**
   * True once a list has been fetched successfully at least once.
   *
   * An empty `sites` means two different things — "no host reports a position"
   * and "we have not asked yet" — and a consumer that pins itself to one site
   * (the range-ring origin) has to tell them apart: only the first is grounds
   * for concluding the site is gone.
   */
  const loaded = ref(false)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollers = 0

  /** Refresh the site list. Silent on transient/offline failures — the
   *  last-known list simply persists, which is the truthful thing to draw. */
  async function fetchSites(): Promise<void> {
    try {
      sites.value = await listSentrySites()
      loaded.value = true
    } catch {
      /* offline / transient — keep the current list */
    }
  }

  /** Begin polling the site list (ref-counted). The first caller fetches
   *  immediately and starts the interval; later callers just join it. */
  function startPolling(): void {
    pollers += 1
    if (pollTimer !== null) return
    void fetchSites()
    pollTimer = setInterval(() => void fetchSites(), SENTRY_SITE_POLL_INTERVAL_MS)
  }

  /** Stop polling when the last consumer leaves (ref-counted). */
  function stopPolling(): void {
    pollers = Math.max(0, pollers - 1)
    if (pollers > 0 || pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  return { sites, loaded, fetchSites, startPolling, stopPolling }
})
