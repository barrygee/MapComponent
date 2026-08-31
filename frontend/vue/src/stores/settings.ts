import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const open = ref(false)
  // Visibility of the settings panel's left navigation rail. Toggled from the
  // footer's side-panel button while the settings panel is open, mirroring how
  // that same button shows/hides the map sidebar elsewhere in the app.
  const sidebarOpen = ref(true)
  const activeSection = ref<string | null>(null)
  const allSettings = ref<Record<string, Record<string, unknown>>>({})
  /**
   * The Sentry host the SDR section should expand when it next renders, or
   * null. Set by the Sentry markers on the domain maps (`SentrySitesControl`)
   * so "MORE" on a marker lands the operator on that host's own row rather than
   * on the section and a hunt through the list. `SentryHostsControl` clears it
   * once it has acted on it, so a later manual visit opens as usual.
   */
  const focusSentryHostId = ref<number | null>(null)

  function openPanel(section?: string) {
    open.value = true
    if (section) activeSection.value = section
  }

  /** Open the settings panel on the SDR section with one Sentry host expanded. */
  function openSentryHost(hostId: number) {
    focusSentryHostId.value = hostId
    openPanel('sdr')
  }

  /** Forget a pending Sentry-host focus, once it has been acted on. */
  function clearSentryHostFocus() {
    focusSentryHostId.value = null
  }

  function closePanel() {
    open.value = false
    document.dispatchEvent(new CustomEvent('settings-panel-closed'))
  }

  function togglePanel() {
    open.value = !open.value
  }

  /** Show/hide the settings panel's left navigation rail. */
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function setSetting(namespace: string, key: string, value: unknown) {
    if (!allSettings.value[namespace]) allSettings.value[namespace] = {}
    allSettings.value[namespace][key] = value
  }

  function getSetting<T>(namespace: string, key: string, fallback: T): T {
    return (allSettings.value[namespace]?.[key] as T) ?? fallback
  }

  async function loadAll() {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        allSettings.value = data
      }
    } catch {}
  }

  async function put(namespace: string, key: string, value: unknown) {
    setSetting(namespace, key, value)
    try {
      await fetch(`/api/settings/${namespace}/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
    } catch {}
  }

  return {
    open,
    sidebarOpen,
    activeSection,
    allSettings,
    focusSentryHostId,
    openPanel,
    openSentryHost,
    clearSentryHostFocus,
    closePanel,
    togglePanel,
    toggleSidebar,
    setSetting,
    getSetting,
    loadAll,
    put,
  }
})
