"use strict";
// ============================================================
// SETTINGS PANEL INITIALISATION
// Waits for DOMContentLoaded then calls _SettingsPanel.init()
// if the panel has been registered as a global.
// ============================================================
/// <reference path="../globals.d.ts" />
document.addEventListener('DOMContentLoaded', function () {
    if (!window._SettingsPanel)
        return;
    window._SettingsPanel.init();
    try {
        if (sessionStorage.getItem('sentinel_panel') === 'settings') {
            var section = sessionStorage.getItem('sentinel_settings_section') || 'app';
            window._SettingsPanel.openSection(section);
        }
    } catch (e) { }
});
