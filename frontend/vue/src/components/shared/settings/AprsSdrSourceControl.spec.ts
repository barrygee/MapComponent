import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'

import AprsSdrSourceControl from './AprsSdrSourceControl.vue'
import * as sdrRadiosApi from '@/services/sdrRadiosApi'
import { useSdrStore } from '@/stores/sdr'

/**
 * Tests for choosing which radio decodes APRS.
 *
 * The consequences here are hardware ones: the choice starts and stops a decode
 * bridge on a real dongle, and it reserves that dongle away from the SDR panel.
 * So the tests care about *when* that happens (staged, on APPLY CHANGES — never
 * as a side effect of the control reading back what the backend already had),
 * about a refusal being reported rather than swallowed, and about an operator
 * always being able to tell why a list is empty.
 */

function radio(overrides: Partial<sdrRadiosApi.SdrRadioRecord> = {}): sdrRadiosApi.SdrRadioRecord {
  return {
    id: 1,
    name: 'Attic Dongle',
    host: '192.168.5.67',
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
    device_available: true,
    unavailable_reason: '',
    ...overrides,
  }
}

/** Mount with the radio list the backend would return, and let it settle. */
async function mountControl(radios: sdrRadiosApi.SdrRadioRecord[]) {
  vi.spyOn(sdrRadiosApi, 'listRadios').mockResolvedValue(radios)
  const wrapper = mount(AprsSdrSourceControl)
  await flushPromises()
  return wrapper
}

/** Pick a row by the value the dropdown carries on it. */
async function pick(wrapper: ReturnType<typeof mount>, value: string) {
  await wrapper.find(`[data-value="${value}"]`).trigger('mousedown')
  await flushPromises()
}

/** Run whatever the control handed the panel to apply. */
async function applyStaged(wrapper: ReturnType<typeof mount>) {
  const staged = wrapper.emitted('stage')
  const apply = staged![staged!.length - 1]![0] as () => Promise<unknown>
  return apply()
}

/** Make `/api/settings/sdr` report which radio the backend has APRS decode on. */
function persistAprsRadio(radioId: number | null) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(radioId === null ? {} : { aprs_radio_id: radioId }), {
      status: 200,
    }),
  )
}

function optionLabels(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[role="option"]').map((option) => option.text())
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  // The control hydrates from the settings API on mount — the DB, not the
  // store's localStorage cache, decides what is decoding. Nothing persisted
  // unless a test calls persistAprsRadio().
  persistAprsRadio(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AprsSdrSourceControl', () => {
  it('offers every enabled, available radio', async () => {
    const wrapper = await mountControl([
      radio({ id: 1, name: 'Attic Dongle' }),
      radio({ id: 2, name: 'Shed Dongle' }),
    ])

    expect(optionLabels(wrapper)).toEqual(['Attic Dongle', 'Shed Dongle'])
  })

  it('falls back to the radio id when a radio has no name', async () => {
    const wrapper = await mountControl([radio({ id: 4, name: '' })])
    expect(optionLabels(wrapper)).toEqual(['Radio 4'])
  })

  it('omits a disabled radio', async () => {
    const wrapper = await mountControl([
      radio({ id: 1, name: 'Running' }),
      radio({ id: 2, name: 'Switched Off', enabled: false }),
    ])

    expect(optionLabels(wrapper)).toEqual(['Running'])
  })

  it('omits a radio whose Sentry device is unavailable', async () => {
    const wrapper = await mountControl([
      radio({ id: 1, name: 'Present' }),
      radio({ id: 2, name: 'Unplugged', device_available: false }),
    ])

    expect(optionLabels(wrapper)).toEqual(['Present'])
  })

  it('survives a radio list that cannot be fetched', async () => {
    vi.spyOn(sdrRadiosApi, 'listRadios').mockRejectedValue(new Error('offline'))
    const wrapper = mount(AprsSdrSourceControl)
    await flushPromises()

    expect(optionLabels(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('Add a radio under Settings → SDR first')
  })

  describe('the chosen radio', () => {
    it('pre-selects the radio the backend says is decoding', async () => {
      const wrapper = await mountControl([radio({ id: 2, name: 'Shed Dongle' })])
      // hydrateAprsFromDb resolved before mount finished; drive it via the store
      // the same way a reload would.
      expect(wrapper.find('[role="option"][aria-selected="true"]').exists()).toBe(false)

      persistAprsRadio(2)
      const remounted = await mountControl([radio({ id: 2, name: 'Shed Dongle' })])
      expect(remounted.find('[role="option"][aria-selected="true"]').attributes('data-value')).toBe(
        '2',
      )
    })

    it('stages nothing when it is only reading back what is already decoding', async () => {
      persistAprsRadio(1)
      const wrapper = await mountControl([radio({ id: 1 })])

      expect(wrapper.emitted('stage')).toBeUndefined()
    })

    it('keeps a withdrawn radio listed, labelled, and explains it', async () => {
      persistAprsRadio(1)
      const wrapper = await mountControl([
        radio({ id: 1, name: 'Unplugged', device_available: false }),
      ])

      expect(optionLabels(wrapper)).toContain('Unplugged (unavailable)')
      expect(wrapper.text()).toContain('no longer available')
    })

    it('offers a way to turn decode off once one is chosen', async () => {
      persistAprsRadio(1)
      const wrapper = await mountControl([radio({ id: 1 })])

      expect(optionLabels(wrapper)[0]).toBe('Not set — APRS decode off')
    })

    it('has no "off" row while nothing is chosen', async () => {
      const wrapper = await mountControl([radio({ id: 1 })])
      expect(wrapper.find('[data-value=""]').exists()).toBe(false)
    })
  })

  describe('applying a choice', () => {
    it('starts decode on APPLY CHANGES, not on the pick itself', async () => {
      const wrapper = await mountControl([radio({ id: 3, name: 'Shed Dongle' })])
      const store = useSdrStore()
      const startSpy = vi.spyOn(store, 'startAprs').mockResolvedValue(true)

      await pick(wrapper, '3')
      expect(startSpy).not.toHaveBeenCalled()

      await applyStaged(wrapper)
      expect(startSpy).toHaveBeenCalledWith(3)
      expect(store.aprsEnabled).toBe(true)
    })

    it('reports a refusal so the panel does not claim it saved', async () => {
      const wrapper = await mountControl([radio({ id: 3 })])
      const store = useSdrStore()
      vi.spyOn(store, 'startAprs').mockResolvedValue(false)

      await pick(wrapper, '3')
      await expect(applyStaged(wrapper)).rejects.toThrow('could not be started')
    })

    it('stops decode when the choice is cleared', async () => {
      persistAprsRadio(1)
      const wrapper = await mountControl([radio({ id: 1 })])
      const store = useSdrStore()
      const stopSpy = vi.spyOn(store, 'stopAprs').mockResolvedValue(true)

      await pick(wrapper, '')
      await applyStaged(wrapper)

      expect(stopSpy).toHaveBeenCalledWith(1)
      expect(store.aprsEnabled).toBe(false)
    })

    it('reports a refusal to stop, but still drops the local flag', async () => {
      persistAprsRadio(1)
      const wrapper = await mountControl([radio({ id: 1 })])
      const store = useSdrStore()
      vi.spyOn(store, 'stopAprs').mockResolvedValue(false)

      await pick(wrapper, '')
      await expect(applyStaged(wrapper)).rejects.toThrow('could not be stopped')
      expect(store.aprsEnabled).toBe(false)
    })

    it('does nothing to stop decode that was never running', async () => {
      // Reachable by picking a radio and then the "off" row before applying.
      const wrapper = await mountControl([radio({ id: 1 })])
      const store = useSdrStore()
      vi.spyOn(store, 'startAprs').mockResolvedValue(true)
      const stopSpy = vi.spyOn(store, 'stopAprs').mockResolvedValue(true)

      await pick(wrapper, '1')
      await pick(wrapper, '')
      await applyStaged(wrapper)

      expect(stopSpy).not.toHaveBeenCalled()
    })

    it('hands decode over without stopping the previous radio first', async () => {
      // The backend runs a single bridge, so starting elsewhere is the handover.
      persistAprsRadio(1)
      const wrapper = await mountControl([radio({ id: 1 }), radio({ id: 2, name: 'Shed' })])
      const store = useSdrStore()
      const startSpy = vi.spyOn(store, 'startAprs').mockResolvedValue(true)
      const stopSpy = vi.spyOn(store, 'stopAprs').mockResolvedValue(true)

      await pick(wrapper, '2')
      await applyStaged(wrapper)

      expect(startSpy).toHaveBeenCalledWith(2)
      expect(stopSpy).not.toHaveBeenCalled()
    })
  })

  describe('when there is nothing to pick', () => {
    it('sends the operator to SDR settings when no radios exist', async () => {
      const wrapper = await mountControl([])

      expect(wrapper.text()).toContain('Add a radio under Settings → SDR first')
      expect(wrapper.find('.settings-dropdown-text').text()).toBe(
        'No radios — add one in SDR settings',
      )
    })

    it('says so when every radio is disabled or unavailable', async () => {
      const wrapper = await mountControl([radio({ enabled: false })])

      expect(wrapper.text()).toContain('all disabled or unavailable')
      expect(wrapper.find('.settings-dropdown-text').text()).toBe('No enabled radios available')
    })

    it('disables the dropdown when it has nothing to offer', async () => {
      const wrapper = await mountControl([])
      expect((wrapper.find('[role="combobox"]').element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('keeping the list fresh', () => {
    it('re-reads the radios on a timer', async () => {
      vi.useFakeTimers()
      const listSpy = vi.spyOn(sdrRadiosApi, 'listRadios').mockResolvedValue([radio()])
      mount(AprsSdrSourceControl)
      await vi.runOnlyPendingTimersAsync()
      listSpy.mockClear()

      await vi.advanceTimersByTimeAsync(5000)
      expect(listSpy).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('stops refreshing once unmounted', async () => {
      vi.useFakeTimers()
      const listSpy = vi.spyOn(sdrRadiosApi, 'listRadios').mockResolvedValue([radio()])
      const wrapper = mount(AprsSdrSourceControl)
      await vi.runOnlyPendingTimersAsync()
      wrapper.unmount()
      listSpy.mockClear()

      await vi.advanceTimersByTimeAsync(15000)
      expect(listSpy).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('never starts a timer when it is unmounted mid-load', async () => {
      // onMounted awaits two requests; unmounting inside that window runs the
      // teardown first, leaving nothing to clear a timer created afterwards.
      vi.useFakeTimers()
      const listSpy = vi.spyOn(sdrRadiosApi, 'listRadios').mockResolvedValue([radio()])
      const wrapper = mount(AprsSdrSourceControl)
      wrapper.unmount()
      await vi.runOnlyPendingTimersAsync()
      listSpy.mockClear()

      await vi.advanceTimersByTimeAsync(15000)
      expect(listSpy).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  it('has no accessibility violations', async () => {
    // `region` is disabled: the control always renders inside the Settings
    // panel's landmark, never as a bare page fragment like this.
    const wrapper = await mountControl([radio()])
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
