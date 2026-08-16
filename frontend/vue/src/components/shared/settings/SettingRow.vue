<template>
  <div
    class="settings-item"
    :class="{
      'settings-item--half': isHalf,
      'settings-item--half-stacked': isHalfStacked,
      'settings-item--full': isFull,
      'settings-item--triple': isTriple,
      'settings-item--natural-height': isNaturalHeight,
    }"
  >
    <div class="settings-item-info">
      <div class="settings-item-label" :class="{ 'sr-only': item.hideLabel }">{{ item.label }}</div>
      <div v-if="item.desc" class="settings-item-desc">{{ item.desc }}</div>
    </div>
    <ConnectivityToggle
      v-if="item.type === 'connectivity-toggle'"
      @stage="emit('stage', item.id, $event)"
    />
    <OverheadAlertsToggleControl
      v-else-if="item.type === 'overhead-alerts-toggle'"
      @stage="emit('stage', item.id, $event)"
    />
    <OverheadAlertRadiusControl
      v-else-if="item.type === 'overhead-alert-radius'"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <LandAprsRetentionControl
      v-else-if="item.type === 'land-aprs-retention'"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <ProbeUrlControl
      v-else-if="item.type === 'probe-url'"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <LocationControl
      v-else-if="item.type === 'location'"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <NotificationSoundControl
      v-else-if="item.type === 'notification-sound'"
      @stage="emit('stage', item.id, $event)"
    />
    <SourceOverrideControl
      v-else-if="item.type === 'source-override'"
      :ns="item.ns!"
      @stage="emit('stage', item.id, $event)"
    />
    <OnlineSourceControl
      v-else-if="item.type === 'online-source'"
      :ns="item.ns!"
      :default-url="item.defaultUrl ?? ''"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <OfflineSourceControl
      v-else-if="item.type === 'offline-source'"
      :ns="item.ns!"
      :default-url="item.defaultUrl ?? ''"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <AdsbSdrSourceControl v-else-if="item.type === 'adsb-sdr-source'" />
    <SpaceTleOnlineControl v-else-if="item.type === 'space-tle-online'" />
    <SpaceTleManualControl v-else-if="item.type === 'space-tle-manual'" />
    <SpaceTleDatabaseControl v-else-if="item.type === 'space-tle-db'" />
    <SpaceTleUncatControl v-else-if="item.type === 'space-tle-uncat'" />
    <SpaceTleSatListControl v-else-if="item.type === 'space-tle-satlist'" />
    <JsonDataControl
      v-else-if="item.type === 'space-sat-radio-file'"
      get-url="/api/space/radio/file"
      post-url="/api/space/radio/file"
      filename="satellite_radio.json"
      @stage="emit('stage', item.id, $event)"
    />
    <SpaceHoverPreviewControl
      v-else-if="item.type === 'space-hover-preview'"
      @stage="emit('stage', item.id, $event)"
    />
    <AdsbLabelFieldsControl
      v-else-if="item.type === 'air-label-fields'"
      @stage="emit('stage', item.id, $event)"
    />
    <AdsbTagFieldsControl
      v-else-if="item.type === 'air-tag-fields'"
      @stage="emit('stage', item.id, $event)"
    />
    <AprsLabelFieldsControl
      v-else-if="item.type === 'land-aprs-label-fields'"
      @stage="emit('stage', item.id, $event)"
    />
    <AirReplayToggleControl
      v-else-if="item.type === 'air-replay-toggle'"
      @stage="emit('stage', item.id, $event)"
    />
    <SentryHostsControl v-else-if="item.type === 'sdr-sentry-hosts'" />
    <SdrDevicesControl v-else-if="item.type === 'sdr-devices'" />
    <SdrOptionsControl
      v-else-if="item.type === 'sdr-options'"
      @stage="emit('stage', item.id, $event)"
      @commit="emit('commit')"
    />
    <JsonDataControl
      v-else-if="item.type === 'sdr-frequencies-file'"
      get-url="/api/sdr/data/frequencies"
      post-url="/api/sdr/data/frequencies"
      filename="sdr_frequencies.json"
      @stage="emit('stage', item.id, $event)"
    />
    <JsonDataControl
      v-else-if="item.type === 'sdr-bandplan-file'"
      get-url="/api/sdr/data/bandplan"
      post-url="/api/sdr/data/bandplan"
      filename="sdr_bandplan.json"
      @stage="emit('stage', item.id, $event)"
    />
    <ConfigCurrentControl
      v-else-if="item.type === 'config-current'"
      @stage="emit('stage', item.id, $event)"
    />
    <ExportAllControl v-else-if="item.type === 'export-all'" />
  </div>
</template>

<script setup lang="ts">
import type { SettingItem } from '@/types/settings'
import ConnectivityToggle from './ConnectivityToggle.vue'
import OverheadAlertsToggleControl from './OverheadAlertsToggleControl.vue'
import OverheadAlertRadiusControl from './OverheadAlertRadiusControl.vue'
import LandAprsRetentionControl from './LandAprsRetentionControl.vue'
import ProbeUrlControl from './ProbeUrlControl.vue'
import LocationControl from './LocationControl.vue'
import NotificationSoundControl from './NotificationSoundControl.vue'
import SourceOverrideControl from './SourceOverrideControl.vue'
import OnlineSourceControl from './OnlineSourceControl.vue'
import OfflineSourceControl from './OfflineSourceControl.vue'
import AdsbSdrSourceControl from './AdsbSdrSourceControl.vue'
import SpaceTleOnlineControl from './SpaceTleOnlineControl.vue'
import SpaceTleManualControl from './SpaceTleManualControl.vue'
import SpaceTleDatabaseControl from './SpaceTleDatabaseControl.vue'
import SpaceTleUncatControl from './SpaceTleUncatControl.vue'
import SpaceTleSatListControl from './SpaceTleSatListControl.vue'
import SpaceHoverPreviewControl from './SpaceHoverPreviewControl.vue'
import AdsbLabelFieldsControl from './AdsbLabelFieldsControl.vue'
import AdsbTagFieldsControl from './AdsbTagFieldsControl.vue'
import AprsLabelFieldsControl from './AprsLabelFieldsControl.vue'
import AirReplayToggleControl from './AirReplayToggleControl.vue'
import SentryHostsControl from './SentryHostsControl.vue'
import SdrDevicesControl from './SdrDevicesControl.vue'
import SdrOptionsControl from './SdrOptionsControl.vue'
import ConfigCurrentControl from './ConfigCurrentControl.vue'
import ExportAllControl from './ExportAllControl.vue'
import JsonDataControl from './JsonDataControl.vue'

const props = defineProps<{
  item: SettingItem
  pending: Map<string, () => Promise<unknown> | void>
}>()
const emit = defineEmits<{
  stage: [id: string, fn: () => Promise<unknown> | void]
  commit: []
}>()

// Two-column controls: wide enough that their labels ("Snap to Known
// Frequencies") stay on one line beside their checkbox column, or that a device
// list is not squeezed into a single 300px column.
const HALF_TYPES = new Set([
  'sdr-sentry-hosts',
  'sdr-devices',
  'sdr-options',
  'space-tle-online',
  'space-tle-manual',
  'space-tle-db',
  'space-hover-preview',
  'air-tag-fields',
  'land-aprs-label-fields',
])
// Two columns wide, but each starting a fresh row, so the SDR pair stacks
// rather than sitting shoulder to shoulder.
const HALF_STACKED_TYPES = new Set(['sdr-frequencies-file', 'sdr-bandplan-file'])
// The remaining raw-JSON editors take the full row, at the width indented JSON
// wants — neither has a sibling to pair with.
const FULL_TYPES = new Set(['space-sat-radio-file', 'config-current'])
const NATURAL_HEIGHT_TYPES = new Set(['location'])
const isTriple = false
const isHalf = HALF_TYPES.has(props.item.type)
const isHalfStacked = HALF_STACKED_TYPES.has(props.item.type)
const isFull = FULL_TYPES.has(props.item.type)
const isNaturalHeight = NATURAL_HEIGHT_TYPES.has(props.item.type)
</script>
