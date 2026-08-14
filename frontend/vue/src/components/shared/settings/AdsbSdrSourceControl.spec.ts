import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'

import AdsbSdrSourceControl from './AdsbSdrSourceControl.vue'
import * as adsbSourceApi from '@/services/adsbSourceApi'
import * as sentryApi from '@/services/sentryApi'

/**
 * Tests for choosing which Sentry SDR receives ADS-B.
 *
 * Two things here have real consequences. The option **value** carries both the
 * host id and the device id, and the device id contains a colon of its own
 * (`serial:ABC`) — splitting it wrongly would silently save a different device,
 * or none. And an empty list has three quite different causes (no hosts, hosts
 * that publish nothing, hosts that are unreachable), which an operator has to
 * be able to tell apart before they can fix it.
 */

function host(overrides: Partial<sentryApi.SentryHost> = {}): sentryApi.SentryHost {
  return {
    id: 1,
    name: 'Attic Pi',
    address: '192.168.5.67',
    port: 8000,
    enabled: true,
    auth_token_set: true,
    created_at: 0,
    last_seen_at: null,
    last_error: null,
    reachable: true,
    api_version: '1',
    ...overrides,
  }
}

function snapshotWith(...devices: { device_id: string; name: string }[]) {
  return {
    reachable: true,
    last_error: null,
    last_polled_at: 0,
    last_success_at: 0,
    api_version: '1',
    status: { generated_at: 0, sdrs: devices as never[] },
  } as sentryApi.SentryDeviceSnapshot
}

let setSourceSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(adsbSourceApi, 'getAdsbSource').mockResolvedValue({
    configured: false,
    sentry_host_id: null,
    sentry_device_id: null,
  })
  setSourceSpy = vi.spyOn(adsbSourceApi, 'setAdsbSource').mockResolvedValue({
    configured: true,
    sentry_host_id: 1,
    sentry_device_id: 'serial:97710286',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdsbSdrSourceControl', () => {
  it('lists every device from every enabled host', async () => {
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith(
        { device_id: 'serial:97710286', name: 'ADSB' },
        { device_id: 'usb:1-1.2', name: 'RTL-SDR-V4' },
      ),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    const options = wrapper.findAll('option').map((option) => option.text())
    expect(options).toContain('Attic Pi — ADSB')
    expect(options).toContain('Attic Pi — RTL-SDR-V4')
  })

  it('names the host alongside the device', async () => {
    // Two Pis can each have a dongle called "ADSB"; picking the wrong one would
    // tune a receiver in another room.
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([
      host({ id: 1, name: 'Attic Pi' }),
      host({ id: 2, name: 'Shed Pi' }),
    ])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:AAA', name: 'ADSB' }),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    const options = wrapper.findAll('option').map((option) => option.text())
    expect(options).toContain('Attic Pi — ADSB')
    expect(options).toContain('Shed Pi — ADSB')
  })

  it('skips hosts that are switched off', async () => {
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host({ enabled: false })])
    const devicesSpy = vi.spyOn(sentryApi, 'getSentryHostDevices')

    mount(AdsbSdrSourceControl)
    await flushPromises()

    expect(devicesSpy).not.toHaveBeenCalled()
  })

  it('survives an unreachable host rather than losing the whole list', async () => {
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([
      host({ id: 1, name: 'Dead Pi' }),
      host({ id: 2, name: 'Live Pi' }),
    ])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockImplementation(async (hostId: number) => {
      if (hostId === 1) throw new Error('unreachable')
      return snapshotWith({ device_id: 'serial:BBB', name: 'ADSB' })
    })

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    expect(wrapper.findAll('option').map((o) => o.text())).toContain('Live Pi — ADSB')
  })

  it('degrades to an empty list when Sentinel itself cannot be reached', async () => {
    vi.spyOn(sentryApi, 'listSentryHosts').mockRejectedValue(new Error('offline'))

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    expect(wrapper.text()).toContain('Add a Sentry host')
  })

  it('falls back to ids when a host and device have no names', async () => {
    // Neither name is guaranteed: a Sentry device need not be named, and a host
    // row's name is optional. Without the fallbacks the list would offer
    // "undefined — undefined".
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host({ name: null })])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:AAA', name: '' }),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    expect(wrapper.findAll('option').map((o) => o.text())).toContain('192.168.5.67 — serial:AAA')
  })

  it('tolerates a host that reports no status payload', async () => {
    // The poller reports `status: null` for a host it has not reached yet.
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue({
      reachable: false,
      last_error: null,
      last_polled_at: 0,
      last_success_at: null,
      api_version: null,
      status: null,
    } as sentryApi.SentryDeviceSnapshot)

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    expect(wrapper.text()).toContain('publish no SDRs')
  })

  it('saves nothing for a malformed selection', async () => {
    // Defensive: every value comes from an option built above, but a saved
    // setting written by hand should not be turned into a nonsense request.
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:AAA', name: 'ADSB' }),
    )
    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    const select = wrapper.find('select').element as HTMLSelectElement
    const option = document.createElement('option')
    option.value = 'not-a-number:'
    select.appendChild(option)
    await wrapper.find('select').setValue('not-a-number:')

    expect(setSourceSpy).not.toHaveBeenCalled()
  })

  it('saves the host id and device id split correctly', async () => {
    // `serial:97710286` contains a colon, so a naive split would save
    // "serial" as the device and drop the rest.
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host({ id: 7 })])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:97710286', name: 'ADSB' }),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()
    const select = wrapper.find('select')
    await select.setValue('7:serial:97710286')

    expect(setSourceSpy).toHaveBeenCalledWith(7, 'serial:97710286')
  })

  it('pre-selects the device already configured', async () => {
    vi.spyOn(adsbSourceApi, 'getAdsbSource').mockResolvedValue({
      configured: true,
      sentry_host_id: 1,
      sentry_device_id: 'serial:97710286',
    })
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:97710286', name: 'ADSB' }),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()

    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('1:serial:97710286')
  })

  it('does not save when cleared back to the placeholder', async () => {
    vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
    vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
      snapshotWith({ device_id: 'serial:AAA', name: 'ADSB' }),
    )

    const wrapper = mount(AdsbSdrSourceControl)
    await flushPromises()
    await wrapper.find('select').setValue('')

    expect(setSourceSpy).not.toHaveBeenCalled()
  })

  describe('when there is nothing to pick', () => {
    it('sends the operator to SDR settings when no hosts exist', async () => {
      vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([])

      const wrapper = mount(AdsbSdrSourceControl)
      await flushPromises()

      expect(wrapper.text()).toContain('Add a Sentry host')
    })

    it('points at device visibility when hosts publish nothing', async () => {
      // A Sentry only exports devices its operator enabled, so an empty list is
      // far more often a toggle than a missing dongle.
      vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
      vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(snapshotWith())

      const wrapper = mount(AdsbSdrSourceControl)
      await flushPromises()

      expect(wrapper.text()).toContain('publish no SDRs')
    })

    it('says nothing extra once devices are available', async () => {
      vi.spyOn(sentryApi, 'listSentryHosts').mockResolvedValue([host()])
      vi.spyOn(sentryApi, 'getSentryHostDevices').mockResolvedValue(
        snapshotWith({ device_id: 'serial:AAA', name: 'ADSB' }),
      )

      const wrapper = mount(AdsbSdrSourceControl)
      await flushPromises()

      expect(wrapper.text()).not.toContain('Add a Sentry host')
      expect(wrapper.text()).not.toContain('publish no SDRs')
    })
  })
})
