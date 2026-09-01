<template>
  <div class="settings-datasource-wrap">
    <div class="settings-datasource-row settings-datasource-row--dropdown">
      <span class="settings-datasource-label">SDR</span>
      <SettingsDropdown
        v-model="selectedRadioValue"
        :options="dropdownOptions"
        :placeholder="placeholderText"
        :disabled="isLoading || dropdownOptions.length === 0"
        accessible-name="APRS decode SDR"
      />
    </div>
    <p v-if="hint" class="settings-datasource-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Picks which SDR radio decodes APRS for the LAND domain.
 *
 * The twin of AIR's Off Grid SDR control (`AdsbSdrSourceControl`): LAND has no
 * receiver of its own, so until a radio is named here nothing feeds the APRS
 * station map — which is why the map's APRS layer button stays disabled until
 * this is set (see `LandView`/`LandSideMenu`).
 *
 * Radios come from the list already configured in Settings → SDR, so there is
 * nothing to type. Choosing one starts background APRS decode on it via the
 * store's start/stop endpoints — the same calls the SDR panel's APRS button
 * makes, and the same single backend bridge, so the two can never disagree
 * about which radio is decoding. The choice is *staged* like the panel's other
 * settings and runs on APPLY CHANGES, so the button reports what the operator
 * just did instead of "NO CHANGES".
 *
 * The radio must be tuned to the APRS channel (2 m packet, e.g. 144.800 MHz in
 * Europe / 144.390 MHz in North America) in the SDR view for packets to arrive;
 * this control chooses the receiver, it does not retune it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listRadios, type SdrRadioRecord } from '@/services/sdrRadiosApi'
import SettingsDropdown, { type SettingsDropdownOption } from './SettingsDropdown.vue'
import { useSdrStore } from '@/stores/sdr'

/**
 * How often the list re-reads the configured radios.
 *
 * A radio can be added, disabled or (for a Sentry-mirrored device) become
 * unavailable while this panel is open, and a stale list offers a receiver that
 * can no longer decode anything. Matches the ADS-B source control's cadence.
 */
const REFRESH_INTERVAL_MS = 5000

const sdrStore = useSdrStore()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()
const radios = ref<SettingsDropdownOption[]>([])
const selectedRadioValue = ref('')
const isLoading = ref(true)
const radioCount = ref(0)
/** True when the *selected* radio is no longer available to decode. */
const withdrawn = ref(false)
/**
 * True while the control writes the persisted choice into the dropdown, so the
 * model watcher can tell hydration apart from an operator's pick and not stage
 * a "change" that only restated what the backend already had.
 */
let isHydrating = false
let refreshTimer: ReturnType<typeof setInterval> | null = null
/**
 * Set when the control goes away, so the initial load cannot start a timer
 * after it has gone — `onMounted` awaits its requests first, and an unmount in
 * that window runs `onBeforeUnmount` before the interval exists to be cleared.
 */
let isUnmounted = false

/**
 * What the dropdown offers: the radios, plus an explicit "off" row once one is
 * chosen — the custom dropdown has no empty entry of its own, and without a way
 * back the operator could switch receivers but never stop decoding.
 */
const dropdownOptions = computed<SettingsDropdownOption[]>(() =>
  selectedRadioValue.value
    ? [{ value: '', label: 'Not set — APRS decode off' }, ...radios.value]
    : radios.value,
)

const placeholderText = computed(() => {
  if (isLoading.value) return 'Loading…'
  if (radioCount.value === 0) return 'No radios — add one in SDR settings'
  if (radios.value.length === 0) return 'No enabled radios available'
  return 'Not set — APRS decode off'
})

const hint = computed(() => {
  if (withdrawn.value) {
    return 'The selected radio is no longer available. APRS decode cannot run until that is fixed, or pick another.'
  }
  if (isLoading.value || radios.value.length > 0) return ''
  if (radioCount.value === 0) {
    return 'Add a radio under Settings → SDR first; it will appear here.'
  }
  return 'Your radios are all disabled or unavailable. Enable one under Settings → SDR.'
})

/** Whether a radio can be offered as the APRS receiver. */
function isOffered(radio: SdrRadioRecord): boolean {
  return radio.enabled && radio.device_available !== false
}

/** Build the option list from the configured radios. */
async function loadRadios(): Promise<void> {
  withdrawn.value = false
  let records: SdrRadioRecord[]
  try {
    records = await listRadios()
  } catch {
    // Sentinel itself being unreachable is the caller's problem to show; here
    // it just means there is nothing to offer.
    records = []
  }
  radioCount.value = records.length

  const options: SettingsDropdownOption[] = []
  for (const radio of records) {
    const value = String(radio.id)
    const offered = isOffered(radio)
    // A disabled or unavailable radio is not offered — picking one would only
    // fail at the point of starting decode. The one already *selected* stays
    // listed even so, and is labelled: dropping it would silently empty the
    // control and leave no clue which radio LAND was decoding.
    if (!offered && value !== selectedRadioValue.value) continue
    if (!offered) withdrawn.value = true
    options.push({
      value,
      label: `${radio.name || `Radio ${radio.id}`}${offered ? '' : ' (unavailable)'}`,
    })
  }
  radios.value = options
}

/** Mirror the backend's persisted APRS radio into the dropdown. */
function readSelection(): void {
  const radioId = sdrStore.aprsRadioId
  isHydrating = true
  selectedRadioValue.value = radioId === null ? '' : String(radioId)
  isHydrating = false
}

/**
 * Stage the chosen receiver. Runs on APPLY CHANGES, which reloads the panel —
 * so the store's flags are set here as well, keeping the SDR panel's APRS
 * button honest in the moment between the call landing and the reload.
 *
 * Throws on a refusal so the panel reports ERROR rather than SAVED: a radio
 * that could not be started is not a saved setting.
 */
function stageSelection(nextValue: string): void {
  emit('stage', async () => {
    const previousRadioId = sdrStore.aprsRadioId
    if (!nextValue) {
      // Clearing the choice stops decode. Nothing to stop if it was never set.
      if (previousRadioId === null) return
      const stopped = await sdrStore.stopAprs(previousRadioId)
      sdrStore.setAprsEnabled(false)
      if (!stopped) throw new Error('APRS decode could not be stopped')
      return
    }
    const radioId = Number(nextValue)
    // The backend runs a single APRS bridge, so starting on another radio hands
    // decode over rather than running two — no explicit stop of the old one.
    const started = await sdrStore.startAprs(radioId)
    if (!started) throw new Error('APRS decode could not be started')
    sdrStore.setAprsEnabled(true)
  })
}

// Watched rather than handled on a change event: the dropdown is a listbox, so
// its model is the only signal that the operator picked something.
watch(
  selectedRadioValue,
  (nextValue) => {
    if (isHydrating) return
    stageSelection(nextValue)
    // Re-read the list so a newly chosen radio that has since been withdrawn is
    // labelled, and the "off" row appears/disappears with the choice.
    void loadRadios()
  },
  // Synchronous so the `isHydrating` flag still stands when the watcher runs:
  // the default pre-flush would fire after hydration had already cleared it,
  // and the restored choice would be treated as an operator's pick.
  { flush: 'sync' },
)

onMounted(async () => {
  // The backend resumes the persisted APRS radio on startup, so the database —
  // not the store's localStorage cache — is the truth about what is decoding.
  await sdrStore.hydrateAprsFromDb()
  readSelection()
  // Selection first: `loadRadios` needs it to know which unavailable radio to
  // keep listed rather than silently dropping the operator's choice.
  await loadRadios()
  isLoading.value = false
  if (isUnmounted) return
  refreshTimer = setInterval(() => {
    void loadRadios()
  }, REFRESH_INTERVAL_MS)
})

onBeforeUnmount(() => {
  isUnmounted = true
  if (refreshTimer !== null) clearInterval(refreshTimer)
})
</script>

<style scoped>
.settings-datasource-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
  opacity: 0.7;
}
</style>
