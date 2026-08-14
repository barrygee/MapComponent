<template>
  <div class="sdr-serial-flash">
    <p class="sdr-serial-flash-note">
      This dongle needs a unique serial before Sentry can identify it reliably.
    </p>
    <BaseButton
      v-if="!confirming"
      type="button"
      variant="ghost"
      class="sdr-devices-btn"
      :style="GHOST_BUTTON_STYLE"
      @click="confirming = true"
    >
      FLASH SERIAL
    </BaseButton>
    <div v-else class="sdr-serial-flash-confirm">
      <label class="sdr-devices-form-label" :for="serialInputId">NEW SERIAL</label>
      <input
        :id="serialInputId"
        v-model="serial"
        type="text"
        class="sdr-devices-form-input"
        :aria-describedby="warningId"
        placeholder="e.g. AIS-01"
        autocomplete="off"
        spellcheck="false"
      />
      <p :id="warningId" class="sdr-serial-flash-warning">
        This writes permanently to the dongle's EEPROM. An interrupted write can corrupt the device.
        Do not unplug the dongle or close this page while flashing.
      </p>
      <div v-if="errorMsg" class="sdr-devices-form-error">{{ errorMsg }}</div>
      <div class="sdr-devices-form-actions">
        <BaseButton
          type="button"
          variant="ghost"
          class="sdr-devices-btn"
          :style="GHOST_BUTTON_STYLE"
          :disabled="flashing"
          @click="cancel"
        >
          CANCEL
        </BaseButton>
        <BaseButton
          type="button"
          variant="danger"
          class="sdr-devices-btn"
          :disabled="flashing || !serial.trim()"
          @click="confirmFlash"
        >
          {{ flashing ? 'FLASHING…' : 'CONFIRM PERMANENT WRITE' }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrSerialFlashControl` — the guarded EEPROM-serial-flash action shown on a
 * device that needs identification (`needs_identification: true`). Writing a
 * serial to an RTL-SDR's EEPROM is permanent and an interrupted write can
 * corrupt the dongle, so this requires an explicit two-step confirmation
 * (reveal the serial input + warning, then a distinctly-labelled destructive
 * button) rather than a single click — the same shape as the delete-radio
 * confirm row elsewhere in this settings surface, but with the serial value
 * itself and a stronger written warning given the higher stakes.
 */
import { ref } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import { flashSentryDeviceSerial, SentryApiRequestError } from '@/services/sentryApi'

const GHOST_BUTTON_STYLE =
  '--ba-ghost-height: auto; --ba-ghost-padding: 8px 18px; --ba-ghost-font-size: 10px; ' +
  '--ba-ghost-color: rgba(16, 19, 29, 0.6); --ba-ghost-hover-color: rgba(16, 19, 29, 0.9)'

const props = defineProps<{ hostId: number; deviceId: string }>()
const emit = defineEmits<{ flashed: [] }>()

const confirming = ref(false)
const serial = ref('')
const flashing = ref(false)
const errorMsg = ref('')
const idSafeDeviceId = props.deviceId.replace(/[^a-zA-Z0-9]/g, '-')
const serialInputId = `sdr-serial-flash-${idSafeDeviceId}`
const warningId = `sdr-serial-flash-warning-${idSafeDeviceId}`

function cancel(): void {
  confirming.value = false
  serial.value = ''
  errorMsg.value = ''
}

async function confirmFlash(): Promise<void> {
  const trimmed = serial.value.trim()
  if (!trimmed) return
  flashing.value = true
  errorMsg.value = ''
  try {
    await flashSentryDeviceSerial(props.hostId, props.deviceId, trimmed)
    confirming.value = false
    serial.value = ''
    emit('flashed')
  } catch (error) {
    errorMsg.value = error instanceof SentryApiRequestError ? error.message : 'Flash failed.'
  } finally {
    flashing.value = false
  }
}
</script>

<style scoped>
.sdr-serial-flash {
  padding: 10px 0;
  border-top: 1px solid rgba(16, 19, 29, 0.08);
}
.sdr-serial-flash-note {
  margin: 0 0 8px;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  color: #d94436;
}
.sdr-serial-flash-confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sdr-serial-flash-warning {
  margin: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  line-height: 1.5;
  color: rgba(16, 19, 29, 0.6);
}
</style>
