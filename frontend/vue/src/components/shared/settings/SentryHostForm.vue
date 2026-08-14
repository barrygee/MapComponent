<template>
  <div class="sdr-devices-accordion">
    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">IP ADDRESS</span>
      <input
        ref="addressRef"
        v-model="form.address"
        type="text"
        class="sdr-devices-form-input"
        aria-label="Sentry host IP address or hostname"
        placeholder="192.168.1.x"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">LABEL</span>
      <input
        v-model="form.name"
        type="text"
        class="sdr-devices-form-input"
        aria-label="Sentry host label"
        placeholder="e.g. Roof Pi"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">PORT</span>
      <input
        v-model.number="form.port"
        type="number"
        class="sdr-devices-form-input"
        aria-label="Sentry API port"
        placeholder="8000"
        min="1"
        max="65535"
      />
    </div>
    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">CONSOLE PASSWORD</span>
      <input
        v-model="form.authToken"
        type="password"
        class="sdr-devices-form-input"
        aria-label="Sentry console password"
        :placeholder="
          host?.auth_token_set
            ? 'Password set — leave blank to keep it'
            : 'The password set on that Sentry\'s console'
        "
        autocomplete="new-password"
        spellcheck="false"
      />
    </div>

    <div
      v-if="probeResult"
      class="sentry-host-probe"
      :class="{ 'sentry-host-probe--fail': !probeResult.reachable }"
    >
      <SdrSourceStatusDot :connected="probeResult.reachable" />
      {{ probeResult.detail }}
    </div>

    <div v-if="errorMsg" class="sdr-devices-form-error">{{ errorMsg }}</div>

    <div class="sdr-devices-form-actions">
      <BaseButton
        v-if="host"
        type="button"
        variant="ghost"
        class="sdr-devices-btn"
        :style="GHOST_BUTTON_STYLE"
        :disabled="probing"
        @click="probeExisting"
      >
        TEST CONNECTION
      </BaseButton>
      <BaseButton
        type="button"
        variant="ghost"
        class="sdr-devices-btn"
        :style="GHOST_BUTTON_STYLE"
        @click="emit('cancel')"
      >
        CANCEL
      </BaseButton>
      <BaseButton
        type="button"
        variant="primary"
        class="sdr-devices-btn sdr-devices-btn--primary"
        :style="PRIMARY_BUTTON_STYLE"
        :disabled="saving"
        @click="save"
      >
        SAVE
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SentryHostForm` — the add/edit form for a Sentry host: the operator enters
 * the Pi's IP address (plus an optional label, port defaulting to 8000, and
 * its console password). Saving probes `POST .../test` and reports
 * reachability inline, both for an existing host (the TEST CONNECTION button,
 * probing the currently *stored* connection before any edit is applied) and
 * automatically after a successful save (probing the just-written connection).
 *
 * The password is write-only end to end — the API never returns it, so this
 * form never shows a stored value, only the "password set" placeholder text and
 * a blank field that keeps the stored one when left empty on edit.

 * It is Sentry's *console password*, not a token: Sentry has no token auth
 * (its ADR-0010), and the client exchanges this for a session cookie.
 */
import { ref, onMounted } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'
import {
  createSentryHost,
  updateSentryHost,
  testSentryHost,
  SentryApiRequestError,
  type SentryHost,
  type SentryHealthProbeResult,
} from '@/services/sentryApi'

// Matches SdrDeviceForm's established bridge from the default ghost/primary
// look down to this settings editor's smaller, dimmer 10px chrome.
const GHOST_BUTTON_STYLE =
  '--ba-ghost-height: auto; --ba-ghost-padding: 8px 18px; --ba-ghost-font-size: 10px; ' +
  '--ba-ghost-color: rgba(16, 19, 29, 0.6); --ba-ghost-hover-color: rgba(16, 19, 29, 0.9)'
const PRIMARY_BUTTON_STYLE =
  '--ba-primary-padding: 8px 18px; --ba-primary-font-size: 10px; ' +
  '--ba-primary-font-weight: 600; --ba-primary-letter-spacing: 0.16em; ' +
  '--ba-disabled-opacity: 1; --ba-disabled-cursor: default'

const props = defineProps<{ host: SentryHost | null }>()
const emit = defineEmits<{ save: []; cancel: [] }>()

const addressRef = ref<HTMLInputElement | null>(null)
const errorMsg = ref('')
const saving = ref(false)
const probing = ref(false)
const probeResult = ref<SentryHealthProbeResult | null>(null)

const form = ref({
  address: props.host?.address ?? '',
  name: props.host?.name ?? '',
  port: props.host?.port ?? 8000,
  authToken: '',
})

onMounted(() => setTimeout(() => addressRef.value?.focus(), 0))

async function probeExisting(): Promise<void> {
  if (!props.host) return
  probing.value = true
  try {
    probeResult.value = await testSentryHost(props.host.id)
  } catch {
    probeResult.value = { reachable: false, detail: 'Could not reach Sentinel to run the probe.' }
  } finally {
    probing.value = false
  }
}

async function save(): Promise<void> {
  const address = form.value.address.trim()
  if (!address) {
    errorMsg.value = 'IP address is required.'
    return
  }
  saving.value = true
  errorMsg.value = ''
  probeResult.value = null
  try {
    let savedHost: SentryHost
    if (props.host) {
      savedHost = await updateSentryHost(props.host.id, {
        // Explicit null clears the label; an empty-trimmed input means "no label".
        name: form.value.name.trim() || null,
        address,
        port: form.value.port || 8000,
        // Omit the key entirely when left blank so the stored token survives.
        ...(form.value.authToken ? { auth_token: form.value.authToken } : {}),
      })
    } else {
      savedHost = await createSentryHost({
        name: form.value.name.trim() || null,
        address,
        port: form.value.port || 8000,
        auth_token: form.value.authToken,
      })
    }
    // Report reachability of the connection just written, before closing the
    // form — an operator who mistyped the address sees it immediately.
    try {
      probeResult.value = await testSentryHost(savedHost.id)
    } catch {
      /* the save itself already succeeded; a failed post-save probe is not fatal */
    }
    emit('save')
  } catch (error) {
    errorMsg.value = error instanceof SentryApiRequestError ? error.message : 'Save failed.'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.sentry-host-probe {
  display: flex;
  align-items: center;
  padding: 8px 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  color: rgba(16, 19, 29, 0.75);
}
.sentry-host-probe--fail {
  color: #d94436;
}
</style>
