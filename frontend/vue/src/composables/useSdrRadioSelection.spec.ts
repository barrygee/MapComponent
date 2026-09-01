import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSdrRadioSelection, type UseSdrRadioSelectionOptions } from './useSdrRadioSelection'
import { useSdrStore, type SdrRadio } from '@/stores/sdr'

function makeRadio(overrides: Partial<SdrRadio> = {}): SdrRadio {
  return {
    id: 1,
    name: 'RTL-SDR #1',
    host: 'localhost',
    port: 1234,
    enabled: true,
    ...overrides,
  } as SdrRadio
}

function createHarness(overrides: Partial<UseSdrRadioSelectionOptions> = {}) {
  const setPlayingState = vi.fn()
  const setStatus = vi.fn()
  const stopAudio = vi.fn()
  const setDigital = vi.fn()
  const releaseOwnershipIfHeld = vi.fn()
  const openControlSocket = vi.fn().mockResolvedValue(undefined)
  const closeControlSocket = vi.fn()
  const options: UseSdrRadioSelectionOptions = {
    sdrStore: () => useSdrStore(),
    selectedRadioId: ref<number | null>(null),
    controlsDisabled: ref(true),
    playing: ref(false),
    setPlayingState,
    setStatus,
    stopAudio,
    setDigital,
    releaseOwnershipIfHeld,
    openControlSocket,
    closeControlSocket,
    ...overrides,
  }
  const selection = useSdrRadioSelection(options)
  return {
    options,
    selection,
    setPlayingState,
    setStatus,
    stopAudio,
    setDigital,
    releaseOwnershipIfHeld,
    openControlSocket,
    closeControlSocket,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  localStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSdrRadioSelection — selectRadio', () => {
  it('selects a radio: label, remembered id, enabled controls, socket opened', () => {
    const harness = createHarness()
    harness.selection.selectRadio(makeRadio())
    expect(harness.options.selectedRadioId.value).toBe(1)
    expect(harness.selection.deviceDropdownLabel.value).toBe('RTL-SDR #1')
    expect(sessionStorage.getItem('sdrLastRadioId')).toBe('1')
    expect(harness.options.controlsDisabled.value).toBe(false)
    expect(harness.openControlSocket).toHaveBeenCalledWith(1)
  })

  it('stops the running audio before switching radios', () => {
    const harness = createHarness({ playing: ref(true) })
    harness.selection.selectRadio(makeRadio({ id: 2, name: 'RTL-SDR #2' }))
    expect(harness.stopAudio).toHaveBeenCalledTimes(1)
    expect(harness.setPlayingState).toHaveBeenCalledWith(false)
    expect(harness.setStatus).toHaveBeenCalledWith(false)
    expect(harness.options.selectedRadioId.value).toBe(2)
  })

  it('drops digital decode before any selection change', () => {
    const harness = createHarness()
    useSdrStore().setDigitalEnabled(true)
    harness.selection.selectRadio(makeRadio())
    expect(harness.setDigital).toHaveBeenCalledWith(false)
  })

  it('deselecting (null) releases the tuner and resets the panel state', () => {
    const harness = createHarness({ selectedRadioId: ref<number | null>(1) })
    const store = useSdrStore()
    const setOwnershipSpy = vi.spyOn(store, 'setOwnership')
    harness.selection.selectRadio(null)
    expect(harness.releaseOwnershipIfHeld).toHaveBeenCalledTimes(1)
    expect(harness.options.selectedRadioId.value).toBeNull()
    expect(harness.selection.deviceDropdownLabel.value).toBe('— select radio —')
    expect(harness.setPlayingState).toHaveBeenCalledWith(false)
    expect(harness.setStatus).toHaveBeenCalledWith(false)
    expect(harness.options.controlsDisabled.value).toBe(true)
    expect(setOwnershipSpy).toHaveBeenCalledWith(true, false, false)
    expect(harness.closeControlSocket).toHaveBeenCalledTimes(1)
    expect(harness.stopAudio).toHaveBeenCalledTimes(1)
  })
})

describe('useSdrRadioSelection — populateRadios / auto-select', () => {
  it('stores the radios, caches them and auto-selects the remembered radio', () => {
    sessionStorage.setItem('sdrLastRadioId', '2')
    const harness = createHarness()
    const radios = [makeRadio(), makeRadio({ id: 2, name: 'RTL-SDR #2' })]
    harness.selection.populateRadios(radios)
    expect(useSdrStore().radios).toEqual(radios)
    expect(harness.selection.radiosLoading.value).toBe(false)
    expect(JSON.parse(sessionStorage.getItem('sdrRadiosCache')!)).toHaveLength(2)
    expect(harness.options.selectedRadioId.value).toBe(2)
    expect(harness.selection.deviceDropdownLabel.value).toBe('RTL-SDR #2')
    expect(harness.openControlSocket).toHaveBeenCalledWith(2)
  })

  it('auto-selects the sole enabled radio when nothing is remembered', () => {
    const harness = createHarness()
    harness.selection.populateRadios([makeRadio(), makeRadio({ id: 2, enabled: false })])
    expect(harness.options.selectedRadioId.value).toBe(1)
    expect(harness.options.controlsDisabled.value).toBe(false)
  })

  it('falls back to the placeholder with several enabled radios and no memory', () => {
    const harness = createHarness()
    harness.selection.populateRadios([makeRadio(), makeRadio({ id: 2 })])
    expect(harness.options.selectedRadioId.value).toBeNull()
    expect(harness.selection.deviceDropdownLabel.value).toBe('— select radio —')
    expect(harness.openControlSocket).not.toHaveBeenCalled()
  })

  it('ignores a remembered radio that is no longer enabled', () => {
    sessionStorage.setItem('sdrLastRadioId', '2')
    const harness = createHarness()
    harness.selection.populateRadios([makeRadio(), makeRadio({ id: 2, enabled: false })])
    // Falls through to the sole-enabled rule instead.
    expect(harness.options.selectedRadioId.value).toBe(1)
  })

  it('clears the pending highlight on the sidebar RADIO tab', () => {
    const radioTab = document.createElement('button')
    radioTab.className = 'msb-tab msb-tab--pending'
    radioTab.dataset.tab = 'radio'
    document.body.appendChild(radioTab)
    const harness = createHarness()
    harness.selection.populateRadios([makeRadio()])
    expect(radioTab.classList.contains('msb-tab--pending')).toBe(false)
  })
})

describe('useSdrRadioSelection — loadRadios', () => {
  it('populates from the sessionStorage cache first, then from the store fetch', async () => {
    const harness = createHarness()
    const store = useSdrStore()
    const cachedRadios = [makeRadio({ id: 3, name: 'Cached' }), makeRadio({ id: 4 })]
    sessionStorage.setItem('sdrRadiosCache', JSON.stringify(cachedRadios))
    const freshRadios = [makeRadio({ id: 5, name: 'Fresh' }), makeRadio({ id: 6 })]
    const loadRadiosSpy = vi.spyOn(store, 'loadRadios').mockImplementation(async () => {
      store.radios = freshRadios
    })
    await harness.selection.loadRadios()
    expect(loadRadiosSpy).toHaveBeenCalledTimes(1)
    expect(store.radios).toEqual(freshRadios)
    expect(harness.selection.radiosLoading.value).toBe(false)
  })

  it('survives a corrupt cache entry and still loads from the store', async () => {
    const harness = createHarness()
    const store = useSdrStore()
    sessionStorage.setItem('sdrRadiosCache', 'not-json{')
    vi.spyOn(store, 'loadRadios').mockImplementation(async () => {
      store.radios = [makeRadio()]
    })
    await harness.selection.loadRadios()
    expect(store.radios).toHaveLength(1)
  })

  it('works with an empty cache (first boot)', async () => {
    const harness = createHarness()
    const store = useSdrStore()
    vi.spyOn(store, 'loadRadios').mockImplementation(async () => {
      store.radios = [makeRadio()]
    })
    await harness.selection.loadRadios()
    expect(harness.options.selectedRadioId.value).toBe(1) // sole enabled auto-select
  })
})

// A radio reserved as a domain receiver (AIR's ADS-B source, LAND's APRS
// decoder) is locked out of the panel, so neither path that picks a radio
// *for* the operator may land on one.
describe('useSdrRadioSelection — radios reserved by a domain', () => {
  it('refuses to select a reserved radio', () => {
    const harness = createHarness()
    useSdrStore().setAprsRadioId(1)

    harness.selection.selectRadio(makeRadio({ id: 1 }))

    expect(harness.options.selectedRadioId.value).toBeNull()
    expect(harness.openControlSocket).not.toHaveBeenCalled()
    expect(harness.options.controlsDisabled.value).toBe(true)
  })

  it('does not auto-select the remembered radio once it is reserved', () => {
    sessionStorage.setItem('sdrLastRadioId', '1')
    const harness = createHarness()
    useSdrStore().setAprsRadioId(1)

    harness.selection.populateRadios([makeRadio({ id: 1 })])

    expect(harness.options.selectedRadioId.value).toBeNull()
    expect(harness.selection.deviceDropdownLabel.value).toBe('— select radio —')
  })

  it('does not treat a reserved radio as the "sole enabled" one', () => {
    const harness = createHarness()
    useSdrStore().setAprsRadioId(1)

    harness.selection.populateRadios([makeRadio({ id: 1 })])

    expect(harness.options.selectedRadioId.value).toBeNull()
    expect(harness.openControlSocket).not.toHaveBeenCalled()
  })

  it('auto-selects the one free radio when its neighbour is reserved', () => {
    const harness = createHarness()
    useSdrStore().setAprsRadioId(2)

    harness.selection.populateRadios([makeRadio({ id: 1 }), makeRadio({ id: 2, name: 'Attic' })])

    expect(harness.options.selectedRadioId.value).toBe(1)
    expect(harness.openControlSocket).toHaveBeenCalledWith(1)
  })
})
