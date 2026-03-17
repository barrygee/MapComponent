"use strict";
/**
 * settings-api.ts — shared client for the /api/settings REST endpoints.
 *
 * All methods are fire-and-forget safe: errors are swallowed silently so a
 * backend hiccup never breaks the UI. Load this script before any overlay-state
 * or settings files that call window._SettingsAPI.
 */
/// <reference path="../../../globals.d.ts" />
window._SettingsAPI = (function () {
    const BASE = '/api/settings';
    /**
     * Fetch all settings for a namespace.
     * @param ns  e.g. 'air', 'space', 'app'
     * @returns parsed key/value map, or null on error
     */
    async function getNamespace(ns) {
        try {
            const res = await fetch(`${BASE}/${ns}`);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch (e) {
            console.warn('[SettingsAPI] getNamespace failed:', e);
            return null;
        }
    }
    /**
     * Upsert a single setting.
     * @param ns     namespace e.g. 'air'
     * @param key    e.g. 'overlayStates'
     * @param value  any JSON-serialisable value
     */
    async function put(ns, key, value) {
        try {
            await fetch(`${BASE}/${ns}/${key}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
        }
        catch (e) {
            console.warn('[SettingsAPI] put failed:', e);
        }
    }
    return { getNamespace, put };
})();
