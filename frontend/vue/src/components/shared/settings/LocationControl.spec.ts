import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import LocationControl from './LocationControl.vue'

vi.mock('@/services/settingsApi', () => ({
  put: vi.fn(),
  getNamespace: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
}))
import * as settingsApi from '@/services/settingsApi'

const STORAGE_KEY = 'sentinel_user_location'

/** Mount the control, optionally attached so `document.getElementById` can find its fields. */
function mountControl({ attach = false }: { attach?: boolean } = {}) {
  return mount(LocationControl, { attachTo: attach ? document.body : undefined })
}

function inputs(wrapper: ReturnType<typeof mountControl>) {
  const fields = wrapper.findAll('input')
  return {
    lat: fields[0]!,
    lon: fields[1]!,
    latValue: () => (fields[0]!.element as HTMLInputElement).value,
    lonValue: () => (fields[1]!.element as HTMLInputElement).value,
  }
}

const statusText = (wrapper: ReturnType<typeof mountControl>) =>
  wrapper.find('.settings-location-status').text()
const errorTexts = (wrapper: ReturnType<typeof mountControl>) =>
  wrapper.findAll('.settings-location-error').map((node) => node.text())
const hintTexts = (wrapper: ReturnType<typeof mountControl>) =>
  wrapper.findAll('.settings-location-hint').map((node) => node.text())
const saveButton = (wrapper: ReturnType<typeof mountControl>) => wrapper.find('button')

const NO_POSITION = 'No position set — using browser geolocation, if it is available.'

describe('LocationControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
    vi.mocked(settingsApi.put).mockResolvedValue(undefined)
  })

  describe('hydration', () => {
    it('seeds both fields from a localStorage latitude/longitude pair', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude: 51.5, longitude: -0.12 }))
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('51.50000')
      expect(fields.lonValue()).toBe('-0.12000')
    })

    it('accepts the legacy lat/lon keys and a longitude-only entry', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ lon: 10 }))
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('')
      expect(fields.lonValue()).toBe('10.00000')
    })

    it('seeds latitude only when longitude is absent', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude: 5 }))
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('5.00000')
      expect(fields.lonValue()).toBe('')
    })

    it('survives unparseable localStorage rather than failing to render', async () => {
      localStorage.setItem(STORAGE_KEY, 'not json')
      const wrapper = mountControl()
      await flushPromises()
      expect(inputs(wrapper).latValue()).toBe('')
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })

    it('prefills empty fields from a valid backend location', async () => {
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        location: { latitude: '40', longitude: '50' },
      })
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('40.00000')
      expect(fields.lonValue()).toBe('50.00000')
    })

    it('clears the fields and the timestamp when the backend location is the unset form', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ latitude: 51.5, longitude: -0.12, ts: 1_700_000_000_000 }),
      )
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        location: { latitude: '', longitude: '' },
      })
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('')
      expect(fields.lonValue()).toBe('')
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })

    it('keeps already-populated fields when the backend also has a valid location', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude: 1, longitude: 2 }))
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({
        location: { latitude: '40', longitude: '50' },
      })
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('1.00000')
      expect(fields.lonValue()).toBe('2.00000')
    })

    it('does nothing on mount when the backend namespace has no location key', async () => {
      vi.mocked(settingsApi.getNamespace).mockResolvedValue({ other: 1 })
      const wrapper = mountControl()
      await flushPromises()
      expect(inputs(wrapper).latValue()).toBe('')
    })

    it('does nothing on mount when the backend is unreachable', async () => {
      vi.mocked(settingsApi.getNamespace).mockResolvedValue(null)
      const wrapper = mountControl()
      await flushPromises()
      expect(inputs(wrapper).latValue()).toBe('')
    })
  })

  describe('status line', () => {
    it('reports no position when nothing is stored', async () => {
      const wrapper = mountControl()
      await flushPromises()
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })

    it('reports when the position was last set', async () => {
      const timestamp = 1_700_000_000_000
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ latitude: 51.5, longitude: -0.12, ts: timestamp }),
      )
      const wrapper = mountControl()
      await flushPromises()
      expect(statusText(wrapper)).toBe(`Last set ${new Date(timestamp).toLocaleString()}.`)
    })

    it('reports no position when a timestamp exists but the latitude is blank', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ longitude: -0.12, ts: 1_700_000_000_000 }))
      const wrapper = mountControl()
      await flushPromises()
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })

    it('reports no position when a timestamp exists but the longitude is blank', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude: 51.5, ts: 1_700_000_000_000 }))
      const wrapper = mountControl()
      await flushPromises()
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })

    it('reports no position when the stored pair carries no timestamp', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ latitude: 51.5, longitude: -0.12 }))
      const wrapper = mountControl()
      await flushPromises()
      expect(statusText(wrapper)).toBe(NO_POSITION)
    })
  })

  describe('field hints', () => {
    it('shows the decimal-degrees range for each field', async () => {
      const wrapper = mountControl()
      await flushPromises()
      expect(hintTexts(wrapper)).toEqual([
        'Decimal degrees, -90 to 90.',
        'Decimal degrees, -180 to 180.',
      ])
    })
  })

  describe('validation on blur', () => {
    it('rejects an out-of-range latitude, replacing its hint with the error', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lat.trigger('blur')
      expect(errorTexts(wrapper)).toEqual(['Latitude must be between -90 and 90.'])
      expect(hintTexts(wrapper)).toEqual(['Decimal degrees, -180 to 180.'])
      expect(fields.lat.attributes('aria-invalid')).toBe('true')
    })

    it('rejects an out-of-range longitude', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lon.setValue('500')
      await fields.lon.trigger('blur')
      expect(errorTexts(wrapper)).toEqual(['Longitude must be between -180 and 180.'])
      expect(fields.lon.attributes('aria-invalid')).toBe('true')
    })

    it('rejects text that is not a number', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('north')
      await fields.lat.trigger('blur')
      expect(errorTexts(wrapper)).toEqual([
        'Latitude must be a number in decimal degrees, e.g. 54.95149.',
      ])
    })

    it('accepts a valid coordinate', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('54.95149')
      await fields.lat.trigger('blur')
      expect(errorTexts(wrapper)).toEqual([])
    })

    it('accepts a blank field, since clearing both removes the position', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lon.setValue('')
      await fields.lon.trigger('blur')
      expect(errorTexts(wrapper)).toEqual([])
    })

    it('clears a latitude error as soon as the operator resumes typing', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lat.trigger('blur')
      expect(errorTexts(wrapper)).toHaveLength(1)
      await fields.lat.setValue('20')
      expect(errorTexts(wrapper)).toEqual([])
    })

    it('clears a longitude error as soon as the operator resumes typing', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lon.setValue('500')
      await fields.lon.trigger('blur')
      expect(errorTexts(wrapper)).toHaveLength(1)
      await fields.lon.setValue('50')
      expect(errorTexts(wrapper)).toEqual([])
    })
  })

  describe('saving', () => {
    it('persists a valid pair and reports when it was set', async () => {
      const liveSpy = vi.fn()
      window.addEventListener('sentinel:setUserLocation', liveSpy)
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(settingsApi.put).toHaveBeenCalledWith('app', 'location', {
        latitude: 51.5,
        longitude: -0.12,
      })
      // persist:false — this control writes the config itself, so the
      // composable must not duplicate the PUT.
      expect(liveSpy.mock.calls[0]![0].detail).toEqual({
        latitude: 51.5,
        longitude: -0.12,
        persist: false,
      })
      expect(statusText(wrapper)).toMatch(/^Last set /)
      window.removeEventListener('sentinel:setUserLocation', liveSpy)
    })

    it('takes the timestamp from what the composable stored, not the clock', async () => {
      const storedTimestamp = 1_700_000_000_000
      // Stand in for useUserLocation's listener, which writes the stored copy
      // (including its `ts`) in response to the dispatched set.
      const store = () =>
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ latitude: 51.5, longitude: -0.12, ts: storedTimestamp }),
        )
      window.addEventListener('sentinel:setUserLocation', store)
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()
      expect(statusText(wrapper)).toBe(`Last set ${new Date(storedTimestamp).toLocaleString()}.`)
      window.removeEventListener('sentinel:setUserLocation', store)
    })

    it('clears the position when both fields are blank', async () => {
      const clearedSpy = vi.fn()
      window.addEventListener('sentinel:userLocationCleared', clearedSpy)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ latitude: 51.5, longitude: -0.12, ts: 1_700_000_000_000 }),
      )
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('')
      await fields.lon.setValue('')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(clearedSpy).toHaveBeenCalled()
      expect(settingsApi.put).toHaveBeenCalledWith('app', 'location', {
        latitude: '',
        longitude: '',
      })
      expect(statusText(wrapper)).toBe(NO_POSITION)
      window.removeEventListener('sentinel:userLocationCleared', clearedSpy)
    })

    it('sends nothing and focuses the latitude when it is out of range', async () => {
      const wrapper = mountControl({ attach: true })
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lon.setValue('10')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(settingsApi.put).not.toHaveBeenCalled()
      expect(errorTexts(wrapper)).toEqual(['Latitude must be between -90 and 90.'])
      expect(document.activeElement).toBe(fields.lat.element)
      wrapper.unmount()
    })

    it('sends nothing and focuses the longitude when only it is out of range', async () => {
      const wrapper = mountControl({ attach: true })
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('10')
      await fields.lon.setValue('500')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(settingsApi.put).not.toHaveBeenCalled()
      expect(errorTexts(wrapper)).toEqual(['Longitude must be between -180 and 180.'])
      expect(document.activeElement).toBe(fields.lon.element)
      wrapper.unmount()
    })

    it('rejects half a position, naming and focusing the empty latitude', async () => {
      const wrapper = mountControl({ attach: true })
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(settingsApi.put).not.toHaveBeenCalled()
      expect(wrapper.find('.settings-location-notice').text()).toBe(
        'Enter a latitude too, or clear both to remove your position.',
      )
      expect(document.activeElement).toBe(fields.lat.element)
      wrapper.unmount()
    })

    it('rejects half a position, naming and focusing the empty longitude', async () => {
      const wrapper = mountControl({ attach: true })
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      expect(settingsApi.put).not.toHaveBeenCalled()
      expect(wrapper.find('.settings-location-notice').text()).toBe(
        'Enter a longitude too, or clear both to remove your position.',
      )
      expect(document.activeElement).toBe(fields.lon.element)
      wrapper.unmount()
    })

    it('does not throw when a rejected save has no field to focus', async () => {
      // Detached mount: the fields are not in the document, so the focus
      // lookup finds nothing. The rejection must still be reported.
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lon.setValue('10')
      await saveButton(wrapper).trigger('click')
      await flushPromises()
      expect(errorTexts(wrapper)).toEqual(['Latitude must be between -90 and 90.'])
    })

    it('disables the button and shows progress while the save is in flight', async () => {
      let releasePut: () => void = () => {}
      vi.mocked(settingsApi.put).mockReturnValue(
        new Promise<void>((resolve) => {
          releasePut = resolve
        }),
      )
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')

      expect(saveButton(wrapper).text()).toBe('SAVING…')
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

      releasePut()
      await flushPromises()
      expect(saveButton(wrapper).text()).toBe('SAVE LOCATION')
    })

    it('ignores an Enter press while a save is still in flight', async () => {
      // The button disables itself while saving, but the fields do not — so
      // Enter is the way a second save can actually be asked for, and the
      // re-entry guard is what stops it becoming a duplicate PUT.
      let releasePut: () => void = () => {}
      vi.mocked(settingsApi.put).mockReturnValue(
        new Promise<void>((resolve) => {
          releasePut = resolve
        }),
      )
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await fields.lat.trigger('keydown.enter')

      expect(settingsApi.put).toHaveBeenCalledTimes(1)
      releasePut()
      await flushPromises()
    })

    it('saves when Enter is pressed in a field', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await fields.lon.trigger('keydown.enter')
      await flushPromises()
      expect(settingsApi.put).toHaveBeenCalledWith('app', 'location', {
        latitude: 51.5,
        longitude: -0.12,
      })
    })
  })

  describe('external location changes', () => {
    it('updates the fields when another component broadcasts a synced location', async () => {
      const wrapper = mountControl()
      await flushPromises()
      window.dispatchEvent(
        new CustomEvent('settings:locationSynced', {
          detail: { latitude: 12.34, longitude: 56.78 },
        }),
      )
      await flushPromises()
      const fields = inputs(wrapper)
      expect(fields.latValue()).toBe('12.34000')
      expect(fields.lonValue()).toBe('56.78000')
      expect(statusText(wrapper)).toMatch(/^Last set /)
    })

    it('takes the synced timestamp from the stored copy when there is one', async () => {
      const storedTimestamp = 1_700_000_000_000
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ latitude: 12.34, longitude: 56.78, ts: storedTimestamp }),
      )
      const wrapper = mountControl()
      await flushPromises()
      window.dispatchEvent(
        new CustomEvent('settings:locationSynced', {
          detail: { latitude: 12.34, longitude: 56.78 },
        }),
      )
      await flushPromises()
      expect(statusText(wrapper)).toBe(`Last set ${new Date(storedTimestamp).toLocaleString()}.`)
    })

    it('clears a pending error when an external set supersedes it', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lat.trigger('blur')
      expect(errorTexts(wrapper)).toHaveLength(1)

      // A save must have happened for the guard to let the sync through.
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      window.dispatchEvent(
        new CustomEvent('settings:locationSynced', {
          detail: { latitude: 12.34, longitude: 56.78 },
        }),
      )
      await flushPromises()
      expect(errorTexts(wrapper)).toEqual([])
    })

    it('ignores the echo of its own save', async () => {
      const wrapper = mountControl()
      await flushPromises()
      // Re-broadcast a synced event synchronously during the component's own
      // dispatch — the selfSetting guard should make it ignore the echo.
      const echo = () =>
        window.dispatchEvent(
          new CustomEvent('settings:locationSynced', {
            detail: { latitude: 99, longitude: 99 },
          }),
        )
      window.addEventListener('sentinel:setUserLocation', echo)
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      // The typed text is left exactly as typed — had the echo been applied,
      // these would have been reformatted to '51.50000' / '-0.12000' under the
      // operator's cursor.
      expect(fields.latValue()).toBe('51.5')
      expect(fields.lonValue()).toBe('-0.12')
      window.removeEventListener('sentinel:setUserLocation', echo)
    })

    it('does not overwrite half-typed coordinates when a GPS fix arrives', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('54.9')

      // A GPS tick dispatches this every few seconds; it must not clobber the
      // edit in progress.
      window.dispatchEvent(
        new CustomEvent('settings:locationSynced', {
          detail: { latitude: 12.34, longitude: 56.78 },
        }),
      )
      await flushPromises()
      expect(fields.latValue()).toBe('54.9')
    })

    it('accepts synced updates again once the edit has been saved', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('51.5')
      await fields.lon.setValue('-0.12')
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      window.dispatchEvent(
        new CustomEvent('settings:locationSynced', {
          detail: { latitude: 12.34, longitude: 56.78 },
        }),
      )
      await flushPromises()
      expect(fields.latValue()).toBe('12.34000')
    })

    it('removes the locationSynced listener on unmount', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      const wrapper = mountControl()
      await flushPromises()
      wrapper.unmount()
      expect(removeSpy).toHaveBeenCalledWith('settings:locationSynced', expect.any(Function))
    })
  })

  describe('accessibility', () => {
    it('has no violations in its resting state', async () => {
      const wrapper = mountControl()
      await flushPromises()
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('has no violations while showing validation errors', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lat.trigger('blur')
      expect(
        await axe(wrapper.html(), { rules: { region: { enabled: false } } }),
      ).toHaveNoViolations()
    })

    it('names each field and points it at its own hint', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      const labels = wrapper.findAll('label')
      expect(labels.map((label) => label.text())).toEqual(['LAT', 'LON'])
      expect(labels[0]!.attributes('for')).toBe(fields.lat.attributes('id'))
      expect(labels[1]!.attributes('for')).toBe(fields.lon.attributes('id'))
      expect(fields.lat.attributes('aria-describedby')).toBe(
        wrapper.findAll('.settings-location-hint')[0]!.attributes('id'),
      )
    })

    it('points a rejected field at its error rather than its hint', async () => {
      const wrapper = mountControl()
      await flushPromises()
      const fields = inputs(wrapper)
      await fields.lat.setValue('200')
      await fields.lat.trigger('blur')
      expect(fields.lat.attributes('aria-describedby')).toBe(
        wrapper.find('.settings-location-error').attributes('id'),
      )
    })
  })
})
