<script setup lang="ts">
/**
 * `BaseDataCell` — a single label/value entry inside a `BaseDataGrid`.
 *
 * Extracted from (not a rewrite of) the `sfr-acc-cell` / `sfr-acc-cell-label` /
 * `sfr-acc-cell-value` markup that `SpaceFilter.vue` originally defined in its
 * own global `<style>` block, but which `TrackingPanel.vue` (and `SpacePasses.vue`,
 * via its own `spp-acc-*` duplicate) silently depended on by reaching across the
 * component boundary for those class names — editing SpaceFilter's styles could
 * silently break the other consumers. This component is now the single source of
 * truth for a data cell's structure and styling.
 *
 * Per-site pixel deltas (TrackingPanel's tighter spacing, lighter value weight,
 * and free-text wrapping vs SpaceFilter's fixed-width truncated telemetry) are
 * expressed as CSS custom properties a caller sets on an ancestor element —
 * `--ba-cell-gap`, `--ba-cell-label-color`, `--ba-cell-value-font-size`,
 * `--ba-cell-value-font-weight`, `--ba-cell-value-white-space`,
 * `--ba-cell-value-overflow`, `--ba-cell-value-text-overflow`,
 * `--ba-cell-value-word-break`, `--ba-cell-value-overflow-wrap`,
 * `--ba-cell-value-line-height`, `--ba-cell-value-color`,
 * `--ba-cell-value-letter-spacing` (free prose reads better unspaced and
 * slightly dimmed than fixed-width telemetry does), `--ba-cell-align`
 * (SpaceFilter/SpacePasses's
 * RADIO grid left-aligns each cell at its natural width — `flex-start` —
 * instead of the default `stretch`, so an unusually long value isn't
 * ellipsized at the column edge; POSITION/ORBITAL never had this and keep the
 * default) — following the same pattern as `BaseButton`'s `--ba-rail-*`
 * properties. Custom properties inherit through the DOM
 * regardless of component boundaries, so a parent's plain (non-scoped) `<style>`
 * block can set them on a wrapping class (e.g. `.tracking-card`) without needing
 * `:deep()`.
 */
interface BaseDataCellProps {
  /** The field's caption, e.g. "LATITUDE". Rendered upper-case by the caller's
   * own text (this component does not transform it). */
  label: string
  /** Plain-text value. Ignored when the default slot supplies richer content
   * (e.g. SpaceFilter/SpacePasses's uplink/downlink cells append a "· MODE"
   * suffix after the formatted frequency). */
  value?: string
  /** Spans two grid columns — used for TrackingPanel's CATEGORY cell inside a
   * three-column grid so a long category name isn't squeezed. Defaults to false. */
  wide?: boolean
  /** Danger/emergency emphasis on the value (TrackingPanel's EMRG field: red,
   * bold). Defaults to false. */
  emphasis?: boolean
}

withDefaults(defineProps<BaseDataCellProps>(), {
  value: undefined,
  wide: false,
  emphasis: false,
})
</script>

<template>
  <div class="ba-data-cell" :class="{ 'ba-data-cell--wide': wide }">
    <div class="ba-data-cell-label">{{ label }}</div>
    <div class="ba-data-cell-value" :class="{ 'ba-data-cell-value--emphasis': emphasis }">
      <slot>{{ value }}</slot>
    </div>
  </div>
</template>

<style scoped>
.ba-data-cell {
  display: flex;
  flex-direction: column;
  align-items: var(--ba-cell-align, stretch);
  gap: var(--ba-cell-gap, 4px);
  min-width: 0;
}

.ba-data-cell--wide {
  grid-column: span 2;
}

.ba-data-cell-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--ba-cell-label-color, rgba(255, 255, 255, 0.35));
  text-transform: uppercase;
}

.ba-data-cell-value {
  font-family: var(--font-primary);
  font-size: var(--ba-cell-value-font-size, 14px);
  font-weight: var(--ba-cell-value-font-weight, 600);
  letter-spacing: var(--ba-cell-value-letter-spacing, 0.06em);
  color: var(--ba-cell-value-color, #fff);
  white-space: var(--ba-cell-value-white-space, nowrap);
  overflow: var(--ba-cell-value-overflow, hidden);
  text-overflow: var(--ba-cell-value-text-overflow, ellipsis);
  word-break: var(--ba-cell-value-word-break, normal);
  overflow-wrap: var(--ba-cell-value-overflow-wrap, normal);
  line-height: var(--ba-cell-value-line-height, normal);
}

.ba-data-cell-value--emphasis {
  color: #ff4040;
  font-weight: 700;
}

/* The "· MODE" suffix a caller may append via the default slot (e.g.
   SpaceFilter/SpacePasses's uplink/downlink cells). Styled here via :slotted()
   since it lives in the caller's slot content, not this component's own
   template — the single source of truth stays in this component either way. */
:slotted(.ba-data-cell-mode) {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 400;
  margin-left: 2px;
}
</style>
