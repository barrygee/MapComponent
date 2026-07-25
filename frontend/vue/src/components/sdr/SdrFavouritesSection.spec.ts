import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SdrFavouritesSection from './SdrFavouritesSection.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrStoredFrequency } from '@/stores/sdr'

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeFreq(overrides: Partial<SdrStoredFrequency> = {}): SdrStoredFrequency {
  return {
    id: 1,
    group_id: null,
    group_ids: [],
    label: 'Tower',
    frequency_hz: 118_300_000,
    mode: 'AM',
    favourite: true,
    ...overrides,
  }
}

interface MountOptions {
  frequencies?: SdrStoredFrequency[]
  tuningDisabled?: boolean
  readOnly?: boolean
}

function mountSection(options: MountOptions = {}): VueWrapper {
  const store = useSdrStore()
  store.frequencies = options.frequencies ?? [makeFreq()]
  if (options.readOnly) {
    store.controlAvailable = true
    store.isOwner = false
    store.locked = true
  }
  return mount(SdrFavouritesSection, {
    props: { tuningDisabled: options.tuningDisabled ?? false },
    attachTo: document.body,
  })
}

function favouriteRows(wrapper: VueWrapper) {
  return wrapper.findAll('.sdr-favourites-list .sdr-favourites-row-item')
}

// =============================================================================
describe('SdrFavouritesSection — rendering', () => {
  it('renders only favourited frequencies, in store order', () => {
    const wrapper = mountSection({
      frequencies: [
        makeFreq({ id: 1, label: 'Alpha', favourite: true }),
        makeFreq({ id: 2, label: 'Bravo', favourite: false }),
        makeFreq({ id: 3, label: 'Charlie', favourite: true }),
      ],
    })
    const rows = favouriteRows(wrapper)
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.sdr-freq-row-label').text()).toBe('Alpha')
    expect(rows[1].find('.sdr-freq-row-label').text()).toBe('Charlie')
  })

  it('shows the empty-state message (and hides the list) when there are no favourites', () => {
    const wrapper = mountSection({ frequencies: [makeFreq({ favourite: false })] })
    expect(favouriteRows(wrapper)).toHaveLength(0)
    const empty = wrapper.find('.sdr-panel-empty')
    expect(empty.text()).toContain('No favourites.')
    expect((empty.element as HTMLElement).style.display).toBe('block')
  })

  it('hides the empty-state message inline when at least one favourite exists', () => {
    const wrapper = mountSection({ frequencies: [makeFreq({ favourite: true })] })
    const empty = wrapper.find('.sdr-panel-empty')
    expect((empty.element as HTMLElement).style.display).toBe('none')
  })

  it('disables the star button when read-only', () => {
    const wrapper = mountSection({ readOnly: true })
    expect(wrapper.find('.sdr-favourites-list button').attributes('disabled')).toBeDefined()
  })

  it('leaves the star enabled when not read-only', () => {
    const wrapper = mountSection({ readOnly: false })
    // The first button in a row is the favourite star (before the play button).
    expect(wrapper.find('.sdr-favourites-row-item button').attributes('disabled')).toBeUndefined()
  })

  it('disables the play button when tuning is disabled', () => {
    const wrapper = mountSection({ tuningDisabled: true })
    expect(wrapper.find('.sdr-favourites-row-play').attributes('disabled')).toBeDefined()
  })
})

// =============================================================================
describe('SdrFavouritesSection — play', () => {
  it('emits play with the stored frequency when the tune button is clicked', async () => {
    const wrapper = mountSection({ frequencies: [makeFreq({ id: 7, label: 'Ground' })] })
    await wrapper.find('.sdr-favourites-row-play').trigger('click')
    const played = wrapper.emitted('play')
    expect(played).toHaveLength(1)
    expect((played![0][0] as SdrStoredFrequency).id).toBe(7)
  })
})

// =============================================================================
describe('SdrFavouritesSection — unfavourite', () => {
  it('removes the row and announces success when the store call succeeds', async () => {
    const wrapper = mountSection({
      frequencies: [makeFreq({ id: 1, label: 'Alpha' })],
    })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockImplementation(async (id) => {
      const row = store.frequencies.find((freq) => freq.id === id)
      if (row) row.favourite = false
    })
    await wrapper.find('.sdr-favourites-list button').trigger('click')
    await flushPromises()
    expect(favouriteRows(wrapper)).toHaveLength(0)
    expect(wrapper.find('[role="status"]').text()).toBe('Alpha removed from favourites')
  })

  it('keeps the row and announces failure without moving focus when the store call rejects', async () => {
    const wrapper = mountSection({
      frequencies: [makeFreq({ id: 1, label: 'Alpha' })],
    })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockRejectedValue(new Error('network error'))
    const starButton = wrapper.find('.sdr-favourites-list button')
    ;(starButton.element as HTMLElement).focus()
    expect(document.activeElement).toBe(starButton.element)
    await starButton.trigger('click')
    await flushPromises()
    // The row survives the failed call — the store never actually mutated it.
    expect(favouriteRows(wrapper)).toHaveLength(1)
    expect(wrapper.find('[role="status"]').text()).toBe('Failed to remove Alpha from favourites')
    // No focus handoff on failure: the button that was focused stays focused.
    expect(document.activeElement).toBe(starButton.element)
  })

  it('moves focus to the next remaining row star when that neighbour survives the removal', async () => {
    const wrapper = mountSection({
      frequencies: [
        makeFreq({ id: 1, label: 'Alpha' }),
        makeFreq({ id: 2, label: 'Bravo' }),
        makeFreq({ id: 3, label: 'Charlie' }),
      ],
    })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockImplementation(async (id) => {
      const row = store.frequencies.find((freq) => freq.id === id)
      if (row) row.favourite = false
    })
    // Unfavourite the middle row (Bravo): its next neighbour (Charlie) is the
    // preferred focus target and survives, so focus should land on Charlie's star.
    const rowsBefore = favouriteRows(wrapper)
    await rowsBefore[1].find('button').trigger('click')
    await flushPromises()
    const remainingRows = favouriteRows(wrapper)
    expect(remainingRows).toHaveLength(2)
    const charlieStar = remainingRows[1].find('button').element
    expect(document.activeElement).toBe(charlieStar)
  })

  it('falls back to the first remaining row star when the preferred neighbour also disappears', async () => {
    const wrapper = mountSection({
      frequencies: [
        makeFreq({ id: 1, label: 'Alpha' }),
        makeFreq({ id: 2, label: 'Bravo' }),
        makeFreq({ id: 3, label: 'Charlie' }),
      ],
    })
    const store = useSdrStore()
    // Simulate the preferred neighbour (Charlie, the row after Bravo) vanishing
    // from under the focus handoff — e.g. a concurrent update removed it too —
    // by unfavouriting BOTH Bravo and Charlie in the same store call.
    vi.spyOn(store, 'setFrequencyFavourite').mockImplementation(async (id) => {
      for (const targetId of [id, 3]) {
        const row = store.frequencies.find((freq) => freq.id === targetId)
        if (row) row.favourite = false
      }
    })
    const rowsBefore = favouriteRows(wrapper)
    await rowsBefore[1].find('button').trigger('click') // unfavourite Bravo
    await flushPromises()
    const remainingRows = favouriteRows(wrapper)
    expect(remainingRows).toHaveLength(1)
    const alphaStar = remainingRows[0].find('button').element
    expect(document.activeElement).toBe(alphaStar)
  })

  it('moves focus to the section container when the list is emptied', async () => {
    const wrapper = mountSection({
      frequencies: [makeFreq({ id: 1, label: 'Alpha' })],
    })
    const store = useSdrStore()
    vi.spyOn(store, 'setFrequencyFavourite').mockImplementation(async (id) => {
      const row = store.frequencies.find((freq) => freq.id === id)
      if (row) row.favourite = false
    })
    await wrapper.find('.sdr-favourites-list button').trigger('click')
    await flushPromises()
    expect(favouriteRows(wrapper)).toHaveLength(0)
    expect(document.activeElement).toBe(wrapper.find('[role="group"]').element)
  })
})

// =============================================================================
describe('SdrFavouritesSection — accessibility', () => {
  it('has no axe violations with rows rendered', async () => {
    const wrapper = mountSection({
      frequencies: [makeFreq({ id: 1, label: 'Alpha' }), makeFreq({ id: 2, label: 'Bravo' })],
    })
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })

  it('has no axe violations in the empty state', async () => {
    const wrapper = mountSection({ frequencies: [] })
    expect(
      await axe(wrapper.html(), {
        rules: { region: { enabled: false } },
      }),
    ).toHaveNoViolations()
  })
})
