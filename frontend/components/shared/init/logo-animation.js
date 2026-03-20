"use strict";
// ============================================================
// LOGO ANIMATION
// Types "SENTINEL " into the SVG text element, then reveals
// the location-pin O and the trailing "S" for "SENTINEL OS".
// Plays once on load and replays on click.
// Shared across all domains.
// ============================================================
/// <reference path="../globals.d.ts" />
(function () {
    const logoSvg    = document.getElementById('logo-img');
    const logoTextEl = document.getElementById('logo-text-el');
    const logoPinEl  = document.getElementById('logo-pin');
    const logoSEl    = document.getElementById('logo-s-el');
    if (!logoSvg || !logoTextEl || !logoPinEl || !logoSEl)
        return;
    let typeTimer  = null;
    let blinkTimer = null;
    function playLogoAnimation() {
        if (typeTimer)
            clearTimeout(typeTimer);
        if (blinkTimer)
            clearInterval(blinkTimer);
        logoTextEl.textContent = '';
        logoPinEl.setAttribute('opacity', '0');
        logoSEl.setAttribute('opacity', '0');
        logoSEl.textContent = '';
        const WORD = 'SENTINEL ';
        let i = 0;
        function typeNextChar() {
            if (i < WORD.length) {
                logoTextEl.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNextChar, 75);
            }
            else {
                logoTextEl.textContent = WORD;
                logoPinEl.setAttribute('opacity', '1');
                logoSEl.textContent = 'S';
                logoSEl.setAttribute('opacity', '1');
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoSEl.textContent = blinks % 2 === 0 ? 'S|' : 'S ';
                    if (blinks >= 6) {
                        clearInterval(blinkTimer);
                        logoSEl.textContent = 'S';
                    }
                }, 300);
            }
        }
        typeTimer = setTimeout(typeNextChar, 1250);
    }
    playLogoAnimation();
    logoSvg.style.cursor = 'pointer';
    logoSvg.addEventListener('click', playLogoAnimation);
})();
