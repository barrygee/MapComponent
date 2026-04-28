import { onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'

const PROBE_INTERVAL_MS = 2000

export function useConnectivity(onModeChange?: (online: boolean) => void) {
  const appStore = useAppStore()
  const settingsStore = useSettingsStore()
  let timer: ReturnType<typeof setInterval> | null = null

  async function probe() {
    const mode = appStore.connectivityMode
    if (mode === 'online') {
      if (!appStore.isOnline) { appStore.setOnline(true); onModeChange?.(true) }
      return
    }
    if (mode === 'offgrid') {
      if (appStore.isOnline) { appStore.setOnline(false); onModeChange?.(false) }
      return
    }
    // auto — probe the connectivity URL
    const probeUrl = settingsStore.getSetting<string>('app', 'connectivityProbeUrl', 'https://tile.openstreetmap.org/favicon.ico')
    try {
      const res = await fetch(probeUrl, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3000) })
      const online = res.ok
      if (online !== appStore.isOnline) { appStore.setOnline(online); onModeChange?.(online) }
    } catch {
      if (appStore.isOnline) { appStore.setOnline(false); onModeChange?.(false) }
    }
  }

  onMounted(() => {
    probe()
    timer = setInterval(probe, PROBE_INTERVAL_MS)
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  // React immediately when the user changes the connectivity mode setting.
  // Always fire onModeChange unconditionally — probe() only fires it when isOnline
  // actually changes, so switching offgrid while already "offline" would be a no-op.
  watch(() => appStore.connectivityMode, (mode) => {
    if (mode === 'offgrid') {
      appStore.setOnline(false)
      onModeChange?.(false)
    } else if (mode === 'online') {
      appStore.setOnline(true)
      onModeChange?.(true)
    } else {
      probe()
    }
  })
}
