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
    }
  } catch {}
  app.mount('#app')
})()
