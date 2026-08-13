import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useAirStore } from '@/stores/air'
import { useAirNotifStore } from '@/stores/airNotif'
import { ADSB_POLL_INTERVAL_MS } from '@/constants/adsb'

const { locationRef, overheadInstance, detectorInstance } = vi.hoisted(() => ({
  locationRef: { value: null as null | { lon: number; lat: number; accuracy: number } },
  overheadInstance: { setEnabled: vi.fn(), setRadiusNm: vi.fn() },
  detectorInstance: { process: vi.fn() },
}))

vi.mock('@/composables/useUserLocation', () => ({
  useUserLocation: () => ({ location: locationRef }),
}))
vi.mock('@/components/air/controls/overhead-zone/OverheadAlertsTracker', () => ({
  // Regular function so it is constructable with `new`.
  OverheadAlertsTracker: vi.fn(function () {
    return overheadInstance
  }),
}))
vi.mock('@/components/air/controls/adsb/AircraftEventDetector', () => ({
  AircraftEventDetector: vi.fn(function () {
    return detectorInstance
  }),
}))
vi.mock('@/components/air/controls/adsb/adsbParse', () => ({
  parseAircraftList: vi.fn((list: unknown[]) => list),
}))

async function loadService() {
  return (await import('./useAirAlertsService')).useAirAlertsService()
}

describe('useAirAlertsService', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    localStorage.clear()
    locationRef.value = null
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ac: [] }) }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not poll when nothing requires it', async () => {
    const service = await loadService()
    service.start()
    expect(fetch).not.toHaveBeenCalled()
    service.stop()
  })

  it('start is idempotent', async () => {
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const service = await loadService()
    service.start()
    const { OverheadAlertsTracker } =
      await import('@/components/air/controls/overhead-zone/OverheadAlertsTracker')
    service.start() // second call must early-return
    expect(OverheadAlertsTracker).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('polls when overhead alerts are enabled and processes the response', async () => {
    locationRef.value = { lon: -0.1, lat: 51.5, accuracy: 0 }
    // Response without an `ac` field exercises the `data.ac || []` fallback.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const air = useAirStore()
    air.setOverlay('overheadAlertsMil', true)
    const service = await loadService()
    service.start()
    await vi.advanceTimersByTimeAsync(0) // let the immediate _poll run
    expect(fetch).toHaveBeenCalledWith(
      '/api/air/adsb/point/51.5000/-0.1000/250',
      expect.any(Object),
    )
    expect(detectorInstance.process).toHaveBeenCalled()
    service.stop()
  })

  it('skips the request when there is no location', async () => {
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const service = await loadService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).not.toHaveBeenCalled()
    service.stop()
  })

  it('ignores a non-ok response', async () => {
    locationRef.value = { lon: 0, lat: 0, accuracy: 0 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const service = await loadService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(detectorInstance.process).not.toHaveBeenCalled()
    service.stop()
  })

  it('swallows fetch errors', async () => {
    locationRef.value = { lon: 0, lat: 0, accuracy: 0 }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')))
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const service = await loadService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    // The rejection was swallowed: no aircraft were processed and nothing threw.
    expect(detectorInstance.process).not.toHaveBeenCalled()
    service.stop()
  })

  it('reacts to overhead enable/radius changes and aircraft opt-ins', async () => {
    const air = useAirStore()
    const airNotif = useAirNotifStore()
    const service = await loadService()
    service.start()
    expect(overheadInstance.setEnabled).toHaveBeenCalledTimes(1) // initial

    air.setOverlay('overheadAlertsCivil', true)
    await nextTick()
    expect(overheadInstance.setEnabled).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(0) // no location yet, but polling started

    air.setOverheadAlertRadiusNm(25)
    await nextTick()
    expect(overheadInstance.setRadiusNm).toHaveBeenCalledWith(25)

    airNotif.enable('abc')
    await nextTick()
    // count went >0 → still polling; turning everything off stops it.
    air.setOverlay('overheadAlertsCivil', false)
    airNotif.clear()
    await nextTick()
    service.stop()
  })

  it('wires the overhead-tracker callbacks and the poll interval', async () => {
    locationRef.value = { lon: -0.1, lat: 51.5, accuracy: 0 }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ac: [
            {
              hex: 'abc',
              flight: 'BAW1',
              r: 'G-XX',
              alt: 30000,
              gs: 400,
              military: false,
              lat: 51.5,
              lon: -0.1,
            },
          ],
        }),
      }),
    )
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const { OverheadAlertsTracker } =
      await import('@/components/air/controls/overhead-zone/OverheadAlertsTracker')
    const service = await loadService()
    service.start()
    await vi.advanceTimersByTimeAsync(0) // initial poll populates the latest list

    const args = vi.mocked(OverheadAlertsTracker).mock.calls[0]!
    const featureCollection = args[1] as () => { features: unknown[] }
    const locationGetter = args[2] as () => { lon: number; lat: number } | null
    const clickRouter = args[3] as (hex: string) => void

    expect(featureCollection().features).toHaveLength(1)

    expect(locationGetter()).toEqual({ lon: -0.1, lat: 51.5 })
    locationRef.value = null
    expect(locationGetter()).toBeNull()

    // Click router: no handler registered → no-op; then routes to a handler.
    expect(() => clickRouter('abc')).not.toThrow()
    const { registerAircraftClickHandler } = await import('@/stores/notifications')
    const handler = vi.fn()
    registerAircraftClickHandler(handler)
    clickRouter('abc')
    expect(handler).toHaveBeenCalledWith('abc')

    await vi.advanceTimersByTimeAsync(ADSB_POLL_INTERVAL_MS) // fire the interval tick
    service.stop()
  })

  it('stop tears down and allows a restart', async () => {
    const air = useAirStore()
    air.setOverlay('overheadAlertsCivil', true)
    const service = await loadService()
    service.start()
    service.stop()
    const { OverheadAlertsTracker } =
      await import('@/components/air/controls/overhead-zone/OverheadAlertsTracker')
    service.start() // _started reset → constructs again
    expect(OverheadAlertsTracker).toHaveBeenCalledTimes(2)
    service.stop()
  })
})
