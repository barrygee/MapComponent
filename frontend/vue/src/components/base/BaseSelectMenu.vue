<template>
  <div
    ref="triggerRef"
    class="sdr-device-dropdown"
    :class="{
      'sdr-device-dropdown--open': menuOpen,
      'sdr-device-dropdown--loading': loading,
    }"
    tabindex="0"
    :role="triggerRole"
    :aria-haspopup="triggerRole ? 'listbox' : undefined"
    :aria-expanded="triggerRole ? menuOpen : undefined"
    v-bind="$attrs"
    @click.stop="onTriggerClick"
    @keydown="onTriggerKeydown"
  >
    <div class="sdr-device-dropdown-selected">
      <slot name="selected" />
      <span class="sdr-device-dropdown-arrow"></span>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="sdr-device-menu sdr-device-menu--open"
      :class="menuClass"
      :style="menuStyle"
      v-bind="menuAttrs"
      @click.stop
    >
      <slot name="options" :close="closeMenu" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * `BaseSelectMenu` — the flat-dark custom dropdown primitive underlying the
 * SDR pickers (`SdrStepPicker`, `SdrSampleRatePicker`, `SdrDeviceSelector`,
 * `SdrSettingsAccordion`'s SAMPLE RATE):
 * a `tabindex` trigger plus a body-teleported, fixed-position menu anchored
 * from the trigger's rect at open time. Extracted from (not a rewrite of)
 * the trigger/Teleport template those pickers each carried on top of
 * `useTeleportedMenu`, which still owns the state + dismiss behaviour
 * (outside click, settle-window scroll, resize).
 *
 * The base renders the trigger shell (`sdr-device-dropdown` + `--open`/
 * `--loading`), the selected-content wrapper + arrow, and the teleported
 * menu shell (`sdr-device-menu`); callers keep their option models and row
 * templates:
 * - `#selected` — the trigger's content, rendered before the arrow glyph
 *   (text span, connection dot, padlock, …).
 * - `#options` — the menu rows; receives `{ close }` so a row click can
 *   dismiss the menu.
 *
 * Fallthrough attributes land on the trigger element (`class`, `aria-label`,
 * `aria-controls`, `aria-owns`, `aria-activedescendant`, …). The default
 * keyboard model matches the simple pickers — Enter/Space toggles (gated by
 * `disabled` after `preventDefault`), Escape closes; callers with a
 * different model (fully-gated triggers, listbox arrow navigation) opt out
 * via `customKeyboard` and drive the exposed `menuOpen`/`openMenu`/
 * `toggleMenu`/`closeMenu` from their own `@trigger-keydown` handler.
 *
 * The `sdr-device-*` family (trigger shell, teleported menu, item rows) is
 * styled by the unscoped block below, moved here in one piece in the B10
 * co-location sweep — the item rules are rendered by the pickers' `#options`
 * slots, but splitting the family across files would risk its internal
 * cascade order (`--active` before `--selected`). The per-picker menu-class
 * hooks (e.g. `.sdr-step-menu`) carry no CSS rules today, and
 * the contextual overrides in feature sheets (`.sdr-search-adhoc-col …`,
 * `.sdr-ef-setting …`) are higher-specificity and order-immune.
 */
import { ref, watch } from 'vue'
import { useTeleportedMenu } from '@/composables/useTeleportedMenu'

// Multi-root (trigger + Teleport): attrs are bound explicitly on the trigger.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** Renders the trigger's loading/disabled style (`--loading`). Purely visual — gating is `disabled`. */
  loading?: boolean
  /**
   * Ignores trigger clicks and the default keyboard toggle (Escape still
   * closes, matching the pre-extraction pickers). Deliberately does NOT gate
   * the exposed `openMenu`/`toggleMenu`/`closeMenu` — callers with quirkier
   * gates (e.g. `SdrStepPicker`'s deliberately ungated keyboard) own them
   * via `customKeyboard`.
   */
  disabled?: boolean
  /**
   * Popup-trigger ARIA (`role`, `aria-haspopup="listbox"`, live
   * `aria-expanded`). Omit to render a bare styled div (the step and
   * settings sample-rate pickers predate the ARIA and stay byte-identical).
   */
  triggerRole?: 'button' | 'combobox'
  /**
   * Replaces the default trigger keydown handling with a `trigger-keydown`
   * emit so the caller can implement its own keyboard model against the
   * exposed menu controls.
   */
  customKeyboard?: boolean
  /** Extra class(es) for the teleported menu element (e.g. `sdr-step-menu`). */
  menuClass?: string
  /** Extra attributes for the teleported menu element (e.g. `role="listbox"` + its label). */
  menuAttrs?: Record<string, string>
}>()

const emit = defineEmits<{
  /** The menu opened (any path: click, keyboard, exposed calls). */
  (event: 'open'): void
  /** The menu closed (any path, including outside click/scroll/resize dismissal). */
  (event: 'close'): void
  /** `customKeyboard` only: a keydown reached the trigger. */
  (event: 'trigger-keydown', keyboardEvent: KeyboardEvent): void
}>()

const triggerRef = ref<HTMLElement | null>(null)
const {
  menuOpen,
  menuStyle,
  openMenu: openTeleportedMenu,
  toggleMenu: toggleTeleportedMenu,
  closeMenu,
} = useTeleportedMenu()

// Watching the ref (rather than wrapping open/close) catches every state
// change, including the composable's own dismissals (outside click, scroll,
// resize), so callers tracking open state never go stale.
watch(menuOpen, (isNowOpen) => {
  if (isNowOpen) {
    emit('open')
  } else {
    emit('close')
  }
})

/** Position from the trigger rect and open the menu. */
function openMenu() {
  openTeleportedMenu(triggerRef.value)
}

/** Close the menu when open, otherwise open it. */
function toggleMenu() {
  toggleTeleportedMenu(triggerRef.value)
}

function onTriggerClick() {
  if (props.disabled) return
  toggleMenu()
}

function onTriggerKeydown(keyboardEvent: KeyboardEvent) {
  if (props.customKeyboard) {
    emit('trigger-keydown', keyboardEvent)
    return
  }
  if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
    keyboardEvent.preventDefault()
    if (!props.disabled) toggleMenu()
  }
  if (keyboardEvent.key === 'Escape') closeMenu()
}

defineExpose({
  /** Whether the menu is currently open (reactive). */
  menuOpen,
  openMenu,
  toggleMenu,
  closeMenu,
})
</script>

<!-- Unscoped on purpose (B10 CSS co-location): the device-dropdown family
     moved here verbatim from SdrPanel.css in one piece, preserving its
     internal order (item base -> :hover/--active -> --selected; the
     --selected rule was always the later, winning rule and remains last).
     `scoped` would add [data-v] attribute selectors and RAISE specificity
     over the original global rules — and the item classes are rendered by
     the pickers' slots, outside this component's scope id anyway. Loaded
     before the feature sheets' contextual overrides is fine: those are
     higher-specificity (id- or descendant-prefixed), so order between
     files never decides a winner. -->
<style>
.sdr-device-dropdown {
  position: relative;
  width: 100%;
  height: 34px;
  cursor: pointer;
  outline: none;
  user-select: none;
  background: rgba(255, 255, 255, 0.04);
  border: none;
  border-radius: 2px;
  box-sizing: border-box;
}

.sdr-device-dropdown:focus,
.sdr-device-dropdown--open {
  background: rgba(255, 255, 255, 0.07);
}

.sdr-device-dropdown-selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 10px;
  gap: 8px;
}

.sdr-device-dropdown-selected .sdr-conn-dot {
  flex-shrink: 0;
}

.sdr-device-dropdown-text {
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.25);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdr-device-dropdown-text--chosen {
  color: rgba(255, 255, 255, 0.75);
}

/* Another Sentinel controls the shared tuner: the red padlock (below) signals
   this, while the device name keeps its normal white so the radio stays easy to
   read. The read-only state is still announced via the sr-only status. */

.sdr-device-lock {
  flex-shrink: 0;
  display: block;
  color: #ff5050;
}

.sdr-device-dropdown-arrow {
  flex-shrink: 0;
  width: 8px;
  height: 5px;
  margin-left: 8px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(255,255,255,0.2)'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  transition: transform 0.15s;
}

.sdr-device-dropdown--open .sdr-device-dropdown-arrow {
  transform: rotate(180deg);
}

.sdr-device-dropdown--loading {
  opacity: 0.45;
  pointer-events: none;
  cursor: default;
}

.sdr-device-menu {
  display: none;
  position: fixed;
  z-index: 99999;
  background: #13171f;
  border: none;
  overflow-y: auto;
  max-height: 220px;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.sdr-device-menu::-webkit-scrollbar {
  width: 8px;
}
.sdr-device-menu::-webkit-scrollbar-track {
  background: transparent;
}
.sdr-device-menu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  border: 2px solid #13171f;
}
.sdr-device-menu::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.32);
}

.sdr-device-menu.sdr-device-menu--open {
  display: block;
}

.sdr-device-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.1s,
    color 0.1s;
}

.sdr-device-menu-item:hover,
.sdr-device-menu-item--active {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.sdr-device-menu-item-label {
  min-width: 0;
}

/* Read-only row: this radio is controlled by another Sentinel. The red padlock
   (.sdr-device-menu-item-lock) carries that signal; the radio name and host keep
   their normal colours so the row stays readable. */

.sdr-device-menu-placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.sdr-device-menu-item-host {
  display: block;
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.05em;
  text-transform: none;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 2px;
}

.sdr-device-menu-item:hover .sdr-device-menu-item-host {
  color: rgba(255, 255, 255, 0.55);
}

/* Highlight the currently chosen sample rate in the menu. */
.sdr-device-menu-item--selected {
  color: #c8ff00;
}
</style>
