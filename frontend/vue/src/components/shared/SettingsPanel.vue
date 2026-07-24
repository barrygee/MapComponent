<template>
  <div
    id="settings-panel"
    ref="panelRef"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-section-heading"
    tabindex="-1"
    :class="{ 'settings-panel-visible': store.open }"
    @keydown="onKeydown"
  >
    <div id="settings-sidebar" :class="{ 'settings-sidebar--collapsed': !store.sidebarOpen }">
      <BaseIconButton
        v-for="s in visibleSections"
        :key="s.key"
        class="settings-nav-item"
        :class="{ active: activeSection === s.key }"
        :bordered="true"
        :active="activeSection === s.key"
        tooltip-side="right"
        :tooltip="s.label"
        :accessible-name="s.label"
        :aria-pressed="activeSection === s.key"
        @click="selectSection(s.key)"
      >
        <span class="settings-nav-icon-wrap">
          <!-- App Settings: sliders icon -->
          <svg
            v-if="s.key === 'app'"
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <line
              x1="4"
              y1="6"
              x2="20"
              y2="6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <circle cx="15" cy="6" r="2.5" stroke="currentColor" stroke-width="1.8" />
            <line
              x1="4"
              y1="13"
              x2="20"
              y2="13"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <circle cx="9" cy="13" r="2.5" stroke="currentColor" stroke-width="1.8" />
            <line
              x1="4"
              y1="20"
              x2="20"
              y2="20"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <circle cx="14" cy="20" r="2.5" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <!-- AIR: civil aircraft (matches AirSideMenu civil filter icon) -->
          <svg
            v-else-if="s.key === 'air'"
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2C12.8 2 13.2 3.6 13.2 6.6 L21 11.5 V13.4 L13.2 11 V16.5 L15.5 18.5 V20 L12 19 L8.5 20 V18.5 L10.8 16.5 V11 L3 13.4 V11.5 L10.8 6.6 C10.8 3.6 11.2 2 12 2Z"
              fill="currentColor"
            />
          </svg>
          <!-- SPACE: planet Earth (globe with meridian and equator) -->
          <svg
            v-else-if="s.key === 'space'"
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" stroke-width="1.8" />
            <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <!-- SEA: sailboat icon -->
          <svg
            v-else-if="s.key === 'sea'"
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <line
              x1="12"
              y1="16"
              x2="12"
              y2="3"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M12 4L5 15h7V4z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path d="M3 16h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <path
              d="M3 16l1.5 4.5h15L21 16"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <!-- LAND: mountain terrain icon -->
          <svg
            v-else-if="s.key === 'land'"
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 20L8 7l4 6.5L16 5l6 15H2z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
          </svg>
          <!-- SDR (default): radio (matches SdrPanel radio tab icon) -->
          <svg
            v-else
            class="settings-nav-icon"
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            stroke-linecap="round"
          >
            <line x1="6" y1="9" x2="18" y2="3" stroke="currentColor" stroke-width="1.6" />
            <rect
              x="3"
              y="9"
              width="18"
              height="12"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="miter"
              fill="none"
            />
            <circle cx="16" cy="15" r="2.6" stroke="currentColor" stroke-width="1.6" />
            <line x1="6" y1="13" x2="11" y2="13" stroke="currentColor" stroke-width="1.6" />
            <line x1="6" y1="17" x2="11" y2="17" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </span>
      </BaseIconButton>
    </div>

    <div id="settings-content">
      <div id="settings-section-heading">
        <span class="settings-heading-dot" aria-hidden="true"></span>
        <span>{{ sectionHeading }}</span>
      </div>

      <div
        id="settings-search-wrap"
        :class="{ 'settings-search-wrap--hidden': activeSection !== 'app' && !searchQuery }"
      >
        <div id="settings-search-inner">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2" />
            <line
              x1="9.5"
              y1="9.5"
              x2="13"
              y2="13"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
          <input
            id="settings-search-input"
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            aria-label="Search settings"
            placeholder="SEARCH SETTINGS"
            autocomplete="off"
            spellcheck="false"
          />
          <BaseIconAction
            id="settings-search-clear"
            accessible-name="Clear search"
            :active="searchQuery.length > 0"
            active-class="settings-search-clear-visible"
            @click="clearSearch"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <line
                x1="2"
                y1="2"
                x2="10"
                y2="10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
              <line
                x1="10"
                y1="2"
                x2="2"
                y2="10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </BaseIconAction>
        </div>
      </div>

      <div id="settings-body">
        <!-- Search results -->
        <template v-if="searchQuery.trim()">
          <template v-if="searchResults.length === 0">
            <div class="settings-empty">No results found</div>
          </template>
          <template v-else>
            <div class="settings-grid">
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
            </div>
          </template>
        </template>

        <!-- Section items -->
        <template v-else>
          <template v-if="currentSectionItems.length === 0">
            <div class="settings-empty">Settings coming soon</div>
          </template>
          <template v-else>
            <div class="settings-grid">
              <template v-for="(item, idx) in currentSectionItems" :key="item.id">
                <div
                  v-if="
                    item.groupLabel !== undefined &&
                    item.groupLabel !== currentSectionItems[idx - 1]?.groupLabel
                  "
                  class="settings-group-label"
                  :class="{ 'settings-group-label--spaced': idx > 0 }"
                >
                  {{ item.groupLabel }}
                </div>
                <SettingRow
                  :item="item"
                  :pending="pending"
                  @stage="stagePending"
                  @commit="commitAll"
                />
              </template>
            </div>
          </template>
        </template>
      </div>

      <div id="settings-footer">
        <span id="settings-apply-status" :class="applyStatusClass">{{ applyStatusMsg }}</span>
        <BaseButton id="settings-apply-btn" variant="primary" @click="commitAll"
          >APPLY CHANGES</BaseButton
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import './SettingsPanel.css'
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { useSdrStore } from '@/stores/sdr'
import { useDialog } from '@/composables/useDialog'
import type { SettingItem } from '@/types/settings'
import SettingRow from './settings/SettingRow.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'

// Re-exported for back-compat: this type used to be defined here. Prefer
// importing from '@/types/settings' directly in new code.
export type { SettingItem }

const store = useSettingsStore()
const appStore = useAppStore()
const sdrStore = useSdrStore()

const activeSection = ref('app')
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

// Modal-dialog behaviour: trap focus while open, Escape to close, restore focus
// to the trigger on close (WCAG 4.1.2 / 2.4.3 / 2.1.2). The panel is display:none
// when closed, so it leaves the a11y tree without needing aria-hidden.
const { onKeydown } = useDialog({
  isOpen: computed(() => store.open),
  container: panelRef,
  onClose: () => store.closePanel(),
  // Focus the dialog container (tabindex="-1") rather than the search field, so
  // the modal focus contract still holds (focus enters the dialog, Escape +
  // tab-trapping work) without auto-highlighting the search input on open.
  initialFocus: () => panelRef.value,
})
const pending = ref<Map<string, () => Promise<unknown> | void>>(new Map())
const applyStatusMsg = ref('')
const applyStatusClass = ref('')

interface NavSection {
  key: string
  label: string
}
const NAV_SECTIONS: NavSection[] = [
  { key: 'app', label: 'App Settings' },
  { key: 'air', label: 'AIR' },
  { key: 'space', label: 'SPACE' },
  { key: 'sea', label: 'SEA' },
  { key: 'land', label: 'LAND' },
  { key: 'sdr', label: 'SDR' },
]

const ALL_SETTINGS: SettingItem[] = [
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'connectivity-mode',
    label: 'Connectivity Mode',
    desc: 'Use online or off grid data sources across the app',
    type: 'connectivity-toggle',
  },
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'app-connectivity-probe',
    label: 'Connectivity Probe URL',
    desc: 'URL polled every 2 seconds to detect internet access',
    type: 'probe-url',
  },
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'notification-sound',
    label: 'Notification Sound',
    desc: 'Play a subtle blip when a new alert or notification arrives',
    type: 'notification-sound',
  },
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'location',
    label: 'My Location',
    desc: 'Set a fixed latitude / longitude for your position',
    type: 'location',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-overhead-alerts',
    label: 'Overhead Aircraft Alerts',
    desc: 'Notify when aircraft are within range of your location, and show the zone on the map',
    type: 'overhead-alerts-toggle',
    groupLabel: 'ALERTS',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-overhead-alert-radius',
    label: 'Overhead Alert Radius',
    desc: 'Distance from your location (in nautical miles) used to trigger overhead aircraft alerts and define the zone shown on the map',
    type: 'overhead-alert-radius',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-tag-fields',
    label: 'Label Data Points',
    desc: 'Choose which data fields appear on aircraft labels for civil and military aircraft',
    type: 'air-tag-fields',
    groupLabel: 'LABELS',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-replay-toggle',
    label: 'Flight Replay',
    desc: 'Record aircraft movements to the database so you can replay them later via the REPLAY tab. When off, no flight history is recorded and the REPLAY tab is hidden. Off by default.',
    type: 'air-replay-toggle',
    groupLabel: 'REPLAY',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-source-override',
    label: 'Source Override',
    desc: 'Override the app-level connectivity mode for this domain',
    type: 'source-override',
    ns: 'air',
    groupLabel: 'DATA SOURCES',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-online-source',
    label: 'Online Data Source',
    desc: 'URL for live air data feed',
    type: 'online-source',
    ns: 'air',
    defaultUrl: 'https://api.airplanes.live/v2',
  },
  {
    section: 'air',
    sectionLabel: 'AIR',
    id: 'air-offline-source',
    label: 'Off Grid Data Source',
    desc: 'Local server URL and port for air data',
    type: 'offline-source',
    ns: 'air',
    defaultUrl: '',
  },
  {
    section: 'space',
    sectionLabel: 'SPACE',
    id: 'space-online-source',
    label: 'Online Data Source',
    desc: 'URL to fetch TLE data from — select a category and click UPDATE TLE',
    type: 'space-tle-online',
    groupLabel: 'DATA SOURCES',
  },
  {
    section: 'space',
    sectionLabel: 'SPACE',
    id: 'space-manual-tle',
    label: 'TLE Import',
    desc: 'Upload a .txt file of TLE data',
    type: 'space-tle-manual',
  },
  {
    section: 'space',
    sectionLabel: 'SPACE',
    id: 'space-tle-database',
    label: 'TLE Database',
    desc: 'Satellite count, sources, and per-category last-updated times. Clear all data, or clear a single category (e.g. space station, amateur radio).',
    type: 'space-tle-db',
  },
  {
    section: 'space',
    sectionLabel: 'SPACE',
    id: 'space-sat-radio-file',
    label: 'Satellite Frequencies (JSON)',
    desc: 'Bulk-edit all satellite frequencies as raw JSON. Saved to backend/data/satellite_radio.json and the database.',
    type: 'space-sat-radio-file',
    groupLabel: 'SATELLITE DATA',
  },
  {
    section: 'space',
    sectionLabel: 'SPACE',
    id: 'space-filter-hover-preview',
    label: 'Filter Hover Behaviour',
    desc: 'When hovering over a satellite in the search results, choose whether the map stays in place or flies to that satellite',
    type: 'space-hover-preview',
    groupLabel: 'FILTER HOVER',
  },
  {
    section: 'sea',
    sectionLabel: 'SEA',
    id: 'sea-source-override',
    label: 'Source Override',
    desc: 'Override the app-level connectivity mode for this domain',
    type: 'source-override',
    ns: 'sea',
  },
  {
    section: 'sea',
    sectionLabel: 'SEA',
    id: 'sea-online-source',
    label: 'Online Data Source',
    desc: 'URL for live sea data feed',
    type: 'online-source',
    ns: 'sea',
    defaultUrl: '',
  },
  {
    section: 'sea',
    sectionLabel: 'SEA',
    id: 'sea-offline-source',
    label: 'Off Grid Data Source',
    desc: 'Local server URL and port for sea data',
    type: 'offline-source',
    ns: 'sea',
    defaultUrl: '',
  },
  {
    section: 'land',
    sectionLabel: 'LAND',
    id: 'land-source-override',
    label: 'Source Override',
    desc: 'Override the app-level connectivity mode for this domain',
    type: 'source-override',
    ns: 'land',
  },
  {
    section: 'land',
    sectionLabel: 'LAND',
    id: 'land-online-source',
    label: 'Online Data Source',
    desc: 'URL for live land data feed',
    type: 'online-source',
    ns: 'land',
    defaultUrl: '',
  },
  {
    section: 'land',
    sectionLabel: 'LAND',
    id: 'land-offline-source',
    label: 'Off Grid Data Source',
    desc: 'Local server URL and port for land data',
    type: 'offline-source',
    ns: 'land',
    defaultUrl: '',
  },
  {
    section: 'land',
    sectionLabel: 'LAND',
    id: 'land-aprs-retention',
    label: 'APRS Retention',
    desc: 'Minutes a heard APRS station stays on the map after its last signal',
    type: 'land-aprs-retention',
    ns: 'land',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-devices',
    label: 'SDR Devices',
    desc: 'Configure RTL-SDR devices reachable via rtl_tcp',
    type: 'sdr-devices',
    groupLabel: 'DEVICES',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-autocenter',
    label: 'Auto-center on Tune',
    desc: 'When ON, clicking the spectrum/waterfall re-centers the display on the new frequency. When OFF, the display stays put and the radio tunes to the clicked frequency where you clicked it.',
    type: 'sdr-autocenter',
    groupLabel: 'WATERFALL',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-full-waterfall-update',
    label: 'Full Waterfall Update',
    desc: 'When ON, the waterfall history clears each time you change Zoom so new rows fill the new viewport cleanly. When OFF (the SDR++ default), the existing rows stay stretched and only new rows are drawn at the new zoom level.',
    type: 'sdr-full-waterfall-update',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-snap-to-known',
    label: 'Snap to Known Frequencies',
    desc: 'When ON, clicking a known-frequency marker in the spectrum jumps straight to it, and dragging the tuner bar snaps to a nearby known frequency from your Frequency Manager.',
    type: 'sdr-snap-to-known',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-show-bandplan',
    label: 'Show Band Plan',
    desc: 'Show the coloured RF band-plan strip (Air Band, FM Broadcast, etc.) along the bottom of the spectrum.',
    type: 'sdr-show-bandplan',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-show-known-freqs',
    label: 'Show Known Frequencies',
    desc: 'Show labels on the spectrum for the frequencies tracked in your Frequency Manager.',
    type: 'sdr-show-known-freqs',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-resume-delay',
    label: 'Resume Delay',
    desc: 'When scan or search locks on a signal, wait this many seconds after the signal drops before continuing. 0 resumes immediately on drop. You can always press HOLD/RESUME to force-continue.',
    type: 'sdr-resume-delay',
    groupLabel: 'SCAN & SEARCH',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-decode-mute-toggle',
    label: 'Mute Audio While Decoding',
    desc: 'When ON, a radio’s analog audio is muted while that radio decodes digital voice (DMR/P25) or APRS — the raw channel is noise, not speech. Only the decoding radio is muted; any other radio you are listening to keeps its audio. Turn OFF to keep hearing the analog demod during decode. On by default.',
    type: 'sdr-decode-mute-toggle',
    groupLabel: 'DECODING',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-frequencies-file',
    label: 'Frequencies & Groups (JSON)',
    desc: 'Bulk-edit frequency groups, stored frequencies, and search ranges as raw JSON. Saved to backend/data/sdr_frequencies.json and the database.',
    type: 'sdr-frequencies-file',
    groupLabel: 'FREQUENCY DATA',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-bandplan-file',
    label: 'Band Plan (JSON)',
    desc: 'Bulk-edit the coloured RF band-plan strip as raw JSON. Saved to backend/data/sdr_bandplan.json and the database.',
    type: 'sdr-bandplan-file',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-trunk-tracking-toggle',
    label: 'Trunk Tracking',
    desc: 'Follow trunked-radio systems by control-channel grants. When on, the TRUNK control and TRUNK SYSTEM channel-map picker appear in the SDR panel and the Trunk Channel Maps editor below is shown. When off, all trunk UI is hidden. Off by default.',
    type: 'sdr-trunk-tracking-toggle',
    groupLabel: 'TRUNK DATA',
  },
  {
    section: 'sdr',
    sectionLabel: 'SDR',
    id: 'sdr-channelmaps-file',
    label: 'Trunk Channel Maps (JSON)',
    desc: 'Add trunked-system channel maps as JSON — each map a name plus a list of {lsn, frequency_hz} pairs. Saved to the database and written out as the CSV files dsd-fme loads for trunk tracking (pick one in the SDR panel’s TRUNK control).',
    type: 'sdr-channelmaps-file',
    groupLabel: 'TRUNK DATA',
  },
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'config-current',
    label: 'Application Config',
    desc: 'Settings currently stored in the database',
    type: 'config-current',
  },
  {
    section: 'app',
    sectionLabel: 'App Settings',
    id: 'export-all',
    label: 'Export All Configuration',
    desc: 'Back up your full configuration (sentinel_config.json, sdr_frequencies.json and sdr_bandplan.json) to a single folder you choose',
    type: 'export-all',
  },
]

const DOMAIN_SECTIONS = new Set(['air', 'space', 'sea', 'land', 'sdr'])
const visibleSections = computed(() =>
  NAV_SECTIONS.filter(
    (s) => !DOMAIN_SECTIONS.has(s.key) || appStore.enabledDomains.includes(s.key),
  ),
)

// Some rows are gated behind a feature flag rather than always shown. The Trunk
// Channel Maps (JSON) editor only makes sense — and only appears — when trunk
// tracking is enabled, so it follows the same master flag as the panel UI.
function isSettingVisible(item: SettingItem): boolean {
  if (item.id === 'sdr-channelmaps-file') return sdrStore.trunkTrackingEnabled
  return true
}

const sectionHeading = computed(() => {
  if (searchQuery.value.trim()) return 'SEARCH RESULTS'
  const s = NAV_SECTIONS.find((n) => n.key === activeSection.value)
  if (!s) return activeSection.value
  return s.key === 'app' ? s.label : s.label + ' SETTINGS'
})

const currentSectionItems = computed(() =>
  ALL_SETTINGS.filter((s) => s.section === activeSection.value && isSettingVisible(s)),
)

const searchResults = computed<SettingItem[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  /* v8 ignore start -- searchResults is only read while a search query is active
     (it sits behind v-if="searchQuery.trim()"), so q is never empty here */
  if (!q) return []
  /* v8 ignore stop */
  return ALL_SETTINGS.filter(
    (s) =>
      (!DOMAIN_SECTIONS.has(s.section) || appStore.enabledDomains.includes(s.section)) &&
      isSettingVisible(s) &&
      (s.label.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.sectionLabel.toLowerCase().includes(q)),
  )
})

const searchResultGroups = computed(() => {
  const groups: Record<string, { section: string; sectionLabel: string; items: SettingItem[] }> = {}
  const order: string[] = []
  searchResults.value.forEach((item) => {
    if (!groups[item.section]) {
      groups[item.section] = { section: item.section, sectionLabel: item.sectionLabel, items: [] }
      order.push(item.section)
    }
    groups[item.section].items.push(item)
  })
  return order.map((k) => groups[k])
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
  pending.value.forEach((fn) => {
    try {
      const result = fn()
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        promises.push(result as Promise<unknown>)
      }
    } catch {
      hasError = true
    }
  })
  if (hasError) {
    showApplyStatus('ERROR', true)
    return
  }
  try {
    await Promise.all(promises)
  } catch {
    showApplyStatus('ERROR', true)
    return
  }
  pending.value.clear()
  showApplyStatus('SAVED', false)
  // Hold long enough for the SAVED confirmation to be clearly visible before the
  // page reloads (the reload re-hydrates settings that need a fresh app start).
  setTimeout(() => {
    try {
      sessionStorage.setItem('sentinel_settings_reopen', activeSection.value)
    } catch {}
    location.reload()
  }, 1200)
}

watch(
  () => store.open,
  (isOpen) => {
    if (isOpen) {
      // Focus-in is handled by useDialog; here we only resolve which section opens.
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
  },
)

// A location set elsewhere (right-click, config hydration) supersedes any
// typed-but-unapplied LAT/LON, so drop the staged 'location' edit. The field
// sync itself is handled by LocationControl listening for this same event;
// don't re-dispatch it here (would loop).
window.addEventListener('settings:locationSynced', () => {
  if (!store.open || activeSection.value !== 'app') return
  pending.value.delete('location')
})
</script>
