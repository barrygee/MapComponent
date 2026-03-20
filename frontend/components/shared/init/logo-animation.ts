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
    if (!logoSvg || !logoTextEl || !logoPinEl || !logoSEl) return;

    let typeTimer:  ReturnType<typeof setTimeout>  | null = null;
    let blinkTimer: ReturnType<typeof setInterval> | null = null;

    function playLogoAnimation(): void {
        if (typeTimer)  clearTimeout(typeTimer);
        if (blinkTimer) clearInterval(blinkTimer);
        logoTextEl!.textContent = '';
        (logoPinEl as SVGElement).setAttribute('opacity', '0');
        (logoSEl as SVGElement).setAttribute('opacity', '0');
        logoSEl!.textContent = '';

        const WORD = 'SENTINEL ';
        let i = 0;

        function typeNextChar(): void {
            if (i < WORD.length) {
                logoTextEl!.textContent = WORD.slice(0, ++i) + '|';
                typeTimer = setTimeout(typeNextChar, 75);
            } else {
                // Finish SENTINEL, reveal pin and S
                logoTextEl!.textContent = WORD;
                (logoPinEl as SVGElement).setAttribute('opacity', '1');
                logoSEl!.textContent = 'S';
                (logoSEl as SVGElement).setAttribute('opacity', '1');

                // Blink cursor after S
                let blinks = 0;
                blinkTimer = setInterval(() => {
                    blinks++;
                    logoSEl!.textContent = blinks % 2 === 0 ? 'S|' : 'S ';
                    if (blinks >= 6) {
                        clearInterval(blinkTimer!);
                        logoSEl!.textContent = 'S';
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
