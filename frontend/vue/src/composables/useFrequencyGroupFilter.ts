import { ref } from 'vue'
import type { SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'

/**
 * `useFrequencyGroupFilter` — the GROUPS pill-filter *state* behind the
 * Frequency Manager's chip row: which groups are selected (or "All"), whether
 * the filter accordion is expanded, and a `filterFrequencies` helper that
 * narrows a frequency list to the selection. Extracted out of
 * `SdrFrequencyManagerTab.vue` unchanged in behaviour, paired with the
 * presentational `SdrFrequencyGroupFilter.vue`.
 *
 * Note on behaviour worth keeping deliberate: a selected group that stops
 * being offered by the chips (e.g. its last frequency was reassigned) is NOT
 * pruned from the selection — the list keeps showing "No matches." until the
 * user clicks "All", which the Frequency Manager's specs pin.
 *
 * @param freqGroupsFor - resolves a stored frequency to the groups it
 *   belongs to (the store's `freqGroupsFor`, or an equivalent).
 */
export function useFrequencyGroupFilter(
  freqGroupsFor: (freq: SdrStoredFrequency) => SdrFrequencyGroup[],
) {
  const selectedGroupIds = ref<number[]>([])
  const allSelected = ref(true)
  // Expanded by default so the group chips are visible on arrival — filtering
  // by group is the primary way users navigate a long frequency list.
  const expanded = ref(true)

  function toggleAll() {
    allSelected.value = true
    selectedGroupIds.value = []
  }

  function toggleGroup(groupId: number) {
    if (allSelected.value) {
      allSelected.value = false
      selectedGroupIds.value = [groupId]
      return
    }
    const index = selectedGroupIds.value.indexOf(groupId)
    if (index >= 0) selectedGroupIds.value.splice(index, 1)
    else selectedGroupIds.value.push(groupId)
    if (selectedGroupIds.value.length === 0) allSelected.value = true
  }

  function filterFrequencies(list: SdrStoredFrequency[]): SdrStoredFrequency[] {
    if (!allSelected.value && selectedGroupIds.value.length > 0) {
      const selected = new Set(selectedGroupIds.value)
      return list.filter((freq) => freqGroupsFor(freq).some((group) => selected.has(group.id)))
    }
    return list
  }

  return { selectedGroupIds, allSelected, expanded, toggleAll, toggleGroup, filterFrequencies }
}
