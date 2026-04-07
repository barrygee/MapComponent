"use strict";
// ============================================================
// SDR GLOBALS
// Module-level mutable state shared across all SDR components.
// Mirrors the pattern used by space-globals.ts.
// ============================================================
/// <reference path="./globals.d.ts" />
// @ts-ignore — globals declared in globals.d.ts; initialised here
var _sdrSocket = null; // eslint-disable-line
// @ts-ignore
var _sdrConnected = false;
// @ts-ignore
var _sdrCurrentFreqHz = 100000000;
// @ts-ignore
var _sdrCurrentMode = 'AM';
// @ts-ignore
var _sdrCurrentGain = 30.0;
// @ts-ignore
var _sdrCurrentGainAuto = false;
// @ts-ignore
var _sdrCurrentSquelch = -60.0;
// @ts-ignore
var _sdrCurrentRadioId = null;
// @ts-ignore
var _sdrCurrentSampleRate = 2048000;
// @ts-ignore
var _sdrCurrentBwHz = 10000;
// @ts-ignore
var _sdrScanActive = false;
// @ts-ignore
var _sdrScanLocked = false;
// @ts-ignore
var _sdrPlaying = false;
