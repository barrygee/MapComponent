"use strict";
// ============================================================
// SDR CONTROLS
// Fixed control strip at the bottom of the page (above the footer).
// Contains: radio selector, frequency input, mode selector,
//           gain slider, squelch slider, connection status dot.
//
// Exposes window._SdrControls = { setStatus, applyStatus, getSelectedRadioId }
// ============================================================
/// <reference path="./globals.d.ts" />
(function buildSdrControls() {
    // ── Build DOM ─────────────────────────────────────────────────────────────
    const strip = document.createElement('div');
    strip.id = 'sdr-controls';
    strip.innerHTML = `
        <div class="sdr-ctrl-group sdr-ctrl-radio">
            <label class="sdr-ctrl-label">RADIO</label>
            <select id="sdr-radio-select" class="sdr-select">
                <option value="">— no radio —</option>
            </select>
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-freq">
            <label class="sdr-ctrl-label">FREQUENCY</label>
            <div class="sdr-freq-row">
                <input id="sdr-freq-input" class="sdr-freq-input" type="text" placeholder="100.000" autocomplete="off" spellcheck="false">
                <span class="sdr-freq-unit">MHz</span>
                <button id="sdr-freq-tune" class="sdr-tune-btn" title="Tune">&#9654;</button>
            </div>
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-mode">
            <label class="sdr-ctrl-label">MODE</label>
            <select id="sdr-mode-select" class="sdr-select">
                <option value="AM">AM</option>
                <option value="NFM">NFM</option>
                <option value="WFM">WFM</option>
                <option value="USB">USB</option>
                <option value="LSB">LSB</option>
                <option value="CW">CW</option>
            </select>
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-gain">
            <label class="sdr-ctrl-label">GAIN <span id="sdr-gain-val">30.0 dB</span></label>
            <input id="sdr-gain-slider" class="sdr-slider" type="range" min="-1" max="49" step="0.5" value="30">
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-squelch">
            <label class="sdr-ctrl-label">SQUELCH <span id="sdr-sq-val">-120 dBFS</span></label>
            <input id="sdr-sq-slider" class="sdr-slider" type="range" min="-120" max="0" step="1" value="-120">
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-volume">
            <label class="sdr-ctrl-label">VOLUME <span id="sdr-vol-val">100%</span></label>
            <input id="sdr-vol-slider" class="sdr-slider" type="range" min="0" max="200" step="1" value="100">
        </div>

        <div class="sdr-ctrl-group sdr-ctrl-audio">
            <label class="sdr-ctrl-label">AUDIO</label>
            <button id="sdr-audio-btn" class="sdr-audio-btn" title="Start/Stop Audio">&#9654;</button>
        </div>

        <div class="sdr-ctrl-status">
            <div id="sdr-conn-dot" class="sdr-conn-dot sdr-dot-off" title="Disconnected"></div>
        </div>
    `;
    document.body.appendChild(strip);
    // ── Element references ────────────────────────────────────────────────────
    const radioSelect = document.getElementById('sdr-radio-select');
    const freqInput = document.getElementById('sdr-freq-input');
    const freqTuneBtn = document.getElementById('sdr-freq-tune');
    const modeSelect = document.getElementById('sdr-mode-select');
    const gainSlider = document.getElementById('sdr-gain-slider');
    const gainVal = document.getElementById('sdr-gain-val');
    const sqSlider = document.getElementById('sdr-sq-slider');
    const sqVal = document.getElementById('sdr-sq-val');
    const connDot = document.getElementById('sdr-conn-dot');
    // ── Helpers ───────────────────────────────────────────────────────────────
    function sendCmd(obj) {
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify(obj));
        }
    }
    function parseFreqMhz(raw) {
        const v = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(v) || v <= 0)
            return null;
        // If value looks like Hz (> 30000), use as-is; otherwise treat as MHz
        return v > 30000 ? v : Math.round(v * 1e6);
    }
    function displayFreq(hz) {
        freqInput.value = (hz / 1e6).toFixed(6).replace(/\.?0+$/, '');
    }
    // ── Tune ──────────────────────────────────────────────────────────────────
    function tune() {
        const hz = parseFreqMhz(freqInput.value);
        if (!hz)
            return;
        _sdrCurrentFreqHz = hz;
        sendCmd({ cmd: 'tune', frequency_hz: hz });
        if (window._SdrDisplay)
            window._SdrDisplay.setFreqMarker(hz);
        displayFreq(hz);
    }
    freqTuneBtn.addEventListener('click', tune);
    freqInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            tune();
    });
    // ── Mode ──────────────────────────────────────────────────────────────────
    modeSelect.addEventListener('change', () => {
        _sdrCurrentMode = modeSelect.value;
        sendCmd({ cmd: 'mode', mode: modeSelect.value });
        if (window._SdrAudio)
            window._SdrAudio.setMode(modeSelect.value);
    });
    // ── Gain ──────────────────────────────────────────────────────────────────
    let _gainDebounce = null;
    gainSlider.addEventListener('input', () => {
        const g = parseFloat(gainSlider.value);
        if (g < 0) {
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
            if (g < 0) {
                sendCmd({ cmd: 'gain', gain_db: null });
            }
            else {
                sendCmd({ cmd: 'gain', gain_db: g });
            }
        }, 150);
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
    // ── Volume ────────────────────────────────────────────────────────────────
    const volSlider = document.getElementById('sdr-vol-slider');
    const volVal = document.getElementById('sdr-vol-val');
    volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10);
        volVal.textContent = `${v}%`;
        if (window._SdrAudio)
            window._SdrAudio.setVolume(v / 100);
    });
    // ── Audio start/stop ──────────────────────────────────────────────────────
    const audioBtn = document.getElementById('sdr-audio-btn');
    let _audioRunning = false;
    function _setAudioRunning(running) {
        _audioRunning = running;
        audioBtn.innerHTML = running ? '&#9646;&#9646;' : '&#9654;';
        audioBtn.title = running ? 'Stop' : 'Start';
    }
    audioBtn.addEventListener('click', async () => {
        if (!_audioRunning) {
            // Start: connect radio then init audio
            const id = getSelectedRadioId();
            if (id)
                document.dispatchEvent(new CustomEvent('sdr-radio-selected', { bubbles: true, detail: { radioId: id } }));
            if (window._SdrAudio)
                await window._SdrAudio.initAudio();
            _setAudioRunning(true);
        }
        else {
            // Stop: close WebSocket and audio
            if (_sdrSocket) {
                _sdrSocket.close();
                _sdrSocket = null;
            }
            if (window._SdrAudio)
                window._SdrAudio.stop();
            _sdrConnected = false;
            setStatus(false);
            _setAudioRunning(false);
        }
    });
    // Keep button in sync if connection drops externally
    window._sdrSetAudioBtn = _setAudioRunning;
    // ── Radio select — handled by sdr-boot (it populates the list) ───────────
    radioSelect.addEventListener('change', () => {
        const id = parseInt(radioSelect.value, 10);
        if (!isNaN(id) && id > 0) {
            // sdr-boot will detect this change and open/re-open the WebSocket
            radioSelect.dispatchEvent(new CustomEvent('sdr-radio-selected', { bubbles: true, detail: { radioId: id } }));
        }
    });
    // ── Status dot ───────────────────────────────────────────────────────────
    function setStatus(connected) {
        _sdrConnected = connected;
        connDot.className = 'sdr-conn-dot ' + (connected ? 'sdr-dot-on' : 'sdr-dot-off');
        connDot.title = connected ? 'Connected' : 'Disconnected';
    }
    function applyStatus(msg) {
        setStatus(msg.connected);
        if (msg.connected) {
            _sdrCurrentFreqHz = msg.center_hz;
            _sdrCurrentMode = msg.mode;
            _sdrCurrentGain = msg.gain_db;
            _sdrCurrentGainAuto = msg.gain_auto;
            _sdrCurrentSampleRate = msg.sample_rate;
            displayFreq(msg.center_hz);
            modeSelect.value = msg.mode;
            if (msg.gain_auto) {
                gainSlider.value = '-1';
                gainVal.textContent = 'AUTO';
            }
            else {
                gainSlider.value = String(msg.gain_db);
                gainVal.textContent = `${msg.gain_db.toFixed(1)} dB`;
            }
            if (window._SdrDisplay)
                window._SdrDisplay.setFreqMarker(msg.center_hz);
        }
    }
    function getSelectedRadioId() {
        const v = parseInt(radioSelect.value, 10);
        return isNaN(v) || v <= 0 ? null : v;
    }
    // ── Populate radio list (called by sdr-boot) ──────────────────────────────
    window._sdrPopulateRadios = function (radios) {
        const current = radioSelect.value;
        while (radioSelect.options.length > 1)
            radioSelect.remove(1);
        radios.filter(r => r.enabled).forEach(r => {
            const opt = document.createElement('option');
            opt.value = String(r.id);
            opt.textContent = r.name;
            radioSelect.appendChild(opt);
        });
        if (current)
            radioSelect.value = current;
    };
    window._SdrControls = { setStatus, applyStatus, getSelectedRadioId };
})();
