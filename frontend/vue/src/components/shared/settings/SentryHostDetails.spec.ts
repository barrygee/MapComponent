import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { axe } from 'jest-axe'
import { useAppStore } from '@/stores/app'
import type { SentryHost, SentryHostInfo } from '@/services/sentryApi'

vi.mock('@/services/sentryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sentryApi')>()
  return { ...actual, getSentryHostInfo: vi.fn() }
})

// The site map owns a real MapLibre instance; this spec only cares whether it
// is rendered, so it is stubbed out at mount instead.
vi.mock('./SentrySiteMap.vue', () => ({
  default: {
    name: 'SentrySiteMap',
    props: ['latitude', 'longitude', 'label'],
    template: '<div class="stub-site-map" :data-pos="`${latitude},${longitude}`" />',
  },
}))

import SentryHostDetails from './SentryHostDetails.vue'
import { getSentryHostInfo } from '@/services/sentryApi'

const mockGetSentryHostInfo = vi.mocked(getSentryHostInfo)

const HOST: SentryHost = {
  id: 7,
  name: 'Gateshead',
  address: '192.168.5.67',
  port: 8000,
  enabled: true,
  auth_token_set: true,
  created_at: 1_700_000_000_000,
  last_seen_at: 1_700_000_500_000,
  last_error: null,
  reachable: true,
  api_version: '1',
}

function makeInfo(overrides: Partial<SentryHostInfo> = {}): SentryHostInfo {
  return {
    ...HOST,
    detail: 'ok',
    last_polled_at: 1_700_000_400_000,
    last_success_at: 1_700_000_400_000,
    health: {
      status: 'ok',
      version: '0.1.0',
      started_at: 1_699_000_000_000,
      uptime_s: 3723,
      database: 'ok',
      hotplug: { source: 'udev', healthy: true, last_event_at: 1_699_500_000_000 },
      devices: {
        present: 2,
        configured: 2,
        streaming: 1,
        degraded: 0,
        error: 0,
        needs_identification: 0,
      },
    },
    source: {
      name: 'sentry',
      version: '0.0.9',
      host: '192.168.5.67',
      http_port: 8000,
      location: { latitude: 54.951186, longitude: -1.532995, updated_at: 1_698_000_000_000 },
    },
    location: { latitude: 54.951186, longitude: -1.532995, updated_at: 1_698_000_000_000 },
    control_port_offset: 2,
    ...overrides,
  }
}

/** Mount and expand the disclosure, resolving the info fetch. */
async function mountExpanded(host: SentryHost = HOST) {
  const wrapper = mount(SentryHostDetails, { props: { host } })
  await wrapper.find('.sentry-host-details-toggle').trigger('click')
  await flushPromises()
  return wrapper
}

/** The value rendered beside a given label, e.g. cellValue(wrapper, 'UPTIME'). */
function cellValue(wrapper: ReturnType<typeof mount>, label: string): string | null {
  const cell = wrapper
    .findAll('.ba-data-cell')
    .find((candidate) => candidate.find('.ba-data-cell-label').text() === label)
  return cell ? cell.find('.ba-data-cell-value').text() : null
}

describe('SentryHostDetails', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockGetSentryHostInfo.mockResolvedValue(makeInfo())
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('the disclosure', () => {
    it('starts collapsed and fetches nothing until it is opened', () => {
      const wrapper = mount(SentryHostDetails, { props: { host: HOST } })
      expect(wrapper.find('.sentry-host-details-toggle').attributes('aria-expanded')).toBe('false')
      expect(mockGetSentryHostInfo).not.toHaveBeenCalled()
    })

    it('fetches the host info on first expansion', async () => {
      const wrapper = await mountExpanded()
      expect(mockGetSentryHostInfo).toHaveBeenCalledWith(HOST.id)
      expect(wrapper.find('.sentry-host-details-toggle').attributes('aria-expanded')).toBe('true')
    })

    it('collapses again on a second click without refetching', async () => {
      const wrapper = await mountExpanded()
      await wrapper.find('.sentry-host-details-toggle').trigger('click')
      expect(wrapper.find('.sentry-host-details-toggle').attributes('aria-expanded')).toBe('false')
      expect(mockGetSentryHostInfo).toHaveBeenCalledTimes(1)
    })

    it('points aria-controls at the body, uniquely per host', async () => {
      const wrapper = await mountExpanded()
      const bodyId = wrapper.find('.sentry-host-details-toggle').attributes('aria-controls')
      expect(bodyId).toBe('sentry-host-details-7')
      expect(wrapper.find(`#${bodyId}`).exists()).toBe(true)
    })
  })

  describe('rendered fields', () => {
    it('renders the live health, source and device counts', async () => {
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'SOFTWARE VERSION')).toBe('0.1.0')
      expect(cellValue(wrapper, 'REPORTED NAME')).toBe('sentry')
      expect(cellValue(wrapper, 'REPORTED HOST')).toBe('192.168.5.67:8000')
      expect(cellValue(wrapper, 'CONTROL PORT OFFSET')).toBe('2')
      expect(cellValue(wrapper, 'DATABASE')).toBe('ok')
      expect(cellValue(wrapper, 'HOTPLUG')).toBe('udev — healthy')
      expect(cellValue(wrapper, 'PRESENT')).toBe('2')
      expect(cellValue(wrapper, 'STREAMING')).toBe('1')
      expect(cellValue(wrapper, 'NEEDS ID')).toBe('0')
    })

    it('renders the reported latitude and longitude to six decimal places', async () => {
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'LATITUDE')).toBe('54.951186')
      expect(cellValue(wrapper, 'LONGITUDE')).toBe('-1.532995')
    })

    // Status, address, label and console password live on the row header and
    // the form's own fields — repeating them here would be noise.
    it('omits the fields the surrounding form already shows', async () => {
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'STATUS')).toBeNull()
      expect(cellValue(wrapper, 'ADDRESS')).toBeNull()
      expect(cellValue(wrapper, 'LABEL')).toBeNull()
      expect(cellValue(wrapper, 'CONSOLE PASSWORD')).toBeNull()
    })

    it('prefers the live API version over the stored one', async () => {
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ api_version: '2' }))
      expect(cellValue(await mountExpanded(), 'API VERSION')).toBe('2')
    })

    it('falls back to the stored API version when the live read has none', async () => {
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ api_version: null }))
      expect(cellValue(await mountExpanded(), 'API VERSION')).toBe('1')
    })

    it('falls back to the source version when health carries none', async () => {
      const info = makeInfo()
      delete (info.health as Record<string, unknown>).version
      mockGetSentryHostInfo.mockResolvedValue(info)
      expect(cellValue(await mountExpanded(), 'SOFTWARE VERSION')).toBe('0.0.9')
    })

    it('reports a host whose polling is switched off', async () => {
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ enabled: false }))
      expect(cellValue(await mountExpanded({ ...HOST, enabled: false }), 'POLLING')).toBe(
        'Disabled',
      )
    })

    it('renders an em dash when neither the live nor the stored API version is known', async () => {
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ api_version: null }))
      const wrapper = await mountExpanded({ ...HOST, api_version: null })
      expect(cellValue(wrapper, 'API VERSION')).toBe('—')
    })

    it('shows the last error only when there is one', async () => {
      expect(cellValue(await mountExpanded(), 'LAST ERROR')).toBeNull()
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ last_error: 'Timed out.' }))
      expect(cellValue(await mountExpanded(), 'LAST ERROR')).toBe('Timed out.')
    })

    it('falls back to the stored last error when the live read has none', async () => {
      mockGetSentryHostInfo.mockResolvedValue(makeInfo({ last_error: null }))
      const wrapper = await mountExpanded({ ...HOST, last_error: 'Stored failure.' })
      expect(cellValue(wrapper, 'LAST ERROR')).toBe('Stored failure.')
    })
  })

  describe('formatting', () => {
    it.each([
      [59, '0m 59s'],
      [3723, '1h 2m'],
      [90_061, '1d 1h 1m'],
      [-5, '0m 00s'],
    ])('formats an uptime of %ss as %s', async (uptimeSeconds, expected) => {
      const info = makeInfo()
      ;(info.health as Record<string, unknown>).uptime_s = uptimeSeconds
      mockGetSentryHostInfo.mockResolvedValue(info)
      expect(cellValue(await mountExpanded(), 'UPTIME')).toBe(expected)
    })

    it('renders a timestamp in the viewer’s locale', async () => {
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'REGISTERED')).toBe(new Date(HOST.created_at).toLocaleString())
    })

    it('renders an em dash for a missing timestamp', async () => {
      const wrapper = await mountExpanded({ ...HOST, last_seen_at: null })
      expect(cellValue(wrapper, 'LAST SEEN')).toBe('—')
    })
  })

  describe('a Sentry that reports nothing usable', () => {
    it('renders em dashes rather than blanks when the live blocks are null', async () => {
      mockGetSentryHostInfo.mockResolvedValue(
        makeInfo({
          health: null,
          source: null,
          location: null,
          control_port_offset: null,
          last_polled_at: null,
        }),
      )
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'SOFTWARE VERSION')).toBe('—')
      expect(cellValue(wrapper, 'REPORTED NAME')).toBe('—')
      expect(cellValue(wrapper, 'REPORTED HOST')).toBe('—')
      expect(cellValue(wrapper, 'CONTROL PORT OFFSET')).toBe('—')
      expect(cellValue(wrapper, 'UPTIME')).toBe('—')
      expect(cellValue(wrapper, 'DATABASE')).toBe('—')
      expect(cellValue(wrapper, 'HOTPLUG')).toBe('—')
      expect(cellValue(wrapper, 'LAST POLLED')).toBe('—')
      expect(cellValue(wrapper, 'PRESENT')).toBe('—')
      expect(cellValue(wrapper, 'LATITUDE')).toBe('Not reported')
      expect(cellValue(wrapper, 'LONGITUDE')).toBe('Not reported')
    })

    it('reports an unhealthy hotplug source as such', async () => {
      const info = makeInfo()
      ;(info.health as Record<string, unknown>).hotplug = { source: 'polling', healthy: false }
      mockGetSentryHostInfo.mockResolvedValue(info)
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'HOTPLUG')).toBe('polling — unhealthy')
      expect(cellValue(wrapper, 'LAST HOTPLUG EVENT')).toBe('—')
    })

    it('drops health values of the wrong type instead of rendering them', async () => {
      mockGetSentryHostInfo.mockResolvedValue(
        makeInfo({
          health: {
            version: '',
            uptime_s: Number.NaN,
            database: 42,
            hotplug: ['udev'],
            devices: { present: '2' },
          },
          source: { name: null, version: null, host: null, http_port: null, location: null },
        }),
      )
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'SOFTWARE VERSION')).toBe('—')
      expect(cellValue(wrapper, 'UPTIME')).toBe('—')
      expect(cellValue(wrapper, 'DATABASE')).toBe('—')
      expect(cellValue(wrapper, 'HOTPLUG')).toBe('—')
      expect(cellValue(wrapper, 'PRESENT')).toBe('—')
    })

    it('renders the host alone when the reported host carries no port', async () => {
      const info = makeInfo()
      info.source!.http_port = null
      mockGetSentryHostInfo.mockResolvedValue(info)
      expect(cellValue(await mountExpanded(), 'REPORTED HOST')).toBe('192.168.5.67')
    })

    it('keeps the stored record when the info request fails', async () => {
      mockGetSentryHostInfo.mockRejectedValue(new Error('offline'))
      const wrapper = await mountExpanded()
      expect(cellValue(wrapper, 'REGISTERED')).toBe(new Date(HOST.created_at).toLocaleString())
      expect(cellValue(wrapper, 'SOFTWARE VERSION')).toBe('—')
    })
  })

  describe('the site map', () => {
    it('plots the Sentry when online and a position is reported', async () => {
      const wrapper = await mountExpanded()
      expect(wrapper.find('.stub-site-map').attributes('data-pos')).toBe('54.951186,-1.532995')
    })

    it('names an unlabelled host by its address on the map', async () => {
      const wrapper = await mountExpanded({ ...HOST, name: null })
      expect(wrapper.findComponent({ name: 'SentrySiteMap' }).props('label')).toBe('192.168.5.67')
    })

    it('is hidden off-grid, where the online basemap cannot load', async () => {
      const wrapper = mount(SentryHostDetails, { props: { host: HOST } })
      useAppStore().setOnline(false)
      await wrapper.find('.sentry-host-details-toggle').trigger('click')
      await flushPromises()
      expect(wrapper.find('.stub-site-map').exists()).toBe(false)
    })

    it.each([
      ['no location at all', null],
      ['a missing latitude', { latitude: null, longitude: -1.5, updated_at: 1 }],
      ['a missing longitude', { latitude: 54.9, longitude: null, updated_at: 1 }],
      ['null island', { latitude: 0, longitude: 0, updated_at: 1 }],
    ])('is hidden for %s', async (_case, location) => {
      mockGetSentryHostInfo.mockResolvedValue(
        makeInfo({ location: location as SentryHostInfo['location'] }),
      )
      const wrapper = await mountExpanded()
      expect(wrapper.find('.stub-site-map').exists()).toBe(false)
    })
  })

  describe('changing host', () => {
    it('refetches while expanded', async () => {
      const wrapper = await mountExpanded()
      await wrapper.setProps({ host: { ...HOST, id: 9 } })
      await flushPromises()
      expect(mockGetSentryHostInfo).toHaveBeenLastCalledWith(9)
    })

    it('drops the previous host’s info without refetching while collapsed', async () => {
      const wrapper = mount(SentryHostDetails, { props: { host: HOST } })
      await wrapper.setProps({ host: { ...HOST, id: 9 } })
      await flushPromises()
      expect(mockGetSentryHostInfo).not.toHaveBeenCalled()
    })
  })

  it('has no accessibility violations when expanded', async () => {
    const wrapper = await mountExpanded()
    // `region` is disabled because this component is a fragment of the settings
    // form, not a whole page — landmark containment is the page's concern.
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
