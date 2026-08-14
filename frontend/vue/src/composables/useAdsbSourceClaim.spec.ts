import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { useAdsbSourceClaim } from './useAdsbSourceClaim'
import * as adsbSourceApi from '@/services/adsbSourceApi'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'

/**
 * Tests for holding the Sentry dongle while AIR watches off grid.
 *
 * The behaviour worth pinning is *when* the device is held, because both
 * mistakes are costly and neither is visible: claiming while online takes
 * hardware away from something that legitimately wants it, in order to receive
 * data Sentinel is not even reading; failing to release on the way out holds a
 * dongle nobody is using until the lease lapses.
 *
 * The renewal timer matters for the same reason — it is what keeps the lease
 * alive, and a cadence taken from the wrong place would let it expire under a
 * view that is still showing aircraft.
 */

function claimResponse(overrides: Partial<adsbSourceApi.AdsbClaim> = {}): adsbSourceApi.AdsbClaim {
  return {
    source: { sentry_host_id: 1, sentry_device_id: 'serial:ADSB' },
    reservation: {
      device_id: 'serial:ADSB',
      holder: 'sentinel:me',
      label: 'Sentinel — AIR (ADS-B)',
      reserved_at: 1,
      expires_at: 120_001,
    },
    tuned: { center_hz: 1_090_000_000, sample_rate: 2_400_000 },
    renew_within_seconds: 30,
    ...overrides,
  }
}

/** Mount the composable in a throwaway component so lifecycle hooks run. */
function mountClaim() {
  const harness = defineComponent({
    setup() {
      return { claimState: useAdsbSourceClaim() }
    },
    template: '<div />',
  })
  return mount(harness)
}

let claimSpy: ReturnType<typeof vi.spyOn>
let releaseSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  claimSpy = vi
    .spyOn(adsbSourceApi, 'claimAdsbSource')
    .mockResolvedValue({ claim: claimResponse() })
  releaseSpy = vi.spyOn(adsbSourceApi, 'releaseAdsbSource').mockResolvedValue()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Put the app into off-grid mode before the composable is mounted. */
function goOffGrid() {
  useAppStore().setConnectivityMode('offgrid')
}

describe('useAdsbSourceClaim', () => {
  describe('when to hold the device', () => {
    it('claims on mount when off grid', async () => {
      goOffGrid()

      mountClaim()
      await nextTick()

      expect(claimSpy).toHaveBeenCalled()
    })

    it('does not claim while online', async () => {
      // Online air data comes from airplanes.live; claiming a dongle then would
      // take hardware away from something that wants it, to receive nothing.
      useAppStore().setConnectivityMode('online')

      mountClaim()
      await nextTick()

      expect(claimSpy).not.toHaveBeenCalled()
    })

    it("honours the air domain's own override over the app-wide mode", async () => {
      // The two must agree, or Sentinel would claim a dongle while reading
      // aircraft from the internet.
      useAppStore().setConnectivityMode('online')
      useSettingsStore().setSetting('air', 'sourceOverride', 'offgrid')

      mountClaim()
      await nextTick()

      expect(claimSpy).toHaveBeenCalled()
    })

    it('does not claim when the air override forces online', async () => {
      goOffGrid()
      useSettingsStore().setSetting('air', 'sourceOverride', 'online')

      mountClaim()
      await nextTick()

      expect(claimSpy).not.toHaveBeenCalled()
    })

    it('releases when the mode switches back to online', async () => {
      goOffGrid()
      mountClaim()
      await nextTick()

      useAppStore().setConnectivityMode('online')
      await nextTick()

      expect(releaseSpy).toHaveBeenCalled()
    })

    it('does not re-claim when an unrelated setting changes', async () => {
      // Redundant claims would hammer Sentry on every settings write; nothing
      // happens because `shouldHold` did not change.
      goOffGrid()
      mountClaim()
      await nextTick()
      claimSpy.mockClear()

      useSettingsStore().setSetting('air', 'somethingElse', true)
      await nextTick()

      expect(claimSpy).not.toHaveBeenCalled()
    })

    it('releases on unmount', async () => {
      goOffGrid()
      const wrapper = mountClaim()
      await nextTick()

      wrapper.unmount()

      expect(releaseSpy).toHaveBeenCalled()
    })
  })

  describe('keeping the lease alive', () => {
    it('renews on the cadence the server asked for', async () => {
      // The interval belongs to Sentry's TTL, not to this client — guessing
      // would either renew pointlessly often or let the lease lapse.
      goOffGrid()
      mountClaim()
      await nextTick()
      claimSpy.mockClear()

      await vi.advanceTimersByTimeAsync(30_000)

      expect(claimSpy).toHaveBeenCalledTimes(1)
    })

    it('keeps renewing for as long as it is mounted', async () => {
      goOffGrid()
      mountClaim()
      await nextTick()
      claimSpy.mockClear()

      await vi.advanceTimersByTimeAsync(90_000)

      expect(claimSpy).toHaveBeenCalledTimes(3)
    })

    it('stops renewing once unmounted', async () => {
      goOffGrid()
      const wrapper = mountClaim()
      await nextTick()
      wrapper.unmount()
      claimSpy.mockClear()

      await vi.advanceTimersByTimeAsync(120_000)

      expect(claimSpy).not.toHaveBeenCalled()
    })

    it('never forces on a renewal', async () => {
      // A timer must not quietly win a fight over hardware that it lost a
      // moment ago; taking a device is the operator's decision.
      goOffGrid()
      mountClaim()
      await nextTick()

      await vi.advanceTimersByTimeAsync(30_000)

      expect(claimSpy).not.toHaveBeenCalledWith(true)
    })
  })

  describe('reporting failures', () => {
    it('records why the claim failed', async () => {
      claimSpy.mockResolvedValue({
        error: { code: 'device_reserved', message: 'Voice decoder has it.', holder: 'other' },
      })
      goOffGrid()

      const wrapper = mountClaim()
      await nextTick()
      await nextTick()

      expect(wrapper.vm.claimState.error.value?.code).toBe('device_reserved')
    })

    it('keeps retrying after a failure', async () => {
      // A busy device or a rebooting Pi usually frees up, and the existing
      // cadence picks it up without the operator doing anything.
      claimSpy.mockResolvedValue({ error: { code: 'host_unreachable', message: 'down' } })
      goOffGrid()
      mountClaim()
      await nextTick()
      await nextTick()
      claimSpy.mockClear()

      await vi.advanceTimersByTimeAsync(60_000)

      expect(claimSpy).toHaveBeenCalled()
    })

    it('clears the error once a later attempt succeeds', async () => {
      claimSpy.mockResolvedValue({ error: { code: 'host_unreachable', message: 'down' } })
      goOffGrid()
      const wrapper = mountClaim()
      await nextTick()
      await nextTick()
      claimSpy.mockResolvedValue({ claim: claimResponse() })

      await vi.advanceTimersByTimeAsync(30_000)

      expect(wrapper.vm.claimState.error.value).toBeNull()
      expect(wrapper.vm.claimState.claim.value).not.toBeNull()
    })
  })

  describe('taking control', () => {
    it('forces the claim when the operator asks', async () => {
      goOffGrid()
      const wrapper = mountClaim()
      await nextTick()

      await wrapper.vm.claimState.takeControl()

      expect(claimSpy).toHaveBeenCalledWith(true)
    })
  })
})
