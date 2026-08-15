<template>
  <LabelFieldsTable
    :columns="OPTION_COLUMNS"
    :rows="OPTION_ROWS"
    :is-checked="isOptionEnabled"
    field-header="Option"
    @toggle="onToggleOption"
  />
</template>

<script setup lang="ts">
/**
 * Settings control for the SDR panel's on/off options, gathered into one box.
 *
 * Replaces five separate toggle rows (auto-center, snap to known frequencies,
 * band plan, known-frequency labels, decode mute) with a single checkbox list
 * in the same style as the domains' "Label Data Points" tables — name plus
 * checkbox, no per-option prose.
 *
 * Each option keeps the lifecycle the individual toggles had: hydrate from the
 * DB on open, mirror into the sdr store immediately so the waterfall/audio
 * previews the change live, and defer the persisted write to APPLY CHANGES via
 * the staged writer.
 */
import { onMounted } from 'vue'
import LabelFieldsTable, { type LabelFieldColumn, type LabelFieldRow } from './LabelFieldsTable.vue'
import { useSdrStore } from '@/stores/sdr'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import * as settingsApi from '@/services/settingsApi'

/** One SDR option: where it persists, and how it reads/writes the sdr store. */
interface SdrOption {
  /** Key within the `sdr` settings namespace. */
  settingKey: string
  /** Row label shown in the table. */
  label: string
  readFromStore: () => boolean
  mirrorToStore: (enabled: boolean) => void
}

const sdrStore = useSdrStore()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()

const OPTIONS: SdrOption[] = [
  {
    settingKey: 'autoCenterWaterfallOnTune',
    label: 'Auto-center on Tune',
    readFromStore: () => sdrStore.autoCenterWaterfallOnTune,
    mirrorToStore: sdrStore.setAutoCenterWaterfallOnTune,
  },
  {
    settingKey: 'snapToKnown',
    label: 'Snap to Known Frequencies',
    readFromStore: () => sdrStore.snapToKnown,
    mirrorToStore: sdrStore.setSnapToKnown,
  },
  {
    settingKey: 'showBandPlan',
    label: 'Show Band Plan',
    readFromStore: () => sdrStore.showBandPlan,
    mirrorToStore: sdrStore.setShowBandPlan,
  },
  {
    settingKey: 'showKnownFreqs',
    label: 'Show Known Frequencies',
    readFromStore: () => sdrStore.showKnownFreqs,
    mirrorToStore: sdrStore.setShowKnownFreqs,
  },
  {
    settingKey: 'muteAudioWhileDecoding',
    label: 'Mute Audio While Decoding',
    readFromStore: () => sdrStore.muteAudioWhileDecoding,
    mirrorToStore: sdrStore.setMuteAudioWhileDecoding,
  },
]

const OPTION_COLUMNS: LabelFieldColumn[] = [{ key: 'enabled', label: 'On' }]

const OPTION_ROWS: LabelFieldRow[] = OPTIONS.map((option) => ({
  key: option.settingKey,
  label: option.label,
}))

/**
 * Adopts the backend's stored values for every option on open, so the box
 * reflects what other devices set. One namespace fetch covers all five rather
 * than the five separate round trips the individual toggles each made.
 */
async function hydrateOptionsFromDb(): Promise<void> {
  const persisted = await settingsApi.getNamespace('sdr')
  if (!persisted) return
  OPTIONS.forEach((option) => {
    const persistedValue = persisted[option.settingKey]
    if (typeof persistedValue === 'boolean' && persistedValue !== option.readFromStore()) {
      option.mirrorToStore(persistedValue)
    }
  })
}

onMounted(() => {
  void hydrateOptionsFromDb()
})

// Keeps the box in sync when the config JSON editor uploads a new config.
useDocumentEvent('sentinel:config-uploaded', hydrateOptionsFromDb)

// The table's rows are built from OPTIONS, so every key it hands back is one
// of these — the lookup never misses.
const OPTIONS_BY_KEY = new Map(OPTIONS.map((option) => [option.settingKey, option]))

function findOption(settingKey: string): SdrOption {
  return OPTIONS_BY_KEY.get(settingKey) as SdrOption
}

function isOptionEnabled(_column: string, settingKey: string): boolean {
  return findOption(settingKey).readFromStore()
}

function onToggleOption(_column: string, settingKey: string): void {
  const option = findOption(settingKey)
  const nextValue = !option.readFromStore()
  option.mirrorToStore(nextValue)
  emit('stage', () => settingsApi.put('sdr', option.settingKey, nextValue))
}
</script>
