// ============================================================
// SHELL — Shared header + footer component
// Injects the #nav header and #footer HTML into the page.
//
// Usage on section pages:
//   <body data-domain="space">
//     <header id="nav"></header>
//     <footer id="footer"></footer>
//     <script src="./frontend/app/shell/shell.js"></script>
//   </body>
//
// The active nav link is determined by document.body.dataset.domain
// (one of: "air" | "space" | "sea" | "land").
//
// Dispatches a 'shell:ready' CustomEvent on document when complete,
// so other scripts can safely depend on the injected DOM elements.
//
// NOTE: On index.html (the existing AIR page), shell.js is NOT loaded —
// the header/footer HTML is already static in the page. Shell is used
// only by new section pages (space.html, sea.html, land.html).
// ============================================================

(function () {
    const domain = (document.body.dataset.domain || 'air').toLowerCase();

    function navLink(href, dataDomain, label) {
        const active = dataDomain === domain ? ' nav-link--active' : '';
        return `<a href="${href}" class="nav-link${active}" data-domain="${dataDomain}">${label}</a>`;
    }

    const headerHTML =
        `<div id="nav-logo">` +
            `<svg id="logo-img" viewBox="0 0 410 60" xmlns="http://www.w3.org/2000/svg" aria-label="SENTINEL" overflow="visible">` +
                `<svg x="0" y="10" width="40" height="40" viewBox="14 15 32 30">` +
                    `<rect class="logo-bg" x="16" y="17" width="28" height="26" fill="#c8ff00" fill-opacity="0"/>` +
                    `<polyline class="logo-corner" points="21,17 16,17 16,22" fill="none" stroke="white" stroke-width="3" stroke-linecap="square"/>` +
                    `<polyline class="logo-corner" points="39,17 44,17 44,22" fill="none" stroke="white" stroke-width="3" stroke-linecap="square"/>` +
                    `<polyline class="logo-corner" points="21,43 16,43 16,38" fill="none" stroke="white" stroke-width="3" stroke-linecap="square"/>` +
                    `<polyline class="logo-corner" points="39,43 44,43 44,38" fill="none" stroke="white" stroke-width="3" stroke-linecap="square"/>` +
                    `<rect class="logo-dot" x="28" y="28" width="4" height="4" fill="white"/>` +
                `</svg>` +
                `<text id="logo-text-el" x="68" y="43" font-family="'Barlow', 'Helvetica Neue', Arial, sans-serif" font-weight="400" font-size="36" letter-spacing="4" fill="white"></text>` +
            `</svg>` +
        `</div>` +
        `<nav id="nav-right">` +
            navLink('/air',   'air',   'AIR')   +
            navLink('/space', 'space', 'SPACE') +
            navLink('/sea',   'sea',   'SEA')   +
            navLink('/land',  'land',  'LAND')  +
        `</nav>`;

    const footerHTML =
        `<div id="footer-left">` +
            `<button id="notif-toggle-btn" aria-label="Toggle notifications" data-tooltip="NOTIFICATIONS">` +
                `<svg id="notif-icon" width="17" height="17" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
                    `<path d="M6.5 1C4.015 1 2 3.015 2 5.5V9H1v1h11V9h-1V5.5C11 3.015 8.985 1 6.5 1Z" fill="currentColor" fill-opacity="1"/>` +
                    `<path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1" fill="none"/>` +
                `</svg>` +
                `<span id="notif-count"></span>` +
            `</button>` +
            `<button id="tracking-toggle-btn" aria-label="Toggle tracking" data-tooltip="TRACKING">` +
                `<svg id="tracking-icon" width="17" height="17" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
                    `<circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.4"/>` +
                    `<circle cx="6.5" cy="6.5" r="2" fill="currentColor"/>` +
                    `<line x1="6.5" y1="1" x2="6.5" y2="2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>` +
                    `<line x1="6.5" y1="10.5" x2="6.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>` +
                    `<line x1="1" y1="6.5" x2="2.5" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>` +
                    `<line x1="10.5" y1="6.5" x2="12" y2="6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>` +
                `</svg>` +
                `<span id="tracking-count"></span>` +
            `</button>` +
        `</div>` +
        `<div id="footer-right">` +
            `<span id="conn-status" class="conn-checking">—</span>` +
            `<span id="footer-location" class="footer-label">UNITED KINGDOM</span>` +
        `</div>`;

    // Inject into existing containers, or create them if missing
    let navEl = document.getElementById('nav');
    if (!navEl) {
        navEl = document.createElement('header');
        navEl.id = 'nav';
        document.body.prepend(navEl);
    }
    navEl.innerHTML = headerHTML;

    let footerEl = document.getElementById('footer');
    if (!footerEl) {
        footerEl = document.createElement('footer');
        footerEl.id = 'footer';
        document.body.appendChild(footerEl);
    }
    footerEl.innerHTML = footerHTML;

    // Notify other scripts that shell DOM is ready
    document.dispatchEvent(new CustomEvent('shell:ready', { detail: { domain } }));
})();
