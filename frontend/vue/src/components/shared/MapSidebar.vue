<template>
  <div id="map-sidebar" :class="{ 'msb-hidden': !open }">
    <div v-if="!hideTabs" id="map-sidebar-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="msb-tab"
        :class="{ 'msb-tab-active': activeTab === tab.id }"
        :data-tab="tab.id"
        @click="switchTab(tab.id)"
      >
        {{ tab.label }}
        <span
          v-if="tab.badge !== undefined && tab.badge > 0"
          class="msb-tab-badge msb-badge-active"
        >{{ tab.badge }}</span>
      </button>
    </div>

    <div id="map-sidebar-panes">
      <template v-if="!hideTabs">
        <div class="msb-pane" :class="{ 'msb-pane-active': activeTab === 'search' }" id="msb-pane-search">
          <slot name="search" />
        </div>
        <div class="msb-pane" :class="{ 'msb-pane-active': activeTab === 'alerts' }" id="msb-pane-alerts">
          <NotificationsPanel />
        </div>
        <div class="msb-pane" :class="{ 'msb-pane-active': activeTab === 'tracking' }" id="msb-pane-tracking">
          <TrackingPanel />
        </div>
        <div class="msb-pane" :class="{ 'msb-pane-active': activeTab === 'passes' }" id="msb-pane-passes">
          <slot name="passes" />
        </div>
        <div class="msb-pane" :class="{ 'msb-pane-active': activeTab === 'playback' }" id="msb-pane-playback">
          <slot name="playback" />
        </div>
      </template>
      <div class="msb-pane msb-pane-radio" :class="{ 'msb-pane-active': hideTabs || activeTab === 'radio' }" id="msb-pane-radio">
        <slot name="radio" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import NotificationsPanel from './NotificationsPanel.vue'
import TrackingPanel from './TrackingPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

const props = withDefaults(defineProps<{ hideTabs?: boolean }>(), { hideTabs: false })

type SidebarTab = 'search' | 'alerts' | 'tracking' | 'passes' | 'playback' | 'radio'

const SS_KEY = 'sentinel_sidebar_open'
const SS_TAB_KEY = 'sentinel_sidebar_tab'

const open = ref(_restoreOpen())
const activeTab = ref<SidebarTab>(_restoreTab())

const tabs = computed(() => [
  { id: 'search' as SidebarTab,   label: 'SEARCH',   badge: undefined },
  { id: 'alerts' as SidebarTab,   label: 'ALERTS',   badge: undefined },
  { id: 'tracking' as SidebarTab, label: 'TRACKING', badge: undefined },
  { id: 'passes' as SidebarTab,    label: 'PASSES',    badge: undefined },
  { id: 'playback' as SidebarTab, label: 'PLAYBACK',  badge: undefined },
  { id: 'radio' as SidebarTab,    label: 'RADIO',     badge: undefined },
])

function switchTab(tab: SidebarTab) {
  activeTab.value = tab
  if (!open.value) { open.value = true; _persistOpen(true) }
  _persistTab(tab)
  document.dispatchEvent(new CustomEvent('msb-tab-switch', { detail: tab }))
}

function toggle() {
  open.value = !open.value
  _persistOpen(open.value)
}

function show() { open.value = true; _persistOpen(true) }
function hide() { open.value = false; _persistOpen(false) }

function openPlaybackTab() { show(); switchTab('playback') }
function openRadioTab() { show(); switchTab('radio') }
function closeRadioTab() {
  if (activeTab.value === 'radio') {
    switchTab('search')
    hide()
  }
}

function _persistOpen(val: boolean) {
  try { val ? sessionStorage.setItem(SS_KEY, '1') : sessionStorage.removeItem(SS_KEY) } catch {}
}

function _persistTab(tab: SidebarTab) {
  try {
    tab === 'radio' ? sessionStorage.setItem(SS_TAB_KEY, tab) : sessionStorage.removeItem(SS_TAB_KEY)
  } catch {}
}

function _restoreOpen(): boolean {
  try { return sessionStorage.getItem(SS_KEY) === '1' } catch { return false }
}

function _restoreTab(): SidebarTab {
  try {
    const saved = sessionStorage.getItem(SS_TAB_KEY)
    if (saved === 'radio') return 'radio'
  } catch {}
  return 'search'
}

defineExpose({ switchTab, openPlaybackTab, openRadioTab, closeRadioTab, show, hide, toggle, open, activeTab })
</script>

<style>
#radio-mini-btn {
    height: 36px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    opacity: 1;
    transition: background 0.2s, opacity 0.2s, color 0.2s;
    flex-shrink: 0;
    margin: 4px 0;
    position: relative;
}

#radio-mini-btn:hover {
    background: var(--color-border);
    border-radius: 6px;
    opacity: 1;
}

#radio-mini-btn.radio-mini-btn-active {
    opacity: 1;
    color: var(--color-accent);
    background: rgba(200, 255, 0, 0.08);
    border-radius: 6px;
}

#radio-mini-btn[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 14px;
    height: 28px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 10001;
}

#radio-mini-btn[data-tooltip]:hover::before { opacity: 1; }
#radio-mini-btn.radio-mini-btn-active[data-tooltip]::before { opacity: 0 !important; }

#map-sidebar-btn {
    height: 36px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    opacity: 0.6;
    transition: background 0.2s, opacity 0.2s;
    flex-shrink: 0;
    margin: 4px 0;
    position: relative;
}

#map-sidebar-btn:hover {
    background: var(--color-border);
    border-radius: 6px;
    opacity: 1;
}

#map-sidebar-btn.msb-btn-active {
    opacity: 1;
    color: var(--color-accent);
    background: rgba(200, 255, 0, 0.08);
    border-radius: 6px;
}

#map-sidebar-btn[data-tooltip]::before {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: #000;
    color: var(--color-text-muted);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 0 14px;
    height: 28px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 10001;
}

#map-sidebar-btn[data-tooltip]:hover::before { opacity: 1; }
#map-sidebar-btn.msb-btn-active[data-tooltip]::before { opacity: 0 !important; }

#map-sidebar {
    position: fixed;
    top: var(--nav-height);
    bottom: var(--footer-height);
    left: 0;
    width: 380px;
    background: rgba(10, 13, 20, 0.92);
    border-right: none;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    transform: translateX(0);
    transition: transform 0.2s ease;
}

#map-sidebar.msb-hidden {
    transform: translateX(-100%);
}

body[data-domain="space"] #map-sidebar {
    width: 430px;
}

body:not([data-domain="space"]) .msb-tab[data-tab="passes"] {
    display: none;
}

body:not([data-domain="air"]) .msb-tab[data-tab="playback"] {
    display: none;
}

body:not([data-domain="sdr"]) .msb-tab[data-tab="radio"] {
    display: none;
}

body[data-domain="sdr"] #map-sidebar-tabs {
    display: none;
}

body[data-domain="sdr"] #msb-pane-radio {
    display: flex;
}

#msb-pane-playback {
    overflow-y: auto;
    scrollbar-width: none;
    flex-direction: column;
}

#msb-pane-playback::-webkit-scrollbar {
    display: none;
}

#msb-pane-radio {
    overflow-y: auto;
    scrollbar-width: none;
    flex-direction: column;
}

#msb-pane-radio::-webkit-scrollbar {
    display: none;
}

#map-sidebar-tabs {
    display: flex;
    flex-shrink: 0;
    height: 52px;
    position: relative;
}

#map-sidebar-tabs::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--color-border);
}

.msb-tab {
    flex: 1 1 0;
    min-width: 0;
    background: none;
    border: none;
    border-bottom: 1px solid transparent;
    color: rgba(255, 255, 255, 0.3);
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s, border-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
}

.msb-tab--pending {
    display: none;
}

.msb-tab:hover {
    color: var(--color-text-muted);
}

.msb-tab.msb-tab-active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
}

.msb-tab-badge {
    font-size: 9px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.35);
    line-height: 1;
}

.msb-tab-badge.msb-badge-active {
    color: var(--color-accent);
}

#map-sidebar-panes {
    flex: 1;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
}

.msb-pane {
    display: none;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
}

.msb-pane.msb-pane-active {
    display: flex;
}

#msb-pane-search {
    overflow: hidden;
}

#msb-pane-search #filter-input-wrap,
#msb-pane-search #space-filter-input-wrap {
    flex-shrink: 0;
}

#msb-pane-search #filter-results,
#msb-pane-search #space-filter-results {
    flex: 1;
    max-height: none;
    overflow-y: auto;
    scrollbar-width: none;
}

#msb-pane-search #filter-results::-webkit-scrollbar,
#msb-pane-search #space-filter-results::-webkit-scrollbar {
    display: none;
}

#msb-pane-alerts {
    overflow: hidden;
}

#msb-pane-alerts #notif-footer {
    flex-shrink: 0;
    width: auto;
    pointer-events: all;
}

#msb-pane-alerts #notif-list-wrap {
    flex: 1;
    min-height: 0;
    visibility: visible;
    opacity: 1;
    pointer-events: all;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    overflow: hidden;
}

#msb-pane-alerts #notif-list {
    flex: 1;
    width: auto;
    max-height: none;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 0;
    align-items: stretch;
}

#msb-pane-alerts #notif-list::-webkit-scrollbar {
    display: none;
}

#msb-pane-alerts .notif-item {
    width: 100%;
}

#msb-pane-alerts .notif-item:first-child {
    margin-top: 16px;
}

#msb-pane-alerts #notif-scroll-hint {
    flex-shrink: 0;
    flex: 1;
}

#msb-alerts-empty {
    padding: 20px 14px;
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.18);
    text-align: center;
    width: 100%;
}

#msb-pane-tracking {
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: none;
    padding-top: 13px;
}

#msb-pane-tracking::-webkit-scrollbar {
    display: none;
}

#msb-tracking-empty {
    padding: 7px 14px;
    font-family: var(--font-primary);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.18);
    text-align: center;
}

#msb-map-controls {
    display: flex;
    flex-shrink: 0;
    padding: 6px 10px;
    gap: 6px;
    border-bottom: 1px solid var(--color-border);
}

#msb-tracks-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    height: 28px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    font-family: var(--font-primary);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}

#msb-tracks-btn:hover {
    color: rgba(255, 255, 255, 0.7);
    border-color: rgba(255, 255, 255, 0.25);
}

#msb-tracks-btn.msb-tracks-btn-active {
    color: var(--color-accent);
    border-color: rgba(200, 255, 0, 0.3);
    background: rgba(200, 255, 0, 0.06);
}
</style>
