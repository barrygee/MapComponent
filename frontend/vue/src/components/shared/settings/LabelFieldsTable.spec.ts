import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { axe } from 'jest-axe'
import LabelFieldsTable, { type LabelFieldColumn, type LabelFieldRow } from './LabelFieldsTable.vue'

const TWO_COLUMNS: LabelFieldColumn[] = [
  { key: 'civil', label: 'Civil' },
  { key: 'mil', label: 'Mil' },
]
const ONE_COLUMN: LabelFieldColumn[] = [{ key: 'show', label: 'Show' }]
const ROWS: LabelFieldRow[] = [
  { key: 'callsign', abbr: 'CSS', label: 'Callsign' },
  { key: 'altitude', abbr: 'ALT', label: 'Altitude' },
]

function mountTable(overrides: Record<string, unknown> = {}) {
  return mount(LabelFieldsTable, {
    props: {
      columns: TWO_COLUMNS,
      rows: ROWS,
      isChecked: () => false,
      ...overrides,
    },
  })
}

describe('LabelFieldsTable', () => {
  it('renders one checkbox per row/column pair', () => {
    expect(mountTable().findAll('input[type="checkbox"]')).toHaveLength(4)
    expect(mountTable({ columns: ONE_COLUMN }).findAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('renders the column headers and the field header caption', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('Civil')
    expect(wrapper.text()).toContain('Mil')
    expect(wrapper.find('.lft-header-field').text()).toBe('Field')
  })

  it('accepts a custom field-header caption', () => {
    expect(mountTable({ fieldHeader: 'Data point' }).find('.lft-header-field').text()).toBe(
      'Data point',
    )
  })

  it('renders each row label and its abbreviation', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('Callsign')
    expect(wrapper.text()).toContain('CSS')
  })

  it('omits the abbreviation element for a row without one', () => {
    const wrapper = mountTable({ rows: [{ key: 'time', label: 'Time' }] })
    expect(wrapper.find('.lft-row-abbr').exists()).toBe(false)
    expect(wrapper.find('.lft-row-name').text()).toBe('Time')
  })

  it('reflects checked state from the caller-supplied predicate', () => {
    const wrapper = mountTable({
      isChecked: (column: string, row: string) => column === 'civil' && row === 'callsign',
    })
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect((boxes[0]!.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[1]!.element as HTMLInputElement).checked).toBe(false)
    // The tick glyph only renders for a checked box.
    expect(wrapper.findAll('svg')).toHaveLength(1)
  })

  it('emits toggle with the column and row that were clicked', async () => {
    const wrapper = mountTable()
    await wrapper.findAll('input[type="checkbox"]')[3]!.trigger('change')
    expect(wrapper.emitted('toggle')).toEqual([['mil', 'altitude']])
  })

  it('names each checkbox by field and column when there are several columns', () => {
    const wrapper = mountTable()
    const labels = wrapper
      .findAll('input[type="checkbox"]')
      .map((input) => input.attributes('aria-label'))
    expect(labels).toEqual([
      'Callsign — Civil',
      'Callsign — Mil',
      'Altitude — Civil',
      'Altitude — Mil',
    ])
  })

  it('names each checkbox by field alone when there is a single column', () => {
    // "Callsign — Show" reads as noise when the column adds no information.
    const wrapper = mountTable({ columns: ONE_COLUMN })
    const labels = wrapper
      .findAll('input[type="checkbox"]')
      .map((input) => input.attributes('aria-label'))
    expect(labels).toEqual(['Callsign', 'Altitude'])
  })

  it('lays out one grid column per checkbox column', () => {
    expect(mountTable().find('.lft-header').attributes('style')).toContain(
      'grid-template-columns: 1fr repeat(2, var(--lft-col-width))',
    )
    expect(mountTable({ columns: ONE_COLUMN }).find('.lft-header').attributes('style')).toContain(
      'repeat(1,',
    )
  })

  it('defaults to the app lime accent and honours a domain accent', () => {
    expect(mountTable().find('.lft-wrap').attributes('style')).toContain('--lft-accent: #c8ff00')
    expect(mountTable({ accentColor: '#b07cff' }).find('.lft-wrap').attributes('style')).toContain(
      '--lft-accent: #b07cff',
    )
  })

  it('draws the tick in the given checkmark colour', () => {
    const wrapper = mountTable({ isChecked: () => true, checkmarkColor: '#ffffff' })
    expect(wrapper.find('svg path').attributes('stroke')).toBe('#ffffff')
  })

  it('renders extra per-row content supplied by the caller', () => {
    const wrapper = mount(LabelFieldsTable, {
      props: { columns: ONE_COLUMN, rows: ROWS, isChecked: () => false },
      slots: { 'row-extra': '<span class="preview">{{ params.row.key }}</span>' },
    })
    expect(wrapper.findAll('.preview')).toHaveLength(2)
  })

  it('renders no rows for an empty field list', () => {
    const wrapper = mountTable({ rows: [] })
    expect(wrapper.findAll('.lft-row')).toHaveLength(0)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('has no accessibility violations', async () => {
    // `region` is disabled: the table always renders inside the Settings
    // dialog's landmark, which an isolated mount has no way to provide.
    const wrapper = mountTable()
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })

  it('has no violations with a checked box and a single column', async () => {
    const wrapper = mountTable({ columns: ONE_COLUMN, isChecked: () => true })
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })

  it('keeps every checkbox keyboard-operable', async () => {
    // The native inputs are visually hidden (not display:none) so they stay in
    // the tab order and Space toggles them natively.
    const wrapper = mountTable()
    const input = wrapper.findAll('input[type="checkbox"]')[0]!
    expect(input.attributes('disabled')).toBeUndefined()
    expect((input.element as HTMLInputElement).style.display).not.toBe('none')
    await input.trigger('change')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
