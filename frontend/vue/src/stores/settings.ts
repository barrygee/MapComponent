import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const open = ref(false)
  const activeSection = ref<string | null>(null)
  const allSettings = ref<Record<string, Record<string, unknown>>>({})

  function openPanel(section?: string) {
    open.value = true
    if (section) activeSection.value = section
  }

  function closePanel() {
    open.value = false
    document.dispatchEvent(new CustomEvent('settings-panel-closed'))
  }

  function togglePanel() {
    open.value = !open.value
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

  return { open, activeSection, allSettings, openPanel, closePanel, togglePanel, setSetting, getSetting, loadAll, put }
})
