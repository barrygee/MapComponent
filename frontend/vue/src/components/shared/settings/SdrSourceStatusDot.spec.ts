import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'

describe('SdrSourceStatusDot', () => {
  it('announces "Connected" and applies the connected modifier class when connected is true', () => {
    const wrapper = mount(SdrSourceStatusDot, { props: { connected: true } })
    expect(wrapper.classes()).toContain('sdr-status-dot--connected')
    expect(wrapper.classes()).not.toContain('sdr-status-dot--disconnected')
    expect(wrapper.attributes('title')).toBe('Connected')
    expect(wrapper.find('.sr-only').text()).toBe('Connected')
  })

  it('announces "Not connected" and applies the disconnected modifier class when connected is false', () => {
    const wrapper = mount(SdrSourceStatusDot, { props: { connected: false } })
    expect(wrapper.classes()).toContain('sdr-status-dot--disconnected')
    expect(wrapper.classes()).not.toContain('sdr-status-dot--connected')
    expect(wrapper.attributes('title')).toBe('Not connected')
    expect(wrapper.find('.sr-only').text()).toBe('Not connected')
  })

  it('announces "Checking…" and applies neither modifier class when connected is null', () => {
    const wrapper = mount(SdrSourceStatusDot, { props: { connected: null } })
    expect(wrapper.classes()).not.toContain('sdr-status-dot--connected')
    expect(wrapper.classes()).not.toContain('sdr-status-dot--disconnected')
    expect(wrapper.attributes('title')).toBe('Checking…')
    expect(wrapper.find('.sr-only').text()).toBe('Checking…')
  })

  it('announces "Checking…" when connected is undefined', () => {
    const wrapper = mount(SdrSourceStatusDot, { props: { connected: undefined } })
    expect(wrapper.attributes('title')).toBe('Checking…')
  })

  it('uses caller-supplied label overrides instead of the defaults', () => {
    const labels = { connected: 'Online', disconnected: 'Offline', unknown: 'Pending…' }
    const connectedWrapper = mount(SdrSourceStatusDot, { props: { connected: true, labels } })
    expect(connectedWrapper.attributes('title')).toBe('Online')

    const disconnectedWrapper = mount(SdrSourceStatusDot, { props: { connected: false, labels } })
    expect(disconnectedWrapper.attributes('title')).toBe('Offline')

    const unknownWrapper = mount(SdrSourceStatusDot, { props: { connected: null, labels } })
    expect(unknownWrapper.attributes('title')).toBe('Pending…')
  })

  it('has no accessibility violations in any connection state', async () => {
    for (const connected of [true, false, null] as const) {
      const wrapper = mount(SdrSourceStatusDot, { props: { connected } })
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    }
  })
})
