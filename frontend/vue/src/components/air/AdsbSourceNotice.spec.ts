import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import AdsbSourceNotice from './AdsbSourceNotice.vue'

/**
 * Tests for the message that explains an empty off-grid map.
 *
 * This component exists because the original failure said nothing: a mis-tuned
 * dongle, a device another consumer had claimed, and an unreachable Pi all
 * looked exactly like quiet skies. So the assertions here are about *speaking* —
 * that the reason reaches the operator, and that the one case they can resolve
 * from here carries the control to resolve it.
 */

const RESERVED = {
  code: 'device_reserved',
  message: 'Voice decoder is using this device.',
  holder: 'sentinel:other',
}

describe('AdsbSourceNotice', () => {
  it('says nothing when there is nothing wrong', () => {
    // A successful claim needs no announcement — the aircraft are the
    // confirmation, and a permanent banner would just be furniture.
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: null, isClaiming: false },
    })

    expect(wrapper.text()).toBe('')
  })

  it('shows the reason the map is empty', () => {
    const wrapper = mount(AdsbSourceNotice, {
      props: {
        error: { code: 'host_unreachable', message: 'That Pi is not answering.' },
        isClaiming: false,
      },
    })

    expect(wrapper.text()).toContain('That Pi is not answering.')
  })

  it('is announced to assistive technology', () => {
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: RESERVED, isClaiming: false },
    })

    expect(wrapper.attributes('role')).toBe('status')
  })

  it('offers to take the device when something else holds it', () => {
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: RESERVED, isClaiming: false },
    })

    expect(wrapper.find('button').text()).toBe('Take control')
  })

  it('emits when the operator takes control', async () => {
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: RESERVED, isClaiming: false },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('takeControl')).toHaveLength(1)
  })

  it('offers no action for a failure taking the device cannot fix', () => {
    // Forcing a claim would not help a Pi that is switched off, and offering it
    // would invite an operator to fight for a device nobody is holding.
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: { code: 'host_unreachable', message: 'down' }, isClaiming: false },
    })

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('disables the action while a claim is in flight', () => {
    const wrapper = mount(AdsbSourceNotice, {
      props: { error: RESERVED, isClaiming: true },
    })

    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('Taking…')
  })
})
