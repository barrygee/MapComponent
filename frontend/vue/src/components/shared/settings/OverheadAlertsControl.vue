<template>
  <div class="overhead-alerts">
    <p v-if="locations.length === 0" class="overhead-alerts-empty">
      No location to watch yet — set your location, or register a Sentry host.
    </p>

    <div
      v-for="location in locations"
      :key="location.id"
      class="overhead-alerts-location"
      :class="{ 'overhead-alerts-location--user': location.isUser }"
    >
      <p class="overhead-alerts-heading">
        <span class="overhead-alerts-name">
          {{ location.isUser ? 'Sentinel location' : `Sentry: ${location.label}` }}
        </span>
        <span class="overhead-alerts-coords">
          ({{ formatLatitude(location.lat) }} {{ formatLongitude(location.lon) }})
        </span>
      </p>

      <div class="overhead-alerts-controls">
        <span class="overhead-alerts-toggle">
          <span class="overhead-alerts-toggle-label">Civil</span>
          <BaseToggleSwitch
            :model-value="location.civil"
            :accessible-name="`Civil aircraft alerts for ${alertLocationName(location)}`"
            @update:model-value="setFlag(location.id, 'civil', $event)"
          />
        </span>
        <span class="overhead-alerts-toggle">
          <span class="overhead-alerts-toggle-label">Military</span>
          <BaseToggleSwitch
            :model-value="location.mil"
            :accessible-name="`Military aircraft alerts for ${alertLocationName(location)}`"
            @update:model-value="setFlag(location.id, 'mil', $event)"
          />
        </span>
        <label class="overhead-alerts-radius">
          <span class="overhead-alerts-radius-label">Radius</span>
          <input
            class="overhead-alerts-radius-input"
            type="text"
            inputmode="numeric"
            spellcheck="false"
            :value="radiusDraft(location)"
            :aria-label="`Alert radius for ${alertLocationName(location)}, nautical miles`"
            @input="onRadiusInput(location.id, $event)"
            @blur="onRadiusBlur(location.id)"
          />
          <span class="overhead-alerts-radius-unit">NM</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Settings > AIR > Overhead Aircraft Alerts — one row per place that can have
 * something overhead it.
 *
 * Replaces the single app-wide toggle pair and radius: a Sentry watches its own
 * patch of sky, so which aircraft count and how far out are questions per
 * receiver. The operator's own position leads the list; each Sentry follows.
 *
 * The radius is held as typed text while it is being edited — clearing the field
 * to retype it would otherwise be read as "0" and rejected mid-keystroke — and
 * committed on blur.
 *
 * Follows the panel's "mirror now, stage the write for APPLY" lifecycle: a
 * change reaches the store at once, so the map draws its zone immediately, and
 * the config-database write is staged so APPLY CHANGES reports what it did
 * rather than "NO CHANGES".
 */
import { onMounted, ref } from 'vue'
import { useAirStore, USER_ALERT_LOCATION_ID, type OverheadAlertConfig } from '@/stores/air'
import * as settingsApi from '@/services/settingsApi'
import {
  useOverheadAlertZones,
  type OverheadAlertLocation,
} from '@/composables/useOverheadAlertZones'
import { formatLatitude, formatLongitude } from '@/utils/locationUtils'
import BaseToggleSwitch from '@/components/base/BaseToggleSwitch.vue'

const airStore = useAirStore()
const { locations } = useOverheadAlertZones()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()

/**
 * Read the stored settings, accepting the pre-split single configuration the
 * config database may still hold (`{civil, mil, radiusNm}`) and mapping it onto
 * the operator's own location.
 */
function readStoredAlerts(
  data: Record<string, unknown> | null,
): Record<string, OverheadAlertConfig> | null {
  const stored = data?.overheadAlerts
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const record = stored as Record<string, unknown>
  if (typeof record.civil === 'boolean' || typeof record.mil === 'boolean') {
    return {
      [USER_ALERT_LOCATION_ID]: {
        civil: record.civil === true,
        mil: record.mil === true,
        radiusNm: typeof record.radiusNm === 'number' ? record.radiusNm : 10,
      },
    }
  }
  return record as Record<string, OverheadAlertConfig>
}

onMounted(async () => {
  const stored = readStoredAlerts(await settingsApi.getNamespace('air'))
  if (stored) airStore.hydrateOverheadAlerts(stored)
})

/** Queue the config-database write for APPLY CHANGES. */
function stageWrite(): void {
  emit('stage', () => settingsApi.put('air', 'overheadAlerts', airStore.overheadAlerts))
}

/** In-flight radius text, keyed by location id; absent once committed. */
const radiusDrafts = ref<Record<string, string>>({})

/** How the row is named in an accessible label. */
function alertLocationName(location: OverheadAlertLocation): string {
  return location.isUser ? 'your location' : location.label
}

function radiusDraft(location: OverheadAlertLocation): string {
  return radiusDrafts.value[location.id] ?? String(location.radiusNm)
}

function setFlag(locationId: string, flag: 'civil' | 'mil', value: boolean): void {
  airStore.setOverheadAlert(locationId, { [flag]: value })
  stageWrite()
}

function onRadiusInput(locationId: string, event: Event): void {
  radiusDrafts.value = {
    ...radiusDrafts.value,
    [locationId]: (event.target as HTMLInputElement).value,
  }
}

/** Commit a typed radius, or fall back to the stored one if it is not a number. */
function onRadiusBlur(locationId: string): void {
  const draft = radiusDrafts.value[locationId]
  if (draft !== undefined) {
    const parsed = Number(draft.trim())
    // setOverheadAlert rejects a non-positive radius, so a nonsense entry simply
    // leaves the stored value in place — and dropping the draft shows it again.
    if (Number.isFinite(parsed)) {
      airStore.setOverheadAlert(locationId, { radiusNm: parsed })
      stageWrite()
    }
  }
  const next = { ...radiusDrafts.value }
  delete next[locationId]
  radiusDrafts.value = next
}
</script>

<style scoped>
.overhead-alerts {
  display: flex;
  flex-direction: column;
  gap: 32px;
  /* Set the first location apart from the section's description, so the list
     reads as the setting rather than as a continuation of the sentence. */
  padding-top: 16px;
}

.overhead-alerts-empty {
  margin: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 12.5px;
  color: rgba(16, 19, 29, 0.5);
}

.overhead-alerts-location {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 4px;
}

/* Name and coordinates on one line: the coordinates say *which* place this is,
   so they belong beside the name rather than under it. */
.overhead-alerts-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 0;
}

.overhead-alerts-name {
  margin: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.92);
}

.overhead-alerts-coords {
  margin: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  color: rgba(16, 19, 29, 0.5);
  font-variant-numeric: tabular-nums;
}

.overhead-alerts-controls {
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
  padding-top: 12px;
}

.overhead-alerts-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overhead-alerts-toggle-label {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: rgba(16, 19, 29, 0.55);
  text-transform: uppercase;
  user-select: none;
}

.overhead-alerts-radius {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.overhead-alerts-radius-label {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: rgba(16, 19, 29, 0.55);
  text-transform: uppercase;
  user-select: none;
}

/* Sized to a two- or three-digit distance, and underlined like every other
   typed value in this panel (SettingsPanel.css `.settings-location-input`). */
.overhead-alerts-radius-input {
  width: 56px;
  background: none;
  border: none;
  border-radius: 0;
  padding: 4px 0 6px;
  color: rgba(16, 19, 29, 0.92);
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--settings-field-line, rgba(16, 19, 29, 0.12));
  transition: box-shadow 0.15s;
  outline: none;
  caret-color: #16191d;
}
.overhead-alerts-radius-input:focus {
  box-shadow: inset 0 -2px 0 var(--color-accent);
}

.overhead-alerts-radius-unit {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  color: rgba(16, 19, 29, 0.5);
}
</style>
