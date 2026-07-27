<template>
  <BaseFilterPanel
    :items="items"
    :query="landStore.searchQuery"
    :expanded-key="landStore.searchExpandedCallsign"
    id-prefix="land-filter"
    input-label="Filter APRS stations by callsign, symbol, path or comment"
    placeholder="CALLSIGN · SYMBOL · PATH · COMMENT"
    listbox-label="APRS stations"
    :empty-message="emptyMessage"
    @update:query="landStore.setSearchQuery"
    @update:expanded-key="landStore.setSearchExpandedCallsign"
  >
    <template #accordion="{ item }">
      <div class="land-filter-accordion">
        <template v-if="stationFor(item.key)">
          <BaseDataGrid title="STATION" :columns="3">
            <BaseDataCell label="CALLSIGN" :value="stationFor(item.key)!.callsign" />
            <BaseDataCell label="SYMBOL">
              <!-- The icon itself, not its name: the same glyph the map draws,
                   so the panel and the map agree at a glance. It carries the
                   type as its accessible name, so nothing is lost by dropping
                   the text. -->
              <SdrAprsSymbol :symbol="stationFor(item.key)!.symbol" />
            </BaseDataCell>
            <BaseDataCell
              label="TIME"
              :value="formatHeardTime(stationFor(item.key)!.last_heard_ms)"
            />
          </BaseDataGrid>
          <BaseDataGrid title="POSITION" :columns="3">
            <BaseDataCell label="LATITUDE" :value="stationFor(item.key)!.latitude.toFixed(5)" />
            <BaseDataCell label="LONGITUDE" :value="stationFor(item.key)!.longitude.toFixed(5)" />
            <BaseDataCell
              label="ALTITUDE"
              :value="formatAltitude(stationFor(item.key)!.altitude) ?? '—'"
            />
          </BaseDataGrid>
          <BaseDataGrid title="MOVEMENT" :columns="2">
            <BaseDataCell
              label="COURSE"
              :value="formatCourse(stationFor(item.key)!.course) ?? '—'"
            />
            <BaseDataCell label="SPEED" :value="formatSpeed(stationFor(item.key)!.speed) ?? '—'" />
          </BaseDataGrid>
          <!-- Free text, not telemetry: sized and weighted like the Space
               pane's NOTES list so prose reads as prose across both panels. -->
          <div class="land-filter-packet">
            <BaseDataGrid title="PACKET" :columns="2" collapse-on-narrow>
              <BaseDataCell label="PATH" :value="stationFor(item.key)!.path ?? '—'" wide />
              <BaseDataCell label="COMMENT" :value="stationFor(item.key)!.comment ?? '—'" wide />
            </BaseDataGrid>
            <!-- The raw frame runs to several wrapped lines and is reference
                 material, not something to read at a glance, so it collapses. -->
            <div class="land-filter-raw">
              <button
                type="button"
                class="land-filter-raw-toggle"
                :aria-expanded="rawExpanded"
                :aria-controls="rawBodyId"
                @click.stop="rawExpanded = !rawExpanded"
              >
                <span class="land-filter-raw-label">RAW</span>
                <ChevronIcon :open="rawExpanded" />
              </button>
              <div v-if="rawExpanded" :id="rawBodyId" class="land-filter-raw-body">
                {{ stationFor(item.key)!.raw ?? '—' }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </BaseFilterPanel>
</template>

<script setup lang="ts">
/**
 * Land FILTER pane — the searchable list of APRS stations currently heard.
 *
 * Mirrors the Space pane's shape (shared BaseFilterPanel shell, an expandable
 * per-item accordion of BaseDataGrid sections) over APRS data, and shows every
 * field the beacon carried rather than only those enabled for map labels.
 *
 * The list tracks the map exactly: it renders the same polled snapshot the map
 * plots, so a station that stops beaconing and ages out of the retention window
 * disappears from both at the same moment.
 */
import { computed, ref, watch } from 'vue'
import BaseFilterPanel, {
  type FilterPanelItem,
} from '@/components/shared/filter/BaseFilterPanel.vue'
import BaseDataGrid from '@/components/base/BaseDataGrid.vue'
import BaseDataCell from '@/components/base/BaseDataCell.vue'
import ChevronIcon from '@/components/shared/ChevronIcon.vue'
import SdrAprsSymbol from '@/components/sdr/SdrAprsSymbol.vue'
import { useLandStore, type AprsStation } from '@/stores/land'
import { aprsSymbolIcon } from '@/utils/aprsSymbols'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import {
  formatAltitude,
  formatCourse,
  formatHeardTime,
  formatSpeed,
} from './controls/aprs/AprsStationsControl'

const landStore = useLandStore()

// Whether the expanded station's raw frame is showing. Only one station is open
// at a time, so one flag covers the pane; it closes again whenever a different
// station is opened, so a frame never appears already-expanded.
const rawExpanded = ref(false)
const rawBodyId = 'land-filter-raw-body'
watch(
  () => landStore.searchExpandedCallsign,
  () => {
    rawExpanded.value = false
  },
)

function symbolLabel(station: AprsStation): string {
  return aprsSymbolIcon(station.symbol).label
}

/** Stations matching the search text, over callsign, symbol type, path and
 *  comment — the fields an operator would recognise a station by. */
const matchingStations = computed<AprsStation[]>(() => {
  // The list shows exactly what the map plots: hiding the APRS layer empties
  // both, rather than leaving the panel listing stations that aren't there.
  if (!landStore.aprsLayerVisible) return []
  const needle = landStore.searchQuery.trim().toLowerCase()
  if (!needle) return landStore.aprsStations
  return landStore.aprsStations.filter((station) =>
    [station.callsign, symbolLabel(station), station.path ?? '', station.comment ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
})

const items = computed<FilterPanelItem[]>(() =>
  matchingStations.value.map((station) => ({
    key: station.callsign,
    primary: station.callsign,
    secondary: `${symbolLabel(station)} · ${formatHeardTime(station.last_heard_ms)}`,
    optionLabel: `${station.callsign}, ${symbolLabel(station)}, heard ${formatHeardTime(station.last_heard_ms)}`,
  })),
)

const emptyMessage = computed(() => {
  if (!landStore.aprsLayerVisible) return 'APRS layer hidden'
  return landStore.aprsStations.length === 0 ? 'No APRS stations heard' : 'No stations match'
})

function stationFor(callsign: string): AprsStation | undefined {
  return landStore.aprsStations.find((station) => station.callsign === callsign)
}

// A station clicked on the map expands here. The sidebar tab switch is App.vue's
// job (it owns the sidebar); this side only has to open the right row.
useDocumentEvent('aprs-station-selected', (event: Event) => {
  const { callsign } = (event as CustomEvent<{ callsign: string }>).detail
  landStore.setSearchExpandedCallsign(callsign)
})

// Collapse the accordion if its station ages out of the retention window, so the
// pane never holds an expanded row for a station that is no longer on the map.
watch(
  () => landStore.aprsStations,
  (stations) => {
    const expanded = landStore.searchExpandedCallsign
    if (expanded && !stations.some((station) => station.callsign === expanded)) {
      landStore.setSearchExpandedCallsign('')
    }
  },
  { deep: true },
)
</script>

<style scoped>
.land-filter-accordion {
  display: flex;
  flex-direction: column;
  padding-bottom: 12px;
}
/* Only the free-text packet fields deviate from the shared cell styling the
   Space pane uses for telemetry: they wrap rather than being ellipsized at the
   column edge (a raw frame is unreadable truncated to one line) and take the
   size, weight and colour of that pane's NOTES list, so prose reads the same in
   both panels. */
.land-filter-packet {
  display: contents;
  --ba-cell-value-white-space: normal;
  --ba-cell-value-word-break: break-word;
  --ba-cell-align: flex-start;
  --ba-cell-value-font-size: 13px;
  --ba-cell-value-font-weight: 400;
  --ba-cell-value-line-height: 1.45;
  --ba-cell-value-letter-spacing: normal;
  --ba-cell-value-color: rgba(255, 255, 255, 0.82);
}

.land-filter-raw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* Set off from the fields above: it is a control, not another field. */
  padding: 12px 24px 14px;
}
/* Matches the data cells' own label, so the disclosure reads as another field
   in the section rather than a control bolted onto it. */
.land-filter-raw-toggle {
  display: flex;
  align-items: center;
  /* Full width with the chevron pushed to the far edge, so it lines up with
     the row chevron above rather than floating beside the label. */
  justify-content: space-between;
  width: 100%;
  gap: 6px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.35);
}
.land-filter-raw-toggle:hover {
  color: rgba(255, 255, 255, 0.6);
}
.land-filter-raw-label {
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
/* Declared to match a packet field's value exactly — same family, size,
   weight, line height, colour and spacing — so the frame reads as the same
   kind of text as the COMMENT above it. */
.land-filter-raw-body {
  font-family: var(--font-primary);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: normal;
  color: rgba(255, 255, 255, 0.82);
  word-break: break-word;
}
</style>
