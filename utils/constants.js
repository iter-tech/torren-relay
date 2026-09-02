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
// PRODUCT FLAG — per-city card filtering (2026-08-13). SHIPPED ON, and it must stay that way.
//
// 🔑 THIS IS NOT A DEBUG SWITCH, and it is the one flag in this file that must NOT be flipped
// when the others are. HANDOFF rule 11: it stays `true`. Turning it off does not quiet a log —
// it silently removes per-city filtering, which is the feature the city buttons exist for. The
// buttons stay on screen and stop filtering, so it reads as a broken board, not a disabled flag.
//
// ⚠ CORRECTED 2026-08-27. This line said "Shipped OFF" from 2026-08-13 until today, describing
// the state it was BUILT in rather than the state it SHIPS in. Anyone returning flags to their
// shipped values by reading these headers would have killed per-city filtering, which is exactly
// the mistake this comment now exists to prevent.
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

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT FLAG — Fast Book. SHIPS `false` IN 1.0. Added 2026-08-27, Ihor's decision.
//
// 🔑 WHY IT IS FALSE, AND WHY THAT IS NOT A DEFAULT: the store listing states that this
// extension "does not book loads". For 1.0 that sentence must be true of the SHIPPED BUILD, not
// merely true of the default settings — a reviewer reads the source, and a booking path that is
// only one storage key away from firing does not match that description. With this false there
// is no reachable path from any UI or console call to Amazon's Book button.
//
// ⚠ NOTHING WAS DELETED. Every part of Fast Book is still here and unmodified — the two-step
// click sequence, the identity gate, the payout gate, the rehearsal helpers and fastbook-suite.
// Flipping this to `true` restores the 2026-08-27 behaviour exactly. This is a 1.1 re-enable
// held behind one constant, not a removal.
//
// 🔑 THREE INDEPENDENT GATES, AND ANY ONE ALONE IS SUFFICIENT:
//   1. content/inlinePanel.js buildActionBar()  — the button is never CREATED or inserted.
//   2. popup/popup.js                            — the Booking section is REMOVED from the DOM,
//                                                  so the toggle cannot be set at all.
//   3. content/inlinePanel.js executeFastBook()  — refuses at ENTRY, before any DOM read, so a
//                                                  direct __EXT_DEBUG call cannot reach a click.
// They are deliberately redundant. Gate 3 alone holds even if someone re-adds a button by hand.
//
// ⚠ WHEN THIS FLIPS TO TRUE, THE MANIFEST DESCRIPTION MUST CHANGE IN THE SAME COMMIT. The
// description's truth depends on this constant. See BACKLOG 0ao.
const FAST_BOOK_ENABLED = false;

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 ARE WE ON THE LOAD BOARD? THE ONE DEFINITION. Added 2026-08-31.
//
// WHY: the extension used to activate on ANY Relay page. On /dashboard the top bar floated
// mid-screen over Amazon's own UI about half a second after the page opened, because there was
// no page check anywhere — only a LOGIN check.
//
// ⚠ ONE DEFINITION, USED EVERYWHERE. Every gate in the extension composes with this function;
// no file does its own path test. Three copies of a card lookup have already cost this project a
// day, and a second copy of THIS would be worse — a page check that disagrees with itself means
// half the UI renders on the dashboard.
//
// ── WHAT IS MEASURED, AND WHAT IS NOT ────────────────────────────────────────
// MEASURED on relay.amazon.com: the load board path is /loadboard/search. Recorded independently
// in docs/AMAZON_SELECTORS.md:492, docs/TEST_CASES.md:13, docs/BACKLOG.md:308 and
// content/inlinePanel.js:1808 — all from the 2026-08-27 sheet measurement, all saying the URL
// "stays /loadboard/search".
//
// 🔴 NOT MEASURED on the other TEN domains. The manifest ships to eleven Relay domains, and
// every capture on disk is from relay.amazon.com — the other ten appear exactly once each, in
// the manifest's own host list, never in a capture. ⚠ SO THE PATH IS NOT GUESSED FOR THEM: the
// rule matches the FIRST PATH SEGMENT ONLY, which is the broadest check the evidence supports,
// and an unrecognised Relay page SAYS SO OUT LOUD (see warnIfUnrecognisedRelayPage below).
// Silently never activating on a whole domain would be worse than the bug this fixes.
// How often the SPA navigation watch compares location.pathname. One string comparison, and it
// has to keep running while the extension is INACTIVE — that is the state we must notice leaving.
// 500 ms matches the "about half a second" the bar already took to appear, so arriving at the
// board feels the same as it does today.
var NAV_WATCH_POLL_MS = 500;

var LOAD_BOARD_PATH_SEGMENT = 'loadboard';

// True when the current page is Amazon's load board.
//
// Matches on the first path segment, so /loadboard, /loadboard/search and any future
// /loadboard/<whatever> all count, while /dashboard, /trips and the rest do not. Deliberately
// NOT an exact match on '/loadboard/search': a sibling board route would then be treated as a
// non-board page and the extension would go dark with no explanation.
function isLoadBoardPage() {
  try {
    var path = (window.location && window.location.pathname) || '';
    // ⚠ WIDENED 2026-08-31, SAME DAY, AFTER A LIVE FAILURE. The first version required
    // 'loadboard' to be the FIRST path segment. Ihor reported the extension not activating on
    // relay.amazon.com/loadboard/search — and the first-segment rule is provably correct for
    // exactly that string, which means the live pathname was NOT exactly that string. A prefix
    // (locale, region, app root) is the ordinary reason, and the first-segment rule rejects
    // every one of them.
    //
    // So the rule is now: ANY path segment equal to 'loadboard'. This accepts /loadboard/search,
    // /us/loadboard/search and any other prefixed form, WITHOUT inventing which prefix it is —
    // that would be the guess this must not make.
    //
    // ⚠ IT IS STILL SEGMENT EQUALITY, NOT A SUBSTRING. '/loadboards/search',
    // '/loadboard-archive' and '/myloadboard' are still correctly rejected, because a substring
    // test would have matched all three.
    var segs = path.toLowerCase().split('/');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === LOAD_BOARD_PATH_SEGMENT) return true;
    }
    return false;
  } catch (e) {
    // Fails CLOSED, like every other gate here. window.location.pathname cannot realistically
    // throw, so this is a genuine anomaly and is reported rather than swallowed.
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('constants', 'isLoadBoardPage failed — treating the page as NOT the load ' +
        'board, so nothing is injected', { error: e });
    }
    return false;
  }
}

// 🔴 A PAGE WE DO NOT RECOGNISE MUST NOT FAIL SILENTLY — ON ANY DOMAIN.
//
// ⚠ COMMENT CORRECTED 2026-08-31. It used to say that relay.amazon.com stayed quiet because its
// path was measured, and that only the other ten warned. That WAS the behaviour, it was removed
// the same day, and this header was left describing it — a comment stating the opposite of the
// code beneath it, which is the same trap the CITY_FILTER_ENABLED header set.
//
// 🔑 ALL ELEVEN RELAY DOMAINS ARE TREATED IDENTICALLY HERE. Whenever we decline to activate on a
// Relay page, we say so out loud and name the path — the same rule as the radius warnings: a
// failure the dispatcher depends on must be VISIBLE. The .com suppression is what made the
// 2026-08-31 non-activation undiagnosable, on precisely the domain where the diagnostic was
// needed.
//
// ⚠ THE ONLY PLACE IN THE EXTENSION THAT STILL TREATS .com DIFFERENTLY is radiusUnitCaveat()
// (content/cityAssign.js). That asymmetry is DELIBERATE and unrelated to domain support: it is
// about the radius UNIT being unknown on a metric board, and it gates no behaviour — it only
// appends a caveat to a diagnostic line. Nothing about activation, injection or matching varies
// by domain.
//
// ⚠ console.warn, NOT logger.warn, ON PURPOSE. logger.warn is silenced at the shipped
// DEBUG_LEVEL of 1, which is exactly how radiusUnitCaveat()'s warning ended up invisible in a
// shipped build. This one has to survive that.
//
// Deduped per path so a dispatcher clicking around does not get a wall of identical lines.
var _extUnrecognisedPathsWarned = {};
function warnIfUnrecognisedRelayPage() {
  try {
    if (isLoadBoardPage()) return false;
    var host = (window.location && window.location.hostname) || '';
    // ⚠ THE .COM SILENCE IS GONE (2026-08-31, same day). It used to return here for
    // relay.amazon.com on the reasoning that the path was measured there, so declining was
    // always correct and a warning would be noise.
    //
    // 🔑 THAT WAS THE WRONG CALL, AND IT COST A DEBUGGING SESSION. When the extension failed to
    // activate on relay.amazon.com/loadboard/search, the ONE diagnostic that would have printed
    // the real pathname was suppressed on precisely the domain where it was needed. A gate that
    // declines silently is the failure mode this whole warning exists to prevent — the domain it
    // happens on does not change that.
    //
    // The cost is one deduped console line per distinct non-board path. That is a fair price for
    // never having to guess a pathname again.
    var path = (window.location && window.location.pathname) || '(unknown)';
    if (Object.prototype.hasOwnProperty.call(_extUnrecognisedPathsWarned, path)) return false;
    _extUnrecognisedPathsWarned[path] = true;

    console.warn('[EXT] Torren Relay did NOT activate on this page.' +
      '\n      host : ' + host +
      '\n      path : ' + path +
      '\n      The extension only runs on the load board, which it recognises by ANY path' +
      '\n      segment equal to "' + LOAD_BOARD_PATH_SEGMENT + '".' +
      '\n      If this IS the load board, the path does not contain that segment and needs' +
      '\n      reporting — copy the path above verbatim.' +
      '\n      If this is the Dashboard or another page, nothing is wrong.');
    return true;
  } catch (e) {
    if (typeof logger !== 'undefined' && logger.error) {
      logger.error('constants', 'warnIfUnrecognisedRelayPage failed — the page check itself is ' +
        'unaffected', { error: e });
    }
    return false;
  }
}
