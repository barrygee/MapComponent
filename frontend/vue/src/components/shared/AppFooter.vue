<template>
  <footer id="footer">
    <div id="footer-left">
      <button id="map-sidebar-btn" aria-label="Toggle map sidebar" data-tooltip="SIDE PANEL"
        :class="{ 'msb-btn-active': sidebarOpen }"
        @click="emit('toggle-sidebar')">
        <svg width="17" height="17" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1.5" y="1.5" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.1"/>
          <line x1="5.5" y1="1.5" x2="5.5" y2="13.5" stroke="currentColor" stroke-width="1.1"/>
        </svg>
      </button>
      <button id="notif-toggle-btn" aria-label="Toggle notifications" data-tooltip="NOTIFICATIONS"
        @click="emit('toggle-notifications')">
        <svg id="notif-icon" width="17" height="17" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor" fill-opacity="1"/>
          <path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>
        </svg>
        <span id="notif-count">{{ notifCount || '' }}</span>
      </button>
      <button id="tracking-toggle-btn" aria-label="Toggle tracking" data-tooltip="TRACKING"
        @click="emit('toggle-tracking')">
        <svg id="tracking-icon" width="17" height="17" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="6.5" cy="6.5" r="2" fill="currentColor"/>
          <line x1="6.5" y1="1" x2="6.5" y2="2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
          <line x1="6.5" y1="10.5" x2="6.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
          <line x1="1" y1="6.5" x2="2.5" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
          <line x1="10.5" y1="6.5" x2="12" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
        </svg>
        <span id="tracking-count">{{ trackingCount || '' }}</span>
      </button>
      <button id="radio-mini-btn" aria-label="Toggle radio player" data-tooltip="RADIO"
        @click="emit('open-radio-tab')">
        <svg width="17" height="17" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.1"/>
          <circle cx="5" cy="9.5" r="1.8" stroke="currentColor" stroke-width="1.1"/>
          <line x1="8.5" y1="7.5" x2="12.5" y2="7.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <line x1="8.5" y1="10" x2="11" y2="10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <line x1="9" y1="5" x2="11" y2="1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <line x1="6" y1="5" x2="7" y2="1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div id="footer-center">
      <span id="conn-status" :class="connStatusClass">{{ connStatusText }}</span>
    </div>
    <div id="footer-right">
      <button id="docs-btn" aria-label="Documentation" data-tooltip="DOCUMENTATION"
        @click="emit('toggle-docs')">
        <svg width="17" height="17" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="2.5" y="1.5" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.1"/>
          <line x1="5" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <line x1="5" y1="7.5" x2="10" y2="7.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <line x1="5" y1="10" x2="8" y2="10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
      <button id="settings-btn" aria-label="Settings" data-tooltip="SETTINGS"
        @click="settingsStore.togglePanel()">
        <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M6.18 1.5h2.64l.38 1.52a5 5 0 0 1 1.1.64l1.5-.5 1.32 2.28-1.16 1.03a5.06 5.06 0 0 1 0 1.26l1.16 1.03-1.32 2.28-1.5-.5a5 5 0 0 1-1.1.64l-.38 1.52H6.18l-.38-1.52a5 5 0 0 1-1.1-.64l-1.5.5L1.88 9.26l1.16-1.03a5.06 5.06 0 0 1 0-1.26L1.88 5.94 3.2 3.66l1.5.5a5 5 0 0 1 1.1-.64L6.18 1.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
          <circle cx="7.5" cy="7.5" r="1.75" stroke="currentColor" stroke-width="1.1"/>
        </svg>
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'
import { useTrackingStore } from '@/stores/tracking'

const props = defineProps<{ sidebarOpen?: boolean }>()

const emit = defineEmits<{
  'toggle-sidebar': []
  'toggle-notifications': []
  'toggle-tracking': []
  'open-radio-tab': []
  'toggle-docs': []
}>()

const appStore = useAppStore()
const settingsStore = useSettingsStore()
const notificationsStore = useNotificationsStore()
const trackingStore = useTrackingStore()

const notifCount = computed(() => notificationsStore.unreadCount)
const trackingCount = computed(() => trackingStore.count)
const sidebarOpen = computed(() => props.sidebarOpen ?? false)

const connStatusClass = computed(() => {
  const mode = appStore.connectivityMode
  const forced = mode === 'online' || mode === 'offgrid'
  if (forced) return mode === 'online' ? 'conn-online conn-mode-forced' : 'conn-offline conn-mode-forced'
  return appStore.isOnline ? 'conn-online' : 'conn-offline'
})

const connStatusText = computed(() => appStore.isOnline ? '● ONLINE' : '● OFF GRID')
</script>
