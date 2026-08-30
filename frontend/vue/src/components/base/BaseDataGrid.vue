<script setup lang="ts">
/**
 * `BaseDataGrid` — a titled label/value grid section: the shared shell behind
 * the "data cell" pattern originally defined only in `SpaceFilter.vue`'s global
 * `<style>` block (`sfr-acc-section` / `sfr-acc-grid`) but silently reused by
 * `TrackingPanel.vue` and duplicated (as `spp-acc-section` / `spp-acc-grid`) in
 * `SpacePasses.vue`. This component now owns that CSS as the single source of
 * truth; render `BaseDataCell` children via the default slot.
 *
 * Per-site deltas are CSS custom properties a caller sets on an ancestor
 * element (see `BaseDataCell`'s doc comment for the matching cell-level set):
 * `--ba-grid-column-gap`, `--ba-grid-row-gap`, `--ba-grid-section-gap`,
 * `--ba-grid-section-padding-top`, `--ba-grid-section-padding-bottom`,
 * `--ba-grid-section-padding-x` (SpacePasses's accordion body is 28px
 * left/right vs SpaceFilter/TrackingPanel's 24px), `--ba-grid-title-color`
 * (the accent title reads as a highlight on the dark map panels this grid was
 * extracted from, but as a stray lime heading on the light settings panel) —
 * following the same pattern as `BaseButton`'s `--ba-rail-*` properties.
 */
interface BaseDataGridProps {
  /** The section caption, e.g. "POSITION DATA". Omit it for a grid whose
   * heading would only repeat its container's (e.g. a titled disclosure whose
   * first section needs no caption of its own) — the title row is then not
   * rendered at all rather than left as an empty line. */
  title?: string
  /** Grid column count. Real usage is either two (the RADIO section) or three
   * (POSITION DATA / ORBITAL DATA). Defaults to 2. */
  columns?: 2 | 3
  /** Collapses to a single column under 480px — matches the RADIO grid, whose
   * values (e.g. transponder type strings) need more room than POSITION/
   * ORBITAL's fixed-width telemetry numbers, which never collapse. Defaults
   * to false. */
  collapseOnNarrow?: boolean
  /**
   * Renders only the title + grid, with no section-level padding/gap box of
   * its own — used when the caller's RADIO section has trailing content after
   * the grid (SpaceFilter/SpacePasses's PACKET/NOTES lines) that must share
   * the *same* padded flex column and inter-item gap as the title/grid, not a
   * second nested one (which would double the spacing). The wrapper switches
   * to `display: contents` so its title/grid children become direct flex
   * items of the caller's own section container. Defaults to false.
   */
  bare?: boolean
}

withDefaults(defineProps<BaseDataGridProps>(), {
  title: undefined,
  columns: 2,
  collapseOnNarrow: false,
  bare: false,
})
</script>

<template>
  <div class="ba-data-grid-section" :class="{ 'ba-data-grid-section--bare': bare }">
    <div v-if="title" class="ba-data-grid-title">{{ title }}</div>
    <div
      class="ba-data-grid"
      :class="{
        'ba-data-grid--three': columns === 3,
        'ba-data-grid--collapse-narrow': collapseOnNarrow,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ba-data-grid-section {
  padding: var(--ba-grid-section-padding-top, 14px) var(--ba-grid-section-padding-x, 24px)
    var(--ba-grid-section-padding-bottom, 12px) var(--ba-grid-section-padding-x, 24px);
  display: flex;
  flex-direction: column;
  gap: var(--ba-grid-section-gap, 10px);
}

.ba-data-grid-section--bare {
  display: contents;
}

.ba-data-grid-title {
  font-family: var(--font-primary);
  font-size: var(--ba-grid-title-font-size, 9px);
  font-weight: var(--ba-grid-title-font-weight, 700);
  letter-spacing: var(--ba-grid-title-letter-spacing, 0.18em);
  color: var(--ba-grid-title-color, var(--color-accent));
  text-transform: uppercase;
}

.ba-data-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: var(--ba-grid-column-gap, 16px);
  row-gap: var(--ba-grid-row-gap, 12px);
}

.ba-data-grid.ba-data-grid--three {
  grid-template-columns: 1fr 1fr 1fr;
}

@media (max-width: 480px) {
  .ba-data-grid.ba-data-grid--collapse-narrow {
    grid-template-columns: 1fr;
  }
}
</style>
