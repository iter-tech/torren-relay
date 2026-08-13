// Layout A ONLY — Load Board (div.load-card / div.load-card__selected).
// NO Layout B, NO .click(), NO setInterval, NO auto-run.

// Deduplicated in-memory collector: { [rawBoardLabel] → true }.
// Tracks display names seen on the load board. Enum codes are a separate concern —
// use window.__EXT_DEBUG.getEquipmentEnumMap() on the PAT form page for that.
// Populated by parseOneCard on every call path (tick + on-demand PAT parse).
// Read via window.__EXT_DEBUG.getSeenEquipmentTypes().
var _seenEquipmentTypes = {};

function parseOneCard(card) {
  // loadId: inner div whose id attribute is a UUID
  const loadId = card.querySelector('div[id]')?.id || null;

  // Payout: "$427.61". TWO inner classes, not one (2026-07-31 fix).
  //
  // Main board:      <span class="wo-total_payout">$427.61</span>
  // Similar matches: <span class="wo-total_payout__match-deviation-attr">$309.08</span>
  //
  // Why the old single `.wo-total_payout` selector missed the second one: a CSS class selector
  // matches whole class TOKENS. `wo-total_payout__match-deviation-attr` is one indivisible
  // token — it is not "wo-total_payout" plus a suffix — so `.wo-total_payout` never matched it
  // and every load in the Similar-matches section parsed with payout = null.
  //
  // Both listed explicitly rather than a `[class^="wo-total_payout"]` prefix match: a prefix/
  // substring match would also hit any ancestor or sibling whose class merely starts with the
  // same string, and querySelector returns the first match in DOCUMENT order, not selector
  // order — so a wrapper appearing earlier would silently win and yield the wrong text.
  //
  // NOTE — a third member of this family is already documented in AMAZON_SELECTORS.md:
  // `.wo-total_payout__modified-load-increase-attr` (price-increase highlight). It is
  // deliberately NOT included here: we have no capture proving it is the payout element itself
  // rather than a separate badge on the card, and if it is a badge that precedes the payout in
  // document order, adding it would make price-increased loads parse the WRONG number. See the
  // 2026-07-31 CHANGELOG entry — capture that markup and this becomes a one-token change.
  //
  // The `|| null` is unchanged and load-bearing: an unreadable payout must stay null so the PAT
  // modal keeps the field empty, shows its warning, and blocks Confirm. This widens what can be
  // read; it never substitutes a value.
  const payout = card.querySelector('.wo-total_payout, .wo-total_payout__match-deviation-attr')
    ?.textContent?.trim() || null;

  // Collect all .wo-card-header__components for multi-field parsing
  const components = Array.from(card.querySelectorAll('.wo-card-header__components'));

  // Price per mile: the component whose text contains "/mi" → "$1.84/mi"
  const ppmEl = components.find(function (el) {
    return el.textContent.includes('/mi');
  });
  const pricePerMile = ppmEl ? ppmEl.textContent.trim() : null;

  // Distance: component whose text contains "mi" but NOT "/mi" → "104.0 mi"
  const distEl = components.find(function (el) {
    var t = el.textContent;
    return t.includes('mi') && !t.includes('/mi');
  });
  const distance = distEl ? distEl.textContent.trim() : null;

  // Duration: component matching a time-span pattern → "2h 52m", "2d 5h", "8h 28m"
  // Pattern: digit(s) followed immediately by 'd' or 'h'. Excludes distance strings.
  const durEl = components.find(function (el) {
    var t = el.textContent;
    return /\d+[dh]/.test(t) && !t.includes('mi');
  });
  const duration = durEl ? durEl.textContent.trim() : null;

  // Stops: components that look like location strings.
  // Heuristic: contains ", " (comma-space as in "CITY, ST") and does not contain "/mi".
  // Layout A pickup/delivery times use no commas ("Tue May 12 19:15 EDT"), so they are excluded.
  const stops = components
    .filter(function (el) {
      return el.textContent.includes(', ') && !el.textContent.includes('/mi');
    })
    .map(function (el) { return el.textContent.trim(); });

  // Equipment type → "53' Trailer"
  const equipment = card.querySelector('.equipment-type-text')?.textContent?.trim() || null;
  if (equipment && !Object.prototype.hasOwnProperty.call(_seenEquipmentTypes, equipment)) {
    _seenEquipmentTypes[equipment] = true;
    logger.log('loadParser', 'new equipment type seen', { equipment: equipment });
  }

  // Trailer type letter circle → "P" (may be absent)
  const trailerCircle = card.querySelector('.trailer-type-circle');
  const trailerLetter = trailerCircle ? (trailerCircle.textContent.trim() || null) : null;

  // Loading type → "Drop" or "Live"
  const loadingType = card.querySelector('.loading-type')?.textContent?.trim() || null;

  // Deadhead: the element immediately before span[title="Deadhead"] → "32.31 mi"
  const deadheadAnchor = card.querySelector('span[title="Deadhead"]');
  const deadhead = deadheadAnchor?.previousElementSibling?.textContent?.trim() || null;

  // Tag: id="STARTING_SOON" or class .wo-tag → "Starting soon", else null
  const tagEl = card.querySelector('#STARTING_SOON, .wo-tag');
  const tag = tagEl ? (tagEl.textContent.trim() || null) : null;

  // Special services flag — presence of text in the card
  const specialServices = card.textContent.includes('Special Services');

  // _element: kept for Stage 13 (neutral-zone click to open details). Never used for booking.
  return {
    loadId,
    payout,
    pricePerMile,
    equipment,
    trailerLetter,
    loadingType,
    deadhead,
    distance,
    duration,
    stops,
    tag,
    specialServices,
    _element: card
  };
}

// Locates the MAIN results list, structurally rather than by document order (2026-08-13).
//
// WHY THIS EXISTS. The board renders TWO div.load-list elements: main results and the
// "Similar matches" block (AMAZON_SELECTORS.md). The old code took
// `document.querySelector('div.load-list')` — the first in document order — and relied on main
// happening to come first. On the captured DOM it does, so this is HARDENING, not a bug fix:
// nothing on screen changes today. But the reliance is invisible and unasserted, and if Amazon
// ever reorders those blocks, this function would start feeding Similar-matches loads into
// detectNewLoads — which fires the sound alert and the highlight. That is the failure this
// removes.
//
// The anchor is the summary panel ("Showing 1 - N of N results"), which is a SIBLING of the
// results, not a container — walking UP for it finds nothing (that mistake cost cityAssign a
// day). Panel id first, class second. Never a css-<hash> class: those rotate on every deploy.
// Never the text "Recently added": that block is not always rendered.
//
// ⚠ DELIBERATELY DIFFERENT FROM cityAssign.findMainResultsList(). That one returns null when the
// panel is missing, because reading nothing there costs only a log line. HERE, reading nothing
// would silently stop the highlight and the alert sound — worse than the fragility being fixed.
// So every failure path falls back to the previous behaviour and warns.
//
// NOT shared with cityAssign.js on purpose: that module is log-only, flag-gated and loads AFTER
// this one in manifest order. The shipped alert path must not depend on it.
function findMainLoadList() {
  logger.log('loadParser', 'findMainLoadList called');
  const fallback = document.querySelector('div.load-list');
  let panel = null;
  try {
    panel = document.getElementById('search-results-summary-panel');
    if (!panel) {
      const divs = document.querySelectorAll('div');
      for (let i = 0; i < divs.length; i++) {
        if (String(divs[i].className || '').indexOf('search-results-summary__panel') !== -1) {
          panel = divs[i];
          break;
        }
      }
    }
    if (panel) {
      let sib = panel.nextElementSibling;
      while (sib) {
        const found = (sib.matches && sib.matches('div.load-list'))
          ? sib
          : (sib.querySelector ? sib.querySelector('div.load-list') : null);
        if (found) return found;
        sib = sib.nextElementSibling;
      }
    }
    // Fallback, never null-return: see the warning above.
    logger.warn('loadParser', 'main results panel/list not found — falling back to the first ' +
      'div.load-list in document order (highlight and alert must keep working)', {
        panelFound: !!panel,
        loadListsInDocument: document.querySelectorAll('div.load-list').length,
        fallbackFound: !!fallback
      });
    return fallback;
  } catch (e) {
    logger.error('loadParser', 'findMainLoadList failed — falling back', {
      error: e, panelFound: !!panel, fallbackFound: !!fallback
    });
    return fallback;
  }
}

function parseLoads() {
  logger.log('loadParser', 'parseLoads called');

  // The MAIN results list only. The other div.load-list is "Similar matches" — never read.
  const mainList = findMainLoadList();
  if (!mainList) {
    logger.warn('loadParser', 'no load-list found');
    return [];
  }
  // Convert NodeList to array and drop any element contained within another match.
  // .wo-card-header--highlighted may be an inner child of .load-card, producing a
  // duplicate entry with loadId=null and noisy error logs.
  const allCards = Array.from(mainList.querySelectorAll('div.load-card, div.load-card__selected, div.wo-card-header--highlighted'));
  const cards = allCards.filter(function (elA) {
    return !allCards.some(function (elB) { return elB !== elA && elB.contains(elA); });
  });
  if (cards.length !== allCards.length) {
    logger.debug('loadParser', 'dropped nested card matches', { dropped: allCards.length - cards.length });
  }

  if (cards.length === 0) {
    logger.warn('loadParser', 'no load-card elements found in main load-list');
    return [];
  }

  const results = [];

  for (const card of cards) {
    // Extract loadId early so it is available in the catch even if parseOneCard throws
    let loadId = null;
    try {
      loadId = card.querySelector('div[id]')?.id || null;
      const load = parseOneCard(card);
      results.push(load);
      // Phase 1 merge into LoadUnit store — additive only, does not change the return value.
      // _element is intentionally excluded (DOM node, never serialized).
      loadStore.mergeLoadUnit(load.loadId, {
        payout:          load.payout,
        pricePerMile:    load.pricePerMile,
        distance:        load.distance,
        duration:        load.duration,
        boardStops:      load.stops,
        equipment:       load.equipment,
        trailerLetter:   load.trailerLetter,
        loadingType:     load.loadingType,
        deadhead:        load.deadhead,
        tag:             load.tag,
        specialServices: load.specialServices
      });
    } catch (e) {
      logger.error('loadParser', 'failed to parse card', { loadId, error: e });
    }
  }

  // Remove LoadUnits for loads that are no longer on the board.
  // Skip prune when results is empty — a transient React remount during a filter change
  // can return 0 cards momentarily; pruning then would wipe Phase 2 detail data for all live loads.
  const currentIds = new Set(results.map(l => l.loadId).filter(Boolean));
  if (results.length === 0) {
    logger.debug('loadParser', 'parseLoads: 0 results — skipping pruneLoadUnits (transient empty render)');
  } else {
    loadStore.pruneLoadUnits(currentIds);
  }

  logger.log('loadParser', 'parseLoads done', { count: results.length });
  return results;
}

// Expose for manual console testing only — NOT called automatically.
// content.js does NOT call parseLoads(). No observer, no interval here.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.getLoads = parseLoads;
window.__EXT_DEBUG.getSeenEquipmentTypes = function () {
  return Object.keys(_seenEquipmentTypes).sort();
};
