<template>
  <div id="air-playback-panel">

      <div class="sdr-group-body sdr-group-body-expanded">

        <!-- ── Setup: date + time fields ── -->
        <div class="sdr-radio-section" :class="{ 'apb-section--locked': isActive }">

          <!-- Start date picker -->
          <label class="sdr-field-label">START DATE</label>
          <div class="apb-cal-wrap" ref="calWrap">
            <button class="apb-date-btn" :class="{ 'apb-date-btn--chosen': !!pendingDate }" @click="!isActive && (calOpen = !calOpen)" type="button" :disabled="isActive">
              <span>{{ pendingDate ? formatDisplayDate(pendingDate) : 'DD / MM / YYYY' }}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1" y="2" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1"/>
                <line x1="1" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1"/>
                <line x1="3" y1="1" x2="3" y2="3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
                <line x1="7" y1="1" x2="7" y2="3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
            </button>
            <div v-if="calOpen && !isActive" class="apb-cal-popup" @mousedown.stop>
              <div class="apb-cal-header">
                <button class="apb-cal-nav" @click="calPrevMonth" type="button">&#8249;</button>
                <span class="apb-cal-month-label">{{ CAL_MONTHS[calViewMonth] }} {{ calViewYear }}</span>
                <button class="apb-cal-nav" @click="calNextMonth" type="button">&#8250;</button>
              </div>
              <div class="apb-cal-grid">
                <span class="apb-cal-dow" v-for="d in ['M','T','W','T','F','S','S']" :key="d + Math.random()">{{ d }}</span>
                <button
                  v-for="cell in calCells" :key="cell.key"
                  class="apb-cal-cell"
                  :class="{
                    'apb-cal-cell--other':    cell.other,
                    'apb-cal-cell--today':    cell.today,
                    'apb-cal-cell--sel':      cell.selected,
                    'apb-cal-cell--disabled': cell.disabled
                  }"
                  :disabled="cell.disabled"
                  @click="selectCalDate(cell)"
                  type="button"
                >{{ cell.day }}</button>
              </div>
            </div>
          </div>

        </div>

        <div class="sdr-radio-section sdr-radio-section--tight" :class="{ 'apb-section--locked': isActive }">
          <!-- Start time -->
          <label class="sdr-field-label">START TIME</label>
          <div class="apb-time-row">
            <div class="apb-dd-wrap" ref="startHHWrap">
              <button class="apb-time-select" :class="{ 'apb-time-select--chosen': startHH !== '' }" @click="!isActive && toggleDd('startHH')" type="button" :disabled="isActive">
                <span>{{ startHH !== '' ? String(startHH).padStart(2, '0') : 'hours' }}</span>
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0l4 5 4-5z" fill="currentColor"/></svg>
              </button>
              <Teleport v-if="openDd === 'startHH' && ddRect" to="body">
                <div class="apb-dd-list apb-dd-list--fixed" :style="{ top: ddRect.top + 'px', left: ddRect.left + 'px', width: ddRect.width + 'px' }" @mousedown.stop>
                  <button v-for="h in 24" :key="h" class="apb-dd-item" :class="{ 'apb-dd-item--sel': startHH === h - 1, 'apb-dd-item--disabled': !isHourAvailable(h - 1) }" :disabled="!isHourAvailable(h - 1)" @click="startHH = h - 1; startMM = ''; closeDd()" type="button">{{ String(h - 1).padStart(2, '0') }}</button>
                </div>
              </Teleport>
            </div>
            <span class="apb-time-colon">:</span>
            <div class="apb-dd-wrap" ref="startMMWrap">
              <button class="apb-time-select" :class="{ 'apb-time-select--chosen': startMM !== '' }" @click="!isActive && toggleDd('startMM')" type="button" :disabled="isActive">
                <span>{{ startMM !== '' ? String(startMM).padStart(2, '0') : 'minutes' }}</span>
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0l4 5 4-5z" fill="currentColor"/></svg>
              </button>
              <Teleport v-if="openDd === 'startMM' && ddRect" to="body">
                <div class="apb-dd-list apb-dd-list--fixed" :style="{ top: ddRect.top + 'px', left: ddRect.left + 'px', width: ddRect.width + 'px' }" @mousedown.stop>
                  <button v-for="m in 60" :key="m" class="apb-dd-item"
                    :class="{ 'apb-dd-item--sel': startMM === m - 1, 'apb-dd-item--disabled': typeof startHH === 'number' && !availableMinutesFor(startHH as number).has(m - 1) }"
                    :disabled="typeof startHH === 'number' && !availableMinutesFor(startHH as number).has(m - 1)"
                    @click="startMM = m - 1; closeDd()" type="button">{{ String(m - 1).padStart(2, '0') }}</button>
                </div>
              </Teleport>
            </div>
          </div>
        </div>

        <div class="sdr-radio-section" :class="{ 'apb-section--locked': isActive }">

          <!-- End date picker -->
          <label class="sdr-field-label">END DATE</label>
          <div class="apb-cal-wrap" ref="endCalWrap">
            <button class="apb-date-btn" :class="{ 'apb-date-btn--chosen': !!pendingEndDate }" @click="!isActive && (endCalOpen = !endCalOpen)" type="button" :disabled="isActive">
              <span>{{ pendingEndDate ? formatDisplayDate(pendingEndDate) : 'DD / MM / YYYY' }}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1" y="2" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1"/>
                <line x1="1" y1="4.5" x2="9" y2="4.5" stroke="currentColor" stroke-width="1"/>
                <line x1="3" y1="1" x2="3" y2="3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
                <line x1="7" y1="1" x2="7" y2="3" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
              </svg>
            </button>
            <div v-if="endCalOpen && !isActive" class="apb-cal-popup" @mousedown.stop>
              <div class="apb-cal-header">
                <button class="apb-cal-nav" @click="endCalPrevMonth" type="button">&#8249;</button>
                <span class="apb-cal-month-label">{{ CAL_MONTHS[endCalViewMonth] }} {{ endCalViewYear }}</span>
                <button class="apb-cal-nav" @click="endCalNextMonth" type="button">&#8250;</button>
              </div>
              <div class="apb-cal-grid">
                <span class="apb-cal-dow" v-for="d in ['M','T','W','T','F','S','S']" :key="d + Math.random()">{{ d }}</span>
                <button
                  v-for="cell in endCalCells" :key="cell.key"
                  class="apb-cal-cell"
                  :class="{
                    'apb-cal-cell--other':    cell.other,
                    'apb-cal-cell--today':    cell.today,
                    'apb-cal-cell--sel':      cell.selected,
                    'apb-cal-cell--disabled': cell.disabled
                  }"
                  :disabled="cell.disabled"
                  @click="selectEndCalDate(cell)"
                  type="button"
                >{{ cell.day }}</button>
              </div>
            </div>
          </div>

        </div>

        <div class="sdr-radio-section sdr-radio-section--tight" :class="{ 'apb-section--locked': isActive }">
          <!-- End time -->
          <label class="sdr-field-label">END TIME</label>
          <span v-if="endTimeError" class="apb-time-error">{{ endTimeError }}</span>
          <div class="apb-time-row">
            <div class="apb-dd-wrap" ref="endHHWrap">
              <button class="apb-time-select" :class="{ 'apb-time-select--chosen': endHH !== '' }" @click="!isActive && toggleDd('endHH')" type="button" :disabled="isActive">
                <span>{{ endHH !== '' ? String(endHH).padStart(2, '0') : 'hours' }}</span>
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0l4 5 4-5z" fill="currentColor"/></svg>
              </button>
              <Teleport v-if="openDd === 'endHH' && ddRect" to="body">
                <div class="apb-dd-list apb-dd-list--fixed" :style="{ top: ddRect.top + 'px', left: ddRect.left + 'px', width: ddRect.width + 'px' }" @mousedown.stop>
                  <button v-for="h in 24" :key="h" class="apb-dd-item" :class="{ 'apb-dd-item--sel': endHH === h - 1, 'apb-dd-item--disabled': !isHourAvailable(h - 1) || (pendingEndDate === pendingDate && typeof startHH === 'number' && h - 1 < startHH) }" :disabled="!isHourAvailable(h - 1) || (pendingEndDate === pendingDate && typeof startHH === 'number' && h - 1 < startHH)" @click="endHH = h - 1; endMM = ''; closeDd()" type="button">{{ String(h - 1).padStart(2, '0') }}</button>
                </div>
              </Teleport>
            </div>
            <span class="apb-time-colon">:</span>
            <div class="apb-dd-wrap" ref="endMMWrap">
              <button class="apb-time-select" :class="{ 'apb-time-select--chosen': endMM !== '' }" @click="!isActive && toggleDd('endMM')" type="button" :disabled="isActive">
                <span>{{ endMM !== '' ? String(endMM).padStart(2, '0') : 'minutes' }}</span>
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0l4 5 4-5z" fill="currentColor"/></svg>
              </button>
              <Teleport v-if="openDd === 'endMM' && ddRect" to="body">
                <div class="apb-dd-list apb-dd-list--fixed" :style="{ top: ddRect.top + 'px', left: ddRect.left + 'px', width: ddRect.width + 'px' }" @mousedown.stop>
                  <button v-for="m in 60" :key="m" class="apb-dd-item"
                    :class="{ 'apb-dd-item--sel': endMM === m - 1, 'apb-dd-item--disabled': (typeof endHH === 'number' && !availableMinutesFor(endHH as number).has(m - 1)) || (pendingEndDate === pendingDate && typeof endHH === 'number' && typeof startHH === 'number' && endHH === startHH && typeof startMM === 'number' && m - 1 <= startMM) }"
                    :disabled="(typeof endHH === 'number' && !availableMinutesFor(endHH as number).has(m - 1)) || (pendingEndDate === pendingDate && typeof endHH === 'number' && typeof startHH === 'number' && endHH === startHH && typeof startMM === 'number' && m - 1 <= startMM)"
                    @click="endMM = m - 1; closeDd()" type="button">{{ String(m - 1).padStart(2, '0') }}</button>
                </div>
              </Teleport>
            </div>
          </div>
        </div>

        <!-- ── START PLAYBACK button (only when not yet active) ── -->
        <div v-if="!isActive" class="sdr-radio-section sdr-radio-section--tight">
          <button
            class="apb-load-btn"
            :disabled="!canLoad || isLoading"
            @click="loadPlayback"
          >
            <svg v-if="isLoading" class="apb-spin" width="11" height="11" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20 12" stroke-linecap="round"/>
            </svg>
            <span>{{ isLoading ? 'LOADING…' : 'START PLAYBACK' }}</span>
          </button>
        </div>

        <!-- ── Timeline group (shown but disabled until active) ── -->
        <div class="sdr-radio-section" :class="{ 'apb-section--locked': !isActive }">
          <!-- Play/Pause + transport row -->
          <div class="apb-transport-row">
            <button
              class="apb-transport-btn"
              :disabled="!isActive"
              @click="playbackStore.status === 'playing' ? playbackStore.pause() : playbackStore.play()"
            >
              <svg v-if="playbackStore.status === 'playing'" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1" y="1" width="3" height="8" rx="0.5" fill="currentColor"/>
                <rect x="6" y="1" width="3" height="8" rx="0.5" fill="currentColor"/>
              </svg>
              <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
                <polygon points="2,1 9,5 2,9" fill="currentColor"/>
              </svg>
            </button>
            <div class="apb-speed-group">
              <button
                v-for="(s, i) in PLAYBACK_SPEEDS" :key="i"
                class="apb-speed-btn"
                :class="{ 'apb-speed-btn--active': i === playbackStore.speedIdx }"
                :disabled="!isActive"
                @click="playbackStore.speedIdx = i"
              >{{ s }}×</button>
            </div>
          </div>
        </div>

        <div class="sdr-radio-section sdr-radio-section--tight" :class="{ 'apb-section--locked': !isActive }">
          <!-- Timeline canvas -->
          <div class="apb-timeline-wrap" ref="timelineWrap">
            <canvas ref="timelineCanvas" class="apb-timeline-canvas"
              @mousedown="isActive && onTimelineMousedown($event)"
              @mousemove="isActive && onTimelineMousemove($event)"
              @mouseleave="isActive && onTimelineMouseleave()"
            />
          </div>
        </div>

        <!-- ── STOP PLAYBACK button (only when active) ── -->
        <div v-if="isActive" class="sdr-radio-section sdr-radio-section--tight">
          <button class="apb-exit-btn" @click="playbackStore.exit()">STOP PLAYBACK</button>
        </div>

      </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { usePlaybackStore, PLAYBACK_SPEEDS } from '@/stores/playback'

const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const playbackStore = usePlaybackStore()

// ---- Setup form refs (declared first — referenced by computed below) ----
const pendingDate    = ref('')
const pendingEndDate = ref('')
const startHH     = ref<number | ''>('')
const startMM     = ref<number | ''>('')
const endHH       = ref<number | ''>('')
const endMM       = ref<number | ''>('')
const isLoading   = ref(false)

// ---- Available recorded periods ----
interface AvailableDate { date: string; start_ms: number; end_ms: number }
const availableDates = ref<AvailableDate[]>([])
const availableDateSet = computed(() => new Set(availableDates.value.map(d => d.date)))

async function fetchAvailableDates(): Promise<void> {
  try {
    const res = await fetch('/api/air/recordings/available-dates')
    if (res.ok) availableDates.value = await res.json()
  } catch { /* silent */ }
}

// For a selected date, the recorded start/end times in UTC minutes-of-day
const selectedDateExtent = computed<{ startMin: number; endMin: number } | null>(() => {
  if (!pendingDate.value) return null
  const entry = availableDates.value.find(d => d.date === pendingDate.value)
  if (!entry) return null
  const s = new Date(entry.start_ms)
  const e = new Date(entry.end_ms)
  return {
    startMin: s.getUTCHours() * 60 + s.getUTCMinutes(),
    endMin:   e.getUTCHours() * 60 + e.getUTCMinutes(),
  }
})

// Hours that contain at least some recorded data for the selected date
const availableHours = computed<Set<number>>(() => {
  const ext = selectedDateExtent.value
  if (!ext) return new Set()
  const hours = new Set<number>()
  for (let h = Math.floor(ext.startMin / 60); h <= Math.floor(ext.endMin / 60); h++) hours.add(h)
  return hours
})

function isHourAvailable(h: number): boolean { return availableHours.value.has(h) }

function availableMinutesFor(h: number): Set<number> {
  const ext = selectedDateExtent.value
  if (!ext) return new Set()
  const mins = new Set<number>()
  const hStart = h * 60
  const hEnd   = h * 60 + 59
  if (hEnd < ext.startMin || hStart > ext.endMin) return mins
  const from = Math.max(0,  ext.startMin - hStart)
  const to   = Math.min(59, ext.endMin   - hStart)
  for (let m = from; m <= to; m++) mins.add(m)
  return mins
}

// For the selected end date, the recorded end time in UTC minutes-of-day
const selectedEndDateExtent = computed<{ startMin: number; endMin: number } | null>(() => {
  if (!pendingEndDate.value) return null
  const entry = availableDates.value.find(d => d.date === pendingEndDate.value)
  if (!entry) return null
  const s = new Date(entry.start_ms)
  const e = new Date(entry.end_ms)
  return {
    startMin: s.getUTCHours() * 60 + s.getUTCMinutes(),
    endMin:   e.getUTCHours() * 60 + e.getUTCMinutes(),
  }
})

// Reset time fields when selected date changes; pre-fill start time from recorded data
watch(() => pendingDate.value, (iso) => {
  endHH.value = ''
  endMM.value = ''
  pendingEndDate.value = iso  // default end date to same day as start date
  if (iso) {
    const d = new Date(iso)
    endCalViewMonth.value = d.getMonth()
    endCalViewYear.value  = d.getFullYear()
  }
  const ext = selectedDateExtent.value
  if (ext) {
    startHH.value = Math.floor(ext.startMin / 60)
    startMM.value = ext.startMin % 60
  } else {
    startHH.value = ''
    startMM.value = ''
  }
})

// Pre-fill end time to latest available time on the selected end date
watch(() => pendingEndDate.value, () => {
  const ext = selectedEndDateExtent.value
  if (ext) {
    endHH.value = Math.floor(ext.endMin / 60)
    endMM.value = ext.endMin % 60
  } else {
    endHH.value = ''
    endMM.value = ''
  }
})

// ---- Custom dropdowns ----
type DdKey = 'startHH' | 'startMM' | 'endHH' | 'endMM'
const openDd     = ref<DdKey | null>(null)
const startHHWrap = ref<HTMLDivElement | null>(null)
const startMMWrap = ref<HTMLDivElement | null>(null)
const endHHWrap   = ref<HTMLDivElement | null>(null)
const endMMWrap   = ref<HTMLDivElement | null>(null)

interface DdRect { top: number; left: number; width: number }
const ddRect = ref<DdRect | null>(null)

const ddWrapMap: Record<DdKey, () => HTMLDivElement | null> = {
  startHH: () => startHHWrap.value,
  startMM: () => startMMWrap.value,
  endHH:   () => endHHWrap.value,
  endMM:   () => endMMWrap.value,
}

function toggleDd(key: DdKey): void {
  if (openDd.value === key) { openDd.value = null; ddRect.value = null; return }
  const el = ddWrapMap[key]()
  if (el) {
    const r = el.getBoundingClientRect()
    ddRect.value = { top: r.bottom, left: r.left, width: r.width }
  }
  openDd.value = key
}
function closeDd(): void { openDd.value = null; ddRect.value = null }

function _onDocClickDd(e: MouseEvent): void {
  const wraps = [startHHWrap.value, startMMWrap.value, endHHWrap.value, endMMWrap.value]
  if (wraps.every(w => !w || !w.contains(e.target as Node))) closeDd()
}

// ---- Calendar (start date) ----
const calWrap      = ref<HTMLDivElement | null>(null)
const calOpen      = ref(false)
const now          = new Date()
const calViewMonth = ref(now.getMonth())
const calViewYear  = ref(now.getFullYear())

// ---- Calendar (end date) ----
const endCalWrap      = ref<HTMLDivElement | null>(null)
const endCalOpen      = ref(false)
const endCalViewMonth = ref(now.getMonth())
const endCalViewYear  = ref(now.getFullYear())

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d} / ${m} / ${y}`
}

interface CalCell { key: string; day: number; iso: string; other: boolean; today: boolean; selected: boolean; disabled: boolean }

const calCells = computed<CalCell[]>(() => {
  const y = calViewYear.value, m = calViewMonth.value
  const first = new Date(y, m, 1)
  const startDow = (first.getDay() + 6) % 7
  const cells: CalCell[] = []
  const todayIso = toIso(new Date())
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, m, 1 - (startDow - i))
    const iso = toIso(d)
    cells.push({ key: 'p' + i, day: d.getDate(), iso, other: true, today: iso === todayIso, selected: iso === pendingDate.value, disabled: !availableDateSet.value.has(iso) })
  }
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    cells.push({ key: 'c' + d, day: d, iso, other: false, today: iso === todayIso, selected: iso === pendingDate.value, disabled: !availableDateSet.value.has(iso) })
  }
  const remaining = 42 - cells.length
  for (let i = 1; i <= remaining; i++) {
    const iso = toIso(new Date(y, m + 1, i))
    cells.push({ key: 'n' + i, day: i, iso, other: true, today: iso === todayIso, selected: iso === pendingDate.value, disabled: !availableDateSet.value.has(iso) })
  }
  return cells
})

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function calPrevMonth(): void {
  if (calViewMonth.value === 0) { calViewMonth.value = 11; calViewYear.value-- }
  else calViewMonth.value--
}
function calNextMonth(): void {
  if (calViewMonth.value === 11) { calViewMonth.value = 0; calViewYear.value++ }
  else calViewMonth.value++
}
function selectCalDate(cell: CalCell): void {
  if (cell.disabled) return
  pendingDate.value = cell.iso
  if (pendingEndDate.value && pendingEndDate.value < cell.iso) pendingEndDate.value = cell.iso
  if (cell.other) {
    const d = new Date(cell.iso)
    calViewMonth.value = d.getMonth()
    calViewYear.value  = d.getFullYear()
  }
  calOpen.value = false
}

const endCalCells = computed<CalCell[]>(() => {
  const y = endCalViewYear.value, m = endCalViewMonth.value
  const first = new Date(y, m, 1)
  const startDow = (first.getDay() + 6) % 7
  const cells: CalCell[] = []
  const todayIso = toIso(new Date())
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, m, 1 - (startDow - i))
    const iso = toIso(d)
    const beforeStart = !!pendingDate.value && iso < pendingDate.value
    cells.push({ key: 'p' + i, day: d.getDate(), iso, other: true, today: iso === todayIso, selected: iso === pendingEndDate.value, disabled: !availableDateSet.value.has(iso) || beforeStart })
  }
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const beforeStart = !!pendingDate.value && iso < pendingDate.value
    cells.push({ key: 'c' + d, day: d, iso, other: false, today: iso === todayIso, selected: iso === pendingEndDate.value, disabled: !availableDateSet.value.has(iso) || beforeStart })
  }
  const remaining = 42 - cells.length
  for (let i = 1; i <= remaining; i++) {
    const iso = toIso(new Date(y, m + 1, i))
    const beforeStart = !!pendingDate.value && iso < pendingDate.value
    cells.push({ key: 'n' + i, day: i, iso, other: true, today: iso === todayIso, selected: iso === pendingEndDate.value, disabled: !availableDateSet.value.has(iso) || beforeStart })
  }
  return cells
})

function endCalPrevMonth(): void {
  if (endCalViewMonth.value === 0) { endCalViewMonth.value = 11; endCalViewYear.value-- }
  else endCalViewMonth.value--
}
function endCalNextMonth(): void {
  if (endCalViewMonth.value === 11) { endCalViewMonth.value = 0; endCalViewYear.value++ }
  else endCalViewMonth.value++
}
function selectEndCalDate(cell: CalCell): void {
  if (cell.disabled) return
  pendingEndDate.value = cell.iso
  if (cell.other) {
    const d = new Date(cell.iso)
    endCalViewMonth.value = d.getMonth()
    endCalViewYear.value  = d.getFullYear()
  }
  endCalOpen.value = false
}

function _onDocClick(e: MouseEvent): void {
  if (calWrap.value && !calWrap.value.contains(e.target as Node)) calOpen.value = false
  if (endCalWrap.value && !endCalWrap.value.contains(e.target as Node)) endCalOpen.value = false
}

const startTotalMin = computed(() =>
  typeof startHH.value === 'number' && typeof startMM.value === 'number'
    ? startHH.value * 60 + startMM.value : null
)
const endTotalMin = computed(() =>
  typeof endHH.value === 'number' && typeof endMM.value === 'number'
    ? endHH.value * 60 + endMM.value : null
)

const isActive = computed(() => !!playbackStore.windowStartMs)

const startEpochMin = computed(() => {
  if (!pendingDate.value || startTotalMin.value === null) return null
  const base = new Date(pendingDate.value + 'T00:00:00Z').getTime()
  return base + startTotalMin.value * 60 * 1000
})

const endEpochMin = computed(() => {
  if (!pendingEndDate.value || endTotalMin.value === null) return null
  const base = new Date(pendingEndDate.value + 'T00:00:00Z').getTime()
  return base + endTotalMin.value * 60 * 1000
})

const canLoad = computed(() =>
  !!pendingDate.value &&
  !!pendingEndDate.value &&
  startEpochMin.value !== null &&
  endEpochMin.value   !== null &&
  endEpochMin.value > startEpochMin.value
)

const endTimeError = computed(() => {
  if (startEpochMin.value === null || endEpochMin.value === null) return null
  if (endEpochMin.value <= startEpochMin.value) return 'END must be after START'
  return null
})

watch(() => playbackStore.status, (s) => {
  if (s === 'idle') {
    isLoading.value = false
    calOpen.value = false
    fetchAvailableDates()
  }
  if (s !== 'loading') isLoading.value = false
})

function loadPlayback(): void {
  if (!canLoad.value) return
  isLoading.value = true
  const sh = startHH.value as number, sm = startMM.value as number
  const eh = endHH.value   as number, em = endMM.value   as number
  const startMs = new Date(`${pendingDate.value}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00Z`).getTime()
  const endMs   = new Date(`${pendingEndDate.value}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00Z`).getTime()
  playbackStore.pendingStartMs = startMs
  playbackStore.pendingEndMs   = endMs
  playbackStore.activate()
}

// ---- Timeline canvas ----
const timelineWrap   = ref<HTMLDivElement | null>(null)
const timelineCanvas = ref<HTMLCanvasElement | null>(null)
let   _hoverMs: number | null = null
let   _isDragging = false
let   _ro: ResizeObserver | null = null

const pad = (n: number) => String(n).padStart(2, '0')

function _fmtHHMM(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function _fmtDateTime(ms: number): string {
  const d = new Date(ms)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]
  return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`
}

function _fmtHMS(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function _drawTimeline(): void {
  const canvas = timelineCanvas.value
  const wrap   = timelineWrap.value
  if (!canvas || !wrap) return

  const dpr = window.devicePixelRatio || 1
  const W   = wrap.clientWidth
  const H   = wrap.clientHeight
  if (W === 0 || H === 0) return

  canvas.width  = W * dpr
  canvas.height = H * dpr
  canvas.style.width  = W + 'px'
  canvas.style.height = H + 'px'

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  const start  = playbackStore.windowStartMs!
  const end    = playbackStore.windowEndMs!
  const cursor = playbackStore.cursorMs ?? start
  const span   = end - start
  if (span <= 0) return

  const PAD_L  = 0
  const PAD_R  = 0
  const trackW = W - PAD_L - PAD_R
  const trackY = Math.round(H * 0.52)
  const tickBaseH  = 7
  const tickMinorH = 4

  const msToX = (ms: number) => PAD_L + ((ms - start) / span) * trackW
  const cursorX = msToX(cursor)

  // Track line — played
  ctx.beginPath()
  ctx.moveTo(PAD_L, trackY)
  ctx.lineTo(cursorX, trackY)
  ctx.strokeStyle = '#c8ff00'
  ctx.lineWidth = 2
  ctx.stroke()

  // Track line — future
  ctx.beginPath()
  ctx.moveTo(cursorX, trackY)
  ctx.lineTo(PAD_L + trackW, trackY)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Ticks
  const FIVE_MIN = 5  * 60 * 1000
  const THIRTY   = 30 * 60 * 1000
  const TEN_MIN  = 10 * 60 * 1000
  const tickStart = Math.ceil(start / FIVE_MIN) * FIVE_MIN
  const labelFont = "600 11px 'Barlow Condensed', 'Barlow', sans-serif"

  ctx.font = labelFont
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  for (let ts = tickStart; ts <= end; ts += FIVE_MIN) {
    const x = msToX(ts)
    const isMajor = ts % THIRTY === 0
    const isMed   = ts % TEN_MIN === 0
    const h       = isMajor ? tickBaseH : isMed ? 5 : tickMinorH
    const isPast  = ts <= cursor

    ctx.strokeStyle = isPast
      ? (isMajor ? 'rgba(200,255,0,0.7)' : 'rgba(200,255,0,0.4)')
      : (isMajor ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)')
    ctx.lineWidth = isMajor ? 1.5 : 1

    ctx.beginPath()
    ctx.moveTo(x, trackY - h)
    ctx.lineTo(x, trackY)
    ctx.stroke()

    if (isMajor) {
      ctx.fillStyle = isPast ? 'rgba(200,255,0,0.55)' : 'rgba(255,255,255,0.35)'
      ctx.fillText(_fmtHHMM(ts), x, trackY + 5)
    }
  }

  // Hover ghost
  if (_hoverMs !== null && !_isDragging) {
    const hx = msToX(_hoverMs)
    ctx.beginPath()
    ctx.moveTo(hx, trackY - 10)
    ctx.lineTo(hx, trackY + 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Cursor needle
  ctx.beginPath()
  ctx.moveTo(cursorX, 0)
  ctx.lineTo(cursorX, trackY + 2)
  ctx.strokeStyle = '#c8ff00'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Cursor diamond
  ctx.beginPath()
  ctx.moveTo(cursorX,     2)
  ctx.lineTo(cursorX + 4, 8)
  ctx.lineTo(cursorX,     14)
  ctx.lineTo(cursorX - 4, 8)
  ctx.closePath()
  ctx.fillStyle = '#c8ff00'
  ctx.fill()

  // Date + time labels
  ctx.font = "700 12px 'Barlow Condensed', 'Barlow', sans-serif"
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const dateLabelX = Math.min(Math.max(cursorX, 60), W - 100)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(_fmtDateTime(cursor), dateLabelX - 46, H * 0.22)
  ctx.fillStyle = 'rgba(200,255,0,0.9)'
  ctx.fillText(_fmtHMS(cursor) + ' UTC', dateLabelX + 54, H * 0.22)

  ctx.beginPath()
  ctx.moveTo(dateLabelX + 6, H * 0.12)
  ctx.lineTo(dateLabelX + 6, H * 0.34)
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function _xToMs(x: number): number {
  const canvas = timelineCanvas.value!
  const W      = canvas.clientWidth
  const start  = playbackStore.windowStartMs!
  const end    = playbackStore.windowEndMs!
  const frac   = Math.max(0, Math.min(1, x / W))
  return Math.round(start + frac * (end - start))
}

function onTimelineMousedown(e: MouseEvent): void {
  _isDragging = true
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  playbackStore.seek(_xToMs(e.clientX - rect.left))
  if (playbackStore.status === 'playing') playbackStore.pause()
}

function onTimelineMousemove(e: MouseEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ms   = _xToMs(e.clientX - rect.left)
  if (_isDragging) { playbackStore.seek(ms) }
  else { _hoverMs = ms }
  _drawTimeline()
}

function onTimelineMouseleave(): void {
  _hoverMs    = null
  _isDragging = false
  _drawTimeline()
}

function _onMouseup(): void { _isDragging = false }

watch([() => playbackStore.cursorMs, () => playbackStore.status, () => playbackStore.windowStartMs], () => {
  nextTick(_drawTimeline)
})

function _initResizeObserver(): void {
  if (!timelineWrap.value) return
  _ro = new ResizeObserver(() => _drawTimeline())
  _ro.observe(timelineWrap.value)
}

watch(() => playbackStore.windowStartMs, (v) => {
  if (v !== null) nextTick(() => { _initResizeObserver(); _drawTimeline() })
  else { _ro?.disconnect(); _ro = null }
})

onMounted(() => {
  window.addEventListener('mouseup', _onMouseup)
  document.addEventListener('click', _onDocClick)
  document.addEventListener('click', _onDocClickDd)
  fetchAvailableDates()
  if (playbackStore.windowStartMs !== null) {
    nextTick(() => { _initResizeObserver(); _drawTimeline() })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('mouseup', _onMouseup)
  document.removeEventListener('click', _onDocClick)
  document.removeEventListener('click', _onDocClickDd)
  _ro?.disconnect()
})
</script>

<style scoped>
#air-playback-panel {
    display: flex;
    flex-direction: column;
}

#air-playback-panel .sdr-field-label {
    color: rgba(255, 255, 255, 0.5);
}

/* ---- Locked/disabled section overlay ---- */
.apb-section--locked {
    opacity: 0.35;
    pointer-events: none;
    user-select: none;
}

/* ---- Calendar ---- */
.apb-cal-wrap {
    position: relative;
    margin-bottom: 4px;
}

.apb-date-btn {
    width: 100%;
    height: 34px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    transition: border-color 0.15s;
    user-select: none;
    outline: none;
}

.apb-date-btn--chosen {
    color: rgba(255, 255, 255, 0.75);
}

.apb-date-btn:hover,
.apb-date-btn:focus {
    border-color: rgba(200, 255, 0, 0.35);
}

.apb-date-btn svg {
    flex-shrink: 0;
    opacity: 0.3;
}

.apb-cal-popup {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 9999;
    background: #13171f;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top: none;
    padding: 10px;
    box-sizing: border-box;
    overflow-y: auto;
    max-height: 260px;
}

.apb-cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}

.apb-cal-nav {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
    transition: color 0.12s;
}

.apb-cal-nav:hover { color: #c8ff00; }

.apb-cal-month-label {
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
}

.apb-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
}

.apb-cal-dow {
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.25);
    text-align: center;
    padding-bottom: 4px;
    text-transform: uppercase;
}

.apb-cal-cell {
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    padding: 4px 0;
    text-align: center;
    transition: background 0.1s, color 0.1s;
}

.apb-cal-cell:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
}

.apb-cal-cell--other    { color: rgba(255, 255, 255, 0.2); }
.apb-cal-cell--today    { color: rgba(200, 255, 0, 0.8); }
.apb-cal-cell--sel      { background: rgba(255, 255, 255, 0.07); color: #c8ff00; }
.apb-cal-cell--disabled { color: rgba(255, 255, 255, 0.12); cursor: not-allowed; pointer-events: none; }

/* ---- Time error ---- */
.apb-time-error {
    display: block;
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: rgba(255, 80, 80, 0.85);
    margin-bottom: 4px;
    text-transform: uppercase;
}

/* ---- Time selects ---- */
.apb-time-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.apb-dd-wrap {
    flex: 1;
    position: relative;
}

.apb-time-select {
    width: 100%;
    height: 34px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    transition: border-color 0.15s;
    user-select: none;
    outline: none;
}

.apb-time-select svg {
    flex-shrink: 0;
    opacity: 0.35;
}

.apb-time-select--chosen {
    color: rgba(255, 255, 255, 0.85);
}

.apb-time-select:hover,
.apb-time-select:focus {
    border-color: rgba(200, 255, 0, 0.35);
}

.apb-dd-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 9999;
    background: #13171f;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top: none;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: none;
    box-sizing: border-box;
}

.apb-dd-list::-webkit-scrollbar { display: none; }

:global(.apb-dd-list--fixed) {
    position: fixed !important;
    z-index: 99999;
    background: #13171f;
    border: 1px solid rgba(255, 255, 255, 0.12);
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: none;
    box-sizing: border-box;
}

:global(.apb-dd-list--fixed::-webkit-scrollbar) { display: none; }

:global(.apb-dd-list--fixed .apb-dd-item) {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.65);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-align: left;
    padding: 7px 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    box-sizing: border-box;
}

:global(.apb-dd-list--fixed .apb-dd-item:hover) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
}

:global(.apb-dd-list--fixed .apb-dd-item--sel) { color: #c8ff00; }

:global(.apb-dd-list--fixed .apb-dd-item--disabled) {
    color: rgba(255, 255, 255, 0.12);
    cursor: not-allowed;
    pointer-events: none;
}

.apb-dd-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.65);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-align: left;
    padding: 7px 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    box-sizing: border-box;
}

.apb-dd-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
}

.apb-dd-item--sel {
    color: #c8ff00;
}

.apb-dd-item--disabled {
    color: rgba(255, 255, 255, 0.12);
    cursor: not-allowed;
    pointer-events: none;
}

.apb-time-colon {
    color: rgba(255, 255, 255, 0.2);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    user-select: none;
    flex-shrink: 0;
}

/* ---- Load button ---- */
.apb-load-btn {
    width: 100%;
    height: 34px;
    background: rgba(200, 255, 0, 0.06);
    border: 1px solid rgba(200, 255, 0, 0.45);
    border-radius: 2px;
    color: #c8ff00;
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    transition: background 0.15s, border-color 0.15s;
    box-sizing: border-box;
}

.apb-load-btn:hover:not(:disabled) {
    background: rgba(200, 255, 0, 0.12);
    border-color: #c8ff00;
}

.apb-load-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

/* ---- Transport ---- */
.apb-transport-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.apb-transport-btn {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.65);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, border-color 0.15s;
}

.apb-transport-btn:hover {
    color: #c8ff00;
    border-color: rgba(200, 255, 0, 0.4);
}

.apb-speed-group {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
}

.apb-speed-btn {
    height: 24px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.28);
    cursor: pointer;
    padding: 0 7px;
    font-family: 'Barlow Condensed', monospace, sans-serif;
    font-size: 11px;
    letter-spacing: 0.05em;
    transition: color 0.12s, border-color 0.12s;
}

.apb-speed-btn:hover {
    color: rgba(255, 255, 255, 0.6);
    border-color: rgba(255, 255, 255, 0.22);
}

.apb-speed-btn--active {
    color: #c8ff00;
    border-color: rgba(200, 255, 0, 0.35);
    background: rgba(200, 255, 0, 0.05);
}

/* ---- Timeline canvas ---- */
.apb-timeline-wrap {
    width: 100%;
    height: 60px;
    position: relative;
    cursor: crosshair;
}

.apb-timeline-canvas {
    display: block;
    width: 100%;
    height: 100%;
}

/* ---- Exit button ---- */
.apb-exit-btn {
    width: 100%;
    height: 34px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.25);
    font-family: var(--font-primary, 'Barlow', sans-serif);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    box-sizing: border-box;
}

.apb-exit-btn:hover {
    color: rgba(255, 70, 70, 0.9);
    border-color: rgba(255, 70, 70, 0.35);
    background: rgba(255, 70, 70, 0.05);
}

@keyframes apb-spin {
    to { transform: rotate(360deg); }
}

.apb-spin {
    animation: apb-spin 0.8s linear infinite;
}
</style>
