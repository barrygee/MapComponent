import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrFrequencyGroupFilter from './SdrFrequencyGroupFilter.vue'
import type { SdrFrequencyGroup } from '@/stores/sdr'

enableAutoUnmount(afterEach)

function makeGroup(overrides: Partial<SdrFrequencyGroup> = {}): SdrFrequencyGroup {
  return { id: 1, name: 'Airband', slug: 'airband', color: '#c8ff00', sort_order: 0, ...overrides }
}

interface MountOptions {
  groups?: SdrFrequencyGroup[]
  selectedGroupIds?: number[]
  allSelected?: boolean
  disabled?: boolean
  expanded?: boolean
}

function mountFilter(options: MountOptions = {}): VueWrapper {
  return mount(SdrFrequencyGroupFilter, {
    props: {
      groups: options.groups ?? [makeGroup()],
      selectedGroupIds: options.selectedGroupIds ?? [],
      allSelected: options.allSelected ?? true,
      bodyId: 'sdr-favourites-groups-section',
      disabled: options.disabled,
      expanded: options.expanded ?? false,
      'onUpdate:expanded': () => {},
    },
    attachTo: document.body,
  })
}

describe('SdrFrequencyGroupFilter — rendering', () => {
  it('renders an All chip plus one chip per group, in order', () => {
    const wrapper = mountFilter({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    const chips = wrapper.findAll('.sdr-scan-group-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['All', 'Airband', 'Marine'])
  })

  it('marks the All chip active when allSelected is true', () => {
    const wrapper = mountFilter({ allSelected: true })
    expect(wrapper.findAll('.sdr-scan-group-chip')[0].attributes('aria-pressed')).toBe('true')
  })

  it('marks only the selected group chip active when allSelected is false', () => {
    const wrapper = mountFilter({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
      allSelected: false,
      selectedGroupIds: [2],
    })
    const chips = wrapper.findAll('.sdr-scan-group-chip')
    expect(chips.map((chip) => chip.attributes('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  it('wires bodyId into both the accordion body id and its header aria-controls', () => {
    const wrapper = mountFilter()
    const toggle = wrapper.find('button[aria-controls="sdr-favourites-groups-section"]')
    expect(toggle.exists()).toBe(true)
    expect(wrapper.find('#sdr-favourites-groups-section').exists()).toBe(true)
  })

  it('disables every chip when disabled is true', () => {
    const wrapper = mountFilter({
      groups: [makeGroup()],
      disabled: true,
    })
    for (const chip of wrapper.findAll('.sdr-scan-group-chip')) {
      expect(chip.attributes('disabled')).toBeDefined()
    }
  })

  it('leaves chips enabled when disabled is not passed', () => {
    const wrapper = mountFilter()
    expect(wrapper.find('.sdr-scan-group-chip').attributes('disabled')).toBeUndefined()
  })

  it('hides the whole filter (v-show) when there are no groups to offer', () => {
    const wrapper = mountFilter({ groups: [] })
    const root = wrapper.find('.sdr-frequency-manager-groups-filter')
    expect((root.element as HTMLElement).style.display).toBe('none')
  })

  it('shows the filter when at least one group exists', () => {
    const wrapper = mountFilter({ groups: [makeGroup()] })
    const root = wrapper.find('.sdr-frequency-manager-groups-filter')
    expect((root.element as HTMLElement).style.display).not.toBe('none')
  })
})

describe('SdrFrequencyGroupFilter — interaction', () => {
  it('emits toggle-all when the All chip is clicked', async () => {
    const wrapper = mountFilter()
    await wrapper.findAll('.sdr-scan-group-chip')[0].trigger('click')
    expect(wrapper.emitted('toggle-all')).toHaveLength(1)
  })

  it('emits toggle-group with the group id when a group chip is clicked', async () => {
    const wrapper = mountFilter({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    await wrapper.findAll('.sdr-scan-group-chip')[2].trigger('click')
    expect(wrapper.emitted('toggle-group')?.[0]).toEqual([2])
  })

  it('supports v-model:expanded via the accordion toggle', async () => {
    const wrapper = mount(SdrFrequencyGroupFilter, {
      props: {
        groups: [makeGroup()],
        selectedGroupIds: [],
        allSelected: true,
        bodyId: 'sdr-freq-manager-groups-section',
        expanded: false,
      },
      attachTo: document.body,
    })
    const toggle = wrapper.find('button[aria-controls="sdr-freq-manager-groups-section"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.emitted('update:expanded')?.[0]).toEqual([true])
  })
})

describe('SdrFrequencyGroupFilter — accessibility', () => {
  it('has no axe violations with groups rendered', async () => {
    const wrapper = mountFilter({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
