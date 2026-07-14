// Per-tab in-memory load data store — keyed by loadId (UUID string).
//
// IMPORTANT: this store is in-memory only and is cleared on any page reload, including
// the dispatcher-triggered ext-memory-indicator reload. Phase 2 (detail) data is only
// repopulated when the dispatcher reopens that load's detail sheet after reload.
// NOT backed by sessionStorage or chrome.storage.local — LoadUnit data is transient
// session data tied to the current board view, not a user setting.
//
// LoadUnit lifecycle:
//   Phase 1 fields (payout, stops, equipment, etc.) — populated each board tick by loadParser.js.
//   Phase 2 field  (detail)                         — populated when the detail sheet is opened, by inlinePanel.js.
//   searchContext                                    — always null; future work, requires new Amazon selector work.

var loadStore = (function () {

  var _units = {}; // { [loadId]: LoadUnit }

  // Derive a numeric payout from a raw string like "$427.61" or "$2,320.23".
  // Returns null when the string is absent or unparseable (caller uses null to mean "unknown").
  // Strips $ and , before parseFloat — same normalization as parseNumStr in patApi.js
  // (loadStore loads before patApi so it cannot call parseNumStr directly).
  function _parsePayoutNum(payoutStr) {
    if (!payoutStr) return null;
    var n = parseFloat(payoutStr.replace(/[$,]/g, ''));
    return isNaN(n) ? null : n;
  }

  // Merge a partial update into the LoadUnit for loadId, creating it if absent.
  // patch may contain any subset of LoadUnit fields.
  // Special rules:
  //   _element is always ignored — DOM nodes are never stored.
  //   detail replaces any existing detail in full (not merged recursively).
  //   searchContext replaces any existing searchContext in full.
  //   payoutNum is derived automatically from patch.payout when present.
  function mergeLoadUnit(loadId, patch) {
    logger.log('loadStore', 'mergeLoadUnit called', { loadId: loadId });
    if (!loadId) return;
    if (!_units[loadId]) {
      _units[loadId] = {
        loadId:          loadId,
        firstSeenAt:     Date.now(),
        payout:          null,
        payoutNum:       null,
        pricePerMile:    null,
        distance:        null,
        duration:        null,
        boardStops:      [],
        equipment:       null,
        trailerLetter:   null,
        loadingType:     null,
        deadhead:        null,
        tag:             null,
        specialServices: false,
        detail:          null,
        searchContext:   null
      };
    }
    var unit = _units[loadId];
    for (var key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      if (key === '_element') continue; // never store DOM nodes
      unit[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'payout')) {
      unit.payoutNum = _parsePayoutNum(patch.payout);
    }
  }

  // Returns the LoadUnit for loadId, or null if not found.
  function getLoadUnit(loadId) {
    logger.log('loadStore', 'getLoadUnit called', { loadId: loadId });
    return _units[loadId] || null;
  }

  // Removes LoadUnits for loads no longer on the board.
  // currentLoadIds must be a Set<string> of loadIds currently visible.
  function pruneLoadUnits(currentLoadIds) {
    logger.log('loadStore', 'pruneLoadUnits called', { surviving: currentLoadIds.size });
    var ids = Object.keys(_units);
    for (var i = 0; i < ids.length; i++) {
      if (!currentLoadIds.has(ids[i])) {
        delete _units[ids[i]];
      }
    }
  }

  // Returns the live internal map (by reference) for debugging and future backend sync.
  // Callers must not mutate the returned objects.
  function getAllLoadUnits() {
    logger.log('loadStore', 'getAllLoadUnits called', { count: Object.keys(_units).length });
    return _units;
  }

  return {
    mergeLoadUnit:  mergeLoadUnit,
    getLoadUnit:    getLoadUnit,
    pruneLoadUnits: pruneLoadUnits,
    getAllLoadUnits: getAllLoadUnits
  };

})();

// Expose for manual console inspection — same pattern as loadParser.js's __EXT_DEBUG.getLoads.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.getLoadUnits = loadStore.getAllLoadUnits;
