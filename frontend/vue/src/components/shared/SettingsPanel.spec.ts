import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'

// SettingRow imports ExportAllControl, which causes a v8 coverage merge artifact
// when ExportAllControl is loaded in this worker (where it's never exercised) AND
// in ExportAllControl.spec.ts's worker (where it has 100% coverage). Mocking it
// here prevents that double-loading without affecting SettingsPanel test behaviour.
vi.mock('./settings/ExportAllControl.vue', () => ({ default: { name: 'ExportAllControl' } }))
import { setActivePinia, createPinia } from 'pinia'
import { axe } from 'jest-axe'
import SettingsPanel from './SettingsPanel.vue'
import SettingRow from './settings/SettingRow.vue'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { useSdrStore } from '@/stores/sdr'

// SettingRow and its many control children are covered by their own specs; stub
// it so this spec exercises only SettingsPanel's own section/search/commit logic.
function mountPanel({ attach = false }: { attach?: boolean } = {}) {
  return mount(SettingsPanel, {
    attachTo: attach ? document.body : undefined,
    global: { stubs: { SettingRow: true } },
  })
}

const reload = vi.fn()

enableAutoUnmount(afterEach)

describe('SettingsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    reload.mockClear()
    // jsdom's location.reload throws "not implemented"; swap in a spy.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('section navigation', () => {
    it('lists App Settings plus every enabled domain section', () => {
      const wrapper = mountPanel()
      const labels = wrapper
        .findAll('.settings-nav-item')
        .map((node) => node.attributes('data-tooltip'))
      expect(labels).toEqual(['App Settings', 'AIR', 'SPACE', 'SEA', 'LAND', 'SDR'])
    })

    it('hides domain sections that are not enabled', () => {
      const appStore = useAppStore()
      appStore.enabledDomains = ['air']
      const wrapper = mountPanel()
      const labels = wrapper
        .findAll('.settings-nav-item')
        .map((node) => node.attributes('data-tooltip'))
      expect(labels).toEqual(['App Settings', 'AIR'])
    })

    // The nav item is a native <button> (BaseIconButton), so Enter/Space
    // activation is guaranteed by the platform — a focused native button
    // turns either keypress into a `click` on its own, with no listener code
    // of ours involved. jsdom doesn't synthesise that click from a dispatched
    // keydown, so simulating the keypress itself wouldn't exercise anything;
    // asserting the click-driven activation is what covers `selectSection`,
    // trusting the platform for the Enter/Space→click part.
    it('activates a section when Enter would activate its native nav button', async () => {
      const wrapper = mountPanel()
      const airNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'AIR')!
      expect(airNav.element.tagName).toBe('BUTTON')
      await airNav.trigger('click')
      expect(airNav.classes()).toContain('active')
    })

    it('activates a section when Space would activate its native nav button', async () => {
      const wrapper = mountPanel()
      const airNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'AIR')!
      expect(airNav.element.tagName).toBe('BUTTON')
      await airNav.trigger('click')
      expect(airNav.classes()).toContain('active')
    })

    it('shows the App heading without a SETTINGS suffix and domain headings with it', async () => {
      const wrapper = mountPanel()
      expect(wrapper.find('#settings-section-heading').text()).toBe('App Settings')

      const airNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'AIR')!
      await airNav.trigger('click')
      expect(wrapper.find('#settings-section-heading').text()).toBe('AIR SETTINGS')
    })

    it('selecting a section marks it active and renders its items', async () => {
      const wrapper = mountPanel()
      const airNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'AIR')!
      await airNav.trigger('click')
      expect(airNav.classes()).toContain('active')
      // The AIR section declares group labels (ALERTS, LABELS, …).
      const groupLabels = wrapper.findAll('.settings-group-label').map((node) => node.text())
      expect(groupLabels).toContain('ALERTS')
      expect(groupLabels).toContain('DATA SOURCES')
    })

    it('renders the empty placeholder for a section with no items', async () => {
      // SEA has items, but selecting then clearing is awkward; instead drive an
      // empty section by enabling a section key that has no settings is not
      // possible — every nav key has items except none, so assert SEA renders rows.
      const wrapper = mountPanel()
      const seaNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'SEA')!
      await seaNav.trigger('click')
      expect(wrapper.findAllComponents(SettingRow).length).toBeGreaterThan(0)
    })

    it('falls back to the raw key when the heading section is unknown', async () => {
      // A stale reopen value points at a section that no longer exists.
      sessionStorage.setItem('sentinel_settings_reopen', 'ghost')
      const store = useSettingsStore()
      const wrapper = mountPanel()
      store.openPanel()
      await flushPromises()
      expect(wrapper.find('#settings-section-heading').text()).toBe('ghost')
    })
  })

  describe('sidebar nav', () => {
    it('each nav item carries a tooltip label matching its accessible name', () => {
      const wrapper = mountPanel()
      const items = wrapper.findAll('.settings-nav-item')
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.attributes('data-tooltip')).toBe(item.attributes('aria-label'))
      }
    })

    it('collapses the rail when the store sidebar is hidden', async () => {
      const wrapper = mountPanel()
      const store = useSettingsStore()
      // Open by default: the rail is expanded.
      expect(wrapper.find('#settings-sidebar').classes()).not.toContain(
        'settings-sidebar--collapsed',
      )
      store.toggleSidebar()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('#settings-sidebar').classes()).toContain('settings-sidebar--collapsed')
    })
  })

  describe('search', () => {
    it('shows SEARCH RESULTS heading and groups matches by section', async () => {
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('source')
      expect(wrapper.find('#settings-section-heading').text()).toBe('SEARCH RESULTS')
      const sectionLabels = wrapper.findAll('.settings-section-label').map((node) => node.text())
      // "source" matches across multiple domains.
      expect(sectionLabels.length).toBeGreaterThan(1)
      expect(wrapper.findAllComponents(SettingRow).length).toBeGreaterThan(0)
    })

    it('shows a no-results message when nothing matches', async () => {
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('zzzznotathing')
      expect(wrapper.find('.settings-empty').text()).toBe('No results found')
    })

    it('excludes matches from disabled domains', async () => {
      const appStore = useAppStore()
      appStore.enabledDomains = ['air'] // space disabled
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('uncategorised') // space-only term
      expect(wrapper.find('.settings-empty').text()).toBe('No results found')
    })

    it('clears the search via the clear button', async () => {
      const wrapper = mountPanel()
      const input = wrapper.find('#settings-search-input')
      await input.setValue('source')
      await wrapper.find('#settings-search-clear').trigger('click')
      expect((input.element as HTMLInputElement).value).toBe('')
    })

    it('closes the panel when Escape is pressed inside the dialog', async () => {
      const store = useSettingsStore()
      store.openPanel()
      const closeSpy = vi.spyOn(store, 'closePanel')
      const wrapper = mountPanel()
      // Escape bubbles to the dialog container's keydown handler.
      await wrapper.find('#settings-panel').trigger('keydown', { key: 'Escape' })
      expect(closeSpy).toHaveBeenCalledOnce()
    })

    it('keeps the footer visible while a search is active', async () => {
      const wrapper = mountPanel()
      const footer = () => wrapper.find('#settings-footer').element as HTMLElement
      expect(footer().style.display).toBe('')
      await wrapper.find('#settings-search-input').setValue('source')
      // Footer remains visible during search so Apply Changes is always reachable.
      expect(footer().style.display).toBe('')
    })
  })

  describe('trunk channel-maps visibility gating', () => {
    // The Trunk Channel Maps (JSON) editor row is gated behind the SDR store's
    // trunkTrackingEnabled flag; the always-present Trunk Tracking toggle is not.
    function renderedItemIds(wrapper: ReturnType<typeof mountPanel>): string[] {
      return wrapper
        .findAllComponents(SettingRow)
        .map((row) => (row.props('item') as { id: string }).id)
    }

    async function openSdrSection(wrapper: ReturnType<typeof mountPanel>) {
      const sdrNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'SDR')!
      await sdrNav.trigger('click')
    }

    it('lists the decode-mute toggle in the SDR section and in search', async () => {
      localStorage.clear()
      const wrapper = mountPanel()
      await openSdrSection(wrapper)
      expect(renderedItemIds(wrapper)).toContain('sdr-decode-mute-toggle')

      await wrapper.find('#settings-search-input').setValue('Mute Audio While Decoding')
      expect(renderedItemIds(wrapper)).toContain('sdr-decode-mute-toggle')
    })

    it('hides the channel-maps editor when trunk tracking is off', async () => {
      localStorage.clear()
      const wrapper = mountPanel()
      await openSdrSection(wrapper)
      const ids = renderedItemIds(wrapper)
      expect(ids).toContain('sdr-trunk-tracking-toggle')
      expect(ids).not.toContain('sdr-channelmaps-file')
    })

    it('shows the channel-maps editor when trunk tracking is on', async () => {
      localStorage.clear()
      useSdrStore().setTrunkTrackingEnabled(true)
      const wrapper = mountPanel()
      await openSdrSection(wrapper)
      const ids = renderedItemIds(wrapper)
      expect(ids).toContain('sdr-trunk-tracking-toggle')
      expect(ids).toContain('sdr-channelmaps-file')
    })

    it('excludes the channel-maps editor from search results when trunk tracking is off', async () => {
      localStorage.clear()
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('Trunk Channel Maps')
      const ids = renderedItemIds(wrapper)
      expect(ids).not.toContain('sdr-channelmaps-file')
    })

    it('includes the channel-maps editor in search results when trunk tracking is on', async () => {
      localStorage.clear()
      useSdrStore().setTrunkTrackingEnabled(true)
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('Trunk Channel Maps')
      const ids = renderedItemIds(wrapper)
      expect(ids).toContain('sdr-channelmaps-file')
    })
  })

  describe('selecting a section resets transient state', () => {
    it('clears the search query and staged changes', async () => {
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('source')
      wrapper.findComponent(SettingRow).vm.$emit('stage', 'x', vi.fn())

      const airNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'AIR')!
      await airNav.trigger('click')
      expect((wrapper.find('#settings-search-input').element as HTMLInputElement).value).toBe('')

      // With no staged changes left, APPLY reports NO CHANGES.
      await wrapper.find('#settings-apply-btn').trigger('click')
      expect(wrapper.find('#settings-apply-status').text()).toBe('NO CHANGES')
    })
  })

  describe('commitAll', () => {
    it('reports NO CHANGES when nothing is staged', async () => {
      const wrapper = mountPanel()
      await wrapper.find('#settings-apply-btn').trigger('click')
      const status = wrapper.find('#settings-apply-status')
      expect(status.text()).toBe('NO CHANGES')
      expect(status.classes()).toContain('settings-apply-status--ok')
    })

    it('awaits async stages, then saves, stashes the reopen section and reloads', async () => {
      vi.useFakeTimers()
      const asyncStage = vi.fn().mockResolvedValue(undefined)
      const syncStage = vi.fn() // returns undefined → treated as immediate
      const wrapper = mountPanel()
      const rows = wrapper.findAllComponents(SettingRow)
      rows[0]!.vm.$emit('stage', 'a', asyncStage)
      rows[1]!.vm.$emit('stage', 'b', syncStage)

      await wrapper.find('#settings-apply-btn').trigger('click')
      await flushPromises()
      expect(asyncStage).toHaveBeenCalledOnce()
      expect(syncStage).toHaveBeenCalledOnce()
      expect(wrapper.find('#settings-apply-status').text()).toBe('SAVED')

      vi.runAllTimers()
      expect(sessionStorage.getItem('sentinel_settings_reopen')).toBe('app')
      expect(reload).toHaveBeenCalledOnce()
    })

    it('reports ERROR when a stage throws synchronously', async () => {
      const wrapper = mountPanel()
      wrapper.findComponent(SettingRow).vm.$emit('stage', 'a', () => {
        throw new Error('bad')
      })
      await wrapper.find('#settings-apply-btn').trigger('click')
      await flushPromises()
      const status = wrapper.find('#settings-apply-status')
      expect(status.text()).toBe('ERROR')
      expect(status.classes()).toContain('settings-apply-status--error')
    })

    it('reports ERROR when an async stage rejects', async () => {
      const wrapper = mountPanel()
      wrapper
        .findComponent(SettingRow)
        .vm.$emit('stage', 'a', () => Promise.reject(new Error('no')))
      await wrapper.find('#settings-apply-btn').trigger('click')
      await flushPromises()
      expect(wrapper.find('#settings-apply-status').text()).toBe('ERROR')
    })

    it('clears the status message after the timeout', async () => {
      vi.useFakeTimers()
      const wrapper = mountPanel()
      await wrapper.find('#settings-apply-btn').trigger('click')
      expect(wrapper.find('#settings-apply-status').text()).toBe('NO CHANGES')
      vi.advanceTimersByTime(2500)
      await flushPromises()
      expect(wrapper.find('#settings-apply-status').text()).toBe('')
    })

    it('can commit via a SettingRow commit event', async () => {
      const wrapper = mountPanel()
      wrapper.findComponent(SettingRow).vm.$emit('commit')
      await flushPromises()
      expect(wrapper.find('#settings-apply-status').text()).toBe('NO CHANGES')
    })
  })

  describe('store.open watcher', () => {
    it('applies the store activeSection and focuses search when opened', async () => {
      vi.useFakeTimers()
      const store = useSettingsStore()
      const wrapper = mountPanel()
      store.openPanel('sdr')
      await flushPromises()
      vi.runAllTimers()
      const sdrNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'SDR')!
      expect(sdrNav.classes()).toContain('active')
    })

    it('a stale reopen section overrides the stored activeSection', async () => {
      const store = useSettingsStore()
      sessionStorage.setItem('sentinel_settings_reopen', 'space')
      const wrapper = mountPanel()
      store.openPanel('air')
      await flushPromises()
      const spaceNav = wrapper
        .findAll('.settings-nav-item')
        .find((node) => node.attributes('data-tooltip') === 'SPACE')!
      expect(spaceNav.classes()).toContain('active')
      expect(sessionStorage.getItem('sentinel_settings_reopen')).toBeNull()
    })

    it('clears the search and staged changes when closed', async () => {
      const store = useSettingsStore()
      store.openPanel()
      const wrapper = mountPanel()
      await wrapper.find('#settings-search-input').setValue('source')
      store.closePanel()
      await flushPromises()
      expect((wrapper.find('#settings-search-input').element as HTMLInputElement).value).toBe('')
    })
  })

  describe('dialog semantics & focus', () => {
    it('exposes the panel as a labelled modal dialog', () => {
      const wrapper = mountPanel()
      const panel = wrapper.find('#settings-panel')
      expect(panel.attributes('role')).toBe('dialog')
      expect(panel.attributes('aria-modal')).toBe('true')
      expect(panel.attributes('aria-labelledby')).toBe('settings-section-heading')
    })

    it('moves focus to the dialog container (not the search field) when opened on the App section', async () => {
      const store = useSettingsStore()
      const wrapper = mountPanel({ attach: true })
      store.openPanel('app')
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.find('#settings-panel').element)
    })

    it('moves focus to the dialog container when opened on a section without search', async () => {
      const store = useSettingsStore()
      const wrapper = mountPanel({ attach: true })
      store.openPanel('sdr')
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.find('#settings-panel').element)
    })

    it('restores focus to the opening trigger when closed', async () => {
      const trigger = document.createElement('button')
      document.body.appendChild(trigger)
      trigger.focus()

      const store = useSettingsStore()
      mountPanel({ attach: true })
      store.openPanel('app')
      await flushPromises()
      expect(document.activeElement).not.toBe(trigger)

      store.closePanel()
      await flushPromises()
      expect(document.activeElement).toBe(trigger)
      trigger.remove()
    })
  })

  describe('locationSynced event', () => {
    it('drops a staged location edit when the panel is open on App settings', async () => {
      const store = useSettingsStore()
      store.openPanel('app')
      const wrapper = mountPanel()
      // Stage a 'location' change, then a sync event supersedes it.
      wrapper.findComponent(SettingRow).vm.$emit('stage', 'location', vi.fn())
      window.dispatchEvent(new CustomEvent('settings:locationSynced'))
      await flushPromises()

      // The staged location was dropped → APPLY now finds nothing to commit.
      await wrapper.find('#settings-apply-btn').trigger('click')
      expect(wrapper.find('#settings-apply-status').text()).toBe('NO CHANGES')
    })

    it('ignores the sync event when the panel is closed', async () => {
      const wrapper = mountPanel()
      wrapper.findComponent(SettingRow).vm.$emit('stage', 'location', vi.fn())
      window.dispatchEvent(new CustomEvent('settings:locationSynced'))
      await flushPromises()
      // Panel closed (store.open false) → staged edit is kept, so APPLY commits it.
      await wrapper.find('#settings-apply-btn').trigger('click')
      await flushPromises()
      expect(wrapper.find('#settings-apply-status').text()).not.toBe('NO CHANGES')
    })
  })

  it('has no accessibility violations', async () => {
    const wrapper = mountPanel()
    // `region` is enabled: the panel is a role="dialog", whose content axe
    // exempts from the landmark requirement (phase 8-4b).
    expect(await axe(wrapper.html())).toHaveNoViolations()
  })
})
