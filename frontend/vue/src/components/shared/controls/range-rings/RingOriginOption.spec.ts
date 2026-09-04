import { describe, it, expect, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import RingOriginOption from './RingOriginOption.vue'

enableAutoUnmount(afterEach)

function mountOption(props: Partial<InstanceType<typeof RingOriginOption>['$props']> = {}) {
  return mount(RingOriginOption, {
    props: {
      name: 'Gateshead',
      detail: '54.95000° N 1.53000° W - 213 NM',
      selected: false,
      tabindex: -1 as const,
      ...props,
    },
    attachTo: document.body,
  })
}

describe('RingOriginOption', () => {
  it('is a radio, so the group reads as single-select', () => {
    const row = mountOption().find('[role="radio"]')
    expect(row.attributes('aria-checked')).toBe('false')
  })

  it('shows what the place is called, over where it is', () => {
    const wrapper = mountOption()
    expect(wrapper.find('.ring-origin-option-name').text()).toBe('Gateshead')
    expect(wrapper.find('.ring-origin-option-sub').text()).toBe('54.95000° N 1.53000° W - 213 NM')
  })

  it('marks itself checked when it is the choice', () => {
    const wrapper = mountOption({ selected: true })
    expect(wrapper.find('[role="radio"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.classes()).toContain('ring-origin-option--selected')
  })

  it('takes the group’s tab stop when it is the one focusable row', () => {
    expect(mountOption({ tabindex: 0 }).attributes('tabindex')).toBe('0')
    expect(mountOption({ tabindex: -1 }).attributes('tabindex')).toBe('-1')
  })

  describe('choosing it', () => {
    it('reports a click', async () => {
      const wrapper = mountOption()
      await wrapper.trigger('click')
      expect(wrapper.emitted('select')).toHaveLength(1)
    })

    it.each(['enter', 'space'])('reports %s, so it is operable without a mouse', async (key) => {
      const wrapper = mountOption()
      await wrapper.trigger(`keydown.${key}`)
      expect(wrapper.emitted('select')).toHaveLength(1)
    })

    it('hands every other key to the group, which owns the arrows', async () => {
      const wrapper = mountOption()
      await wrapper.trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.emitted('keydown')).toHaveLength(1)
      expect(wrapper.emitted('select')).toBeUndefined()
    })
  })

  describe('a place with no position', () => {
    it('is listed but marked unchoosable, since hiding it reads as missing', () => {
      const wrapper = mountOption({ disabled: true })
      expect(wrapper.attributes('aria-disabled')).toBe('true')
      expect(wrapper.classes()).toContain('ring-origin-option--disabled')
    })

    it('leaves the refusal to the picker rather than swallowing the event', async () => {
      // The row still reports the click; the picker is the one place that
      // decides a disabled choice does nothing.
      const wrapper = mountOption({ disabled: true })
      await wrapper.trigger('click')
      expect(wrapper.emitted('select')).toHaveLength(1)
    })

    it('carries no aria-disabled when it is choosable', () => {
      expect(mountOption().attributes('aria-disabled')).toBeUndefined()
    })
  })

  it('has no axe violations', async () => {
    // A lone radio is not a valid radiogroup child on its own, so it is wrapped
    // the way the picker renders it.
    const wrapper = mountOption()
    const group = document.createElement('div')
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', 'Centre range rings on')
    group.appendChild(wrapper.element)
    // `region` is disabled because the row is audited in isolation, outside the
    // app's landmarks — same reason as the other component-level audits.
    expect(await axe(group, { rules: { region: { enabled: false } } })).toHaveNoViolations()
  })
})
