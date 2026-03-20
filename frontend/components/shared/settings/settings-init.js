"use strict";
// ============================================================
// SETTINGS PANEL INITIALISATION
// Waits for DOMContentLoaded then calls _SettingsPanel.init()
// if the panel has been registered as a global.
// ============================================================
/// <reference path="../globals.d.ts" />
document.addEventListener('DOMContentLoaded', function () {
    if (window._SettingsPanel)
        window._SettingsPanel.init();
});
