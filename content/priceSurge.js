// Price Surge Alert — read-only feature.
// NO .click() on Amazon elements, NO booking, NO innerHTML with page data.
// Compares per-load payout against the previous tick's value stored in tabState.
// Per-tab: threshold and price history live in tabState (sessionStorage-backed).
// Triggers only on INCREASES >= threshold. Rebuilds history from scratch each tick
// so entries for gone loads are automatically purged (no unbounded growth).
// Returns array of surge load objects so content.js can auto-stop + open details
// via the existing openTopNewLoad neutral-zone click — priceSurge.js never clicks anything.

function injectSurgeStyle() {
  if (document.getElementById('ext-surge-style')) return;
  var style = document.createElement('style');
  style.id = 'ext-surge-style';
  style.textContent =
    '.ext-surge-price{' +
      'color:#7a4f00 !important;background:rgba(212,167,44,.12);' +
      'border-radius:3px;padding:0 3px;' +
    '}' +
    '.ext-surge-badge{' +
      'display:inline-block;font-size:10px;font-weight:600;' +
      'color:#7a4f00;margin-left:4px;vertical-align:middle;' +
    '}' +
    'html.ext-night .ext-surge-price{' +
      'color:#f0c040 !important;background:rgba(212,167,44,.20) !important;' +
    '}' +
    'html.ext-night .ext-surge-badge{' +
      'color:#f0c040 !important;-webkit-text-fill-color:#f0c040 !important;' +
    '}';
  document.head.appendChild(style);
}

injectSurgeStyle();

function clearSurgeHighlights() {
  logger.log('priceSurge', 'clearSurgeHighlights called');
  var priceEls = document.querySelectorAll('.ext-surge-price');
  priceEls.forEach(function (el) { el.classList.remove('ext-surge-price'); });
  var badges = document.querySelectorAll('[data-testid="ext-surge-badge"]');
  badges.forEach(function (badge) { if (badge.parentNode) badge.parentNode.removeChild(badge); });
}

function highlightSurge(card, delta) {
  logger.log('priceSurge', 'highlightSurge called', { delta: delta });
  var payoutEl = card.querySelector('.wo-total_payout');
  if (!payoutEl) return;
  payoutEl.classList.add('ext-surge-price');
  var badge = document.createElement('span');
  badge.className = 'ext-surge-badge';
  badge.setAttribute('data-testid', 'ext-surge-badge');
  badge.textContent = '↑ +$' + Math.round(delta);
  payoutEl.parentNode.insertBefore(badge, payoutEl.nextSibling);
}

function parsePayoutNumber(payoutStr) {
  if (!payoutStr) return NaN;
  var cleaned = payoutStr.replace(/[$,]/g, '').trim();
  return parseFloat(cleaned);
}

async function checkPriceSurge(loads) {
  logger.log('priceSurge', 'checkPriceSurge called', { loadCount: loads.length });
  try {
    // surgeEnabled is a global setting — stays in chrome.storage.local
    var stored  = await chrome.storage.local.get(STORAGE_KEYS.SURGE_ENABLED);
    var enabled = stored[STORAGE_KEYS.SURGE_ENABLED] === true;

    // threshold and history are per-tab — read from tabState (synchronous)
    var threshold = tabState.get('surgeThreshold');
    var history   = tabState.get('priceHistory');

    if (!enabled) {
      clearSurgeHighlights();
      if (Object.keys(history).length > 0) {
        tabState.set('priceHistory', {});
        logger.log('priceSurge', 'disabled — price history reset to {}');
      }
      return [];
    }

    if (isNaN(threshold) || threshold <= 0) threshold = 50;

    var newHistory = {};
    var surgeHits  = []; // { load, delta }

    for (var i = 0; i < loads.length; i++) {
      var load   = loads[i];
      var loadId = load.loadId;
      if (loadId === null || loadId === undefined) continue;

      var payout = parsePayoutNumber(load.payout);
      if (isNaN(payout)) continue;

      newHistory[loadId] = payout;

      var prev = history[loadId];

      if (prev !== undefined) {
        var delta     = payout - prev;
        var triggered = delta >= threshold;
        if (triggered && load._element) {
          surgeHits.push({ load: load, delta: delta });
        }
      }
    }

    // Save rebuilt history per-tab — automatically purges gone loads (no unbounded growth)
    tabState.set('priceHistory', newHistory);
    logger.log('priceSurge', 'history saved', { trackedLoads: Object.keys(newHistory).length });

    clearSurgeHighlights();
    for (var j = 0; j < surgeHits.length; j++) {
      highlightSurge(surgeHits[j].load._element, surgeHits[j].delta);
    }

    if (surgeHits.length > 0) {
      logger.log('priceSurge', 'surge triggered', { count: surgeHits.length });
      await playAlert();
    }

    // Return load objects only — content.js handles auto-stop + neutral-zone open.
    // priceSurge.js never clicks anything.
    return surgeHits.map(function (h) { return h.load; });

  } catch (e) {
    logger.error('priceSurge', 'checkPriceSurge failed', { error: e });
    return [];
  }
}
