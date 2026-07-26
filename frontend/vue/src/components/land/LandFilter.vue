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
            <BaseDataCell label="SYMBOL" :value="symbolLabel(stationFor(item.key)!)" />
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
          <!-- Free text, not telemetry: set in regular weight so a long path or
               raw frame reads as prose rather than shouting like a value. -->
          <div class="land-filter-packet">
            <BaseDataGrid title="PACKET" :columns="2" collapse-on-narrow>
              <BaseDataCell label="PATH" :value="stationFor(item.key)!.path ?? '—'" wide />
              <BaseDataCell label="COMMENT" :value="stationFor(item.key)!.comment ?? '—'" wide />
              <BaseDataCell label="RAW" :value="stationFor(item.key)!.raw ?? '—'" wide />
            </BaseDataGrid>
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
import { computed, watch } from 'vue'
import BaseFilterPanel, {
  type FilterPanelItem,
} from '@/components/shared/filter/BaseFilterPanel.vue'
import BaseDataGrid from '@/components/base/BaseDataGrid.vue'
import BaseDataCell from '@/components/base/BaseDataCell.vue'
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
  /* Free-text packet fields wrap instead of being ellipsized at the column edge:
     a path or comment is unreadable truncated to one line. */
  --ba-cell-value-white-space: normal;
  --ba-cell-value-word-break: break-word;
  --ba-cell-align: flex-start;
}
.land-filter-packet {
  display: contents;
  --ba-cell-value-font-weight: 400;
}
</style>
