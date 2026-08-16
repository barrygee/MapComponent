<template>
  <div class="settings-location-wrap">
    <p class="settings-location-status">{{ statusText }}</p>

    <p v-if="pairError" class="settings-location-notice" role="alert">{{ pairError }}</p>

    <div class="settings-location-field">
      <label class="settings-location-label" :for="latitudeInputId">LAT</label>
      <input
        :id="latitudeInputId"
        v-model="latitudeDraft"
        type="text"
        inputmode="decimal"
        class="settings-location-input"
        :class="{ 'settings-location-input--invalid': latitudeError !== null }"
        :aria-invalid="latitudeError !== null"
        :aria-describedby="latitudeError !== null ? latitudeErrorId : latitudeHintId"
        placeholder="0.000"
        spellcheck="false"
        @input="onLatitudeInput"
        @blur="onLatitudeBlur"
        @keydown.enter="save"
      />
      <p v-if="latitudeError !== null" :id="latitudeErrorId" class="settings-location-error">
        {{ latitudeError }}
      </p>
      <p v-else :id="latitudeHintId" class="settings-location-hint">{{ LATITUDE_HINT }}</p>
    </div>

    <div class="settings-location-field">
      <label class="settings-location-label" :for="longitudeInputId">LON</label>
      <input
        :id="longitudeInputId"
        v-model="longitudeDraft"
        type="text"
        inputmode="decimal"
        class="settings-location-input"
        :class="{ 'settings-location-input--invalid': longitudeError !== null }"
        :aria-invalid="longitudeError !== null"
        :aria-describedby="longitudeError !== null ? longitudeErrorId : longitudeHintId"
        placeholder="0.000"
        spellcheck="false"
        @input="onLongitudeInput"
        @blur="onLongitudeBlur"
        @keydown.enter="save"
      />
      <p v-if="longitudeError !== null" :id="longitudeErrorId" class="settings-location-error">
        {{ longitudeError }}
      </p>
      <p v-else :id="longitudeHintId" class="settings-location-hint">{{ LONGITUDE_HINT }}</p>
    </div>

    <div class="settings-location-actions">
      <BaseButton variant="primary" :disabled="saving" @click="save">
        {{ saving ? 'SAVING…' : 'SAVE LOCATION' }}
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Settings > My Location — a fixed latitude/longitude for your own position.
 *
 * Mirrors Sentry's Sentry Location panel: a "last set" line, stacked labelled
 * fields with a decimal-degrees hint apiece, per-field validation on blur, and
 * its own SAVE LOCATION button. Unlike every other control in this panel it
 * does not stage into APPLY CHANGES — the coordinates are applied the moment
 * they are saved, which is also what moves the marker on the maps.
 */
import { ref, computed, onMounted, onUnmounted, useId } from 'vue'
import * as settingsApi from '@/services/settingsApi'
import { isValidLatLon } from '@/utils/locationUtils'
import {
  parseCoordinate,
  validateCoordinatePair,
  validateLatitude,
  validateLongitude,
} from '@/utils/locationValidation'
import BaseButton from '@/components/base/BaseButton.vue'

// Held once rather than repeated in the template and in the aria wiring: the
// hint and the range it describes must stay in step with locationValidation.
const LATITUDE_HINT = 'Decimal degrees, -90 to 90.'
const LONGITUDE_HINT = 'Decimal degrees, -180 to 180.'

const STORAGE_KEY = 'sentinel_user_location'

const latitudeInputId = useId()
const longitudeInputId = useId()
const latitudeHintId = useId()
const longitudeHintId = useId()
const latitudeErrorId = useId()
const longitudeErrorId = useId()

// Empty string means "field cleared", which is meaningful here — clearing both
// is how you remove the fixed position and hand the map back to browser
// geolocation — so drafts are held as raw text and only parsed on save.
const latitudeDraft = ref('')
const longitudeDraft = ref('')
const latitudeError = ref<string | null>(null)
const longitudeError = ref<string | null>(null)
const pairError = ref<string | null>(null)
const saving = ref(false)
// Set once a field is touched, cleared on save. Typing no longer takes a manual
// override on the composable (that now happens at save time), so without this a
// GPS tick — which dispatches settings:locationSynced every few seconds — would
// overwrite half-typed coordinates.
const hasUnsavedEdits = ref(false)
// When the stored position was last written. Sourced from localStorage rather
// than the config: the backend normalises app.location down to lat/lon and
// keeps no timestamp, and the stored copy is refreshed by every set — typed,
// right-clicked on the map, or a GPS fix.
const lastSetMs = ref<number | null>(null)

const statusText = computed(() =>
  lastSetMs.value !== null && latitudeDraft.value !== '' && longitudeDraft.value !== ''
    ? `Last set ${new Date(lastSetMs.value).toLocaleString()}.`
    : 'No position set — using browser geolocation, if it is available.',
)

interface StoredLocation {
  latitude?: number
  longitude?: number
  lat?: number
  lon?: number
  ts?: number
}

function readStoredLocation(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredLocation) : null
  } catch {
    return null
  }
}

const stored = readStoredLocation()
if (stored) {
  const storedLatitude = stored.latitude ?? stored.lat
  const storedLongitude = stored.longitude ?? stored.lon
  if (storedLatitude != null) latitudeDraft.value = storedLatitude.toFixed(5)
  if (storedLongitude != null) longitudeDraft.value = storedLongitude.toFixed(5)
  lastSetMs.value = stored.ts ?? null
}

onMounted(async () => {
  // Show whatever the config currently holds. Reconciling the marker /
  // manual-override state with the config is owned by hydrateFromConfig() in
  // App.vue, so this only prefills the fields (and only with a valid pair —
  // the "" unset form must leave them blank so it doesn't render as NaN or
  // re-pin a cleared location).
  const data = await settingsApi.getNamespace('app')
  const location = data?.location as { latitude?: unknown; longitude?: unknown } | undefined
  if (!location) return
  const configLatitude = parseFloat(String(location.latitude))
  const configLongitude = parseFloat(String(location.longitude))
  if (isValidLatLon(configLatitude, configLongitude)) {
    if (!latitudeDraft.value) latitudeDraft.value = configLatitude.toFixed(5)
    if (!longitudeDraft.value) longitudeDraft.value = configLongitude.toFixed(5)
  } else {
    // Config explicitly cleared — clear the fields too so the panel reflects
    // the unset state rather than a stale localStorage value.
    latitudeDraft.value = ''
    longitudeDraft.value = ''
    lastSetMs.value = null
  }
})

// Errors clear as you type rather than re-validating on every keystroke:
// correcting a rejected value should not keep shouting the old complaint while
// the replacement is half typed.
function onLatitudeInput(): void {
  hasUnsavedEdits.value = true
  latitudeError.value = null
  pairError.value = null
}

function onLongitudeInput(): void {
  hasUnsavedEdits.value = true
  longitudeError.value = null
  pairError.value = null
}

function onLatitudeBlur(): void {
  latitudeError.value = validateLatitude(parseCoordinate(latitudeDraft.value))
}

function onLongitudeBlur(): void {
  longitudeError.value = validateLongitude(parseCoordinate(longitudeDraft.value))
}

// True only while dispatching our own set, so the resulting
// settings:locationSynced echo doesn't reformat a field mid-edit (e.g. "54.9" →
// "54.90000" with a cursor jump). The event chain is synchronous, so the flag is
// reliably set across the round trip.
let selfSetting = false

/** Validate both fields, then persist. Nothing is sent while either is invalid. */
async function save(): Promise<void> {
  if (saving.value) return

  const latitude = parseCoordinate(latitudeDraft.value)
  const longitude = parseCoordinate(longitudeDraft.value)

  latitudeError.value = validateLatitude(latitude)
  longitudeError.value = validateLongitude(longitude)
  pairError.value =
    latitudeError.value === null && longitudeError.value === null
      ? validateCoordinatePair(latitude, longitude)
      : null

  if (latitudeError.value !== null || longitudeError.value !== null || pairError.value !== null) {
    // Return focus to the field that was rejected — otherwise a screen-reader
    // user is told something is wrong without being taken to it.
    const targetId =
      latitudeError.value !== null || (pairError.value !== null && latitude === null)
        ? latitudeInputId
        : longitudeInputId
    document.getElementById(targetId)?.focus()
    return
  }

  saving.value = true
  try {
    if (latitude === null && longitude === null) {
      // The one authoritative clear signal: useUserLocation's listener wipes
      // stored/in-memory state and the maps drop the marker + overlays.
      window.dispatchEvent(new CustomEvent('sentinel:userLocationCleared'))
      lastSetMs.value = null
      hasUnsavedEdits.value = false
      await settingsApi.put('app', 'location', { latitude: '', longitude: '' })
      return
    }

    // persist: false — this control writes the config itself below, so the
    // composable's own PUT would only duplicate it. The event is still what
    // moves the marker and refreshes any other listening field.
    selfSetting = true
    try {
      window.dispatchEvent(
        new CustomEvent('sentinel:setUserLocation', {
          detail: { longitude, latitude, persist: false },
        }),
      )
    } finally {
      selfSetting = false
    }
    lastSetMs.value = readStoredLocation()?.ts ?? Date.now()
    hasUnsavedEdits.value = false
    await settingsApi.put('app', 'location', { latitude, longitude })
  } finally {
    saving.value = false
  }
}

function onLocationSynced(event: Event): void {
  // Ignore the echo of our own saved value, and anything arriving (a GPS tick,
  // a right-click set on the map) while there are unsaved edits in the fields.
  if (selfSetting || hasUnsavedEdits.value) return
  const { longitude, latitude } = (event as CustomEvent).detail as {
    longitude: number
    latitude: number
  }
  latitudeDraft.value = latitude.toFixed(5)
  longitudeDraft.value = longitude.toFixed(5)
  latitudeError.value = null
  longitudeError.value = null
  pairError.value = null
  lastSetMs.value = readStoredLocation()?.ts ?? Date.now()
}

window.addEventListener('settings:locationSynced', onLocationSynced)
onUnmounted(() => window.removeEventListener('settings:locationSynced', onLocationSynced))
</script>
