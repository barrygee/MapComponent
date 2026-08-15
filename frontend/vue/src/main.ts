import { createApp } from 'vue'
import { createPinia } from 'pinia'
import maplibregl from 'maplibre-gl'
import * as pmtiles from 'pmtiles'

import 'maplibre-gl/dist/maplibre-gl.css'
import './assets/fonts.css'
import './assets/styles.css'
// Global a11y baseline (focus-visible, reduced motion, skip-link/sr-only
// utilities) — imported last so its focus ring overrides component resets.
import './assets/a11y.css'

import App from './App.vue'
import router from './router'
import { useAppStore } from './stores/app'
import type { ConnectivityMode } from './stores/app'
import { useAirStore } from './stores/air'
import type { AdsbLabelFields, AdsbTagFields } from './stores/air'
import { useLandStore } from './stores/land'
import type { AprsLabelFieldMap } from './stores/land'
import { useSettingsStore } from './stores/settings'

// Register PMTiles protocol once at app startup — never inside a component.
const protocol = new pmtiles.Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(router)

// Hydrate app store from localStorage before first render.
const appStore = useAppStore()
try {
  const savedMode = localStorage.getItem('sentinel_app_connectivityMode') as ConnectivityMode | null
  if (savedMode && (['auto', 'online', 'offgrid'] as string[]).includes(savedMode)) {
    appStore.setConnectivityMode(savedMode)
    // Initialise isOnline so styleUrl computes correctly before any component mounts.
    if (savedMode === 'offgrid') appStore.setOnline(false)
    else if (savedMode === 'online') appStore.setOnline(true)
  }
} catch {}

// Load per-domain enabled state from backend before first render.
const ALL_DOMAINS = ['air', 'space', 'sea', 'land', 'sdr'] as const
// Domains that are ON by default when the DB has no explicit enabled key for them.
const DOMAINS_ON_BY_DEFAULT = new Set(['air', 'space', 'sdr'])
const airStore = useAirStore()
const landStore = useLandStore()
const settingsStore = useSettingsStore()

const DEFAULT_LABEL_DATA_POINTS = {
  civil: {
    callsign: true,
    altitude: false,
    speed: false,
    heading: false,
    aircraftType: false,
    registration: false,
    squawk: false,
    category: false,
  },
  mil: {
    callsign: true,
    altitude: false,
    speed: false,
    heading: false,
    aircraftType: true,
    registration: false,
    squawk: false,
    category: false,
  },
}

;(async () => {
  try {
    const res = await fetch('/api/settings')
    if (res.ok) {
      const data = (await res.json()) as Record<string, Record<string, unknown>>
      // Seed the settings store from this same payload so reads like
      // sdr.bandPlan (waterfall band strip) and app.connectivityProbeUrl
      // resolve to the persisted values instead of their fallbacks. Nothing
      // else calls loadAll(), so without this the store stays empty.
      settingsStore.allSettings = data
      const enabled = ALL_DOMAINS.filter((d) => {
        const val = data[d]?.enabled
        if (typeof val === 'boolean') return val
        // Key absent from DB — fall back to per-domain default.
        return DOMAINS_ON_BY_DEFAULT.has(d)
      })
      if (enabled.length > 0) appStore.setEnabledDomains(enabled)

      // Sync connectivity mode from backend — backend is authoritative so a mode
      // set from another session doesn't get overridden by a stale localStorage value.
      const backendMode = data.app?.connectivityMode as string | undefined
      if (backendMode && (['auto', 'online', 'offgrid'] as string[]).includes(backendMode)) {
        try {
          localStorage.setItem('sentinel_app_connectivityMode', backendMode)
        } catch {}
        appStore.setConnectivityMode(backendMode as ConnectivityMode)
      }

      // Notification blip sound — default OFF when absent from the DB.
      const soundOn = data.app?.notificationSound
      appStore.setNotificationSound(typeof soundOn === 'boolean' ? soundOn : false)

      // Replay recording toggle — default OFF when absent from the DB.
      const replayOn = data.air?.replayEnabled
      airStore.setReplayEnabled(typeof replayOn === 'boolean' ? replayOn : false)

      // Hydrate labelDataPoints from API into store before first render.
      const remote = data.air?.labelDataPoints as AdsbTagFields | undefined
      if (
        remote &&
        typeof remote === 'object' &&
        !Array.isArray(remote) &&
        typeof remote.civil === 'object' &&
        typeof remote.mil === 'object'
      ) {
        airStore.setAdsbTagFields({
          civil: { ...DEFAULT_LABEL_DATA_POINTS.civil, ...(remote.civil as object) },
          mil: { ...DEFAULT_LABEL_DATA_POINTS.mil, ...(remote.mil as object) },
        })
      } else {
        // Seed labelDataPoints into the DB if not yet stored.
        fetch('/api/settings/air/labelDataPoints', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: DEFAULT_LABEL_DATA_POINTS }),
        }).catch(() => {})
      }

      // APRS station label fields — same cross-device rationale as the ADS-B
      // fields above: adopt the stored choice, or seed the DB from this
      // browser's current one when the key has never been written.
      const remoteAprsFields = data.land?.labelDataPoints as Partial<AprsLabelFieldMap> | undefined
      if (
        remoteAprsFields &&
        typeof remoteAprsFields === 'object' &&
        !Array.isArray(remoteAprsFields)
      ) {
        landStore.setAprsLabelFields({ ...landStore.aprsLabelFields, ...remoteAprsFields })
      } else {
        fetch('/api/settings/land/labelDataPoints', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: landStore.aprsLabelFields }),
        }).catch(() => {})
      }

      // ADS-B labels master toggle — backend-synced so the show/hide choice
      // follows the user across devices (localStorage alone is per-browser, which
      // is why labels appeared on the host but not on a second device). When the
      // key is absent from the DB, seed it from the current (localStorage) value
      // so an existing per-browser preference becomes the shared default instead
      // of being reset to off.
      const remoteLabelsVisible = data.air?.labelsVisible
      if (typeof remoteLabelsVisible === 'boolean') {
        airStore.setOverlay('adsbLabels', remoteLabelsVisible)
      } else {
        fetch('/api/settings/air/labelsVisible', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: airStore.overlayStates.adsbLabels }),
        }).catch(() => {})
      }

      // Per-aircraft label fields (type/alt, separately for civil and military) —
      // same cross-device rationale and the same seed-from-localStorage migration.
      const remoteLabelFields = data.air?.labelFields as AdsbLabelFields | undefined
      if (
        remoteLabelFields &&
        typeof remoteLabelFields === 'object' &&
        !Array.isArray(remoteLabelFields) &&
        Array.isArray(remoteLabelFields.civil) &&
        Array.isArray(remoteLabelFields.mil)
      ) {
        airStore.setAdsbLabelFields({
          civil: remoteLabelFields.civil,
          mil: remoteLabelFields.mil,
        })
      } else {
        fetch('/api/settings/air/labelFields', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: airStore.adsbLabelFields }),
        }).catch(() => {})
      }
    }
  } catch {}
  app.mount('#app')
})()
