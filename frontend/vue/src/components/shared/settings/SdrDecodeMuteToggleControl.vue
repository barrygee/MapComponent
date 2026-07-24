<script setup lang="ts">
import BaseToggleSetting from '@/components/base/BaseToggleSetting.vue'
import { useSdrStore } from '@/stores/sdr'
import * as settingsApi from '@/services/settingsApi'

const sdrStore = useSdrStore()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()

/**
 * Re-reads `muteAudioWhileDecoding` from the `sdr` settings namespace and
 * mirrors it into the store — same pattern as `SdrTrunkTrackingToggleControl`.
 */
async function hydrateDecodeMuteFromDb(): Promise<void> {
  const data = await settingsApi.getNamespace('sdr')
  const nextValue = data?.muteAudioWhileDecoding
  if (typeof nextValue === 'boolean') {
    sdrStore.setMuteAudioWhileDecoding(nextValue)
  }
}
</script>

<template>
  <!--
    No deferMirror: the mute applies live to a decode already running, so the
    switch takes effect as soon as it is flipped (the DB write still rides on
    APPLY CHANGES with every other staged setting).
  -->
  <BaseToggleSetting
    label="MUTE AUDIO WHILE DECODING"
    accessible-name="Toggle muting audio while decoding"
    namespace="sdr"
    setting-key="muteAudioWhileDecoding"
    :hydrate-from-db="hydrateDecodeMuteFromDb"
    :read-from-store="() => sdrStore.muteAudioWhileDecoding"
    :mirror-to-store="sdrStore.setMuteAudioWhileDecoding"
    @stage="emit('stage', $event)"
  />
</template>
