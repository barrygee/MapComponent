import { computed, type ComputedRef } from 'vue'
import { useAirStore, USER_ALERT_LOCATION_ID, sentryAlertLocationId } from '@/stores/air'
import { useSentrySitesStore } from '@/stores/sentrySites'
import { useUserLocation } from '@/composables/useUserLocation'
import { siteLabel } from '@/utils/sentrySiteLabel'
import type { OverheadAlertZone } from '@/components/air/controls/overhead-zone/OverheadAlertsTracker'

/**
 * Every place overhead alerts can watch, with its own settings resolved.
 *
 * A Sentry watches its own patch of sky, so "is anything overhead?" is asked
 * once per receiver rather than once for the app. The operator's own position
 * leads the list — it is the one place that exists before any Sentry does — and
 * each Sentry follows in fleet order.
 *
 * Used by the two things that need the same answer: the background alert
 * service, which decides what to notify about, and the Air map, which draws a
 * zone for each. Both call this, so the zones and the alerts cannot disagree.
 *
 * Everything here derives from stores, so there is nothing to memoise — each
 * caller gets its own computed over the same reactive sources. (Holding one
 * shared computed would pin the store instances it first resolved, which is a
 * trap the moment a second pinia exists.)
 */
export interface OverheadAlertLocation extends OverheadAlertZone {
  /** True for the operator's own position, false for a Sentry site. */
  isUser: boolean
}

/** The alert locations, in the order the Settings table lists them. */
export function useOverheadAlertZones(): {
  locations: ComputedRef<OverheadAlertLocation[]>
  /** Only those actually watching something — what the tracker and map draw. */
  activeZones: ComputedRef<OverheadAlertZone[]>
} {
  const airStore = useAirStore()
  const sentrySitesStore = useSentrySitesStore()
  const { location } = useUserLocation()

  const locations = computed<OverheadAlertLocation[]>(() => {
    const zones: OverheadAlertLocation[] = []

    const own = location.value
    if (own) {
      zones.push({
        id: USER_ALERT_LOCATION_ID,
        label: 'MY LOCATION',
        lon: own.lon,
        lat: own.lat,
        isUser: true,
        ...airStore.overheadAlertFor(USER_ALERT_LOCATION_ID),
      })
    }

    for (const site of sentrySitesStore.sites) {
      const id = sentryAlertLocationId(site.id)
      zones.push({
        id,
        label: siteLabel(site).toUpperCase(),
        lon: site.longitude,
        lat: site.latitude,
        isUser: false,
        ...airStore.overheadAlertFor(id),
      })
    }

    return zones
  })

  return {
    locations,
    activeZones: computed(() => locations.value.filter((zone) => zone.civil || zone.mil)),
  }
}
