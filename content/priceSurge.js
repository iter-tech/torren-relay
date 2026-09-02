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
    // ── THE INCREASE AMOUNT (2026-08-26, Ihor's decision, from a live screenshot) ────────
    //
    // It rendered correctly as "↑ +$53" — detection and render both work. The problem was
    // LEGIBILITY: the delta was 10px, carried the SAME #7a4f00 as the tinted payout beside it,
    // and sat 4px away, so the two read as one blob at a glance.
    //
    // THREE CHANGES, AND ONLY THREE:
    //   colour      -> var(--ext-success), the token's LIGHT value #157347
    //   font-size   -> 11px, ONE step up this file's own ladder (9/10/11/12/13/14/15/16/18);
    //                  11px is also the size used most often across the extension's CSS
    //   margin-left -> 20px, a +16px growth (Ihor asked for 15-20px more separation)
    //
    // ⚠ THE PAYOUT'S OWN AMBER TINT (.ext-surge-price) IS DELIBERATELY UNTOUCHED. Two
    // different colours on two different things is the whole point — amber marks WHICH payout
    // moved, green states BY HOW MUCH.
    //
    // ⚠ NO DECREASE STATE EXISTS AND NONE WAS ADDED. checkPriceSurge() triggers on
    // `delta >= threshold` only, so a fall never reaches here. Ihor ruled a red/down-arrow
    // branch out explicitly — do not add one.
    '.ext-surge-badge{' +
      'display:inline-block;font-size:11px;font-weight:600;' +
      'color:var(--ext-success);margin-left:20px;vertical-align:middle;' +
    '}' +
    'html.ext-night .ext-surge-price{' +
      'color:#f0c040 !important;background:rgba(212,167,44,.20) !important;' +
    '}' +
    // ⚠ THIS OVERRIDE HAD TO MOVE WITH THE COLOUR, or dark mode would have stayed amber and
    // the change would have been half-done. It is NOT a new rule and NOT in nightMode.js —
    // content/nightMode.js has no surge rule at all (checked 2026-08-26), so nothing there
    // needed touching and the standing constraint on that file holds.
    //
    // The token is theme-aware: designTokens.js declares --ext-success:#157347 on :root and
    // #37b06f under html.ext-night, so ONE token name gives both. The !important and the
    // -webkit-text-fill-color are kept exactly as they were — they are what stops Amazon's own
    // dark styling repainting the text, and removing them was not asked for.
    'html.ext-night .ext-surge-badge{' +
      'color:var(--ext-success) !important;' +
      '-webkit-text-fill-color:var(--ext-success) !important;' +
    '}';
  document.head.appendChild(style);
}

// 2026-08-31 — gated on the ONE page check, same reason as highlighter.js: this injected the
// surge CSS at module load on every Relay page, Dashboard included.
if (typeof isLoadBoardPage === 'function' && isLoadBoardPage()) injectSurgeStyle();

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

// ── SIMULATION HOOK (2026-08-26) — __EXT_DEBUG.simulateSurge(loadId, newPayout) ───────────
//
// WHY IT EXISTS: Ihor has NEVER seen the surge indicator fire. Payouts change too rarely to
// catch one, and PLAN 20 is blocked on a capture. We must not ship a visual nobody has seen.
//
// 🔑 IT DOES NOT CALL highlightSurge() DIRECTLY. Calling the renderer would prove only that the
// renderer runs — it would prove nothing about detection, the threshold, the enabled gate, the
// alert, or the auto-open. Instead it seeds the ONE input the real comparison reads:
//
//     checkPriceSurge()  ->  delta = payout - history[loadId]  ->  delta >= threshold
//
// so the NEXT ordinary tick fires the surge through the entire real path, exactly as a genuine
// price rise would. Nothing here is on the production path: this function only writes the same
// tabState key the normal flow already rewrites every tick.
//
// ⚠ IT CLEARS ITSELF. checkPriceSurge() rebuilds priceHistory from scratch on every tick, so
// the seeded value survives exactly one comparison and is then overwritten by the real payout.
// It fires ONCE. Nothing is persisted beyond the tab session, and a reload re-seeds nothing.
//
// ⚠ IT DOES NOT TOUCH THE surgeEnabled SETTING. Flipping a stored user setting from a debug
// hook is exactly the kind of hidden state change that makes a later bug unexplainable, so if
// the feature is off this reports that and stops.
function simulateSurge(loadId, newPayout) {
  logger.log('priceSurge', 'simulateSurge called');
  try {
    if (!loadId || typeof newPayout !== 'number' || !isFinite(newPayout)) {
      console.log('[EXT] simulateSurge(loadId, newPayout) — both arguments are required.\n' +
        '      e.g. __EXT_DEBUG.simulateSurge("a1b2c3d4-...", 950)');
      return null;
    }

    // The REAL parser, so the payout compared against is the one the product would use.
    var loads = (typeof parseLoads === 'function') ? parseLoads() : [];
    var target = null;
    for (var i = 0; i < loads.length; i++) {
      if (loads[i] && loads[i].loadId === loadId) { target = loads[i]; break; }
    }
    if (!target) {
      console.log('[EXT] simulateSurge: no load with id ' + loadId + ' is on the board right now. ' +
        'Copy an id from a card\'s div[id], or run __EXT_DEBUG.surgeCandidates().');
      return null;
    }

    var current = parsePayoutNumber(target.payout);
    if (isNaN(current)) {
      console.log('[EXT] simulateSurge: that card\'s payout could not be read ' +
        '(.wo-total_payout missing or unparseable), so there is nothing to compare against.');
      return null;
    }

    var delta = newPayout - current;
    if (delta <= 0) {
      console.log('[EXT] simulateSurge: ' + newPayout + ' is not above the current payout of ' +
        current + '. The feature triggers on INCREASES only, so nothing would fire.');
      return null;
    }

    var threshold = tabState.get('surgeThreshold');
    if (isNaN(threshold) || threshold <= 0) threshold = 50;   // same default as checkPriceSurge

    // Seed the PREVIOUS payout so the real comparison computes exactly `delta`.
    // history[id] = current - delta  =>  payout - history[id] = delta.
    var history = tabState.get('priceHistory') || {};
    var seeded = {};
    for (var k in history) {
      if (Object.prototype.hasOwnProperty.call(history, k)) seeded[k] = history[k];
    }
    seeded[loadId] = current - delta;
    tabState.set('priceHistory', seeded);

    var enabled = null;   // resolved asynchronously below; reported, never changed
    try {
      chrome.storage.local.get(STORAGE_KEYS.SURGE_ENABLED, function (st) {
        enabled = st && st[STORAGE_KEYS.SURGE_ENABLED] === true;
        if (!enabled) {
          console.log('[EXT] ⚠ simulateSurge: "Price Surge Alert" is OFF in the popup, so ' +
            'checkPriceSurge() will clear the history and fire nothing. Turn it ON, then run ' +
            'this again. (This hook does NOT change your setting.)');
        }
      });
    } catch (e2) {
      logger.error('priceSurge', 'simulateSurge could not read the surgeEnabled setting — ' +
        'the seed is in place regardless', { error: e2 });
    }

    console.log('[EXT] simulateSurge armed for ' + loadId +
      '\n      current payout on the card : $' + current +
      '\n      simulated new payout       : $' + newPayout +
      '\n      delta the badge will show  : +$' + Math.round(delta) +
      '\n      threshold that must be met : ' + threshold +
      (delta >= threshold
        ? '\n      -> WILL FIRE on the next refresh (delta >= threshold)'
        : '\n      -> WILL NOT FIRE: the delta is BELOW the threshold. Raise newPayout, or ' +
          'lower the threshold in the popup.') +
      '\n      The loop must be RUNNING — this fires on the next ordinary tick, not now.');

    return { loadId: loadId, current: current, newPayout: newPayout, delta: delta,
             threshold: threshold, willFire: delta >= threshold };
  } catch (e) {
    logger.error('priceSurge', 'simulateSurge failed — nothing was seeded, the surge path is ' +
      'unaffected', { error: e, loadId: !!loadId });
    return null;
  }
}

// Lists ids and payouts of the cards currently on the board, so Ihor does not have to dig one
// out of the DOM by hand. Read-only.
function surgeCandidates() {
  logger.log('priceSurge', 'surgeCandidates called');
  try {
    var loads = (typeof parseLoads === 'function') ? parseLoads() : [];
    var rows = [];
    for (var i = 0; i < loads.length && rows.length < 20; i++) {
      var p = parsePayoutNumber(loads[i].payout);
      if (loads[i].loadId && !isNaN(p)) {
        rows.push({ loadId: loads[i].loadId, payout: p, suggested: Math.round(p + 100) });
      }
    }
    if (!rows.length) {
      console.log('[EXT] surgeCandidates: no cards with a readable payout are on the board.');
      return [];
    }
    console.log('[EXT] copy a loadId, then run ' +
      '__EXT_DEBUG.simulateSurge("<loadId>", <suggested>)');
    console.table(rows);
    return rows;
  } catch (e) {
    logger.error('priceSurge', 'surgeCandidates failed', { error: e });
    return [];
  }
}

// Same __EXT_DEBUG surface as simulateRateLimit — console-only, never product UI. The
// `|| {}` guard matters: this file loads BEFORE content.js in the manifest.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.simulateSurge   = simulateSurge;
window.__EXT_DEBUG.surgeCandidates = surgeCandidates;
