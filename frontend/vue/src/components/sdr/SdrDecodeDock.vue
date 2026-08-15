<template>
  <section
    class="sdr-decode-dock"
    :class="{
      'panel-closed': !panelOpen,
      'not-playing': !store.playing && !store.aprsEnabled,
      'aprs-mode': isAprs,
    }"
    aria-label="Decoder output"
  >
    <!-- Voice/DMR shows two columns (raw dsd-fme log + decoded calls) side by
         side. APRS drops the separate raw-log column and its sync indicator (a
         packet mode has no "sync") — the raw packet is a column in the table
         instead — so its single table column fills the dock. -->
    <div class="sdr-decode-dock-columns">
      <!-- ── Column: raw decoder logs (verbatim dsd-fme output) — voice only ──── -->
      <section v-if="!isAprs" class="sdr-decode-dock-column" aria-label="Decoder logs">
        <div class="sdr-decode-dock-column-header">
          <!-- aria-live announces sync / decoder-reachability changes without
               re-reading the whole log on every new line. -->
          <p class="sdr-decode-status" aria-live="polite">
            <span class="sdr-decode-dot" :class="statusClass" aria-hidden="true"></span>
            {{ statusText }}
          </p>
        </div>

        <div ref="logsBody" class="sdr-decode-dock-body">
          <!-- aria-live off: the control channel emits many lines per second, so
               announcing each would flood a screen reader — read on demand instead. -->
          <div
            class="sdr-decode-logs"
            role="log"
            aria-live="off"
            aria-label="Raw decoder log, newest last"
          >
            <p v-if="logRows.length === 0" class="sdr-decode-empty">No logs to display.</p>
            <ol v-else class="sdr-decode-log-list">
              <li
                v-for="(row, index) in logRows"
                :key="index"
                class="sdr-decode-log-line"
                :class="{ 'sdr-decode-log-line--error': row.isError }"
              >
                <span v-if="row.isError" class="sdr-sr-only">Error: </span>{{ row.line }}
              </li>
            </ol>
          </div>
        </div>

        <!-- Floated to the column's top-right (aligned with the status row), but
             kept last in the DOM so it follows the log content in reading order. -->
        <BaseIconAction
          v-if="logRows.length > 0"
          class="sdr-decode-clear"
          tooltip="Clear"
          tooltip-side="left"
          accessible-name="Clear"
          @click="store.clearDecodeLogs()"
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
      </section>

      <!-- ── Column: decoded messages (structured call rows) ────────────────── -->
      <section class="sdr-decode-dock-column" aria-label="Decoded messages">
        <!-- No header band here: the table's heading row stands in for it (its
             padding reproduces the logs header geometry, so the headings line up
             with the "Synced…" status row — see .sdr-decode-table thead th). -->
        <div ref="messagesBody" class="sdr-decode-dock-body">
          <!-- The structured column shows decoded digital-voice CALLS or decoded
               APRS PACKETS depending on which decoder is active for the viewed
               radio (store.decodeStreamKind). The table shell, scroll behaviour,
               and Clear button are shared; only the columns differ. -->
          <table v-if="isAprs" class="sdr-decode-table sdr-decode-table--aprs">
            <caption class="sdr-sr-only">
              Decoded APRS packets, newest last
            </caption>
            <thead v-if="events.length > 0">
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Callsign</th>
                <th scope="col">Symbol</th>
                <th scope="col">Latitude</th>
                <th scope="col">Longitude</th>
                <th scope="col">Course</th>
                <th scope="col">Speed</th>
                <th scope="col">Altitude</th>
                <th scope="col">Path</th>
                <th scope="col">Comment</th>
                <th scope="col">Raw</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="events.length === 0">
                <td class="sdr-decode-empty" colspan="11">No packets to display.</td>
              </tr>
              <tr v-for="(event, index) in events" :key="`${event.ts}-${index}`">
                <td>{{ formatTime(event.ts) }}</td>
                <td>{{ event.from ?? '—' }}</td>
                <td>
                  <SdrAprsSymbol v-if="event.symbol" :symbol="event.symbol" />
                  <span v-else>—</span>
                </td>
                <td>{{ formatCoord(event.latitude) }}</td>
                <td>{{ formatCoord(event.longitude) }}</td>
                <td>{{ formatMeasure(event.course, '°') }}</td>
                <td>{{ formatMeasure(event.speed, ' kn') }}</td>
                <td>{{ formatMeasure(event.altitude, ' ft') }}</td>
                <td>{{ event.path ?? '—' }}</td>
                <td class="sdr-decode-cell--wrap">{{ event.comment ?? '—' }}</td>
                <td class="sdr-decode-cell--raw">{{ event.raw ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <table v-else class="sdr-decode-table">
            <caption class="sdr-sr-only">
              Decoded digital calls, newest last
            </caption>
            <!-- Headings show only when there are messages. When empty the thead
                 is hidden and the placeholder is padded down on its own (see
                 .sdr-decode-table .sdr-decode-empty) so it still lines up with
                 the logs column's first line. -->
            <thead v-if="events.length > 0">
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Mode</th>
                <th scope="col">Talkgroup</th>
                <th scope="col">Source ID</th>
                <th scope="col">CC</th>
                <th scope="col">Sync</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="events.length === 0">
                <td class="sdr-decode-empty" colspan="6">No messages to display.</td>
              </tr>
              <tr v-for="(event, index) in events" :key="`${event.ts}-${index}`">
                <td>{{ formatTime(event.ts) }}</td>
                <td>{{ event.mode ?? '—' }}</td>
                <td>{{ event.talkgroup ?? '—' }}</td>
                <td>{{ event.source ?? '—' }}</td>
                <td>{{ event.color_code ?? '—' }}</td>
                <td>{{ syncLabel(event) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Floated to the column's top-right (aligned with the status row), but
             kept last in the DOM so it follows the message content in reading
             order. It sits in the empty right edge of the SYNC column, clear of
             the left-aligned heading text. -->
        <BaseIconAction
          v-if="events.length > 0"
          class="sdr-decode-clear"
          tooltip="Clear"
          tooltip-side="left"
          accessible-name="Clear"
          @click="store.clearDecodeEvents()"
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
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import SdrAprsSymbol from '@/components/sdr/SdrAprsSymbol.vue'
import { useSdrStore } from '@/stores/sdr'
import type { DecodeEvent } from '@/stores/sdr'

const store = useSdrStore()

// The store buffers newest-first (so the cap drops the oldest); the UI shows
// newest LAST, so reverse a copy for display and keep the latest row pinned at
// the bottom (see the scroll-to-bottom watchers).
const events = computed<DecodeEvent[]>(() => [...store.decodeEvents].reverse())

// dsd-fme flags decode problems with these tokens (e.g. "DCH (CRC ERR)",
// "Sync: no sync"). Lines matching any are rendered red. Word-boundaried so
// "err" only matches as a standalone token, not inside unrelated words.
const ERROR_LOG_PATTERN =
  /\b(?:err|error|errors|fail|failed|failure|no sync|sync lost|invalid|timeout|unable|cannot)\b/i
const logRows = computed(() =>
  store.decodeLogs.map((line) => ({ line, isError: ERROR_LOG_PATTERN.test(line) })).reverse(),
)

// Scrollable bodies for each column; after new rows arrive we pin both to the
// bottom so the most recent entry is always visible (newest-last ordering).
const messagesBody = ref<HTMLElement | null>(null)
const logsBody = ref<HTMLElement | null>(null)
function scrollToBottom(element: HTMLElement | null): void {
  /* v8 ignore start -- template refs are always bound when this runs; the null
     guard is purely defensive */
  if (!element) return
  /* v8 ignore stop */
  element.scrollTop = element.scrollHeight
}
watch(events, () => nextTick(() => scrollToBottom(messagesBody.value)))
watch(logRows, () => nextTick(() => scrollToBottom(logsBody.value)))

// Live status, derived from reachability first then sync. Stated as text (not
// colour alone) so it is meaningful without seeing the dot.
const statusText = computed(() => {
  if (!store.decoderReachable) return 'Decoder offline'
  return store.decodeSync ? 'Synced — decoding' : 'No sync'
})
const statusClass = computed(() => {
  if (!store.decoderReachable) return 'sdr-decode-dot--offline'
  return store.decodeSync ? 'sdr-decode-dot--synced' : 'sdr-decode-dot--idle'
})

// Whether the structured column is showing APRS packets (vs voice calls).
const isAprs = computed(() => store.decodeStreamKind === 'aprs')

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour12: false })
}

// A decimal coordinate to 4 dp (≈ 11 m), or an em-dash when a packet carries no
// position (status/message/telemetry frames).
function formatCoord(value: number | undefined): string {
  return typeof value === 'number' ? value.toFixed(4) : '—'
}

// A rounded numeric measurement with a unit suffix (course/speed/altitude), or an
// em-dash when the field is absent. 0 is a real value (e.g. course due north).
function formatMeasure(value: number | undefined, suffix: string): string {
  return typeof value === 'number' ? `${Math.round(value)}${suffix}` : '—'
}
function syncLabel(event: DecodeEvent): string {
  if (event.sync === true) return 'Yes'
  if (event.sync === false) return 'No'
  return '—'
}

// Track the SDR side panel open/closed state so the dock's left edge lines up
// with the waterfall (mirrors SdrWaterfall's own tracking).
function readSidebarOpen(): boolean {
  try {
    return sessionStorage.getItem('sentinel_sidebar_open') === '1'
  } catch {
    /* v8 ignore next -- sessionStorage only throws in locked-down privacy modes */
    return false
  }
}
const panelOpen = ref<boolean>(readSidebarOpen())
function onSidebarState(domEvent: Event) {
  panelOpen.value = !!(domEvent as CustomEvent<{ open: boolean }>).detail?.open
}
onMounted(() => {
  document.addEventListener('sentinel:sidebar-state', onSidebarState)
  // Start pinned to the most recent entry in each column.
  scrollToBottom(messagesBody.value)
  scrollToBottom(logsBody.value)
})
onUnmounted(() => document.removeEventListener('sentinel:sidebar-state', onSidebarState))
</script>

<style scoped>
/* Fixed strip docked at the bottom of the SDR page, below the waterfall. Its
   height (--sdr-dock-height, defined on #sdr-page) is ~1/3 of the waterfall's
   height; the waterfall raises its own bottom by the same amount when open. The
   left edge follows the side panel (430px open / 44px tab-rail closed).

   The boxes are inset to line up with the waterfall DISPLAY (the sigplot data
   box), not the waterfall element. The insets are published live by
   #sdr-waterfall (syncBandInset → :root CSS vars); fallbacks are the default
   sigplot margins:
   - left: the spectrum's dB-axis gutter (sigplot _Mx.l, ~56px).
   - right: the freq-label gutter (sigplot, ~12px) plus the 44px slider-control
     column (#sdr-waterfall padding-right). */
.sdr-decode-dock {
  position: fixed;
  left: 430px;
  right: 0;
  bottom: var(--footer-height);
  height: var(--sdr-dock-height);
  transition: left 0.2s ease;
  display: flex;
  flex-direction: column;
  background: #0a0d14;
  padding-left: var(--sdr-wf-inset-left, 56px);
  padding-right: calc(44px + var(--sdr-wf-inset-right, 12px));
  /* Gap between the last decode row and the footer bar below, so the rows don't
     sit flush against the footer. */
  padding-bottom: 0.75rem;
  box-sizing: border-box;
  z-index: 2;
}

.sdr-decode-dock.panel-closed {
  left: 44px;
}

/* Disabled / dulled state — matches the spectrum + waterfall while the radio is
   not tuned (store.playing is false). The decoder boxes grey back and stop
   accepting interaction so it's clear no decode is running yet. */
.sdr-decode-dock.not-playing .sdr-decode-dock-columns {
  opacity: 0.35;
  filter: grayscale(0.6);
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    filter 0.2s ease;
}

/* The two panels sit side by side, each filling half the dock width and
   scrolling independently. */
.sdr-decode-dock-columns {
  flex: 1;
  min-height: 0;
  display: flex;
}

.sdr-decode-dock-column {
  position: relative;
  flex: 1 1 50%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* APRS mode drops the separate raw-log column (the raw packet is a table column
   instead), so its single packet table fills the whole dock width. Voice mode
   keeps the balanced 50/50 two-column split. */
.sdr-decode-dock.aprs-mode .sdr-decode-dock-column {
  flex: 1 1 100%;
}

/* Header carries the logs column's sync status. The messages column has no
   header band — its table heading row stands in for it (see thead padding), so
   the two columns' top rows line up. No borders — the boxes are free of
   horizontal/vertical rules. */
.sdr-decode-dock-column-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 1.6rem;
  padding: 0.3rem 0.45rem;
  /* Spacing sits below the header (outside the scrolling body) so the gap
     between the status row and the first log line holds even when the body has
     scrolled to the bottom. */
  margin-bottom: 0.75rem;
  flex: none;
}

/* Status text ("No sync" / "Synced — decoding") matches the case and font of the
   column-heading labels: 9px Barlow, weight 400, 0.18em tracking, uppercase. */
.sdr-decode-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #cfd6dd;
}

.sdr-decode-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  flex: none;
}

.sdr-decode-dot--offline {
  background: #6b7480;
}
.sdr-decode-dot--idle {
  background: #e0a23c;
}
.sdr-decode-dot--synced {
  background: #5ad17a;
}

/* Borderless transparent trash/bin icon button with a styled "Clear" tooltip
   (data-tooltip) shown to the LEFT of the button. Floated to the column's
   top-right, vertically centred on the status row (its ~24px box centred on the
   status text's ~1.1rem centre → top 0.35rem). Still a positioned ancestor for
   the tooltip's absolute ::before. */
.sdr-decode-clear {
  position: absolute;
  top: 0.35rem;
  /* Inset from the column's right edge so the logs bin clears the messages
     column's "TIME" heading next to it (the columns butt together at the 50%
     line); also keeps the messages bin off the far edge. */
  right: 0.75rem;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  width: 24px;
  height: 24px;
  padding: 0;
  cursor: pointer;
  flex: none;
  transition: color 0.15s;
}

.sdr-decode-clear:hover {
  color: #fff;
}

/* The "Clear" tooltip pill itself comes from BaseIconAction
   (tooltipSide="left"); these custom properties restyle its default black
   pill to this family's flat-navy look. */
.sdr-decode-clear {
  --ba-icon-action-tooltip-offset: 8px;
  --ba-icon-action-tooltip-bg: rgba(10, 13, 20, 0.96);
  --ba-icon-action-tooltip-color: #fff;
  --ba-icon-action-tooltip-font: var(--font-primary, 'Barlow', sans-serif);
  --ba-icon-action-tooltip-padding: 0 10px;
  --ba-icon-action-tooltip-height: 24px;
  --ba-icon-action-tooltip-radius: 3px;
  --ba-icon-action-tooltip-z: 10001;
}

/* Each tab panel fills the remaining dock height and scrolls internally
   (vertically through rows, horizontally for long single-line log entries). */
.sdr-decode-dock-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sdr-decode-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  /* Body cells read in the same voice as the raw log lines so the two columns
     match: 10px Barlow, weight 400, 0.14em tracking, uppercase, line-height 1.4.
     thead overrides size/tracking/colour below for the column headings. */
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.4;
  color: #b6c2cf;
  /* The list scrolls newest-last and pins its last row to the body bottom. The
     logs column's list has 0.2rem bottom padding, lifting its last line that far
     off the floor; mirror it here so the bottom-anchored rows in the two columns
     line up (without it the right column reads 0.2rem lower). */
  padding-bottom: 0.2rem;
}

/* No horizontal separators between rows — the row padding alone provides the
   spacing (per design). The logs column's text-to-text gap is its 0.35rem flex
   gap plus the log line's 0.1rem padding (≈0.45rem); two adjacent table rows
   reproduce that with 0.225rem top+bottom padding, so the two columns share a
   row pitch. */
.sdr-decode-table th,
.sdr-decode-table td {
  text-align: left;
  padding: 0.225rem 0.45rem;
}

/* APRS comment cell: allow wrapping so long status text stays readable rather
   than forcing the whole row to the widest single line. */
.sdr-decode-cell--wrap {
  white-space: normal;
  word-break: break-word;
}

/* The APRS table has many columns; size them to their content and let the body
   scroll horizontally rather than squeezing every field into the panel width.
   Short fields stay on one line; only the free-text comment wraps (bounded). */
.sdr-decode-table--aprs {
  table-layout: auto;
  width: max-content;
  min-width: 100%;
}
.sdr-decode-table--aprs th,
.sdr-decode-table--aprs td {
  white-space: nowrap;
}
.sdr-decode-table--aprs .sdr-decode-cell--wrap {
  white-space: normal;
  word-break: break-word;
  max-width: 32ch;
}

/* Raw TNC2 packet: the full verbatim frame. Wrapped (packets are long, unbroken
   strings) and slightly dimmed/smaller as a supplementary column. */
.sdr-decode-table--aprs .sdr-decode-cell--raw {
  white-space: normal;
  word-break: break-all;
  max-width: 44ch;
  font-size: 9px;
  color: #8b95a1;
}

/* When the messages list is empty the thead is hidden (headings only show with
   data), so nothing holds the header-zone height. Pad the placeholder down by
   that height (~the thead's 0.7 + ~0.79 + 1.5rem) so "No messages to display"
   still lines up with the logs column's first line. */
.sdr-decode-table .sdr-decode-empty {
  padding-top: 3.2rem;
}

/* Column headings match the side-panel field labels (SAMPLE RATE / BANDWIDTH):
   9px Barlow, weight 400, 0.18em tracking, uppercase, white. */
.sdr-decode-table thead th {
  position: sticky;
  top: 0;
  background: #0a0d14;
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #fff;
  /* The messages column has no header band of its own, so the heading row stands
     in for it: this padding reproduces the logs header geometry. The top padding
     drops the headings to the same height as the logs "Synced…" status row, and
     the bottom padding reproduces the status-to-first-log-line gap so the first
     message lines up with the first log line. Sticky, so the labels stay put
     while the rows scroll under them. */
  padding: 0.7rem 0.45rem 1.5rem;
}

/* Empty-state text matches the side-panel "No alerts" label (#msb-alerts-empty):
   10px Barlow, weight 400, 0.14em tracking, uppercase. */
.sdr-decode-empty {
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8b95a1;
  padding: 0.4rem 0.45rem;
}

.sdr-decode-logs {
  height: 100%;
}

.sdr-decode-log-list {
  list-style: none;
  margin: 0;
  padding: 0.2rem 0.45rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  /* Vertical breathing room between log rows. */
  gap: 0.35rem;
  /* Size to the widest line (but never narrower than the panel) so each line
     stays on one row and the body scrolls horizontally instead of wrapping. */
  width: max-content;
  min-width: 100%;
}

/* Log lines share the empty-state / side-panel label styling (10px Barlow,
   weight 400, 0.14em tracking, uppercase) so the decoder output reads in the
   same voice as the rest of the dock. */
.sdr-decode-log-line {
  font-family: var(--font-primary, 'Barlow', sans-serif);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.4;
  color: #b6c2cf;
  /* One line per entry: preserve dsd-fme's leading spaces/brackets and never
     wrap; overflow scrolls horizontally on the body. */
  white-space: pre;
  padding: 0.05rem 0.1rem;
}

/* Error lines (CRC errors, lost sync, …): red, with an sr-only "Error:" prefix
   so it is not colour-alone. #ff6b6b clears AA. */
.sdr-decode-log-line--error {
  color: #ff6b6b;
}

/* Scrollbars are hidden in both boxes — the bodies still scroll (and stay
   pinned to the newest row), the bar itself is just not drawn. */
.sdr-decode-dock-body {
  scrollbar-width: none;
}
.sdr-decode-dock-body::-webkit-scrollbar {
  display: none;
}

/* Visually-hidden but available to assistive tech. */
.sdr-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
