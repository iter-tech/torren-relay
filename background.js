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
    lastFailureAt:    null
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

async function requestPermit(sharedLimitEnabled) {
  permitQueueTail = permitQueueTail.then(
    function () { return grantOrDenyPermit(sharedLimitEnabled); },
    function () { return grantOrDenyPermit(sharedLimitEnabled); }
  );
  return permitQueueTail;
}

// ok=true (2xx observed) resets backoff entirely. ok=false (5xx or network failure —
// status 0) advances one backoff step. Never called on 3xx/4xx — content.js only reports
// results for responses it identifies as either success or a 5xx/network failure; other
// statuses are left alone deliberately (a 401/403 is an auth problem, not a rate problem,
// and should not be treated as "the whole browser must back off").
async function reportResult(ok, status) {
  var state = await getState();
  if (ok) {
    state.backoffUntil     = null;
    state.backoffStepIndex = -1;
    state.lastFailureAt    = null;
  } else {
    state.backoffStepIndex = Math.min(state.backoffStepIndex + 1, BACKOFF_STEPS_MS.length);
    var baseMs = state.backoffStepIndex < BACKOFF_STEPS_MS.length
      ? BACKOFF_STEPS_MS[state.backoffStepIndex]
      : BACKOFF_MAX_MS;
    baseMs = Math.min(baseMs, BACKOFF_MAX_MS);
    state.backoffUntil  = Date.now() + jitter(baseMs);
    state.lastFailureAt = Date.now();
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
    requestPermit(sharedLimitEnabled)
      .then(function (result) { sendResponse(result); })
      .catch(function (e) { sendResponse({ granted: false, error: String(e) }); });
    return true; // async response
  }

  if (msg.type === 'REPORT_RESULT') {
    reportResult(msg.ok === true, msg.status)
      .then(function (state) { sendResponse({ ack: true, state: state }); })
      .catch(function (e) { sendResponse({ ack: false, error: String(e) }); });
    return true; // async response
  }

  return false;
});
