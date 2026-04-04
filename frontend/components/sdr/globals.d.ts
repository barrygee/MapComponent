/// <reference path="../../globals.d.ts" />

// ── SDR data types ────────────────────────────────────────────────────────────

interface SdrRadio {
    id: number;
    name: string;
    host: string;
    port: number;
    description: string;
    enabled: boolean;
    bandwidth:  number | null;
    rf_gain:    number | null;
    agc:        boolean | null;
    created_at: number;
}

interface SdrFrequencyGroup {
    id: number;
    name: string;
    color: string;
    sort_order: number;
    created_at: number;
}

interface SdrStoredFrequency {
    id: number;
    group_ids: number[];
    label: string;
    frequency_hz: number;
    mode: string;
    squelch: number;
    gain: number;
    scannable: boolean;
    notes: string;
    created_at: number;
}

interface SdrStatusMsg {
    type: 'status';
    connected: boolean;
    radio_id: number;
    radio_name: string;
    center_hz: number;
    sample_rate: number;
    mode: string;
    gain_db: number;
    gain_auto: boolean;
}

interface SdrErrorMsg {
    type: 'error';
    code: string;
    message: string;
}

// ── SDR mutable globals (declared in sdr-globals.ts) ─────────────────────────

declare let _sdrSocket: WebSocket | null;
declare let _sdrConnected: boolean;
declare let _sdrCurrentFreqHz: number;
declare let _sdrCurrentMode: string;
declare let _sdrCurrentGain: number;
declare let _sdrCurrentGainAuto: boolean;
declare let _sdrCurrentSquelch: number;
declare let _sdrCurrentRadioId: number | null;
declare let _sdrCurrentSampleRate: number;
declare let _sdrCurrentBwHz: number;
declare let _sdrScanActive: boolean;
declare let _sdrScanLocked: boolean;

// ── SDR component public APIs ─────────────────────────────────────────────────

interface SdrControlsAPI {
    setStatus(connected: boolean): void;
    applyStatus(msg: SdrStatusMsg): void;
    getSelectedRadioId(): number | null;
    updateSignalBar(dbfs: number): void;
}

interface SdrPanelAPI {
    show(): void;
    hide(): void;
    toggle(): void;
    isVisible(): boolean;
    refresh(groups: SdrFrequencyGroup[], freqs: SdrStoredFrequency[]): void;
    setScanStatus(active: boolean, currentHz: number | null): void;
}

interface SdrAudioAPI {
    start(radioId?: number): Promise<void>;
    initAudio(radioId?: number): Promise<void>;
    stop(): void;
    setRadioId(id: number): void;
    setMode(mode: string): void;
    setSquelch(dbfs: number): void;
    setVolume(v: number): void;
    setBandwidthHz(hz: number): void;
}

// ── Extend Window ─────────────────────────────────────────────────────────────

interface Window {
    _SdrControls: SdrControlsAPI;
    _SdrPanel:    SdrPanelAPI;
    _SdrAudio:    SdrAudioAPI;
}
