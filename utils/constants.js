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
