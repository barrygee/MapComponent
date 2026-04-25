<template>
  <div id="settings-panel" :class="{ 'settings-panel-visible': store.open }">
    <div id="settings-sidebar">
      <div
        v-for="s in visibleSections"
        :key="s.key"
        class="settings-nav-item"
        :class="{ active: activeSection === s.key }"
        @click="selectSection(s.key)"
      >{{ s.label }}</div>
    </div>

    <div id="settings-content">
      <div id="settings-section-heading">{{ sectionHeading }}</div>

      <div id="settings-search-wrap" :class="{ 'settings-search-wrap--hidden': activeSection !== 'app' && !searchQuery }">
        <div id="settings-search-inner">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>
            <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <input
            id="settings-search-input"
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            placeholder="SEARCH SETTINGS"
            autocomplete="off"
            spellcheck="false"
            @keydown.escape="store.closePanel()"
          >
          <button
            id="settings-search-clear"
            aria-label="Clear search"
            :class="{ 'settings-search-clear-visible': searchQuery.length > 0 }"
            @click="clearSearch"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="settings-body">
        <!-- Search results -->
        <template v-if="searchQuery.trim()">
          <template v-if="searchResults.length === 0">
            <div class="settings-empty">No results found</div>
          </template>
          <template v-else>
            <template v-for="group in searchResultGroups" :key="group.section">
              <div class="settings-section-label">{{ group.sectionLabel }}</div>
              <SettingRow
                v-for="item in group.items"
                :key="item.id"
                :item="item"
                :pending="pending"
                @stage="stagePending"
                @commit="commitAll"
              />
            </template>
          </template>
        </template>

        <!-- Section items -->
        <template v-else>
          <template v-if="currentSectionItems.length === 0">
            <div class="settings-empty">Settings coming soon</div>
          </template>
          <template v-else>
            <template v-for="(item, idx) in currentSectionItems" :key="item.id">
              <div
                v-if="item.groupLabel !== undefined && item.groupLabel !== currentSectionItems[idx - 1]?.groupLabel"
                class="settings-group-label"
                :class="{ 'settings-group-label--spaced': idx > 0 }"
              >{{ item.groupLabel }}</div>
              <SettingRow
                :item="item"
                :pending="pending"
                @stage="stagePending"
                @commit="commitAll"
              />
            </template>
          </template>
        </template>
      </div>

      <div id="settings-footer" v-show="activeSection !== 'sdr' && !searchQuery.trim()">
        <span id="settings-apply-status" :class="applyStatusClass">{{ applyStatusMsg }}</span>
        <button id="settings-apply-btn" @click="commitAll">APPLY CHANGES</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import * as settingsApi from '@/services/settingsApi'
import SettingRow from './settings/SettingRow.vue'

const store = useSettingsStore()

const activeSection = ref('app')
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const pending = ref<Map<string, () => Promise<unknown> | void>>(new Map())
const applyStatusMsg = ref('')
const applyStatusClass = ref('')

interface NavSection { key: string; label: string }
const NAV_SECTIONS: NavSection[] = [
  { key: 'app',   label: 'App Settings' },
  { key: 'air',   label: 'AIR' },
  { key: 'space', label: 'SPACE' },
  { key: 'sea',   label: 'SEA' },
  { key: 'land',  label: 'LAND' },
  { key: 'sdr',   label: 'SDR' },
]

export interface SettingItem {
  section: string
  sectionLabel: string
  id: string
  label: string
  desc: string
  groupLabel?: string
  type: string
  // type-specific props
  ns?: string
  defaultUrl?: string
}

const ALL_SETTINGS: SettingItem[] = [
  { section: 'app', sectionLabel: 'App Settings', id: 'connectivity-mode', label: 'Connectivity Mode', desc: 'Use online or off grid data sources across the app', type: 'connectivity-toggle' },
  { section: 'app', sectionLabel: 'App Settings', id: 'app-connectivity-probe', label: 'Connectivity Probe URL', desc: 'URL polled every 2 seconds to detect internet access', type: 'probe-url' },
  { section: 'app', sectionLabel: 'App Settings', id: 'location', label: 'My Location', desc: 'Set a fixed latitude / longitude for your position', type: 'location' },
  { section: 'air', sectionLabel: 'AIR', id: 'air-tag-fields', label: 'Label Data Points', desc: 'Choose which data fields appear on aircraft labels for civil and military aircraft', type: 'air-tag-fields', groupLabel: 'LABELS' },
  { section: 'air', sectionLabel: 'AIR', id: 'air-source-override', label: 'Source Override', desc: 'Override the app-level connectivity mode for this domain', type: 'source-override', ns: 'air', groupLabel: 'DATA SOURCES' },
  { section: 'air', sectionLabel: 'AIR', id: 'air-online-source', label: 'Online Data Source', desc: 'URL for live air data feed', type: 'online-source', ns: 'air', defaultUrl: 'https://api.airplanes.live/v2' },
  { section: 'air', sectionLabel: 'AIR', id: 'air-offline-source', label: 'Off Grid Data Source', desc: 'Local server URL and port for air data', type: 'offline-source', ns: 'air', defaultUrl: '' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-online-source', label: 'Online Data Source', desc: 'URL to fetch TLE data from — select a category and click UPDATE TLE', type: 'space-tle-online', groupLabel: 'DATA SOURCES' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-manual-tle', label: 'TLE Import', desc: 'Upload a .txt file of TLE data', type: 'space-tle-manual' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-tle-database', label: 'TLE Database', desc: 'Satellite count, sources, and per-category last-updated times', type: 'space-tle-db' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-tle-uncategorised', label: 'Uncategorised Satellites', desc: 'Assign categories to satellites imported without one', type: 'space-tle-uncat' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-tle-satlist', label: 'Satellite List', desc: 'Full list of all TLE records stored in the database', type: 'space-tle-satlist' },
  { section: 'space', sectionLabel: 'SPACE', id: 'space-filter-hover-preview', label: 'Filter Hover Behaviour', desc: 'When hovering over a satellite in the search results, choose whether the map stays in place or flies to that satellite', type: 'space-hover-preview', groupLabel: 'FILTER HOVER' },
  { section: 'sea', sectionLabel: 'SEA', id: 'sea-source-override', label: 'Source Override', desc: 'Override the app-level connectivity mode for this domain', type: 'source-override', ns: 'sea' },
  { section: 'sea', sectionLabel: 'SEA', id: 'sea-online-source', label: 'Online Data Source', desc: 'URL for live sea data feed', type: 'online-source', ns: 'sea', defaultUrl: '' },
  { section: 'sea', sectionLabel: 'SEA', id: 'sea-offline-source', label: 'Off Grid Data Source', desc: 'Local server URL and port for sea data', type: 'offline-source', ns: 'sea', defaultUrl: '' },
  { section: 'land', sectionLabel: 'LAND', id: 'land-source-override', label: 'Source Override', desc: 'Override the app-level connectivity mode for this domain', type: 'source-override', ns: 'land' },
  { section: 'land', sectionLabel: 'LAND', id: 'land-online-source', label: 'Online Data Source', desc: 'URL for live land data feed', type: 'online-source', ns: 'land', defaultUrl: '' },
  { section: 'land', sectionLabel: 'LAND', id: 'land-offline-source', label: 'Off Grid Data Source', desc: 'Local server URL and port for land data', type: 'offline-source', ns: 'land', defaultUrl: '' },
  { section: 'sdr', sectionLabel: 'SDR', id: 'sdr-devices', label: 'SDR Devices', desc: 'Configure RTL-SDR devices reachable via rtl_tcp', type: 'sdr-devices' },
  { section: 'app', sectionLabel: 'App Settings', id: 'config-current', label: 'Application Config', desc: 'Settings currently stored in the database', type: 'config-current' },
]

const visibleSections = computed(() => NAV_SECTIONS)

const sectionHeading = computed(() => {
  if (searchQuery.value.trim()) return 'SEARCH RESULTS'
  const s = NAV_SECTIONS.find(n => n.key === activeSection.value)
  if (!s) return activeSection.value
  return s.key === 'app' ? s.label : s.label + ' SETTINGS'
})

const currentSectionItems = computed(() =>
  ALL_SETTINGS.filter(s => s.section === activeSection.value)
)

const searchResults = computed<SettingItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return ALL_SETTINGS.filter(s =>
    s.label.toLowerCase().includes(q) ||
    s.desc.toLowerCase().includes(q) ||
    s.sectionLabel.toLowerCase().includes(q)
  )
})

const searchResultGroups = computed(() => {
  const groups: Record<string, { section: string; sectionLabel: string; items: SettingItem[] }> = {}
  const order: string[] = []
  searchResults.value.forEach(item => {
    if (!groups[item.section]) {
      groups[item.section] = { section: item.section, sectionLabel: item.sectionLabel, items: [] }
      order.push(item.section)
    }
    groups[item.section].items.push(item)
  })
  return order.map(k => groups[k])
})

function selectSection(key: string): void {
  activeSection.value = key
  searchQuery.value = ''
  pending.value.clear()
}

function clearSearch(): void {
  searchQuery.value = ''
  searchInputRef.value?.focus()
}

function stagePending(id: string, fn: () => Promise<unknown> | void): void {
  pending.value.set(id, fn)
}

function showApplyStatus(msg: string, isError: boolean): void {
  applyStatusMsg.value = msg
  applyStatusClass.value = isError ? 'settings-apply-status--error' : 'settings-apply-status--ok'
  setTimeout(() => {
    applyStatusMsg.value = ''
    applyStatusClass.value = ''
  }, 2500)
}

async function commitAll(): Promise<void> {
  if (pending.value.size === 0) {
    showApplyStatus('NO CHANGES', false)
    return
  }
  const promises: Promise<unknown>[] = []
  let hasError = false
  pending.value.forEach(fn => {
    try {
      const result = fn()
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        promises.push(result as Promise<unknown>)
      }
    } catch {
      hasError = true
    }
  })
  if (hasError) { showApplyStatus('ERROR', true); return }
  try {
    await Promise.all(promises)
  } catch {
    showApplyStatus('ERROR', true)
    return
  }
  pending.value.clear()
  showApplyStatus('SAVED', false)
  setTimeout(() => {
    try { sessionStorage.setItem('sentinel_settings_reopen', activeSection.value) } catch {}
    location.reload()
  }, 400)
}

watch(() => store.open, (isOpen) => {
  if (isOpen) {
    setTimeout(() => searchInputRef.value?.focus(), 50)
    if (store.activeSection) {
      activeSection.value = store.activeSection
    }
    try {
      const reopenSection = sessionStorage.getItem('sentinel_settings_reopen')
      if (reopenSection) {
        sessionStorage.removeItem('sentinel_settings_reopen')
        activeSection.value = reopenSection
      }
    } catch {}
  } else {
    searchQuery.value = ''
    pending.value.clear()
  }
})

window.addEventListener('sentinel:locationChanged', (e: Event) => {
  if (!store.open || activeSection.value !== 'app') return
  const detail = (e as CustomEvent).detail as { longitude: number; latitude: number }
  pending.value.delete('location')
  window.dispatchEvent(new CustomEvent('settings:locationSynced', { detail }))
})
</script>

<style>
#settings-panel {
    position: fixed;
    top: 68px;
    bottom: 44px;
    left: 0;
    right: 0;
    z-index: 10000;
    display: none;
    flex-direction: row;
    background-color: #38435c;
}

#settings-panel.settings-panel-visible {
    display: flex;
}

#settings-sidebar,
#settings-content {
    position: relative;
}

#settings-sidebar {
    width: 325px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    padding: 24px 0;
    overflow-y: auto;
    scrollbar-width: none;
}

#settings-sidebar::-webkit-scrollbar {
    display: none;
}

.settings-nav-item {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    padding: 11px 24px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    border-left: 2px solid transparent;
    user-select: none;
}

.settings-nav-item:hover {
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.04);
}

.settings-nav-item.active {
    color: var(--color-accent);
    border-left-color: var(--color-accent);
    background: rgba(200, 255, 0, 0.04);
}

#settings-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

#settings-section-heading {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.9);
    padding: 36px 48px 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
}

#settings-search-wrap {
    display: flex;
    align-items: center;
    padding: 36px 48px 48px;
    flex-shrink: 0;
}

#settings-search-wrap.settings-search-wrap--hidden {
    display: none;
}

#settings-search-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 420px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    padding: 8px 12px;
}

#settings-search-inner svg {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.5);
}

#settings-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: rgba(255, 255, 255, 0.9);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 16px;
    font-weight: 400;
    letter-spacing: 0.08em;
    caret-color: var(--color-accent);
    min-width: 0;
}

#settings-search-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
    letter-spacing: 0.14em;
}

#settings-search-clear {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.4);
    display: none;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
    flex-shrink: 0;
}

#settings-search-clear.settings-search-clear-visible {
    display: flex;
}

#settings-search-clear:hover {
    color: rgba(255, 255, 255, 0.8);
}

#settings-body {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
}

#settings-body::-webkit-scrollbar {
    display: none;
}

#settings-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
    padding: 16px 32px;
}

#settings-apply-status {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: transparent;
    transition: color 0.2s;
}

#settings-apply-status.settings-apply-status--ok {
    color: var(--color-accent);
}

#settings-apply-status.settings-apply-status--error {
    color: rgba(255, 80, 80, 0.9);
}

#settings-apply-btn {
    background: none;
    border: 1px solid rgba(200, 255, 0, 0.4);
    border-radius: 3px;
    padding: 9px 24px;
    color: var(--color-accent);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
}

#settings-apply-btn:hover {
    background: rgba(200, 255, 0, 0.08);
    border-color: rgba(200, 255, 0, 0.7);
    color: var(--color-accent);
}

.settings-section-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.3);
    padding: 48px 48px 24px;
    text-transform: uppercase;
}

.settings-group-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: rgba(255, 255, 255, 0.2);
    text-transform: uppercase;
    padding: 20px 48px 4px;
}

.settings-group-label--spaced {
    padding-top: 72px;
}

.settings-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 24px 48px;
    gap: 16px;
    max-width: 640px;
}

.settings-item + .settings-item {
    padding-top: 48px;
}

.settings-item:last-child {
    padding-bottom: 48px;
}

.settings-item-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.settings-item-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    text-transform: uppercase;
}

.settings-item-desc {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.3);
}

.settings-result-breadcrumb {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.2);
    text-transform: uppercase;
    margin-bottom: 2px;
}

.settings-empty {
    padding: 32px 48px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.15);
    text-transform: uppercase;
}

.settings-location-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 320px;
}

.settings-location-row {
    display: flex;
    align-items: center;
    gap: 0;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
}

.settings-location-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    padding: 0 10px;
    flex-shrink: 0;
    user-select: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-location-input {
    flex: 1;
    background: none;
    border: none;
    padding: 9px 12px;
    color: rgba(255, 255, 255, 0.9);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.08em;
    outline: none;
    caret-color: var(--color-accent);
    min-width: 0;
}

.settings-location-row:focus-within {
    border-color: rgba(200, 255, 0, 0.4);
}

.settings-location-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
    font-size: 11px;
    letter-spacing: 0.14em;
}

.settings-theme-switch {
    display: flex;
    align-items: center;
    gap: 12px;
}

.settings-theme-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    user-select: none;
}

.settings-theme-track {
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    padding: 0;
}

.settings-theme-track.is-dark {
    background: rgba(200, 255, 0, 0.15);
    border-color: rgba(200, 255, 0, 0.4);
}

.settings-theme-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transition: transform 0.2s, background 0.2s;
}

.settings-theme-track.is-dark .settings-theme-thumb {
    transform: translateX(20px);
    background: var(--color-accent);
}

.settings-datasource-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 420px;
}

.settings-datasource-row {
    display: flex;
    align-items: center;
    gap: 0;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
}

.settings-datasource-row:focus-within {
    border-color: rgba(200, 255, 0, 0.4);
}

.settings-datasource-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    padding: 0 10px;
    flex-shrink: 0;
    user-select: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
}

.settings-datasource-input {
    flex: 1;
    background: none;
    border: none;
    padding: 9px 12px;
    color: rgba(255, 255, 255, 0.9);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.08em;
    outline: none;
    caret-color: var(--color-accent);
    min-width: 0;
}

.settings-datasource-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
    font-size: 11px;
    letter-spacing: 0.14em;
}

.settings-datasource-status {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: transparent;
    transition: color 0.2s;
    height: 16px;
    line-height: 16px;
}

.settings-datasource-status--ok {
    color: var(--color-accent);
}

.settings-datasource-status--err {
    color: rgba(255, 80, 80, 0.9);
}

.settings-connectivity-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.settings-connectivity-switch {
    display: flex;
    align-items: center;
    gap: 12px;
}

.settings-connectivity-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    user-select: none;
}

.settings-connectivity-track {
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    padding: 0;
}

.settings-connectivity-track.is-online {
    background: rgba(200, 255, 0, 0.15);
    border-color: rgba(200, 255, 0, 0.4);
}

.settings-connectivity-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transition: transform 0.2s, background 0.2s;
}

.settings-connectivity-track.is-online .settings-connectivity-thumb {
    transform: translateX(20px);
    background: var(--color-accent);
}

.settings-connectivity-override-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    max-width: 420px;
}

.settings-conn-override-heading {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.25);
    margin-bottom: 4px;
}

.settings-conn-override-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.settings-conn-override-ns {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.5);
    width: 52px;
}

.settings-conn-override-arrow {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.2);
    width: 32px;
    text-align: center;
    flex-shrink: 0;
}

.settings-conn-override-val {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
}

.settings-conn-override-val--online  { color: var(--color-accent); }
.settings-conn-override-val--offline { color: rgba(255, 80, 80, 0.8); }

.settings-connectivity-warning {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(255, 160, 0, 0.08);
    border: 1px solid rgba(255, 160, 0, 0.35);
    border-radius: 3px;
    max-width: 420px;
}

.settings-connectivity-warning-msg {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(255, 200, 80, 0.9);
    line-height: 1.5;
}

.settings-connectivity-warning-btn {
    align-self: flex-start;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 6px 16px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    color: rgba(255, 255, 255, 0.6);
    display: inline-block;
    margin-right: 8px;
}

.settings-connectivity-warning-btn--confirm {
    border-color: rgba(200, 255, 0, 0.4);
    color: var(--color-accent);
}

.settings-connectivity-warning-btn--confirm:hover {
    background: rgba(200, 255, 0, 0.08);
    border-color: rgba(200, 255, 0, 0.7);
}

.settings-connectivity-warning-btn--cancel:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.4);
    color: rgba(255, 255, 255, 0.9);
}

.settings-source-override-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.settings-source-override-group {
    display: flex;
    flex-direction: row;
    gap: 0;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    overflow: hidden;
    width: fit-content;
}

.settings-source-override-btn {
    background: rgba(255, 255, 255, 0.05);
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    padding: 7px 16px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    user-select: none;
}

.settings-source-override-btn:last-child {
    border-right: none;
}

.settings-source-override-btn:hover {
    background: rgba(255, 255, 255, 0.09);
    color: var(--color-text-muted);
}

.settings-source-override-btn.is-active {
    background: rgba(200, 255, 0, 0.12);
    color: var(--color-accent);
}

.settings-source-override-note {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.05em;
    color: rgba(255, 200, 80, 0.75);
    font-style: italic;
}

#settings-btn.settings-btn-active {
    opacity: 1;
    color: var(--color-accent);
    background: rgba(200, 255, 0, 0.08);
    border-radius: 6px;
}

#settings-btn.settings-btn-active[data-tooltip]::before {
    opacity: 0 !important;
}

.tle-action-btn {
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.05);
    border: none;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0 16px;
    height: 37px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
    user-select: none;
}
.tle-action-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.85);
}
.tle-action-btn:disabled {
    opacity: 0.35;
    cursor: default;
}
.tle-action-btn--primary {
    background: rgba(200, 255, 0, 0.08);
    color: var(--color-accent);
    border-left-color: rgba(200, 255, 0, 0.2);
}
.tle-action-btn--primary:hover:not(:disabled) {
    background: rgba(200, 255, 0, 0.15);
    color: var(--color-accent);
}
.tle-action-btn--danger {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 80, 80, 0.25);
    color: rgba(255, 100, 100, 0.7);
    height: 34px;
    padding: 0 16px;
}
.tle-action-btn--danger:hover:not(:disabled) {
    background: rgba(255, 60, 60, 0.1);
    border-color: rgba(255, 80, 80, 0.5);
    color: rgba(255, 120, 120, 0.9);
}
.tle-action-btn--confirm {
    background: rgba(255, 140, 0, 0.1);
    border-color: rgba(255, 140, 0, 0.4);
    color: rgba(255, 180, 0, 0.9);
}

.tle-uncat-select {
    flex: 1;
    min-width: 0;
    height: 37px;
    padding: 0 28px 0 10px;
    background-color: rgba(255, 255, 255, 0.04);
    border: none;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.65);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(255,255,255,0.2)'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
}
.tle-uncat-select:focus {
    background-color: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    outline: none;
}
.tle-uncat-select option {
    background-color: #222831;
    color: rgba(255, 255, 255, 0.85);
    font-family: 'Barlow', Arial, sans-serif;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: none;
    padding: 6px 8px;
}

.tle-dropdown {
    position: relative;
    width: 200px;
    flex-shrink: 0;
    height: 37px;
    cursor: pointer;
    outline: none;
    user-select: none;
}

.tle-dropdown-selected {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    padding: 0 10px 0 10px;
    background-color: rgba(255, 255, 255, 0.04);
    border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.tle-dropdown-selected-text {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tle-dropdown-selected-text--chosen {
    color: var(--color-text-muted);
}

.tle-dropdown-arrow {
    flex-shrink: 0;
    width: 8px;
    height: 5px;
    margin-left: 8px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(255,255,255,0.2)'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: center;
    transition: transform 0.15s;
}

.tle-dropdown--open .tle-dropdown-arrow {
    transform: rotate(180deg);
}

.tle-dropdown--open .tle-dropdown-selected {
    background-color: rgba(255, 255, 255, 0.06);
}

.tle-dropdown-menu {
    display: none;
    position: absolute;
    z-index: 99999;
    background: #222831;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-top: none;
    overflow-y: auto;
    max-height: 240px;
}

.tle-dropdown-menu.tle-dropdown-menu--open {
    display: block;
}

.tle-dropdown-item {
    padding: 9px 12px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
}

.tle-dropdown-item:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
}

.tle-dropdown-item--placeholder {
    color: rgba(255, 255, 255, 0.3);
}

.tle-cat-row-ctrl {
    display: inline-flex;
    align-items: center;
    gap: 0;
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    margin-top: 12px;
    overflow: visible;
    clip-path: none;
    isolation: isolate;
}
.tle-cat-row-ctrl > .tle-inline-label:first-child {
    border-radius: 2px 0 0 2px;
}
.tle-cat-row-ctrl > .tle-action-btn:last-child {
    border-radius: 0 2px 2px 0;
}
.tle-cat-row-ctrl:focus-within {
    border-color: rgba(200, 255, 0, 0.4);
}

.tle-inline-label {
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    white-space: nowrap;
    height: 37px;
    display: flex;
    align-items: center;
}

.tle-status-line {
    min-height: 18px;
    margin-top: 4px;
}
.tle-status-badge {
    display: inline-block;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    border-radius: 2px;
}
.tle-status-badge--ok {
    color: var(--color-accent);
    background: rgba(200, 255, 0, 0.07);
}
.tle-status-badge--error {
    color: rgba(255, 100, 100, 0.9);
    background: rgba(255, 60, 60, 0.07);
}
.tle-status-badge--info {
    color: rgba(255, 255, 255, 0.4);
}

.tle-section-heading {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    text-transform: uppercase;
    margin-top: 40px;
    margin-bottom: 10px;
    user-select: none;
}
.tle-section-heading:first-child {
    margin-top: 0;
}

.tle-online-wrap {
    max-width: 860px;
}

.tle-info-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-top: 2px;
}
.tle-info-row-header {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
.tle-info-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.35);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    flex-shrink: 0;
    line-height: 1;
}
.tle-info-toggle:hover,
.tle-info-toggle--active {
    color: var(--color-accent);
    border-color: var(--color-accent);
}
.tle-info-chevron {
    display: inline-flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.3);
    transition: transform 0.2s ease, color 0.15s;
    line-height: 0;
}
.tle-info-chevron--open {
    transform: rotate(180deg);
}
.tle-info-row-header:hover .tle-info-chevron {
    color: rgba(200, 255, 0, 0.6);
}
.tle-info-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.3);
    user-select: none;
    transition: color 0.15s;
}
.tle-info-row-header:hover .tle-info-label,
.tle-info-toggle--active ~ .tle-info-label {
    color: rgba(200, 255, 0, 0.6);
}
.tle-info-panel {
    margin-top: 8px;
    width: 100%;
}

.tle-info-list {
    display: flex;
    flex-direction: column;
    gap: 0;
}
.tle-info-list-item {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    padding: 5px 0;
}
.tle-info-list-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.45);
    flex-shrink: 0;
}
.tle-info-list-sep {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
}
.tle-info-table-url {
    color: rgba(200, 255, 0, 0.7);
    text-decoration: none;
    font-family: 'Barlow', 'Helvetica Neue', Arial, monospace;
    font-size: 11px;
    word-break: break-all;
}
.tle-info-table-url:hover {
    color: var(--color-accent);
    text-decoration: underline;
}

.tle-manual-wrap {
    display: flex;
    flex-direction: column;
    width: 100%;
}

.tle-file-row {
    display: flex;
    align-items: center;
    gap: 0;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    margin-top: 12px;
    overflow: hidden;
}
.tle-file-input {
    display: none;
}
.tle-file-label {
    flex-shrink: 0;
    height: 37px;
    padding: 0 16px;
    background: rgba(255, 255, 255, 0.04);
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.5);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: background 0.15s, color 0.15s;
    user-select: none;
}
.tle-file-label:hover {
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.85);
}
.tle-file-name {
    flex: 1;
    padding: 0 12px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.35);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.04em;
}

.tle-db-wrap {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 480px;
}
.tle-db-summary {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.45);
}

.tle-cat-table {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    overflow: hidden;
}
.tle-cat-row {
    display: grid;
    grid-template-columns: 1fr 48px 90px;
    align-items: center;
    padding: 7px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
}
.tle-cat-row:last-child {
    border-bottom: none;
}
.tle-cat-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.04);
}
.tle-cat-name {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
}
.tle-cat-count {
    font-family: 'Barlow Condensed', 'Barlow', Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent);
    text-align: right;
    padding-right: 16px;
}
.tle-cat-age {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    text-align: right;
    letter-spacing: 0.04em;
}

.tle-uncat-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 580px;
}
.tle-uncat-count {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.45);
    text-decoration: none;
}
.tle-uncat-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.15) transparent;
}
.tle-uncat-list::-webkit-scrollbar { width: 4px; }
.tle-uncat-list::-webkit-scrollbar-track { background: transparent; }
.tle-uncat-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
.tle-uncat-row {
    display: grid;
    grid-template-columns: 1fr 56px auto;
    align-items: center;
    overflow: visible;
    gap: 0;
    padding: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
    overflow: hidden;
}
.tle-uncat-row:last-child {
    border-bottom: none;
}
.tle-uncat-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.04);
}
.tle-uncat-name {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.7);
    padding: 0 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.03em;
}
.tle-uncat-id {
    font-family: 'Courier New', monospace;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.25);
    text-align: right;
    padding-right: 8px;
    letter-spacing: 0.04em;
}
.tle-uncat-row .tle-uncat-drop {
    height: 34px;
    min-width: 150px;
}
.tle-uncat-row .tle-uncat-drop .tle-dropdown-selected {
    height: 34px;
    border-left: 1px solid var(--color-border);
    background-color: rgba(255, 255, 255, 0.03);
}
.tle-uncat-row .tle-uncat-drop .tle-dropdown-selected-text {
    font-size: 9px;
    letter-spacing: 0.1em;
}

.settings-item--wide {
    max-width: none !important;
}
.settings-item--wide .tle-manual-wrap,
.settings-item--wide .tle-satlist-wrap,
.settings-item--wide .tle-online-wrap,
.settings-item--wide .sdr-devices-wrap {
    max-width: 680px;
}

.tle-satlist-wrap {
    display: flex;
    flex-direction: column;
    gap: 0;
}

.tle-satlist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
    max-width: 860px;
}
.tle-satlist-header:hover {
    background: var(--color-border);
}

.tle-satlist-header-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
}

.tle-satlist-chevron {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.25);
    transition: transform 0.2s ease;
    flex-shrink: 0;
}
.tle-satlist-chevron--open {
    transform: rotate(90deg);
}

.tle-satlist-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    max-width: 860px;
}
.tle-satlist-body--hidden {
    display: none;
}

.tle-satlist-search-row {
    margin-bottom: 0;
}

.tle-satlist-table {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 360px;
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.12) transparent;
}
.tle-satlist-table::-webkit-scrollbar { width: 4px; }
.tle-satlist-table::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

.tle-satlist-row {
    display: grid;
    grid-template-columns: 1fr 60px 130px 72px;
    align-items: center;
    padding: 7px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(255, 255, 255, 0.02);
}
.tle-satlist-row:last-child { border-bottom: none; }
.tle-satlist-row:nth-child(even) { background: rgba(255, 255, 255, 0.04); }

.tle-satlist-name {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 8px;
}
.tle-satlist-id {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.25);
    text-align: left;
}
.tle-satlist-cat {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(200, 255, 0, 0.6);
}
.tle-satlist-cat--none {
    color: rgba(255, 255, 255, 0.2);
}
.tle-satlist-age {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    text-align: right;
    letter-spacing: 0.04em;
}

.tle-satlist-count {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.06em;
    text-align: right;
}

.tle-satlist-loading {
    padding: 16px 12px;
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.06em;
}

.tle-satlist-name--user {
    color: rgba(200, 255, 0, 0.85);
}

.settings-config-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(1120px, 100%);
}

.settings-config-preview--hidden {
    display: none;
}

.settings-config-preview--textarea {
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
    outline: none;
    caret-color: var(--color-accent);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif !important;
    font-size: 13px !important;
    font-weight: 400;
    letter-spacing: 0.05em;
}

.settings-config-preview--textarea:focus {
    border-color: rgba(255, 255, 255, 0.25);
}

.settings-config-preview {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 16px;
    font-family: 'Barlow Condensed', 'Barlow', monospace;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.6);
    white-space: pre;
    overflow: auto;
    max-height: 600px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.settings-config-action-row {
    display: flex;
    align-items: center;
    gap: 16px;
}

.settings-config-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 9px 20px;
    color: rgba(255, 255, 255, 0.6);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    user-select: none;
    align-self: flex-start;
}

.settings-config-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.4);
    color: rgba(255, 255, 255, 0.9);
}

.sdr-devices-wrap {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 0;
}

.sdr-devices-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
}

.sdr-devices-empty {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.3);
    padding: 4px 0 12px;
}

.sdr-device-item {
    display: flex;
    flex-direction: column;
}

.sdr-device-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
}

.sdr-device-item--open > .sdr-device-row {
    border-bottom-color: transparent;
}

.sdr-device-info {
    flex: 1;
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sdr-device-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 4px 5px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s;
}

.sdr-device-btn:hover {
    color: rgba(255, 255, 255, 0.75);
}

.sdr-device-btn--active {
    color: var(--color-accent);
}

.sdr-device-btn--danger:hover {
    color: rgba(255, 90, 90, 0.85);
}

.sdr-device-confirm {
    display: none;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.sdr-device-confirm-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: rgba(255, 90, 90, 0.7);
    text-transform: uppercase;
}

.sdr-device-confirm-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    padding: 3px 9px;
    color: rgba(255, 255, 255, 0.45);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.sdr-device-confirm-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.8);
}

.sdr-device-confirm-btn--yes {
    border-color: rgba(255, 60, 60, 0.35);
    color: rgba(255, 90, 90, 0.8);
}

.sdr-device-confirm-btn--yes:hover {
    background: rgba(255, 60, 60, 0.1);
    border-color: rgba(255, 60, 60, 0.6);
    color: rgba(255, 110, 110, 0.95);
}

.sdr-devices-accordion {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 0 12px 0;
}

.sdr-device-item--new > .sdr-devices-accordion {
    padding-top: 4px;
}

.sdr-devices-form-row {
    display: flex;
    align-items: center;
    gap: 14px;
}

.sdr-devices-form-label {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    width: 110px;
    flex-shrink: 0;
}

.sdr-devices-form-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 6px 10px;
    color: rgba(255, 255, 255, 0.85);
    font-family: 'Barlow Condensed', 'Barlow', sans-serif;
    font-size: 14px;
    font-weight: 400;
    letter-spacing: 0.04em;
    outline: none;
    caret-color: var(--color-accent);
    transition: border-color 0.15s;
    min-width: 0;
    -moz-appearance: textfield;
}

.sdr-devices-form-input:focus {
    border-color: rgba(200, 255, 0, 0.3);
}

.sdr-devices-form-input::placeholder {
    color: rgba(255, 255, 255, 0.18);
}

.sdr-devices-form-input::-webkit-outer-spin-button,
.sdr-devices-form-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.sdr-devices-enabled-group {
    display: flex;
    gap: 8px;
}

.sdr-devices-enabled-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 5px 12px;
    color: rgba(255, 255, 255, 0.3);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.sdr-devices-enabled-btn:hover {
    color: rgba(255, 255, 255, 0.6);
    border-color: rgba(255, 255, 255, 0.25);
}

.sdr-devices-enabled-btn.is-active {
    background: rgba(200, 255, 0, 0.08);
    border-color: rgba(200, 255, 0, 0.45);
    color: var(--color-accent);
}

.sdr-devices-agc-row {
    padding: 4px 0 2px;
}

.sdr-devices-agc-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
}

.sdr-devices-agc-input {
    display: none;
}

.sdr-devices-agc-box {
    width: 14px;
    height: 14px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s;
}

.sdr-devices-agc-input:checked + .sdr-devices-agc-box {
    background: rgba(200, 255, 0, 0.12);
    border-color: rgba(200, 255, 0, 0.6);
}

.sdr-devices-agc-input:checked + .sdr-devices-agc-box::after {
    content: '';
    display: block;
    width: 8px;
    height: 5px;
    border-left: 1.5px solid #c8ff00;
    border-bottom: 1.5px solid #c8ff00;
    transform: rotate(-45deg) translateY(-1px);
}

.sdr-devices-agc-text {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.5);
    letter-spacing: 0.06em;
}

.sdr-devices-form-error {
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    color: rgba(255, 80, 80, 0.9);
    padding: 0;
    margin-left: 124px;
}

.sdr-devices-form-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 2px;
}

.sdr-devices-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    padding: 7px 16px;
    color: rgba(255, 255, 255, 0.5);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.sdr-devices-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.85);
}

.sdr-devices-btn--primary {
    border-color: rgba(200, 255, 0, 0.4);
    color: var(--color-accent);
}

.sdr-devices-btn--primary:hover {
    background: rgba(200, 255, 0, 0.07);
    border-color: rgba(200, 255, 0, 0.7);
}

.sdr-devices-add-btn {
    background: none;
    border: none;
    padding: 4px 0;
    color: rgba(255, 255, 255, 0.35);
    font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.12s;
    align-self: flex-start;
}

.sdr-devices-add-btn:hover {
    color: var(--color-accent);
}
</style>
