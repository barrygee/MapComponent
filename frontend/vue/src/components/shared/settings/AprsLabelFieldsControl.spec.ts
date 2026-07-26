import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import AprsLabelFieldsControl from './AprsLabelFieldsControl.vue'
import { useLandStore } from '@/stores/land'

vi.mock('@/services/settingsApi', () => ({
  put: vi.fn(),
  getNamespace: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
}))
import * as settingsApi from '@/services/settingsApi'

/** Index of a field's checkbox, matching the control's row order. */
const ROW = {
  time: 0,
  callsign: 1,
  symbol: 2,
  symbolText: 3,
  latitude: 4,
  longitude: 5,
  course: 6,
  speed: 7,
  altitude: 8,
  path: 9,
  comment: 10,
} as const

describe('AprsLabelFieldsControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    vi.mocked(settingsApi.put).mockResolvedValue(undefined)
  })

  it('renders one checkbox for each of the eleven APRS fields', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(11)
  })

  it('offers the symbol icon and its text as separate fields, in that order', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes[ROW.symbol]!.attributes('aria-label')).toBe('Symbol')
    expect(boxes[ROW.symbolText]!.attributes('aria-label')).toBe('Symbol Text')
    // Icon on, name off — the label stays compact until asked otherwise.
    expect((boxes[ROW.symbol]!.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[ROW.symbolText]!.element as HTMLInputElement).checked).toBe(false)
  })

  it('toggles the symbol name without touching the icon', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const land = useLandStore()
    await wrapper.findAll('input[type="checkbox"]')[ROW.symbolText]!.trigger('change')
    expect(land.aprsLabelFields.symbolText).toBe(true)
    expect(land.aprsLabelFields.symbol).toBe(true)
  })

  it('has a single column, so checkboxes are named by field alone', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes[ROW.callsign]!.attributes('aria-label')).toBe('Callsign')
    expect(boxes[ROW.comment]!.attributes('aria-label')).toBe('Comment')
  })

  it('uses the app accent, matching the Air domain’s field table', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    expect(wrapper.find('.lft-wrap').attributes('style')).toContain('--lft-accent: #c8ff00')
  })

  it('shows the stored state, with callsign and symbol on by default', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect((boxes[ROW.callsign]!.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[ROW.symbol]!.element as HTMLInputElement).checked).toBe(true)
    expect((boxes[ROW.speed]!.element as HTMLInputElement).checked).toBe(false)
  })

  it('switching a field on updates the store and stages the backend write', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const land = useLandStore()
    await wrapper.findAll('input[type="checkbox"]')[ROW.speed]!.trigger('change')

    expect(land.aprsLabelFields.speed).toBe(true)
    // Nothing is written until the staged callback runs (Settings' Apply).
    expect(settingsApi.put).not.toHaveBeenCalled()
    await (wrapper.emitted('stage')![0]![0] as () => unknown)()
    expect(settingsApi.put).toHaveBeenCalledWith(
      'land',
      'labelDataPoints',
      expect.objectContaining({ speed: true }),
    )
  })

  it('switching a default-on field off updates the store', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const land = useLandStore()
    await wrapper.findAll('input[type="checkbox"]')[ROW.callsign]!.trigger('change')
    expect(land.aprsLabelFields.callsign).toBe(false)
  })

  it('leaves the other fields untouched when one is toggled', async () => {
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const land = useLandStore()
    await wrapper.findAll('input[type="checkbox"]')[ROW.path]!.trigger('change')
    expect(land.aprsLabelFields.path).toBe(true)
    expect(land.aprsLabelFields.callsign).toBe(true)
    expect(land.aprsLabelFields.symbol).toBe(true)
    expect(land.aprsLabelFields.comment).toBe(false)
  })

  it('adopts a stored backend config on mount', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({
      labelDataPoints: { comment: true, callsign: false },
    } as never)
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    const land = useLandStore()
    expect(land.aprsLabelFields.comment).toBe(true)
    expect(land.aprsLabelFields.callsign).toBe(false)
    // Keys the backend didn't send keep their local value rather than vanishing.
    expect(land.aprsLabelFields.symbol).toBe(true)
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect((boxes[ROW.comment]!.element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps local state when the namespace has no stored config', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({ aprsRetentionMinutes: 5 } as never)
    mount(AprsLabelFieldsControl)
    await flushPromises()
    expect(useLandStore().aprsLabelFields.callsign).toBe(true)
  })

  it('ignores a malformed stored config', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({
      labelDataPoints: ['not', 'an', 'object'],
    } as never)
    mount(AprsLabelFieldsControl)
    await flushPromises()
    expect(useLandStore().aprsLabelFields.callsign).toBe(true)
  })

  it('survives the namespace request returning nothing', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    expect(() => mount(AprsLabelFieldsControl)).not.toThrow()
    await flushPromises()
    expect(useLandStore().aprsLabelFields.symbol).toBe(true)
  })

  it('has no accessibility violations', async () => {
    // `region` is disabled: the control always renders inside the Settings
    // dialog's landmark, which an isolated mount cannot provide.
    const wrapper = mount(AprsLabelFieldsControl)
    await flushPromises()
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
