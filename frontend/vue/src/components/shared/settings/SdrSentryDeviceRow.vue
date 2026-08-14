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
        :title="canAdd ? undefined : 'Sentry has not assigned this device an output port yet'"
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

const canAdd = computed(() => props.device.output !== null)

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
