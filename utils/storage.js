const STORAGE_KEYS = {
  SPEED:              'refreshSpeedSeconds',  // legacy — no longer written (moved to tabState); kept so Reset cleans old installs
  RUNNING:            'isRunning',            // legacy — no longer written (moved to tabState); kept so Reset cleans old installs
  AUTO_OPEN:          'autoOpenTopNew',
  NIGHT_MODE:         'nightMode',
  TAB_ALERT:          'tabAlert',
  HIDE_SIMILAR:       'hideSimilarMatches',
  VOLUME:             'soundVolume',
  SOUND_ID:           'soundId',
  HIDE_PROMOTED:      'hidePromoted',
  HIDE_STARTING_SOON: 'hideStartingSoon',
  HIDE_TRAILER_READY: 'hideTrailerReady',
  HIDE_PAST_BOOK:     'hidePastBook',
  SURGE_ENABLED:      'surgeEnabled',
  SURGE_THRESHOLD:    'surgeThreshold',
  FAST_BOOK_ENABLED:  'fastBookEnabled',
  PRICE_HISTORY:      'priceHistory',          // legacy — no longer written (moved to tabState); kept so Reset cleans old installs
  // Refresh interval is GLOBAL as of 2026-07-20 (was per-tab via tabState.refreshIntervalMs
  // — see CHANGELOG.md for why: N independently-timed tabs multiplied the effective
  // request rate against one IP). Deliberately a NEW key, not a reuse of the legacy SPEED
  // key above (different unit — ms, not seconds — and different semantics; reusing it
  // risked a stale old value being silently reinterpreted).
  REFRESH_INTERVAL_MS: 'globalRefreshIntervalMs',
  // "Shared refresh limit" toggle (2026-07-20 follow-up) — true-default. ON: permit
  // pacing is enforced, using REFRESH_INTERVAL_MS itself (above) as the shared global
  // floor — see background.js's getGlobalPacingFloorMs() (2026-07-30: replaced a hardcoded
  // 5000ms constant with the dispatcher's own chosen interval). OFF: each tab fires its own
  // refresh on its own schedule with no cross-tab pacing coordination — 503 backoff still
  // applies either way (background.js checks backoff before pacing, unconditionally; only
  // the pacing check itself is gated on this setting).
  SHARED_LIMIT_ENABLED: 'sharedRefreshLimitEnabled'
};

// Supabase session — intentionally NOT in STORAGE_KEYS. "Reset to Defaults" clears
// Object.values(STORAGE_KEYS) and must not log the dispatcher out as a side effect
// of resetting extension preferences.
const SUPABASE_SESSION_KEY = 'supabaseSession';

// Pending OTP email — set when "Send code" succeeds, so the code-entry step survives
// the popup closing before the dispatcher enters the code. Shape: { pendingEmail, step }.
// Same reasoning as SUPABASE_SESSION_KEY: not in STORAGE_KEYS, Reset must not disrupt
// an in-flight login.
const AUTH_PENDING_KEY = 'authPendingEmail';

// Cross-tab rate-limit coordination state, owned by background.js. Intentionally NOT in
// STORAGE_KEYS — it is not a user preference, it is live coordination state; "Reset to
// Defaults" clearing it mid-backoff would let every tab immediately hammer Amazon again
// right when the extension is most likely to be freshly reinstalled/reset after trouble.
const RATE_LIMITER_KEY = 'extRateLimiterState';

const storage = {

  async get(key, defaultValue) {
    logger.log('storage', 'get', { key, defaultValue });
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] !== undefined ? result[key] : defaultValue;
    } catch (e) {
      logger.error('storage', 'get failed', { key, error: e });
      return defaultValue;
    }
  },

  async set(key, value) {
    logger.log('storage', 'set', { key, value });
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      logger.error('storage', 'set failed', { key, value, error: e });
    }
  },

  async remove(key) {
    logger.log('storage', 'remove', { key });
    try {
      await chrome.storage.local.remove(key);
    } catch (e) {
      logger.error('storage', 'remove failed', { key, error: e });
    }
  },

  async getAll() {
    logger.log('storage', 'getAll');
    try {
      return await chrome.storage.local.get(null);
    } catch (e) {
      logger.error('storage', 'getAll failed', { error: e });
      return {};
    }
  }

};
