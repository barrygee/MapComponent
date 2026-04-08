// ============================================================
// SDR MINI PLAYER
// Compact, draggable SDR player component for use on any page.
// Exposes window._SdrMiniPlayer = { tune, show, hide, populateRadios }
//
// Depends on: sdr-globals.js, sdr-audio.js, sdr-boot.js
// Those must be loaded before this script on pages that use it.
// ============================================================

/// <reference path="./globals.d.ts" />

(function buildSdrMiniPlayer() {

    // ── Constants ────────────────────────────────────────────────────────────

    const SIGNAL_SEGS     = 36;
    const DEFAULT_SQUELCH = -60;

    // ── DOM ──────────────────────────────────────────────────────────────────

    const el = document.createElement('div');
    el.id = 'sdr-mini-player';
    el.className = 'sdr-mini-hidden';
    el.innerHTML = `
        <div class="sdr-mini-drag-handle" id="sdr-mini-handle">
            <span class="sdr-mini-title" id="sdr-mini-title">SDR</span>
            <div class="sdr-mini-conn-dot sdr-mini-dot-off" id="sdr-mini-dot" title="Disconnected"></div>
            <button class="sdr-mini-close-btn" id="sdr-mini-close" title="Close">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>

        <!-- Tab bar -->
        <div class="sdr-mini-tabs">
            <button class="sdr-mini-tab sdr-mini-tab--active" data-tab="signal">SIGNAL</button>
            <button class="sdr-mini-tab" data-tab="device">DEVICE</button>
        </div>

        <!-- ── Tab: SIGNAL ── -->
        <div class="sdr-mini-pane" id="sdr-mini-panel-signal">

            <!-- Frequency -->
            <div class="sdr-mini-section">
                <label class="sdr-mini-field-label">FREQUENCY MHZ</label>
                <div class="sdr-mini-freq-row">
                    <input id="sdr-mini-freq" class="sdr-mini-freq-input" type="text"
                           placeholder="100.000" autocomplete="off" spellcheck="false">
                    <button class="sdr-mini-pill sdr-mini-tune-btn" id="sdr-mini-play" title="Tune / Play">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polygon points="2,1 11,6 2,11" fill="currentColor"/></svg>
                    </button>
                    <button class="sdr-mini-pill sdr-mini-tune-btn sdr-mini-stop-btn" id="sdr-mini-stop" title="Stop" disabled>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>
                    </button>
                </div>
            </div>

            <!-- Mode -->
            <div class="sdr-mini-section">
                <label class="sdr-mini-field-label">MODE</label>
                <div class="sdr-mini-mode-pills" id="sdr-mini-mode-pills">
                    <button class="sdr-mini-pill sdr-mini-mode-pill active" data-mode="AM">AM</button>
                    <button class="sdr-mini-pill sdr-mini-mode-pill" data-mode="NFM">NFM</button>
                    <button class="sdr-mini-pill sdr-mini-mode-pill" data-mode="WFM">WFM</button>
                    <button class="sdr-mini-pill sdr-mini-mode-pill" data-mode="USB">USB</button>
                    <button class="sdr-mini-pill sdr-mini-mode-pill" data-mode="LSB">LSB</button>
                    <button class="sdr-mini-pill sdr-mini-mode-pill" data-mode="CW">CW</button>
                </div>
            </div>

            <!-- Signal -->
            <div class="sdr-mini-section">
                <span class="sdr-mini-field-label">SIGNAL</span>
                <div class="sdr-mini-signal-bar" id="sdr-mini-signal-bar"></div>
            </div>

            <!-- Volume -->
            <div class="sdr-mini-section">
                <div class="sdr-mini-slider-header">
                    <label class="sdr-mini-field-label">VOLUME</label>
                    <span class="sdr-mini-slider-val" id="sdr-mini-vol-val">80%</span>
                </div>
                <input class="sdr-mini-slider" id="sdr-mini-vol" type="range" min="0" max="200" step="1" value="80">
            </div>

            <!-- Squelch -->
            <div class="sdr-mini-section">
                <div class="sdr-mini-slider-header">
                    <label class="sdr-mini-field-label">SQUELCH</label>
                    <span class="sdr-mini-slider-val" id="sdr-mini-sq-val">${DEFAULT_SQUELCH} dBFS</span>
                </div>
                <input class="sdr-mini-slider" id="sdr-mini-sq" type="range" min="-120" max="0" step="1" value="${DEFAULT_SQUELCH}">
            </div>

        </div>

        <!-- ── Tab: DEVICE ── -->
        <div class="sdr-mini-pane sdr-mini-pane--hidden" id="sdr-mini-panel-device">

            <!-- Radio -->
            <div class="sdr-mini-section">
                <div class="sdr-mini-device-dropdown" id="sdr-mini-device-dropdown" tabindex="0">
                    <div class="sdr-mini-device-selected">
                        <span class="sdr-mini-device-text" id="sdr-mini-device-text">— SELECT RADIO —</span>
                        <span class="sdr-mini-device-arrow"></span>
                    </div>
                </div>
                <select id="sdr-mini-radio" style="display:none"></select>
            </div>

            <!-- Bandwidth -->
            <div class="sdr-mini-section">
                <div class="sdr-mini-slider-header">
                    <label class="sdr-mini-field-label">BANDWIDTH</label>
                    <span class="sdr-mini-slider-val" id="sdr-mini-bw-val">10 kHz</span>
                </div>
                <input class="sdr-mini-slider" id="sdr-mini-bw" type="range" min="1000" max="2048000" step="500" value="10000">
            </div>

            <!-- RF Gain -->
            <div class="sdr-mini-section">
                <div class="sdr-mini-slider-header">
                    <label class="sdr-mini-field-label">RF GAIN</label>
                    <span class="sdr-mini-slider-val" id="sdr-mini-gain-val">30.0 dB</span>
                </div>
                <input class="sdr-mini-slider" id="sdr-mini-gain" type="range" min="-1" max="49" step="0.5" value="30">
            </div>

            <!-- AGC -->
            <div class="sdr-mini-section sdr-mini-agc-row">
                <label class="sdr-mini-checkbox-label">
                    <input id="sdr-mini-agc" type="checkbox" class="sdr-mini-checkbox">
                    <span class="sdr-mini-checkbox-custom"></span>
                    <span class="sdr-mini-checkbox-text">AGC (Automatic Gain Control)</span>
                </label>
            </div>

        </div>
    `;

    document.body.appendChild(el);

    // ── State ─────────────────────────────────────────────────────────────────

    let _freqHz: number   = 0;
    let _mode:   string   = 'AM';
    let _playing: boolean = false;
    let _signalSmoothed   = -120;
    let _squelch: number  = DEFAULT_SQUELCH;

    // ── Element refs ─────────────────────────────────────────────────────────

    const titleEl      = document.getElementById('sdr-mini-title')!       as HTMLSpanElement;
    const dotEl        = document.getElementById('sdr-mini-dot')!         as HTMLDivElement;
    const closeBtn     = document.getElementById('sdr-mini-close')!       as HTMLButtonElement;
    const freqInput    = document.getElementById('sdr-mini-freq')!        as HTMLInputElement;
    const modePillsEl  = document.getElementById('sdr-mini-mode-pills')!  as HTMLDivElement;
    const signalBar    = document.getElementById('sdr-mini-signal-bar')!  as HTMLDivElement;
    const volSlider    = document.getElementById('sdr-mini-vol')!         as HTMLInputElement;
    const volVal       = document.getElementById('sdr-mini-vol-val')!     as HTMLSpanElement;
    const sqSlider     = document.getElementById('sdr-mini-sq')!          as HTMLInputElement;
    const sqVal        = document.getElementById('sdr-mini-sq-val')!      as HTMLSpanElement;
    const playBtn      = document.getElementById('sdr-mini-play')!        as HTMLButtonElement;
    const stopBtn      = document.getElementById('sdr-mini-stop')!        as HTMLButtonElement;
    const handle       = document.getElementById('sdr-mini-handle')!      as HTMLDivElement;
    const radioSelect  = document.getElementById('sdr-mini-radio')!       as HTMLSelectElement;
    const bwSlider     = document.getElementById('sdr-mini-bw')!          as HTMLInputElement;
    const bwVal        = document.getElementById('sdr-mini-bw-val')!      as HTMLSpanElement;
    const gainSlider   = document.getElementById('sdr-mini-gain')!        as HTMLInputElement;
    const gainVal      = document.getElementById('sdr-mini-gain-val')!    as HTMLSpanElement;
    const agcCheck     = document.getElementById('sdr-mini-agc')!         as HTMLInputElement;
    const deviceDropdown = document.getElementById('sdr-mini-device-dropdown')! as HTMLDivElement;
    const deviceText   = document.getElementById('sdr-mini-device-text')! as HTMLSpanElement;

    // ── Tabs ──────────────────────────────────────────────────────────────────

    el.querySelectorAll<HTMLButtonElement>('.sdr-mini-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            el.querySelectorAll('.sdr-mini-tab').forEach(t => t.classList.remove('sdr-mini-tab--active'));
            el.querySelectorAll('.sdr-mini-pane').forEach(p => p.classList.add('sdr-mini-pane--hidden'));
            tab.classList.add('sdr-mini-tab--active');
            const pane = document.getElementById(`sdr-mini-panel-${tab.dataset.tab}`);
            if (pane) pane.classList.remove('sdr-mini-pane--hidden');
        });
    });

    // ── Signal bar ───────────────────────────────────────────────────────────

    const _segEls: HTMLDivElement[] = [];
    for (let i = 0; i < SIGNAL_SEGS; i++) {
        const seg = document.createElement('div');
        seg.className = 'sdr-mini-seg';
        signalBar.appendChild(seg);
        _segEls.push(seg);
    }

    function updateSignalBar(dbfs: number) {
        const alpha = dbfs > _signalSmoothed ? 0.3 : 0.05;
        _signalSmoothed += alpha * (dbfs - _signalSmoothed);
        // Only light segments when signal breaks squelch
        const lit = _signalSmoothed > _squelch
            ? Math.round(Math.max(0, Math.min(SIGNAL_SEGS, ((_signalSmoothed + 120) / 120) * SIGNAL_SEGS)))
            : 0;
        for (let i = 0; i < SIGNAL_SEGS; i++) {
            _segEls[i].classList.toggle('sdr-mini-seg--on', i < lit);
        }
    }

    function resetSignalBar() {
        _signalSmoothed = -120;
        _segEls.forEach(s => s.classList.remove('sdr-mini-seg--on'));
    }

    // ── Connection dot ───────────────────────────────────────────────────────

    function setConnected(on: boolean) {
        dotEl.className = 'sdr-mini-conn-dot ' + (on ? 'sdr-mini-dot-on' : 'sdr-mini-dot-off');
        dotEl.title = on ? 'Connected' : 'Disconnected';
    }

    // ── Playing state ────────────────────────────────────────────────────────

    function setPlaying(playing: boolean) {
        _playing = playing;
        playBtn.disabled = playing;
        stopBtn.disabled = !playing;
        if (!playing) resetSignalBar();
    }

    // ── Frequency helpers ─────────────────────────────────────────────────────

    function parseFreqMhz(raw: string): number | null {
        const v = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(v) || v <= 0) return null;
        return v > 30000 ? Math.round(v) : Math.round(v * 1e6);
    }

    function displayFreq(hz: number) {
        if (document.activeElement !== freqInput) {
            freqInput.value = (hz / 1e6).toFixed(3);
        }
    }

    // ── Mode pills ───────────────────────────────────────────────────────────

    function setModePill(mode: string) {
        modePillsEl.querySelectorAll<HTMLButtonElement>('.sdr-mini-mode-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    modePillsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sdr-mini-mode-pill');
        if (!btn || btn.disabled) return;
        _mode = btn.dataset.mode!;
        setModePill(_mode);
        if (_playing) {
            if (window._SdrAudio) {
                window._SdrAudio.setMode(_mode);
                window._SdrAudio.setBandwidthHz(defaultBwHz(_mode));
            }
            if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
                _sdrSocket.send(JSON.stringify({ cmd: 'mode', mode: _mode }));
            }
        }
    });

    // ── Play / stop ──────────────────────────────────────────────────────────

    function defaultBwHz(mode: string): number {
        switch (mode) {
            case 'WFM': return 200_000;
            case 'NFM': return 12_500;
            case 'AM':  return 10_000;
            case 'USB': case 'LSB': return 3_000;
            case 'CW':  return 500;
            default:    return 10_000;
        }
    }

    function play() {
        const hz = parseFreqMhz(freqInput.value);
        if (!hz) return;
        _freqHz = hz;
        if (window._SdrAudio) {
            window._SdrAudio.initAudio(_sdrCurrentRadioId ?? undefined);
            window._SdrAudio.setMode(_mode);
            window._SdrAudio.setBandwidthHz(parseInt(bwSlider.value, 10));
            window._SdrAudio.setVolume(parseInt(volSlider.value, 10) / 100);
            window._SdrAudio.setSquelch(_squelch);
        }
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify({ cmd: 'tune', frequency_hz: _freqHz }));
            _sdrSocket.send(JSON.stringify({ cmd: 'mode', mode: _mode }));
        } else if (!_sdrSocket || _sdrSocket.readyState === WebSocket.CLOSED) {
            if (_sdrCurrentRadioId) {
                document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId: _sdrCurrentRadioId } }));
            }
        }
        sessionStorage.setItem('sdrLastFreqHz', String(_freqHz));
        sessionStorage.setItem('sdrLastMode', _mode);
        setPlaying(true);
    }

    function stop() {
        if (window._SdrAudio) window._SdrAudio.stop();
        setPlaying(false);
    }

    playBtn.addEventListener('click', play);
    stopBtn.addEventListener('click', stop);

    freqInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') play();
    });

    // ── Volume ────────────────────────────────────────────────────────────────

    volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10);
        volVal.textContent = `${v}%`;
        if (window._SdrAudio) window._SdrAudio.setVolume(v / 100);
    });

    // ── Squelch ──────────────────────────────────────────────────────────────

    let _sqDebounce: ReturnType<typeof setTimeout> | null = null;
    sqSlider.addEventListener('input', () => {
        _squelch = parseInt(sqSlider.value, 10);
        sqVal.textContent = `${_squelch} dBFS`;
        if (_sqDebounce) clearTimeout(_sqDebounce);
        _sqDebounce = setTimeout(() => {
            if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
                _sdrSocket.send(JSON.stringify({ cmd: 'squelch', squelch_dbfs: _squelch }));
            }
            if (window._SdrAudio) window._SdrAudio.setSquelch(_squelch);
        }, 150);
    });

    // ── Bandwidth ─────────────────────────────────────────────────────────────

    function formatBwHz(hz: number): string {
        if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
        if (hz >= 1_000)     return `${Math.round(hz / 1000)} kHz`;
        return `${hz} Hz`;
    }

    function snapToValidSampleRate(hz: number): number {
        if (hz <= 262500)  return 250000;
        if (hz <= 600000)  return 300000;
        if (hz <= 1474000) return 1024000;
        if (hz <= 1761000) return 1536000;
        if (hz <= 1921000) return 1792000;
        return 2048000;
    }

    let _bwDebounce: ReturnType<typeof setTimeout> | null = null;
    bwSlider.addEventListener('input', () => {
        const hz = parseInt(bwSlider.value, 10);
        bwVal.textContent = formatBwHz(hz);
        if (window._SdrAudio) window._SdrAudio.setBandwidthHz(hz);
        if (_bwDebounce) clearTimeout(_bwDebounce);
        _bwDebounce = setTimeout(() => {
            if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
                _sdrSocket.send(JSON.stringify({ cmd: 'sample_rate', rate_hz: snapToValidSampleRate(hz) }));
            }
        }, 150);
    });

    // ── RF Gain / AGC ─────────────────────────────────────────────────────────

    let _gainDebounce: ReturnType<typeof setTimeout> | null = null;

    function applyGain() {
        const auto = agcCheck.checked;
        gainSlider.disabled = auto;
        const g = parseFloat(gainSlider.value);
        gainVal.textContent = auto ? 'AUTO' : `${g.toFixed(1)} dB`;
        if (_gainDebounce) clearTimeout(_gainDebounce);
        _gainDebounce = setTimeout(() => {
            if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
                _sdrSocket.send(JSON.stringify({ cmd: 'gain', gain_db: auto ? null : g }));
            }
        }, 150);
    }

    gainSlider.addEventListener('input', applyGain);
    agcCheck.addEventListener('change', applyGain);

    // ── Custom device dropdown ────────────────────────────────────────────────

    let _deviceMenuEl: HTMLDivElement | null = null;
    let _deviceMenuOpen = false;

    function buildDeviceMenu(radios: SdrRadio[]) {
        if (_deviceMenuEl) _deviceMenuEl.remove();
        _deviceMenuEl = document.createElement('div');
        _deviceMenuEl.className = 'sdr-mini-device-menu';

        const placeholder = document.createElement('div');
        placeholder.className = 'sdr-mini-device-menu-item sdr-mini-device-menu-placeholder';
        placeholder.textContent = '— select radio —';
        placeholder.addEventListener('click', () => {
            radioSelect.value = '';
            deviceText.textContent = '— SELECT RADIO —';
            deviceText.classList.remove('sdr-mini-device-text--chosen');
            closeDeviceMenu();
            stop();
            setConnected(false);
            _sdrCurrentRadioId = null;
            sessionStorage.removeItem('sdrLastRadioId');
            document.dispatchEvent(new CustomEvent('sdr-radio-deselected'));
        });
        _deviceMenuEl.appendChild(placeholder);

        radios.filter(r => r.enabled).forEach(r => {
            const item = document.createElement('div');
            item.className = 'sdr-mini-device-menu-item';
            item.textContent = r.name;
            item.addEventListener('click', () => {
                radioSelect.value = String(r.id);
                deviceText.textContent = r.name.toUpperCase();
                deviceText.classList.add('sdr-mini-device-text--chosen');
                closeDeviceMenu();
                stop();
                setConnected(false);
                _sdrCurrentRadioId = r.id;
                sessionStorage.setItem('sdrLastRadioId', String(r.id));
                document.dispatchEvent(new CustomEvent('sdr-radio-selected', { detail: { radioId: r.id } }));
            });
            _deviceMenuEl!.appendChild(item);
        });

        document.body.appendChild(_deviceMenuEl);
    }

    function positionDeviceMenu() {
        if (!_deviceMenuEl) return;
        const rect = deviceDropdown.getBoundingClientRect();
        _deviceMenuEl.style.left  = rect.left + 'px';
        _deviceMenuEl.style.top   = rect.bottom + 'px';
        _deviceMenuEl.style.width = rect.width + 'px';
    }

    function openDeviceMenu() {
        if (!_deviceMenuEl) return;
        positionDeviceMenu();
        _deviceMenuEl.classList.add('sdr-mini-device-menu--open');
        deviceDropdown.classList.add('sdr-mini-device-dropdown--open');
        _deviceMenuOpen = true;
    }

    function closeDeviceMenu() {
        if (!_deviceMenuEl) return;
        _deviceMenuEl.classList.remove('sdr-mini-device-menu--open');
        deviceDropdown.classList.remove('sdr-mini-device-dropdown--open');
        _deviceMenuOpen = false;
    }

    deviceDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_deviceMenuOpen) closeDeviceMenu(); else openDeviceMenu();
    });

    deviceDropdown.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _deviceMenuOpen ? closeDeviceMenu() : openDeviceMenu(); }
        if (e.key === 'Escape') closeDeviceMenu();
    });

    document.addEventListener('click', () => { if (_deviceMenuOpen) closeDeviceMenu(); });

    // ── Populate radios (called by boot) ─────────────────────────────────────

    function populateRadios(radios: SdrRadio[]) {
        // Keep hidden select in sync for value tracking
        while (radioSelect.options.length > 0) radioSelect.remove(0);
        const def = document.createElement('option');
        def.value = '';
        def.textContent = '— select radio —';
        radioSelect.appendChild(def);
        radios.filter(r => r.enabled).forEach(r => {
            const opt = document.createElement('option');
            opt.value = String(r.id);
            opt.textContent = r.name;
            radioSelect.appendChild(opt);
        });

        buildDeviceMenu(radios);

        // Restore last selection
        const savedId = _sdrCurrentRadioId != null ? String(_sdrCurrentRadioId) : '';
        if (savedId) {
            const radio = radios.find(r => r.enabled && String(r.id) === savedId);
            if (radio) {
                radioSelect.value = savedId;
                deviceText.textContent = radio.name.toUpperCase();
                deviceText.classList.add('sdr-mini-device-text--chosen');
            }
        }
    }

    // ── Signal bar: driven by audio worklet power messages ───────────────────
    // The worklet posts {type:'power', dbfs} on every frame — before squelch
    // gating. We gate here: only light segments when signal exceeds squelch.
    // _SdrControls.updateSignalBar is what sdr-audio.ts calls from the worklet.
    // Register it so it routes here when the mini player is active.

    if (!window._SdrControls) {
        (window as any)._SdrControls = {} as SdrControlsAPI;
    }
    const _prevUpdateSignalBar = window._SdrControls.updateSignalBar;
    window._SdrControls.updateSignalBar = (dbfs: number) => {
        if (_prevUpdateSignalBar) _prevUpdateSignalBar(dbfs);
        if (_playing) updateSignalBar(dbfs);
    };

    document.addEventListener('sdr-mini:connected', (e: Event) => {
        setConnected((e as CustomEvent<boolean>).detail);
        if (!(e as CustomEvent<boolean>).detail) setPlaying(false);
    });

    // ── Close ─────────────────────────────────────────────────────────────────

    closeBtn.addEventListener('click', () => { stop(); hide(); });

    // ── Dragging ─────────────────────────────────────────────────────────────

    let _dragOffX = 0, _dragOffY = 0, _dragging = false;

    handle.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('#sdr-mini-close')) return;
        _dragging = true;
        const rect = el.getBoundingClientRect();
        _dragOffX = e.clientX - rect.left;
        _dragOffY = e.clientY - rect.top;
        el.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!_dragging) return;
        const x = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  e.clientX - _dragOffX));
        const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - _dragOffY));
        el.style.right = 'auto'; el.style.bottom = 'auto';
        el.style.left = x + 'px'; el.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => { _dragging = false; });

    handle.addEventListener('touchstart', (e: TouchEvent) => {
        if ((e.target as HTMLElement).closest('#sdr-mini-close')) return;
        _dragging = true;
        const t = e.touches[0], rect = el.getBoundingClientRect();
        _dragOffX = t.clientX - rect.left; _dragOffY = t.clientY - rect.top;
        el.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e: TouchEvent) => {
        if (!_dragging) return;
        const t = e.touches[0];
        const x = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  t.clientX - _dragOffX));
        const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, t.clientY - _dragOffY));
        el.style.right = 'auto'; el.style.bottom = 'auto';
        el.style.left = x + 'px'; el.style.top = y + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => { _dragging = false; });

    // ── Public API ────────────────────────────────────────────────────────────

    function show() { el.classList.remove('sdr-mini-hidden'); }
    function hide() { el.classList.add('sdr-mini-hidden'); }

    function tune(freqHz: number, mode: string, name: string) {
        _freqHz = freqHz;
        _mode   = mode || 'AM';
        titleEl.textContent = name || 'SDR';
        displayFreq(freqHz);
        setModePill(_mode);
        setPlaying(false);
        show();
    }

    (window as any)._SdrMiniPlayer = { tune, show, hide, updateSignalBar, setConnected, populateRadios };

})();
