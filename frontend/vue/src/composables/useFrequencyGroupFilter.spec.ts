import { describe, it, expect } from 'vitest'
import { useFrequencyGroupFilter } from './useFrequencyGroupFilter'
import type { SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'

function makeGroup(overrides: Partial<SdrFrequencyGroup> = {}): SdrFrequencyGroup {
  return { id: 1, name: 'Airband', slug: 'airband', color: '#c8ff00', sort_order: 0, ...overrides }
}

function makeFreq(overrides: Partial<SdrStoredFrequency> = {}): SdrStoredFrequency {
  return {
    id: 1,
    group_id: null,
    group_ids: [],
    label: 'Tower',
    frequency_hz: 118_300_000,
    mode: 'AM',
    ...overrides,
  }
}

// A minimal freqGroupsFor stand-in: resolves a frequency's group_ids straight
// into group objects, matching how the SDR store's real implementation reads.
function makeFreqGroupsFor(groups: SdrFrequencyGroup[]) {
  return (freq: SdrStoredFrequency): SdrFrequencyGroup[] =>
    groups.filter((group) => (freq.group_ids ?? []).includes(group.id))
}

describe('useFrequencyGroupFilter — initial state', () => {
  it('starts with All selected, no groups selected and the accordion collapsed', () => {
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor([]))
    expect(filter.allSelected.value).toBe(true)
    expect(filter.selectedGroupIds.value).toEqual([])
    expect(filter.expanded.value).toBe(false)
  })
})

describe('useFrequencyGroupFilter — toggleAll', () => {
  it('resets to All selected and clears any group selection', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    expect(filter.allSelected.value).toBe(false)
    filter.toggleAll()
    expect(filter.allSelected.value).toBe(true)
    expect(filter.selectedGroupIds.value).toEqual([])
  })
})

describe('useFrequencyGroupFilter — toggleGroup', () => {
  it('selects a single group when starting from All (first pick)', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    expect(filter.allSelected.value).toBe(false)
    expect(filter.selectedGroupIds.value).toEqual([1])
  })

  it('adds a second group to an existing multi-select', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    filter.toggleGroup(2)
    expect(filter.selectedGroupIds.value).toEqual([1, 2])
  })

  it('removes a group that is already selected', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    filter.toggleGroup(2)
    filter.toggleGroup(1)
    expect(filter.selectedGroupIds.value).toEqual([2])
  })

  it('resets to All once the last selected group is deselected', () => {
    const groups = [makeGroup()]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    filter.toggleGroup(1)
    expect(filter.allSelected.value).toBe(true)
    expect(filter.selectedGroupIds.value).toEqual([])
  })
})

describe('useFrequencyGroupFilter — filterFrequencies', () => {
  it('returns the full list unfiltered while All is selected', () => {
    const groups = [makeGroup()]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    const list = [makeFreq({ id: 1, group_ids: [1] }), makeFreq({ id: 2, group_ids: [] })]
    expect(filter.filterFrequencies(list)).toEqual(list)
  })

  it('narrows the list to frequencies belonging to a selected group', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    const airband = makeFreq({ id: 1, group_ids: [1] })
    const marine = makeFreq({ id: 2, group_ids: [2] })
    expect(filter.filterFrequencies([airband, marine])).toEqual([airband])
  })

  it('matches a frequency belonging to any of several selected groups', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(1)
    filter.toggleGroup(2)
    const airband = makeFreq({ id: 1, group_ids: [1] })
    const marine = makeFreq({ id: 2, group_ids: [2] })
    const ungrouped = makeFreq({ id: 3, group_ids: [] })
    expect(filter.filterFrequencies([airband, marine, ungrouped])).toEqual([airband, marine])
  })

  it('returns an empty list when the selection matches nothing', () => {
    const groups = [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })]
    const filter = useFrequencyGroupFilter(makeFreqGroupsFor(groups))
    filter.toggleGroup(2)
    const airband = makeFreq({ id: 1, group_ids: [1] })
    expect(filter.filterFrequencies([airband])).toEqual([])
  })
})
