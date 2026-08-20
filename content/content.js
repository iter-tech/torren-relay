logger.log('content', 'extension loaded', { version: EXT_VERSION });

// --- Orchestrator ---

var orchTimer       = null;   // setTimeout handle; null means loop is not scheduled
var orchTickRunning = false;  // overlap guard — prevents concurrent ticks
var orchLoopActive  = false;  // double-start guard — true between startOrchestrator and stopOrchestrator

var REFRESH_SETTLE_MS = 1200; // ms to wait after refresh before parsing

// 2026-07-30 FIX: scheduleNextTick() used to set a FRESH globalRefreshIntervalMs timer
// after every tick finished, so tick overhead (permit round-trip + refreshNow + settle +
// pipeline) was added ON TOP of the chosen interval every cycle instead of being part of
// it — a 2s setting compounded to ~3.5s in practice. lastTickElapsedMs records how long the
// just-finished tick actually took (wall-clock, from tick start to tick end) so
// scheduleNextTick can subtract it from the next delay, floored at 0 — the goal is for
// refreshNow()-to-refreshNow() spacing to equal the chosen interval, not
// interval + overhead. Left at 0 until the first real tick completes (see the tick's own
// finally block below) — deliberately NOT updated by the orchTickRunning overlap-guard's
// early return, since that's not a real tick attempt.
var lastTickElapsedMs = 0;

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// --- Cross-tab rate limiting (2026-07-20) ---
// GLOBAL refresh interval — was per-tab via tabState.refreshIntervalMs. N independently
// timed tabs were multiplying the effective request rate against one IP (confirmed live:
// 3-4 tabs at 2s each caused sustained HTTP 503 on /api/loadboard/search; switching
// networks restored access immediately, confirming an IP-based, not account-based,
// throttle). Cached here and kept in sync via chrome.storage.onChanged so
// scheduleNextTick() doesn't need an async storage round-trip on every call — same
// pattern used for the sidebar's own local caches.
var globalRefreshIntervalMs = 2000; // default; corrected by the async seed below

chrome.storage.local.get(STORAGE_KEYS.REFRESH_INTERVAL_MS, function (data) {
  var ms = data[STORAGE_KEYS.REFRESH_INTERVAL_MS];
  if (typeof ms === 'number' && ms > 0) {
    globalRefreshIntervalMs = ms;
    logger.log('content', 'globalRefreshIntervalMs seeded', { ms: ms });
  }
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.REFRESH_INTERVAL_MS] === undefined) return;
  var newMs = changes[STORAGE_KEYS.REFRESH_INTERVAL_MS].newValue;
  if (typeof newMs === 'number' && newMs > 0) {
    globalRefreshIntervalMs = newMs;
    logger.log('content', 'globalRefreshIntervalMs synced from another tab', { ms: newMs });
  }
});

// "Shared refresh limit" toggle (2026-07-20 follow-up) — true-default, set from the popup,
// same cache+onChanged pattern as globalRefreshIntervalMs above. ON: orchestratorTick asks
// background.js for a paced permit (GLOBAL_MIN_PERMIT_INTERVAL_MS enforced). OFF: the
// permit request still happens (so backoff is still checked — see requirement below) but
// tells background.js to skip pacing, restoring "each tab fires on its own schedule"
// legacy behavior. Toggling takes effect on the very next tick — no reload needed.
var sharedRefreshLimitEnabled = true; // default; corrected by the async seed below

// ── D1 (2026-08-20, Ihor): THE SHARED CROSS-TAB REFRESH LIMIT SHIPS OFF ───────────────────
//
// HIS REASONING, recorded so this is not quietly reversed: silently slowing refreshes while
// the dispatcher is looking at "Refresh every 2.5s" would read as the extension being BROKEN,
// not as protection. Dispatchers already know Amazon throttles and they manage their own tab
// count. Honesty about what the extension does outranks the extra safety margin here.
//
// The underlying shared-limit machinery in background.js is DELIBERATELY LEFT INTACT and is
// simply never asked for — see BACKLOG: deferred to a later release, not deleted. Flipping
// this one constant re-enables the whole path.
//
// ⚠ THIS DOES NOT DISABLE BACKOFF. grantOrDenyPermit() checks backoffUntil FIRST, before it
// ever looks at sharedLimitEnabled, so a 429/502/503/504 still pauses every tab with the
// shared limit off. Verified in background.js, not assumed.
var SHARED_LIMIT_SHIPS_ENABLED = false;

chrome.storage.local.get(STORAGE_KEYS.SHARED_LIMIT_ENABLED, function (data) {
  var v = data[STORAGE_KEYS.SHARED_LIMIT_ENABLED];
  // D1: the stored preference is read but never allowed to turn the shared limit ON.
  sharedRefreshLimitEnabled = SHARED_LIMIT_SHIPS_ENABLED && (v !== false);
  logger.log('content', 'sharedRefreshLimitEnabled seeded', { value: sharedRefreshLimitEnabled });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED] === undefined) return;
  // D1: same clamp on the cross-tab sync — no stored value can switch it on.
  sharedRefreshLimitEnabled = SHARED_LIMIT_SHIPS_ENABLED &&
    (changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED].newValue !== false);
  logger.log('content', 'sharedRefreshLimitEnabled synced from another tab', { value: sharedRefreshLimitEnabled });
});

// Relays board-search HTTP status from the MAIN-world network observer
// (content/networkObserver.js — a separate content_scripts entry, "world":"MAIN", per
// manifest.json) to the rate-limit coordinator in background.js. Registered
// unconditionally (not gated behind the login/auth check that gates the rest of this
// file) — this is passive observation of the page's own network traffic, relaying it to
// the shared coordinator is correct and safe regardless of THIS tab's login state (a 503
// is a property of the shared IP, not of any one tab's session), and it costs nothing
// when idle. ev.source check accepts only messages from this page's own scripts (not
// iframes/other origins) — a coarse trust boundary, not a security gate, since the only
// payload is an HTTP status code, nothing sensitive.
window.addEventListener('message', function (ev) {
  if (ev.source !== window) return;
  var data = ev.data;
  if (!data || data.__extRelaySearchResult !== true) return;
  logger.log('content', 'board search result observed', { url: data.url, ok: data.ok, status: data.status });
  try {
    chrome.runtime.sendMessage({ type: 'REPORT_RESULT', ok: data.ok, status: data.status }).catch(function (e) {
      logger.warn('content', 'REPORT_RESULT message failed', { error: e });
    });
  } catch (e) {
    logger.warn('content', 'REPORT_RESULT sendMessage threw', { error: e });
  }
});

// DEVELOPMENT DIAGNOSTIC (2026-07-31) — response-body capture summary, shipped OFF.
//
// PLAN 10 CONSOLE COMMANDS. console.* on purpose so they work at the shipped DEBUG_LEVEL.
//   __EXT_DEBUG.rateDiagOn()        start collecting grants across all tabs (clears first)
//   __EXT_DEBUG.rateDiag()          print the aggregate: rate across ALL tabs vs configured
//   __EXT_DEBUG.rateDiagOff()       stop collecting
//   __EXT_DEBUG.simulateRateLimit() inject a 503 into the REAL backoff path
//   __EXT_DEBUG.simulateRecovery()  inject a 200 into the REAL path, clearing the backoff
if (typeof window !== 'undefined') {
  window.__EXT_DEBUG = window.__EXT_DEBUG || {};
  function _rd(action, extra) {
    var msg = { type: 'RATE_DIAG', action: action };
    if (extra) for (var k in extra) msg[k] = extra[k];
    return chrome.runtime.sendMessage(msg).then(function (r) { console.log('[EXT] RATE_DIAG ' + action, r); return r; });
  }
  window.__EXT_DEBUG.rateDiagOn        = function () { return _rd('on'); };
  window.__EXT_DEBUG.rateDiagOff       = function () { return _rd('off'); };
  window.__EXT_DEBUG.rateDiagClear     = function () { return _rd('clear'); };
  window.__EXT_DEBUG.rateDiag          = function () { return rateDiagReport(); };
  window.__EXT_DEBUG.simulateRateLimit = function (s) { return _rd('simulate', { status: s || 503 }); };
  window.__EXT_DEBUG.simulateRecovery  = function () { return _rd('recover'); };
}

// ── PLAN 10 DIAGNOSTICS (2026-08-20) ──────────────────────────────────────────────────────
//
// The aggregate request rate is a property of ALL tabs together. background.js is the only place
// that sees every tab, so it records granted permits; these helpers read that back so ANY ONE
// console shows the whole picture.
//
// ⚠ MEASUREMENT ONLY. Nothing here changes the interval, the backoff curve or WATCH_PATH.
//
// ⚠ THERE IS NO TOKEN, LEASE OR TURN TO HOLD, and this is worth stating because it is easy to
// assume otherwise. The mechanism is a PERMIT with a single GLOBAL FLOOR: background.js keeps one
// "lastGrantedAt" in chrome.storage.local and refuses any permit until lastGrantedAt + floorMs
// has passed, serving tabs first-come-first-served. No tab ever "has the turn" — every tab asks
// every tick and waits its place in the queue. So the state line reports the global floor and the
// backoff, which is what actually exists.

// A short, stable identity for THIS tab, so four consoles are told apart at a glance. Random per
// page load; it never leaves the tab except inside these diagnostic lines.
var RATE_DIAG_TAB = 'tab-' + Math.random().toString(36).slice(2, 6).toUpperCase();
var _rateDiagLastRequestAt = null;

function rateDiagEnabled() {
  return (typeof CITY_ASSIGN_DEBUG !== 'undefined') && CITY_ASSIGN_DEBUG;
}

// One line per outbound board request from THIS tab: when, and how long since its previous one.
function rateDiagNoteRequest(permit, askedAt) {
  logger.log('content', 'rateDiagNoteRequest called');
  try {
    if (!rateDiagEnabled()) return;
    var now = Date.now();
    var sinceMine = (_rateDiagLastRequestAt === null) ? null : (now - _rateDiagLastRequestAt);
    if (permit && permit.granted) _rateDiagLastRequestAt = now;
    logger.log('content', 'RATEDIAG REQUEST  ' + RATE_DIAG_TAB +
      '  at ' + new Date(now).toISOString().slice(11, 23) +
      '  |  ' + (permit && permit.granted ? 'GRANTED' : 'DENIED') +
      '  |  waited ' + (now - askedAt) + ' ms for the permit' +
      '  |  since THIS tab\'s previous request: ' +
      (sinceMine === null ? '(first)' : sinceMine + ' ms') +
      (permit && permit.backoffUntil
        ? '  |  BACKOFF until ' + new Date(permit.backoffUntil).toISOString().slice(11, 23) : ''));
  } catch (e) {
    logger.error('content', 'rateDiagNoteRequest failed — diagnostics only', { error: e });
  }
}

// THE AGGREGATE VIEW. console.* on purpose, like dumpTrailerLabels: it must work at the shipped
// DEBUG_LEVEL so Ihor runs it without reconfiguring anything mid-test.
async function rateDiagReport() {
  try {
    var r = await chrome.runtime.sendMessage({ type: 'RATE_DIAG', action: 'read' });
    if (!r || !r.ok) { console.log('[EXT] RATEDIAG unavailable', r); return null; }
    var now = Date.now();
    var recent = (r.grants || []).filter(function (g) { return now - g.t <= 60000; });
    var byTab = {};
    recent.forEach(function (g) { byTab[g.tab] = (byTab[g.tab] || 0) + 1; });
    var mean = null;
    if (recent.length > 1) {
      var sorted = recent.slice().sort(function (a, b) { return a.t - b.t; });
      mean = Math.round((sorted[sorted.length - 1].t - sorted[0].t) / (sorted.length - 1));
    }
    console.log('[EXT] RATEDIAG AGGREGATE  ' + RATE_DIAG_TAB +
      '  |  collecting: ' + (r.on ? 'ON' : '** OFF — run __EXT_DEBUG.rateDiagOn() first **') +
      '  |  requests across ALL tabs in the last 60s: ' + recent.length +
      '  |  mean interval between them: ' + (mean === null ? 'n/a' : mean + ' ms') +
      '  |  configured global interval: ' + r.floorMs + ' ms' +
      '  |  ' + (mean === null ? '(need 2+ requests)'
        : (Math.abs(mean - r.floorMs) <= r.floorMs * 0.25
            ? 'AGREES — the aggregate matches the global interval'
            : '** DISAGREES — the aggregate is ' + (mean < r.floorMs ? 'FASTER' : 'slower') +
              ' than configured **')));
    console.log('[EXT] RATEDIAG PER TAB    ' + JSON.stringify(byTab) +
      '  |  active tabs background knows about: ' + r.tabCount);
    console.log('[EXT] RATEDIAG STATE      global lastGrantedAt ' +
      (r.state.lastGrantedAt ? new Date(r.state.lastGrantedAt).toISOString().slice(11, 23) : 'never') +
      '  |  backoffUntil ' +
      (r.state.backoffUntil ? new Date(r.state.backoffUntil).toISOString().slice(11, 23) : 'none') +
      '  |  backoffStepIndex ' + r.state.backoffStepIndex +
      '  |  rateLimited ' + r.state.rateLimited +
      '  |  (no tab "holds" anything — one global floor, first-come-first-served)');
    return { recent: recent.length, meanMs: mean, floorMs: r.floorMs, state: r.state };
  } catch (e) {
    logger.error('content', 'rateDiagReport failed', { error: e });
    return null;
  }
}

// Deliberately a SEPARATE listener from the REPORT_RESULT relay above, not a branch inside
// it: that relay, the rate-limit path and the abort handling are done and verified, and this
// keeps their diff at zero lines.
//
// content/networkObserver.js runs in the MAIN world and has no `logger` and no DEBUG_LEVEL,
// so it postMessages five counters across and this side does the logging — which is what
// makes the line level-gated. logger.log needs DEBUG_LEVEL >= 3; shipped is 1, so this is
// silent in a stock build even if the MAIN-world mirror is left on by accident.
//
// The payload is counters only — count, total, cursor, length. No ids, cities, addresses or
// payouts, by construction on the sending side. Nothing here is stored or rendered.
window.addEventListener('message', function (ev) {
  if (ev.source !== window) return;
  var d = ev.data;
  if (!d || d.__extRelayCaptureSummary !== true) return;
  if (typeof CAPTURE_RESPONSES !== 'undefined' && !CAPTURE_RESPONSES) return;
  logger.log('networkObserver', 'response captured (dev switch)', {
    endpoint: d.endpoint, workOpportunities: d.woCount,
    totalResultsSize: d.totalSize, nextItemToken: d.nextToken, bodyLength: d.bodyLength
  });
});

// Shared heap reader — used by sidebar.js's memory indicator (polled independently
// of the orchestrator loop). Returns null where performance.memory is unsupported.
function getHeapUsageRatio() {
  logger.debug('content', 'getHeapUsageRatio called'); // debug: fires every 7s from sidebar poll
  try {
    if (!performance.memory) return null;
    var used  = performance.memory.usedJSHeapSize;
    var limit = performance.memory.jsHeapSizeLimit;
    var ratio = used / limit;
    return { usedBytes: used, limitBytes: limit, ratio: ratio };
  } catch (e) {
    logger.error('content', 'getHeapUsageRatio failed', { error: e });
    return null;
  }
}

// Returns a copy of the loads array sorted by numeric payout descending.
// Unparseable payout strings (null, missing, non-numeric) sort to the end (-Infinity).
// Does NOT mutate the input array.
function sortByPayoutDesc(loads) {
  logger.log('content', 'sortByPayoutDesc called', { count: loads ? loads.length : 0 });
  return loads.slice().sort(function (a, b) {
    var aNum = parseFloat((a.payout || '').replace(/[$,]/g, ''));
    var bNum = parseFloat((b.payout || '').replace(/[$,]/g, ''));
    if (isNaN(aNum)) aNum = -Infinity;
    if (isNaN(bNum)) bNum = -Infinity;
    return bNum - aNum;
  });
}

// Single checkpoint used after every await inside runDetectionPipeline/orchestratorTick
// (2026-07-20 fix): a tick already mid-flight when the login gate closes (live logout —
// no reload needed, see utils/authGate.js) or the loop is otherwise stopped must not be
// allowed to keep running — it was previously left to finish, which could still highlight
// cards, play sound, auto-open a card, and re-create #ext-inline-panel after
// deactivateExtensionUI() had already torn everything down.
function shouldContinue() {
  var gateActive = (typeof isAuthGateActiveSync === 'function') ? isAuthGateActiveSync() : false;
  return gateActive && tabState.get('running');
}

// Checkpoint for the ONE window where `running` is false BY OUR OWN DOING (2026-08-13).
//
// The auto-open path now stops the loop the moment it commits to opening a load — before any
// await — so that a refresh cannot land mid-open and have Amazon re-render the list out from
// under the panel we are about to insert. From that point `shouldContinue()` is false by
// design, and using it would abort the very render the stop exists to protect.
//
// So this checks the AUTH GATE only. A logout or deactivate still aborts, exactly as before;
// our own deliberate stop does not. The distinction matters: `running === false` here means
// "we are finishing an open", while a closed gate means "the extension is being torn down".
// ⚠ ORPHANED BY STAGE A (2026-08-14) — currently has no caller.
//
// It existed for the two post-await checkpoints in the auto-open path, which are gone with the
// 800ms settle they guarded. NOT deleted: it is PLAN 7b's companion fix, and 7b's whole point was
// that stopping the loop early requires a gate-only predicate. Stage C re-opens this path; if it
// truly needs no await then this can go with it, deliberately, rather than by drift now.
function gateStillOpen() {
  return (typeof isAuthGateActiveSync === 'function') ? isAuthGateActiveSync() : false;
}

// True when the dispatcher is reading something and the view must NOT move under him
// (2026-08-13). Both of the conditions the auto-switch must respect collapse into this one
// test, which is why no marker had to be added to the manual-click path:
//
//   - "a detail panel is open from a manual card click" -> #ext-inline-panel exists.
//   - "the loop is already stopped for review"          -> running is false.
//
// It is deliberately BROADER than asked: a panel auto-opened on an earlier cycle also blocks a
// switch. That is the same judgement — if anything is open, he may be reading it. Erring toward
// not moving the view is the safe direction; a delayed alert costs a moment, a view yanked out
// from under him costs the load he was looking at.
function dispatcherIsMidWork() {
  try {
    if (document.getElementById('ext-inline-panel')) return true;
    if (!tabState.get('running')) return true;
    return false;
  } catch (e) {
    logger.error('content', 'dispatcherIsMidWork failed — assuming mid-work, will not switch', { error: e });
    return true;   // on doubt, do not move the view
  }
}

// Wipes every DOM node this pipeline can create. Called both by deactivateExtensionUI()
// (a real logout/gate-close) and by every shouldContinue()-failing checkpoint below — a
// tick already mid-flight when logout happens can leave something behind in the gap
// *before* the next checkpoint catches it (e.g. checkPriceSurge() applies surge highlights
// internally, synchronously, before its own awaited playAlert() resolves — well before
// runDetectionPipeline's first checkpoint runs). Safe to call at any time; every function
// it calls is already a no-op when there is nothing to clear, so deactivate stays
// authoritative regardless of exactly where a tick got bailed out.
function clearPipelineDom() {
  removeInlinePanel();
  clearHighlights();
  clearSurgeHighlights();
}

// Shared detection pipeline — called by both orchestratorTick (after a refresh) and
// runObserverPipeline (DOM already changed, no refresh step).
// sourceTag ('tick' | 'observer') is threaded through log lines to keep origin distinguishable.
async function runDetectionPipeline(sourceTag) {
  logger.log('content', 'runDetectionPipeline called', { source: sourceTag });

  var loads  = parseLoads();
  var result = detectNewLoads(loads);
  logger.log('content', 'runDetectionPipeline: diff done', {
    source: sourceTag, allCount: result.allCount, newCount: result.newCount
  });

  var surgeLoads = await checkPriceSurge(loads);
  if (!shouldContinue()) {
    logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after checkPriceSurge' });
    clearPipelineDom();
    return;
  }

  if (result.newCount > 0) {
    highlightNewLoads(result.newLoads); // highlight all, original DOM order
    await playAlert();
    if (!shouldContinue()) {
      logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after playAlert' });
      clearPipelineDom();
      return;
    }
    if (typeof flashTabAlert === 'function') flashTabAlert(result.newCount);

    var autoOpen = await storage.get(STORAGE_KEYS.AUTO_OPEN, true);
    if (!shouldContinue()) {
      logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after AUTO_OPEN read' });
      clearPipelineDom();
      return;
    }
    var opened   = false;
    // Sort by payout desc so openTopNewLoad always opens the highest-paying new load.
    var ordered  = sortByPayoutDesc(result.newLoads);

    // ── FILTER AWARENESS (2026-08-13) ──────────────────────────────────────────────────
    //
    // Detection above is deliberately untouched: it still covers EVERY city, so a new load is
    // never missed and the sound always fires. What changes is what we OPEN.
    //
    // Observed live: on the HEBRON tab a LITTLE ROCK load arrived, the alert fired and the
    // accordion opened — over a card the filter had hidden. The dispatcher saw a detail panel
    // with nothing behind it. Opening a card he cannot see is worse than not opening one.
    //
    // So: auto-open only from the loads that are actually visible, and mark the owning city's
    // button for the rest.
    //
    // ── AUTO-SWITCH (2026-08-13, Ihor's decision) ──────────────────────────────────────
    //
    // Badging alone proved too quiet: a load could arrive, sound the alert and then sit behind a
    // city button he never looked at, so the alert pointed at nothing he could act on. The view
    // now follows the load instead.
    //
    // Anchored on ordered[0] — the highest-paying new load, which is exactly the one
    // openTopNewLoad would open. Switching to ITS city is what makes the auto-open and the switch
    // agree when several cities get loads in one cycle; the rest stay badged below.
    //
    // The switch runs BEFORE the visible/hidden partition, so the load it uncovers is then
    // treated as an ordinary visible load: same highlight, same auto-open, same everything. It is
    // also synchronous, so the stop that follows still happens before any await (PLAN 7b holds).
    //
    // Three cases deliberately do NOT switch:
    //   - filter is "All"  -> nothing is hidden, nothing to switch to.
    //   - dispatcher mid-work -> see dispatcherIsMidWork(); badge only.
    //   - the top load is already visible -> he is looking at its city.
    if (typeof getActiveCityFilter === 'function' && getActiveCityFilter() !== null &&
        typeof cityFilterHidesLoad === 'function' && ordered.length > 0 &&
        cityFilterHidesLoad(ordered[0].loadId)) {
      if (dispatcherIsMidWork()) {
        logger.log('content', 'runDetectionPipeline: new load in another city, but the dispatcher ' +
          'is reading something — badging only, not switching', { source: sourceTag });
      } else {
        // A load can be in range of several cities; the first is a deterministic pick and any of
        // them makes it visible. The ACTIVE city is never among them — cityFilterHidesLoad just
        // said so — so this always moves the view.
        var switchTo = (typeof citiesOfLoad === 'function') ? citiesOfLoad(ordered[0].loadId) : [];
        if (switchTo.length > 0 && typeof selectCityFilter === 'function') {
          // selectCityFilter is the CLICK path itself, not a copy of it: it sets the active city,
          // clears that city's badge, calls applyCityFilter and repaints the buttons. Hide/show,
          // unassigned-always-visible and re-apply-after-refresh therefore behave identically to
          // Ihor pressing the button — there is no second implementation to drift.
          logger.log('content', 'runDetectionPipeline: new load in another city — switching the view to it', {
            source: sourceTag, from: getActiveCityFilter(), to: switchTo[0], alsoIn: switchTo.length - 1
          });
          selectCityFilter(switchTo[0]);
        }
      }
    }

    var visible = ordered;
    var hiddenByFilter = [];
    if (typeof cityFilterHidesLoad === 'function') {
      visible = [];
      for (var vi = 0; vi < ordered.length; vi++) {
        if (cityFilterHidesLoad(ordered[vi].loadId)) hiddenByFilter.push(ordered[vi]);
        else visible.push(ordered[vi]);
      }
    }
    if (hiddenByFilter.length > 0 && typeof markCityNewLoads === 'function') {
      // A load can be in range of SEVERAL cities (2026-08-13), so it marks every one of them —
      // each of those drivers could take it, and each should see it waiting.
      var perCity = {};
      for (var hi = 0; hi < hiddenByFilter.length; hi++) {
        var hcs = (typeof citiesOfLoad === 'function') ? citiesOfLoad(hiddenByFilter[hi].loadId) : [];
        for (var hj = 0; hj < hcs.length; hj++) perCity[hcs[hj]] = (perCity[hcs[hj]] || 0) + 1;
      }
      for (var pc in perCity) {
        if (Object.prototype.hasOwnProperty.call(perCity, pc)) markCityNewLoads(pc, perCity[pc]);
      }
      logger.log('content', 'runDetectionPipeline: new loads in filtered-out cities — marked, not opened', {
        source: sourceTag, hidden: hiddenByFilter.length, visible: visible.length
      });
    }
    // Only ever open something on screen. With everything filtered out, `visible` is empty and
    // openTopNewLoad is not called at all.
    ordered = visible;
    if (autoOpen && ordered.length > 0) opened = openTopNewLoad(ordered);

    // STOP THE LOOP HERE — synchronously, BEFORE any await (2026-08-13, fixes PLAN 7b).
    //
    // It used to sit at the bottom of this block, i.e. after openTopNewLoad + await sleep(800)
    // + showInlinePanel. At a 2.5s interval a refresh landed inside that window: refreshNow()
    // made Amazon re-render the load list, and the inline panel — inserted as a SIBLING of the
    // card inside that list (inlinePanel.js) — was destroyed with it. The dispatcher saw the
    // accordion open and vanish about a second later.
    //
    // This is exactly what the MANUAL card-click path already does (inlinePanel.js, 2026-07-31):
    // it stops at the click, before the sheet opens. Same call, same state, same visible result
    // in the sidebar — the tabState subscriber fires synchronously, so the play/pause control
    // shows "stopped" from this moment whether or not the render below succeeds. That is what
    // keeps a failed or abandoned open from leaving the loop silently stopped.
    //
    // Unconditional, matching the previous behaviour: any new load auto-stops, opened or not.
    tabState.set('running', false);
    logger.log('content', 'runDetectionPipeline: new loads found — auto-stopping BEFORE the open ' +
      'so a refresh cannot destroy the panel', {
      source: sourceTag, newCount: result.newCount, opened: opened
    });

    // 2026-08-14 (STAGE A): the 800ms settle and the render that followed it are GONE.
    //
    // The sleep existed for exactly one reason — to give Amazon's detail sheet time to finish
    // opening so the scrape could read it. With the scrape removed there is nothing left to
    // wait for, so waiting would be a delay with no purpose. The card is still opened by
    // openTopNewLoad() above, which is what the dispatcher sees; OUR panel returns in Stage B
    // (PLAN §29b) and, per §29c, will render with no fixed delay at all.
    //
    // The stop above is UNCHANGED and still runs before any await, which is what PLAN 7b
    // requires. Removing this block makes that ordering trivially true rather than merely
    // maintained: there is no await left on this path.
  } else if (surgeLoads.length > 0) {
    var surgeAutoOpen  = await storage.get(STORAGE_KEYS.AUTO_OPEN, true);
    if (!shouldContinue()) {
      logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after AUTO_OPEN read (surge)' });
      clearPipelineDom();
      return;
    }
    var surgeOpened    = false;
    var orderedSurge   = sortByPayoutDesc(surgeLoads);
    if (surgeAutoOpen) surgeOpened = openTopNewLoad(orderedSurge);

    // Same reordering as the new-load branch above, for the same reason — this path opens a
    // card and inserts the same panel through the same code, so it had the identical race.
    // Fixing only one of the two would have left the bug alive on the surge path.
    tabState.set('running', false);
    logger.log('content', 'runDetectionPipeline: surge detected — auto-stopping BEFORE the open ' +
      'so a refresh cannot destroy the panel', {
      source: sourceTag, surgeCount: surgeLoads.length, opened: surgeOpened
    });

    // Same removal as the new-load branch above (STAGE A): no settle, no render. The surge card
    // is still opened by openTopNewLoad(); only OUR panel is absent until Stage B.
  }
}

async function orchestratorTick() {
  if (orchTickRunning) {
    logger.warn('content', 'orchestratorTick: previous tick still running, skipping');
    return;
  }
  orchTickRunning = true;
  var tickStart = Date.now();
  try {
    // Cross-tab permit gate (2026-07-20) — background.js enforces ONE global minimum
    // interval between board requests across every open Relay tab, plus backoff on 5xx.
    // A denied permit means either the global pace floor hasn't elapsed yet (another tab
    // is "due" first) or the shared limiter is in backoff — either way, this tick simply
    // skips refreshing; the next scheduled tick (globalRefreshIntervalMs later) will ask
    // again. This is what keeps the sidebar's countdown live during backoff without a
    // separate polling loop, and keeps the service worker from being evicted for the
    // whole backoff duration (a message arrives every tick).
    //
    // "Shared refresh limit" toggle (2026-07-20 follow-up): the permit request is ALWAYS
    // sent, even when the toggle is off — this is what keeps 503 backoff working in both
    // modes (requirement: backoff is never optional). sharedRefreshLimitEnabled only tells
    // background.js whether to ALSO enforce the pacing floor on top of the backoff check.
    var permit;
    var _rlAskedAt = Date.now();
    try {
      permit = await chrome.runtime.sendMessage({ type: 'REQUEST_PERMIT', sharedLimitEnabled: sharedRefreshLimitEnabled });
      rateDiagNoteRequest(permit, _rlAskedAt);
    } catch (e) {
      logger.warn('content', 'orchestratorTick: permit request failed (service worker unreachable?) — skipping this tick', { error: e });
      return;
    }
    if (!permit || !permit.granted) {
      logger.log('content', 'orchestratorTick: no permit — rate limiter active, skipping this tick', {
        backoffUntil: permit && permit.backoffUntil
      });
      return;
    }

    var refreshed = refreshNow();
    logger.log('content', 'orchestratorTick: refresh triggered', { refreshed: refreshed });
    await sleep(REFRESH_SETTLE_MS);
    if (!shouldContinue()) {
      logger.log('content', 'orchestratorTick: bailing — gate/running closed during refresh settle', {});
      clearPipelineDom();
      return;
    }
    await runDetectionPipeline('tick');
  } catch (e) {
    logger.error('content', 'orchestratorTick: unexpected error', { error: e });
  } finally {
    orchTickRunning = false;
    lastTickElapsedMs = Date.now() - tickStart;
  }
}

function scheduleNextTick() {
  if (!orchLoopActive) {
    logger.log('content', 'scheduleNextTick: loop not active — halted');
    return;
  }
  var running = tabState.get('running');
  if (!running) {
    logger.log('content', 'scheduleNextTick: loop halted');
    return;
  }
  var intervalMs = globalRefreshIntervalMs; // GLOBAL (2026-07-20) — see top of file
  // Subtract the previous tick's actual overhead (2026-07-30 fix — see lastTickElapsedMs
  // comment above) so refreshNow()-to-refreshNow() spacing matches intervalMs instead of
  // intervalMs + overhead. Floored at 0: if a tick already took longer than intervalMs
  // (e.g. it had to wait for a permit due to another tab's turn), fire again immediately
  // rather than waiting a full extra interval on top.
  var delayMs = Math.max(0, intervalMs - lastTickElapsedMs);
  orchTimer = setTimeout(async function () {
    await orchestratorTick();
    scheduleNextTick();
  }, delayMs);
}

async function startOrchestrator() {
  if (orchLoopActive) {
    logger.warn('content', 'startOrchestrator: loop already active — ignoring');
    return;
  }
  if (orchTimer !== null) {
    logger.warn('content', 'startOrchestrator: timer already scheduled — ignoring');
    return;
  }
  orchLoopActive = true;
  logger.log('content', 'startOrchestrator: starting loop');
  orchestratorTick().then(function () { scheduleNextTick(); });
}

function stopOrchestrator() {
  orchLoopActive = false;
  if (orchTimer !== null) {
    clearTimeout(orchTimer);
    orchTimer = null;
  }
  // 2026-07-30: tell background.js this tab is no longer in the round-robin — covers both
  // logout (deactivateExtensionUI) and the dispatcher manually pausing (Play/Pause off).
  // Fire-and-forget; the sidebar's "Active tabs: N" display is best-effort UI, not
  // correctness-critical, so a failed/unreachable service worker here is not fatal.
  try {
    chrome.runtime.sendMessage({ type: 'RELEASE_TAB' }).catch(function (e) {
      logger.warn('content', 'stopOrchestrator: RELEASE_TAB failed (service worker unreachable?)', { error: e });
    });
  } catch (e) {
    logger.warn('content', 'stopOrchestrator: RELEASE_TAB threw synchronously', { error: e });
  }
  logger.log('content', 'stopOrchestrator: loop stopped');
}

// tabState subscriber replaces chrome.storage.onChanged for RUNNING.
// Fires synchronously when sidebar toggles or orchestrator auto-stops.
tabState.subscribe('running', function (val) {
  if (val) {
    closePanelsForStart(); // close detail panel once per loop start
    // START clears our own panel too (2026-08-13). closePanelsForStart() only closes AMAZON's
    // detail sheet; ours survived, and a panel left over from before a START would then be
    // carried into whatever the loop rendered next. Pressing START means "begin a clean pass".
    removeInlinePanel();
    startLoadObserver();   // instant detection via MutationObserver
    startOrchestrator();   // timer-tick fallback
  } else {
    stopLoadObserver();
    stopOrchestrator();
    // STOP does NOT remove the panel — stopping is exactly what an auto-open does when it opens
    // one for review (PLAN 7b), so removing here would destroy the panel the stop exists to
    // protect. It is verified instead: if its load is gone from the board, it goes.
    if (typeof enforcePanelAnchor === 'function') enforcePanelAnchor('loop stopped');
  }
});

// --- Login gating: activate/deactivate without a page reload ---
// TASK 1 (2026-07-20): previously the gate was only checked once at content-script
// startup — logging in/out via the popup while a Relay tab was already open had no effect
// on it until the tab was reloaded. Now utils/authGate.js's onAuthGateChange() fires
// live whenever chrome.storage.local's SUPABASE_SESSION_KEY transitions active↔inactive
// (popup.js writes it on verify/logout), so these two functions run immediately, no
// reload required in either direction.

var _extActivated  = false; // idempotency guard — both functions are safe to call repeatedly
// Separate in-flight guard (2026-07-30, audit B1). Deliberately NOT the same flag as
// _extActivated: _extActivated means "initialisation finished and the UI exists", which is
// only true at the very end. Something still has to stop a second call arriving mid-await
// from starting initialisation a second time, and that is this flag. Always cleared in a
// finally — a thrown step must never leave it stuck true, or we would have recreated the
// exact lockout this fix removes, just one flag over.
var _extActivating = false;

async function activateExtensionUI() {
  if (_extActivated) return;
  if (_extActivating) {
    logger.log('content', 'activateExtensionUI: activation already in flight — ignoring');
    return;
  }
  _extActivating = true;
  logger.log('content', 'activateExtensionUI called');

  // 2026-07-30 (audit B1, High): _extActivated used to be set HERE, before the awaits. If
  // tabState.init() or buildSidebar() threw, the flag stayed true with no UI built, and
  // every later activateExtensionUI() call — including the one from a fresh login — hit the
  // early return on line 1 and did nothing. The dispatcher got a dead extension (no sidebar,
  // no buttons, nothing on screen) that could only be recovered by reloading the page. The
  // flag is now set only after every step has actually succeeded.
  var step = 'tabState.init';
  try {
    await tabState.init();
    step = 'buildSidebar';
    buildSidebar();
    step = 'initManualToggle';
    initManualToggle();
    // Origin-cities panel (2026-08-05). Last, and deliberately not guarded by `step`:
    // buildOriginCitiesPanel() swallows its own errors, so a failure there degrades to "no
    // panel" instead of rolling back the whole activation and costing the dispatcher the
    // sidebar and the monitoring loop.
    step = 'buildOriginCitiesPanel';
    buildOriginCitiesPanel();
    // City-assignment debug feed (2026-08-06). Read-only, logs only, and a complete no-op
    // unless CITY_ASSIGN_DEBUG is on — see content/cityAssign.js. Same reasoning as the panel
    // above: it swallows its own errors, so a diagnostic can never cost the dispatcher his
    // sidebar. Placed after the panel because it consumes getActiveOriginCities().
    step = 'initCityAssign';
    initCityAssign();

    _extActivated = true; // ONLY after every step completed without throwing
    logger.log('content', 'extension UI activated — waiting for manual Start');
  } catch (e) {
    // logger.error is level 1, so this survives the shipped quiet DEBUG_LEVEL — a failed
    // activation must be visible in the console even on a default install. `step` names the
    // step that threw.
    logger.error('content', 'activateExtensionUI failed — rolling back, extension stays inactive', { step: step, error: e });
    try {
      // Roll back whatever the failed run already built, through the ONE existing teardown
      // path — no second teardown to keep in sync. deactivateExtensionUI() early-returns
      // unless _extActivated is true, so it is set true purely to open that gate; the very
      // first thing deactivateExtensionUI() does is set it back to false. Nothing can observe
      // the true in between: it is a synchronous call with no awaits, and any activation
      // attempt reaching us during it is still blocked by _extActivating above.
      // Every step it performs is a no-op when the thing was never built (buildSidebar may
      // have thrown before or after appending #ext-sidebar; both cases are handled), which is
      // what lets the NEXT activation start from a clean state instead of a half-built one.
      _extActivated = true;
      deactivateExtensionUI();
    } catch (e2) {
      logger.error('content', 'activateExtensionUI: rollback teardown threw', { step: step, error: e2 });
    } finally {
      _extActivated = false; // authoritative, even if the teardown threw before clearing it
    }
  } finally {
    _extActivating = false; // never leave the retry path blocked
  }
}

// Stops the loop, removes every DOM node/timer/listener the extension owns, and reverts
// the page to the same state as if the extension had never activated on this load —
// mirrors the "never activates when logged out" guarantee from content-script startup.
function deactivateExtensionUI() {
  if (!_extActivated) return;
  _extActivated = false;
  logger.log('content', 'deactivateExtensionUI called');

  // Stops via the tabState 'running' subscriber above (stopLoadObserver + stopOrchestrator)
  // and — while the sidebar still exists — updates its play/pause visual one last time.
  tabState.set('running', false);

  // Same cleanup shouldContinue()'s bail-out checkpoints in runDetectionPipeline use — kept
  // as one shared function so this stays authoritative: whichever path (a real deactivate,
  // or a mid-flight tick catching the closed gate) runs last, the result is identical.
  clearPipelineDom();

  // Origin-cities panel (2026-08-05) — removes the panel, its <style>, its MutationObserver
  // and any pending debounce. Without this a logout would leave a floating panel and a live
  // observer on the page, breaking the "reverted to fully untouched" guarantee below.
  removeOriginCitiesPanel();

  // City-assignment debug feed (2026-08-06) — drops its message listener, buffers and pending
  // timer. Same reason as the panel above: a logged-out page must be left with no live
  // listener of ours on it.
  teardownCityAssign();

  var sidebarEl = document.getElementById('ext-sidebar');
  if (sidebarEl) {
    // Release the sidebar's tabState subscription, its independent memory-poll timer, and
    // its global-storage change listener (all three stored on the element by
    // buildSidebar()) so a later reactivation's fresh buildSidebar() call doesn't leak a
    // second copy of any of them alongside this one. 2026-07-30: the fourth entry here, the
    // rate-limit countdown timer, was dropped — buildSidebar() no longer creates it (the
    // paused banner is now purely storage-event-driven; see sidebar.js).
    if (sidebarEl._runningSubscriber) tabState.unsubscribe('running', sidebarEl._runningSubscriber);
    if (sidebarEl._memoryPollInterval) clearInterval(sidebarEl._memoryPollInterval);
    if (sidebarEl._rateLimitStorageListener) chrome.storage.onChanged.removeListener(sidebarEl._rateLimitStorageListener);
    // The drag listeners live on WINDOW, not on the element (the pointer leaves the bar
    // mid-drag), so removing the element does not take them with it — 2026-08-14.
    if (sidebarEl._extDragMove) window.removeEventListener('pointermove', sidebarEl._extDragMove);
    if (sidebarEl._extDragUp) window.removeEventListener('pointerup', sidebarEl._extDragUp);
    sidebarEl.remove();
  }
  // 2026-07-30: the shared-rate status row (see sidebar.js) sets body padding-top via
  // inline style (JS, not the injected <style> tag) since it varies with mode/tab-count —
  // removing the <style> tag alone would NOT revert this. Explicit cleanup keeps the
  // "revert to fully untouched" guarantee intact.
  document.body.style.removeProperty('padding-top');

  logger.log('content', 'extension UI deactivated — page reverted to untouched state');
}

if (typeof onAuthGateChange === 'function') {
  onAuthGateChange(function (gate) {
    if (gate.active) {
      activateExtensionUI().catch(function (e) {
        logger.error('content', 'activateExtensionUI (live gate change) failed', { error: e });
      });
    } else {
      deactivateExtensionUI();
    }
  });
}

// Async init: gated on an active Supabase session (utils/authGate.js) at content-script
// startup. If the dispatcher isn't logged in, none of our UI is built at all, and the
// Amazon Relay page is left completely untouched — same as the extension being
// uninstalled. Live login/logout after this point is handled by the onAuthGateChange
// listener above, not this IIFE (which only ever runs once, at page load).
(async function () {
  var gate = await getAuthGate();
  if (!gate.active) {
    logger.log('content', 'auth gate closed — extension inactive on this page load', {});
    return;
  }
  // PII (2026-07-30): was `{ email: gate.email }`. The dispatcher's email must never reach
  // the console at any DEBUG_LEVEL — a Web Store reviewer opening devtools would see it.
  // hasEmail keeps the diagnostic value (did the session actually carry a user record?)
  // without the value itself.
  logger.log('content', 'auth gate open', { hasEmail: !!gate.email });
  await activateExtensionUI();
})();
