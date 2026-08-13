import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrDeviceForm from './SdrDeviceForm.vue'
import SdrSerialFlashControl from './SdrSerialFlashControl.vue'
import type { SdrRadioRecord } from '@/services/sdrRadiosApi'
import { SentryApiRequestError, type SentryDeviceStatus } from '@/services/sentryApi'

vi.mock('@/services/sdrRadiosApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sdrRadiosApi')>()
  return { ...actual, createRadio: vi.fn(), updateRadio: vi.fn() }
})
vi.mock('@/services/sentryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sentryApi')>()
  return { ...actual, getSentryDeviceRecords: vi.fn(), patchSentryDevice: vi.fn() }
})

import { createRadio, updateRadio } from '@/services/sdrRadiosApi'
import { getSentryDeviceRecords, patchSentryDevice } from '@/services/sentryApi'

const mockCreateRadio = vi.mocked(createRadio)
const mockUpdateRadio = vi.mocked(updateRadio)
const mockGetSentryDeviceRecords = vi.mocked(getSentryDeviceRecords)
const mockPatchSentryDevice = vi.mocked(patchSentryDevice)

const EXISTING: SdrRadioRecord = {
  id: 7,
  name: 'Roof',
  host: '192.168.1.50',
  port: 1234,
  bandwidth: 2048000,
  rf_gain: 30,
  agc: true,
  enabled: false,
  description: '',
  sentry_host_id: null,
  sentry_device_id: null,
  notes: '',
  antenna: '',
  visibility: 'public',
}

const EXISTING_SENTRY: SdrRadioRecord = {
  id: 12,
  name: 'Attic RTL',
  host: '192.168.1.50',
  port: 1234,
  bandwidth: null,
  rf_gain: null,
  agc: null,
  enabled: true,
  description: '',
  sentry_host_id: 3,
  sentry_device_id: 'rtl-9',
  notes: 'roof notes',
  antenna: 'discone',
  visibility: 'public',
}

const SENTRY_STATUS: SentryDeviceStatus = {
  device_id: 'rtl-9',
  name: 'Attic RTL',
  present: true,
  state: 'streaming',
  state_reason: null,
  enabled: true,
  visibility: 'public',
  notes: 'sentry notes',
  antenna: 'sentry antenna',
  needs_identification: false,
  output: { iq_port: 1234, control_port: 1235, host: '192.168.1.50' },
  usb: null,
  usb_last_known: null,
}

function emptyRecordsPayload() {
  return {
    devices: [],
    port_suggestion: null,
    constraints: { min_port: 1, max_port: 65535, control_port_offset: 1, reserved_ports: [] },
  }
}

describe('SdrDeviceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSentryDeviceRecords.mockResolvedValue(emptyRecordsPayload())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('manual radio', () => {
    it('defaults a new form to enabled', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      const [enabledBtn, disabledBtn] = wrapper.findAll('.sdr-devices-enabled-btn')
      expect(enabledBtn!.classes()).toContain('is-active')
      expect(disabledBtn!.classes()).not.toContain('is-active')
    })

    it('exposes the STATUS pills as a keyboard-operable radio group', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      const group = wrapper.find('.sdr-devices-enabled-group')
      expect(group.attributes('role')).toBe('radiogroup')
      expect(group.attributes('aria-label')).toBe('Device status')

      const [enabledBtn, disabledBtn] = wrapper.findAll('.sdr-devices-enabled-btn')
      expect(enabledBtn!.attributes('role')).toBe('radio')
      expect(enabledBtn!.attributes('aria-checked')).toBe('true')
      expect(enabledBtn!.attributes('tabindex')).toBe('0')
      expect(disabledBtn!.attributes('aria-checked')).toBe('false')
      expect(disabledBtn!.attributes('tabindex')).toBe('-1')

      await enabledBtn!.trigger('keydown', { key: 'ArrowRight' })
      expect(disabledBtn!.attributes('aria-checked')).toBe('true')
      expect(disabledBtn!.attributes('tabindex')).toBe('0')
      expect(disabledBtn!.classes()).toContain('is-active')
      expect(enabledBtn!.attributes('aria-checked')).toBe('false')

      await disabledBtn!.trigger('keydown', { key: 'ArrowLeft' })
      expect(enabledBtn!.attributes('aria-checked')).toBe('true')
    })

    it('renders only name/host/port inputs — no Sentry-only fields', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      expect(wrapper.findAll('.sdr-devices-form-input')).toHaveLength(3)
      expect(wrapper.find('.sdr-devices-agc-input').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('OUTPUT PORT')
      expect(wrapper.text()).not.toContain('TUNING')
    })

    it('prefills the form from an existing radio', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      const inputs = wrapper.findAll('.sdr-devices-form-input')
      expect((inputs[0]!.element as HTMLInputElement).value).toBe('Roof')
      expect((inputs[1]!.element as HTMLInputElement).value).toBe('192.168.1.50')
      expect(wrapper.findAll('.sdr-devices-enabled-btn')[1]!.classes()).toContain('is-active')
    })

    it('emits cancel when CANCEL is clicked', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn').trigger('click')
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })

    it('requires a name and host before saving', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe(
        'Name and IP address are required.',
      )
      expect(mockCreateRadio).not.toHaveBeenCalled()
    })

    it('creates a new radio via sdrRadiosApi with defaulted optional fields', async () => {
      mockCreateRadio.mockResolvedValue({ ...EXISTING, id: 99 })
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      const inputs = wrapper.findAll('.sdr-devices-form-input')
      await inputs[0]!.setValue('New SDR')
      await inputs[1]!.setValue('10.0.0.1')
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(mockCreateRadio).toHaveBeenCalledTimes(1)
      expect(mockCreateRadio).toHaveBeenCalledWith({
        name: 'New SDR',
        host: '10.0.0.1',
        port: 1234,
        bandwidth: null,
        rf_gain: null,
        agc: null,
        description: '',
        enabled: true,
        sentry_host_id: null,
        sentry_device_id: null,
        notes: '',
        antenna: '',
        visibility: 'public',
      })
      expect(wrapper.emitted('save')).toHaveLength(1)
    })

    it('sends the name/host/port the user fills in on a new radio', async () => {
      mockCreateRadio.mockResolvedValue({ ...EXISTING, id: 99 })
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      const inputs = wrapper.findAll('.sdr-devices-form-input')
      await inputs[0]!.setValue('Full SDR')
      await inputs[1]!.setValue('10.0.0.2')
      await inputs[2]!.setValue(5678)
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(mockCreateRadio).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Full SDR', host: '10.0.0.2', port: 5678 }),
      )
    })

    it('updates an existing radio by id, preserving stored bandwidth/gain/AGC', async () => {
      mockUpdateRadio.mockResolvedValue(EXISTING)
      const wrapper = mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(mockUpdateRadio).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ port: 1234, bandwidth: 2048000, rf_gain: 30, agc: true }),
      )
    })

    it('shows a save-failed message when the API returns null', async () => {
      mockUpdateRadio.mockResolvedValue(null)
      const wrapper = mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Save failed.')
      expect(wrapper.emitted('save')).toBeUndefined()
    })

    it('shows a network-error message when the request throws', async () => {
      mockUpdateRadio.mockRejectedValue(new Error('offline'))
      const wrapper = mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Network error.')
    })

    it('toggles the enabled/disabled status buttons', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      const [enabledBtn, disabledBtn] = wrapper.findAll('.sdr-devices-enabled-btn')
      await disabledBtn!.trigger('click')
      expect(disabledBtn!.classes()).toContain('is-active')
      await enabledBtn!.trigger('click')
      expect(enabledBtn!.classes()).toContain('is-active')
    })

    it('focuses the name field shortly after mount', async () => {
      vi.useFakeTimers()
      const wrapper = mount(SdrDeviceForm, { props: { radio: null }, attachTo: document.body })
      const nameInput = wrapper.findAll('.sdr-devices-form-input')[0]!.element as HTMLInputElement
      vi.runAllTimers()
      expect(document.activeElement).toBe(nameInput)
      wrapper.unmount()
    })

    it('does not fetch persisted tuning for a manual radio', async () => {
      mount(SdrDeviceForm, { props: { radio: EXISTING } })
      await flushPromises()
      expect(mockGetSentryDeviceRecords).not.toHaveBeenCalled()
    })

    it('has no accessibility violations', async () => {
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })
  })

  describe('Sentry-backed radio', () => {
    it('renders OUTPUT PORT/VISIBILITY/NOTES/ANTENNA instead of IP/PORT, plus a TUNING section', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      expect(wrapper.text()).toContain('OUTPUT PORT')
      expect(wrapper.text()).toContain('VISIBILITY')
      expect(wrapper.text()).toContain('NOTES')
      expect(wrapper.text()).toContain('ANTENNA')
      expect(wrapper.text()).toContain('TUNING')
      expect(wrapper.text()).not.toContain('IP ADDRESS')
    })

    it('prefills output port, visibility, notes, and antenna from the radio', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      const outputPortInput = wrapper.find('[aria-label="Output IQ port"]')
        .element as HTMLInputElement
      expect(outputPortInput.value).toBe('1234')
      const notesInput = wrapper.find('[aria-label="Notes"]').element as HTMLTextAreaElement
      expect(notesInput.value).toBe('roof notes')
      const antennaInput = wrapper.find('[aria-label="Antenna"]').element as HTMLInputElement
      expect(antennaInput.value).toBe('discone')
    })

    it('falls back to the live Sentry status notes/antenna when the stored radio record is missing them', async () => {
      const malformedRadio = {
        ...EXISTING_SENTRY,
        notes: undefined as unknown as string,
        antenna: undefined as unknown as string,
      }
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: malformedRadio, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      const notesInput = wrapper.find('[aria-label="Notes"]').element as HTMLTextAreaElement
      expect(notesInput.value).toBe('sentry notes')
      const antennaInput = wrapper.find('[aria-label="Antenna"]').element as HTMLInputElement
      expect(antennaInput.value).toBe('sentry antenna')
    })

    it('toggles VISIBILITY via click and via ArrowRight/ArrowLeft keyboard', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      const group = wrapper.findAll('.sdr-devices-enabled-group')[0]!
      expect(group.attributes('aria-label')).toBe('Device visibility')
      const [publicBtn, privateBtn] = group.findAll('.sdr-devices-enabled-btn')
      expect(publicBtn!.classes()).toContain('is-active')
      await privateBtn!.trigger('click')
      expect(privateBtn!.classes()).toContain('is-active')
      await publicBtn!.trigger('click')
      expect(publicBtn!.classes()).toContain('is-active')
      await publicBtn!.trigger('keydown', { key: 'ArrowRight' })
      expect(privateBtn!.attributes('aria-checked')).toBe('true')
      await privateBtn!.trigger('keydown', { key: 'ArrowLeft' })
      expect(publicBtn!.attributes('aria-checked')).toBe('true')
    })

    it('updates OUTPUT PORT/NOTES/ANTENNA as the operator types', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('[aria-label="Output IQ port"]').setValue(4321)
      await wrapper.find('[aria-label="Notes"]').setValue('new notes')
      await wrapper.find('[aria-label="Antenna"]').setValue('new antenna')
      expect(
        (wrapper.find('[aria-label="Output IQ port"]').element as HTMLInputElement).value,
      ).toBe('4321')
      expect((wrapper.find('[aria-label="Notes"]').element as HTMLTextAreaElement).value).toBe(
        'new notes',
      )
      expect((wrapper.find('[aria-label="Antenna"]').element as HTMLInputElement).value).toBe(
        'new antenna',
      )
    })

    it('updates SAMPLE RATE/GAIN/PPM CORRECTION and toggles BIAS-TEE as the operator edits tuning', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      await wrapper.find('[aria-label="Sample rate in Hz"]').setValue(3000000)
      await wrapper.find('[aria-label="Gain in decibels"]').setValue(12.5)
      await wrapper.find('[aria-label="Frequency correction in parts per million"]').setValue(7)
      expect(
        (wrapper.find('[aria-label="Sample rate in Hz"]').element as HTMLInputElement).value,
      ).toBe('3000000')
      expect(
        (wrapper.find('[aria-label="Gain in decibels"]').element as HTMLInputElement).value,
      ).toBe('12.5')
      expect(
        (
          wrapper.find('[aria-label="Frequency correction in parts per million"]')
            .element as HTMLInputElement
        ).value,
      ).toBe('7')
      const switches = wrapper.findAll('[role="switch"]')
      const biasTeeSwitch = switches[1]! // AGC is the first switch, BIAS-TEE the second
      expect(biasTeeSwitch.attributes('aria-checked')).toBe('false')
      await biasTeeSwitch.trigger('click')
      expect(biasTeeSwitch.attributes('aria-checked')).toBe('true')
    })

    it('shows the USB identity block from live usb data, with em-dash fallbacks for unset fields', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: {
            ...SENTRY_STATUS,
            usb: { manufacturer: 'RTL', product: null, serial: null, topology_path: null },
          },
        },
      })
      await flushPromises()
      const identity = wrapper.find('.sdr-device-usb-identity')
      expect(identity.exists()).toBe(true)
      expect(identity.text()).toContain('RTL')
      expect(identity.findAll('dd').filter((dd) => dd.text() === '—')).toHaveLength(3)
    })

    it('shows em-dash fallbacks for every USB identity field, including manufacturer, when all are unset', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: {
            ...SENTRY_STATUS,
            usb: { manufacturer: null, product: null, serial: null, topology_path: null },
          },
        },
      })
      await flushPromises()
      const identity = wrapper.find('.sdr-device-usb-identity')
      expect(identity.findAll('dd').filter((dd) => dd.text() === '—')).toHaveLength(4)
    })

    it('falls back to usb_last_known when usb is null', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: {
            ...SENTRY_STATUS,
            usb: null,
            usb_last_known: {
              manufacturer: 'RTL',
              product: 'RTL2838',
              serial: 'abc123',
              topology_path: '1-1',
            },
          },
        },
      })
      await flushPromises()
      expect(wrapper.find('.sdr-device-usb-identity').text()).toContain('RTL2838')
    })

    it('shows no USB identity block when neither usb nor usb_last_known is known', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: { ...SENTRY_STATUS, usb: null, usb_last_known: null },
        },
      })
      await flushPromises()
      expect(wrapper.find('.sdr-device-usb-identity').exists()).toBe(false)
    })

    it('offers FLASH SERIAL when Sentry flags the device as needing identification', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: { ...SENTRY_STATUS, needs_identification: true },
        },
      })
      await flushPromises()
      const flashControl = wrapper.findComponent(SdrSerialFlashControl)
      expect(flashControl.exists()).toBe(true)
      expect(flashControl.props('hostId')).toBe(3)
      expect(flashControl.props('deviceId')).toBe('rtl-9')
      flashControl.vm.$emit('flashed')
      expect(wrapper.emitted('save')).toHaveLength(1)
    })

    it('does not offer FLASH SERIAL for a manual radio even if the status flags identification', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: null,
          sentryDeviceStatus: { ...SENTRY_STATUS, needs_identification: true },
        },
      })
      await flushPromises()
      expect(wrapper.findComponent(SdrSerialFlashControl).exists()).toBe(false)
    })

    it('does not offer FLASH SERIAL when Sentry does not flag identification', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      expect(wrapper.findComponent(SdrSerialFlashControl).exists()).toBe(false)
    })

    it('loads persisted tuning via getSentryDeviceRecords when the form opens', async () => {
      mockGetSentryDeviceRecords.mockResolvedValue({
        devices: [
          {
            device_id: 'rtl-9',
            record_id: 1,
            name: 'Attic RTL',
            description: '',
            notes: '',
            antenna: '',
            output_port: 1234,
            control_port: 1235,
            enabled: true,
            visibility: 'public',
            present: true,
            state: 'streaming',
            needs_identification: false,
            identity_kind: 'serial',
            identity_key: 'abc',
            last_serial: 'abc',
            last_topology_path: '1-1',
            center_hz: 100000000,
            sample_rate: 2048000,
            gain_db: 20.5,
            gain_auto: false,
            ppm_correction: 3,
            bias_tee: true,
            direct_sampling: 2,
          },
        ],
        port_suggestion: null,
        constraints: { min_port: 1, max_port: 65535, control_port_offset: 1, reserved_ports: [] },
      })
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      expect(mockGetSentryDeviceRecords).toHaveBeenCalledWith(3)
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const sampleRateInput = wrapper.find('[aria-label="Sample rate in Hz"]')
        .element as HTMLInputElement
      expect(sampleRateInput.value).toBe('2048000')
      const gainInput = wrapper.find('[aria-label="Gain in decibels"]').element as HTMLInputElement
      expect(gainInput.value).toBe('20.5')
      const ppmInput = wrapper.find('[aria-label="Frequency correction in parts per million"]')
        .element as HTMLInputElement
      expect(ppmInput.value).toBe('3')
      const directSamplingGroup = wrapper.find('[aria-label="Direct sampling mode"]')
      expect(directSamplingGroup.findAll('.sdr-devices-enabled-btn')[2]!.classes()).toContain(
        'is-active',
      )
    })

    it('leaves tuning at its defaults when the device id is not found in the records payload', async () => {
      mockGetSentryDeviceRecords.mockResolvedValue(emptyRecordsPayload())
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const sampleRateInput = wrapper.find('[aria-label="Sample rate in Hz"]')
        .element as HTMLInputElement
      expect(sampleRateInput.value).toBe('')
    })

    it('does not write blank tuning values back to Sentry when the persisted-tuning load fails', async () => {
      mockGetSentryDeviceRecords.mockRejectedValue(new Error('offline'))
      mockPatchSentryDevice.mockResolvedValue({
        device_id: 'rtl-9',
        record_id: 1,
        name: 'Attic RTL',
        description: '',
        notes: 'roof notes',
        antenna: 'discone',
        output_port: 1234,
        control_port: 1235,
        enabled: true,
        visibility: 'public',
        present: true,
        state: 'streaming',
        needs_identification: false,
        identity_kind: 'serial',
        identity_key: 'abc',
        last_serial: 'abc',
        last_topology_path: '1-1',
      })
      mockUpdateRadio.mockResolvedValue(EXISTING_SENTRY)
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      // The load failed, so the tuning fields never received real values —
      // saving now must not stamp blanks over Sentry's stored configuration.
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      const patch = mockPatchSentryDevice.mock.calls[0]![2]
      // JSON.stringify (the real wire encoding in sentryApi.ts) drops an
      // `undefined`-valued key entirely, so Sentry's stored value survives —
      // assert the value stays undefined rather than a literal blank/0/null.
      expect(patch.sample_rate).toBeUndefined()
      expect(patch.gain_db).toBeUndefined()
    })

    it('tolerates a non-Error rejection from getSentryDeviceRecords without crashing the form', async () => {
      // A thrown non-Error value (e.g. a raw string) is a real possibility
      // from an arbitrary rejected promise — the fallback message covers it.
      mockGetSentryDeviceRecords.mockRejectedValue('offline')
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      // The form still renders and functions normally despite the failed load.
      expect(wrapper.find('.sdr-devices-form-error').exists()).toBe(false)
      expect(wrapper.findAll('.sdr-devices-form-input')[0]!.element).toBeTruthy()
    })

    it('fills in tuning defaults for any field Sentry omits from an otherwise-found record', async () => {
      mockGetSentryDeviceRecords.mockResolvedValue({
        devices: [
          {
            device_id: 'rtl-9',
            record_id: 1,
            name: 'Attic RTL',
            description: '',
            notes: '',
            antenna: '',
            output_port: null,
            control_port: null,
            enabled: true,
            visibility: 'public',
            present: true,
            state: 'streaming',
            needs_identification: false,
            identity_kind: 'serial',
            identity_key: 'abc',
            last_serial: 'abc',
            last_topology_path: '1-1',
            // Every optional tuning field left unset — each must fall back to
            // its own default rather than the record's absent value.
          },
        ],
        port_suggestion: null,
        constraints: { min_port: 1, max_port: 65535, control_port_offset: 1, reserved_ports: [] },
      })
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      // output_port fell back to the form's existing value (from radio.port)
      // rather than being blanked by the record's null.
      const outputPortInput = wrapper.find('[aria-label="Output IQ port"]')
        .element as HTMLInputElement
      expect(outputPortInput.value).toBe('1234')
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const sampleRateInput = wrapper.find('[aria-label="Sample rate in Hz"]')
        .element as HTMLInputElement
      expect(sampleRateInput.value).toBe('')
      const directSamplingGroup = wrapper.find('[aria-label="Direct sampling mode"]')
      expect(directSamplingGroup.findAll('.sdr-devices-enabled-btn')[0]!.classes()).toContain(
        'is-active',
      ) // OFF (0) default
    })

    it('requires a name before saving a Sentry-backed device', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.findAll('.sdr-devices-form-input')[0]!.setValue('')
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Name is required.')
      expect(mockPatchSentryDevice).not.toHaveBeenCalled()
    })

    it('PATCHes /api/sdr/sentry-hosts/... for a Sentry-backed radio, then syncs the mirrored radio row', async () => {
      mockPatchSentryDevice.mockResolvedValue({
        device_id: 'rtl-9',
        record_id: 1,
        name: 'Attic RTL',
        description: '',
        notes: 'roof notes',
        antenna: 'discone',
        output_port: 4321,
        control_port: 4322,
        enabled: true,
        visibility: 'private',
        present: true,
        state: 'streaming',
        needs_identification: false,
        identity_kind: 'serial',
        identity_key: 'abc',
        last_serial: 'abc',
        last_topology_path: '1-1',
      })
      mockUpdateRadio.mockResolvedValue(EXISTING_SENTRY)
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(mockPatchSentryDevice).toHaveBeenCalledWith(
        3,
        'rtl-9',
        expect.objectContaining({
          name: 'Attic RTL',
          enabled: true,
          visibility: 'public',
          notes: 'roof notes',
          antenna: 'discone',
          output_port: 1234,
        }),
      )
      expect(mockUpdateRadio).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          name: 'Attic RTL',
          port: 4321,
          visibility: 'private',
          sentry_host_id: 3,
          sentry_device_id: 'rtl-9',
        }),
      )
      expect(wrapper.emitted('save')).toHaveLength(1)
    })

    it('omits output_port from the patch when it is null (a device with no assigned port yet)', async () => {
      // `form.outputPort` always initialises from the radio's own numeric
      // `port`, so it cannot go null through normal typing (an emptied input
      // becomes `''`, not null) — this exercises the null-coalescing guard
      // directly, the same defensive path the tuning fields rely on.
      mockPatchSentryDevice.mockResolvedValue({
        device_id: 'rtl-9',
        record_id: 1,
        name: 'Attic RTL',
        description: '',
        notes: '',
        antenna: '',
        output_port: null,
        control_port: null,
        enabled: true,
        visibility: 'public',
        present: true,
        state: 'streaming',
        needs_identification: false,
        identity_kind: 'serial',
        identity_key: 'abc',
        last_serial: 'abc',
        last_topology_path: '1-1',
      })
      mockUpdateRadio.mockResolvedValue(EXISTING_SENTRY)
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      ;(wrapper.vm as unknown as { form: { outputPort: number | null } }).form.outputPort = null
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      const patch = mockPatchSentryDevice.mock.calls[0]![2]
      expect(patch.output_port).toBeUndefined()
    })

    it("falls back to the radio's existing port when Sentry's response omits output_port", async () => {
      mockPatchSentryDevice.mockResolvedValue({
        device_id: 'rtl-9',
        record_id: 1,
        name: 'Attic RTL',
        description: '',
        notes: '',
        antenna: '',
        output_port: null,
        control_port: null,
        enabled: true,
        visibility: 'public',
        present: true,
        state: 'streaming',
        needs_identification: false,
        identity_kind: 'serial',
        identity_key: 'abc',
        last_serial: 'abc',
        last_topology_path: '1-1',
      })
      mockUpdateRadio.mockResolvedValue(EXISTING_SENTRY)
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(mockUpdateRadio).toHaveBeenCalledWith(
        12,
        expect.objectContaining({ port: EXISTING_SENTRY.port }),
      )
    })

    it('omits gain_db from the patch while automatic gain control is on', async () => {
      mockPatchSentryDevice.mockResolvedValue({
        device_id: 'rtl-9',
        record_id: 1,
        name: 'Attic RTL',
        description: '',
        notes: '',
        antenna: '',
        output_port: 1234,
        control_port: 1235,
        enabled: true,
        visibility: 'public',
        present: true,
        state: 'streaming',
        needs_identification: false,
        identity_kind: 'serial',
        identity_key: 'abc',
        last_serial: 'abc',
        last_topology_path: '1-1',
      })
      mockUpdateRadio.mockResolvedValue(EXISTING_SENTRY)
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const agcSwitch = wrapper.find('[role="switch"]')
      await agcSwitch.trigger('click')
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      const patch = mockPatchSentryDevice.mock.calls[0]![2]
      expect(patch.gain_db).toBeUndefined()
      expect(patch).toMatchObject({ gain_auto: true })
    })

    it("surfaces Sentry's rejection verbatim, including the conflicting device id, without flattening it", async () => {
      mockPatchSentryDevice.mockRejectedValue(
        new SentryApiRequestError(
          409,
          'port_conflict',
          'Port 1234 is already in use by device rtl-3.',
          { conflicting_device_id: 'rtl-3' },
        ),
      )
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe(
        'Port 1234 is already in use by device rtl-3.',
      )
      expect(wrapper.emitted('save')).toBeUndefined()
      expect(mockUpdateRadio).not.toHaveBeenCalled()
    })

    it('falls back to a generic save-failed message for a non-SentryApiRequestError failure', async () => {
      mockPatchSentryDevice.mockRejectedValue(new Error('boom'))
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-devices-btn--primary').trigger('click')
      await flushPromises()
      expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Save failed.')
    })

    it('does nothing when saveSentryBackedDevice is invoked without a Sentry-backed radio', async () => {
      // `save()` only calls into this branch when `isSentryBacked` is true,
      // which requires a radio with both Sentry ids set — so this guard can
      // never be reached by clicking SAVE. Exercised directly to prove the
      // early return holds rather than throwing on a null radio.
      const wrapper = mount(SdrDeviceForm, { props: { radio: null } })
      await flushPromises()
      await (
        wrapper.vm as unknown as { saveSentryBackedDevice: () => Promise<void> }
      ).saveSentryBackedDevice()
      expect(mockPatchSentryDevice).not.toHaveBeenCalled()
    })

    it('toggles DIRECT SAMPLING via click and ArrowRight keyboard', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const group = wrapper.find('[aria-label="Direct sampling mode"]')
      const options = group.findAll('.sdr-devices-enabled-btn')
      expect(options[0]!.classes()).toContain('is-active') // OFF is the default
      await options[1]!.trigger('click')
      expect(options[1]!.classes()).toContain('is-active')
      await options[1]!.trigger('keydown', { key: 'ArrowRight' })
      expect(options[2]!.attributes('aria-checked')).toBe('true')
    })

    it('disables the GAIN field while automatic gain control is on', async () => {
      const wrapper = mount(SdrDeviceForm, {
        props: { radio: EXISTING_SENTRY, sentryDeviceStatus: SENTRY_STATUS },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      const gainInput = wrapper.find('[aria-label="Gain in decibels"]')
      expect(gainInput.attributes('disabled')).toBeUndefined()
      await wrapper.find('[role="switch"]').trigger('click')
      expect(gainInput.attributes('disabled')).toBeDefined()
    })

    it('has no accessibility violations with tuning and USB identity expanded', async () => {
      mockGetSentryDeviceRecords.mockResolvedValue(emptyRecordsPayload())
      const wrapper = mount(SdrDeviceForm, {
        props: {
          radio: EXISTING_SENTRY,
          sentryDeviceStatus: {
            ...SENTRY_STATUS,
            needs_identification: true,
            usb: { manufacturer: 'RTL', product: 'RTL2838', serial: 'abc', topology_path: '1-1' },
          },
        },
      })
      await flushPromises()
      await wrapper.find('.sdr-ef-settings-toggle').trigger('click')
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })
  })
})
