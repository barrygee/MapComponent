<template>
  <a class="skip-link" href="#main">Skip to main content</a>

  <header id="nav">
    <div id="nav-logo">
      <img id="logo-img" src="/assets/logo.svg" alt="SENTINEL" />
    </div>
    <nav id="nav-right" aria-label="Domains">
      <RouterLink
        v-for="[domain, label] in navDomains"
        :key="domain"
        :to="`/${domain}/`"
        class="nav-link"
        active-class="nav-link--active"
        :data-domain="domain"
        >{{ label }}</RouterLink
      >
    </nav>
    <button
      id="nav-burger-btn"
      :aria-expanded="menuOpen"
      aria-controls="nav-overlay"
      aria-label="Toggle navigation menu"
      @click="toggleMenu"
    >
      <!-- hamburger / close icon — 19×19 matches the sidebar rail icon size -->
      <svg
        v-if="!menuOpen"
        width="19"
        height="19"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
      >
        <line
          x1="2"
          y1="5"
          x2="20"
          y2="5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <line
          x1="2"
          y1="11"
          x2="20"
          y2="11"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <line
          x1="2"
          y1="17"
          x2="20"
          y2="17"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
      <svg v-else width="19" height="19" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <line
          x1="4"
          y1="4"
          x2="18"
          y2="18"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <line
          x1="18"
          y1="4"
          x2="4"
          y2="18"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </header>

  <!-- Mobile fullscreen nav overlay — rendered outside the header so it fills
       the viewport below the nav bar without any stacking context clipping -->
  <nav
    id="nav-overlay"
    :class="{ 'nav-overlay-open': menuOpen }"
    aria-label="Mobile domain navigation"
    @keydown.esc="menuOpen = false"
  >
    <RouterLink
      v-for="[domain, label] in navDomains"
      :key="domain"
      :to="`/${domain}/`"
      class="nav-overlay-link"
      active-class="nav-overlay-link--active"
      :data-domain="domain"
      @click="menuOpen = false"
      >{{ label }}</RouterLink
    >
    <button class="nav-overlay-link nav-overlay-settings-btn" @click="openSettings">
      SETTINGS
    </button>
  </nav>

  <main id="main" ref="mainRef" tabindex="-1">
    <RouterView />
  </main>

  <aside class="app-sidebar-region" aria-label="Map controls">
    <MapSidebar ref="sidebarRef" :hide-tabs="isSdrRoute">
      <template #radio>
        <SdrTabPanel />
      </template>
    </MapSidebar>
  </aside>

  <AppFooter
    :sidebar-open="sidebarOpen"
    :sdr-section-active="isSdrRoute"
    :has-right-menu="hasRightSideMenu"
    @toggle-sidebar="sidebarRef?.toggle()"
  />

  <SettingsPanel />

  <!-- App-level screen-reader announcer (WCAG 4.1.3): notifications/alerts change
       the DOM silently for sighted users; these visually-hidden live regions speak
       each new notification. Polite for status, assertive for urgent (emergency). -->
  <div class="sr-only" role="status" aria-live="polite">{{ politeAnnouncement }}</div>
  <div class="sr-only" role="alert" aria-live="assertive">{{ assertiveAnnouncement }}</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import MapSidebar from '@/components/shared/MapSidebar.vue'
import AppFooter from '@/components/shared/AppFooter.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import SdrTabPanel from '@/components/sdr/SdrTabPanel.vue'
import { useUserLocation } from '@/composables/useUserLocation'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { useAirAlertsService } from '@/composables/useAirAlertsService'
import { useSpaceAlertsService } from '@/composables/useSpaceAlertsService'
import { useAppStore } from '@/stores/app'
import { useNotificationsStore } from '@/stores/notifications'
import { useSettingsStore } from '@/stores/settings'

const route = useRoute()
const appStore = useAppStore()
const settingsStore = useSettingsStore()
const { locationUnavailable, start: startGps, hydrateFromConfig } = useUserLocation()
const notificationsStore = useNotificationsStore()

onMounted(async () => {
  // Reconcile with the config first: a valid config location seeds the
  // marker, an explicitly-cleared one drops any stale manual override so
  // GPS (started next) can reposition rather than pinning the old marker.
  await hydrateFromConfig()
  startGps()
  // App-level alert services run independently of the active section so
  // aircraft/overhead/satellite-pass alerts fire from any page.
  useAirAlertsService().start()
  useSpaceAlertsService().start()
})

// Surface the "no location available" state as a single app-wide alerts-panel
// notification (consistent across Air/Space/SDR — App.vue is always mounted).
// Added when geolocation can't provide a fix and none is set; auto-dismissed
// the moment a location is obtained (right-click, Settings, or a GPS fix).
let _locNotifId: string | null = null
watch(
  locationUnavailable,
  (unavailable) => {
    if (unavailable && !_locNotifId) {
      _locNotifId = notificationsStore.add({
        type: 'system',
        title: 'LOCATION UNAVAILABLE',
        detail:
          'No location is set and the browser could not provide one. Right-click the map to set a location, or enable location access.',
      })
    } else if (!unavailable && _locNotifId) {
      notificationsStore.dismiss(_locNotifId)
      _locNotifId = null
    }
  },
  { immediate: true },
)

// Screen-reader announcer: mirror each new notification into the polite or
// assertive live region above. Driven by the store's `liveAnnouncement` signal,
// which only fires for newly-added notifications (not reloaded-from-storage).
const politeAnnouncement = ref('')
const assertiveAnnouncement = ref('')
watch(
  () => notificationsStore.liveAnnouncement,
  (announcement) => {
    if (!announcement) return
    if (announcement.assertive) {
      assertiveAnnouncement.value = announcement.message
    } else {
      politeAnnouncement.value = announcement.message
    }
  },
)

useDocumentEvent('air-open-search', () => sidebarRef.value?.switchTab('search'))
useDocumentEvent('open-space-search', () => sidebarRef.value?.switchTab('search'))
// Clicking an APRS station on the Land map opens its details in the FILTER pane
// (LandFilter expands the matching row).
useDocumentEvent('aprs-station-selected', () => sidebarRef.value?.switchTab('search'))

const menuOpen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function openSettings() {
  menuOpen.value = false
  settingsStore.openPanel()
}

// Reflect overlay state on body so CSS can hide the footer settings button
// while the menu is open (it moves into the overlay at mobile sizes).
watch(menuOpen, (open) => {
  if (open) {
    document.body.setAttribute('data-nav-open', '')
  } else {
    document.body.removeAttribute('data-nav-open')
  }
})

// Close mobile nav overlay on route change
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)

const isSdrRoute = computed(() => route.path.startsWith('/sdr'))

// Only Air and Space render a right-edge controls rail (#side-menu /
// #space-side-menu); the footer's side-menu toggle keys off this.
const hasRightSideMenu = computed(
  () => route.path.startsWith('/air') || route.path.startsWith('/space'),
)

watch(isSdrRoute, (isSdr) => {
  if (isSdr) {
    sidebarRef.value?.openRadioTab()
  } else {
    sidebarRef.value?.closeRadioTab()
  }
})

const sidebarRef = ref<InstanceType<typeof MapSidebar> | null>(null)

const sidebarOpen = computed(() => sidebarRef.value?.open ?? false)

const ALL_NAV_DOMAINS: [string, string][] = [
  ['air', 'AIR'],
  ['space', 'SPACE'],
  ['sea', 'SEA'],
  ['land', 'LAND'],
  ['sdr', 'SDR'],
]

const navDomains = computed(() =>
  ALL_NAV_DOMAINS.filter(([d]) => appStore.enabledDomains.includes(d)),
)

// The routed view container. Focus moves here on navigation so screen-reader
// and keyboard users land on the new view rather than staying on the old one.
const mainRef = ref<HTMLElement | null>(null)

/** Per-view document title (WCAG 2.4.2): "SENTINEL — AIR" etc., or "SENTINEL". */
function titleForPath(path: string): string {
  const segment = path.split('/').filter(Boolean)[0] ?? ''
  const entry = ALL_NAV_DOMAINS.find(([domain]) => domain === segment)
  return entry ? `SENTINEL — ${entry[1]}` : 'SENTINEL'
}

// Announce SPA navigation to assistive tech: set the page title immediately, and
// on an actual route change (not the initial load) move focus to the main region
// so the change isn't silent. WCAG 2.4.2 Page Titled / 2.4.3 Focus Order.
watch(
  () => route.path,
  (path, previousPath) => {
    document.title = titleForPath(path)
    if (previousPath !== undefined) {
      nextTick(() => mainRef.value?.focus())
    }
  },
  { immediate: true },
)
</script>
