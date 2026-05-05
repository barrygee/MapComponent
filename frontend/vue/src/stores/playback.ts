import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused'

export interface MultiSnapshot {
  ts: number
  lat: number
  lon: number
  alt_baro: number | null
  gs: number | null
  track: number | null
  baro_rate: number | null
  squawk: string | null
}

export interface PlaybackAircraft {
  registration: string
  callsign: string
  type_code: string
  hex: string
  snapshots: MultiSnapshot[]
}

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16]

export const usePlaybackStore = defineStore('playback', () => {
  const status        = ref<PlaybackStatus>('idle')
  const aircraft      = ref<Record<string, PlaybackAircraft>>({})
  const windowStartMs = ref<number | null>(null)
  const windowEndMs   = ref<number | null>(null)
  const cursorMs      = ref<number | null>(null)
  const speedIdx      = ref(2) // default 1×

  // Set by the user in the footer before data is fetched
  const pendingStartMs = ref<number | null>(null)
  const pendingEndMs   = ref<number | null>(null)

  const isActive = computed(() => status.value !== 'idle')

  function activate(): void {
    status.value = 'loading'
  }

  function setData(data: { start_ms: number; end_ms: number; aircraft: Record<string, PlaybackAircraft> }): void {
    aircraft.value      = data.aircraft
    windowStartMs.value = data.start_ms
    windowEndMs.value   = data.end_ms

    // Start the cursor at the first actual snapshot so _bisectLeft immediately
    // finds a valid index — the user-selected start_ms may precede all data.
    let firstSnapshotMs = data.end_ms
    for (const ac of Object.values(data.aircraft)) {
      if (ac.snapshots.length && ac.snapshots[0].ts < firstSnapshotMs)
        firstSnapshotMs = ac.snapshots[0].ts
    }
    cursorMs.value = Math.max(data.start_ms, Math.min(firstSnapshotMs, data.end_ms))
    status.value   = 'ready'
  }

  function play(): void  { status.value = 'playing' }
  function pause(): void { status.value = 'paused' }

  function seek(ms: number): void {
    const lo = windowStartMs.value ?? ms
    const hi = windowEndMs.value   ?? ms
    cursorMs.value = Math.max(lo, Math.min(hi, ms))
  }

  function exit(): void {
    status.value        = 'idle'
    aircraft.value      = {}
    cursorMs.value      = null
    windowStartMs.value = null
    windowEndMs.value   = null
    pendingStartMs.value = null
    pendingEndMs.value   = null
  }

  return {
    status, aircraft, windowStartMs, windowEndMs, cursorMs, speedIdx,
    pendingStartMs, pendingEndMs, isActive,
    activate, setData, play, pause, seek, exit,
  }
})
