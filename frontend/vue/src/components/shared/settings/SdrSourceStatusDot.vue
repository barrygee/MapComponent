<template>
  <span
    class="sdr-status-dot"
    :class="{
      'sdr-status-dot--connected': connected === true,
      'sdr-status-dot--disconnected': connected === false,
    }"
    :title="statusText"
  >
    <span class="sr-only">{{ statusText }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * `SdrSourceStatusDot` — the small reachability indicator shared by every SDR
 * source row in Settings (a manual radio's TCP connection, a Sentry host's
 * reachability, a Sentry-mirrored device's live state). Extracted from the
 * `.sdr-status-dot` markup that previously lived only in
 * `SdrDevicesControl.vue` so `SentryHostsControl.vue` can reuse the identical
 * look rather than re-implementing it.
 *
 * State is never conveyed by colour alone (WCAG 2.2 AA): the dot carries a
 * `title` tooltip plus a visually-hidden `sr-only` label with the same text,
 * so a screen reader announces "Connected"/"Not connected"/"Checking…"
 * regardless of colour perception.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** true = reachable, false = unreachable, null/undefined = not yet known. */
    connected: boolean | null | undefined
    /** Overrides the default "Connected"/"Not connected"/"Checking…" wording. */
    labels?: { connected: string; disconnected: string; unknown: string }
  }>(),
  { labels: undefined },
)

const DEFAULT_LABELS = {
  connected: 'Connected',
  disconnected: 'Not connected',
  unknown: 'Checking…',
}

const statusText = computed(() => {
  const labels = props.labels ?? DEFAULT_LABELS
  if (props.connected === true) return labels.connected
  if (props.connected === false) return labels.disconnected
  return labels.unknown
})
</script>

<style scoped>
.sdr-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  background: #555;
  flex-shrink: 0;
  vertical-align: middle;
  position: relative;
  top: -1px;
}
.sdr-status-dot--connected {
  background: var(--color-accent);
}
.sdr-status-dot--disconnected {
  background: #ef4444;
}
.sr-only {
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
