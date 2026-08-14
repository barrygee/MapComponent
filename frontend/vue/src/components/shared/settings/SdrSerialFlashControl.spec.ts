import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrSerialFlashControl from './SdrSerialFlashControl.vue'

vi.mock('@/services/sentryApi', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/sentryApi')>('@/services/sentryApi')
  return { ...actual, flashSentryDeviceSerial: vi.fn() }
})
import { flashSentryDeviceSerial, SentryApiRequestError } from '@/services/sentryApi'

describe('SdrSerialFlashControl', () => {
  beforeEach(() => {
    vi.mocked(flashSentryDeviceSerial).mockReset()
  })

  it('shows only the FLASH SERIAL button and no confirmation form before it is clicked', () => {
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    expect(wrapper.find('.sdr-serial-flash-confirm').exists()).toBe(false)
    expect(wrapper.find('button').text()).toBe('FLASH SERIAL')
  })

  it('cannot flash without first entering the confirmation step — the guard cannot be bypassed', async () => {
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    // The CONFIRM PERMANENT WRITE button, the serial input, and its warning
    // simply do not exist in the DOM until FLASH SERIAL is clicked — there is
    // no way to reach confirmFlash() without going through this step first.
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('CONFIRM PERMANENT WRITE')
    expect(flashSentryDeviceSerial).not.toHaveBeenCalled()

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.sdr-serial-flash-confirm').exists()).toBe(true)
    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.text()).toContain('CONFIRM PERMANENT WRITE')
  })

  it('rejects an invalid (empty or whitespace-only) serial — the flash button stays disabled and no request is sent', async () => {
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    expect(confirmButton.attributes('disabled')).toBeDefined()

    await wrapper.find('input').setValue('   ')
    expect(confirmButton.attributes('disabled')).toBeDefined()

    await confirmButton.trigger('click')
    expect(flashSentryDeviceSerial).not.toHaveBeenCalled()
  })

  it("re-checks the trimmed serial inside the handler itself, not only via the button's disabled attribute", async () => {
    // Belt-and-braces: confirmFlash() bails out on a blank serial even if
    // invoked while the DOM's `disabled` attribute has not yet caught up with
    // a same-tick value change — exercised here by blanking the underlying
    // input value and clicking in the same tick, before Vue's reactive
    // re-render has re-disabled the button in the DOM, proving the in-handler
    // guard is not solely cosmetic.
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const inputElement = wrapper.find('input').element as HTMLInputElement
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!

    inputElement.value = '   '
    inputElement.dispatchEvent(new Event('input'))
    await confirmButton.trigger('click')

    expect(flashSentryDeviceSerial).not.toHaveBeenCalled()
  })

  it('enables the confirm button and trims the serial once a non-blank value is entered', async () => {
    vi.mocked(flashSentryDeviceSerial).mockResolvedValue({})
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('  AIS-01  ')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    expect(confirmButton.attributes('disabled')).toBeUndefined()

    await confirmButton.trigger('click')
    await flushPromises()
    expect(flashSentryDeviceSerial).toHaveBeenCalledWith(1, 'usb:1/2', 'AIS-01')
  })

  it('collapses the form and emits flashed after a successful flash', async () => {
    vi.mocked(flashSentryDeviceSerial).mockResolvedValue({})
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    await confirmButton.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('flashed')).toHaveLength(1)
    expect(wrapper.find('.sdr-serial-flash-confirm').exists()).toBe(false)
  })

  it('shows a busy label and disables both buttons while the flash request is in flight', async () => {
    let resolveFlash: (value: unknown) => void = () => {}
    vi.mocked(flashSentryDeviceSerial).mockReturnValue(
      new Promise((resolve) => {
        resolveFlash = resolve
      }),
    )
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    await confirmButton.trigger('click')

    expect(wrapper.findAll('button')[0]!.text()).toBe('CANCEL')
    expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')[1]!.text()).toBe('FLASHING…')
    expect(wrapper.findAll('button')[1]!.attributes('disabled')).toBeDefined()

    resolveFlash({})
    await flushPromises()
  })

  it("shows the Sentry rejection's message when the flash fails with SentryApiRequestError", async () => {
    vi.mocked(flashSentryDeviceSerial).mockRejectedValue(
      new SentryApiRequestError(409, 'serial_conflict', 'That serial is already in use.'),
    )
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    await confirmButton.trigger('click')
    await flushPromises()

    expect(wrapper.find('.sdr-devices-form-error').text()).toBe('That serial is already in use.')
    expect(wrapper.emitted('flashed')).toBeUndefined()
    // The form stays open with the entered value so the operator can retry.
    expect(wrapper.find('.sdr-serial-flash-confirm').exists()).toBe(true)
  })

  it('shows a generic failure message when the flash rejects with a non-Sentry error', async () => {
    vi.mocked(flashSentryDeviceSerial).mockRejectedValue(new Error('network down'))
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    await confirmButton.trigger('click')
    await flushPromises()

    expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Flash failed.')
  })

  it('CANCEL clears the serial value and error message and hides the confirmation form', async () => {
    vi.mocked(flashSentryDeviceSerial).mockRejectedValue(new Error('network down'))
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    await wrapper.find('input').setValue('AIS-01')
    const confirmButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('CONFIRM'))!
    await confirmButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-devices-form-error').exists()).toBe(true)

    const cancelButton = wrapper.findAll('button').find((button) => button.text() === 'CANCEL')!
    await cancelButton.trigger('click')
    expect(wrapper.find('.sdr-serial-flash-confirm').exists()).toBe(false)

    await wrapper.find('button').trigger('click')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.sdr-devices-form-error').exists()).toBe(false)
  })

  it('derives distinct, DOM-safe element ids from the device id', async () => {
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    await wrapper.find('button').trigger('click')
    const input = wrapper.find('input')
    expect(input.attributes('id')).toBe('sdr-serial-flash-usb-1-2')
    expect(input.attributes('aria-describedby')).toBe('sdr-serial-flash-warning-usb-1-2')
    expect(wrapper.find(`#${input.attributes('aria-describedby')}`).exists()).toBe(true)
  })

  it('has no accessibility violations before or after confirming', async () => {
    const wrapper = mount(SdrSerialFlashControl, { props: { hostId: 1, deviceId: 'usb:1/2' } })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()

    await wrapper.find('button').trigger('click')
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
