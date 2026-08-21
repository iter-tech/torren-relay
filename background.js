// Background service worker — TASK (2026-07-20): coordinates ONE global request-rate
// budget across every open Relay tab. Root cause: each tab ran its own independent
// refresh timer (utils/tabState.js), so N tabs multiplied the effective request rate
// against a single IP — confirmed live: 3-4 tabs at 2s each caused sustained HTTP 503 on
// /api/loadboard/search, and switching networks restored access immediately (IP-based
// throttle, not account-based).
//
// This file ONLY grants/denies permits and tracks backoff state. It NEVER performs the
// board fetch itself — that stays in the content script (content/content.js), which needs
// the page's own authentication context (cookies/CSRF) that a service-worker-initiated
// fetch would not reliably carry the same way. See docs/SAFETY.md.
//
// chrome.storage.local (not in-memory state) is the single source of truth for pacing and
// backoff, because MV3 service workers are NOT persistent — Chrome can terminate this
// worker after ~30s of no pending extension-API activity and restart it fresh on the next
// message. Every function here re-reads state from storage on each call rather than
// trusting anything held in a JS variable across invocations. The one exception
// (permitQueueTail below) is explicitly NOT authoritative — see its comment.

// Must match utils/storage.js's RATE_LIMITER_KEY exactly — duplicated, not shared, because
// this service worker is not part of the content_scripts bundle and there is no module
// system in this codebase to import a single constant from.
const RATE_LIMITER_KEY = 'extRateLimiterState';

// Must match utils/storage.js's STORAGE_KEYS.REFRESH_INTERVAL_MS exactly — duplicated,
// not shared (see RATE_LIMITER_KEY comment above for why).
const REFRESH_INTERVAL_KEY = 'globalRefreshIntervalMs';
const DEFAULT_REFRESH_INTERVAL_MS = 2000; // matches content.js's own fallback default

// 2026-07-30 FIX: the shared pacing floor used to be a hardcoded 5000ms
// (GLOBAL_MIN_PERMIT_INTERVAL_MS), unrelated to the dispatcher's own slider setting — a
// single tab at a 2s setting was being silently throttled to 5s. Correct model: the
// dispatcher's chosen interval IS the global request budget, not a separate constant. With
// 1 active tab, the floor is never binding (that tab's own tick cadence already exceeds
// it), so it refreshes at exactly the chosen interval. With N tabs sharing the SAME
// FIFO-ordered floor, each tab statistically receives 1 grant in every N, i.e. an effective
// per-tab cadence of interval × N — automatically, with no explicit tab count anywhere: a
// closed or logged-out tab simply stops sending REQUEST_PERMIT messages, so it drops out of
// the round-robin instantly, no registry/TTL needed. Read fresh from storage on every call
// (not cached) so a live slider change takes effect for pacing immediately, same as it
// already does for content.js's own local timer.
async function getGlobalPacingFloorMs() {
  var data = await chrome.storage.local.get(REFRESH_INTERVAL_KEY);
  var ms = data[REFRESH_INTERVAL_KEY];
  return (typeof ms === 'number' && ms > 0) ? ms : DEFAULT_REFRESH_INTERVAL_MS;
}

// Backoff schedule on 5xx/network failure — exponential, capped, jittered. Reset to
// "normal" (index -1, no backoff) only after a reported 2xx.
const BACKOFF_STEPS_MS     = [5000, 10000, 20000, 40000, 80000];
const BACKOFF_MAX_MS       = 300000; // 5 minutes
const BACKOFF_JITTER_RATIO = 0.20;   // ±20%

function jitter(ms) {
  var delta = ms * BACKOFF_JITTER_RATIO;
  return Math.round(ms + (Math.random() * 2 - 1) * delta);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function getState() {
  var data = await chrome.storage.local.get(RATE_LIMITER_KEY);
  return data[RATE_LIMITER_KEY] || {
    lastGrantedAt:    0,
    backoffUntil:     null,
    backoffStepIndex: -1,
    lastFailureAt:    null,
    rateLimited:      false
  };
}

async function setState(state) {
  await chrome.storage.local.set({ [RATE_LIMITER_KEY]: state });
}

// Serializes concurrent permit requests within one LIVE service-worker session, so
// simultaneous requests from multiple tabs are processed one at a time, in arrival order
// (first-come-first-served = round-robin fairness; no single tab can cut the line).
// Purely an in-memory convenience for a live worker — if the worker is evicted and
// restarted between requests, this chain simply resets to a fresh Promise.resolve() with
// no correctness impact, because the actual pacing floor (state.lastGrantedAt) is always
// re-read from chrome.storage.local, never carried only in memory.
var permitQueueTail = Promise.resolve();

// sharedLimitEnabled (2026-07-20 follow-up, "Shared refresh limit" toggle, default true):
// backoff is checked FIRST and ALWAYS, regardless of this flag — a 503 must still pause
// every tab, shared budget or not. Only the PACING floor (see getGlobalPacingFloorMs above)
// is skipped when the caller has the toggle off, restoring "each tab fires on its own
// schedule" legacy behavior. lastGrantedAt is deliberately left untouched on the
// pacing-skipped path so it never competes with concurrently-shared-mode tabs' pacing math.
async function grantOrDenyPermit(sharedLimitEnabled) {
  var state = await getState();
  var now = Date.now();

  if (state.backoffUntil && state.backoffUntil > now) {
    return { granted: false, backoffUntil: state.backoffUntil, backoffStepIndex: state.backoffStepIndex };
  }

  if (!sharedLimitEnabled) {
    return { granted: true };
  }

  var floorMs = await getGlobalPacingFloorMs();
  var nextAllowedAt = Math.max(state.lastGrantedAt + floorMs, now);
  var waitMs = nextAllowedAt - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  // Re-read after waiting: another tab may have been granted while we waited (advancing
  // lastGrantedAt further), or a failure may have been reported mid-wait (setting
  // backoffUntil) — a fresh backoff must win over the grant we were about to hand out.
  state = await getState();
  now = Date.now();
  if (state.backoffUntil && state.backoffUntil > now) {
    return { granted: false, backoffUntil: state.backoffUntil, backoffStepIndex: state.backoffStepIndex };
  }

  state.lastGrantedAt = now;
  await setState(state);
  return { granted: true };
}

// ── PLAN 10 DIAGNOSTICS (2026-08-20) — measurement only, no pacing change ─────────────────
//
// WHY IT LIVES HERE. The aggregate rate is a property of ALL tabs together, and the only place
// that sees every tab is this service worker. Recording grants here lets ANY ONE tab print the
// aggregate, so Ihor does not have to correlate four consoles by hand.
//
// OFF BY DEFAULT and stored, not compiled in: background.js is a separate context and never sees
// utils/constants.js, so the flag cannot be CITY_ASSIGN_DEBUG. It is a stored boolean that the
// content-side command flips. When off, noteGrantForDiag() does nothing and writes nothing.
//
// ⚠ IT CHANGES NO PACING. The ring is appended AFTER the grant decision is final, and nothing in
// grantOrDenyPermit(), reportResult() or the backoff math ever reads it.
const RATE_DIAG_KEY  = 'extRateDiag';
const RATE_DIAG_MAX  = 200;   // ~7 minutes at a 2s floor; far more than the 60s window needs

async function getRateDiag() {
  var data = await chrome.storage.local.get(RATE_DIAG_KEY);
  return data[RATE_DIAG_KEY] || { on: false, grants: [] };
}

// Appends one granted-permit timestamp with the tab that got it. Fire-and-forget by its caller.
async function noteGrantForDiag(tabId) {
  try {
    var diag = await getRateDiag();
    if (!diag.on) return;
    diag.grants.push({ t: Date.now(), tab: (tabId === undefined || tabId === null) ? '?' : tabId });
    while (diag.grants.length > RATE_DIAG_MAX) diag.grants.shift();
    await chrome.storage.local.set({ [RATE_DIAG_KEY]: diag });
  } catch (e) {
    console.error('[background] noteGrantForDiag failed — diagnostics only, pacing unaffected', e);
  }
}

async function requestPermit(sharedLimitEnabled) {
  permitQueueTail = permitQueueTail.then(
    function () { return grantOrDenyPermit(sharedLimitEnabled); },
    function () { return grantOrDenyPermit(sharedLimitEnabled); }
  );
  return permitQueueTail;
}

// 2026-07-30: active-tab registry — added for the "Shared rate" UI display only (sidebar.js
// shows "Active tabs: N → each tab refreshes every intervalMs*N"). Pacing itself (above)
// does NOT use this — it stays purely FIFO-on-a-shared-floor, which already produces the
// correct interval*N cadence with zero tab-count dependency. This is the ONE authoritative
// source of N; nothing else counts tabs independently. {tabId: lastSeenAt}, persisted (not
// just in-memory) for the same reason as RATE_LIMITER_KEY — a restarted service worker must
// not silently forget who's active. Primary removal is immediate (chrome.tabs.onRemoved,
// and the RELEASE_TAB message content.js sends on logout/pause); ACTIVE_TAB_STALE_MS below
// is a safety net only, for a tab that vanishes without a clean event (crash, navigating off
// the Relay domain without a normal teardown).
const ACTIVE_TABS_KEY       = 'extActiveTabs';      // {tabId: lastSeenAt} — internal registry
const ACTIVE_TAB_COUNT_KEY  = 'extActiveTabCount';  // {count:N} — what content scripts subscribe to
const ACTIVE_TAB_STALE_MS   = 20000;

var activeTabsQueueTail = Promise.resolve(); // same read-modify-write race guard as permitQueueTail

async function getActiveTabsRegistry() {
  var data = await chrome.storage.local.get(ACTIVE_TABS_KEY);
  return data[ACTIVE_TABS_KEY] || {};
}

async function writeActiveTabsState(registry) {
  var count = Object.keys(registry).length;
  await chrome.storage.local.set({
    [ACTIVE_TABS_KEY]:      registry,
    [ACTIVE_TAB_COUNT_KEY]: { count: count }
  });
  return count;
}

async function touchActiveTabNow(tabId) {
  var registry = await getActiveTabsRegistry();
  var now = Date.now();
  registry[tabId] = now;
  Object.keys(registry).forEach(function (id) {
    if (now - registry[id] > ACTIVE_TAB_STALE_MS) delete registry[id];
  });
  await writeActiveTabsState(registry);
}

async function releaseActiveTabNow(tabId) {
  var registry = await getActiveTabsRegistry();
  if (registry[tabId] === undefined) return;
  delete registry[tabId];
  await writeActiveTabsState(registry);
}

function touchActiveTab(tabId) {
  if (typeof tabId !== 'number') return Promise.resolve();
  activeTabsQueueTail = activeTabsQueueTail.then(
    function () { return touchActiveTabNow(tabId); },
    function () { return touchActiveTabNow(tabId); }
  );
  return activeTabsQueueTail;
}

function releaseActiveTab(tabId) {
  if (typeof tabId !== 'number') return Promise.resolve();
  activeTabsQueueTail = activeTabsQueueTail.then(
    function () { return releaseActiveTabNow(tabId); },
    function () { return releaseActiveTabNow(tabId); }
  );
  return activeTabsQueueTail;
}

// Immediate removal on real tab close — chrome.tabs.onRemoved is a persistent event
// listener re-registered on every service-worker load, so this survives SW eviction/restart
// just like every other listener in this file.
chrome.tabs.onRemoved.addListener(function (tabId) {
  releaseActiveTab(tabId).catch(function (e) {
    console.error('[background] releaseActiveTab on tab close failed', e);
  });
});

// The ONLY statuses that mean "Amazon is rate-limiting this IP".
//
// 429 — the explicit signal.
// 503 — confirmed live on 2026-07-20 (see this file's header: 3-4 tabs at 2s each produced
//       sustained 503 on /api/loadboard/search, and switching networks restored access
//       immediately, proving an IP-based throttle rather than an account problem).
// 502, 504 — added 2026-07-31 as a DELIBERATE SAFETY-SIDE DEFAULT, made WITHOUT captured
//       evidence. We have never observed Amazon throttling via a gateway status; these are
//       included because the cost is asymmetric, not because we know. If a gateway status IS
//       a throttle and we do not back off, we keep hammering Amazon and risk an IP block on
//       the dispatcher's account — precisely what this backoff exists to prevent. If it is an
//       ordinary gateway error, we lose a few seconds and recover on our own. Revisit if
//       evidence ever appears: capture what Amazon actually returns under a real throttle.
//
// 500 is deliberately EXCLUDED — an application error on Amazon's side is not a throttle, and
// retrying more slowly does not help it.
const RATE_LIMIT_STATUSES = [429, 502, 503, 504];

// ok=true (2xx observed) resets backoff entirely. A failure advances one backoff step ONLY
// when its HTTP status is in RATE_LIMIT_STATUSES. Every other outcome leaves the state
// completely untouched — no write, no storage event, no escalation.
//
// 2026-07-31 FIX. The previous version accepted `status` and never read it: the whole
// decision was `if (ok)`, so the else branch fired for ANY non-2xx. Confirmed by execution:
// status 0, 404 and 401 all paused the extension. The comment that used to sit here claimed
// "Never called on 3xx/4xx — content.js only reports results for responses it identifies as
// either success or a 5xx/network failure". That was never true; content.js
// (see its window 'message' listener) relays every observed result verbatim, with no
// filtering, and still does. The filtering lives HERE now, which is why the claim is gone.
//
// The practical damage: switching a saved search aborts the in-flight search, the abort was
// reported as a failure, and monitoring silently stopped and escalated through 5/10/20/40/80s
// while the dispatcher's board carried on working normally. Aborts are no longer reported at
// all (content/networkObserver.js), and non-rate-limit failures no longer pause us here —
// two independent fixes, either of which alone would have prevented that specific case.
//
// Deliberately NOT decided in this task: what a genuine network failure (status 0) or an
// unexpected status (401/404/500/502/504) SHOULD do. They currently do nothing beyond being
// logged. See CHANGELOG.md 2026-07-31 for the recommendation on each.
//
// `rateLimited` (2026-07-30) is a DISPLAY flag only — nothing in this file's pacing or
// backoff math reads it. It exists because backoffUntil answers a different question than a
// paused indicator needs: backoffUntil expiring means "we may try again now", NOT "Amazon
// lifted the block". Only an observed 2xx proves the latter, so the flag is set when we enter
// backoff and cleared ONLY on a reported success — it deliberately outlives the backoff
// timer. (The sidebar element that displayed it was removed 2026-07-31; the flag itself still
// drives the shared-rate status row and is still the honest record of the paused state.)
async function reportResult(ok, status) {
  var state = await getState();
  if (ok) {
    state.backoffUntil     = null;
    state.backoffStepIndex = -1;
    state.lastFailureAt    = null;
    state.rateLimited      = false;
  } else if (RATE_LIMIT_STATUSES.indexOf(status) !== -1) {
    state.rateLimited      = true;
    state.backoffStepIndex = Math.min(state.backoffStepIndex + 1, BACKOFF_STEPS_MS.length);
    var baseMs = state.backoffStepIndex < BACKOFF_STEPS_MS.length
      ? BACKOFF_STEPS_MS[state.backoffStepIndex]
      : BACKOFF_MAX_MS;
    baseMs = Math.min(baseMs, BACKOFF_MAX_MS);
    state.backoffUntil  = Date.now() + jitter(baseMs);
    state.lastFailureAt = Date.now();
  } else {
    // Not a rate-limit signal. Return WITHOUT setState so an existing backoff is neither
    // extended nor cleared, and no storage write fires — a non-rate-limit failure arriving
    // mid-backoff must be a complete no-op, not a nudge in either direction.
    console.log('[background] non-rate-limit result ignored for backoff purposes', { status: status });
    return state;
  }
  await setState(state);
  return state;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  if (msg.type === 'REQUEST_PERMIT') {
    // Default true (missing/undefined) so an older/mismatched content script that doesn't
    // send the flag still gets the safe (paced) behavior rather than an accidental bypass.
    var sharedLimitEnabled = msg.sharedLimitEnabled !== false;
    // Heartbeat for the active-tab registry — fire-and-forget, not awaited before the
    // permit response, so this display-only bookkeeping never adds latency to the
    // latency-sensitive pacing decision above.
    if (sender.tab) {
      touchActiveTab(sender.tab.id).catch(function (e) {
        console.error('[background] touchActiveTab failed', e);
      });
    }
    requestPermit(sharedLimitEnabled)
      .then(function (result) {
        // PLAN 10: record the grant for the aggregate view. AFTER the decision, never awaited
        // before the response — it cannot add latency to or alter pacing.
        if (result && result.granted) {
          noteGrantForDiag(sender.tab && sender.tab.id).catch(function () {});
        }
        sendResponse(result);
      })
      .catch(function (e) { sendResponse({ granted: false, error: String(e) }); });
    return true; // async response
  }

  if (msg.type === 'REPORT_RESULT') {
    reportResult(msg.ok === true, msg.status)
      .then(function (state) { sendResponse({ ack: true, state: state }); })
      .catch(function (e) { sendResponse({ ack: false, error: String(e) }); });
    return true; // async response
  }

  // PLAN 10 diagnostics + the synthetic rate-limit hook. Measurement and test only.
  if (msg.type === 'RATE_DIAG') {
    (async function () {
      try {
        var diag = await getRateDiag();
        if (msg.action === 'on')    { diag.on = true;  diag.grants = []; }
        if (msg.action === 'off')   { diag.on = false; }
        if (msg.action === 'clear') { diag.grants = []; }
        if (msg.action === 'on' || msg.action === 'off' || msg.action === 'clear') {
          await chrome.storage.local.set({ [RATE_DIAG_KEY]: diag });
        }
        // ⚠ THE SYNTHETIC RATE-LIMIT HOOK. It does NOT mock the path — it calls the SAME
        // reportResult() that a real 503 reaches, with the same status, so the real
        // classification, the real backoff curve, the real storage write and the real
        // cross-tab propagation all execute.
        //
        // WHAT IT PROVES: everything downstream of the status — that a rate-limit status pauses
        // every tab, that the backoff step advances, and that a later 2xx resumes them together.
        // WHAT IT DOES NOT PROVE: that a genuine Amazon 503 actually arrives here as status 503.
        // That is the networkObserver -> content.js relay, which this bypasses. Only a real 503
        // exercises that half.
        if (msg.action === 'simulate') {
          var st = (typeof msg.status === 'number') ? msg.status : 503;
          // 2026-08-20: `times` fires N CONSECUTIVE events so the stop threshold can be tested
          // without waiting for real throttling. Each iteration is a separate real
          // reportResult() call — this is still the real path, looped, not a mock.
          var times = (typeof msg.times === 'number' && msg.times > 0) ? Math.min(msg.times, 10) : 1;
          console.log('[background] RATE_DIAG simulate — injecting status ' + st + ' x' + times +
            ' into the REAL reportResult path');
          var after = null;
          for (var i = 0; i < times; i++) { after = await reportResult(false, st); }
          // backoffStepIndex IS the consecutive counter (see reportResult): 0-based, so the Nth
          // consecutive response leaves it at N-1. Reported here so the console shows the count
          // the sidebar is about to act on.
          var consecutive = (after && typeof after.backoffStepIndex === 'number' && after.backoffStepIndex >= 0)
            ? after.backoffStepIndex + 1 : 0;
          sendResponse({ ok: true, simulated: st, times: times, consecutive: consecutive,
                         stopsAt: 3, willStop: consecutive >= 3, state: after,
                         diag: { on: diag.on, count: diag.grants.length } });
          return;
        }
        if (msg.action === 'recover') {
          console.log('[background] RATE_DIAG recover — injecting a success into the REAL path; ' +
            'this RESETS the consecutive counter to zero');
          var ok = await reportResult(true, 200);
          sendResponse({ ok: true, consecutive: 0, state: ok,
                         diag: { on: diag.on, count: diag.grants.length } });
          return;
        }
        var state = await getState();
        var floor = await getGlobalPacingFloorMs();
        var tabs  = await chrome.storage.local.get(ACTIVE_TAB_COUNT_KEY);
        sendResponse({ ok: true, on: diag.on, grants: diag.grants, state: state,
                       floorMs: floor, tabCount: (tabs[ACTIVE_TAB_COUNT_KEY] || {}).count });
      } catch (e) {
        console.error('[background] RATE_DIAG failed', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'RELEASE_TAB') {
    // Sent by content.js's stopOrchestrator() — covers both logout and the dispatcher
    // manually pausing (Play/Pause off). A paused tab isn't part of the round-robin, so it
    // must not count toward N — see the comment on ACTIVE_TABS_KEY above.
    var releaseTabId = sender.tab && sender.tab.id;
    releaseActiveTab(releaseTabId)
      .then(function () { sendResponse({ ack: true }); })
      .catch(function (e) { sendResponse({ ack: false, error: String(e) }); });
    return true; // async response
  }

  return false;
});
