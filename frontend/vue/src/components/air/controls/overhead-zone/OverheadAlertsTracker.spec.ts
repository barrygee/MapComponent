import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { OverheadAlertsTracker } from './OverheadAlertsTracker'
import { useNotificationsStore } from '@/stores/notifications'

vi.mock('@/composables/useNotificationSound', () => ({
  playNotificationSound: vi.fn(),
}))

type NotificationsStore = ReturnType<typeof useNotificationsStore>

const USER = { lon: -1, lat: 51 }

/** One watched place, defaulting to the operator's own position at 10 nm. */
function zone(
  overrides: Partial<{
    id: string
    label: string
    lon: number
    lat: number
    civil: boolean
    mil: boolean
    radiusNm: number
  }> = {},
) {
  return {
    id: 'user',
    label: 'MY LOCATION',
    lon: USER.lon,
    lat: USER.lat,
    civil: false,
    mil: false,
    radiusNm: 10,
    ...overrides,
  }
}

// A feature roughly at the user's location (well inside a 10 nm radius).
function aircraftFeature(
  hex: string,
  overrides: Partial<{
    coords: [number, number]
    alt_baro: number
    gs: number
    military: boolean
    flight: string
    r: string
  }> = {},
) {
  return {
    geometry: {
      type: 'Point' as const,
      coordinates: overrides.coords ?? ([-1, 51.01] as [number, number]),
    },
    properties: {
      hex,
      alt_baro: overrides.alt_baro ?? 5000,
      gs: overrides.gs ?? 250,
      military: overrides.military ?? false,
      flight: overrides.flight,
      r: overrides.r,
    },
  }
}

function overheadCount(notifications: NotificationsStore): number {
  return notifications.items.filter((item) => item.type === 'overhead').length
}

let notifications: NotificationsStore

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  vi.useFakeTimers()
  notifications = useNotificationsStore()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OverheadAlertsTracker.setZones', () => {
  it('raises a civil overhead alert for an in-zone civil aircraft when civil is enabled', () => {
    const features = { features: [aircraftFeature('abc123')] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    tracker.setZones([zone({ civil: true, mil: false })])

    expect(overheadCount(notifications)).toBe(1)
    expect(notifications.items[0]!.hex).toBe('abc123')
    tracker.destroy()
  })

  it('ignores civil aircraft when only military alerts are enabled', () => {
    const features = { features: [aircraftFeature('abc123', { military: false })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    tracker.setZones([zone({ civil: false, mil: true })])

    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('raises a military alert for an in-zone military aircraft', () => {
    const features = { features: [aircraftFeature('mil001', { military: true })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    tracker.setZones([zone({ civil: false, mil: true })])

    expect(overheadCount(notifications)).toBe(1)
    tracker.destroy()
  })

  it('does nothing when called with the same enabled flags twice', () => {
    const getFeatures = vi.fn(() => ({ features: [aircraftFeature('abc123')] }))
    const tracker = new OverheadAlertsTracker(notifications, getFeatures)

    tracker.setZones([zone({ civil: true, mil: false })])
    const callsAfterFirst = getFeatures.mock.calls.length
    tracker.setZones([zone({ civil: true, mil: false })])
    // No state change → no extra immediate tick.
    expect(getFeatures.mock.calls.length).toBe(callsAfterFirst)
    tracker.destroy()
  })

  it('clears all overhead notifications when alerts are turned off', () => {
    const features = { features: [aircraftFeature('abc123')] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(1)

    tracker.setZones([])
    expect(overheadCount(notifications)).toBe(0)
  })

  it('sweeps lingering, untracked overhead notifications when turned off', () => {
    // An overhead notification the tracker did not create (e.g. left from a
    // previous session) must still be cleared by the disable sweep.
    notifications.add({ type: 'overhead', title: 'stale' })
    const tracker = new OverheadAlertsTracker(
      notifications,
      () => ({ features: [] }),
      () => USER,
    )

    tracker.setZones([zone({ civil: true, mil: false })]) // timer on, nothing in zone
    expect(overheadCount(notifications)).toBe(1) // the stale one survives the tick

    tracker.setZones([]) // disable → sweep dismisses it
    expect(overheadCount(notifications)).toBe(0)
  })

  it('dismisses an already-tracked aircraft whose type becomes disabled', () => {
    const features = {
      features: [
        aircraftFeature('civ001', { military: false }),
        aircraftFeature('mil001', { military: true }),
      ],
    }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: true })])
    expect(overheadCount(notifications)).toBe(2)

    // Disable civil: the tracked civil aircraft must be dismissed.
    tracker.setZones([zone({ civil: false, mil: true })])
    expect(overheadCount(notifications)).toBe(1)
    expect(notifications.items.some((item) => item.hex === 'civ001')).toBe(false)
    tracker.destroy()
  })
})

describe('OverheadAlertsTracker._tick filtering', () => {
  it('skips aircraft beyond the configured radius', () => {
    const features = { features: [aircraftFeature('far001', { coords: [-1, 60] })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('skips on-ground aircraft (altitude ≤ 0)', () => {
    const features = { features: [aircraftFeature('gnd001', { alt_baro: 0 })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('skips features missing coordinates or hex, and non-numeric coordinates', () => {
    const features = {
      features: [
        {
          geometry: { type: 'Point' as const, coordinates: [-1, 51.01] as [number, number] },
          properties: { hex: '' },
        },
        {
          geometry: {
            type: 'Point' as const,
            coordinates: ['x', 51] as unknown as [number, number],
          },
          properties: { hex: 'bad' },
        },
      ],
    }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('skips military aircraft when only civil alerts are enabled', () => {
    const features = { features: [aircraftFeature('mil001', { military: true })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('treats a missing altitude as on-ground and skips it', () => {
    const features = {
      features: [
        {
          geometry: { type: 'Point' as const, coordinates: [-1, 51.01] as [number, number] },
          properties: { hex: 'noalt', military: false }, // alt_baro undefined → 0
        },
      ],
    }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('does nothing with no places to watch', () => {
    // A location with no fix, or with both classes off, is simply not in the
    // list — there is no "enabled but nowhere" state to get wrong.
    const tracker = new OverheadAlertsTracker(notifications, () => ({
      features: [aircraftFeature('abc123')],
    }))
    tracker.setZones([])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('does nothing when the feed has not arrived yet', () => {
    const tracker = new OverheadAlertsTracker(notifications, () => null)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('builds the detail string from distance, altitude and ground speed', () => {
    const features = {
      features: [aircraftFeature('abc123', { alt_baro: 12000, gs: 300, flight: 'BAW1' })],
    }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    const detail = notifications.items[0]!.detail
    expect(detail).toContain('nm')
    expect(detail).toContain('12,000 ft')
    expect(detail).toContain('300 kt')
    expect(notifications.items[0]!.title).toBe('BAW1')
    tracker.destroy()
  })

  it('omits ground speed from the detail when it is zero', () => {
    const features = { features: [aircraftFeature('abc123', { gs: 0 })] }
    const tracker = new OverheadAlertsTracker(notifications, () => features)
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(notifications.items[0]!.detail).not.toContain('kt')
    tracker.destroy()
  })

  it('falls back to registration then hex for the title', () => {
    const regOnly = { features: [aircraftFeature('abc123', { r: 'G-TEST' })] }
    const tracker = new OverheadAlertsTracker(
      notifications,
      () => regOnly,
      () => USER,
    )
    tracker.setZones([zone({ civil: true, mil: false })])
    expect(notifications.items[0]!.title).toBe('G-TEST')
    tracker.destroy()
  })
})

describe('OverheadAlertsTracker tracking lifecycle', () => {
  it('updates an existing notification on the next tick instead of adding a new one', () => {
    let gs = 200
    const features = { features: [aircraftFeature('abc123', { gs: 0 })] }
    Object.defineProperty(features.features[0]!.properties, 'gs', { get: () => gs })
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(1)
    const firstDetail = notifications.items[0]!.detail

    gs = 400
    vi.advanceTimersByTime(2000)
    expect(overheadCount(notifications)).toBe(1) // still one — updated, not duplicated
    expect(notifications.items[0]!.detail).not.toBe(firstDetail)
    tracker.destroy()
  })

  it('dismisses a tracked aircraft once it drops out of the feed', () => {
    let present = true
    const getFeatures = () =>
      present ? { features: [aircraftFeature('abc123')] } : { features: [] }
    const tracker = new OverheadAlertsTracker(notifications, getFeatures)

    tracker.setZones([zone({ civil: true, mil: false })])
    expect(overheadCount(notifications)).toBe(1)

    present = false
    vi.advanceTimersByTime(2000)
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('invokes the alert click callback with the aircraft hex', () => {
    const onAlertClick = vi.fn()
    const features = { features: [aircraftFeature('abc123')] }
    const tracker = new OverheadAlertsTracker(notifications, () => features, onAlertClick)

    tracker.setZones([zone({ civil: true, mil: false })])
    notifications.items[0]!.clickAction!()
    expect(onAlertClick).toHaveBeenCalledWith('abc123')
    tracker.destroy()
  })

  it('polls again on the interval', () => {
    const getFeatures = vi.fn(() => ({ features: [aircraftFeature('abc123')] }))
    const tracker = new OverheadAlertsTracker(notifications, getFeatures)
    tracker.setZones([zone({ civil: true, mil: false })])
    const callsAfterEnable = getFeatures.mock.calls.length

    vi.advanceTimersByTime(2000)
    expect(getFeatures.mock.calls.length).toBeGreaterThan(callsAfterEnable)
    tracker.destroy()
  })
})

describe('OverheadAlertsTracker zone radius', () => {
  it('ignores non-finite or non-positive radii', () => {
    const features = { features: [aircraftFeature('abc123', { coords: [-1, 51.2] })] } // ~12 nm away
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    tracker.setZones([zone({ civil: true, mil: false })])
    // Default 10 nm radius → the ~12 nm aircraft is out of range.
    expect(overheadCount(notifications)).toBe(0)
    tracker.destroy()
  })

  it('widens the radius so a previously out-of-range aircraft qualifies', () => {
    const features = { features: [aircraftFeature('abc123', { coords: [-1, 51.2] })] } // ~12 nm away
    const tracker = new OverheadAlertsTracker(notifications, () => features)

    // The same aircraft qualifies once the place watches further out.
    tracker.setZones([zone({ civil: true, mil: false, radiusNm: 30 })])
    expect(overheadCount(notifications)).toBe(1)
    tracker.destroy()
  })
})

describe('OverheadAlertsTracker.destroy', () => {
  it('stops the timer and clears tracked state', () => {
    const getFeatures = vi.fn(() => ({ features: [aircraftFeature('abc123')] }))
    const tracker = new OverheadAlertsTracker(notifications, getFeatures)
    tracker.setZones([zone({ civil: true, mil: false })])

    tracker.destroy()
    const callsAfterDestroy = getFeatures.mock.calls.length
    vi.advanceTimersByTime(10000)
    // Timer cleared: no further polling.
    expect(getFeatures.mock.calls.length).toBe(callsAfterDestroy)
  })

  it('is a safe no-op when destroyed before ever being enabled', () => {
    const tracker = new OverheadAlertsTracker(
      notifications,
      () => ({ features: [] }),
      () => USER,
    )
    // No timer was started → the destroy guard takes its no-timer branch.
    expect(() => tracker.destroy()).not.toThrow()
  })
})
