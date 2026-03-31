// ============================================================
// SDR PANEL
// SDR-specific left panel — replaces the shared map sidebar on the SDR page.
// Contains three tabs: FREQS / GROUPS / SCAN
//
// Exposes window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus }
// ============================================================

/// <reference path="./globals.d.ts" />

(function buildSdrPanel() {

    // ── DOM ───────────────────────────────────────────────────────────────────

    const panel = document.createElement('div');
    panel.id = 'sdr-panel';

    panel.innerHTML = `
        <div id="sdr-panel-tabs">
            <button class="sdr-ptab sdr-ptab-active" data-tab="freqs">FREQS</button>
            <button class="sdr-ptab" data-tab="groups">GROUPS</button>
            <button class="sdr-ptab" data-tab="scan">SCAN</button>
            <button class="sdr-ptab" data-tab="test">TEST</button>
        </div>
        <div id="sdr-panel-panes">
            <div class="sdr-ppane sdr-ppane-active" id="sdr-pane-freqs">
                <div id="sdr-freq-list"></div>
                <div id="sdr-freq-empty" class="sdr-panel-empty">No saved frequencies.<br>Click ADD FREQ in the menu to save the current frequency.</div>
            </div>
            <div class="sdr-ppane" id="sdr-pane-groups">
                <div id="sdr-group-list"></div>
                <div class="sdr-panel-add-row">
                    <input id="sdr-new-group-name" class="sdr-panel-input" type="text" placeholder="Group name…" maxlength="40">
                    <button id="sdr-add-group-btn" class="sdr-panel-btn">ADD</button>
                </div>
            </div>
            <div class="sdr-ppane" id="sdr-pane-scan">
                <div class="sdr-scan-status" id="sdr-scan-status">
                    <div class="sdr-scan-indicator" id="sdr-scan-indicator"></div>
                    <span id="sdr-scan-label">IDLE</span>
                </div>
                <div class="sdr-scan-current" id="sdr-scan-current"></div>
                <div class="sdr-scan-dwell-row">
                    <label class="sdr-ctrl-label">DWELL TIME</label>
                    <input id="sdr-scan-dwell" class="sdr-panel-input" type="number" min="500" max="30000" step="500" value="2000">
                    <span class="sdr-scan-dwell-unit">ms</span>
                </div>
                <div class="sdr-scan-controls">
                    <button id="sdr-scan-start" class="sdr-panel-btn sdr-scan-btn">START SCAN</button>
                    <button id="sdr-scan-stop"  class="sdr-panel-btn sdr-scan-stop-btn" disabled>STOP</button>
                </div>
                <div class="sdr-scan-queue-label">SCAN QUEUE <span id="sdr-scan-count">0 frequencies</span></div>
                <div id="sdr-scan-queue-list" class="sdr-scan-queue"></div>
            </div>

            <div class="sdr-ppane" id="sdr-pane-test">
                <div class="sdr-test-section-label">SEND COMMAND</div>
                <div class="sdr-test-row">
                    <label class="sdr-ctrl-label">TUNE (Hz)</label>
                    <input id="sdr-test-freq" class="sdr-panel-input" type="number" placeholder="118050000" step="1000">
                    <button class="sdr-panel-btn" id="sdr-test-tune-btn">SEND</button>
                </div>
                <div class="sdr-test-row">
                    <label class="sdr-ctrl-label">GAIN (dB / blank=auto)</label>
                    <input id="sdr-test-gain" class="sdr-panel-input" type="number" placeholder="auto" step="0.5">
                    <button class="sdr-panel-btn" id="sdr-test-gain-btn">SEND</button>
                </div>
                <div class="sdr-test-row">
                    <label class="sdr-ctrl-label">SAMPLE RATE (Hz)</label>
                    <input id="sdr-test-rate" class="sdr-panel-input" type="number" placeholder="2048000" step="1">
                    <button class="sdr-panel-btn" id="sdr-test-rate-btn">SEND</button>
                </div>
                <div class="sdr-test-row">
                    <label class="sdr-ctrl-label">RAW JSON COMMAND</label>
                    <input id="sdr-test-raw" class="sdr-panel-input" type="text" placeholder='{"cmd":"ping"}'>
                    <button class="sdr-panel-btn" id="sdr-test-raw-btn">SEND</button>
                </div>
                <div class="sdr-test-section-label" style="margin-top:10px">RESPONSE LOG</div>
                <div id="sdr-test-log" class="sdr-test-log"></div>
                <button class="sdr-panel-btn" id="sdr-test-clear-btn" style="margin:8px 14px">CLEAR LOG</button>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    // ── State ─────────────────────────────────────────────────────────────────

    let _groups:  SdrFrequencyGroup[]   = [];
    let _freqs:   SdrStoredFrequency[]  = [];
    let _visible: boolean = true;

    // ── Tab switching ─────────────────────────────────────────────────────────

    const tabs  = panel.querySelectorAll<HTMLButtonElement>('.sdr-ptab');
    const panes = panel.querySelectorAll<HTMLDivElement>('.sdr-ppane');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t  => t.classList.remove('sdr-ptab-active'));
            panes.forEach(p => p.classList.remove('sdr-ppane-active'));
            tab.classList.add('sdr-ptab-active');
            const target = panel.querySelector<HTMLDivElement>(`#sdr-pane-${tab.dataset.tab}`);
            if (target) target.classList.add('sdr-ppane-active');
        });
    });

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

        // Group freqs
        const grouped: Record<number | 'none', SdrStoredFrequency[]> = { none: [] };
        _groups.forEach(g => { grouped[g.id] = []; });
        _freqs.forEach(f => {
            const key = f.group_id ?? 'none';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(f);
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
                    <div class="sdr-freq-row-hz">${mhz} <span>MHz</span></div>
                `;
                row.addEventListener('click', () => tuneToFreq(f));
                list.appendChild(row);
            });
        }

        _groups.forEach(g => renderGroup(g.name, g.color, grouped[g.id] || []));
        renderGroup('Ungrouped', 'rgba(255,255,255,0.2)', grouped['none'] || []);

        // Update scan queue list too
        renderScanQueue();
    }

    function tuneToFreq(f: SdrStoredFrequency) {
        _sdrCurrentFreqHz = f.frequency_hz;
        _sdrCurrentMode   = f.mode;
        if (_sdrSocket && _sdrSocket.readyState === WebSocket.OPEN) {
            _sdrSocket.send(JSON.stringify({ cmd: 'tune', frequency_hz: f.frequency_hz }));
            _sdrSocket.send(JSON.stringify({ cmd: 'mode', mode: f.mode }));
        }
        if (window._SdrDisplay) window._SdrDisplay.setFreqMarker(f.frequency_hz);
        // Sync controls input
        const freqInput = document.getElementById('sdr-freq-input') as HTMLInputElement | null;
        if (freqInput) freqInput.value = (f.frequency_hz / 1e6).toFixed(6).replace(/\.?0+$/, '');
        const modeSelect = document.getElementById('sdr-mode-select') as HTMLSelectElement | null;
        if (modeSelect) modeSelect.value = f.mode;
    }

    // ── Render group list (GROUPS tab) ────────────────────────────────────────

    function renderGroups() {
        const list = document.getElementById('sdr-group-list')!;
        list.innerHTML = '';
        _groups.forEach(g => {
            const row = document.createElement('div');
            row.className = 'sdr-group-row';
            row.innerHTML = `
                <span class="sdr-freq-group-dot" style="background:${g.color}"></span>
                <span class="sdr-group-name">${g.name}</span>
                <button class="sdr-group-del" data-id="${g.id}" title="Delete group">&#x2715;</button>
            `;
            row.querySelector<HTMLButtonElement>('.sdr-group-del')!.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteGroup(g.id);
            });
            list.appendChild(row);
        });
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
            if (res.ok) {
                input.value = '';
                await reloadData();
            }
        } catch (_) {}
    }

    async function deleteGroup(id: number) {
        try {
            await fetch(`/api/sdr/groups/${id}`, { method: 'DELETE' });
            await reloadData();
        } catch (_) {}
    }

    // ── Scanner ───────────────────────────────────────────────────────────────

    let _scanQueue:   SdrStoredFrequency[] = [];
    let _scanIdx:     number = 0;
    let _scanTimer:   ReturnType<typeof setTimeout> | null = null;

    function renderScanQueue() {
        _scanQueue = _freqs.filter(f => f.scannable);
        const count = document.getElementById('sdr-scan-count')!;
        count.textContent = `${_scanQueue.length} frequenc${_scanQueue.length === 1 ? 'y' : 'ies'}`;

        const qList = document.getElementById('sdr-scan-queue-list')!;
        qList.innerHTML = '';
        _scanQueue.forEach(f => {
            const item = document.createElement('div');
            item.className = 'sdr-scan-item';
            item.textContent = `${(f.frequency_hz / 1e6).toFixed(4)} ${f.mode}  ${f.label}`;
            qList.appendChild(item);
        });
    }

    function startScan() {
        if (_sdrScanLocked || _scanQueue.length === 0) return;
        _sdrScanActive = true;
        document.getElementById('sdr-scan-start')!.setAttribute('disabled', '');
        (document.getElementById('sdr-scan-stop') as HTMLButtonElement).disabled = false;
        setScanStatus(true, null);
        _scanIdx = 0;
        doScanStep();
    }

    function stopScan() {
        _sdrScanActive = false;
        if (_scanTimer) { clearTimeout(_scanTimer); _scanTimer = null; }
        document.getElementById('sdr-scan-start')!.removeAttribute('disabled');
        (document.getElementById('sdr-scan-stop') as HTMLButtonElement).disabled = true;
        setScanStatus(false, null);
    }

    function doScanStep() {
        if (!_sdrScanActive || _sdrScanLocked || _scanQueue.length === 0) return;
        const f = _scanQueue[_scanIdx % _scanQueue.length];
        tuneToFreq(f);
        setScanStatus(true, f.frequency_hz);
        const dwell = parseInt((document.getElementById('sdr-scan-dwell') as HTMLInputElement).value, 10) || 2000;
        _scanIdx++;
        _scanTimer = setTimeout(doScanStep, dwell);
    }

    document.getElementById('sdr-scan-start')!.addEventListener('click', startScan);
    document.getElementById('sdr-scan-stop')!.addEventListener('click',  stopScan);

    function setScanStatus(active: boolean, currentHz: number | null) {
        const indicator = document.getElementById('sdr-scan-indicator')!;
        const label     = document.getElementById('sdr-scan-label')!;
        const current   = document.getElementById('sdr-scan-current')!;
        indicator.className = 'sdr-scan-indicator' + (active ? ' sdr-scan-running' : '');
        label.textContent   = active ? 'SCANNING' : 'IDLE';
        current.textContent = (active && currentHz) ? `→ ${(currentHz / 1e6).toFixed(4)} MHz` : '';
    }

    // ── Test panel ────────────────────────────────────────────────────────────

    function testLog(msg: string, type: 'sent' | 'ok' | 'err' = 'ok') {
        const log = document.getElementById('sdr-test-log')!;
        const line = document.createElement('div');
        line.className = `sdr-test-log-line sdr-test-${type}`;
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.insertBefore(line, log.firstChild);
        // Keep last 50 lines
        while (log.children.length > 50) log.removeChild(log.lastChild!);
    }

    function testSend(obj: object) {
        if (!_sdrSocket || _sdrSocket.readyState !== WebSocket.OPEN) {
            testLog('Not connected — no WebSocket open', 'err');
            return;
        }
        const str = JSON.stringify(obj);
        _sdrSocket.send(str);
        testLog(`→ ${str}`, 'sent');
    }

    document.getElementById('sdr-test-tune-btn')!.addEventListener('click', () => {
        const v = (document.getElementById('sdr-test-freq') as HTMLInputElement).value;
        const hz = parseInt(v, 10);
        if (!hz) { testLog('Invalid frequency', 'err'); return; }
        testSend({ cmd: 'tune', frequency_hz: hz });
    });

    document.getElementById('sdr-test-gain-btn')!.addEventListener('click', () => {
        const v = (document.getElementById('sdr-test-gain') as HTMLInputElement).value.trim();
        testSend({ cmd: 'gain', gain_db: v === '' ? null : parseFloat(v) });
    });

    document.getElementById('sdr-test-rate-btn')!.addEventListener('click', () => {
        const v = (document.getElementById('sdr-test-rate') as HTMLInputElement).value;
        const hz = parseInt(v, 10);
        if (!hz) { testLog('Invalid sample rate', 'err'); return; }
        testSend({ cmd: 'sample_rate', rate_hz: hz });
    });

    document.getElementById('sdr-test-raw-btn')!.addEventListener('click', () => {
        const v = (document.getElementById('sdr-test-raw') as HTMLInputElement).value.trim();
        try {
            const obj = JSON.parse(v);
            testSend(obj);
        } catch (_) {
            testLog('Invalid JSON', 'err');
        }
    });

    document.getElementById('sdr-test-clear-btn')!.addEventListener('click', () => {
        document.getElementById('sdr-test-log')!.innerHTML = '';
    });

    // Allow Enter key in raw input
    document.getElementById('sdr-test-raw')!.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') (document.getElementById('sdr-test-raw-btn') as HTMLButtonElement).click();
    });

    // Expose testLog so sdr-boot can log incoming messages to it
    (window as any)._sdrTestLog = testLog;

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

    function toggle() {
        if (_visible) hide(); else show();
    }

    function isVisible() { return _visible; }

    function refresh(groups: SdrFrequencyGroup[], freqs: SdrStoredFrequency[]) {
        _groups = groups;
        _freqs  = freqs;
        renderGroups();
        renderFreqs();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    window._SdrPanel = { show, hide, toggle, isVisible, refresh, setScanStatus };

    // ── Expose reloadData for external use (add-freq button) ─────────────────

    (window as any)._sdrPanelReload = reloadData;

    // Initial load
    reloadData();
})();
