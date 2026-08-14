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
import { computed, onMounted, ref } from 'vue'
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

const placeholderText = computed(() => {
  if (isLoading.value) return 'Loading…'
  if (hostCount.value === 0) return 'No Sentry hosts — add one in SDR settings'
  if (devices.value.length === 0) return 'No devices published by your Sentry hosts'
  return 'Not set'
})

const hint = computed(() => {
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
  isLoading.value = true
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
        const hostLabel = host.name || host.address
        options.push({
          value: `${host.id}:${device.device_id}`,
          // Names the host as well as the device: two Pis can each have a
          // dongle called "ADSB", and picking the wrong one would tune a
          // receiver in another room.
          label: `${hostLabel} — ${device.name || device.device_id}`,
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
  await Promise.all([loadDevices(), loadSelection()])
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
