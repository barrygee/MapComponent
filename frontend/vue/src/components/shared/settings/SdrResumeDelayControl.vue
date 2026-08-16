<script setup lang="ts">
/**
 * Settings-panel control for the SDR's resume-after-reconnect delay (in
 * seconds). Thin wrapper around `BaseNumberSetting` supplying the SDR
 * store bindings; see that component for the shared input/staging plumbing.
 */
import { useSdrStore } from '@/stores/sdr'
import BaseNumberSetting from '@/components/base/BaseNumberSetting.vue'

const sdr = useSdrStore()
const emit = defineEmits<{
  stage: [fn: () => Promise<unknown> | void]
  commit: []
}>()
</script>

<template>
  <BaseNumberSetting
    accessible-name="Scan / search resume delay in seconds"
    :max-length="3"
    namespace="sdr"
    setting-key="resumeDelaySec"
    :hydrate-from-db="sdr.hydrateResumeDelaySecFromDb"
    :read-from-store="() => sdr.resumeDelaySec"
    :mirror-to-store="sdr.setResumeDelaySec"
    @stage="emit('stage', $event)"
    @commit="emit('commit')"
  />
</template>
