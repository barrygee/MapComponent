import { describe, it, expect, beforeEach, vi } from 'vitest'
import { REMOVED_STORAGE_KEYS, clearRemovedStorageKeys } from './removedStorageKeys'

describe('clearRemovedStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('lists the trunk-tracking keys removed with the feature', () => {
    expect([...REMOVED_STORAGE_KEYS]).toEqual(['sdrTrunkTrackingEnabled', 'sdrTrunkChannelMap'])
  })

  it('deletes every listed key', () => {
    REMOVED_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, '1'))
    clearRemovedStorageKeys()
    REMOVED_STORAGE_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull())
  })

  it('leaves keys belonging to live features alone', () => {
    // The cleanup runs before the stores hydrate, so touching a live cache key
    // would silently reset a user's setting on next load.
    localStorage.setItem('sdrShowBandPlan', '0')
    localStorage.setItem('sentinel_app_connectivityMode', 'offgrid')
    localStorage.setItem('sdrTrunkTrackingEnabled', '1')

    clearRemovedStorageKeys()

    expect(localStorage.getItem('sdrShowBandPlan')).toBe('0')
    expect(localStorage.getItem('sentinel_app_connectivityMode')).toBe('offgrid')
    expect(localStorage.getItem('sdrTrunkTrackingEnabled')).toBeNull()
  })

  it('is a no-op when the keys are already absent', () => {
    expect(() => clearRemovedStorageKeys()).not.toThrow()
    expect(localStorage.length).toBe(0)
  })

  it('is idempotent across repeated startups', () => {
    localStorage.setItem('sdrTrunkChannelMap', 'site-a.csv')
    localStorage.setItem('sdrShowBandPlan', '1')
    clearRemovedStorageKeys()
    clearRemovedStorageKeys()
    expect(localStorage.getItem('sdrTrunkChannelMap')).toBeNull()
    expect(localStorage.getItem('sdrShowBandPlan')).toBe('1')
  })

  it('swallows a storage failure rather than breaking startup', () => {
    // Private mode / blocked storage: the stale keys are inert, so failing to
    // clear them must not throw out of app startup.
    // Spy on the instance, not Storage.prototype: the test harness swaps in its
    // own in-memory storage object (see src/test/setup.ts), which a prototype
    // spy would never intercept.
    const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => clearRemovedStorageKeys()).not.toThrow()
    expect(removeItem).toHaveBeenCalled()
  })
})
