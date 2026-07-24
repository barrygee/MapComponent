import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrDecodeMuteToggleControl from './SdrDecodeMuteToggleControl.vue'
import { useSdrStore } from '@/stores/sdr'

vi.mock('@/services/settingsApi', () => ({
  put: vi.fn(),
  getNamespace: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
}))
import * as settingsApi from '@/services/settingsApi'

describe('SdrDecodeMuteToggleControl', () => {
  beforeEach(() => {
    // The store seeds the flag from localStorage, so clear it to guarantee the
    // default-on starting point for each test.
    localStorage.clear()
    setActivePinia(createPinia())
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    vi.mocked(settingsApi.put).mockResolvedValue(undefined)
  })

  it('renders the switch reflecting the store default (on)', async () => {
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')
  })

  it('leaves the toggle on when the backend has no muteAudioWhileDecoding value', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({ somethingElse: 1 })
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(useSdrStore().muteAudioWhileDecoding).toBe(true)
  })

  it('hydrates the toggle and store from the DB on mount', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({ muteAudioWhileDecoding: false })
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(useSdrStore().muteAudioWhileDecoding).toBe(false)
  })

  it('mirrors the change into the store immediately and stages the DB write', async () => {
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    const sdr = useSdrStore()
    await wrapper.find('[role="switch"]').trigger('click')
    // No deferMirror: a decode already running must react to the switch at once.
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(sdr.muteAudioWhileDecoding).toBe(false)
    const staged = wrapper.emitted('stage')
    expect(staged).toHaveLength(1)
    await (staged![0]![0] as () => unknown)()
    expect(settingsApi.put).toHaveBeenCalledWith('sdr', 'muteAudioWhileDecoding', false)
  })

  it('re-syncs when a new config is uploaded', async () => {
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({ muteAudioWhileDecoding: false })
    document.dispatchEvent(new CustomEvent('sentinel:config-uploaded'))
    await flushPromises()
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  it('removes the config-uploaded listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('sentinel:config-uploaded', expect.any(Function))
  })

  it('has no accessibility violations', async () => {
    const wrapper = mount(SdrDecodeMuteToggleControl)
    await flushPromises()
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
