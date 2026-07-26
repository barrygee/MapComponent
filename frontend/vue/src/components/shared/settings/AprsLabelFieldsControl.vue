<template>
  <LabelFieldsTable :columns="COLUMNS" :rows="ROWS" :is-checked="isChecked" @toggle="onToggle" />
</template>

<script setup lang="ts">
/**
 * Settings control for which data fields appear on APRS station map labels.
 *
 * The Land counterpart of AdsbTagFieldsControl: same shared table, but a single
 * column (APRS has no civil/military split). The live map picks changes up by
 * watching the store, so no DOM event bridge is needed.
 */
import { ref, onMounted } from 'vue'
import LabelFieldsTable, { type LabelFieldColumn, type LabelFieldRow } from './LabelFieldsTable.vue'
import { useLandStore, type AprsLabelFieldMap } from '@/stores/land'
import * as settingsApi from '@/services/settingsApi'

const landStore = useLandStore()
const emit = defineEmits<{ stage: [fn: () => void] }>()

const fields = ref<AprsLabelFieldMap>({ ...landStore.aprsLabelFields })

const COLUMNS: LabelFieldColumn[] = [{ key: 'show', label: 'Show' }]

const ROWS: LabelFieldRow[] = [
  { key: 'time', abbr: 'TIME', label: 'Time' },
  { key: 'callsign', abbr: 'CSS', label: 'Callsign' },
  { key: 'symbol', abbr: 'SYM', label: 'Symbol' },
  { key: 'symbolText', abbr: 'SYMT', label: 'Symbol Text' },
  { key: 'latitude', abbr: 'LAT', label: 'Latitude' },
  { key: 'longitude', abbr: 'LON', label: 'Longitude' },
  { key: 'course', abbr: 'CRS', label: 'Course' },
  { key: 'speed', abbr: 'SPD', label: 'Speed' },
  { key: 'altitude', abbr: 'ALT', label: 'Altitude' },
  { key: 'path', abbr: 'PATH', label: 'Path' },
  { key: 'comment', abbr: 'CMT', label: 'Comment' },
]

// Adopt the backend's stored choice on open, so the panel reflects what other
// devices set rather than this browser's last local edit.
onMounted(async () => {
  const data = await settingsApi.getNamespace('land')
  const remote = data?.labelDataPoints as Partial<AprsLabelFieldMap> | undefined
  if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
    fields.value = { ...landStore.aprsLabelFields, ...remote }
    landStore.setAprsLabelFields({ ...fields.value })
  }
})

function isChecked(_column: string, key: string): boolean {
  return fields.value[key as keyof AprsLabelFieldMap]
}

function onToggle(_column: string, key: string): void {
  const field = key as keyof AprsLabelFieldMap
  fields.value = { ...fields.value, [field]: !fields.value[field] }
  landStore.setAprsLabelFields({ ...fields.value })
  emit('stage', () => {
    settingsApi.put('land', 'labelDataPoints', { ...fields.value })
  })
}
</script>
