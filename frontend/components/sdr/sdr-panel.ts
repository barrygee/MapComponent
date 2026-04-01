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

                <!-- Status row -->
                <div class="sdr-radio-status-row">
                    <span id="sdr-status-label" class="sdr-status-label">DISCONNECTED</span>
                </div>

                <!-- Radio selector -->
                <div class="sdr-radio-section">
                    <label class="sdr-field-label">DEVICE</label>
                    <div class="sdr-device-dropdown" id="sdr-device-dropdown" tabindex="0">
                        <div class="sdr-device-dropdown-selected">
                            <span class="sdr-device-dropdown-text" id="sdr-device-dropdown-text">— select radio —</span>
                            <span class="sdr-device-dropdown-arrow"></span>
                        </div>
                    </div>
                    <select id="sdr-radio-select" style="display:none"></select>
                </div>

                <!-- Frequency -->
                <div class="sdr-radio-section">
                    <label class="sdr-field-label">FREQ (MHz)</label>
                    <div class="sdr-freq-row">
                        <input id="sdr-freq-input" class="sdr-panel-input sdr-freq-input-large" type="text"
                               placeholder="100.000" autocomplete="off" spellcheck="false">
                        <button id="sdr-freq-tune" class="sdr-tune-btn" title="Tune">TUNE</button>
                    </div>
                </div>

                <!-- Mode — pill buttons -->
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

                <!-- RF Gain -->
                <div class="sdr-radio-section">
                    <div class="sdr-slider-header">
                        <label class="sdr-field-label">RF GAIN</label>
                        <span id="sdr-gain-val" class="sdr-slider-val">30.0 dB</span>
                    </div>
                    <input id="sdr-gain-slider" class="sdr-panel-slider" type="range" min="-1" max="49" step="0.5" value="30">
                </div>

                <!-- AGC checkbox -->
                <div class="sdr-radio-section sdr-agc-row">
                    <label class="sdr-checkbox-label">
                        <input id="sdr-agc-check" type="checkbox" class="sdr-checkbox">
                        <span class="sdr-checkbox-custom"></span>
                        <span class="sdr-checkbox-text">AGC (Automatic Gain Control)</span>
                    </label>
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
                    <!-- Signal meter -->
                    <div class="sdr-scan-signal-row">
                        <span class="sdr-field-label" style="margin-bottom:6px;display:block">SIGNAL</span>
                        <div class="sdr-signal-bar-track">
                            <div id="sdr-signal-bar" class="sdr-signal-bar"></div>
                        </div>
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

    document.body.appendChild(panel);

    // ── State ─────────────────────────────────────────────────────────────────

    let _groups:  SdrFrequencyGroup[]   = [];
    let _freqs:   SdrStoredFrequency[]  = [];
    let _visible: boolean = true;
    let _editingFreqId: number | null = null;

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

    // ── Element refs ──────────────────────────────────────────────────────────

    const radioSelect  = document.getElementById('sdr-radio-select')  as HTMLSelectElement;
    const freqInput    = document.getElementById('sdr-freq-input')     as HTMLInputElement;
    const freqTuneBtn  = document.getElementById('sdr-freq-tune')      as HTMLButtonElement;
    const modePillsEl  = document.getElementById('sdr-mode-pills')!;
    const gainSlider   = document.getElementById('sdr-gain-slider')    as HTMLInputElement;
    const gainVal      = document.getElementById('sdr-gain-val')       as HTMLSpanElement;
    const agcCheck     = document.getElementById('sdr-agc-check')      as HTMLInputElement;
    const volSlider    = document.getElementById('sdr-vol-slider')     as HTMLInputElement;
    const volVal       = document.getElementById('sdr-vol-val')        as HTMLSpanElement;
    const sqSlider     = document.getElementById('sdr-sq-slider')      as HTMLInputElement;
    const sqVal        = document.getElementById('sdr-sq-val')         as HTMLSpanElement;
    const connDot      = document.getElementById('sdr-conn-dot')       as HTMLDivElement;
    const statusLabel  = document.getElementById('sdr-status-label')   as HTMLSpanElement;
    const activeFreq   = document.getElementById('sdr-active-freq')    as HTMLSpanElement;
    const signalBar    = document.getElementById('sdr-signal-bar')     as HTMLDivElement;
    const radioScanBtn = document.getElementById('sdr-radio-scan-btn') as HTMLButtonElement;
    const radioScanInd = document.getElementById('sdr-radio-scan-indicator') as HTMLDivElement;
    const radioScanLbl = document.getElementById('sdr-radio-scan-label') as HTMLSpanElement;
    const radioScanFreq= document.getElementById('sdr-radio-scan-freq') as HTMLSpanElement;
    const addFreqBtn   = document.getElementById('sdr-radio-add-freq') as HTMLButtonElement;
    const lockBtn      = document.getElementById('sdr-radio-lock-btn') as HTMLButtonElement;

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

    function sendCmd(obj: object) {
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify(obj));
        }
    }

    function parseFreqMhz(raw: string): number | null {
        const v = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(v) || v <= 0) return null;
        return v > 30000 ? v : Math.round(v * 1e6);
    }

    function displayFreq(hz: number) {
        freqInput.value = (hz / 1e6).toFixed(6).replace(/\.?0+$/, '');
        activeFreq.textContent = (hz / 1e6).toFixed(3) + ' MHz';
    }

    // ── Mode pills (main radio tab) ───────────────────────────────────────────

    function setModePill(container: HTMLElement, mode: string) {
        container.querySelectorAll<HTMLButtonElement>('.sdr-mode-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    modePillsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sdr-mode-pill');
        if (!btn || !btn.dataset.mode) return;
        const mode = btn.dataset.mode;
        setModePill(modePillsEl, mode);
        _sdrCurrentMode = mode;
        sendCmd({ cmd: 'mode', mode });
        if (window._SdrAudio) window._SdrAudio.setMode(mode);
    });

    // ── Tune ──────────────────────────────────────────────────────────────────

    function tune() {
        const hz = parseFreqMhz(freqInput.value);
        if (!hz) return;
        _sdrCurrentFreqHz = hz;
        displayFreq(hz);
        if (window._SdrAudio) window._SdrAudio.initAudio();
        if (!_sdrSocket || _sdrSocket.readyState !== WebSocket.OPEN) {
            // Socket is dead — trigger a reconnect; boot will auto-tune on open
            sessionStorage.setItem('sdrLastFreqHz', String(hz));
            sessionStorage.setItem('sdrLastMode', _sdrCurrentMode);
            const radioId = getSelectedRadioId();
            if (radioId) {
                document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId } }));
            }
            return;
        }
        sendCmd({ cmd: 'tune', frequency_hz: hz });
    }

    freqTuneBtn.addEventListener('click', tune);
    freqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tune(); });

    // ── Gain + AGC ────────────────────────────────────────────────────────────

    let _gainDebounce: ReturnType<typeof setTimeout> | null = null;

    function applyGain() {
        const g = parseFloat(gainSlider.value);
        const auto = agcCheck.checked || g < 0;
        if (auto) {
            gainVal.textContent = 'AUTO';
            _sdrCurrentGainAuto = true;
        } else {
            gainVal.textContent = `${g.toFixed(1)} dB`;
            _sdrCurrentGain = g;
            _sdrCurrentGainAuto = false;
        }
        if (_gainDebounce) clearTimeout(_gainDebounce);
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
        if (window._SdrAudio) window._SdrAudio.setVolume(v / 100);
    });

    // ── Squelch ───────────────────────────────────────────────────────────────

    let _sqDebounce: ReturnType<typeof setTimeout> | null = null;
    sqSlider.addEventListener('input', () => {
        const sq = parseInt(sqSlider.value, 10);
        sqVal.textContent = `${sq} dBFS`;
        _sdrCurrentSquelch = sq;
        if (_sqDebounce) clearTimeout(_sqDebounce);
        _sqDebounce = setTimeout(() => {
            sendCmd({ cmd: 'squelch', squelch_dbfs: sq });
            if (window._SdrAudio) window._SdrAudio.setSquelch(sq);
        }, 150);
    });

    // ── Signal meter ──────────────────────────────────────────────────────────

    function updateSignalBar(dbfs: number) {
        const pct = Math.max(0, Math.min(100, ((dbfs + 120) / 120) * 100));
        signalBar.style.width = pct + '%';
        if (pct < 60) {
            signalBar.style.background = '#4cdd4c';
        } else if (pct < 85) {
            signalBar.style.background = '#c8ff00';
        } else {
            signalBar.style.background = '#ff4444';
        }
    }

    // ── Radio select ──────────────────────────────────────────────────────────

    radioSelect.addEventListener('change', () => {
        const id = parseInt(radioSelect.value, 10);
        if (!isNaN(id) && id > 0) {
            radioSelect.dispatchEvent(new CustomEvent('sdr-radio-selected', { bubbles: true, detail: { radioId: id } }));
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
                btn.innerHTML = `<span class="sdr-ef-gpill-dot" style="background:${color}"></span>${label}`;
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
        connDot.className = 'sdr-conn-dot ' + (connected ? 'sdr-dot-on' : 'sdr-dot-off');
        connDot.title = connected ? 'Connected' : 'Disconnected';
        statusLabel.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
        statusLabel.className   = 'sdr-status-label' + (connected ? ' sdr-status-on' : '');
    }

    function applyStatus(msg: SdrStatusMsg) {
        setStatus(msg.connected);
        if (msg.connected) {
            _sdrCurrentFreqHz    = msg.center_hz;
            _sdrCurrentMode      = msg.mode;
            _sdrCurrentGain      = msg.gain_db;
            _sdrCurrentGainAuto  = msg.gain_auto;
            _sdrCurrentSampleRate = msg.sample_rate;

            displayFreq(msg.center_hz);
            setModePill(modePillsEl, msg.mode);

            if (msg.gain_auto) {
                agcCheck.checked    = true;
                gainSlider.disabled = true;
                gainVal.textContent = 'AUTO';
            } else {
                agcCheck.checked    = false;
                gainSlider.disabled = false;
                gainSlider.value    = String(msg.gain_db);
                gainVal.textContent = `${msg.gain_db.toFixed(1)} dB`;
            }

            if (typeof (msg as any).signal_dbfs === 'number') {
                updateSignalBar((msg as any).signal_dbfs);
            }
        }
    }

    function getSelectedRadioId(): number | null {
        const v = parseInt(radioSelect.value, 10);
        return isNaN(v) || v <= 0 ? null : v;
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
        const current = radioSelect.value;
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
            }
        }
        buildDeviceMenu(radios);
    };

    window._SdrControls = { setStatus, applyStatus, getSelectedRadioId, updateSignalBar };

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
        const freqsToUpdate = _freqs.filter(f => {
            const ids = (f.group_ids || []).filter(gid => gid !== 0);
            return ids.length === 1 && ids[0] === id;
        });
        try {
            await Promise.all(freqsToUpdate.map(f =>
                fetch(`/api/sdr/frequencies/${f.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ group_ids: [] }),
                })
            ));
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
        const f = _scanQueue[_scanIdx % _scanQueue.length];
        tuneToFreq(f);
        setScanStatus(true, f.frequency_hz);
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
        sessionStorage.removeItem('sdrPanelOpen');
    }

    function toggle() { if (_visible) hide(); else show(); }
    function isVisible() { return _visible; }

    function refresh(groups: SdrFrequencyGroup[], freqs: SdrStoredFrequency[]) {
        _groups = groups;
        _freqs  = freqs;
        renderGroups();
        renderFreqs();
        buildScanQueue();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus };
    (window as any)._sdrPanelReload = reloadData;

    reloadData();
})();
