import { ref, type Ref } from 'vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { useWindowEvent } from '@/composables/useWindowEvent'

/**
 * How long after a menu opens that scroll events are ignored rather than
 * dismissing it. Opening a menu focuses its (tabindex) trigger, and the
 * browser scrolls that trigger into view — a single settle scroll fires ~one
 * frame after open. Closing on it would dismiss the menu the instant it
 * opens; a genuine user scroll always lands well after this window.
 */
export const MENU_OPEN_SETTLE_MS = 250

/**
 * useTeleportedMenu — shared state + behaviour for the flat-dark dropdown
 * pattern used across the SDR pickers: a trigger element plus a
 * body-teleported, position: fixed menu anchored once at open time from the
 * trigger's bounding rect.
 *
 * Owns the full dismiss behaviour, matching native <select>: outside click,
 * panel scroll past the open-settle window (see MENU_OPEN_SETTLE_MS), and
 * window resize. Callers keep their own trigger/menu templates, option
 * models, keyboard handlers and disabled gates — they bind `menuOpen` /
 * `menuStyle` and call `toggleMenu`/`openMenu`/`closeMenu`.
 *
 * The trigger element is passed per call (rather than captured at setup) so
 * callers can position from a template ref OR from `event.currentTarget` —
 * inside a v-for, Vue makes a template ref an array, so currentTarget is the
 * reliable handle there.
 *
 * Returns:
 * - `menuOpen` — whether the menu is rendered (bind the Teleport's v-if).
 * - `menuStyle` — fixed-position style for the menu (bind :style).
 * - `openMenu(triggerElement)` — position from the trigger rect, open, and
 *   arm the settle window.
 * - `toggleMenu(triggerElement)` — close when open, otherwise openMenu.
 * - `closeMenu()` — dismiss.
 */
export interface TeleportedMenuOptions {
  /**
   * The teleported menu element, when the caller renders one.
   *
   * The outside-click dismiss consults it rather than relying on the menu's own
   * `@click.stop`: that handler is attached during the patch that mounts the
   * menu, and a click landing before it is bound reaches the document handler
   * and dismisses a menu the user was clicking *into*. Asking "did this click
   * come from inside the menu?" cannot race, because it reads the DOM at the
   * moment of the event.
   */
  menuElement?: Ref<HTMLElement | null>
}

export function useTeleportedMenu(options: TeleportedMenuOptions = {}) {
  const menuOpen = ref(false)
  const menuStyle = ref<Record<string, string>>({})

  // Armed at open time; scrolls within the settle window are the browser
  // scrolling the focused trigger into view, not the user dismissing the menu.
  let openedAtMs = 0

  function openMenu(triggerElement: HTMLElement | null) {
    // Every caller's trigger is rendered before the menu can be toggled, so
    // the element is always present here.
    /* v8 ignore start */
    if (!triggerElement) return
    /* v8 ignore stop */
    const rect = triggerElement.getBoundingClientRect()
    menuStyle.value = {
      left: rect.left + 'px',
      top: rect.bottom + 'px',
      width: rect.width + 'px',
    }
    menuOpen.value = true
    openedAtMs = Date.now()
  }

  function toggleMenu(triggerElement: HTMLElement | null) {
    if (menuOpen.value) {
      closeMenu()
      return
    }
    openMenu(triggerElement)
  }

  function closeMenu() {
    menuOpen.value = false
  }

  function closeOnScroll() {
    if (Date.now() - openedAtMs < MENU_OPEN_SETTLE_MS) return
    closeMenu()
  }

  /** Dismiss on any click that did not come from inside the menu itself. */
  function closeOnOutsideClick(event: MouseEvent): void {
    const menuEl = options.menuElement?.value
    const target = event.target
    if (menuEl && target instanceof Node && menuEl.contains(target)) return
    closeMenu()
  }

  useDocumentEvent('click', closeOnOutsideClick)
  // Capture phase so scrolls from the inner side-panel container (a
  // descendant, and scroll doesn't bubble) still reach this handler and
  // dismiss the menu.
  useDocumentEvent('scroll', closeOnScroll, { capture: true })
  useWindowEvent('resize', closeMenu)

  return { menuOpen, menuStyle, openMenu, toggleMenu, closeMenu }
}
