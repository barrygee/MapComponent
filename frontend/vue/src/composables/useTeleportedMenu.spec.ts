import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { useTeleportedMenu, MENU_OPEN_SETTLE_MS } from './useTeleportedMenu'

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// A minimal harness: a trigger div whose clicks toggle the menu, exposing the
// composable's returns for assertions. Mirrors how the SDR pickers consume it
// (trigger element passed per call, menu bound to menuOpen/menuStyle).
const TeleportedMenuHarness = defineComponent({
  setup(props, { expose }) {
    const menu = useTeleportedMenu()
    expose(menu)
    return () =>
      h('div', {
        class: 'harness-trigger',
        // .stop like the real picker triggers — without it the click would
        // bubble to the composable's own document-click dismiss listener.
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          menu.toggleMenu(event.currentTarget as HTMLElement)
        },
      })
  },
})

interface HarnessApi {
  menuOpen: boolean
  menuStyle: Record<string, string>
  openMenu: (triggerElement: HTMLElement | null) => void
  toggleMenu: (triggerElement: HTMLElement | null) => void
  closeMenu: () => void
}

function mountHarness(): { wrapper: VueWrapper; api: HarnessApi } {
  const wrapper = mount(TeleportedMenuHarness, { attachTo: document.body })
  return { wrapper, api: wrapper.vm as unknown as HarnessApi }
}

/**
 * A harness that hands the composable its menu element, as BaseSelectMenu does.
 * The menu is a real node outside the trigger, so a click inside it genuinely
 * has to be recognised by the guard rather than by `@click.stop`.
 */
const MenuElementHarness = defineComponent({
  setup(props, { expose }) {
    const menuRef: Ref<HTMLElement | null> = ref(null)
    const menu = useTeleportedMenu({ menuElement: menuRef })
    expose({ ...menu, menuRef })
    return () =>
      h('div', [
        h('div', {
          class: 'harness-trigger',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            menu.toggleMenu(event.currentTarget as HTMLElement)
          },
        }),
        h('div', { class: 'harness-menu', ref: menuRef }, [h('button', { class: 'harness-row' })]),
      ])
  },
})

describe('useTeleportedMenu', () => {
  it('opens positioned from the trigger rect and toggles closed on a second call', async () => {
    const { wrapper, api } = mountHarness()
    const trigger = wrapper.find('.harness-trigger').element as HTMLElement
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 25,
      bottom: 60,
      width: 140,
      top: 40,
      right: 165,
      height: 20,
      x: 25,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect)

    await wrapper.find('.harness-trigger').trigger('click')
    expect(api.menuOpen).toBe(true)
    expect(api.menuStyle).toEqual({ left: '25px', top: '60px', width: '140px' })

    await wrapper.find('.harness-trigger').trigger('click')
    expect(api.menuOpen).toBe(false)
  })

  it('closeMenu dismisses an open menu', async () => {
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')
    expect(api.menuOpen).toBe(true)
    api.closeMenu()
    expect(api.menuOpen).toBe(false)
  })

  it('closes on an outside document click', async () => {
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')
    expect(api.menuOpen).toBe(true)
    document.body.click()
    await wrapper.vm.$nextTick()
    expect(api.menuOpen).toBe(false)
  })

  describe('when the caller hands over its menu element', () => {
    it('stays open for a click that came from inside the menu', async () => {
      const wrapper = mount(MenuElementHarness, { attachTo: document.body })
      const api = wrapper.vm as unknown as HarnessApi
      await wrapper.find('.harness-trigger').trigger('click')
      expect(api.menuOpen).toBe(true)

      // The row's own click bubbles to the document; without the guard it would
      // dismiss the menu the operator is clicking into.
      wrapper.find('.harness-row').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(api.menuOpen).toBe(true)
    })

    it('still closes for a click outside it', async () => {
      const wrapper = mount(MenuElementHarness, { attachTo: document.body })
      const api = wrapper.vm as unknown as HarnessApi
      await wrapper.find('.harness-trigger').trigger('click')

      document.body.click()
      await wrapper.vm.$nextTick()

      expect(api.menuOpen).toBe(false)
    })

    it('closes for an event with no element target', async () => {
      const wrapper = mount(MenuElementHarness, { attachTo: document.body })
      const api = wrapper.vm as unknown as HarnessApi
      await wrapper.find('.harness-trigger').trigger('click')

      // A synthesised event can carry a non-Node target; that is not "inside".
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(api.menuOpen).toBe(false)
    })
  })

  it('closes on window resize', async () => {
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(api.menuOpen).toBe(false)
  })

  it('ignores the settle scroll right after opening, then closes on a later scroll', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(50_000)
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')

    // Inside the settle window: the browser scrolling the focused trigger
    // into view must not dismiss the menu it just opened.
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(api.menuOpen).toBe(true)

    // Past the settle window: a genuine user scroll dismisses it.
    vi.setSystemTime(50_000 + MENU_OPEN_SETTLE_MS + 1)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(api.menuOpen).toBe(false)
  })

  it('re-arms the settle window on every open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(50_000)
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')

    // Close and reopen well past the first settle window…
    vi.setSystemTime(50_000 + MENU_OPEN_SETTLE_MS + 100)
    api.closeMenu()
    await wrapper.find('.harness-trigger').trigger('click')

    // …the settle scroll after the SECOND open must still be ignored.
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(api.menuOpen).toBe(true)
  })

  it('removes its document/window listeners on unmount', async () => {
    const { wrapper, api } = mountHarness()
    await wrapper.find('.harness-trigger').trigger('click')
    const trigger = wrapper.find('.harness-trigger').element as HTMLElement
    wrapper.unmount()
    // Listeners are gone: reopening state is untouched by document clicks.
    api.openMenu(trigger)
    document.body.click()
    expect(api.menuOpen).toBe(true)
  })
})
