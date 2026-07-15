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

  // Payout: .wo-total_payout → raw text e.g. "$427.61"
  const payout = card.querySelector('.wo-total_payout')?.textContent?.trim() || null;

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

function parseLoads() {
  logger.log('loadParser', 'parseLoads called');

  // Use only the FIRST div.load-list (main results).
  // The second div.load-list is "Similar matches" — ignored entirely.
  const mainList = document.querySelector('div.load-list');
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
