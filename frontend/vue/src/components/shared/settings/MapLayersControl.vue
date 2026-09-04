<template>
  <LabelFieldsTable
    :columns="COLUMNS"
    :rows="LAYER_ROWS"
    :is-checked="isLayerOn"
    :show-header="false"
    control="switch"
    field-header="Layer"
    @toggle="(_columnKey, rowKey) => toggleLayer(rowKey as MapLayerKey)"
  />
</template>

<script setup lang="ts">
/**
 * Settings > Map Layers — every map overlay as an on/off switch, in one table.
 *
 * The map rails keep the handful of overlays an operator flips mid-task (range
 * rings, A2A refuelling, AWACS); the rest are set here and left alone. Both
 * surfaces are views of the same persisted state, so a rail toggle shows up in
 * this table and a switch here moves the layer on the map — there is one value,
 * not two that have to be kept in step.
 *
 * `names` lives on the shared basemap store because it describes the base map
 * every domain draws; the rest are Air overlays.
 */
import { useAirStore, type OverlayStates } from '@/stores/air'
import { useBasemapStore } from '@/stores/basemap'
import LabelFieldsTable, { type LabelFieldRow } from './LabelFieldsTable.vue'

/** An Air overlay flag, or the shared base-map place-name layer. */
type MapLayerKey = keyof OverlayStates | 'names'

// One unlabelled column: every row is a plain on/off, so a heading would say
// nothing the switch does not.
const COLUMNS = [{ key: 'on', label: 'Show' }]

const LAYER_ROWS: LabelFieldRow[] = [
  { key: 'rangeRings', label: 'Range rings' },
  { key: 'aara', label: 'A2A refuelling' },
  { key: 'awacs', label: 'AWACS' },
  { key: 'groundVehicles', label: 'Ground vehicles' },
  { key: 'towers', label: 'Towers' },
  { key: 'names', label: 'Location names' },
  { key: 'airports', label: 'Airports' },
  { key: 'militaryBases', label: 'Military bases' },
]

const airStore = useAirStore()
const basemapStore = useBasemapStore()

function isLayerOn(_columnKey: string, layer: string): boolean {
  const key = layer as MapLayerKey
  if (key === 'names') return basemapStore.layers.names
  return airStore.overlayStates[key]
}

function toggleLayer(layer: MapLayerKey): void {
  if (layer === 'names') {
    basemapStore.setLayer('names', !basemapStore.layers.names)
    return
  }
  airStore.setOverlay(layer, !airStore.overlayStates[layer])
}
</script>
