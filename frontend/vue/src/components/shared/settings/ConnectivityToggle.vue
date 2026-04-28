<template>
  <div class="settings-connectivity-wrap">
    <div class="settings-connectivity-switch">
      <span class="settings-connectivity-label">OFF GRID</span>
      <button
        class="settings-connectivity-track"
        :class="{ 'is-online': offGrid }"
        role="switch"
        :aria-checked="offGrid"
        aria-label="Toggle off grid mode"
        @click="toggle"
      ><span class="settings-connectivity-thumb"></span></button>
    </div>
    <div v-if="overrideConflicts.length > 0" class="settings-connectivity-override-summary">
      <div class="settings-conn-override-heading">SECTION OVERRIDES</div>
      <div v-for="c in overrideConflicts" :key="c.ns" class="settings-conn-override-row">
        <span class="settings-conn-override-ns">{{ c.ns.toUpperCase() }}</span>
        <span class="settings-conn-override-arrow">→</span>
        <span class="settings-conn-override-val" :class="'settings-conn-override-val--' + c.override">{{ c.override.toUpperCase() }}</span>
      </div>
    </div>
    <div v-if="warningVisible" class="settings-connectivity-warning">
      <span class="settings-connectivity-warning-msg">Some domains have source overrides set. Switching will reset all overrides to AUTO.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as settingsApi from '@/services/settingsApi'
import { useAppStore } from '@/stores/app'
import type { ConnectivityMode } from '@/stores/app'

const appStore = useAppStore()

const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()

const LS_KEY = 'sentinel_app_connectivityMode'
const DOMAIN_NAMESPACES = ['air', 'space', 'sea', 'land']

const offGrid = ref(false)
const warningVisible = ref(false)

try {
  offGrid.value = (localStorage.getItem(LS_KEY) ?? 'online') === 'offgrid'
} catch {}

const overrideConflicts = computed(() => {
  const appMode = offGrid.value ? 'offgrid' : 'online'
  return DOMAIN_NAMESPACES.flatMap(ns => {
    let override = 'auto'
    try { override = localStorage.getItem('sentinel_' + ns + '_sourceOverride') ?? 'auto' } catch {}
    return override !== 'auto' && override !== appMode ? [{ ns, override }] : []
  })
})

function hasOverrides(): boolean {
  return DOMAIN_NAMESPACES.some(ns => {
    try { const v = localStorage.getItem('sentinel_' + ns + '_sourceOverride'); return !!v && v !== 'auto' } catch { return false }
  })
}

function resetAllOverrides(): void {
  DOMAIN_NAMESPACES.forEach(ns => {
    try { localStorage.setItem('sentinel_' + ns + '_sourceOverride', 'auto') } catch {}
    settingsApi.put(ns, 'sourceOverride', 'auto')
  })
}

function toggle(): void {
  offGrid.value = !offGrid.value
  const newMode = offGrid.value ? 'offgrid' : 'online'
  const needsOverrideReset = hasOverrides()
  if (needsOverrideReset) warningVisible.value = true
  emit('stage', () => {
    if (needsOverrideReset) {
      resetAllOverrides()
      window.dispatchEvent(new CustomEvent('sentinel:sourceOverrideChanged'))
    }
    try { localStorage.setItem(LS_KEY, newMode) } catch {}
    settingsApi.put('app', 'connectivityMode', newMode)
    appStore.setConnectivityMode(newMode as ConnectivityMode)
  })
}

onMounted(async () => {
  const data = await settingsApi.getNamespace('app')
  if (data?.connectivityMode) {
    const backendMode = data.connectivityMode as string
    const backendOffGrid = backendMode === 'offgrid'
    if (backendOffGrid !== offGrid.value) {
      offGrid.value = backendOffGrid
      try { localStorage.setItem(LS_KEY, backendMode) } catch {}
      appStore.setConnectivityMode(backendMode as ConnectivityMode)
    }
  }
})

window.addEventListener('sentinel:sourceOverrideChanged', () => {
  // computed re-evaluates automatically
})
</script>
