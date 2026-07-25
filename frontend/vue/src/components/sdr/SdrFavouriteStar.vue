<template>
  <BaseIconAction
    ref="actionRef"
    class="sdr-freq-row-fav"
    :active="favourite"
    active-class="sdr-freq-row-fav-active"
    :accessible-name="accessibleName"
    :tooltip="favourite ? 'Unfavourite' : 'Favourite'"
    tooltip-side="bottom"
    :disabled="disabled"
    @click="emit('toggle')"
  >
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points="12,3 14.5,8.5 20.6,9.2 16.1,13.3 17.3,19.3 12,16.3 6.7,19.3 7.9,13.3 3.4,9.2 9.5,8.5"
        :fill="favourite ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  </BaseIconAction>
</template>

<script setup lang="ts">
/**
 * `SdrFavouriteStar` — the per-row favourite/unfavourite toggle used by both
 * the Frequency Manager (starring) and the FAVOURITES list (unstarring).
 * Wraps `BaseIconAction` for its active/disabled/accessible-name contract and
 * adds a state-reflecting accessible name so a screen-reader user hears which
 * frequency the press affects and what pressing it will do.
 *
 * Deliberately NOT the military star used in the Air/Space filter rails
 * (`shared/FilterSubTabIcon.vue`, `air/AirSideMenu.vue`) — that glyph is a
 * fixed 5-point outline star (fill:none, stroke-width:1.4, inner/outer radius
 * ratio ~0.35, tightly pointed). This star differs three ways: it FILLS solid
 * (`fill="currentColor"`) when favourited instead of staying an outline (the
 * fill state doubles as the toggle's own affordance), it turns the panel's
 * lime accent (see `.sdr-freq-row-fav-active` in SdrPanel.css) rather than the
 * row's muted
 * grey, and its points are fuller/fatter (inner/outer radius ratio ~0.48,
 * heavier 1.6 stroke) with a distinct hand-authored vertex set — never a
 * shared glyph, so there is no name collision or accidental restyle risk.
 */
import { computed, ref } from 'vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'

const props = defineProps<{
  /** Current favourite state — solid star when true, outline when false. */
  favourite: boolean
  /** The frequency's label, folded into the accessible name (see below). */
  frequencyLabel: string
  /** Disables the button (e.g. a read-only tuner follower). */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** The star was pressed; the parent decides which store call to make. */
  (event: 'toggle'): void
}>()

// State-reflecting accessible name: announces both the frequency and what
// pressing the button will do, so a screen-reader user does not have to infer
// the toggle's effect from a static "Favourite" label. A computed (not a
// plain const) because the SAME component instance is reused across a
// favourite/unfavourite toggle (v-for keyed by frequency id) — a plain const
// would freeze the name at its initial mount value.
//
// Deliberately NOT paired with `aria-pressed`: a state-reflecting name and
// aria-pressed are alternative toggle-button conventions, not additive —
// together a favourited row would announce "Unfavourite Tower, button,
// pressed", where the verb and the pressed state point in opposite
// directions. The name alone already carries both the frequency and the
// current state.
const accessibleName = computed(
  () => `${props.favourite ? 'Unfavourite' : 'Favourite'} ${props.frequencyLabel}`,
)

const actionRef = ref<InstanceType<typeof BaseIconAction> | null>(null)

/**
 * Move keyboard focus to this star button. Used by `SdrFavouritesSection` to
 * keep focus inside the list when unfavouriting removes the row underneath
 * it, rather than letting focus fall back to `document.body`.
 */
function focus() {
  const element: unknown = actionRef.value?.$el
  if (element instanceof HTMLElement) element.focus()
}

defineExpose({ focus })
</script>
