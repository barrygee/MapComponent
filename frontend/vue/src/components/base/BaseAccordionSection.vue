<template>
  <button
    type="button"
    :class="
      variant === 'section'
        ? [
            'sdr-scanner-header-row',
            'sdr-frequency-manager-accordion-toggle',
            { 'sdr-frequency-manager-accordion-toggle-expanded': expanded },
          ]
        : 'sdr-ef-settings-toggle'
    "
    :aria-expanded="expanded"
    :aria-controls="bodyId"
    @click="expanded = !expanded"
  >
    <label
      v-if="variant === 'section'"
      class="sdr-field-label sdr-frequency-manager-scanner-title"
      >{{ title }}</label
    >
    <span v-else class="sdr-ef-settings-toggle-title">{{ title }}</span>
    <slot name="header-extra" />
    <span v-if="variant === 'section'" class="sdr-frequency-manager-accordion-chevron">
      <ChevronIcon />
    </span>
    <ChevronIcon v-else :open="expanded" />
  </button>
  <!-- v-bind (not :class) so that without bodyClass the body renders with no
       class attribute at all, matching the pre-extraction id-only divs. -->
  <div v-show="expanded" :id="bodyId" v-bind="bodyClass ? { class: bodyClass } : {}">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * `BaseAccordionSection` — the disclosure header-row + collapsible body used
 * across the SDR panel. Extracted from (not a rewrite of) the byte-identical
 * header buttons copy-pasted across `SdrPanel.vue` (SCANNER / SEARCH / SAVED
 * RANGES) and `SdrSettingsAccordion.vue` (SETTINGS), plus the two near-copies
 * in `SdrFrequencyManagerTab.vue`
 * (the add/edit forms' RADIO SETTINGS toggle).
 *
 * Two real, spec-pinned looks — variants, not free-form class props:
 * - `variant="section"` (default) — the uppercase panel-section header
 *   (`sdr-scanner-header-row` + `sdr-frequency-manager-accordion-toggle`,
 *   label-styled title, chevron in its rotating wrapper span, `-expanded`
 *   class while open).
 * - `variant="form"` — the edit-form RADIO SETTINGS toggle
 *   (`sdr-ef-settings-toggle`, span-styled title, bare `ChevronIcon` driven
 *   by its `open` prop, no expanded class).
 *
 * The expanded state stays caller-owned (`v-model:expanded`) — `SdrPanel`
 * collapses its sections whenever the side panel opens. The header button and
 * body `<div v-show>` render as adjacent siblings, which
 * DOM-dependent selectors (and the existing specs) rely on.
 *
 * Slots:
 * - default — the collapsible body content.
 * - `#header-extra` — optional content between the title and the chevron
 *   (e.g. the SCANNER/SEARCH activity-state rows).
 *
 * Styling stays in `SdrPanel.css` until the B10 co-location sweep, same as
 * `BaseSelectMenu`.
 */
import ChevronIcon from '@/components/shared/ChevronIcon.vue'

/** Whether the body is expanded (caller-owned so panels can collapse sections). */
const expanded = defineModel<boolean>('expanded', { required: true })

withDefaults(
  defineProps<{
    /** The header text (rendered uppercase by the variant's CSS family). */
    title: string
    /** The body element's id, also wired to the header's `aria-controls`. */
    bodyId: string
    /** Which spec-pinned header/body look to render (see the component doc). */
    variant?: 'section' | 'form'
    /** Extra class(es) for the body element (e.g. `sdr-ef-settings-grid`). */
    bodyClass?: string
  }>(),
  // No bodyClass default: absent means the body renders with no class
  // attribute at all (the section sites' bodies are bare id-only divs).
  { variant: 'section', bodyClass: undefined },
)
</script>
