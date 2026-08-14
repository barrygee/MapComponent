<template>
  <div v-if="error" class="adsb-source-notice" role="status">
    <p class="adsb-source-notice-message">{{ error.message }}</p>
    <button
      v-if="error.code === 'device_reserved'"
      type="button"
      class="adsb-source-notice-action"
      :disabled="isClaiming"
      @click="emit('takeControl')"
    >
      {{ isClaiming ? 'Taking…' : 'Take control' }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Says why the off-grid map is empty, when it is empty for a reason.
 *
 * This is the point of the whole claim mechanism from an operator's side. The
 * original failure was a map with no aircraft and nothing to act on: the dongle
 * was on the wrong frequency, or another consumer had it, or the Pi was
 * unreachable, and all three looked identical — like quiet skies.
 *
 * Only rendered when there is something to say. A claim that succeeded needs no
 * announcement: the aircraft are the confirmation.
 *
 * `device_reserved` is the one case with an action attached, because it is the
 * one the operator can resolve from here. Taking the device is deliberately a
 * button rather than something the retry loop does on its own — winning a fight
 * over hardware should be a decision, not a side effect of a timer.
 */
import type { AdsbClaimError } from '@/services/adsbSourceApi'

defineProps<{
  error: AdsbClaimError | null
  isClaiming: boolean
}>()

const emit = defineEmits<{ takeControl: [] }>()
</script>

<style scoped>
.adsb-source-notice {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 24px));
  padding: 10px 14px;
  border-radius: 4px;
  /* The warn fill rather than danger: nothing is broken and no data is lost —
     the map is simply not receiving yet, and the operator can usually fix it. */
  background: var(--color-warn-fill, #f0c419);
  color: var(--color-ink-on-accent, #0a0c10);
  font-size: 12.5px;
  line-height: 1.55;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
}

.adsb-source-notice-message {
  margin: 0;
}

.adsb-source-notice-action {
  flex-shrink: 0;
  padding: 6px 12px;
  border: none;
  border-radius: 3px;
  background: var(--color-ink-on-accent, #0a0c10);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.adsb-source-notice-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: no-preference) {
  .adsb-source-notice {
    transition: opacity 150ms ease;
  }
}
</style>
