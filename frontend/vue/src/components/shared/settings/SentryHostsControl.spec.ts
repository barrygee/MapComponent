import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SentryHostsControl from './SentryHostsControl.vue'
import SentryHostForm from './SentryHostForm.vue'
import { SENTRY_HOSTS_CHANGED_EVENT } from '@/composables/sdrDeviceEvents'
import { useSettingsStore } from '@/stores/settings'
import type { SentryHost } from '@/services/sentryApi'

vi.mock('@/services/sentryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sentryApi')>()
  return {
    ...actual,
    listSentryHosts: vi.fn(),
    deleteSentryHost: vi.fn(),
  }
})

import { listSentryHosts, deleteSentryHost } from '@/services/sentryApi'

const mockListSentryHosts = vi.mocked(listSentryHosts)
const mockDeleteSentryHost = vi.mocked(deleteSentryHost)

const REACHABLE_HOST: SentryHost = {
  id: 5,
  name: 'Roof Pi',
  address: '192.168.1.50',
  port: 8000,
  enabled: true,
  auth_token_set: false,
  created_at: 0,
  last_seen_at: 100,
  last_error: null,
  reachable: true,
  api_version: '1.0.0',
}

const UNREACHABLE_HOST: SentryHost = {
  ...REACHABLE_HOST,
  id: 9,
  name: null,
  reachable: false,
  last_error: 'Connection refused',
}

describe('SentryHostsControl', () => {
  beforeEach(() => {
    // The form's MORE disclosure reads appStore.isOnline to decide
    // whether the site map can load, so these mounts need an active Pinia.
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an empty message when no Sentry hosts are registered', async () => {
    mockListSentryHosts.mockResolvedValue([])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    expect(wrapper.find('.sdr-devices-empty').text()).toContain('No Sentry hosts registered')
  })

  it('lists a registered host, falling back to its address when unlabelled', async () => {
    mockListSentryHosts.mockResolvedValue([UNREACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    expect(wrapper.find('.sdr-device-info').text()).toContain('192.168.1.50')
  })

  it("renders an unreachable host's last_error rather than showing nothing", async () => {
    mockListSentryHosts.mockResolvedValue([UNREACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    expect(wrapper.find('.sentry-host-error').text()).toBe('— Connection refused')
    expect(wrapper.find('.sdr-status-dot--disconnected').exists()).toBe(true)
  })

  it('shows no last_error line for a reachable host', async () => {
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    expect(wrapper.find('.sentry-host-error').exists()).toBe(false)
    expect(wrapper.find('.sdr-status-dot--connected').exists()).toBe(true)
  })

  it('opens and closes the edit form for a host', async () => {
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn[title="Edit"]').trigger('click')
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(true)
    await wrapper.find('.sdr-device-btn[title="Edit"]').trigger('click')
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
  })

  it('opens and toggles closed a blank form via ADD SENTRY', async () => {
    mockListSentryHosts.mockResolvedValue([])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-devices-add-btn').trigger('click')
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(true)
    await wrapper.find('.sdr-devices-add-btn').trigger('click')
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
  })

  it('closes the blank ADD SENTRY form when it emits cancel', async () => {
    mockListSentryHosts.mockResolvedValue([])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-devices-add-btn').trigger('click')
    mockListSentryHosts.mockClear()
    wrapper.findComponent(SentryHostForm).vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
    expect(mockListSentryHosts).not.toHaveBeenCalled()
  })

  it('reloads and broadcasts sdr:sentry-hosts-changed when the form emits save', async () => {
    const changed = vi.fn()
    document.addEventListener(SENTRY_HOSTS_CHANGED_EVENT, changed)
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn[title="Edit"]').trigger('click')
    mockListSentryHosts.mockClear()
    wrapper.findComponent(SentryHostForm).vm.$emit('save')
    await flushPromises()
    expect(mockListSentryHosts).toHaveBeenCalled()
    expect(changed).toHaveBeenCalled()
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
    document.removeEventListener(SENTRY_HOSTS_CHANGED_EVENT, changed)
  })

  it('closes the form without reloading when it emits cancel', async () => {
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn[title="Edit"]').trigger('click')
    mockListSentryHosts.mockClear()
    wrapper.findComponent(SentryHostForm).vm.$emit('cancel')
    await flushPromises()
    expect(mockListSentryHosts).not.toHaveBeenCalled()
    expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
  })

  it('confirms then deletes a host and broadcasts the change', async () => {
    const changed = vi.fn()
    document.addEventListener(SENTRY_HOSTS_CHANGED_EVENT, changed)
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    mockDeleteSentryHost.mockResolvedValue(undefined)
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn--danger').trigger('click')
    expect(wrapper.find('.sdr-device-confirm').exists()).toBe(true)
    await wrapper.find('.sdr-device-confirm-btn--yes').trigger('click')
    await flushPromises()
    expect(mockDeleteSentryHost).toHaveBeenCalledWith(5)
    expect(changed).toHaveBeenCalled()
    expect(wrapper.find('.sdr-device-confirm').exists()).toBe(false)
    document.removeEventListener(SENTRY_HOSTS_CHANGED_EVENT, changed)
  })

  it('cancels a pending delete with NO', async () => {
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn--danger').trigger('click')
    const noButton = wrapper.findAll('.sdr-device-confirm-btn').at(-1)!
    await noButton.trigger('click')
    expect(wrapper.find('.sdr-device-confirm').exists()).toBe(false)
    expect(mockDeleteSentryHost).not.toHaveBeenCalled()
  })

  it('leaves the confirm row up so the operator can retry when delete fails', async () => {
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    mockDeleteSentryHost.mockRejectedValue(new Error('offline'))
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    await wrapper.find('.sdr-device-btn--danger').trigger('click')
    await wrapper.find('.sdr-device-confirm-btn--yes').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-device-confirm').exists()).toBe(true)
  })

  it('keeps the previous host list when a background poll reload fails', async () => {
    vi.useFakeTimers()
    mockListSentryHosts.mockResolvedValueOnce([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await vi.runOnlyPendingTimersAsync()
    expect(wrapper.find('.sdr-device-info').text()).toContain('192.168.1.50')
    mockListSentryHosts.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(5000)
    // The failed poll is swallowed and the previously loaded host stays shown.
    expect(wrapper.find('.sdr-device-info').text()).toContain('192.168.1.50')
  })

  it('re-lists hosts on the 5s reachability poll', async () => {
    vi.useFakeTimers()
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    mount(SentryHostsControl)
    await vi.runOnlyPendingTimersAsync()
    mockListSentryHosts.mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockListSentryHosts).toHaveBeenCalledTimes(1)
  })

  it('skips an overlapping poll tick while a previous refresh is still in flight', async () => {
    vi.useFakeTimers()
    let resolveFirst: (() => void) | null = null
    mockListSentryHosts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve([REACHABLE_HOST])
        }),
    )
    mount(SentryHostsControl)
    await vi.runOnlyPendingTimersAsync()
    expect(mockListSentryHosts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    // The first sweep never resolved, so the guard must have skipped this tick.
    expect(mockListSentryHosts).toHaveBeenCalledTimes(1)
    resolveFirst!()
    await flushPromises()
  })

  it('clears the poll interval on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  describe('opening a host from a map marker', () => {
    it('expands the requested host once the list holding it has loaded', async () => {
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      const settingsStore = useSettingsStore()
      settingsStore.openSentryHost(REACHABLE_HOST.id)
      const wrapper = mount(SentryHostsControl)
      await flushPromises()
      expect(wrapper.findComponent(SentryHostForm).props('host')).toMatchObject({
        id: REACHABLE_HOST.id,
      })
    })

    it('acts on a request that arrives after it is already mounted', async () => {
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      const settingsStore = useSettingsStore()
      const wrapper = mount(SentryHostsControl)
      await flushPromises()
      expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
      settingsStore.openSentryHost(REACHABLE_HOST.id)
      await flushPromises()
      expect(wrapper.findComponent(SentryHostForm).exists()).toBe(true)
    })

    it('clears the request once acted on, so the row can be closed again', async () => {
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      const settingsStore = useSettingsStore()
      settingsStore.openSentryHost(REACHABLE_HOST.id)
      const wrapper = mount(SentryHostsControl)
      await flushPromises()
      expect(settingsStore.focusSentryHostId).toBeNull()
      // With the request cleared, the edit toggle closes the row rather than
      // the watch immediately re-opening it.
      await wrapper.find('button[aria-label="Edit Sentry host"]').trigger('click')
      await flushPromises()
      expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
    })

    it('scrolls the requested host into view', async () => {
      const scrollSpy = vi.fn()
      // jsdom has no layout, so scrollIntoView is not implemented on elements.
      Element.prototype.scrollIntoView = scrollSpy
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      useSettingsStore().openSentryHost(REACHABLE_HOST.id)
      mount(SentryHostsControl)
      await flushPromises()
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('waits rather than acting on a host the list does not hold', async () => {
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      const settingsStore = useSettingsStore()
      settingsStore.openSentryHost(4242) // deleted host, or a stale marker
      const wrapper = mount(SentryHostsControl)
      await flushPromises()
      expect(wrapper.findComponent(SentryHostForm).exists()).toBe(false)
      // The request is kept, not discarded: the host may still arrive on a
      // later poll (this one just has not loaded it yet).
      expect(settingsStore.focusSentryHostId).toBe(4242)
    })

    it('cancels a pending delete confirmation when a host is opened from a marker', async () => {
      mockListSentryHosts.mockResolvedValue([REACHABLE_HOST])
      const settingsStore = useSettingsStore()
      const wrapper = mount(SentryHostsControl)
      await flushPromises()
      await wrapper.find('button[aria-label="Delete Sentry host"]').trigger('click')
      expect(wrapper.find('.sdr-device-confirm').exists()).toBe(true)
      settingsStore.openSentryHost(REACHABLE_HOST.id)
      await flushPromises()
      expect(wrapper.find('.sdr-device-confirm').exists()).toBe(false)
      expect(wrapper.findComponent(SentryHostForm).exists()).toBe(true)
    })
  })

  it('has no accessibility violations', async () => {
    mockListSentryHosts.mockResolvedValue([UNREACHABLE_HOST])
    const wrapper = mount(SentryHostsControl)
    await flushPromises()
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
