// Per-tab state store — isolates running, refreshIntervalMs, surgeThreshold, priceHistory.
// Each tab has its own in-memory state; sessionStorage backs three of the four fields so
// they survive the memory-watchdog page reload without touching chrome.storage.local.
//
// running:           in-memory only — always starts false; memory-reload resume is handled
//                    separately via sessionStorage['ext_resume_after_memory_reload'].
// refreshIntervalMs: sessionStorage['ext_tab_speed']          (persists across reload)
// surgeThreshold:    sessionStorage['ext_tab_surge_threshold'] (persists across reload)
// priceHistory:      sessionStorage['ext_tab_price_history']   (persists across reload)
//
// Global settings (nightMode, sounds, tag filters, surgeEnabled) stay in chrome.storage.local.

var tabState = (function () {

  var _state = {
    running:           false,
    refreshIntervalMs: 2000,
    surgeThreshold:    50,
    priceHistory:      {}
  };

  var _subscribers = {}; // { key: [fn, ...] }

  function _notify(key) {
    var subs = _subscribers[key];
    if (!subs) return;
    var val = _state[key];
    for (var i = 0; i < subs.length; i++) {
      try {
        subs[i](val);
      } catch (e) {
        logger.error('tabState', '_notify callback threw', { key: key, error: e });
      }
    }
  }

  function get(key) {
    return _state[key];
  }

  function set(key, value) {
    if (key !== 'priceHistory' && _state[key] === value) {
      logger.debug('tabState', 'set: value unchanged — skipping', { key: key, value: value });
      return;
    }
    logger.log('tabState', 'set', { key: key, value: key === 'priceHistory' ? '[object]' : value });
    _state[key] = value;
    // Mirror non-running fields to sessionStorage so they survive a page reload.
    try {
      if (key === 'refreshIntervalMs') {
        sessionStorage.setItem('ext_tab_speed', String(value));
      } else if (key === 'surgeThreshold') {
        sessionStorage.setItem('ext_tab_surge_threshold', String(value));
      } else if (key === 'priceHistory') {
        sessionStorage.setItem('ext_tab_price_history', JSON.stringify(value));
      }
      // 'running' is intentionally not persisted — always reset on page load.
    } catch (e) {
      logger.error('tabState', 'sessionStorage write failed', { key: key, error: e });
    }
    _notify(key);
  }

  function subscribe(key, fn) {
    logger.log('tabState', 'subscribe', { key: key });
    if (!_subscribers[key]) _subscribers[key] = [];
    _subscribers[key].push(fn);
  }

  // Needed once features can be deactivated + reactivated within the same page load
  // (login/logout without reload — see utils/authGate.js) — without this, each
  // reactivation's buildSidebar() would add another permanent subscriber referencing a
  // detached DOM node from the previous activation.
  function unsubscribe(key, fn) {
    var subs = _subscribers[key];
    if (!subs) return;
    var idx = subs.indexOf(fn);
    if (idx !== -1) subs.splice(idx, 1);
  }

  // init() is async because seeding surgeThreshold may need one chrome.storage.local read
  // (only on the very first open of a tab that has no sessionStorage value yet).
  // Returns a Promise so callers can await it before building UI that reads tabState.
  function init() {
    logger.log('tabState', 'init called');
    return new Promise(function (resolve) {
      try {
        // Restore refresh speed
        var savedSpeed = sessionStorage.getItem('ext_tab_speed');
        if (savedSpeed !== null) {
          var ms = parseFloat(savedSpeed);
          if (!isNaN(ms) && ms > 0) {
            _state.refreshIntervalMs = ms;
            logger.log('tabState', 'refreshIntervalMs restored', { ms: ms });
          }
        }

        // Restore price history
        var savedHistory = sessionStorage.getItem('ext_tab_price_history');
        if (savedHistory) {
          try {
            var parsed = JSON.parse(savedHistory);
            if (parsed && typeof parsed === 'object') {
              _state.priceHistory = parsed;
              logger.log('tabState', 'priceHistory restored', { keys: Object.keys(parsed).length });
            }
          } catch (e) {
            logger.error('tabState', 'priceHistory parse failed', { error: e });
          }
        }

        // Restore surge threshold — prefer sessionStorage; fall back to global storage default
        var savedThreshold = sessionStorage.getItem('ext_tab_surge_threshold');
        if (savedThreshold !== null) {
          var thr = Number(savedThreshold);
          if (!isNaN(thr) && thr > 0) {
            _state.surgeThreshold = thr;
            logger.log('tabState', 'surgeThreshold restored from sessionStorage', { value: thr });
            resolve();
            return;
          }
        }

        // No sessionStorage threshold — seed from the popup's global default
        chrome.storage.local.get(STORAGE_KEYS.SURGE_THRESHOLD, function (data) {
          try {
            var globalThr = data[STORAGE_KEYS.SURGE_THRESHOLD];
            if (globalThr !== undefined) {
              var n = Number(globalThr);
              if (!isNaN(n) && n > 0) {
                _state.surgeThreshold = n;
                logger.log('tabState', 'surgeThreshold seeded from global storage', { value: n });
              }
            }
          } catch (e) {
            logger.error('tabState', 'global surgeThreshold read failed', { error: e });
          }
          resolve();
        });

      } catch (e) {
        logger.error('tabState', 'init failed', { error: e });
        resolve(); // always resolve so the caller can proceed
      }
    });
  }

  return { get: get, set: set, subscribe: subscribe, unsubscribe: unsubscribe, init: init };

})();
