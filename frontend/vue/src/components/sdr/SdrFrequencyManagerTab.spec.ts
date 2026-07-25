import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrFrequencyManagerTab from './SdrFrequencyManagerTab.vue'
import type { SdrLiveTuneSeed } from './SdrFrequencyManagerTab.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'

enableAutoUnmount(afterEach)

// ── Fetch double ──────────────────────────────────────────────────────────────
const fetchCalls: Array<{ url: string; opts?: RequestInit }> = []
let fetchOverride: ((url: string, opts?: RequestInit) => Promise<Response> | null) | null = null

function okResponse(): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)
}

beforeEach(() => {
  setActivePinia(createPinia())
  fetchCalls.length = 0
  fetchOverride = null
  vi.stubGlobal('fetch', ((url: string, opts?: RequestInit) => {
    fetchCalls.push({ url, opts })
    return fetchOverride?.(url, opts) ?? okResponse()
  }) as unknown as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.querySelectorAll('.sdr-device-menu').forEach((node) => node.remove())
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGroup(overrides: Partial<SdrFrequencyGroup> = {}): SdrFrequencyGroup {
  return {
    id: 1,
    name: 'Airband',
    slug: 'airband',
    color: '#c8ff00',
    sort_order: 0,
    ...overrides,
  }
}

function makeFreq(overrides: Partial<SdrStoredFrequency> = {}): SdrStoredFrequency {
  return {
    id: 10,
    group_id: null,
    group_ids: [1],
    label: 'Tower',
    frequency_hz: 118_380_000,
    mode: 'AM',
    squelch: -55,
    gain: 28,
    bandwidth: 12_000,
    sample_rate: 1536000,
    volume: 70,
    zoom: 2,
    zmin: -100,
    zmax: -20,
    scannable: false,
    notes: 'ground control',
    ...overrides,
  }
}

function makeLive(overrides: Partial<SdrLiveTuneSeed> = {}): SdrLiveTuneSeed {
  return {
    freqHz: 121_500_000,
    mode: 'NFM',
    gainAuto: false,
    gainDb: 30,
    bwHz: 10_000,
    squelch: -60,
    volume: 80,
    sampleRateHz: 2048000,
    ...overrides,
  }
}

interface MountOptions {
  freqs?: SdrStoredFrequency[]
  groups?: SdrFrequencyGroup[]
  live?: SdrLiveTuneSeed
  tuningDisabled?: boolean
  readOnly?: boolean
}

function mountTab(options: MountOptions = {}): VueWrapper {
  const store = useSdrStore()
  store.groups = options.groups ?? [makeGroup()]
  store.frequencies = options.freqs ?? [makeFreq()]
  if (options.readOnly) {
    store.controlAvailable = true
    store.isOwner = false
    store.locked = true
  }
  store.viewZoom = 3
  store.viewZmin = -110
  store.viewZmax = -10
  return mount(SdrFrequencyManagerTab, {
    props: {
      live: options.live ?? makeLive(),
      tuningDisabled: options.tuningDisabled ?? false,
    },
    attachTo: document.body,
  })
}

function freqRows(wrapper: VueWrapper) {
  return wrapper.findAll('#sdr-freq-list .sdr-freq-row-item')
}

async function openAddForm(wrapper: VueWrapper) {
  await wrapper.find('#sdr-radio-add-freq').trigger('click')
  return wrapper.find('#sdr-editfreq-body')
}

// =============================================================================
describe('SdrFrequencyManagerTab — rendering', () => {
  it('renders rows with label, MHz, mode and group chips', () => {
    const wrapper = mountTab({
      freqs: [makeFreq(), makeFreq({ id: 11, label: 'Bare', mode: '', group_ids: [] })],
    })
    const rows = freqRows(wrapper)
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.sdr-freq-row-label').text()).toBe('Tower')
    expect(rows[0].find('.sdr-freq-row-hz').text()).toBe('118.3800 MHz')
    expect(rows[0].find('.sdr-freq-row-mode').text()).toBe('AM')
    expect(rows[0].find('.sdr-freq-row-group-chip').text()).toBe('Airband')
    // Ungrouped row falls back to the Default chip and hides the mode segment.
    expect(rows[1].find('.sdr-freq-row-group-chip').text()).toBe('Default')
    expect(rows[1].find('.sdr-freq-row-mode').exists()).toBe(false)
  })

  it('shows the empty message when there are no frequencies', () => {
    const wrapper = mountTab({ freqs: [] })
    expect(wrapper.find('#sdr-freq-empty').isVisible()).toBe(true)
  })

  it('announces read-only mode and disables edit/delete/add', () => {
    const wrapper = mountTab({ readOnly: true })
    expect(wrapper.find('[role="status"]').text()).toContain('read-only')
    expect(wrapper.find('.sdr-freq-row-edit').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.sdr-freq-row-del').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#sdr-radio-add-freq').attributes('disabled')).toBeDefined()
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — group filter', () => {
  const twoGroupsTwoFreqs: MountOptions = {
    groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    freqs: [makeFreq(), makeFreq({ id: 11, label: 'Coast', group_ids: [2] })],
  }

  it('toggles the GROUPS filter accordion (closed by default) open and closed', async () => {
    const wrapper = mountTab(twoGroupsTwoFreqs)
    const toggle = wrapper.find('button[aria-controls="sdr-freq-manager-groups-section"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('filters rows by group chip and returns to All', async () => {
    const wrapper = mountTab(twoGroupsTwoFreqs)
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    expect(chips.map((chip) => chip.text())).toEqual(['All', 'Airband', 'Marine'])
    await chips[1].trigger('click')
    expect(freqRows(wrapper)).toHaveLength(1)
    expect(freqRows(wrapper)[0].find('.sdr-freq-row-label').text()).toBe('Tower')
    // Selecting the second group too shows both rows again.
    await chips[2].trigger('click')
    expect(freqRows(wrapper)).toHaveLength(2)
    // Deselecting one keeps the other's rows.
    await chips[1].trigger('click')
    expect(freqRows(wrapper)[0].find('.sdr-freq-row-label').text()).toBe('Coast')
    // Deselecting the last selected group falls back to All.
    await chips[2].trigger('click')
    expect(freqRows(wrapper)).toHaveLength(2)
    // The explicit All chip also resets.
    await chips[1].trigger('click')
    await chips[0].trigger('click')
    expect(freqRows(wrapper)).toHaveLength(2)
  })

  it('reports each filter chip state via aria-pressed (multi-select, not a radio group)', async () => {
    const wrapper = mountTab(twoGroupsTwoFreqs)
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    expect(chips.map((chip) => chip.attributes('aria-pressed'))).toEqual(['true', 'false', 'false'])
    await chips[1].trigger('click')
    expect(chips.map((chip) => chip.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])
  })

  it('shows "No matches." when the filter excludes every row', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
      freqs: [makeFreq({ group_ids: [1] })],
    })
    // Marine has no rows but only groups WITH freqs get chips — filter via
    // Airband then delete… instead, select Airband and empty it by pointing
    // the only freq at group 2 via the store.
    const store = useSdrStore()
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    await chips[1].trigger('click')
    store.frequencies = [makeFreq({ group_ids: [2] })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('No matches.')
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — play', () => {
  it('emits play with the stored frequency', async () => {
    const wrapper = mountTab()
    await wrapper.find('.sdr-freq-row-play').trigger('click')
    const played = wrapper.emitted('play')
    expect(played).toHaveLength(1)
    expect((played![0][0] as SdrStoredFrequency).id).toBe(10)
  })

  it('disables the play button when tuning is disabled', () => {
    const wrapper = mountTab({ tuningDisabled: true })
    expect(wrapper.find('.sdr-freq-row-play').attributes('disabled')).toBeDefined()
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — favourite star', () => {
  it('stars a frequency via the store and leaves no failure announcement on success', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ favourite: false })] })
    const store = useSdrStore()
    const setFavouriteSpy = vi.spyOn(store, 'setFrequencyFavourite').mockResolvedValue(undefined)
    await wrapper.find('.sdr-freq-row-fav').trigger('click')
    await flushPromises()
    expect(setFavouriteSpy).toHaveBeenCalledWith(10, true)
    expect(wrapper.find('[role="status"]').text()).toBe('')
  })

  it('unstars an already-favourited frequency (toggles the opposite way)', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ favourite: true })] })
    const store = useSdrStore()
    const setFavouriteSpy = vi.spyOn(store, 'setFrequencyFavourite').mockResolvedValue(undefined)
    await wrapper.find('.sdr-freq-row-fav').trigger('click')
    await flushPromises()
    expect(setFavouriteSpy).toHaveBeenCalledWith(10, false)
  })

  it('announces failure and keeps the row state when the store call rejects', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ favourite: false, label: 'Tower' })] })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockRejectedValue(new Error('offline'))
    await wrapper.find('.sdr-freq-row-fav').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('Failed to favourite Tower')
  })

  it('announces an unfavourite failure with the opposite verb', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ favourite: true, label: 'Tower' })] })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockRejectedValue(new Error('offline'))
    await wrapper.find('.sdr-freq-row-fav').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('Failed to unfavourite Tower')
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — add', () => {
  it('seeds the add form from the live radio state and emits activate', async () => {
    const wrapper = mountTab({ live: makeLive({ gainAuto: true }) })
    const editor = await openAddForm(wrapper)
    expect(wrapper.emitted('activate')).toHaveLength(1)
    expect((wrapper.find('#sdr-ef-freq').element as HTMLInputElement).value).toBe('121.5000')
    const activeMode = editor.find('#sdr-ef-mode-pills .sdr-mode-pill.active')
    expect(activeMode.text()).toBe('NFM')
    // AGC seeded on: the gain input is disabled.
    expect(editor.find('input[aria-label="RF gain in dB"]').attributes('disabled')).toBeDefined()
  })

  it('exposes the MODE pills as a keyboard-operable radio group and the GROUPS pills as aria-pressed toggles', async () => {
    const wrapper = mountTab({
      live: makeLive(),
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    const editor = await openAddForm(wrapper)

    const modeGroup = editor.find('#sdr-ef-mode-pills')
    expect(modeGroup.attributes('role')).toBe('radiogroup')
    expect(modeGroup.attributes('aria-label')).toBe('Demodulation mode')

    // Roving tabindex: seeded mode (NFM from the live state) is the tab stop.
    const modePills = editor.findAll('#sdr-ef-mode-pills .sdr-mode-pill')
    const checkedPill = modePills.find((pill) => pill.attributes('aria-checked') === 'true')!
    expect(checkedPill.text()).toBe('NFM')
    expect(checkedPill.attributes('role')).toBe('radio')
    expect(checkedPill.attributes('tabindex')).toBe('0')
    expect(modePills.find((pill) => pill.text() === 'AM')!.attributes('tabindex')).toBe('-1')

    // ArrowLeft from NFM wraps back to AM (the previous mode) and moves the tab stop.
    await checkedPill.trigger('keydown', { key: 'ArrowLeft' })
    const amPill = modePills.find((pill) => pill.text() === 'AM')!
    expect(amPill.attributes('aria-checked')).toBe('true')
    expect(amPill.attributes('tabindex')).toBe('0')
    expect(checkedPill.attributes('aria-checked')).toBe('false')

    // GROUPS pills are multi-select toggles, not radios: aria-pressed only.
    const groupPills = editor.findAll('#sdr-ef-groups .sdr-ef-gpill')
    expect(groupPills.map((pill) => pill.attributes('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ])
    expect(groupPills[0].attributes('role')).toBeUndefined()
    await groupPills[1].trigger('click')
    expect(groupPills.map((pill) => pill.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('leaves the freq blank when nothing is tuned', async () => {
    const wrapper = mountTab({ live: makeLive({ freqHz: 0 }) })
    await openAddForm(wrapper)
    expect((wrapper.find('#sdr-ef-freq').element as HTMLInputElement).value).toBe('')
  })

  it('POSTs the parsed body with settings payload, clamped volume and group ids', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    const editor = await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-label').setValue('  Approach  ')
    await wrapper.find('#sdr-ef-freq').setValue('119.1')
    // Pick a group, expand settings, tweak volume beyond the clamp.
    await editor.findAll('#sdr-ef-groups .sdr-ef-gpill')[2].trigger('click')
    await editor.find('.sdr-ef-settings-toggle').trigger('click')
    await editor.find('input[aria-label="Volume percent"]').setValue('250')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const post = fetchCalls.find(
      (call) => call.url === '/api/sdr/frequencies' && call.opts?.method === 'POST',
    )
    expect(post).toBeTruthy()
    expect(JSON.parse(String(post?.opts?.body))).toEqual({
      label: 'Approach',
      frequency_hz: 119_100_000,
      mode: 'NFM',
      squelch: -60,
      gain: 30,
      bandwidth: 10_000,
      sample_rate: 2048000,
      volume: 100,
      zoom: 3,
      zmin: -110,
      zmax: -10,
      scannable: true,
      favourite: false,
      group_ids: [2],
      notes: '',
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('#sdr-editfreq-body').exists()).toBe(false)
  })

  it('sends gain -1 and numeric fallbacks when AGC is on and fields are cleared', async () => {
    const wrapper = mountTab()
    const editor = await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-label').setValue('R')
    await wrapper.find('#sdr-ef-freq').setValue('100')
    await editor.find('.sdr-ef-settings-toggle').trigger('click')
    await editor.find('.sdr-ef-toggle').trigger('click') // AGC on
    await editor.find('input[aria-label="Demod bandwidth in kHz"]').setValue('')
    await editor.find('input[aria-label="Squelch threshold in dBFS"]').setValue('')
    await editor.find('input[aria-label="Volume percent"]').setValue('')
    await editor.find('input[aria-label="Waterfall zoom"]').setValue('')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const body = JSON.parse(
      String(fetchCalls.find((call) => call.opts?.method === 'POST')?.opts?.body),
    )
    expect(body.gain).toBe(-1)
    expect(body.bandwidth).toBe(10_000)
    expect(body.squelch).toBe(-60)
    expect(body.volume).toBe(80)
    expect(body.zoom).toBe(1)
  })

  it('validates label, frequency and notes without calling the API', async () => {
    const wrapper = mountTab()
    await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-save').trigger('click')
    expect(wrapper.find('.sdr-field-error').text()).toBe('Label is required')
    await wrapper.find('#sdr-ef-label').setValue('x'.repeat(61))
    await wrapper.find('#sdr-ef-save').trigger('click')
    expect(wrapper.find('.sdr-field-error').text()).toBe('Label must be 60 characters or fewer')
    await wrapper.find('#sdr-ef-label').setValue('Tower')
    await wrapper.find('#sdr-ef-freq').setValue('not a number')
    await wrapper.find('#sdr-ef-save').trigger('click')
    expect(wrapper.find('.sdr-field-error').text()).toBe('Enter a valid frequency in MHz')
    await wrapper.find('#sdr-ef-freq').setValue('118.38')
    await wrapper.find('#sdr-ef-notes').setValue('bad § char')
    await wrapper.find('#sdr-ef-save').trigger('click')
    expect(wrapper.find('.sdr-field-error').text()).toBe('Notes contain disallowed characters')
    expect(fetchCalls.some((call) => call.opts?.method === 'POST')).toBe(false)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('clears field errors as the user types', async () => {
    const wrapper = mountTab()
    await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-save').trigger('click')
    expect(wrapper.find('.sdr-field-error').exists()).toBe(true)
    await wrapper.find('#sdr-ef-label').setValue('T')
    expect(wrapper.find('.sdr-field-error').exists()).toBe(false)
    // Freq + notes watchers clear their own errors too.
    await wrapper.find('#sdr-ef-freq').setValue('bad')
    await wrapper.find('#sdr-ef-notes').setValue('§')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await wrapper.find('#sdr-ef-freq').setValue('118.38')
    await wrapper.find('#sdr-ef-notes').setValue('fine')
    expect(wrapper.find('.sdr-field-error').exists()).toBe(false)
  })

  it('cancels the add form and swallows a network error on save', async () => {
    const wrapper = mountTab()
    await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-cancel').trigger('click')
    expect(wrapper.find('#sdr-editfreq-body').exists()).toBe(false)
    fetchOverride = () => Promise.reject(new Error('offline'))
    await openAddForm(wrapper)
    await wrapper.find('#sdr-ef-label').setValue('R')
    await wrapper.find('#sdr-ef-freq').setValue('100')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('picks a sample rate inside the form via the picker', async () => {
    const wrapper = mountTab()
    const editor = await openAddForm(wrapper)
    await editor.find('.sdr-ef-settings-toggle').trigger('click')
    await editor.find('.sdr-ef-setting-dropdown').trigger('click')
    const items = Array.from(document.querySelectorAll('.sdr-device-menu-item'))
    ;(items.find((item) => item.textContent?.trim() === '1.02 MHz') as HTMLElement).click()
    await wrapper.vm.$nextTick()
    await wrapper.find('#sdr-ef-label').setValue('R')
    await wrapper.find('#sdr-ef-freq').setValue('100')
    await wrapper.find('#sdr-ef-save').trigger('click')
    await flushPromises()
    const body = JSON.parse(
      String(fetchCalls.find((call) => call.opts?.method === 'POST')?.opts?.body),
    )
    expect(body.sample_rate).toBe(1024000)
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — edit', () => {
  it('drives the inline-edit MODE radio group with arrow keys', async () => {
    const wrapper = mountTab()
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    const modePills = editor.findAll('.sdr-mode-pills .sdr-mode-pill')
    const checkedIndex = modePills.findIndex((pill) => pill.attributes('aria-checked') === 'true')
    const nextPill = modePills[(checkedIndex + 1) % modePills.length]!
    await modePills[checkedIndex]!.trigger('keydown', { key: 'ArrowRight' })
    expect(nextPill.attributes('aria-checked')).toBe('true')
    expect(nextPill.attributes('tabindex')).toBe('0')
  })

  it('prefills from the stored values, PUTs with preserved scannable and emits changed', async () => {
    const wrapper = mountTab()
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    expect(wrapper.emitted('activate')).toHaveLength(1)
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    expect(
      (editor.find('input[aria-label="Frequency label"]').element as HTMLInputElement).value,
    ).toBe('Tower')
    expect(
      (editor.find('input[aria-label="Frequency in MHz"]').element as HTMLInputElement).value,
    ).toBe('118.3800')
    expect(
      (editor.find('textarea[aria-label="Frequency notes"]').element as HTMLTextAreaElement).value,
    ).toBe('ground control')
    await editor.find('input[aria-label="Frequency label"]').setValue('Tower North')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    await flushPromises()
    const put = fetchCalls.find(
      (call) => call.url === '/api/sdr/frequencies/10' && call.opts?.method === 'PUT',
    )
    expect(put).toBeTruthy()
    const body = JSON.parse(String(put?.opts?.body))
    expect(body.label).toBe('Tower North')
    expect(body.scannable).toBe(false) // preserved from the stored row
    expect(body.gain).toBe(28)
    expect(body.sample_rate).toBe(1536000)
    expect(body.zoom).toBe(2)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('falls back to the live settings for a legacy row missing per-freq settings', async () => {
    const wrapper = mountTab({
      freqs: [
        makeFreq({
          gain: undefined,
          bandwidth: undefined,
          squelch: undefined,
          volume: undefined,
          sample_rate: undefined,
          zoom: undefined,
          zmin: undefined,
          zmax: undefined,
          notes: undefined,
        }),
      ],
      live: makeLive({ gainDb: -1 }),
    })
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    // live gainDb -1 → seeded as AGC on.
    expect(editor.find('.sdr-ef-toggle').classes()).toContain('is-on')
    expect(
      (editor.find('input[aria-label="Demod bandwidth in kHz"]').element as HTMLInputElement).value,
    ).toBe('10')
    expect(
      (editor.find('textarea[aria-label="Frequency notes"]').element as HTMLTextAreaElement).value,
    ).toBe('')
  })

  it('reports a mode error for a legacy invalid mode and clears it when a pill is picked', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ mode: 'DSTAR' })] })
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    await editor.find('.sdr-editfreq-save-btn').trigger('click')
    expect(editor.find('.sdr-field-error').text()).toBe('Select a mode')
    expect(fetchCalls.some((call) => call.opts?.method === 'PUT')).toBe(false)
    await editor.findAll('.sdr-mode-pills .sdr-mode-pill')[0].trigger('click')
    expect(editor.find('.sdr-field-error').exists()).toBe(false)
  })

  it('toggles group pills and the Default pill inside the edit form', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
    })
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    const editor = wrapper.find('.sdr-freq-editing .sdr-editfreq-body')
    const pills = editor.findAll('.sdr-fmod-groups .sdr-ef-gpill')
    // Seeded with group 1 selected.
    expect(pills[1].classes()).toContain('active')
    await pills[2].trigger('click') // add Marine
    expect(pills[2].classes()).toContain('active')
    await pills[1].trigger('click') // remove Airband
    expect(pills[1].classes()).not.toContain('active')
    await pills[0].trigger('click') // Default clears all
    expect(pills[0].classes()).toContain('active')
  })

  it('toggles the editor closed from the edit button', async () => {
    const wrapper = mountTab()
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })
})

// =============================================================================
/**
 * Removing a frequency is a two-step inline confirm (the ✕ arms the row, then
 * the ✓ commits — same pattern as the recordings list), so a delete assertion
 * has to drive BOTH steps. Clicking the ✕ alone only arms it and deletes
 * nothing, which would leave these tests passing vacuously.
 */
async function removeRow(wrapper: VueWrapper, rowIndex = 0) {
  await wrapper.findAll('.sdr-freq-row-del')[rowIndex].trigger('click')
  // Only one row can be armed at a time, so the confirm ✓ is unambiguous.
  await wrapper.find('.sdr-freq-row-del--confirm').trigger('click')
}

describe('SdrFrequencyManagerTab — delete', () => {
  it('DELETEs the row and emits changed', async () => {
    const wrapper = mountTab()
    await removeRow(wrapper)
    await flushPromises()
    expect(
      fetchCalls.some(
        (call) => call.url === '/api/sdr/frequencies/10' && call.opts?.method === 'DELETE',
      ),
    ).toBe(true)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('closes the editor when the row being edited is deleted', async () => {
    const wrapper = mountTab()
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
    await removeRow(wrapper)
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(false)
  })

  it('keeps the editor open when a different row is deleted', async () => {
    const wrapper = mountTab({
      freqs: [makeFreq(), makeFreq({ id: 11, label: 'Coast' })],
    })
    await wrapper.findAll('.sdr-freq-row-edit')[0].trigger('click')
    await removeRow(wrapper, 1)
    await flushPromises()
    expect(wrapper.find('.sdr-freq-editing').exists()).toBe(true)
  })

  it('swallows a network error on delete without emitting', async () => {
    fetchOverride = () => Promise.reject(new Error('offline'))
    const wrapper = mountTab()
    await removeRow(wrapper)
    await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('cancels an armed row, returning focus to its plain ✕ and announcing the cancellation', async () => {
    const wrapper = mountTab({ freqs: [makeFreq({ label: 'Tower' })] })
    await wrapper.find('.sdr-freq-row-del').trigger('click')
    expect(wrapper.find('.sdr-freq-row-del--confirm').exists()).toBe(true)
    await wrapper.find('.sdr-freq-row-del--cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sdr-freq-row-del--confirm').exists()).toBe(false)
    expect(wrapper.find('.sdr-freq-row-del').exists()).toBe(true)
    expect(wrapper.find('[role="status"]').text()).toBe('Removal of Tower cancelled')
    expect(document.activeElement).toBe(wrapper.find('.sdr-freq-row-del').element)
  })

  it('disarms a row that leaves the visible list when the group filter changes', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
      freqs: [makeFreq(), makeFreq({ id: 11, label: 'Coast', group_ids: [2] })],
    })
    // Arm the Tower row's remove (leaves it showing the ✓/✕ confirm pair).
    await wrapper.findAll('.sdr-freq-row-del')[0].trigger('click')
    expect(wrapper.find('.sdr-freq-row-del--confirm').exists()).toBe(true)
    // Filtering to Marine hides Tower from the visible list entirely, which
    // should disarm it (the watcher guard) rather than leaving it armed
    // underneath the filter.
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    await chips.find((chip) => chip.text() === 'Marine')!.trigger('click')
    // Returning to All should now show Tower with a plain ✕, not the armed
    // confirm pair — proving the row was disarmed while hidden rather than
    // merely hidden-but-still-armed.
    await chips.find((chip) => chip.text() === 'All')!.trigger('click')
    expect(freqRows(wrapper)).toHaveLength(2)
    expect(wrapper.find('.sdr-freq-row-del--confirm').exists()).toBe(false)
  })

  it('leaves an armed row alone when the filter change does not remove it from view', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
      freqs: [makeFreq(), makeFreq({ id: 11, label: 'Coast', group_ids: [2] })],
    })
    // Arm the Tower row, then filter to Airband (which Tower still belongs
    // to) — the watcher should find Tower still visible and leave it armed.
    await wrapper.findAll('.sdr-freq-row-del')[0].trigger('click')
    const chips = wrapper.findAll('.sdr-frequency-manager-groups-filter .sdr-scan-group-chip')
    await chips.find((chip) => chip.text() === 'Airband')!.trigger('click')
    expect(wrapper.find('.sdr-freq-row-del--confirm').exists()).toBe(true)
  })
})

// =============================================================================
describe('SdrFrequencyManagerTab — accessibility', () => {
  it('has no axe violations with rows, filter chips and an open editor', async () => {
    const wrapper = mountTab({
      groups: [makeGroup(), makeGroup({ id: 2, name: 'Marine', slug: 'marine' })],
      freqs: [makeFreq(), makeFreq({ id: 11, label: 'Coast', group_ids: [2] })],
    })
    await wrapper.find('.sdr-freq-row-edit').trigger('click')
    await wrapper.vm.$nextTick()
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
