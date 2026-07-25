import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrFrequencyRowSummary from './SdrFrequencyRowSummary.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeGroup(overrides: Partial<SdrFrequencyGroup> = {}): SdrFrequencyGroup {
  return { id: 1, name: 'Airband', slug: 'airband', color: '#c8ff00', sort_order: 0, ...overrides }
}

function makeFreq(overrides: Partial<SdrStoredFrequency> = {}): SdrStoredFrequency {
  return {
    id: 1,
    group_id: null,
    group_ids: [],
    label: 'Tower',
    frequency_hz: 118_380_000,
    mode: 'AM',
    ...overrides,
  }
}

function mountRow(frequency: SdrStoredFrequency, groups: SdrFrequencyGroup[] = []): VueWrapper {
  const store = useSdrStore()
  store.groups = groups
  return mount(SdrFrequencyRowSummary, {
    props: { frequency },
    slots: { actions: '<button class="fake-action">Act</button>' },
  })
}

describe('SdrFrequencyRowSummary — rendering', () => {
  it('renders the label and frequency formatted to 4 decimal places in MHz', () => {
    const wrapper = mountRow(makeFreq({ label: 'Ground', frequency_hz: 121_500_000 }))
    expect(wrapper.find('.sdr-freq-row-label').text()).toBe('Ground')
    expect(wrapper.find('.sdr-freq-row-hz').text()).toBe('121.5000 MHz')
  })

  it('rounds a non-terminating MHz value to 4 decimal places', () => {
    const wrapper = mountRow(makeFreq({ frequency_hz: 118_383_333 }))
    expect(wrapper.find('.sdr-freq-row-hz').text()).toBe('118.3833 MHz')
  })

  it('shows the mode segment when a mode is present', () => {
    const wrapper = mountRow(makeFreq({ mode: 'NFM' }))
    expect(wrapper.find('.sdr-freq-row-mode').text()).toBe('NFM')
    expect(wrapper.find('.sdr-freq-row-sep').exists()).toBe(true)
  })

  it('hides the mode segment entirely when mode is empty', () => {
    const wrapper = mountRow(makeFreq({ mode: '' }))
    expect(wrapper.find('.sdr-freq-row-mode').exists()).toBe(false)
    expect(wrapper.find('.sdr-freq-row-sep').exists()).toBe(false)
  })

  it('renders a chip per group the frequency belongs to', () => {
    const wrapper = mountRow(makeFreq({ group_ids: [1, 2] }), [
      makeGroup(),
      makeGroup({ id: 2, name: 'Marine', slug: 'marine' }),
    ])
    const chips = wrapper.findAll('.sdr-freq-row-group-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['Airband', 'Marine'])
  })

  it('falls back to a single "Default" chip when the frequency belongs to no group', () => {
    const wrapper = mountRow(makeFreq({ group_ids: [] }), [makeGroup()])
    const chips = wrapper.findAll('.sdr-freq-row-group-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toBe('Default')
  })

  it('renders the #actions slot content inside the actions cluster', () => {
    const wrapper = mountRow(makeFreq())
    expect(wrapper.find('.sdr-freq-row-actions .fake-action').exists()).toBe(true)
  })
})

describe('SdrFrequencyRowSummary — accessibility', () => {
  it('has no axe violations with groups and mode rendered', async () => {
    const wrapper = mountRow(makeFreq({ mode: 'AM', group_ids: [1] }), [makeGroup()])
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })

  it('has no axe violations in the ungrouped/no-mode fallback state', async () => {
    const wrapper = mountRow(makeFreq({ mode: '', group_ids: [] }))
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
