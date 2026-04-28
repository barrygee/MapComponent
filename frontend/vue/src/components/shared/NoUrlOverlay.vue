<template>
  <div v-if="visible" class="no-url-overlay">
    <div class="no-url-overlay-box">
      <div class="no-url-overlay-domain">{{ domain.toUpperCase() }}</div>
      <div class="no-url-overlay-title">No Data Source Configured</div>
      <div class="no-url-overlay-msg">{{ message }}</div>
      <button class="no-url-overlay-btn" @click="openSettings">OPEN SETTINGS</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { onlineKey, offgridKey } from '@/utils/domainKeys'

const props = defineProps<{ domain: string }>()

const appStore      = useAppStore()
const settingsStore = useSettingsStore()

const hasUrl = ref(true)

function _readSourceOverride(): string {
  try { return localStorage.getItem(`sentinel_${props.domain}_sourceOverride`) || 'auto' } catch { return 'auto' }
}

const _sourceOverride = ref(_readSourceOverride())

function _effectiveMode(): string {
  const override = _sourceOverride.value
  if (override !== 'auto') return override
  return appStore.connectivityMode
}

const message = computed(() => {
  const mode = _effectiveMode() === 'offgrid' ? 'Off Grid' : 'Online'
  const setting = _effectiveMode() === 'offgrid' ? 'Off Grid Data Source' : 'Online Data Source'
  return `${mode} mode is active but no ${setting} URL has been set for ${props.domain.toUpperCase()}. Configure a URL in settings or switch connectivity mode to continue.`
})

const visible = computed(() => !hasUrl.value)

function _isPlaceholder(url: string): boolean {
  const t = url.trim()
  return !t || /^https?:\/\/?$/.test(t) || /^http:\/\/localhost\/?$/.test(t)
}

function _lsGet(key: string): string {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}

function check() {
  const ns    = props.domain
  const mode  = _effectiveMode()
  const _oKey = offgridKey(ns)
  const _nKey = onlineKey(ns)

  if (mode === 'offgrid') {
    const raw = _lsGet(`sentinel_${ns}_${_oKey}`)
    if (!raw) { hasUrl.value = false; return }
    try {
      const src = JSON.parse(raw)
      hasUrl.value = !!(src?.url && !_isPlaceholder(src.url))
    } catch { hasUrl.value = false }
  } else {
    const url = _lsGet(`sentinel_${ns}_${_nKey}`)
    hasUrl.value = url.length > 0 && !_isPlaceholder(url)
  }
}

async function checkWithBackend() {
  const ns    = props.domain
  const mode  = _effectiveMode()
  const _oKey = offgridKey(ns)
  const _nKey = onlineKey(ns)
  try {
    const res  = await fetch(`/api/settings/${ns}`)
    if (!res.ok) { check(); return }
    const data = await res.json() as Record<string, unknown>
    let backendUrl = ''
    if (mode === 'offgrid') {
      const src = data[_oKey] as { url?: string } | undefined
      backendUrl = src?.url ?? ''
    } else {
      backendUrl = (data[_nKey] as string) ?? ''
    }
    if (backendUrl && !_isPlaceholder(backendUrl)) {
      hasUrl.value = true
      const lsKey = mode === 'offgrid' ? `sentinel_${ns}_${_oKey}` : `sentinel_${ns}_${_nKey}`
      try {
        localStorage.setItem(lsKey, mode === 'offgrid' ? JSON.stringify(data[_oKey]) : backendUrl)
      } catch {}
    } else {
      hasUrl.value = false
    }
  } catch { check() }
}

function openSettings() {
  settingsStore.openPanel(props.domain)
}

function onSettingsClosed() {
  _sourceOverride.value = _readSourceOverride()
  checkWithBackend()
}

watch(() => appStore.connectivityMode, () => { checkWithBackend() })
watch(_sourceOverride, () => { checkWithBackend() })

onMounted(() => {
  checkWithBackend()
  window.addEventListener('sentinel:sourceOverrideChanged', onSettingsClosed)
})
onUnmounted(() => { window.removeEventListener('sentinel:sourceOverrideChanged', onSettingsClosed) })

useDocumentEvent('settings-panel-closed', onSettingsClosed)
</script>
