<template>
  <div class="sdr-devices-wrap">
    <div class="sdr-devices-list">
      <div v-if="hosts.length === 0" class="sdr-devices-empty">
        No Sentry hosts registered. Add one below.
      </div>
      <div
        v-for="sentryHost in hosts"
        :key="sentryHost.id"
        class="sdr-device-item"
        :class="{ 'sdr-device-item--open': openId === sentryHost.id }"
      >
        <div class="sdr-device-row">
          <span class="sdr-device-info" :style="confirmId === sentryHost.id ? 'opacity:0.4' : ''">
            <SdrSourceStatusDot :connected="sentryHost.reachable" />
            {{ sentryHost.name || sentryHost.address }}&nbsp;&nbsp;{{ sentryHost.address }}:{{
              sentryHost.port
            }}
            <span v-if="sentryHost.last_error" class="sentry-host-error">
              — {{ sentryHost.last_error }}
            </span>
          </span>
          <button
            v-if="confirmId !== sentryHost.id"
            class="sdr-device-btn"
            :class="{ 'sdr-device-btn--active': openId === sentryHost.id }"
            title="Edit"
            aria-label="Edit Sentry host"
            @click="toggleEdit(sentryHost.id)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M9.5 1.5L11.5 3.5L4.5 10.5H2.5V8.5L9.5 1.5Z"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            v-if="confirmId !== sentryHost.id"
            class="sdr-device-btn sdr-device-btn--danger"
            title="Delete"
            aria-label="Delete Sentry host"
            @click="startDelete(sentryHost.id)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <line
                x1="2.5"
                y1="2.5"
                x2="10.5"
                y2="10.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
              <line
                x1="10.5"
                y1="2.5"
                x2="2.5"
                y2="10.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <div v-if="confirmId === sentryHost.id" class="sdr-device-confirm" style="display: flex">
            <span class="sdr-device-confirm-label">DELETE?</span>
            <button
              class="sdr-device-confirm-btn sdr-device-confirm-btn--yes"
              @click="confirmDelete(sentryHost.id)"
            >
              YES
            </button>
            <button class="sdr-device-confirm-btn" @click="confirmId = null">NO</button>
          </div>
        </div>
        <SentryHostForm
          v-if="openId === sentryHost.id"
          :host="sentryHost"
          @save="onSave"
          @cancel="openId = null"
        />
      </div>

      <div
        v-if="openId === 'new'"
        class="sdr-device-item sdr-device-item--open sdr-device-item--new"
      >
        <SentryHostForm :host="null" @save="onSave" @cancel="openId = null" />
      </div>
    </div>
    <BaseButton variant="ghost" class="sdr-devices-add-btn" @click="toggleNew"
      >+ ADD SENTRY</BaseButton
    >
  </div>
</template>

<script setup lang="ts">
/**
 * `SentryHostsControl` — lists the Sentry hosts Sentinel has registered
 * (ADR-0009), each with a reachability dot, an inline edit/delete affordance,
 * and an "+ ADD SENTRY" action that opens `SentryHostForm`. Structurally a
 * sibling of `SdrDevicesControl` (same list/edit/delete/confirm shape, same
 * `.sdr-devices-*`/`.sdr-device-*` chrome) — kept as its own component
 * because it manages a genuinely different resource (hosts, not radios).
 *
 * Expanding a row shows `SentryHostForm`, which carries both the editable
 * fields and (in its own `MORE` disclosure) everything else known
 * about that host.
 *
 * Dispatches `sdr:sentry-hosts-changed` on `document` after every add/edit/
 * delete so `SdrDevicesControl` (which groups radios by Sentry host) picks up
 * the change without polling this control's own state.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'
import SentryHostForm from './SentryHostForm.vue'
import { listSentryHosts, deleteSentryHost, type SentryHost } from '@/services/sentryApi'
import { SENTRY_HOSTS_CHANGED_EVENT } from '@/composables/sdrDeviceEvents'

const hosts = ref<SentryHost[]>([])
const openId = ref<number | 'new' | null>(null)
const confirmId = ref<number | null>(null)

// Guards the periodic reachability refresh the same way SdrDevicesControl
// guards its status poll — a slow tick must never stack on top of another.
let refreshInFlight = false

async function load(): Promise<void> {
  if (refreshInFlight) return
  refreshInFlight = true
  try {
    hosts.value = await listSentryHosts()
  } catch {
    /* offline / transient — keep the previous list rather than blanking it */
  } finally {
    refreshInFlight = false
  }
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

function announceChanged(): void {
  document.dispatchEvent(new CustomEvent(SENTRY_HOSTS_CHANGED_EVENT))
}

async function confirmDelete(id: number): Promise<void> {
  try {
    await deleteSentryHost(id)
    confirmId.value = null
    await load()
    announceChanged()
  } catch {
    /* leave the confirm row up — the operator can retry or cancel */
  }
}

async function onSave(): Promise<void> {
  openId.value = null
  await load()
  announceChanged()
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void load()
  pollTimer = setInterval(() => void load(), 5000)
})

onBeforeUnmount(() => {
  /* v8 ignore start -- defensive: pollTimer is always assigned in onMounted
     before this teardown runs, so the null guard is never false here */
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  /* v8 ignore stop */
})
</script>

<style scoped>
.sentry-host-error {
  color: #d94436;
}
</style>
