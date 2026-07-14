// content/nightMode.js
// Night Mode — elevation-based dark theme over Amazon Relay (CSS-only, idempotent).
// Reads/writes STORAGE_KEYS.NIGHT_MODE. NO Amazon click sites touched — Book is
// only RESTYLED. Surface ramp: base → raised → overlay → high (Material/Apple guidance).
//
// UNCOVERED BLOCKS (no stable selector — noted per spec, not silently added):
//   - Left filter/search panel: Amazon uses hashed CSS classes for the filter column;
//     it currently inherits base bg (transparent → base), which is correct at base level.
//   - Load card hover state: `:hover` on Amazon card classes risks false positives.
//     Cards stay at raised level on hover; no explicit hover-elevation rule added.

var NIGHT_STYLE_ID = 'ext-night-mode-style';

// ── Elevation ramp ────────────────────────────────────────────────────────────
var DK_BASE          = '#16181c';   // page bg — ONLY used here
var DK_RAISED        = '#1e2126';   // cards, nav, footer, filter-area (inherits)
var DK_OVERLAY       = '#262a31';   // selected card, detail sheet, popovers, inline panel
var DK_HIGH          = '#2e333b';   // expanded rows, segment headers, modals
var DK_BORDER        = 'rgba(255,255,255,.09)';
var DK_BORDER_STRONG = 'rgba(255,255,255,.14)';

// ── Text scale ────────────────────────────────────────────────────────────────
var DK_TEXT  = '#e8eaed';   // primary
var DK_MUTED = '#a8b0b9';   // secondary / placeholder
var DK_FAINT = '#6b7480';   // disabled / column-label headers

// ── Accent (matches designTokens.js dark values) ──────────────────────────────
var DK_ACCENT_BG   = '#172236';
var DK_ACCENT_TEXT = '#7aa9ff';
var DK_SUCCESS     = '#37b06f';

// ── Semantic: Book button (unchanged) ─────────────────────────────────────────
var BOOK_BG     = '#146eb4';
var BOOK_TEXT   = '#ffffff';
var BOOK_BORDER = '#1a82d6';

function buildNightCss() {
  return [
    // ── 1. Color scheme hint ──────────────────────────────────────────────────
    'html.ext-night{color-scheme:dark;}',

    // ── 2. Page background (base — darkest layer) ─────────────────────────────
    'html.ext-night,html.ext-night body{background-color:' + DK_BASE + ' !important;}',

    // ── 3. Universal transparent + text reset ─────────────────────────────────
    //    Everything not explicitly elevated → transparent (shows parent surface through).
    //    Text set to primary; element-specific rules below override to secondary/disabled.
    'html.ext-night body *:not(svg):not(path):not(g):not(use):not(img):not(video):not(canvas){' +
      'background-color:transparent !important;' +
      'border-color:' + DK_BORDER + ' !important;' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
    '}',

    // ── 4. RAISED — load cards + card headers ────────────────────────────────
    'html.ext-night .load-card,' +
    'html.ext-night .wo-card-header,' +
    'html.ext-night .wo-card-header--highlighted{' +
      'background-color:' + DK_RAISED + ' !important;' +
      'border-bottom:1px solid ' + DK_BORDER + ' !important;' +
    '}',

    // ── 5. OVERLAY — selected/expanded card (top of frame) ───────────────────
    'html.ext-night .load-card__selected{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border:1px solid ' + DK_BORDER_STRONG + ' !important;' +
      'border-bottom:none !important;' +
      'border-radius:7px 7px 0 0 !important;' +
    '}',

    // ── 6. OVERLAY — Amazon detail panel (right sheet, bottom of frame) ───────
    'html.ext-night #selected-work-sheet{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border:1px solid ' + DK_BORDER_STRONG + ' !important;' +
      'border-top:none !important;' +
      'border-radius:0 0 7px 7px !important;' +
      'padding-bottom:2px !important;' +
    '}',

    // ── 7. HIGH — segment header band inside detail sheet ────────────────────
    // NOTE: .css-1c02o5u is a hashed Amazon class; may drift on Amazon rebuild.
    'html.ext-night #selected-work-sheet .css-1c02o5u{' +
      'background-color:' + DK_HIGH + ' !important;' +
      'border-top:1px solid ' + DK_BORDER + ' !important;' +
      'font-weight:600 !important;' +
    '}',

    // Column-label row in detail sheet — disabled text, no background plate
    'html.ext-night #selected-work-sheet thead,' +
    'html.ext-night #selected-work-sheet thead tr,' +
    'html.ext-night #selected-work-sheet th{' +
      'background-color:transparent !important;' +
      'color:' + DK_FAINT + ' !important;' +
      '-webkit-text-fill-color:' + DK_FAINT + ' !important;' +
      'font-size:9px !important;font-weight:400 !important;' +
      'text-transform:none !important;letter-spacing:0 !important;' +
      'line-height:1 !important;white-space:nowrap !important;' +
      'padding-top:2px !important;padding-bottom:2px !important;border:none !important;' +
    '}',

    // ── 8. HIGH — stop data rows inside detail sheet ─────────────────────────
    'html.ext-night #selected-work-sheet tbody,' +
    'html.ext-night #selected-work-sheet tbody tr,' +
    'html.ext-night #selected-work-sheet td{' +
      'background-color:' + DK_HIGH + ' !important;' +
    '}',
    'html.ext-night #selected-work-sheet tbody tr{' +
      'border-bottom:1px solid ' + DK_BORDER + ' !important;' +
    '}',
    'html.ext-night #selected-work-sheet td{' +
      'padding-top:9px !important;padding-bottom:9px !important;' +
    '}',

    // ── 9. OUR inline panel — OVERLAY (reads against raised card) ────────────
    'html.ext-night #ext-inline-panel{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border:1px solid ' + DK_BORDER_STRONG + ' !important;' +
      'border-top:none !important;border-radius:0 0 7px 7px !important;' +
    '}',

    // Segment accordion headers — HIGH (one level above overlay panel bg)
    'html.ext-night #ext-inline-panel .ext-seg-header{' +
      'background-color:' + DK_HIGH + ' !important;' +
      'border-top:1px solid ' + DK_BORDER + ' !important;' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
    '}',

    // Stop-number circles — accent tint
    'html.ext-night #ext-inline-panel .ext-stop-num{' +
      'background-color:' + DK_ACCENT_BG + ' !important;' +
      'color:' + DK_ACCENT_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_ACCENT_TEXT + ' !important;' +
    '}',

    // Route arrow — muted, not full primary
    'html.ext-night #ext-inline-panel .ext-route-arrow{' +
      'color:' + DK_MUTED + ' !important;' +
      '-webkit-text-fill-color:' + DK_MUTED + ' !important;' +
    '}',

    // Segment Loaded / Empty status text
    'html.ext-night #ext-inline-panel .ext-seg-loaded{' +
      'color:' + DK_SUCCESS + ' !important;' +
      '-webkit-text-fill-color:' + DK_SUCCESS + ' !important;' +
    '}',
    'html.ext-night #ext-inline-panel .ext-seg-empty{' +
      'color:' + DK_MUTED + ' !important;' +
      '-webkit-text-fill-color:' + DK_MUTED + ' !important;' +
    '}',

    // Column-label row — disabled text, same treatment as Amazon's
    'html.ext-night #ext-inline-panel thead th{' +
      'background-color:transparent !important;' +
      'color:' + DK_FAINT + ' !important;' +
      '-webkit-text-fill-color:' + DK_FAINT + ' !important;' +
      'font-size:9px !important;font-weight:400 !important;' +
      'text-transform:none !important;letter-spacing:0 !important;' +
      'line-height:1 !important;white-space:nowrap !important;' +
      'padding-top:2px !important;padding-bottom:2px !important;border:none !important;' +
    '}',

    // Stop data rows — HIGH (one step above overlay panel bg)
    'html.ext-night #ext-inline-panel tbody td{' +
      'background-color:' + DK_HIGH + ' !important;' +
    '}',
    'html.ext-night #ext-inline-panel tbody tr{' +
      'border-bottom:1px solid ' + DK_BORDER + ' !important;' +
    '}',

    // Loaded/empty status dots
    'html.ext-night #ext-inline-panel .ext-dot-loaded{background-color:' + DK_TEXT + ' !important;}',
    'html.ext-night #ext-inline-panel .ext-dot-empty{border-color:' + DK_TEXT + ' !important;}',

    // Action bar — sits at overlay level (flush with panel bg)
    'html.ext-night #ext-inline-panel .ext-action-bar{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border-top:1px solid ' + DK_BORDER + ' !important;' +
    '}',
    // Action buttons — muted icon color, hover gains high bg
    'html.ext-night #ext-inline-panel .ext-action-btn{' +
      'color:' + DK_MUTED + ' !important;' +
      '-webkit-text-fill-color:' + DK_MUTED + ' !important;' +
    '}',
    'html.ext-night #ext-inline-panel .ext-action-btn:hover{' +
      'background-color:' + DK_HIGH + ' !important;' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
    '}',

    // Icon dot colors (Font Awesome circles in detail rows)
    'html.ext-night #ext-inline-panel i.fa-circle,' +
    'html.ext-night #ext-inline-panel i.fa-circle-o{' +
      'color:' + DK_TEXT + ' !important;' +
    '}',

    // ── 10. RAISED — footer / utility bar ────────────────────────────────────
    'html.ext-night #utility-bar,' +
    'html.ext-night .utility-bar__default,' +
    'html.ext-night [class*="utility-bar" i]{' +
      'background-color:' + DK_RAISED + ' !important;' +
      'border-top:1px solid ' + DK_BORDER + ' !important;' +
    '}',
    'html.ext-night #utility-bar *{background-color:transparent !important;}',

    // ── 11. RAISED — inputs / selects / form fields (strong border) ──────────
    'html.ext-night input,' +
    'html.ext-night textarea,' +
    'html.ext-night select{' +
      'background-color:' + DK_RAISED + ' !important;' +
      'background-image:none !important;' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
      'border:1px solid ' + DK_BORDER_STRONG + ' !important;' +
      'outline:none !important;box-shadow:none !important;' +
    '}',
    'html.ext-night input::placeholder,' +
    'html.ext-night textarea::placeholder{' +
      'color:' + DK_MUTED + ' !important;' +
      '-webkit-text-fill-color:' + DK_MUTED + ' !important;' +
    '}',
    'html.ext-night [class*="dropdown" i],' +
    'html.ext-night [class*="select" i],' +
    'html.ext-night [class*="field" i],' +
    'html.ext-night [class*="input" i]{' +
      'background-color:' + DK_RAISED + ' !important;' +
    '}',

    // ── 12. RAISED — buttons (generic Amazon buttons) ─────────────────────────
    'html.ext-night button{' +
      'background-color:' + DK_RAISED + ' !important;' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
      'border:1px solid ' + DK_BORDER + ' !important;' +
    '}',

    // ── 13. SVG icon strokes ──────────────────────────────────────────────────
    'html.ext-night svg[aria-hidden="true"] g[stroke],' +
    'html.ext-night svg[aria-hidden="true"] path[stroke]{' +
      'stroke:' + DK_TEXT + ' !important;' +
    '}',

    // ── 14. Close buttons ─────────────────────────────────────────────────────
    'html.ext-night [aria-label*="close" i],' +
    'html.ext-night [class*="close" i],' +
    'html.ext-night [title*="close" i]{' +
      'background-color:' + DK_RAISED + ' !important;' +
      'color:' + DK_TEXT + ' !important;opacity:1 !important;' +
    '}',
    'html.ext-night [aria-label*="close" i] svg,' +
    'html.ext-night [class*="close" i] svg{' +
      'stroke:' + DK_TEXT + ' !important;' +
    '}',

    // ── 15. OVERLAY — popovers / menus / modals ───────────────────────────────
    'html.ext-night [role="dialog"],' +
    'html.ext-night [role="menu"],' +
    'html.ext-night [role="listbox"],' +
    'html.ext-night [role="tooltip"],' +
    'html.ext-night [role="grid"],' +
    'html.ext-night [aria-modal="true"]{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border:1px solid ' + DK_BORDER_STRONG + ' !important;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.55) !important;' +
    '}',
    'html.ext-night [class*="popover" i],' +
    'html.ext-night [class*="popup" i],' +
    'html.ext-night [class*="tooltip" i],' +
    'html.ext-night [class*="menu" i],' +
    'html.ext-night [class*="overlay" i],' +
    'html.ext-night [class*="modal" i],' +
    'html.ext-night [class*="calendar" i],' +
    'html.ext-night [class*="datepicker" i],' +
    'html.ext-night [class*="timepicker" i],' +
    'html.ext-night [class*="picker" i],' +
    'html.ext-night [class*="flyout" i]{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
    '}',
    'html.ext-night body > div[style*="position: absolute"],' +
    'html.ext-night body > div[style*="position:absolute"],' +
    'html.ext-night body > div[style*="position: fixed"],' +
    'html.ext-night body > div[style*="position:fixed"]{' +
      'background-color:' + DK_OVERLAY + ' !important;' +
      'border:1px solid ' + DK_BORDER + ' !important;' +
    '}',
    'html.ext-night [role="dialog"] *,' +
    'html.ext-night [role="grid"] *,' +
    'html.ext-night [class*="picker" i] *{' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
    '}',

    // ── 16. RAISED — Amazon header / banner / nav (neutral dark) ─────────────
    'html.ext-night header,' +
    'html.ext-night [role="banner"],' +
    'html.ext-night nav[role="navigation"]{' +
      'background-color:' + DK_RAISED + ' !important;' +
    '}',
    'html.ext-night header *,' +
    'html.ext-night [role="banner"] *,' +
    'html.ext-night nav[role="navigation"] *{' +
      'color:' + DK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + DK_TEXT + ' !important;' +
      'background-color:transparent !important;' +
    '}',

    // ── 17. Book button — blue semantic action, unaffected by ramp ───────────
    'html.ext-night #rlb-book-btn,' +
    'html.ext-night #rlb-book-trip-confirm-booking-btn,' +
    'html.ext-night [id*="book" i][id*="btn" i]{' +
      'background-color:' + BOOK_BG + ' !important;' +
      'color:' + BOOK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + BOOK_TEXT + ' !important;' +
      'border:1px solid ' + BOOK_BORDER + ' !important;' +
      'font-weight:700 !important;opacity:1 !important;' +
    '}',
    'html.ext-night #rlb-book-btn *,' +
    'html.ext-night #rlb-book-trip-confirm-booking-btn *{' +
      'color:' + BOOK_TEXT + ' !important;' +
      '-webkit-text-fill-color:' + BOOK_TEXT + ' !important;' +
    '}',

    // ── 18. OUR elements ──────────────────────────────────────────────────────

    // New-load highlight — accent blue tint + inset left-rule
    'html.ext-night .ext-new-load{' +
      'background-color:rgba(76,141,255,.15) !important;' +
      'box-shadow:inset 4px 0 0 0 rgba(76,141,255,.8) !important;' +
    '}',

    // Sidebar — dark graphite surface (belt-and-suspenders with sidebar.js overrides)
    'html.ext-night #ext-sidebar{background-color:#1c1f24 !important;color:#e5edf5 !important;}',
    'html.ext-night #ext-sidebar input{background-color:transparent !important;border:none !important;}',
    'html.ext-night #ext-sidebar [data-testid="ext-playpause"]{background:#23272d !important;border-color:#2c313a !important;color:#b0bcca !important;}',
    'html.ext-night #ext-sidebar .ext-scanline__seg{background:linear-gradient(90deg,rgba(76,141,255,0),rgba(76,141,255,.9),rgba(76,141,255,0)) !important;}'
  ].join('');
}

function ensureNightStyle() {
  if (document.getElementById(NIGHT_STYLE_ID)) return;
  var style = document.createElement('style');
  style.id = NIGHT_STYLE_ID;
  style.setAttribute('data-testid', NIGHT_STYLE_ID);
  style.textContent = buildNightCss();
  (document.head || document.documentElement).appendChild(style);
}

function applyNightMode(on) {
  ensureNightStyle();
  document.documentElement.classList.toggle('ext-night', on === true);
  logger.log('nightMode', 'applied', { on: on === true });
}

(async function initNightMode() {
  try {
    var on = await storage.get(STORAGE_KEYS.NIGHT_MODE, false);
    applyNightMode(on);
  } catch (e) {
    logger.warn('nightMode', 'init failed', { error: e });
  }
})();

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!changes[STORAGE_KEYS.NIGHT_MODE]) return;
  applyNightMode(changes[STORAGE_KEYS.NIGHT_MODE].newValue === true);
});

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.toggleNight = function () {
  var cur = document.documentElement.classList.contains('ext-night');
  applyNightMode(!cur);
  storage.set(STORAGE_KEYS.NIGHT_MODE, !cur);
  return !cur;
};
