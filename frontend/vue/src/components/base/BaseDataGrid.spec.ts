import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import BaseDataGrid from './BaseDataGrid.vue'
import BaseDataCell from './BaseDataCell.vue'

describe('BaseDataGrid', () => {
  it('renders the title and the default-slot cells', () => {
    const wrapper = mount(BaseDataGrid, {
      props: { title: 'POSITION DATA' },
      slots: { default: '<div class="probe-cell">cell</div>' },
    })
    expect(wrapper.find('.ba-data-grid-title').text()).toBe('POSITION DATA')
    expect(wrapper.find('.probe-cell').exists()).toBe(true)
  })

  // Used by a titled container (e.g. the Sentry MORE disclosure) whose first
  // section would only repeat its heading — the row must not render as a blank
  // line in that case.
  it('renders no title row at all when no title is given', () => {
    const wrapper = mount(BaseDataGrid, {
      slots: { default: '<div class="probe-cell">cell</div>' },
    })
    expect(wrapper.find('.ba-data-grid-title').exists()).toBe(false)
    expect(wrapper.find('.probe-cell').exists()).toBe(true)
  })

  it('defaults to a two-column grid', () => {
    const wrapper = mount(BaseDataGrid, { props: { title: 'RADIO' } })
    expect(wrapper.find('.ba-data-grid').classes()).not.toContain('ba-data-grid--three')
  })

  it('applies the three-column class when columns=3', () => {
    const wrapper = mount(BaseDataGrid, { props: { title: 'POSITION DATA', columns: 3 } })
    expect(wrapper.find('.ba-data-grid').classes()).toContain('ba-data-grid--three')
  })

  it('does not collapse on narrow widths by default', () => {
    const wrapper = mount(BaseDataGrid, { props: { title: 'POSITION DATA' } })
    expect(wrapper.find('.ba-data-grid').classes()).not.toContain('ba-data-grid--collapse-narrow')
  })

  it('adds the collapse-narrow class when collapseOnNarrow=true', () => {
    const wrapper = mount(BaseDataGrid, {
      props: { title: 'RADIO', collapseOnNarrow: true },
    })
    expect(wrapper.find('.ba-data-grid').classes()).toContain('ba-data-grid--collapse-narrow')
  })

  it('does not render the bare modifier by default', () => {
    const wrapper = mount(BaseDataGrid, { props: { title: 'RADIO' } })
    expect(wrapper.find('.ba-data-grid-section').classes()).not.toContain(
      'ba-data-grid-section--bare',
    )
  })

  it('adds the bare modifier when bare=true, for a caller-owned section container', () => {
    const wrapper = mount(BaseDataGrid, { props: { title: 'RADIO', bare: true } })
    expect(wrapper.find('.ba-data-grid-section').classes()).toContain('ba-data-grid-section--bare')
    // The title and grid still render — only the section-level box collapses.
    expect(wrapper.find('.ba-data-grid-title').text()).toBe('RADIO')
    expect(wrapper.find('.ba-data-grid').exists()).toBe(true)
  })

  it('composes with BaseDataCell children', () => {
    const wrapper = mount(BaseDataGrid, {
      props: { title: 'ORBITAL DATA', columns: 3 },
      slots: {
        default: () => [
          mount(BaseDataCell, { props: { label: 'ALTITUDE', value: '410 km' } }).html(),
        ],
      },
    })
    expect(wrapper.text()).toContain('ALTITUDE')
    expect(wrapper.text()).toContain('410 km')
  })

  it('has no accessibility violations', async () => {
    const wrapper = mount(BaseDataGrid, {
      props: { title: 'POSITION DATA', columns: 3 },
      slots: {
        default: '<div class="ba-data-cell"><div class="ba-data-cell-label">LATITUDE</div></div>',
      },
    })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
