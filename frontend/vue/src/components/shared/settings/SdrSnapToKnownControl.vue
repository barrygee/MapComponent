<script setup lang="ts">
import BaseToggleSetting from '@/components/base/BaseToggleSetting.vue'
import { useSdrStore } from '@/stores/sdr'

// "Snap to known frequencies" toggle. ON: clicking a known-frequency marker in
// the spectrum jumps to it, and dragging the tuner bar snaps to a nearby known
// frequency. Persistence and DB hydration mirror SdrAutoCenterControl.
const sdr = useSdrStore()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()
</script>

<template>
  <BaseToggleSetting
    label="SNAP TO KNOWN FREQUENCIES"
    accessible-name="Toggle snap to known frequencies in the spectrum"
    namespace="sdr"
    setting-key="snapToKnown"
    :hydrate-from-db="sdr.hydrateSnapToKnownFromDb"
    :read-from-store="() => sdr.snapToKnown"
    :mirror-to-store="sdr.setSnapToKnown"
    @stage="emit('stage', $event)"
  />
</template>
