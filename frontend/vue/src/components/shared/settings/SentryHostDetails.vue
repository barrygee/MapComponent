<template>
  <div class="sentry-host-details">
    <button
      type="button"
      class="sentry-host-details-toggle"
      :aria-expanded="isExpanded"
      :aria-controls="bodyId"
      @click="toggle"
    >
      <span class="sentry-host-details-toggle-title">MORE</span>
      <ChevronIcon :open="isExpanded" />
    </button>

    <div v-show="isExpanded" :id="bodyId" class="sentry-host-details-body">
      <BaseDataGrid>
        <BaseDataCell label="POLLING" :value="host.enabled ? 'Enabled' : 'Disabled'" />
        <BaseDataCell
          label="API VERSION"
          :value="info?.api_version ?? host.api_version ?? UNSET_TEXT"
        />
        <BaseDataCell label="LAST SEEN" :value="formatTimestamp(host.last_seen_at)" />
        <BaseDataCell label="LAST POLLED" :value="formatTimestamp(info?.last_polled_at ?? null)" />
        <BaseDataCell label="REGISTERED" :value="formatTimestamp(host.created_at)" />
        <BaseDataCell v-if="errorText" label="LAST ERROR" :value="errorText" wide emphasis />
      </BaseDataGrid>

      <div class="sentry-host-details-location">
        <BaseDataGrid title="LOCATION">
          <BaseDataCell label="LATITUDE" :value="formatCoordinate(location?.latitude ?? null)" />
          <BaseDataCell label="LONGITUDE" :value="formatCoordinate(location?.longitude ?? null)" />
          <BaseDataCell
            label="POSITION SET"
            :value="formatTimestamp(location?.updated_at ?? null)"
            wide
          />
        </BaseDataGrid>
        <SentrySiteMap
          v-if="sitePosition && appStore.isOnline"
          :latitude="sitePosition.latitude"
          :longitude="sitePosition.longitude"
          :label="host.name ?? host.address"
        />
      </div>

      <BaseDataGrid title="SENTRY">
        <BaseDataCell label="SOFTWARE VERSION" :value="softwareVersion" />
        <BaseDataCell label="REPORTED NAME" :value="info?.source?.name ?? UNSET_TEXT" />
        <BaseDataCell label="REPORTED HOST" :value="reportedHost" />
        <BaseDataCell
          label="CONTROL PORT OFFSET"
          :value="formatNumber(info?.control_port_offset ?? null)"
        />
        <BaseDataCell label="UPTIME" :value="uptimeText" />
        <BaseDataCell
          label="STARTED"
          :value="formatTimestamp(readNumber(info?.health, 'started_at'))"
        />
        <BaseDataCell
          label="DATABASE"
          :value="readString(info?.health, 'database') ?? UNSET_TEXT"
        />
        <BaseDataCell label="HOTPLUG" :value="hotplugText" />
        <BaseDataCell
          label="LAST HOTPLUG EVENT"
          :value="formatTimestamp(lastHotplugEventAt)"
          wide
        />
      </BaseDataGrid>

      <BaseDataGrid title="DEVICES" :columns="3">
        <BaseDataCell
          v-for="deviceCount in deviceCounts"
          :key="deviceCount.label"
          :label="deviceCount.label"
          :value="deviceCount.value"
        />
      </BaseDataGrid>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SentryHostDetails` — the read-only "everything we know" view of one Sentry
 * host, rendered above `SentryHostForm` when a host row is expanded.
 *
 * The form only carries the four fields an operator can *edit* (address,
 * label, port, password). Everything else Sentinel or the Pi itself knows —
 * where the Sentry is (its latitude/longitude), what software it runs, how
 * long it has been up, how many dongles it can see, when it was last reached —
 * had nowhere to be shown. This component fills that gap, fetching
 * `GET /api/sdr/sentry-hosts/{id}/info` once per expansion.
 *
 * Renders through `BaseDataGrid`/`BaseDataCell` (the same label/value grid the
 * Space tracking panels use) rather than inventing a second detail layout.
 *
 * An unreachable host is a normal state, not an error: the request still
 * resolves, the live blocks come back null, and every cell falls back to
 * `UNSET_TEXT` so the view degrades to "what Sentinel has on record".
 */
import { computed, ref, watch } from 'vue'
import ChevronIcon from '@/components/shared/ChevronIcon.vue'
import SentrySiteMap from './SentrySiteMap.vue'
import { useAppStore } from '@/stores/app'
import BaseDataGrid from '@/components/base/BaseDataGrid.vue'
import BaseDataCell from '@/components/base/BaseDataCell.vue'
import { getSentryHostInfo, type SentryHost, type SentryHostInfo } from '@/services/sentryApi'

/** Shown wherever a value is genuinely absent, so no cell renders blank. */
const UNSET_TEXT = '—'

const props = defineProps<{ host: SentryHost }>()

const appStore = useAppStore()

const info = ref<SentryHostInfo | null>(null)
const isExpanded = ref(false)

/** Unique per host so two expanded rows never share an `aria-controls` target. */
const bodyId = computed(() => `sentry-host-details-${props.host.id}`)

/**
 * Collapsed by default and fetched on first expansion — the details are a
 * "tell me more" affordance, so an operator who only came to edit the address
 * never pays for a round trip to the Pi.
 */
function toggle(): void {
  isExpanded.value = !isExpanded.value
  if (isExpanded.value) void loadInfo(props.host.id)
}

// Status, address, label and console password are deliberately absent: the row
// header above already carries reachability and address, and the form's own
// fields carry the label and the "password set" state — this view shows only
// what is NOT already on screen.
const errorText = computed(() => info.value?.last_error ?? props.host.last_error)
const location = computed(() => info.value?.location ?? null)

/**
 * The reported position, or null when the Sentry has no location set — which
 * is what gates the site map: a Sentry that has never been sited reports
 * `location: null` (or a half-filled/zeroed pair), and there is nothing to plot.
 */
const sitePosition = computed(() => {
  const reported = location.value
  if (reported?.latitude == null || reported.longitude == null) return null
  // 0,0 is null island — the default an unsited Sentry reports, never a real
  // Pi's position — so it counts as "no location set" and plots nothing.
  if (reported.latitude === 0 && reported.longitude === 0) return null
  return { latitude: reported.latitude, longitude: reported.longitude }
})

/** Sentry reports its version twice; `/api/health` is the authoritative one. */
const softwareVersion = computed(
  () => readString(info.value?.health, 'version') ?? info.value?.source?.version ?? UNSET_TEXT,
)

const reportedHost = computed(() => {
  const source = info.value?.source
  if (!source?.host) return UNSET_TEXT
  return source.http_port === null ? source.host : `${source.host}:${source.http_port}`
})

const uptimeText = computed(() => formatDuration(readNumber(info.value?.health, 'uptime_s')))

const hotplugText = computed(() => {
  const hotplug = readRecord(info.value?.health, 'hotplug')
  const source = readString(hotplug, 'source')
  if (source === null) return UNSET_TEXT
  return `${source} — ${readBoolean(hotplug, 'healthy') ? 'healthy' : 'unhealthy'}`
})

const lastHotplugEventAt = computed(() =>
  readNumber(readRecord(info.value?.health, 'hotplug'), 'last_event_at'),
)

/** The `devices` counters `/api/health` reports, in the order Sentry lists them. */
const DEVICE_COUNT_FIELDS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'present', label: 'PRESENT' },
  { key: 'configured', label: 'CONFIGURED' },
  { key: 'streaming', label: 'STREAMING' },
  { key: 'degraded', label: 'DEGRADED' },
  { key: 'error', label: 'ERROR' },
  { key: 'needs_identification', label: 'NEEDS ID' },
]

const deviceCounts = computed(() => {
  const devices = readRecord(info.value?.health, 'devices')
  return DEVICE_COUNT_FIELDS.map((field) => ({
    label: field.label,
    value: formatNumber(readNumber(devices, field.key)),
  }))
})

// ── Safe readers for Sentry's raw `/api/health` body ─────────────────────────
// It is a remote service's response relayed verbatim, so every field is
// treated as possibly missing or of another type rather than assumed present.

function readRecord(
  source: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(
  source: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function readNumber(
  source: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(source: Record<string, unknown> | null | undefined, key: string): boolean {
  return source?.[key] === true
}

// ── Formatters ───────────────────────────────────────────────────────────────

function formatNumber(value: number | null): string {
  return value === null ? UNSET_TEXT : String(value)
}

/** Six decimal places — ~0.1 m, the precision Sentry itself publishes. */
function formatCoordinate(value: number | null): string {
  return value === null ? 'Not reported' : value.toFixed(6)
}

function formatTimestamp(epochMs: number | null): string {
  return epochMs === null ? UNSET_TEXT : new Date(epochMs).toLocaleString()
}

/** Seconds as `3d 4h 12m` / `4h 12m` / `12m 03s`, dropping empty leading units. */
function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return UNSET_TEXT
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(wholeSeconds / 86400)
  const hours = Math.floor((wholeSeconds % 86400) / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

async function loadInfo(hostId: number): Promise<void> {
  try {
    info.value = await getSentryHostInfo(hostId)
  } catch {
    // Sentinel itself is unreachable — keep rendering the stored record rather
    // than replacing the whole details view with an error.
    info.value = null
  }
}

// A different host opened in the same expanded row refetches; a collapsed one
// waits until it is opened, so nothing is fetched for a row nobody looked at.
watch(
  () => props.host.id,
  (hostId) => {
    info.value = null
    if (isExpanded.value) void loadInfo(hostId)
  },
)
</script>

<style scoped>
/* The disclosure header IS a form label (.sdr-devices-form-label's exact
   family, size, spacing and grey), so the closed accordion reads as one more
   row of the form it sits in rather than as a panel section of its own. */
.sentry-host-details-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  /* Extra room above so the disclosure separates from the CONSOLE PASSWORD
     field rather than reading as one more row of it. */
  padding: 26px 0 10px;
  background: none;
  border: none;
  border-radius: 0;
  color: rgba(16, 19, 29, 0.5);
  cursor: pointer;
  text-align: left;
}
/* Collapsed points right (at the title), expanded points down (at the body) —
   ChevronIcon's own default is down/up, so both states are re-pointed here. */
.sentry-host-details-toggle :deep(.chevron-icon) {
  transform: rotate(-90deg);
}
.sentry-host-details-toggle :deep(.chevron-icon--open) {
  transform: rotate(0deg);
}
.sentry-host-details-toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.sentry-host-details-toggle-title {
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

/* BaseDataGrid/BaseDataCell default to the dark map panels they were extracted
   from — white values on a near-transparent label, at the panels' own type
   scale. Both are re-pointed here at the settings panel's light surface and at
   the type of the edit form around them (.sdr-devices-form-label /
   .sdr-devices-form-input), with roomier vertical rhythm than the map panels'
   dense telemetry needs. */
.sentry-host-details-body {
  --ba-grid-section-padding-x: 0px;
  --ba-grid-section-padding-top: 0px;
  --ba-grid-section-padding-bottom: 0px;
  --ba-grid-section-gap: 16px;
  --ba-grid-row-gap: 20px;
  --ba-grid-column-gap: 24px;
  --ba-cell-gap: 7px;
  /* Section titles take .settings-group-label's scale; field labels take
     .sdr-devices-form-label's. Both sit darker than those panel greys (0.35 /
     0.5): at this size they are the only carrier of the field's meaning, so
     they hold AA contrast rather than the decorative weight larger headings
     can afford. */
  --ba-grid-title-font-size: 10px;
  --ba-grid-title-font-weight: 600;
  --ba-grid-title-letter-spacing: 0.22em;
  --ba-grid-title-color: rgba(16, 19, 29, 0.75);
  --ba-cell-label-font-size: 10px;
  --ba-cell-label-font-weight: 600;
  --ba-cell-label-letter-spacing: 0.14em;
  --ba-cell-label-color: rgba(16, 19, 29, 0.62);
  --ba-cell-value-font-size: 13px;
  --ba-cell-value-font-weight: 400;
  --ba-cell-value-letter-spacing: 0.02em;
  --ba-cell-value-color: rgba(16, 19, 29, 0.92);
  --ba-cell-value-emphasis-color: #d94436;
  --ba-cell-value-white-space: normal;
  --ba-cell-value-word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 14px 0 20px;
}

/* The site map belongs to the LOCATION section, so it sits closer to those
   cells than the 40px that separates one section from the next. */
.sentry-host-details-location {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
