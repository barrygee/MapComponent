<template>
  <div class="settings-datasource-wrap">
    <div class="settings-datasource-row">
      <span class="settings-datasource-label">SDR</span>
      <select
        v-model="selected"
        class="settings-datasource-input"
        aria-label="ADS-B source SDR"
        :disabled="isLoading"
        @change="onChange"
      >
        <option value="">{{ placeholderText }}</option>
        <option v-for="device in devices" :key="device.value" :value="device.value">
          {{ device.label }}
        </option>
      </select>
    </div>
    <p v-if="hint" class="settings-datasource-hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Picks which Sentry SDR produces the samples behind Off Grid ADS-B.
 *
 * The Off Grid *URL* beside this says where to read decoded aircraft from; this
 * says which dongle produced them. They are separate facts — a decoder can sit
 * anywhere — and until this existed the receiver was anonymous, so Sentinel
 * could neither tune it to 1090 MHz nor stop anything else retuning it. See
 * ADR-0003.
 *
 * Devices come from the Sentry hosts already registered in Settings → SDR, so
 * there is nothing to type: an operator picks the dongle they already named.
 * Saved immediately on change rather than staged with the panel's other
 * settings, because the AIR view acts on it the moment it is set, and a choice
 * that only took effect on some later Save would look broken in between.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getAdsbSource, setAdsbSource } from '@/services/adsbSourceApi'
import { getSentryHostDevices, listSentryHosts, type SentryHost } from '@/services/sentryApi'

interface DeviceOption {
  /** `${hostId}:${deviceId}` — the two ids the backend needs, in one select value. */
  value: string
  label: string
}

const devices = ref<DeviceOption[]>([])
const selected = ref('')
const isLoading = ref(true)
const hostCount = ref(0)
/** True when the *selected* device is no longer offered by its Sentry. */
const withdrawn = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null
/**
 * Set when the control goes away, so the initial load cannot start a timer
 * after it has gone.
 *
 * `onMounted` awaits two requests before scheduling the refresh, and an unmount
 * during that window runs `onBeforeUnmount` *first* — leaving nothing to clear
 * the interval that is about to be created, and a poller running for the life
 * of the page against a control that no longer exists.
 */
let isUnmounted = false

/**
 * How often the list re-reads Sentry's devices.
 *
 * A device's visibility or enabled state can change from Sentry's own console
 * at any moment, and this list is how an operator decides what to point AIR at
 * — a stale one offers a dongle that has since been withdrawn. Sentinel's fleet
 * poller already refreshes its snapshot every couple of seconds, so this only
 * has to re-read that cached view, not reach the Pi.
 */
const REFRESH_INTERVAL_MS = 5000

const placeholderText = computed(() => {
  if (isLoading.value) return 'Loading…'
  if (hostCount.value === 0) return 'No Sentry hosts — add one in SDR settings'
  if (devices.value.length === 0) return 'No devices published by your Sentry hosts'
  return 'Not set'
})

const hint = computed(() => {
  if (withdrawn.value) {
    return 'The selected SDR is no longer public/enabled on its Sentry. AIR cannot claim it until that is changed, or pick another.'
  }
  if (isLoading.value || devices.value.length > 0) return ''
  if (hostCount.value === 0) {
    return 'Add a Sentry host under Settings → SDR first; its SDRs will appear here.'
  }
  // A Sentry only publishes devices its operator marked public, so an empty
  // list is far more often a visibility toggle than a missing dongle.
  return 'Your Sentry hosts are reachable but publish no SDRs. Check each device is enabled.'
})

/** Build the option list from every enabled host's devices. */
async function loadDevices(): Promise<void> {
  withdrawn.value = false
  let hosts: SentryHost[]
  try {
    hosts = await listSentryHosts()
  } catch {
    // Sentinel itself being unreachable is the caller's problem to show; here
    // it just means there is nothing to offer.
    hosts = []
  }
  hostCount.value = hosts.length

  const options: DeviceOption[] = []
  for (const host of hosts) {
    if (!host.enabled) continue
    try {
      const snapshot = await getSentryHostDevices(host.id)
      for (const device of snapshot.status?.sdrs ?? []) {
        // Private and disabled devices are not offered as sources. Both are the
        // operator saying on the Sentry side that this dongle is not for
        // sharing or not in service, and picking one here would claim and tune
        // hardware they have withdrawn.
        //
        // The one already *selected* is kept in the list even when withdrawn,
        // and labelled as such. Dropping it would silently empty the control
        // and leave the operator with no clue which dongle AIR was pointed at.
        const value = `${host.id}:${device.device_id}`
        const isOffered = device.enabled && device.visibility === 'public'
        if (!isOffered && value !== selected.value) continue
        if (!isOffered) withdrawn.value = true
        const hostLabel = host.name || host.address
        options.push({
          value,
          // Names the host as well as the device: two Pis can each have a
          // dongle called "ADSB", and picking the wrong one would tune a
          // receiver in another room.
          label:
            `${hostLabel} — ${device.name || device.device_id}` +
            (isOffered ? '' : ' (no longer published)'),
        })
      }
    } catch {
      /* an unreachable host contributes nothing rather than failing the list */
    }
  }
  devices.value = options
  isLoading.value = false
}

async function loadSelection(): Promise<void> {
  const source = await getAdsbSource()
  if (source?.configured && source.sentry_host_id !== null && source.sentry_device_id) {
    selected.value = `${source.sentry_host_id}:${source.sentry_device_id}`
  }
}

async function onChange(): Promise<void> {
  if (!selected.value) return
  // `device_id` itself contains a colon ("serial:ABC"), so split once only.
  const separator = selected.value.indexOf(':')
  const hostId = Number(selected.value.slice(0, separator))
  const deviceId = selected.value.slice(separator + 1)
  if (!Number.isFinite(hostId) || !deviceId) return
  await setAdsbSource(hostId, deviceId)
}

onMounted(async () => {
  // Selection first: `loadDevices` needs it to know which withdrawn device to
  // keep listed rather than silently dropping the operator's choice.
  await loadSelection()
  await loadDevices()
  isLoading.value = false
  if (isUnmounted) return
  refreshTimer = setInterval(() => {
    void loadDevices()
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
