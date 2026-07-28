import { defineStore } from 'pinia'
import { ref } from 'vue'
import { usePersistedObject, usePersistedRef, usePersistedStringSet } from './_persist'

const LS_OVERLAYS = 'sentinel_space_overlayStates'

/** Space-specific overlays. Base-map layers that every domain shares (place
 *  names, roads) live on the `basemap` store instead. */
export interface SpaceOverlayStates {
  iss: boolean
  groundTrack: boolean
  footprint: boolean
  daynight: boolean
}

const DEFAULTS: SpaceOverlayStates = {
  iss: true,
  groundTrack: true,
  footprint: true,
  daynight: true,
}

export const useSpaceStore = defineStore('space', () => {
  const overlayStates = usePersistedObject<SpaceOverlayStates>(LS_OVERLAYS, DEFAULTS)
  const filterQuery = ref('')
  const filterOpen = ref(false)
  const mapCenter = ref<[number, number] | null>(null)
  const mapZoom = ref<number | null>(null)

  // ── Per-section UI state, persisted so the Space section resumes exactly as
  // left after navigating away (and across a full refresh). These live on the
  // store — a singleton created once for the app's lifetime — rather than in the
  // teleported SpaceFilter/SpacePasses components, whose mount timing is fragile:
  // holding the state here makes restore independent of when those panes remount.

  // SEARCH pane (SpaceFilter)
  const searchQuery = usePersistedRef<string>('sentinel_space_filterQuery', '')
  const searchExpandedNorad = usePersistedRef<string>('sentinel_space_filterExpandedNorad', '')
  // The active FILTER category, driven by the rail sub-tabs. Single-select — the
  // panel shows only this category's satellites. Empty resolves to the first
  // available category (see SpaceFilter). Persisted so the choice survives navigation.
  const spaceFilterCategory = usePersistedRef<string>('sentinel_space_filterCategory', '')
  // The satellite categories that currently have data, in display order — published
  // by SpaceFilter from the loaded satellite set. Drives which rail sub-tabs render,
  // so it is derived (never persisted): the sub-tabs must reflect live data.
  const spaceAvailableCategories = ref<string[]>([])

  // PASSES pane (SpacePasses)
  const passesMinEl = usePersistedRef<number>('sentinel_space_passesMinEl', 35)
  const passesHours = usePersistedRef<number>('sentinel_space_passesHours', 24)
  const passesFiltersOpen = usePersistedRef<boolean>('sentinel_space_passesFiltersExpanded', false)
  const passesExpandedKey = usePersistedRef<string>('sentinel_space_passesExpandedKey', '')
  const passesActiveFilters = usePersistedStringSet('sentinel_space_passesActiveFilters')

  function setOverlay(key: keyof SpaceOverlayStates, visible: boolean) {
    overlayStates.value[key] = visible
  }

  function setFilter(query: string) {
    filterQuery.value = query
  }

  function setSpaceFilterCategory(category: string) {
    spaceFilterCategory.value = category
  }

  function setSpaceAvailableCategories(categories: string[]) {
    spaceAvailableCategories.value = categories
  }

  function toggleFilter() {
    filterOpen.value = !filterOpen.value
  }

  function saveMapState(center: [number, number], zoom: number) {
    mapCenter.value = center
    mapZoom.value = zoom
  }

  return {
    overlayStates,
    filterQuery,
    filterOpen,
    mapCenter,
    mapZoom,
    setOverlay,
    setFilter,
    setSpaceFilterCategory,
    setSpaceAvailableCategories,
    toggleFilter,
    saveMapState,
    searchQuery,
    searchExpandedNorad,
    spaceFilterCategory,
    spaceAvailableCategories,
    passesMinEl,
    passesHours,
    passesFiltersOpen,
    passesExpandedKey,
    passesActiveFilters,
  }
})
