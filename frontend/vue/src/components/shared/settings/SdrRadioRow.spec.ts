import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrRadioRow from './SdrRadioRow.vue'
import SdrDeviceForm from './SdrDeviceForm.vue'
import type { SdrRadioRecord } from '@/services/sdrRadiosApi'
import type { SentryDeviceStatus } from '@/services/sentryApi'

// SdrRadioRow's own concern is the row chrome; it renders a real SdrDeviceForm
// when open, so its service calls must be neutralised the same way
// SdrDeviceForm.spec.ts does, rather than pulled in as a side effect here.
vi.mock('@/services/sdrRadiosApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sdrRadiosApi')>()
  return { ...actual, listRadios: vi.fn(), createRadio: vi.fn(), updateRadio: vi.fn() }
})
vi.mock('@/services/sentryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sentryApi')>()
  return { ...actual, getSentryDeviceRecords: vi.fn() }
})

import { getSentryDeviceRecords } from '@/services/sentryApi'

const mockGetSentryDeviceRecords = vi.mocked(getSentryDeviceRecords)

const MANUAL_RADIO: SdrRadioRecord = {
  id: 1,
  name: 'Roof',
  host: '10.0.0.1',
  port: 1234,
  description: '',
  enabled: true,
  bandwidth: null,
  rf_gain: null,
  agc: null,
  sentry_host_id: null,
  sentry_device_id: null,
  notes: '',
  antenna: '',
  visibility: 'public',
}

const SENTRY_DEVICE_STATUS: SentryDeviceStatus = {
  device_id: 'rtl-1',
  name: 'Attic RTL',
  present: true,
  state: 'streaming',
  state_reason: null,
  enabled: true,
  visibility: 'public',
  notes: '',
  antenna: '',
  needs_identification: false,
  output: { iq_port: 1234, control_port: 1235, host: '192.168.1.50' },
  usb: null,
  usb_last_known: null,
}

describe('SdrRadioRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSentryDeviceRecords.mockResolvedValue({
      devices: [],
      port_suggestion: null,
      constraints: { min_port: 1, max_port: 65535, control_port_offset: 1, reserved_ports: [] },
    })
  })

  it('renders the radio name, host, and port', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: false },
    })
    expect(wrapper.find('.sdr-device-info').text()).toContain('Roof')
    expect(wrapper.find('.sdr-device-info').text()).toContain('10.0.0.1:1234')
  })

  it('shows a connected status dot when connected is true', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: true, open: false, confirming: false },
    })
    expect(wrapper.find('.sdr-status-dot--connected').exists()).toBe(true)
  })

  it('shows a disconnected status dot when connected is false', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: false, open: false, confirming: false },
    })
    expect(wrapper.find('.sdr-status-dot--disconnected').exists()).toBe(true)
  })

  it('shows neither connected nor disconnected styling while status is unknown', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: false },
    })
    expect(wrapper.find('.sdr-status-dot--connected').exists()).toBe(false)
    expect(wrapper.find('.sdr-status-dot--disconnected').exists()).toBe(false)
  })

  it('emits toggle-edit when the edit button is clicked', async () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: false },
    })
    await wrapper.find('.sdr-device-btn[title="Edit"]').trigger('click')
    expect(wrapper.emitted('toggle-edit')).toHaveLength(1)
  })

  it('emits start-delete when the delete button is clicked', async () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: false },
    })
    await wrapper.find('.sdr-device-btn--danger').trigger('click')
    expect(wrapper.emitted('start-delete')).toHaveLength(1)
  })

  it('hides the edit/delete buttons and dims the row while confirming a delete', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: true },
    })
    expect(wrapper.find('.sdr-device-btn[title="Edit"]').exists()).toBe(false)
    expect(wrapper.find('.sdr-device-btn--danger').exists()).toBe(false)
    expect(wrapper.find('.sdr-device-confirm').exists()).toBe(true)
    expect(wrapper.find('.sdr-device-info').attributes('style')).toContain('opacity: 0.4')
  })

  it('emits confirm-delete and cancel-delete from the confirm row', async () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: true },
    })
    await wrapper.find('.sdr-device-confirm-btn--yes').trigger('click')
    expect(wrapper.emitted('confirm-delete')).toHaveLength(1)
    await wrapper.findAll('.sdr-device-confirm-btn').at(-1)!.trigger('click')
    expect(wrapper.emitted('cancel-delete')).toHaveLength(1)
  })

  it('does not render the edit form when closed', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: false, confirming: false },
    })
    expect(wrapper.findComponent(SdrDeviceForm).exists()).toBe(false)
  })

  it('renders the edit form with the radio and Sentry device status forwarded when open', () => {
    const wrapper = mount(SdrRadioRow, {
      props: {
        radio: MANUAL_RADIO,
        connected: null,
        open: true,
        confirming: false,
        sentryDeviceStatus: SENTRY_DEVICE_STATUS,
      },
    })
    const form = wrapper.findComponent(SdrDeviceForm)
    expect(form.exists()).toBe(true)
    expect(form.props('radio')).toEqual(MANUAL_RADIO)
    expect(form.props('sentryDeviceStatus')).toEqual(SENTRY_DEVICE_STATUS)
  })

  it('re-emits save and cancel-edit from the nested form', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: null, open: true, confirming: false },
    })
    const form = wrapper.findComponent(SdrDeviceForm)
    form.vm.$emit('save')
    expect(wrapper.emitted('save')).toHaveLength(1)
    form.vm.$emit('cancel')
    expect(wrapper.emitted('cancel-edit')).toHaveLength(1)
  })

  it('has no accessibility violations', () => {
    const wrapper = mount(SdrRadioRow, {
      props: { radio: MANUAL_RADIO, connected: true, open: false, confirming: false },
    })
    return axe(wrapper.html(), { rules: { region: { enabled: false } } }).then((results) => {
      expect(results).toHaveNoViolations()
    })
  })
})

describe('a radio whose Sentry device is unavailable', () => {
  /**
   * The state that used to be invisible: the dongle is unplugged, disabled or
   * replugged elsewhere, and the only way to find out was to connect and get a
   * bare failure. The row now says so before the operator tries.
   */
  const unavailable = (reason: string): SdrRadioRecord => ({
    ...MANUAL_RADIO,
    sentry_host_id: 1,
    sentry_device_id: 'serial:AAA',
    device_available: false,
    unavailable_reason: reason,
  })

  const mountRow = (radio: SdrRadioRecord) =>
    mount(SdrRadioRow, {
      props: { radio, connected: false, open: false, confirming: false },
    })

  it('shows the reason it cannot be used', () => {
    const wrapper = mountRow(unavailable('The dongle is unplugged.'))

    expect(wrapper.find('.sdr-device-unavailable').text()).toBe('The dongle is unplugged.')
  })

  it('dims the row so it reads as out of service', () => {
    const wrapper = mountRow(unavailable('The dongle is unplugged.'))

    expect(wrapper.find('.sdr-device-info--unavailable').exists()).toBe(true)
  })

  it('still shows the radio rather than hiding it', () => {
    // It is still the operator's radio to keep, rename or delete — a loose USB
    // plug must not make their configuration disappear.
    const wrapper = mountRow(unavailable('Its Sentry no longer has this device.'))

    expect(wrapper.text()).toContain('Roof')
    expect(wrapper.find('[aria-label="Edit device"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Delete device"]').exists()).toBe(true)
  })

  it('says nothing for an available radio', () => {
    const wrapper = mountRow({ ...MANUAL_RADIO, device_available: true })

    expect(wrapper.find('.sdr-device-unavailable').exists()).toBe(false)
    expect(wrapper.find('.sdr-device-info--unavailable').exists()).toBe(false)
  })

  it('treats an absent flag as available', () => {
    // An older backend, or a manual radio with no Sentry device behind it —
    // greying either out would be a lie.
    const wrapper = mountRow(MANUAL_RADIO)

    expect(wrapper.find('.sdr-device-info--unavailable').exists()).toBe(false)
  })

  it('hides the reason while a delete confirmation is showing', () => {
    // The confirm/cancel controls take the row; two competing messages there
    // would be noise at the moment the operator is answering a question.
    const wrapper = mount(SdrRadioRow, {
      props: {
        radio: unavailable('The dongle is unplugged.'),
        connected: false,
        open: false,
        confirming: true,
      },
    })

    expect(wrapper.find('.sdr-device-unavailable').exists()).toBe(false)
  })

  it('has no accessibility violations', async () => {
    // `region` disabled as elsewhere in this file: a row mounted on its own is
    // not inside the settings panel's landmarks, which is a fact about the test
    // harness rather than the component.
    const wrapper = mountRow(unavailable('The dongle is unplugged.'))

    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
