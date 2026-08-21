// originCities.js — floating panel listing the origin cities currently active in Amazon's
// load-board filters.
//
// READ-ONLY with respect to Amazon. This file never clicks, never writes to Amazon's DOM, and
// never issues a request. It reads filter-chip text and renders our own panel. SAFETY.md's
// click-site rules therefore do not apply — there is no .click() anywhere in this file.
//
// Built by content.js's activateExtensionUI(); torn down by deactivateExtensionUI(), so a
// logged-out page is left exactly as untouched as it is today.
//
// WHY NOT THE css-* CLASSES. The chips are wrapped in generated CSS-in-JS hashes
// (div.css-1w1nhw5 > div.css-e7fmj9 > span). Those change on every Amazon deploy — this repo
// has already been bitten by exactly that (see AMAZON_SELECTORS.md; three June 2026 attempts
// at the filter panel failed on hashed selectors). The only stable anchor is the visible text
// prefix "Origin city: ", which is user-facing copy and changes far less often.

var ORIGIN_PANEL_ID   = 'ext-origin-cities';
var ORIGIN_CITY_PREFIX = 'Origin city: ';

// Debounce for the observer. Amazon re-renders the filter area in bursts; this coalesces a
// burst into one read. Matches loadObserver.js's own 200ms for the same reason.
var ORIGIN_DEBOUNCE_MS = 200;

// Anchor = Amazon's results-count line ("Showing N results"), matched by TEXT.
// Gap to the right of the results-count text when the panel sits beside it.
// Gap below the row when there is not enough width to sit beside it.
// Below this much free width to the right, the panel drops under the row instead.
// Sub-pixel jitter threshold. Writing style on every frame regardless would dirty layout
// 60x/sec for nothing; 0.5px is below what any display can show.
// DEAD since 2026-08-14 (the panel no longer positions itself). Left in place only because
// removing a constant is a separate, deliberate cleanup — nothing reads it.

// Driver-name renaming (2026-08-05). Cap is enforced twice: `maxLength` on the input stops
// typing, and a slice on commit stops a paste getting past it.
var ORIGIN_NAME_MAX_LEN = 24;

var _originNames       = {};    // city string -> driver name, mirrors ORIGIN_DRIVER_NAMES_KEY
var _originNamesReady  = false; // false until storage has answered — see loadDriverNames()
var _originEditingCity = null;  // city currently being renamed, or null

var _originObserver    = null;
var _originDebounce    = null;
// True once the anchor has been successfully measured at least once. Distinguishes "the row has
// not appeared yet" (first paint — corner fallback is correct) from "the row went away for a
// moment" (Amazon re-rendering the list — hold position). See the not-found branch below.
var _originLastRender  = null;  // last rendered list, joined — used to skip idempotent renders
// Same list as _originLastRender but unjoined, kept so other modules can read the active
// cities without re-scraping the chips (2026-08-06). Written ONLY where _originLastRender is
// written, so the two can never disagree about what is on screen. See getActiveOriginCities().
var _originLastCities  = [];
// Which city the dispatcher has selected, or null for All. Panel-local UI state; the actual
// hiding lives in cityAssign.js. Survives a re-render so the selection is not lost on refresh.
var _originActiveFilter = null;

// Extracts the active origin cities from Amazon's filter chips.
//
// Returns e.g. ["LITTLE ROCK, AR", "CHICAGO, IL"] — de-duplicated, in DOM order.
// Returns [] when no origin filter is applied. Never throws.
//
// Matching is on the TEXT PREFIX, not on any class. Two details that matter:
//   - textContent is trimmed before testing. Amazon's own markup carries stray whitespace
//     elsewhere on this board (the Filter button's aria-label is literally "Filter  "), so an
//     untrimmed startsWith would silently miss chips.
//   - nested spans mean the same chip can match twice (an outer span's textContent also starts
//     with the prefix). De-duplication handles that rather than assuming a flat structure.
function readActiveOriginCities() {
  logger.log('originCities', 'readActiveOriginCities called');
  var found = [];
  try {
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];
      // Never read our own panel back in. Not currently possible (we render the bare city
      // without the prefix) but this keeps that a deliberate choice rather than a coincidence
      // that a later copy-edit could break.
      if (span.closest && span.closest('#' + ORIGIN_PANEL_ID)) continue;

      var text = span.textContent;
      if (!text) continue;
      text = text.trim();
      if (text.lastIndexOf(ORIGIN_CITY_PREFIX, 0) !== 0) continue; // startsWith, ES5-safe

      var city = text.slice(ORIGIN_CITY_PREFIX.length).trim();
      if (!city) continue;
      if (found.indexOf(city) === -1) found.push(city);
    }
  } catch (e) {
    logger.error('originCities', 'readActiveOriginCities failed', { error: e });
    return [];
  }
  logger.log('originCities', 'origin cities read', { count: found.length });
  return found;
}

// READ-ONLY ACCESSOR for other modules (added 2026-08-06 for content/cityAssign.js).
//
// Returns the cities as of the LAST RENDER, not a fresh scrape. Deliberate: re-scraping would
// walk every <span> on the page again, and — worse — could return a list the panel has not
// drawn yet (during a mid-rename hold, or before driver names have loaded), so a consumer
// could disagree with what the dispatcher can actually see.
//
// Returns a COPY. A caller that mutates the result must not be able to corrupt the panel's own
// idempotent-render bookkeeping. Empty array before the first render and after teardown.
// Changes NOTHING about this file's behaviour — nothing here writes.
function getActiveOriginCities() {
  logger.log('originCities', 'getActiveOriginCities called');
  return _originLastCities.slice();
}

// True only on the LOAD BOARD (2026-08-14). The row used to render on every Relay page, Trips
// included, pinned top-left where it looked like a stray widget.
//
// Anchored on the board's own DOM rather than on a URL path. The path for the board is not
// recorded anywhere on disk and guessing it risks hiding the row on the one page it belongs to;
// these three nodes are all confirmed from the captures (AMAZON_SELECTORS.md) and none of them
// exists on Trips:
//   - the results summary panel      #search-results-summary-panel
//   - the results list               div.load-list
//   - Amazon's origin filter chips   "Origin city: ..." — board-only copy
function isLoadBoardPage() {
  try {
    if (document.getElementById('search-results-summary-panel')) return true;
    if (document.querySelector('div.load-list')) return true;
    // The chips are the last resort: they are what this panel exists to mirror, so if they are
    // on screen the board is too, even mid-render before the list paints.
    return readActiveOriginCities().length > 0;
  } catch (e) {
    logger.error('originCities', 'isLoadBoardPage failed — assuming NOT the board', { error: e });
    return false;   // on doubt, do not render. An absent row is better than one on Trips.
  }
}

// Injects the panel's stylesheet once. Colours come entirely from the --ext-* design tokens,
// which already carry html.ext-night overrides (utils/designTokens.js) — so this panel themes
// itself in night mode with NO change to content/nightMode.js.
function injectOriginPanelStyle() {
  if (document.getElementById('ext-origin-cities-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-origin-cities-style';
  style.setAttribute('data-testid', 'ext-origin-cities-style');
  style.textContent =
    // MERGED INTO THE TOP BAR (2026-08-14). This was a separately positioned floating panel:
    // position:fixed, its own z-index, and a requestAnimationFrame loop measuring Amazon's
    // "Showing N results" row on every frame to sit under it. That overlapped Amazon's own
    // filter controls and appeared on every Relay page, Trips included.
    //
    // It is now the SECOND ROW of #ext-sidebar. No position, no z-index, no follow loop — the
    // bar owns all of that, and the row simply flows beneath row 1.
    '#ext-origin-cities{' +
      // Horizontal band: All + cities on one line, wrapping only when they do not fit.
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;' +
      'width:100%;box-sizing:border-box;' +
      // The bar's own background shows through; only a divider separates the two rows.
      'background:transparent;color:var(--ext-n900);' +
      'border-top:1px solid var(--ext-n200);' +
      'font-family:Arial,sans-serif;font-size:12px;' +
      'padding:6px 10px;user-select:none;' +
    '}' +
    // Hidden entirely until there are cities to show, so the bar does not grow an empty strip.
    '#ext-origin-cities[data-empty="true"]{display:none;}' +
    // U2: one constant row height, defined once. 14px text at line-height 1.25 is 17.5px, plus
    // 8px padding top and bottom and 1px border each side = 35.5px; 36px is that rounded up, so
    // nothing is clipped and no button can disagree with another.
    '#ext-origin-cities{--ext-city-btn-h:36px;}' +
    // THE "ALL" BUTTON (2026-08-13). Was a static caption; it is now the filter's reset control,
    // so it is styled as a pill like the cities rather than as a heading.
    // ── U2 (2026-08-20): THE ALL BUTTON WAS SHORTER, AND THE BADGE WAS NOT THE CAUSE ───────
    //
    // MEASURED FROM THE BOX MODEL, not guessed. Both buttons are <div>s with IDENTICAL
    // font-size 14px, font-weight 600, padding 8px 14px, 1px border and line-height 1.25.
    // The one difference was the DISPLAY:
    //   city pill : display:flex  -> children are flex items; height = the tallest child
    //   All button: NO display declared -> blockified as a flex item of the row, but its own
    //               children fall into an INLINE formatting context, so its height is a LINE
    //               BOX built by baseline-aligning 14px/1.25 text against an inline-block badge
    //               with line-height:16px. A different box model, therefore a different height.
    // The 'flex-direction:row;align-items:center' rule further down applied to it was INERT for
    // exactly the same reason — no flex display for it to act on.
    //
    // ⚠ THE BADGE IS NOT THE CAUSE, and this is checkable: the RESERVED BADGE SLOT (2026-08-14)
    // means both badges are ALWAYS in the DOM and merely transparent when empty. They are never
    // added or removed, so a count appearing cannot change any button's size. That was fixed six
    // days ago; what remained was this display asymmetry.
    //
    // THE FIX: same display for both, plus one explicit min-height so the row is a constant
    // height whatever any child does.
    '#ext-origin-cities [data-testid="ext-origin-cities-all"],' +
    '#ext-origin-cities [data-testid="ext-origin-city"]{' +
      'display:flex;flex-direction:row;align-items:center;' +
      'min-height:var(--ext-city-btn-h);box-sizing:border-box;' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-cities-all"]{' +
      'flex-shrink:0;' +
      'font-size:14px;font-weight:600;color:var(--ext-n700);white-space:nowrap;' +
      'background:var(--ext-n100);border:1px solid var(--ext-n200);' +
      'border-radius:var(--ext-radius-sm);padding:8px 14px;' +
      'cursor:pointer;line-height:1.25;' +
    '}' +
    // ACTIVE STATE, shared by "All" and the city pills. --ext-accent* tokens only, which already
    // carry html.ext-night overrides in utils/designTokens.js — so night mode needs no change
    // and nothing here is a hardcoded colour.
    //
    // ⚠ THE PAIRING MATTERS. --ext-accent-bg (a light tint) with --ext-accent-text is the
    // intended combination: measured 5.80:1 in light and 5.43:1 in night, both past the 4.5:1
    // WCAG floor for text under 18px. Filling with --ext-accent itself and keeping
    // --ext-accent-text gives 1.47:1 / 1.36:1 — effectively invisible. The saturated accent is
    // used for the BORDER instead, which is what makes the active pill obvious at a glance.
    '#ext-origin-cities [data-testid="ext-origin-cities-all"][data-active="true"],' +
    '#ext-origin-cities [data-testid="ext-origin-city"][data-active="true"]{' +
      'background:var(--ext-accent-bg);border-color:var(--ext-accent);' +
      'color:var(--ext-accent-text);font-weight:700;' +
    '}' +
    // NEW-LOAD BADGE. --ext-accent on --ext-surface: a count the eye catches without competing
    // with the active pill. Tokens only, so night mode is already handled.
    '#ext-origin-cities [data-testid="ext-origin-city-new"]{' +
      'display:inline-block;margin-left:6px;min-width:16px;padding:0 5px;' +
      'font-size:11px;font-weight:700;line-height:16px;text-align:center;' +
      'background:var(--ext-accent);color:var(--ext-surface);' +
      'border-radius:var(--ext-radius-pill);' +
    '}' +
    // A city with unseen loads gets an accent outline even when it is not the active tab.
    // REMOVED 2026-08-14: this gave every city with pending loads an accent border, so several
    // buttons looked alike and the OPEN tab was no longer obvious. Border and background now
    // belong to the active button and nothing else; pending loads are the badge's job alone.
    //
    // RESERVED BADGE SLOT (2026-08-14). The badge used to be appended and removed, which grew
    // the button and shifted the whole row every time a load arrived. Every city button now
    // carries the slot permanently and it is merely TRANSPARENT when empty, so the button's
    // width and height never change. min-width covers a two-digit count without reflow.
    '#ext-origin-cities [data-testid="ext-origin-city-new"][data-empty="true"],' +
    '#ext-origin-cities [data-testid="ext-origin-unassigned"][data-empty="true"]{' +
      'background:transparent;color:transparent;' +
    '}' +
    // UNASSIGNED COUNTER on the All button (2026-08-13). Loads whose id never arrived in any
    // captured response cannot be attributed to a city, so they stay visible under every filter.
    // Showing the number is the point: on 2026-08-13 EVERY card was unassigned and two city tabs
    // showed an identical list, which looked exactly like a working filter over similar boards.
    // A number the dispatcher can see makes that failure self-announcing.
    //
    // --ext-n700 on --ext-surface, measured 9.93:1 light / 7.22:1 night. Deliberately NOT the
    // accent: this is not news, it is a caveat about how much of the board the filter can speak
    // for, and it must not compete with the new-load badge sitting inches away. There is no
    // warning/danger token in designTokens.js — the dark neutral is the honest choice from the
    // palette that exists, rather than inventing a colour.
    '#ext-origin-cities [data-testid="ext-origin-unassigned"]{' +
      'display:inline-block;margin-left:6px;min-width:16px;padding:0 5px;' +
      'font-size:11px;font-weight:700;line-height:16px;text-align:center;' +
      'background:var(--ext-n700);color:var(--ext-surface);' +
      'border-radius:var(--ext-radius-pill);cursor:pointer;' +
    '}' +
    // THE UNMATCHED-ONLY VIEW IS ACTIVE. The All button takes the SAME active treatment a city
    // pill does — same two tokens, measured 5.80:1 / 5.43:1 — so "I am filtered" reads
    // identically wherever the filter came from. The badge inverts to surface-on-n700 so it
    // stays legible on the now-accent-coloured button.
    '#ext-origin-cities [data-testid="ext-origin-cities-all"][data-unmatchedview="true"]{' +
      'background:var(--ext-accent-bg);color:var(--ext-accent-text);' +
      'border-color:var(--ext-accent);font-weight:700;' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-cities-all"][data-unmatchedview="true"] ' +
      '[data-testid="ext-origin-unassigned"]{' +
      'background:var(--ext-accent-text);color:var(--ext-surface);' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-cities-all"]{' +
      'flex-direction:row;align-items:center;' +
    '}' +
    // The data-hasunassigned border rule was REMOVED 2026-08-14, for the same reason as the
    // city border above: the count speaks for itself, and only the ACTIVE button is allowed to
    // carry a border or a background.

    // The city pill is a column flex container; the badge must sit beside the label, not under.
    '#ext-origin-cities [data-testid="ext-origin-city"]{flex-direction:row;align-items:center;}' +
    // The label is a child element with its own colour rule, so it must follow the active state
    // too — otherwise the pill turns accent-coloured with unreadable dark text on it.
    '#ext-origin-cities [data-testid="ext-origin-city"][data-active="true"] ' +
      '[data-testid="ext-origin-city-label"]{' +
      'color:var(--ext-accent-text);' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-cities-list"]{' +
      'display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px;' +
      'min-width:0;' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-city"]{' +
      // Subtle pill. Horizontal city names contain their own comma ("LITTLE ROCK, AR"), so
      // gap alone reads as one run-on string — the pill is what separates them.
      'font-size:14px;font-weight:600;color:var(--ext-n700);white-space:nowrap;' +
      'background:var(--ext-n100);border:1px solid var(--ext-n200);' +
      // HIT TARGET (2026-08-05): was font-size:12px + padding:1px 6px, which gave a ~19px-tall
      // button — fiddly to click. Now 14px text with 8px/14px padding: roughly 35px tall and
      // 28px wider than its text, so the target is comfortably larger than the glyphs.
      'border-radius:var(--ext-radius-sm);padding:8px 14px;' +
      'cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;' +
    '}' +
    // Explicit rather than inherited, so the label's size cannot drift if the pill's own
    // font-size is ever changed for another reason.
    '#ext-origin-cities [data-testid="ext-origin-city-label"]{' +
      'font-size:14px;font-weight:600;color:var(--ext-n700);' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-city"]:focus-visible{' +
      'outline:2px solid var(--ext-accent);outline-offset:1px;' +
    '}' +
    // Driver name = primary label once set.
    '#ext-origin-cities [data-testid="ext-origin-driver-name"]{' +
      'font-size:12px;font-weight:600;color:var(--ext-n700);' +
    '}' +
    // City beneath the name — smaller and muted, but NEVER dropped: the dispatcher has to be
    // able to see which city a name belongs to. --ext-text-muted does not exist in
    // designTokens.js; --ext-n500 is the nearest existing muted token and is what this panel's
    // own caption already uses.
    '#ext-origin-cities [data-testid="ext-origin-city-sub"]{' +
      'font-size:10px;font-weight:400;color:var(--ext-n500);' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-name-input"]{' +
      'font-family:inherit;font-size:12px;font-weight:600;' +
      'color:var(--ext-n900);background:var(--ext-surface);' +
      'border:1px solid var(--ext-accent);border-radius:var(--ext-radius-sm);' +
      'padding:0 4px;width:120px;outline:none;' +
    '}' +
    '#ext-origin-cities [data-testid="ext-origin-cities-empty"]{' +
      'font-size:11px;font-weight:400;color:var(--ext-n400);font-style:italic;' +
    '}';
  document.head.appendChild(style);
}

// Renders the list into the panel. textContent only — city names are PAGE DATA and must never
// go through innerHTML (CLAUDE.md rule 6).
function renderOriginCities(cities) {
  logger.log('originCities', 'renderOriginCities called', { count: cities.length });
  var panel = document.getElementById(ORIGIN_PANEL_ID);
  if (!panel) return;
  var list = panel.querySelector('[data-testid="ext-origin-cities-list"]');
  if (!list) return;

  while (list.firstChild) list.removeChild(list.firstChild);

  // THE ROW IS HIDDEN ENTIRELY WHEN THERE IS NOTHING TO SHOW (2026-08-14). data-empty drives a
  // display:none rule, so the bar does not carry a blank strip on a page with no origin filter —
  // or on a page that is not the load board at all.
  var showRow = cities.length > 0 && isLoadBoardPage();
  if (showRow) panel.removeAttribute('data-empty');
  else panel.setAttribute('data-empty', 'true');

  if (cities.length === 0) {
    // Kept for the case where the dispatcher is ON the board with no origin filter applied: the
    // row is hidden, but the message is there the moment data-empty is cleared.
    var empty = document.createElement('div');
    empty.setAttribute('data-testid', 'ext-origin-cities-empty');
    empty.textContent = 'No origin cities in filters';
    list.appendChild(empty);
    return;
  }
  for (var i = 0; i < cities.length; i++) {
    list.appendChild(buildCityItem(cities[i]));
  }

  // If the selected city has disappeared from the filters, fall back to All rather than leaving
  // a selection pointing at a city that is no longer on the board.
  if (_originActiveFilter !== null && cities.indexOf(_originActiveFilter) === -1) {
    logger.log("originCities", "active city no longer in filters — reverting to All");
    selectCityFilter(null);
    return;
  }
  paintActiveCityButton();
}

// Builds one pill. Unnamed: the city text alone. Named: the driver name as the primary label
// with the city beneath it, smaller and muted — the city is never dropped.
// textContent only: both the city (page data) and the name (dispatcher input) are untrusted.
// Builds one city button. Shows the CITY TEXT ONLY.
//
// RENAME IS DISCONNECTED, NOT DELETED (2026-08-05). The click on a city is being reserved for
// per-city filtering in a later task, so it is a no-op for now. What was removed from THIS
// function, and what re-wiring it needs:
//   1. `item.addEventListener('click', … startRenameCity(city))`
//   2. the matching Enter/Space `keydown` handler — otherwise the editor would still be
//      reachable by keyboard and "unreachable" would be false
//   3. the two-line named render (ext-origin-driver-name + ext-origin-city-sub), because with
//      no way to set a name it could only ever display one restored from storage
// Everything the rename NEEDS is still here and still callable: startRenameCity(),
// commitDriverName(), loadDriverNames(), ORIGIN_DRIVER_NAMES_KEY, the _originNames cache (still
// loaded on every build), the _originEditingCity guard in refreshOriginCities(), the input's
// CSS, and the driver-name/city-sub CSS rules. Stored names are NOT wiped — a dispatcher who
// named cities before this change still has them, and they reappear the moment (1)-(3) return.
function buildCityItem(city) {
  logger.log('originCities', 'buildCityItem called');
  var item = document.createElement('div');
  item.setAttribute('data-testid', 'ext-origin-city');
  item.setAttribute('data-city', city);
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  // No "click to rename" hint — the click does nothing, and promising an action we do not
  // perform is worse than saying nothing.
  item.setAttribute('title', city);

  var labelEl = document.createElement('div');
  labelEl.setAttribute('data-testid', 'ext-origin-city-label');
  labelEl.textContent = city;
  item.appendChild(labelEl);

  // WIRED 2026-08-13. Single-select: clicking a city shows only that city; clicking the ACTIVE
  // city again returns to All. The rename editor stays disconnected, as decided — this click is
  // the filtering action the element was reserved for.
  item.addEventListener('click', function () {
    selectCityFilter(_originActiveFilter === city ? null : city);
  });
  item.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      selectCityFilter(_originActiveFilter === city ? null : city);
    }
  });
  return item;
}

// ── NEW-LOAD INDICATOR (2026-08-13) ───────────────────────────────────────────────────────
//
// WHY. With a city filter active, a new load for a DIFFERENT city is still detected and still
// sounds — but its card is hidden, so auto-open would leave the dispatcher looking at a detail
// panel with no card behind it. Instead the pipeline marks the owning city's button, and he
// decides when to switch. Deliberately no auto-switch: changing tabs under his hands while he is
// reading a load is worse than a missed second.
//
// city string -> unseen new-load count. Cleared for a city when he opens it.
var _originNewCounts = {};

// Records new loads for a city that is not currently visible. Called by content.js.
function markCityNewLoads(city, count) {
  logger.log('originCities', 'markCityNewLoads called', { count: count });
  try {
    if (!city || !count) return;
    _originNewCounts[city] = (_originNewCounts[city] || 0) + count;
    paintCityNewCounts();
  } catch (e) {
    logger.error('originCities', 'markCityNewLoads failed', { error: e, count: count });
  }
}

// Renders each city's unseen count as a badge on its button. Additive to the pill's own content
// so the city label is never replaced — textContent only, never innerHTML.
function paintCityNewCounts() {
  logger.log('originCities', 'paintCityNewCounts called');
  try {
    var panel = document.getElementById(ORIGIN_PANEL_ID);
    if (!panel) return;
    var items = panel.querySelectorAll('[data-testid="ext-origin-city"]');
    for (var i = 0; i < items.length; i++) {
      var city = items[i].getAttribute('data-city');
      var n = _originNewCounts[city] || 0;
      // RESERVED SLOT (2026-08-14). The badge used to be appended and removed, which changed the
      // button's width every time a load arrived and shifted the whole row under the dispatcher's
      // cursor. The slot is now permanent and merely goes transparent when empty, so the button
      // is exactly the same size with and without a count.
      var badge = items[i].querySelector('[data-testid="ext-origin-city-new"]');
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-testid', 'ext-origin-city-new');
        badge.setAttribute('aria-label', 'new loads');
        items[i].appendChild(badge);
      }
      // A zero-width space keeps the slot's line box even when there is nothing to show, so an
      // empty slot occupies exactly the height a filled one does.
      badge.textContent = n > 0 ? String(n) : '​';
      if (n > 0) {
        badge.removeAttribute('data-empty');
        // data-hasnew is kept as a hook for tests and future use, but it NO LONGER draws a
        // border (2026-08-14) — only the active button is highlighted.
        items[i].setAttribute('data-hasnew', 'true');
      } else {
        badge.setAttribute('data-empty', 'true');
        items[i].removeAttribute('data-hasnew');
      }
    }
  } catch (e) {
    logger.error('originCities', 'paintCityNewCounts failed', { error: e });
  }
}

// Applies a filter selection and repaints the active state. null = All.
//
// The filtering itself lives in cityAssign.js; this file only decides WHAT is selected and how
// it looks. applyCityFilter() is a no-op when CITY_FILTER_ENABLED is off, so a build with the
// feature disabled still gets working buttons that simply do not filter.
function selectCityFilter(city) {
  logger.log('originCities', 'selectCityFilter called', { toAll: city === null });
  try {
    _originActiveFilter = city;
    // Opening a city clears its unseen-load badge — he has now seen them.
    if (city !== null && _originNewCounts[city]) delete _originNewCounts[city];
    if (typeof applyCityFilter === 'function') applyCityFilter(city);
    else logger.warn('originCities', 'applyCityFilter unavailable — selection recorded only');
    paintActiveCityButton();
    paintCityNewCounts();
  } catch (e) {
    logger.error('originCities', 'selectCityFilter failed', { error: e, hasCity: city !== null });
  }
}

// How many rendered loads could NOT be attributed to any city, shown on the All button.
//
// WHY THIS EXISTS (2026-08-13). On the HEBRON and COLUMBUS tabs every card was unassigned, so
// both tabs showed an identical list — and an identical list of plausible loads is exactly what a
// working filter looks like. Nothing on screen contradicted it. This number does: when it equals
// the board size, the filter is speaking for nothing, and that is visible at a glance instead of
// needing a console.
var _originUnassigned = 0;

// Where clicking the badge a second time returns to. Captured when the view is entered, so the
// toggle restores the city Ihor was actually on rather than dumping him on "All".
var _originUnmatchedReturnTo = null;

// Toggles the unmatched-only view. Wired to the badge, and to Enter/Space on it.
function toggleUnmatchedFilter() {
  logger.log('originCities', 'toggleUnmatchedFilter called', { count: _originUnassigned });
  try {
    if (typeof CITY_FILTER_UNMATCHED === 'undefined') {
      logger.warn('originCities', 'cityAssign not loaded — unmatched view unavailable');
      return;
    }
    if (_originActiveFilter === CITY_FILTER_UNMATCHED) {
      selectCityFilter(_originUnmatchedReturnTo);      // back to where he was
      return;
    }
    if (_originUnassigned <= 0) return;                // rule 4: nothing to inspect
    _originUnmatchedReturnTo = _originActiveFilter;
    selectCityFilter(CITY_FILTER_UNMATCHED);
  } catch (e) {
    logger.error('originCities', 'toggleUnmatchedFilter failed', { error: e });
  }
}

function markUnassignedLoads(count) {
  logger.log('originCities', 'markUnassignedLoads called', { count: count });
  try {
    var n = (typeof count === 'number' && isFinite(count) && count > 0) ? Math.floor(count) : 0;
    if (n === _originUnassigned) return;    // no DOM write when nothing changed
    _originUnassigned = n;
    paintUnassignedCount();
  } catch (e) {
    logger.error('originCities', 'markUnassignedLoads failed', { error: e, count: count });
  }
}

function paintUnassignedCount() {
  logger.log('originCities', 'paintUnassignedCount called');
  try {
    var panel = document.getElementById(ORIGIN_PANEL_ID);
    if (!panel) return;
    var allBtn = panel.querySelector('[data-testid="ext-origin-cities-all"]');
    if (!allBtn) return;
    // Same reserved slot as the city badges (2026-08-14): always present, transparent when
    // empty, so the All button never changes size.
    var badge = allBtn.querySelector('[data-testid="ext-origin-unassigned"]');
    {
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-testid', 'ext-origin-unassigned');
        badge.setAttribute('aria-label', 'loads with no city');
        // addEventListener only, attached once at creation — the badge is rebuilt only when it
        // goes from absent to present, so this cannot stack up. stopPropagation keeps the click
        // off the All button underneath it, which would otherwise clear the filter instead.
        badge.addEventListener('click', function (ev) {
          ev.stopPropagation();
          toggleUnmatchedFilter();
        });
        badge.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          ev.stopPropagation();
          toggleUnmatchedFilter();
        });
        allBtn.appendChild(badge);
      }
      if (_originUnassigned > 0) {
        badge.textContent = String(_originUnassigned);
        badge.setAttribute('title', 'Show only the ' + _originUnassigned +
          ' load(s) that could not be matched to a city. Click again to go back.');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.removeAttribute('data-empty');
        allBtn.setAttribute('data-hasunassigned', 'true');
      } else {
        // The slot STAYS, transparent and inert, so the All button keeps its size. Not
        // focusable and not described, so it cannot be tabbed to or clicked at zero —
        // toggleUnmatchedFilter() refuses at zero anyway, this just removes the affordance.
        badge.textContent = '​';
        badge.setAttribute('data-empty', 'true');
        badge.removeAttribute('title');
        badge.removeAttribute('role');
        badge.removeAttribute('tabindex');
        allBtn.removeAttribute('data-hasunassigned');
        // Leaving the view active with nothing to show would be a blank board with no way back.
        if (_originActiveFilter === CITY_FILTER_UNMATCHED) {
          logger.log('originCities', 'unmatched count fell to zero — leaving the unmatched view');
          selectCityFilter(_originUnmatchedReturnTo);
        }
      }
    }
  } catch (e) {
    logger.error('originCities', 'paintUnassignedCount failed', { error: e });
  }
}

// Marks exactly one control active. Uses a data attribute rather than an inline style so the
// colours stay in the stylesheet and therefore in --ext-* tokens, which night mode already
// overrides — nothing here hardcodes a colour.
function paintActiveCityButton() {
  logger.log('originCities', 'paintActiveCityButton called');
  try {
    var panel = document.getElementById(ORIGIN_PANEL_ID);
    if (!panel) return;
    var unmatchedView = (typeof CITY_FILTER_UNMATCHED !== 'undefined' &&
                         _originActiveFilter === CITY_FILTER_UNMATCHED);
    var allBtn = panel.querySelector('[data-testid="ext-origin-cities-all"]');
    if (allBtn) {
      // "All" is active only when nothing is filtered. The unmatched view is its own state and
      // gets its own attribute — showing both would claim the board is unfiltered while it is
      // hiding most of it.
      if (_originActiveFilter === null) allBtn.setAttribute('data-active', 'true');
      else allBtn.removeAttribute('data-active');
      if (unmatchedView) allBtn.setAttribute('data-unmatchedview', 'true');
      else allBtn.removeAttribute('data-unmatchedview');
    }
    var items = panel.querySelectorAll('[data-testid="ext-origin-city"]');
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-city') === _originActiveFilter) {
        items[i].setAttribute('data-active', 'true');
      } else {
        items[i].removeAttribute('data-active');
      }
    }
  } catch (e) {
    logger.error('originCities', 'paintActiveCityButton failed', { error: e });
  }
}

// Swaps one pill for a text input. Enter or blur commits, Escape cancels, empty clears.
function startRenameCity(city) {
  logger.log('originCities', 'startRenameCity called');
  try {
    if (_originEditingCity !== null) return; // already editing something
    var panel = document.getElementById(ORIGIN_PANEL_ID);
    if (!panel) return;
    var item = panel.querySelector('[data-testid="ext-origin-city"][data-city="' + city + '"]');
    if (!item) return;

    _originEditingCity = city;

    var input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('data-testid', 'ext-origin-name-input');
    input.setAttribute('maxlength', String(ORIGIN_NAME_MAX_LEN));
    input.setAttribute('aria-label', 'Driver name for ' + city);
    input.setAttribute('placeholder', city);
    input.value = Object.prototype.hasOwnProperty.call(_originNames, city) ? _originNames[city] : '';

    var settled = false;
    var finish = function (commit) {
      if (settled) return;          // blur fires after Enter/Escape too — only act once
      settled = true;
      _originEditingCity = null;
      if (commit) commitDriverName(city, input.value);
      else        renderOriginCities(readActiveOriginCities());
    };
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter')  { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });

    while (item.firstChild) item.removeChild(item.firstChild);
    item.appendChild(input);
    input.focus();
    input.select();
  } catch (e) {
    logger.error('originCities', 'startRenameCity failed', { error: e, city: city });
    _originEditingCity = null;
  }
}

// Writes (or clears) the name, persists it, and re-renders. An empty value removes the entry
// so the city reverts to showing its own text.
function commitDriverName(city, rawValue) {
  logger.log('originCities', 'commitDriverName called');
  try {
    var name = String(rawValue == null ? '' : rawValue).trim().slice(0, ORIGIN_NAME_MAX_LEN);
    if (name) _originNames[city] = name;
    else      delete _originNames[city];

    renderOriginCities(readActiveOriginCities());

    // Fire-and-forget: storage.set already swallows and logs its own failures, and a failed
    // write must not cost the dispatcher the label they can see on screen.
    Promise.resolve(storage.set(ORIGIN_DRIVER_NAMES_KEY, _originNames))
      .catch(function (e) {
        logger.error('originCities', 'persisting driver names failed', { error: e, city: city });
      });
  } catch (e) {
    logger.error('originCities', 'commitDriverName failed', { error: e, city: city });
  }
}

// Loads stored names BEFORE the first render, so the panel never shows raw city names and then
// swaps them for driver names. Resolves either way — a storage failure renders plain cities
// rather than blocking the panel.
function loadDriverNames() {
  logger.log('originCities', 'loadDriverNames called');
  return Promise.resolve()
    .then(function () { return storage.get(ORIGIN_DRIVER_NAMES_KEY, {}); })
    .then(function (stored) {
      _originNames = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
    })
    .catch(function (e) {
      logger.error('originCities', 'loadDriverNames failed — rendering plain city names', {
        error: e, key: ORIGIN_DRIVER_NAMES_KEY
      });
      _originNames = {};
    })
    .then(function () { _originNamesReady = true; });
}









// Reads + renders, but ONLY when the extracted list actually changed.
//
// This is the primary self-trigger guard: our own render mutates the DOM, which wakes the
// observer, which calls back here. Comparing against the last rendered list makes that second
// pass a no-op, so there is no feedback loop even if the observer's own subtree filter is ever
// loosened.
function refreshOriginCities() {
  var cities = readActiveOriginCities();
  var signature = cities.join('|');
  // Names not loaded yet — rendering now would show raw city text and then swap. The load
  // callback calls this again. Signature deliberately NOT recorded, so that call still renders.
  if (!_originNamesReady) return;
  // Mid-rename: Amazon re-renders the board on every refresh tick, so without this the input
  // would be destroyed under the dispatcher's cursor. Signature again NOT recorded, so the
  // render happens once editing ends.
  if (_originEditingCity !== null) return;
  if (signature === _originLastRender) return;
  _originLastRender = signature;
  _originLastCities = cities.slice();  // read-only mirror for getActiveOriginCities()
  logger.log('originCities', 'origin city list changed — re-rendering', { count: cities.length });
  renderOriginCities(cities);
  // NOTE: positioning is deliberately NOT done here any more (2026-08-05). It lives entirely in
  // the rAF follow loop, so this debounced path is once again purely about the list.
}

// Watches for filter changes. MutationObserver rather than setInterval: filter edits are
// event-driven and rare, so polling would burn cycles on a page this extension already has
// memory pressure on (see the sidebar's memory indicator).
//
// Anchored on document.body for the same reason loadObserver.js is — Amazon is a React SPA and
// unmounts/remounts the filter containers, so binding to any inner node goes permanently deaf
// once that node is replaced.
function startOriginObserver() {
  logger.log('originCities', 'startOriginObserver called');
  if (_originObserver) return;
  _originObserver = new MutationObserver(function (mutations) {
    // Ignore mutations we caused ourselves. Cheap first-pass filter; refreshOriginCities()'s
    // change comparison is the real guarantee.
    var external = false;
    for (var i = 0; i < mutations.length; i++) {
      var t = mutations[i].target;
      if (t && t.closest && t.closest('#' + ORIGIN_PANEL_ID)) continue;
      external = true;
      break;
    }
    if (!external) return;

    if (_originDebounce !== null) clearTimeout(_originDebounce);
    _originDebounce = setTimeout(function () {
      _originDebounce = null;
      refreshOriginCities();
    }, ORIGIN_DEBOUNCE_MS);
  });
  _originObserver.observe(document.body, { childList: true, subtree: true });

  // NOTE (2026-08-05): the debounced `resize` and `scroll` listeners that used to be registered
  // here are GONE. Both existed only to signal "the anchor may have moved", and the rAF follow
  // loop observes that directly, every frame — so they were redundant, not merely superseded.
}

// Builds the panel and starts watching. Called once per activation from content.js.
// Swallows its own errors: a failure here must never abort activateExtensionUI() and cost the
// dispatcher the sidebar and the monitoring loop.
function buildOriginCitiesPanel() {
  logger.log('originCities', 'buildOriginCitiesPanel called');
  try {
    if (document.getElementById(ORIGIN_PANEL_ID)) {
      logger.warn('originCities', 'origin cities panel already present, skipping');
      return;
    }
    injectOriginPanelStyle();

    var panel = document.createElement('div');
    panel.id = ORIGIN_PANEL_ID;
    panel.setAttribute('data-testid', ORIGIN_PANEL_ID);
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Active origin cities');

    // THE "ALL" BUTTON (2026-08-13). What used to be a static label is now the filter's reset
    // control: it clears the city filter and shows every load from every selected city. It is
    // the default state, so it starts active.
    var title = document.createElement('div');
    title.setAttribute('data-testid', 'ext-origin-cities-all');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('title', 'Show loads from all selected cities');
    title.textContent = 'All';
    title.addEventListener('click', function () { selectCityFilter(null); });
    title.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        selectCityFilter(null);
      }
    });

    var list = document.createElement('div');
    list.setAttribute('data-testid', 'ext-origin-cities-list');

    panel.appendChild(title);
    panel.appendChild(list);

    // KEYSTROKE CONTAINMENT. Amazon's board listens for keys at the document level; a name
    // typed into our input must never reach it. Stopping all three key events at the panel
    // covers every handler style — keydown (modern shortcuts), keypress (legacy), keyup (some
    // toggles). stopPropagation, NOT stopImmediatePropagation: our own input handlers sit on a
    // descendant and have already run by the time bubbling reaches here, and we must not
    // cancel them. Registered on the panel, so it also covers any future control we add.
    ['keydown', 'keypress', 'keyup'].forEach(function (type) {
      panel.addEventListener(type, function (ev) { ev.stopPropagation(); });
    });

    // MERGED INTO THE TOP BAR (2026-08-14). Was document.body.appendChild + position:fixed +
    // an rAF loop measuring Amazon's results row every frame. It now lives INSIDE #ext-sidebar
    // as a second row, so the bar owns position, stacking and dragging, and the panel can no
    // longer overlap Amazon's own filter controls.
    var bar = document.getElementById('ext-sidebar');
    if (!bar) {
      // The sidebar builds first in activateExtensionUI(), so this should not happen. Refusing
      // is right if it ever does: appending to body would resurrect the floating panel this
      // change exists to remove, and a panel with no position would land wherever it fell.
      logger.warn('originCities', 'top bar not present — origin cities row NOT injected');
      return;
    }
    bar.appendChild(panel);

    _originLastRender = null;     // force the first render
    startOriginObserver();
    // Render only AFTER stored names are in, so no raw-city flash. refreshOriginCities()
    // early-returns until _originNamesReady, including if the observer fires first.
    loadDriverNames().then(function () { refreshOriginCities(); });
    logger.log('originCities', 'origin cities panel injected');
  } catch (e) {
    logger.error('originCities', 'buildOriginCitiesPanel failed', { error: e });
  }
}

// Removes the panel, its stylesheet, the observer and any pending debounce. Safe to call when
// nothing was built. Mirrors deactivateExtensionUI()'s "revert to fully untouched" guarantee.
function removeOriginCitiesPanel() {
  logger.log('originCities', 'removeOriginCitiesPanel called');
  try {
    if (_originObserver) {
      _originObserver.disconnect();
      _originObserver = null;
    }
    // Cancel the follow loop. Without this it would keep calling requestAnimationFrame forever
    // after logout — a permanent ~60fps callback on a page the extension no longer owns.
    // stopOriginFollowLoop() removed 2026-08-14 — there is no follow loop any more; the row
    // is a child of #ext-sidebar and is removed with it.
    if (_originDebounce !== null) {
      clearTimeout(_originDebounce);
      _originDebounce = null;
    }
    // The seven positioning variables that used to be reset here are GONE (2026-08-14) along
    // with the follow loop. Leaving the assignments behind would have been worse than untidy:
    // this file is not in strict mode, so assigning to an undeclared name creates a GLOBAL on
    // window — silently, on every logout.
    _originLastRender = null;
    // Nothing is on screen after teardown, so the accessor must report nothing rather than a
    // stale list from the previous session.
    _originLastCities = [];
    // Selection resets to All. cityAssign's teardown separately restores every hidden card, so
    // the two halves cannot disagree about the filter state after a logout.
    _originActiveFilter = null;
    _originNewCounts = {};
    // The unmatched view and its return-to memory reset with everything else, so a re-activation
    // never starts inside a debug view or remembers the previous session's city.
    _originUnassigned = 0;
    _originUnmatchedReturnTo = null;
    // Driver-name state. The panel and its input go with the panel element; this just makes a
    // later rebuild re-read from storage rather than trusting an in-memory copy from the
    // previous session. Stored names themselves are NEVER cleared here — they persist.
    _originNames       = {};
    _originNamesReady  = false;
    _originEditingCity = null;
    var panel = document.getElementById(ORIGIN_PANEL_ID);
    if (panel) panel.remove();
    var style = document.getElementById('ext-origin-cities-style');
    if (style) style.remove();
  } catch (e) {
    logger.error('originCities', 'removeOriginCitiesPanel failed', { error: e });
  }
}
