<template>
  <!-- ── LEFT RAIL (teleported so it persists when the side panel hides) ── -->
  <Teleport to="body">
    <div v-show="isSdrRoute" id="sdr-sidebar-rail">
      <BaseIconButton
        v-for="tab in sdrTabs"
        :key="tab.id"
        class="sdr-rail-btn"
        :class="{ 'sdr-rail-btn-active': activeSdrTab === tab.id && sidebarOpen }"
        style="
          --ba-icon-btn-tooltip-offset: 8px;
          --ba-icon-btn-tooltip-bg: rgba(10, 13, 20, 0.96);
          --ba-icon-btn-tooltip-color: #fff;
          --ba-icon-btn-tooltip-font: var(--font-primary, 'Barlow', sans-serif);
          --ba-icon-btn-tooltip-padding: 0 10px;
          --ba-icon-btn-tooltip-height: 24px;
          --ba-icon-btn-tooltip-radius: 3px;
          --ba-rail-transition: color 0.15s ease;
        "
        :active="activeSdrTab === tab.id && sidebarOpen"
        :data-tab="tab.id"
        tooltip-side="right"
        :tooltip="tab.label"
        :accessible-name="tab.label"
        @click="onSdrTabClick(tab.id)"
      >
        <!-- radio (receiver with antenna and dial) -->
        <svg
          v-if="tab.id === 'radio'"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          stroke-linecap="round"
        >
          <line x1="6" y1="9" x2="18" y2="3" stroke="currentColor" stroke-width="1.6" />
          <rect
            x="3"
            y="9"
            width="18"
            height="12"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="miter"
            fill="none"
          />
          <circle cx="16" cy="15" r="2.6" stroke="currentColor" stroke-width="1.6" />
          <line x1="6" y1="13" x2="11" y2="13" stroke="currentColor" stroke-width="1.6" />
          <line x1="6" y1="17" x2="11" y2="17" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <!-- search ranges (range brackets with sweep) -->
        <svg
          v-else-if="tab.id === 'search-ranges'"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          stroke-linecap="round"
        >
          <path d="M5 7v10M5 7h3M5 17h3" stroke="currentColor" stroke-width="1.8" />
          <path d="M19 7v10M19 7h-3M19 17h-3" stroke="currentColor" stroke-width="1.8" />
          <line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.8" />
        </svg>
        <!-- groups (stacked tags) -->
        <svg
          v-else-if="tab.id === 'groups'"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          stroke-linejoin="miter"
        >
          <path d="M4 7h10l4 4-4 4H4V7Z" stroke="currentColor" stroke-width="1.8" fill="none" />
          <circle cx="7" cy="11" r="1.1" fill="currentColor" />
        </svg>
        <!-- recordings -->
        <svg
          v-else-if="tab.id === 'recordings'"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
          <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
      </BaseIconButton>
    </div>
  </Teleport>

  <div id="sdr-panel-panes">
    <!-- ── TAB PANES ── -->
    <div class="sdr-tab-panes">
      <!-- ───────────── RADIO TAB ───────────── -->
      <div class="sdr-tab-pane sdr-tab-pane--radio" :class="{ active: activeSdrTab === 'radio' }">
        <!-- Device dropdown -->
        <div class="sdr-radio-section sdr-radio-section--device">
          <SdrDeviceSelector
            :label="deviceDropdownLabel"
            :loading="radiosLoading"
            :connected="connected"
            :selected-radio-id="selectedRadioId"
            @select="selectRadio"
          />
        </div>

        <!-- Frequency -->
        <div class="sdr-radio-section sdr-radio-section--freq">
          <div class="sdr-freq-row">
            <input
              ref="freqInputRef"
              v-model="freqInputVal"
              class="sdr-freq-input-large"
              type="text"
              aria-label="Tuned frequency in MHz"
              size="8"
              placeholder=""
              autocomplete="off"
              spellcheck="false"
              :disabled="tuningDisabled"
              :readonly="scanActive"
              @keydown.enter="tune"
              @blur="formatFreqInput"
              @wheel.prevent="onFreqWheel"
            />
            <span class="sdr-freq-unit">MHz</span>
          </div>
          <div v-if="currentFreqLabel" class="sdr-freq-name">{{ currentFreqLabel }}</div>
          <div class="sdr-freq-actions-row">
            <BasePillToggle
              class="sdr-mode-pill sdr-tune-btn"
              title="Tune"
              aria-label="Tune"
              :disabled="playDisabled || playing || scanActive || searchActive"
              @click="tune"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <polygon points="2,1 11,6 2,11" fill="currentColor" />
              </svg>
            </BasePillToggle>
            <BasePillToggle
              class="sdr-mode-pill sdr-tune-btn sdr-stop-btn"
              title="Stop audio"
              aria-label="Stop audio"
              :disabled="!playing && !scanActive && !searchActive"
              @click="stop"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
              </svg>
            </BasePillToggle>
            <BasePillToggle
              class="sdr-mode-pill sdr-tune-btn sdr-rec-btn"
              :active="isRecording"
              active-class="sdr-rec-btn--active"
              :title="isRecording ? 'Stop recording' : 'Record'"
              :aria-label="isRecording ? 'Stop recording' : 'Record'"
              :aria-pressed="isRecording"
              :disabled="!playing && !scanActive && !searchActive"
              @click="toggleRecording"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <template v-if="isRecording">
                  <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
                </template>
                <template v-else>
                  <circle cx="5" cy="5" r="4" fill="currentColor" />
                </template>
              </svg>
            </BasePillToggle>
          </div>
        </div>

        <!-- Signal meter — sits below the play/stop/record buttons, outside the
             CONTROLS accordion so it stays visible when the accordion is collapsed. -->
        <div class="sdr-radio-section">
          <span class="sdr-field-label">SIGNAL</span>
          <div
            class="sdr-signal-segments"
            :class="{ 'sdr-signal-segments--muted': !signalAudible }"
          >
            <div
              v-for="i in SIGNAL_SEGS"
              :key="i"
              class="sdr-signal-seg"
              :class="{ 'sdr-signal-seg--on': i <= signalLit }"
            ></div>
          </div>
        </div>

        <!-- Controls accordion — MODULATION demod mode pills, the DMR / P25
             digital decode pill and the nested SETTINGS accordion (open by
             default; state survives panel open/close). -->
        <div class="sdr-radio-section sdr-scan-controls">
          <BaseAccordionSection
            v-model:expanded="modeSectionExpanded"
            title="CONTROLS"
            body-id="sdr-mode-section"
          >
            <div class="sdr-radio-section">
              <label class="sdr-field-label">MODULATION</label>
              <div class="sdr-mode-pills" role="radiogroup" aria-label="Demodulation mode">
                <BasePillToggle
                  v-for="(mode, modeIndex) in MODES"
                  :key="mode"
                  class="sdr-mode-pill"
                  role="radio"
                  :aria-checked="currentMode === mode"
                  :tabindex="modeKeyboard.radioTabindex(modeIndex)"
                  :active="currentMode === mode"
                  active-class="active"
                  :disabled="tuningDisabled"
                  @click="setMode(mode)"
                  @keydown="modeKeyboard.onRadioKeydown($event, modeIndex)"
                >
                  {{ mode }}
                </BasePillToggle>
              </div>
            </div>

            <!-- Digital modes — the DMR / P25 pill toggles digital decoding AND
             shows/hides the decoder dock below the waterfall (both driven by
             digitalEnabled). -->
            <div class="sdr-radio-section">
              <label class="sdr-field-label">DIGITAL MODE</label>
              <div class="sdr-mode-pills">
                <BasePillToggle
                  class="sdr-mode-pill sdr-digital-btn"
                  :active="digitalEnabled"
                  active-class="sdr-digital-btn--active"
                  :title="digitalEnabled ? 'Hide decoder' : 'Decode digital voice'"
                  :aria-label="digitalEnabled ? 'Hide decoder' : 'Decode digital voice'"
                  :aria-pressed="digitalEnabled"
                  :disabled="!playing || aprsEnabled"
                  @click="toggleDigital"
                >
                  DMR
                </BasePillToggle>
                <!-- APRS runs in the BACKGROUND (independent of the analog view),
                     so it needs a selected radio but not `playing`. Its active
                     state is per-radio (`aprsEnabled` = "decoding on the VIEWED
                     radio"), so switching radios shows this radio's state, not
                     the global one. It is mutually exclusive with voice decode on
                     this radio (one channel), hence each disables the other. -->
                <BasePillToggle
                  class="sdr-mode-pill sdr-digital-btn"
                  :active="aprsEnabled"
                  active-class="sdr-digital-btn--active"
                  :title="aprsEnabled ? 'Stop APRS decode' : 'Decode APRS packets'"
                  :aria-label="aprsEnabled ? 'Stop APRS decode' : 'Decode APRS packets'"
                  :aria-pressed="aprsEnabled"
                  :disabled="!selectedRadioId || digitalEnabled"
                  @click="toggleAprs"
                >
                  APRS
                </BasePillToggle>
              </div>
            </div>

            <!-- Settings accordion, nested so the CONTROLS section carries the
                 full tuner control set. -->
            <div class="sdr-radio-section sdr-settings-controls">
              <SdrSettingsAccordion
                :volume="volume"
                :squelch="squelch"
                :bw-hz="bwHz"
                :bw-max="bwMax"
                :gain-db="gainDb"
                :gain-auto="gainAuto"
                :sample-rate-hz="sampleRateHz"
                :controls-disabled="controlsDisabled"
                :tuning-disabled="tuningDisabled"
                @volume-input="onVolumeInput"
                @squelch-input="onSquelchInput"
                @bw-input="onBwInput"
                @gain-input="onGainInput"
                @agc-change="onAgcChange"
                @pick-sample-rate="pickSampleRate"
              />
            </div>
          </BaseAccordionSection>
        </div>

        <!-- Frequency manager (saved frequencies) — lives in its own accordion
             between SETTINGS and SCANNER (formerly a rail tab). `activate`
             fires when one of its forms opens, so expand the accordion to keep
             the form visible. -->
        <div class="sdr-radio-section sdr-scan-controls">
          <BaseAccordionSection
            v-model:expanded="freqManagerSectionExpanded"
            title="FREQUENCY MANAGER"
            body-id="sdr-freq-manager-section"
          >
            <SdrFrequencyManagerTab
              :live="liveTuneSeed"
              :tuning-disabled="tuningDisabled"
              @play="playFreq"
              @activate="freqManagerSectionExpanded = true"
              @changed="reloadData"
            />
          </BaseAccordionSection>
        </div>

        <!-- Scan controls -->
        <div class="sdr-radio-section sdr-scan-controls">
          <BaseAccordionSection
            v-model:expanded="scannerSectionExpanded"
            title="SCANNER"
            body-id="sdr-scanner-section"
          >
            <template #header-extra>
              <div v-show="scanActive" class="sdr-scan-state-row">
                <span class="sdr-scan-state-label">{{
                  scanLocked ? 'SCANNING PAUSED' : 'SCANNING'
                }}</span>
                <div
                  class="sdr-scan-indicator"
                  :class="{
                    'sdr-scan-running': scanActive && !scanLocked,
                    'sdr-scan-holding': scanLocked,
                  }"
                ></div>
              </div>
            </template>
            <div class="sdr-scan-groups-row">
              <BasePillToggle
                class="sdr-scan-group-chip"
                :active="scanAllSelected"
                active-class="sdr-scan-group-chip-active"
                :disabled="tuningDisabled"
                @click="toggleScanAll"
              >
                All
              </BasePillToggle>
              <BasePillToggle
                v-for="g in groupsWithFreqs"
                :key="g.id"
                class="sdr-scan-group-chip"
                :active="!scanAllSelected && scanSelectedGroupIds.includes(g.id)"
                active-class="sdr-scan-group-chip-active"
                :disabled="tuningDisabled"
                @click="toggleScanGroup(g.id)"
              >
                {{ g.name }}
              </BasePillToggle>
            </div>
            <div class="sdr-scan-btns-row sdr-scan-btns-row--left">
              <button
                type="button"
                class="sdr-search-adhoc-play"
                :class="{ 'sdr-search-adhoc-play--active': scanActive }"
                :disabled="tuningDisabled"
                :aria-label="scanActive ? 'Stop scan' : 'Start scan'"
                :title="scanActive ? 'Stop scan' : 'Start scan'"
                @click="onScanPrimaryClick"
              >
                <svg
                  v-if="scanActive"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect x="1" y="1" width="8" height="8" fill="currentColor" />
                </svg>
                <svg
                  v-else
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <polygon points="2,1 11,6 2,11" fill="currentColor" />
                </svg>
              </button>
            </div>
          </BaseAccordionSection>
        </div>

        <!-- Search controls (low/high range sweep) -->
        <div class="sdr-radio-section sdr-scan-controls">
          <BaseAccordionSection
            v-model:expanded="searchSectionExpanded"
            title="SEARCH"
            body-id="sdr-search-section"
          >
            <template #header-extra>
              <div v-show="searchActive" class="sdr-scan-state-row">
                <span class="sdr-scan-state-label">{{
                  searchLocked ? 'SEARCHING PAUSED' : 'SEARCHING'
                }}</span>
                <div
                  class="sdr-scan-indicator"
                  :class="{
                    'sdr-scan-running': searchActive && !searchLocked,
                    'sdr-scan-holding': searchLocked,
                  }"
                ></div>
              </div>
            </template>
            <div class="sdr-search-adhoc-row">
              <div class="sdr-search-adhoc-col">
                <label class="sdr-field-label">LOW (MHz)</label>
                <input
                  v-model="adhocLowMhz"
                  class="sdr-panel-input sdr-search-adhoc-input"
                  aria-label="Search range low frequency in MHz"
                  type="number"
                  step="0.0001"
                  required
                  :disabled="controlsDisabled || searchActive"
                />
              </div>
              <div class="sdr-search-adhoc-col">
                <label class="sdr-field-label">HIGH (MHz)</label>
                <input
                  v-model="adhocHighMhz"
                  class="sdr-panel-input sdr-search-adhoc-input"
                  aria-label="Search range high frequency in MHz"
                  type="number"
                  step="0.0001"
                  required
                  :disabled="controlsDisabled || searchActive"
                />
              </div>
              <div class="sdr-search-adhoc-col">
                <label class="sdr-field-label">STEP</label>
                <SdrStepPicker
                  v-model="adhocStepKhz"
                  :disabled="controlsDisabled || searchActive"
                />
              </div>
              <div class="sdr-search-adhoc-col sdr-search-adhoc-col--play">
                <button
                  type="button"
                  class="sdr-search-adhoc-play"
                  :class="{ 'sdr-search-adhoc-play--active': isAdhocSearching }"
                  :disabled="tuningDisabled || (!adhocSearchValid && !isAdhocSearching)"
                  :aria-label="isAdhocSearching ? 'Stop search' : 'Start search'"
                  :title="isAdhocSearching ? 'Stop search' : 'Start search'"
                  @click="onAdhocPlayClick"
                >
                  <svg
                    v-if="isAdhocSearching"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect x="1" y="1" width="8" height="8" fill="currentColor" />
                  </svg>
                  <svg
                    v-else
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <polygon points="2,1 11,6 2,11" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="sdr-search-saved-ranges">
              <BaseAccordionSection
                v-model:expanded="savedRangesExpanded"
                title="SAVED RANGES"
                body-id="sdr-saved-ranges-section"
              >
                <div v-if="searchRanges.length > 0" class="sdr-search-range-list">
                  <div
                    v-for="r in searchRanges"
                    :key="r.id"
                    class="sdr-search-range-item"
                    :class="{ 'sdr-search-range-item-active': searchSelectedRangeId === r.id }"
                    :title="`step ${(r.step_hz / 1000).toFixed(2)} kHz · ${r.mode}`"
                  >
                    <button
                      type="button"
                      class="sdr-search-range-item-body"
                      :disabled="tuningDisabled"
                      @click="selectSearchRange(r.id)"
                    >
                      <span class="sdr-search-range-primary">{{ r.label }}</span>
                      <span class="sdr-search-range-secondary"
                        >{{ (r.low_hz / 1e6).toFixed(3) }}–{{
                          (r.high_hz / 1e6).toFixed(3)
                        }}
                        MHz</span
                      >
                    </button>
                    <button
                      type="button"
                      class="sdr-search-range-item-play"
                      :class="{ 'sdr-search-range-item-play--active': isSavedRangeSearching(r.id) }"
                      :disabled="tuningDisabled"
                      :aria-label="isSavedRangeSearching(r.id) ? 'Stop search' : 'Start search'"
                      :title="isSavedRangeSearching(r.id) ? 'Stop search' : 'Start search'"
                      @click.stop="onSavedRangePlayClick(r.id)"
                    >
                      <svg
                        v-if="isSavedRangeSearching(r.id)"
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect x="1" y="1" width="8" height="8" fill="currentColor" />
                      </svg>
                      <svg
                        v-else
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <polygon points="2,1 11,6 2,11" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div v-else class="sdr-scan-subsection-label" style="opacity: 0.6">
                  No ranges defined — add some in Frequency Manager.
                </div>
              </BaseAccordionSection>
            </div>
          </BaseAccordionSection>
        </div>

        <!-- Trunk-system channel-map picker + FOLLOW button. Lives in its own
             accordion below SEARCH; only shown when trunk tracking is enabled
             in Settings and while digital decode is running (the trunk control
             rides on the decode session). -->
        <SdrTrunkSection
          v-if="trunkTrackingEnabled && digitalEnabled"
          v-model:expanded="trunkSectionExpanded"
          v-model:channel-map="trunkChannelMap"
          :trunk-enabled="trunkEnabled"
          :channel-maps="trunkChannelMaps"
          :can-follow="canEnableTrunk"
          :trunk-error="trunkError"
          @toggle-follow="toggleTrunk"
        />
      </div>

      <!-- ───────────── SEARCH RANGES TAB ───────────── -->
      <div class="sdr-tab-pane" :class="{ active: activeSdrTab === 'search-ranges' }">
        <SdrSearchRangesTab
          :ranges="searchRanges"
          @before-delete="onRangeBeforeDelete"
          @changed="reloadSearchRanges"
        />
      </div>

      <!-- ───────────── GROUPS TAB ───────────── -->
      <div class="sdr-tab-pane" :class="{ active: activeSdrTab === 'groups' }">
        <SdrGroupsTab @changed="reloadData" />
      </div>

      <!-- ───────────── RECORDINGS TAB ───────────── -->
      <div class="sdr-tab-pane" :class="{ active: activeSdrTab === 'recordings' }">
        <SdrRecordingsSection
          ref="recordingsSectionRef"
          :live-recording="liveRecording"
          :rec-squelch-open="recSquelchOpen"
          :live-elapsed-s="liveElapsedS"
          @stop-recording="stopRecordingIfActive"
          @playback-active="(active: boolean) => sdrAudio.setLiveMuted(active)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import './SdrPanel.css'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSdrAudio } from '@/composables/useSdrAudio'
import { useSdrDecode } from '@/composables/useSdrDecode'
import { useSdrAutoTune } from '@/composables/useSdrAutoTune'
import { useSdrControlSocket } from '@/composables/useSdrControlSocket'
import { useSdrDigitalDecode } from '@/composables/useSdrDigitalDecode'
import { useSdrFreqDigitWheel } from '@/composables/useSdrFreqDigitWheel'
import { useSdrRadioSelection } from '@/composables/useSdrRadioSelection'
import { useSdrRecording } from '@/composables/useSdrRecording'
import { useSdrSweepEngine } from '@/composables/useSdrSweepEngine'
import { useDocumentEvent } from '@/composables/useDocumentEvent'
import { useRadioGroupKeyboard } from '@/composables/useRadioGroupKeyboard'
import SdrRecordingsSection from './SdrRecordingsSection.vue'
import SdrGroupsTab from './SdrGroupsTab.vue'
import SdrSearchRangesTab from './SdrSearchRangesTab.vue'
import SdrStepPicker from './SdrStepPicker.vue'
import SdrFrequencyManagerTab from './SdrFrequencyManagerTab.vue'
import SdrDeviceSelector from './SdrDeviceSelector.vue'
import SdrSettingsAccordion from './SdrSettingsAccordion.vue'
import SdrTrunkSection from './SdrTrunkSection.vue'
import type { SdrLiveTuneSeed } from './SdrFrequencyManagerTab.vue'
import BaseAccordionSection from '@/components/base/BaseAccordionSection.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import BasePillToggle from '@/components/base/BasePillToggle.vue'
import { useSdrStore } from '@/stores/sdr'
import type { SdrMode, SdrTab, SdrRadio, SdrFrequencyGroup, SdrStoredFrequency } from '@/stores/sdr'
import { useNotificationsStore } from '@/stores/notifications'

// SdrRadio / SdrFrequencyGroup / SdrStoredFrequency now come from the SDR
// store (see stores/sdr.ts) — it owns loading radios/groups/frequencies, so
// the shape lives in one place instead of a duplicated local interface.
defineProps<{ fullPage: boolean }>()

const sdrAudio = useSdrAudio()
const sdrDecode = useSdrDecode()

// Lazy store accessor. MUST be declared here — above every watcher that calls
// it — not lower in the file. `_sdrStore` is a hoisted function so it is
// *callable* early, but its body closes over the `let _spectrumStore` binding.
// The `{ immediate: true }` watchers below fire synchronously during setup and
// call _sdrStore(); if `let _spectrumStore` is declared further down it is
// still in its temporal dead zone at that point → "ReferenceError: Cannot
// access '_spectrumStore' before initialization" (the crash on every SDR page
// load). Keeping the declaration before the watchers is load-bearing.
let _spectrumStore: ReturnType<typeof useSdrStore> | null = null
function _sdrStore() {
  if (!_spectrumStore) _spectrumStore = useSdrStore()
  return _spectrumStore
}

let _notifStore: ReturnType<typeof useNotificationsStore> | null = null
function _notificationsStore() {
  if (!_notifStore) _notifStore = useNotificationsStore()
  return _notifStore
}

// Read-only follower: the shared dongle is currently owned by another Sentinel
// instance over the relay control channel. Drives the read-only banner and
// disables this instance's hardware tuning controls (frequency, gain, sample
// rate, scan, search). False for a single instance or a free/unowned tuner.
const readOnly = computed(() => _sdrStore().readOnly)

// Visual disable for controls a read-only follower must NOT drive: disabled when
// there's no usable radio (controlsDisabled) OR this instance is a follower. This
// now also covers mode + bandwidth: under the "mirror the owner exactly" model a
// follower reproduces the owner's demod (offset/mode/bandwidth) and can't diverge
// from it. Purely per-listener controls (volume, squelch) stay on controlsDisabled
// so each watcher keeps its own audio level/gating while still mirroring the tune.
const tuningDisabled = computed(() => controlsDisabled.value || readOnly.value)

// Play/listen is a LOCAL action: it opens this instance's own IQ socket and
// demodulates in-browser, so it must NOT be blocked when another instance owns
// the shared tuner. A read-only follower still needs to press Play to start
// receiving spectrum/waterfall/audio for the band the owner is tuned to — hence
// this gates on controlsDisabled (radio usable) only, not tuningDisabled. When
// the tuner is free (not readOnly) a Play still sends a real tune and claims it,
// unchanged; when read-only, sendCmd suppresses the hardware tune (see sendCmd).
const playDisabled = computed(() => controlsDisabled.value)

// The satellite auto-tune reconciliation (AOS retune queue, pre-AOS snapshot
// and LOS restore, lock-in priority, record-the-pass) lives in useSdrAutoTune,
// instantiated below once its injected chokepoints exist.

const SIGNAL_SEGS = 36

// ── Active tab ────────────────────────────────────────────────────────────────
const SDR_TAB_KEY = 'sentinel_sdr_tab'
const sdrTabs: ReadonlyArray<{ id: SdrTab; label: string }> = [
  { id: 'radio', label: 'RADIO' },
  { id: 'groups', label: 'GROUPS' },
  { id: 'search-ranges', label: 'SEARCH RANGES' },
  { id: 'recordings', label: 'RECORDINGS' },
]
function _restoreSdrTab(): SdrTab {
  try {
    const v = sessionStorage.getItem(SDR_TAB_KEY) as SdrTab | null
    if (v && sdrTabs.some((t) => t.id === v)) return v
  } catch {}
  return 'radio'
}
const activeSdrTab = ref<SdrTab>(_restoreSdrTab())
// Seed the store mirror so the footer indicator reflects the restored tab from
// first paint (before any user tab switch).
_sdrStore().setActiveTab(activeSdrTab.value)
function switchSdrTab(tab: SdrTab) {
  activeSdrTab.value = tab
  _sdrStore().setActiveTab(tab)
  try {
    sessionStorage.setItem(SDR_TAB_KEY, tab)
  } catch {}
}

const route = useRoute()
const isSdrRoute = computed(() => route.path.startsWith('/sdr'))
const sidebarOpen = ref<boolean>(_readSidebarOpen())
function _readSidebarOpen(): boolean {
  try {
    return sessionStorage.getItem('sentinel_sidebar_open') === '1'
  } catch {
    return false
  }
}
function onSdrTabClick(tab: SdrTab) {
  if (activeSdrTab.value === tab && sidebarOpen.value) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-toggle-panel'))
    return
  }
  switchSdrTab(tab)
  if (!sidebarOpen.value) {
    document.dispatchEvent(new CustomEvent('sentinel:sdr-open-panel'))
  }
}
useDocumentEvent('sentinel:sidebar-state', (e: Event) => {
  sidebarOpen.value = !!(e as CustomEvent<{ open: boolean }>).detail?.open
})

// The config JSON editor (Settings → App Settings → Application Config) just
// replaced the DB settings. Re-hydrate the sdr store's cached
// autoCenterWaterfallOnTune so a change made there takes effect on the live
// waterfall immediately — SdrPanel is mounted for the whole SDR session, so
// this stays in sync even when the Settings SDR control isn't mounted.
useDocumentEvent('sentinel:config-uploaded', () => {
  void _sdrStore().hydrateAutoCenterFromDb()
  void _sdrStore().hydrateResumeDelaySecFromDb()
  void _sdrStore().hydrateMuteAudioWhileDecodingFromDb()
})

const recordingsSectionRef = ref<InstanceType<typeof SdrRecordingsSection> | null>(null)

// ── Radio state ───────────────────────────────────────────────────────────────
const connected = ref(false)
const playing = ref(false)
// Mirror play state into the store so SdrWaterfall can gate its rendering.
// A single passive watch — deliberately does NOT alter any existing
// play-state logic (avoids the regression that earlier setPlayingState
// substitutions risked).
watch(playing, (v) => {
  _sdrStore().setPlaying(v)
})
// Mirror device reachability into the store so other components (e.g. the
// air-domain airport list) can gate SDR tuning on whether a radio is connected.
watch(
  connected,
  (v) => {
    _sdrStore().setConnected(v)
  },
  { immediate: true },
)
const controlsDisabled = ref(true)
const selectedRadioId = ref<number | null>(null)
// Store-owned: the SDR store fetches/holds the configured radios (loadRadios);
// this panel only reads them (dropdown, auto-select) and drives the fetch via
// the store action — see loadRadios()/populateRadios() below.
const knownRadios = computed<SdrRadio[]>(() => _sdrStore().radios)
const currentMode = ref('AM')
const freqInputVal = ref('')
const freqInputRef = ref<HTMLInputElement | null>(null)
const currentFreqHz = ref(0)
const gainDb = ref(30)
const gainAuto = ref(false)
const volume = ref(80)
const squelch = ref(-30)
const bwHz = ref(10000)
const bwMax = ref(2048000)
// Hardware sample rate (rtl_tcp): governs the spectrum/waterfall x-axis span
// and is fully independent of the demod-filter Bandwidth slider above.
// SAMPLE_RATE_OPTIONS (shared with the frequency-manager forms) lives in
// sdrPanelUtils.ts next to snapToValidSampleRate().
const sampleRateHz = ref<number>(2048000)
// Resume delay is owned by the SDR store (Settings → SDR → SCAN & SEARCH).
// Wrapped in a computed so the existing watcher code keeps using
// `resumeDelaySec.value` unchanged.
const resumeDelaySec = computed<number>(() => _sdrStore().resumeDelaySec)
const activeFreqDisplay = ref('')
const signalSmoothed = ref(-120)
const signalLit = ref(0)
const worklestSquelchOpen = ref(true)

// ── Store mirrors / marker bridge ─────────────────────────────────────────────
// Passive mirrors so the spectrum/waterfall marker (SdrWaterfall, a sibling)
// can read the authoritative tuned freq + demod bandwidth. These fire on EVERY
// existing path that mutates the local refs (tune, tuneToFreq, setMode,
// onBwInput, applyStatus) — no changes to those functions.
watch(
  currentFreqHz,
  (v) => {
    if (v) _sdrStore().setFrequency(v)
  },
  { immediate: true },
)
watch(
  bwHz,
  (v) => {
    _sdrStore().setBandwidthHz(v)
  },
  { immediate: true },
)

// Collapse the Scanner + Search accordions whenever the side panel opens,
// so the user starts from a clean state instead of inheriting prior expansion.
watch(
  () => _sdrStore().panelOpen,
  (open) => {
    if (open) {
      freqManagerSectionExpanded.value = false
      scannerSectionExpanded.value = false
      searchSectionExpanded.value = false
      savedRangesExpanded.value = false
      trunkSectionExpanded.value = false
    }
  },
)

// Demod NCO offset bridge. The store is the single source of truth for the
// offset from the hardware centre (set by the waterfall click handler when
// auto-centre is OFF, cleared to 0 by the ON path / toggle). Push every change
// into the audio worklet. immediate so a restored 0 is asserted on mount.
watch(
  () => _sdrStore().tuningOffsetHz,
  (hz) => {
    sdrAudio.setOffsetHz(hz || 0)
  },
  { immediate: true },
)

// Marker retune request. The bar/marker only moves once currentFreqHz updates
// (the waterfall watches it via applyMarker), so update the display state
// immediately for snappy click-to-tune — only debounce the hardware sendCmd
// and the persistent saves so rapid drags still coalesce.
watch(
  () => _sdrStore().tuneRequest,
  (req) => {
    if (!req || !playing.value || !selectedRadioId.value) return
    const hz = Math.round(req.hz)
    if (!hz || hz === currentFreqHz.value) return
    currentFreqHz.value = hz
    activeFreqDisplay.value = (hz / 1e6).toFixed(3) + ' MHz'
    freqInputVal.value = (hz / 1e6).toFixed(4)
    // A freq-axis drag-pan (req.center) commits exactly ONCE on mouse release, so
    // it needs no coalescing debounce — retune the hardware IMMEDIATELY so the
    // panned view fills with real data without the ~600ms lag. The pan means
    // "move the hardware centre" regardless of the auto-centre toggle. (Marker
    // drags / typed freqs still debounce below to coalesce continuous updates.)
    if (req.center) {
      if (_retuneDebounce) clearTimeout(_retuneDebounce)
      sendCmd({ cmd: 'tune', frequency_hz: hz })
      // Persist (best-effort) without blocking the retune.
      _retuneDebounce = setTimeout(() => {
        sessionStorage.setItem('sdrLastFreqHz', String(hz))
        saveSettings()
      }, 600)
      return
    }
    if (_retuneDebounce) clearTimeout(_retuneDebounce)
    _retuneDebounce = setTimeout(() => {
      sessionStorage.setItem('sdrLastFreqHz', String(hz))
      saveSettings()
      // Auto-centre OFF: do NOT retune the hardware — the demod NCO offset
      // (already set in the store by the waterfall click) tunes the audio while
      // the display stays put. Calling sendCmd('tune') here would both recenter
      // the hardware AND clear the offset (sendCmd zeroes it on any tune), so
      // skip it.
      if (_sdrStore().autoCenterWaterfallOnTune) {
        sendCmd({ cmd: 'tune', frequency_hz: hz })
      }
    }, 600)
  },
)

// Waterfall FFT-size request. The waterfall sizes its desired bin count to the
// canvas's device-pixel width so each bin maps to ~1 px (no blur from upsampling
// a 1024-bin FFT into a 2600+ px canvas). Forwarded straight to the backend; it
// clamps to a power of two in [MIN_FFT_SIZE, MAX_FFT_SIZE].
watch(
  () => _sdrStore().fftSizeRequest,
  (req) => {
    // requestFftSize only ever assigns a non-null payload, and the watch fires
    // on change, so req is always present here.
    /* v8 ignore start */
    if (!req) return
    /* v8 ignore stop */
    sendCmd({ cmd: 'fft_size', bins: req.bins })
  },
)

// Marker bandwidth request — demod audio filter ONLY (no sample_rate command;
// matches SDR++/SDR#/GQRX and avoids the rtl_tcp reconfigure stall).
watch(
  () => _sdrStore().bwRequest,
  (req) => {
    if (!req || !playing.value) return
    const v = Math.round(req.hz)
    if (!v || v === bwHz.value) return
    bwHz.value = v // re-mirrors to the store via the watch above
    saveSettings()
    sdrAudio.setBandwidthHz(v)
  },
)

const signalAudible = computed(
  () => playing.value && (squelch.value <= -119 || worklestSquelchOpen.value),
)

// ── Device dropdown ───────────────────────────────────────────────────────────
// The combobox UI (listbox menu, keyboard nav, padlock rows) lives in
// SdrDeviceSelector.vue; it emits `select` into selectRadio (from
// useSdrRadioSelection below), which also owns the engine-written display
// state (radiosLoading / deviceDropdownLabel) passed down as props.

// ── Scanner + search (sweep engine) ───────────────────────────────────────────
// The scanner and range-search engines — with their shared post-tune race
// guard, latest-spectrum stash, channel sampler and auto-resume watcher —
// live in useSdrSweepEngine, instantiated below once its injected chokepoints
// (sendCmd, tuneToFreq/tuneToHzMode) exist. Only accordion view state stays
// here.
const searchSectionExpanded = ref(false)
const savedRangesExpanded = ref(false)
const _rangesSectionExpanded = ref(false)

// ── Groups + frequencies ──────────────────────────────────────────────────────
// Store-owned: the SDR store fetches/holds groups and frequencies
// (loadGroups/loadFrequencies) so SdrWaterfall's known-frequency markers read
// the same data with no prop-drilling. This panel reads them as computeds and
// drives the fetch via reloadData() below, which calls the store actions.
const freqs = computed<SdrStoredFrequency[]>(() => _sdrStore().frequencies)
const scannerSectionExpanded = ref(false)
const freqManagerSectionExpanded = ref(false)
// Mode/digital/signal accordion — open by default and (like SETTINGS) not
// collapsed when the panel reopens; these are the primary tuning controls.
const modeSectionExpanded = ref(true)

const currentFreqLabel = computed<string>(() => {
  const hz = currentFreqHz.value
  if (!hz) return ''
  const match = freqs.value.find((f) => f.frequency_hz === hz)
  return match?.label || ''
})

// Store-owned since P4 (the store owns freqs+groups) — shared with the
// Frequency Manager tab's group filter.
const groupsWithFreqs = computed<SdrFrequencyGroup[]>(() => _sdrStore().groupsWithFreqs)

// The scanner-state store mirror, the owner→follower sweep_state publish and
// the read-only sweep-mirror clear all live in useSdrSweepEngine (below).

// ── Edit frequency panel ──────────────────────────────────────────────────────
// The FREQUENCY MANAGER accordion (freq list, group filter and the add/edit
// forms with their RADIO SETTINGS grid) lives in SdrFrequencyManagerTab.vue.
// The panel supplies the `live` seed (current radio state) and reacts to its
// events: play (tune to a stored frequency), activate (expand the accordion
// so an opening form is visible) and changed (full data reload).

// The parent's live radio state, seeding the tab's add/edit forms.
const liveTuneSeed = computed<SdrLiveTuneSeed>(() => ({
  freqHz: currentFreqHz.value,
  mode: currentMode.value,
  gainAuto: gainAuto.value,
  gainDb: gainDb.value,
  bwHz: bwHz.value,
  squelch: squelch.value,
  volume: volume.value,
  sampleRateHz: sampleRateHz.value,
}))

// ── Recording state (live recording props passed to SdrRecordingsSection) ─────
// The recording state machine (REC start/stop, the live elapsed timer and its
// squelch-pause accounting) lives in useSdrRecording; the panel injects the
// live tune refs and useSdrAudio's capture functions so the clip metadata and
// timer cadence are unchanged.
const {
  isRecording,
  recSquelchOpen,
  liveElapsedS,
  liveRecording,
  toggleRecording,
  startRecording: _startRecording,
  endRecordingOnManualChange: _endRecordingOnManualChange,
  stopRecordingIfActive,
  onRecordingSquelchChange,
  clearLiveRecordingTimer,
} = useSdrRecording({
  selectedRadioId,
  knownRadios,
  currentFreqHz,
  currentMode,
  gainDb,
  squelch,
  startAudioRecording: sdrAudio.startRecording,
  stopAudioRecording: sdrAudio.stopRecording,
  reloadRecordings: () => recordingsSectionRef.value?.reload(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

import { parseFreqMhz, defaultBwHz, MODES, SAMPLE_RATE_OPTIONS } from './sdrPanelUtils'

function saveSettings() {
  try {
    sessionStorage.setItem(
      'sdrSettings',
      JSON.stringify({
        gainDb: gainDb.value,
        gainAuto: gainAuto.value,
        squelch: squelch.value,
        bwHz: bwHz.value,
        vol: volume.value,
        mode: currentMode.value,
        freqHz: currentFreqHz.value,
        sampleRateHz: sampleRateHz.value,
      }),
    )
  } catch (_) {}
}

function restoreSettings() {
  try {
    const raw = sessionStorage.getItem('sdrSettings')
    if (!raw) return
    const s = JSON.parse(raw)
    if (s.freqHz > 0) {
      currentFreqHz.value = s.freqHz
      freqInputVal.value = (s.freqHz / 1e6).toFixed(4)
      activeFreqDisplay.value = (s.freqHz / 1e6).toFixed(3) + ' MHz'
    }
    if (s.mode) currentMode.value = s.mode
    if (typeof s.gainDb === 'number') {
      gainDb.value = s.gainDb
      gainAuto.value = !!s.gainAuto
    }
    if (typeof s.squelch === 'number') squelch.value = s.squelch
    if (typeof s.bwHz === 'number' && s.bwHz > 0) bwHz.value = s.bwHz
    if (typeof s.vol === 'number') {
      volume.value = s.vol
      sdrAudio.setVolume(s.vol / 100)
    }
    if (
      typeof s.sampleRateHz === 'number' &&
      SAMPLE_RATE_OPTIONS.includes(s.sampleRateHz as (typeof SAMPLE_RATE_OPTIONS)[number])
    ) {
      sampleRateHz.value = s.sampleRateHz
      bwMax.value = s.sampleRateHz
    }
  } catch (_) {}
}

// ── Control WebSocket ─────────────────────────────────────────────────────────
// The transport layer (socket handle, exponential reconnect backoff, stale-
// socket supersede guards, per-radio init markers, the connection-dot
// reachability probe and the sendCmd chokepoint with its read-only/offset
// policy) lives in useSdrControlSocket. The panel keeps the semantics: the
// on-open restore chain (onCtrlSocketOpen) and the per-frame message handling
// (onCtrlSocketMessage) below. The socket deliberately stays OPEN on unmount
// (SdrTabPanel persists across navigation) — the composable registers no
// lifecycle hooks, and open/close stay caller-driven.
const {
  sendCmd,
  openControlSocket,
  closeControlSocket,
  isDataConfirmed,
  setDataConfirmed,
  isSocketOpen,
  isSocketConnecting,
  markInitialised: _markInitialised,
  isInitialised: _isInitialised,
} = useSdrControlSocket({
  sdrStore: _sdrStore,
  onSocketOpen: onCtrlSocketOpen,
  onSocketMessage: onCtrlSocketMessage,
  onSocketDown: () => setStatus(false),
  onRadioMissing: () => {
    // The stale sdrLastRadioId + socket are already cleared; reset the selection UI.
    selectedRadioId.value = null
    deviceDropdownLabel.value = '— select radio —'
    controlsDisabled.value = true
  },
  onReachable: () => {
    connected.value = true
  },
  isRadioStillSelected: (radioId) => selectedRadioId.value === radioId,
  isAlreadyConnected: () => connected.value,
})

// ── Digital decode (dsd-fme sidecar) + trunk tracking ─────────────────────────
// The decode/trunk engine (backend digital_decode / trunk_decode /
// digital_channel commands, decode-socket + analog-mute choreography, the
// channel-map fetch and the digital↔trunk reconciliation watchers) lives in
// useSdrDigitalDecode; the panel injects sendCmd and its tuner refs so the
// command cadence is unchanged.
const {
  digitalEnabled,
  setDigital,
  toggleDigital,
  trunkTrackingEnabled,
  trunkEnabled,
  trunkChannelMap,
  trunkChannelMaps,
  trunkError,
  canEnableTrunk,
  loadChannelMaps,
  toggleTrunk,
} = useSdrDigitalDecode({
  sdrStore: _sdrStore,
  sendCmd,
  selectedRadioId,
  bwHz,
  currentMode,
  startDecode: sdrDecode.start,
  stopDecode: sdrDecode.stop,
  setLiveMuted: sdrAudio.setLiveMuted,
})

// ── APRS decode (Direwolf sidecar) ────────────────────────────────────────────
// APRS runs in the BACKGROUND on the selected radio (independent of the analog
// view and of digital voice — they can run concurrently on separate dongles), so
// it is driven by the store's HTTP start/stop endpoints rather than the spectrum
// WS. The panel still opens the decode event socket so the waterfall panels show
// the packets, and clears the decode buffers so the dock switches cleanly.
// Whether APRS is decoding on the radio currently being VIEWED. The store's
// aprsEnabled is global (decode continues in the background whichever radio the
// panel shows), so the button must key off the decoding radio instead —
// otherwise it stays lit after switching radios and a click would stop decode on
// a radio that was never decoding.
const aprsEnabled = computed(
  () => _sdrStore().aprsRadioId != null && _sdrStore().aprsRadioId === selectedRadioId.value,
)

// APRS traffic is data, not speech, so the radio decoding it is muted while it
// does — but ONLY that radio (store.aprsRadioId, set when the backend accepts
// the start). Any other radio the user has tuned to a voice frequency keeps its
// audio. Honours the "Mute Audio While Decoding" setting, and re-runs when the
// setting, the decoding radio or the viewed radio changes so it applies live.
// `immediate` so a reload with APRS already running mutes without a toggle.
watch(
  [
    () => _sdrStore().aprsRadioId,
    () => _sdrStore().muteAudioWhileDecoding,
    selectedRadioId,
    playing,
  ],
  () => {
    const decodingRadioId = _sdrStore().aprsRadioId
    const shouldMute = decodingRadioId != null && _sdrStore().muteAudioWhileDecoding
    sdrAudio.setLiveMuted(shouldMute, 'aprs', decodingRadioId ?? 'all')
  },
  { immediate: true },
)

async function toggleAprs() {
  const radioId = selectedRadioId.value
  if (!radioId) return
  // Toggling acts on the VIEWED radio: stop only when it is the one decoding,
  // otherwise start here. The backend runs a single APRS bridge, so starting on
  // another radio hands decode over rather than running two.
  const next = !aprsEnabled.value
  _sdrStore().setAprsEnabled(next)
  _sdrStore().clearDecode()
  if (next) {
    const started = await _sdrStore().startAprs(radioId, _sdrStore().tuningOffsetHz, bwHz.value)
    if (!started) {
      _sdrStore().setAprsEnabled(false)
      return
    }
    sdrDecode.start(radioId)
  } else {
    sdrDecode.stop()
    await _sdrStore().stopAprs(radioId)
    _sdrStore().clearDecode()
  }
}

// Trunk-system accordion (sits below SEARCH). The accordion body, its
// flat-dark channel-map dropdown (with its own teleported menu + dismissal)
// and the FOLLOW button live in SdrTrunkSection.vue; only the expanded flag
// stays here so the panel-open watch above can collapse it with its siblings.
const trunkSectionExpanded = ref(false)

// ── Radio selection ───────────────────────────────────────────────────────────
// Manual select/deselect, the radio-list load (with its sessionStorage cache)
// and the remembered/sole-enabled auto-select live in useSdrRadioSelection;
// the panel injects its socket/audio/state chokepoints so the selection
// choreography is unchanged.
const { radiosLoading, deviceDropdownLabel, selectRadio, loadRadios } = useSdrRadioSelection({
  sdrStore: _sdrStore,
  selectedRadioId,
  controlsDisabled,
  playing,
  setPlayingState,
  setStatus,
  stopAudio: sdrAudio.stop,
  setDigital,
  releaseOwnershipIfHeld,
  openControlSocket,
  closeControlSocket,
})

// Publish this instance's within-band demod state (NCO offset, mode, audio
// bandwidth) to the backend so it can forward it over the relay control channel
// to read-only followers — letting watchers mirror the EXACT channel this owner
// is listening to, not just the hardware centre. Only while playing and not a
// follower ourselves (a follower mirrors; it never publishes). Guarded so a
// single instance / raw rtl_tcp harmlessly no-ops on the backend.
watch([() => _sdrStore().tuningOffsetHz, bwHz, currentMode, playing], () => {
  if (!playing.value || _sdrStore().readOnly) return
  sendCmd({
    cmd: 'demod',
    offset_hz: _sdrStore().tuningOffsetHz,
    bw_hz: bwHz.value,
    mode: currentMode.value,
  })
})

// Restore chain run inside the control socket's 'open' listener (the transport
// in useSdrControlSocket has already reset the reconnect delay and kicked off
// the reachability probe when this fires).
function onCtrlSocketOpen(radioId: number) {
  // The restored highlight (currentMode, from sdrSettings via restoreSettings)
  // is the single source of truth — not sdrLastMode, which setMode does not
  // update and can be stale after a mode change. Using it kept the audio/
  // backend demod mode out of sync with the highlighted button across a reload.
  const lastMode = currentMode.value as SdrMode
  if (!_isInitialised(radioId)) _markInitialised(radioId)
  if (sessionStorage.getItem('sdrPlaying') === '1') {
    playing.value = true
    sdrAudio.setMode(lastMode)
    // Restore the demod bandwidth as well. The backend only ever sends a single
    // connected=false status frame (connected state is driven client-side by
    // spectrum frames), so applyStatus never runs its bandwidth push on reload.
    // Without this the worklet keeps its default bandwidth of 0 — which it
    // treats as whole-span passthrough — so the audio is wideband noise that
    // doesn't sound like the restored mode until the user re-clicks the mode
    // button (the only other code path that sets the bandwidth). bwHz is the
    // value restored by restoreSettings (or the sensible 10 kHz default). It
    // must be pushed AFTER initAudio creates the worklet, hence the chain.
    const restoredBwHz = bwHz.value
    void Promise.resolve(sdrAudio.initAudio(radioId)).then(() => {
      sdrAudio.setBandwidthHz(restoredBwHz)
    })
    // Re-assert the restored demod mode to the backend so its reported state
    // matches the highlighted button. Without this, a backend connection that
    // was recreated (defaulting to AM) reports a mode that diverges from the
    // restored highlight, leaving the radio demodulating the wrong mode until
    // the user re-clicks the mode button.
    sendCmd({ cmd: 'mode', mode: lastMode })
  }
  // Replay the most recent waterfall-driven FFT size request, if any. The
  // waterfall publishes its target bin count on mount, which may have fired
  // before this socket opened (sendCmd silently drops while CONNECTING).
  const fftReq = _sdrStore().fftSizeRequest
  if (fftReq) sendCmd({ cmd: 'fft_size', bins: fftReq.bins })
  // Push the restored hardware sample rate so the backend's span matches
  // what the user last picked, instead of whatever the device default is.
  sendCmd({ cmd: 'sample_rate', rate_hz: sampleRateHz.value })
  // Apply a queued auto-tune now that the socket can accept commands.
  drainPendingExternalTune()
}

// Per-frame control-socket message handling (the transport JSON-parses every
// frame and dispatches it here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic WS JSON payload; discriminated on msg.type and field-cast at use sites
function onCtrlSocketMessage(msg: any) {
  switch (msg.type) {
    case 'status':
      applyStatus(msg)
      applyOwnership(msg)
      // Only trust the device-reported mode once it's actually connected, to
      // match applyStatus (which gates currentMode/the button highlight the
      // same way). An initial connected=false status after a refresh carries
      // the backend's default mode and must not clobber the restored demod
      // mode — otherwise the highlight and the audio demod diverge.
      if (msg.connected) {
        sdrAudio.setMode(msg.mode as SdrMode)
        sessionStorage.setItem('sdrLastMode', msg.mode)
      }
      if (!sessionStorage.getItem('sdrLastFreqHz') || !currentFreqHz.value) {
        sessionStorage.setItem('sdrLastFreqHz', String(msg.center_hz))
      }
      break
    case 'spectrum':
      if (!isDataConfirmed()) {
        setDataConfirmed(true)
        setStatus(true)
      }
      if (Array.isArray(msg.bins)) {
        _sdrStore().setSpectrum({
          bins: msg.bins,
          center_hz: msg.center_hz,
          sample_rate: msg.sample_rate,
          ts: msg.timestamp_ms,
        })
        // Feed the sweep engine's spectrum stash + post-tune race guard.
        noteSpectrumFrame({
          bins: msg.bins as number[],
          center_hz: msg.center_hz as number,
          sample_rate: msg.sample_rate as number,
        })
      }
      break
    case 'control':
      // Tuning ownership changed (another instance took/released the shared
      // dongle, or this client's retune was refused). Reflect it so the UI
      // disables tuning + shows the read-only banner, and snaps the displayed
      // frequency back to the owner's real tuning.
      applyOwnership(msg)
      break
    case 'error':
      setDataConfirmed(false)
      setStatus(false)
      break
    case 'pong':
      break
    case 'trunk_status':
      // Backend confirms (or rejects) a trunk_decode request. On rejection
      // (e.g. missing channel map) it reports enabled:false + an error, so
      // reconcile the toggle and surface the message.
      if (msg.enabled === false) {
        _sdrStore().setTrunkEnabled(false)
        if (typeof msg.error === 'string') _sdrStore().setTrunkError(msg.error)
      } else if (msg.enabled === true) {
        _sdrStore().setTrunkEnabled(true)
      }
      break
  }
}

// ── Playing state ─────────────────────────────────────────────────────────────

function setPlayingState(on: boolean) {
  playing.value = on
  sessionStorage.setItem('sdrPlaying', on ? '1' : '0')
  if (!on) stopRecordingIfActive()
}

// ── Sweep engine (scanner + range search) ─────────────────────────────────────
// Both sweeps live in useSdrSweepEngine — they share the post-tune race guard,
// spectrum stash, channel sampler and resume watcher. The panel injects its
// retune chokepoints so the tune/mode command cadence is unchanged.
const {
  scanActive,
  scanLocked,
  scanSelectedGroupIds,
  scanAllSelected,
  onScanPrimaryClick,
  toggleScanAll,
  toggleScanGroup,
  stopScan,
  rebuildScanQueue,
  searchRanges,
  searchActive,
  searchLocked,
  searchSelectedRangeId,
  adhocLowMhz,
  adhocHighMhz,
  adhocStepKhz,
  adhocSearchValid,
  isAdhocSearching,
  isSavedRangeSearching,
  stopSearch,
  onAdhocPlayClick,
  onSavedRangePlayClick,
  reloadSearchRanges,
  selectSearchRange,
  onRangeBeforeDelete,
  noteSpectrumFrame,
  onSweepSquelchChange,
} = useSdrSweepEngine({
  sdrStore: _sdrStore,
  sendCmd,
  freqs,
  groupsWithFreqs,
  readOnly,
  squelch,
  bwHz,
  resumeDelaySec,
  currentMode,
  tuneToFreq,
  tuneToHzMode,
  // Starts the audio stream when a search sweep begins. The play buttons that
  // reach startSearch are disabled while no radio is selected
  // (controlsDisabled), so a radio is always present here.
  /* v8 ignore start */
  startAudioForSearch: (mode: string) => {
    if (selectedRadioId.value) {
      sdrAudio.initAudio(selectedRadioId.value)
      sdrAudio.setMode(mode as SdrMode)
      const bw = defaultBwHz(mode)
      sdrAudio.setBandwidthHz(bw)
      bwHz.value = bw
      setPlayingState(true)
    }
  },
  /* v8 ignore stop */
})

// ── Satellite auto-tune (AOS/LOS reconciliation) ──────────────────────────────
// The pass scheduler's external-tune handling (pending-tune queue, pre-AOS
// snapshot + LOS restore, lock-in priority, record-the-pass, notifications)
// lives in useSdrAutoTune; the panel injects its engine chokepoints so the
// tune/mode command cadence is unchanged. The useDocumentEvent registrations
// stay at the bottom of this file.
const { onExternalTune, onExternalTuneRestore, drainPendingExternalTune } = useSdrAutoTune({
  notificationsStore: _notificationsStore,
  playing,
  currentFreqHz,
  currentMode,
  freqInputVal,
  activeFreqDisplay,
  bwHz,
  selectedRadioId,
  knownRadios,
  scanActive,
  searchActive,
  isRecording,
  sdrAudio,
  sendCmd,
  saveSettings,
  setPlayingState,
  stop,
  selectRadio,
  startRecording: _startRecording,
  stopRecordingIfActive,
  isSocketOpen,
  isSocketConnecting,
})

// ── Tune ──────────────────────────────────────────────────────────────────────

let _retuneDebounce: ReturnType<typeof setTimeout> | null = null

// ── Scroll-to-tune (per-digit) ────────────────────────────────────────────────
// The per-digit wheel geometry (hidden measuring mirror, place-value hit-test)
// and the debounced hardware commit live in useSdrFreqDigitWheel; the panel
// injects its refs and command chokepoints so the retune cadence is unchanged.
const { onFreqWheel } = useSdrFreqDigitWheel({
  freqInputRef,
  currentFreqHz,
  freqInputVal,
  activeFreqDisplay,
  tuningDisabled,
  scanActive,
  playing,
  selectedRadioId,
  endRecordingOnManualChange: _endRecordingOnManualChange,
  sendCmd,
  saveSettings,
})

function tune() {
  // Tune fires only from the button / input-Enter, both disabled when no radio
  // is selected, so this guard is never the taken branch.
  /* v8 ignore start */
  if (!selectedRadioId.value) return
  /* v8 ignore stop */
  formatFreqInput()
  const hz = parseFreqMhz(freqInputVal.value)
  if (!hz) return
  currentFreqHz.value = hz
  activeFreqDisplay.value = (hz / 1e6).toFixed(3) + ' MHz'
  sdrAudio.initAudio(selectedRadioId.value)
  sdrAudio.setMode(currentMode.value as SdrMode)
  const bw = defaultBwHz(currentMode.value)
  sdrAudio.setBandwidthHz(bw)
  bwHz.value = bw
  setPlayingState(true)
  sessionStorage.setItem('sdrLastFreqHz', String(hz))
  sessionStorage.setItem('sdrLastMode', currentMode.value)
  saveSettings()
  sendCmd({ cmd: 'tune', frequency_hz: hz })
}

function stop() {
  _endRecordingOnManualChange()
  if (_sdrStore().digitalEnabled) setDigital(false)
  if (scanActive.value) stopScan()
  if (searchActive.value) stopSearch()
  sdrAudio.stop()
  setPlayingState(false)
  signalSmoothed.value = -120
  signalLit.value = 0
  // Hand the shared tuner back when we stop listening, so another instance can
  // take over instead of us hogging it with nothing playing (the "won't release"
  // bug). Only meaningful while we actually own it over the relay control channel;
  // a later Play re-claims it if it is still free.
  releaseOwnershipIfHeld()
}

// Tell the backend to release the shared tuner if this instance currently owns it
// over the relay control channel. Safe to call unconditionally (the backend no-ops
// when we don't own it), but gated here to avoid pointless traffic.
function releaseOwnershipIfHeld() {
  if (_sdrStore().controlAvailable && _sdrStore().isOwner) {
    sendCmd({ cmd: 'release' })
  }
}

function formatFreqInput() {
  const raw = freqInputVal.value.trim()
  if (!raw) return
  const n = parseFloat(raw)
  if (!isFinite(n)) return
  freqInputVal.value = n.toFixed(4)
}

// ── Gain ──────────────────────────────────────────────────────────────────────

let _gainDebounce: ReturnType<typeof setTimeout> | null = null

function onGainInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  gainDb.value = v
  gainAuto.value = v < 0
  saveSettings()
  if (_gainDebounce) clearTimeout(_gainDebounce)
  _gainDebounce = setTimeout(
    () => sendCmd({ cmd: 'gain', gain_db: gainAuto.value ? null : v }),
    150,
  )
}

function onAgcChange(e: Event) {
  gainAuto.value = (e.target as HTMLInputElement).checked
  saveSettings()
  if (_gainDebounce) clearTimeout(_gainDebounce)
  _gainDebounce = setTimeout(
    () => sendCmd({ cmd: 'gain', gain_db: gainAuto.value ? null : gainDb.value }),
    150,
  )
}

// ── Volume / squelch / bandwidth ──────────────────────────────────────────────

function onVolumeInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  volume.value = v
  saveSettings()
  sdrAudio.setVolume(v / 100)
}

let _sqDebounce: ReturnType<typeof setTimeout> | null = null
function onSquelchInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  squelch.value = v
  saveSettings()
  if (_sqDebounce) clearTimeout(_sqDebounce)
  _sqDebounce = setTimeout(() => {
    sendCmd({ cmd: 'squelch', squelch_dbfs: v })
    sdrAudio.setSquelch(v)
  }, 150)
}

function onBwInput(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  bwHz.value = v
  saveSettings()
  // Demod audio filter only — the spectrum/FFT span is governed by the
  // hardware sample rate (separate Sample Rate selector below), matching
  // SDR# / SDR++ / GQRX where Bandwidth never reconfigures the device.
  sdrAudio.setBandwidthHz(v)
}

// The SETTINGS accordion UI (sliders, AGC checkbox and the sample-rate
// dropdown) lives in SdrSettingsAccordion.vue. It forwards raw slider/checkbox
// events into the handlers above so the 150 ms command debounces and
// audio-worklet call cadence stay exactly as they were, and emits
// `pick-sample-rate` into pickSampleRate below.
function pickSampleRate(v: number) {
  // The menu only ever offers SAMPLE_RATE_OPTIONS values, so this allow-list
  // guard never rejects a real selection.
  /* v8 ignore start */
  if (!SAMPLE_RATE_OPTIONS.includes(v as (typeof SAMPLE_RATE_OPTIONS)[number])) return
  /* v8 ignore stop */
  if (v === sampleRateHz.value) return
  sampleRateHz.value = v
  // Update the BW slider ceiling synchronously so the UI doesn't wait for the
  // backend's status echo, and clamp the current bwHz down if it now exceeds.
  bwMax.value = v
  if (bwHz.value > v) {
    bwHz.value = v
    sdrAudio.setBandwidthHz(v)
  }
  saveSettings()
  sendCmd({ cmd: 'sample_rate', rate_hz: v })
}

// ── Mode ──────────────────────────────────────────────────────────────────────

function setMode(m: string) {
  currentMode.value = m
  saveSettings()
  // Keep the session's last-mode marker in step with the highlighted button so
  // the reload restore path (which seeds the audio/backend demod mode) never
  // reads a stale value left behind by a mode change.
  sessionStorage.setItem('sdrLastMode', m)
  sendCmd({ cmd: 'mode', mode: m })
  sdrAudio.setMode(m as SdrMode)
  const bw = defaultBwHz(m)
  sdrAudio.setBandwidthHz(bw)
  bwHz.value = bw
}

// Radio-group keyboard model (roving tabindex + arrow keys) for the MODE
// pills; selecting via arrow key runs the exact same setMode path as a click.
const modeKeyboard = useRadioGroupKeyboard({
  optionCount: () => MODES.length,
  selectedIndex: () => (MODES as readonly string[]).indexOf(currentMode.value),
  select: (modeIndex) => setMode(MODES[modeIndex]!),
})

// ── Signal meter ──────────────────────────────────────────────────────────────

function updateSignalBar(dbfs: number, squelchOpen?: boolean) {
  if (squelchOpen !== undefined) worklestSquelchOpen.value = squelchOpen
  if (squelchOpen === false) {
    signalSmoothed.value = -120
    signalLit.value = 0
    return
  }
  /* v8 ignore start -- defensive default / fall-through for an always-present field (or jsdom-limited path) */
  const alpha = dbfs > signalSmoothed.value ? 0.3 : 0.05
  /* v8 ignore stop */
  signalSmoothed.value += alpha * (dbfs - signalSmoothed.value)
  signalLit.value = Math.round(
    Math.max(0, Math.min(SIGNAL_SEGS, ((signalSmoothed.value + 120) / 120) * SIGNAL_SEGS)),
  )
}

// ── Status ────────────────────────────────────────────────────────────────────

// The connection-dot reachability probe lives in useSdrControlSocket (it runs
// on every socket 'open' and lights the dot via the onReachable hook above).

function setStatus(isConnected: boolean) {
  connected.value = isConnected
  if (isConnected) {
    if (!playing.value && sessionStorage.getItem('sdrPlaying') === '1') playing.value = true
  } else {
    playing.value = false
    stopRecordingIfActive()
    controlsDisabled.value = true
    activeFreqDisplay.value = ''
    signalSmoothed.value = -120
    signalLit.value = 0
  }
}

function applyStatus(msg: {
  connected: boolean
  center_hz: number
  mode: string
  gain_db: number
  gain_auto: boolean
  sample_rate: number
}) {
  // Seed the frequency field from the device's center_hz even while the radio is
  // still reporting connected=false (the initial status sent right after a page
  // refresh). Without this the input stays blank until the user manually tunes,
  // which looked like "the selected SDR can't be tuned again after a refresh".
  const hadUserFreq = currentFreqHz.value && currentFreqHz.value !== msg.center_hz
  if (!hadUserFreq && msg.center_hz > 0) {
    currentFreqHz.value = msg.center_hz
    freqInputVal.value = (msg.center_hz / 1e6).toFixed(4)
    activeFreqDisplay.value = (msg.center_hz / 1e6).toFixed(3) + ' MHz'
  }
  // The remaining fields reflect live hardware state — only trust them once the
  // device is actually connected and streaming.
  if (!msg.connected) return
  currentMode.value = msg.mode
  gainDb.value = msg.gain_db
  gainAuto.value = msg.gain_auto
  bwMax.value = msg.sample_rate
  if (SAMPLE_RATE_OPTIONS.includes(msg.sample_rate as (typeof SAMPLE_RATE_OPTIONS)[number])) {
    sampleRateHz.value = msg.sample_rate
  }
  const clampedBw = Math.min(bwHz.value, msg.sample_rate)
  bwHz.value = clampedBw
  sdrAudio.setBandwidthHz(clampedBw)
  saveSettings()
}

// Reflect tuning ownership from a status/control frame. When this instance is a
// read-only follower (another instance owns the shared dongle), snap the display
// back to the owner's real tuning so the frequency/gain/sample-rate never lie.
function applyOwnership(msg: {
  is_owner?: boolean
  control_available?: boolean
  locked?: boolean
  center_hz: number
  sample_rate: number
  gain_db: number
  gain_auto: boolean
  offset_hz?: number
  bw_hz?: number
  mode?: string
  scan_active?: boolean
  scan_groups?: string[]
  search_active?: boolean
  search_low_hz?: number | null
  search_high_hz?: number | null
  search_current_hz?: number | null
}) {
  // Default to "owner" when the backend omits these fields (a single instance, or
  // a relay without the control channel), so behaviour there is unchanged.
  const owner = msg.is_owner !== false
  _sdrStore().setOwnership(owner, msg.control_available === true, msg.locked === true)
  // Clean handoff: while actively watching (playing), if the shared tuner just
  // became FREE (control available, we're not the owner, nobody holds it) claim it
  // so control passes to us the instant the owner releases — instead of the
  // ex-owner grabbing it back on its next Play. The relay grants a claim only when
  // the token is genuinely free, so this never steals from a live owner.
  if (playing.value && msg.control_available === true && !owner && msg.locked !== true) {
    sendCmd({ cmd: 'claim' })
  }
  if (!_sdrStore().readOnly) return
  if (msg.center_hz > 0) {
    currentFreqHz.value = msg.center_hz
    freqInputVal.value = (msg.center_hz / 1e6).toFixed(4)
    activeFreqDisplay.value = (msg.center_hz / 1e6).toFixed(3) + ' MHz'
  }
  gainDb.value = msg.gain_db
  gainAuto.value = msg.gain_auto
  if (SAMPLE_RATE_OPTIONS.includes(msg.sample_rate as (typeof SAMPLE_RATE_OPTIONS)[number])) {
    sampleRateHz.value = msg.sample_rate
  }
  // Mirror the owner's within-band demod so a follower hears the EXACT channel,
  // not just the hardware centre: the NCO offset (moves the tuning bar + shifts
  // the local demod), the demod mode, and the audio bandwidth. Each is optional —
  // a relay that doesn't carry these leaves the follower at centre-only viewing.
  if (typeof msg.offset_hz === 'number') {
    _sdrStore().setTuningOffsetHz(msg.offset_hz)
    sdrAudio.setOffsetHz(msg.offset_hz)
  }
  if (msg.mode && MODES.includes(msg.mode as SdrMode)) {
    currentMode.value = msg.mode as SdrMode
    sdrAudio.setMode(msg.mode as SdrMode)
  }
  if (typeof msg.bw_hz === 'number' && msg.bw_hz > 0) {
    bwHz.value = msg.bw_hz
    sdrAudio.setBandwidthHz(msg.bw_hz)
  }
  // Mirror the owner's scanner/search sweep state so the follower's waterfall shows
  // the same "paused during active scan/search" overlay. Each field is optional — a
  // relay that doesn't carry them leaves the follower without the overlay (graceful).
  const _ss = _sdrStore()
  if (typeof msg.scan_active === 'boolean') _ss.scanSweeping = msg.scan_active
  if (Array.isArray(msg.scan_groups)) _ss.scanGroupNames = msg.scan_groups
  if (typeof msg.search_active === 'boolean') _ss.searchSweeping = msg.search_active
  if (msg.search_low_hz !== undefined) _ss.searchLowHz = msg.search_low_hz
  if (msg.search_high_hz !== undefined) _ss.searchHighHz = msg.search_high_hz
  if (msg.search_current_hz !== undefined) _ss.searchCurrentHz = msg.search_current_hz
}

// ── Radio selection / populate ────────────────────────────────────────────────
// selectRadio / clearRadioSelection / populateRadios / loadRadios live in
// useSdrRadioSelection (instantiated above).

// ── Scanner ───────────────────────────────────────────────────────────────────
// The scanner engine (queue building, dwell stepping, lock/resume) lives in
// useSdrSweepEngine (instantiated above).

// Lightweight retune used by the scan engine: the stream is already running,
// so this only moves the receiver — it must NOT (re)init audio or toggle the
// playing state on every scan step.
// Apply a stored frequency's saved tuning settings (RF gain, demod bandwidth,
// squelch, volume, device sample rate, and the waterfall zoom/min/max view) to
// the live radio. Used both when the user clicks a saved frequency and when a
// scan lands on one. Each setting is applied only when it differs from the
// current value, so a scan across frequencies that all share the defaults does
// not spam the backend with redundant commands.
function applyStoredFreqSettings(f: SdrStoredFrequency) {
  if (typeof f.gain === 'number') {
    const auto = f.gain < 0
    if (f.gain !== gainDb.value || auto !== gainAuto.value) {
      gainDb.value = f.gain
      gainAuto.value = auto
      sendCmd({ cmd: 'gain', gain_db: auto ? null : f.gain })
    }
  }
  if (typeof f.squelch === 'number' && f.squelch !== squelch.value) {
    squelch.value = f.squelch
    sendCmd({ cmd: 'squelch', squelch_dbfs: f.squelch })
    sdrAudio.setSquelch(f.squelch)
  }
  // Device sample rate first so the bandwidth ceiling (bwMax) is correct before
  // the demod bandwidth below is applied/clamped.
  const rate = f.sample_rate
  if (
    typeof rate === 'number' &&
    rate !== sampleRateHz.value &&
    SAMPLE_RATE_OPTIONS.includes(rate as (typeof SAMPLE_RATE_OPTIONS)[number])
  ) {
    sampleRateHz.value = rate
    bwMax.value = rate
    sendCmd({ cmd: 'sample_rate', rate_hz: rate })
  }
  const bw = typeof f.bandwidth === 'number' ? f.bandwidth : defaultBwHz(f.mode)
  const clampedBw = Math.min(bw, bwMax.value)
  if (clampedBw !== bwHz.value) {
    bwHz.value = clampedBw
    sdrAudio.setBandwidthHz(clampedBw)
  }
  if (typeof f.volume === 'number' && f.volume !== volume.value) {
    volume.value = f.volume
    sdrAudio.setVolume(f.volume / 100)
  }
  // Waterfall view (zoom / Min / Max). Written through the store so the
  // SdrWaterfall sibling picks them up; setViewSettings is a no-op-cheap ref +
  // localStorage write, but only call it when something actually changed.
  const store = _sdrStore()
  const zoom = typeof f.zoom === 'number' ? f.zoom : store.viewZoom
  const zmin = typeof f.zmin === 'number' ? f.zmin : store.viewZmin
  const zmax = typeof f.zmax === 'number' ? f.zmax : store.viewZmax
  if (zoom !== store.viewZoom || zmin !== store.viewZmin || zmax !== store.viewZmax) {
    // A non-zero Min/Max means the user pinned the scale for this frequency.
    store.setViewSettings({ zoom, zmin, zmax, autoScale: zmin === 0 && zmax === 0 })
  }
}

function tuneToFreq(f: SdrStoredFrequency) {
  currentFreqHz.value = f.frequency_hz
  currentMode.value = f.mode
  freqInputVal.value = (f.frequency_hz / 1e6).toFixed(4)
  activeFreqDisplay.value = (f.frequency_hz / 1e6).toFixed(3) + ' MHz'
  sendCmd({ cmd: 'tune', frequency_hz: f.frequency_hz })
  sendCmd({ cmd: 'mode', mode: f.mode })
  applyStoredFreqSettings(f)
}

// Play button on a saved frequency row: tune AND start the audio stream.
function playFreq(f: SdrStoredFrequency) {
  // Both guards below are defensive: the play button is disabled whenever
  // selectedRadioId is unset (tuningDisabled tracks controlsDisabled, which is
  // always false only once a radio is selected) or while read-only, so neither
  // condition is reachable via a real button click — only via a raced/non-UI
  // call path.
  /* v8 ignore start -- play button disabled while no radio selected or read-only; defensive guard */
  if (!selectedRadioId.value) return
  if (readOnly.value) return
  /* v8 ignore stop */
  _endRecordingOnManualChange()
  if (scanActive.value) stopScan()
  if (searchActive.value) stopSearch()
  currentFreqHz.value = f.frequency_hz
  currentMode.value = f.mode
  freqInputVal.value = (f.frequency_hz / 1e6).toFixed(4)
  activeFreqDisplay.value = (f.frequency_hz / 1e6).toFixed(3) + ' MHz'
  sdrAudio.initAudio(selectedRadioId.value)
  sdrAudio.setMode(f.mode as SdrMode)
  setPlayingState(true)
  sessionStorage.setItem('sdrLastFreqHz', String(f.frequency_hz))
  sessionStorage.setItem('sdrLastMode', f.mode)
  sendCmd({ cmd: 'tune', frequency_hz: f.frequency_hz })
  sendCmd({ cmd: 'mode', mode: f.mode })
  // Apply this frequency's saved tuning settings (gain/bw/squelch/volume/
  // sample rate + waterfall view), then persist the resulting live state.
  applyStoredFreqSettings(f)
  saveSettings()
}

// ── Search engine (low/high range sweep with stop-on-signal) ─────────────────
// The range helpers (ad-hoc/saved/current), the channel sampler and the sweep
// stepping live in useSdrSweepEngine (instantiated above).

function tuneToHzMode(hz: number, mode: string) {
  currentFreqHz.value = hz
  currentMode.value = mode
  freqInputVal.value = (hz / 1e6).toFixed(4)
  activeFreqDisplay.value = (hz / 1e6).toFixed(3) + ' MHz'
  sendCmd({ cmd: 'tune', frequency_hz: hz })
  sendCmd({ cmd: 'mode', mode })
}

// ── Search range editor ───────────────────────────────────────────────────────
// The SEARCH RANGES tab (range list + add/edit forms, CRUD) lives in
// SdrSearchRangesTab.vue; the sweep engine reacts to its events (stopping an
// active search before one of its ranges is deleted, reloading the list) via
// onRangeBeforeDelete / reloadSearchRanges from useSdrSweepEngine above.

// ── Data reload ───────────────────────────────────────────────────────────────

async function reloadData() {
  // Groups + frequencies are fetched by the store (loadGroups/loadFrequencies)
  // so SdrWaterfall's known-frequency markers read the exact same data this
  // panel edits — no separate slim mirror copy needed anymore.
  await Promise.all([_sdrStore().loadGroups(), _sdrStore().loadFrequencies()])
  void reloadSearchRanges()
  rebuildScanQueue()
  await recordingsSectionRef.value?.reload()
}

// Refresh the list when frequencies are imported from the settings panel
useDocumentEvent('sdr:frequenciesImported', () => {
  reloadData()
})

// ── Recording ─────────────────────────────────────────────────────────────────
// toggleRecording / startRecording / stopRecordingIfActive /
// endRecordingOnManualChange live in useSdrRecording (instantiated with the
// recording state block above).

function onSquelchChangeCallback(open: boolean) {
  // Sweep lock-on-squelch lives in useSdrSweepEngine; recording squelch-pause
  // accounting lives in useSdrRecording.
  onSweepSquelchChange(open)
  onRecordingSquelchChange(open)
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onRadiosChanged() {
  loadRadios()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  restoreSettings()

  // Hydrate the resume delay from the DB so the scan/search watcher uses the
  // user's persisted value even if the Settings SDR panel hasn't been opened
  // yet in this session.
  void _sdrStore().hydrateResumeDelaySecFromDb()

  // The backend resumes APRS decode on the persisted radio at startup, so the DB
  // — not the localStorage cache — is the truth about which radio is decoding
  // (and therefore which one must stay muted) after a reload. Same for the
  // decode-mute setting, which the Settings panel may never have been opened to.
  void _sdrStore().hydrateAprsFromDb()
  void _sdrStore().hydrateMuteAudioWhileDecodingFromDb()

  sdrAudio.onSquelchChange(onSquelchChangeCallback)
  sdrAudio.onPower(updateSignalBar)

  loadRadios()
  reloadData()
  void loadChannelMaps()
})

onUnmounted(() => {
  stopScan()
  clearLiveRecordingTimer()
  // Keep socket open — SdrTabPanel persists across navigation, audio must survive
  // Only close if unmounting the full-page SdrView (not the RADIO tab)
})

// Every dropdown now lives in its own extracted component (device selector,
// step/sample-rate pickers, settings accordion, trunk section) with its own
// teleported menu, settle window and dismiss listeners — the panel no longer
// registers document-level click/scroll/resize handlers for menus.
useDocumentEvent('sdr:radios-changed', onRadiosChanged)
useDocumentEvent('sentinel:sdr-tune-external', onExternalTune)
useDocumentEvent('sentinel:sdr-tune-restore', onExternalTuneRestore)
</script>
