<template>
  <div class="sdr-devices-accordion">
    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">NAME</span>
      <input
        ref="nameRef"
        v-model="form.name"
        type="text"
        class="sdr-devices-form-input"
        aria-label="Device name"
        placeholder="e.g. Roof RTL-SDR"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <template v-if="!isSentryBacked">
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">IP ADDRESS</span>
        <input
          v-model="form.host"
          type="text"
          class="sdr-devices-form-input"
          aria-label="IP address"
          placeholder="192.168.1.x"
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
          aria-label="Port"
          placeholder="1234"
          min="1"
          max="65535"
        />
      </div>
    </template>

    <template v-else>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">OUTPUT PORT</span>
        <input
          v-model.number="form.outputPort"
          type="number"
          class="sdr-devices-form-input"
          aria-label="Output IQ port"
          min="1"
          max="65535"
        />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">VISIBILITY</span>
        <div class="sdr-devices-enabled-group" role="radiogroup" aria-label="Device visibility">
          <BasePillToggle
            class="sdr-devices-enabled-btn"
            role="radio"
            :aria-checked="form.visibility === 'public'"
            :tabindex="visibilityKeyboard.radioTabindex(0)"
            :active="form.visibility === 'public'"
            active-class="is-active"
            @click="form.visibility = 'public'"
            @keydown="visibilityKeyboard.onRadioKeydown($event, 0)"
          >
            PUBLIC
          </BasePillToggle>
          <BasePillToggle
            class="sdr-devices-enabled-btn"
            role="radio"
            :aria-checked="form.visibility === 'private'"
            :tabindex="visibilityKeyboard.radioTabindex(1)"
            :active="form.visibility === 'private'"
            active-class="is-active"
            @click="form.visibility = 'private'"
            @keydown="visibilityKeyboard.onRadioKeydown($event, 1)"
          >
            PRIVATE
          </BasePillToggle>
        </div>
      </div>
      <div class="sdr-devices-form-row sdr-devices-form-row--wide">
        <span class="sdr-devices-form-label">NOTES</span>
        <textarea
          v-model="form.notes"
          class="sdr-devices-form-input sdr-devices-form-textarea"
          aria-label="Notes"
          rows="2"
        ></textarea>
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">ANTENNA</span>
        <input
          v-model="form.antenna"
          type="text"
          class="sdr-devices-form-input"
          aria-label="Antenna"
          placeholder="e.g. Discone"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    </template>

    <div class="sdr-devices-form-row">
      <span class="sdr-devices-form-label">STATUS</span>
      <div class="sdr-devices-enabled-group" role="radiogroup" aria-label="Device status">
        <BasePillToggle
          class="sdr-devices-enabled-btn"
          role="radio"
          :aria-checked="form.enabled"
          :tabindex="statusKeyboard.radioTabindex(0)"
          :active="form.enabled"
          active-class="is-active"
          @click="form.enabled = true"
          @keydown="statusKeyboard.onRadioKeydown($event, 0)"
        >
          ENABLED
        </BasePillToggle>
        <BasePillToggle
          class="sdr-devices-enabled-btn"
          role="radio"
          :aria-checked="!form.enabled"
          :tabindex="statusKeyboard.radioTabindex(1)"
          :active="!form.enabled"
          active-class="is-active"
          @click="form.enabled = false"
          @keydown="statusKeyboard.onRadioKeydown($event, 1)"
        >
          DISABLED
        </BasePillToggle>
      </div>
    </div>

    <BaseAccordionSection
      v-if="isSentryBacked"
      v-model:expanded="tuningExpanded"
      title="TUNING"
      variant="form"
      body-id="sdr-device-form-tuning"
    >
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">SAMPLE RATE</span>
        <input
          v-model.number="form.sampleRate"
          type="number"
          class="sdr-devices-form-input"
          aria-label="Sample rate in Hz"
          min="0"
        />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">GAIN (DB)</span>
        <input
          v-model.number="form.gainDb"
          type="number"
          class="sdr-devices-form-input"
          aria-label="Gain in decibels"
          step="0.1"
          :disabled="form.gainAuto"
        />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">AGC</span>
        <BaseToggleSwitch v-model="form.gainAuto" accessible-name="Automatic gain control" />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">PPM CORRECTION</span>
        <input
          v-model.number="form.ppmCorrection"
          type="number"
          class="sdr-devices-form-input"
          aria-label="Frequency correction in parts per million"
        />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">BIAS-TEE</span>
        <BaseToggleSwitch v-model="form.biasTee" accessible-name="Bias-tee power" />
      </div>
      <div class="sdr-devices-form-row">
        <span class="sdr-devices-form-label">DIRECT SAMPLING</span>
        <div class="sdr-devices-enabled-group" role="radiogroup" aria-label="Direct sampling mode">
          <BasePillToggle
            v-for="option in DIRECT_SAMPLING_OPTIONS"
            :key="option.value"
            class="sdr-devices-enabled-btn"
            role="radio"
            :aria-checked="form.directSampling === option.value"
            :tabindex="directSamplingKeyboard.radioTabindex(option.value)"
            :active="form.directSampling === option.value"
            active-class="is-active"
            @click="form.directSampling = option.value"
            @keydown="directSamplingKeyboard.onRadioKeydown($event, option.value)"
          >
            {{ option.label }}
          </BasePillToggle>
        </div>
      </div>
    </BaseAccordionSection>

    <div v-if="usbIdentity" class="sdr-device-usb-identity">
      <div class="sdr-devices-form-label">USB IDENTITY</div>
      <dl class="sdr-device-usb-identity-list">
        <dt>Manufacturer</dt>
        <dd>{{ usbIdentity.manufacturer || '—' }}</dd>
        <dt>Product</dt>
        <dd>{{ usbIdentity.product || '—' }}</dd>
        <dt>Serial</dt>
        <dd>{{ usbIdentity.serial || '—' }}</dd>
        <dt>Topology path</dt>
        <dd>{{ usbIdentity.topology_path || '—' }}</dd>
      </dl>
    </div>

    <SdrSerialFlashControl
      v-if="needsIdentification"
      :host-id="needsIdentification.hostId"
      :device-id="needsIdentification.deviceId"
      @flashed="emit('save')"
    />

    <div v-if="errorMsg" class="sdr-devices-form-error">{{ errorMsg }}</div>
    <div class="sdr-devices-form-actions">
      <BaseButton
        type="button"
        variant="ghost"
        class="sdr-devices-btn"
        :style="GHOST_BUTTON_STYLE"
        @click="emit('cancel')"
        >CANCEL</BaseButton
      >
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
 * `SdrDeviceForm` — the add/edit form for one row in `SdrDevicesControl`.
 *
 * Two distinct backing stores, chosen by whether `radio.sentry_host_id` is
 * set (ADR-0009):
 * - A manual radio (`sentry_host_id === null`) edits Sentinel's own
 *   `/api/sdr/radios` record — name/IP/port/status, exactly as before this
 *   feature existed.
 * - A Sentry-mirrored radio writes through `PATCH
 *   /api/sdr/sentry-hosts/{host_id}/devices/{device_id}` — Sentry owns the
 *   device's configuration (ADR-0009), so this form never writes tuning/
 *   visibility/notes/antenna to Sentinel directly. After a successful patch,
 *   the mirrored Sentinel radio row (name/port/enabled/visibility/notes/
 *   antenna) is updated to match Sentry's accepted values so the operational
 *   radio list reflects the edit immediately rather than waiting for the next
 *   poll tick.
 *
 * Sentry's rejection (409 port conflict, 422 invalid field, …) is shown
 * verbatim in `errorMsg` — per ADR-0009 that message is written for the
 * operator and must reach them unchanged, including which device already
 * holds a conflicting port when Sentry says so.
 */
import { ref, computed, onMounted } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BasePillToggle from '@/components/base/BasePillToggle.vue'
import BaseToggleSwitch from '@/components/base/BaseToggleSwitch.vue'
import BaseAccordionSection from '@/components/base/BaseAccordionSection.vue'
import SdrSerialFlashControl from './SdrSerialFlashControl.vue'
import { useRadioGroupKeyboard } from '@/composables/useRadioGroupKeyboard'
import {
  createRadio,
  updateRadio,
  type SdrRadioRecord,
  type SdrRadioInput,
} from '@/services/sdrRadiosApi'
import {
  getSentryDeviceRecords,
  patchSentryDevice,
  SentryApiRequestError,
  type SentryDeviceRecord,
  type SentryDeviceStatus,
} from '@/services/sentryApi'

// `.sdr-devices-btn`/`--primary` are smaller and dimmer than the default
// ghost/primary look (10px type, 8px/18px padding, auto height) — bridge those
// deltas via the established `--ba-*` custom-property hooks.
const GHOST_BUTTON_STYLE =
  '--ba-ghost-height: auto; --ba-ghost-padding: 8px 18px; --ba-ghost-font-size: 10px; ' +
  '--ba-ghost-color: rgba(16, 19, 29, 0.6); --ba-ghost-hover-color: rgba(16, 19, 29, 0.9)'
// The original `.sdr-devices-btn--primary` never had a disabled visual
// treatment at all (unlike BaseButton's shared dimmed/not-allowed default),
// so `saving` never visibly dims this SAVE button — preserve that.
const PRIMARY_BUTTON_STYLE =
  '--ba-primary-padding: 8px 18px; --ba-primary-font-size: 10px; ' +
  '--ba-primary-font-weight: 600; --ba-primary-letter-spacing: 0.16em; ' +
  '--ba-disabled-opacity: 1; --ba-disabled-cursor: default'

const DIRECT_SAMPLING_OPTIONS = [
  { value: 0, label: 'OFF' },
  { value: 1, label: 'I' },
  { value: 2, label: 'Q' },
] as const

const props = defineProps<{
  /** The radio being edited, or null when adding a new manual radio. */
  radio: SdrRadioRecord | null
  /**
   * Live Sentry device status for this radio (USB identity, needs-
   * identification flag, current tuning). Present only when `radio` mirrors
   * a Sentry device and the fleet poller currently has a snapshot for it;
   * null for a manual radio or before the first successful poll.
   */
  sentryDeviceStatus?: SentryDeviceStatus | null
}>()
const emit = defineEmits<{ save: []; cancel: [] }>()

const isSentryBacked = computed(
  () => props.radio?.sentry_host_id != null && props.radio?.sentry_device_id != null,
)

const usbIdentity = computed(
  () => props.sentryDeviceStatus?.usb ?? props.sentryDeviceStatus?.usb_last_known ?? null,
)

/** Non-null only when the flash-serial action should be offered: a Sentry-
 * backed device Sentry has flagged as needing identification. */
const needsIdentification = computed(() => {
  const radio = props.radio
  if (!props.sentryDeviceStatus?.needs_identification) return null
  if (radio?.sentry_host_id == null || radio?.sentry_device_id == null) return null
  return { hostId: radio.sentry_host_id, deviceId: radio.sentry_device_id }
})

const nameRef = ref<HTMLInputElement | null>(null)
const errorMsg = ref('')
const saving = ref(false)
const tuningExpanded = ref(false)

const form = ref({
  name: props.radio?.name ?? '',
  host: props.radio?.host ?? '',
  port: props.radio?.port ?? (null as number | null),
  enabled: props.radio ? props.radio.enabled !== false : true,
  outputPort: props.radio?.port ?? (null as number | null),
  visibility: props.radio?.visibility ?? ('public' as 'public' | 'private'),
  notes: props.radio?.notes ?? props.sentryDeviceStatus?.notes ?? '',
  antenna: props.radio?.antenna ?? props.sentryDeviceStatus?.antenna ?? '',
  // Tuning starts empty and is filled in by `loadSentryDeviceRecord` below.
  // It cannot come from `sentryDeviceStatus`: Sentry's `DeviceStatus` reports
  // what a device is *doing* and carries no persisted tuning at all, so
  // reading it here would show every field blank and then write those blanks
  // back over the stored configuration on save.
  sampleRate: null as number | null,
  gainDb: null as number | null,
  gainAuto: false,
  ppmCorrection: 0,
  biasTee: false,
  directSampling: 0,
})

/** True once the persisted tuning has loaded, so the form can't save blanks over it. */
const tuningLoaded = ref(false)
const tuningLoadError = ref('')

/**
 * Fetch this device's persisted configuration from Sentry.
 *
 * Live rather than cached — the operator is about to edit these values.
 */
async function loadSentryDeviceRecord(): Promise<void> {
  const radio = props.radio
  if (!radio?.sentry_host_id || !radio.sentry_device_id) {
    tuningLoaded.value = true
    return
  }
  try {
    const payload = await getSentryDeviceRecords(radio.sentry_host_id)
    const record = payload.devices.find(
      (candidate: SentryDeviceRecord) => candidate.device_id === radio.sentry_device_id,
    )
    if (record) {
      form.value.sampleRate = record.sample_rate ?? null
      form.value.gainDb = record.gain_db ?? null
      form.value.gainAuto = record.gain_auto ?? false
      form.value.ppmCorrection = record.ppm_correction ?? 0
      form.value.biasTee = record.bias_tee ?? false
      form.value.directSampling = record.direct_sampling ?? 0
      form.value.outputPort = record.output_port ?? form.value.outputPort
    }
    tuningLoaded.value = true
  } catch (error) {
    // The form still saves name/port/notes/antenna; the tuning section stays
    // disabled rather than offering fields that would write blanks on save.
    tuningLoadError.value =
      error instanceof Error ? error.message : 'Could not load tuning settings.'
  }
}

// Radio-group keyboard models — index 0/1 for the STATUS and VISIBILITY
// pills (matches render order), and the direct-sampling value itself for its
// three-option group (0/1/2 are already the option identities).
const statusKeyboard = useRadioGroupKeyboard({
  optionCount: () => 2,
  selectedIndex: () => (form.value.enabled ? 0 : 1),
  select: (optionIndex) => {
    form.value.enabled = optionIndex === 0
  },
})
const visibilityKeyboard = useRadioGroupKeyboard({
  optionCount: () => 2,
  selectedIndex: () => (form.value.visibility === 'public' ? 0 : 1),
  select: (optionIndex) => {
    form.value.visibility = optionIndex === 0 ? 'public' : 'private'
  },
})
const directSamplingKeyboard = useRadioGroupKeyboard({
  optionCount: () => DIRECT_SAMPLING_OPTIONS.length,
  selectedIndex: () => form.value.directSampling,
  select: (optionIndex) => {
    form.value.directSampling = optionIndex
  },
})

onMounted(() => {
  setTimeout(() => nameRef.value?.focus(), 0)
  void loadSentryDeviceRecord()
})

async function saveManualRadio(): Promise<void> {
  if (!form.value.name.trim() || !form.value.host.trim()) {
    errorMsg.value = 'Name and IP address are required.'
    return
  }
  const body: SdrRadioInput = {
    name: form.value.name.trim(),
    host: form.value.host.trim(),
    port: form.value.port || 1234,
    // Bandwidth / RF gain / AGC are no longer edited in this form; preserve any
    // existing stored values on edit so saving name/host/port doesn't wipe them.
    bandwidth: props.radio?.bandwidth ?? null,
    rf_gain: props.radio?.rf_gain ?? null,
    agc: props.radio?.agc ?? null,
    description: props.radio?.description ?? '',
    enabled: form.value.enabled,
    sentry_host_id: null,
    sentry_device_id: null,
    notes: '',
    antenna: '',
    visibility: 'public',
  }
  saving.value = true
  errorMsg.value = ''
  try {
    const saved = props.radio ? await updateRadio(props.radio.id, body) : await createRadio(body)
    if (!saved) {
      errorMsg.value = 'Save failed.'
      return
    }
    emit('save')
  } catch {
    errorMsg.value = 'Network error.'
  } finally {
    saving.value = false
  }
}

async function saveSentryBackedDevice(): Promise<void> {
  const radio = props.radio
  if (!radio || radio.sentry_host_id == null || radio.sentry_device_id == null) return
  if (!form.value.name.trim()) {
    errorMsg.value = 'Name is required.'
    return
  }
  saving.value = true
  errorMsg.value = ''
  try {
    const updatedDevice = await patchSentryDevice(radio.sentry_host_id, radio.sentry_device_id, {
      name: form.value.name.trim(),
      enabled: form.value.enabled,
      visibility: form.value.visibility,
      notes: form.value.notes,
      antenna: form.value.antenna,
      output_port: form.value.outputPort ?? undefined,
      sample_rate: form.value.sampleRate ?? undefined,
      gain_db: form.value.gainAuto ? undefined : (form.value.gainDb ?? undefined),
      gain_auto: form.value.gainAuto,
      ppm_correction: form.value.ppmCorrection,
      bias_tee: form.value.biasTee,
      direct_sampling: form.value.directSampling,
    })
    // Keep Sentinel's mirrored radio row in sync with what Sentry actually
    // accepted, rather than waiting for the next poll tick to reconcile it.
    await updateRadio(radio.id, {
      name: updatedDevice.name,
      host: radio.host,
      port: updatedDevice.output_port ?? radio.port,
      description: radio.description,
      bandwidth: radio.bandwidth,
      rf_gain: radio.rf_gain,
      agc: radio.agc,
      enabled: updatedDevice.enabled,
      sentry_host_id: radio.sentry_host_id,
      sentry_device_id: radio.sentry_device_id,
      notes: updatedDevice.notes,
      antenna: updatedDevice.antenna,
      visibility: updatedDevice.visibility,
    })
    emit('save')
  } catch (error) {
    errorMsg.value = error instanceof SentryApiRequestError ? error.message : 'Save failed.'
  } finally {
    saving.value = false
  }
}

async function save(): Promise<void> {
  if (isSentryBacked.value) await saveSentryBackedDevice()
  else await saveManualRadio()
}
</script>

<style scoped>
.sdr-devices-form-row--wide {
  align-items: flex-start;
}
.sdr-devices-form-textarea {
  height: auto;
  min-height: 56px;
  padding: 8px 10px;
  resize: vertical;
}
.sdr-device-usb-identity {
  padding: 10px 0;
  border-top: 1px solid rgba(16, 19, 29, 0.08);
}
.sdr-device-usb-identity-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 6px 0 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
}
.sdr-device-usb-identity-list dt {
  color: rgba(16, 19, 29, 0.5);
}
.sdr-device-usb-identity-list dd {
  margin: 0;
  color: rgba(16, 19, 29, 0.85);
}
</style>
