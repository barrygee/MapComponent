<template>
  <div class="sdr-host-group-header">
    <SdrSourceStatusDot :connected="reachable" />
    <span class="sdr-host-group-header-name">{{ label }}</span>
    <span v-if="lastError" class="sdr-host-group-header-error">— {{ lastError }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrHostGroupHeader` — the header row above one Sentry host's devices in
 * `SdrDevicesControl`: reachability dot, the host's label (name, falling back
 * to its address), and its last polling error when the host is unreachable —
 * so a dead Pi reads as "unreachable, here's why" rather than an empty group
 * that looks like it simply has no devices.
 */
import SdrSourceStatusDot from './SdrSourceStatusDot.vue'

defineProps<{
  label: string
  /** null while the fleet poller has not produced a snapshot yet. */
  reachable: boolean | null
  lastError: string | null
}>()
</script>

<style scoped>
.sdr-host-group-header {
  display: flex;
  align-items: center;
  padding: 10px 14px 6px;
  font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(16, 19, 29, 0.55);
}
.sdr-host-group-header-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdr-host-group-header-error {
  margin-left: 8px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: #d94436;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
