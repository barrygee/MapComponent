import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrOptionsControl from './SdrOptionsControl.vue'
import { useSdrStore } from '@/stores/sdr'

vi.mock('@/services/settingsApi', () => ({
  put: vi.fn(),
  getNamespace: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
}))
import * as settingsApi from '@/services/settingsApi'

/** Index of an option's checkbox, matching the control's row order. */
const ROW = {
  autoCenter: 0,
  snapToKnown: 1,
  showBandPlan: 2,
  showKnownFreqs: 3,
  muteWhileDecoding: 4,
} as const

function checkboxes(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('input[type="checkbox"]')
}

function isChecked(wrapper: ReturnType<typeof mount>, row: number): boolean {
  return (checkboxes(wrapper)[row]!.element as HTMLInputElement).checked
}

/** Runs the staged writer the control emitted for its `index`-th change. */
async function runStagedWrite(wrapper: ReturnType<typeof mount>, index = 0): Promise<void> {
  await (wrapper.emitted('stage')![index]![0] as () => unknown)()
}

describe('SdrOptionsControl', () => {
  // The control listens on `document`, so a wrapper left mounted would keep
  // answering config-upload events in later tests.
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    vi.mocked(settingsApi.put).mockResolvedValue(undefined)
  })

  it('renders one checkbox for each of the five SDR options', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(checkboxes(wrapper)).toHaveLength(5)
  })

  it('names each checkbox after its option, with no per-option description', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    const names = checkboxes(wrapper).map((box) => box.attributes('aria-label'))
    expect(names).toEqual([
      'Auto-center on Tune',
      'Snap to Known Frequencies',
      'Show Band Plan',
      'Show Known Frequencies',
      'Mute Audio While Decoding',
    ])
    // The old per-toggle prose is gone — only the option names are on screen.
    expect(wrapper.text()).not.toContain('re-centers the display')
    expect(wrapper.text()).not.toContain('Frequency Manager')
  })

  it('uses the app accent, matching the domains’ label-field tables', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(wrapper.find('.lft-wrap').attributes('style')).toContain('--lft-accent: #c8ff00')
  })

  it('shows every option on by default', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(checkboxes(wrapper).map((_box, index) => isChecked(wrapper, index))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it('reflects an option the store already has switched off', async () => {
    const sdr = useSdrStore()
    sdr.setShowBandPlan(false)
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(isChecked(wrapper, ROW.showBandPlan)).toBe(false)
    expect(isChecked(wrapper, ROW.showKnownFreqs)).toBe(true)
  })

  it('switching an option off mirrors into the store immediately', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    const sdr = useSdrStore()
    await checkboxes(wrapper)[ROW.snapToKnown]!.trigger('change')

    expect(sdr.snapToKnown).toBe(false)
    expect(isChecked(wrapper, ROW.snapToKnown)).toBe(false)
    // Nothing is persisted until the Settings panel applies the staged write.
    expect(settingsApi.put).not.toHaveBeenCalled()
  })

  it('switching an option back on mirrors into the store', async () => {
    const sdr = useSdrStore()
    sdr.setShowKnownFreqs(false)
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    await checkboxes(wrapper)[ROW.showKnownFreqs]!.trigger('change')

    expect(sdr.showKnownFreqs).toBe(true)
    expect(isChecked(wrapper, ROW.showKnownFreqs)).toBe(true)
  })

  it('stages the write under the option’s own settings key', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    await checkboxes(wrapper)[ROW.showBandPlan]!.trigger('change')
    await runStagedWrite(wrapper)
    expect(settingsApi.put).toHaveBeenCalledWith('sdr', 'showBandPlan', false)
  })

  it.each([
    [ROW.autoCenter, 'autoCenterWaterfallOnTune'],
    [ROW.snapToKnown, 'snapToKnown'],
    [ROW.showBandPlan, 'showBandPlan'],
    [ROW.showKnownFreqs, 'showKnownFreqs'],
    [ROW.muteWhileDecoding, 'muteAudioWhileDecoding'],
  ])('persists row %i as the %s setting', async (row, settingKey) => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    await checkboxes(wrapper)[row]!.trigger('change')
    await runStagedWrite(wrapper)
    expect(settingsApi.put).toHaveBeenCalledWith('sdr', settingKey, false)
  })

  it('leaves the other options untouched when one is toggled', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    const sdr = useSdrStore()
    await checkboxes(wrapper)[ROW.muteWhileDecoding]!.trigger('change')

    expect(sdr.muteAudioWhileDecoding).toBe(false)
    expect(sdr.autoCenterWaterfallOnTune).toBe(true)
    expect(sdr.snapToKnown).toBe(true)
    expect(sdr.showBandPlan).toBe(true)
    expect(sdr.showKnownFreqs).toBe(true)
  })

  it('stages one write per option when several are toggled', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    await checkboxes(wrapper)[ROW.autoCenter]!.trigger('change')
    await checkboxes(wrapper)[ROW.showBandPlan]!.trigger('change')

    expect(wrapper.emitted('stage')).toHaveLength(2)
    await runStagedWrite(wrapper, 0)
    await runStagedWrite(wrapper, 1)
    expect(settingsApi.put).toHaveBeenCalledWith('sdr', 'autoCenterWaterfallOnTune', false)
    expect(settingsApi.put).toHaveBeenCalledWith('sdr', 'showBandPlan', false)
  })

  it('adopts the stored values on mount, in one namespace fetch', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({
      snapToKnown: false,
      muteAudioWhileDecoding: false,
    } as never)
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    const sdr = useSdrStore()

    expect(settingsApi.getNamespace).toHaveBeenCalledTimes(1)
    expect(settingsApi.getNamespace).toHaveBeenCalledWith('sdr')
    expect(sdr.snapToKnown).toBe(false)
    expect(sdr.muteAudioWhileDecoding).toBe(false)
    expect(isChecked(wrapper, ROW.snapToKnown)).toBe(false)
    expect(isChecked(wrapper, ROW.muteWhileDecoding)).toBe(false)
    // Keys the backend didn't send keep their local value.
    expect(sdr.showBandPlan).toBe(true)
  })

  it('ignores stored values that are not booleans', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue({
      showBandPlan: 'off',
      showKnownFreqs: null,
    } as never)
    mount(SdrOptionsControl)
    await flushPromises()
    const sdr = useSdrStore()
    expect(sdr.showBandPlan).toBe(true)
    expect(sdr.showKnownFreqs).toBe(true)
  })

  it('keeps local state when the namespace request returns nothing', async () => {
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    expect(() => mount(SdrOptionsControl)).not.toThrow()
    await flushPromises()
    expect(useSdrStore().autoCenterWaterfallOnTune).toBe(true)
  })

  it('re-syncs when the config JSON editor uploads a new config', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(isChecked(wrapper, ROW.showKnownFreqs)).toBe(true)

    vi.mocked(settingsApi.getNamespace).mockResolvedValue({ showKnownFreqs: false } as never)
    document.dispatchEvent(new Event('sentinel:config-uploaded'))
    await flushPromises()

    expect(useSdrStore().showKnownFreqs).toBe(false)
    expect(isChecked(wrapper, ROW.showKnownFreqs)).toBe(false)
  })

  it('stops re-syncing once unmounted', async () => {
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    wrapper.unmount()
    vi.mocked(settingsApi.getNamespace).mockClear()

    document.dispatchEvent(new Event('sentinel:config-uploaded'))
    await flushPromises()
    expect(settingsApi.getNamespace).not.toHaveBeenCalled()
  })

  it('has no accessibility violations', async () => {
    // `region` is disabled: the control always renders inside the Settings
    // dialog's landmark, which an isolated mount cannot provide.
    const wrapper = mount(SdrOptionsControl)
    await flushPromises()
    expect(
      await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations()
  })
})
