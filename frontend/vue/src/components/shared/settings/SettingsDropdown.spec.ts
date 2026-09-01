import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'

import SettingsDropdown from './SettingsDropdown.vue'

/**
 * Tests for the Settings panel's dropdown.
 *
 * It replaces a native `<select>`, so everything the browser used to give for
 * free has to be proven here: that a keyboard alone can open the list, move
 * through it and choose a row; that the popup carries the listbox roles a
 * screen reader needs; and that a click cannot be swallowed by the trigger's
 * own blur — the reason rows commit on `mousedown`.
 */

const OPTIONS = [
  { value: 'one', label: 'Radio One' },
  { value: 'two', label: 'Radio Two' },
  { value: 'three', label: 'Radio Three' },
]

function mountDropdown(props: Record<string, unknown> = {}) {
  return mount(SettingsDropdown, {
    props: {
      modelValue: '',
      options: OPTIONS,
      accessibleName: 'Test dropdown',
      ...props,
    },
    attachTo: document.body,
  })
}

function trigger(wrapper: ReturnType<typeof mountDropdown>) {
  return wrapper.find('[role="combobox"]')
}

function options(wrapper: ReturnType<typeof mountDropdown>) {
  return wrapper.findAll('[role="option"]')
}

describe('SettingsDropdown', () => {
  it('shows the placeholder in the unset style until a value is chosen', () => {
    const wrapper = mountDropdown({ placeholder: 'Not set' })
    const text = wrapper.find('.settings-dropdown-text')
    expect(text.text()).toBe('Not set')
    expect(text.classes()).not.toContain('settings-dropdown-text--chosen')
  })

  it("shows the chosen option's label in the chosen style", () => {
    const wrapper = mountDropdown({ modelValue: 'two', placeholder: 'Not set' })
    const text = wrapper.find('.settings-dropdown-text')
    expect(text.text()).toBe('Radio Two')
    expect(text.classes()).toContain('settings-dropdown-text--chosen')
  })

  it('marks only the chosen row as selected', () => {
    const wrapper = mountDropdown({ modelValue: 'two' })
    const selected = options(wrapper).filter((o) => o.attributes('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.text()).toBe('Radio Two')
  })

  it('opens and closes on click, reflecting it in aria-expanded', async () => {
    const wrapper = mountDropdown()
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')

    await trigger(wrapper).trigger('click')
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.settings-dropdown-menu').classes()).toContain(
      'settings-dropdown-menu--open',
    )

    await trigger(wrapper).trigger('click')
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('emits the picked value on mousedown, before the trigger can blur', async () => {
    const wrapper = mountDropdown()
    await trigger(wrapper).trigger('click')
    await options(wrapper)[1]!.trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')).toEqual([['two']])
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('returns focus to the trigger after a mouse pick', async () => {
    const wrapper = mountDropdown()
    await trigger(wrapper).trigger('click')
    await options(wrapper)[0]!.trigger('mousedown')

    expect(document.activeElement).toBe(trigger(wrapper).element)
    wrapper.unmount()
  })

  it('does not re-emit when the already-chosen row is picked', async () => {
    const wrapper = mountDropdown({ modelValue: 'two' })
    await trigger(wrapper).trigger('click')
    await options(wrapper)
      .find((o) => o.text() === 'Radio Two')!
      .trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('closes when the trigger loses focus', async () => {
    const wrapper = mountDropdown()
    await trigger(wrapper).trigger('click')
    await trigger(wrapper).trigger('blur')

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('follows the pointer with the active-row highlight', async () => {
    const wrapper = mountDropdown()
    await trigger(wrapper).trigger('click')
    await options(wrapper)[2]!.trigger('mousemove')

    expect(options(wrapper)[2]!.classes()).toContain('settings-dropdown-item--active')
    expect(trigger(wrapper).attributes('aria-activedescendant')).toBe(
      options(wrapper)[2]!.attributes('id'),
    )
  })

  describe('when it is disabled', () => {
    // The native `disabled` attribute is the gate: a disabled button receives
    // neither click nor keydown, so there is nothing for the open path to
    // second-guess.
    it('disables the trigger button, so nothing can open the list', async () => {
      const wrapper = mountDropdown({ disabled: true })
      expect((trigger(wrapper).element as HTMLButtonElement).disabled).toBe(true)

      await trigger(wrapper).trigger('click')
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('.settings-dropdown-menu').classes()).not.toContain(
        'settings-dropdown-menu--open',
      )
    })

    it('is enabled by default', () => {
      const wrapper = mountDropdown()
      expect((trigger(wrapper).element as HTMLButtonElement).disabled).toBe(false)
    })
  })

  describe('keyboard', () => {
    it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])('opens the list on %s', async (key) => {
      const wrapper = mountDropdown()
      await trigger(wrapper).trigger('keydown', { key })
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('true')
    })

    it('starts from the chosen row rather than the top of the list', async () => {
      const wrapper = mountDropdown({ modelValue: 'three' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })

      expect(options(wrapper)[2]!.classes()).toContain('settings-dropdown-item--active')
    })

    it('moves down and up through the rows', async () => {
      const wrapper = mountDropdown()
      // Nothing chosen, so the list opens with no active row and the first
      // ArrowDown lands on the top one rather than skipping it.
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      expect(options(wrapper)[0]!.classes()).toContain('settings-dropdown-item--active')

      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      expect(options(wrapper)[1]!.classes()).toContain('settings-dropdown-item--active')

      await trigger(wrapper).trigger('keydown', { key: 'ArrowUp' })
      expect(options(wrapper)[0]!.classes()).toContain('settings-dropdown-item--active')
    })

    it('clamps at the ends instead of wrapping', async () => {
      const wrapper = mountDropdown({ modelValue: 'one' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' }) // opens on "one"
      await trigger(wrapper).trigger('keydown', { key: 'ArrowUp' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowUp' })
      expect(options(wrapper)[0]!.classes()).toContain('settings-dropdown-item--active')

      await trigger(wrapper).trigger('keydown', { key: 'End' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      expect(options(wrapper)[2]!.classes()).toContain('settings-dropdown-item--active')
    })

    it('jumps to the first and last rows with Home and End', async () => {
      const wrapper = mountDropdown()
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      await trigger(wrapper).trigger('keydown', { key: 'End' })
      expect(options(wrapper)[2]!.classes()).toContain('settings-dropdown-item--active')

      await trigger(wrapper).trigger('keydown', { key: 'Home' })
      expect(options(wrapper)[0]!.classes()).toContain('settings-dropdown-item--active')
    })

    it('ignores Home and End while the list is closed', async () => {
      const wrapper = mountDropdown()
      await trigger(wrapper).trigger('keydown', { key: 'Home' })
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    })

    it.each(['Enter', ' '])('chooses the active row on %s', async (key) => {
      const wrapper = mountDropdown()
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' }) // opens
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' }) // → "one"
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' }) // → "two"
      await trigger(wrapper).trigger('keydown', { key })

      expect(wrapper.emitted('update:modelValue')).toEqual([['two']])
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    })

    it('closes without choosing when no row is active', async () => {
      // Opening with nothing chosen leaves the active index off the list, so
      // Enter must not fall back to picking whatever happens to be first.
      const wrapper = mountDropdown()
      await trigger(wrapper).trigger('keydown', { key: 'Enter' })
      await trigger(wrapper).trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    })

    it('closes on Escape without choosing', async () => {
      const wrapper = mountDropdown({ modelValue: 'one' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      await trigger(wrapper).trigger('keydown', { key: 'Escape' })

      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })

    it('ignores Escape while the list is closed', async () => {
      const wrapper = mountDropdown()
      const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      trigger(wrapper).element.dispatchEvent(escape)
      expect(escape.defaultPrevented).toBe(false)
    })

    it('leaves other keys to the browser', async () => {
      const wrapper = mountDropdown()
      const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
      trigger(wrapper).element.dispatchEvent(tab)
      expect(tab.defaultPrevented).toBe(false)
    })

    it('cannot move the highlight when there is nothing to list', async () => {
      const wrapper = mountDropdown({ options: [] })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
      await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })

      expect(options(wrapper)).toHaveLength(0)
      expect(trigger(wrapper).attributes('aria-activedescendant')).toBeUndefined()
    })
  })

  it('has no accessibility violations, open or closed', async () => {
    // `region` is disabled: the dropdown always renders inside the Settings
    // panel's landmark, never as a bare page fragment like this.
    const axeOptions = { rules: { region: { enabled: false } } }
    const wrapper = mountDropdown({ modelValue: 'two', placeholder: 'Not set' })
    expect(await axe(wrapper.html(), axeOptions)).toHaveNoViolations()

    await trigger(wrapper).trigger('click')
    expect(await axe(wrapper.html(), axeOptions)).toHaveNoViolations()
    wrapper.unmount()
  })

  it('names both the trigger and the listbox', () => {
    const wrapper = mountDropdown()
    expect(trigger(wrapper).attributes('aria-label')).toBe('Test dropdown')
    expect(wrapper.find('[role="listbox"]').attributes('aria-label')).toBe('Test dropdown')
    expect(trigger(wrapper).attributes('aria-controls')).toBe(
      wrapper.find('[role="listbox"]').attributes('id'),
    )
  })

  it('drops aria-activedescendant when the list is closed', async () => {
    const wrapper = mountDropdown({ modelValue: 'one' })
    await trigger(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(trigger(wrapper).attributes('aria-activedescendant')).toBeDefined()

    await trigger(wrapper).trigger('keydown', { key: 'Escape' })
    expect(trigger(wrapper).attributes('aria-activedescendant')).toBeUndefined()
  })

  it('carries each row value as data-value for its caller', () => {
    const wrapper = mountDropdown()
    expect(options(wrapper).map((o) => o.attributes('data-value'))).toEqual(['one', 'two', 'three'])
  })
})

// Guard against a silent regression in the pick path: `select` closes before it
// emits, so a caller that re-renders on the model change still sees a closed
// menu rather than one that re-opens.
describe('SettingsDropdown — ordering', () => {
  it('is closed by the time the model change is observed', async () => {
    const wrapper = mountDropdown()
    const seen: string[] = []
    await trigger(wrapper).trigger('click')
    wrapper.vm.$watch('modelValue', () => seen.push(trigger(wrapper).attributes('aria-expanded')!))
    await options(wrapper)[0]!.trigger('mousedown')
    await wrapper.setProps({ modelValue: 'one' })

    expect(seen).toEqual(['false'])
  })
})

// A caller can hand over a fresh list at any time (the SDR pickers poll), so the
// component must not hold a stale reference to what it was mounted with.
describe('SettingsDropdown — reactive options', () => {
  it('renders a replaced option list', async () => {
    const wrapper = mountDropdown()
    await wrapper.setProps({ options: [{ value: 'new', label: 'Brand New' }] })

    expect(options(wrapper).map((o) => o.text())).toEqual(['Brand New'])
  })

  it('falls back to the placeholder when the chosen value disappears', async () => {
    const wrapper = mountDropdown({ modelValue: 'one', placeholder: 'Not set' })
    await wrapper.setProps({ options: [{ value: 'other', label: 'Other' }] })

    expect(wrapper.find('.settings-dropdown-text').text()).toBe('Not set')
  })
})

// The spy is only here to prove the component does not reach for globals that
// jsdom lacks; a throw would surface as an unhandled error in the pick path.
describe('SettingsDropdown — no environment assumptions', () => {
  it('picks a row when the trigger cannot be focused', async () => {
    const wrapper = mountDropdown()
    await trigger(wrapper).trigger('click')
    vi.spyOn(trigger(wrapper).element as HTMLButtonElement, 'focus').mockImplementation(() => {})
    await options(wrapper)[0]!.trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')).toEqual([['one']])
  })
})
