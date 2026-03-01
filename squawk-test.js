// =============================================================================
// squawk-test.js — ADS-B emergency squawk dev tests
// Load via DevTools: call window.sqkTest.<functionName>()
// =============================================================================

(() => {
    const MOCK_LAT  = 51.5;
    const MOCK_LON  = -0.1;
    let _origFetch  = null;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _adsb() {
        const ctrl = window._adsb;
        if (!ctrl) throw new Error('window._adsb not found — make sure main.js is loaded');
        return ctrl;
    }

    /** Replace window.fetch with one that returns a fixed aircraft array */
    function _mockFetch(acArray) {
        if (!_origFetch) _origFetch = window.fetch;
        window.fetch = (url, opts) => {
            if (url.includes('airplanes.live')) {
                return Promise.resolve(new Response(JSON.stringify({ ac: acArray })));
            }
            return _origFetch(url, opts);
        };
    }

    /** Restore the real fetch and clear squawk state */
    function _restore() {
        if (_origFetch) {
            window.fetch = _origFetch;
            _origFetch = null;
        }
    }

    /** Build a minimal aircraft object */
    function _aircraft(overrides = {}) {
        return Object.assign({
            hex:      'test01',
            flight:   'TEST001',
            r:        'G-TEST',
            squawk:   '1200',
            alt_baro: 25000,
            gs:       450,
            track:    90,
            lat:      MOCK_LAT,
            lon:      MOCK_LON,
        }, overrides);
    }

    // -------------------------------------------------------------------------
    // Public test functions
    // -------------------------------------------------------------------------

    const sqkTest = {

        /**
         * Test entering a single emergency squawk code.
         * Usage: sqkTest.enterEmergency('7700')
         *        sqkTest.enterEmergency('7600')
         *        sqkTest.enterEmergency('7500')
         */
        enterEmergency(squawk = '7700') {
            const ctrl = _adsb();
            // Clear any previous state for this hex so the notification fires fresh
            delete ctrl._prevSquawk['test01'];
            _mockFetch([_aircraft({ squawk })]);
            console.log(`[sqkTest] Mocked fetch with squawk ${squawk} — next poll will trigger EMERGENCY notification`);
            console.log('[sqkTest] Poll runs every 5 s. Call sqkTest.restore() when done.');
        },

        /**
         * Test clearing an emergency — fires the SQUAWK CLEARED notification.
         * Call this after enterEmergency() has run at least one poll cycle.
         */
        clearEmergency(newSquawk = '1200') {
            _mockFetch([_aircraft({ squawk: newSquawk })]);
            console.log(`[sqkTest] Squawk changed to ${newSquawk} — next poll will trigger SQUAWK CLEARED notification`);
        },

        /**
         * Full end-to-end flow: emergency → wait → clear.
         * @param {string} squawk   Emergency code (7700/7600/7500)
         * @param {number} holdMs   How long to hold the emergency before clearing (default 8 s)
         */
        fullFlow(squawk = '7700', holdMs = 8000) {
            const ctrl = _adsb();
            delete ctrl._prevSquawk['test01'];

            console.log(`[sqkTest] Step 1 — entering emergency squawk ${squawk}`);
            _mockFetch([_aircraft({ squawk })]);

            setTimeout(() => {
                console.log('[sqkTest] Step 2 — clearing emergency, squawk → 1200');
                _mockFetch([_aircraft({ squawk: '1200' })]);

                // Auto-restore real fetch after one more poll cycle
                setTimeout(() => sqkTest.restore(), 6000);
            }, holdMs);
        },

        /**
         * Fire all three emergency codes in sequence, one per poll cycle.
         */
        allCodes() {
            const ctrl = _adsb();
            const codes = ['7700', '7600', '7500'];
            codes.forEach((code, i) => {
                setTimeout(() => {
                    // Use a distinct hex per code so each fires independently
                    const hex = `test0${i + 1}`;
                    delete ctrl._prevSquawk[hex];
                    _mockFetch(codes.map((c, j) => _aircraft({
                        hex:    `test0${j + 1}`,
                        flight: `EMRG${c}`,
                        squawk: j <= i ? c : '1200',
                        lat:    MOCK_LAT + j * 0.15,
                        lon:    MOCK_LON + j * 0.15,
                    })));
                    console.log(`[sqkTest] Added squawk ${code} (hex ${hex})`);
                }, i * 6000);
            });
            console.log('[sqkTest] allCodes: will fire 7700 → 7600 → 7500 over ~12 s');
        },

        /**
         * Restore real fetch and clear test squawk state.
         * Always call this when you are done testing.
         */
        restore() {
            _restore();
            const ctrl = _adsb();
            // Remove test hex entries from squawk state
            ['test01', 'test02', 'test03'].forEach(h => delete ctrl._prevSquawk[h]);
            console.log('[sqkTest] Restored real fetch. Test state cleared.');
        },

        /**
         * Show current internal squawk tracking state.
         */
        status() {
            const ctrl = _adsb();
            console.table(ctrl._prevSquawk);
            const emergs = ctrl._geojson.features
                .filter(f => f.properties.squawkEmerg === 1)
                .map(f => ({ hex: f.properties.hex, flight: f.properties.flight, squawk: f.properties.squawk }));
            console.log(`[sqkTest] Active emergency aircraft: ${emergs.length}`);
            if (emergs.length) console.table(emergs);
        },

        help() {
            console.log([
                '',
                '  sqkTest.enterEmergency("7700")    — trigger EMERGENCY notification (7700/7600/7500)',
                '  sqkTest.clearEmergency("1200")    — trigger SQUAWK CLEARED notification',
                '  sqkTest.fullFlow("7700", 8000)    — full enter→clear flow (holds 8 s by default)',
                '  sqkTest.allCodes()                — fire all three emergency codes in sequence',
                '  sqkTest.status()                  — show current squawk tracking state',
                '  sqkTest.restore()                 — restore real fetch, clean up test state',
                '',
                '  Polls run every 5 s automatically — you don\'t need to call anything after mocking.',
                '',
            ].join('\n'));
        },
    };

    window.sqkTest = sqkTest;
    console.log('[sqkTest] Loaded. Call sqkTest.help() for available commands.');
})();
