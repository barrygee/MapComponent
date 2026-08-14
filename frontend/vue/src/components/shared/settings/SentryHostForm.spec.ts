import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SentryHostForm from './SentryHostForm.vue'
import { SentryApiRequestError, type SentryHost } from '@/services/sentryApi'

vi.mock('@/services/sentryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sentryApi')>()
  return {
    ...actual,
    createSentryHost: vi.fn(),
    updateSentryHost: vi.fn(),
    testSentryHost: vi.fn(),
  }
})

import { createSentryHost, updateSentryHost, testSentryHost } from '@/services/sentryApi'

const mockCreateSentryHost = vi.mocked(createSentryHost)
const mockUpdateSentryHost = vi.mocked(updateSentryHost)
const mockTestSentryHost = vi.mocked(testSentryHost)

const EXISTING_HOST: SentryHost = {
  id: 5,
  name: 'Roof Pi',
  address: '192.168.1.50',
  port: 8000,
  enabled: true,
  auth_token_set: true,
  created_at: 0,
  last_seen_at: 100,
  last_error: null,
  reachable: true,
  api_version: '1.0.0',
}

function makeSavedHost(overrides: Partial<SentryHost> = {}): SentryHost {
  return { ...EXISTING_HOST, ...overrides }
}

describe('SentryHostForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults a new form to port 8000 and an empty address/label', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    const inputs = wrapper.findAll('.sdr-devices-form-input')
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('8000')
  })

  it('prefills the form from an existing host', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    const inputs = wrapper.findAll('.sdr-devices-form-input')
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('192.168.1.50')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('Roof Pi')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('8000')
  })

  it('shows the "password set" placeholder for a host with a stored password', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    const tokenInput = wrapper.findAll('.sdr-devices-form-input')[3]!
    expect(tokenInput.attributes('placeholder')).toBe('Password set — leave blank to keep it')
  })

  it('shows a plain optional-token placeholder for a host without a stored token', async () => {
    const wrapper = mount(SentryHostForm, {
      props: { host: { ...EXISTING_HOST, auth_token_set: false } },
    })
    const tokenInput = wrapper.findAll('.sdr-devices-form-input')[3]!
    expect(tokenInput.attributes('placeholder')).toBe("The password set on that Sentry's console")
  })

  it('does not render TEST CONNECTION for a new (unsaved) host', () => {
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    expect(
      wrapper.findAll('.sdr-devices-btn').some((btn) => btn.text() === 'TEST CONNECTION'),
    ).toBe(false)
  })

  it('requires an IP address before saving a new host', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    expect(wrapper.find('.sdr-devices-form-error').text()).toBe('IP address is required.')
    expect(mockCreateSentryHost).not.toHaveBeenCalled()
  })

  it('creates a new host and probes it after a successful save', async () => {
    mockCreateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    const inputs = wrapper.findAll('.sdr-devices-form-input')
    await inputs[0]!.setValue('10.0.0.9')
    await inputs[1]!.setValue('Attic')
    await inputs[3]!.setValue('secret-token')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockCreateSentryHost).toHaveBeenCalledWith({
      name: 'Attic',
      address: '10.0.0.9',
      port: 8000,
      auth_token: 'secret-token',
    })
    expect(mockTestSentryHost).toHaveBeenCalledWith(5)
    expect(wrapper.find('.sentry-host-probe').text()).toContain('ok')
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('sends an explicit null name when the label is left blank on create', async () => {
    mockCreateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.findAll('.sdr-devices-form-input')[0]!.setValue('10.0.0.9')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockCreateSentryHost).toHaveBeenCalledWith(
      expect.objectContaining({ name: null, auth_token: '' }),
    )
  })

  it('updates an existing host, omitting auth_token when left blank', async () => {
    mockUpdateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    const patch = mockUpdateSentryHost.mock.calls[0]![1]
    expect(mockUpdateSentryHost).toHaveBeenCalledWith(5, expect.anything())
    expect(patch).not.toHaveProperty('auth_token')
    expect(patch).toMatchObject({ name: 'Roof Pi', address: '192.168.1.50', port: 8000 })
  })

  it('includes auth_token in the patch when the operator types a new one', async () => {
    mockUpdateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    await wrapper.findAll('.sdr-devices-form-input')[3]!.setValue('new-token')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockUpdateSentryHost.mock.calls[0]![1]).toMatchObject({ auth_token: 'new-token' })
  })

  it('clears the label to null on update when the field is emptied', async () => {
    mockUpdateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    await wrapper.findAll('.sdr-devices-form-input')[1]!.setValue('')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockUpdateSentryHost.mock.calls[0]![1]).toMatchObject({ name: null })
  })

  it('defaults the port to 8000 when cleared to a falsy value', async () => {
    mockUpdateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    await wrapper.findAll('.sdr-devices-form-input')[2]!.setValue(0)
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockUpdateSentryHost.mock.calls[0]![1]).toMatchObject({ port: 8000 })
  })

  it('defaults the port to 8000 on create when cleared to a falsy value', async () => {
    mockCreateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockResolvedValue({ reachable: true, detail: 'ok' })
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    const inputs = wrapper.findAll('.sdr-devices-form-input')
    await inputs[0]!.setValue('10.0.0.9')
    await inputs[2]!.setValue(0)
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(mockCreateSentryHost).toHaveBeenCalledWith(expect.objectContaining({ port: 8000 }))
  })

  it("shows Sentry's rejection message verbatim, including which device holds a conflicting port", async () => {
    mockCreateSentryHost.mockRejectedValue(
      new SentryApiRequestError(
        409,
        'port_conflict',
        'Port 1234 is already in use by device rtl-3.',
        { conflicting_device_id: 'rtl-3' },
      ),
    )
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.findAll('.sdr-devices-form-input')[0]!.setValue('10.0.0.9')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-devices-form-error').text()).toBe(
      'Port 1234 is already in use by device rtl-3.',
    )
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('falls back to a generic save-failed message for a non-SentryApiRequestError failure', async () => {
    mockCreateSentryHost.mockRejectedValue(new Error('boom'))
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.findAll('.sdr-devices-form-input')[0]!.setValue('10.0.0.9')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-devices-form-error').text()).toBe('Save failed.')
  })

  it('does not fail the save when the post-save probe itself fails', async () => {
    mockCreateSentryHost.mockResolvedValue(makeSavedHost())
    mockTestSentryHost.mockRejectedValue(new Error('probe unreachable'))
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.findAll('.sdr-devices-form-input')[0]!.setValue('10.0.0.9')
    await wrapper.find('.sdr-devices-btn--primary').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.find('.sentry-host-probe').exists()).toBe(false)
    expect(wrapper.find('.sdr-devices-form-error').exists()).toBe(false)
  })

  it('probes an existing host on TEST CONNECTION and shows an unreachable result', async () => {
    mockTestSentryHost.mockResolvedValue({ reachable: false, detail: 'Connection refused' })
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    const testButton = wrapper
      .findAll('.sdr-devices-btn')
      .find((button) => button.text() === 'TEST CONNECTION')!
    await testButton.trigger('click')
    await flushPromises()
    expect(mockTestSentryHost).toHaveBeenCalledWith(5)
    expect(wrapper.find('.sentry-host-probe--fail').text()).toContain('Connection refused')
  })

  it('reports a probe failure inline when TEST CONNECTION throws', async () => {
    mockTestSentryHost.mockRejectedValue(new Error('network down'))
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    const testButton = wrapper
      .findAll('.sdr-devices-btn')
      .find((button) => button.text() === 'TEST CONNECTION')!
    await testButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('.sentry-host-probe--fail').text()).toContain(
      'Could not reach Sentinel to run the probe.',
    )
  })

  it('does nothing when probeExisting is invoked without a stored host', async () => {
    // TEST CONNECTION is only ever rendered when a host is present
    // (`v-if="host"`), so this defensive guard cannot be reached by clicking
    // through the UI. Exercised directly to prove it returns without probing.
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await (wrapper.vm as unknown as { probeExisting: () => Promise<void> }).probeExisting()
    expect(mockTestSentryHost).not.toHaveBeenCalled()
    expect(wrapper.find('.sentry-host-probe').exists()).toBe(false)
  })

  it('emits cancel when CANCEL is clicked', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: null } })
    await wrapper.find('.sdr-devices-btn').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('focuses the address field shortly after mount', async () => {
    vi.useFakeTimers()
    const wrapper = mount(SentryHostForm, {
      props: { host: null },
      attachTo: document.body,
    })
    const addressInput = wrapper.findAll('.sdr-devices-form-input')[0]!.element as HTMLInputElement
    vi.runAllTimers()
    expect(document.activeElement).toBe(addressInput)
    wrapper.unmount()
  })

  it('has no accessibility violations', async () => {
    const wrapper = mount(SentryHostForm, { props: { host: EXISTING_HOST } })
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
