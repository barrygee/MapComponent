import { watch } from 'vue'
import { useNotificationsStore, getAircraftClickHandler } from '@/stores/notifications'
import { useAirNotifStore } from '@/stores/airNotif'
import { useUserLocation } from '@/composables/useUserLocation'
import { ADSB_POLL_INTERVAL_MS } from '@/constants/adsb'
import { OverheadAlertsTracker } from '@/components/air/controls/overhead-zone/OverheadAlertsTracker'
import { useOverheadAlertZones } from '@/composables/useOverheadAlertZones'
import { AircraftEventDetector } from '@/components/air/controls/adsb/AircraftEventDetector'
import {
  parseAircraftList,
  type ParsedAircraft,
  type AdsbApiEntry,
} from '@/components/air/controls/adsb/adsbParse'

// App-level background service that detects aircraft landing/departure and
// overhead-zone entry and fires the corresponding notifications — regardless of
// which section the user is currently viewing. Previously this detection lived
// inside AdsbLiveControl / OverheadAlertsTracker owned by AirMap.vue, so it
// stopped the moment the user navigated away from the Air section.
//
// This is the SOLE owner of landing/departure + overhead detection now; the map
// control keeps only rendering. Because there is one detector fed by one poll,
// there is no double-fire even while the Air section is mounted.
//
// Module-singleton (mirrors useUserLocation / useConnectivity). Instantiated and
// started once from App.vue.

// Matches the backend's ADS-B cache TTL — see `@/constants/adsb`. This service
// polls a different cache key than the map control (user location vs map
// centre), so both pollers share the upstream's single call budget; keeping
// this at the TTL stops the two starving each other of call slots.
const POLL_MS = ADSB_POLL_INTERVAL_MS

let _started = false
let _timer: ReturnType<typeof setInterval> | null = null
let _aborter: AbortController | null = null
let _latest: ParsedAircraft[] = []

function _featureCollection() {
  return {
    features: _latest.map((a) => ({
      geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] as [number, number] },
      properties: {
        hex: a.hex,
        flight: a.flight,
        r: a.r,
        alt_baro: a.alt,
        gs: a.gs,
        military: a.military,
      },
    })),
  }
}

function start(): void {
  if (_started) return
  _started = true

  const notifications = useNotificationsStore()
  const airNotif = useAirNotifStore()
  const { location } = useUserLocation()

  const detector = new AircraftEventDetector(notifications, airNotif)
  const { activeZones } = useOverheadAlertZones()
  const overhead = new OverheadAlertsTracker(
    notifications,
    _featureCollection,
    // When Air is mounted it registers an aircraft-click handler that selects
    // the plane; route overhead-alert clicks through it (no-op otherwise).
    (hex: string) => {
      getAircraftClickHandler()?.(hex)
    },
  )
  overhead.setZones(activeZones.value)

  async function _poll(): Promise<void> {
    const l = location.value
    if (!l) {
      _latest = []
      return
    }
    _aborter?.abort()
    _aborter = new AbortController()
    try {
      const url = `/api/air/adsb/point/${l.lat.toFixed(4)}/${l.lon.toFixed(4)}/250`
      const resp = await fetch(url, { signal: _aborter.signal })
      if (!resp.ok) return
      const data = (await resp.json()) as { ac?: AdsbApiEntry[] }
      _latest = parseAircraftList(data.ac || [])
      detector.process(_latest)
    } catch {
      /* aborted or network error — ignore */
    }
  }

  function _shouldPoll(): boolean {
    return airNotif.count > 0 || activeZones.value.length > 0
  }

  function _syncPolling(): void {
    if (_shouldPoll()) {
      if (_timer) return
      void _poll()
      _timer = setInterval(() => {
        void _poll()
      }, POLL_MS)
    } else {
      if (_timer) {
        clearInterval(_timer)
        _timer = null
      }
      _aborter?.abort()
      _latest = []
    }
  }

  // React to a location being switched on or off, its radius changing, or a
  // Sentry joining or leaving the fleet — from anywhere in the app.
  watch(activeZones, (zones) => {
    overhead.setZones(zones)
    _syncPolling()
  })
  // Start/stop polling as aircraft opt-ins come and go.
  watch(
    () => airNotif.count,
    () => _syncPolling(),
  )

  _syncPolling()
}

function stop(): void {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _aborter?.abort()
  _latest = []
  _started = false
}

export function useAirAlertsService() {
  return { start, stop }
}
