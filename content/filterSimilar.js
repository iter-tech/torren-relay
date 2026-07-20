// content/filterSimilar.js
// "Hide Similar Matches" — hides Amazon's entire "Similar matches" section with
// ZERO flicker.
//
// CONFIRMED STRUCTURE (live DOM):
//   div(outer)                         <- section wrapper
//     p  "Similar matches (4)"         <- heading, DIRECT child
//     div > div.load-list              <- similar cards
//     button "Show more"               <- DIRECT child
//
// FLICKER ROOT CAUSE: a JS observer tags the wrapper only AFTER Amazon paints
// it, so the block flashes for a moment on each auto-refresh.
//
// FIX: a pure-CSS :has() rule hides the wrapper whose DIRECT-CHILD <p> text is
// "Similar matches…". CSS :has() is evaluated at style time, before paint, with
// NO JS round-trip -> nothing flashes. The rule is scoped precisely:
//   div:has(> p) whose <p> starts with "Similar matches"
// Plain CSS cannot match on text, so we still need JS ONCE to mark the heading
// <p> with a stable data-attribute the CSS can target. We mark the <p> as early
// as possible AND keep it marked; the CSS does the actual (synchronous) hiding
// of the parent via :has(). Because the parent is hidden by a style rule keyed
// to the child marker, re-renders that recreate the block are caught the moment
// the <p> is re-marked — and we re-mark synchronously inside the observer.
//
// Net: the SECTION is hidden by :has() (pre-paint) as long as the heading <p>
// carries the marker. DOM hide only — NO clicks, NO parsing changes.

var PMARK = 'data-ext-similar-head';
var SIMILAR_STYLE_ID = 'ext-hide-similar-style';
var SIMILAR_HTML_CLASS = 'ext-hide-similar';
var similarObserver = null;

function ensureSimilarStyle() {
  if (document.getElementById(SIMILAR_STYLE_ID)) return;
  var style = document.createElement('style');
  style.id = SIMILAR_STYLE_ID;
  style.setAttribute('data-testid', SIMILAR_STYLE_ID);
  // Hide the section wrapper that has a direct-child marked heading <p>.
  // Also hide a marked heading that is a bare child (defensive).
  // Gated by html.ext-hide-similar so it only applies when the feature is ON.
  style.textContent =
    'html.' + SIMILAR_HTML_CLASS + ' :has(> [' + PMARK + ']){display:none !important;}' +
    'html.' + SIMILAR_HTML_CLASS + ' [' + PMARK + ']{display:none !important;}';
  (document.head || document.documentElement).appendChild(style);
}

// Mark every heading <p> whose OWN text starts with "Similar matches".
// Idempotent; safe to call on every mutation.
function markHeadings() {
  var nodes = document.querySelectorAll('p');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.getAttribute(PMARK)) continue;
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^Similar matches\b/i.test(t)) el.setAttribute(PMARK, '1');
  }
}

function unmarkAll() {
  var marked = document.querySelectorAll('[' + PMARK + ']');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(PMARK);
}

function enableHideSimilar() {
  ensureSimilarStyle();
  document.documentElement.classList.add(SIMILAR_HTML_CLASS);
  markHeadings();
  if (similarObserver) return;
  // Re-mark synchronously on DOM changes (no debounce) so the marker is present
  // before the browser paints the re-rendered section.
  similarObserver = new MutationObserver(function () {
    markHeadings();
  });
  similarObserver.observe(document.body, { childList: true, subtree: true });
  logger.log('filterSimilar', 'enabled');
}

function disableHideSimilar() {
  document.documentElement.classList.remove(SIMILAR_HTML_CLASS);
  if (similarObserver) { similarObserver.disconnect(); similarObserver = null; }
  unmarkAll();
  logger.log('filterSimilar', 'disabled');
}

function applyHideSimilar(on) {
  if (on) enableHideSimilar(); else disableHideSimilar();
}

// See utils/authGate.js — features require an active session. Guards the live
// onChanged listener below too, not just the startup apply. Set by
// activate/deactivateFilterSimilar (idempotent), called both at startup and on live
// login/logout (onAuthGateChange, TASK 1 2026-07-20).
var _hideSimilarAuthed = false;

function activateFilterSimilar() {
  if (_hideSimilarAuthed) return;
  _hideSimilarAuthed = true;
  storage.get(STORAGE_KEYS.HIDE_SIMILAR, false).then(function (on) {
    applyHideSimilar(on === true);
  }).catch(function (e) {
    logger.warn('filterSimilar', 'activateFilterSimilar failed', { error: e });
  });
}

// Reverts to fully untouched — disables the feature AND removes the injected <style>
// tag entirely, not just the html class.
function deactivateFilterSimilar() {
  if (!_hideSimilarAuthed) return;
  _hideSimilarAuthed = false;
  applyHideSimilar(false);
  var style = document.getElementById(SIMILAR_STYLE_ID);
  if (style) style.remove();
  logger.log('filterSimilar', 'deactivated — session ended, reverted to untouched page');
}

(async function initHideSimilar() {
  try {
    var gate = await getAuthGate();
    if (gate.active) activateFilterSimilar();
  } catch (e) {
    logger.warn('filterSimilar', 'init failed', { error: e });
  }
})();

if (typeof onAuthGateChange === 'function') {
  onAuthGateChange(function (gate) {
    if (gate.active) activateFilterSimilar(); else deactivateFilterSimilar();
  });
}

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!_hideSimilarAuthed) return;
  if (!changes[STORAGE_KEYS.HIDE_SIMILAR]) return;
  applyHideSimilar(changes[STORAGE_KEYS.HIDE_SIMILAR].newValue === true);
});

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.toggleHideSimilar = function () {
  var on = !document.documentElement.classList.contains(SIMILAR_HTML_CLASS);
  applyHideSimilar(on);
  storage.set(STORAGE_KEYS.HIDE_SIMILAR, on);
  return on;
};
