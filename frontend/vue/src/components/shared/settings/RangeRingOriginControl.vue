<template>
  <div class="settings-ring-origin">
    <RingOriginPicker @stage="emit('stage', $event)" />
  </div>
</template>

<script setup lang="ts">
/**
 * Settings > Range Ring Origin — the durable copy of the choice the map rail
 * makes in passing.
 *
 * The row itself is only the frame: the picker owns the choices, and each of
 * its rows already carries the coordinates it would centre on, so the section
 * needs no separate readout of where the rings currently are.
 *
 * The choice takes effect on the map immediately, but the write to the config
 * database is staged (`stage`) so APPLY CHANGES reports SAVED rather than
 * "NO CHANGES".
 */
import { onMounted } from 'vue'
import { useSentrySitesStore } from '@/stores/sentrySites'
import RingOriginPicker from '@/components/shared/controls/range-rings/RingOriginPicker.vue'

const sentrySitesStore = useSentrySitesStore()
const emit = defineEmits<{ stage: [fn: () => Promise<unknown> | void] }>()

// Settings can be opened without a map having ever mounted, and the site list
// is fetched by the maps' polling. Ask once so the Sentry choices are real.
onMounted(() => void sentrySitesStore.fetchSites())
</script>

<style scoped>
/* No card of its own: SettingsPanel.css is explicit that cards "sit directly on
   the panel canvas … not a white box with a shadow", so the sub-section labels
   and the row rules do the separating. */
.settings-ring-origin {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
</style>
