<template>
  <div class="sdr-device-item" :class="{ 'sdr-device-item--open': open }">
    <div class="sdr-device-row">
      <span
        class="sdr-device-info"
        :class="{ 'sdr-device-info--unavailable': isUnavailable }"
        :style="confirming ? 'opacity:0.4' : ''"
      >
        <SdrSourceStatusDot :connected="connected" />
        {{ radio.name }}&nbsp;&nbsp;{{ radio.host }}:{{ radio.port }}
      </span>
      <span v-if="isUnavailable && !confirming" class="sdr-device-unavailable">
        {{ radio.unavailable_reason }}
      </span>
      <button
        v-if="!confirming"
        class="sdr-device-btn"
        :class="{ 'sdr-device-btn--active': open }"
        title="Edit"
        aria-label="Edit device"
        @click="emit('toggle-edit')"
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
        v-if="!confirming"
        class="sdr-device-btn sdr-device-btn--danger"
        title="Delete"
        aria-label="Delete device"
        @click="emit('start-delete')"
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
      <div v-if="confirming" class="sdr-device-confirm" style="display: flex">
        <span class="sdr-device-confirm-label">DELETE?</span>
        <button
          class="sdr-device-confirm-btn sdr-device-confirm-btn--yes"
          @click="emit('confirm-delete')"
        >
          YES
        </button>
        <button class="sdr-device-confirm-btn" @click="emit('cancel-delete')">NO</button>
      </div>
    </div>
    <SdrDeviceForm
      v-if="open"
      :radio="radio"
      :sentry-device-status="sentryDeviceStatus"
      @save="emit('save')"
      @cancel="emit('cancel-edit')"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrRadioRow` — one configured-radio row shared by both groupings in
 * `SdrDevicesControl`: a manual radio and a Sentry-mirrored radio render
 * identically here (name, host:port, reachability dot, edit/delete with
 * inline delete-confirm, and the `SdrDeviceForm` editor) — only the data and
 * the write path underneath differ, and `SdrDeviceForm` itself branches on
 * that. Extracted from the byte-identical row markup this app shipped for
 * manual radios only, so both groupings can reuse it instead of duplicating
 * the row chrome per grouping.
 */
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'
import SdrDeviceForm from './SdrDeviceForm.vue'
import { computed } from 'vue'
import type { SdrRadioRecord } from '@/services/sdrRadiosApi'
import type { SentryDeviceStatus } from '@/services/sentryApi'

const props = defineProps<{
  radio: SdrRadioRecord
  /** Reachability dot state: manual radios read their rtl_tcp TCP probe;
   * Sentry-mirrored radios read the device's live `present` flag. Null while
   * unknown. */
  connected: boolean | null
  open: boolean
  confirming: boolean
  /** Live Sentry status for this radio's device, when it mirrors one. */
  sentryDeviceStatus?: SentryDeviceStatus | null
}>()

/**
 * Whether this radio's device is currently unusable.
 *
 * Reported by the backend against the live fleet snapshot rather than stored,
 * because a dongle can be unplugged or replugged elsewhere at any moment. Shown
 * here so the operator sees *why* before trying to connect, instead of after.
 *
 * Only an explicit `false` counts. An absent field means an older backend or a
 * manually-entered radio with no Sentry device behind it, and greying the row
 * out in either case would be a lie.
 */
const isUnavailable = computed(() => props.radio.device_available === false)

const emit = defineEmits<{
  'toggle-edit': []
  'start-delete': []
  'confirm-delete': []
  'cancel-delete': []
  save: []
  'cancel-edit': []
}>()
</script>
