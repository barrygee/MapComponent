"use strict";
/* ============================================================
   DOCS PAGE — sidebar active-state via IntersectionObserver
   ============================================================ */
(function () {
    var _navItems = [];
    var _sections = [];

    function _init() {
        _navItems = Array.from(document.querySelectorAll('.docs-nav-item[href^="#"]'));
        _sections = _navItems.map(function (a) {
            return document.getElementById(a.getAttribute('href').slice(1));
        }).filter(Boolean);

        if (_sections.length === 0) return;

        // Track which section is most visible using IntersectionObserver
        var _visible = new Map();

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                _visible.set(entry.target.id, entry.intersectionRatio);
            });
            _updateActive();
        }, {
            root: document.getElementById('docs-body'),
            threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
        });

        _sections.forEach(function (section) { observer.observe(section); });

        // Smooth scroll on nav click
        _navItems.forEach(function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                var target = document.getElementById(a.getAttribute('href').slice(1));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function _updateActive() {
        // Find the section with the highest intersection ratio, or the first
        // section above the viewport mid-point if all ratios are 0
        var best = null;
        var bestRatio = -1;
        _sections.forEach(function (section) {
            var ratio = _visible.get(section.id) || 0;
            if (ratio > bestRatio) {
                bestRatio = ratio;
                best = section;
            }
        });

        // Fall back to topmost visible section
        if (!best) best = _sections[0];

        _navItems.forEach(function (a) {
            var isActive = best && a.getAttribute('href') === '#' + best.id;
            a.classList.toggle('active', !!isActive);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
