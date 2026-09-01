import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrDeviceSelector from './SdrDeviceSelector.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrRadio } from '@/stores/sdr'
import { MENU_OPEN_SETTLE_MS } from '@/composables/useTeleportedMenu'

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  // The teleported menu can linger between mounts — clear it so document
  // queries always resolve to the current instance.
  document.querySelectorAll('.sdr-device-menu').forEach((node) => node.remove())
})

function makeRadio(overrides: Partial<SdrRadio> = {}): SdrRadio {
  return {
    id: 1,
    name: 'Rooftop',
    host: '10.0.0.5',
    port: 1234,
    enabled: true,
    ...overrides,
  }
}

interface MountOptions {
  radios?: SdrRadio[]
  label?: string
  loading?: boolean
  connected?: boolean
  selectedRadioId?: number | null
  readOnly?: boolean
}

function mountSelector(options: MountOptions = {}): VueWrapper {
  const store = useSdrStore()
  store.radios = options.radios ?? [makeRadio()]
  if (options.readOnly) {
    store.controlAvailable = true
    store.isOwner = false
    store.locked = true
  }
  return mount(SdrDeviceSelector, {
    props: {
      label: options.label ?? 'Rooftop',
      loading: options.loading ?? false,
      connected: options.connected ?? false,
      selectedRadioId: options.selectedRadioId !== undefined ? options.selectedRadioId : 1,
    },
    attachTo: document.body,
  })
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.sdr-device-menu .sdr-device-menu-item'))
}

describe('SdrDeviceSelector — trigger', () => {
  it('shows the label, connection dot state and combobox ARIA', () => {
    const wrapper = mountSelector({ connected: true })
    const dropdown = wrapper.find('.sdr-device-dropdown')
    expect(dropdown.attributes('role')).toBe('combobox')
    expect(dropdown.attributes('aria-expanded')).toBe('false')
    expect(dropdown.attributes('aria-activedescendant')).toBeUndefined()
    expect(wrapper.find('.sdr-device-dropdown-text').text()).toBe('Rooftop')
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-on')
    expect(wrapper.find('.sdr-device-dropdown-text').classes()).toContain(
      'sdr-device-dropdown-text--chosen',
    )
  })

  it('shows the disconnected dot, loading style and unchosen text', () => {
    const wrapper = mountSelector({ loading: true, connected: false, selectedRadioId: null })
    expect(wrapper.find('.sdr-conn-dot').classes()).toContain('sdr-dot-off')
    expect(wrapper.find('.sdr-device-dropdown').classes()).toContain('sdr-device-dropdown--loading')
    expect(wrapper.find('.sdr-device-dropdown-text').classes()).not.toContain(
      'sdr-device-dropdown-text--chosen',
    )
  })

  it('shows the padlock and sr-only announcement for a read-only follower', () => {
    const wrapper = mountSelector({ readOnly: true })
    expect(wrapper.find('.sdr-device-lock').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').text()).toContain('Another Sentinel')
    expect(wrapper.find('.sdr-device-dropdown-text').classes()).toContain(
      'sdr-device-dropdown-text--readonly',
    )
  })
})

describe('SdrDeviceSelector — menu', () => {
  it('opens with the placeholder plus one row per ENABLED radio, read from the store at open time', async () => {
    const wrapper = mountSelector({
      radios: [
        makeRadio(),
        makeRadio({ id: 2, name: 'Attic', host: '10.0.0.6' }),
        makeRadio({ id: 3, name: 'Disabled', enabled: false }),
      ],
    })
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    const items = menuItems()
    expect(items).toHaveLength(3) // placeholder + 2 enabled
    expect(items[0].textContent).toContain('select radio')
    expect(items[1].textContent).toContain('Rooftop')
    expect(items[1].textContent).toContain('10.0.0.5')
    expect(wrapper.find('.sdr-device-dropdown').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.sdr-device-dropdown').attributes('aria-activedescendant')).toBe(
      'sdr-device-opt-0',
    )
  })

  it('shows the "no radios configured" note when nothing is enabled', async () => {
    const wrapper = mountSelector({ radios: [makeRadio({ enabled: false })] })
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    expect(document.querySelector('.sdr-device-menu')?.textContent).toContain(
      'no radios configured',
    )
  })

  it('marks only the connected radio row read-only for a follower', async () => {
    const wrapper = mountSelector({
      readOnly: true,
      selectedRadioId: 1,
      radios: [makeRadio(), makeRadio({ id: 2, name: 'Attic' })],
    })
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    const items = menuItems()
    expect(items[1].classList.contains('sdr-device-menu-item--readonly')).toBe(true)
    expect(items[2].classList.contains('sdr-device-menu-item--readonly')).toBe(false)
    expect(items[1].querySelector('.sdr-device-menu-item-lock')).not.toBeNull()
  })

  it('toggles closed on a second click and closes on an outside click', async () => {
    const wrapper = mountSelector()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    document.body.click()
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('survives the settle scroll, then closes on a later scroll and on resize', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(50_000)
    const wrapper = mountSelector()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
    vi.setSystemTime(50_000 + MENU_OPEN_SETTLE_MS + 1)
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })

  it('positions the menu from the trigger rect at open time', async () => {
    const wrapper = mountSelector()
    const trigger = wrapper.find('.sdr-device-dropdown').element as HTMLElement
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 12,
      bottom: 44,
      width: 180,
      top: 24,
      right: 192,
      height: 20,
      x: 12,
      y: 24,
      toJSON: () => ({}),
    } as DOMRect)
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    const menu = document.querySelector('.sdr-device-menu') as HTMLElement
    expect(menu.style.left).toBe('12px')
    expect(menu.style.top).toBe('44px')
    expect(menu.style.width).toBe('180px')
  })
})

describe('SdrDeviceSelector — selection', () => {
  it('emits select with the clicked radio and null for the placeholder', async () => {
    const wrapper = mountSelector({ radios: [makeRadio()] })
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    menuItems()[1].click()
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    menuItems()[0].click()
    await wrapper.vm.$nextTick()
    const emitted = wrapper.emitted('select')!
    expect((emitted[0][0] as SdrRadio).id).toBe(1)
    expect(emitted[1][0]).toBeNull()
  })
})

describe('SdrDeviceSelector — keyboard', () => {
  it('opens with Enter/Space/Arrows and ignores other keys while closed', async () => {
    const wrapper = mountSelector()
    const dropdown = wrapper.find('.sdr-device-dropdown')
    await dropdown.trigger('keydown', { key: 'x' })
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    expect(document.querySelector('.sdr-device-menu')).not.toBeNull()
  })

  it('moves the highlight with arrows/Home/End (wrapping) and updates aria-activedescendant', async () => {
    const wrapper = mountSelector({
      radios: [makeRadio(), makeRadio({ id: 2, name: 'Attic' })],
    })
    const dropdown = wrapper.find('.sdr-device-dropdown')
    await dropdown.trigger('keydown', { key: 'Enter' })
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-1')
    await dropdown.trigger('keydown', { key: 'ArrowUp' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
    // ArrowUp from 0 wraps to the last option.
    await dropdown.trigger('keydown', { key: 'ArrowUp' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-2')
    // ArrowDown from the last wraps back to 0.
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
    await dropdown.trigger('keydown', { key: 'End' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-2')
    await dropdown.trigger('keydown', { key: 'Home' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
    // Unhandled keys leave the highlight alone.
    await dropdown.trigger('keydown', { key: 'x' })
    expect(dropdown.attributes('aria-activedescendant')).toBe('sdr-device-opt-0')
  })

  it('highlights rows on mousemove', async () => {
    const wrapper = mountSelector()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    menuItems()[1].dispatchEvent(new MouseEvent('mousemove'))
    await wrapper.vm.$nextTick()
    expect(menuItems()[1].classList.contains('sdr-device-menu-item--active')).toBe(true)
  })

  it('selects the highlighted radio with Enter and the placeholder at index 0', async () => {
    const wrapper = mountSelector({ radios: [makeRadio()] })
    const dropdown = wrapper.find('.sdr-device-dropdown')
    await dropdown.trigger('keydown', { key: 'Enter' })
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    await dropdown.trigger('keydown', { key: 'Enter' })
    expect((wrapper.emitted('select')![0][0] as SdrRadio).id).toBe(1)
    await dropdown.trigger('keydown', { key: ' ' })
    await dropdown.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('select')![1][0]).toBeNull()
  })

  it('closes with Escape and Tab', async () => {
    const wrapper = mountSelector()
    const dropdown = wrapper.find('.sdr-device-dropdown')
    await dropdown.trigger('keydown', { key: 'Enter' })
    await dropdown.trigger('keydown', { key: 'Escape' })
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
    await dropdown.trigger('keydown', { key: 'Enter' })
    await dropdown.trigger('keydown', { key: 'Tab' })
    expect(document.querySelector('.sdr-device-menu')).toBeNull()
  })
})

describe('SdrDeviceSelector — accessibility', () => {
  it('has no axe violations with the listbox open and a read-only row', async () => {
    const wrapper = mountSelector({
      readOnly: true,
      radios: [makeRadio(), makeRadio({ id: 2, name: 'Attic' })],
    })
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    expect(
      await axe(document.body.innerHTML, {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})

// A radio named as a domain receiver in Settings (AIR's ADS-B source, LAND's
// APRS decoder) is doing a job that retuning it from here would silently break,
// so it is listed for context but cannot be picked.
describe('SdrDeviceSelector — radios reserved by a domain', () => {
  function mountWithReservedAprsRadio() {
    const store = useSdrStore()
    store.setAprsRadioId(2)
    return mountSelector({
      radios: [makeRadio(), makeRadio({ id: 2, name: 'Attic', host: '10.0.0.6' })],
    })
  }

  it('says which domain reserved the radio, in place of its host', async () => {
    const wrapper = mountWithReservedAprsRadio()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    const reservedRow = menuItems()[2]!

    expect(reservedRow.textContent).toContain('RESERVED · APRS RECEIVER')
    expect(reservedRow.textContent).not.toContain('10.0.0.6')
  })

  it('padlocks the reserved row and marks it unavailable to assistive tech', async () => {
    const wrapper = mountWithReservedAprsRadio()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    const items = menuItems()

    expect(items[2]!.classList).toContain('sdr-device-menu-item--reserved')
    expect(items[2]!.getAttribute('aria-disabled')).toBe('true')
    expect(items[2]!.querySelector('.sdr-device-menu-item-lock')).not.toBeNull()
    // The free radio beside it is untouched.
    expect(items[1]!.getAttribute('aria-disabled')).toBe('false')
    expect(items[1]!.querySelector('.sdr-device-menu-item-lock')).toBeNull()
  })

  it('ignores a click on a reserved row, leaving the menu open to pick another', async () => {
    const wrapper = mountWithReservedAprsRadio()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    menuItems()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.find('.sdr-device-dropdown').attributes('aria-expanded')).toBe('true')
  })

  it('ignores the keyboard selecting a reserved row', async () => {
    const wrapper = mountWithReservedAprsRadio()
    const dropdown = wrapper.find('.sdr-device-dropdown')
    await dropdown.trigger('click')
    // 0 = placeholder, 1 = free radio, 2 = the reserved one.
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    await dropdown.trigger('keydown', { key: 'ArrowDown' })
    await dropdown.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('still lets a free radio be picked while another is reserved', async () => {
    const wrapper = mountWithReservedAprsRadio()
    await wrapper.find('.sdr-device-dropdown').trigger('click')
    menuItems()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('select')![0]![0]).toMatchObject({ id: 1 })
  })
})
