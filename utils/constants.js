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
const EXT_NAME    = 'Amazon Relay Helper';
const EXT_VERSION = '0.1.0';

// 0 = off, 1 = errors/warnings only, 2 = full debug
const DEBUG_LEVEL = 2;
