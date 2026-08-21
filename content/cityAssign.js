// cityAssign.js — foundation for per-city load splitting (2026-08-06).
//
// READ-ONLY RECONNAISSANCE. This file answers ONE question and then prints the answer:
// "which active origin city does each load card on screen belong to?" It changes NOTHING the
// dispatcher sees. There is no hiding, no filtering, no reordering, no restyling, no badge, no
// UI of any kind. It does not add, remove or modify a single node in Amazon's DOM, and it never
// clicks anything. Its entire output is console lines.
//
// It exists so the assignment can be checked against a real board BEFORE anything acts on it.
// If the counts it prints do not match what the dispatcher sees, we find out here, at zero risk,
// rather than after loads have been hidden from him.
//
// ── GATED OFF BY DEFAULT ──────────────────────────────────────────────────────────────────
// Nothing below runs unless CITY_ASSIGN_DEBUG (utils/constants.js) is true. Turning it on is a
// FOUR-SWITCH, THREE-FILE operation, because the data rides on the existing capture path and
// the output rides on the existing log-level gate:
//   1. DEBUG_LEVEL        -> 3   (utils/constants.js)          — logger.log needs >= 3
//   2. CAPTURE_RESPONSES  -> true (utils/constants.js)
//   3. CAPTURE_RESPONSES  -> true (content/networkObserver.js — MAIN-world mirror)
//   4. CITY_ASSIGN_DEBUG  -> true (BOTH utils/constants.js and networkObserver.js)
// Leaving any one of them off makes this file silent. That is deliberate: the log lines here
// contain city names and work-opportunity ids, and the level gate is the backstop that keeps
// them out of a stock build even if a flag is left on by mistake.
//
// ── WHY THE ASSIGNMENT IS GEOMETRIC, NOT TEXTUAL ──────────────────────────────────────────
// The obvious approach — compare the card's origin city text to the filter chip text — does not
// work. State formatting in the captured response is inconsistent within a SINGLE response
// (verified: "IL" alongside "Ohio" alongside "Indiana"), so string matching would silently
// mis-assign. We therefore never match on city or state strings anywhere in this file. We use
// the PICKUP stop's latitude/longitude and take the nearest active city by great-circle
// distance. Coordinates do not have formatting variants.

// Great-circle radius in miles. Haversine on a sphere is accurate to ~0.5% at these distances,
// which is far inside the tolerance of a "which of 5 cities is nearest" question.
var CITY_ASSIGN_EARTH_RADIUS_MI = 3958.8;

// ⚠ A GUESS, NOT A KNOWN VALUE. Dispatcher radius has been seen set from 25 to 100 miles, so a
// pickup should normally sit well inside 100 mi of its city. 150 leaves headroom for a wide
// radius plus the difference between the city centroid the cities endpoint returns and the
// actual warehouse. It is here to stop a load being FORCED onto a city it has nothing to do
// with — an unmatched card is an honest answer, a wrongly-attributed one is not.
// TUNE THIS AGAINST REAL LOGS. If genuine loads show up as unmatched with distances of
// 150–250 mi, raise it. If junk is being absorbed, lower it.
var CITY_ASSIGN_MAX_MILES = 150;

// A refresh can deliver several responses. The raw responses are still buffered for DIAGNOSTICS
// ONLY; assignment reads the merged map below, not these.
//
// CAN EVICTION LOSE SOMETHING WE NEED? No — checked, not assumed (2026-08-13). mergePickupCoords()
// runs inside onCityCoordsMessage, i.e. the moment a response ARRIVES, so its coordinates are in
// the persistent map before this array is ever trimmed. Every remaining reader of the array is
// either pickBuffer() (defined, never called) or a CITY_ASSIGN_DEBUG-only diagnostic. Dropping an
// old raw body costs a log line, never an assignment.
//
// RAISED 4 -> 6 anyway (2026-08-13), for the diagnostic's sake: a refresh now delivers search +
// similar + recommendations, so a cap of 4 could not hold even one complete refresh and the
// inventory would show a torn picture of what arrived together. Six covers a refresh with room
// for a second saved-search tab's search.
var CITY_ASSIGN_MAX_BUFFERS = 6;

// ── THE MERGED PICKUP MAP (2026-08-13) ────────────────────────────────────────────────────
//
// work-opportunity id -> { lat, lng }, taken from Amazon's OWN coordinates
// (workOpportunities[].loads[0].stops[0].location.latitude/.longitude).
//
// THIS REPLACED pickBuffer(), WHICH WAS THE ACTUAL DEFECT. pickBuffer chose the ONE buffered
// response with the highest id overlap and discarded the rest, so a board whose cards came from
// two responses — any paginated board, any board rendered after a second saved-search tab
// answered — lost every id living in the responses that lost the vote.
//
// MERGING IS SAFE, and it is safe for a checkable reason rather than an assumed one: the join key
// is the work-opportunity id, which is globally unique. If the same id appears in two responses
// it is the SAME load, so the coordinates agree. Measured across the captures on disk: 13 ids
// appear in more than one response, 13 carry identical coordinates, 0 conflict. There is a test
// that reads those files and re-checks it rather than trusting this paragraph.
//
// IT PERSISTS ACROSS CYCLES. Coverage on a paginated board accumulates as pages arrive: page 1's
// response covers the first 50 ids, page 2's adds the next 25, and neither evicts the other.
// Rebuilding from the current buffers alone is what made coverage collapse the moment a refresh
// pushed a response out of the 4-slot window.
//
// BOUNDED, oldest-first, so a long session cannot grow it without limit. 4000 entries is ~80
// pages of results — far beyond any board — at roughly 40 bytes each.
var CITY_PICKUP_MAX = 4000;
var _cityPickupById = {};   // id -> { lat, lng }
var _cityPickupOrder = [];  // insertion order, for eviction

// ── THE PANEL'S RECORD STORE (STAGE B, 2026-08-14) ────────────────────────────────────────
//
// work-opportunity id -> the curated record projectRecord() emits in networkObserver.js.
// Lives here because this is where the capture message arrives and where the bounded eviction
// and teardown already are; inlinePanel reads it through getLoadRecord() and never touches the
// network path itself.
//
// Bounded by the SAME rule as the pickup map and evicted together, so the two can never
// disagree about which loads we know. Cleared on teardown and logout with everything else.
var _cityRecordById = {};

// ── PART 2: TRAILER-LABEL COLLECTION (2026-08-20) ─────────────────────────────────────────
//
// WHY THIS EXISTS. Four hypotheses for the P/R rule died UNCONFIRMED — assetOwner, containerOwner,
// C1 and C5 — for one reason: exactly ONE labelled record existed on disk, and it was a P. With no
// labelled R, a field can be refuted but never confirmed. This fixes the cause rather than
// guessing again: every time Ihor works the board, the card's badge letter is filed beside the
// captured record under the SAME work-opportunity id, so labelled pairs accumulate by themselves.
//
// It lives HERE, next to _cityRecordById, deliberately: same id, same eviction list, same
// teardown. If the label lived somewhere else it could outlive or predecease its record and the
// pair would silently drift — which is the whole failure this is meant to end.
//
// IN-MEMORY ONLY. No disk write, no network, no storage API, nothing leaves the tab. The letter is
// the one loadParser already reads at loadParser.js:84; no extra DOM traversal is added.
var _cityTrailerLabelById = {};

// Called by loadParser for each card it parses. Records only — nothing here decides anything and
// nothing here can affect filtering, the panel, detection or what PAT posts.
function noteTrailerLabel(loadId, letter) {
  try {
    if (!loadId) return;
    if (letter === null || letter === undefined || letter === '') return;
    _cityTrailerLabelById[loadId] = String(letter);
  } catch (e) {
    logger.error('cityAssign', 'noteTrailerLabel failed — label collection only, nothing else ' +
      'is affected', { error: e, loadId: !!loadId });
  }
}

// The badge letter for a load, or null. PAT reads this — see the INTERIM DOM DEPENDENCY note in
// patModal.js. It is a plain read of an in-memory map; it touches no DOM itself.
function getTrailerLabel(loadId) {
  logger.log('cityAssign', 'getTrailerLabel called');
  try {
    if (!loadId) return null;
    return Object.prototype.hasOwnProperty.call(_cityTrailerLabelById, loadId)
      ? _cityTrailerLabelById[loadId] : null;
  } catch (e) {
    logger.error('cityAssign', 'getTrailerLabel failed', { error: e, loadId: !!loadId });
    return null;
  }
}

// THE DUMP COMMAND. Deliberately console.* and NOT logger.* — logger.log needs DEBUG_LEVEL 3, and
// this must work at the shipped level so Ihor changes no configuration to run it. It is invoked
// explicitly by a human, never ambient.
//
//   __EXT_DEBUG.dumpTrailerLabels()
//
function dumpTrailerLabels() {
  try {
    var out = [];
    for (var id in _cityTrailerLabelById) {
      if (!Object.prototype.hasOwnProperty.call(_cityTrailerLabelById, id)) continue;
      var rec = Object.prototype.hasOwnProperty.call(_cityRecordById, id) ? _cityRecordById[id] : null;
      out.push({ id: id, badge: _cityTrailerLabelById[id], record: rec });
    }
    var withRec = out.filter(function (x) { return x.record !== null; });
    var p = out.filter(function (x) { return x.badge === 'P'; }).length;
    var r = out.filter(function (x) { return x.badge === 'R'; }).length;
    var other = out.length - p - r;
    console.log('[EXT] TRAILER LABELS  ' + out.length + ' card(s) labelled  |  P: ' + p +
      '  R: ' + r + (other ? '  other/unexpected: ' + other : '') +
      '  |  ' + withRec.length + ' of them also have a captured record (those are the useful ones)');
    if (r === 0) {
      console.log('[EXT] ** No R labels yet. R is the scarce one and worth the most — the rule ' +
        'cannot be confirmed without it. **');
    }
    console.log('[EXT] Copy everything between the markers and send it to the PM:');
    console.log('----- BEGIN TRAILER LABELS -----');
    console.log(JSON.stringify(withRec, null, 2));
    console.log('----- END TRAILER LABELS -----');
    return { total: out.length, P: p, R: r, withRecord: withRec.length };
  } catch (e) {
    logger.error('cityAssign', 'dumpTrailerLabels failed', { error: e });
    return null;
  }
}

// The inline panel's ONLY data source. Returns null for an id we have never captured, which is
// what makes "no record, no panel, no interception" checkable rather than assumed.
function getLoadRecord(loadId) {
  logger.log('cityAssign', 'getLoadRecord called');
  try {
    if (!loadId) return null;
    return Object.prototype.hasOwnProperty.call(_cityRecordById, loadId)
      ? _cityRecordById[loadId] : null;
  } catch (e) {
    logger.error('cityAssign', 'getLoadRecord failed', { error: e, loadId: !!loadId });
    return null;
  }
}

// Ids a response DID list but WITHOUT coordinates. Kept only so an unmatched card can be given
// the right reason: "we never saw this load" and "we saw it and Amazon sent no position" are the
// same outcome but very different problems, and Ihor cannot report a pattern from a number.
var _cityNoCoordIds = {};

// Which captured endpoint last mentioned an id — 'search' | 'recommendations' | 'similar', the
// labels networkObserver.js already assigns. DIAGNOSTICS ONLY (2026-08-20): it answers "from
// which endpoint did the record come" for an unassigned load, and nothing reads it to make a
// decision. Deliberately a SIDE map: the merged coordinate map is not changed.
var _cityIdEndpointById = {};

// The third filter state, alongside null (All) and a city name: show ONLY the cards that could
// not be matched to any city. Carried inside _cityFilterActive as a sentinel rather than as a
// fourth variable, so re-apply-after-refresh, restore-on-teardown and the panel-anchor check
// all keep working untouched. City strings come from Amazon's filter chips and look like
// "CHICAGO, IL", so this cannot collide with one. Plain ASCII deliberately: the first attempt
// used a U+0000 prefix and put a real NUL byte in the source, which made the file read as
// binary to grep and every other text tool.
var CITY_FILTER_UNMATCHED = '__EXT_UNMATCHED__';

// The response arrives BEFORE React has rendered the cards it describes, so reading the DOM at
// arrival would find the previous page's cards (or none). This waits for the render to settle
// and coalesces the burst of responses a single refresh produces into ONE cycle.
// ⚠ ALSO A GUESS — tune against real logs. If cycles report "no captured response matches the
// cards on screen" on a slow board, this is the first thing to raise.
var CITY_ASSIGN_SETTLE_MS = 700;

// Folds one response's { id, lat, lng } triples into the persistent map. Returns how many ids
// were NEW, which is what makes accumulation visible in the log.
function mergePickupCoords(pairs) {
  var added = 0;
  if (!pairs || !pairs.length) return 0;
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    if (!p || !p.id) continue;
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
    if (!Object.prototype.hasOwnProperty.call(_cityPickupById, p.id)) {
      _cityPickupOrder.push(p.id);
      added++;
    }
    // Last write wins on a repeat. Harmless by the uniqueness argument above — the values are
    // equal — and it keeps the entry fresh rather than stale if Amazon ever did revise one.
    _cityPickupById[p.id] = { lat: p.lat, lng: p.lng };
  }
  while (_cityPickupOrder.length > CITY_PICKUP_MAX) {
    var old = _cityPickupOrder.shift();
    // The record goes with the coordinates, always — one eviction, one order list, so the two
    // stores can never disagree about which loads we still know.
    if (Object.prototype.hasOwnProperty.call(_cityRecordById, old)) delete _cityRecordById[old];
    // The trailer label goes with them too — same id, same eviction, so a label can never outlive
    // the record it describes (PART 2).
    if (Object.prototype.hasOwnProperty.call(_cityTrailerLabelById, old)) {
      delete _cityTrailerLabelById[old];
    }
    // Same for the diagnostic endpoint note (2026-08-20): one eviction, one order list.
    if (Object.prototype.hasOwnProperty.call(_cityIdEndpointById, old)) {
      delete _cityIdEndpointById[old];
    }
    if (!Object.prototype.hasOwnProperty.call(_cityPickupById, old)) continue;
    delete _cityPickupById[old];
  }
  return added;
}

// Folds one response's curated records into the store, keyed by id. Same last-write-wins rule as
// the coordinates, and safe for the same reason: the id is globally unique, so a repeat is the
// same load.
function mergeLoadRecords(records) {
  var added = 0;
  if (!records || !records.length) return 0;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r || !r.id) continue;
    if (!Object.prototype.hasOwnProperty.call(_cityRecordById, r.id)) added++;
    _cityRecordById[r.id] = r;
  }
  return added;
}

var _cityAssignBuffers  = [];    // recent captured responses, oldest first
var _cityAssignTimer    = null;  // settle-debounce handle
var _cityAssignRunning  = false; // re-entry guard — the cycle awaits, refreshes do not wait
var _cityAssignListener = null;  // kept so teardown can remove exactly what init added
var _cityEndpointListener = null; // endpoint recon listener (2026-08-08), removed alongside it
var _cityTraceListener  = null;  // capture drop/ok trace listener (2026-08-13)

// city string ("TULSA, OK") -> { lat, lng } or null when unresolvable.
//
// NEGATIVE RESULTS ARE CACHED TOO (the null). Without that, a city the endpoint cannot resolve
// would be re-requested on every single refresh forever. See resolveCityCoords for the cost
// note — this cache is the only reason this feature is not a per-refresh network call.
var _cityCoordCache = {};

// ── NO CROSS-CYCLE STATE (2026-08-12) ─────────────────────────────────────────────────────
//
// There is deliberately NO id accumulator here any more. Each cycle matches the cards currently
// in the main list against the CURRENT /search response and remembers nothing.
//
// WHAT WAS REMOVED AND WHY. An accumulator merged every /search page across a "search session",
// on the belief that the board paginated at 5 and filled in as the dispatcher scrolled. That
// belief was wrong: it came from misreading the "Similar matches" block. The MAIN results list
// renders all N at once ("10 of 10"), so there was never anything to accumulate.
//
// Both reset rules it needed were also wrong, each disproven on a live board:
//   - searchAuditId changed per REQUEST, not per search, so it wiped the store nearly every
//     cycle.
//   - originCities fired during the NORMAL staged loading of the SAME search — the chips arrive
//     one, then all five — wiping 51 ids mid-fill.
//
// A stateless cycle has neither failure mode, and with all N present in one response it needs
// no memory to be complete. `_cityCoordCache` above is NOT part of this: it caches city-name ->
// coordinates from the cities endpoint, which is a genuine network saving and has nothing to do
// with load ids.

// ── GEOMETRY ──────────────────────────────────────────────────────────────────────────────

// NO logger.log at entry here, deliberately, and this is the ONLY function in the file that
// omits it. It runs cards x cities times per cycle (~250 calls on a 50-card, 5-city board);
// logging each one would produce 250 console lines per refresh and drown the summary this
// feature exists to print. Pure arithmetic, no I/O, nothing to fail — there is nothing a
// per-call entry line would tell anyone. Every caller logs.
function haversineMiles(lat1, lng1, lat2, lng2) {
  var toRad = Math.PI / 180;
  var dLat  = (lat2 - lat1) * toRad;
  var dLng  = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return CITY_ASSIGN_EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "MOUNT JULIET, TN" -> { city: 'MOUNT JULIET', state: 'TN' }
// Splits on the LAST comma: city names may contain one, the trailing state code may not.
function parseCityState(cityString) {
  logger.log('cityAssign', 'parseCityState called');
  var s = String(cityString || '').trim();
  var ci = s.lastIndexOf(',');
  if (ci === -1) return { city: s, state: '' };
  return { city: s.slice(0, ci).trim(), state: s.slice(ci + 1).trim().toUpperCase() };
}

// ── INPUTS ────────────────────────────────────────────────────────────────────────────────

// Reads the join ids of the load cards currently rendered.
//
// Selectors and the id lookup are taken verbatim from loadParser.js (see AMAZON_SELECTORS.md,
// "Load card (Layout A)") so the two cannot drift apart about what a card is.
//
// loadParser filters out cards nested inside other cards; we do not need to, because a nested
// match resolves to the same inner div[id] and the dedupe below collapses it. Same result,
// less work.
//
// PURE READS: querySelector / querySelectorAll / .id only. No getBoundingClientRect, no
// offsetWidth/Height, no getComputedStyle — nothing that forces a layout pass. This function
// cannot make the board janky.
// Finds the MAIN results list, excluding "Similar matches" (2026-08-12).
//
// ROOT CAUSE THIS FIXES. The board renders TWO div.load-list elements: the main results and
// the "Similar matches" block (structure documented in filterSimilar.js). The old reader took
// `document.querySelector('div.load-list')` — the FIRST in document order — and assumed that
// was the main one. Live it is not reliably so: a search showing "9 of 9 results" collected 13
// cards, the extra 4 being similar-matches cards. Those never appear in the /search response,
// so they could never join, and the intersection sat at 0/N permanently.
//
// THE STABLE ANCHOR. The main list lives inside the results panel whose class or id contains
// the substring "search-results-summary". Matched as a SUBSTRING on className/id, deliberately
// NOT as a css-<hash> class — those rotate on every Amazon deploy and this repo has already
// been bitten three times by hashed selectors (AMAZON_SELECTORS.md).
//
// Returns null rather than falling back to the document. A fallback would silently re-include
// the similar cards, which is exactly the bug being fixed — better to read nothing and say so.
// ⚠ THE SUMMARY PANEL IS A SIBLING OF THE RESULTS, NOT AN ANCESTOR (captured live 2026-08-13).
// An earlier version walked UP from each load-list looking for this token and found nothing, so
// it read ZERO cards on every cycle. Real structure — see AMAZON_SELECTORS.md:
//
//   div.<hash>
//   ├── div#search-results-summary-panel        <- "Showing 1 - N of N results"
//   ├── div.<hash> > div.load-list              <- MAIN RESULTS
//   └── div.<hash> > ... > div.load-list        <- SIMILAR MATCHES (ignore forever)
//
// Both anchors are stable text-free identifiers. NEVER select on the css-<hash> classes around
// them — those rotate on every Amazon deploy.
var MAIN_PANEL_ID    = 'search-results-summary-panel';
var MAIN_PANEL_CLASS = 'search-results-summary__panel';

// A card's join id is a bare UUID on a div[id] inside the card. Cards also carry non-UUID ids
// such as div[id="STARTING_SOON"], so the shape is the filter — see readRenderedCardIds().
var CARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findMainResultsList() {
  logger.log('cityAssign', 'findMainResultsList called');
  var lists = null;
  var panel = null;
  try {
    lists = document.querySelectorAll('div.load-list');

    // The summary panel — the "Showing 1 - N of N results" block. Id first, since the live DOM
    // carries a real one; the class is the fallback in case the id is dropped.
    panel = document.getElementById(MAIN_PANEL_ID);
    if (!panel) {
      var all = document.querySelectorAll('div');
      for (var a = 0; a < all.length; a++) {
        if (String(all[a].className || '').indexOf(MAIN_PANEL_CLASS) !== -1) {
          panel = all[a];
          break;
        }
      }
    }

    // The panel is a SIBLING of the results, not an ancestor of them. Walk forward from it and
    // take the first load-list found — the main results sit in the next sibling block, and the
    // Similar-matches list is in a later one, so document order does the separating.
    if (panel) {
      var sib = panel.nextElementSibling;
      while (sib) {
        var found = sib.matches && sib.matches('div.load-list')
          ? sib
          : (sib.querySelector ? sib.querySelector('div.load-list') : null);
        if (found) return found;
        sib = sib.nextElementSibling;
      }
    }

    logger.warn('cityAssign', 'main results list not found — reading NO cards rather than ' +
      'falling back to the whole document (that fallback is what re-included similar matches)', {
        panelFound: !!panel, loadListsInDocument: lists ? lists.length : null
      });
    return null;
  } catch (e) {
    logger.error('cityAssign', 'findMainResultsList failed', {
      error: e, panelFound: !!panel, loadListsInDocument: lists ? lists.length : null
    });
    return null;
  }
}

// Reads the board's "Showing 1 - 50 of 230 results" line. Text-anchored, same reasoning as
// originCities.js: the visible copy is far more stable than the hashed classes around it.
//
// ⚠ THE LINE CARRIES TWO DIFFERENT NUMBERS (2026-08-13). This function used to return only the
// "of N" — the GRAND TOTAL — and its caller compared that against the cards on screen. On every
// single-page board (9 of 9, 30 of 30) the two are equal and the bug is invisible; on any
// paginated board they are not, and the mismatch skipped the whole cycle. Captures on disk:
// 50 rendered of 338 total, 50 of 104, 5 of 11. So:
//
//   rendered — how many cards are on screen right now, from the RANGE "1 - 50"
//   total    — how many exist across all pages, from "of 230"
//
// rendered is computed as hi - lo + 1 rather than taken as `hi`, so it stays correct both when
// Amazon replaces the list per page ("Showing 51 - 100 of 230" -> 50) and when it appends on
// scroll ("Showing 1 - 100 of 230" -> 100).
//
// Returns { rendered, total, raw }. Any field is null when it could not be read — never a guess.
// `raw` is the matched line itself, so a parse failure can be diagnosed from the log without
// having to reproduce the board.
function readShowingCounts() {
  logger.log('cityAssign', 'readShowingCounts called');
  // `from`/`to` are the range endpoints, kept since 2026-08-13 because they identify WHICH page
  // is on screen — "Showing 51 - 100" is a different working set from "Showing 1 - 50" even
  // though both render 50 cards, so `rendered` alone cannot tell a page change from a refresh.
  var out = { rendered: null, total: null, raw: null, from: null, to: null };
  try {
    var els = document.querySelectorAll('span, div, p');
    // Both numbers in one pass. The dash class covers hyphen-minus, en dash and em dash — the
    // board uses a plain hyphen today, but the copy is Amazon's and a typographic dash would
    // otherwise silently drop us back to the total-only branch. Written as \u escapes so the
    // class cannot be mangled by an editor or an encoding round-trip.
    var reRange = /Showing\b\D*?([\d,]+)\s*[-\u2010-\u2015]\s*([\d,]+)\s+of\s+([\d,]+)\s+results?/i;
    // Fallback: keeps the total readable on a board that prints no range at all, so the
    // diagnostic line stays useful even when the guard has to stand down.
    var reTotal = /Showing\b[^]*?\bof\s+([\d,]+)\s+results?/i;
    var num = function (s) { return parseInt(String(s).replace(/,/g, ''), 10); };

    for (var i = 0; i < els.length; i++) {
      // Leaf-ish only: an ancestor's textContent would concatenate unrelated copy.
      if (els[i].children && els[i].children.length > 0) continue;
      var t = els[i].textContent;
      if (!t) continue;
      t = t.trim();

      var mr = reRange.exec(t);
      if (mr) {
        var lo = num(mr[1]), hi = num(mr[2]);
        out.raw = t;
        out.total = num(mr[3]);
        // Guard the arithmetic: a reversed or nonsensical range must read as "unknown", not as a
        // negative count that would then compare as "collected MORE" and skip every cycle.
        if (isFinite(lo) && isFinite(hi) && hi >= lo) {
          out.rendered = hi - lo + 1;
          out.from = lo;
          out.to = hi;
        }
        return out;
      }

      var mt = reTotal.exec(t);
      if (mt) { out.raw = t; out.total = num(mt[1]); return out; }
    }
    return out;
  } catch (e) {
    logger.error('cityAssign', 'readShowingCounts failed', { error: e, raw: out.raw });
    return out;
  }
}

function readRenderedCardIds() {
  logger.log('cityAssign', 'readRenderedCardIds called');
  var ids = [];
  try {
    // Scoped to the MAIN list only — see findMainResultsList().
    var mainList = findMainResultsList();
    if (!mainList) return ids;   // already warned; never fall back to the whole document

    // COUNT BY ID SHAPE, NOT BY CARD CLASS (2026-08-13). Measured on a live "9 of 9" board:
    // `div.load-card, div.load-card__selected` found 8, UUID-shaped div[id] found 9, the board
    // said 9. The recently-added/highlighted card carries a different class, so any
    // class-based count silently loses it. Every card's join id is a bare UUID, so matching the
    // shape is both simpler and complete.
    //
    // The filter is load-bearing: cards also contain div[id="STARTING_SOON"], which is not an
    // id we can join on and must never reach the assignment.
    var idEls = mainList.querySelectorAll('div[id]');
    for (var i = 0; i < idEls.length; i++) {
      var id = idEls[i].id;
      if (!id || !CARD_UUID_RE.test(id)) continue;
      if (ids.indexOf(id) === -1) ids.push(id);
    }
  } catch (e) {
    logger.error('cityAssign', 'readRenderedCardIds failed', { error: e });
    return [];
  }
  return ids;
}

// Resolves one origin city to coordinates, via the same cities endpoint Post-a-Truck uses.
//
// ⚠ COST NOTE. resolvePATCity() is a live fetch and is NOT memoised inside patApi.js — every
// call there hits the network (and up to three times, counting its abbreviation and prefix
// retries). This cache is what stops that becoming a per-refresh network call: each distinct
// city is resolved ONCE per page session, then answered from memory forever. A board with 5
// cities refreshing every 20s makes 5 requests total, not 5 per refresh.
// The cache is in-memory only and dies with the page — a reload re-resolves. Whether it should
// persist to chrome.storage is deliberately NOT decided here.
async function resolveCityCoords(cityString) {
  logger.log('cityAssign', 'resolveCityCoords called');
  if (Object.prototype.hasOwnProperty.call(_cityCoordCache, cityString)) {
    return _cityCoordCache[cityString];
  }
  var parsed = parseCityState(cityString);
  try {
    var res = await resolvePATCity({ city: parsed.city, state: parsed.state });
    if (!res || typeof res.latitude !== 'number' || typeof res.longitude !== 'number') {
      _cityCoordCache[cityString] = null;
      logger.warn('cityAssign', 'city coordinates unresolved — city skipped this cycle', {
        city: cityString
      });
      return null;
    }
    _cityCoordCache[cityString] = { lat: res.latitude, lng: res.longitude };
    return _cityCoordCache[cityString];
  } catch (e) {
    // Never throw out of here: one unresolvable city must not abort the whole cycle.
    logger.error('cityAssign', 'resolveCityCoords failed', { error: e, city: cityString });
    _cityCoordCache[cityString] = null;
    return null;
  }
}

// Chooses which captured response describes the board on screen. Since 2026-08-12 this is once
// again the assignment's source, not just a diagnostic — with no accumulator, the cycle matches
// against exactly this response.
//
// A refresh can deliver more than one /search response (other saved-search tabs), and the
// newest is NOT reliably the right one. The right one is whichever shares the most ids with the
// cards actually rendered, so that is what we measure. Both counts are logged so a wrong pick
// is visible rather than silent.
function pickBuffer(cardIds) {
  logger.log('cityAssign', 'pickBuffer called');
  var best = null;
  var bestCount = -1;
  var breakdown = [];
  for (var i = 0; i < _cityAssignBuffers.length; i++) {
    var buf = _cityAssignBuffers[i];
    var n = 0;
    for (var j = 0; j < cardIds.length; j++) {
      if (Object.prototype.hasOwnProperty.call(buf.byId, cardIds[j])) n++;
    }
    breakdown.push(buf.endpoint + '#' + i + ': ' + n + '/' + cardIds.length);
    if (n > bestCount) { bestCount = n; best = buf; }
  }
  if (bestCount <= 0) {
    // Not "cycle skipped": the cycle still runs and reports every card unmatched, so there is
    // exactly one CITY ASSIGN line per cycle whatever happens. On a healthy board this warn
    // should never appear — the response describing the rendered cards is normally buffered.
    // If it does appear, the per-response breakdown below says which responses were held.
    logger.warn('cityAssign', 'no buffered response shares an id with the cards on screen — ' +
      'this cycle will report every card unmatched', {
      buffers: _cityAssignBuffers.length, cardCount: cardIds.length, intersections: breakdown.join(' | ')
    });
    return null;
  }
  logger.log('cityAssign', 'response chosen by id intersection', {
    chosen: best.endpoint, intersection: bestCount + '/' + cardIds.length,
    allBuffers: breakdown.join(' | ')
  });
  return best;
}

// ── DIAGNOSTICS (2026-08-08) ──────────────────────────────────────────────────────────────
//
// Added after a live run showed 6 of 11 cards as "id not in any response", with the missing
// cards all belonging to ONE city (Chicago showed 2, should have been 8). That reason string is
// produced by testing the SELECTED buffer only, so on its own it cannot tell apart:
//
//   A. PAGINATION      — the board shows more cards than the captured page contained, so the
//                        later ones were never in any body we read.
//   B. WRONG RESPONSE  — the ids DO exist, in a buffered response that pickBuffer() did not
//                        select. One /search per saved-search tab would look exactly like this.
//   C. MISSING COORDS  — the ids are in the selected response, but the lat/lng path is absent.
//
// PURE LOGGING. Nothing below changes the assignment, the selection, or the DOM. It re-reads
// state the cycle already has and prints it.

// Small helper — these buffers are plain objects, so there is no .size to read.
function countKeys(obj) {
  var n = 0;
  for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) n++; }
  return n;
}

// Parts 1-3. Deliberately logged BEFORE pickBuffer() decides anything, so a cycle that bails
// out with "no captured response intersects" still leaves the full inventory in the console —
// that cycle is exactly the one worth diagnosing.
function logBufferInventory(cardIds) {
  logger.log('cityAssign', 'logBufferInventory called');
  try {
    // ── 1. what is buffered ──
    logger.log('cityAssign', 'CITY DIAG 1/4  buffered responses this cycle: ' +
      _cityAssignBuffers.length);
    for (var i = 0; i < _cityAssignBuffers.length; i++) {
      var b = _cityAssignBuffers[i];
      var idCount = b.withCoords + countKeys(b.noCoord);
      var total   = (b.totalResultsSize === null || b.totalResultsSize === undefined)
                      ? 'unknown' : b.totalResultsSize;
      var token   = (b.nextItemToken === null || b.nextItemToken === undefined)
                      ? 'none' : b.nextItemToken;
      // "ids" is what this response actually carried; "totalResultsSize" is what the server says
      // exists overall. ids < totalResultsSize means there are pages we never saw.
      logger.log('cityAssign',
        'CITY DIAG 1/4  response #' + i + ' [' + b.endpoint + ']' +
        '  ids: ' + idCount +
        ' (withCoords ' + b.withCoords + ', noCoord ' + countKeys(b.noCoord) + ')' +
        '  totalResultsSize: ' + total +
        '  nextItemToken: ' + token);
    }

    // ── 2. what is on screen ──
    logger.log('cityAssign', 'CITY DIAG 2/4  load-card ids in DOM: ' + cardIds.length);

    // ── 3. overlap, per response ──
    var parts = [];
    for (var j = 0; j < _cityAssignBuffers.length; j++) {
      var bb = _cityAssignBuffers[j];
      var hit = 0;
      for (var k = 0; k < cardIds.length; k++) {
        if (Object.prototype.hasOwnProperty.call(bb.byId, cardIds[k]) ||
            Object.prototype.hasOwnProperty.call(bb.noCoord, cardIds[k])) hit++;
      }
      parts.push('#' + j + ' [' + bb.endpoint + ']: ' + hit + '/' + cardIds.length);
    }
    logger.log('cityAssign', 'CITY DIAG 3/4  DOM ids found in each response: ' +
      (parts.length ? parts.join(' | ') : '(no responses buffered)'));
  } catch (e) {
    logger.error('cityAssign', 'logBufferInventory failed', { error: e, cards: cardIds.length });
  }
}

// ── ID-SHAPE SAMPLES (2026-08-08) ─────────────────────────────────────────────────────────
//
// Added after a live run reported 0/50 overlap across ALL FOUR buffers. A pagination gap would
// still match the captured page, so zero overlap means the two id sets are simply not the same
// strings. Everything below prints RAW VALUES and containment results — it draws no conclusion
// and changes no behaviour.
//
// Pipe-wrapped (|like this|) so leading/trailing whitespace is visible in the console.

function pipe(v) {
  if (v === null || v === undefined) return '(' + String(v) + ')';
  return '|' + String(v) + '|';
}

// Every data-* attribute on one element, as "name=|value|" strings.
function collectDataAttrs(el) {
  var out = [];
  try {
    var attrs = (el && el.attributes) || [];
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.lastIndexOf('data-', 0) === 0) {
        out.push(attrs[i].name + '=' + pipe(attrs[i].value));
      }
    }
  } catch (e) {
    logger.error('cityAssign', 'collectDataAttrs failed', { error: e });
  }
  return out;
}

// Sweeps the WHOLE card for data-* values that look like a UUID. If the join key is not on an
// id attribute at all, this is what finds it — and it is the first thing to check when the DOM
// and JSON id sets share nothing.
function findUuidLikeDataAttrs(card) {
  var hits = [];
  try {
    var all = card.querySelectorAll('*');
    var re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (var i = 0; i < all.length && hits.length < 6; i++) {
      var attrs = all[i].attributes || [];
      for (var j = 0; j < attrs.length; j++) {
        if (attrs[j].name.lastIndexOf('data-', 0) !== 0) continue;
        if (!re.test(attrs[j].value)) continue;
        hits.push('<' + all[i].tagName + '> ' + attrs[j].name + '=' + pipe(attrs[j].value));
        break;
      }
    }
  } catch (e) {
    logger.error('cityAssign', 'findUuidLikeDataAttrs failed', { error: e });
  }
  return hits;
}

// Where the DOM id actually comes from. readRenderedCardIds() takes the FIRST descendant
// matching 'div[id]' — which is only correct if that descendant is the load. If Amazon wrapped
// the card in anything id-bearing, we would be reading a layout wrapper and never know. So this
// lists EVERY id-bearing descendant plus every data-* attribute, not just the one we pick.
function readCardIdProvenance(limit) {
  logger.log('cityAssign', 'readCardIdProvenance called');
  var out = [];
  try {
    // Same scope as readRenderedCardIds (2026-08-12) — otherwise this diagnostic would print
    // similar-matches cards the reader no longer collects, and the two would disagree.
    var mainList = findMainResultsList();
    if (!mainList) return out;
    var cards = mainList.querySelectorAll(
      'div.load-card, div.load-card__selected, div.wo-card-header--highlighted'
    );
    for (var i = 0; i < cards.length && out.length < limit; i++) {
      var card = cards[i];
      var chosen = card.querySelector('div[id]');
      var withId = card.querySelectorAll('[id]');
      var idEls = [];
      for (var j = 0; j < withId.length && j < 8; j++) {
        idEls.push({
          tag: withId[j].tagName,
          isChosen: withId[j] === chosen,
          // className can be an SVGAnimatedString; String() keeps this from throwing.
          cls: String(withId[j].className || '').slice(0, 60),
          idProp: withId[j].id,
          idAttr: withId[j].getAttribute ? withId[j].getAttribute('id') : null,
          // data-* on EVERY id-bearing element, not just the chosen one. When the join is
          // broken the real key is most likely on an element we are NOT reading, so listing
          // only the chosen element's attributes would hide exactly what we are looking for.
          data: collectDataAttrs(withId[j])
        });
      }
      out.push({
        cardTag: card.tagName, cardCls: String(card.className || '').slice(0, 80),
        cardDataAttrs: collectDataAttrs(card),
        chosenData: chosen ? collectDataAttrs(chosen) : [],
        uuidLikeData: findUuidLikeDataAttrs(card),
        idEls: idEls, idElCount: withId.length
      });
    }
  } catch (e) {
    logger.error('cityAssign', 'readCardIdProvenance failed', { error: e });
  }
  return out;
}

// Index of the first differing character, or -1 when one is a prefix of the other.
function firstDivergence(a, b) {
  var n = Math.min(a.length, b.length);
  for (var i = 0; i < n; i++) { if (a.charAt(i) !== b.charAt(i)) return i; }
  return (a.length === b.length) ? -1 : n;
}

// Of all ids in a response, the one sharing the longest prefix with `domId` — the most
// informative thing to diff against when nothing matches exactly.
function nearestJsonId(domId, buf) {
  var best = null, bestLen = -1;
  var keys = [];
  for (var k in buf.byId) { if (Object.prototype.hasOwnProperty.call(buf.byId, k)) keys.push(k); }
  for (var k2 in buf.noCoord) {
    if (Object.prototype.hasOwnProperty.call(buf.noCoord, k2)) keys.push(k2);
  }
  for (var i = 0; i < keys.length; i++) {
    var d = firstDivergence(domId, keys[i]);
    var shared = (d === -1) ? Math.min(domId.length, keys[i].length) : d;
    if (shared > bestLen) { bestLen = shared; best = keys[i]; }
  }
  return { id: best, shared: bestLen };
}

function logIdShapeSamples(cardIds) {
  logger.log('cityAssign', 'logIdShapeSamples called');
  try {
    var buf0 = _cityAssignBuffers.length ? _cityAssignBuffers[0] : null;

    // ── 1. the DOM side, raw ──
    logger.log('cityAssign',
      'CITY RAW 1  DOM ids read from: getElementById("' + MAIN_PANEL_ID + '") ' +
      '-> its FOLLOWING SIBLINGS -> first div.load-list found (main results ONLY, ' +
      'similar-matches excluded) -> .querySelectorAll("div[id]") -> the .id DOM PROPERTY, ' +
      'kept only when it is a bare UUID (this is what excludes div[id="STARTING_SOON"])');
    for (var i = 0; i < cardIds.length && i < 3; i++) {
      logger.log('cityAssign', 'CITY RAW 1  DOM ID [' + i + ']: ' + pipe(cardIds[i]) +
        '  length: ' + cardIds[i].length);
    }
    var prov = readCardIdProvenance(3);
    for (var p = 0; p < prov.length; p++) {
      var pr = prov[p];
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] <' + pr.cardTag + '> class=' +
        pipe(pr.cardCls) + '  data-* on card: ' +
        (pr.cardDataAttrs.length ? pr.cardDataAttrs.join(' ') : '(none)') +
        '  data-* on chosen id element: ' +
        (pr.chosenData.length ? pr.chosenData.join(' ') : '(none)'));
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] has ' + pr.idElCount +
        ' id-bearing descendant(s); first ' + pr.idEls.length + ':');
      for (var q = 0; q < pr.idEls.length; q++) {
        var e = pr.idEls[q];
        logger.log('cityAssign', 'CITY RAW 1    ' + (e.isChosen ? '>> CHOSEN ' : '   ') +
          '<' + e.tag + '> class=' + pipe(e.cls) +
          '  .id=' + pipe(e.idProp) + '  getAttribute("id")=' + pipe(e.idAttr) +
          '  (.id and getAttribute agree: ' + (e.idProp === e.idAttr) + ')' +
          '  data-*: ' + (e.data.length ? e.data.join(' ') : '(none)'));
      }
      // The single most useful line when the two id sets share nothing: a UUID sitting in a
      // data-* attribute means the join key exists in the DOM, just not where we read it.
      logger.log('cityAssign', 'CITY RAW 1  card [' + p + '] UUID-shaped data-* anywhere in ' +
        'the card: ' + (pr.uuidLikeData.length ? pr.uuidLikeData.join('  ') : '(none found)'));
    }

    // ── 2. the JSON side, raw ──
    if (!buf0) {
      logger.log('cityAssign', 'CITY RAW 2  no response buffered — nothing to sample');
    } else {
      logger.log('cityAssign', 'CITY RAW 2  response #0 [' + buf0.endpoint + '] rawBodyLength: ' +
        buf0.rawBodyLength + (buf0.rawBodyTruncated ? ' (TRUNCATED for the probe)' : ''));
      var samples = buf0.idSamples || [];
      if (!samples.length) logger.log('cityAssign', 'CITY RAW 2  no id samples in response #0');
      for (var s = 0; s < samples.length; s++) {
        logger.log('cityAssign', 'CITY RAW 2  JSON ID [' + s + '] from ' + samples[s].path +
          ': ' + pipe(samples[s].id) +
          '  length: ' + (samples[s].id === null ? 'n/a' : samples[s].id.length) +
          '  typeof: ' + samples[s].idType);
      }
    }

    // ── 3. containment, both directions ──
    // The point of scanning the WHOLE body rather than the id field: if the DOM id exists in the
    // response under some other key, the join is looking in the wrong place, not at absent data.
    if (buf0 && cardIds.length) {
      var dom0 = cardIds[0];
      var inBody = (typeof buf0.rawBody === 'string') ? buf0.rawBody.indexOf(dom0) !== -1 : null;
      logger.log('cityAssign', 'CITY RAW 3  DOM ID [0] ' + pipe(dom0) +
        ' appears anywhere in response #0 raw text: ' +
        (inBody === null ? 'UNKNOWN (no raw body retained)' : (inBody ? 'YES' : 'NO')) +
        (buf0.rawBodyTruncated ? '  ⚠ body was truncated — a NO here is not proof of absence' : ''));
    }
    if (buf0 && buf0.idSamples && buf0.idSamples.length && buf0.idSamples[0].id) {
      var json0 = buf0.idSamples[0].id;
      // innerHTML, not textContent: ids live in attributes, which textContent does not include.
      // This is a read; it serialises the DOM but forces no layout.
      var html = (document.body && document.body.innerHTML) || '';
      logger.log('cityAssign', 'CITY RAW 3  JSON ID [0] ' + pipe(json0) +
        ' appears anywhere in document.body.innerHTML: ' +
        (html.indexOf(json0) !== -1 ? 'YES' : 'NO') +
        '  (searched ' + html.length + ' chars)');
    }

    // ── 4. character-by-character divergence ──
    if (buf0 && cardIds.length) {
      var d0 = cardIds[0];
      var near = nearestJsonId(d0, buf0);
      if (!near.id) {
        logger.log('cityAssign', 'CITY RAW 4  response #0 contains no ids to compare against');
      } else {
        var at = firstDivergence(d0, near.id);
        logger.log('cityAssign', 'CITY RAW 4  nearest JSON id to DOM ID [0]:');
        logger.log('cityAssign', 'CITY RAW 4    DOM : ' + pipe(d0) + '  (len ' + d0.length + ')');
        logger.log('cityAssign', 'CITY RAW 4    JSON: ' + pipe(near.id) + '  (len ' + near.id.length + ')');
        if (at === -1) {
          logger.log('cityAssign', 'CITY RAW 4    IDENTICAL — if the join still fails the ' +
            'lookup key is wrong, not the string');
        } else {
          logger.log('cityAssign', 'CITY RAW 4    shared prefix: ' + at + ' char(s) = ' +
            pipe(d0.slice(0, at)) +
            '  |  first difference at index ' + at + ': DOM ' + pipe(d0.charAt(at)) +
            ' vs JSON ' + pipe(near.id.charAt(at)));
          logger.log('cityAssign', 'CITY RAW 4    DOM remainder after divergence: ' +
            pipe(d0.slice(at)) + '  JSON remainder: ' + pipe(near.id.slice(at)));
        }
      }
      // Shape hints — decoration on the DOM id is the usual cause of a whole-set mismatch.
      //
      // Every test below runs on the TRIMMED value, with whitespace reported separately.
      // Testing the raw string instead lets a stray space mask everything else: /[-_]\d+$/
      // cannot match "…-2 ", so a real trailing index would go unreported purely because the
      // id also had whitespace.
      var hints = [];
      var t0 = d0.trim();
      if (d0 !== t0) hints.push('has leading/trailing WHITESPACE (all checks below use the ' +
        'trimmed value ' + pipe(t0) + ')');
      if (t0.indexOf(':') !== -1) hints.push('contains a COLON segment -> ' +
        pipe(t0.slice(0, t0.indexOf(':'))) + ' + ' + pipe(t0.slice(t0.indexOf(':'))));
      var m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(t0);
      if (m && m.index > 0) hints.push('UUID is PREFIXED by ' + pipe(t0.slice(0, m.index)));
      if (m && (m.index + m[1].length) < t0.length) {
        hints.push('UUID is SUFFIXED by ' + pipe(t0.slice(m.index + m[1].length)));
      }
      if (/[-_]\d+$/.test(t0)) hints.push('ends with a TRAILING INDEX -> ' +
        pipe(/[-_]\d+$/.exec(t0)[0]));
      if (!m) hints.push('contains NO UUID at all');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t0)) {
        hints.push('NOT a bare UUID');
      }
      logger.log('cityAssign', 'CITY RAW 4  DOM ID [0] shape: ' +
        (hints.length ? hints.join(' | ') : 'bare UUID, no decoration detected'));
    }
  } catch (e) {
    logger.error('cityAssign', 'logIdShapeSamples failed', {
      error: e, cards: cardIds ? cardIds.length : null, buffers: _cityAssignBuffers.length
    });
  }
}

// Part 4 — the one that actually separates A from B from C.
//
// Takes the unmatched list the cycle just built and asks, for each id, where it COULD have been
// found: nowhere at all, in a response we passed over, or in the one we picked but without
// coordinates.
function logUnmatchedProvenance(unmatched, chosen, cardIds) {
  logger.log('cityAssign', 'logUnmatchedProvenance called');
  try {
    var absentAll = 0;          // in no buffered response at all       -> A (or never captured)
    var inOther = 0;            // in a response we did NOT select      -> B
    var inChosenNoCoord = 0;    // in the selected response, no lat/lng -> C
    var tooFar = 0;             // matched fine, just implausibly far   -> none of the three
    var otherWhere = [];        // which non-selected response held it

    for (var i = 0; i < unmatched.length; i++) {
      var id = unmatched[i].id;
      // Distance rejections are not lookup failures — counted separately so they cannot be
      // mistaken for a data problem.
      if (unmatched[i].why.indexOf('nearest city') === 0) { tooFar++; continue; }

      if (chosen && Object.prototype.hasOwnProperty.call(chosen.noCoord, id)) {
        inChosenNoCoord++;
        continue;
      }
      var foundElsewhere = -1;
      for (var b = 0; b < _cityAssignBuffers.length; b++) {
        var buf = _cityAssignBuffers[b];
        if (buf === chosen) continue;
        if (Object.prototype.hasOwnProperty.call(buf.byId, id) ||
            Object.prototype.hasOwnProperty.call(buf.noCoord, id)) { foundElsewhere = b; break; }
      }
      if (foundElsewhere !== -1) {
        inOther++;
        if (otherWhere.indexOf(foundElsewhere) === -1) otherWhere.push(foundElsewhere);
      } else {
        absentAll++;
      }
    }

    logger.log('cityAssign',
      'CITY DIAG 4/4  unmatched provenance — ' +
      'absent from ALL responses: ' + absentAll + ' | ' +
      'present in a NON-selected response: ' + inOther +
        (otherWhere.length ? ' (in response #' + otherWhere.join(', #') + ')' : '') + ' | ' +
      'in selected response but no coords: ' + inChosenNoCoord + ' | ' +
      'over max distance: ' + tooFar);

    // ── VERDICT ──
    // A hint, not a proof: it reports which hypothesis the numbers are CONSISTENT WITH. The
    // counts above are the evidence; this line just saves reading them cold.
    var verdict;
    if (inOther > 0) {
      verdict = 'B (WRONG RESPONSE SELECTED) — those ids were buffered, in a response ' +
                'pickBuffer() passed over. One /search per saved-search tab looks like this. ' +
                'Fix direction: merge all buffers instead of picking one.';
    } else if (inChosenNoCoord > 0) {
      verdict = 'C (MISSING COORDINATES) — the ids are in the selected response, but its ' +
                'loads[0].stops[0].location has no numeric lat/lng. Fix direction: the ' +
                'coordinate path, not the selection.';
    } else if (absentAll > 0) {
      // Pagination only explains this if the capture was genuinely short of the full result set.
      var chosenIds = chosen ? (chosen.withCoords + countKeys(chosen.noCoord)) : 0;
      var paginated = !!chosen &&
        ((chosen.nextItemToken !== null && chosen.nextItemToken !== undefined) ||
         (typeof chosen.totalResultsSize === 'number' && chosen.totalResultsSize > chosenIds));
      if (paginated) {
        verdict = 'A (PAGINATION) — ' + absentAll + ' id(s) in no captured response, and the ' +
                  'selected response is short of the full set (ids ' + chosenIds +
                  ', totalResultsSize ' + chosen.totalResultsSize +
                  ', nextItemToken ' + (chosen.nextItemToken === null ||
                    chosen.nextItemToken === undefined ? 'none' : chosen.nextItemToken) +
                  '). Fix direction: capture the later pages.';
      } else {
        verdict = 'NONE OF A/B/C — ' + absentAll + ' id(s) are in NO buffered response, yet the ' +
                  'selected response is NOT paginated short (ids ' + chosenIds +
                  ', totalResultsSize ' + (chosen ? chosen.totalResultsSize : 'n/a') +
                  ', nextItemToken none). So the request carrying them was never captured at ' +
                  'all — it fired before the observer installed, was served from cache, or ' +
                  'used an endpoint outside CAPTURE_PATHS. Fix direction: find the missing ' +
                  'request, not the assignment logic.';
      }
    } else {
      verdict = 'no unmatched lookup failures this cycle';
    }
    logger.log('cityAssign', 'CITY DIAG VERDICT  ' + verdict);
  } catch (e) {
    logger.error('cityAssign', 'logUnmatchedProvenance failed', {
      error: e, unmatched: unmatched ? unmatched.length : null, cards: cardIds ? cardIds.length : null
    });
  }
}

// ── CITY FILTER (2026-08-13) ──────────────────────────────────────────────────────────────
//
// ⚠ THE ONLY CODE IN THIS FILE THAT CHANGES WHAT THE DISPATCHER SEES. Everything else logs.
// Gated behind CITY_FILTER_ENABLED, which ships OFF; with it off nothing below writes a style.
//
// DESIGN RULES, each chosen so the worst outcome is "too many loads shown", never "too few":
//   1. HIDE, NEVER REMOVE. Only style.display is written, and the previous inline value is
//      recorded so the restore is exact. No remove(), no detach, no reorder, no innerHTML, no
//      change to card contents, no attributes added to Amazon's nodes.
//   2. AN UNASSIGNED CARD IS NEVER HIDDEN. A load the dispatcher cannot see is a load he cannot
//      book, so anything we could not confidently assign stays visible.
//   3. THE SIMILAR-MATCHES LIST IS NEVER TOUCHED — not hidden, not shown, not even read. Only
//      cards inside findMainResultsList() are eligible.
//   4. EVERY APPLY RESTORES FIRST. Amazon re-renders the list on each refresh, so re-applying
//      from a clean slate is what makes the filter reassert itself on new nodes AND makes a card
//      that has become unassigned visible again.
//
// WHY display:none IS SAFE FOR THE REST OF THE PIPELINE: the card stays in the DOM, so
// loadParser still parses it and it stays in knownLoadIds. Hiding can therefore never make a
// card look "new" on the next cycle, and cannot affect the alert, the highlight, or auto-open.

// True when the assignment pipeline should run at all. The filter feature needs it; the debug
// diagnostics also need it. Either reason is sufficient.
function cityAssignEnabled() {
  var filterOn = (typeof CITY_FILTER_ENABLED !== 'undefined') && CITY_FILTER_ENABLED;
  var debugOn  = (typeof CITY_ASSIGN_DEBUG  !== 'undefined') && CITY_ASSIGN_DEBUG;
  return filterOn || debugOn;
}

// True only for the verbose CITY DIAG / CITY RAW blocks, which stay debug-gated so a shipped
// build at DEBUG_LEVEL 1 prints nothing and does no diagnostic work.
function cityVerboseDiagnostics() {
  return (typeof CITY_ASSIGN_DEBUG !== 'undefined') && CITY_ASSIGN_DEBUG;
}

var _cityFilterActive = null;   // null = showing all; otherwise the city key being shown
var _cityFilterHidden = [];     // [{ el, hadInline, prevDisplay }] — for an exact restore
var _cityAssignByCard = {};     // id -> assigned city name, or null; rebuilt every cycle

// Card container for an id-bearing div. Returns null when the container cannot be identified,
// which the caller treats as "do not hide" — see rule 2.
function cardContainerFor(idEl, mainList) {
  try {
    if (!idEl || typeof idEl.closest !== 'function') return null;
    var byClass = idEl.closest('div.load-card, div.load-card__selected, div.wo-card-header--highlighted');
    if (byClass) return byClass;

    // FALLBACK (2026-08-13). The class list is not exhaustive: a recently-added card can carry a
    // shape none of these match — measured live, 8 by class against 9 by UUID id.
    //
    // Under the capture-based source that card was still ASSIGNED (ids were collected class-
    // agnostically) and merely could not be hidden. Now that assignment reads the container, no
    // container meant no assignment at all, so the card fell out of the coverage count entirely.
    // Same visible outcome — it stays on screen — but it made "every rendered card is assigned"
    // false, which is the promise this whole change is judged on.
    //
    // Walk UP to the child of the main list, which IS the card wrapper whatever it is called.
    // BOUNDED DELIBERATELY: never return the list itself, and never anything above it. Hiding
    // the list would blank the entire board — the one failure this feature must never produce.
    if (mainList && idEl !== mainList) {
      var n = idEl;
      while (n && n.parentElement && n.parentElement !== mainList) n = n.parentElement;
      if (n && n.parentElement === mainList) return n;
    }
    return null;
  } catch (e) {
    logger.error('cityAssign', 'cardContainerFor failed', { error: e });
    return null;
  }
}

// Every main-list card as { id, el }. MAIN LIST ONLY — the similar list is unreachable from
// here by construction, because findMainResultsList() never returns it.
function readMainCardElements() {
  logger.log('cityAssign', 'readMainCardElements called');
  var out = [];
  try {
    var mainList = findMainResultsList();
    if (!mainList) return out;
    var idEls = mainList.querySelectorAll('div[id]');
    for (var i = 0; i < idEls.length; i++) {
      var id = idEls[i].id;
      if (!id || !CARD_UUID_RE.test(id)) continue;
      var container = cardContainerFor(idEls[i], mainList);
      if (!container) continue;              // cannot identify the card -> never hide it
      out.push({ id: id, el: container });
    }
  } catch (e) {
    logger.error('cityAssign', 'readMainCardElements failed', { error: e });
    return [];
  }
  return out;
}

// ── PER-CITY DEADHEAD (2026-08-13, Ihor's decision) ───────────────────────────────────────
//
// THE PROBLEM. Amazon's deadhead is ONE value per load — the distance to the NEAREST of the five
// origin cities in the search. A load 5 mi from HEBRON, KY still prints "5 mi" on the COLUMBUS, OH
// tab, where it is really ~100 mi away. One DOM node, one number; the filter only hides and shows
// the card around it.
//
// MEASURED, NOT ASSUMED: the payload has NO per-origin-city deadhead. `deadhead` is a single
// {value, unit} scalar on every work opportunity across all captures on disk — 204 distinct key
// paths searched, nothing per-city. So the figure has to be computed. See api-samples.md.
//
// It is also STRAIGHT-LINE, not road miles, which is what makes substituting ours honest: across
// the 50-load five-city capture, Amazon's value is LOWER than a straight line on 42 of 50 loads,
// and road distance can never be lower than a straight line. The small residual (mean -1 mi, max
// 4.1) is Amazon measuring from its own city-centre point rather than ours.
//
// RULES, exactly as Ihor set them:
//   - Replace, never append. One number on the card.
//   - ONLY on loads that belong to 2+ active cities. On a one-city load Amazon's number IS the
//     distance to that city, so touching it would add error for nothing.
//   - Nothing at all on "All".
//   - Unknown coordinates: leave Amazon's value alone.
//
// The anchor is `span[title="Deadhead"]` — derived from samples/paired-card.html, where it occurs
// exactly once and the VALUE is its previousElementSibling. A title attribute, not a css-<hash>.
var DEADHEAD_LABEL_SELECTOR = 'span[title="Deadhead"]';
var DEADHEAD_TESTID         = 'ext-city-deadhead';

// ── THE UNASSIGNED MARKER (2026-08-20, Ihor) ──────────────────────────────────────────────
//
// A load whose origin we could not determine now appears under "All" ONLY, and says so on the
// card. Before this, an unassigned load was shown under EVERY city tab — and a YORK, PA load
// appeared under the HEBRON, KY tab. Ihor: a dispatcher who believes he is booking near Hebron
// and is actually 450 miles away is a money problem, not a cosmetic one.
//
// ⚠ THIS REFINES SETTLED RULE 9, IT DOES NOT OVERTURN IT. Rule 9 keeps unassigned loads VISIBLE
// and counted, because a silently broken assignment once looked exactly like a working filter.
// That still holds. What changed is where "visible" means: visible IN "All", not visible under
// every city. See docs/HANDOFF.md, rule 9.
var UNASSIGNED_TESTID       = 'ext-city-unassigned';
var UNASSIGNED_TEXT         = 'Origin not determined';
var UNASSIGNED_TITLE        = 'Torren Relay could not determine this load\'s origin city, so it ' +
                              'is shown only under All. Check the load before booking.';
var _unassignedMarked       = [];   // [{ cardEl, ourEl }] — exactly what we inserted

// One record per patched card, so the restore is exact rather than a best guess.
var _deadheadPatched = [];

// Amazon's deadhead VALUE node for a card, or null when the card has no deadhead block.
function findDeadheadValue(cardEl) {
  try {
    if (!cardEl || !cardEl.querySelector) return null;
    var label = cardEl.querySelector(DEADHEAD_LABEL_SELECTOR);
    if (!label) return null;
    return label.previousElementSibling || null;
  } catch (e) {
    logger.error('cityAssign', 'findDeadheadValue failed', { error: e });
    return null;
  }
}

// Undoes every deadhead substitution, exactly. Restores the original inline display (including
// "no inline display at all") and removes our node. Safe to call at any time.
function restoreDeadheads() {
  logger.log('cityAssign', 'restoreDeadheads called');
  var restored = 0, swept = 0;
  try {
    for (var i = 0; i < _deadheadPatched.length; i++) {
      var rec = _deadheadPatched[i];
      if (!rec) continue;
      try {
        if (rec.ourEl && rec.ourEl.parentNode) {
          if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'removeChild deadhead', rec.ourEl, 'attached', 'detached');
          rec.ourEl.parentNode.removeChild(rec.ourEl);
        }
        // IDEMPOTENT (2026-08-19): a card already restored is not written to again. The
        // removeChild above is already guarded by rec.ourEl.parentNode; this guards the style.
        if (rec.valueEl && rec.valueEl.style) {
          var backTo = rec.hadInline ? rec.prevDisplay : '';
          if ((rec.valueEl.style.display || '') !== backTo) {
            if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(deadhead restore)', rec.valueEl, rec.valueEl.style.display, backTo);
            if (rec.hadInline) rec.valueEl.style.display = rec.prevDisplay;
            else rec.valueEl.style.removeProperty('display');
          }
        }
        restored++;
      } catch (e1) {
        logger.error('cityAssign', 'one deadhead restore failed — continuing', { error: e1 });
      }
    }
    _deadheadPatched = [];

    // Orphan sweep, same reasoning as restoreAllCards(): an extension reload leaves our nodes in
    // the DOM with an empty tracker. Without this the dispatcher would be left reading a number
    // nothing is updating.
    var stray = document.querySelectorAll('[data-testid="' + DEADHEAD_TESTID + '"]');
    for (var s = 0; s < stray.length; s++) {
      var el = stray[s];
      if (!el.parentNode) continue;
      // Un-hide whatever sibling we hid before removing ourselves, so the card is never left
      // with NO number at all.
      var sib = el.nextElementSibling;
      if (sib && sib.style && sib.style.display === 'none') {
        if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(deadhead sweep)', sib, 'none', '');
        sib.style.removeProperty('display');
      }
      if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'removeChild deadhead-sweep', el, 'attached', 'detached');
      el.parentNode.removeChild(el);
      swept++;
    }
    if (restored > 0 || swept > 0) {
      logger.log('cityAssign', 'CITY DEADHEAD  restored ' + restored + ', swept ' + swept + ' orphan(s)');
    }
  } catch (e) {
    logger.error('cityAssign', 'restoreDeadheads failed', { error: e });
    _deadheadPatched = [];
  }
}

// Substitutes our distance-to-the-active-city on multi-city loads only.
// `cards` are the ones the filter just left VISIBLE; `activeCity` is resolved to coordinates.
function applyCityDeadheads(cards, activeCity) {
  logger.log('cityAssign', 'applyCityDeadheads called');
  // IDEMPOTENT SINCE 2026-08-19. A card already showing the value we would write is left
  // COMPLETELY untouched: no removeChild, no insertBefore, no style write. Only cards whose
  // desired state differs from their current state are written to.
  //
  // Three passes, because "what should be there" has to be known before "what is there" can be
  // judged. Pass 1 writes nothing at all.
  var replaced = 0, updated = 0, unchanged = 0, undone = 0;
  var singleCity = 0, noCoords = 0, noNode = 0;
  try {
    if (!activeCity) return { replaced: 0 };

    // ── PASS 1: the DESIRED state. Read-only. ────────────────────────────────────────────
    // Keyed on the value ELEMENT, not the load id: a duplicate id (readMainCardElements has no
    // dedupe) means two real elements, and today both are substituted. Keying on the id would
    // silently drop one and change what is rendered.
    var desired = [];
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].id;
      var assigned = Object.prototype.hasOwnProperty.call(_cityAssignByCard, id)
        ? _cityAssignByCard[id] : null;

      // Rule 2: exactly one membership -> Amazon's number is already this city's distance.
      if (!assigned || assigned.length < 2) { singleCity++; continue; }

      // Rule 6: no coordinates -> leave Amazon's value untouched.
      var pickup = Object.prototype.hasOwnProperty.call(_cityPickupById, id)
        ? _cityPickupById[id] : null;
      if (!pickup) { noCoords++; continue; }

      var valueEl = findDeadheadValue(cards[i].el);
      if (!valueEl || !valueEl.style) { noNode++; continue; }

      var miles = haversineMiles(pickup.lat, pickup.lng, activeCity.lat, activeCity.lng);
      desired.push({
        id: id, valueEl: valueEl,
        text:  formatMiles(miles),
        title: 'Deadhead to ' + activeCity.name + ' (Torren Relay)',
        done:  false
      });
    }

    // ── PASS 2: judge what is ALREADY there. ─────────────────────────────────────────────
    var survivors = [];
    for (var k = 0; k < _deadheadPatched.length; k++) {
      var rec = _deadheadPatched[k];
      if (!rec) continue;

      // Match on the value element — the node actually being stood in for.
      var want = null;
      for (var w = 0; w < desired.length; w++) {
        if (!desired[w].done && desired[w].valueEl === rec.valueEl) { want = desired[w]; break; }
      }

      var attached = !!(rec.ourEl && rec.ourEl.parentNode);
      if (want && attached) {
        var textOk  = (rec.ourEl.textContent === want.text);
        var titleOk = (typeof rec.ourEl.getAttribute !== 'function') ||
                      (rec.ourEl.getAttribute('title') === want.title);
        var hiddenOk = !!(rec.valueEl && rec.valueEl.style && rec.valueEl.style.display === 'none');

        if (textOk && titleOk && hiddenOk) {
          // ALREADY IN THE DESIRED STATE — the whole point of this change. Zero DOM writes.
          want.done = true; survivors.push(rec); unchanged++;
          continue;
        }

        // Wrong VALUE only (a city switch, or a moved load). Update in place rather than
        // remove-and-reinsert: textContent and attributes are not childList, so this cannot wake
        // the observer, and the rendered result is identical either way.
        if (!textOk) {
          if (cityVerboseDiagnostics()) cityDiagWrite('characterData', 'textContent deadhead', rec.ourEl, rec.ourEl.textContent, want.text);
          rec.ourEl.textContent = want.text;
        }
        if (!titleOk) {
          if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'title deadhead', rec.ourEl, rec.ourEl.getAttribute('title'), want.title);
          rec.ourEl.setAttribute('title', want.title);
        }
        if (!hiddenOk && rec.valueEl && rec.valueEl.style) {
          if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(hide Amazon value)', rec.valueEl, rec.valueEl.style.display, 'none');
          rec.valueEl.style.display = 'none';
        }
        rec.text = want.text; rec.title = want.title;
        want.done = true; survivors.push(rec); updated++;
        continue;
      }

      // Either this card is no longer eligible, or Amazon replaced the node under us. Undo what
      // is still ours, exactly as restoreDeadheads would, and let pass 3 rebuild if wanted.
      try {
        if (attached) {
          if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'removeChild deadhead', rec.ourEl, 'attached', 'detached');
          rec.ourEl.parentNode.removeChild(rec.ourEl);
        }
        if (rec.valueEl && rec.valueEl.style) {
          var back = rec.hadInline ? rec.prevDisplay : '';
          if ((rec.valueEl.style.display || '') !== back) {
            if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(deadhead restore)', rec.valueEl, rec.valueEl.style.display, back);
            if (rec.hadInline) rec.valueEl.style.display = rec.prevDisplay;
            else rec.valueEl.style.removeProperty('display');
          }
        }
        undone++;
      } catch (e1) {
        logger.error('cityAssign', 'one deadhead reconcile-undo failed — continuing', { error: e1 });
      }
    }
    _deadheadPatched = survivors;

    // ── PASS 3: insert what is still missing. ────────────────────────────────────────────
    for (var d = 0; d < desired.length; d++) {
      var want2 = desired[d];
      if (want2.done) continue;
      var valueEl2 = want2.valueEl;

      // OUR node. textContent only — never innerHTML, and never a read of Amazon's text.
      // font/colour inherit, so it carries the same size, weight and colour as the value it
      // stands in for and the card does not look edited. No hardcoded colour, no hash class.
      var ours = document.createElement('span');
      ours.setAttribute('data-testid', DEADHEAD_TESTID);
      ours.setAttribute('title', want2.title);
      ours.style.font = 'inherit';
      ours.style.color = 'inherit';
      ours.textContent = want2.text;

      var hadInline = !!(valueEl2.style.display && valueEl2.style.display.length);
      _deadheadPatched.push({
        id: want2.id, valueEl: valueEl2, hadInline: hadInline,
        prevDisplay: valueEl2.style.display, ourEl: ours,
        text: want2.text, title: want2.title
      });

      // Rule 4: hide with display only. The node stays, its text is never touched.
      if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'insertBefore deadhead', ours, 'detached', 'attached');
      valueEl2.parentNode.insertBefore(ours, valueEl2);
      if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(hide Amazon value)', valueEl2, valueEl2.style.display, 'none');
      valueEl2.style.display = 'none';
      replaced++;
    }

    if (replaced > 0 || updated > 0 || undone > 0) {
      logger.log('cityAssign', 'CITY DEADHEAD  ' + activeCity.name + ' — inserted ' + replaced +
        ', updated in place ' + updated + ', removed ' + undone + ', ALREADY CORRECT (no write) ' +
        unchanged + '  |  left alone: ' + singleCity + ' single-city, ' +
        noCoords + ' without coordinates, ' + noNode + ' with no deadhead node');
    } else if (unchanged > 0) {
      logger.log('cityAssign', 'CITY DEADHEAD  ' + activeCity.name + ' — ' + unchanged +
        ' substitution(s) ALREADY CORRECT, no DOM write performed');
    }
    return { replaced: replaced, updated: updated, unchanged: unchanged, undone: undone,
             singleCity: singleCity, noCoords: noCoords, noNode: noNode };
  } catch (e) {
    logger.error('cityAssign', 'applyCityDeadheads failed — restoring Amazon values', { error: e });
    restoreDeadheads();
    return { replaced: 0, error: true };
  }
}

// Matches Amazon's own formatting: one decimal place and " mi", e.g. "33.9 mi".
function formatMiles(miles) {
  var n = Math.round(miles * 10) / 10;
  return n.toFixed(1) + ' mi';
}

// Undoes every hide we performed, exactly. Also sweeps the main list for a stray display:none
// we may have orphaned (an extension reload leaves the DOM styled but our tracker empty), which
// is what makes applyCityFilter(null) a reliable one-step way back to a normal board.
// Removes every marker we inserted, and sweeps any stray one a previous script instance left.
// Mirrors restoreDeadheads() exactly, for the same reasons.
function clearUnassignedMarkers() {
  logger.log('cityAssign', 'clearUnassignedMarkers called');
  var removed = 0, swept = 0;
  try {
    for (var i = 0; i < _unassignedMarked.length; i++) {
      var rec = _unassignedMarked[i];
      if (!rec || !rec.ourEl || !rec.ourEl.parentNode) continue;
      if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'removeChild unassigned-marker', rec.ourEl, 'attached', 'detached');
      rec.ourEl.parentNode.removeChild(rec.ourEl);
      removed++;
    }
    _unassignedMarked = [];

    var stray = document.querySelectorAll('[data-testid="' + UNASSIGNED_TESTID + '"]');
    for (var j = 0; j < stray.length; j++) {
      if (stray[j].parentNode) { stray[j].parentNode.removeChild(stray[j]); swept++; }
    }
    if (swept > 0) {
      logger.warn('cityAssign', 'swept orphaned unassigned markers — likely left by a previous ' +
        'script instance', { swept: swept });
    }
  } catch (e) {
    logger.error('cityAssign', 'clearUnassignedMarkers failed — a marker may be left on a card',
      { error: e, removed: removed, swept: swept });
  }
  return { removed: removed, swept: swept };
}

// Marks the unassigned cards that are VISIBLE in this view, and unmarks everything else.
//
// ⚠ IDEMPOTENT, FOR THE REASON THE DEADHEAD SUBSTITUTION IS. Inserting and removing nodes are
// childList mutations, which is exactly what the board observer watches; a mark-then-unmark
// on every apply would wake it, and the wake would re-apply. Measured at ~27 wakes/sec when the
// deadhead code had that shape (2026-08-19). A card already carrying our marker is left
// COMPLETELY untouched: no removeChild, no insertBefore, no attribute write.
function applyUnassignedMarkers(cards, shouldMark) {
  logger.log('cityAssign', 'applyUnassignedMarkers called', { mark: shouldMark === true });
  var added = 0, kept = 0, dropped = 0;
  try {
    // ── PASS 1: the DESIRED set. Read-only. Keyed on the CARD ELEMENT, not the id, because
    //    readMainCardElements() has no dedupe and a duplicate id means two real elements.
    var desired = [];
    if (shouldMark === true) {
      for (var i = 0; i < cards.length; i++) {
        var assigned = Object.prototype.hasOwnProperty.call(_cityAssignByCard, cards[i].id)
          ? _cityAssignByCard[cards[i].id] : null;
        if (assigned && assigned.length) continue;         // assigned — nothing to say
        if (!cards[i].el) continue;
        desired.push({ el: cards[i].el, done: false });
      }
    }

    // ── PASS 2: judge what is already there.
    var survivors = [];
    for (var k = 0; k < _unassignedMarked.length; k++) {
      var rec = _unassignedMarked[k];
      if (!rec) continue;
      var want = null;
      for (var w = 0; w < desired.length; w++) {
        if (!desired[w].done && desired[w].el === rec.cardEl) { want = desired[w]; break; }
      }
      var attached = !!(rec.ourEl && rec.ourEl.parentNode);
      if (want && attached) {
        want.done = true; survivors.push(rec); kept++;     // ZERO DOM writes
        continue;
      }
      try {
        if (attached) {
          if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'removeChild unassigned-marker', rec.ourEl, 'attached', 'detached');
          rec.ourEl.parentNode.removeChild(rec.ourEl);
        }
        dropped++;
      } catch (e1) {
        logger.error('cityAssign', 'one unassigned-marker undo failed — continuing', { error: e1 });
      }
    }
    _unassignedMarked = survivors;

    // ── PASS 3: insert what is missing.
    for (var d = 0; d < desired.length; d++) {
      if (desired[d].done) continue;
      var cardEl = desired[d].el;
      if (!cardEl || typeof cardEl.appendChild !== 'function') continue;

      // textContent only — never innerHTML, and nothing is read back off Amazon's markup.
      // Colours come from --ext-* tokens; no literal, no css-<hash> anchor.
      var ours = document.createElement('div');
      ours.setAttribute('data-testid', UNASSIGNED_TESTID);
      ours.setAttribute('title', UNASSIGNED_TITLE);
      ours.setAttribute('role', 'note');
      ours.setAttribute('aria-label', UNASSIGNED_TEXT);
      ours.style.display      = 'inline-block';
      ours.style.margin       = '4px 0 0 0';
      ours.style.padding      = '2px 8px';
      ours.style.borderRadius = 'var(--ext-radius-pill)';
      ours.style.border       = '1px solid var(--ext-accent)';
      ours.style.background   = 'var(--ext-accent-bg)';
      ours.style.color        = 'var(--ext-accent-text)';
      ours.style.fontSize     = '11px';
      ours.style.fontWeight   = '600';
      ours.style.lineHeight   = '1.4';
      ours.textContent        = UNASSIGNED_TEXT;

      if (cityVerboseDiagnostics()) cityDiagWrite('childList', 'appendChild unassigned-marker', ours, 'detached', 'attached');
      cardEl.appendChild(ours);
      _unassignedMarked.push({ cardEl: cardEl, ourEl: ours });
      added++;
    }

    if (added || dropped) {
      logger.log('cityAssign', 'CITY UNASSIGNED MARK  added: ' + added + '  kept: ' + kept +
        '  removed: ' + dropped);
    }
  } catch (e) {
    logger.error('cityAssign', 'applyUnassignedMarkers failed — leaving the cards as they are',
      { error: e, added: added, kept: kept, dropped: dropped });
  }
  return { added: added, kept: kept, dropped: dropped };
}

function restoreAllCards() {
  logger.log('cityAssign', 'restoreAllCards called');
  var restored = 0, swept = 0;
  try {
    for (var i = 0; i < _cityFilterHidden.length; i++) {
      var rec = _cityFilterHidden[i];
      if (!rec || !rec.el || !rec.el.style) continue;
      if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(restore)', rec.el, rec.el.style.display, rec.hadInline ? rec.prevDisplay : '');
      if (rec.hadInline) rec.el.style.display = rec.prevDisplay;
      else rec.el.style.removeProperty('display');   // exact: leave NO inline display behind
      restored++;
    }
    _cityFilterHidden = [];

    // Orphan sweep. Only display:'none' on a main-list card is cleared — nothing else is read
    // or written, and the similar list is never in scope.
    var cards = readMainCardElements();
    for (var j = 0; j < cards.length; j++) {
      var el = cards[j].el;
      if (el && el.style && el.style.display === 'none') {
        if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display(sweep)', el, 'none', '');
        el.style.removeProperty('display');
        swept++;
      }
    }
    if (swept > 0) {
      logger.warn('cityAssign', 'restore swept orphaned display:none cards — likely left by a ' +
        'previous script instance', { swept: swept });
    }
    logger.log('cityAssign', 'CITY FILTER  restored', { restored: restored, swept: swept });
  } catch (e) {
    logger.error('cityAssign', 'restoreAllCards failed', {
      error: e, tracked: _cityFilterHidden.length
    });
  }
}

// THE public entry point. `cityKey` null/undefined = show all (the default and the reset path).
function applyCityFilter(cityKey) {
  logger.log('cityAssign', 'applyCityFilter called');
  try {
    if (typeof CITY_FILTER_ENABLED === 'undefined' || !CITY_FILTER_ENABLED) {
      logger.log('cityAssign', 'CITY FILTER  disabled by flag — no style written');
      return { applied: false, reason: 'flag-off' };
    }

    // CITYDIAG Q5 (round 3): open the write ledger before the first write of this apply.
    if (cityVerboseDiagnostics()) cityDiagBeginWrites();
    // ALWAYS restore first: guarantees no residue, and re-applies cleanly onto re-rendered nodes.
    // The deadhead substitution restores here too — BEFORE the new city is applied, so switching
    // from HEBRON to COLUMBUS can never leave Hebron's number on a card (rule 5).
    restoreAllCards();
    // DEADHEADS ARE RECONCILED, NOT TORN DOWN AND REBUILT (2026-08-19).
    //
    // The blanket restoreDeadheads() that used to run here removed our node from every
    // substituted card, and applyCityDeadheads() then re-inserted an identical one. Measured on
    // Ihor's board: 24 removeChild + 24 insertBefore per apply. Those are childList mutations —
    // exactly what the board observer watches — so every apply woke it, and the wake re-applied
    // the filter. Self-sustaining, measured at ~27 wakes/sec.
    //
    // Only the paths that will NOT substitute still tear down here. For a real city with known
    // coordinates the reconcile inside applyCityDeadheads() handles removal, in-place update and
    // insertion per card, so rule 5 still holds: switching HEBRON -> COLUMBUS finds a value/title
    // mismatch and rewrites that card, and a card that is no longer eligible is restored.
    //
    // The condition mirrors the call site below exactly — same city key, same coordinate lookup.
    // If those two ever disagree, a substitution would be left stranded.
    var _ddCity = (cityKey === undefined || cityKey === null) ? null : String(cityKey);
    var _ddWillReconcile = (_ddCity !== null && _ddCity !== CITY_FILTER_UNMATCHED &&
                            !!_cityCoordCache[_ddCity]);
    if (!_ddWillReconcile) restoreDeadheads();
    _cityFilterActive = (cityKey === undefined || cityKey === null) ? null : String(cityKey);

    if (_cityFilterActive === null) {
      // ALL: everything visible, and every unassigned card MARKED so the dispatcher knows its
      // origin was not determined. This is the only view where an unassigned load appears.
      var allCards = readMainCardElements();
      var markedAll = applyUnassignedMarkers(allCards, true);
      logger.log('cityAssign', 'CITY FILTER  cleared — showing all  |  unassigned marked: ' +
        (markedAll.added + markedAll.kept));
      if (cityVerboseDiagnostics()) { cityDiagEndWrites('cleared to ALL'); logCityDiagOrphans('filter cleared to ALL'); }
      return { applied: true, city: null, hidden: 0, shown: 0, unassignedShown: 0,
               unassignedMarked: markedAll.added + markedAll.kept };
    }

    var cards = readMainCardElements();
    var hidden = 0, shown = 0, unassignedHidden = 0;

    // The unmatched view is the other place an unassigned card is visible, so it is marked there
    // too. Under a real city they are all hidden, so the pass simply clears every marker.
    applyUnassignedMarkers(cards, _cityFilterActive === CITY_FILTER_UNMATCHED);
    var shownCards = [];       // the cards left VISIBLE, for the deadhead substitution below
    for (var i = 0; i < cards.length; i++) {
      var assigned = Object.prototype.hasOwnProperty.call(_cityAssignByCard, cards[i].id)
        ? _cityAssignByCard[cards[i].id] : null;

      var isUnassigned = !assigned || !assigned.length;

      // THE UNMATCHED VIEW (2026-08-13) inverts the test: show only what we could NOT place, so
      // Ihor can look at the misses instead of just counting them. Everything else about the
      // filter is identical — display-only hiding, the same restore list, the same re-apply.
      if (_cityFilterActive === CITY_FILTER_UNMATCHED) {
        if (isUnassigned) { shown++; continue; }
        // fall through to hide the assigned ones
      } else {
        // `assigned` is the SET of cities this card is in range of. An empty or missing set
        // means unassigned.
        //
        // ⚠ CHANGED 2026-08-20 (Ihor). This used to `continue` — leaving the card VISIBLE, which
        // meant an unassigned load appeared under EVERY city tab. A YORK, PA load showed under
        // HEBRON, KY. It now falls through to the hide below, so an unassigned load appears under
        // "All" ONLY, marked.
        //
        // BOTH categories behave identically here, deliberately: "never captured" and "captured
        // but beyond CITY_ASSIGN_MAX_MILES of every city" both leave assignByCard without an
        // entry, and both are equally capable of putting a load 450 miles away under a city tab.
        //
        // ⚠ THIS REFINES RULE 9, IT DOES NOT OVERTURN IT — unassigned loads are still visible and
        // still counted, in "All". See docs/HANDOFF.md.
        if (isUnassigned) {
          unassignedHidden++;
          // deliberately NOT `continue` — fall through to the hide
        } else
        // Shown when the active city is ONE OF the card's cities — a load in range of two cities
        // appears under both.
        if (assigned.indexOf(_cityFilterActive) !== -1) {
          shown++;
          shownCards.push(cards[i]);
          continue;
        }
      }

      var el = cards[i].el;
      if (!el || !el.style) continue;
      var hadInline = !!(el.style.display && el.style.display.length);
      _cityFilterHidden.push({ el: el, hadInline: hadInline, prevDisplay: el.style.display });
      if (cityVerboseDiagnostics()) cityDiagWrite('attributes', 'style.display', el, el.style.display, 'none');
      el.style.display = 'none';
      hidden++;
    }
    logger.log('cityAssign', 'CITY FILTER  ' +
      (_cityFilterActive === CITY_FILTER_UNMATCHED ? 'UNMATCHED ONLY' : _cityFilterActive) +
      '  shown: ' + shown + '  hidden: ' + hidden +
      '  unassigned HIDDEN (All-only since 2026-08-20): ' + unassignedHidden +
      '  of ' + cards.length + ' cards');

    // PER-CITY DEADHEAD, on the cards this filter left visible. Only for a real city — never on
    // "All" (which returned above) and never in the unmatched view, where there is no active city
    // to measure to.
    if (_cityFilterActive !== CITY_FILTER_UNMATCHED) {
      var activeCoords = _cityCoordCache[_cityFilterActive];
      if (activeCoords) {
        applyCityDeadheads(shownCards, {
          name: _cityFilterActive, lat: activeCoords.lat, lng: activeCoords.lng
        });
      } else {
        logger.log('cityAssign', 'CITY DEADHEAD  skipped — the active city has no coordinates yet');
      }
    }

    // A filter change can hide the card an open panel belongs to. A panel over a hidden row is
    // an orphan, so it goes — checked AFTER the hiding above, so the display values are final.
    if (cityVerboseDiagnostics()) { cityDiagEndWrites('applied: ' + _cityFilterActive); logCityDiagOrphans('filter applied: ' + _cityFilterActive); }
    if (typeof enforcePanelAnchor === 'function') enforcePanelAnchor('city filter changed');
    return { applied: true, city: _cityFilterActive, hidden: hidden, shown: shown,
             unassignedShown: 0, unassignedHidden: unassignedHidden };
  } catch (e) {
    logger.error('cityAssign', 'applyCityFilter failed — restoring to a visible board', {
      error: e, requested: cityKey
    });
    // Any failure ends with everything visible AND every original number back. Never leave the
    // board partly hidden, and never leave our figure on a card the filter has abandoned.
    try { restoreAllCards(); restoreDeadheads(); clearUnassignedMarkers(); _cityFilterActive = null; } catch (e2) {
      logger.error('cityAssign', 'restore after applyCityFilter failure ALSO failed', { error: e2 });
    }
    return { applied: false, reason: 'error' };
  }
}

// ── READ-ONLY ACCESSORS for the new-load pipeline (2026-08-13) ────────────────────────────
//
// content.js uses these to stay filter-aware: detection still covers every city, but auto-open
// must never target a card the dispatcher cannot see. Both are pure reads — no DOM, no state.

// The SET of cities a load is in range of this cycle — [] when it could not be assigned.
//
// Returns an ARRAY as of 2026-08-13 (was a single city string). A load within range of two
// selected cities belongs to both, so every consumer must handle more than one: the filter shows
// it under either, and a new load marks BOTH city buttons.
//
// Returns a COPY so a caller cannot corrupt the cycle's own map.
function citiesOfLoad(loadId) {
  try {
    if (!loadId) return [];
    var v = Object.prototype.hasOwnProperty.call(_cityAssignByCard, loadId)
      ? _cityAssignByCard[loadId] : null;
    return (v && v.length) ? v.slice() : [];
  } catch (e) {
    logger.error('cityAssign', 'citiesOfLoad failed', { error: e });
    return [];
  }
}

// True only when this load is CURRENTLY hidden by the active filter.
//
// Deliberately mirrors applyCityFilter's rule exactly, including the most important part:
// ⚠ AS OF 2026-08-20 an UNASSIGNED load IS hidden under a city tab (it appears under "All"
// only). If these two ever disagreed, the pipeline would either skip a visible card or open an
// invisible one — and this one is what decides whether auto-open may open a load, so a stale
// copy of the old rule here would put the dispatcher on a card he cannot see.
function cityFilterHidesLoad(loadId) {
  try {
    if (typeof CITY_FILTER_ENABLED === 'undefined' || !CITY_FILTER_ENABLED) return false;
    if (_cityFilterActive === null) return false;      // showing all
    var assigned = citiesOfLoad(loadId);
    // In the unmatched view the test inverts: an ASSIGNED load is the one being hidden.
    if (_cityFilterActive === CITY_FILTER_UNMATCHED) return assigned.length > 0;
    // CHANGED 2026-08-20 with applyCityFilter: unassigned is visible in "All" only, so under a
    // real city it IS hidden. _cityFilterActive === null returned false above, so reaching here
    // means a real city is active.
    if (assigned.length === 0) return true;
    // Hidden only when the active city is NOT among the card's cities.
    return assigned.indexOf(_cityFilterActive) === -1;
  } catch (e) {
    logger.error('cityAssign', 'cityFilterHidesLoad failed', { error: e, loadId: !!loadId });
    return false;                                      // on doubt, treat as visible
  }
}

// The city currently being shown, or null for All.
function getActiveCityFilter() {
  return _cityFilterActive;
}

// Called at the end of each cycle so the filter reasserts itself on Amazon's re-rendered nodes.
// No-op when no filter is active, so a normal board costs nothing.
function reapplyCityFilter() {
  logger.log('cityAssign', 'reapplyCityFilter called');
  try {
    if (typeof CITY_FILTER_ENABLED === 'undefined' || !CITY_FILTER_ENABLED) return;
    if (_cityFilterActive === null) return;
    applyCityFilter(_cityFilterActive);
  } catch (e) {
    logger.error('cityAssign', 'reapplyCityFilter failed', { error: e, active: _cityFilterActive });
  }
}

// ── ASSIGNMENT CORE ───────────────────────────────────────────────────────────────────────
//
// Amazon's own coordinates, joined by work-opportunity id through the merged persistent map.
// Nothing is parsed out of the card and nothing is geocoded per load: the response already
// carries stops[0].location.latitude/.longitude for every work opportunity, which was measured
// at 50/50 on the captures and gave a full 30/30 join live.
//
// The only geocoding left is for the ACTIVE ORIGIN CITIES — the filter chips — which are city
// names and have no coordinates of their own.
//
// Fully synchronous: the map and the city coordinates are both in memory, so this is safe to
// call from a MutationObserver, which is what keeps a re-render from flashing unfiltered.
function computeAssignment(cards, resolved) {
  var counts = {}, unmatched = [], assignByCard = {};
  var unresolved = 0, outOfRange = 0;
  for (var ri = 0; ri < resolved.length; ri++) counts[resolved[ri].name] = 0;

  for (var k = 0; k < cards.length; k++) {
    var id = cards[k].id;
    var pickup = Object.prototype.hasOwnProperty.call(_cityPickupById, id)
      ? _cityPickupById[id] : null;

    // UNASSIGNED means exactly one thing now: this id has never appeared in any captured
    // response. It stays out of assignByCard and is therefore never hidden — and it is counted,
    // because a board full of these is what "the filter looks like it works but does nothing"
    // actually is. The count reaches the dispatcher on the All button.
    if (!pickup) {
      unresolved++;
      // TWO DIFFERENT PROBLEMS, and the distinction is the point of logging this at all:
      // "we never saw this load" points at the capture path (a response that landed before
      // activation, or an endpoint we do not watch), while "Amazon listed it with no position"
      // points at the data. Ihor cannot report a pattern from a count.
      unmatched.push({
        id: id,
        why: Object.prototype.hasOwnProperty.call(_cityNoCoordIds, id)
          ? 'seen in a captured response, but it carried no coordinates'
          : 'id never seen in any captured response'
      });
      continue;
    }

    // RANGE MEMBERSHIP, unchanged: a card belongs to EVERY active city within
    // CITY_ASSIGN_MAX_MILES, not only the nearest, and the <= boundary includes a load sitting
    // exactly on the threshold.
    var inRange = [];
    var bestDist = Infinity;
    var nearestName = null;
    for (var m = 0; m < resolved.length; m++) {
      var d = haversineMiles(pickup.lat, pickup.lng, resolved[m].lat, resolved[m].lng);
      if (d < bestDist) { bestDist = d; nearestName = resolved[m].name; }
      if (d <= CITY_ASSIGN_MAX_MILES) inRange.push(resolved[m].name);
    }
    if (inRange.length === 0) {
      // Resolved, and the answer is "no city" — a different thing from unresolved, and NOT
      // counted as such. It is still never hidden.
      outOfRange++;
      unmatched.push({
        id: id,
        why: 'nearest city ' + (nearestName || '?') + ' ' + Math.round(bestDist) + ' mi > ' +
             CITY_ASSIGN_MAX_MILES + ' mi max'
      });
      continue;
    }
    for (var ci = 0; ci < inRange.length; ci++) counts[inRange[ci]]++;
    assignByCard[id] = inRange;
  }

  return { assignByCard: assignByCard, counts: counts, unmatched: unmatched,
           unresolved: unresolved, outOfRange: outOfRange };
}

// ── PART 2 (2026-08-20): WHY did this load get no city? ───────────────────────────────────
//
// Hiding an unassigned load from the city tabs stops it misleading anyone; it does not say why
// the assignment failed. One line per unassigned load, readable at a glance:
//
//   CITY WHY-UNASSIGNED  1/2  <id>  OUT OF RANGE  @39.963,-76.728  nearest HEBRON, KY 442 mi
//                             > 150 mi max  |  HEBRON, KY 442 mi · COLUMBUS, OH 318 mi
//   CITY WHY-UNASSIGNED  2/2  <id>  NO COORDINATES  listed in a captured response from
//                             [recommendations] but it carried no latitude/longitude
//
// Flag-gated: nothing runs in a shipped build. Never feeds a decision.
function logUnassignedDiagnostics(cards, resolved, result) {
  logger.log('cityAssign', 'logUnassignedDiagnostics called');
  try {
    if (!cityVerboseDiagnostics()) return;
    var list = (result && result.unmatched) ? result.unmatched : [];
    if (!list.length) {
      logger.log('cityAssign', 'CITY WHY-UNASSIGNED  none — every rendered card was assigned');
      return;
    }
    logger.log('cityAssign', 'CITY WHY-UNASSIGNED  ' + list.length + ' unassigned of ' +
      cards.length + ' rendered  ||  active cities: ' +
      (resolved.length ? resolved.map(function (r) { return r.name; }).join(', ') : '(none)') +
      '  ||  limit ' + CITY_ASSIGN_MAX_MILES + ' mi (CITY_ASSIGN_MAX_MILES — NOT changed here; ' +
      'whether 150 is right is PLAN 16 and Ihor has not decided it)');

    for (var i = 0; i < list.length; i++) {
      var id = list[i].id;
      var pickup = Object.prototype.hasOwnProperty.call(_cityPickupById, id)
        ? _cityPickupById[id] : null;

      if (!pickup) {
        // ── CATEGORY: NO COORDINATES. Say WHICH lookup came back empty, and from where.
        var listedNoCoord = Object.prototype.hasOwnProperty.call(_cityNoCoordIds, id);
        var ep = Object.prototype.hasOwnProperty.call(_cityIdEndpointById, id)
          ? _cityIdEndpointById[id] : null;
        logger.log('cityAssign', 'CITY WHY-UNASSIGNED  ' + (i + 1) + '/' + list.length + '  ' + id +
          '  NO COORDINATES  ' +
          (listedNoCoord
            ? 'listed in a captured response from [' + (ep || 'unknown endpoint') + '] but it ' +
              'carried no latitude/longitude — _cityPickupById has no entry, _cityNoCoordIds does'
            : 'never seen in ANY captured response — neither _cityPickupById nor _cityNoCoordIds ' +
              'has this id, so no watched endpoint ever listed it' +
              (ep ? ' (last endpoint that mentioned it: [' + ep + '])' : '')) +
          '  ||  merged map holds ' + _cityPickupOrder.length + ' ids from ' +
          _cityAssignBuffers.length + ' buffered response(s)');
        continue;
      }

      // ── CATEGORY: OUT OF RANGE. Distance to EVERY active city, and the nearest named.
      var parts = [];
      var bestDist = Infinity, nearest = null;
      for (var m = 0; m < resolved.length; m++) {
        var d = haversineMiles(pickup.lat, pickup.lng, resolved[m].lat, resolved[m].lng);
        if (d < bestDist) { bestDist = d; nearest = resolved[m].name; }
        parts.push(resolved[m].name + ' ' + Math.round(d) + ' mi');
      }
      logger.log('cityAssign', 'CITY WHY-UNASSIGNED  ' + (i + 1) + '/' + list.length + '  ' + id +
        '  OUT OF RANGE  @' + pickup.lat.toFixed(3) + ',' + pickup.lng.toFixed(3) +
        (nearest
          ? '  nearest ' + nearest + ' ' + Math.round(bestDist) + ' mi > ' +
            CITY_ASSIGN_MAX_MILES + ' mi max'
          : '  ** NO ACTIVE ORIGIN CITY RESOLVED — nothing to measure against **') +
        (parts.length ? '  ||  ' + parts.join(' · ') : ''));
    }
  } catch (e) {
    logger.error('cityAssign', 'logUnassignedDiagnostics failed — diagnostics only, the filter is ' +
      'unaffected', { error: e });
  }
}

// Distances for a handful of cards, so a dispatcher can check the arithmetic against a map he
// already knows. Diagnostics only — never feeds a decision.
function sampleDistances(cards, resolved, howMany) {
  var out = [];
  for (var i = 0; i < cards.length && out.length < howMany; i++) {
    var p = _cityPickupById[cards[i].id];
    if (!p) continue;
    var parts = [];
    for (var m = 0; m < resolved.length; m++) {
      parts.push(resolved[m].name + ' ' +
        Math.round(haversineMiles(p.lat, p.lng, resolved[m].lat, resolved[m].lng)) + 'mi');
    }
    out.push(cards[i].id.slice(0, 8) + ' @' + p.lat.toFixed(3) + ',' + p.lng.toFixed(3) +
             ' -> ' + parts.join(', '));
  }
  return out;
}

// The active origin cities, resolved to coordinates. Cached after the first call per city.
async function resolveActiveCities() {
  logger.log('cityAssign', 'resolveActiveCities called');
  var cities = getActiveOriginCities();
  var resolved = [];
  for (var ci = 0; ci < cities.length; ci++) {
    var coords = await resolveCityCoords(cities[ci]);
    if (!coords) continue;                    // already warned by name inside resolveCityCoords
    resolved.push({ name: cities[ci], lat: coords.lat, lng: coords.lng });
  }
  return { cities: cities, resolved: resolved };
}

// Same, but cache-only — for the synchronous re-render path.
function resolveActiveCitiesFromCache() {
  var cities = getActiveOriginCities();
  var resolved = [];
  for (var ci = 0; ci < cities.length; ci++) {
    var c = _cityCoordCache[cities[ci]];
    if (c) resolved.push({ name: cities[ci], lat: c.lat, lng: c.lng });
  }
  return resolved;
}

// ── Q5/Q6 WRITE-AND-WAKE LEDGER (2026-08-18, round 3) ─────────────────────────────────────
//
// A filter application on the live board is repeating every 20-25 ms with IDENTICAL state.
// These two ledgers record what the filter writes and what the observer then wakes on, so the
// two can be matched against each other instead of assumed to be related.
//
// RATE LIMITED. Filtering fires hundreds of times a second when it loops; an unbounded log makes
// the console useless and slows the page enough to change what is being measured. Q5 and Q6 log
// for the first CITYDIAG_WAKE_MAX applies/wakes after a filter selection, then print one summary
// line, then go silent until the selection changes.
//
// STRICTLY READ-ONLY, and deliberately WITHOUT a loop guard: suppressing the loop here would
// destroy the measurement that the fix has to be chosen from.
var CITYDIAG_WAKE_MAX = 20;

var _cityDiagWakeCount   = 0;      // observer wakes since the current selection
var _cityDiagApplyCount  = 0;      // filter applies since the current selection
var _cityDiagWakeFor     = null;   // the selection those counters belong to; null forces a reset
var _cityDiagSilenced    = false;  // the one summary line has been printed
var _cityDiagFirstAt     = 0;      // when this burst started, for the rate in the summary
var _cityDiagTotalWrites = 0;      // writes across the WHOLE burst, not just the logged ones
var _cityDiagTotalMuts   = 0;

var _cityDiagWrites     = null;    // ledger for the apply in progress
var _cityDiagLastWrites = [];      // the immediately preceding apply's ledger, for Q6 matching
var _cityDiagPendingMuts = [];     // mutation records accumulated since the last frame

// Resets the budget whenever the dispatcher changes what is selected — each selection gets its
// own 20, so a later selection is not silenced by an earlier one.
function cityDiagBudget() {
  var sel = (_cityFilterActive === null) ? '(ALL)' : String(_cityFilterActive);
  if (sel !== _cityDiagWakeFor) {
    _cityDiagWakeFor = sel;
    _cityDiagWakeCount = 0; _cityDiagApplyCount = 0;
    _cityDiagSilenced = false; _cityDiagFirstAt = Date.now();
    _cityDiagTotalWrites = 0; _cityDiagTotalMuts = 0;
  }
  return sel;
}

// The single summary line, printed once when the budget runs out.
function cityDiagSummary() {
  if (_cityDiagSilenced) return;
  _cityDiagSilenced = true;
  var ms = Date.now() - _cityDiagFirstAt;
  logger.log('cityAssign', 'CITYDIAG Q56 SUMMARY  [' + _cityDiagWakeFor + ']  ' +
    _cityDiagApplyCount + ' filter applies and ' + _cityDiagWakeCount + ' observer wakes in ' +
    ms + ' ms' + (ms > 0 ? '  (~' + Math.round(_cityDiagWakeCount * 1000 / ms) + ' wakes/sec)' : '') +
    '  |  ' + _cityDiagTotalWrites + ' DOM write(s), ' + _cityDiagTotalMuts +
    ' mutation record(s)  |  going SILENT now — change the selection to measure again');
}

// ── Q5 WHAT WE WRITE ──────────────────────────────────────────────────────────────────────
//
// Called at each write site inside the filter chain, BEFORE the write, so the recorded "was" is the value
// actually on the node. The kind is what the MutationObserver would classify it as: only
// 'childList' can wake ours — it observes {childList:true, subtree:true} and NOT attributes.
function cityDiagWrite(kind, prop, node, was, now) {
  try {
    _cityDiagTotalWrites++;
    if (!_cityDiagWrites) return;
    _cityDiagWrites.push({
      kind: kind, prop: prop, node: node,
      was: String(was), now: String(now),
      changed: String(was) !== String(now)
    });
  } catch (e) {
    // Rule 5: every catch logs. This one should be unreachable — it guards a push onto an array.
    logger.error('cityAssign', 'cityDiagWrite failed — diagnostics only, the write itself is ' +
      'unaffected', { error: e, kind: kind, prop: prop });
  }
}

function cityDiagBeginWrites() {
  _cityDiagWrites = [];
}

function cityDiagEndWrites(where) {
  try {
    var w = _cityDiagWrites || [];
    _cityDiagWrites = null;
    _cityDiagLastWrites = w;
    cityDiagBudget();
    _cityDiagApplyCount++;
    if (_cityDiagApplyCount > CITYDIAG_WAKE_MAX) { cityDiagSummary(); return; }

    if (w.length === 0) {
      logger.log('cityAssign', 'CITYDIAG Q5 WRITES    apply #' + _cityDiagApplyCount +
        ' [' + where + ']  ** ZERO WRITES **');
      return;
    }
    // Count per kind, and separately how many were WAKING writes (childList) versus writes the
    // observer is blind to (attributes), and how many wrote a value that was already there.
    var byKind = {}, waking = 0, identical = 0;
    for (var i = 0; i < w.length; i++) {
      var k = w[i].kind + '/' + w[i].prop;
      byKind[k] = (byKind[k] || 0) + 1;
      if (w[i].kind === 'childList') waking++;
      if (!w[i].changed) identical++;
    }
    var tally = [];
    for (var key in byKind) if (Object.prototype.hasOwnProperty.call(byKind, key)) tally.push(key + ': ' + byKind[key]);

    logger.log('cityAssign', 'CITYDIAG Q5 WRITES    apply #' + _cityDiagApplyCount +
      ' [' + where + ']  ' + w.length + ' write(s) — ' + tally.join(' | ') +
      '  ||  ' + waking + ' are childList (THE ONLY KIND THIS OBSERVER SEES — it watches ' +
      '{childList:true, subtree:true}, not attributes)' +
      '  |  ' + identical + ' wrote a value identical to what was already there');
    for (var j = 0; j < w.length && j < 5; j++) {
      var testid = (w[j].node && w[j].node.getAttribute) ? w[j].node.getAttribute('data-testid') : null;
      logger.log('cityAssign', 'CITYDIAG Q5 WRITES    ' + (j + 1) + '/' + w.length + '  ' +
        w[j].kind + '.' + w[j].prop + '  "' + w[j].was + '" -> "' + w[j].now + '"  ' +
        (w[j].changed ? 'CHANGED' : 'IDENTICAL — this write altered nothing') +
        (testid ? '  |  data-testid=' + testid : ''));
    }
  } catch (e) {
    logger.error('cityAssign', 'cityDiagEndWrites failed — diagnostics only', { error: e });
  }
}

// ── Q6 WHAT WAKES US ──────────────────────────────────────────────────────────────────────
//
// The observer callback discards its records argument. They are accumulated here instead, and
// read once per frame by logCityDiagWake(). rAF-coalesced, so one frame can carry several
// batches — hence an accumulator rather than a single assignment.
function cityDiagNoteMutations(records) {
  try {
    if (!records || !records.length) return;
    _cityDiagTotalMuts += records.length;
    for (var i = 0; i < records.length; i++) {
      if (_cityDiagPendingMuts.length >= 200) break;   // bounded; the count above stays exact
      _cityDiagPendingMuts.push(records[i]);
    }
  } catch (e) {
    logger.error('cityAssign', 'cityDiagNoteMutations failed — diagnostics only, the observer is ' +
      'unaffected', { error: e });
  }
}

// Does this record correspond to a node the PRECEDING apply wrote? Identity first — the ledger
// holds the actual node references — then data-testid as the fallback for a node we created.
function cityDiagMatchesOurWrite(rec) {
  try {
    var hit = function (list) {
      if (!list) return false;
      for (var a = 0; a < list.length; a++) {
        for (var b = 0; b < _cityDiagLastWrites.length; b++) {
          if (_cityDiagLastWrites[b].node === list[a]) return true;
        }
        if (list[a] && list[a].getAttribute &&
            list[a].getAttribute('data-testid') === DEADHEAD_TESTID) return true;
      }
      return false;
    };
    if (hit(rec.addedNodes)) return 'YES — we INSERTED this node in the preceding apply';
    if (hit(rec.removedNodes)) return 'YES — we REMOVED this node in the preceding apply';
    for (var b = 0; b < _cityDiagLastWrites.length; b++) {
      if (_cityDiagLastWrites[b].node === rec.target) return 'YES — we wrote to this exact node';
    }
    return 'no — not attributable to our preceding apply';
  } catch (e) {
    logger.error('cityAssign', 'cityDiagMatchesOurWrite failed — diagnostics only', { error: e });
    return 'unknown (match failed)';
  }
}

function logCityDiagWake() {
  try {
    var recs = _cityDiagPendingMuts;
    _cityDiagPendingMuts = [];
    cityDiagBudget();
    _cityDiagWakeCount++;
    if (_cityDiagWakeCount > CITYDIAG_WAKE_MAX) { cityDiagSummary(); return; }

    var kinds = {}, ours = 0;
    for (var i = 0; i < recs.length; i++) {
      kinds[recs[i].type] = (kinds[recs[i].type] || 0) + 1;
      if (cityDiagMatchesOurWrite(recs[i]).indexOf('YES') === 0) ours++;
    }
    var tally = [];
    for (var k in kinds) if (Object.prototype.hasOwnProperty.call(kinds, k)) tally.push(k + ': ' + kinds[k]);

    logger.log('cityAssign', 'CITYDIAG Q6 WAKE      wake #' + _cityDiagWakeCount +
      '  |  ' + recs.length + ' mutation record(s) — ' + (tally.length ? tally.join(' | ') : '(none captured)') +
      '  ||  ' + ours + ' of them are OUR OWN writes from the preceding apply' +
      (recs.length && ours === recs.length
        ? '  ** EVERY record this wake is self-inflicted **' : ''));

    for (var j = 0; j < recs.length && j < 3; j++) {
      var r = recs[j];
      // Is the target inside a card the filter hid? _cityFilterHidden holds those elements.
      var inHidden = false;
      for (var h = 0; h < _cityFilterHidden.length; h++) {
        var he = _cityFilterHidden[h] && _cityFilterHidden[h].el;
        if (he && he.contains && r.target && he.contains(r.target)) { inHidden = true; break; }
      }
      logger.log('cityAssign', 'CITYDIAG Q6 WAKE      ' + (j + 1) + '/' + recs.length +
        '  type=' + r.type +
        (r.type === 'attributes' ? '  attributeName=' + r.attributeName : '') +
        '  added=' + ((r.addedNodes && r.addedNodes.length) || 0) +
        '  removed=' + ((r.removedNodes && r.removedNodes.length) || 0) +
        '  |  target inside a card we hid: ' + (inHidden ? 'YES' : 'no') +
        '  |  matches our write: ' + cityDiagMatchesOurWrite(r));
    }
    if (recs.length > 3) {
      logger.log('cityAssign', 'CITYDIAG Q6 WAKE      ... and ' + (recs.length - 3) +
        ' more record(s) this wake, not shown');
    }
  } catch (e) {
    logger.error('cityAssign', 'logCityDiagWake failed — diagnostics only', { error: e });
  }
}

// ── PAGE-DEGRADATION DIAGNOSTIC (2026-08-18) ──────────────────────────────────────────────
//
// WHY IT EXISTS: per-city filtering is reported to degrade above 50 results, where Amazon shows
// pagination controls — city tabs start listing loads from states nowhere near the selected city,
// while the All button's unassigned counter stays at zero. Counters alone cannot separate the
// candidate causes, so this prints the whole chain for one cycle: what is rendered, how the page
// was classified, what the merged map knows, what got assigned, and what survived the filter.
//
// EVERY LINE IS TAGGED "CITYDIAG" so the console can be filtered down to just this chain.
//
// STRICTLY READ-ONLY. It reads the DOM and module state and prints. It writes no style, issues no
// request, and nothing here feeds a decision — deleting the whole section changes no behaviour.
//
// GATED TWICE by construction: cityVerboseDiagnostics() is CITY_ASSIGN_DEBUG, and logger.log
// needs DEBUG_LEVEL 3. A shipped build (flag false, level 1) executes none of it.

// Buffer objects already reported, so each response is announced as NEW exactly once. A Set of
// object references — buffers dropped by the CITY_ASSIGN_MAX_BUFFERS shift are simply never
// looked up again. Created lazily so a non-debug session allocates nothing.
var _cityDiagSeenBuffers = null;

// The last verdict the RE-RENDER path reached, recorded by cityDiagNoteRerender(). The cycle
// cannot recompute it: by the time the cycle runs, _cityPageKey has already moved on.
var _cityDiagLastRerender = null;

// Which COMPONENT of the page signature moved. currentPageKey() joins four with '|':
// range | count | firstId | lastId. Naming the one that changed is what turns "PAGE CHANGE" into
// a reason — a range change is a real page turn, a first/last-id change on the same range is
// Amazon re-rendering different loads into the same window.
function cityDiagKeyDiff(prev, now) {
  if (prev === now) return 'identical';
  if (prev === null || prev === undefined) return 'no previous key (first cycle of the session)';
  if (now === null) return 'current key unreadable';
  var a = String(prev).split('|'), b = String(now).split('|');
  var names = ['range', 'count', 'firstId', 'lastId'], moved = [];
  for (var i = 0; i < names.length; i++) {
    if (a[i] !== b[i]) moved.push(names[i] + ' ' + (a[i] || '-') + '->' + (b[i] || '-'));
  }
  return moved.length ? moved.join(', ') : 'components equal but keys differ';
}

// Called from onBoardRerender, already behind the flag there. Records only — decides nothing.
//
// ALSO ANSWERS Q3 (2026-08-18): the re-render's effect on the board and on our hidden state.
//
// ⚠ THE "re-applied?" VERDICT IS RE-DERIVED, NOT OBSERVED. This runs near the TOP of
// onBoardRerender, before the guards it is describing, so it re-tests the same four conditions
// read-only rather than watching the call happen. They are quoted here in the same order the
// function checks them; if that order ever changes, this line silently starts lying. The
// alternative — instrumenting each early return — would put five diagnostic blocks inside the
// hot observer path, which is worse.
var _cityDiagLastDomCount = null;   // cards seen at the PREVIOUS re-render

function cityDiagNoteRerender(prevKey, nextKey, changed, cards) {
  _cityDiagLastRerender = {
    changed: !!changed, prev: prevKey, next: nextKey,
    rule: cityDiagKeyDiff(prevKey, nextKey), at: Date.now()
  };
  try {
    cards = cards || [];
    var before = _cityDiagLastDomCount;
    _cityDiagLastDomCount = cards.length;

    // Our hidden state, measured two ways. They disagree when Amazon has replaced the nodes:
    // _cityFilterHidden still points at DETACHED elements while the fresh ones carry no
    // display:none at all. restoreAllCards() has an orphan sweep for the reverse case.
    var domHidden = 0, domVisible = 0;
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i].el;
      if (el && el.style && el.style.display === 'none') domHidden++; else domVisible++;
    }
    var tracked = _cityFilterHidden.length, stillAttached = 0;
    for (var j = 0; j < _cityFilterHidden.length; j++) {
      var r = _cityFilterHidden[j];
      if (r && r.el && document.contains && document.contains(r.el)) stillAttached++;
    }

    // The four guards, in source order, re-tested read-only.
    var why = null;
    if (typeof CITY_FILTER_ENABLED === 'undefined' || !CITY_FILTER_ENABLED) why = 'CITY_FILTER_ENABLED is off';
    else if (_cityFilterActive === null) why = 'filter is ALL (_cityFilterActive === null) — this path returns before assigning or filtering';
    else if (resolveActiveCitiesFromCache().length === 0) why = 'no active city has coordinates cached yet';
    else if (cards.length === 0) why = 'zero cards rendered at this instant';

    logger.log('cityAssign', 'CITYDIAG Q3 RERENDER  cards in DOM ' +
      (before === null ? '(first)' : before) + ' -> ' + cards.length +
      '  |  hidden by us ' + domHidden + ', not hidden ' + domVisible +
      '  |  _cityFilterHidden tracks ' + tracked + ' node(s), ' + stillAttached +
      ' still in the document' +
      '  |  page verdict ' + (changed ? 'PAGE CHANGE -> would REPLACE the assignment map' : 're-render -> would MERGE') +
      '  |  FILTER RE-APPLIED BY THIS PATH: ' + (why === null ? 'YES' : 'NO — ' + why));
  } catch (e) {
    logger.error('cityAssign', 'cityDiagNoteRerender Q3 failed — diagnostics only', { error: e });
  }
}

// ── Q2 SOURCE OF THE EXCESS ───────────────────────────────────────────────────────────────
//
// WHY A SEPARATE MAP. Endpoint attribution lives on the buffers, and _cityAssignBuffers keeps
// only CITY_ASSIGN_MAX_BUFFERS (6) — an id whose response has aged out would report "none" even
// though it WAS captured, which is precisely the wrong answer for this question. So the endpoint
// is remembered per id here instead. DEBUG-ONLY: written solely from the flag-gated call in
// onCityCoordsMessage, read solely by the line below, bounded by the same cap as the coords map.
var _cityDiagEndpointById = {};
var _cityDiagEndpointOrder = [];

function cityDiagNoteEndpoints(endpoint, pairs, noCoordIds) {
  try {
    var take = function (id) {
      if (!Object.prototype.hasOwnProperty.call(_cityDiagEndpointById, id)) {
        _cityDiagEndpointById[id] = endpoint;
        _cityDiagEndpointOrder.push(id);
        if (_cityDiagEndpointOrder.length > CITY_PICKUP_MAX) {
          delete _cityDiagEndpointById[_cityDiagEndpointOrder.shift()];
        }
      } else if (_cityDiagEndpointById[id].indexOf(endpoint) === -1) {
        // Seen from more than one endpoint — worth knowing, so both are kept.
        _cityDiagEndpointById[id] += '+' + endpoint;
      }
    };
    for (var i = 0; i < (pairs || []).length; i++) take(String(pairs[i].id));
    for (var j = 0; j < (noCoordIds || []).length; j++) take(String(noCoordIds[j]));
  } catch (e) {
    logger.error('cityAssign', 'cityDiagNoteEndpoints failed — diagnostics only', { error: e });
  }
}

// Which endpoint each rendered card came from, and WHERE the non-/search cards sit relative to
// the block of /search cards. "Above" means Amazon injected them at the top of the main list.
function logCityDiagExcess(cards, showing) {
  try {
    var byEp = {}, order = [], firstSearch = -1, lastSearch = -1;
    for (var i = 0; i < cards.length; i++) {
      var ep = Object.prototype.hasOwnProperty.call(_cityDiagEndpointById, cards[i].id)
        ? _cityDiagEndpointById[cards[i].id]
        : (Object.prototype.hasOwnProperty.call(_cityPickupById, cards[i].id)
            ? 'none (in coords map, response aged out)' : 'none (never captured)');
      byEp[ep] = (byEp[ep] || 0) + 1;
      order.push({ i: i, id: cards[i].id, ep: ep });
      if (ep.indexOf('search') === 0) { if (firstSearch === -1) firstSearch = i; lastSearch = i; }
    }
    var tally = [];
    for (var k in byEp) if (Object.prototype.hasOwnProperty.call(byEp, k)) tally.push(k + ': ' + byEp[k]);

    var rendered = (showing && showing.rendered !== null) ? showing.rendered : null;
    logger.log('cityAssign', 'CITYDIAG Q2 EXCESS    collected ' + cards.length +
      '  vs  Showing range ' + (rendered === null ? '?' : rendered) +
      (rendered === null ? '' : '  =  excess ' + (cards.length - rendered)) +
      '  |  by endpoint — ' + (tally.length ? tally.join(' | ') : '(none attributed)') +
      '  |  /search block spans DOM index ' + firstSearch + '..' + lastSearch);

    // Every non-/search card, positioned against that block. Capped so a 60-card board stays
    // readable; the tally above is already complete.
    var shown = 0;
    for (var m = 0; m < order.length && shown < 12; m++) {
      if (order[m].ep.indexOf('search') === 0) continue;
      var pos = (firstSearch === -1) ? 'no /search card to compare against'
        : (order[m].i < firstSearch ? 'ABOVE the /search block'
          : (order[m].i > lastSearch ? 'BELOW the /search block' : 'INTERLEAVED inside it'));
      logger.log('cityAssign', 'CITYDIAG Q2 EXCESS    dom#' + order[m].i + '  ' + order[m].id +
        '  from ' + order[m].ep + '  —  ' + pos);
      shown++;
    }
  } catch (e) {
    logger.error('cityAssign', 'logCityDiagExcess failed — diagnostics only', { error: e });
  }
}

// ── Q1 ORPHANS ────────────────────────────────────────────────────────────────────────────
//
// A card in the DOM with no entry in the assignment map. It is NEVER hidden (rule 2), so under a
// city tab every orphan is a load shown regardless of where it actually is. The last column is
// the one that matters: an orphan whose id IS in the coords map was assignable and simply was not
// assigned — that points at WHEN the map was built, not at the capture.
function logCityDiagOrphans(where) {
  try {
    var cards = readMainCardElements();
    var orphans = [];
    for (var i = 0; i < cards.length; i++) {
      var a = Object.prototype.hasOwnProperty.call(_cityAssignByCard, cards[i].id)
        ? _cityAssignByCard[cards[i].id] : null;
      if (a && a.length) continue;
      orphans.push(cards[i]);
    }
    logger.log('cityAssign', 'CITYDIAG Q1 ORPHANS   after [' + where + ']  filter ' +
      (_cityFilterActive === null ? 'ALL' : _cityFilterActive) +
      '  |  cards in DOM ' + cards.length + '  |  assignment map ' + countKeys(_cityAssignByCard) +
      ' id(s)  |  ORPHANS ' + orphans.length +
      (orphans.length ? '  — every one of these is VISIBLE regardless of the selected city' : ''));
    for (var j = 0; j < orphans.length && j < 5; j++) {
      var el = orphans[j].el;
      var vis = (el && el.style && el.style.display === 'none') ? 'HIDDEN' : 'VISIBLE';
      logger.log('cityAssign', 'CITYDIAG Q1 ORPHANS   ' + (j + 1) + '/' + orphans.length + '  ' +
        orphans[j].id + '  ' + vis +
        '  |  in coords map: ' +
        (Object.prototype.hasOwnProperty.call(_cityPickupById, orphans[j].id)
          ? 'YES — it was assignable, so the map was built without it'
          : 'no — never captured') +
        '  |  endpoint: ' + (Object.prototype.hasOwnProperty.call(_cityDiagEndpointById, orphans[j].id)
          ? _cityDiagEndpointById[orphans[j].id] : 'unknown'));
    }
  } catch (e) {
    logger.error('cityAssign', 'logCityDiagOrphans failed — diagnostics only', { error: e });
  }
}

// ── Q4 READ SYNCHRONY ─────────────────────────────────────────────────────────────────────
//
// currentPageKey() combines two INDEPENDENT reads of the same board: the "Showing" line and the
// rendered card ids. Amazon updates them at different moments, so one can describe the next page
// while the other still describes this one. This fires only when they DISAGREE — when one moved
// since the previous read and the other did not. That asymmetry is what identifies the stale one.
var _cityDiagLastRead = null;
var _cityDiagReadSeq = 0;

function cityDiagNoteRead(showing, cards) {
  try {
    _cityDiagReadSeq++;
    var tRange = Date.now();
    var range = (showing.from !== null && showing.to !== null)
      ? (showing.from + '-' + showing.to) : '?';
    var tIds = Date.now();
    var firstId = (cards && cards.length) ? cards[0].id : '-';
    var lastId  = (cards && cards.length) ? cards[cards.length - 1].id : '-';
    var now = { seq: _cityDiagReadSeq, range: range, total: showing.total, raw: showing.raw,
                rendered: showing.rendered, from: showing.from, to: showing.to,
                firstId: firstId, lastId: lastId,
                count: cards ? cards.length : 0, tRange: tRange, tIds: tIds };
    var prev = _cityDiagLastRead;
    _cityDiagLastRead = now;
    if (!prev) return;

    var rangeMoved = (prev.range !== now.range);
    var idsMoved   = (prev.firstId !== now.firstId || prev.lastId !== now.lastId);
    if (rangeMoved === idsMoved) return;          // both moved, or neither — nothing to report

    var stamp = function (t) { return new Date(t).toISOString().slice(11, 23); };
    logger.log('cityAssign', 'CITYDIAG Q4 SYNC      ** the two reads DISAGREE ** ' +
      (rangeMoved ? 'the RANGE moved and the IDS did not — the id read is stale, or Amazon ' +
                    'relabelled the page before swapping the cards'
                  : 'the IDS moved and the RANGE did not — the Showing line is stale, or Amazon ' +
                    'swapped the cards before relabelling') +
      '  ||  read #' + prev.seq + '  range "' + prev.range + '" of ' + prev.total +
      ' @' + stamp(prev.tRange) + '  first ' + String(prev.firstId).slice(0, 8) +
      ' last ' + String(prev.lastId).slice(0, 8) + ' (' + prev.count + ' cards) @' + stamp(prev.tIds) +
      '  ->  read #' + now.seq + '  range "' + now.range + '" of ' + now.total +
      ' @' + stamp(now.tRange) + '  first ' + String(now.firstId).slice(0, 8) +
      ' last ' + String(now.lastId).slice(0, 8) + ' (' + now.count + ' cards) @' + stamp(now.tIds) +
      '  ||  ' + (now.to !== null && now.to !== undefined && now.total !== null && now.to > now.total
        ? '** the range runs PAST the total (' + now.to + ' > ' + now.total + ') — impossible ' +
          'for a settled board, so this reading is mid-update **'
        : 'range arithmetic is self-consistent') +
      '  |  Showing line: ' + (now.raw === null ? '(none)' : JSON.stringify(now.raw)));
  } catch (e) {
    logger.error('cityAssign', 'cityDiagNoteRead failed — diagnostics only', { error: e });
  }
}

// THE BLOCK. Seven lines, one cycle. ctx carries what only the cycle knows.
function logCityPageDiagnostics(ctx) {
  logger.log('cityAssign', 'logCityPageDiagnostics called');
  try {
    var cards    = ctx.cards || [];
    var cardIds  = ctx.cardIds || [];
    var showing  = ctx.showing || { from: null, to: null, total: null, rendered: null, raw: null };
    var result   = ctx.result || { counts: {}, unresolved: 0, outOfRange: 0 };
    var resolved = ctx.resolved || [];
    var nul = function (v) { return (v === null || v === undefined) ? '?' : v; };

    // 1. PAGE — what the board says is on screen, and the ids that bracket it.
    logger.log('cityAssign', 'CITYDIAG 1 PAGE      from ' + nul(showing.from) + ' to ' +
      nul(showing.to) + ' of ' + nul(showing.total) + ' total  |  rendered(parsed) ' +
      nul(showing.rendered) + '  |  cards collected ' + cards.length +
      '  |  first ' + (cardIds.length ? cardIds[0] : '-') +
      '  |  last ' + (cardIds.length ? cardIds[cardIds.length - 1] : '-') +
      '  |  showing line: ' + (showing.raw === null ? '(none found)' : JSON.stringify(showing.raw)));

    // 2. PAGE VERDICT — for BOTH paths, because they behave differently and only one of them
    //    merges. ⚠ The CYCLE has no page-change branch at all: it overwrites _cityPageKey and
    //    then replaces _cityAssignByCard unconditionally. The re-render path is the only one
    //    that ever merges, so its verdict is the one that can leave a stale assignment behind.
    var r = _cityDiagLastRerender;
    logger.log('cityAssign', 'CITYDIAG 2 VERDICT   cycle: ' +
      (ctx.prevPageKey === ctx.pageKey ? 'SAME PAGE' : 'PAGE CHANGE') +
      ' (' + cityDiagKeyDiff(ctx.prevPageKey, ctx.pageKey) + ')' +
      ' — but the cycle branches on nothing: it always REPLACES the assignment map' +
      '  ||  last re-render: ' + (r === null
        ? 'none since load (the MutationObserver path has not run)'
        : (r.changed ? 'PAGE CHANGE -> REPLACED' : 'RE-RENDER -> MERGED') +
          ' by [' + r.rule + '] ' + Math.round((Date.now() - r.at) / 1000) + 's ago'));

    // 3. MAP — ⚠ TWO DIFFERENT MAPS, and conflating them is how this gets misread:
    //    _cityPickupById (id -> coords) is ALWAYS merged and never replaced — that is task 7e's
    //    whole point, and it persists across pages on purpose. _cityAssignByCard (id -> cities)
    //    is the one that is replaced or merged.
    logger.log('cityAssign', 'CITYDIAG 3 MAP       coords map ' + ctx.mapBefore + ' -> ' +
      _cityPickupOrder.length + ' ids (cap ' + CITY_PICKUP_MAX + ')  |  MERGED — this map is ' +
      'never replaced by design  ||  assignment map now ' + countKeys(_cityAssignByCard) +
      ' ids, REPLACED by this cycle  |  no-coord ids known: ' + countKeys(_cityNoCoordIds));

    // Q2 — where the cards beyond the Showing range came from.
    logCityDiagExcess(cards, showing);

    // 4. COVERAGE — how many rendered ids the coords map could answer for at all.
    var missing = [];
    for (var i = 0; i < cardIds.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(_cityPickupById, cardIds[i])) missing.push(cardIds[i]);
    }
    logger.log('cityAssign', 'CITYDIAG 4 COVERAGE  rendered ' + cardIds.length + '  |  in coords map ' +
      (cardIds.length - missing.length) + '  |  MISSING ' + missing.length +
      (missing.length ? '  |  first ' + Math.min(5, missing.length) + ': ' +
        missing.slice(0, 5).join(' ') : '  |  every rendered card is joinable'));

    // 5. ASSIGN — memberships per city (a load in range of two cities counts in both), then the
    //    TWO kinds of unassigned. They are still reported SEPARATELY because they point at
    //    different problems — "we never saw this load" is a capture-path fault, "we saw it and it
    //    is 450 miles away" is not a fault at all — but as of 2026-08-20 they BEHAVE identically:
    //    both are hidden from every city tab, both appear under All with a marker, and both are
    //    on the All badge. This diagnostic used to say the second was off the badge and shown
    //    under every tab; that was true, and it is what the YORK/HEBRON defect was made of.
    var parts = [];
    for (var c = 0; c < resolved.length; c++) {
      parts.push(resolved[c].name + ': ' + (result.counts[resolved[c].name] || 0));
    }
    logger.log('cityAssign', 'CITYDIAG 5 ASSIGN    ' + (parts.length ? parts.join(' | ') : '(no city resolved)') +
      '  ||  unassigned: ' + result.unresolved + ' never captured' +
      '  +  ' + result.outOfRange + ' captured but beyond ' + CITY_ASSIGN_MAX_MILES +
      ' mi of every city  =  ' + unassignedTotal(result) +
      ' on the All badge, All-ONLY on the board, each marked on its card (2026-08-20)');

    // 6. VISIBLE — measured from the settled DOM, not from what the filter believes it did. The
    //    split is the point: a card visible under a city it is not assigned to is the symptom.
    //    ⚠ Since 2026-08-20 the two unassigned buckets must read ZERO under a city filter. A
    //    non-zero there is the YORK-under-HEBRON defect returning.
    var active = _cityFilterActive;
    var vis = 0, visAssigned = 0, visUnassignedNeverSeen = 0, visUnassignedOutOfRange = 0, visOther = 0;
    for (var v = 0; v < cards.length; v++) {
      var el = cards[v].el;
      if (!el || !el.style || el.style.display === 'none') continue;
      vis++;
      var a = Object.prototype.hasOwnProperty.call(_cityAssignByCard, cards[v].id)
        ? _cityAssignByCard[cards[v].id] : null;
      if (a && a.length) {
        if (active === null || a.indexOf(active) !== -1) visAssigned++;
        else visOther++;                       // visible under a city it is NOT assigned to
      } else if (Object.prototype.hasOwnProperty.call(_cityPickupById, cards[v].id)) {
        visUnassignedOutOfRange++;             // we know where it is; it is simply too far
      } else {
        visUnassignedNeverSeen++;              // no coordinates for it at all
      }
    }
    logger.log('cityAssign', 'CITYDIAG 6 VISIBLE   filter ' +
      (active === null ? 'ALL' : (active === CITY_FILTER_UNMATCHED ? 'UNMATCHED-ONLY' : active)) +
      '  |  visible ' + vis + '/' + cards.length +
      '  =  ' + visAssigned + ' assigned to it' +
      '  +  ' + visUnassignedOutOfRange + ' unassigned/too-far' +
      (active === null || active === CITY_FILTER_UNMATCHED
        ? '' : (visUnassignedOutOfRange ? ' ** SHOWN UNDER A CITY — MUST BE 0 **' : '')) +
      '  +  ' + visUnassignedNeverSeen + ' unassigned/never-captured' +
      (active === null || active === CITY_FILTER_UNMATCHED
        ? '' : (visUnassignedNeverSeen ? ' ** SHOWN UNDER A CITY — MUST BE 0 **' : '')) +
      (visOther ? '  +  ' + visOther + ' ** VISIBLE BUT ASSIGNED ELSEWHERE — filter did not hide these **' : ''));

    // 7. CAPTURE — every buffered response still held, and how much of it is on screen. A
    //    response whose ids barely intersect the rendered list is describing a different page.
    if (_cityDiagSeenBuffers === null && typeof Set === 'function') _cityDiagSeenBuffers = new Set();
    var rendered = {};
    for (var q = 0; q < cardIds.length; q++) rendered[cardIds[q]] = true;
    if (!_cityAssignBuffers.length) {
      logger.log('cityAssign', 'CITYDIAG 7 CAPTURE   no buffered responses held');
    }
    for (var b = 0; b < _cityAssignBuffers.length; b++) {
      var buf = _cityAssignBuffers[b];
      var isNew = _cityDiagSeenBuffers ? !_cityDiagSeenBuffers.has(buf) : true;
      if (_cityDiagSeenBuffers) _cityDiagSeenBuffers.add(buf);
      var hit = 0, ids = 0;
      for (var k in buf.byId) {
        if (!Object.prototype.hasOwnProperty.call(buf.byId, k)) continue;
        ids++; if (rendered[k]) hit++;
      }
      var ncHit = 0;
      for (var k2 in buf.noCoord) {
        if (Object.prototype.hasOwnProperty.call(buf.noCoord, k2) && rendered[k2]) ncHit++;
      }
      logger.log('cityAssign', 'CITYDIAG 7 CAPTURE   [' + (b + 1) + '/' + _cityAssignBuffers.length +
        ']' + (isNew ? ' NEW' : '    ') + '  endpoint ' + buf.endpoint +
        '  |  woCount ' + nul(buf.woCount) +
        '  |  totalResultsSize ' + nul(buf.totalResultsSize) +
        '  |  nextItemToken ' + nul(buf.nextItemToken) +
        '  |  ids with coords ' + ids + ', of which ON SCREEN ' + hit +
        '  |  no-coord ids on screen ' + ncHit);
    }
  } catch (e) {
    logger.error('cityAssign', 'logCityPageDiagnostics failed — diagnostics only, the cycle is ' +
      'unaffected', { error: e });
  }
}

// ── THE CYCLE ─────────────────────────────────────────────────────────────────────────────

// One assignment pass. Reads, computes, logs, and touches nothing.
//
// COST: cards x cities distance computations — ~250 on a 50-card, 5-city board. Pure
// arithmetic (multiply, sqrt, atan2), no DOM writes and no layout reads, so it is well under a
// millisecond and cannot affect rendering. The DOM is read exactly once, up front.
async function runCityAssignCycle() {
  logger.log('cityAssign', 'runCityAssignCycle called');
  // The cycle awaits city resolution on its first run; refreshes do not wait for it. Without
  // this guard a second refresh could interleave and double-count.
  if (_cityAssignRunning) {
    logger.log('cityAssign', 'cycle already running — skipping this trigger');
    return;
  }
  _cityAssignRunning = true;
  try {
    // A lost observer means pagination stops being noticed, silently. Cheap to check, and the
    // cycle is the natural place — it runs on every refresh.
    ensureBoardRenderObserver();
    // Read the cards ONCE — id plus the element the filter will hide. THIS IS THE WORKING SET:
    // whatever is rendered right now, and nothing else. The coordinates come from the merged
    // pickup map, keyed by that id.
    var cards   = readMainCardElements();
    // Keep the page signature current here too, so a page turn that happens without a mutation
    // the observer sees (or before it is attached) still registers rather than leaving the
    // previous page's key in place and suppressing the next real change.
    // CITYDIAG (2026-08-18): snapshot what the next line overwrites and what the coords map
    // held on entry. Locals, read by logCityPageDiagnostics() only — nothing else consults them.
    var diagPrevPageKey = _cityPageKey;
    var diagMapBefore   = _cityPickupOrder.length;
    _cityPageKey = currentPageKey(cards);
    var cardIds = [];
    for (var idi = 0; idi < cards.length; idi++) cardIds.push(cards[idi].id);
    if (cardIds.length === 0) {
      logger.warn('cityAssign', 'no load cards rendered — cycle skipped');
      return;
    }
    // MAIN-LIST SCOPE CHECK (2026-08-12, premise corrected 2026-08-13). THE tell that
    // similar-matches cards are excluded: the collected count must not EXCEED the number of
    // cards the board says are RENDERED. Before the scope fix a 9-result board collected 13.
    //
    // It used to compare against the GRAND TOTAL, which is only the same number on a
    // single-page board — see readShowingCounts(). Logged first so it is visible even if
    // something below throws.
    var showing  = readShowingCounts();
    var rendered = showing.rendered;
    logger.log('cityAssign', 'CITY DIAG 0/5  main-list scope check — collected ' +
      cardIds.length + ' card(s)  |  board renders ' +
      (rendered === null ? '?' : rendered) + ' of ' +
      (showing.total === null ? '?' : showing.total) + ' total  |  ' +
      (rendered === null
        ? 'SCOPE: unknown (no rendered range to compare against) — proceeding'
        : (cardIds.length <= rendered
            ? 'SCOPE: OK — collected ' + (cardIds.length === rendered ? 'exactly' : 'no more than') +
              ' what is rendered, similar-matches cards are excluded'
            : 'SCOPE: BAD — collected MORE than the board renders (diff +' +
              (cardIds.length - rendered) + ')')));

    // Diagnostics parts 1-3 (2026-08-08). BEFORE the mismatch bail below, so a cycle that stops
    // still leaves the full inventory in the console — that cycle is the most worth diagnosing.
    // Verbose blocks are DEBUG ONLY (2026-08-13): a shipped build must not walk every span on
    // the page or enumerate id-bearing descendants just to print nothing.
    if (cityVerboseDiagnostics()) logBufferInventory(cardIds);

    // THE SCOPE CHECK NO LONGER SKIPS ANYTHING (2026-08-13). It is now pure diagnostics.
    //
    // It existed because assignment came from a captured response: one shared id join for the
    // whole board, so a set containing cards the response did not describe produced wrong
    // per-city counts, and refusing to publish was the safe move.
    //
    // With the DOM as the source that reasoning is gone. Each card carries its OWN origin and is
    // assigned independently — an extra card cannot corrupt another card's answer. The worst a
    // miscount can now do is assign a card that should not have been collected, and that card is
    // in the main list to begin with.
    //
    // Meanwhile skipping had become actively harmful, which is what Ihor hit live: on a
    // "Showing 1 - 50 of 75" board the collected count was 52 against 50 rendered, the cycle
    // returned, and the filter re-applied the PREVIOUS cycle's map onto a board of different
    // loads — the Chicago tab showed Tulsa loads. A stale map is far worse than an imperfect
    // fresh one, because it is silently wrong rather than visibly incomplete.
    //
    // So both conditions warn and continue. Nothing here returns.
    if (rendered === null) {
      logger.warn('cityAssign', 'could not read a rendered range from the board — proceeding; ' +
        'the scope check is diagnostics only and never blocks assignment', {
        collected: cardIds.length, total: showing.total,
        rawShowingLine: showing.raw === null ? '(no "Showing ... results" line found)' : showing.raw
      });
    } else if (cardIds.length > rendered) {
      logger.warn('cityAssign', 'collected MORE cards than the board renders — proceeding anyway; ' +
        'each card carries its own origin so an extra card cannot corrupt the others', {
        collected: cardIds.length, rendered: rendered, total: showing.total,
        excess: cardIds.length - rendered, rawShowingLine: showing.raw
      });
    }
    // Raw id samples (2026-08-08). Also before pickBuffer: when overlap is zero there IS no
    // selected response, and this block is precisely what explains why.
    if (cityVerboseDiagnostics()) logIdShapeSamples(cardIds);

    // Reused from originCities.js, NOT re-scraped — see getActiveOriginCities() there.
    var active = await resolveActiveCities();
    if (!active.cities.length) {
      logger.warn('cityAssign', 'no active origin cities available — cycle skipped', {
        cardCount: cards.length
      });
      return;
    }
    if (active.resolved.length === 0) {
      logger.warn('cityAssign', 'no origin city could be resolved to coordinates — cycle skipped', {
        cities: active.cities.length
      });
      return;
    }
    var resolved = active.resolved;

    // NOTHING IS GEOCODED PER LOAD. Every card's coordinates come from Amazon, already merged
    // into _cityPickupById as responses arrived. The only await above is for the chips.
    var result       = computeAssignment(cards, resolved);
    var counts       = result.counts;
    var unmatched    = result.unmatched;
    var assignByCard = result.assignByCard;

    // THE line this whole file exists to print.
    //
    // These are MEMBERSHIPS, not a partition. Since 2026-08-13 a card belongs to every city it
    // is within CITY_ASSIGN_MAX_MILES of, so a load shared by two cities is counted in both and
    // the per-city numbers can sum to MORE than the card count. That is correct, not a
    // double-count — the line says so explicitly rather than leaving it to look like a bug.
    var parts = [];
    var membershipTotal = 0;
    for (var pi = 0; pi < resolved.length; pi++) {
      parts.push(resolved[pi].name + ': ' + counts[resolved[pi].name]);
      membershipTotal += counts[resolved[pi].name];
    }
    parts.push('unmatched: ' + unmatched.length);

    // COVERAGE IS THE NUMBER TO READ. resolved/rendered — how many cards the merged map could
    // answer for at all. This is the line that would have made the HEBRON/COLUMBUS failure
    // obvious in one glance instead of looking like a working filter: it read 0/N.
    var resolvedCount = cardIds.length - result.unresolved;
    logger.log('cityAssign', 'CITY ASSIGN  ' + parts.join(' | ') +
      '   [coverage ' + resolvedCount + '/' + cardIds.length + ' resolved' +
      (result.unresolved > 0 ? '  ** ' + result.unresolved + ' NOT IN ANY CAPTURED RESPONSE **' : '') +
      '  |  ' + result.outOfRange + ' resolved but outside ' + CITY_ASSIGN_MAX_MILES + ' mi' +
      '  |  ' + membershipTotal + ' memberships — a load in range of 2 cities counts in both, ' +
      'so the sum may exceed the card count' +
      '  |  merged map holds ' + _cityPickupOrder.length + ' ids]');

    // Three worked examples, so the arithmetic can be checked against a map by eye.
    var samples = sampleDistances(cards, resolved, 3);
    if (samples.length > 0) {
      logger.log('cityAssign', 'CITY ASSIGN distances  ' + samples.join('   |   '));
    }

    // ONE LINE PER UNMATCHED CARD (2026-08-13). It used to be one joined line capped at 20,
    // which is unreadable at 50 and silently dropped the rest. These are logger.log, so they
    // appear only at DEBUG_LEVEL 3 and cost a shipped build nothing.
    for (var ui = 0; ui < unmatched.length; ui++) {
      logger.log('cityAssign', 'CITY UNMATCHED  ' + (ui + 1) + '/' + unmatched.length + '  ' +
        unmatched[ui].id + '  —  ' + unmatched[ui].why);
    }

    // PART 2 (2026-08-20): WHY each unassigned load got no city. One readable line each —
    // coordinates, distance to every active city, and the category. Flag-gated inside.
    logUnassignedDiagnostics(cards, resolved, result);

    // logUnmatchedProvenance() is NOT called any more. It classified an unmatched card against
    // the SELECTED BUFFER, and there is no selected buffer any more — the map is merged from all
    // of them. Left in place with the rest of the capture path; see the dead-weight list.

    // Publish this cycle's assignment, then let any active filter reassert itself on the nodes
    // Amazon just re-rendered. Both are no-ops on a normal board: reapplyCityFilter returns
    // immediately unless a filter is active AND the feature flag is on.
    _cityAssignByCard = assignByCard;
    publishUnassignedCount(unassignedTotal(result));
    reapplyCityFilter();
    // Last, after the filter has settled: the cards this cycle describes may not be the ones the
    // open panel belongs to. reapplyCityFilter runs its own check, but only when a filter is
    // active — this covers the "All" case too.
    if (typeof enforcePanelAnchor === 'function') enforcePanelAnchor('assignment cycle');

    // CITYDIAG (2026-08-18). LAST, so item 6 measures the DOM after the filter has settled
    // rather than what the filter thinks it did. Flag-gated: nothing runs in a shipped build.
    if (cityVerboseDiagnostics()) {
      logCityPageDiagnostics({
        cards: cards, cardIds: cardIds, showing: showing, result: result,
        resolved: resolved, prevPageKey: diagPrevPageKey, pageKey: _cityPageKey,
        mapBefore: diagMapBefore
      });
    }
  } catch (e) {
    logger.error('cityAssign', 'runCityAssignCycle failed', { error: e });
  } finally {
    // In finally, not at the end of try: an early return or a throw must not wedge the guard on
    // and silence the feature for the rest of the session.
    _cityAssignRunning = false;
  }
}

// ── IMMEDIATE RE-FILTER ON RE-RENDER (2026-08-13) ─────────────────────────────────────────
//
// THE FLASH THIS REMOVES: Amazon re-rendered, the fresh nodes carried no display:none, and the
// filter only re-asserted at the END of the network-triggered cycle — after a 700 ms debounce
// that each additional response restarted. Every refresh showed the whole board for 1-1.5 s.
//
// It could not be fixed before this change because assignment NEEDED the response. Now it does
// not: the origin is on the card, so a re-render can be filtered from the DOM alone, with no
// network wait at all.
//
// HOW THE RE-RENDER IS DETECTED: a MutationObserver watching childList+subtree. Cards are added
// and removed, so childList fires; we deliberately do NOT observe attributes, so the filter's own
// hide/show — which writes nothing but style.display — is invisible to it.
//
// CORRECTED 2026-08-19. This block used to claim outright that "the filter cannot retrigger
// itself". That was true when it was written and became FALSE when the per-city deadhead
// substitution landed: substituting inserts a <span> and restoring removes it, and those ARE
// childList mutations inside the observed subtree. Every apply therefore woke this observer,
// which re-applied the filter — a loop measured live at ~27 wakes/sec on a board with 24
// multi-city loads.
//
// WHAT HOLDS NOW: applyCityDeadheads() is IDEMPOTENT. A card already showing the value we would
// write receives no DOM write of any kind, and a changed value is written in place via
// textContent/attributes rather than by removing and re-inserting the node. So a REPEATED apply
// over an unchanged board emits no childList mutation and cannot wake this observer. A FIRST
// apply, and any apply that genuinely changes a card, still inserts or removes — that is a real
// change to the board and waking on it is correct.
//
// It observes the main list's PARENT, not the list, because Amazon replaces the list element
// itself on some renders; the parent survives.
//
// Coalesced with requestAnimationFrame: a render arrives as a burst of mutations, and this runs
// once per frame at most, before the browser paints. That is what makes it flash-free rather than
// merely fast.
var _cityRenderObserver = null;
var _cityRenderFrame    = null;
var _cityRenderTarget   = null;   // the node the observer is attached to, for re-attach checks

// ── THE RENDERED PAGE IS THE WORKING SET (2026-08-13, Ihor's rule) ────────────────────────
//
// Work only with the loads currently rendered. "Showing 1 - 50 of 145" means we assign and
// filter those 50 and nothing else; when he clicks page 2, the new 50 become the working set.
// We never try to hold or filter loads that are not on screen, and we never drive Amazon's page
// controls — he changes pages, we react.
//
// HOW A PAGE CHANGE IS DETECTED: the identity of the working set, not a click on a control.
// Two independent signals, combined:
//
//   1. The RANGE in the "Showing 51 - 100 of 145" line. This is the reliable one and it is
//      text-anchored, not css-<hash> — see AMAZON_SELECTORS.md. It distinguishes page 2 from
//      page 1 even though both render 50 cards, which a count alone cannot.
//   2. The FIRST AND LAST rendered card ids. This catches a page change on a board that prints
//      no range at all, and catches Amazon re-rendering different loads into the same range.
//
// Deliberately NOT the pagination buttons: they are unlabelled and hash-classed, and reacting to
// a click would race the render anyway. The signature is read AFTER the DOM has changed, so it
// describes what is actually on screen.
var _cityPageKey = null;

function currentPageKey(cards) {
  try {
    var showing = readShowingCounts();
    var range = (showing.from !== null && showing.to !== null)
      ? (showing.from + '-' + showing.to) : '?';
    var first = (cards && cards.length) ? cards[0].id : '-';
    var last  = (cards && cards.length) ? cards[cards.length - 1].id : '-';
    // CITYDIAG Q4 (2026-08-18): both reads are in hand here and nowhere else. Read-only.
    if (cityVerboseDiagnostics()) cityDiagNoteRead(showing, cards);
    return range + '|' + (cards ? cards.length : 0) + '|' + first + '|' + last;
  } catch (e) {
    logger.error('cityAssign', 'currentPageKey failed', { error: e });
    return null;
  }
}

function onBoardRerender() {
  logger.log('cityAssign', 'onBoardRerender called');
  try {
    // FIRST, AND BEFORE EVERY EARLY RETURN BELOW (2026-08-13). This observer is the only thing
    // that sees Amazon swap a saved-search tab, and the inline panel leaking across those tabs
    // was a separate bug from filtering — it happened with the filter on "All" too. So the
    // anchor check must not sit behind the filter's own guards.
    if (typeof enforcePanelAnchor === 'function') enforcePanelAnchor('board re-render');

    // PAGE CHANGE IS CHECKED BEFORE THE FILTER GUARDS, so it is noticed even on "All". Reading
    // the cards is the only cost, and the observer already fired because the DOM changed.
    var cards   = readMainCardElements();
    var pageKey = currentPageKey(cards);
    var pageChanged = (pageKey !== null && pageKey !== _cityPageKey);
    // CITYDIAG (2026-08-18): the cycle cannot recover this — _cityPageKey has moved on by then.
    // Records only; the branch below is untouched.
    if (cityVerboseDiagnostics()) { logCityDiagWake(); cityDiagNoteRerender(_cityPageKey, pageKey, pageChanged, cards); }
    if (pageChanged) {
      logger.log('cityAssign', 'CITY PAGE  working set changed — ' + cards.length +
        ' card(s) now rendered  [' + _cityPageKey + '  ->  ' + pageKey + ']');
      _cityPageKey = pageKey;
    }

    if (typeof CITY_FILTER_ENABLED === 'undefined' || !CITY_FILTER_ENABLED) return;
    if (_cityFilterActive === null) return;      // nothing to hide; the board is already correct

    // IN-MEMORY ONLY, so this whole path is synchronous and completes inside the frame. An id
    // the merged map has never seen is simply unassigned for this frame, which means VISIBLE —
    // never wrongly hidden.
    var resolved = resolveActiveCitiesFromCache();
    if (resolved.length === 0) return;            // chips not geocoded yet; the async cycle will
    if (cards.length === 0) return;
    var result = computeAssignment(cards, resolved);

    // ON A PAGE CHANGE, REPLACE. Otherwise MERGE.
    //
    // The working set IS the rendered page (Ihor's rule), so when the page turns, last page's
    // answers must not linger in the map — that is how a load from another city ended up visible
    // under a city tab past result 50. On an ordinary re-render the merge still applies: a card
    // whose id has not arrived in a response yet would otherwise lose an assignment it already
    // had and flash into view.
    //
    // The COORDINATES are not touched either way. _cityPickupById persists across pages, so
    // going back to page 1 re-assigns instantly from memory with no new request (requirement 3).
    if (pageChanged) {
      _cityAssignByCard = result.assignByCard;
    } else {
      var merged = {};
      for (var oldId in _cityAssignByCard) {
        if (Object.prototype.hasOwnProperty.call(_cityAssignByCard, oldId)) {
          merged[oldId] = _cityAssignByCard[oldId];
        }
      }
      for (var newId in result.assignByCard) {
        if (Object.prototype.hasOwnProperty.call(result.assignByCard, newId)) {
          merged[newId] = result.assignByCard[newId];
        }
      }
      _cityAssignByCard = merged;
    }
    publishUnassignedCount(unassignedTotal(result));
    reapplyCityFilter();

    logger.log('cityAssign', 'CITY REFILTER  ' + (pageChanged ? 'PAGE CHANGE' : 're-render') +
      ' filtered in-frame — ' + cards.length + ' card(s), coverage ' +
      (cards.length - result.unresolved) + '/' + cards.length);

    // Ids we have never seen: a response for them may still be in flight, so ask for a cycle.
    if (result.unresolved > 0) scheduleCityAssignCycle();
  } catch (e) {
    logger.error('cityAssign', 'onBoardRerender failed — leaving the board as it is', { error: e });
  }
}

function startBoardRenderObserver() {
  logger.log('cityAssign', 'startBoardRenderObserver called');
  try {
    if (_cityRenderObserver) return;
    if (typeof MutationObserver !== 'function') {
      logger.warn('cityAssign', 'MutationObserver unavailable — re-renders will only be filtered ' +
        'by the debounced cycle, i.e. with the old delay');
      return;
    }
    var list = findMainResultsList();
    // The list's parent survives a list replacement; document.body is the fallback so a board
    // that has not rendered yet still gets watched.
    var target = (list && list.parentElement) ? list.parentElement : document.body;
    if (!target) return;

    _cityRenderObserver = new MutationObserver(function (records) {
      // CITYDIAG Q6 (round 3): the callback discarded its records; they are accumulated for the
      // frame instead. Recording only — the scheduling below is untouched.
      if (cityVerboseDiagnostics()) cityDiagNoteMutations(records);
      if (_cityRenderFrame !== null) return;               // already scheduled for this frame
      var raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : function (fn) { return setTimeout(fn, 0); };     // jsdom / headless fallback
      _cityRenderFrame = raf(function () {
        _cityRenderFrame = null;
        onBoardRerender();
      });
    });
    _cityRenderObserver.observe(target, { childList: true, subtree: true });
    _cityRenderTarget = target;
    logger.log('cityAssign', 'board render observer active', { onBody: target === document.body });
  } catch (e) {
    logger.error('cityAssign', 'startBoardRenderObserver failed', { error: e });
  }
}

// Re-attaches the observer if the node it was watching has been detached.
//
// The observer sits on the results list's PARENT, chosen because it survives the list itself
// being replaced. A page change is a bigger re-render, and there is no guarantee the parent
// survives it — if it does not, the observer is left watching an orphan and pagination stops
// being noticed at all, which is silent and would look exactly like the bug this task fixes.
// Called from the cycle, so a lost observer is recovered within one refresh at worst.
function ensureBoardRenderObserver() {
  try {
    if (!_cityRenderObserver) { startBoardRenderObserver(); return; }
    if (!_cityRenderTarget) return;
    var attached = (typeof document.contains === 'function')
      ? document.contains(_cityRenderTarget)
      : true;                                   // cannot tell -> leave it alone
    if (attached) return;
    logger.log('cityAssign', 'render observer was watching a detached node — re-attaching');
    stopBoardRenderObserver();
    startBoardRenderObserver();
  } catch (e) {
    logger.error('cityAssign', 'ensureBoardRenderObserver failed', { error: e });
  }
}

function stopBoardRenderObserver() {
  logger.log('cityAssign', 'stopBoardRenderObserver called');
  try {
    if (_cityRenderFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_cityRenderFrame);
      else clearTimeout(_cityRenderFrame);
      _cityRenderFrame = null;
    }
    if (_cityRenderObserver) {
      _cityRenderObserver.disconnect();
      _cityRenderObserver = null;
    }
    _cityRenderTarget = null;
  } catch (e) {
    logger.error('cityAssign', 'stopBoardRenderObserver failed', { error: e });
  }
}

// Hands the unassigned count to the panel. Kept behind a typeof check so cityAssign never
// depends on originCities having loaded — the filter must work with or without the badge.
//
// ⚠ THE COUNT IS BOTH CATEGORIES AS OF 2026-08-20, and callers pass unassignedTotal(result).
// It used to be `result.unresolved` alone — "never captured" — while "captured but beyond
// CITY_ASSIGN_MAX_MILES of every city" was left out. Both are now hidden from every city tab and
// shown only under All, so both must be counted: a badge reading 0 beside a board carrying
// out-of-range loads told the dispatcher nothing was missing when something was.
function publishUnassignedCount(n) {
  try {
    if (typeof markUnassignedLoads === 'function') markUnassignedLoads(n);
  } catch (e) {
    logger.error('cityAssign', 'publishUnassignedCount failed', { error: e, count: n });
  }
}

// Everything the filter treats as unassigned, which is what the All badge must show. ONE
// definition, used by every caller, so the badge and the filter cannot drift apart.
function unassignedTotal(result) {
  logger.log('cityAssign', 'unassignedTotal called');
  try {
    if (!result) return 0;
    var a = (typeof result.unresolved === 'number') ? result.unresolved : 0;
    var b = (typeof result.outOfRange === 'number') ? result.outOfRange : 0;
    return a + b;
  } catch (e) {
    logger.error('cityAssign', 'unassignedTotal failed — reporting 0 rather than a wrong number',
      { error: e });
    return 0;
  }
}

// The debounced async cycle, as a named function so both the network message and the re-render
// path can ask for one.
function scheduleCityAssignCycle() {
  if (_cityAssignTimer !== null) clearTimeout(_cityAssignTimer);
  _cityAssignTimer = setTimeout(function () {
    _cityAssignTimer = null;
    runCityAssignCycle();
  }, CITY_ASSIGN_SETTLE_MS);
}

// ── PLUMBING ──────────────────────────────────────────────────────────────────────────────

// Receives the { id, lat, lng } triples from content/networkObserver.js (MAIN world).
//
// The body itself never crosses: the MAIN world extracts the triples and posts only those, so
// a ~300KB response becomes a few KB of message. See emitCityAssignCoords() there.
function onCityCoordsMessage(ev) {
  logger.log('cityAssign', 'onCityCoordsMessage called');
  try {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.__extRelayCityCoords !== true) return;

    var byId = {};
    var pairs = data.pairs || [];
    for (var i = 0; i < pairs.length; i++) {
      byId[pairs[i].id] = { lat: pairs[i].lat, lng: pairs[i].lng };
    }

    // NO reset checks and no merge here any more (2026-08-12). Each response is simply buffered
    // and each cycle reads the buffer that matches the board — see the header note. The two
    // reset signals that used to live here were both disproven live: searchAuditId changes per
    // request, and the origin-city set changes during the normal staged load of the SAME search.
    // DIAGNOSTICS ONLY (2026-08-20): remember which endpoint last mentioned each id, so an
    // unassigned load can be told "listed by [recommendations] with no coordinates" rather than
    // just "no coordinates". Written for ids WITH coordinates too, a few lines below. Nothing
    // reads this to make a decision, and the merged coordinate map is untouched.
    for (var pe = 0; pe < pairs.length; pe++) {
      if (pairs[pe] && pairs[pe].id) _cityIdEndpointById[pairs[pe].id] = data.endpoint;
    }

    var noCoord = {};
    var nc = data.noCoordIds || [];
    for (var j = 0; j < nc.length; j++) {
      noCoord[nc[j]] = true;
      _cityIdEndpointById[nc[j]] = data.endpoint;
      // Persisted alongside the pickup map so an unmatched card can be told apart from one we
      // simply never saw. Bounded by the same reasoning: it only ever holds ids a response
      // actually listed, and teardown clears it.
      _cityNoCoordIds[nc[j]] = true;
    }

    _cityAssignBuffers.push({
      endpoint: data.endpoint, byId: byId, noCoord: noCoord,
      withCoords: pairs.length, woCount: data.woCount,
      // 2026-08-08: kept per-buffer so the diagnostic can test each response for pagination
      // individually rather than reasoning about the newest one only.
      totalResultsSize: data.totalResultsSize, nextItemToken: data.nextItemToken,
      noCoordCount: nc.length,
      // 2026-08-08 id-shape probe. Debug-only; see the emitter's warning in networkObserver.js.
      // Dropped on teardown with everything else.
      rawBody: data.rawBody, rawBodyTruncated: data.rawBodyTruncated,
      rawBodyLength: data.rawBodyLength, idSamples: data.idSamples || []
    });
    // Bounded: a long session must not accumulate buffers forever.
    while (_cityAssignBuffers.length > CITY_ASSIGN_MAX_BUFFERS) _cityAssignBuffers.shift();

    // Per-endpoint record count (2026-08-08 recon). The reported symptom is that "search"
    // carries 1 record while the board shows 50, so the endpoint serving 50 is the one the
    // cards actually come from. Printed per response, unaggregated, so it cannot mislead.
    logger.log('cityAssign', 'CITY ENDPOINT SHAPE  [' + data.endpoint + ']  woCount: ' +
      data.woCount + '  withCoords: ' + pairs.length + '  noCoord: ' + nc.length +
      '  totalResultsSize: ' + data.totalResultsSize +
      '  searchAuditId: ' + data.searchAuditId);

    logger.log('cityAssign', 'pickup coordinates buffered', {
      endpoint: data.endpoint, withCoords: pairs.length,
      withoutCoords: nc.length, woCount: data.woCount, buffers: _cityAssignBuffers.length,
    });

    // MERGE INTO THE PERSISTENT MAP — this is assignment's input again, and the merge is the
    // whole fix: every response contributes, none is discarded by a vote, and what earlier
    // responses taught us survives.
    // CITYDIAG Q2 (2026-08-18): remember which endpoint each id came from. Debug-only and
    // write-only from here; the buffers cannot answer this once they age out at 6.
    if (cityVerboseDiagnostics()) cityDiagNoteEndpoints(data.endpoint, pairs, nc);
    var addedNow = mergePickupCoords(pairs);
    // STAGE B: the panel's records ride the same message and the same eviction.
    var recAdded = mergeLoadRecords(data.records);
    logger.log('cityAssign', 'CITY MERGE  +' + addedNow + ' new id(s) from this ' +
      data.endpoint + ' response; merged map now holds ' + _cityPickupOrder.length +
      ' of a possible ' + CITY_PICKUP_MAX + '  |  +' + recAdded + ' panel record(s)');

    scheduleCityAssignCycle();
  } catch (e) {
    logger.error('cityAssign', 'onCityCoordsMessage failed', { error: e });
  }
}

// ENDPOINT RECONNAISSANCE receiver (2026-08-08). Read-only.
//
// networkObserver reports every '/api/loadboard/' path it sees, once each, with whether
// CAPTURE_PATHS matched it. The line to read is any path showing captured:NO — that is an
// endpoint feeding the board that we never read a body from.
function onEndpointSeenMessage(ev) {
  logger.log('cityAssign', 'onEndpointSeenMessage called');
  try {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data || data.__extRelayEndpointSeen !== true) return;
    logger.log('cityAssign', 'CITY ENDPOINT  ' + data.path +
      '  captured: ' + (data.captured ? 'YES' : 'NO') +
      (data.captured ? '' : '   <-- body never read; if the board is served from here, this is the gap'));
  } catch (e) {
    logger.error('cityAssign', 'onEndpointSeenMessage failed', { error: e });
  }
}

// DROP-TRACE receiver (2026-08-13). Read-only.
//
// networkObserver.js has no logger, so it postMessages a reason code for every point where a
// captured response could previously be discarded silently, plus one line per response that
// made it through. This side does the logging, which is what makes it level-gated.
//
// READ THESE AS A MATCHED SET: within one refresh, every `seq` that appears on a CAPTURE OK
// line reached the store; every `seq` on a CAPTURE DROP line did not, and the reason says why.
// A seq that appears on neither was never observed at all.
function onCaptureTraceMessage(ev) {
  logger.log('cityAssign', 'onCaptureTraceMessage called');
  try {
    if (ev.source !== window) return;
    var data = ev.data;
    if (!data) return;

    if (data.__extRelayCaptureDrop === true) {
      logger.warn('cityAssign', 'CAPTURE DROP  seq=' + data.seq + '  ' + data.reason +
        '  path: ' + data.path +
        (data.status !== undefined ? '  status: ' + data.status : '') +
        (data.bodyLength !== undefined ? '  bodyLength: ' + data.bodyLength : '') +
        (data.responseType !== undefined ? '  responseType: ' + data.responseType : '') +
        (data.detail !== undefined ? '  (' + data.detail + ')' : ''));
      return;
    }

    if (data.__extRelayCaptureOk === true) {
      logger.log('cityAssign', 'CAPTURE OK    seq=' + data.seq +
        '  path: ' + data.path +
        '  totalResultsSize: ' + data.totalResultsSize +
        '  woCount: ' + data.woCount +
        '  bodyLength: ' + data.bodyLength);
      return;
    }
  } catch (e) {
    logger.error('cityAssign', 'onCaptureTraceMessage failed', { error: e });
  }
}

// Installed by content.js's activateExtensionUI(). Completely inert when the flag is off — it
// does not even register a listener, so a stock build carries zero runtime cost from this file.
function initCityAssign() {
  logger.log('cityAssign', 'initCityAssign called');
  try {
    // 2026-08-13: was gated on CITY_ASSIGN_DEBUG alone, which is why filtering did nothing in a
    // shipped build. The assignment is now a PRODUCT path — it runs whenever the filter feature
    // is on, at DEBUG_LEVEL 1 with both debug flags off.
    if (!cityAssignEnabled()) return;
    if (_cityAssignListener) return;  // idempotent: activation can be re-entered
    // The capture listener STAYS (2026-08-13) — the response path is kept intact, it simply no
    // longer feeds assignment. All it does now is buffer and log.
    _cityAssignListener = onCityCoordsMessage;
    window.addEventListener('message', _cityAssignListener);

    // Watches for Amazon re-rendering the board, so the filter re-asserts in the same frame
    // instead of 700 ms later. This is what removes the un-filtered flash.
    startBoardRenderObserver();

    // ASSIGNMENT NO LONGER WAITS FOR A RESPONSE (2026-08-13). The board is usually already
    // rendered when the extension activates, and nothing else would trigger a first cycle now
    // that the network message is not the source. Without this, a dispatcher who activated on an
    // already-loaded board saw nothing assigned until the next refresh.
    scheduleCityAssignCycle();

    // The two DIAGNOSTIC receivers stay debug-only — they exist to log, and a shipped build has
    // nothing to log. Not registering them also means their messages are never even inspected.
    if (typeof CITY_ASSIGN_DEBUG !== 'undefined' && CITY_ASSIGN_DEBUG) {
      _cityEndpointListener = onEndpointSeenMessage;
      window.addEventListener('message', _cityEndpointListener);
      _cityTraceListener = onCaptureTraceMessage;
      window.addEventListener('message', _cityTraceListener);
    }
    logger.log('cityAssign', 'city assignment ACTIVE', {
      filterEnabled: (typeof CITY_FILTER_ENABLED !== 'undefined' && CITY_FILTER_ENABLED),
      verboseDiagnostics: (typeof CITY_ASSIGN_DEBUG !== 'undefined' && CITY_ASSIGN_DEBUG),
      maxMiles: CITY_ASSIGN_MAX_MILES, settleMs: CITY_ASSIGN_SETTLE_MS
    });
  } catch (e) {
    logger.error('cityAssign', 'initCityAssign failed', { error: e });
  }
}

// Torn down by content.js's deactivateExtensionUI(). Drops the listener, the buffers and the
// pending timer. The resolved-coordinate cache is dropped too: on a re-activation the cities
// may have changed, and re-resolving a handful of cities once is cheaper than reasoning about
// whether a stale entry is still correct.
function teardownCityAssign() {
  logger.log('cityAssign', 'teardownCityAssign called');
  try {
    if (_cityAssignListener) {
      window.removeEventListener('message', _cityAssignListener);
      _cityAssignListener = null;
    }
    if (_cityEndpointListener) {
      window.removeEventListener('message', _cityEndpointListener);
      _cityEndpointListener = null;
    }
    if (_cityTraceListener) {
      window.removeEventListener('message', _cityTraceListener);
      _cityTraceListener = null;
    }
    if (_cityAssignTimer !== null) {
      clearTimeout(_cityAssignTimer);
      _cityAssignTimer = null;
    }
    // Same reason as the message listener: a logged-out page must be left with no live observer
    // of ours on it, and no pending animation frame.
    stopBoardRenderObserver();
    // deactivateExtensionUI() runs on logout, so a different dispatcher signing in on the same
    // browser profile can never inherit the previous one's load ids or coordinates. With the
    // accumulator gone the only id-bearing state left is the response buffer, which is dropped
    // here alongside the coordinate cache.
    // EVERY CARD BECOMES VISIBLE AGAIN. teardownCityAssign() runs from deactivateExtensionUI(),
    // i.e. on logout and on deactivate, so a dispatcher can never be left looking at a filtered
    // board with no extension running to un-filter it. Deliberately FIRST — if anything below
    // were to throw, the board is already restored.
    restoreAllCards();
    // And every deadhead we substituted. A logged-out page must show Amazon's own numbers, not a
    // frozen figure from a session that no longer exists — same reasoning as un-hiding the cards.
    restoreDeadheads();
    _cityFilterActive = null;
    _cityAssignByCard = {};

    _cityAssignBuffers = [];
    _cityCoordCache    = {};
    _cityAssignRunning = false;
    // The merged pickup map is load data keyed by work-opportunity id. teardownCityAssign runs
    // from deactivateExtensionUI, i.e. on LOGOUT — so a different dispatcher signing in on the
    // same profile can never inherit the previous one's loads or their coordinates.
    _cityPickupById  = {};
    _cityPickupOrder = [];
    clearUnassignedMarkers();
    _cityNoCoordIds  = {};
    _cityIdEndpointById = {};
    _cityRecordById  = {};
    _cityTrailerLabelById = {};
    // The page signature too, so a re-activation treats the first board it sees as a new working
    // set rather than matching a key left over from the previous session.
    _cityPageKey     = null;
    publishUnassignedCount(0);
  } catch (e) {
    logger.error('cityAssign', 'teardownCityAssign failed', { error: e });
  }
}

// Exposed for MANUAL console testing only — nothing calls these automatically, and the city
// buttons are deliberately NOT wired to them yet.
//
// ⚠ These live in the ISOLATED world. In DevTools the console defaults to the page's own
// context, where __EXT_DEBUG does not exist — switch the console's context dropdown to the
// extension before calling, exactly as with the existing __EXT_DEBUG.detectNewLoads().
//
//   __EXT_DEBUG.filterCity('CHICAGO, IL')  -> show only that city's loads
//   __EXT_DEBUG.filterCity()               -> show ALL again (also the panic button)
//   __EXT_DEBUG.cityAssignments()          -> the current id -> city map, to pick a valid key
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
// PART 2 (2026-08-20): dump the collected badge-letter + record pairs, for the PM.
window.__EXT_DEBUG.dumpTrailerLabels = dumpTrailerLabels;
window.__EXT_DEBUG.filterCity      = function (city) { return applyCityFilter(city); };
window.__EXT_DEBUG.cityAssignments = function () {
  var out = {};
  for (var k in _cityAssignByCard) {
    if (Object.prototype.hasOwnProperty.call(_cityAssignByCard, k)) out[k] = _cityAssignByCard[k];
  }
  return out;
};
