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

// DEVELOPMENT SWITCH — per-city load assignment debug (2026-08-06). Shipped OFF. No UI, no
// storage key, no popup control, exactly like CAPTURE_RESPONSES above.
//
// OFF (false): content/cityAssign.js installs nothing and does nothing, and
// content/networkObserver.js emits no ids and no coordinates.
// ON  (true):  each captured /search body additionally yields { id, lat, lng } triples for the
// PICKUP stop, which the isolated world uses to assign each on-screen load card to its nearest
// active origin city and log ONE compact count summary per refresh. Read-only: no DOM is added,
// removed, hidden, reordered or restyled. Nothing is stored or rendered.
//
// ⚠ THIS FLAG ALONE DOES NOTHING — it needs THREE switches on, in two files:
//   1. this constant, and
//   2. CITY_ASSIGN_DEBUG in content/networkObserver.js (the MAIN-world mirror), and
//   3. BOTH copies of CAPTURE_RESPONSES — the coordinates ride on the existing capture path,
//      so with capture off there is no body to read and this stays silent.
//
// WHY THIS ONE IS MIRRORED. Unlike a log line, the gate has to sit in the MAIN world: it
// decides whether ids and coordinates cross the postMessage boundary at all. Gating only on
// the isolated side would send them and then discard them, which is precisely what
// summariseAndDiscard()'s "no ids, no cities, no addresses" contract exists to prevent.
const CITY_ASSIGN_DEBUG = false;

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE SWITCH — per-city card filtering (2026-08-13). Shipped OFF.
//
// ⚠ THIS IS THE ONLY FLAG IN THIS FILE THAT CAN CHANGE WHAT THE DISPATCHER SEES. Everything
// else here is logging. With this on, applyCityFilter() may set style.display on Amazon's load
// cards to hide loads belonging to other cities.
//
// OFF (false): applyCityFilter() is a no-op. NO style is ever written, no card is ever hidden,
// and content/cityAssign.js remains what it has always been — read-only.
// ON  (true):  applyCityFilter(city) hides main-list cards assigned to a DIFFERENT city.
//
// Safety properties that hold even when it is on (see content/cityAssign.js):
//   - Cards are HIDDEN, never removed, detached, reordered, or edited.
//   - A card we could not assign is NEVER hidden — erring toward showing is always correct,
//     because a load the dispatcher cannot see is a load he cannot book.
//   - The "Similar matches" list is never touched at all.
//   - display:none keeps the card in the DOM, so loadParser still sees it and knownLoadIds is
//     unaffected — hiding a card cannot make it look "new" on the next cycle.
//
// ONE DECLARATION IS ENOUGH — unlike CAPTURE_RESPONSES / CITY_ASSIGN_DEBUG there is no MAIN-world
// mirror, because the filter lives entirely in the isolated world where the DOM work happens.
// content/networkObserver.js neither reads nor needs it.
const CITY_FILTER_ENABLED = true;
