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
  PRICE_HISTORY:      'priceHistory'           // legacy — no longer written (moved to tabState); kept so Reset cleans old installs
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
