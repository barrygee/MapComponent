<template>
  <div class="sdr-freq-row-top">
    <div class="sdr-freq-row-body">
      <div class="sdr-freq-row-main">
        <span class="sdr-freq-row-label">{{ frequency.label }}</span>
      </div>
      <div class="sdr-freq-row-sub">
        <span class="sdr-freq-row-hz">{{ (frequency.frequency_hz / 1e6).toFixed(4) }} MHz</span>
        <template v-if="frequency.mode">
          <span class="sdr-freq-row-sep">·</span>
          <span class="sdr-freq-row-mode">{{ frequency.mode }}</span>
        </template>
      </div>
      <div class="sdr-freq-row-groups">
        <template v-if="freqGroupsFor(frequency).length">
          <span
            v-for="group in freqGroupsFor(frequency)"
            :key="group.id"
            class="sdr-freq-row-group-chip"
          >
            {{ group.name }}
          </span>
        </template>
        <span v-else class="sdr-freq-row-group-chip"> Default </span>
      </div>
    </div>
    <!-- Own flex container so the action glyphs sit tightly together as one
         cluster, instead of inheriting the row's wide body↔actions gap
         between each button — which ate width the label needs. -->
    <div class="sdr-freq-row-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrFrequencyRowSummary` — the read-only saved-frequency row body (label,
 * MHz to 4dp, mode, group chips or the "Default" fallback), extracted
 * verbatim (byte-identical `.sdr-freq-row-*` classes) from the Frequency
 * Manager so it and the FAVOURITES list render the exact same row chrome
 * instead of a copy-pasted block — existing CSS and specs targeting these
 * classes keep matching unchanged.
 *
 * The trailing button cluster is the caller's concern via the `#actions`
 * slot, since the two hosts offer different actions (the manager: favourite,
 * tune, edit, remove; FAVOURITES: unfavourite, tune). This component only
 * owns the cluster's wrapper, so the buttons group tightly regardless of who
 * fills the slot.
 */
import { useSdrStore } from '@/stores/sdr'
import type { SdrStoredFrequency } from '@/stores/sdr'

defineProps<{
  /** The stored frequency to render. */
  frequency: SdrStoredFrequency
}>()

// Reads the store directly (rather than taking groups as a prop) so every
// row resolves its own group membership the same way the pre-extraction
// Frequency Manager did.
const freqGroupsFor = useSdrStore().freqGroupsFor
</script>
