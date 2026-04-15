// ============================================================
// SDR PANEL
// SDR-specific left panel — replaces the shared map sidebar on the SDR page.
// Also reused as a tab pane in the shared map-sidebar on all other pages.
//
// Call signature:
//   buildSdrPanel()            — SDR page: creates #sdr-panel, appends to body
//   buildSdrPanel(mountTarget) — Other pages: injects panel content into mountTarget
//
// Exposes window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus }
// Exposes window._SdrControls = { setStatus, applyStatus, getSelectedRadioId }
// Exposes window._sdrPopulateRadios
// ============================================================

/// <reference path="./globals.d.ts" />

function buildSdrPanel(mountTarget?: HTMLElement) {

    // ── Mode ──────────────────────────────────────────────────────────────────
    // 'panel' = standalone fixed panel on SDR page
    // 'tab'   = embedded inside map-sidebar radio pane on other pages
    const _tabMode = !!mountTarget;

    // ── DOM ───────────────────────────────────────────────────────────────────

    const panel = _tabMode ? (mountTarget as HTMLElement) : document.createElement('div');
    if (!_tabMode) {
        panel.id = 'sdr-panel';
    }

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
                        <input id="sdr-vol-slider" class="sdr-panel-slider" type="range" min="0" max="200" step="1" value="80">
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
                        <span class="sdr-group-toggle-label">RECORDINGS</span>
                    </div>
                    <span id="sdr-clips-count" class="sdr-clips-count"></span>
                </button>
                <div class="sdr-group-body sdr-group-body-expanded" id="sdr-recording-group-body">
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
                    <button id="sdr-recmod-save" class="sdr-panel-btn sdr-editfreq-save-btn">SAVE</button>
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
    `;

    if (!_tabMode) {
        document.body.appendChild(panel);
    }

    // ── State ─────────────────────────────────────────────────────────────────

    let _groups:       SdrFrequencyGroup[]   = [];
    let _freqs:        SdrStoredFrequency[]  = [];
    let _knownRadios:  SdrRadio[]            = [];
    let _visible:      boolean = true;
    let _editingFreqId: number | null = null;

    // ── Clips / recording state ───────────────────────────────────────────────
    let _clips:            any[]         = [];
    let _clipsFilter       = '';
    let _isRecording       = false;
    let _recTimerInterval: ReturnType<typeof setInterval> | null = null;
    let _liveRecRow:       HTMLDivElement | null = null;
    let _recPausedMs       = 0;
    let _recPauseStart:    number | null = null;
    let _recSquelchOpen    = true;
    let _recStartEpoch     = 0;
    let _editingRecId:     number | null = null;
    let _deletingRecId:    number | null = null;

    // ── Radio / Scanner main section toggles ─────────────────────────────────

    function bindMainToggle(toggleId: string, bodyId: string) {
        const toggle = document.getElementById(toggleId) as HTMLButtonElement;
        const body   = document.getElementById(bodyId)   as HTMLDivElement;
        toggle.addEventListener('click', () => {
            const expanded = toggle.classList.contains('sdr-scanner-main-toggle-expanded');
            toggle.classList.toggle('sdr-scanner-main-toggle-expanded', !expanded);
            body.classList.toggle('sdr-scanner-main-body-expanded', !expanded);
        });
        return { toggle, body };
    }

    bindMainToggle('sdr-radio-main-toggle', 'sdr-pane-radio');
    const { toggle: scannerMainToggle, body: scannerMainBody } =
        bindMainToggle('sdr-scanner-main-toggle', 'sdr-pane-scanner');

    // ── Scanner section collapse ──────────────────────────────────────────────

    panel.querySelectorAll<HTMLButtonElement>('.sdr-scanner-section-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const section = toggle.dataset.section;
            const body = document.getElementById(`sdr-scanner-${section}-body`);
            const expanded = toggle.classList.contains('sdr-scanner-section-toggle-expanded');
            toggle.classList.toggle('sdr-scanner-section-toggle-expanded', !expanded);
            if (body) body.classList.toggle('sdr-scanner-section-body-expanded', !expanded);
        });
    });

    // ── Radio group toggles (Device / Signal) ────────────────────────────────

    function bindGroupToggle(toggleId: string, bodyId: string) {
        const toggle = document.getElementById(toggleId) as HTMLButtonElement;
        const body   = document.getElementById(bodyId)   as HTMLDivElement;
        if (!toggle || !body) return;
        toggle.addEventListener('click', () => {
            const expanded = toggle.classList.contains('sdr-group-toggle-expanded');
            toggle.classList.toggle('sdr-group-toggle-expanded', !expanded);
            body.classList.toggle('sdr-group-body-expanded', !expanded);
        });
    }

    bindGroupToggle('sdr-device-group-toggle', 'sdr-device-group-body');
    bindGroupToggle('sdr-signal-group-toggle', 'sdr-signal-group-body');
    bindGroupToggle('sdr-recording-group-toggle', 'sdr-recording-group-body');

    // ── Element refs ──────────────────────────────────────────────────────────

    const radioSelect  = document.getElementById('sdr-radio-select')  as HTMLSelectElement;
    const freqInput    = document.getElementById('sdr-freq-input')     as HTMLInputElement;
    const freqTuneBtn  = document.getElementById('sdr-freq-tune')      as HTMLButtonElement;
    const freqStopBtn  = document.getElementById('sdr-freq-stop')      as HTMLButtonElement;
    const modePillsEl  = document.getElementById('sdr-mode-pills')!;
    const gainSlider   = document.getElementById('sdr-gain-slider')    as HTMLInputElement;
    const gainVal      = document.getElementById('sdr-gain-val')       as HTMLSpanElement;
    const agcCheck     = document.getElementById('sdr-agc-check')      as HTMLInputElement;
    const volSlider    = document.getElementById('sdr-vol-slider')     as HTMLInputElement;
    const volVal       = document.getElementById('sdr-vol-val')        as HTMLSpanElement;
    const sqSlider     = document.getElementById('sdr-sq-slider')      as HTMLInputElement;
    const sqVal        = document.getElementById('sdr-sq-val')         as HTMLSpanElement;
    const bwSlider     = document.getElementById('sdr-bw-slider')      as HTMLInputElement;
    const bwVal        = document.getElementById('sdr-bw-val')         as HTMLSpanElement;
    const connDot      = document.getElementById('sdr-conn-dot')       as HTMLDivElement;
const activeFreq   = document.getElementById('sdr-active-freq')    as HTMLSpanElement;
    const signalBarEl  = document.getElementById('sdr-signal-bar')     as HTMLDivElement;
    const radioScanBtn = document.getElementById('sdr-radio-scan-btn') as HTMLButtonElement;
    const radioScanInd = document.getElementById('sdr-radio-scan-indicator') as HTMLDivElement;
    const radioScanLbl = document.getElementById('sdr-radio-scan-label') as HTMLSpanElement;
    const radioScanFreq= document.getElementById('sdr-radio-scan-freq') as HTMLSpanElement;
    const addFreqBtn   = document.getElementById('sdr-radio-add-freq') as HTMLButtonElement;
    const lockBtn      = document.getElementById('sdr-radio-lock-btn') as HTMLButtonElement;

    // Recording refs
    const recBtn           = document.getElementById('sdr-rec-btn')           as HTMLButtonElement;
    const clipsSearch      = document.getElementById('sdr-clips-search')      as HTMLInputElement;
    const clipsList        = document.getElementById('sdr-clips-list')        as HTMLDivElement;
    const clipsEmpty       = document.getElementById('sdr-clips-empty')       as HTMLDivElement;
    const clipsCount       = document.getElementById('sdr-clips-count')       as HTMLSpanElement;
    const clipsScrollHint  = document.getElementById('sdr-clips-scroll-hint') as HTMLDivElement;
    const clipsScrollArrow = document.getElementById('sdr-clips-scroll-arrow') as unknown as SVGElement;
    const recModal         = document.getElementById('sdr-rec-modal')         as HTMLDivElement;
    const recmodName       = document.getElementById('sdr-recmod-name')       as HTMLInputElement;
    const recmodNotes      = document.getElementById('sdr-recmod-notes')      as HTMLTextAreaElement;
    const recmodCancel     = document.getElementById('sdr-recmod-cancel')     as HTMLButtonElement;
    const recmodSave       = document.getElementById('sdr-recmod-save')       as HTMLButtonElement;
    const recDelModal      = document.getElementById('sdr-rec-del-modal')     as HTMLDivElement;
    const recDelMsg        = document.getElementById('sdr-recdelmod-msg')     as HTMLDivElement;
    const recDelCancel     = document.getElementById('sdr-recdelmod-cancel')  as HTMLButtonElement;
    const recDelConfirm    = document.getElementById('sdr-recdelmod-confirm') as HTMLButtonElement;

    // Edit freq panel
    const efToggle    = document.getElementById('sdr-editfreq-toggle')! as HTMLButtonElement;
    const efBody      = document.getElementById('sdr-editfreq-body')!;
    const efLabel     = document.getElementById('sdr-ef-label')     as HTMLInputElement;
    const efFreq      = document.getElementById('sdr-ef-freq')      as HTMLInputElement;
    const efModePills = document.getElementById('sdr-ef-mode-pills')!;
    const efGroupsEl  = document.getElementById('sdr-ef-groups')!;
    const efCancel    = document.getElementById('sdr-ef-cancel')    as HTMLButtonElement;
    const efSave      = document.getElementById('sdr-ef-save')      as HTMLButtonElement;
    const efDelete    = document.getElementById('sdr-ef-delete')    as HTMLButtonElement;

    // ── Helpers ───────────────────────────────────────────────────────────────

    function setRadioControlsDisabled(disabled: boolean) {
        freqInput.disabled   = disabled;
        freqTuneBtn.disabled = disabled;
        // freqStopBtn is managed exclusively by setPlayingState
        gainSlider.disabled  = disabled || _sdrCurrentGainAuto;
        agcCheck.disabled    = disabled;
        volSlider.disabled   = disabled;
        sqSlider.disabled    = disabled;
        bwSlider.disabled    = disabled;
        radioScanBtn.disabled = disabled;
        lockBtn.disabled     = disabled;
        addFreqBtn.disabled  = disabled;
        modePillsEl.querySelectorAll<HTMLButtonElement>('.sdr-mode-pill').forEach(btn => {
            btn.disabled = disabled;
        });
        [gainVal, volVal, sqVal, bwVal].forEach(el => {
            el.classList.toggle('sdr-slider-val--dimmed', disabled);
        });
    }

    // Disable controls until a radio is selected
    setRadioControlsDisabled(true);

    // ── Persist / restore all SDR settings across page navigation ────────────

    function _saveSettings() {
        try {
            sessionStorage.setItem('sdrSettings', JSON.stringify({
                gainDb:    _sdrCurrentGain,
                gainAuto:  _sdrCurrentGainAuto,
                squelch:   _sdrCurrentSquelch,
                bwHz:      _sdrCurrentBwHz,
                vol:       volSlider ? parseInt(volSlider.value, 10) : 100,
                mode:      _sdrCurrentMode,
                freqHz:    _sdrCurrentFreqHz,
            }));
        } catch (_e) {}
    }

    function _restoreSettings() {
        try {
            const raw = sessionStorage.getItem('sdrSettings');
            if (!raw) return;
            const s = JSON.parse(raw) as {
                gainDb: number; gainAuto: boolean; squelch: number;
                bwHz: number; vol: number; mode: string; freqHz: number;
            };
            if (s.freqHz > 0) {
                _sdrCurrentFreqHz = s.freqHz;
                displayFreq(s.freqHz);
            }
            if (s.mode) {
                _sdrCurrentMode = s.mode;
                setModePill(modePillsEl, s.mode);
            }
            if (typeof s.gainDb === 'number') {
                _sdrCurrentGain     = s.gainDb;
                _sdrCurrentGainAuto = !!s.gainAuto;
                gainSlider.value    = String(s.gainDb);
                agcCheck.checked    = _sdrCurrentGainAuto;
                gainVal.textContent = _sdrCurrentGainAuto ? 'AUTO' : `${s.gainDb.toFixed(1)} dB`;
                gainSlider.disabled = _sdrCurrentGainAuto;
            }
            if (typeof s.squelch === 'number') {
                _sdrCurrentSquelch  = s.squelch;
                sqSlider.value      = String(s.squelch);
                sqVal.textContent   = `${s.squelch} dBFS`;
            }
            if (typeof s.bwHz === 'number' && s.bwHz > 0) {
                _sdrCurrentBwHz   = s.bwHz;
                bwSlider.value    = String(s.bwHz);
                bwVal.textContent = formatBwHz(s.bwHz);
            }
            if (typeof s.vol === 'number') {
                volSlider.value    = String(s.vol);
                volVal.textContent = `${s.vol}%`;
                if (window._SdrAudio) window._SdrAudio.setVolume(s.vol / 100);
            }
        } catch (_e) {}
    }

    // Restore persisted settings on all pages — freq/mode/gain are user settings that should
    // survive navigation. On the SDR page the server may also send a status update, but
    // _restoreSettings ensures the input is pre-filled immediately on load.
    _restoreSettings();
    if (_tabMode) {
        const savedRadioId = sessionStorage.getItem('sdrLastRadioId');
        if (savedRadioId) radioSelect.value = savedRadioId;
    }


    function sendCmd(obj: object) {
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify(obj));
        }
    }

    function parseFreqMhz(raw: string): number | null {
        const parsedValue = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(parsedValue) || parsedValue <= 0) return null;
        return parsedValue > 30000 ? parsedValue : Math.round(parsedValue * 1e6);
    }

    function displayFreq(hz: number) {
        if (document.activeElement !== freqInput) {
            freqInput.value = (hz / 1e6).toFixed(3);
        }
        activeFreq.textContent = (hz / 1e6).toFixed(3) + ' MHz';
    }

    // ── Mode pills (main radio tab) ───────────────────────────────────────────

    function setModePill(container: HTMLElement, mode: string) {
        container.querySelectorAll<HTMLButtonElement>('.sdr-mode-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    function defaultBwHz(mode: string): number {
        switch (mode) {
            case 'WFM':         return 200_000;
            case 'NFM':         return 12_500;
            case 'AM':          return 10_000;
            case 'USB': case 'LSB': return 3_000;
            case 'CW':          return 500;
            default:            return 10_000;
        }
    }

    modePillsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sdr-mode-pill');
        if (!btn || !btn.dataset.mode) return;
        const mode = btn.dataset.mode;
        setModePill(modePillsEl, mode);
        _sdrCurrentMode = mode;
        _saveSettings();
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

    function _setRecBtnIcon(recording: boolean) {
        const icon = document.getElementById('sdr-rec-icon');
        if (!icon) return;
        icon.innerHTML = recording
            ? '<rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor"/>'
            : '<circle cx="5" cy="5" r="4" fill="currentColor"/>';
    }

    async function _stopRecordingIfActive() {
        if (!_isRecording) return;
        _isRecording = false;
        if (_recTimerInterval) { clearInterval(_recTimerInterval); _recTimerInterval = null; }
        recBtn.classList.remove('sdr-rec-btn--active');
        _setRecBtnIcon(false);
        if (!window._SdrAudio) return;
        const radioId = getSelectedRadioId();
        const radioName = radioId ? (_knownRadios.find(r => r.id === radioId) || {} as any).name || '' : '';
        const metadata: SdrRecordingMetadata = {
            radio_id:     radioId,
            radio_name:   radioName,
            frequency_hz: _sdrCurrentFreqHz || 0,
            mode:         _sdrCurrentMode   || 'AM',
            gain_db:      _sdrCurrentGain   || 30,
            squelch_dbfs: _sdrCurrentSquelch || -60,
            sample_rate:  _sdrCurrentSampleRate || 2048000,
        };
        await window._SdrAudio.stopRecording(metadata);
        _removeLiveRecRow();
        await reloadClips();
        setTimeout(reloadClips, 2000);
        const recGroupToggle = document.getElementById('sdr-recording-group-toggle');
        const recGroupBody   = document.getElementById('sdr-recording-group-body');
        if (recGroupToggle && !recGroupToggle.classList.contains('sdr-group-toggle-expanded')) {
            recGroupToggle.classList.add('sdr-group-toggle-expanded');
            recGroupBody!.classList.add('sdr-group-body-expanded');
        }
    }

    function setPlayingState(playing: boolean) {
        _sdrPlaying = playing;
        sessionStorage.setItem('sdrPlaying', playing ? '1' : '0');
        freqTuneBtn.disabled = playing;
        freqStopBtn.disabled = !playing;
        recBtn.disabled = !playing;
        if (!playing) _stopRecordingIfActive();
    }

    function tune() {
        if (!getSelectedRadioId()) return;
        const hz = parseFreqMhz(freqInput.value);
        if (!hz) return;
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
        _saveSettings();
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

    function retune(hz: number) {
        if (!_sdrSocket || _sdrSocket.readyState !== WebSocket.OPEN) return;
        _sdrCurrentFreqHz = hz;
        displayFreq(hz);
        sessionStorage.setItem('sdrLastFreqHz', String(hz));
        sendCmd({ cmd: 'tune', frequency_hz: hz });
    }

    freqTuneBtn.addEventListener('click', tune);
    freqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tune(); });

    // Auto-retune when frequency input changes while audio is playing
    let _retuneDebounce: ReturnType<typeof setTimeout> | null = null;
    freqInput.addEventListener('input', () => {
        if (freqStopBtn.disabled) return; // not playing
        const hz = parseFreqMhz(freqInput.value);
        if (!hz) return;
        if (_retuneDebounce) clearTimeout(_retuneDebounce);
        _retuneDebounce = setTimeout(() => retune(hz), 600);
    });

    freqStopBtn.addEventListener('click', () => {
        if (window._SdrAudio) window._SdrAudio.stop();
        setPlayingState(false);
        clearRadioSelection();
    });

    // ── Gain + AGC ────────────────────────────────────────────────────────────

    let _gainDebounce: ReturnType<typeof setTimeout> | null = null;

    function applyGain() {
        const gainDb = parseFloat(gainSlider.value);
        const auto = agcCheck.checked || gainDb < 0;
        if (auto) {
            gainVal.textContent = 'AUTO';
            _sdrCurrentGainAuto = true;
        } else {
            gainVal.textContent = `${gainDb.toFixed(1)} dB`;
            _sdrCurrentGain = gainDb;
            _sdrCurrentGainAuto = false;
        }
        _saveSettings();
        if (_gainDebounce) clearTimeout(_gainDebounce);
        _gainDebounce = setTimeout(() => {
            sendCmd({ cmd: 'gain', gain_db: auto ? null : gainDb });
        }, 150);
    }

    gainSlider.addEventListener('input', applyGain);

    agcCheck.addEventListener('change', () => {
        gainSlider.disabled = agcCheck.checked;
        applyGain();
    });

    // ── Volume ────────────────────────────────────────────────────────────────

    volSlider.addEventListener('input', () => {
        const volumeLevel = parseInt(volSlider.value, 10);
        volVal.textContent = `${volumeLevel}%`;
        _saveSettings();
        if (window._SdrAudio) window._SdrAudio.setVolume(volumeLevel / 100);
    });

    // ── Squelch ───────────────────────────────────────────────────────────────

    let _sqDebounce: ReturnType<typeof setTimeout> | null = null;
    sqSlider.addEventListener('input', () => {
        const sq = parseInt(sqSlider.value, 10);
        sqVal.textContent = `${sq} dBFS`;
        _sdrCurrentSquelch = sq;
        _saveSettings();
        if (_sqDebounce) clearTimeout(_sqDebounce);
        _sqDebounce = setTimeout(() => {
            sendCmd({ cmd: 'squelch', squelch_dbfs: sq });
            if (window._SdrAudio) window._SdrAudio.setSquelch(sq);
        }, 150);
    });

    // ── Bandwidth ─────────────────────────────────────────────────────────────

    function formatBwHz(hz: number): string {
        if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
        if (hz >= 1_000)     return `${Math.round(hz / 1000)} kHz`;
        return `${hz} Hz`;
    }

    function setBandwidthSlider(hz: number) {
        bwSlider.value    = String(hz);
        bwVal.textContent = formatBwHz(hz);
        _sdrCurrentBwHz   = hz;
    }

    // Snap to nearest valid RTL-SDR sample rate (225001–300000 or 900001–3200000 Hz)
    function snapToValidSampleRate(hz: number): number {
        if (hz <= 262500) return 250000;
        if (hz <= 600000) return 300000;
        if (hz <= 1474000) return 1024000;
        if (hz <= 1761000) return 1536000;
        if (hz <= 1921000) return 1792000;
        if (hz <= 2048000) return 2048000;
        return 2048000;
    }

    let _bwDebounce: ReturnType<typeof setTimeout> | null = null;
    bwSlider.addEventListener('input', () => {
        const hz = parseInt(bwSlider.value, 10);
        bwVal.textContent = formatBwHz(hz);
        _sdrCurrentBwHz   = hz;
        _saveSettings();
        if (window._SdrAudio) window._SdrAudio.setBandwidthHz(hz);
        if (_bwDebounce) clearTimeout(_bwDebounce);
        _bwDebounce = setTimeout(() => {
            sendCmd({ cmd: 'sample_rate', rate_hz: snapToValidSampleRate(hz) });
        }, 150);
    });

    // ── Recording helpers ─────────────────────────────────────────────────────

    function _escHtml(s: string): string {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _fmtDuration(s: number): string {
        const m = Math.floor(s / 60), sec = Math.round(s % 60);
        return `${m}:${String(sec).padStart(2,'0')}`;
    }
    function _fmtBytes(b: number): string {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    function _createLiveRecRow(metadata: SdrRecordingMetadata, startEpoch: number, squelchOpen = true): HTMLDivElement {
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

    function _updateLiveRecRow(elapsedS: number) {
        if (!_liveRecRow) return;
        (_liveRecRow.querySelector('.sdr-clip-name') as HTMLElement).textContent = _recSquelchOpen ? 'Recording…' : 'Waiting for signal…';
        (_liveRecRow.querySelector('.sdr-clip-live-dur') as HTMLElement).textContent = _fmtDuration(elapsedS);
        (_liveRecRow.querySelector('.sdr-clip-live-sz') as HTMLElement).textContent = _fmtBytes(elapsedS * 96000);
    }

    function _removeLiveRecRow() {
        if (_liveRecRow) { _liveRecRow.remove(); _liveRecRow = null; }
    }

    function _updateClipsScrollHint() {
        if (!clipsScrollHint) return;
        const wrap = document.getElementById('sdr-clips-list-wrap')!;
        const hasOverflow = wrap.scrollHeight > wrap.clientHeight + 2;
        const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 4;
        clipsScrollHint.style.display = (hasOverflow && !atBottom) ? 'flex' : 'none';
    }

    document.getElementById('sdr-clips-list-wrap')!
        .addEventListener('scroll', _updateClipsScrollHint);

    function renderClips() {
        const filter = _clipsFilter.toLowerCase();
        const visible = filter
            ? _clips.filter((c: any) =>
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
        visible.forEach((c: any) => {
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

            const headerEl = row.querySelector('.sdr-clip-header')!;
            const bodyEl   = row.querySelector('.sdr-clip-body') as HTMLElement;
            function expandBody() {
                row.classList.add('sdr-clip-expanded');
                bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
                bodyEl.addEventListener('transitionend', function clear() {
                    bodyEl.style.maxHeight = 'none';
                    bodyEl.removeEventListener('transitionend', clear);
                });
            }
            function collapseBody() {
                bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    bodyEl.style.maxHeight = '0';
                    row.classList.remove('sdr-clip-expanded');
                });
            }
            expandBody();
            headerEl.addEventListener('click', () => {
                if (row.classList.contains('sdr-clip-expanded')) collapseBody();
                else expandBody();
            });

            const playBtn  = row.querySelector('.sdr-clip-play-btn') as HTMLButtonElement;
            const audio    = document.getElementById(`sdr-clip-audio-${c.id}`) as HTMLAudioElement;
            const player   = document.getElementById(`sdr-clip-player-${c.id}`) as HTMLElement;
            const seekEl   = document.getElementById(`sdr-clip-seek-${c.id}`) as HTMLInputElement;
            const curEl    = document.getElementById(`sdr-clip-cur-${c.id}`) as HTMLElement;
            const durEl    = document.getElementById(`sdr-clip-dur-${c.id}`) as HTMLElement;
            const playIcon = playBtn.querySelector('.sdr-clip-play-icon') as HTMLElement;
            const stopIcon = playBtn.querySelector('.sdr-clip-stop-icon') as HTMLElement;
            function fmtT(s: number) {
                const m = Math.floor(s/60), sec = Math.floor(s%60);
                return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
            }
            function setPlaying(on: boolean) {
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
                seekEl.max = String(audio.duration || 0);
                durEl.textContent = fmtT(audio.duration || 0);
            });
            audio.addEventListener('timeupdate', () => {
                seekEl.value = String(audio.currentTime);
                curEl.textContent = fmtT(audio.currentTime);
            });
            audio.addEventListener('ended', () => {
                audio.currentTime = 0;
                setPlaying(false);
            });
            seekEl.addEventListener('input', () => {
                audio.currentTime = parseFloat(seekEl.value);
            });

            (row.querySelector('.sdr-clip-edit-btn') as HTMLButtonElement)
                .addEventListener('click', () => openEditRecModal(c));
            (row.querySelector('.sdr-clip-export-btn') as HTMLButtonElement)
                .addEventListener('click', () => {
                    const a = document.createElement('a');
                    a.href = `/api/sdr/recordings/${c.id}/file`;
                    a.download = `${c.name}.wav`;
                    a.click();
                });
            if (c.has_iq_file) {
                (row.querySelector('.sdr-clip-iq-btn') as HTMLButtonElement)
                    .addEventListener('click', () => {
                        const a = document.createElement('a');
                        a.href = `/api/sdr/recordings/${c.id}/iq`;
                        a.download = `${c.name}.u8`;
                        a.click();
                    });
            }
            (row.querySelector('.sdr-clip-del-btn') as HTMLButtonElement)
                .addEventListener('click', () => openDeleteRecModal(c));
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
    }

    // Edit recording modal
    function openEditRecModal(c: any) {
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
    function openDeleteRecModal(c: any) {
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
    recBtn.addEventListener('click', async () => {
        if (!_isRecording) {
            const radioId = getSelectedRadioId();
            const radioName = radioId
                ? (_knownRadios.find(r => r.id === radioId) || {} as any).name || ''
                : '';
            const metadata: SdrRecordingMetadata = {
                radio_id:     radioId,
                radio_name:   radioName,
                frequency_hz: _sdrCurrentFreqHz   || 0,
                mode:         _sdrCurrentMode      || 'AM',
                gain_db:      _sdrCurrentGain      || 30,
                squelch_dbfs: _sdrCurrentSquelch   || -60,
                sample_rate:  _sdrCurrentSampleRate || 2048000,
            };
            if (!window._SdrAudio) return;
            const recId = await window._SdrAudio.startRecording(metadata);
            if (!recId) return;
            _isRecording = true;
            _recStartEpoch = Date.now();
            _recPausedMs = 0;
            const squelchActive = (metadata.squelch_dbfs ?? -120) > -119;
            _recSquelchOpen = !squelchActive;
            _recPauseStart = squelchActive ? Date.now() : null;
            clipsCount.textContent = '';
            recBtn.classList.add('sdr-rec-btn--active');
            _setRecBtnIcon(true);
            _removeLiveRecRow();
            _liveRecRow = _createLiveRecRow(metadata, _recStartEpoch, _recSquelchOpen);
            clipsEmpty.style.display = 'none';
            clipsList.insertBefore(_liveRecRow, clipsList.firstChild);
            _recTimerInterval = setInterval(() => {
                const pausedSoFar = _recPauseStart != null
                    ? _recPausedMs + (Date.now() - _recPauseStart)
                    : _recPausedMs;
                const s = Math.floor((Date.now() - _recStartEpoch - pausedSoFar) / 1000);
                _updateLiveRecRow(s);
            }, 1000);
        } else {
            await _stopRecordingIfActive();
        }
    });

    // ── Signal meter ──────────────────────────────────────────────────────────

    const SIGNAL_SEGS = 36;
    const _segEls: HTMLDivElement[] = [];
    for (let i = 0; i < SIGNAL_SEGS; i++) {
        const seg = document.createElement('div');
        seg.className = 'sdr-signal-seg';
        signalBarEl.appendChild(seg);
        _segEls.push(seg);
    }

    let _signalSmoothed = -120;
    function updateSignalBar(dbfs: number, squelchOpen?: boolean) {
        if (squelchOpen === false) {
            _signalSmoothed = -120;
            for (let i = 0; i < SIGNAL_SEGS; i++) _segEls[i].classList.remove('sdr-signal-seg--on');
            return;
        }
        const alpha = dbfs > _signalSmoothed ? 0.3 : 0.05;
        _signalSmoothed += alpha * (dbfs - _signalSmoothed);
        const lit = Math.round(Math.max(0, Math.min(SIGNAL_SEGS, ((_signalSmoothed + 120) / 120) * SIGNAL_SEGS)));
        for (let i = 0; i < SIGNAL_SEGS; i++) {
            _segEls[i].classList.toggle('sdr-signal-seg--on', i < lit);
        }
    }

    // ── Radio select ──────────────────────────────────────────────────────────

    radioSelect.addEventListener('change', () => {
        const id = parseInt(radioSelect.value, 10);

        // Always stop audio and tear down current session when switching radios
        if (window._SdrAudio) window._SdrAudio.stop();
        setPlayingState(false);
        setStatus(false);

        if (!isNaN(id) && id > 0) {
            setRadioControlsDisabled(false);
            radioSelect.dispatchEvent(new CustomEvent('sdr-radio-selected', { bubbles: true, detail: { radioId: id } }));
        } else {
            setRadioControlsDisabled(true);
            document.dispatchEvent(new CustomEvent('sdr-radio-deselected'));
        }
    });

    // ── Scan (radio tab) ──────────────────────────────────────────────────────

    radioScanBtn.addEventListener('click', () => {
        if (_sdrScanActive) {
            stopScan();
        } else {
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

    function buildEfGroupCheckboxes(selectedIds: number[]) {
        efGroupsEl.innerHTML = '';

        const makeGroupPill = (id: number, label: string, color: string | null, active: boolean) => {
            const btn = document.createElement('button');
            btn.className = 'sdr-mode-pill sdr-ef-gpill' + (active ? ' active' : '');
            btn.dataset.gid = String(id);
            btn.type = 'button';
            if (color) {
                const dot = document.createElement('span');
                dot.className = 'sdr-ef-gpill-dot';
                dot.style.setProperty('--dot-color', color);
                btn.appendChild(dot);
                btn.appendChild(document.createTextNode(label));
            } else {
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

    function getEfGroupIds(): number[] {
        return Array.from(efGroupsEl.querySelectorAll<HTMLButtonElement>('.sdr-ef-gpill.active'))
            .map(btn => parseInt(btn.dataset.gid!, 10))
            .filter(id => id !== 0);
    }

    function getEfMode(): string {
        const active = efModePills.querySelector<HTMLButtonElement>('.sdr-mode-pill.active');
        return active?.dataset.mode ?? 'AM';
    }

    efModePills.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sdr-mode-pill');
        if (!btn || !btn.dataset.mode) return;
        setModePill(efModePills, btn.dataset.mode);
    });

    function switchToScannerTab() {
        // Expand scanner section
        scannerMainToggle.classList.add('sdr-scanner-main-toggle-expanded');
        scannerMainBody.classList.add('sdr-scanner-main-body-expanded');
        // Ensure freqs section is expanded
        const freqsToggle = document.getElementById('sdr-scanner-freqs-toggle')!;
        const freqsBody   = document.getElementById('sdr-scanner-freqs-body')!;
        freqsToggle.classList.add('sdr-scanner-section-toggle-expanded');
        freqsBody.classList.add('sdr-scanner-section-body-expanded');
    }

    function clearEditingHighlight() {
        document.querySelectorAll('.sdr-freq-editing').forEach(el => el.classList.remove('sdr-freq-editing'));
    }

    function openEditFreqPanel(f: SdrStoredFrequency) {
        _editingFreqId = f.id;
        efLabel.value = f.label;
        efFreq.value  = (f.frequency_hz / 1e6).toFixed(4);
        setModePill(efModePills, f.mode);
        buildEfGroupCheckboxes(f.group_ids || []);
        efDelete.style.display = '';
        switchToScannerTab();
        efToggle.classList.add('expanded');
        efBody.classList.add('expanded');
        clearEditingHighlight();
        const rowEl = document.querySelector<HTMLElement>(`.sdr-freq-row-item[data-id="${f.id}"]`);
        if (rowEl) rowEl.classList.add('sdr-freq-editing');
        efToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function openAddFreqPanel() {
        _editingFreqId = null;
        efLabel.value = '';
        efFreq.value  = _sdrCurrentFreqHz ? (_sdrCurrentFreqHz / 1e6).toFixed(4) : '';
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
        const hz    = parseFreqMhz(efFreq.value);
        if (!label || !hz) return;
        const mode     = getEfMode();
        const groupIds = getEfGroupIds();

        try {
            if (_editingFreqId !== null) {
                await fetch(`/api/sdr/frequencies/${_editingFreqId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label, frequency_hz: hz, mode, group_ids: groupIds }),
                });
            } else {
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
        } catch (_) {}
    });

    // ── Delete frequency ──────────────────────────────────────────────────────

    efDelete.addEventListener('click', async () => {
        if (_editingFreqId === null) return;
        try {
            await fetch(`/api/sdr/frequencies/${_editingFreqId}`, { method: 'DELETE' });
            _editingFreqId = null;
            clearEditingHighlight();
            efToggle.classList.remove('expanded');
            efBody.classList.remove('expanded');
            await reloadData();
        } catch (_) {}
    });

    // ── Add frequency button → opens inline panel ─────────────────────────────

    addFreqBtn.addEventListener('click', openAddFreqPanel);

    // ── Group modal ───────────────────────────────────────────────────────────

    const groupModal  = document.getElementById('sdr-group-modal')!;
    const gmodName    = document.getElementById('sdr-gmod-name')   as HTMLInputElement;
    const gmodCancel  = document.getElementById('sdr-gmod-cancel') as HTMLButtonElement;
    const gmodSave    = document.getElementById('sdr-gmod-save')   as HTMLButtonElement;

    let _editingGroupId: number | null = null;

    function openEditGroupModal(g: SdrFrequencyGroup) {
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
    groupModal.addEventListener('click', (e) => { if (e.target === groupModal) closeGroupModal(); });

    gmodSave.addEventListener('click', async () => {
        const name = gmodName.value.trim();
        if (!name || _editingGroupId === null) return;
        try {
            await fetch(`/api/sdr/groups/${_editingGroupId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            closeGroupModal();
            await reloadData();
        } catch (_) {}
    });

    // ── Status dot + controls update ─────────────────────────────────────────

    function setStatus(connected: boolean) {
        _sdrConnected = connected;
        const isOn = connected;
        connDot.className = 'sdr-conn-dot ' + (isOn ? 'sdr-dot-on' : 'sdr-dot-off');
        connDot.title = isOn ? 'Connected' : 'Disconnected';
        if (connected) {
            if (_sdrPlaying) {
                freqTuneBtn.disabled = true;
                freqStopBtn.disabled = false;
                recBtn.disabled = false;
            } else {
                setPlayingState(false);
            }
        } else {
            setPlayingState(false);
            setRadioControlsDisabled(true);
            activeFreq.textContent = '';
            _signalSmoothed = -120;
            for (let i = 0; i < SIGNAL_SEGS; i++) _segEls[i].classList.remove('sdr-signal-seg--on');
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

    function applyStatus(msg: SdrStatusMsg) {
        // Do not drive the connection dot here — setStatus(true) is only called
        // once real spectrum data arrives (in sdr-boot), so a stale cached
        // connection never produces a false green.
        if (msg.connected) {
            const hadUserFreq = _sdrCurrentFreqHz && _sdrCurrentFreqHz !== msg.center_hz;
            if (!hadUserFreq) _sdrCurrentFreqHz = msg.center_hz;
            _sdrCurrentMode      = msg.mode;
            _sdrCurrentGain      = msg.gain_db;
            _sdrCurrentGainAuto  = msg.gain_auto;
            _sdrCurrentSampleRate = msg.sample_rate;

            // Update bandwidth slider max to match the SDR's sample rate
            bwSlider.max = String(msg.sample_rate);
            const clampedBw = Math.min(_sdrCurrentBwHz, msg.sample_rate);
            setBandwidthSlider(clampedBw);
            if (window._SdrAudio) window._SdrAudio.setBandwidthHz(clampedBw);

            if (!hadUserFreq) displayFreq(msg.center_hz);
            setModePill(modePillsEl, msg.mode);

            if (msg.gain_auto) {
                agcCheck.checked    = true;
                if (_sdrConnected) gainSlider.disabled = true;
                gainVal.textContent = 'AUTO';
            } else {
                agcCheck.checked    = false;
                if (_sdrConnected) gainSlider.disabled = false;
                gainSlider.value    = String(msg.gain_db);
                gainVal.textContent = `${msg.gain_db.toFixed(1)} dB`;
            }

            _saveSettings();
        }
    }

    function getSelectedRadioId(): number | null {
        const selectedId = parseInt(radioSelect.value, 10);
        return isNaN(selectedId) || selectedId <= 0 ? null : selectedId;
    }

    // ── Custom device dropdown ────────────────────────────────────────────────

    const deviceDropdown     = document.getElementById('sdr-device-dropdown')!;
    const deviceDropdownText = document.getElementById('sdr-device-dropdown-text')!;
    let _deviceMenuEl: HTMLDivElement | null = null;
    let _deviceMenuOpen = false;

    function buildDeviceMenu(radios: SdrRadio[]) {
        if (_deviceMenuEl) _deviceMenuEl.remove();
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
            _deviceMenuEl!.appendChild(item);
        });

        document.body.appendChild(_deviceMenuEl);
    }

    function positionDeviceMenu() {
        if (!_deviceMenuEl) return;
        const rect = deviceDropdown.getBoundingClientRect();
        _deviceMenuEl.style.left   = rect.left + 'px';
        _deviceMenuEl.style.top    = (rect.bottom) + 'px';
        _deviceMenuEl.style.width  = rect.width + 'px';
    }

    function openDeviceMenu() {
        if (!_deviceMenuEl) return;
        positionDeviceMenu();
        _deviceMenuEl.classList.add('sdr-device-menu--open');
        deviceDropdown.classList.add('sdr-device-dropdown--open');
        _deviceMenuOpen = true;
    }

    function closeDeviceMenu() {
        if (!_deviceMenuEl) return;
        _deviceMenuEl.classList.remove('sdr-device-menu--open');
        deviceDropdown.classList.remove('sdr-device-dropdown--open');
        _deviceMenuOpen = false;
    }

    deviceDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_deviceMenuOpen) closeDeviceMenu(); else openDeviceMenu();
    });

    deviceDropdown.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (_deviceMenuOpen) closeDeviceMenu(); else openDeviceMenu(); }
        if (e.key === 'Escape') closeDeviceMenu();
    });

    document.addEventListener('click', () => { if (_deviceMenuOpen) closeDeviceMenu(); });

    // ── Populate radio list ───────────────────────────────────────────────────

    (window as any)._sdrPopulateRadios = function(radios: SdrRadio[]) {
        _knownRadios = radios;
        // Read the saved id from sessionStorage directly — radioSelect.value may be '' if
        // options hadn't been added yet when it was pre-seeded.
        const current = radioSelect.value || sessionStorage.getItem('sdrLastRadioId') || '';
        while (radioSelect.options.length > 0) radioSelect.remove(0);
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
        if (current) {
            radioSelect.value = current;
            const chosen = radios.find(r => String(r.id) === current);
            if (chosen) {
                deviceDropdownText.textContent = chosen.name;
                deviceDropdownText.classList.add('sdr-device-dropdown-text--chosen');
                setRadioControlsDisabled(false);
                // Restore playing state now that the radio is confirmed available.
                if (sessionStorage.getItem('sdrPlaying') === '1') {
                    _sdrPlaying = true;
                    freqTuneBtn.disabled = true;
                    freqStopBtn.disabled = false;
                    recBtn.disabled = false;
                    // One-shot: first interaction resumes audio (browser autoplay policy).
                    const resumeAudioOnce = () => {
                        panel.removeEventListener('click', resumeAudioOnce);
                        panel.removeEventListener('keydown', resumeAudioOnce);
                        if (window._SdrAudio) {
                            window._SdrAudio.initAudio(getSelectedRadioId() ?? undefined);
                            window._SdrAudio.setMode(_sdrCurrentMode);
                            window._SdrAudio.setBandwidthHz(defaultBwHz(_sdrCurrentMode));
                        }
                    };
                    panel.addEventListener('click', resumeAudioOnce);
                    panel.addEventListener('keydown', resumeAudioOnce);
                }
            } else {
                // Previously selected radio no longer exists — clear the display
                deviceDropdownText.textContent = '— select radio —';
                deviceDropdownText.classList.remove('sdr-device-dropdown-text--chosen');
                setRadioControlsDisabled(true);
            }
        }
        buildDeviceMenu(radios);
    };

    window._SdrControls = { setStatus, applyStatus, getSelectedRadioId, updateSignalBar };

    // ── In tab mode, sdr-mini-boot drives connection/signal via custom events ──
    if (_tabMode) {
        document.addEventListener('sdr-mini:connected', (e: Event) => {
            setStatus((e as CustomEvent<boolean>).detail);
        });
        document.addEventListener('sdr-mini:signal', (e: Event) => {
            if (_sdrPlaying) updateSignalBar((e as CustomEvent<number>).detail);
        });
    }

    // ── Render frequency list ─────────────────────────────────────────────────

    function renderFreqs() {
        const list  = document.getElementById('sdr-freq-list')!;
        const empty = document.getElementById('sdr-freq-empty')!;
        list.innerHTML = '';

        if (_freqs.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        const grouped: Record<number | 'default', SdrStoredFrequency[]> = { default: [] };
        _groups.forEach(g => { grouped[g.id] = []; });

        _freqs.forEach(f => {
            const ids = f.group_ids && f.group_ids.length > 0 ? f.group_ids : [];
            const realIds = ids.filter(id => id !== 0 && _groups.some(g => g.id === id));
            if (realIds.length === 0) {
                grouped['default'].push(f);
            } else {
                realIds.forEach(id => {
                    if (!grouped[id]) grouped[id] = [];
                    grouped[id].push(f);
                });
            }
        });

        function renderGroup(name: string, color: string, items: SdrStoredFrequency[]) {
            if (items.length === 0) return;
            const header = document.createElement('div');
            header.className = 'sdr-freq-group-header';
            const dot = document.createElement('span');
            dot.className = 'sdr-freq-group-dot';
            dot.style.setProperty('--dot-color', color);
            header.appendChild(dot);
            header.appendChild(document.createTextNode(name));
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

    function tuneToFreq(f: SdrStoredFrequency) {
        _sdrCurrentFreqHz = f.frequency_hz;
        _sdrCurrentMode   = f.mode;
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify({ cmd: 'tune', frequency_hz: f.frequency_hz }));
            _sdrSocket.send(JSON.stringify({ cmd: 'mode', mode: f.mode }));
        }
        displayFreq(f.frequency_hz);
        setModePill(modePillsEl, f.mode);
    }

    // ── Render group list ─────────────────────────────────────────────────────

    function renderGroups() {
        const list = document.getElementById('sdr-group-list')!;
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
            pill.querySelector<HTMLButtonElement>('.sdr-group-pill-edit')!.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditGroupModal(g);
            });
            pill.querySelector<HTMLButtonElement>('.sdr-group-pill-del')!.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(g.id);
            });
            pills.appendChild(pill);
        });

        list.appendChild(pills);
    }

    // ── Group add/delete ──────────────────────────────────────────────────────

    document.getElementById('sdr-add-group-btn')!.addEventListener('click', addGroup);
    document.getElementById('sdr-new-group-name')!.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') addGroup();
    });

    async function addGroup() {
        const input = document.getElementById('sdr-new-group-name') as HTMLInputElement;
        const name  = input.value.trim();
        if (!name) return;
        try {
            const res = await fetch('/api/sdr/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color: '#c8ff00', sort_order: _groups.length }),
            });
            if (res.ok) { input.value = ''; await reloadData(); }
        } catch (_) {}
    }

    async function deleteGroup(id: number) {
        try {
            await fetch(`/api/sdr/groups/${id}`, { method: 'DELETE' });
            await reloadData();
        } catch (_) {}
    }

    // ── Scanner ───────────────────────────────────────────────────────────────

    let _scanQueue: SdrStoredFrequency[] = [];
    let _scanIdx:   number = 0;
    let _scanTimer: ReturnType<typeof setTimeout> | null = null;

    function buildScanQueue() {
        _scanQueue = _freqs.filter(f => f.scannable);
    }

    function startScan() {
        if (_sdrScanLocked) return;
        buildScanQueue();
        if (_scanQueue.length === 0) return;
        _sdrScanActive = true;
        setScanStatus(true, null);
        _scanIdx = 0;
        doScanStep();
    }

    function stopScan() {
        _sdrScanActive = false;
        if (_scanTimer) { clearTimeout(_scanTimer); _scanTimer = null; }
        setScanStatus(false, null);
    }

    function doScanStep() {
        if (!_sdrScanActive || _sdrScanLocked || _scanQueue.length === 0) return;
        const nextFrequency = _scanQueue[_scanIdx % _scanQueue.length];
        tuneToFreq(nextFrequency);
        setScanStatus(true, nextFrequency.frequency_hz);
        _scanIdx++;
        _scanTimer = setTimeout(doScanStep, 2000);
    }

    function setScanStatus(active: boolean, currentHz: number | null) {
        radioScanInd.className   = 'sdr-scan-indicator' + (active ? ' sdr-scan-running' : '');
        radioScanLbl.textContent  = active ? 'SCANNING' : 'IDLE';
        radioScanFreq.textContent = (active && currentHz) ? `→ ${(currentHz / 1e6).toFixed(4)} MHz` : '';
        radioScanBtn.textContent  = active ? 'STOP SCANNING' : 'START SCANNING';
        radioScanBtn.classList.toggle('sdr-scan-active-btn', active);
    }

    // ── Data reload ───────────────────────────────────────────────────────────

    async function reloadData() {
        try {
            const [gRes, fRes] = await Promise.all([
                fetch('/api/sdr/groups'),
                fetch('/api/sdr/frequencies'),
            ]);
            _groups = await gRes.json();
            _freqs  = await fRes.json();
            renderGroups();
            renderFreqs();
            buildScanQueue();
        } catch (_) {}
        await reloadClips();
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    function show() {
        if (_tabMode) {
            // In tab mode, visibility is controlled by map-sidebar; open the radio tab
            if (window._MapSidebar) window._MapSidebar.openRadioTab();
            return;
        }
        _visible = true;
        panel.classList.remove('sdr-panel-hidden');
        document.body.classList.remove('sdr-panel-hidden');
        sessionStorage.setItem('sdrPanelOpen', '1');
    }

    function hide() {
        if (_tabMode) return; // Controlled by map-sidebar
        _visible = false;
        panel.classList.add('sdr-panel-hidden');
        document.body.classList.add('sdr-panel-hidden');
        sessionStorage.setItem('sdrPanelOpen', '0');
    }

    function toggle() {
        if (_tabMode) { show(); return; }
        if (_visible) hide(); else show();
    }
    function isVisible() { return _tabMode ? true : _visible; }

    function refresh(groups: SdrFrequencyGroup[], freqs: SdrStoredFrequency[]) {
        _groups = groups;
        _freqs  = freqs;
        renderGroups();
        renderFreqs();
        buildScanQueue();
    }

    function onSquelchChange(open: boolean) {
        if (!_isRecording) return;
        if (open && !_recSquelchOpen) {
            if (_recPauseStart != null) {
                _recPausedMs += Date.now() - _recPauseStart;
                _recPauseStart = null;
            }
            _recSquelchOpen = true;
            if (_liveRecRow) {
                (_liveRecRow.querySelector('.sdr-clip-name') as HTMLElement).textContent = 'Recording…';
                _liveRecRow.querySelector('.sdr-clip-live-dot')!.classList.remove('sdr-clip-live-dot--waiting');
            }
        } else if (!open && _recSquelchOpen) {
            _recPauseStart = Date.now();
            _recSquelchOpen = false;
            if (_liveRecRow) {
                (_liveRecRow.querySelector('.sdr-clip-name') as HTMLElement).textContent = 'Waiting for signal…';
                _liveRecRow.querySelector('.sdr-clip-live-dot')!.classList.add('sdr-clip-live-dot--waiting');
            }
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus, onSquelchChange };
    (window as any)._sdrPanelReload = reloadData;

    reloadData();
}

// ── Auto-invoke on the SDR page; expose for tab-mode use on other pages ────
if (document.body.dataset['domain'] === 'sdr') {
    buildSdrPanel();
} else {
    // Available for sdr-radio-tab to call with a mount target
    (window as any)._buildSdrPanel = buildSdrPanel;
}
