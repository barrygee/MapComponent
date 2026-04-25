<template>
  <div class="settings-item" :class="{ 'settings-item--wide': isWide }">
    <div class="settings-item-info">
      <div class="settings-item-label">{{ item.label }}</div>
      <div v-if="item.desc" class="settings-item-desc">{{ item.desc }}</div>
    </div>
    <ConnectivityToggle v-if="item.type === 'connectivity-toggle'" @stage="emit('stage', item.id, $event)" />
    <ProbeUrlControl v-else-if="item.type === 'probe-url'" @stage="emit('stage', item.id, $event)" @commit="emit('commit')" />
    <LocationControl v-else-if="item.type === 'location'" @stage="emit('stage', item.id, $event)" @commit="emit('commit')" />
    <SourceOverrideControl v-else-if="item.type === 'source-override'" :ns="item.ns!" @stage="emit('stage', item.id, $event)" />
    <OnlineSourceControl v-else-if="item.type === 'online-source'" :ns="item.ns!" :default-url="item.defaultUrl ?? ''" @stage="emit('stage', item.id, $event)" @commit="emit('commit')" />
    <OfflineSourceControl v-else-if="item.type === 'offline-source'" :ns="item.ns!" :default-url="item.defaultUrl ?? ''" @stage="emit('stage', item.id, $event)" @commit="emit('commit')" />
    <SpaceTleOnlineControl v-else-if="item.type === 'space-tle-online'" />
    <SpaceTleManualControl v-else-if="item.type === 'space-tle-manual'" />
    <SpaceTleDatabaseControl v-else-if="item.type === 'space-tle-db'" />
    <SpaceTleUncatControl v-else-if="item.type === 'space-tle-uncat'" />
    <SpaceTleSatListControl v-else-if="item.type === 'space-tle-satlist'" />
    <SpaceHoverPreviewControl v-else-if="item.type === 'space-hover-preview'" @stage="emit('stage', item.id, $event)" />
    <AdsbLabelFieldsControl v-else-if="item.type === 'air-label-fields'" @stage="emit('stage', item.id, $event)" />
    <SdrDevicesControl v-else-if="item.type === 'sdr-devices'" />
    <ConfigCurrentControl v-else-if="item.type === 'config-current'" @stage="emit('stage', item.id, $event)" />
  </div>
</template>

<script setup lang="ts">
import type { SettingItem } from '../SettingsPanel.vue'
import ConnectivityToggle from './ConnectivityToggle.vue'
import ProbeUrlControl from './ProbeUrlControl.vue'
import LocationControl from './LocationControl.vue'
import SourceOverrideControl from './SourceOverrideControl.vue'
import OnlineSourceControl from './OnlineSourceControl.vue'
import OfflineSourceControl from './OfflineSourceControl.vue'
import SpaceTleOnlineControl from './SpaceTleOnlineControl.vue'
import SpaceTleManualControl from './SpaceTleManualControl.vue'
import SpaceTleDatabaseControl from './SpaceTleDatabaseControl.vue'
import SpaceTleUncatControl from './SpaceTleUncatControl.vue'
import SpaceTleSatListControl from './SpaceTleSatListControl.vue'
import SpaceHoverPreviewControl from './SpaceHoverPreviewControl.vue'
import AdsbLabelFieldsControl from './AdsbLabelFieldsControl.vue'
import SdrDevicesControl from './SdrDevicesControl.vue'
import ConfigCurrentControl from './ConfigCurrentControl.vue'

const props = defineProps<{ item: SettingItem; pending: Map<string, () => Promise<unknown> | void> }>()
const emit = defineEmits<{
  stage: [id: string, fn: () => Promise<unknown> | void]
  commit: []
}>()

const WIDE_TYPES = new Set(['sdr-devices', 'space-tle-online', 'space-tle-manual', 'space-tle-satlist', 'config-current'])
const isWide = WIDE_TYPES.has(props.item.type)
</script>
