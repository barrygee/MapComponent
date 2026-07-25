import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrFavouriteStar from './SdrFavouriteStar.vue'

enableAutoUnmount(afterEach)

function mountStar(
  props: { favourite?: boolean; frequencyLabel?: string; disabled?: boolean } = {},
): VueWrapper {
  return mount(SdrFavouriteStar, {
    props: {
      favourite: props.favourite ?? false,
      frequencyLabel: props.frequencyLabel ?? 'Tower',
      disabled: props.disabled,
    },
    attachTo: document.body,
  })
}

describe('SdrFavouriteStar — rendering', () => {
  it('renders an outline star and the "Favourite" accessible name when not favourited', () => {
    const wrapper = mountStar({ favourite: false, frequencyLabel: 'Tower' })
    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('Favourite Tower')
    expect(wrapper.find('polygon').attributes('fill')).toBe('none')
  })

  it('renders a solid star and the "Unfavourite" accessible name when favourited', () => {
    const wrapper = mountStar({ favourite: true, frequencyLabel: 'Tower' })
    const button = wrapper.find('button')
    expect(button.attributes('aria-label')).toBe('Unfavourite Tower')
    expect(wrapper.find('polygon').attributes('fill')).toBe('currentColor')
  })

  it('reacts to a changed favourite prop on the same instance (state-reflecting name)', async () => {
    const wrapper = mountStar({ favourite: false, frequencyLabel: 'Tower' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Favourite Tower')
    await wrapper.setProps({ favourite: true })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Unfavourite Tower')
  })

  it('disables the button when disabled is true', () => {
    const wrapper = mountStar({ disabled: true })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('leaves the button enabled when disabled is not passed', () => {
    const wrapper = mountStar()
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})

describe('SdrFavouriteStar — interaction', () => {
  it('emits toggle when clicked', async () => {
    const wrapper = mountStar()
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('moves DOM focus to the button via the exposed focus() method', () => {
    const wrapper = mountStar()
    const button = wrapper.find('button').element as HTMLButtonElement
    expect(document.activeElement).not.toBe(button)
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(button)
  })

  it('no-ops focus() once the underlying button ref is gone (e.g. after unmount)', () => {
    const wrapper = mountStar()
    const focusFn = (wrapper.vm as unknown as { focus: () => void }).focus
    wrapper.unmount()
    // The internal $el ref is cleared on unmount, so this exercises the
    // defensive `instanceof HTMLElement` guard's false branch instead of
    // throwing on a null/undefined element.
    expect(() => focusFn()).not.toThrow()
  })
})

describe('SdrFavouriteStar — accessibility', () => {
  it('has no axe violations in either favourite state', async () => {
    const favourited = mountStar({ favourite: true })
    expect(await axe(favourited.html())).toHaveNoViolations()
    favourited.unmount()
    const unfavourited = mountStar({ favourite: false })
    expect(await axe(unfavourited.html())).toHaveNoViolations()
  })
})
