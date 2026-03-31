// ============================================================
// SDR GLOBALS
// Module-level mutable state shared across all SDR components.
// Mirrors the pattern used by space-globals.ts.
// ============================================================

/// <reference path="./globals.d.ts" />

// @ts-ignore — globals declared in globals.d.ts; initialised here
var _sdrSocket: WebSocket | null = null; // eslint-disable-line
// @ts-ignore
var _sdrConnected: boolean = false;
// @ts-ignore
var _sdrCurrentFreqHz: number = 100_000_000;
// @ts-ignore
var _sdrCurrentMode: string = 'AM';
// @ts-ignore
var _sdrCurrentGain: number = 30.0;
// @ts-ignore
var _sdrCurrentGainAuto: boolean = false;
// @ts-ignore
var _sdrCurrentSquelch: number = -60.0;
// @ts-ignore
var _sdrCurrentRadioId: number | null = null;
// @ts-ignore
var _sdrCurrentSampleRate: number = 2_048_000;
// @ts-ignore
var _sdrScanActive: boolean = false;
// @ts-ignore
var _sdrScanLocked: boolean = false;
