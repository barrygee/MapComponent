<template>
  <!-- Line-art icon for a decoded APRS symbol, in the side-panel button style.
       The paths come from our own symbol registry (not the packet), so v-html is
       safe. Colour is inherited from the surrounding table text. -->
  <span class="aprs-symbol" role="img" :aria-label="icon.label" :title="tooltip">
    <!-- eslint-disable vue/no-v-html -- trusted: icon.paths is our own static SVG
         markup from the aprsSymbols registry, never packet/user input -->
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      v-html="icon.paths"
    ></svg>
    <!-- eslint-enable vue/no-v-html -->
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { aprsSymbolIcon } from '@/utils/aprsSymbols'

const props = defineProps<{ symbol?: string | null }>()

const icon = computed(() => aprsSymbolIcon(props.symbol))
// Tooltip pairs the decoded type with the raw two-char symbol code.
const tooltip = computed(() =>
  props.symbol ? `${icon.value.label} (${props.symbol})` : icon.value.label,
)
</script>

<style scoped>
.aprs-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
</style>
