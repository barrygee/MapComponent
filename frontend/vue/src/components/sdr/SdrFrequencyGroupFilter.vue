<template>
  <!-- Hidden (not removed) once nothing has a group, exactly as the
       pre-extraction Frequency Manager did — v-if here would also collapse
       the accordion's own header row, retargeting every positional
       `.sdr-scanner-header-row` lookup after it (SCANNER/SEARCH/…). -->
  <div v-show="groups.length > 0" class="sdr-frequency-manager-groups-filter">
    <BaseAccordionSection v-model:expanded="expandedModel" title="GROUPS" :body-id="bodyId">
      <div class="sdr-scan-groups-row sdr-frequency-manager-groups-filter-row">
        <BasePillToggle
          class="sdr-scan-group-chip"
          :active="allSelected"
          active-class="sdr-scan-group-chip-active"
          :aria-pressed="allSelected"
          :disabled="disabled"
          @click="emit('toggle-all')"
        >
          All
        </BasePillToggle>
        <BasePillToggle
          v-for="group in groups"
          :key="group.id"
          class="sdr-scan-group-chip"
          :active="!allSelected && selectedGroupIds.includes(group.id)"
          active-class="sdr-scan-group-chip-active"
          :aria-pressed="!allSelected && selectedGroupIds.includes(group.id)"
          :disabled="disabled"
          @click="emit('toggle-group', group.id)"
        >
          {{ group.name }}
        </BasePillToggle>
      </div>
    </BaseAccordionSection>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrFrequencyGroupFilter` — the GROUPS pill-filter accordion, lifted
 * verbatim (DOM + classes unchanged) from the Frequency Manager so both it
 * and the FAVOURITES list render the identical filter chrome instead of a
 * copy-pasted block. Purely presentational: the selection state lives in
 * `useFrequencyGroupFilter`, instantiated separately by each host so their
 * filters stay independent.
 *
 * `bodyId` is a required prop (not defaulted) because `BaseAccordionSection`
 * writes it straight into the DOM as the body's real `id` and into the
 * header's `aria-controls` — a plain correctness requirement, not a defence
 * against a live duplication bug (only one `<SdrPanel>` is ever mounted,
 * `App.vue` → `SdrTabPanel.vue`): every instance still needs its own unique
 * id, since this component is instantiated twice in that single mount (once
 * by the Frequency Manager, once by FAVOURITES). The Frequency Manager keeps
 * `sdr-freq-manager-groups-section`; FAVOURITES uses
 * `sdr-favourites-groups-section`.
 */
import type { SdrFrequencyGroup } from '@/stores/sdr'
import BaseAccordionSection from '@/components/base/BaseAccordionSection.vue'
import BasePillToggle from '@/components/base/BasePillToggle.vue'

defineProps<{
  /** Groups offered as filter chips (typically the store's `groupsWithFreqs`). */
  groups: SdrFrequencyGroup[]
  /** Currently selected group ids when `allSelected` is false. */
  selectedGroupIds: number[]
  /** Whether the "All" chip is the active selection. */
  allSelected: boolean
  /** Unique DOM id for the accordion body — see the component doc above. */
  bodyId: string
  /** Disables every chip (e.g. a read-only tuner follower). */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** The "All" chip was clicked. */
  (event: 'toggle-all'): void
  /** A single group chip was clicked. */
  (event: 'toggle-group', groupId: number): void
}>()

const expandedModel = defineModel<boolean>('expanded', { required: true })
</script>
