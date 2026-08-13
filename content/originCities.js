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
var ORIGIN_ANCHOR_RE = /^Showing\b.*\bresults?$/;
// Gap to the right of the results-count text when the panel sits beside it.
var ORIGIN_ANCHOR_GAP_PX = 16;
// Gap below the row when there is not enough width to sit beside it.
var ORIGIN_BELOW_GAP_PX = 6;
// Below this much free width to the right, the panel drops under the row instead.
var ORIGIN_MIN_RIGHT_SPACE_PX = 200;
// Sub-pixel jitter threshold. Writing style on every frame regardless would dirty layout
// 60x/sec for nothing; 0.5px is below what any display can show.
var ORIGIN_MOVE_EPSILON_PX = 0.5;
// Used only when the results-count text cannot be found — see positionOriginPanel().
var ORIGIN_FALLBACK_TOP_PX  = 8;
var ORIGIN_FALLBACK_LEFT_PX = 8;

// Driver-name renaming (2026-08-05). Cap is enforced twice: `maxLength` on the input stops
// typing, and a slice on commit stops a paste getting past it.
var ORIGIN_NAME_MAX_LEN = 24;

var _originNames       = {};    // city string -> driver name, mirrors ORIGIN_DRIVER_NAMES_KEY
var _originNamesReady  = false; // false until storage has answered — see loadDriverNames()
var _originEditingCity = null;  // city currently being renamed, or null

var _originObserver    = null;
var _originDebounce    = null;
var _originAnchorEl    = null;  // CACHED results-count element — see getAnchorElement()
var _originRafId       = null;  // requestAnimationFrame handle for the follow loop
var _originLastTop     = null;  // last written top/left/mode, for the >0.5px change test
var _originLastLeft    = null;
var _originLastMode    = null;
// True once the anchor has been successfully measured at least once. Distinguishes "the row has
// not appeared yet" (first paint — corner fallback is correct) from "the row went away for a
// moment" (Amazon re-rendering the list — hold position). See the not-found branch below.
var _originHasMeasured = false;
var _originHoldLogged  = false; // so the hold is logged once, not once per frame
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

// Injects the panel's stylesheet once. Colours come entirely from the --ext-* design tokens,
// which already carry html.ext-night overrides (utils/designTokens.js) — so this panel themes
// itself in night mode with NO change to content/nightMode.js.
function injectOriginPanelStyle() {
  if (document.getElementById('ext-origin-cities-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-origin-cities-style';
  style.setAttribute('data-testid', 'ext-origin-cities-style');
  style.textContent =
    '#ext-origin-cities{' +
      // top/left are NOT set here — positionOriginPanel() measures and writes them on every
      // render, resize and scroll. A hardcoded offset would drift the moment Amazon's chips
      // wrap to a second row or the dispatcher scrolls.
      'position:fixed;' +
      // One below the sidebar's 2147483647, so if they ever meet the sidebar wins.
      'z-index:2147483646;' +
      // Horizontal band: caption + cities on one line, wrapping only when they do not fit.
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;' +
      // Bounded so a long filter set cannot run off the right edge; wrapping absorbs the rest.
      'max-width:calc(100vw - 16px);' +
      'background:var(--ext-bar-bg);color:var(--ext-n900);' +
      'border:1px solid var(--ext-n200);border-radius:var(--ext-radius-card);' +
      'box-shadow:var(--ext-shadow-2);' +
      'font-family:Arial,sans-serif;font-size:12px;' +
      'padding:6px 10px;user-select:none;' +
    '}' +
    // THE "ALL" BUTTON (2026-08-13). Was a static caption; it is now the filter's reset control,
    // so it is styled as a pill like the cities rather than as a heading.
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

  if (cities.length === 0) {
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

// Applies a filter selection and repaints the active state. null = All.
//
// The filtering itself lives in cityAssign.js; this file only decides WHAT is selected and how
// it looks. applyCityFilter() is a no-op when CITY_FILTER_ENABLED is off, so a build with the
// feature disabled still gets working buttons that simply do not filter.
function selectCityFilter(city) {
  logger.log('originCities', 'selectCityFilter called', { toAll: city === null });
  try {
    _originActiveFilter = city;
    if (typeof applyCityFilter === 'function') applyCityFilter(city);
    else logger.warn('originCities', 'applyCityFilter unavailable — selection recorded only');
    paintActiveCityButton();
  } catch (e) {
    logger.error('originCities', 'selectCityFilter failed', { error: e, hasCity: city !== null });
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
    var allBtn = panel.querySelector('[data-testid="ext-origin-cities-all"]');
    if (allBtn) {
      if (_originActiveFilter === null) allBtn.setAttribute('data-active', 'true');
      else allBtn.removeAttribute('data-active');
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


// Finds Amazon's results-count element ("Showing 104 results") by TEXT — never by class or id.
//
// Requires a LEAF (no element children), so we match the node that literally holds the text
// rather than every ancestor whose textContent happens to contain it.
//
// EXPENSIVE: scans every element in the document. Deliberately NOT called per frame — see
// getAnchorElement().
function findAnchorElement() {
  logger.log('originCities', 'findAnchorElement called');
  try {
    var els = document.body.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children && el.children.length > 0) continue;      // leaves only
      if (el.closest && el.closest('#' + ORIGIN_PANEL_ID)) continue;
      var text = el.textContent;
      if (!text) continue;
      if (ORIGIN_ANCHOR_RE.test(text.trim())) return el;
    }
  } catch (e) {
    logger.error('originCities', 'findAnchorElement failed', { error: e });
  }
  return null;
}

// Cached accessor. The rAF loop runs ~60x/sec; re-scanning every element every frame would be
// indefensible. The element's IDENTITY does not change as the board reflows — only its rect —
// so the scan runs once and is repeated only when the cached node leaves the DOM (Amazon's
// React re-render). Steady-state cost per frame is therefore ONE getBoundingClientRect().
function getAnchorElement() {
  if (_originAnchorEl && _originAnchorEl.isConnected) return _originAnchorEl;
  _originAnchorEl = findAnchorElement();
  return _originAnchorEl;
}

// Walks up from the anchor to the nearest ANCESTOR with a non-zero height — that is the row.
//
// Starts at parentElement, not at the element itself. The results-count leaf usually has its own
// non-zero height, so starting at `el` would return the leaf and centre the panel on the text
// rather than on its row — a few px out, and wrong for the below-branch's row.bottom/row.left.
// Returns { el, rect } — the rect is handed back so the caller does not re-measure the same
// node. That keeps the steady-state frame cost at exactly TWO getBoundingClientRect() calls.
function findAnchorRow(el) {
  var node = el ? el.parentElement : null;
  while (node && node !== document.body) {
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (r && r.height > 0) return { el: node, rect: r };
    node = node.parentElement;
  }
  return null;
}

// Positions the panel relative to the results-count row. Called every animation frame.
//
// WHY THIS ANCHOR, not the chips (changed 2026-08-05): the results-count line sits ABOVE the
// chip band, so a panel glued to it no longer covers the first load card — which the
// below-the-chips placement did at narrow widths.
//
// Two branches, both logged on transition:
//   BESIDE — vertically centred on the row, left edge at the text's right + 16px. Uses
//            translateY(-50%) so the panel's own height is never measured: one rect read.
//   BELOW  — when free width to the right is under 200px: row.bottom + 6px, aligned to row.left.
//
// Writes only when top or left moved by more than 0.5px, so a still board costs zero style
// writes and zero layout invalidation.
function positionOriginPanel() {
  var panel = document.getElementById(ORIGIN_PANEL_ID);
  if (!panel) return;
  try {
    var anchor = getAnchorElement();
    var row    = anchor ? findAnchorRow(anchor) : null;
    if (!anchor || !row) {
      // HOLD THE LAST GOOD POSITION (2026-08-05 fix). Every board refresh clears and re-renders
      // Amazon's load list, and the "Showing N results" row is briefly absent while that
      // happens. This branch used to apply the corner fallback on those frames, so the panel
      // snapped to top-left and back on every single refresh — read by the dispatcher as a
      // flicker.
      //
      // If we have ever measured a real position, the panel's inline top/left are already
      // correct: do nothing at all and let a later frame pick the anchor back up. No timeout,
      // no retry counter, no visibility toggle — the loop runs every frame, so "keep the last
      // value" is the whole mechanism.
      //
      // The corner fallback now only applies before the row has EVER existed, which is the one
      // case where there is no last-good position to hold.
      if (_originHasMeasured) {
        if (!_originHoldLogged) {
          _originHoldLogged = true;
          logger.log('originCities', 'anchor missing — holding last measured position', {
            heldTop: _originLastTop, heldLeft: _originLastLeft
          });
        }
        return;
      }
      if (_originLastMode !== 'fallback') {
        logger.warn('originCities', 'results-count text not found — using fallback position', {
          anchorFound: !!anchor, rowFound: !!row,
          pattern: String(ORIGIN_ANCHOR_RE),
          fallbackTop: ORIGIN_FALLBACK_TOP_PX, fallbackLeft: ORIGIN_FALLBACK_LEFT_PX
        });
      }
      applyOriginPosition(panel, ORIGIN_FALLBACK_TOP_PX, ORIGIN_FALLBACK_LEFT_PX, 'fallback');
      return;
    }
    // Anchor is back (or here for the first time) — resume normal measuring.
    _originHoldLogged = false;

    var textRect = anchor.getBoundingClientRect();
    var rowRect  = row.rect; // already measured by findAnchorRow — do not read it twice

    // Free width is measured against the VIEWPORT, not the row: the panel is position:fixed, so
    // the viewport edge is what actually clips it.
    var freeRight = window.innerWidth - textRect.right - ORIGIN_ANCHOR_GAP_PX;
    if (freeRight >= ORIGIN_MIN_RIGHT_SPACE_PX) {
      applyOriginPosition(panel, rowRect.top + rowRect.height / 2,
                          textRect.right + ORIGIN_ANCHOR_GAP_PX, 'beside');
    } else {
      applyOriginPosition(panel, rowRect.bottom + ORIGIN_BELOW_GAP_PX, rowRect.left, 'below');
    }
  } catch (e) {
    logger.error('originCities', 'positionOriginPanel failed', { error: e });
    applyOriginPosition(panel, ORIGIN_FALLBACK_TOP_PX, ORIGIN_FALLBACK_LEFT_PX, 'fallback');
  }
}

// Single place that touches style. Skips the write unless something actually moved.
function applyOriginPosition(panel, top, left, mode) {
  var moved = _originLastTop  === null ||
              Math.abs(top  - _originLastTop)  > ORIGIN_MOVE_EPSILON_PX ||
              Math.abs(left - _originLastLeft) > ORIGIN_MOVE_EPSILON_PX;
  if (!moved && mode === _originLastMode) return;

  if (mode !== _originLastMode) {
    logger.log('originCities', 'panel placement branch', { mode: mode });
    // 'beside' centres on the row via translateY(-50%); the other two align to a top edge.
    panel.style.transform = (mode === 'beside') ? 'translateY(-50%)' : '';
  }
  panel.style.top  = top + 'px';
  panel.style.left = left + 'px';
  _originLastTop  = top;
  _originLastLeft = left;
  _originLastMode = mode;
  // Only a REAL measurement arms the hold. The corner fallback must never count as one, or the
  // first-paint fallback would be held forever instead of being replaced once the row appears.
  if (mode !== 'fallback') _originHasMeasured = true;
}

// requestAnimationFrame follow loop.
//
// WHY rAF AND NOT A DEBOUNCE (changed 2026-08-05): the dispatcher collapses Amazon's left
// filter panel and the whole board reflows. A debounced reposition made the panel visibly SNAP
// into place after the reflow had finished. Reading the rect every frame makes it travel with
// the content instead. This also makes the previous resize and scroll listeners redundant —
// both were only ever proxies for "the anchor may have moved", which the loop now observes
// directly — so they were removed rather than left running alongside it.
function startOriginFollowLoop() {
  logger.log('originCities', 'startOriginFollowLoop called');
  if (_originRafId !== null) return;
  var tick = function () {
    positionOriginPanel();
    _originRafId = requestAnimationFrame(tick);
  };
  _originRafId = requestAnimationFrame(tick);
}

function stopOriginFollowLoop() {
  if (_originRafId !== null) {
    cancelAnimationFrame(_originRafId);
    _originRafId = null;
  }
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

    document.body.appendChild(panel);

    _originLastRender = null;     // force the first render
    startOriginObserver();
    startOriginFollowLoop();      // owns ALL positioning from here on
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
    stopOriginFollowLoop();
    if (_originDebounce !== null) {
      clearTimeout(_originDebounce);
      _originDebounce = null;
    }
    _originAnchorEl   = null;
    _originLastTop    = null;
    _originLastLeft   = null;
    _originLastMode   = null;
    // CLEARED, not carried over. Without this a logout→login cycle would start with the hold
    // already armed and _originLastTop/_originLastLeft still holding the previous session's
    // coordinates — so a rebuild whose anchor is not yet present would hold a stale position
    // from a board that may have scrolled or resized since. Cleared, the rebuild correctly
    // treats itself as a first paint.
    _originHasMeasured = false;
    _originHoldLogged  = false;
    _originLastRender = null;
    // Nothing is on screen after teardown, so the accessor must report nothing rather than a
    // stale list from the previous session.
    _originLastCities = [];
    // Selection resets to All. cityAssign's teardown separately restores every hidden card, so
    // the two halves cannot disagree about the filter state after a logout.
    _originActiveFilter = null;
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
