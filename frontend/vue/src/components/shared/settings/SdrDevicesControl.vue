<template>
  <div class="sdr-devices-wrap">
    <div class="sdr-devices-list">
      <div v-if="sentryHosts.length === 0 && manualRadios.length === 0" class="sdr-devices-empty">
        No SDRs configured. Add one below, or register a Sentry host in SENTRY HOSTS above.
      </div>

      <template v-for="group in sentryGroups" :key="'host-' + group.host.id">
        <SdrHostGroupHeader
          :label="group.host.name || group.host.address"
          :reachable="group.snapshot?.reachable ?? null"
          :last-error="group.snapshot?.last_error ?? null"
        />
        <div v-if="group.devices.length === 0" class="sdr-devices-empty">
          No devices detected on this host.
        </div>
        <template
          v-for="entry in group.devices"
          :key="group.host.id + ':' + entry.device.device_id"
        >
          <SdrRadioRow
            v-if="entry.radio"
            :radio="entry.radio"
            :connected="entry.device.present"
            :open="openId === entry.radio.id"
            :confirming="confirmId === entry.radio.id"
            :sentry-device-status="entry.device"
            @toggle-edit="toggleEdit(entry.radio.id)"
            @start-delete="startDelete(entry.radio.id)"
            @confirm-delete="confirmDelete(entry.radio.id)"
            @cancel-delete="confirmId = null"
            @save="onSave"
            @cancel-edit="openId = null"
          />
          <SdrSentryDeviceRow
            v-else
            :device="entry.device"
            :adding="addingDeviceKey === group.host.id + ':' + entry.device.device_id"
            @add="addDeviceAsRadio(group.host, entry.device)"
          />
        </template>
        <!-- Radios whose device this host no longer lists — usually a dongle
             replugged into another socket, which changes its identity. Rendered
             so they can be seen and removed; without this they are invisible
             here yet still fail whenever something connects to them. -->
        <SdrRadioRow
          v-for="radio in group.orphanedRadios"
          :key="'orphan-' + radio.id"
          :radio="radio"
          :connected="false"
          :open="openId === radio.id"
          :confirming="confirmId === radio.id"
          @toggle-edit="toggleEdit(radio.id)"
          @start-delete="startDelete(radio.id)"
          @confirm-delete="confirmDelete(radio.id)"
          @cancel-delete="confirmId = null"
          @save="onSave"
          @cancel-edit="openId = null"
        />
      </template>

      <template v-if="manualRadios.length > 0">
        <div v-if="sentryHosts.length > 0" class="sdr-host-group-header">MANUAL RADIOS</div>
        <SdrRadioRow
          v-for="radio in manualRadios"
          :key="radio.id"
          :radio="radio"
          :connected="manualStatusMap[radio.id] ?? null"
          :open="openId === radio.id"
          :confirming="confirmId === radio.id"
          @toggle-edit="toggleEdit(radio.id)"
          @start-delete="startDelete(radio.id)"
          @confirm-delete="confirmDelete(radio.id)"
          @cancel-delete="confirmId = null"
          @save="onSave"
          @cancel-edit="openId = null"
        />
      </template>

      <div
        v-if="openId === 'new'"
        class="sdr-device-item sdr-device-item--open sdr-device-item--new"
      >
        <SdrDeviceForm :radio="null" @save="onSave" @cancel="openId = null" />
      </div>
    </div>
    <BaseButton variant="ghost" class="sdr-devices-add-btn" @click="toggleNew"
      >+ ADD SDR</BaseButton
    >
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrDevicesControl` — the Settings → SDR → DEVICES editor. Groups
 * configured/available SDR devices by source (ADR-0009):
 * - One group per registered Sentry host, listing every device Sentry
 *   currently reports (`SdrSentryDeviceRow` for one not yet mirrored into
 *   Sentinel's own radio list, `SdrRadioRow` once it has been).
 * - A trailing "MANUAL RADIOS" group for radios entered directly in
 *   Sentinel (`sentry_host_id === null`), unchanged from before this
 *   feature existed.
 *
 * A single 3s poll tick (guarded by `pollInFlight` so a slow tick can never
 * stack) refreshes both a manual radio's TCP reachability and every Sentry
 * host's cached device snapshot, and diffs each host's device-id set against
 * the previous tick to announce arrivals/departures through the
 * notifications store — the live plug/unplug behaviour this component adds
 * on top of the original per-radio-only poll. `sdr:radios-changed` keeps
 * firing on every local mutation (add/edit/delete/mirror), matching the
 * contract other components (e.g. `SdrDeviceSelector`, the SDR panel) already
 * listen for.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import SdrDeviceForm from './SdrDeviceForm.vue'
import SdrRadioRow from './SdrRadioRow.vue'
import SdrSentryDeviceRow from './SdrSentryDeviceRow.vue'
import SdrHostGroupHeader from './SdrHostGroupHeader.vue'
import { useNotificationsStore } from '@/stores/notifications'
import {
  listRadios,
  createRadio,
  deleteRadio,
  getRadioStatus,
  type SdrRadioRecord,
  type SdrRadioInput,
} from '@/services/sdrRadiosApi'
import {
  listSentryHosts,
  getSentryHostDevices,
  type SentryHost,
  type SentryDeviceSnapshot,
  type SentryDeviceStatus,
} from '@/services/sentryApi'
import { RADIOS_CHANGED_EVENT, SENTRY_HOSTS_CHANGED_EVENT } from '@/composables/sdrDeviceEvents'

const notificationsStore = useNotificationsStore()

const radios = ref<SdrRadioRecord[]>([])
const sentryHosts = ref<SentryHost[]>([])
const deviceSnapshots = ref<Record<number, SentryDeviceSnapshot>>({})
const openId = ref<number | 'new' | null>(null)
const confirmId = ref<number | null>(null)
const manualStatusMap = ref<Record<number, boolean | null>>({})
const addingDeviceKey = ref<string | null>(null)

// The present device-id set last seen per host, used only to diff against
// the newest poll and detect arrivals/departures — not rendered. Paired with
// the last-known name per device id so a departure notification can name the
// device instead of showing its raw id.
const previousDeviceIdsByHost = new Map<number, Set<string>>()
const lastKnownDeviceNames = new Map<string, string>()

const manualRadios = computed(() => radios.value.filter((radio) => radio.sentry_host_id == null))

/** One row model per device on a host: the live Sentry status, plus the
 * mirrored Sentinel radio if one has already been created for it (null =
 * not yet added — rendered as `SdrSentryDeviceRow`'s ADD row instead). */
interface SentryDeviceRowModel {
  device: SentryDeviceStatus
  radio: SdrRadioRecord | null
}

interface SentryHostGroup {
  host: SentryHost
  snapshot: SentryDeviceSnapshot | undefined
  devices: SentryDeviceRowModel[]
  /**
   * Radios belonging to this host whose device is no longer in its device list.
   *
   * The list above is built by walking the host's *devices* and finding each
   * one's radio, so a radio whose device has gone has nothing to hang off and
   * would never be rendered at all. That is not a cosmetic gap: it happens
   * whenever a topology-keyed dongle is replugged into a different USB socket —
   * the identity changes, the old one vanishes, and the operator is left with a
   * radio they cannot see, cannot fix and cannot delete, which still fails when
   * something tries to connect to it.
   */
  orphanedRadios: SdrRadioRecord[]
}

const sentryGroups = computed<SentryHostGroup[]>(() =>
  sentryHosts.value.map((host) => {
    const snapshot = deviceSnapshots.value[host.id]
    const devices = snapshot?.status?.sdrs ?? []
    return {
      host,
      snapshot,
      devices: devices.map((device) => ({
        device,
        radio:
          radios.value.find(
            (radio) =>
              radio.sentry_host_id === host.id && radio.sentry_device_id === device.device_id,
          ) ?? null,
      })),
      // Only meaningful once the host has actually answered: with no snapshot
      // every radio would look orphaned, which is the opposite of the truth
      // while a Pi is simply still booting.
      orphanedRadios: snapshot?.status
        ? radios.value.filter(
            (radio) =>
              radio.sentry_host_id === host.id &&
              !devices.some((device) => device.device_id === radio.sentry_device_id),
          )
        : [],
    }
  }),
)

// Guards the 3s poll: a tick fans out one status probe per manual radio plus
// one device-snapshot fetch per Sentry host, each of which waits on a
// backend round trip. Skip a tick while a previous sweep is still in flight
// rather than stacking overlapping requests (same guard as before this
// feature existed, now covering the combined manual+Sentry sweep).
let pollInFlight = false

async function pollManualRadioStatuses(): Promise<void> {
  await Promise.all(
    manualRadios.value.map(async (radio) => {
      const status = await getRadioStatus(radio.id)
      manualStatusMap.value[radio.id] = status?.connected === true
    }),
  )
}

/**
 * Announce devices that plugged in/unplugged on `host` since the previous
 * tick. Tracks only the *present* device-id set — a serial-identified device
 * Sentry keeps configured while unplugged still appears in every snapshot
 * with `present: false`, so membership in the full device list is not itself
 * a plug/unplug signal; only a `present` transition is.
 */
function announceDeviceChanges(host: SentryHost, currentDevices: SentryDeviceStatus[]): void {
  const currentPresentIds = new Set(
    currentDevices.filter((device) => device.present).map((device) => device.device_id),
  )
  const previousPresentIds = previousDeviceIdsByHost.get(host.id)
  // Undefined only on the very first snapshot for this host — nothing to
  // diff against yet, so every currently-present device would otherwise look
  // like a fresh arrival.
  if (previousPresentIds) {
    for (const device of currentDevices) {
      if (device.present && !previousPresentIds.has(device.device_id)) {
        notificationsStore.add({
          type: 'system',
          title: 'SDR device connected',
          detail: `${device.name || device.device_id} on ${host.name || host.address}`,
        })
      }
    }
    for (const previousId of previousPresentIds) {
      if (!currentPresentIds.has(previousId)) {
        const previousName = lastKnownDeviceNames.get(previousId) || previousId
        notificationsStore.add({
          type: 'system',
          title: 'SDR device disconnected',
          detail: `${previousName} on ${host.name || host.address}`,
        })
      }
    }
  }
  for (const device of currentDevices) lastKnownDeviceNames.set(device.device_id, device.name)
  previousDeviceIdsByHost.set(host.id, currentPresentIds)
}

async function pollSentryHostDevices(): Promise<void> {
  await Promise.all(
    sentryHosts.value.map(async (host) => {
      const snapshot = await getSentryHostDevices(host.id)
      deviceSnapshots.value = { ...deviceSnapshots.value, [host.id]: snapshot }
      announceDeviceChanges(host, snapshot.status?.sdrs ?? [])
    }),
  )
}

async function pollAll(): Promise<void> {
  if (pollInFlight) return
  pollInFlight = true
  try {
    await Promise.all([pollManualRadioStatuses(), pollSentryHostDevices()])
  } finally {
    pollInFlight = false
  }
}

async function loadRadios(): Promise<void> {
  radios.value = await listRadios()
}

async function loadSentryHosts(): Promise<void> {
  try {
    sentryHosts.value = await listSentryHosts()
  } catch {
    /* offline / transient — keep the previous list */
  }
}

async function load(): Promise<void> {
  await Promise.all([loadRadios(), loadSentryHosts()])
  await pollAll()
}

function toggleEdit(id: number): void {
  openId.value = openId.value === id ? null : id
  confirmId.value = null
}

function toggleNew(): void {
  openId.value = openId.value === 'new' ? null : 'new'
  confirmId.value = null
}

function startDelete(id: number): void {
  confirmId.value = id
  openId.value = null
}

async function confirmDelete(id: number): Promise<void> {
  const deleted = await deleteRadio(id)
  if (!deleted) return
  confirmId.value = null
  await loadRadios()
  document.dispatchEvent(new CustomEvent(RADIOS_CHANGED_EVENT))
}

async function onSave(): Promise<void> {
  openId.value = null
  await loadRadios()
  document.dispatchEvent(new CustomEvent(RADIOS_CHANGED_EVENT))
}

async function addDeviceAsRadio(host: SentryHost, device: SentryDeviceStatus): Promise<void> {
  if (!device.output) return
  const key = `${host.id}:${device.device_id}`
  addingDeviceKey.value = key
  try {
    const body: SdrRadioInput = {
      name: device.name || device.device_id,
      host: host.address,
      port: device.output.iq_port,
      description: '',
      enabled: device.enabled,
      bandwidth: null,
      rf_gain: null,
      agc: null,
      sentry_host_id: host.id,
      sentry_device_id: device.device_id,
      notes: device.notes,
      antenna: device.antenna,
      visibility: device.visibility,
    }
    const created = await createRadio(body)
    if (created) {
      await loadRadios()
      document.dispatchEvent(new CustomEvent(RADIOS_CHANGED_EVENT))
    }
  } finally {
    if (addingDeviceKey.value === key) addingDeviceKey.value = null
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function onRadiosChanged(): void {
  void loadRadios()
}

function onSentryHostsChanged(): void {
  void loadSentryHosts()
}

onMounted(() => {
  void load()
  pollTimer = setInterval(() => void pollAll(), 3000)
  document.addEventListener(RADIOS_CHANGED_EVENT, onRadiosChanged)
  document.addEventListener(SENTRY_HOSTS_CHANGED_EVENT, onSentryHostsChanged)
})

onBeforeUnmount(() => {
  /* v8 ignore start -- defensive: pollTimer is always assigned in onMounted
     before this teardown runs, so the null guard is never false here */
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  /* v8 ignore stop */
  document.removeEventListener(RADIOS_CHANGED_EVENT, onRadiosChanged)
  document.removeEventListener(SENTRY_HOSTS_CHANGED_EVENT, onSentryHostsChanged)
})
</script>

<style scoped>
.sdr-host-group-header {
  padding: 10px 14px 6px;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.55);
}
</style>
