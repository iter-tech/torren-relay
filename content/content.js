logger.log('content', 'extension loaded', { version: EXT_VERSION });

// --- Orchestrator ---

var orchTimer       = null;   // setTimeout handle; null means loop is not scheduled
var orchTickRunning = false;  // overlap guard — prevents concurrent ticks
var orchLoopActive  = false;  // double-start guard — true between startOrchestrator and stopOrchestrator

var REFRESH_SETTLE_MS = 1200; // ms to wait after refresh before parsing

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

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
  try {
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
  var intervalMs = tabState.get('refreshIntervalMs');
  orchTimer = setTimeout(async function () {
    await orchestratorTick();
    scheduleNextTick();
  }, intervalMs);
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
    // Release the sidebar's tabState subscription + its independent memory-poll timer
    // (both stored on the element by buildSidebar()) so a later reactivation's fresh
    // buildSidebar() call doesn't leak a second copy of either alongside this one.
    if (sidebarEl._runningSubscriber) tabState.unsubscribe('running', sidebarEl._runningSubscriber);
    if (sidebarEl._memoryPollInterval) clearInterval(sidebarEl._memoryPollInterval);
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
