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

chrome.storage.local.get(STORAGE_KEYS.SHARED_LIMIT_ENABLED, function (data) {
  var v = data[STORAGE_KEYS.SHARED_LIMIT_ENABLED];
  sharedRefreshLimitEnabled = v !== false;
  logger.log('content', 'sharedRefreshLimitEnabled seeded', { value: sharedRefreshLimitEnabled });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED] === undefined) return;
  sharedRefreshLimitEnabled = changes[STORAGE_KEYS.SHARED_LIMIT_ENABLED].newValue !== false;
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
    if (autoOpen) opened = openTopNewLoad(ordered);

    if (autoOpen && opened) {
      await sleep(800);
      if (!shouldContinue()) {
        logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after 800ms settle, before showInlinePanel' });
        clearPipelineDom();
        return;
      }
      try {
        showInlinePanel(ordered[0]._element);
        logger.log('content', 'runDetectionPipeline: inline panel shown', { source: sourceTag, topPayout: ordered[0].payout });
      } catch (e) {
        logger.warn('content', 'runDetectionPipeline: inline panel render failed', { source: sourceTag, error: e });
      }
    }

    tabState.set('running', false);
    logger.log('content', 'runDetectionPipeline: new loads found — auto-stopping', {
      source: sourceTag, newCount: result.newCount
    });
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

    if (surgeAutoOpen && surgeOpened) {
      await sleep(800);
      if (!shouldContinue()) {
        logger.log('content', 'runDetectionPipeline: bailing — gate/running closed', { source: sourceTag, checkpoint: 'after 800ms settle, before showInlinePanel (surge)' });
        clearPipelineDom();
        return;
      }
      try {
        showInlinePanel(orderedSurge[0]._element);
        logger.log('content', 'runDetectionPipeline: inline panel shown for surge', { source: sourceTag, topPayout: orderedSurge[0].payout });
      } catch (e) {
        logger.warn('content', 'runDetectionPipeline: inline panel render failed for surge', { source: sourceTag, error: e });
      }
    }

    tabState.set('running', false);
    logger.log('content', 'runDetectionPipeline: surge detected — auto-stopping', {
      source: sourceTag, surgeCount: surgeLoads.length
    });
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
    try {
      permit = await chrome.runtime.sendMessage({ type: 'REQUEST_PERMIT', sharedLimitEnabled: sharedRefreshLimitEnabled });
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
  logger.log('content', 'stopOrchestrator: loop stopped');
}

// tabState subscriber replaces chrome.storage.onChanged for RUNNING.
// Fires synchronously when sidebar toggles or orchestrator auto-stops.
tabState.subscribe('running', function (val) {
  if (val) {
    closePanelsForStart(); // close detail panel once per loop start
    startLoadObserver();   // instant detection via MutationObserver
    startOrchestrator();   // timer-tick fallback
  } else {
    stopLoadObserver();
    stopOrchestrator();
  }
});

// --- Login gating: activate/deactivate without a page reload ---
// TASK 1 (2026-07-20): previously the gate was only checked once at content-script
// startup — logging in/out via the popup while a Relay tab was already open had no effect
// on it until the tab was reloaded. Now utils/authGate.js's onAuthGateChange() fires
// live whenever chrome.storage.local's SUPABASE_SESSION_KEY transitions active↔inactive
// (popup.js writes it on verify/logout), so these two functions run immediately, no
// reload required in either direction.

var _extActivated = false; // idempotency guard — both functions are safe to call repeatedly

async function activateExtensionUI() {
  if (_extActivated) return;
  _extActivated = true;
  logger.log('content', 'activateExtensionUI called');

  await tabState.init();
  buildSidebar();
  initManualToggle();

  logger.log('content', 'extension UI activated — waiting for manual Start');
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

  var sidebarEl = document.getElementById('ext-sidebar');
  if (sidebarEl) {
    // Release the sidebar's tabState subscription, its independent memory-poll timer,
    // its rate-limit countdown timer, and its global-storage change listener (all four
    // stored on the element by buildSidebar()) so a later reactivation's fresh
    // buildSidebar() call doesn't leak a second copy of any of them alongside this one.
    if (sidebarEl._runningSubscriber) tabState.unsubscribe('running', sidebarEl._runningSubscriber);
    if (sidebarEl._memoryPollInterval) clearInterval(sidebarEl._memoryPollInterval);
    if (sidebarEl._rateLimitPollInterval) clearInterval(sidebarEl._rateLimitPollInterval);
    if (sidebarEl._rateLimitStorageListener) chrome.storage.onChanged.removeListener(sidebarEl._rateLimitStorageListener);
    sidebarEl.remove();
  }

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
  logger.log('content', 'auth gate open', { email: gate.email });
  await activateExtensionUI();
})();
