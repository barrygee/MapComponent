import { createApp } from 'vue'
import { createPinia } from 'pinia'
import maplibregl from 'maplibre-gl'
import * as pmtiles from 'pmtiles'

import 'maplibre-gl/dist/maplibre-gl.css'
import './assets/styles.css'

import App from './App.vue'
import router from './router'
import { useAppStore } from './stores/app'
import type { ConnectivityMode } from './stores/app'
import { useAirStore } from './stores/air'
import type { AdsbTagFields } from './stores/air'

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
  }
} catch {}

// Load per-domain enabled state from backend before first render.
const ALL_DOMAINS = ['air', 'space', 'sea', 'land', 'sdr'] as const
// Domains that are ON by default when the DB has no explicit enabled key for them.
const DOMAINS_ON_BY_DEFAULT = new Set(['air', 'space', 'sdr'])
const airStore = useAirStore()

const DEFAULT_LABEL_DATA_POINTS = {
  civil: { callsign: true, altitude: false, speed: false, heading: false, aircraftType: false, registration: false, squawk: false, category: false },
  mil:   { callsign: true, altitude: false, speed: false, heading: false, aircraftType: true,  registration: false, squawk: false, category: false },
}

;(async () => {
  try {
    const res = await fetch('/api/settings')
    if (res.ok) {
      const data = await res.json() as Record<string, Record<string, unknown>>
      const enabled = ALL_DOMAINS.filter(d => {
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
        try { localStorage.setItem('sentinel_app_connectivityMode', backendMode) } catch {}
        appStore.setConnectivityMode(backendMode as ConnectivityMode)
      }

      // Hydrate labelDataPoints from API into store before first render.
      const remote = data.air?.labelDataPoints as AdsbTagFields | undefined
      if (remote && typeof remote === 'object' && !Array.isArray(remote) &&
          typeof remote.civil === 'object' && typeof remote.mil === 'object') {
        airStore.setAdsbTagFields({
          civil: { ...DEFAULT_LABEL_DATA_POINTS.civil, ...(remote.civil as object) },
          mil:   { ...DEFAULT_LABEL_DATA_POINTS.mil,   ...(remote.mil   as object) },
        })
      } else {
        // Seed labelDataPoints into the DB if not yet stored.
        fetch('/api/settings/air/labelDataPoints', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: DEFAULT_LABEL_DATA_POINTS }),
        }).catch(() => {})
      }
    }
  } catch {}
  app.mount('#app')
})()
