"use strict";
// ============================================================
// SDR PANEL
// SDR-specific left panel — replaces the shared map sidebar on the SDR page.
// Contains two tabs: RADIO / SCANNER
//
// Exposes window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus }
// Exposes window._SdrControls = { setStatus, applyStatus, getSelectedRadioId }
// Exposes window._sdrPopulateRadios
// ============================================================
/// <reference path="./globals.d.ts" />
(function buildSdrPanel() {
    // ── DOM ───────────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'sdr-panel';
    panel.innerHTML = `
        <div id="sdr-panel-panes">

            <!-- ── RADIO SECTION ── -->
            <button class="sdr-scanner-main-toggle sdr-scanner-main-toggle-expanded" id="sdr-radio-main-toggle">
                <div class="sdr-scanner-section-left">
                    <span class="sdr-scanner-section-icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span class="sdr-scanner-section-label">RADIO</span>
                </div>
                <div class="sdr-radio-toggle-status">
                    <div id="sdr-conn-dot" class="sdr-conn-dot sdr-dot-off" title="Disconnected"></div>
                    <span id="sdr-active-freq" class="sdr-active-freq"></span>
                </div>
            </button>
            <div class="sdr-scanner-main-body sdr-scanner-main-body-expanded" id="sdr-pane-radio">

                <!-- ── Group 1: Device / Bandwidth / RF Gain / AGC ── -->
                <button class="sdr-group-toggle sdr-group-toggle-expanded" id="sdr-device-group-toggle">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-group-toggle-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-group-toggle-label">DEVICE</span>
                    </div>
                </button>
                <div class="sdr-group-body sdr-group-body-expanded" id="sdr-device-group-body">

                    <!-- Device -->
                    <div class="sdr-radio-section">
                        <div class="sdr-device-dropdown" id="sdr-device-dropdown" tabindex="0">
                            <div class="sdr-device-dropdown-selected">
                                <span class="sdr-device-dropdown-text" id="sdr-device-dropdown-text">— select radio —</span>
                                <span class="sdr-device-dropdown-arrow"></span>
                            </div>
                        </div>
                        <select id="sdr-radio-select" style="display:none"></select>
                    </div>

                    <!-- Bandwidth -->
                    <div class="sdr-radio-section sdr-radio-section--tight">
                        <div class="sdr-slider-header">
                            <label class="sdr-field-label">BANDWIDTH</label>
                            <span id="sdr-bw-val" class="sdr-slider-val">10 kHz</span>
                        </div>
                        <input id="sdr-bw-slider" class="sdr-panel-slider" type="range" min="1000" max="2048000" step="500" value="10000">
                    </div>

                    <!-- RF Gain -->
                    <div class="sdr-radio-section sdr-radio-section--tight">
                        <div class="sdr-slider-header">
                            <label class="sdr-field-label">RF GAIN</label>
                            <span id="sdr-gain-val" class="sdr-slider-val">30.0 dB</span>
                        </div>
                        <input id="sdr-gain-slider" class="sdr-panel-slider" type="range" min="-1" max="49" step="0.5" value="30">
                    </div>

                    <!-- AGC -->
                    <div class="sdr-radio-section sdr-agc-row">
                        <label class="sdr-checkbox-label">
                            <input id="sdr-agc-check" type="checkbox" class="sdr-checkbox">
                            <span class="sdr-checkbox-custom"></span>
                            <span class="sdr-checkbox-text">AGC (Automatic Gain Control)</span>
                        </label>
                    </div>

                </div>

                <!-- ── Group 2: Frequency / Mode / Signal / Volume / Squelch ── -->
                <button class="sdr-group-toggle sdr-group-toggle-expanded" id="sdr-signal-group-toggle">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-group-toggle-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-group-toggle-label">SIGNAL</span>
                    </div>
                </button>
                <div class="sdr-group-body sdr-group-body-expanded" id="sdr-signal-group-body">

                    <!-- Frequency -->
                    <div class="sdr-radio-section">
                        <label class="sdr-field-label">FREQUENCY MHz</label>
                        <div class="sdr-freq-row">
                            <input id="sdr-freq-input" class="sdr-freq-input-large" type="text"
                                   placeholder="100.000" autocomplete="off" spellcheck="false">
                            <button id="sdr-freq-tune" class="sdr-mode-pill sdr-tune-btn" type="button" title="Tune">
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polygon points="2,1 11,6 2,11" fill="currentColor"/></svg>
                            </button>
                            <button id="sdr-freq-stop" class="sdr-mode-pill sdr-tune-btn sdr-stop-btn" type="button" title="Stop audio">
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>
                            </button>
                            <button id="sdr-rec-btn" class="sdr-mode-pill sdr-tune-btn sdr-rec-btn" type="button" title="Record" disabled>
                                <svg id="sdr-rec-icon" width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Mode -->
                    <div class="sdr-radio-section">
                        <label class="sdr-field-label">MODE</label>
                        <div class="sdr-mode-pills" id="sdr-mode-pills">
                            <button class="sdr-mode-pill active" data-mode="AM">AM</button>
                            <button class="sdr-mode-pill" data-mode="NFM">NFM</button>
                            <button class="sdr-mode-pill" data-mode="WFM">WFM</button>
                            <button class="sdr-mode-pill" data-mode="USB">USB</button>
                            <button class="sdr-mode-pill" data-mode="LSB">LSB</button>
                            <button class="sdr-mode-pill" data-mode="CW">CW</button>
                        </div>
                    </div>

                    <!-- Signal meter -->
                    <div class="sdr-radio-section">
                        <span class="sdr-field-label">SIGNAL</span>
                        <div id="sdr-signal-bar" class="sdr-signal-segments"></div>
                    </div>

                    <!-- Volume -->
                    <div class="sdr-radio-section">
                        <div class="sdr-slider-header">
                            <label class="sdr-field-label">VOLUME</label>
                            <span id="sdr-vol-val" class="sdr-slider-val">80%</span>
                        </div>
                        <input id="sdr-vol-slider" class="sdr-panel-slider" type="range" min="0" max="100" step="1" value="80">
                    </div>

                    <!-- Squelch -->
                    <div class="sdr-radio-section">
                        <div class="sdr-slider-header">
                            <label class="sdr-field-label">SQUELCH</label>
                            <span id="sdr-sq-val" class="sdr-slider-val">-120 dBFS</span>
                        </div>
                        <input id="sdr-sq-slider" class="sdr-panel-slider" type="range" min="-120" max="0" step="1" value="-120">
                    </div>

                </div>

                <!-- ── Group 3: Recording / Clips ── -->
                <button class="sdr-group-toggle sdr-group-toggle-expanded" id="sdr-recording-group-toggle">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-group-toggle-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-group-toggle-label">RECORDING</span>
                    </div>
                    <span id="sdr-clips-count" class="sdr-clips-count"></span>
                </button>
                <div class="sdr-group-body sdr-group-body-expanded" id="sdr-recording-group-body">

                    <!-- Clips list -->
                    <div class="sdr-clips-search-row">
                        <input id="sdr-clips-search" class="sdr-panel-input sdr-clips-search-input" type="text" placeholder="Search clips…" autocomplete="off">
                    </div>
                    <div id="sdr-clips-list-wrap">
                        <div id="sdr-clips-list"></div>
                        <div id="sdr-clips-empty" class="sdr-panel-empty" style="display:none">No recordings yet.<br>Use the REC button while listening.</div>
                    </div>
                    <div id="sdr-clips-scroll-hint">MORE
                        <svg id="sdr-clips-scroll-arrow" width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <polyline points="1,2.5 4,5.5 7,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>

                </div>

            </div>

            <!-- ── SCANNER SECTION ── -->
            <button class="sdr-scanner-main-toggle sdr-scanner-main-toggle-expanded" id="sdr-scanner-main-toggle">
                <div class="sdr-scanner-section-left">
                    <span class="sdr-scanner-section-icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span class="sdr-scanner-section-label">SCANNER</span>
                </div>
            </button>
            <div class="sdr-scanner-main-body sdr-scanner-main-body-expanded" id="sdr-pane-scanner">

                <!-- Scan controls section (above frequencies) -->
                <div class="sdr-scan-controls">
                    <div class="sdr-scan-state-row">
                        <div class="sdr-scan-indicator" id="sdr-radio-scan-indicator"></div>
                        <span id="sdr-radio-scan-label" class="sdr-scan-state-label">IDLE</span>
                        <span id="sdr-radio-scan-freq" class="sdr-scan-state-freq"></span>
                    </div>
                    <div class="sdr-scan-btns-row">
                        <button id="sdr-radio-scan-btn" class="sdr-scan-action-btn sdr-scan-action-btn--bg">START SCANNING</button>
                        <button id="sdr-radio-lock-btn" class="sdr-scan-action-btn sdr-scan-action-btn--bg" title="Hold scanner on current frequency">HOLD SCAN</button>
                    </div>
                </div>

                <!-- GROUPS section -->
                <button class="sdr-scanner-section-toggle sdr-scanner-section-toggle-expanded" id="sdr-scanner-groups-toggle" data-section="groups">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-scanner-section-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-scanner-section-label">GROUPS</span>
                    </div>
                </button>
                <div class="sdr-scanner-section-body sdr-scanner-section-body-expanded" id="sdr-scanner-groups-body">
                    <div id="sdr-group-list"></div>
                    <div class="sdr-panel-add-row">
                        <input id="sdr-new-group-name" class="sdr-panel-input" type="text" placeholder="Group name…" maxlength="40">
                        <button id="sdr-add-group-btn" class="sdr-panel-btn">ADD</button>
                    </div>
                </div>

                <!-- FREQUENCIES section -->
                <button class="sdr-scanner-section-toggle sdr-scanner-section-toggle-expanded" id="sdr-scanner-freqs-toggle" data-section="freqs">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-scanner-section-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-scanner-section-label">FREQUENCIES</span>
                    </div>
                </button>
                <div class="sdr-scanner-section-body sdr-scanner-section-body-expanded" id="sdr-scanner-freqs-body">

                    <!-- Add freq button -->
                    <div class="sdr-scan-btns-row" style="padding: 10px 28px 0;">
                        <button id="sdr-radio-add-freq" class="sdr-scan-action-btn sdr-add-freq-btn sdr-scan-action-btn--bg">+ ADD FREQ</button>
                    </div>

                    <div id="sdr-freq-list"></div>
                    <div id="sdr-freq-empty" class="sdr-panel-empty">No saved frequencies.<br>Tune to a frequency and use + ADD FREQ to save it.</div>

                    <!-- Edit Frequency — collapsible panel -->
                    <button class="sdr-editfreq-toggle" id="sdr-editfreq-toggle">
                        <div class="sdr-editfreq-toggle-left">
                            <span class="sdr-editfreq-toggle-icon">
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </span>
                            <span class="sdr-editfreq-toggle-label">EDIT FREQUENCY</span>
                        </div>
                    </button>
                    <div class="sdr-editfreq-body" id="sdr-editfreq-body">
                        <div class="sdr-editfreq-field">
                            <label class="sdr-field-label">LABEL</label>
                            <input id="sdr-ef-label" class="sdr-panel-input" type="text" placeholder="Label…" maxlength="60" style="width:100%">
                        </div>
                        <div class="sdr-editfreq-field">
                            <label class="sdr-field-label">FREQ (MHz)</label>
                            <input id="sdr-ef-freq" class="sdr-panel-input" type="text" placeholder="118.3800" autocomplete="off" style="width:100%">
                        </div>
                        <div class="sdr-editfreq-field">
                            <label class="sdr-field-label">MODE</label>
                            <div class="sdr-mode-pills" id="sdr-ef-mode-pills">
                                <button class="sdr-mode-pill active" data-mode="AM">AM</button>
                                <button class="sdr-mode-pill" data-mode="NFM">NFM</button>
                                <button class="sdr-mode-pill" data-mode="WFM">WFM</button>
                                <button class="sdr-mode-pill" data-mode="USB">USB</button>
                                <button class="sdr-mode-pill" data-mode="LSB">LSB</button>
                                <button class="sdr-mode-pill" data-mode="CW">CW</button>
                            </div>
                        </div>
                        <div class="sdr-editfreq-field">
                            <label class="sdr-field-label">GROUPS</label>
                            <div id="sdr-ef-groups" class="sdr-fmod-groups"></div>
                        </div>
                        <div class="sdr-editfreq-actions">
                            <button id="sdr-ef-delete" class="sdr-panel-btn sdr-editfreq-del-btn" style="display:none">DELETE</button>
                            <div class="sdr-editfreq-actions-right">
                                <button id="sdr-ef-cancel" class="sdr-panel-btn">CANCEL</button>
                                <button id="sdr-ef-save" class="sdr-panel-btn sdr-editfreq-save-btn">SAVE</button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <!-- ── SETTINGS SECTION ── -->
            <button class="sdr-scanner-main-toggle" id="sdr-settings-main-toggle">
                <div class="sdr-scanner-section-left">
                    <span class="sdr-scanner-section-icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span class="sdr-scanner-section-label">SETTINGS</span>
                </div>
            </button>
            <div class="sdr-scanner-main-body" id="sdr-pane-settings">

                <!-- WAV Recordings -->
                <button class="sdr-group-toggle" id="sdr-mgmt-wav-toggle">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-group-toggle-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-group-toggle-label">WAV RECORDINGS</span>
                    </div>
                    <span id="sdr-mgmt-wav-count" class="sdr-clips-count"></span>
                </button>
                <div class="sdr-group-body" id="sdr-mgmt-wav-body">
                    <div id="sdr-mgmt-wav-list"></div>
                    <div class="sdr-mgmt-actions-row">
                        <button id="sdr-mgmt-wav-delete-all" class="sdr-panel-btn sdr-editfreq-del-btn">DELETE ALL</button>
                    </div>
                </div>

                <!-- IQ Files -->
                <button class="sdr-group-toggle" id="sdr-mgmt-iq-toggle">
                    <div class="sdr-scanner-section-left">
                        <span class="sdr-group-toggle-icon">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </span>
                        <span class="sdr-group-toggle-label">IQ FILES</span>
                    </div>
                    <span id="sdr-mgmt-iq-count" class="sdr-clips-count"></span>
                </button>
                <div class="sdr-group-body" id="sdr-mgmt-iq-body">
                    <div id="sdr-mgmt-iq-list"></div>
                    <div class="sdr-mgmt-actions-row">
                        <button id="sdr-mgmt-iq-delete-all" class="sdr-panel-btn sdr-editfreq-del-btn">DELETE ALL</button>
                    </div>
                </div>

            </div>

        </div>

        <div style="display:none" id="sdr-pane-clips">
        </div>

        <!-- ── GROUP RENAME MODAL ── -->
        <div id="sdr-group-modal" class="sdr-modal-overlay" style="display:none">
            <div class="sdr-modal">
                <div class="sdr-modal-title">EDIT GROUP</div>
                <div class="sdr-modal-field">
                    <label class="sdr-field-label">NAME</label>
                    <input id="sdr-gmod-name" class="sdr-panel-input sdr-modal-input" type="text" placeholder="Group name…" maxlength="40">
                </div>
                <div class="sdr-modal-actions">
                    <button id="sdr-gmod-cancel" class="sdr-panel-btn">CANCEL</button>
                    <button id="sdr-gmod-save" class="sdr-panel-btn sdr-fmod-save-btn">SAVE</button>
                </div>
            </div>
        </div>

        <!-- ── EDIT RECORDING MODAL ── -->
        <div id="sdr-rec-modal" class="sdr-modal-overlay" style="display:none">
            <div class="sdr-modal">
                <div class="sdr-modal-title">EDIT CLIP</div>
                <div class="sdr-modal-field">
                    <label class="sdr-field-label">NAME</label>
                    <input id="sdr-recmod-name" class="sdr-panel-input sdr-modal-input" type="text" maxlength="120">
                </div>
                <div class="sdr-modal-field">
                    <label class="sdr-field-label">NOTES</label>
                    <textarea id="sdr-recmod-notes" class="sdr-panel-input sdr-modal-input sdr-recmod-notes" rows="3" maxlength="500" placeholder="Optional notes…"></textarea>
                </div>
                <div class="sdr-modal-actions">
                    <button id="sdr-recmod-cancel" class="sdr-panel-btn">CANCEL</button>
                    <button id="sdr-recmod-save" class="sdr-panel-btn sdr-fmod-save-btn">SAVE</button>
                </div>
            </div>
        </div>

        <!-- ── DELETE RECORDING MODAL ── -->
        <div id="sdr-rec-del-modal" class="sdr-modal-overlay" style="display:none">
            <div class="sdr-modal">
                <div class="sdr-modal-title">DELETE CLIP?</div>
                <div id="sdr-recdelmod-msg" class="sdr-recdelmod-msg"></div>
                <div class="sdr-modal-actions">
                    <button id="sdr-recdelmod-cancel" class="sdr-panel-btn">CANCEL</button>
                    <button id="sdr-recdelmod-confirm" class="sdr-panel-btn sdr-editfreq-del-btn">DELETE</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    // ── State ─────────────────────────────────────────────────────────────────
    let _groups = [];
    let _freqs = [];
    let _knownRadios = [];
    let _visible = true;
    let _sdrPlaying = false;
    let _editingFreqId = null;
    // ── Clips state ───────────────────────────────────────────────────────────
    let _clips = [];
    let _clipsFilter = '';
    let _isRecording = false;
    let _recTimerInterval = null;
    let _liveRecRow = null;
    let _recPausedMs = 0;       // total ms paused waiting for squelch
    let _recPauseStart = null;  // epoch when current pause began, or null
    let _recSquelchOpen = true; // assume open until told otherwise
    let _editingRecId = null;
    let _deletingRecId = null;
    // ── Radio / Scanner main section toggles ─────────────────────────────────
    function bindMainToggle(toggleId, bodyId) {
        const toggle = document.getElementById(toggleId);
        const body = document.getElementById(bodyId);
        toggle.addEventListener('click', () => {
            const expanded = toggle.classList.contains('sdr-scanner-main-toggle-expanded');
            toggle.classList.toggle('sdr-scanner-main-toggle-expanded', !expanded);
            body.classList.toggle('sdr-scanner-main-body-expanded', !expanded);
        });
        return { toggle, body };
    }
    bindMainToggle('sdr-radio-main-toggle', 'sdr-pane-radio');
    const { toggle: scannerMainToggle, body: scannerMainBody } = bindMainToggle('sdr-scanner-main-toggle', 'sdr-pane-scanner');
    bindMainToggle('sdr-settings-main-toggle', 'sdr-pane-settings');
    // ── Scanner section collapse ──────────────────────────────────────────────
    panel.querySelectorAll('.sdr-scanner-section-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const section = toggle.dataset.section;
            const body = document.getElementById(`sdr-scanner-${section}-body`);
            const expanded = toggle.classList.contains('sdr-scanner-section-toggle-expanded');
            toggle.classList.toggle('sdr-scanner-section-toggle-expanded', !expanded);
            if (body)
                body.classList.toggle('sdr-scanner-section-body-expanded', !expanded);
        });
    });
    // ── Radio group toggles (Device / Signal) ────────────────────────────────
    function bindGroupToggle(toggleId, bodyId) {
        const toggle = document.getElementById(toggleId);
        const body = document.getElementById(bodyId);
        if (!toggle || !body)
            return;
        toggle.addEventListener('click', () => {
            const expanded = toggle.classList.contains('sdr-group-toggle-expanded');
            toggle.classList.toggle('sdr-group-toggle-expanded', !expanded);
            body.classList.toggle('sdr-group-body-expanded', !expanded);
        });
    }
    bindGroupToggle('sdr-device-group-toggle', 'sdr-device-group-body');
    bindGroupToggle('sdr-signal-group-toggle', 'sdr-signal-group-body');
    bindGroupToggle('sdr-recording-group-toggle', 'sdr-recording-group-body');
    bindGroupToggle('sdr-mgmt-wav-toggle', 'sdr-mgmt-wav-body');
    bindGroupToggle('sdr-mgmt-iq-toggle', 'sdr-mgmt-iq-body');
    // ── Element refs ──────────────────────────────────────────────────────────
    const radioSelect = document.getElementById('sdr-radio-select');
    const freqInput = document.getElementById('sdr-freq-input');
    const freqTuneBtn = document.getElementById('sdr-freq-tune');
    const freqStopBtn = document.getElementById('sdr-freq-stop');
    const modePillsEl = document.getElementById('sdr-mode-pills');
    const gainSlider = document.getElementById('sdr-gain-slider');
    const gainVal = document.getElementById('sdr-gain-val');
    const agcCheck = document.getElementById('sdr-agc-check');
    const volSlider = document.getElementById('sdr-vol-slider');
    const volVal = document.getElementById('sdr-vol-val');
    const sqSlider = document.getElementById('sdr-sq-slider');
    const sqVal = document.getElementById('sdr-sq-val');
    const bwSlider = document.getElementById('sdr-bw-slider');
    const bwVal = document.getElementById('sdr-bw-val');
    const connDot = document.getElementById('sdr-conn-dot');
    const activeFreq = document.getElementById('sdr-active-freq');
    const signalBarEl = document.getElementById('sdr-signal-bar');
    const radioScanBtn = document.getElementById('sdr-radio-scan-btn');
    const radioScanInd = document.getElementById('sdr-radio-scan-indicator');
    const radioScanLbl = document.getElementById('sdr-radio-scan-label');
    const radioScanFreq = document.getElementById('sdr-radio-scan-freq');
    const addFreqBtn = document.getElementById('sdr-radio-add-freq');
    const lockBtn = document.getElementById('sdr-radio-lock-btn');
    // Edit freq panel
    const efToggle = document.getElementById('sdr-editfreq-toggle');
    const efBody = document.getElementById('sdr-editfreq-body');
    const efLabel = document.getElementById('sdr-ef-label');
    const efFreq = document.getElementById('sdr-ef-freq');
    const efModePills = document.getElementById('sdr-ef-mode-pills');
    const efGroupsEl = document.getElementById('sdr-ef-groups');
    const efCancel = document.getElementById('sdr-ef-cancel');
    const efSave = document.getElementById('sdr-ef-save');
    const efDelete = document.getElementById('sdr-ef-delete');
    // Clips / recording refs
    const recBtn          = document.getElementById('sdr-rec-btn');
    const recTimer        = document.getElementById('sdr-rec-timer');
    const clipsSearch     = document.getElementById('sdr-clips-search');
    const clipsList       = document.getElementById('sdr-clips-list');
    const clipsEmpty      = document.getElementById('sdr-clips-empty');
    const clipsCount      = document.getElementById('sdr-clips-count');
    const clipsScrollHint = document.getElementById('sdr-clips-scroll-hint');
    const clipsScrollArrow= document.getElementById('sdr-clips-scroll-arrow');
    function _updateClipsScrollHint() {
        if (!clipsScrollHint || !clipsScrollArrow) return;
        const hiddenBelow = clipsList.scrollHeight - clipsList.clientHeight - clipsList.scrollTop;
        const overflows   = clipsList.scrollHeight > clipsList.clientHeight + 1;
        const enoughItems = _clips.length > 3;
        if (!overflows || !enoughItems) {
            clipsScrollHint.classList.remove('sdr-clips-hint-visible');
        } else {
            clipsScrollHint.classList.add('sdr-clips-hint-visible');
            clipsScrollArrow.classList.toggle('sdr-clips-arrow-up', hiddenBelow <= 8);
        }
    }
    clipsList.addEventListener('scroll', _updateClipsScrollHint);
    const recModal      = document.getElementById('sdr-rec-modal');
    const recmodName    = document.getElementById('sdr-recmod-name');
    const recmodNotes   = document.getElementById('sdr-recmod-notes');
    const recmodCancel  = document.getElementById('sdr-recmod-cancel');
    const recmodSave    = document.getElementById('sdr-recmod-save');
    const recDelModal   = document.getElementById('sdr-rec-del-modal');
    const recDelMsg     = document.getElementById('sdr-recdelmod-msg');
    const recDelCancel  = document.getElementById('sdr-recdelmod-cancel');
    const recDelConfirm = document.getElementById('sdr-recdelmod-confirm');
    // ── Helpers ───────────────────────────────────────────────────────────────
    function setRadioControlsDisabled(disabled) {
        freqInput.disabled = disabled;
        freqTuneBtn.disabled = disabled || _sdrPlaying;
        // freqStopBtn state is owned exclusively by setPlayingState — do not touch here
        gainSlider.disabled = disabled || _sdrCurrentGainAuto;
        agcCheck.disabled = disabled;
        volSlider.disabled = disabled;
        sqSlider.disabled = disabled;
        bwSlider.disabled = disabled;
        radioScanBtn.disabled = disabled;
        lockBtn.disabled = disabled;
        addFreqBtn.disabled = disabled;
        modePillsEl.querySelectorAll('.sdr-mode-pill').forEach(btn => {
            btn.disabled = disabled;
        });
        [gainVal, volVal, sqVal, bwVal].forEach(el => {
            el.classList.toggle('sdr-slider-val--dimmed', disabled);
        });
    }
    // Disable controls until a radio is selected
    setRadioControlsDisabled(true);
    function sendCmd(obj) {
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify(obj));
        }
    }
    function parseFreqMhz(raw) {
        const v = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(v) || v <= 0)
            return null;
        return v > 30000 ? v : Math.round(v * 1e6);
    }
    function displayFreq(hz) {
        if (document.activeElement !== freqInput) {
            freqInput.value = (hz / 1e6).toFixed(3);
        }
        activeFreq.textContent = (hz / 1e6).toFixed(3) + ' MHz';
    }
    // ── Mode pills (main radio tab) ───────────────────────────────────────────
    function setModePill(container, mode) {
        container.querySelectorAll('.sdr-mode-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }
    function defaultBwHz(mode) {
        switch (mode) {
            case 'WFM': return 200000;
            case 'NFM': return 12500;
            case 'AM': return 10000;
            case 'USB':
            case 'LSB': return 3000;
            case 'CW': return 500;
            default: return 10000;
        }
    }
    modePillsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.sdr-mode-pill');
        if (!btn || !btn.dataset.mode)
            return;
        const mode = btn.dataset.mode;
        setModePill(modePillsEl, mode);
        _sdrCurrentMode = mode;
        sendCmd({ cmd: 'mode', mode });
        if (window._SdrAudio) {
            window._SdrAudio.setMode(mode);
            window._SdrAudio.setBandwidthHz(defaultBwHz(mode));
        }
        setBandwidthSlider(defaultBwHz(mode));
    });
    // ── Tune ──────────────────────────────────────────────────────────────────
    // Stop is disabled until play is clicked; they toggle each other
    freqStopBtn.disabled = true;
    function _setRecBtnIcon(recording) {
        const icon = document.getElementById('sdr-rec-icon');
        if (!icon) return;
        if (recording) {
            // Stop-recording icon: filled square
            icon.innerHTML = '<rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor"/>';
        } else {
            // Record icon: filled circle
            icon.innerHTML = '<circle cx="5" cy="5" r="4" fill="currentColor"/>';
        }
    }
    async function _stopRecordingIfActive() {
        if (!_isRecording) return;
        _isRecording = false;
        if (_recTimerInterval) { clearInterval(_recTimerInterval); _recTimerInterval = null; }
        recBtn.classList.remove('sdr-rec-btn--active');
        _setRecBtnIcon(false);
        if (recTimer) recTimer.textContent = '';
        if (!window._SdrAudio) return;
        const radioId = getSelectedRadioId();
        const radioName = radioId
            ? (_knownRadios.find(r => r.id === radioId) || {}).name || ''
            : '';
        const metadata = {
            radio_id: radioId || null,
            radio_name: radioName,
            frequency_hz: _sdrCurrentFreqHz || 0,
            mode: _sdrCurrentMode || 'AM',
            gain_db: _sdrCurrentGain || 30,
            squelch_dbfs: _sdrCurrentSquelch || -60,
            sample_rate: _sdrCurrentSampleRate || 2048000,
        };
        await window._SdrAudio.stopRecording(metadata);
        _removeLiveRecRow();
        await reloadClips();
        const recGroupToggle = document.getElementById('sdr-recording-group-toggle');
        const recGroupBody = document.getElementById('sdr-recording-group-body');
        if (recGroupToggle && !recGroupToggle.classList.contains('sdr-group-toggle-expanded')) {
            recGroupToggle.classList.add('sdr-group-toggle-expanded');
            recGroupBody.classList.add('sdr-group-body-expanded');
        }
    }
    function setPlayingState(playing) {
        _sdrPlaying = playing;
        freqTuneBtn.disabled = playing;
        freqStopBtn.disabled = !playing;
        recBtn.disabled = !playing;
        if (!playing) _stopRecordingIfActive();
    }
    async function tune() {
        const hz = parseFreqMhz(freqInput.value);
        if (!hz)
            return;
        _sdrCurrentFreqHz = hz;
        displayFreq(hz);
        if (window._SdrAudio) {
            window._SdrAudio.initAudio(getSelectedRadioId() ?? undefined);
            window._SdrAudio.setMode(_sdrCurrentMode);
            const bw = defaultBwHz(_sdrCurrentMode);
            window._SdrAudio.setBandwidthHz(bw);
            setBandwidthSlider(bw);
        }
        setPlayingState(true);
        // Always persist so reconnect restores the user's chosen frequency
        sessionStorage.setItem('sdrLastFreqHz', String(hz));
        sessionStorage.setItem('sdrLastMode', _sdrCurrentMode);
        if (!_sdrSocket || _sdrSocket.readyState !== WebSocket.OPEN) {
            // Only trigger a new connection if no socket exists or it's fully closed
            if (!_sdrSocket || _sdrSocket.readyState === WebSocket.CLOSED) {
                const radioId = getSelectedRadioId();
                if (radioId) {
                    document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId } }));
                }
            }
            return;
        }
        sendCmd({ cmd: 'tune', frequency_hz: hz });
    }
    function retune(hz) {
        if (!_sdrSocket || _sdrSocket.readyState !== WebSocket.OPEN)
            return;
        _sdrCurrentFreqHz = hz;
        displayFreq(hz);
        sessionStorage.setItem('sdrLastFreqHz', String(hz));
        sendCmd({ cmd: 'tune', frequency_hz: hz });
    }
    freqTuneBtn.addEventListener('click', tune);
    freqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter')
        tune(); });
    // Auto-retune when frequency input changes while audio is playing
    let _retuneDebounce = null;
    freqInput.addEventListener('input', () => {
        if (freqStopBtn.disabled)
            return; // not playing
        const hz = parseFreqMhz(freqInput.value);
        if (!hz)
            return;
        if (_retuneDebounce)
            clearTimeout(_retuneDebounce);
        _retuneDebounce = setTimeout(() => retune(hz), 600);
    });
    freqStopBtn.addEventListener('click', async () => {
        await _stopRecordingIfActive();
        if (window._SdrAudio)
            window._SdrAudio.stop();
        setPlayingState(false);
        _signalSmoothed = -120;
        for (let i = 0; i < SIGNAL_SEGS; i++)
            _segEls[i].classList.remove('sdr-signal-seg--on');
    });
    // ── Gain + AGC ────────────────────────────────────────────────────────────
    let _gainDebounce = null;
    function applyGain() {
        const g = parseFloat(gainSlider.value);
        const auto = agcCheck.checked || g < 0;
        if (auto) {
            gainVal.textContent = 'AUTO';
            _sdrCurrentGainAuto = true;
        }
        else {
            gainVal.textContent = `${g.toFixed(1)} dB`;
            _sdrCurrentGain = g;
            _sdrCurrentGainAuto = false;
        }
        if (_gainDebounce)
            clearTimeout(_gainDebounce);
        _gainDebounce = setTimeout(() => {
            sendCmd({ cmd: 'gain', gain_db: auto ? null : g });
        }, 150);
    }
    gainSlider.addEventListener('input', applyGain);
    agcCheck.addEventListener('change', () => {
        gainSlider.disabled = agcCheck.checked;
        applyGain();
    });
    // ── Volume ────────────────────────────────────────────────────────────────
    volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10);
        volVal.textContent = `${v}%`;
        if (window._SdrAudio)
            window._SdrAudio.setVolume(v / 100);
    });
    // ── Squelch ───────────────────────────────────────────────────────────────
    let _sqDebounce = null;
    sqSlider.addEventListener('input', () => {
        const sq = parseInt(sqSlider.value, 10);
        sqVal.textContent = `${sq} dBFS`;
        _sdrCurrentSquelch = sq;
        if (_sqDebounce)
            clearTimeout(_sqDebounce);
        _sqDebounce = setTimeout(() => {
            sendCmd({ cmd: 'squelch', squelch_dbfs: sq });
            if (window._SdrAudio)
                window._SdrAudio.setSquelch(sq);
        }, 150);
    });
    // ── Bandwidth ─────────────────────────────────────────────────────────────
    function formatBwHz(hz) {
        if (hz >= 1000000)
            return `${(hz / 1000000).toFixed(2)} MHz`;
        if (hz >= 1000)
            return `${Math.round(hz / 1000)} kHz`;
        return `${hz} Hz`;
    }
    function setBandwidthSlider(hz) {
        bwSlider.value = String(hz);
        bwVal.textContent = formatBwHz(hz);
        _sdrCurrentBwHz = hz;
    }
    // Snap to nearest valid RTL-SDR sample rate (225001–300000 or 900001–3200000 Hz)
    function snapToValidSampleRate(hz) {
        if (hz <= 262500) return 250000;
        if (hz <= 600000) return 300000;
        if (hz <= 1474000) return 1024000;
        if (hz <= 1761000) return 1536000;
        if (hz <= 1921000) return 1792000;
        return 2048000;
    }
    let _bwDebounce = null;
    bwSlider.addEventListener('input', () => {
        const hz = parseInt(bwSlider.value, 10);
        bwVal.textContent = formatBwHz(hz);
        _sdrCurrentBwHz = hz;
        if (window._SdrAudio)
            window._SdrAudio.setBandwidthHz(hz);
        if (_bwDebounce)
            clearTimeout(_bwDebounce);
        _bwDebounce = setTimeout(() => {
            sendCmd({ cmd: 'sample_rate', rate_hz: snapToValidSampleRate(hz) });
        }, 150);
    });
    // ── Signal meter ──────────────────────────────────────────────────────────
    const SIGNAL_SEGS = 36;
    const _segEls = [];
    for (let i = 0; i < SIGNAL_SEGS; i++) {
        const seg = document.createElement('div');
        seg.className = 'sdr-signal-seg';
        signalBarEl.appendChild(seg);
        _segEls.push(seg);
    }
    let _signalSmoothed = -120;
    function updateSignalBar(dbfs, squelchOpen = true) {
        const alpha = dbfs > _signalSmoothed ? 0.3 : 0.05;
        _signalSmoothed += alpha * (dbfs - _signalSmoothed);
        const lit = squelchOpen
            ? Math.round(Math.max(0, Math.min(SIGNAL_SEGS, ((_signalSmoothed + 120) / 120) * SIGNAL_SEGS)))
            : 0;
        for (let i = 0; i < SIGNAL_SEGS; i++) {
            _segEls[i].classList.toggle('sdr-signal-seg--on', i < lit);
        }
    }
    // ── Radio select ──────────────────────────────────────────────────────────
    radioSelect.addEventListener('change', () => {
        const id = parseInt(radioSelect.value, 10);
        if (window._SdrAudio) window._SdrAudio.stop();
        setPlayingState(false);
        setStatus(false);
        setRadioControlsDisabled(true);
        if (!isNaN(id) && id > 0) {
            // Apply stored defaults and enable controls immediately on radio selection
            const radio = _knownRadios.find(r => r.id === id);
            if (radio) {
                if (radio.agc === true) {
                    agcCheck.checked = true;
                    gainSlider.disabled = true;
                    gainVal.textContent = 'AUTO';
                    _sdrCurrentGainAuto = true;
                }
                else if (radio.rf_gain != null) {
                    agcCheck.checked = false;
                    gainSlider.value = String(radio.rf_gain);
                    gainVal.textContent = `${radio.rf_gain.toFixed(1)} dB`;
                    _sdrCurrentGain = radio.rf_gain;
                    _sdrCurrentGainAuto = false;
                }
                if (radio.bandwidth != null) {
                    setBandwidthSlider(radio.bandwidth);
                    if (window._SdrAudio)
                        window._SdrAudio.setBandwidthHz(radio.bandwidth);
                }
            }
            radioSelect.dispatchEvent(new CustomEvent('sdr-radio-selected', { bubbles: true, detail: { radioId: id } }));
        }
        else {
            document.dispatchEvent(new CustomEvent('sdr-radio-deselected'));
        }
    });
    // ── Scan (radio tab) ──────────────────────────────────────────────────────
    radioScanBtn.addEventListener('click', () => {
        if (_sdrScanActive) {
            stopScan();
        }
        else {
            startScan();
        }
    });
    // ── Hold scan ─────────────────────────────────────────────────────────────
    lockBtn.addEventListener('click', () => {
        _sdrScanLocked = !_sdrScanLocked;
        lockBtn.classList.toggle('sdr-btn-active', _sdrScanLocked);
        lockBtn.textContent = _sdrScanLocked ? 'RESUME SCAN' : 'HOLD SCAN';
    });
    // ── Edit frequency — collapsible panel ────────────────────────────────────
    efToggle.addEventListener('click', () => {
        const open = !efToggle.classList.contains('expanded');
        efToggle.classList.toggle('expanded', open);
        efBody.classList.toggle('expanded', open);
        if (!open) {
            _editingFreqId = null;
        }
    });
    function buildEfGroupCheckboxes(selectedIds) {
        efGroupsEl.innerHTML = '';
        const makeGroupPill = (id, label, color, active) => {
            const btn = document.createElement('button');
            btn.className = 'sdr-mode-pill sdr-ef-gpill' + (active ? ' active' : '');
            btn.dataset.gid = String(id);
            btn.type = 'button';
            if (color) {
                btn.innerHTML = `<span class="sdr-ef-gpill-dot" style="background:${color}"></span>${label}`;
            }
            else {
                btn.textContent = label;
            }
            btn.addEventListener('click', () => btn.classList.toggle('active'));
            return btn;
        };
        const defaultActive = selectedIds.length === 0 || selectedIds.includes(0);
        efGroupsEl.appendChild(makeGroupPill(0, 'Default', null, defaultActive));
        _groups.forEach(g => {
            efGroupsEl.appendChild(makeGroupPill(g.id, g.name, g.color, selectedIds.includes(g.id)));
        });
    }
    function getEfGroupIds() {
        return Array.from(efGroupsEl.querySelectorAll('.sdr-ef-gpill.active'))
            .map(btn => parseInt(btn.dataset.gid, 10))
            .filter(id => id !== 0);
    }
    function getEfMode() {
        const active = efModePills.querySelector('.sdr-mode-pill.active');
        return active?.dataset.mode ?? 'AM';
    }
    efModePills.addEventListener('click', (e) => {
        const btn = e.target.closest('.sdr-mode-pill');
        if (!btn || !btn.dataset.mode)
            return;
        setModePill(efModePills, btn.dataset.mode);
    });
    function switchToScannerTab() {
        // Expand scanner section
        scannerMainToggle.classList.add('sdr-scanner-main-toggle-expanded');
        scannerMainBody.classList.add('sdr-scanner-main-body-expanded');
        // Ensure freqs section is expanded
        const freqsToggle = document.getElementById('sdr-scanner-freqs-toggle');
        const freqsBody = document.getElementById('sdr-scanner-freqs-body');
        freqsToggle.classList.add('sdr-scanner-section-toggle-expanded');
        freqsBody.classList.add('sdr-scanner-section-body-expanded');
    }
    function clearEditingHighlight() {
        document.querySelectorAll('.sdr-freq-editing').forEach(el => el.classList.remove('sdr-freq-editing'));
    }
    function openEditFreqPanel(f) {
        _editingFreqId = f.id;
        efLabel.value = f.label;
        efFreq.value = (f.frequency_hz / 1e6).toFixed(4);
        setModePill(efModePills, f.mode);
        buildEfGroupCheckboxes(f.group_ids || []);
        efDelete.style.display = '';
        switchToScannerTab();
        efToggle.classList.add('expanded');
        efBody.classList.add('expanded');
        clearEditingHighlight();
        const rowEl = document.querySelector(`.sdr-freq-row-item[data-id="${f.id}"]`);
        if (rowEl)
            rowEl.classList.add('sdr-freq-editing');
        efToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function openAddFreqPanel() {
        _editingFreqId = null;
        efLabel.value = '';
        efFreq.value = _sdrCurrentFreqHz ? (_sdrCurrentFreqHz / 1e6).toFixed(4) : '';
        setModePill(efModePills, _sdrCurrentMode || 'AM');
        buildEfGroupCheckboxes([]);
        efDelete.style.display = 'none';
        switchToScannerTab();
        efToggle.classList.add('expanded');
        efBody.classList.add('expanded');
        efToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    efCancel.addEventListener('click', () => {
        _editingFreqId = null;
        clearEditingHighlight();
        efToggle.classList.remove('expanded');
        efBody.classList.remove('expanded');
    });
    efSave.addEventListener('click', async () => {
        const label = efLabel.value.trim();
        const hz = parseFreqMhz(efFreq.value);
        if (!label || !hz)
            return;
        const mode = getEfMode();
        const groupIds = getEfGroupIds();
        try {
            if (_editingFreqId !== null) {
                await fetch(`/api/sdr/frequencies/${_editingFreqId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label, frequency_hz: hz, mode, group_ids: groupIds }),
                });
            }
            else {
                await fetch('/api/sdr/frequencies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        label,
                        frequency_hz: hz,
                        mode,
                        squelch: _sdrCurrentSquelch,
                        gain: _sdrCurrentGain,
                        scannable: true,
                        group_ids: groupIds,
                    }),
                });
            }
            _editingFreqId = null;
            clearEditingHighlight();
            efToggle.classList.remove('expanded');
            efBody.classList.remove('expanded');
            await reloadData();
        }
        catch (_) { }
    });
    // ── Delete frequency ──────────────────────────────────────────────────────
    efDelete.addEventListener('click', async () => {
        if (_editingFreqId === null)
            return;
        try {
            await fetch(`/api/sdr/frequencies/${_editingFreqId}`, { method: 'DELETE' });
            _editingFreqId = null;
            clearEditingHighlight();
            efToggle.classList.remove('expanded');
            efBody.classList.remove('expanded');
            await reloadData();
        }
        catch (_) { }
    });
    // ── Add frequency button → opens inline panel ─────────────────────────────
    addFreqBtn.addEventListener('click', openAddFreqPanel);
    // ── Group modal ───────────────────────────────────────────────────────────
    const groupModal = document.getElementById('sdr-group-modal');
    const gmodName = document.getElementById('sdr-gmod-name');
    const gmodCancel = document.getElementById('sdr-gmod-cancel');
    const gmodSave = document.getElementById('sdr-gmod-save');
    let _editingGroupId = null;
    function openEditGroupModal(g) {
        _editingGroupId = g.id;
        gmodName.value = g.name;
        groupModal.style.display = 'flex';
        gmodName.focus();
    }
    function closeGroupModal() {
        groupModal.style.display = 'none';
        _editingGroupId = null;
    }
    gmodCancel.addEventListener('click', closeGroupModal);
    groupModal.addEventListener('click', (e) => { if (e.target === groupModal)
        closeGroupModal(); });
    gmodSave.addEventListener('click', async () => {
        const name = gmodName.value.trim();
        if (!name || _editingGroupId === null)
            return;
        try {
            await fetch(`/api/sdr/groups/${_editingGroupId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            closeGroupModal();
            await reloadData();
        }
        catch (_) { }
    });
    // ── Status dot + controls update ─────────────────────────────────────────
    function setStatus(connected) {
        _sdrConnected = connected;
        connDot.className = 'sdr-conn-dot ' + (connected ? 'sdr-dot-on' : 'sdr-dot-off');
        connDot.title = connected ? 'Connected' : 'Disconnected';
        if (connected) {
            setPlayingState(false);
            setRadioControlsDisabled(false);
        } else {
            setPlayingState(false);
            setRadioControlsDisabled(true);
            activeFreq.textContent = '';
            _signalSmoothed = -120;
            for (let i = 0; i < SIGNAL_SEGS; i++)
                _segEls[i].classList.remove('sdr-signal-seg--on');
        }
    }
    function clearRadioSelection() {
        radioSelect.value = '';
        deviceDropdownText.textContent = '— select radio —';
        deviceDropdownText.classList.remove('sdr-device-dropdown-text--chosen');
        setPlayingState(false);
        setRadioControlsDisabled(true);
        document.dispatchEvent(new CustomEvent('sdr-radio-deselected'));
    }
    function applyStatus(msg) {
        // Do not drive the connection dot here — setStatus(true) is only called
        // once real spectrum data arrives (in sdr-boot), so a stale cached
        // connection never produces a false green.
        if (msg.connected) {
            const hadUserFreq = _sdrCurrentFreqHz && _sdrCurrentFreqHz !== msg.center_hz;
            if (!hadUserFreq)
                _sdrCurrentFreqHz = msg.center_hz;
            _sdrCurrentMode = msg.mode;
            _sdrCurrentGain = msg.gain_db;
            _sdrCurrentGainAuto = msg.gain_auto;
            _sdrCurrentSampleRate = msg.sample_rate;
            // Update bandwidth slider max to match the SDR's sample rate
            bwSlider.max = String(msg.sample_rate);
            const clampedBw = Math.min(_sdrCurrentBwHz, msg.sample_rate);
            setBandwidthSlider(clampedBw);
            if (window._SdrAudio)
                window._SdrAudio.setBandwidthHz(clampedBw);
            if (!hadUserFreq)
                displayFreq(msg.center_hz);
            setModePill(modePillsEl, msg.mode);
            if (msg.gain_auto) {
                agcCheck.checked = true;
                if (_sdrConnected) gainSlider.disabled = true;
                gainVal.textContent = 'AUTO';
            }
            else {
                agcCheck.checked = false;
                if (_sdrConnected) gainSlider.disabled = false;
                gainSlider.value = String(msg.gain_db);
                gainVal.textContent = `${msg.gain_db.toFixed(1)} dB`;
            }
        }
    }
    function getSelectedRadioId() {
        const v = parseInt(radioSelect.value, 10);
        return isNaN(v) || v <= 0 ? null : v;
    }
    // ── Custom device dropdown ────────────────────────────────────────────────
    const deviceDropdown = document.getElementById('sdr-device-dropdown');
    const deviceDropdownText = document.getElementById('sdr-device-dropdown-text');
    let _deviceMenuEl = null;
    let _deviceMenuOpen = false;
    function buildDeviceMenu(radios) {
        if (_deviceMenuEl)
            _deviceMenuEl.remove();
        _deviceMenuEl = document.createElement('div');
        _deviceMenuEl.className = 'sdr-device-menu';
        const placeholder = document.createElement('div');
        placeholder.className = 'sdr-device-menu-item sdr-device-menu-placeholder';
        placeholder.textContent = '— select radio —';
        placeholder.addEventListener('click', () => {
            radioSelect.value = '';
            deviceDropdownText.textContent = '— select radio —';
            deviceDropdownText.classList.remove('sdr-device-dropdown-text--chosen');
            closeDeviceMenu();
            setRadioControlsDisabled(true);
            document.dispatchEvent(new CustomEvent('sdr-radio-deselected'));
        });
        _deviceMenuEl.appendChild(placeholder);
        radios.filter(r => r.enabled).forEach(r => {
            const item = document.createElement('div');
            item.className = 'sdr-device-menu-item';
            item.textContent = r.name;
            item.dataset.value = String(r.id);
            item.addEventListener('click', () => {
                radioSelect.value = String(r.id);
                deviceDropdownText.textContent = r.name;
                deviceDropdownText.classList.add('sdr-device-dropdown-text--chosen');
                closeDeviceMenu();
                radioSelect.dispatchEvent(new Event('change'));
            });
            _deviceMenuEl.appendChild(item);
        });
        document.body.appendChild(_deviceMenuEl);
    }
    function positionDeviceMenu() {
        if (!_deviceMenuEl)
            return;
        const rect = deviceDropdown.getBoundingClientRect();
        _deviceMenuEl.style.left = rect.left + 'px';
        _deviceMenuEl.style.top = (rect.bottom) + 'px';
        _deviceMenuEl.style.width = rect.width + 'px';
    }
    function openDeviceMenu() {
        if (!_deviceMenuEl)
            return;
        positionDeviceMenu();
        _deviceMenuEl.classList.add('sdr-device-menu--open');
        deviceDropdown.classList.add('sdr-device-dropdown--open');
        _deviceMenuOpen = true;
    }
    function closeDeviceMenu() {
        if (!_deviceMenuEl)
            return;
        _deviceMenuEl.classList.remove('sdr-device-menu--open');
        deviceDropdown.classList.remove('sdr-device-dropdown--open');
        _deviceMenuOpen = false;
    }
    deviceDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_deviceMenuOpen)
            closeDeviceMenu();
        else
            openDeviceMenu();
    });
    deviceDropdown.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (_deviceMenuOpen)
                closeDeviceMenu();
            else
                openDeviceMenu();
        }
        if (e.key === 'Escape')
            closeDeviceMenu();
    });
    document.addEventListener('click', () => { if (_deviceMenuOpen)
        closeDeviceMenu(); });
    // ── Populate radio list ───────────────────────────────────────────────────
    window._sdrPopulateRadios = function (radios) {
        _knownRadios = radios;
        window._sdrRadioList = radios;
        const current = radioSelect.value;
        while (radioSelect.options.length > 0)
            radioSelect.remove(0);
        const defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.textContent = '— select radio —';
        radioSelect.appendChild(defOpt);
        radios.filter(r => r.enabled).forEach(r => {
            const opt = document.createElement('option');
            opt.value = String(r.id);
            opt.textContent = r.name;
            radioSelect.appendChild(opt);
        });
        // Restore session selection or keep current
        const savedId = current || sessionStorage.getItem('sdrLastRadioId') || '';
        const chosen = savedId ? radios.find(r => r.enabled && String(r.id) === String(savedId)) : null;
        if (chosen) {
            radioSelect.value = String(chosen.id);
            deviceDropdownText.textContent = chosen.name;
            deviceDropdownText.classList.add('sdr-device-dropdown-text--chosen');
            radioSelect.dispatchEvent(new Event('change'));
        } else {
            deviceDropdownText.textContent = '— select radio —';
            deviceDropdownText.classList.remove('sdr-device-dropdown-text--chosen');
        }
        buildDeviceMenu(radios);
    };
    window._SdrControls = { setStatus, applyStatus, getSelectedRadioId, updateSignalBar };
    // ── Render frequency list ─────────────────────────────────────────────────
    function renderFreqs() {
        const list = document.getElementById('sdr-freq-list');
        const empty = document.getElementById('sdr-freq-empty');
        list.innerHTML = '';
        if (_freqs.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        const grouped = { default: [] };
        _groups.forEach(g => { grouped[g.id] = []; });
        _freqs.forEach(f => {
            const ids = f.group_ids && f.group_ids.length > 0 ? f.group_ids : [];
            const realIds = ids.filter(id => id !== 0 && _groups.some(g => g.id === id));
            if (realIds.length === 0) {
                grouped['default'].push(f);
            }
            else {
                realIds.forEach(id => {
                    if (!grouped[id])
                        grouped[id] = [];
                    grouped[id].push(f);
                });
            }
        });
        function renderGroup(name, color, items) {
            if (items.length === 0)
                return;
            const header = document.createElement('div');
            header.className = 'sdr-freq-group-header';
            header.innerHTML = `<span class="sdr-freq-group-dot" style="background:${color}"></span>${name}`;
            list.appendChild(header);
            items.forEach(f => {
                const row = document.createElement('div');
                row.className = 'sdr-freq-row-item';
                row.dataset.id = String(f.id);
                const mhz = (f.frequency_hz / 1e6).toFixed(4);
                row.innerHTML = `
                    <div class="sdr-freq-row-main">
                        <span class="sdr-freq-row-label">${f.label}</span>
                        <span class="sdr-freq-row-mode">${f.mode}</span>
                    </div>
                    <div class="sdr-freq-row-sub">
                        <span class="sdr-freq-row-hz">${mhz} <span>MHz</span></span>
                    </div>
                `;
                row.addEventListener('click', () => {
                    tuneToFreq(f);
                    openEditFreqPanel(f);
                });
                list.appendChild(row);
            });
        }
        _groups.forEach(g => renderGroup(g.name, g.color, grouped[g.id] || []));
        renderGroup('Default', 'rgba(255,255,255,0.2)', grouped['default'] || []);
    }
    function tuneToFreq(f) {
        _sdrCurrentFreqHz = f.frequency_hz;
        _sdrCurrentMode = f.mode;
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify({ cmd: 'tune', frequency_hz: f.frequency_hz }));
            _sdrSocket.send(JSON.stringify({ cmd: 'mode', mode: f.mode }));
        }
        displayFreq(f.frequency_hz);
        setModePill(modePillsEl, f.mode);
    }
    // ── Render group list ─────────────────────────────────────────────────────
    function renderGroups() {
        const list = document.getElementById('sdr-group-list');
        list.innerHTML = '';
        const pills = document.createElement('div');
        pills.className = 'sdr-group-pills';
        // Default pill (non-interactive)
        const defaultPill = document.createElement('div');
        defaultPill.className = 'sdr-group-pill sdr-group-pill-default';
        defaultPill.innerHTML = `
            <span class="sdr-group-pill-dot" style="background:rgba(255,255,255,0.2)"></span>
            <span class="sdr-group-pill-name">Default</span>
        `;
        pills.appendChild(defaultPill);
        _groups.forEach(g => {
            const pill = document.createElement('div');
            pill.className = 'sdr-group-pill';
            pill.innerHTML = `
                <span class="sdr-group-pill-dot" style="background:${g.color}"></span>
                <span class="sdr-group-pill-name">${g.name}</span>
                <button class="sdr-group-pill-edit" title="Rename group">&#x270E;</button>
                <button class="sdr-group-pill-del" title="Delete group">&#x2715;</button>
            `;
            pill.querySelector('.sdr-group-pill-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                openEditGroupModal(g);
            });
            pill.querySelector('.sdr-group-pill-del').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(g.id);
            });
            pills.appendChild(pill);
        });
        list.appendChild(pills);
    }
    // ── Group add/delete ──────────────────────────────────────────────────────
    document.getElementById('sdr-add-group-btn').addEventListener('click', addGroup);
    document.getElementById('sdr-new-group-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            addGroup();
    });
    async function addGroup() {
        const input = document.getElementById('sdr-new-group-name');
        const name = input.value.trim();
        if (!name)
            return;
        try {
            const res = await fetch('/api/sdr/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color: '#c8ff00', sort_order: _groups.length }),
            });
            if (res.ok) {
                input.value = '';
                await reloadData();
            }
        }
        catch (_) { }
    }
    async function deleteGroup(id) {
        try {
            await fetch(`/api/sdr/groups/${id}`, { method: 'DELETE' });
            await reloadData();
        }
        catch (_) { }
    }
    // ── Scanner ───────────────────────────────────────────────────────────────
    let _scanQueue = [];
    let _scanIdx = 0;
    let _scanTimer = null;
    function buildScanQueue() {
        _scanQueue = _freqs.filter(f => f.scannable);
    }
    function startScan() {
        if (_sdrScanLocked)
            return;
        buildScanQueue();
        if (_scanQueue.length === 0)
            return;
        _sdrScanActive = true;
        setScanStatus(true, null);
        _scanIdx = 0;
        doScanStep();
    }
    function stopScan() {
        _sdrScanActive = false;
        if (_scanTimer) {
            clearTimeout(_scanTimer);
            _scanTimer = null;
        }
        setScanStatus(false, null);
    }
    function doScanStep() {
        if (!_sdrScanActive || _sdrScanLocked || _scanQueue.length === 0)
            return;
        const f = _scanQueue[_scanIdx % _scanQueue.length];
        tuneToFreq(f);
        setScanStatus(true, f.frequency_hz);
        _scanIdx++;
        _scanTimer = setTimeout(doScanStep, 2000);
    }
    function setScanStatus(active, currentHz) {
        radioScanInd.className = 'sdr-scan-indicator' + (active ? ' sdr-scan-running' : '');
        radioScanLbl.textContent = active ? 'SCANNING' : 'IDLE';
        radioScanFreq.textContent = (active && currentHz) ? `→ ${(currentHz / 1e6).toFixed(4)} MHz` : '';
        radioScanBtn.textContent = active ? 'STOP SCANNING' : 'START SCANNING';
        radioScanBtn.classList.toggle('sdr-scan-active-btn', active);
    }
    // ── Clips / Recording ─────────────────────────────────────────────────────
    function _escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _fmtDuration(s) {
        const m = Math.floor(s / 60), sec = Math.round(s % 60);
        return `${m}:${String(sec).padStart(2,'0')}`;
    }
    function _fmtBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
        return (b/1048576).toFixed(1) + ' MB';
    }
    function _createLiveRecRow(metadata, startEpoch, squelchOpen = true) {
        const mhz = (metadata.frequency_hz / 1e6).toFixed(4);
        const now = new Date(startEpoch);
        const dt = now.toISOString().replace('T',' ').slice(0,16);
        const row = document.createElement('div');
        row.className = 'sdr-clip-row sdr-clip-live';
        row.innerHTML = `
            <div class="sdr-clip-header">
                <span class="sdr-clip-live-dot${squelchOpen ? '' : ' sdr-clip-live-dot--waiting'}"></span>
                <span class="sdr-clip-name">${squelchOpen ? 'Recording…' : 'Waiting for signal…'}</span>
            </div>
            <div class="sdr-clip-live-meta">
                <span class="sdr-clip-live-mhz">${mhz} MHz</span>
                &nbsp;·&nbsp;
                <span class="sdr-clip-mode-inline">${_escHtml(metadata.mode)}</span>
                &nbsp;·&nbsp;
                <span class="sdr-clip-live-dur">0:00</span>
                &nbsp;·&nbsp;
                <span class="sdr-clip-live-sz">0 B</span>
            </div>
            <div class="sdr-clip-date">${dt}</div>
        `;
        return row;
    }
    function _updateLiveRecRow(elapsedS) {
        if (!_liveRecRow) return;
        _liveRecRow.querySelector('.sdr-clip-name').textContent = _recSquelchOpen ? 'Recording…' : 'Waiting for signal…';
        _liveRecRow.querySelector('.sdr-clip-live-dur').textContent = _fmtDuration(elapsedS);
        // 48 kHz mono int16 = 96000 bytes/s
        _liveRecRow.querySelector('.sdr-clip-live-sz').textContent = _fmtBytes(elapsedS * 96000);
    }
    function _removeLiveRecRow() {
        if (_liveRecRow) { _liveRecRow.remove(); _liveRecRow = null; }
    }
    function renderClips() {
        const filter = _clipsFilter.toLowerCase();
        const visible = filter
            ? _clips.filter(c =>
                (c.name||'').toLowerCase().includes(filter) ||
                (c.notes||'').toLowerCase().includes(filter) ||
                (c.radio_name||'').toLowerCase().includes(filter) ||
                (c.mode||'').toLowerCase().includes(filter))
            : _clips;
        clipsCount.textContent = _clips.length ? String(_clips.length) : '';
        clipsList.innerHTML = '';
        if (_liveRecRow) clipsList.appendChild(_liveRecRow);
        if (visible.length === 0) {
            clipsEmpty.style.display = _liveRecRow ? 'none' : 'block';
            return;
        }
        clipsEmpty.style.display = 'none';
        visible.forEach(c => {
            const row = document.createElement('div');
            row.className = 'sdr-clip-row';
            const mhz = (c.frequency_hz / 1e6).toFixed(4);
            const dur = _fmtDuration(c.duration_s || 0);
            const sz  = _fmtBytes(c.file_size_bytes || 0);
            const dt  = c.started_at ? c.started_at.replace('T',' ').slice(0,16) : '';
            row.innerHTML = `
                <div class="sdr-clip-header">
                    <span class="sdr-clip-name">${_escHtml(c.name)}</span>
                </div>
                <div class="sdr-clip-summary">${mhz} MHz &nbsp;·&nbsp; ${c.mode || ''} &nbsp;·&nbsp; ${dur} &nbsp;·&nbsp; ${sz}</div>
                <div class="sdr-clip-body">
                    <div class="sdr-clip-meta">${mhz} MHz &nbsp;·&nbsp; ${c.mode || ''} &nbsp;·&nbsp; ${dur} &nbsp;·&nbsp; ${sz}</div>
                    <div class="sdr-clip-date">${dt}</div>
                    ${c.notes ? `<div class="sdr-clip-notes">${_escHtml(c.notes)}</div>` : ''}
                    <div class="sdr-clip-actions">
                        <button class="sdr-clip-play-btn sdr-panel-btn" data-id="${c.id}" title="Play">
                            <svg class="sdr-clip-btn-icon sdr-clip-play-icon" width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>
                            <svg class="sdr-clip-btn-icon sdr-clip-stop-icon" width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="display:none"><rect x="1.5" y="1.5" width="3" height="7"/><rect x="5.5" y="1.5" width="3" height="7"/></svg>
                        </button>
                        <button class="sdr-clip-edit-btn sdr-panel-btn" data-id="${c.id}" title="Edit">
                            <svg class="sdr-clip-btn-icon" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z"/></svg>
                        </button>
                        <button class="sdr-clip-export-btn sdr-panel-btn" data-id="${c.id}" data-name="${_escHtml(c.name)}" title="Download WAV">
                            <svg class="sdr-clip-btn-icon" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 1v6M2.5 7l3 3 3-3"/><line x1="1" y1="10" x2="10" y2="10"/></svg>
                        </button>
                        ${c.has_iq_file ? `<button class="sdr-clip-iq-btn sdr-panel-btn" data-id="${c.id}" data-name="${_escHtml(c.name)}" title="Download IQ">IQ</button>` : ''}
                        <button class="sdr-clip-del-btn sdr-panel-btn" data-id="${c.id}" data-name="${_escHtml(c.name)}" title="Delete">
                            <svg class="sdr-clip-btn-icon" width="10" height="11" viewBox="0 0 10 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h8M4 3V2h2v1M8 3l-.7 7H2.7L2 3"/></svg>
                        </button>
                    </div>
                    <div id="sdr-clip-player-${c.id}" class="sdr-clip-player" style="display:none">
                        <span class="sdr-clip-time-cur" id="sdr-clip-cur-${c.id}">00:00</span>
                        <input type="range" class="sdr-clip-seek sdr-panel-slider" id="sdr-clip-seek-${c.id}" value="0" min="0" step="0.01">
                        <span class="sdr-clip-time-dur" id="sdr-clip-dur-${c.id}">00:00</span>
                    </div>
                </div>
                <audio id="sdr-clip-audio-${c.id}" style="display:none" src="/api/sdr/recordings/${c.id}/file"></audio>
            `;
            clipsList.appendChild(row);
            const headerEl  = row.querySelector('.sdr-clip-header');
            const bodyEl    = row.querySelector('.sdr-clip-body');
            function expandBody() {
                row.classList.add('sdr-clip-expanded');
                bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
                bodyEl.addEventListener('transitionend', function clear() {
                    bodyEl.style.maxHeight = 'none';
                    bodyEl.removeEventListener('transitionend', clear);
                });
            }
            function collapseBody() {
                // Pin to current rendered height first so transition starts from real value
                bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    bodyEl.style.maxHeight = '0';
                    row.classList.remove('sdr-clip-expanded');
                });
            }
            // Start expanded
            expandBody();
            headerEl.addEventListener('click', () => {
                if (row.classList.contains('sdr-clip-expanded')) collapseBody();
                else expandBody();
            });
            const playBtn  = row.querySelector('.sdr-clip-play-btn');
            const audio    = document.getElementById(`sdr-clip-audio-${c.id}`);
            const player   = document.getElementById(`sdr-clip-player-${c.id}`);
            const seekEl   = document.getElementById(`sdr-clip-seek-${c.id}`);
            const curEl    = document.getElementById(`sdr-clip-cur-${c.id}`);
            const durEl    = document.getElementById(`sdr-clip-dur-${c.id}`);
            const playIcon = playBtn.querySelector('.sdr-clip-play-icon');
            const stopIcon = playBtn.querySelector('.sdr-clip-stop-icon');
            function fmtT(s) {
                const m = Math.floor(s/60), sec = Math.floor(s%60);
                return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
            }
            function setPlaying(on) {
                playIcon.style.display = on ? 'none' : '';
                stopIcon.style.display = on ? '' : 'none';
                player.style.display = on ? 'flex' : 'none';
            }
            playBtn.addEventListener('click', function() {
                if (!audio.paused || (audio.currentTime > 0 && player.style.display !== 'none')) {
                    audio.pause();
                    audio.currentTime = 0;
                    setPlaying(false);
                } else {
                    audio.play();
                    setPlaying(true);
                }
            });
            audio.addEventListener('loadedmetadata', () => {
                seekEl.max = audio.duration || 0;
                durEl.textContent = fmtT(audio.duration || 0);
            });
            audio.addEventListener('timeupdate', () => {
                seekEl.value = audio.currentTime;
                curEl.textContent = fmtT(audio.currentTime);
            });
            audio.addEventListener('ended', () => {
                audio.currentTime = 0;
                setPlaying(false);
            });
            seekEl.addEventListener('input', () => {
                audio.currentTime = parseFloat(seekEl.value);
            });
            row.querySelector('.sdr-clip-edit-btn').addEventListener('click', () => openEditRecModal(c));
            row.querySelector('.sdr-clip-export-btn').addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = `/api/sdr/recordings/${c.id}/file`;
                a.download = `${c.name}.wav`;
                a.click();
            });
            if (c.has_iq_file) {
                row.querySelector('.sdr-clip-iq-btn').addEventListener('click', () => {
                    const a = document.createElement('a');
                    a.href = `/api/sdr/recordings/${c.id}/iq`;
                    a.download = `${c.name}.u8`;
                    a.click();
                });
            }
            row.querySelector('.sdr-clip-del-btn').addEventListener('click', () => openDeleteRecModal(c));
        });
        setTimeout(_updateClipsScrollHint, 0);
    }
    async function reloadClips() {
        try {
            const res = await fetch('/api/sdr/recordings', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            _clips = await res.json();
        } catch(e) { console.error('[SDR] reloadClips failed:', e); }
        renderClips();
        renderMgmt();
    }
    // ── Settings / file management ────────────────────────────────────────────
    function renderMgmt() {
        const wavList  = document.getElementById('sdr-mgmt-wav-list');
        const iqList   = document.getElementById('sdr-mgmt-iq-list');
        const wavCount = document.getElementById('sdr-mgmt-wav-count');
        const iqCount  = document.getElementById('sdr-mgmt-iq-count');
        if (!wavList || !iqList) return;
        const wavClips = _clips.slice();                   // all clips have a WAV
        const iqClips  = _clips.filter(c => c.has_iq_file);
        wavCount.textContent = wavClips.length || '';
        iqCount.textContent  = iqClips.length  || '';
        function buildMgmtRow(c, type) {
            const mhz = (c.frequency_hz / 1e6).toFixed(4);
            const dt  = c.started_at ? c.started_at.replace('T',' ').slice(0,16) : '';
            const sz  = _fmtBytes(type === 'iq' ? (c.iq_file_size_bytes || 0) : (c.file_size_bytes || 0));
            const row = document.createElement('div');
            row.className = 'sdr-mgmt-row';
            row.innerHTML = `
                <div class="sdr-mgmt-row-main">
                    <span class="sdr-mgmt-name">${_escHtml(c.name)}</span>
                    <span class="sdr-mgmt-mode">${_escHtml(c.mode)}</span>
                </div>
                <div class="sdr-mgmt-row-sub">
                    <span class="sdr-mgmt-meta">${mhz} MHz &nbsp;·&nbsp; ${sz}</span>
                    <span class="sdr-mgmt-date">${dt}</span>
                </div>
                <div class="sdr-mgmt-actions">
                    <button class="sdr-mgmt-edit-btn sdr-panel-btn" title="Edit">
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z"/></svg>
                    </button>
                    <button class="sdr-mgmt-dl-btn sdr-panel-btn" title="Download">
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 1v6M2.5 7l3 3 3-3"/><line x1="1" y1="10" x2="10" y2="10"/></svg>
                    </button>
                    <button class="sdr-mgmt-del-btn sdr-panel-btn" title="Delete">
                        <svg width="10" height="11" viewBox="0 0 10 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h8M4 3V2h2v1M8 3l-.7 7H2.7L2 3"/></svg>
                    </button>
                </div>
            `;
            row.querySelector('.sdr-mgmt-edit-btn').addEventListener('click', () => openEditRecModal(c));
            row.querySelector('.sdr-mgmt-dl-btn').addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = type === 'iq' ? `/api/sdr/recordings/${c.id}/iq` : `/api/sdr/recordings/${c.id}/file`;
                a.download = type === 'iq' ? `${c.name}.u8` : `${c.name}.wav`;
                a.click();
            });
            row.querySelector('.sdr-mgmt-del-btn').addEventListener('click', () => openDeleteRecModal(c));
            return row;
        }
        wavList.innerHTML = '';
        wavClips.forEach(c => wavList.appendChild(buildMgmtRow(c, 'wav')));
        iqList.innerHTML = '';
        iqClips.forEach(c => iqList.appendChild(buildMgmtRow(c, 'iq')));
        // Delete all buttons
        const wavDelAll = document.getElementById('sdr-mgmt-wav-delete-all');
        const iqDelAll  = document.getElementById('sdr-mgmt-iq-delete-all');
        if (wavDelAll) {
            wavDelAll.onclick = async () => {
                if (!confirm(`Delete all ${wavClips.length} WAV recording(s)?`)) return;
                await Promise.all(wavClips.map(c => fetch(`/api/sdr/recordings/${c.id}`, { method: 'DELETE' })));
                await reloadClips();
            };
        }
        if (iqDelAll) {
            iqDelAll.onclick = async () => {
                if (!confirm(`Delete all ${iqClips.length} IQ file(s)?`)) return;
                await Promise.all(iqClips.map(c => fetch(`/api/sdr/recordings/${c.id}/iq`, { method: 'DELETE' })));
                await reloadClips();
            };
        }
    }
    // Edit recording modal
    function openEditRecModal(c) {
        _editingRecId = c.id;
        recmodName.value = c.name || '';
        recmodNotes.value = c.notes || '';
        recModal.style.display = 'flex';
        recmodName.focus();
    }
    function closeEditRecModal() {
        recModal.style.display = 'none';
        _editingRecId = null;
    }
    recmodCancel.addEventListener('click', closeEditRecModal);
    recModal.addEventListener('click', (e) => { if (e.target === recModal) closeEditRecModal(); });
    recmodSave.addEventListener('click', async () => {
        const name = recmodName.value.trim();
        if (!name || _editingRecId === null) return;
        try {
            await fetch(`/api/sdr/recordings/${_editingRecId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, notes: recmodNotes.value.trim() }),
            });
            closeEditRecModal();
            await reloadClips();
        } catch(_) {}
    });
    // Delete recording modal
    function openDeleteRecModal(c) {
        _deletingRecId = c.id;
        recDelMsg.textContent = `Delete "${c.name}"? This cannot be undone.`;
        recDelModal.style.display = 'flex';
    }
    function closeDeleteRecModal() {
        recDelModal.style.display = 'none';
        _deletingRecId = null;
    }
    recDelCancel.addEventListener('click', closeDeleteRecModal);
    recDelModal.addEventListener('click', (e) => { if (e.target === recDelModal) closeDeleteRecModal(); });
    recDelConfirm.addEventListener('click', async () => {
        if (_deletingRecId === null) return;
        try {
            await fetch(`/api/sdr/recordings/${_deletingRecId}`, { method: 'DELETE' });
            closeDeleteRecModal();
            await reloadClips();
        } catch(_) {}
    });
    // Clips search
    clipsSearch.addEventListener('input', () => {
        _clipsFilter = clipsSearch.value;
        renderClips();
    });
    // Record button
    let _recStartEpoch = 0;
    recBtn.addEventListener('click', async () => {
        if (!_isRecording) {
            const radioId = getSelectedRadioId();
            const radioName = radioId
                ? (_knownRadios.find(r => r.id === radioId) || {}).name || ''
                : '';
            const metadata = {
                radio_id: radioId || null,
                radio_name: radioName,
                frequency_hz: _sdrCurrentFreqHz || 0,
                mode: _sdrCurrentMode || 'AM',
                gain_db: _sdrCurrentGain || 30,
                squelch_dbfs: _sdrCurrentSquelch || -60,
                sample_rate: _sdrCurrentSampleRate || 2048000,
            };
            if (!window._SdrAudio) return;
            const recId = await window._SdrAudio.startRecording(metadata);
            if (!recId) return;
            _isRecording = true;
            _recStartEpoch = Date.now();
            _recPausedMs = 0;
            // If squelch is set to a real threshold, start paused until signal breaks through
            const squelchActive = (metadata.squelch_dbfs ?? -120) > -119;
            _recSquelchOpen = !squelchActive;
            _recPauseStart = squelchActive ? Date.now() : null;
            clipsCount.textContent = '';
            recBtn.classList.add('sdr-rec-btn--active');
            _setRecBtnIcon(true);
            if (recTimer) recTimer.textContent = _recSquelchOpen ? '0:00' : '0:00 WAIT';
            _removeLiveRecRow();
            _liveRecRow = _createLiveRecRow(metadata, _recStartEpoch, _recSquelchOpen);
            clipsEmpty.style.display = 'none';
            clipsList.insertBefore(_liveRecRow, clipsList.firstChild);
            _recTimerInterval = setInterval(() => {
                const pausedSoFar = _recPauseStart != null
                    ? _recPausedMs + (Date.now() - _recPauseStart)
                    : _recPausedMs;
                const s = Math.floor((Date.now() - _recStartEpoch - pausedSoFar) / 1000);
                if (recTimer) recTimer.textContent = _recSquelchOpen ? _fmtDuration(s) : _fmtDuration(s) + ' WAIT';
                _updateLiveRecRow(s);
            }, 1000);
        } else {
            await _stopRecordingIfActive();
        }
    });
    // ── Data reload ───────────────────────────────────────────────────────────
    async function reloadData() {
        try {
            const [gRes, fRes] = await Promise.all([
                fetch('/api/sdr/groups'),
                fetch('/api/sdr/frequencies'),
            ]);
            _groups = await gRes.json();
            _freqs = await fRes.json();
            renderGroups();
            renderFreqs();
            buildScanQueue();
        }
        catch (_) { }
        await reloadClips();
    }
    // ── Visibility ────────────────────────────────────────────────────────────
    function show() {
        _visible = true;
        panel.classList.remove('sdr-panel-hidden');
        document.body.classList.remove('sdr-panel-hidden');
        sessionStorage.setItem('sdrPanelOpen', '1');
    }
    function hide() {
        _visible = false;
        panel.classList.add('sdr-panel-hidden');
        document.body.classList.add('sdr-panel-hidden');
        sessionStorage.setItem('sdrPanelOpen', '0');
    }
    function toggle() { if (_visible)
        hide();
    else
        show(); }
    function isVisible() { return _visible; }
    function refresh(groups, freqs) {
        _groups = groups;
        _freqs = freqs;
        renderGroups();
        renderFreqs();
        buildScanQueue();
    }
    // ── Public API ────────────────────────────────────────────────────────────
    function onSquelchChange(open) {
        if (!_isRecording) return;
        if (open && !_recSquelchOpen) {
            // Squelch just opened — resume timer
            if (_recPauseStart != null) {
                _recPausedMs += Date.now() - _recPauseStart;
                _recPauseStart = null;
            }
            _recSquelchOpen = true;
            if (_liveRecRow) {
                _liveRecRow.querySelector('.sdr-clip-name').textContent = 'Recording…';
                _liveRecRow.querySelector('.sdr-clip-live-dot').classList.remove('sdr-clip-live-dot--waiting');
            }
        } else if (!open && _recSquelchOpen) {
            // Squelch just closed — pause timer
            _recPauseStart = Date.now();
            _recSquelchOpen = false;
            if (_liveRecRow) {
                _liveRecRow.querySelector('.sdr-clip-name').textContent = 'Waiting for signal…';
                _liveRecRow.querySelector('.sdr-clip-live-dot').classList.add('sdr-clip-live-dot--waiting');
            }
        }
    }
    window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus, onSquelchChange };
    window._sdrPanelReload = reloadData;
    reloadData();
})();
