<template>
  <LabelFieldsTable
    class="sdr-options-table"
    :columns="OPTION_COLUMNS"
    :rows="OPTION_ROWS"
    :is-checked="isOptionEnabled"
    :show-header="false"
    control="switch"
    @toggle="onToggleOption"
  >
    <template #row-control>
      <SdrResumeDelayControl @stage="emit('stage', $event)" @commit="emit('commit')" />
    </template>
  </LabelFieldsTable>
</template>

<script setup lang="ts">
/**
 * Settings control for the SDR panel's on/off options, gathered into one box.
 *
 * Replaces the separate toggle rows (auto-center, snap to known frequencies,
 * band plan, known-frequency labels, waterfall timestamps, decode mute) with a
 * single list built on
 * the domains' "Label Data Points" table — name plus the Settings panel's
 * standard toggle switch, with no column headings and no per-option prose.
 *
 * Each option keeps the lifecycle the individual toggles had: hydrate from the
 * DB on open, mirror into the sdr store immediately so the waterfall/audio
 * previews the change live, and defer the persisted write to APPLY CHANGES via
 * the staged writer.
 */
import { onMounted } from 'vue'
import LabelFieldsTable, { type LabelFieldColumn, type LabelFieldRow } from './LabelFieldsTable.vue'
import SdrResumeDelayControl from './SdrResumeDelayControl.vue'
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
const emit = defineEmits<{
  stage: [fn: () => Promise<unknown> | void]
  commit: []
}>()

const OPTIONS: SdrOption[] = [
  {
    settingKey: 'autoCenterWaterfallOnTune',
    label: 'Auto-center Waterfall on Tune',
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
    label: 'Display Known Frequencies',
    readFromStore: () => sdrStore.showKnownFreqs,
    mirrorToStore: sdrStore.setShowKnownFreqs,
  },
  {
    settingKey: 'showWaterfallTimestamps',
    label: 'Show Waterfall Timestamps',
    readFromStore: () => sdrStore.showWaterfallTimestamps,
    mirrorToStore: sdrStore.setShowWaterfallTimestamps,
  },
  {
    settingKey: 'muteAudioWhileDecoding',
    label: 'Mute Audio While Decoding',
    readFromStore: () => sdrStore.muteAudioWhileDecoding,
    mirrorToStore: sdrStore.setMuteAudioWhileDecoding,
  },
]

const OPTION_COLUMNS: LabelFieldColumn[] = [{ key: 'enabled', label: 'On' }]

// The resume delay rides along as a final row rather than a card of its own:
// it is another thing the SDR panel does while scanning, and a whole card for
// one number sat oddly beside the option list it belongs with. It is not a
// toggle, so it fills its cell through the table's `row-control` slot.
const RESUME_DELAY_ROW: LabelFieldRow = {
  key: 'resumeDelaySec',
  label: 'Scan / Search Resume Delay (Seconds)',
  control: 'custom',
}

const OPTION_ROWS: LabelFieldRow[] = [
  ...OPTIONS.map((option) => ({
    key: option.settingKey,
    label: option.label,
  })),
  RESUME_DELAY_ROW,
]

/**
 * Adopts the backend's stored values for every option on open, so the box
 * reflects what other devices set. One namespace fetch covers them all rather
 * than the separate round trips the individual toggles each made.
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

<style scoped>
/* Wide enough for the resume-delay row's number field; the toggle rows simply
   centre in the same column. */
.sdr-options-table {
  --lft-col-width: 100px;
}

/* Match the SDR Devices rows (`.sdr-device-info` in SettingsPanel.css) so the
   two SDR cards read as one family. The size was already the same 12px Barlow
   500 — what set the option names apart was the label-grid's wider 0.08em
   tracking and slightly lighter ink, both of which are dialled back here. The
   size is restated so this row stays matched if the shared grid's own type
   ever changes for the domains' label tables. The rule lives here rather than
   in LabelFieldsTable because only this card follows the device rows.
   `:deep()` is required: the table renders inside a child component. */
.sdr-options-table :deep(.lft-row-name) {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: rgba(16, 19, 29, 0.85);
}
</style>
