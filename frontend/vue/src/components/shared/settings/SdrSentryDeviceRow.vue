<template>
  <div class="sdr-device-item">
    <div class="sdr-device-row">
      <span class="sdr-device-info">
        <SdrSourceStatusDot :connected="device.present" />
        {{ device.name || device.device_id }}
        <span class="sdr-sentry-device-state">{{ stateLabel }}</span>
      </span>
      <BaseButton
        variant="ghost"
        class="sdr-devices-btn"
        :style="ADD_BUTTON_STYLE"
        :disabled="!canAdd || adding"
        :title="addBlockedReason || undefined"
        @click="emit('add')"
      >
        {{ adding ? 'ADDING…' : 'ADD' }}
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrSentryDeviceRow` — one row for a Sentry-known device that has not yet
 * been mirrored into Sentinel's own radio list (ADR-0009). Shows the device's
 * live presence/state and an ADD action that creates the mirroring Sentinel
 * radio; disabled until Sentry has allocated the device an output port (a
 * device Sentry has only just detected, not yet configured, has no port to
 * connect to).
 */
import { computed } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'
import type { SentryDeviceStatus } from '@/services/sentryApi'

const ADD_BUTTON_STYLE =
  '--ba-ghost-height: auto; --ba-ghost-padding: 8px 18px; --ba-ghost-font-size: 10px; ' +
  '--ba-ghost-color: rgba(16, 19, 29, 0.6); --ba-ghost-hover-color: rgba(16, 19, 29, 0.9)'

const props = defineProps<{
  device: SentryDeviceStatus
  /** True while this row's ADD request is in flight. */
  adding: boolean
}>()
const emit = defineEmits<{ add: [] }>()

/**
 * Whether this device may be mirrored into Sentinel's radio list.
 *
 * Three separate reasons it may not be, each with its own explanation below —
 * an ADD button that is merely greyed out with no reason is worse than one that
 * is absent.
 *
 * A **private** or **disabled** device is not offered as a source at all. Both
 * are the operator saying, on the Sentry side, that this dongle is not for
 * sharing or not in service; mirroring it into Sentinel would quietly
 * contradict that, and the mirrored radio would then fail to connect for a
 * reason nothing in Sentinel explains. The row itself stays visible, because
 * this is the management view — hiding it here is what would make the very
 * toggles that flip these states unreachable.
 */
/** Why ADD is unavailable, in the operator's terms. Empty when it is available. */
const addBlockedReason = computed(() => {
  if (props.device.visibility !== 'public') {
    return 'This device is private on its Sentry — make it public to use it as a source'
  }
  if (!props.device.enabled) {
    return 'This device is disabled on its Sentry'
  }
  if (props.device.output === null) {
    return 'Sentry has not assigned this device an output port yet'
  }
  return ''
})

/** Addable exactly when there is no reason not to be — one source of truth. */
const canAdd = computed(() => addBlockedReason.value === '')

const stateLabel = computed(() => {
  const reason = props.device.state_reason ? ` (${props.device.state_reason})` : ''
  return `${props.device.state.toUpperCase()}${reason}`
})
</script>

<style scoped>
.sdr-sentry-device-state {
  margin-left: 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.45);
}
</style>
