<template>
  <span v-if="readOnly" class="sr-only" role="status"
    >Frequency manager is read-only while another Sentinel controls this radio</span
  >
  <!-- Row-action announcements. Covers a failed favourite toggle (the star's
       own accessible name already reflects a SUCCESSFUL change, so that needs
       no announcement) and the remove flow, where the row and its button
       disappear from under the user. -->
  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{
    rowStatusMessage
  }}</span>
  <div
    class="sdr-frequency-manager-freqs-body"
    :class="{ 'sdr-frequency-manager--readonly': readOnly }"
  >
    <div v-show="!(efOpen && editingFreqId === null)" class="sdr-frequency-manager-add-freq-row">
      <button
        id="sdr-radio-add-freq"
        ref="addFreqButtonRef"
        class="sdr-add-freq-btn"
        :disabled="readOnly"
        @click="openAddFreqPanel"
      >
        Add Frequency
      </button>
    </div>

    <!-- Add frequency panel (only when adding, not editing) -->
    <div
      v-if="efOpen && editingFreqId === null"
      id="sdr-editfreq-body"
      class="sdr-editfreq-body sdr-addfreq-body expanded"
    >
      <div class="sdr-addfreq-title-row">
        <span class="sdr-scanner-section-label">ADD FREQUENCY</span>
      </div>
      <div class="sdr-editfreq-field">
        <label class="sdr-field-label">LABEL</label>
        <input
          id="sdr-ef-label"
          v-model="efLabel"
          class="sdr-panel-input"
          :class="{ 'sdr-input-error': efErrors.label }"
          type="text"
          aria-label="Frequency label"
          placeholder="Label…"
          maxlength="60"
          style="width: 100%"
        />
        <div v-if="efErrors.label" class="sdr-field-error">{{ efErrors.label }}</div>
      </div>
      <div class="sdr-editfreq-field">
        <label class="sdr-field-label">FREQ (MHz)</label>
        <input
          id="sdr-ef-freq"
          v-model="efFreq"
          class="sdr-panel-input"
          :class="{ 'sdr-input-error': efErrors.freq }"
          type="text"
          aria-label="Frequency in MHz"
          placeholder="118.3800"
          autocomplete="off"
          style="width: 100%"
        />
        <div v-if="efErrors.freq" class="sdr-field-error">{{ efErrors.freq }}</div>
      </div>
      <div class="sdr-editfreq-field">
        <label class="sdr-field-label">MODE</label>
        <div
          id="sdr-ef-mode-pills"
          class="sdr-mode-pills"
          :class="{ 'sdr-input-error': efErrors.mode }"
          role="radiogroup"
          aria-label="Demodulation mode"
        >
          <BasePillToggle
            v-for="(mode, modeIndex) in MODES"
            :key="mode"
            class="sdr-mode-pill"
            role="radio"
            :aria-checked="efMode === mode"
            :tabindex="efModeKeyboard.radioTabindex(modeIndex)"
            :active="efMode === mode"
            active-class="active"
            @click="efMode = mode"
            @keydown="efModeKeyboard.onRadioKeydown($event, modeIndex)"
          >
            {{ mode }}
          </BasePillToggle>
        </div>
        <!-- No mode-error slot here: the Add panel seeds efMode from the
             current (always-valid) mode, so it can never fail mode
             validation. The inline per-row edit (which can open a stored
             frequency with a legacy/invalid mode) keeps its slot. -->
      </div>
      <div class="sdr-editfreq-field">
        <label class="sdr-field-label">GROUPS</label>
        <div id="sdr-ef-groups" class="sdr-fmod-groups">
          <BasePillToggle
            class="sdr-mode-pill sdr-ef-gpill"
            :active="efGroupIds.length === 0"
            active-class="active"
            :aria-pressed="efGroupIds.length === 0"
            @click="efGroupIds = []"
          >
            Default
          </BasePillToggle>
          <BasePillToggle
            v-for="group in groups"
            :key="group.id"
            class="sdr-mode-pill sdr-ef-gpill"
            :active="efGroupIds.includes(group.id)"
            active-class="active"
            :aria-pressed="efGroupIds.includes(group.id)"
            @click="toggleEfGroup(group.id)"
          >
            {{ group.name }}
          </BasePillToggle>
        </div>
      </div>
      <div class="sdr-editfreq-field">
        <label class="sdr-field-label">NOTES</label>
        <textarea
          id="sdr-ef-notes"
          v-model="efNotes"
          class="sdr-panel-input sdr-panel-textarea"
          :class="{ 'sdr-input-error': efErrors.notes }"
          aria-label="Frequency notes"
          placeholder="Notes…"
          rows="4"
          style="width: 100%"
        ></textarea>
        <div v-if="efErrors.notes" class="sdr-field-error">{{ efErrors.notes }}</div>
      </div>
      <div class="sdr-editfreq-field">
        <BaseAccordionSection
          v-model:expanded="efSettingsExpanded"
          title="RADIO SETTINGS"
          body-id="sdr-ef-settings-section"
          variant="form"
          body-class="sdr-ef-settings-grid"
        >
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">RF GAIN (dB)</span>
            <input
              v-model="efGainDb"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              step="0.1"
              :disabled="efGainAuto"
              aria-label="RF gain in dB"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">AUTO (AGC)</span>
            <div class="sdr-ef-toggle-wrap">
              <button
                type="button"
                class="sdr-ef-toggle"
                :class="{ 'is-on': efGainAuto }"
                role="switch"
                :aria-checked="efGainAuto"
                aria-label="Auto gain (AGC)"
                @click="efGainAuto = !efGainAuto"
              >
                <span class="sdr-ef-toggle-thumb"></span>
              </button>
            </div>
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">BANDWIDTH (kHz)</span>
            <input
              v-model="efBwKhz"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              step="0.1"
              min="0"
              aria-label="Demod bandwidth in kHz"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">SQUELCH (dBFS)</span>
            <input
              v-model="efSquelch"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              aria-label="Squelch threshold in dBFS"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">VOLUME (%)</span>
            <input
              v-model="efVolume"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              min="0"
              max="100"
              aria-label="Volume percent"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">SAMPLE RATE</span>
            <SdrSampleRatePicker v-model="efSampleRate" />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">ZOOM</span>
            <input
              v-model="efZoom"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              step="0.1"
              min="1"
              aria-label="Waterfall zoom"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">WF MIN (dB)</span>
            <input
              v-model="efZmin"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              aria-label="Waterfall minimum dB"
            />
          </div>
          <div class="sdr-ef-setting">
            <span class="sdr-field-label">WF MAX (dB)</span>
            <input
              v-model="efZmax"
              class="sdr-panel-input sdr-ef-setting-input"
              type="number"
              aria-label="Waterfall maximum dB"
            />
          </div>
        </BaseAccordionSection>
      </div>
      <div class="sdr-editfreq-actions">
        <div class="sdr-editfreq-actions-right">
          <BaseButton
            id="sdr-ef-cancel"
            variant="ghost"
            class="sdr-panel-btn"
            @click="cancelEditFreq"
            >CANCEL</BaseButton
          >
          <BaseButton
            id="sdr-ef-save"
            variant="ghost"
            class="sdr-panel-btn sdr-editfreq-save-btn"
            @click="saveFreq"
          >
            SAVE
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Group-filter chips, tucked into their own GROUPS accordion. -->
    <SdrFrequencyGroupFilter
      v-model:expanded="groupFilter.expanded.value"
      body-id="sdr-freq-manager-groups-section"
      :groups="groupsWithFreqs"
      :selected-group-ids="groupFilter.selectedGroupIds.value"
      :all-selected="groupFilter.allSelected.value"
      :disabled="readOnly"
      @toggle-all="groupFilter.toggleAll"
      @toggle-group="groupFilter.toggleGroup"
    />

    <div id="sdr-freq-list" ref="freqListRef">
      <div
        v-for="frequency in filteredFreqs"
        :key="frequency.id"
        class="sdr-freq-row-item"
        :class="{ 'sdr-freq-editing': editingFreqId === frequency.id }"
        :data-id="frequency.id"
      >
        <SdrFrequencyRowSummary :frequency="frequency">
          <template #actions>
            <SdrFavouriteStar
              :favourite="frequency.favourite === true"
              :frequency-label="frequency.label"
              :disabled="readOnly"
              @toggle="toggleFavourite(frequency)"
            />
            <BaseIconAction
              class="sdr-freq-row-play"
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
            <BaseIconAction
              class="sdr-freq-row-edit"
              accessible-name="Edit frequency"
              tooltip="Edit"
              tooltip-side="bottom"
              :disabled="readOnly"
              @click.stop="toggleEditFreqPanel(frequency)"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5z"
                  fill="currentColor"
                />
              </svg>
            </BaseIconAction>
            <!-- Inline remove confirm, same arm→confirm pattern as the
                 recordings list: ✕ arms the row, then ✓ commits and ✕ cancels.
                 Deleting a saved frequency is irreversible, so it should never
                 be one stray click away. -->
            <template v-if="confirmDeleteFreqId === frequency.id">
              <BaseIconAction
                class="sdr-freq-row-del sdr-freq-row-del--confirm"
                accessible-name="Confirm remove frequency"
                tooltip="Confirm remove"
                tooltip-side="bottom"
                :disabled="readOnly"
                @click.stop="confirmRemoveFreq(frequency)"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2.5 7.5l3 3 6-7" />
                </svg>
              </BaseIconAction>
              <BaseIconAction
                class="sdr-freq-row-del sdr-freq-row-del--cancel"
                accessible-name="Cancel remove frequency"
                tooltip="Cancel"
                tooltip-side="bottom"
                @click.stop="cancelRemoveFreq(frequency)"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                </svg>
              </BaseIconAction>
            </template>
            <BaseIconAction
              v-else
              class="sdr-freq-row-del"
              accessible-name="Remove frequency"
              tooltip="Remove"
              tooltip-side="bottom"
              :disabled="readOnly"
              @click.stop="armRemoveFreq(frequency)"
            >
              &#x2715;
            </BaseIconAction>
          </template>
        </SdrFrequencyRowSummary>

        <!-- Inline edit form (accordion body) -->
        <div
          v-if="efOpen && editingFreqId === frequency.id"
          class="sdr-editfreq-body expanded"
          @click.stop
        >
          <div class="sdr-editfreq-field">
            <label class="sdr-field-label">LABEL</label>
            <input
              v-model="efLabel"
              class="sdr-panel-input"
              :class="{ 'sdr-input-error': efErrors.label }"
              type="text"
              aria-label="Frequency label"
              placeholder="Label…"
              maxlength="60"
              style="width: 100%"
            />
            <div v-if="efErrors.label" class="sdr-field-error">{{ efErrors.label }}</div>
          </div>
          <div class="sdr-editfreq-field">
            <label class="sdr-field-label">FREQ (MHz)</label>
            <input
              v-model="efFreq"
              class="sdr-panel-input"
              :class="{ 'sdr-input-error': efErrors.freq }"
              type="text"
              aria-label="Frequency in MHz"
              placeholder="118.3800"
              autocomplete="off"
              style="width: 100%"
            />
            <div v-if="efErrors.freq" class="sdr-field-error">{{ efErrors.freq }}</div>
          </div>
          <div class="sdr-editfreq-field">
            <label class="sdr-field-label">MODE</label>
            <div
              class="sdr-mode-pills"
              :class="{ 'sdr-input-error': efErrors.mode }"
              role="radiogroup"
              aria-label="Demodulation mode"
            >
              <BasePillToggle
                v-for="(mode, modeIndex) in MODES"
                :key="mode"
                class="sdr-mode-pill"
                role="radio"
                :aria-checked="efMode === mode"
                :tabindex="efModeKeyboard.radioTabindex(modeIndex)"
                :active="efMode === mode"
                active-class="active"
                @click="efMode = mode"
                @keydown="efModeKeyboard.onRadioKeydown($event, modeIndex)"
              >
                {{ mode }}
              </BasePillToggle>
            </div>
            <div v-if="efErrors.mode" class="sdr-field-error">{{ efErrors.mode }}</div>
          </div>
          <div class="sdr-editfreq-field">
            <label class="sdr-field-label">GROUPS</label>
            <div class="sdr-fmod-groups">
              <BasePillToggle
                class="sdr-mode-pill sdr-ef-gpill"
                :active="efGroupIds.length === 0"
                active-class="active"
                :aria-pressed="efGroupIds.length === 0"
                @click="efGroupIds = []"
              >
                Default
              </BasePillToggle>
              <BasePillToggle
                v-for="group in groups"
                :key="group.id"
                class="sdr-mode-pill sdr-ef-gpill"
                :active="efGroupIds.includes(group.id)"
                active-class="active"
                :aria-pressed="efGroupIds.includes(group.id)"
                @click="toggleEfGroup(group.id)"
              >
                {{ group.name }}
              </BasePillToggle>
            </div>
          </div>
          <div class="sdr-editfreq-field">
            <label class="sdr-field-label">NOTES</label>
            <textarea
              v-model="efNotes"
              class="sdr-panel-input sdr-panel-textarea"
              :class="{ 'sdr-input-error': efErrors.notes }"
              aria-label="Frequency notes"
              placeholder="Notes…"
              rows="4"
              style="width: 100%"
            ></textarea>
            <div v-if="efErrors.notes" class="sdr-field-error">{{ efErrors.notes }}</div>
          </div>
          <div class="sdr-editfreq-field">
            <BaseAccordionSection
              v-model:expanded="efSettingsExpanded"
              title="RADIO SETTINGS"
              body-id="sdr-ef-settings-section"
              variant="form"
              body-class="sdr-ef-settings-grid"
            >
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">RF GAIN (dB)</span>
                <input
                  v-model="efGainDb"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  step="0.1"
                  :disabled="efGainAuto"
                  aria-label="RF gain in dB"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">AUTO (AGC)</span>
                <div class="sdr-ef-toggle-wrap">
                  <button
                    type="button"
                    class="sdr-ef-toggle"
                    :class="{ 'is-on': efGainAuto }"
                    role="switch"
                    :aria-checked="efGainAuto"
                    aria-label="Auto gain (AGC)"
                    @click="efGainAuto = !efGainAuto"
                  >
                    <span class="sdr-ef-toggle-thumb"></span>
                  </button>
                </div>
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">BANDWIDTH (kHz)</span>
                <input
                  v-model="efBwKhz"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  step="0.1"
                  min="0"
                  aria-label="Demod bandwidth in kHz"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">SQUELCH (dBFS)</span>
                <input
                  v-model="efSquelch"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  aria-label="Squelch threshold in dBFS"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">VOLUME (%)</span>
                <input
                  v-model="efVolume"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  min="0"
                  max="100"
                  aria-label="Volume percent"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">SAMPLE RATE</span>
                <SdrSampleRatePicker v-model="efSampleRate" />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">ZOOM</span>
                <input
                  v-model="efZoom"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  step="0.1"
                  min="1"
                  aria-label="Waterfall zoom"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">WF MIN (dB)</span>
                <input
                  v-model="efZmin"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  aria-label="Waterfall minimum dB"
                />
              </div>
              <div class="sdr-ef-setting">
                <span class="sdr-field-label">WF MAX (dB)</span>
                <input
                  v-model="efZmax"
                  class="sdr-panel-input sdr-ef-setting-input"
                  type="number"
                  aria-label="Waterfall maximum dB"
                />
              </div>
            </BaseAccordionSection>
          </div>
          <div class="sdr-editfreq-actions">
            <div class="sdr-editfreq-actions-right">
              <BaseButton variant="ghost" class="sdr-panel-btn" @click="cancelEditFreq"
                >CANCEL</BaseButton
              >
              <BaseButton
                variant="ghost"
                class="sdr-panel-btn sdr-editfreq-save-btn"
                @click="saveFreq"
                >SAVE</BaseButton
              >
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      id="sdr-freq-empty"
      class="sdr-panel-empty"
      :style="{ display: freqs.length === 0 ? 'block' : 'none' }"
    >
      No saved frequencies.<br />Tune to a frequency and use Add Frequency to save it.
    </div>
    <div v-if="freqs.length > 0 && filteredFreqs.length === 0" class="sdr-panel-empty">
      No matches.
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * SdrFrequencyManagerTab — the FREQUENCY MANAGER tab of the SDR side panel:
 * the saved-frequency list with its group filter, plus the add / inline-edit
 * forms (label, freq, mode, groups, notes and the RADIO SETTINGS grid of
 * per-frequency tuning settings). CRUD goes against /api/sdr/frequencies.
 *
 * The GROUPS filter (`SdrFrequencyGroupFilter` + `useFrequencyGroupFilter`)
 * and the row body (`SdrFrequencyRowSummary`) are shared with
 * `SdrFavouritesSection` rather than duplicated. Each row's action cluster
 * leads with `SdrFavouriteStar` (star before play/edit/delete, so the two
 * destructive-adjacent buttons stay where muscle memory expects them) —
 * starring here is what populates the RADIO panel's FAVOURITES accordion.
 *
 * The tuning engine stays in the parent panel: the row play button emits
 * `play` (parent runs playFreq → applyStoredFreqSettings → tune), and the
 * add/edit forms seed their RADIO SETTINGS from the `live` prop (the parent's
 * current radio state) so a new frequency captures what the user is hearing.
 *
 * Emits `activate` when a form opens (parent switches the visible tab) and
 * `changed` after every successful save/delete (parent runs its full data
 * reload).
 *
 * Styling lives in SdrPanel.css (imported globally by SdrPanel.vue), same as
 * the other extracted panel sections.
 */
import { ref, computed, watch, nextTick } from 'vue'
import BaseAccordionSection from '@/components/base/BaseAccordionSection.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIconAction from '@/components/base/BaseIconAction.vue'
import BasePillToggle from '@/components/base/BasePillToggle.vue'
import SdrFavouriteStar from './SdrFavouriteStar.vue'
import SdrFrequencyGroupFilter from './SdrFrequencyGroupFilter.vue'
import SdrFrequencyRowSummary from './SdrFrequencyRowSummary.vue'
import { useFrequencyGroupFilter } from '@/composables/useFrequencyGroupFilter'
import { useRadioGroupKeyboard } from '@/composables/useRadioGroupKeyboard'
import SdrSampleRatePicker from './SdrSampleRatePicker.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'
import { parseFreqMhz, MODES } from './sdrPanelUtils'

/** The parent panel's live radio state, used to seed the add/edit forms. */
export interface SdrLiveTuneSeed {
  freqHz: number
  mode: string
  gainAuto: boolean
  gainDb: number
  bwHz: number
  squelch: number
  volume: number
  sampleRateHz: number
}

const props = defineProps<{
  /** Live radio state seeding new/legacy form fields (see SdrLiveTuneSeed). */
  live: SdrLiveTuneSeed
  /** Disables the row play buttons (no radio connected / read-only follower). */
  tuningDisabled: boolean
}>()

const emit = defineEmits<{
  /** Row play button: the parent tunes the radio to this stored frequency. */
  (event: 'play', freq: SdrStoredFrequency): void
  /** A form opened: the parent switches the visible tab to frequency-manager. */
  (event: 'activate'): void
  /** Fired after a successful save/delete so the parent reloads data. */
  (event: 'changed'): void
}>()

const sdrStore = useSdrStore()

const readOnly = computed(() => sdrStore.readOnly)
const groups = computed<SdrFrequencyGroup[]>(() => sdrStore.groups)
const freqs = computed<SdrStoredFrequency[]>(() => sdrStore.frequencies)
const groupsWithFreqs = computed<SdrFrequencyGroup[]>(() => sdrStore.groupsWithFreqs)
const freqGroupsFor = sdrStore.freqGroupsFor

// ── Group filter ──────────────────────────────────────────────────────────────
// State + filtering live in useFrequencyGroupFilter, paired with the
// presentational SdrFrequencyGroupFilter; this tab is the only host (the
// FAVOURITES section is deliberately unfiltered — it is a short hand-picked
// list). See the composable's doc for the "No matches." stranding behaviour
// this tab's specs pin.
const groupFilter = useFrequencyGroupFilter(freqGroupsFor)
const filteredFreqs = computed<SdrStoredFrequency[]>(() =>
  groupFilter.filterFrequencies(freqs.value),
)

// Announces row-action outcomes (see the template's sr-only status span).
const rowStatusMessage = ref('')

// The saved-frequency list element, used to find a specific row's action
// button by `data-id`, and the Add Frequency button as the last-resort focus
// target when the removed row had no neighbour left to receive focus.
const freqListRef = ref<HTMLElement | null>(null)
const addFreqButtonRef = ref<HTMLButtonElement | null>(null)

// The row whose ✕ is "armed" — swaps it for a ✓ / ✕ pair until confirmed,
// mirroring the recordings list's inline delete confirm. A single value, so
// only one row can ever be armed.
const confirmDeleteFreqId = ref<number | null>(null)

// Disarm a row that leaves the visible list (group filter changed, or the
// parent reloaded the data). Without this the row stays armed while hidden and
// comes back pre-armed, leaving a destructive ✓ one stray click away in a
// state the user has long since forgotten arming.
watch(filteredFreqs, (visibleFreqs) => {
  if (confirmDeleteFreqId.value === null) return
  if (!visibleFreqs.some((freq) => freq.id === confirmDeleteFreqId.value)) {
    confirmDeleteFreqId.value = null
  }
})

/**
 * Moves keyboard focus to one of a row's action buttons, addressing the row by
 * its `data-id` rather than keeping a parallel Map of element refs: the rows
 * already carry `data-id` for exactly this kind of lookup, and every button in
 * the arm→confirm swap is created/destroyed as the state changes, so a ref map
 * would need constant re-syncing. Returns whether the target was found.
 *
 * This exists because each step of the remove flow REPLACES the button the
 * user just activated (✕ → ✓/✕ → gone), which would otherwise drop focus onto
 * `document.body` and lose the keyboard user's place in the list entirely.
 */
async function focusRowAction(frequencyId: number | null, actionSelector: string) {
  if (frequencyId === null) return false
  await nextTick()
  const button = freqListRef.value?.querySelector<HTMLElement>(
    `[data-id="${frequencyId}"] ${actionSelector}`,
  )
  button?.focus()
  return button !== null && button !== undefined
}

/** Arms a row's ✕, moving focus onto the ✓ that replaces it. */
async function armRemoveFreq(freq: SdrStoredFrequency) {
  confirmDeleteFreqId.value = freq.id
  rowStatusMessage.value = `Confirm removal of ${freq.label}, or cancel`
  await focusRowAction(freq.id, '.sdr-freq-row-del--confirm')
}

/** Cancels an armed row, returning focus to the ✕ it came from. */
async function cancelRemoveFreq(freq: SdrStoredFrequency) {
  confirmDeleteFreqId.value = null
  rowStatusMessage.value = `Removal of ${freq.label} cancelled`
  await focusRowAction(freq.id, '.sdr-freq-row-del')
}

// Star a/unstar a stored frequency. Uses the store's dedicated favourite PATCH
// (not the full-replace frequency PUT saveFreq below uses) so toggling a star
// never risks resetting the row's other fields.
async function toggleFavourite(freq: SdrStoredFrequency) {
  const nextFavourite = !freq.favourite
  try {
    await sdrStore.setFrequencyFavourite(freq.id, nextFavourite)
  } catch {
    // The row simply keeps its previous favourite state on failure — the
    // star reverts visually, so a screen-reader user needs the explicit
    // announcement to know the press didn't take.
    rowStatusMessage.value = `Failed to ${nextFavourite ? 'favourite' : 'unfavourite'} ${freq.label}`
  }
}

// ── Edit frequency panel ──────────────────────────────────────────────────────
const efOpen = ref(false)
const editingFreqId = ref<number | null>(null)
const efLabel = ref('')
const efFreq = ref('')
const efMode = ref('AM')
const efGroupIds = ref<number[]>([])
const efNotes = ref('')
// Per-frequency tuning settings for the add/edit form. Numeric fields are
// strings (parsed on save) to mirror the freq input; efGainAuto toggles AGC
// (stored as gain = -1), and efSampleRate is a concrete option value.
const efGainDb = ref('30')
const efGainAuto = ref(false)
const efBwKhz = ref('10')
const efSquelch = ref('-60')
const efVolume = ref('80')
const efSampleRate = ref<number>(2048000)
const efSettingsExpanded = ref(false)
const efZoom = ref('1')
const efZmin = ref('0')
const efZmax = ref('0')
const efErrors = ref<{ label?: string; freq?: string; mode?: string; notes?: string }>({})

watch(efLabel, () => {
  if (efErrors.value.label) efErrors.value = { ...efErrors.value, label: undefined }
})
watch(efFreq, () => {
  if (efErrors.value.freq) efErrors.value = { ...efErrors.value, freq: undefined }
})
watch(efMode, () => {
  // efMode is only ever set from the mode pills (always a valid MODES entry), so
  // clearing an existing error is the only observable effect of this watcher.
  if (efErrors.value.mode) efErrors.value = { ...efErrors.value, mode: undefined }
})
watch(efNotes, () => {
  if (efErrors.value.notes) efErrors.value = { ...efErrors.value, notes: undefined }
})

const NOTES_ALLOWED = /^[A-Za-z0-9\s.,!?\-_():;/@]*$/

function openAddFreqPanel() {
  editingFreqId.value = null
  efLabel.value = ''
  efFreq.value = props.live.freqHz ? (props.live.freqHz / 1e6).toFixed(4) : ''
  /* v8 ignore start -- defensive default / fall-through for an always-present field (or jsdom-limited path) */
  efMode.value = props.live.mode || 'AM'
  /* v8 ignore stop */
  efGroupIds.value = []
  efNotes.value = ''
  // New frequencies default their tuning settings to the live radio settings.
  efGainAuto.value = props.live.gainAuto
  efGainDb.value = String(props.live.gainDb)
  efBwKhz.value = String(props.live.bwHz / 1000)
  efSquelch.value = String(props.live.squelch)
  efVolume.value = String(props.live.volume)
  efSampleRate.value = props.live.sampleRateHz
  efZoom.value = String(sdrStore.viewZoom)
  efZmin.value = String(sdrStore.viewZmin)
  efZmax.value = String(sdrStore.viewZmax)
  efErrors.value = {}
  efOpen.value = true
  emit('activate')
}

function openEditFreqPanel(f: SdrStoredFrequency) {
  editingFreqId.value = f.id
  efLabel.value = f.label
  efFreq.value = (f.frequency_hz / 1e6).toFixed(4)
  efMode.value = f.mode
  efGroupIds.value = (f.group_ids || []).filter((id) => id !== 0)
  efNotes.value = f.notes ?? ''
  // Seed the settings from the stored values, falling back to the live settings
  // for anything a legacy row (predating these fields) didn't carry.
  efGainAuto.value = (f.gain ?? props.live.gainDb) < 0
  efGainDb.value = String(f.gain ?? props.live.gainDb)
  efBwKhz.value = String((f.bandwidth ?? props.live.bwHz) / 1000)
  efSquelch.value = String(f.squelch ?? props.live.squelch)
  efVolume.value = String(f.volume ?? props.live.volume)
  efSampleRate.value = f.sample_rate ?? props.live.sampleRateHz
  efZoom.value = String(f.zoom ?? sdrStore.viewZoom)
  efZmin.value = String(f.zmin ?? sdrStore.viewZmin)
  efZmax.value = String(f.zmax ?? sdrStore.viewZmax)
  efErrors.value = {}
  efOpen.value = true
  emit('activate')
}

function toggleEditFreqPanel(f: SdrStoredFrequency) {
  if (efOpen.value && editingFreqId.value === f.id) {
    cancelEditFreq()
  } else {
    openEditFreqPanel(f)
  }
}

function cancelEditFreq() {
  editingFreqId.value = null
  efOpen.value = false
  efErrors.value = {}
}

function validateFreqForm(): boolean {
  const errs: { label?: string; freq?: string; mode?: string; notes?: string } = {}
  const label = efLabel.value.trim()
  if (!label) errs.label = 'Label is required'
  else if (label.length > 60) errs.label = 'Label must be 60 characters or fewer'
  const hz = parseFreqMhz(efFreq.value)
  if (!hz) errs.freq = 'Enter a valid frequency in MHz'
  // Reachable when editing a stored frequency whose mode isn't one of MODES.
  if (!efMode.value || !(MODES as readonly string[]).includes(efMode.value))
    errs.mode = 'Select a mode'
  if (efNotes.value && !NOTES_ALLOWED.test(efNotes.value))
    errs.notes = 'Notes contain disallowed characters'
  efErrors.value = errs
  return Object.keys(errs).length === 0
}

function toggleEfGroup(id: number) {
  const idx = efGroupIds.value.indexOf(id)
  if (idx === -1) efGroupIds.value = [...efGroupIds.value, id]
  else efGroupIds.value = efGroupIds.value.filter((i) => i !== id)
}

// Radio-group keyboard model for the MODE pills. One instance serves both the
// inline-edit and Add forms — they render the same MODES over the same efMode.
const efModeKeyboard = useRadioGroupKeyboard({
  optionCount: () => MODES.length,
  selectedIndex: () => (MODES as readonly string[]).indexOf(efMode.value),
  select: (modeIndex) => {
    efMode.value = MODES[modeIndex]!
  },
})

// Parse the per-frequency tuning settings from the add/edit form into the API
// shape. Each value falls back to a sensible default if the field was cleared
// or non-numeric, so a malformed entry never blocks the save.
function freqSettingsPayload() {
  const gain = efGainAuto.value ? -1 : numOr(efGainDb.value, 30)
  const volume = Math.min(100, Math.max(0, Math.round(numOr(efVolume.value, 80))))
  return {
    squelch: numOr(efSquelch.value, -60),
    gain,
    bandwidth: Math.round(numOr(efBwKhz.value, 10) * 1000),
    sample_rate: efSampleRate.value,
    volume,
    zoom: numOr(efZoom.value, 1),
    zmin: numOr(efZmin.value, 0),
    zmax: numOr(efZmax.value, 0),
  }
}

function numOr(raw: string, fallback: number): number {
  const parsed = parseFloat(raw)
  return isFinite(parsed) ? parsed : fallback
}

async function saveFreq() {
  if (!validateFreqForm()) return
  const label = efLabel.value.trim()
  const hz = parseFreqMhz(efFreq.value)
  // validateFreqForm() above already guarantees a non-empty label and valid hz.
  /* v8 ignore start */
  if (!label || !hz) return
  /* v8 ignore stop */
  try {
    if (editingFreqId.value !== null) {
      const existing = freqs.value.find((x) => x.id === editingFreqId.value)
      await fetch(`/api/sdr/frequencies/${editingFreqId.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          frequency_hz: hz,
          mode: efMode.value,
          group_ids: efGroupIds.value,
          ...freqSettingsPayload(),
          /* v8 ignore start -- defensive default / fall-through for an always-present field (or jsdom-limited path) */
          scannable: existing?.scannable ?? true,
          /* v8 ignore stop */
          // This PUT is a full replace (see the store's setFrequencyFavourite
          // doc for why the star toggle uses a dedicated PATCH instead), so
          // the star's current value must be resent here or saving the edit
          // form would silently unfavourite the row.
          favourite: existing?.favourite ?? false,
          notes: efNotes.value,
        }),
      })
    } else {
      await fetch('/api/sdr/frequencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          frequency_hz: hz,
          mode: efMode.value,
          ...freqSettingsPayload(),
          scannable: true,
          favourite: false,
          group_ids: efGroupIds.value,
          notes: efNotes.value,
        }),
      })
    }
    editingFreqId.value = null
    efOpen.value = false
    emit('changed')
  } catch (_) {}
}

/**
 * Deletes the frequency whose ✕ was armed and then confirmed with ✓. Only
 * reachable from the armed state, so the confirm is the guard — there is no
 * unconfirmed delete path.
 */
async function confirmRemoveFreq(freq: SdrStoredFrequency) {
  // Pick the focus successor BEFORE the row goes: once deleted it has no
  // neighbours to ask.
  const currentIndex = filteredFreqs.value.findIndex((item) => item.id === freq.id)
  const successorId =
    filteredFreqs.value[currentIndex + 1]?.id ?? filteredFreqs.value[currentIndex - 1]?.id ?? null
  confirmDeleteFreqId.value = null
  try {
    await fetch(`/api/sdr/frequencies/${freq.id}`, { method: 'DELETE' })
    if (editingFreqId.value === freq.id) {
      editingFreqId.value = null
      efOpen.value = false
    }
    rowStatusMessage.value = `${freq.label} removed`
    emit('changed')
    // The parent's reload drives the row's actual removal, so the successor's
    // ✕ may not be focusable yet on the first tick; fall back to the always
    // present Add Frequency button rather than leaving focus on nothing.
    if (!(await focusRowAction(successorId, '.sdr-freq-row-del'))) {
      addFreqButtonRef.value?.focus()
    }
  } catch {
    // Nothing to roll back locally: the row is only removed once the parent's
    // reload lands, so a failed delete simply leaves it in place.
    rowStatusMessage.value = `Failed to remove ${freq.label}`
  }
}
</script>
