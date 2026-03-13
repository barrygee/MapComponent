"use strict";
// ============================================================
// DOMAIN STATUS — calls the backend status endpoint for the
// current domain and shows a "coming soon" banner when the
// domain is not yet implemented.
//
// Reads: document.body.dataset.domain  (e.g. "sea", "land", "space")
// Calls: GET /api/{domain}/status
// ============================================================

(function () {
    const domain = document.body.dataset.domain;
    if (!domain) return;

    fetch(`/api/${domain}/status`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || data.status !== 'not_implemented') return;
            const banner = document.createElement('div');
            banner.id = 'domain-status-banner';
            banner.innerHTML =
                `<span class="domain-status-label">${domain.toUpperCase()}</span>` +
                `<span class="domain-status-msg">COMING SOON</span>`;
            document.body.appendChild(banner);
        })
        .catch(() => { /* backend unavailable — show nothing */ });
})();
