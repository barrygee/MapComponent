<template>
  <div
    ref="sectionRootRef"
    class="sdr-favourites-body"
    tabindex="-1"
    role="group"
    aria-label="Favourites"
  >
    <!-- Announces removals for screen-reader users: unfavouriting makes the
         row vanish from under the pointer/focus, which is otherwise silent. -->
    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{
      liveMessage
    }}</span>

    <div class="sdr-favourites-list" role="list">
      <div
        v-for="frequency in favourites"
        :key="frequency.id"
        class="sdr-freq-row-item sdr-favourites-row-item"
        role="listitem"
      >
        <SdrFrequencyRowSummary :frequency="frequency">
          <template #actions>
            <SdrFavouriteStar
              :ref="(el) => setStarRef(frequency.id, el)"
              :favourite="true"
              :frequency-label="frequency.label"
              :disabled="readOnly"
              @toggle="unfavourite(frequency)"
            />
            <BaseIconAction
              class="sdr-freq-row-play sdr-favourites-row-play"
              accessible-name="Tune to frequency"
              tooltip="Tune to"
              tooltip-side="bottom"
              :disabled="tuningDisabled"
              @click.stop="emit('play', frequency)"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <polygon points="2,1 11,6 2,11" fill="currentColor" />
              </svg>
            </BaseIconAction>
          </template>
        </SdrFrequencyRowSummary>
      </div>
    </div>

    <div class="sdr-panel-empty" :style="{ display: favourites.length === 0 ? 'block' : 'none' }">
      No favourites.<br />Star a frequency in the Frequency Manager to see it here.
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * `SdrFavouritesSection` — the FAVOURITES accordion body hosted by
 * `SdrPanel.vue` (the outer `BaseAccordionSection` stays there, matching how
 * the Frequency Manager was hosted before it). Shows only the frequencies the
 * user has starred, with quick tune (play) and one-click unfavourite —
 * deliberately no group filter and no add/edit/delete forms. Favourites are a
 * short hand-picked shortcut list, so filtering it earns nothing; the full
 * list, its GROUPS filter and all the CRUD stay the manager's job.
 *
 * Unfavouriting removes the row out from under the user's pointer/keyboard
 * focus, so this component both announces the removal via an `sr-only` live
 * region and moves focus to the next row's star (or the section root when
 * the list empties) so focus is never dropped onto `document.body`.
 */
import { computed, nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import SdrFavouriteStar from './SdrFavouriteStar.vue'
import SdrFrequencyRowSummary from './SdrFrequencyRowSummary.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrStoredFrequency } from '@/stores/sdr'

defineProps<{
  /** Disables the row play buttons (no radio connected / read-only follower). */
  tuningDisabled: boolean
}>()

const emit = defineEmits<{
  /** Row play button: the parent tunes the radio to this stored frequency. */
  (event: 'play', freq: SdrStoredFrequency): void
}>()

const sdrStore = useSdrStore()

// Favouriting/unfavouriting mutates shared server state (the same row every
// other Sentinel instance sees), so — like the manager's edit/delete — it is
// blocked for a read-only tuner follower.
const readOnly = computed(() => sdrStore.readOnly)
const favourites = computed<SdrStoredFrequency[]>(() => sdrStore.favouriteFrequencies)

const liveMessage = ref('')
const sectionRootRef = ref<HTMLElement | null>(null)
type FavouriteStarInstance = InstanceType<typeof SdrFavouriteStar>
const starRefs = new Map<number, FavouriteStarInstance>()

/**
 * Narrows the `:ref` callback's `Element | ComponentPublicInstance | null`
 * union to the `SdrFavouriteStar` instance it always actually is here (this
 * ref is only ever bound to that component), by checking for its exposed
 * `focus` method rather than casting blindly.
 */
function setStarRef(frequencyId: number, starComponent: Element | ComponentPublicInstance | null) {
  if (starComponent && 'focus' in starComponent && typeof starComponent.focus === 'function') {
    starRefs.set(frequencyId, starComponent as FavouriteStarInstance)
  } else {
    starRefs.delete(frequencyId)
  }
}

async function unfavourite(frequency: SdrStoredFrequency) {
  // The preferred target — this row's neighbour — is read from the
  // PRE-removal list: once the row is gone, its own former neighbours are
  // the only sensible "next" choice.
  const currentIndex = favourites.value.findIndex((item) => item.id === frequency.id)
  const preferredFocusId =
    favourites.value[currentIndex + 1]?.id ?? favourites.value[currentIndex - 1]?.id ?? null
  try {
    await sdrStore.setFrequencyFavourite(frequency.id, false)
    liveMessage.value = `${frequency.label} removed from favourites`
  } catch {
    // The row stays put on failure — nothing to announce beyond the error,
    // and no focus move since the list did not actually change.
    liveMessage.value = `Failed to remove ${frequency.label} from favourites`
    return
  }
  // Confirm the target survived AFTER the DOM updates before focusing it, and
  // fall back to the first remaining star, so focus only lands on the
  // container when the list is genuinely empty.
  await nextTick()
  const remaining = favourites.value
  const focusTargetId =
    preferredFocusId !== null && remaining.some((item) => item.id === preferredFocusId)
      ? preferredFocusId
      : (remaining[0]?.id ?? null)
  if (focusTargetId !== null) starRefs.get(focusTargetId)?.focus()
  else sectionRootRef.value?.focus()
}
</script>
