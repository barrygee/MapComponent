<script setup lang="ts">
import { useDisclosure } from '@/composables/useDisclosure'

/**
 * `IconRailAccordion` — the click-to-expand sub-panel mechanic shared by the
 * MAP LAYERS / FILTER groups in `IconRail`-based rails (`AirSideMenu.vue`,
 * `SpaceSideMenu.vue`). It owns the expand/collapse state (via
 * `useDisclosure`) and the panel's show/hide + layout; callers own the
 * trigger button and panel content via slots, plus whatever domain
 * behaviour those buttons perform on click.
 *
 * The open/closed flag is transient UI state local to this component
 * instance — it does not need to survive a teleport remount, so (per this
 * project's state-placement rule) it stays out of Pinia, exactly as it did
 * when `SpaceSideMenu`/`AirSideMenu` called `useDisclosure()` directly.
 */
interface IconRailAccordionProps {
  /** Passthrough `id` for the panel container — legacy call sites and their
   * existing `aria-controls`/tests key off this (`space-layers-panel`,
   * `filter-mode-flyout`). */
  panelId: string
  /** Whether the accordion starts expanded. Defaults to `false`. */
  initiallyOpen?: boolean
}

const props = withDefaults(defineProps<IconRailAccordionProps>(), {
  initiallyOpen: false,
})

const { open, toggle } = useDisclosure(props.initiallyOpen)
</script>

<template>
  <slot name="trigger" :open="open" :toggle="toggle" />
  <div v-show="open" :id="panelId" class="icon-rail-accordion__panel sm-accordion-panel">
    <slot name="panel" :open="open" />
  </div>
</template>

<style scoped>
/* Sub-items stack vertically on a grey panel (the --color-button-bg control grey);
   `sm-accordion-panel` is kept as a passthrough class for legacy
   CSS/selectors that already key off it. */
.icon-rail-accordion__panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--color-button-bg);
}

/* Touch screens: hover tooltips aren't useful (mirrors IconRail's identical
   rule — see the NOTE in IconRail.vue's own <style> for why this is
   duplicated rather than inherited). IconRailAccordion has two template
   roots (the trigger slot output + this panel div), so it is a multi-root
   component; Vue's scoped-CSS slot-scope-id propagation bails out for
   multi-root components, meaning IconRail's own `:slotted([data-tooltip])`
   rule never reaches the trigger button or panel buttons rendered here —
   only content slotted directly into IconRail itself. This component must
   therefore repeat the suppression for its own slot children (the MAP
   LAYERS/FILTER trigger button and its panel's sub-buttons), or a tap on any
   of them leaves a stuck tooltip pill on touch devices at ≤768px. */
@media (max-width: 768px) {
  :slotted([data-tooltip])::before {
    display: none !important;
  }
}
</style>
