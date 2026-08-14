import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrSentryDeviceRow from './SdrSentryDeviceRow.vue'
import type { SentryDeviceStatus } from '@/services/sentryApi'

function buildDevice(overrides: Partial<SentryDeviceStatus> = {}): SentryDeviceStatus {
  return {
    device_id: 'usb:1/2',
    name: '',
    present: true,
    state: 'detected',
    state_reason: null,
    enabled: true,
    visibility: 'public',
    notes: '',
    antenna: '',
    needs_identification: false,
    output: null,
    usb: null,
    usb_last_known: null,
    ...overrides,
  }
}

describe('SdrSentryDeviceRow', () => {
  it('falls back to the device id when the device has no name', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ name: '' }), adding: false },
    })
    expect(wrapper.find('.sdr-device-info').text()).toContain('usb:1/2')
  })

  it('shows the device name in preference to the device id when present', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ name: 'RTL 1' }), adding: false },
    })
    expect(wrapper.find('.sdr-device-info').text()).toContain('RTL 1')
    expect(wrapper.find('.sdr-device-info').text()).not.toContain('usb:1/2')
  })

  it('renders the uppercased state with no parenthetical when there is no state reason', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ state: 'streaming', state_reason: null }), adding: false },
    })
    expect(wrapper.find('.sdr-sentry-device-state').text()).toBe('STREAMING')
  })

  it('appends the state reason in parentheses when present', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({ state: 'error', state_reason: 'usb reset' }),
        adding: false,
      },
    })
    expect(wrapper.find('.sdr-sentry-device-state').text()).toBe('ERROR (usb reset)')
  })

  it('passes the device present flag through to the status dot', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ present: false }), adding: false },
    })
    expect(wrapper.find('.sdr-status-dot--disconnected').exists()).toBe(true)
  })

  it('disables the ADD button and explains why when Sentry has not allocated an output port', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ output: null }), adding: false },
    })
    const button = wrapper.find('.sdr-devices-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe(
      'Sentry has not assigned this device an output port yet',
    )
    expect(button.text()).toBe('ADD')
  })

  it('enables the ADD button with no title once Sentry has allocated an output port', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({ output: { iq_port: 1, control_port: 2, host: '10.0.0.1' } }),
        adding: false,
      },
    })
    const button = wrapper.find('.sdr-devices-btn')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('title')).toBeUndefined()
  })

  it('refuses to mirror a private device, and says why', () => {
    // Private is the operator saying on the Sentry side that this dongle is not
    // for sharing. Mirroring it would contradict that, and the resulting radio
    // would fail to connect for a reason nothing in Sentinel explains.
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({
          output: { iq_port: 1, control_port: 2, host: '10.0.0.1' },
          visibility: 'private',
        }),
        adding: false,
      },
    })
    const button = wrapper.find('.sdr-devices-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('private on its Sentry')
  })

  it('refuses to mirror a disabled device, and says why', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({
          output: { iq_port: 1, control_port: 2, host: '10.0.0.1' },
          enabled: false,
        }),
        adding: false,
      },
    })
    const button = wrapper.find('.sdr-devices-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('disabled on its Sentry')
  })

  it('still shows the row for a private device', () => {
    // The row stays: this is the management view, and hiding it is what would
    // make the very toggle that flips the state unreachable.
    const wrapper = mount(SdrSentryDeviceRow, {
      props: { device: buildDevice({ visibility: 'private' }), adding: false },
    })
    expect(wrapper.text()).toContain(buildDevice().name)
  })

  it('disables the ADD button and shows a busy label while an add request is in flight', () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({ output: { iq_port: 1, control_port: 2, host: '10.0.0.1' } }),
        adding: true,
      },
    })
    const button = wrapper.find('.sdr-devices-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('ADDING…')
  })

  it('emits add when the ADD button is clicked while addable', async () => {
    const wrapper = mount(SdrSentryDeviceRow, {
      props: {
        device: buildDevice({ output: { iq_port: 1, control_port: 2, host: '10.0.0.1' } }),
        adding: false,
      },
    })
    await wrapper.find('.sdr-devices-btn').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const wrapper = mount(SdrSentryDeviceRow, { props: { device: buildDevice(), adding: false } })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
