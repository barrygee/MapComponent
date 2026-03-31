"use strict";
// ============================================================
// SDR DISPLAY — SigPlot spectrum + waterfall with tuning overlay
//
// Overlay canvas sits on top of both plots and draws:
//   - A centre-frequency marker line
//   - A draggable bandwidth bracket (shows demod bandwidth)
//   - Click anywhere to tune
//   - Drag bracket edges to set bandwidth (sent as sample_rate cmd)
// ============================================================
/// <reference path="./globals.d.ts" />
(function buildSdrDisplay() {
    // ── DOM ───────────────────────────────────────────────────────────────────
    const content = document.createElement('div');
    content.id = 'sdr-content';
    const specDiv = document.createElement('div');
    specDiv.id = 'sdr-spectrum';
    const wfDiv = document.createElement('div');
    wfDiv.id = 'sdr-waterfall';
    // Overlay canvas covers the full content area for tuning interaction
    const overlay = document.createElement('canvas');
    overlay.id = 'sdr-overlay';
    content.appendChild(specDiv);
    content.appendChild(wfDiv);
    content.appendChild(overlay);
    document.body.appendChild(content);
    // ── SigPlot instances ─────────────────────────────────────────────────────
    const SPEC_OPTS = {
        all: true,
        expand: true,
        autol: 5,
        autohide_panbars: true,
        nogrid: false,
        ylabel: 2,
        noxaxis: false,
        noyaxis: false,
        ymin: -120,
        ymax: 0,
        colors: { fg: '#c8ff00', bg: '#000000' },
    };
    const WF_OPTS = {
        all: true,
        expand: true,
        autol: 5,
        autohide_panbars: true,
        noxaxis: false,
        noyaxis: true,
        colors: { fg: '#c8ff00', bg: '#000000' },
    };
    const specPlot = new sigplot.Plot(specDiv, SPEC_OPTS);
    const wfPlot = new sigplot.Plot(wfDiv, WF_OPTS);
    // ── Pipe layers ───────────────────────────────────────────────────────────
    let _specLayer = null;
    let _wfLayer = null;
    let _nBins = 0;
    let _centerHz = 0;
    let _sampleRate = 0;
    let _freqMinMhz = 0;
    let _freqMaxMhz = 0;
    function _ensureLayers(frame) {
        const n = frame.bins.length;
        if (_specLayer && n === _nBins && frame.center_hz === _centerHz && frame.sample_rate === _sampleRate)
            return;
        if (_specLayer) {
            specPlot.deoverlay(_specLayer);
            _specLayer = null;
        }
        if (_wfLayer) {
            wfPlot.deoverlay(_wfLayer);
            _wfLayer = null;
        }
        _nBins = n;
        _centerHz = frame.center_hz;
        _sampleRate = frame.sample_rate;
        const halfBw = frame.sample_rate / 2;
        _freqMinMhz = (frame.center_hz - halfBw) / 1e6;
        _freqMaxMhz = (frame.center_hz + halfBw) / 1e6;
        const xdelta = frame.sample_rate / n / 1e6;
        const override1d = { type: 1000, xstart: _freqMinMhz, xdelta, xunits: 3, yunits: 2, xlabel: 3 };
        const override2d = { type: 2000, subsize: n, xstart: _freqMinMhz, xdelta, xunits: 3, yunits: 0, xlabel: 3 };
        _specLayer = specPlot.overlay_pipe(override1d, { framesize: n });
        _wfLayer = wfPlot.overlay_pipe(override2d, { framesize: n });
        if (_tunerMhz < _freqMinMhz || _tunerMhz > _freqMaxMhz) {
            _tunerMhz = frame.center_hz / 1e6;
        }
        _drawOverlay();
    }
    // ── Render ────────────────────────────────────────────────────────────────
    function renderFrame(frame) {
        const n = frame.bins.length;
        if (!n)
            return;
        _ensureLayers(frame);
        const data = new Float32Array(frame.bins);
        specPlot.push(_specLayer, data);
        wfPlot.push(_wfLayer, data);
        content.classList.remove('sdr-no-signal');
    }
    // ── Overlay: tuner marker + bandwidth bracket ─────────────────────────────
    let _tunerMhz = 0; // centre of demod window
    let _bwMhz = 0.2; // demod bandwidth (default 200 kHz for WFM)
    const HANDLE_PX = 8; // grab handle half-width in px
    function _mhzToX(mhz) {
        if (_freqMaxMhz === _freqMinMhz)
            return 0;
        return ((mhz - _freqMinMhz) / (_freqMaxMhz - _freqMinMhz)) * overlay.width;
    }
    function _xToMhz(x) {
        return _freqMinMhz + (x / overlay.width) * (_freqMaxMhz - _freqMinMhz);
    }
    function _drawOverlay() {
        const ctx = overlay.getContext('2d');
        if (!ctx)
            return;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (!_tunerMhz || _freqMinMhz === _freqMaxMhz)
            return;
        const cx = _mhzToX(_tunerMhz);
        const lx = _mhzToX(_tunerMhz - _bwMhz / 2);
        const rx = _mhzToX(_tunerMhz + _bwMhz / 2);
        const h = overlay.height;
        const specH = Math.round(h * 0.3); // matches CSS 30% split
        // Bandwidth fill
        ctx.fillStyle = 'rgba(255, 60, 0, 0.15)';
        ctx.fillRect(lx, 0, rx - lx, h);
        // Centre line
        ctx.strokeStyle = '#ff3c00';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
        // Bracket top bar (spectrum area only)
        ctx.strokeStyle = 'rgba(255, 60, 0, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(lx, 2, rx - lx, specH - 4);
        // Edge handles
        ctx.fillStyle = '#ff3c00';
        ctx.fillRect(lx - HANDLE_PX / 2, specH / 2 - HANDLE_PX, HANDLE_PX, HANDLE_PX * 2);
        ctx.fillRect(rx - HANDLE_PX / 2, specH / 2 - HANDLE_PX, HANDLE_PX, HANDLE_PX * 2);
        // Frequency label
        ctx.fillStyle = '#ff3c00';
        ctx.font = '11px monospace';
        ctx.fillText(`${_tunerMhz.toFixed(4)} MHz`, cx + 4, 14);
        ctx.fillText(`BW: ${(_bwMhz * 1000).toFixed(0)} kHz`, cx + 4, 28);
    }
    let _drag = null;
    function _hitTest(x) {
        if (!_tunerMhz)
            return 'tune';
        const cx = _mhzToX(_tunerMhz);
        const lx = _mhzToX(_tunerMhz - _bwMhz / 2);
        const rx = _mhzToX(_tunerMhz + _bwMhz / 2);
        if (Math.abs(x - lx) <= HANDLE_PX)
            return 'bw-left';
        if (Math.abs(x - rx) <= HANDLE_PX)
            return 'bw-right';
        return 'tune';
    }
    function _sendTune(mhz) {
        if (!_sdrSocket || !_sdrConnected)
            return;
        const hz = Math.round(mhz * 1e6);
        _sdrSocket.send(JSON.stringify({ cmd: 'tune', frequency_hz: hz }));
        const inp = document.getElementById('sdr-freq-input');
        if (inp)
            inp.value = mhz.toFixed(4);
    }
    function _applyBandwidth() {
        if (window._SdrAudio)
            window._SdrAudio.setBandwidthHz(Math.round(_bwMhz * 1e6));
    }
    overlay.addEventListener('mousedown', (e) => {
        const rect = overlay.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (overlay.width / rect.width);
        _drag = _hitTest(x);
        if (_drag === 'tune') {
            _tunerMhz = Math.max(_freqMinMhz, Math.min(_freqMaxMhz, _xToMhz(x)));
            _drawOverlay();
            // Don't tune yet — wait for mouseup to avoid waterfall resets while dragging
        }
    });
    overlay.addEventListener('mousemove', (e) => {
        const rect = overlay.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (overlay.width / rect.width);
        // Cursor hint
        const hit = _hitTest(x);
        overlay.style.cursor = (hit === 'bw-left' || hit === 'bw-right') ? 'ew-resize' : 'crosshair';
        if (!_drag)
            return;
        const mhz = _xToMhz(x);
        if (_drag === 'tune') {
            _tunerMhz = Math.max(_freqMinMhz, Math.min(_freqMaxMhz, mhz));
            _drawOverlay();
            // No tune command during drag — only update the visual marker
        }
        else if (_drag === 'bw-left') {
            const newBw = (_tunerMhz - mhz) * 2;
            _bwMhz = Math.max(0.01, Math.min(_freqMaxMhz - _freqMinMhz, newBw));
            _drawOverlay();
        }
        else if (_drag === 'bw-right') {
            const newBw = (mhz - _tunerMhz) * 2;
            _bwMhz = Math.max(0.01, Math.min(_freqMaxMhz - _freqMinMhz, newBw));
            _drawOverlay();
        }
    });
    overlay.addEventListener('mouseup', () => {
        if (_drag === 'tune')
            _sendTune(_tunerMhz);
        if (_drag === 'bw-left' || _drag === 'bw-right')
            _applyBandwidth();
        _drag = null;
    });
    overlay.addEventListener('mouseleave', () => {
        // Cancel drag silently — no tune on leave
        _drag = null;
    });
    // ── Resize ────────────────────────────────────────────────────────────────
    function resize() {
        const w = content.clientWidth;
        const h = content.clientHeight;
        if (w < 10 || h < 10)
            return;
        overlay.width = w;
        overlay.height = h;
        specPlot.checkresize();
        wfPlot.checkresize();
        _drawOverlay();
    }
    // ── Public API ────────────────────────────────────────────────────────────
    function setFreqMarker(hz) {
        _tunerMhz = hz / 1e6;
        _drawOverlay();
    }
    window._SdrDisplay = { renderFrame, resize, setFreqMarker };
    new ResizeObserver(resize).observe(content);
    setTimeout(resize, 60);
})();
