// Shared login gate for content scripts. Every extension feature requires an active
// Supabase session — this module is the single place that checks one, reusing the
// same session object popup/popup.js writes to chrome.storage.local[SUPABASE_SESSION_KEY].
//
// Content scripts never CLEAR a bad session — that stays popup.js's job (restoreSession()),
// so a stale refresh token doesn't race across N open tabs all trying to log the dispatcher
// out at once. A failed/expired session here just means the gate is closed for this page
// load; it is not a logout.
//
// Requires vendor/supabase.min.js + utils/supabaseConfig.js loaded first (see manifest.json
// content_scripts order). If either is missing, the gate stays permanently closed rather
// than throwing — same fallback popup.js uses.

var _authGateClient = null;
if (typeof supabase !== 'undefined' && typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
  _authGateClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function _checkAuthGateOnce() {
  if (!_authGateClient) {
    logger.warn('authGate', 'supabase client not configured — gate closed');
    return { active: false, email: null };
  }
  try {
    var data    = await chrome.storage.local.get(SUPABASE_SESSION_KEY);
    var session = data[SUPABASE_SESSION_KEY];
    if (!session || !session.refresh_token) {
      return { active: false, email: null };
    }

    var nowSec    = Math.floor(Date.now() / 1000);
    var expiresAt = session.expires_at || 0;

    if (expiresAt - nowSec > 30) {
      var setResult = await _authGateClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
      if (setResult.error || !setResult.data.session) {
        logger.warn('authGate', 'setSession failed', setResult.error);
        return { active: false, email: null };
      }
      return { active: true, email: setResult.data.session.user && setResult.data.session.user.email };
    }

    logger.log('authGate', 'session expiring — refreshing silently');
    var refreshResult = await _authGateClient.auth.refreshSession({ refresh_token: session.refresh_token });
    if (refreshResult.error || !refreshResult.data.session) {
      logger.warn('authGate', 'silent refresh failed', refreshResult.error);
      return { active: false, email: null };
    }
    await chrome.storage.local.set({ [SUPABASE_SESSION_KEY]: refreshResult.data.session });
    return { active: true, email: refreshResult.data.session.user && refreshResult.data.session.user.email };
  } catch (e) {
    logger.error('authGate', 'checkAuthGate failed', { error: e });
    return { active: false, email: null };
  }
}

var _authGatePromise  = null;
var _lastGateActive   = null;  // null = not yet known (first check hasn't resolved)
var _authGateListeners = [];

// Every getAuthGate()/recheckAuthGate() call runs its result through here. Fires
// registered listeners only on an actual active↔inactive TRANSITION (not on every check —
// e.g. a session refresh that stays active must not re-fire "activate"). The very first
// resolved check never fires listeners (wasActive === null) — content.js's own startup
// IIFE handles the initial activate/no-op directly; this is for LIVE changes afterward
// (login/logout from the popup while the page is already open — see TASK 1, 2026-07-20).
function _handleGateResult(gate) {
  var wasActive = _lastGateActive;
  _lastGateActive = gate.active;
  if (wasActive !== null && wasActive !== gate.active) {
    logger.log('authGate', 'gate transition', { from: wasActive, to: gate.active, email: gate.email });
    _authGateListeners.forEach(function (cb) {
      try { cb(gate); } catch (e) { logger.error('authGate', 'onAuthGateChange listener threw', { error: e }); }
    });
  }
  return gate;
}

// Cached for the lifetime of this page load. content.js, nightMode.js, filterTags.js,
// and filterSimilar.js all call this from their own startup IIFEs at roughly the same
// tick — dedup so that only one actual check (and, at most, one refresh) happens.
function getAuthGate() {
  if (!_authGatePromise) _authGatePromise = _checkAuthGateOnce().then(_handleGateResult);
  return _authGatePromise;
}

// Forces a fresh check, bypassing the startup cache, and updates the cache with the
// result. Used at the moment the dispatcher clicks Play — a tab can sit open for hours
// after the initial gate check, long enough for the session to need refreshing again.
function recheckAuthGate() {
  _authGatePromise = _checkAuthGateOnce().then(_handleGateResult);
  return _authGatePromise;
}

// Synchronous read of the last-known gate state — for call sites that can't await
// (e.g. a document-level click handler). Reflects whatever the most recent
// getAuthGate()/recheckAuthGate() resolved to; defaults to false (inactive) before the
// first check has resolved, which is the safe default (matches "no session ⇒ inert").
function isAuthGateActiveSync() {
  return _lastGateActive === true;
}

// Registers a callback for live gate transitions (login/logout while the page is already
// open, detected via the chrome.storage.onChanged listener below). Callback receives the
// same { active, email } shape as getAuthGate(). Each content script module that
// self-activates independently of content.js's orchestrator (nightMode.js,
// filterSimilar.js, filterTags.js) registers its own activate/deactivate pair here;
// content.js registers activateExtensionUI/deactivateExtensionUI.
function onAuthGateChange(callback) {
  _authGateListeners.push(callback);
}

// Live detection: popup.js writes SUPABASE_SESSION_KEY on login/logout. Any write
// triggers a fresh check; _handleGateResult only notifies listeners if that check finds an
// actual transition (guards against firing on every silent-refresh write, which keeps the
// gate active throughout).
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes[SUPABASE_SESSION_KEY] === undefined) return;
  logger.log('authGate', 'session storage changed — rechecking gate');
  recheckAuthGate();
});
