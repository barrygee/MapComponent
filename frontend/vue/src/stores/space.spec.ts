import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSpaceStore } from './space'

describe('space store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initialises overlay states to the defaults (all on)', () => {
    const store = useSpaceStore()
    expect(store.overlayStates).toEqual({
      iss: true,
      groundTrack: true,
      footprint: true,
      daynight: true,
    })
  })

  it('has the expected non-persisted initial state', () => {
    const store = useSpaceStore()
    expect(store.filterQuery).toBe('')
    expect(store.filterOpen).toBe(false)
    expect(store.mapCenter).toBeNull()
    expect(store.mapZoom).toBeNull()
  })

  it('has the expected persisted pane defaults', () => {
    const store = useSpaceStore()
    expect(store.searchQuery).toBe('')
    expect(store.searchExpandedNorad).toBe('')
    expect(store.spaceFilterCategory).toBe('')
    expect(store.passesMinEl).toBe(35)
    expect(store.passesHours).toBe(24)
    expect(store.passesFiltersOpen).toBe(false)
    expect(store.passesExpandedKey).toBe('')
    expect(store.passesActiveFilters).toBeInstanceOf(Set)
  })

  it('setOverlay toggles a single overlay and persists it', () => {
    const store = useSpaceStore()
    store.setOverlay('iss', false)
    expect(store.overlayStates.iss).toBe(false)
    expect(JSON.parse(localStorage.getItem('sentinel_space_overlayStates')!).iss).toBe(false)
  })

  it('setFilter updates the filter query', () => {
    const store = useSpaceStore()
    store.setFilter('ISS')
    expect(store.filterQuery).toBe('ISS')
  })

  it('toggleFilter flips the filter-open state', () => {
    const store = useSpaceStore()
    store.toggleFilter()
    expect(store.filterOpen).toBe(true)
    store.toggleFilter()
    expect(store.filterOpen).toBe(false)
  })

  it('saveMapState stores the centre and zoom', () => {
    const store = useSpaceStore()
    store.saveMapState([10, 20], 4)
    expect(store.mapCenter).toEqual([10, 20])
    expect(store.mapZoom).toBe(4)
  })

  it('setSpaceFilterCategory updates and persists the active category', () => {
    const store = useSpaceStore()
    expect(store.spaceFilterCategory).toBe('')
    store.setSpaceFilterCategory('weather')
    expect(store.spaceFilterCategory).toBe('weather')
    expect(localStorage.getItem('sentinel_space_filterCategory')).toBe('"weather"')
  })

  it('setSpaceAvailableCategories replaces the available-category list (not persisted)', () => {
    const store = useSpaceStore()
    expect(store.spaceAvailableCategories).toEqual([])
    store.setSpaceAvailableCategories(['weather', 'navigation'])
    expect(store.spaceAvailableCategories).toEqual(['weather', 'navigation'])
    // Derived from live data — never written to localStorage.
    expect(localStorage.getItem('sentinel_space_availableCategories')).toBeNull()
  })
})
