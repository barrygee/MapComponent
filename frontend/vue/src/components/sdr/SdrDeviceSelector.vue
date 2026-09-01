<template>
  <BaseSelectMenu
    ref="selectMenuRef"
    :loading="loading"
    trigger-role="combobox"
    aria-label="Radio device"
    aria-controls="sdr-device-listbox"
    aria-owns="sdr-device-listbox"
    :aria-activedescendant="activeDescId"
    custom-keyboard
    @trigger-keydown="onDropdownKey"
    @open="onMenuOpen"
  >
    <template #selected>
      <div
        class="sdr-conn-dot"
        :class="connected ? 'sdr-dot-on' : 'sdr-dot-off'"
        :title="connected ? 'CONNECTED' : 'DISCONNECTED'"
      ></div>
      <span
        class="sdr-device-dropdown-text"
        :class="{
          'sdr-device-dropdown-text--chosen': selectedRadioId !== null,
          'sdr-device-dropdown-text--readonly': readOnly,
        }"
        >{{ label }}</span
      >
      <!-- Padlock shown when another Sentinel controls the shared tuner;
           decorative here (the sr-only status below announces the state). -->
      <svg
        v-if="readOnly"
        class="sdr-device-lock"
        width="12"
        height="12"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6V4.5a3 3 0 0 1 6 0V6m-7 0h8v6H3V6Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
    </template>
    <template #options>
      <div id="sdr-device-listbox" role="listbox" aria-label="Available radios">
        <div
          :id="optionId(0)"
          role="option"
          class="sdr-device-menu-item sdr-device-menu-placeholder"
          :class="{ 'sdr-device-menu-item--active': highlight === 0 }"
          :aria-selected="highlight === 0"
          @click="pickRadio(null)"
          @mousemove="highlight = 0"
        >
          — select radio —
        </div>
        <div
          v-for="(r, index) in menuRadios"
          :id="optionId(index + 1)"
          :key="r.id"
          role="option"
          class="sdr-device-menu-item"
          :class="{
            'sdr-device-menu-item--active': highlight === index + 1,
            'sdr-device-menu-item--readonly': isRadioReadOnly(r),
            'sdr-device-menu-item--reserved': reservationFor(r) !== null,
          }"
          :aria-selected="highlight === index + 1"
          :aria-disabled="reservationFor(r) !== null"
          @click="pickRadio(r)"
          @mousemove="highlight = index + 1"
        >
          <span class="sdr-device-menu-item-label"
            >{{ r.name
            }}<span class="sdr-device-menu-item-host">{{
              reservationFor(r) ? `RESERVED · ${reservationFor(r)} RECEIVER` : r.host
            }}</span></span
          >
          <!-- Padlock: this radio is controlled by another Sentinel, or is
               reserved as a domain receiver. Only the connected radio's remote
               lock is known, so only its row is marked for that case. -->
          <svg
            v-if="isRadioReadOnly(r) || reservationFor(r) !== null"
            class="sdr-device-lock sdr-device-menu-item-lock"
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 6V4.5a3 3 0 0 1 6 0V6m-7 0h8v6H3V6Z"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </div>
      <!-- Non-selectable status note lives outside the listbox. -->
      <div v-if="menuRadios.length === 0" class="sdr-device-menu-item sdr-device-menu-placeholder">
        no radios configured
      </div>
    </template>
  </BaseSelectMenu>
  <span v-if="readOnly" class="sr-only" role="status"
    >Another Sentinel is controlling this radio</span
  >
</template>

<script setup lang="ts">
/**
 * SdrDeviceSelector — the RADIO tab's device combobox: connection dot, the
 * selected radio's name (with the read-only follower padlock + sr-only
 * announcement) and the body-teleported listbox of enabled radios with full
 * keyboard navigation (arrows/Home/End move the highlight, Enter/Space
 * selects, Escape/Tab close).
 *
 * Selection is the parent's ENGINE concern — picking a row only emits
 * `select`; the parent's selectRadio() owns the control-socket lifecycle,
 * ownership release and label/state updates, which is also why `label`,
 * `loading`, `connected` and `selectedRadioId` arrive as props rather than
 * living here.
 *
 * The menu list is re-read from the store at open time (the store owns
 * `radios`). Reachability is deliberately NOT probed here: rtl_tcp is
 * single-client, so a throwaway probe socket disturbs the dongle — the
 * connection dot reflects the real control connection instead.
 *
 * The trigger, teleported menu and dismiss behaviour (outside click,
 * settle-window scroll, resize) come from BaseSelectMenu; this component
 * opts out of the default keyboard model (`custom-keyboard`) and adds the
 * listbox highlight/keyboard model on top, driving the exposed menu
 * controls. The `open` event is the open-time hook — every open path (click
 * or keyboard) resets the highlight and re-reads the store there. The
 * connection-dot family (`.sdr-conn-dot`, `.sdr-dot-off/-on`) is styled by
 * the unscoped block below (B10 CSS co-location); the dropdown chrome lives
 * with BaseSelectMenu.
 */
import { ref, computed } from 'vue'
import BaseSelectMenu from '@/components/base/BaseSelectMenu.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrRadio } from '@/stores/sdr'

const props = defineProps<{
  /** Text shown in the trigger (radio name / placeholder / loading…). */
  label: string
  /** True until the radio list has been loaded (renders the loading style). */
  loading: boolean
  /** Whether the control connection to the selected radio is up (dot colour). */
  connected: boolean
  /** The currently selected radio id, or null when none is selected. */
  selectedRadioId: number | null
}>()

const emit = defineEmits<{
  /** A row was picked: the parent selects the radio (null = deselect). */
  (event: 'select', radio: SdrRadio | null): void
}>()

const sdrStore = useSdrStore()
const readOnly = computed(() => sdrStore.readOnly)

// A dropdown row is shown read-only (red + padlock) when this instance is a
// follower AND the row is the radio we're connected to — the only radio whose
// lock state we actually know (its control channel is the one we're on).
function isRadioReadOnly(radio: SdrRadio): boolean {
  return readOnly.value && radio.id === props.selectedRadioId
}

/**
 * Which domain has reserved a radio ('APRS' / 'ADS-B'), or null when it is free.
 *
 * A reserved radio is doing a job for another domain — holding a decode bridge,
 * or tuned to 1090 MHz for AIR — so it is listed but not selectable here, with
 * the reason on the row. Retuning it from the panel would silently break that
 * domain; the way to get it back is to deselect it in Settings.
 */
function reservationFor(radio: SdrRadio): string | null {
  return sdrStore.radioReservation(radio.id)
}

const selectMenuRef = ref<InstanceType<typeof BaseSelectMenu> | null>(null)
// Mirrors the base menu's open state reactively (null before first render).
const menuOpen = computed(() => selectMenuRef.value?.menuOpen ?? false)
// 0 = the "select radio" placeholder, 1..N = menuRadios[index-1].
const highlight = ref(0)
const menuRadios = ref<SdrRadio[]>([])

// The device listbox always has the placeholder (index 0) plus one option per
// online radio. The active-descendant id is clamped so it always references a
// rendered option (radios can load in after the menu opens).
const optionCount = computed(() => 1 + menuRadios.value.length)
function optionId(index: number): string {
  return `sdr-device-opt-${index}`
}
const activeDescId = computed(() =>
  menuOpen.value ? optionId(Math.min(highlight.value, optionCount.value - 1)) : undefined,
)

// List every enabled, non-private radio. We deliberately do NOT probe
// reachability here: rtl_tcp is single-client, so opening a throwaway probe
// socket to a radio (then closing it) disturbs the dongle and made the
// immediately-following control connect fail — the user had to select the
// radio twice before it connected. Reachability is shown by the device dot
// once a radio is selected and the real control connection is established;
// the menu just lists what's configured. A `visibility: 'private'` device
// (ADR-0009) still runs and holds its port but is deliberately excluded from
// this operational list — it exists for another consumer, not this operator.
function populateMenuRadios() {
  menuRadios.value = sdrStore.radios.filter(
    (radio) => radio.enabled && radio.visibility !== 'private',
  )
}

// Runs on every open path (trigger click or keyboard) via the base's `open`
// event, before the menu body renders.
function onMenuOpen() {
  highlight.value = 0
  populateMenuRadios()
}

function pickRadio(radio: SdrRadio | null) {
  // A reserved row is inert: the menu stays open so the operator can pick
  // another radio, and the reason is already on the row they clicked.
  if (radio && reservationFor(radio) !== null) return
  // The options only render once the menu (and therefore the ref) exists.
  selectMenuRef.value!.closeMenu()
  emit('select', radio)
}

function selectHighlightedRadio() {
  const index = highlight.value
  // `index` is clamped to 0..menuRadios.length by the key handler, so a non-zero
  // index always resolves to a radio.
  pickRadio(index === 0 ? null : menuRadios.value[index - 1]!)
}

function onDropdownKey(e: KeyboardEvent) {
  // The trigger only fires events once mounted, so the ref is always set.
  const menu = selectMenuRef.value!
  if (!menuOpen.value) {
    // Closed: Enter/Space/Arrow keys open the listbox.
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      menu.openMenu()
    }
    return
  }
  // Open: arrow keys move the highlight, Enter/Space selects, Escape/Tab close.
  const count = optionCount.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlight.value = (highlight.value + 1) % count
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlight.value = (highlight.value - 1 + count) % count
  } else if (e.key === 'Home') {
    e.preventDefault()
    highlight.value = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    highlight.value = count - 1
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    selectHighlightedRadio()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    menu.closeMenu()
  } else if (e.key === 'Tab') {
    menu.closeMenu()
  }
}
</script>

<!-- Unscoped on purpose (B10 CSS co-location): the connection-dot family
     moved here verbatim from SdrPanel.css. The base sizing and the on/off
     colours are disjoint declarations, and the family-context rule in
     BaseSelectMenu's sheet (`.sdr-device-dropdown-selected .sdr-conn-dot`)
     is higher-specificity, so order between the two blocks never decides a
     winner. -->
<style>
.sdr-conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition:
    background 0.3s,
    box-shadow 0.3s;
}

.sdr-dot-off {
  background: rgba(255, 60, 60, 0.6);
}

.sdr-dot-on {
  background: #c8ff00;
}
</style>
