<template>
  <div class="sdr-recordings-search-wrap">
    <input
      v-model="recordingsFilter"
      class="sdr-recordings-search-input"
      type="text"
      aria-label="Filter recordings by notes or mode"
      placeholder="NOTES · MODE"
      autocomplete="off"
      spellcheck="false"
    />
    <BaseIconAction
      v-if="recordingsFilter"
      class="sdr-recordings-search-clear"
      accessible-name="Clear filter"
      @click="recordingsFilter = ''"
    >
      ✕
    </BaseIconAction>
  </div>
  <div class="sdr-recordings-body">
    <BaseList
      id="sdr-recordings-list-wrap"
      ref="recordingsListWrapRef"
      :is-empty="!liveRecording && filteredRecordings.length === 0"
      empty-text="No recordings."
      @scroll="updateScrollHint"
    >
      <template #empty>
        <div id="sdr-recordings-empty" class="sdr-panel-empty">No recordings.</div>
      </template>
      <!-- Live recording row -->
      <div v-if="liveRecording" class="sdr-recording-row sdr-recording-live">
        <div class="sdr-recording-content">
          <div class="sdr-recording-head">
            <div class="sdr-recording-freq">
              <span class="sdr-recording-freq-num">{{
                (liveRecording.frequency_hz / 1e6).toFixed(4)
              }}</span>
              <span class="sdr-recording-freq-unit">MHz</span>
              <span v-if="liveRecording.mode" class="sdr-recording-freq-mode"
                >- {{ liveRecording.mode }}</span
              >
            </div>
            <span class="sdr-recording-live-status">
              <span
                class="sdr-recording-live-dot"
                :class="{ 'sdr-recording-live-dot--waiting': !recSquelchOpen }"
              ></span>
              {{ recSquelchOpen ? 'Recording' : 'Waiting' }}
            </span>
          </div>
          <dl class="sdr-recording-meta">
            <div class="sdr-recording-meta-row">
              <dt>Date</dt>
              <dd>{{ liveRecording.startedAt }}</dd>
            </div>
            <div class="sdr-recording-meta-row">
              <dt>Duration</dt>
              <dd>{{ fmtDuration(liveElapsedS) }}</dd>
            </div>
            <div class="sdr-recording-meta-row">
              <dt>Size</dt>
              <dd>{{ fmtBytes(liveElapsedS * 96000) }}</dd>
            </div>
          </dl>
          <div class="sdr-recording-controls">
            <button
              class="sdr-recording-stop"
              title="Stop recording"
              aria-label="Stop recording"
              @click.stop="emit('stop-recording')"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 10 10"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
              </svg>
              STOP
            </button>
          </div>
        </div>
      </div>

      <!-- Saved recordings -->
      <div
        v-for="c in filteredRecordings"
        :key="c.id"
        class="sdr-recording-row"
        :class="{ 'sdr-recording-playing': playingRecordingId === c.id }"
      >
        <div class="sdr-recording-content">
          <!-- Title: frequency in the radio readout style (big number + small unit).
               Edit / delete stay top-right as borderless glyphs. -->
          <div class="sdr-recording-head">
            <div class="sdr-recording-freq">
              <span class="sdr-recording-freq-num">{{ recordingFreqNumber(c) }}</span>
              <span class="sdr-recording-freq-unit">MHz</span>
              <span v-if="c.mode" class="sdr-recording-freq-mode">- {{ c.mode }}</span>
            </div>
            <div class="sdr-recording-actions">
              <BaseIconAction
                class="sdr-recording-edit"
                :active="editingRecId === c.id"
                active-class="sdr-recording-edit--active"
                tooltip="Edit"
                tooltip-side="bottom"
                accessible-name="Edit"
                @click.stop="toggleEditAccordion(c)"
              >
                &#x270E;
              </BaseIconAction>
              <!-- Inline delete confirm: bin → check/cancel pair. Click bin to arm,
                   click again (✓) to confirm, ✕ to cancel. -->
              <template v-if="confirmDelId === c.id">
                <BaseIconAction
                  class="sdr-recording-del sdr-recording-del--confirm"
                  tooltip="Confirm delete"
                  tooltip-side="bottom"
                  accessible-name="Confirm delete"
                  @click.stop="confirmInlineDelete(c)"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2.5 7.5l3 3 6-7" />
                  </svg>
                </BaseIconAction>
                <BaseIconAction
                  class="sdr-recording-del sdr-recording-del--cancel"
                  tooltip="Cancel"
                  tooltip-side="bottom"
                  accessible-name="Cancel delete"
                  @click.stop="confirmDelId = null"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                  </svg>
                </BaseIconAction>
              </template>
              <BaseIconAction
                v-else
                class="sdr-recording-del"
                tooltip="Delete"
                tooltip-side="bottom"
                accessible-name="Delete"
                @click.stop="confirmDelId = c.id"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 3.5h10" />
                  <path d="M5.5 3.5V2.2a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7v1.3" />
                  <path d="M3.2 3.5l.6 8.1a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.1" />
                  <path d="M6 6v4M8 6v4" />
                </svg>
              </BaseIconAction>
            </div>
          </div>

          <!-- Custom name (if any), radio freq-name style. -->
          <div v-if="recordingCustomName(c)" class="sdr-recording-subname">
            {{ recordingCustomName(c) }}
          </div>

          <dl class="sdr-recording-meta">
            <div class="sdr-recording-meta-row">
              <dt>Date</dt>
              <dd>{{ c.started_at ? c.started_at.replace('T', ' ').slice(0, 16) : '—' }}</dd>
            </div>
            <div class="sdr-recording-meta-row">
              <dt>Duration</dt>
              <dd>{{ fmtDuration(c.duration_s || 0) }}</dd>
            </div>
            <div class="sdr-recording-meta-row">
              <dt>Size</dt>
              <dd>{{ fmtBytes(c.file_size_bytes || 0) }}</dd>
            </div>
          </dl>

          <!-- Saved note (read-only) shown when present and not editing. The
               "NOTES" caption only appears when there is note text — mirroring
               the DATE/DURATION/SIZE meta labels. -->
          <div v-if="c.notes && editingRecId !== c.id" class="sdr-recording-note">
            <div class="sdr-recording-note-label">NOTES</div>
            <div class="sdr-recording-note-text">{{ c.notes }}</div>
          </div>

          <!-- Inline edit accordion: slides open between the meta and the play
               controls. Note only — flat input, no border box. -->
          <div v-if="editingRecId === c.id" class="sdr-recording-edit-panel" @click.stop>
            <div v-if="recmodNotes.trim()" class="sdr-recording-note-label">NOTES</div>
            <!-- Function ref (not a string ref): this textarea is inside the row v-for, so a
                 string ref would be collected into an array (ref_for) and `.focus()` below
                 would throw. Matches the audio element's function-ref pattern. -->
            <textarea
              :ref="(el) => (recmodNoteRef = el as HTMLTextAreaElement | null)"
              v-model="recmodNotes"
              class="sdr-recording-edit-note"
              rows="2"
              maxlength="250"
              aria-label="Recording note"
              placeholder="Add a note…"
              @keydown.esc="closeEditAccordion"
            ></textarea>
            <div class="sdr-recording-edit-actions">
              <BaseButton
                variant="ghost"
                class="sdr-panel-btn sdr-recording-edit-cancel"
                @click.stop="closeEditAccordion"
              >
                CANCEL
              </BaseButton>
              <BaseButton
                variant="ghost"
                class="sdr-panel-btn sdr-editfreq-save-btn sdr-recording-edit-save"
                @click.stop="saveEditAccordion"
              >
                SAVE
              </BaseButton>
            </div>
          </div>

          <!-- Play + download (WAV/IQ) as pill buttons, beneath the meta. -->
          <div class="sdr-recording-controls">
            <button
              class="sdr-recording-play"
              :title="playingRecordingId === c.id ? 'Stop' : 'Play'"
              :aria-label="playingRecordingId === c.id ? 'Stop' : 'Play'"
              @click.stop="toggleRecordingPlay(c)"
            >
              <svg
                v-if="playingRecordingId !== c.id"
                width="13"
                height="13"
                viewBox="0 0 10 10"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="2,1 9,5 2,9" />
              </svg>
              <svg
                v-else
                width="13"
                height="13"
                viewBox="0 0 10 10"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="1.5" y="1.5" width="3" height="7" />
                <rect x="5.5" y="1.5" width="3" height="7" />
              </svg>
            </button>
            <button
              class="sdr-recording-export"
              title="Download WAV"
              aria-label="Download WAV"
              @click.stop="downloadRecording(c, 'wav')"
            >
              DOWNLOAD
            </button>
            <button
              v-if="c.has_iq_file"
              class="sdr-recording-iq"
              title="Download IQ"
              aria-label="Download IQ"
              @click.stop="downloadRecording(c, 'iq')"
            >
              IQ
            </button>
          </div>

          <!-- SIGNAL-style block progress bar (click to seek), shown while playing.
               Each block lights up as playback passes it; a CSS transition fades
               the colour so it animates cleanly block-by-block. -->
          <div v-if="playingRecordingId === c.id" class="sdr-recording-progress">
            <div class="sdr-recording-segments" @click.stop="seekRecordingBar" @mousedown.stop>
              <div
                v-for="i in RECORDING_PROGRESS_SEGS"
                :key="i"
                class="sdr-recording-seg"
                :class="{ 'sdr-recording-seg--on': i <= recordingLitSegs }"
              ></div>
            </div>
            <span class="sdr-recording-time"
              >{{ fmtTime(recordingCurrentTime) }} / {{ fmtTime(recordingDuration) }}</span
            >
          </div>
        </div>
        <audio
          :ref="(el) => setRecordingAudioRef(c.id, el as HTMLAudioElement | null)"
          :src="`/api/sdr/recordings/${c.id}/file`"
          style="display: none"
          @loadedmetadata="onAudioMeta(c.id)"
          @timeupdate="onAudioTimeUpdate(c.id)"
          @ended="onAudioEnded(c.id)"
        ></audio>
      </div>
    </BaseList>
    <div id="sdr-recordings-scroll-hint" ref="scrollHintRef" style="display: none">
      MORE
      <ScrollHintChevronIcon id="sdr-recordings-scroll-arrow" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import ScrollHintChevronIcon from '@/components/shared/ScrollHintChevronIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import BaseList from '@/components/base/BaseList.vue'

interface SdrRecording {
  id: number
  name: string
  notes: string
  frequency_hz: number
  mode: string
  duration_s: number
  file_size_bytes: number
  started_at: string
  has_iq_file: boolean
  radio_id: number | null
  radio_name: string
}

interface LiveRecording {
  frequency_hz: number
  mode: string
  startedAt: string
}

const _props = defineProps<{
  liveRecording: LiveRecording | null
  recSquelchOpen: boolean
  liveElapsedS: number
}>()

const emit = defineEmits<{
  (e: 'stop-recording'): void
  // Fired whenever a recording starts/stops playing so the parent can mute the live
  // SDR audio during playback (signal/waterfall/spectrum keep running).
  (e: 'playback-active', active: boolean): void
}>()

// ── Recordings state ───────────────────────────────────────────────────────────────

const recordings = ref<SdrRecording[]>([])
const recordingsFilter = ref('')
const filteredRecordings = computed(() => {
  const q = recordingsFilter.value.toLowerCase()
  if (!q) return recordings.value
  return recordings.value.filter(
    (c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q) ||
      (c.radio_name || '').toLowerCase().includes(q) ||
      (c.mode || '').toLowerCase().includes(q),
  )
})

const playingRecordingId = ref<number | null>(null)
const recordingCurrentTime = ref(0)
const recordingDuration = ref(0)
const recordingAudioRefs = new Map<number, HTMLAudioElement>()
const recordingProgressPct = computed(() =>
  recordingDuration.value > 0
    ? Math.min(100, Math.max(0, (recordingCurrentTime.value / recordingDuration.value) * 100))
    : 0,
)

// How many of the RECORDING_PROGRESS_SEGS blocks are lit for the current position.
const recordingLitSegs = computed(() =>
  Math.round((recordingProgressPct.value / 100) * RECORDING_PROGRESS_SEGS),
)

// Mute live SDR audio while any recording is playing; unmute when nothing plays.
watch(playingRecordingId, (id, prev) => {
  if ((id !== null) !== (prev !== null)) emit('playback-active', id !== null)
})

// A BaseList component ref — the scroll-hint below reads its exposed
// `scrollContainer` (the list's root scrolling element) rather than owning its
// own div ref, per the convention documented on BaseList.
const recordingsListWrapRef = ref<InstanceType<typeof BaseList> | null>(null)
const scrollHintRef = ref<HTMLElement | null>(null)

// ── Inline edit accordion state ───────────────────────────────────────────────
// editingRecId is the recording whose edit panel is expanded (null = none open).

// recmodName holds the recording's existing name unchanged — the accordion only edits
// the note, but the PATCH endpoint requires a name, so we round-trip it.
const recmodName = ref('')
const recmodNotes = ref('')
const recmodNoteRef = ref<HTMLTextAreaElement | null>(null)
const editingRecId = ref<number | null>(null)

// ── Inline delete confirm ─────────────────────────────────────────────────────
// The recording whose bin icon is "armed" — swaps it for a ✓ / ✕ pair until confirmed.
const confirmDelId = ref<number | null>(null)

// Number of blocks in the SIGNAL-style progress bar (matches the radio meter feel).
const RECORDING_PROGRESS_SEGS = 28

// ── Helpers ───────────────────────────────────────────────────────────────────

// The title is always the frequency in the big radio readout style. The numeric
// part and the "MHz" unit are split so they can be sized differently, mirroring
// .sdr-freq-input-large + .sdr-freq-unit.
function recordingFreqNumber(c: SdrRecording): string {
  return c.frequency_hz ? (c.frequency_hz / 1e6).toFixed(4) : '—'
}

// A custom, user-given name (if any) shown as a small sub-line under the freq.
// Strip any legacy auto-generated "Recording <date>" / "YYYY-MM-DD HH:MM ·" or a
// bare "<freq> MHz · MODE" so we only surface a real, meaningful name.
function recordingCustomName(c: SdrRecording): string {
  const stripped = (c.name || '')
    .replace(/^Recording\s+/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?:\s*·\s*)?/, '')
    .replace(/^\d+(?:\.\d+)?\s*MHz(?:\s*·\s*[A-Z]+)?$/i, '')
    .trim()
  return stripped
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60),
    sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60)
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
}

// ── Recording loading ──────────────────────────────────────────────────────────────

async function reload(): Promise<void> {
  try {
    const res = await fetch('/api/sdr/recordings', { cache: 'no-store' })
    if (res.ok) recordings.value = await res.json()
  } catch (_) {}
  nextTick(updateScrollHint)
}

// ── Recording playback ─────────────────────────────────────────────────────────────

function setRecordingAudioRef(id: number, el: HTMLAudioElement | null): void {
  if (el) recordingAudioRefs.set(id, el)
  else recordingAudioRefs.delete(id)
}

function toggleRecordingPlay(c: SdrRecording): void {
  const a = recordingAudioRefs.get(c.id)
  /* v8 ignore start -- defensive: every saved row renders its own <audio> whose function ref
     registers it, so the element is always present for a row whose play button can be clicked. */
  if (!a) return
  /* v8 ignore stop */
  if (playingRecordingId.value === c.id) {
    a.pause()
    a.currentTime = 0
    playingRecordingId.value = null
  } else {
    if (playingRecordingId.value !== null) {
      const prev = recordingAudioRefs.get(playingRecordingId.value)
      /* v8 ignore start -- defensive: the previously-playing id always has its <audio>
         registered in the ref map. */
      if (prev) {
        prev.pause()
        prev.currentTime = 0
      }
      /* v8 ignore stop */
    }
    playingRecordingId.value = c.id
    recordingCurrentTime.value = 0
    // Seed duration from metadata if already loaded, else fall back to the
    // recorded duration_s so the end time is populated immediately.
    recordingDuration.value = isFiniteDuration(a.duration) ? a.duration : c.duration_s || 0
    a.play()
  }
}

function isFiniteDuration(d: number): boolean {
  return Number.isFinite(d) && d > 0
}

function onAudioMeta(id: number): void {
  const a = recordingAudioRefs.get(id)
  /* v8 ignore start -- defensive: the event fires from the row's own registered <audio>. */
  if (!a) return
  /* v8 ignore stop */
  if (playingRecordingId.value === id && isFiniteDuration(a.duration))
    recordingDuration.value = a.duration
}

function onAudioTimeUpdate(id: number): void {
  if (playingRecordingId.value !== id) return
  const a = recordingAudioRefs.get(id)
  /* v8 ignore start -- defensive: the event fires from the row's own registered <audio>. */
  if (!a) return
  /* v8 ignore stop */
  recordingCurrentTime.value = a.currentTime
  // Streamed WAVs may only expose a finite duration once playback begins.
  if (isFiniteDuration(a.duration) && a.duration !== recordingDuration.value)
    recordingDuration.value = a.duration
}

function onAudioEnded(id: number): void {
  if (playingRecordingId.value === id) {
    playingRecordingId.value = null
    recordingCurrentTime.value = 0
  }
}

// Click anywhere on the block bar to seek to that fraction of the recording.
function seekRecordingBar(e: MouseEvent): void {
  if (playingRecordingId.value === null || recordingDuration.value <= 0) return
  const a = recordingAudioRefs.get(playingRecordingId.value)
  /* v8 ignore start -- defensive: the seek bar only renders for the playing row, whose
     <audio> is registered. */
  if (!a) return
  /* v8 ignore stop */
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  a.currentTime = frac * recordingDuration.value
}

function downloadRecording(c: SdrRecording, type: 'wav' | 'iq'): void {
  const a = document.createElement('a')
  a.href = type === 'wav' ? `/api/sdr/recordings/${c.id}/file` : `/api/sdr/recordings/${c.id}/iq`
  a.download = `${c.name}.${type === 'wav' ? 'wav' : 'u8'}`
  a.click()
}

// ── Scroll hint ───────────────────────────────────────────────────────────────

function updateScrollHint(): void {
  const wrap = recordingsListWrapRef.value?.scrollContainer
  const hint = scrollHintRef.value
  /* v8 ignore start -- defensive: both elements are always present in the template (not
     behind a v-if), so the refs are set whenever this runs. */
  if (!wrap || !hint) return
  /* v8 ignore stop */
  const hasOverflow = wrap.scrollHeight > wrap.clientHeight + 2
  const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4
  hint.style.display = hasOverflow && !atBottom ? 'flex' : 'none'
}

// ── Inline edit accordion ─────────────────────────────────────────────────────

// Toggle the edit panel for a recording. Opening seeds the inputs from the recording and
// closes any other open panel; clicking the pencil again collapses it.
function toggleEditAccordion(c: SdrRecording): void {
  if (editingRecId.value === c.id) {
    closeEditAccordion()
    return
  }
  editingRecId.value = c.id
  recmodName.value = c.name || ''
  recmodNotes.value = c.notes || ''
  nextTick(() => recmodNoteRef.value?.focus())
}

function closeEditAccordion(): void {
  editingRecId.value = null
}

async function saveEditAccordion(): Promise<void> {
  const name = recmodName.value.trim()
  if (!name) return
  /* v8 ignore start -- editingRecId is non-null whenever the SAVE button (its only caller)
     is rendered; this guard exists to narrow the type for the request URL below. */
  if (editingRecId.value === null) return
  /* v8 ignore stop */
  try {
    await fetch(`/api/sdr/recordings/${editingRecId.value}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, notes: recmodNotes.value.trim() }),
    })
    closeEditAccordion()
    await reload()
  } catch (_) {}
}

// ── Delete recording ──────────────────────────────────────────────────────────

// Inline confirm: the bin was armed and the ✓ was clicked.
async function confirmInlineDelete(c: SdrRecording): Promise<void> {
  confirmDelId.value = null
  try {
    await fetch(`/api/sdr/recordings/${c.id}`, { method: 'DELETE' })
    await reload()
  } catch (_) {}
}

// Expose reload so SdrPanel can trigger refresh after recording stops
defineExpose({ reload })
</script>

<!-- Unscoped on purpose (B10 CSS co-location): the recordings family
     moved here verbatim from SdrPanel.css, preserving intra-family order
     (base -> :hover -> modifier rules). `scoped` would add [data-v]
     attribute selectors and RAISE specificity over the original global
     rules. Loaded after SdrPanel.css (component modules import after
     SdrPanel.vue's leading CSS import). The @keyframes sdr-rec-pulse
     referenced by the live dots stays in SdrPanel.css (keyframes are
     global by name; the transport REC button shares them), as do the
     :has() pane-layout rules that only probe .sdr-recordings-body. -->
<style>
.sdr-recordings-search-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  /* Match the height of the SEARCH rail tab button (.msb-rail-btn). */
  height: 40px;
  flex: 0 0 auto;
  padding: 0 20px 0 24px;
  background: var(--color-search-field-bg);
  box-sizing: border-box;
  transition: background 0.12s;
}

/* Drop the green a11y focus ring (assets/a11y.css :focus-visible); the input row
   keeps its own fill on focus. The accent text caret is the visible focus cue
   for this text field (WCAG 2.4.7). */
.sdr-recordings-search-input:focus-visible {
  outline: none !important;
}

/* The search box stays pinned; only the list below it scrolls — matching the
   other list side panels (e.g. the Frequency Manager). */
.sdr-recordings-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sdr-recordings-search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: #fff;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  caret-color: var(--color-accent);
  min-width: 0;
  padding: 0;
}

.sdr-recordings-search-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
  font-size: 11px;
  letter-spacing: 0.14em;
}

.sdr-recordings-search-clear {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.3);
  font-family: 'Barlow', sans-serif;
  font-size: 10px;
  font-weight: 700;
  padding: 0;
  margin-right: 6px;
  transition: color 0.15s;
  flex-shrink: 0;
}

.sdr-recordings-search-clear:hover {
  color: var(--color-text-muted);
}

#sdr-recordings-empty {
  padding-top: 12px;
}

#sdr-recordings-list-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 14px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

#sdr-recordings-list-wrap::-webkit-scrollbar {
  display: none;
}

#sdr-recordings-list {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 480px;
  scrollbar-width: none;
}

#sdr-recordings-list::-webkit-scrollbar {
  display: none;
}

#sdr-recordings-scroll-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  color: rgba(255, 255, 255, 0.3);
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 0.2s ease,
    visibility 0.2s ease;
  pointer-events: none;
}

#sdr-recordings-scroll-arrow {
  display: inline-block;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

/* Recording rows adopt the radio styling: a large Barlow-Condensed frequency readout
   (mirroring .sdr-freq-input-large), a small uppercase name/mode sub-line, the
   Date/Duration/Size meta, and — while playing — a SIGNAL-style block bar that
   lights up to show position (click anywhere on it to seek). */
.sdr-recording-row {
  display: flex;
  flex-direction: column;
  transition: background 0.12s;
}

.sdr-recording-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

/* Subtle highlight on the whole row while playing. */
.sdr-recording-playing {
  background: rgba(200, 255, 0, 0.04);
}

.sdr-recording-content {
  display: flex;
  flex-direction: column;
  padding: 10px 20px 10px 24px;
  min-width: 0;
}

/* Title row: large frequency readout on the left, action glyphs on the right. */
.sdr-recording-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sdr-recording-freq {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

/* Mirrors .sdr-freq-input-large — the radio's big frequency readout. */
.sdr-recording-freq-num {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 26px;
  font-weight: 300;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mirrors .sdr-freq-unit. */
.sdr-recording-freq-unit {
  flex-shrink: 0;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 14px;
  font-weight: 300;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.6);
}

/* Mode (USB/AM/…) inline after the unit, separated by a dash. */
.sdr-recording-freq-mode {
  flex-shrink: 0;
  margin-left: 5px;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

/* Custom name under the freq, mirroring .sdr-freq-name. */
.sdr-recording-subname {
  margin-top: 3px;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Labelled metadata rows: Date / Duration / Size. */
.sdr-recording-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0 0;
}

.sdr-recording-meta-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.08em;
}

.sdr-recording-meta-row dt {
  width: 64px;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  flex-shrink: 0;
}

.sdr-recording-meta-row dd {
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

/* Saved note (read-only), shown under the meta when present. The "NOTES"
   caption matches the DATE/DURATION/SIZE meta labels. */
.sdr-recording-note {
  margin-top: 12px;
}

.sdr-recording-note-label {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 5px;
}

/* Read-only note: clamp to 2 lines, then ellipsis. */
.sdr-recording-note-text {
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 11px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.55);
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

/* Pencil turns accent while its edit accordion is open. */
.sdr-recording-edit--active {
  color: rgba(200, 255, 0, 0.85);
}

/* ── Inline edit accordion (note only) ── */
.sdr-recording-edit-panel {
  display: flex;
  flex-direction: column;
  margin-top: 12px;
}

/* Flat note input — no box/border, just an underline that brightens on focus. */
.sdr-recording-edit-note {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  /* Exactly two lines (2 × 1.45em line-height) + the 4px top/bottom padding.
       overflow:hidden removes the scrollbar; content past 2 lines scrolls
       internally as you type but is never shown with a scrollbar. */
  height: calc(2 * 1.45em + 8px);
  overflow: hidden;
  background: none;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0;
  padding: 4px 0;
  outline: none;
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 11px;
  line-height: 1.45;
  transition: border-color 0.15s;
}

.sdr-recording-edit-note:focus {
  border-bottom-color: rgba(200, 255, 0, 0.5);
}

.sdr-recording-edit-note::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

.sdr-recording-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

/* ── SIGNAL-style block progress bar (click to seek) ── */
.sdr-recording-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.sdr-recording-segments {
  display: flex;
  gap: 3px;
  flex: 1;
  height: 10px;
  cursor: pointer;
}

/* Each block lights up as playback reaches it; the colour transition fades it
   in cleanly so the bar animates block-by-block. */
.sdr-recording-seg {
  flex: 1;
  height: 100%;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.08);
  transition: background 0.15s ease;
}

.sdr-recording-seg--on {
  background: #c8ff00;
}

.sdr-recording-time {
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Edit / delete sit inline on the right of the title, borderless glyphs. */
.sdr-recording-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.sdr-recording-edit,
.sdr-recording-del {
  position: relative;
  background: none;
  border: none;
  outline: none;
  cursor: pointer;
  padding: 0 2px;
  color: rgba(255, 255, 255, 0.35);
  transition: color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
  /* WCAG 2.5.8 Target Size (AA): keep a ≥24×24px hit area. The glyph stays the
     same visual size — the extra is transparent, centred padding. */
  min-width: 24px;
  min-height: 24px;
}

/* Flat dark tooltip — matches .sdr-rail-btn / #radio-mini-btn. Drops below the
   button (the actions sit at the top of each recording row). The pill itself
   comes from BaseIconAction (tooltipSide="bottom"); these custom properties
   restyle its default black pill to this family's flat-navy look. */
.sdr-recording-edit,
.sdr-recording-del {
  --ba-icon-action-tooltip-offset: 8px;
  --ba-icon-action-tooltip-bg: rgba(10, 13, 20, 0.96);
  --ba-icon-action-tooltip-color: #fff;
  --ba-icon-action-tooltip-font: var(--font-primary, 'Barlow', sans-serif);
  --ba-icon-action-tooltip-padding: 0 10px;
  --ba-icon-action-tooltip-height: 24px;
  --ba-icon-action-tooltip-radius: 3px;
  --ba-icon-action-tooltip-z: 10001;
}

.sdr-recording-edit {
  font-size: 15px;
}

.sdr-recording-edit:hover {
  color: rgba(200, 255, 0, 0.85);
}

.sdr-recording-del {
  font-size: 14px;
}

.sdr-recording-del:hover {
  color: rgba(255, 80, 80, 0.85);
}

/* Inline delete confirm: armed ✓ reads as a "go" colour, ✕ stays neutral/red. */
.sdr-recording-del--confirm {
  color: rgba(200, 255, 0, 0.85);
}
.sdr-recording-del--confirm:hover {
  color: rgba(200, 255, 0, 1);
}
.sdr-recording-del--cancel {
  color: rgba(255, 255, 255, 0.45);
}
.sdr-recording-del--cancel:hover {
  color: rgba(255, 80, 80, 0.85);
}

/* Play + download pill row beneath the meta. Buttons match the radio controls
   (.sdr-mode-pill): a dark background that brightens on hover, accent tints. */
.sdr-recording-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
}

.sdr-recording-play,
.sdr-recording-export,
.sdr-recording-iq,
.sdr-recording-stop {
  height: 28px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
  transition:
    background 0.15s,
    color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* Stop recording — red pill with a square glyph + STOP label. */
.sdr-recording-stop {
  gap: 7px;
  padding: 0 14px;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 80, 80, 0.85);
}

.sdr-recording-stop svg {
  display: block;
}

.sdr-recording-stop:hover {
  background: rgba(255, 80, 80, 0.15);
  color: #ff5050;
}

.sdr-recording-play {
  width: 40px;
  padding: 0;
}

.sdr-recording-play svg {
  display: block;
}

/* Download is a text pill ("DOWNLOAD"), no icon. Sized to match the FM/USB/LSB
   mode pills (9px). */
.sdr-recording-export {
  padding: 0 14px;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.sdr-recording-export:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

/* Play button carries the accent tint, like the radio's tune button. */
.sdr-recording-play {
  color: rgba(200, 255, 0, 0.75);
}

.sdr-recording-play:hover {
  background: rgba(200, 255, 0, 0.15);
  color: #c8ff00;
}

.sdr-recording-playing .sdr-recording-play {
  background: rgba(200, 255, 0, 0.12);
  color: #c8ff00;
}

.sdr-recording-iq {
  padding: 0 12px;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(100, 180, 255, 0.75);
}

.sdr-recording-iq:hover {
  background: rgba(100, 180, 255, 0.15);
  color: rgba(100, 180, 255, 0.95);
}

/* ── Live recording row ── */

/* "Recording" / "Waiting" status pill on the right of the freq title. */
.sdr-recording-live-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-family: 'Barlow Condensed', 'Barlow', sans-serif;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.65);
}

.sdr-recording-live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c8ff00;
  flex-shrink: 0;
  animation: sdr-rec-pulse 1.2s ease-in-out infinite;
}

.sdr-recording-live-dot--waiting {
  background: #ffb300;
  animation: sdr-rec-pulse 2s ease-in-out infinite;
}
</style>
