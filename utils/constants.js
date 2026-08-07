const FORBIDDEN_SELECTORS = [
];

function isForbiddenElement(el) {
  if (!el || el.nodeType !== 1 || typeof el.matches !== 'function') return false;
  return FORBIDDEN_SELECTORS.some(s => el.matches(s) || el.closest(s));
}

// Named click intents — every .click() call must declare which intent it is.
const ALLOWED_CLICK_INTENTS = {
  REFRESH:            'REFRESH',            // Amazon's internal refresh button — refreshes list, books nothing
  NEUTRAL_ZONE:       'NEUTRAL_ZONE',       // Load card body — opens details panel, does NOT book
  CLOSE_DETAIL_PANEL: 'CLOSE_DETAIL_PANEL', // Load detail sheet close control — dismisses sheet, books nothing
  // RESTORED 2026-08-05. Removed in June 2026 when three attempts at the filters auto-collapse
  // were abandoned (none could read the panel's open/closed state). The feature is back, using
  // a layout measurement instead of a state attribute — see panelCloser.js collapseFilterPanel().
  CLOSE_FILTER_PANEL: 'CLOSE_FILTER_PANEL', // Amazon's Filter toggle — shows/hides filters, books nothing
  FAST_BOOK:          'FAST_BOOK'           // Fast Book sequence — user-triggered, clicks Amazon booking buttons
};

// Project-wide config
// 2026-07-30: was 'Amazon Relay Helper' — the pre-rebrand name, which the sidebar was still
// showing while the extension ships as "Torren Relay" (manifest.json `name`). Sole reader is
// content/sidebar.js's ext-sidebar-title.
const EXT_NAME    = 'Torren Relay';
const EXT_VERSION = '0.1.0';

// ─────────────────────────────────────────────────────────────────────────────
// Console verbosity. THIS IS THE ONE LINE TO RAISE WHILE DEVELOPING — set it to 4
// locally, and set it back to 1 before shipping. There is deliberately no UI for it.
//
//   0 = silent
//   1 = error only            ← shipped default
//   2 = error + warn
//   3 = error + warn + log
//   4 = everything, incl. debug
//
// Enforced for ALL FOUR logger methods in utils/logger.js (2026-07-30). Before that date
// only logger.debug consulted this constant, so with 183 logger.log calls against 5
// logger.debug the knob silenced roughly 3% of output and was effectively non-functional —
// the console stayed fully verbose at every setting.
const DEBUG_LEVEL = 1;

// ─────────────────────────────────────────────────────────────────────────────
// DEVELOPMENT SWITCH — response-body capture. Shipped OFF, deliberately no UI, no storage
// key, no popup control (2026-07-31).
//
// OFF (false): content/networkObserver.js behaves exactly as it did before this flag
// existed — it reads only resp.ok / resp.status and never touches a response body.
// ON  (true):  for /api/loadboard/search and /api/loadboard/similar ONLY, the body is
// cloned, read, reduced to five NON-IDENTIFYING counters, logged once, and thrown away.
// Nothing is stored, cached, or rendered. See the file header of networkObserver.js.
//
// ⚠ FLIPPING THIS IS A TWO-FILE EDIT. content/networkObserver.js runs in the page's MAIN
// world (manifest.json declares "world":"MAIN" for it) and therefore CANNOT see this file —
// isolated-world globals do not exist there. It carries its own mirrored copy of this
// constant which is the one that actually gates the capture. Same duplication, for the same
// reason, as background.js's RATE_LIMITER_KEY. To turn capture on you must set BOTH:
//   1. this constant, and
//   2. CAPTURE_RESPONSES in content/networkObserver.js
// This constant alone gates only the isolated-world log line; the mirror gates the body read.
const CAPTURE_RESPONSES = false;
