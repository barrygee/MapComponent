<template>
  <div
    class="settings-dropdown"
    :class="{ 'settings-dropdown--open': isOpen, 'settings-dropdown--disabled': disabled }"
  >
    <button
      :id="triggerId"
      ref="triggerElement"
      type="button"
      class="settings-dropdown-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      :aria-label="accessibleName"
      :aria-activedescendant="isOpen && activeOption ? optionDomId(activeIndex) : undefined"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKeydown"
      @blur="close"
    >
      <span
        class="settings-dropdown-text"
        :class="{ 'settings-dropdown-text--chosen': selectedOption !== undefined }"
      >
        {{ selectedOption ? selectedOption.label : placeholder }}
      </span>
      <span class="settings-dropdown-arrow" aria-hidden="true"></span>
    </button>
    <div
      :id="listboxId"
      class="settings-dropdown-menu"
      :class="{ 'settings-dropdown-menu--open': isOpen }"
      role="listbox"
      :aria-label="accessibleName"
    >
      <div
        v-for="(option, optionIndex) in options"
        :id="optionDomId(optionIndex)"
        :key="option.value"
        class="settings-dropdown-item"
        :class="{
          'settings-dropdown-item--selected': option.value === modelValue,
          'settings-dropdown-item--active': optionIndex === activeIndex,
        }"
        role="option"
        :data-value="option.value"
        :aria-selected="option.value === modelValue"
        @mousedown.prevent="select(option.value)"
        @mousemove="activeIndex = optionIndex"
      >
        {{ option.label }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SettingsDropdown` — the Settings panel's dropdown, as a reusable control.
 *
 * The panel's design language (square corners, `#e8eaed` fields, uppercase
 * Barlow) has always used a custom listbox rather than a native `<select>`,
 * which no browser lets you style to match. That look previously existed only
 * as the hand-rolled `.tle-dropdown` markup inside the TLE controls, so any new
 * picker either copy-pasted it or fell back to a native select that looked
 * foreign among its neighbours. This is that dropdown, once, with the
 * keyboard/ARIA behaviour the hand-rolled copies never had.
 *
 * Implements the ARIA select-only combobox pattern: focus stays on the trigger
 * and the active option is pointed at with `aria-activedescendant`, so arrow
 * keys work without moving focus into the popup. Enter/Space open the list (or
 * choose the active option), Escape closes it, Home/End jump to the ends, and
 * blur closes — options commit on `mousedown` so a click lands before the
 * trigger's blur can dismiss the menu.
 */
import { computed, ref, useId } from 'vue'

/** One choice in the list. `value` is what the caller round-trips as the model. */
export interface SettingsDropdownOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** Currently chosen value; empty string when nothing is chosen. */
    modelValue: string
    options: SettingsDropdownOption[]
    /** Shown, in the muted "unset" colour, while nothing is chosen. */
    placeholder?: string
    /** Renders the trigger as a disabled button, which is what gates it: a
     * disabled button receives neither click nor keydown, so the open/keyboard
     * paths below need no guard of their own. */
    disabled?: boolean
    /**
     * Accessible name for the trigger and its listbox — required because the
     * chosen value is the only visible text, and it never says what the
     * control chooses. Deliberately NOT named `ariaLabel`; see `BaseIconButton`.
     */
    accessibleName: string
  }>(),
  { placeholder: '', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const isOpen = ref(false)
/** Which option the keyboard is pointing at while the list is open. */
const activeIndex = ref(-1)
const triggerElement = ref<HTMLButtonElement | null>(null)

const componentId = useId()
const triggerId = `${componentId}-trigger`
const listboxId = `${componentId}-listbox`
const optionDomId = (optionIndex: number): string => `${componentId}-option-${optionIndex}`

const selectedOption = computed(() => props.options.find((opt) => opt.value === props.modelValue))
const activeOption = computed(() => props.options[activeIndex.value])

function open(): void {
  isOpen.value = true
  // Point at the current choice so the first arrow key moves from where the
  // operator is, not from the top of an unrelated list.
  activeIndex.value = props.options.findIndex((opt) => opt.value === props.modelValue)
}

function close(): void {
  isOpen.value = false
  activeIndex.value = -1
}

function toggle(): void {
  if (isOpen.value) close()
  else open()
}

function select(value: string): void {
  close()
  // Refocus on a mouse pick: the option row is not focusable, so without this
  // the tab ring would restart from the top of the panel.
  triggerElement.value?.focus()
  if (value === props.modelValue) return
  emit('update:modelValue', value)
}

/** Move the active option by `step`, clamped to the ends of the list. */
function moveActive(step: number): void {
  if (props.options.length === 0) return
  const nextIndex = activeIndex.value + step
  activeIndex.value = Math.min(Math.max(nextIndex, 0), props.options.length - 1)
}

function onTriggerKeydown(keyboardEvent: KeyboardEvent): void {
  switch (keyboardEvent.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      keyboardEvent.preventDefault()
      if (!isOpen.value) open()
      else moveActive(keyboardEvent.key === 'ArrowDown' ? 1 : -1)
      break
    case 'Home':
    case 'End':
      if (!isOpen.value) return
      keyboardEvent.preventDefault()
      activeIndex.value = keyboardEvent.key === 'Home' ? 0 : props.options.length - 1
      break
    case 'Enter':
    case ' ':
      keyboardEvent.preventDefault()
      if (!isOpen.value) open()
      else if (activeOption.value) select(activeOption.value.value)
      else close()
      break
    case 'Escape':
      if (!isOpen.value) return
      keyboardEvent.preventDefault()
      close()
      break
  }
}
</script>

<style scoped>
/* The panel's field look: square corners, flat #e8eaed ground, uppercase
   Barlow — matching the settings text inputs beside it. */
.settings-dropdown {
  position: relative;
  width: 100%;
  height: 37px;
  flex: 1;
  min-width: 0;
}

.settings-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  background-color: #e8eaed;
  cursor: pointer;
  text-align: left;
  user-select: none;
}

.settings-dropdown-trigger:disabled {
  cursor: default;
  opacity: 0.55;
}

.settings-dropdown-trigger:focus-visible {
  outline: 2px solid #10131d;
  outline-offset: -2px;
}

.settings-dropdown--open .settings-dropdown-trigger {
  background-color: #dcdfe3;
}

.settings-dropdown-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.55);
}

.settings-dropdown-text--chosen {
  color: rgba(16, 19, 29, 0.9);
}

.settings-dropdown-arrow {
  flex-shrink: 0;
  width: 8px;
  height: 5px;
  margin-left: 8px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(16,19,29,0.5)'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  transition: transform 0.15s;
}

.settings-dropdown--open .settings-dropdown-arrow {
  transform: rotate(180deg);
}

.settings-dropdown-menu {
  display: none;
  position: absolute;
  z-index: 99999;
  left: 0;
  right: 0;
  margin-top: 6px;
  padding: 4px;
  background: #ffffff;
  border-radius: 0;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
  overflow-y: auto;
  max-height: 240px;
  scrollbar-width: thin;
  scrollbar-color: rgba(16, 19, 29, 0.15) transparent;
}

.settings-dropdown-menu::-webkit-scrollbar {
  width: 4px;
}
.settings-dropdown-menu::-webkit-scrollbar-track {
  background: transparent;
}
.settings-dropdown-menu::-webkit-scrollbar-thumb {
  background: rgba(16, 19, 29, 0.15);
  border-radius: 2px;
}

.settings-dropdown-menu--open {
  display: block;
}

.settings-dropdown-item {
  padding: 9px 12px;
  border-radius: 0;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.75);
  cursor: pointer;
}

/* Hover and keyboard-active share one treatment: the pointer and the arrow
   keys are pointing at the same row, and two different highlights would read
   as two different selections. */
.settings-dropdown-item:hover,
.settings-dropdown-item--active {
  background: #e8eaed;
  color: rgba(16, 19, 29, 0.95);
}

.settings-dropdown-item--selected {
  color: #10131d;
  font-weight: 600;
}
</style>
