// Popup — Step 3 wiring.
// WIRED: Night Mode, Tab Alert, Hide Similar Matches, Sound (volume + sound select + preview),
//        Hide Promoted, Hide Starting Soon, Hide Trailer Ready, Price Surge, Reset.
// Popup runs in its own isolated context: never clicks page elements, never
// parses loads, never triggers refresh. State shared via chrome.storage.local.
// utils/constants.js, utils/logger.js, utils/storage.js loaded before this file
// (see popup.html) — STORAGE_KEYS and logger are available as globals.

// AUDIT 2026-07-30 (Part B): these were hardcoded string literals duplicating the values in
// STORAGE_KEYS, each with a trailing comment naming the constant it duplicated — two places
// to keep in sync, and a silent-desync risk if a key is ever renamed in utils/storage.js
// (the popup would keep reading/writing the old key while every content script moved to the
// new one). Now derived from STORAGE_KEYS directly. utils/storage.js is loaded before this
// file (see popup.html), so STORAGE_KEYS is already defined here. Values are unchanged —
// verified key-by-key against STORAGE_KEYS before the swap; the local aliases are kept
// purely so the ~60 usages below stay untouched.
var KEY_NIGHT_MODE         = STORAGE_KEYS.NIGHT_MODE;
var KEY_TAB_ALERT          = STORAGE_KEYS.TAB_ALERT;
var KEY_AUTO_OPEN          = STORAGE_KEYS.AUTO_OPEN;          // true-default
var KEY_HIDE_SIMILAR       = STORAGE_KEYS.HIDE_SIMILAR;
var KEY_VOLUME             = STORAGE_KEYS.VOLUME;             // 0–100, default 70
var KEY_SOUND_ID           = STORAGE_KEYS.SOUND_ID;           // string, default 'default'
var KEY_HIDE_PROMOTED      = STORAGE_KEYS.HIDE_PROMOTED;
var KEY_HIDE_STARTING_SOON = STORAGE_KEYS.HIDE_STARTING_SOON;
var KEY_HIDE_TRAILER_READY = STORAGE_KEYS.HIDE_TRAILER_READY;
var KEY_HIDE_PAST_BOOK     = STORAGE_KEYS.HIDE_PAST_BOOK;     // boolean, default false
var KEY_SURGE_ENABLED      = STORAGE_KEYS.SURGE_ENABLED;      // boolean, default false
var KEY_SURGE_THRESHOLD    = STORAGE_KEYS.SURGE_THRESHOLD;    // number, default 50
var KEY_FAST_BOOK_ENABLED  = STORAGE_KEYS.FAST_BOOK_ENABLED;  // boolean, default false
var KEY_SHARED_LIMIT       = STORAGE_KEYS.SHARED_LIMIT_ENABLED; // true-default

// ── Supabase auth (email OTP) ──────────────────────────────────────────────────
// vendor/supabase.min.js (global `supabase`) + utils/supabaseConfig.js
// (SUPABASE_URL / SUPABASE_ANON_KEY globals) are loaded before this file — see
// popup.html. The `typeof` guards below keep login inert (no throw) if either
// file is ever missing. Session persisted under SUPABASE_SESSION_KEY
// (utils/storage.js), deliberately outside STORAGE_KEYS so "Reset to Defaults"
// never logs the dispatcher out.

var supabaseClient = null;
if (typeof supabase !== 'undefined' && typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

// ── Sound preview (popup context — uses shared global SOUND_DEFS from utils/soundDefs.js) ──

var popupAudioCtx = null;

function getPopupAudioCtx() {
  if (!popupAudioCtx) popupAudioCtx = new AudioContext();
  return popupAudioCtx;
}

function popupGetSoundTones(soundId, startTime) {
  var fn = SOUND_DEFS[soundId] || SOUND_DEFS['default'];
  return fn(startTime);
}

async function previewSound(soundId, volume) {
  if (volume === 0) return;
  try {
    var ctx = getPopupAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    var now      = ctx.currentTime;
    var gainPeak = volume / 100;
    var tones    = popupGetSoundTones(soundId, now);

    tones.forEach(function (tone) {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = tone.type;
      if (tone.freqEnd !== undefined) {
        osc.frequency.setValueAtTime(tone.freq, tone.start);
        osc.frequency.linearRampToValueAtTime(tone.freqEnd, tone.end);
      } else {
        osc.frequency.value = tone.freq;
      }

      gain.gain.setValueAtTime(0.0001, tone.start);
      gain.gain.exponentialRampToValueAtTime(gainPeak, tone.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, tone.end);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(tone.start);
      osc.stop(tone.end);
    });
  } catch (e) {
    console.error('[popup] previewSound failed', e);
  }
}

// ── DOMContentLoaded ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  logger.log('popup', 'DOMContentLoaded');

  var nightToggle        = document.getElementById('popup-night-mode');
  var tabToggle          = document.getElementById('popup-tab-alert');
  var autoOpenToggle     = document.getElementById('popup-auto-open');
  var similarToggle      = document.getElementById('popup-hide-similar');
  var volumeSlider       = document.getElementById('popup-volume');
  var soundSelect        = document.getElementById('popup-sound-select');
  var replayBtn          = document.getElementById('popup-sound-replay');
  var promotedToggle     = document.getElementById('popup-hide-promoted');
  var startingSoonToggle = document.getElementById('popup-hide-starting-soon');
  var trailerReadyToggle = document.getElementById('popup-hide-trailer-ready');
  var pastBookToggle     = document.getElementById('popup-hide-past-book');
  var surgeToggle        = document.getElementById('popup-surge');
  var surgeThreshold     = document.getElementById('popup-surge-threshold');
  var fastBookToggle     = document.getElementById('popup-fast-book');
  // D1 (2026-08-20): the shared-limit toggle was removed from popup.html and the feature ships
  // OFF. These three lookups now return null and every use below is already null-guarded, so
  // the wiring is inert rather than deleted — restoring the markup restores the feature.
  var sharedLimitToggle  = document.getElementById('popup-shared-limit');
  var sharedLimitInfo    = document.getElementById('popup-shared-limit-info');
  var sharedLimitTooltip = document.getElementById('popup-shared-limit-tooltip');
  var resetBtn           = document.getElementById('popup-reset');

  // ── Account / login (Supabase email OTP) ───────────────────────────────────

  var authStepEmail    = document.getElementById('popup-auth-step-email');
  var authStepCode     = document.getElementById('popup-auth-step-code');
  var authStepLoggedIn = document.getElementById('popup-auth-step-loggedin');
  var authEmailInput   = document.getElementById('popup-auth-email');
  var authCodeInput    = document.getElementById('popup-auth-code');
  var authSendBtn      = document.getElementById('popup-auth-send-code');
  var authVerifyBtn    = document.getElementById('popup-auth-verify');
  var authResendBtn    = document.getElementById('popup-auth-resend');
  var authChangeBtn    = document.getElementById('popup-auth-change-email');
  var authLogoutBtn    = document.getElementById('popup-auth-logout');
  var authEmailDisplay = document.getElementById('popup-auth-email-display');
  var authStatus       = document.getElementById('popup-auth-status');
  var authGateNote     = document.getElementById('popup-auth-gate-note');
  var popupFeatures    = document.getElementById('popup-features');

  var pendingAuthEmail = '';

  // Shown inline (in the existing popup-auth-status line — no new UI) when background
  // validation could not REACH the server. Deliberately not a logout: see restoreSession().
  var MSG_NO_CONNECTION = 'No connection — check your internet.';

  function setAuthStatus(msg, isError) {
    if (!authStatus) return;
    authStatus.textContent = msg || '';
    authStatus.classList.toggle('popup-auth-status--error', !!isError);
  }

  // Single source of truth for which auth step is visible — also gates every feature
  // control in the popup (`popup-features`). Logged out ⇒ only the login block shows;
  // Display & Alerts, Sound, Price Surge, Load Board Filters, Booking, and Reset are all
  // hidden until step === 'loggedin'. The underlying inputs still exist in the DOM and
  // still get initialized/wired below (harmless while hidden) — only visibility is gated
  // here, matching how content-script feature gating works (utils/authGate.js).
  function showAuthStep(step) {
    if (authStepEmail)    authStepEmail.hidden    = step !== 'email';
    if (authStepCode)     authStepCode.hidden     = step !== 'code';
    if (authStepLoggedIn) authStepLoggedIn.hidden = step !== 'loggedin';
    if (authGateNote)     authGateNote.hidden     = step === 'loggedin';
    if (popupFeatures)    popupFeatures.hidden    = step !== 'loggedin';
  }

  function showLoggedIn(email) {
    if (authEmailDisplay) authEmailDisplay.textContent = email || '';
    showAuthStep('loggedin');
    setAuthStatus('');
  }

  function saveSession(session) {
    return chrome.storage.local.set({ [SUPABASE_SESSION_KEY]: session });
  }

  function clearSession() {
    return chrome.storage.local.remove(SUPABASE_SESSION_KEY);
  }

  // Persists the pending OTP email so the code-entry step survives the popup closing
  // before the dispatcher enters the code (BUG fix — was in-memory only, lost on close).
  function savePendingEmail(email) {
    return chrome.storage.local.set({ [AUTH_PENDING_KEY]: { pendingEmail: email, step: 'code' } });
  }

  function clearPendingEmail() {
    return chrome.storage.local.remove(AUTH_PENDING_KEY);
  }

  // Called whenever there is no valid session: shows the code step for a pending
  // email if one was saved (popup reopened mid-flow), otherwise the email step.
  async function restorePendingOrEmailStep() {
    var data    = await chrome.storage.local.get(AUTH_PENDING_KEY);
    var pending = data[AUTH_PENDING_KEY];
    if (pending && pending.pendingEmail) {
      // PII (2026-07-30): was `email: pending.pendingEmail`. The stored email is still used
      // below to prefill the input and the status line — only the LOG loses it.
      logger.log('popup', 'restorePendingOrEmailStep: resuming pending code step', { emailLength: pending.pendingEmail.length });
      pendingAuthEmail = pending.pendingEmail;
      if (authEmailInput) authEmailInput.value = pending.pendingEmail;
      setAuthStatus('Enter the code sent to ' + pending.pendingEmail + '.');
      showAuthStep('code');
    } else {
      showAuthStep('email');
    }
  }

  // "The server said no" vs "I could not get an answer from the server" — the distinction
  // requirement 3 rests on, and the reason a lost connection must never log anyone out.
  //
  // Verified by reading the SHIPPED vendor/supabase.min.js, not from memory or docs:
  //   - fetch itself rejecting (offline, DNS failure, connection refused, abort)
  //       => AuthRetryableFetchError, status 0   [minified Vr: `catch(e){...throw new Zn(J(e),0)}`]
  //   - HTTP 500,501,502,503,504,520-530
  //       => AuthRetryableFetchError, that status [minified zr: `if(Rr.includes(e.status))`]
  //   - a real auth verdict (401/403/400, bad or revoked token)
  //       => AuthApiError carrying that status
  // gotrue RETURNS these as `result.error` rather than throwing (its own catch does
  // `if(isAuthError(e)) return {..., error:e}`), and _getUser passes the instance through
  // untouched, so both the returned-error and thrown-error paths arrive here intact.
  //
  // The guard itself is the library's own exported predicate (the UMD bundle exports
  // isAuthRetryableFetchError alongside createClient), with a name check as fallback in case
  // a future bundle drops the export.
  //
  // Everything that is NOT a supabase auth error at all is also treated as "no answer": a
  // TypeError out of the client, or the synthesized 'setSession failed' below, is not the
  // server rejecting the session. Signing someone out therefore requires a POSITIVE
  // server-issued verdict — nothing weaker.
  function isServerVerdict(err) {
    if (!err) return false;
    if (typeof supabase !== 'undefined' && typeof supabase.isAuthRetryableFetchError === 'function') {
      if (supabase.isAuthRetryableFetchError(err)) return false;
    }
    if (err.name === 'AuthRetryableFetchError') return false;
    return err.__isAuthError === true;
  }

  // 2026-07-30 — renders from LOCAL storage first, validates over the network afterwards.
  //
  // Was: read storage, then await a network round trip, and only then render. That cost a
  // 1-1.5s "Checking your session…" screen on every open, and — worse — a failed round trip
  // dropped the dispatcher onto the login form, i.e. a lost connection logged them out.
  //
  // The network call never discovered anything: the stored session already carries
  // expires_at and user.email, the expiry comparison below is a complete signed-in decision,
  // and the storage.onChanged handler at the bottom of this file has always rendered the
  // logged-in state from exactly this local data with no network at all. The call VALIDATES
  // a known answer, so it now runs after the answer is already on screen.
  //
  // Every auth call, storage key, and branch condition below is unchanged from the previous
  // version — only WHEN each result is applied, and what a failure is allowed to do.
  //
  // Accepted trade-off (PM decision, 2026-07-30): a session revoked server-side shows the
  // panel for a few hundred ms until validation corrects it. Access is free at this stage,
  // so there is nothing to gate.
  async function restoreSession() {
    logger.log('popup', 'restoreSession');
    if (!supabaseClient) {
      logger.warn('popup', 'restoreSession: supabase client not configured');
      await restorePendingOrEmailStep();
      return;
    }
    var data = await chrome.storage.local.get(SUPABASE_SESSION_KEY);
    var session = data[SUPABASE_SESSION_KEY];
    if (!session || !session.refresh_token) {
      await restorePendingOrEmailStep();
      return;
    }

    var nowSec    = Math.floor(Date.now() / 1000);
    var expiresAt = session.expires_at || 0;
    var locallyValid = expiresAt - nowSec > 30; // same 30s margin as before, same comparison

    // ── FIRST PAINT — decided here, from local data only. Nothing above this line touches
    // the network. This is the whole fix.
    if (locallyValid) {
      showLoggedIn(session.user && session.user.email);
    } else {
      await restorePendingOrEmailStep();
    }

    // ── BACKGROUND VALIDATION — the panel (or login form) is already on screen. Same two
    // calls, same branch condition, as the pre-2026-07-30 version.
    try {
      if (locallyValid) {
        var setResult = await supabaseClient.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        if (setResult.error || !setResult.data.session) throw setResult.error || new Error('setSession failed');
        // Re-render from the validated session: same call as before, and it also refreshes
        // the displayed email if the server's copy differs from the stored one.
        showLoggedIn(setResult.data.session.user && setResult.data.session.user.email);
        return;
      }
      // Expired locally — the login form is already showing. The silent refresh still runs
      // (unchanged; TC-AUTH-3 depends on it) and promotes to the panel if it succeeds.
      logger.log('popup', 'restoreSession: refreshing expired session');
      var refreshResult = await supabaseClient.auth.refreshSession({ refresh_token: session.refresh_token });
      if (refreshResult.error || !refreshResult.data.session) throw refreshResult.error || new Error('refresh failed');
      await saveSession(refreshResult.data.session);
      showLoggedIn(refreshResult.data.session.user && refreshResult.data.session.user.email);
    } catch (e) {
      if (!isServerVerdict(e)) {
        // Could not reach the server. Change NOTHING: the stored session stays, the view
        // stays, and the dispatcher stays signed in. Only an inline note explains the state.
        // Losing the connection is not evidence the session is bad, and treating it as such
        // is what used to sign people out on a flaky connection.
        logger.error('popup', 'session validation could not reach the server — staying signed in, session NOT cleared', {
          errorName: e && e.name, status: e && e.status
        });
        setAuthStatus(MSG_NO_CONNECTION, true);
        return;
      }
      // A positive server-issued verdict: the session really is invalid/revoked/expired.
      // Same handling as before — clear it and fall back to the auth block, which still
      // routes through restorePendingOrEmailStep() so a pending OTP resumes at the code step.
      logger.warn('popup', 'restoreSession failed, clearing session', e);
      await clearSession();
      await restorePendingOrEmailStep();
    }
  }

  if (authSendBtn) {
    authSendBtn.addEventListener('click', async function () {
      if (!supabaseClient) { setAuthStatus('Login not configured.', true); return; }
      var email = authEmailInput ? authEmailInput.value.trim() : '';
      if (!email) { setAuthStatus('Enter your email.', true); return; }
      // PII (2026-07-30): was `{ email: email }`. Never log the address itself at any
      // DEBUG_LEVEL. The length keeps a little diagnostic value (distinguishes "user typed
      // something" from an empty/whitespace submit) without being identifying.
      logger.log('popup', 'signInWithOtp requested', { emailLength: email.length });
      authSendBtn.disabled = true;
      setAuthStatus('Sending code…');
      try {
        var result = await supabaseClient.auth.signInWithOtp({ email: email });
        if (result.error) {
          logger.error('popup', 'signInWithOtp failed', result.error);
          setAuthStatus(result.error.message || 'Failed to send code.', true);
        } else {
          pendingAuthEmail = email;
          await savePendingEmail(email);
          setAuthStatus('Code sent to ' + email + '.');
          showAuthStep('code');
        }
      } catch (e) {
        logger.error('popup', 'signInWithOtp threw', e);
        setAuthStatus('Failed to send code.', true);
      } finally {
        authSendBtn.disabled = false;
      }
    });
  }

  if (authVerifyBtn) {
    authVerifyBtn.addEventListener('click', async function () {
      if (!supabaseClient) { setAuthStatus('Login not configured.', true); return; }
      var code = authCodeInput ? authCodeInput.value.trim() : '';
      if (!code) { setAuthStatus('Enter the code from your email.', true); return; }
      // Digits only, 6-10 chars — not a fixed length. Supabase sends 8-digit codes;
      // this input used to hard-cap at 6 and reject them.
      if (!/^\d{6,10}$/.test(code)) { setAuthStatus('Code must be 6-10 digits, numbers only.', true); return; }
      // PII (2026-07-30): was `email: pendingAuthEmail`. codeLength is the useful diagnostic
      // here anyway — Supabase sends 8-digit codes and this input used to hard-cap at 6.
      logger.log('popup', 'verifyOtp requested', { emailLength: pendingAuthEmail.length, codeLength: code.length });
      authVerifyBtn.disabled = true;
      setAuthStatus('Verifying…');
      try {
        var result = await supabaseClient.auth.verifyOtp({ email: pendingAuthEmail, token: code, type: 'email' });
        if (result.error || !result.data.session) {
          logger.error('popup', 'verifyOtp failed', result.error);
          setAuthStatus((result.error && result.error.message) || 'Invalid code.', true);
        } else {
          await saveSession(result.data.session);
          await clearPendingEmail();
          if (authCodeInput) authCodeInput.value = '';
          showLoggedIn(result.data.session.user && result.data.session.user.email);
        }
      } catch (e) {
        logger.error('popup', 'verifyOtp threw', e);
        setAuthStatus('Invalid code.', true);
      } finally {
        authVerifyBtn.disabled = false;
      }
    });
  }

  if (authResendBtn) {
    authResendBtn.addEventListener('click', async function () {
      if (!supabaseClient || !pendingAuthEmail) return;
      // PII (2026-07-30): was `email: pendingAuthEmail`.
      logger.log('popup', 'resend signInWithOtp requested', { emailLength: pendingAuthEmail.length });
      authResendBtn.disabled = true;
      setAuthStatus('Sending code…');
      try {
        var result = await supabaseClient.auth.signInWithOtp({ email: pendingAuthEmail });
        setAuthStatus(
          result.error ? (result.error.message || 'Failed to resend code.') : ('Code sent to ' + pendingAuthEmail + '.'),
          !!result.error
        );
      } catch (e) {
        logger.error('popup', 'resend signInWithOtp threw', e);
        setAuthStatus('Failed to resend code.', true);
      } finally {
        authResendBtn.disabled = false;
      }
    });
  }

  if (authChangeBtn) {
    authChangeBtn.addEventListener('click', async function () {
      logger.log('popup', 'popup-auth-change-email clicked');
      pendingAuthEmail = '';
      await clearPendingEmail();
      if (authCodeInput) authCodeInput.value = '';
      setAuthStatus('');
      showAuthStep('email');
    });
  }

  if (authLogoutBtn) {
    authLogoutBtn.addEventListener('click', async function () {
      logger.log('popup', 'popup-auth-logout clicked');
      authLogoutBtn.disabled = true;
      try {
        if (supabaseClient) await supabaseClient.auth.signOut();
      } catch (e) {
        logger.error('popup', 'signOut threw', e);
      }
      await clearSession();
      await clearPendingEmail();
      if (authEmailInput) authEmailInput.value = '';
      pendingAuthEmail = '';
      setAuthStatus('');
      showAuthStep('email');
      authLogoutBtn.disabled = false;
    });
  }

  // 2026-07-30: the 3000ms bounded-wait timer that used to sit here is GONE. It existed only
  // to rescue the dispatcher from the neutral "Checking your session…" state if the network
  // check never answered; nothing waits on the network to render any more, so there is no
  // stuck state left for it to rescue — and a timeout that falls back to the login form is
  // exactly the sign-out-on-bad-network behaviour this change removes.
  //
  // The .catch stays. restoreSession() can still reject: its chrome.storage.local.get sits
  // outside any handler, and if the local read fails there is no session data to render
  // from, so the login form is the only honest option (this is a storage failure, not a
  // network one — no session is cleared here either way). Without it this would also be an
  // unhandled promise rejection, as it was before 2026-07-30.
  restoreSession().catch(function (e) {
    logger.error('popup', 'restoreSession threw — falling back to the auth block', { error: e });
    return restorePendingOrEmailStep().catch(function (e2) {
      logger.error('popup', 'failure fallback restorePendingOrEmailStep threw', { error: e2 });
      showAuthStep('email');
    });
  });

  // ── Read all settings from storage and initialise the UI ──────────────────
  chrome.storage.local.get(
    [
      KEY_NIGHT_MODE, KEY_TAB_ALERT, KEY_AUTO_OPEN, KEY_HIDE_SIMILAR,
      KEY_VOLUME, KEY_SOUND_ID,
      KEY_HIDE_PROMOTED, KEY_HIDE_STARTING_SOON, KEY_HIDE_TRAILER_READY, KEY_HIDE_PAST_BOOK,
      KEY_SURGE_ENABLED, KEY_SURGE_THRESHOLD, KEY_FAST_BOOK_ENABLED, KEY_SHARED_LIMIT
    ],
    function (data) {
      if (nightToggle)        nightToggle.checked        = data[KEY_NIGHT_MODE] === true;
      document.documentElement.classList.toggle('ext-night', data[KEY_NIGHT_MODE] === true);
      if (tabToggle)          tabToggle.checked          = data[KEY_TAB_ALERT] === true;
      if (autoOpenToggle)     autoOpenToggle.checked     = data[KEY_AUTO_OPEN] !== false; // true-default
      if (similarToggle)      similarToggle.checked      = data[KEY_HIDE_SIMILAR] === true;
      if (volumeSlider)       volumeSlider.value         = (data[KEY_VOLUME] !== undefined) ? data[KEY_VOLUME] : 70;
      if (soundSelect)        soundSelect.value          = data[KEY_SOUND_ID] || 'default';
      if (promotedToggle)     promotedToggle.checked     = data[KEY_HIDE_PROMOTED] === true;
      if (startingSoonToggle) startingSoonToggle.checked = data[KEY_HIDE_STARTING_SOON] === true;
      if (trailerReadyToggle) trailerReadyToggle.checked = data[KEY_HIDE_TRAILER_READY] === true;
      if (pastBookToggle)     pastBookToggle.checked     = data[KEY_HIDE_PAST_BOOK]     === true;
      if (surgeToggle)        surgeToggle.checked        = data[KEY_SURGE_ENABLED]      === true;
      if (surgeThreshold) {
        var storedThreshold = data[KEY_SURGE_THRESHOLD];
        surgeThreshold.value = (storedThreshold !== undefined) ? storedThreshold : 50;
        logger.log('popup', 'surgeThreshold loaded', { value: surgeThreshold.value });
      }
      if (fastBookToggle)     fastBookToggle.checked     = data[KEY_FAST_BOOK_ENABLED]  === true;
      if (sharedLimitToggle)  sharedLimitToggle.checked  = data[KEY_SHARED_LIMIT] !== false; // true-default
    }
  );

  // ── Write handlers ────────────────────────────────────────────────────────

  if (nightToggle) {
    nightToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_NIGHT_MODE]: nightToggle.checked });
    });
  }

  if (tabToggle) {
    tabToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_TAB_ALERT]: tabToggle.checked });
    });
  }

  if (autoOpenToggle) {
    autoOpenToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_AUTO_OPEN]: autoOpenToggle.checked });
    });
  }

  if (similarToggle) {
    similarToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_HIDE_SIMILAR]: similarToggle.checked });
    });
  }

  // Volume: write on 'change' (thumb released), not on every 'input' tick.
  if (volumeSlider) {
    volumeSlider.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_VOLUME]: Number(volumeSlider.value) });
    });
  }

  // Sound select: persist + immediately preview the chosen sound.
  if (soundSelect) {
    soundSelect.addEventListener('change', function () {
      var soundId = soundSelect.value;
      var vol     = volumeSlider ? Number(volumeSlider.value) : 70;
      chrome.storage.local.set({ [KEY_SOUND_ID]: soundId });
      previewSound(soundId, vol);
    });
  }

  // Replay button: preview current selection at current volume.
  if (replayBtn) {
    replayBtn.addEventListener('click', function () {
      var soundId = soundSelect ? soundSelect.value : 'default';
      var vol     = volumeSlider ? Number(volumeSlider.value) : 70;
      previewSound(soundId, vol);
    });
  }

  if (promotedToggle) {
    promotedToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_HIDE_PROMOTED]: promotedToggle.checked });
    });
  }

  if (startingSoonToggle) {
    startingSoonToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_HIDE_STARTING_SOON]: startingSoonToggle.checked });
    });
  }

  if (trailerReadyToggle) {
    trailerReadyToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_HIDE_TRAILER_READY]: trailerReadyToggle.checked });
    });
  }

  if (pastBookToggle) {
    pastBookToggle.addEventListener('change', function () {
      chrome.storage.local.set({ [KEY_HIDE_PAST_BOOK]: pastBookToggle.checked });
    });
  }

  if (surgeToggle) {
    surgeToggle.addEventListener('change', function () {
      logger.log('popup', 'surgeEnabled saved', { value: surgeToggle.checked });
      chrome.storage.local.set({ [KEY_SURGE_ENABLED]: surgeToggle.checked });
    });
  }

  if (surgeThreshold) {
    function saveSurgeThreshold() {
      var n = Number(surgeThreshold.value);
      if (isNaN(n) || n <= 0) return;
      logger.log('popup', 'surgeThreshold saved', { value: n });
      chrome.storage.local.set({ [KEY_SURGE_THRESHOLD]: n });
    }
    surgeThreshold.addEventListener('input',  saveSurgeThreshold);
    surgeThreshold.addEventListener('change', saveSurgeThreshold);
  }

  if (fastBookToggle) {
    fastBookToggle.addEventListener('change', function () {
      logger.log('popup', 'fastBookEnabled saved', { value: fastBookToggle.checked });
      chrome.storage.local.set({ [KEY_FAST_BOOK_ENABLED]: fastBookToggle.checked });
    });
  }

  if (sharedLimitToggle) {
    sharedLimitToggle.addEventListener('change', function () {
      logger.log('popup', 'sharedRefreshLimitEnabled saved', { value: sharedLimitToggle.checked });
      chrome.storage.local.set({ [KEY_SHARED_LIMIT]: sharedLimitToggle.checked });
    });
  }

  // Info tooltip — hover + keyboard focus (not a native title attribute, which doesn't
  // reliably show on keyboard focus). Matches content/sidebar.js's memory-info pattern.
  if (sharedLimitInfo && sharedLimitTooltip) {
    var showSharedLimitTooltip = function () { sharedLimitTooltip.classList.add('popup-tooltip-visible'); };
    var hideSharedLimitTooltip = function () { sharedLimitTooltip.classList.remove('popup-tooltip-visible'); };
    sharedLimitInfo.addEventListener('mouseenter', showSharedLimitTooltip);
    sharedLimitInfo.addEventListener('mouseleave', hideSharedLimitTooltip);
    sharedLimitInfo.addEventListener('focus', showSharedLimitTooltip);
    sharedLimitInfo.addEventListener('blur', hideSharedLimitTooltip);
  }

  // ── Reset to defaults ─────────────────────────────────────────────────────
  // Clears every extension-managed key from chrome.storage.local, then resets
  // the popup UI controls to their documented defaults. No confirm dialog.
  // tabState (sessionStorage, per-tab) is intentionally NOT touched — it is
  // session state, separate from persisted settings.

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      logger.log('popup', 'popup-reset clicked');
      var keys = Object.values(STORAGE_KEYS);
      chrome.storage.local.remove(keys, function () {
        logger.log('popup', 'extension storage cleared', { keys: keys });
        if (nightToggle)        nightToggle.checked        = false;
        if (tabToggle)          tabToggle.checked          = false;
        if (autoOpenToggle)     autoOpenToggle.checked     = true; // true-default
        if (similarToggle)      similarToggle.checked      = false;
        if (volumeSlider)       volumeSlider.value         = 70;
        if (soundSelect)        soundSelect.value          = 'default';
        if (promotedToggle)     promotedToggle.checked     = false;
        if (startingSoonToggle) startingSoonToggle.checked = false;
        if (trailerReadyToggle) trailerReadyToggle.checked = false;
        if (pastBookToggle)     pastBookToggle.checked     = false;
        if (surgeToggle)        surgeToggle.checked        = false;
        if (surgeThreshold)     surgeThreshold.value       = 50;
        if (fastBookToggle)     fastBookToggle.checked     = false;
        if (sharedLimitToggle)  sharedLimitToggle.checked  = true; // true-default
      });
    });
  }

  // ── Live sync: storage → UI (handles changes from other extension pages) ──
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[KEY_NIGHT_MODE] !== undefined) {
      var nightOn = changes[KEY_NIGHT_MODE].newValue === true;
      document.documentElement.classList.toggle('ext-night', nightOn);
      if (nightToggle) nightToggle.checked = nightOn;
    }
    if (changes[KEY_TAB_ALERT]          !== undefined && tabToggle)          tabToggle.checked          = changes[KEY_TAB_ALERT].newValue === true;
    if (changes[KEY_AUTO_OPEN]          !== undefined && autoOpenToggle)     autoOpenToggle.checked     = changes[KEY_AUTO_OPEN].newValue !== false;
    if (changes[KEY_HIDE_SIMILAR]       !== undefined && similarToggle)      similarToggle.checked      = changes[KEY_HIDE_SIMILAR].newValue === true;
    if (changes[KEY_VOLUME]   !== undefined && volumeSlider)  volumeSlider.value = (changes[KEY_VOLUME].newValue   !== undefined) ? changes[KEY_VOLUME].newValue   : 70;
    if (changes[KEY_SOUND_ID] !== undefined && soundSelect)  soundSelect.value  = (changes[KEY_SOUND_ID].newValue !== undefined) ? changes[KEY_SOUND_ID].newValue : 'default';
    if (changes[KEY_HIDE_PROMOTED]      !== undefined && promotedToggle)     promotedToggle.checked     = changes[KEY_HIDE_PROMOTED].newValue === true;
    if (changes[KEY_HIDE_STARTING_SOON] !== undefined && startingSoonToggle) startingSoonToggle.checked = changes[KEY_HIDE_STARTING_SOON].newValue === true;
    if (changes[KEY_HIDE_TRAILER_READY] !== undefined && trailerReadyToggle) trailerReadyToggle.checked = changes[KEY_HIDE_TRAILER_READY].newValue === true;
    if (changes[KEY_HIDE_PAST_BOOK]     !== undefined && pastBookToggle)     pastBookToggle.checked     = changes[KEY_HIDE_PAST_BOOK].newValue     === true;
    if (changes[KEY_SURGE_ENABLED]      !== undefined && surgeToggle)        surgeToggle.checked        = changes[KEY_SURGE_ENABLED].newValue      === true;
    if (changes[KEY_SURGE_THRESHOLD] !== undefined && surgeThreshold) surgeThreshold.value = (changes[KEY_SURGE_THRESHOLD].newValue !== undefined) ? changes[KEY_SURGE_THRESHOLD].newValue : 50;
    if (changes[KEY_FAST_BOOK_ENABLED]  !== undefined && fastBookToggle)    fastBookToggle.checked     = changes[KEY_FAST_BOOK_ENABLED].newValue   === true;
    if (changes[KEY_SHARED_LIMIT] !== undefined && sharedLimitToggle) sharedLimitToggle.checked = changes[KEY_SHARED_LIMIT].newValue !== false;
    if (changes[SUPABASE_SESSION_KEY] !== undefined) {
      var newSession = changes[SUPABASE_SESSION_KEY].newValue;
      if (newSession && newSession.user) {
        showLoggedIn(newSession.user.email);
      } else {
        pendingAuthEmail = '';
        showAuthStep('email');
      }
    }
  });
});
