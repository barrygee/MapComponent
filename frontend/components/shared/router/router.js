"use strict";
// ============================================================
// SPA ROUTER
// Intercepts nav-link clicks and popstate events to navigate
// between domains without a full page reload.
//
// On each transition:
//   1. Calls window._domainTeardown() on the leaving domain
//   2. Updates DOM visibility and body[data-domain]
//   3. Loads domain scripts once (serial, cached)
//   4. Calls window._domainMount()
//
// Radio audio is never stopped — sdr-audio.js survives transitions.
// ============================================================
(function () {

    // ── Domain script registry (mirrors {% block scripts %} load order) ────────
    var DOMAIN_SCRIPTS = {
        air: [
            '/frontend/components/air/init/air-globals.js',
            '/frontend/components/air/overlay/overlay-state.js',
            '/frontend/components/air/init/map-alias.js',
            '/frontend/components/air/controls/sentinel-control-base/sentinel-control-base.js',
            '/frontend/components/air/controls/roads/roads.js',
            '/frontend/components/air/controls/reset-view/reset-view.js',
            '/frontend/components/air/controls/airports/airports.js',
            '/frontend/components/air/controls/military-bases/military-bases.js',
            '/frontend/components/air/controls/names/names.js',
            '/frontend/components/air/controls/range-rings/range-rings.js',
            '/frontend/components/air/controls/aara/aara.js',
            '/frontend/components/air/controls/awacs/awacs.js',
            '/frontend/components/air/controls/adsb/adsb.js',
            '/frontend/components/air/controls/adsb-labels/adsb-labels.js',
            '/frontend/components/air/controls/clear-overlays/clear-overlays.js',
            '/frontend/components/air/init/overlay-reinit.js',
            '/frontend/components/air/overlay/side-menu.js',
            '/frontend/components/air/air-filter/air-filter.js',
            '/frontend/components/air/user-location/user-location.js',
            '/frontend/components/air/init/boot.js',
            '/frontend/assets/template.js',
        ],
        space: [
            '/frontend/components/space/init/space-globals.js',
            '/frontend/components/space/overlay/space-overlay-state.js',
            '/frontend/components/space/init/space-map-alias.js',
            '/frontend/components/air/controls/sentinel-control-base/sentinel-control-base.js',
            '/frontend/components/space/controls/daynight/daynight-control.js',
            '/frontend/components/space/controls/iss/iss-control.js',
            '/frontend/components/space/controls/names/space-names-control.js',
            '/frontend/components/space/init/space-overlay-reinit.js',
            '/frontend/components/space/user-location/space-user-location.js',
            '/frontend/components/space/overlay/space-side-menu.js',
            '/frontend/components/space/space-filter/space-filter.js',
            '/frontend/components/space/passes/space-passes.js',
            '/frontend/components/space/sat-info/sat-info-panel.js',
            '/frontend/components/space/init/space-boot.js',
        ],
        sea:  ['/frontend/assets/template.js'],
        land: ['/frontend/assets/template.js'],
        sdr:  ['/frontend/components/sdr/sdr-boot.js'],
    };

    // Map domains use #map; SDR uses #sdr-root
    var MAP_DOMAINS = { air: true, space: true, sea: true, land: true };

    // Scripts loaded at least once — never re-injected
    var _loadedScripts = new Set();
    // Domains whose full script list has been loaded
    var _loadedDomains = new Set();

    // Per-domain mount/teardown registry — boot files register here instead of
    // overwriting window._domainMount, which breaks when scripts only load once.
    var _domainHandlers = {};

    // Boot files call this to register their handlers.
    window._registerDomain = function (domain, mount, teardown) {
        _domainHandlers[domain] = { mount: mount, teardown: teardown };
    };

    // sea/land share template.js with air (which only executes once).
    // Register minimal handlers for them directly here so they are always correct.
    // _runNoUrlCheck is exposed by template.js on window so the URL overlay works.
    (function () {
        function _seaLandMount() {
            var ns = document.body.dataset.domain;
            if (typeof window._Notifications !== 'undefined') window._Notifications.init();
            if (typeof window._Tracking !== 'undefined') window._Tracking.init();
            if (typeof window._MapSidebar !== 'undefined') window._MapSidebar.init({ trackingEmptyText: 'No tracked contacts' });
            if (ns && typeof window._runNoUrlCheck === 'function') window._runNoUrlCheck(ns);
        }
        function _seaLandTeardown() {
            if (window.MapComponent && window.MapComponent.clearStyleLoadCallbacks) {
                window.MapComponent.clearStyleLoadCallbacks();
            }
        }
        _domainHandlers['sea']  = { mount: _seaLandMount, teardown: _seaLandTeardown };
        _domainHandlers['land'] = { mount: _seaLandMount, teardown: _seaLandTeardown };
    })();

    var _currentDomain = null;

    // ── Script loader: serial, deduped ────────────────────────────────────────
    function _loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (_loadedScripts.has(src)) {
                resolve();
                return;
            }
            _loadedScripts.add(src);
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () {
                console.error('[router] failed to load script:', src);
                reject(new Error('Script load failed: ' + src));
            };
            document.head.appendChild(s);
        });
    }

    async function _loadDomainScripts(domain) {
        if (_loadedDomains.has(domain)) return;
        _loadedDomains.add(domain);
        var scripts = DOMAIN_SCRIPTS[domain] || [];
        for (var i = 0; i < scripts.length; i++) {
            await _loadScript(scripts[i]);
        }
    }

    // ── DOM visibility per domain ─────────────────────────────────────────────
    function _applyDomainVisibility(domain) {
        var mapEl = document.getElementById('map');
        var sdrEl = document.getElementById('sdr-root');
        var starEl = document.getElementById('space-starfield');

        if (mapEl) mapEl.style.display = MAP_DOMAINS[domain] ? '' : 'none';
        if (sdrEl) sdrEl.style.display = domain === 'sdr' ? '' : 'none';
        if (starEl) starEl.style.display = domain === 'space' ? '' : 'none';

        // Hide overlays on domain change; domain mount will show them if needed
        var urlOverlay = document.getElementById('no-url-overlay');
        var tleOverlay = document.getElementById('no-tle-overlay');
        if (urlOverlay) urlOverlay.classList.add('hidden');
        if (tleOverlay) tleOverlay.classList.add('hidden');

        // Update the domain label inside no-url-overlay for the arriving domain
        var domainLabel = document.getElementById('no-url-overlay-domain');
        if (domainLabel) domainLabel.textContent = domain.toUpperCase();

        // Resize map when it becomes visible again (MapLibre needs this after display:none)
        if (MAP_DOMAINS[domain] && window.MapComponent && window.MapComponent.map) {
            setTimeout(function () { window.MapComponent.map.resize(); }, 0);
        }
    }

    // ── Nav link active state ─────────────────────────────────────────────────
    function _updateNavActive(domain) {
        document.querySelectorAll('.nav-link').forEach(function (a) {
            a.classList.toggle('nav-link--active', a.dataset.domain === domain);
        });
    }

    // ── Radio mini button visibility ──────────────────────────────────────────
    function _updateRadioMiniBtn(domain) {
        var btn = document.getElementById('radio-mini-btn');
        if (!btn) return;
        btn.style.display = domain === 'sdr' ? 'none' : '';
    }

    // ── Core transition ───────────────────────────────────────────────────────
    async function _navigateTo(domain, pushState) {
        if (!DOMAIN_SCRIPTS[domain]) {
            console.warn('[router] unknown domain:', domain);
            return;
        }

        // Teardown current domain using the registered handler
        if (_currentDomain && _domainHandlers[_currentDomain] && _domainHandlers[_currentDomain].teardown) {
            try { _domainHandlers[_currentDomain].teardown(); } catch (e) { console.error('[router] teardown error:', e); }
        } else if (_currentDomain && typeof window._domainTeardown === 'function') {
            console.warn('[router] no registered teardown for', _currentDomain, '— falling back to window._domainTeardown');
            try { window._domainTeardown(); } catch (e) { console.error('[router] teardown error:', e); }
        }

        // Update URL
        if (pushState) {
            history.pushState({ domain: domain }, '', '/' + domain + '/');
        }

        // Update body attribute and visibility
        document.body.dataset.domain = domain;
        _applyDomainVisibility(domain);
        _updateNavActive(domain);
        _updateRadioMiniBtn(domain);

        // Load scripts (no-op if already loaded)
        try {
            await _loadDomainScripts(domain);
        } catch (e) {
            console.error('[router] script load error for domain', domain, e);
            return;
        }

        _currentDomain = domain;

        // Mount domain using the registered handler (registered by boot files via _registerDomain)
        if (_domainHandlers[domain] && _domainHandlers[domain].mount) {
            try { _domainHandlers[domain].mount(); } catch (e) { console.error('[router] mount error:', e); }
        } else if (typeof window._domainMount === 'function') {
            try { window._domainMount(); } catch (e) { console.error('[router] mount error:', e); }
        }
    }

    // ── Extract domain from pathname ──────────────────────────────────────────
    function _domainFromPath(pathname) {
        var m = pathname.match(/^\/([a-z]+)\/?/);
        return m ? m[1] : null;
    }

    // ── Intercept nav-link clicks ─────────────────────────────────────────────
    document.addEventListener('click', function (e) {
        var link = e.target.closest('.nav-link');
        if (!link) return;
        var domain = link.dataset.domain;
        if (!domain || !DOMAIN_SCRIPTS[domain]) return;
        if (domain === _currentDomain) return; // already here
        e.preventDefault();
        _navigateTo(domain, true);
    });

    // ── Back/forward ──────────────────────────────────────────────────────────
    window.addEventListener('popstate', function (e) {
        var domain = (e.state && e.state.domain) || _domainFromPath(location.pathname);
        if (domain && domain !== _currentDomain) {
            _navigateTo(domain, false);
        }
    });

    // ── Bootstrap on initial page load ───────────────────────────────────────
    // The server already rendered the correct domain. Scripts self-call _domainMount()
    // at the bottom of each boot file, so we must NOT call it again after loading —
    // that would double-mount. We only need to set up router state and load scripts.
    document.addEventListener('DOMContentLoaded', function () {
        var domain = document.body.dataset.domain || _domainFromPath(location.pathname);
        if (!domain || !DOMAIN_SCRIPTS[domain]) return;

        // Mark initial state in history so popstate can navigate back to it
        history.replaceState({ domain: domain }, '', location.href);

        _currentDomain = domain;
        _applyDomainVisibility(domain);
        _updateNavActive(domain);
        _updateRadioMiniBtn(domain);

        // Load scripts — boot files self-call _domainMount() so we skip it here
        _loadDomainScripts(domain).catch(function (e) {
            console.error('[router] initial script load error:', e);
        });
    });

})();
