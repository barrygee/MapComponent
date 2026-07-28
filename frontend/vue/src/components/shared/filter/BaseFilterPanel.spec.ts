import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { axe } from 'jest-axe'
import BaseFilterPanel, { type FilterPanelItem } from './BaseFilterPanel.vue'

const ITEMS: FilterPanelItem[] = [
  { key: 'M0ABC', primary: 'M0ABC', secondary: 'Car · 21:33:47' },
  { key: 'MB7UMS', primary: 'MB7UMS', secondary: 'Digipeater · 21:30:00' },
  { key: 'M7FRH', primary: 'M7FRH', secondary: 'Person · 21:28:11' },
]

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(BaseFilterPanel, {
    props: {
      items: ITEMS,
      query: '',
      expandedKey: '',
      idPrefix: 'test-filter',
      inputLabel: 'Filter stations',
      placeholder: 'CALLSIGN',
      listboxLabel: 'Stations',
      ...overrides,
    },
    attachTo: document.body,
  })
}

describe('BaseFilterPanel', () => {
  describe('rendering', () => {
    it('renders a row per item with its primary and secondary text', () => {
      const wrapper = mountPanel()
      const rows = wrapper.findAll('.bfp-result-item')
      expect(rows).toHaveLength(3)
      expect(rows[0]!.find('.bfp-result-primary').text()).toBe('M0ABC')
      expect(rows[0]!.find('.bfp-result-secondary').text()).toBe('Car · 21:33:47')
    })

    it('omits the secondary line for an item without one', () => {
      const wrapper = mountPanel({ items: [{ key: 'a', primary: 'A' }] })
      expect(wrapper.find('.bfp-result-secondary').exists()).toBe(false)
    })

    it('shows the empty message instead of rows when there are no items', () => {
      const wrapper = mountPanel({ items: [], emptyMessage: 'No stations heard' })
      expect(wrapper.find('.bfp-no-results').text()).toBe('No stations heard')
      expect(wrapper.findAll('.bfp-result-item')).toHaveLength(0)
    })

    it('falls back to a generic empty message', () => {
      expect(mountPanel({ items: [] }).find('.bfp-no-results').text()).toBe('No results')
    })

    it('namespaces every generated id with the given prefix', () => {
      const wrapper = mountPanel({ idPrefix: 'land-filter' })
      expect(wrapper.find('#land-filter-input').exists()).toBe(true)
      expect(wrapper.find('#land-filter-results').exists()).toBe(true)
      expect(wrapper.find('#land-filter-listbox').exists()).toBe(true)
      expect(wrapper.find('#land-filter-row-M0ABC').exists()).toBe(true)
      expect(wrapper.find('#land-filter-opt-M0ABC').exists()).toBe(true)
    })

    it('applies the caller accent, defaulting to the app accent token', () => {
      expect(mountPanel().find('.bfp-results').attributes('style')).toContain(
        '--bfp-accent: var(--color-accent)',
      )
      expect(
        mountPanel({ accentColor: '#b07cff' }).find('.bfp-results').attributes('style'),
      ).toContain('--bfp-accent: #b07cff')
    })
  })

  describe('combobox semantics', () => {
    it('wires the input as a combobox owning the option rows', () => {
      const wrapper = mountPanel()
      const input = wrapper.find('input')
      expect(input.attributes('role')).toBe('combobox')
      expect(input.attributes('aria-label')).toBe('Filter stations')
      expect(input.attributes('aria-expanded')).toBe('true')
      expect(input.attributes('aria-controls')).toBe('test-filter-listbox')

      const listbox = wrapper.find('[role="listbox"]')
      expect(listbox.attributes('aria-label')).toBe('Stations')
      // The rows live outside the listbox (they carry non-option chrome), so
      // the listbox claims them by id instead.
      expect(listbox.attributes('aria-owns')).toBe(
        'test-filter-opt-M0ABC test-filter-opt-MB7UMS test-filter-opt-M7FRH',
      )
      expect(listbox.element.children).toHaveLength(0)
    })

    it('collapses the combobox when no options are rendered', () => {
      // An empty listbox would fail aria-required-children.
      const wrapper = mountPanel({ items: [] })
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
      expect(wrapper.find('input').attributes('aria-expanded')).toBe('false')
      expect(wrapper.find('input').attributes('aria-controls')).toBeUndefined()
    })

    it('names each option from its visible text', () => {
      const wrapper = mountPanel()
      expect(wrapper.find('#test-filter-opt-M0ABC').attributes('aria-label')).toBe(
        'M0ABC, Car · 21:33:47',
      )
    })

    it('names an option without a secondary line by its primary text alone', () => {
      const wrapper = mountPanel({ items: [{ key: 'a', primary: 'ALPHA' }] })
      expect(wrapper.find('#test-filter-opt-a').attributes('aria-label')).toBe('ALPHA')
    })

    it('prefers an explicit option label when the caller supplies one', () => {
      const wrapper = mountPanel({
        items: [{ key: 'a', primary: 'A', secondary: 'b', optionLabel: 'Station A, heard 10:00' }],
      })
      expect(wrapper.find('#test-filter-opt-a').attributes('aria-label')).toBe(
        'Station A, heard 10:00',
      )
    })

    it('keeps the overflowing results region focusable so it can be scrolled', () => {
      // WCAG 2.1.1 / axe scrollable-region-focusable: options are driven from
      // the combobox, so without this tab stop the list would be unscrollable.
      const results = mountPanel().find('.bfp-results')
      expect(results.attributes('tabindex')).toBe('0')
      expect(results.attributes('role')).toBe('group')
      expect(results.attributes('aria-label')).toBe('Filter results')
    })
  })

  describe('query', () => {
    it('shows the current query and reports edits', async () => {
      const wrapper = mountPanel({ query: 'MB7' })
      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('MB7')
      await wrapper.find('input').setValue('M0A')
      expect(wrapper.emitted('update:query')).toEqual([['M0A']])
    })

    it('hides the clear button until there is something to clear', () => {
      expect(mountPanel().find('.bfp-clear-btn').classes()).not.toContain('bfp-clear-visible')
      expect(mountPanel({ query: 'x' }).find('.bfp-clear-btn').classes()).toContain(
        'bfp-clear-visible',
      )
    })

    it('clearing empties the query and returns focus to the input', async () => {
      const wrapper = mountPanel({ query: 'MB7' })
      await wrapper.find('.bfp-clear-btn').trigger('click')
      expect(wrapper.emitted('update:query')).toEqual([['']])
      expect(document.activeElement).toBe(wrapper.find('input').element)
      wrapper.unmount()
    })

    it('Escape clears the query', async () => {
      const wrapper = mountPanel({ query: 'MB7' })
      await wrapper.find('input').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('update:query')).toEqual([['']])
    })
  })

  describe('expansion', () => {
    it('renders the accordion slot only for the expanded row', () => {
      const wrapper = mount(BaseFilterPanel, {
        props: {
          items: ITEMS,
          query: '',
          expandedKey: 'MB7UMS',
          idPrefix: 'test-filter',
          inputLabel: 'Filter stations',
          placeholder: 'CALLSIGN',
          listboxLabel: 'Stations',
        },
        slots: { accordion: '<p class="detail">{{ params.item.key }}</p>' },
      })
      const details = wrapper.findAll('.detail')
      expect(details).toHaveLength(1)
      expect(details[0]!.text()).toBe('MB7UMS')
      expect(wrapper.find('#test-filter-row-MB7UMS').classes()).toContain('bfp-expanded')
    })

    it('clicking a row asks to expand it and reports the selection', async () => {
      const wrapper = mountPanel()
      await wrapper.find('#test-filter-row-MB7UMS').trigger('click')
      expect(wrapper.emitted('update:expandedKey')).toEqual([['MB7UMS']])
      expect(wrapper.emitted('select')).toEqual([['MB7UMS']])
    })

    it('clicking the expanded row collapses it without re-selecting', async () => {
      const wrapper = mountPanel({ expandedKey: 'MB7UMS' })
      await wrapper.find('#test-filter-row-MB7UMS').trigger('click')
      expect(wrapper.emitted('update:expandedKey')).toEqual([['']])
      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('scrolls a newly expanded row into view, including one expanded externally', async () => {
      const wrapper = mountPanel()
      const row = wrapper.find('#test-filter-row-M7FRH').element as HTMLElement
      const scrollIntoView = vi.fn()
      row.scrollIntoView = scrollIntoView

      // Simulates a map click expanding a row that may be below the fold.
      await wrapper.setProps({ expandedKey: 'M7FRH' })
      await flushPromises()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      wrapper.unmount()
    })

    it('does not scroll when the expansion is cleared', async () => {
      const wrapper = mountPanel({ expandedKey: 'M0ABC' })
      const row = wrapper.find('#test-filter-row-M0ABC').element as HTMLElement
      const scrollIntoView = vi.fn()
      row.scrollIntoView = scrollIntoView
      await wrapper.setProps({ expandedKey: '' })
      await flushPromises()
      expect(scrollIntoView).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('survives an expanded key that matches no rendered row', async () => {
      const wrapper = mountPanel()
      await wrapper.setProps({ expandedKey: 'GONE' })
      await flushPromises()
      expect(wrapper.findAll('.bfp-expanded')).toHaveLength(0)
    })
  })

  describe('keyboard navigation', () => {
    async function pressKey(wrapper: ReturnType<typeof mountPanel>, key: string) {
      await wrapper.find('input').trigger('keydown', { key })
    }

    it('ArrowDown walks into the list and on down it', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-M0ABC',
      )
      expect(wrapper.find('#test-filter-row-M0ABC').classes()).toContain('bfp-keyboard-focused')
      expect(wrapper.find('#test-filter-opt-M0ABC').attributes('aria-selected')).toBe('true')

      await pressKey(wrapper, 'ArrowDown')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-MB7UMS',
      )
    })

    it('ArrowDown past the last row wraps to the first', async () => {
      const wrapper = mountPanel()
      for (let step = 0; step < 4; step += 1) await pressKey(wrapper, 'ArrowDown')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-M0ABC',
      )
    })

    it('ArrowUp steps back up the list', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'ArrowUp')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-M0ABC',
      )
    })

    it('ArrowUp from the first row returns focus to the text field', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'ArrowUp')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBeUndefined()
      expect(wrapper.findAll('.bfp-keyboard-focused')).toHaveLength(0)
    })

    it('Enter expands the focused row', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'Enter')
      expect(wrapper.emitted('update:expandedKey')).toEqual([['MB7UMS']])
    })

    it('Enter with nothing focused expands the first row', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'Enter')
      expect(wrapper.emitted('update:expandedKey')).toEqual([['M0ABC']])
    })

    it('ignores navigation keys when the list is empty', async () => {
      const wrapper = mountPanel({ items: [] })
      await pressKey(wrapper, 'ArrowDown')
      await pressKey(wrapper, 'Enter')
      expect(wrapper.emitted('update:expandedKey')).toBeUndefined()
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBeUndefined()
    })

    it('ignores keys it does not handle', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'a')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBeUndefined()
      expect(wrapper.emitted('update:expandedKey')).toBeUndefined()
    })

    it('drops the virtual focus when the focused row leaves a live list', async () => {
      // A station expiring must not strand aria-activedescendant on a dead id.
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-M0ABC',
      )
      await wrapper.setProps({ items: ITEMS.slice(1) })
      await nextTick()
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBeUndefined()
    })

    it('keeps the virtual focus when the focused row survives the update', async () => {
      const wrapper = mountPanel()
      await pressKey(wrapper, 'ArrowDown')
      await wrapper.setProps({ items: [...ITEMS] })
      await nextTick()
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-M0ABC',
      )
    })
  })

  describe('caller options', () => {
    it('builds a row’s ids from idKey when the key is not id-safe', () => {
      // A key holding a space would split the space-separated aria-owns list
      // into dangling IDREFs, so a caller can supply a safe token instead.
      const wrapper = mountPanel({
        items: [{ key: 'RAF Fairford', primary: 'EGVA', idKey: 'mil-0' }],
      })
      expect(wrapper.find('#test-filter-listbox').attributes('aria-owns')).toBe(
        'test-filter-opt-mil-0',
      )
      expect(wrapper.find('[role="option"]').attributes('id')).toBe('test-filter-opt-mil-0')
      expect(wrapper.find('.bfp-result-item').attributes('id')).toBe('test-filter-row-mil-0')
    })

    it('points aria-activedescendant at the idKey-derived option id', async () => {
      const wrapper = mountPanel({
        items: [{ key: 'RAF Fairford', primary: 'EGVA', idKey: 'mil-0' }],
      })
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBe(
        'test-filter-opt-mil-0',
      )
    })

    it('puts a caller class on the row', () => {
      const wrapper = mountPanel({
        items: [{ key: 'a', primary: 'A', rowClass: 'row--emergency' }],
      })
      expect(wrapper.find('.bfp-result-item').classes()).toContain('row--emergency')
    })

    it('swaps the chevron for the trailing slot on a row that cannot expand', () => {
      const wrapper = mount(BaseFilterPanel, {
        props: {
          items: [{ key: 'a', primary: 'A', expandable: false }],
          query: '',
          expandedKey: '',
          idPrefix: 'test-filter',
          inputLabel: 'Filter stations',
          placeholder: 'CALLSIGN',
          listboxLabel: 'Stations',
        },
        slots: { 'row-trailing': '<span class="badge">MIL</span>' },
      })
      expect(wrapper.find('.bfp-item-chevron').exists()).toBe(false)
      expect(wrapper.find('.bfp-item-trailing .badge').text()).toBe('MIL')
    })

    it('keeps the chevron on a row that can expand', () => {
      const wrapper = mountPanel({ items: [{ key: 'a', primary: 'A', expandable: true }] })
      expect(wrapper.find('.bfp-item-chevron').exists()).toBe(true)
      expect(wrapper.find('.bfp-item-trailing').exists()).toBe(false)
    })

    it('Enter only moves the focus onto the first row when told not to activate it', async () => {
      const wrapper = mountPanel({ enterActivatesFirstRow: false })
      await wrapper.find('input').trigger('keydown', { key: 'Enter' })
      // Focused, but nothing asked to open — that takes a second Enter.
      expect(wrapper.find('#test-filter-row-M0ABC').classes()).toContain('bfp-keyboard-focused')
      expect(wrapper.emitted('update:expandedKey')).toBeUndefined()
      expect(wrapper.emitted('select')).toBeUndefined()

      await wrapper.find('input').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('update:expandedKey')![0]).toEqual(['M0ABC'])
    })

    it('drops the virtual focus as the caller types when asked to', async () => {
      const wrapper = mountPanel({ clearFocusOnInput: true })
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.find('.bfp-keyboard-focused').exists()).toBe(true)
      await wrapper.find('input').setValue('M0')
      expect(wrapper.find('.bfp-keyboard-focused').exists()).toBe(false)
      expect(wrapper.find('input').attributes('aria-activedescendant')).toBeUndefined()
    })

    it('keeps the virtual focus while typing by default', async () => {
      const wrapper = mountPanel()
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      await wrapper.find('input').setValue('M0')
      expect(wrapper.find('.bfp-keyboard-focused').exists()).toBe(true)
    })

    it('reports a deliberate clear separately from an edit down to empty', async () => {
      const wrapper = mountPanel({ query: 'M0' })
      await wrapper.find('input').setValue('')
      // Edited to empty: the text changed, but nothing was "cleared".
      expect(wrapper.emitted('update:query')![0]).toEqual([''])
      expect(wrapper.emitted('clear')).toBeUndefined()

      await wrapper.find('.bfp-clear-btn').trigger('click')
      expect(wrapper.emitted('clear')).toHaveLength(1)

      await wrapper.find('input').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('clear')).toHaveLength(2)
    })
  })

  describe('click containment', () => {
    it('does not collapse the row when the accordion content is used', async () => {
      // The accordion is nested in the row, whose click handler toggles it —
      // without containment, using a control inside would shut it mid-click.
      const wrapper = mount(BaseFilterPanel, {
        props: {
          items: ITEMS,
          query: '',
          expandedKey: 'M0ABC',
          idPrefix: 'test-filter',
          inputLabel: 'Filter stations',
          placeholder: 'CALLSIGN',
          listboxLabel: 'Stations',
        },
        slots: { accordion: '<button class="detail-action">Tune</button>' },
      })
      await wrapper.find('.detail-action').trigger('click')
      expect(wrapper.emitted('update:expandedKey')).toBeUndefined()
    })

    it('still collapses when the row header itself is clicked', async () => {
      const wrapper = mountPanel({ expandedKey: 'M0ABC' })
      await wrapper.find('.bfp-result-option').trigger('click')
      expect(wrapper.emitted('update:expandedKey')![0]).toEqual([''])
    })
  })

  describe('keeping the focused row in view', () => {
    it('scrolls the row the keyboard walks onto into view', async () => {
      const wrapper = mountPanel()
      const scrollIntoView = vi.fn()
      wrapper.find('#test-filter-row-MB7UMS').element.scrollIntoView = scrollIntoView

      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      await nextTick()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('scrolls the row stepped back onto into view', async () => {
      const wrapper = mountPanel()
      const scrollIntoView = vi.fn()
      wrapper.find('#test-filter-row-M0ABC').element.scrollIntoView = scrollIntoView

      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      await wrapper.find('input').trigger('keydown', { key: 'ArrowUp' })
      await nextTick()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('does not scroll when ArrowUp leaves the list for the text field', async () => {
      const wrapper = mountPanel()
      await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
      const scrollIntoView = vi.fn()
      wrapper.find('#test-filter-row-M0ABC').element.scrollIntoView = scrollIntoView

      await wrapper.find('input').trigger('keydown', { key: 'ArrowUp' })
      await nextTick()
      expect(wrapper.find('.bfp-keyboard-focused').exists()).toBe(false)
      expect(scrollIntoView).not.toHaveBeenCalled()
    })
  })

  it('exposes focus() so a host can put the caret in the field', () => {
    const wrapper = mountPanel()
    ;(wrapper.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(wrapper.find('input').element)
    wrapper.unmount()
  })

  describe('accessibility', () => {
    it('has no violations with rows rendered', async () => {
      // `region` is disabled: the pane always renders inside the sidebar's
      // landmark, which an isolated mount cannot provide.
      const wrapper = mountPanel()
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('has no violations when empty', async () => {
      const wrapper = mountPanel({ items: [] })
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('has no violations with a row expanded', async () => {
      const wrapper = mount(BaseFilterPanel, {
        props: {
          items: ITEMS,
          query: 'M0',
          expandedKey: 'M0ABC',
          idPrefix: 'test-filter',
          inputLabel: 'Filter stations',
          placeholder: 'CALLSIGN',
          listboxLabel: 'Stations',
        },
        slots: { accordion: '<p>Detail</p>' },
      })
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })
  })
})
