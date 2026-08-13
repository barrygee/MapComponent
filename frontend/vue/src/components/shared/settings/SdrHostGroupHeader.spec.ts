import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrHostGroupHeader from './SdrHostGroupHeader.vue'
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'

describe('SdrHostGroupHeader', () => {
  it('renders the host label and passes reachability through to the status dot', () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: true, lastError: null },
    })
    expect(wrapper.find('.sdr-host-group-header-name').text()).toBe('Pi Roof')
    expect(wrapper.findComponent(SdrSourceStatusDot).props('connected')).toBe(true)
  })

  it('does not render an error span when lastError is null', () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: true, lastError: null },
    })
    expect(wrapper.find('.sdr-host-group-header-error').exists()).toBe(false)
  })

  it('does not render an error span when lastError is an empty string', () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: false, lastError: '' },
    })
    expect(wrapper.find('.sdr-host-group-header-error').exists()).toBe(false)
  })

  it('renders the last polling error, prefixed with an em dash, when the host is unreachable', () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: false, lastError: 'connection refused' },
    })
    expect(wrapper.find('.sdr-host-group-header-error').text()).toBe('— connection refused')
  })

  it('passes a null reachable state through to the status dot as "checking"', () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: null, lastError: null },
    })
    expect(wrapper.findComponent(SdrSourceStatusDot).props('connected')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const wrapper = mount(SdrHostGroupHeader, {
      props: { label: 'Pi Roof', reachable: false, lastError: 'connection refused' },
    })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
