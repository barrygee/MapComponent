<template>
  <div
    role="radio"
    class="ring-origin-option"
    :class="{
      'ring-origin-option--selected': selected,
      'ring-origin-option--disabled': disabled,
    }"
    :aria-checked="selected"
    :aria-disabled="disabled || undefined"
    :tabindex="tabindex"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
    @keydown="emit('keydown', $event)"
  >
    <span class="ring-origin-option-radio" aria-hidden="true"></span>
    <span class="ring-origin-option-text">
      <span class="ring-origin-option-name">{{ name }}</span>
      <span class="ring-origin-option-sub">({{ detail }})</span>
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * One choice in the ring-origin picker: what the point is called, and where it
 * is — coordinates plus, for a Sentry site, how far away it is.
 *
 * A `role="radio"` row rather than a button, because the picker is a
 * single-select group: the operator is choosing *which* origin, and arrow keys
 * should move through the choices. Its keyboard bindings come from the group,
 * which is why `tabindex` and the arrow handler are passed in rather than owned
 * here.
 */
withDefaults(
  defineProps<{
    /** What the origin is called, e.g. `SENTINEL LOCATION`, `GATESHEAD`. */
    name: string
    /** The line under the name: coordinates, or why there are none. */
    detail: string
    selected: boolean
    /** Roving tabindex from the enclosing radio group. */
    tabindex: 0 | -1
    /** A place with no known position: listed, but not choosable. */
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ select: []; keydown: [event: KeyboardEvent] }>()

function onActivate(): void {
  emit('select')
}
</script>

<style scoped>
/* The Settings panel is light, so the rows are drawn on its own ground rather
   than the dark palette the map's flyouts use. */
.ring-origin-option {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 2px;
  cursor: pointer;
  box-sizing: border-box;
}
.ring-origin-option:hover:not(.ring-origin-option--disabled) .ring-origin-option-name {
  color: rgba(16, 19, 29, 0.92);
}
.ring-origin-option--disabled {
  /* Listed, because hiding a place reads as a missing place — but one with no
     position has nothing to centre on, so it cannot be chosen. */
  opacity: 0.45;
  cursor: default;
}
.ring-origin-option-radio {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(16, 19, 29, 0.35);
  box-sizing: border-box;
}
/* Chosen: a lime outer circle around a black centre. The lime is the app's
   accent, as every other "on" fill in the panel uses (the toggle switches, the
   apply button); the black centre is what keeps the mark legible on this light
   ground, where the lime on its own is far too pale to read. */
.ring-origin-option--selected .ring-origin-option-radio {
  border: none;
  background: var(--color-bg, #000);
  box-shadow: inset 0 0 0 2px var(--color-accent);
}

/* Name and coordinates on one line, typed to match Overhead Aircraft Alerts —
   the two settings list the same kind of place and should read alike. */
.ring-origin-option-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.ring-origin-option-name {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.85);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ring-origin-option-sub {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: rgba(16, 19, 29, 0.45);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
</style>
