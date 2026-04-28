<template>
  <div class="settings-datasource-wrap">
    <div class="settings-datasource-row">
      <span class="settings-datasource-label">URL</span>
      <input
        v-model="urlValue"
        type="url"
        class="settings-datasource-input"
        :placeholder="props.defaultUrl || 'http://localhost'"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
        @keydown.enter="emit('commit')"
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as settingsApi from '@/services/settingsApi'
import { offgridKey } from '@/utils/domainKeys'

const props = defineProps<{ ns: string; defaultUrl: string }>()
const emit = defineEmits<{
  stage: [fn: () => Promise<unknown> | void]
  commit: []
}>()

const _key   = offgridKey(props.ns)
const LS_KEY = `sentinel_${props.ns}_${_key}`
const urlValue = ref('')

const noDefault = props.defaultUrl === ''
function isPlaceholder(url: string): boolean {
  const t = url.trim()
  return !t || /^http:\/\/localhost\/?$/.test(t)
}

try {
  const raw = localStorage.getItem(LS_KEY)
  if (raw) {
    const saved = JSON.parse(raw) as { url?: string }
    if (saved.url && !(noDefault && isPlaceholder(saved.url))) urlValue.value = saved.url
    else if (noDefault && saved.url && isPlaceholder(saved.url)) {
      try { localStorage.removeItem(LS_KEY) } catch {}
    }
  }
} catch {}

onMounted(async () => {
  const data = await settingsApi.getNamespace(props.ns)
  if (!data?.[_key]) return
  const backendVal = data[_key] as { url?: string }
  if (backendVal.url && !isPlaceholder(backendVal.url) && !urlValue.value) {
    urlValue.value = backendVal.url
    try { localStorage.setItem(LS_KEY, JSON.stringify(backendVal)) } catch {}
  } else if (noDefault && backendVal.url && isPlaceholder(backendVal.url)) {
    try { localStorage.removeItem(LS_KEY) } catch {}
    settingsApi.put(props.ns, _key, { url: '' })
  } else if (!noDefault) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(backendVal)) } catch {}
  }
})

function onInput(): void {
  emit('stage', () => {
    const url = urlValue.value.trim()
    if (url) new URL(url)
    const val = { url }
    try { localStorage.setItem(LS_KEY, JSON.stringify(val)) } catch {}
    settingsApi.put(props.ns, _key, val)
  })
}
</script>
