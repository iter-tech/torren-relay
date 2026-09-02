// NO clicks, NO booking, NO Layout B, NO scrolling, NO sound.
// Only adds/removes a CSS class on load-card elements. Not wired to refresh loop yet.

function injectHighlightStyle() {
  if (document.getElementById('ext-highlight-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-highlight-style';
  style.textContent =
    '.ext-new-load{' +
      'background-color:var(--ext-accent-bg) !important;' +
      'box-shadow:inset 4px 0 0 0 var(--ext-accent);' +
    '}';
  document.head.appendChild(style);
}

// 2026-08-31 — gated on the ONE page check. This ran at module load on EVERY Relay page, so the
// highlight CSS was in the <head> of the Dashboard too. Inert without our elements, but it is
// still markup we put on a page we have no business touching.
if (typeof isLoadBoardPage === 'function' && isLoadBoardPage()) injectHighlightStyle();

function highlightNewLoads(newLoads) {
  logger.log('highlighter', 'highlightNewLoads called', { count: newLoads.length });

  var applied = 0;
  newLoads.forEach(function (load) {
    if (!load._element) return;
    load._element.classList.add('ext-new-load');
    applied++;
  });

  logger.log('highlighter', 'highlights applied', { applied: applied });
}

function clearHighlights() {
  logger.log('highlighter', 'clearHighlights called');
  var highlighted = document.querySelectorAll('.ext-new-load');
  highlighted.forEach(function (el) {
    el.classList.remove('ext-new-load');
  });
  logger.log('highlighter', 'highlights cleared', { cleared: highlighted.length });
}

// Expose for manual console testing only — NOT called automatically.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.highlightNew = function () {
  var r = detectNewLoads(parseLoads());
  highlightNewLoads(r.newLoads);
  return r.newCount;
};
window.__EXT_DEBUG.clearHighlights = clearHighlights;
