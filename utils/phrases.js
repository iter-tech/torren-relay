// utils/phrases.js
// ── THE DISPATCHER'S NEGOTIATION PHRASES (EXT-D9) ──────────────────────────────────────────────
//
// What this is for: later, a button on our load card will open Amazon's own Relay Assistant chat
// for that load, and a panel beside it will list these phrases — one click sends one into the chat.
// Booking always stays a manual click on Amazon's own Book button.
//
// 🔴 THIS FILE TOUCHES NOTHING ON AMAZON'S PAGE. It is the library: storage, limits and rendering.
// Since 2026-09-28 (EXT-D10.2) content/aiChatPhrases.js uses it for the "Phrases ▾" dropdown inside
// Amazon's chat; that file does the DOM work and inserts text, and nothing ever sends a message.
//
// 🔑 THE LIST IS THE DISPATCHER'S, AND IT PERSISTS UNTIL HE CHANGES IT. It is his words for his
// negotiation; the starter set is a starting point, not a product opinion. Export/import is JSON so
// he can move it to another machine or keep a copy.
//
// 🔑 chrome.storage.sync FIRST, local AS FALLBACK. Sync follows him to a second computer, which is
// the whole point of a phrase list he has tuned. Sync has hard quotas (about 8 KB per item, 100 KB
// in total, and a write rate limit), so every write checks for failure and falls back to
// chrome.storage.local for the rest of the session — and `phrases.whereStored()` says which is in
// use, because "my phrases did not follow me" must be answerable.

/** The stored key. ⚠ VERSIONED IN THE NAME as well as in the value, so a future shape is a new key. */
var PHRASES_KEY = 'phrasesV1';

/** Which area a write landed in, once we know. 'sync' | 'local' | null while nothing is written. */
var PHRASES_AREA_KEY = 'phrasesStorageArea';

/** The shape's own version, inside the value. `migratePhrases()` upgrades anything older. */
var PHRASES_VERSION = 1;

/**
 * ⚠ THE LIMITS, AND WHY THESE NUMBERS.
 *
 *   15 phrases — the ADD limit (Ihor, 2026-09-28; was 20 in EXT-D9). A list you scan in a dropdown
 *                inside Amazon's chat while a load is on screen. Adding is refused at 15, in the popup
 *                AND in the chat dropdown, and an import is cut to 15.
 *   20 phrases — the STORAGE ceiling, i.e. the old limit. 🔴 A LIST SAVED UNDER THE OLD LIMIT IS
 *                NEVER TRUNCATED: 16–20 stored phrases are all kept and shown; only adding is blocked
 *                until the list is below 15. Truncating on read would delete his own wording silently.
 *  200 characters — two sentences. Amazon's assistant answers a short question; a paragraph pasted
 *                into a chat reads as a form letter and buries the number being negotiated.
 *
 * Enforced on save AND on import, so a hand-edited JSON file cannot get past them.
 */
var MAX_PHRASES = 15;
var MAX_STORED_PHRASES = 20;
var MAX_PHRASE_LENGTH = 200;

/**
 * The starter set. ⚠ WORDING FOR IHOR TO REVIEW — these are plausible English negotiation lines,
 * not measured ones: no capture of a real negotiation exists in this repository.
 *
 * Six lines covering the moves a dispatcher actually makes: ask, counter with a number, counter
 * with a percentage, ask about the things that cost money besides the rate, and accept.
 */
var STARTER_PHRASES = [
  'Can you do better than {payout} on this one?',
  'I can take it at {payout+150}.',
  'My rate for this lane is {payout+10%} — can you meet that?',
  'What is the detention policy at these stops?',
  'Is there any flexibility on the pickup time?',
  'Are there other loads on this lane at a better rate?',
  'That works — I will take it at {payout}.',
];

var phrases = (function () {

  /* ── the value shape ──────────────────────────────────────────────────────────────────────── */

  function makeItem(text) {
    return {
      // A short random id, so reorder and delete never depend on the text or the index.
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: String(text == null ? '' : text).slice(0, MAX_PHRASE_LENGTH),
    };
  }

  // 🔑 FIXED IDS for the starter set (EXT-D10.2). Until the first save, every load() returns a fresh
  // starter value; with random ids an edit made from the chat dropdown could not find its own row in
  // the next load and was silently dropped (caught by the headless proof). Ids only need to be unique
  // within one list.
  function starterValue() {
    return { version: PHRASES_VERSION, updatedAt: Date.now(),
             items: STARTER_PHRASES.map(function (t, i) { return { id: 'starter' + i, text: t }; }) };
  }

  /**
   * Anything read from storage → a valid value.
   *
   * 🔑 THE MIGRATION PATH, EVEN THOUGH THERE IS ONLY ONE VERSION TODAY. A list that is a
   * dispatcher's own typing must never be dropped because a later shape arrived: an OLDER version
   * is upgraded field by field, and a NEWER one (a second machine already running a later build,
   * syncing back) is kept EXACTLY as it is and reported, never rewritten by this older code.
   */
  function migratePhrases(raw) {
    if (!raw || typeof raw !== 'object') return { value: starterValue(), fresh: true, note: 'no stored list' };

    var v = Number(raw.version);
    if (!isFinite(v)) v = 0;

    if (v > PHRASES_VERSION) {
      // ⚠ NOT TOUCHED. Reading is fine; writing would downgrade the other machine's list.
      return { value: raw, fresh: false, note: 'stored by a NEWER build (v' + v + ') — left as it is' };
    }

    var items = Array.isArray(raw.items) ? raw.items : [];
    var clean = [];
    for (var i = 0; i < items.length && clean.length < MAX_STORED_PHRASES; i++) {
      var it = items[i];
      var text = (it && typeof it === 'object') ? it.text : it;   // v0 may have been bare strings
      if (typeof text !== 'string') continue;
      var trimmed = text.slice(0, MAX_PHRASE_LENGTH);
      if (!trimmed.trim()) continue;
      clean.push({ id: (it && it.id) || makeItem('').id, text: trimmed });
    }
    return {
      value: { version: PHRASES_VERSION, items: clean, updatedAt: Number(raw.updatedAt) || Date.now() },
      fresh: false,
      note: v < PHRASES_VERSION ? ('upgraded from v' + v) : null,
    };
  }

  /* ── storage ──────────────────────────────────────────────────────────────────────────────── */

  var _area = null;   // 'sync' | 'local', once a read or a write has told us

  function areaFor(name) {
    try {
      return (chrome && chrome.storage && chrome.storage[name]) ? chrome.storage[name] : null;
    } catch (e) {
      return null;
    }
  }

  function getFrom(name, key) {
    return new Promise(function (resolve) {
      var area = areaFor(name);
      if (!area) { resolve({ ok: false, value: undefined, error: name + ' is unavailable' }); return; }
      try {
        area.get(key, function (data) {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) { resolve({ ok: false, value: undefined, error: err.message }); return; }
          resolve({ ok: true, value: data ? data[key] : undefined, error: null });
        });
      } catch (e) {
        resolve({ ok: false, value: undefined, error: String(e) });
      }
    });
  }

  function setIn(name, key, value) {
    return new Promise(function (resolve) {
      var area = areaFor(name);
      if (!area) { resolve({ ok: false, error: name + ' is unavailable' }); return; }
      try {
        var payload = {};
        payload[key] = value;
        area.set(payload, function () {
          var err = chrome.runtime && chrome.runtime.lastError;
          // ⚠ QUOTA FAILURES ARRIVE HERE, NOT AS A THROW. Without reading lastError a full sync
          // area loses every write silently, which is exactly how a phrase list "resets itself".
          if (err) { resolve({ ok: false, error: err.message }); return; }
          resolve({ ok: true, error: null });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  /** Read the list. Sync first; whatever answers decides where later writes go. */
  async function load() {
    var fromSync = await getFrom('sync', PHRASES_KEY);
    if (fromSync.ok && fromSync.value !== undefined) {
      _area = 'sync';
      var m = migratePhrases(fromSync.value);
      logger.log('phrases', 'loaded from sync', { items: (m.value.items || []).length, note: m.note });
      return { value: m.value, area: 'sync', note: m.note };
    }
    var fromLocal = await getFrom('local', PHRASES_KEY);
    if (fromLocal.ok && fromLocal.value !== undefined) {
      _area = 'local';
      var m2 = migratePhrases(fromLocal.value);
      logger.log('phrases', 'loaded from local', { items: (m2.value.items || []).length, note: m2.note });
      return { value: m2.value, area: 'local', note: m2.note };
    }
    // Nothing stored anywhere: the starter set, not yet written. The first save writes it.
    var starter = starterValue();
    logger.log('phrases', 'no stored list — starting from the starter set', { items: starter.items.length });
    return { value: starter, area: _area, note: 'starter set (nothing stored yet)' };
  }

  /**
   * Write the list. Sync, then local if sync refuses.
   * ⚠ THE FALLBACK IS REPORTED, NOT SILENT: a list that stopped following him between machines is
   * a thing he must be able to see, and `whereStored()` is what the editor prints.
   */
  async function save(items) {
    var clean = [];
    for (var i = 0; i < items.length && clean.length < MAX_STORED_PHRASES; i++) {
      var text = String(items[i] && items[i].text != null ? items[i].text : items[i]).slice(0, MAX_PHRASE_LENGTH);
      if (!text.trim()) continue;
      clean.push({ id: (items[i] && items[i].id) || makeItem('').id, text: text });
    }
    var value = { version: PHRASES_VERSION, items: clean, updatedAt: Date.now() };

    var trySync = await setIn('sync', PHRASES_KEY, value);
    if (trySync.ok) {
      _area = 'sync';
      await setIn('local', PHRASES_AREA_KEY, 'sync');
      logger.log('phrases', 'saved to sync', { items: clean.length });
      return { ok: true, area: 'sync', error: null, items: clean };
    }

    logger.warn('phrases', 'sync refused the write — falling back to local storage', { error: trySync.error });
    var tryLocal = await setIn('local', PHRASES_KEY, value);
    if (tryLocal.ok) {
      _area = 'local';
      await setIn('local', PHRASES_AREA_KEY, 'local');
      return { ok: true, area: 'local', error: 'sync: ' + trySync.error, items: clean };
    }
    logger.error('phrases', 'the phrase list could not be saved anywhere', {
      sync: trySync.error, local: tryLocal.error,
    });
    return { ok: false, area: null, error: tryLocal.error, items: clean };
  }

  function whereStored() { return _area; }

  /* ── the variables ────────────────────────────────────────────────────────────────────────── */

  /**
   * The payout of a load, as a number, from the record the extension already holds.
   *
   * ⚠ BOTH SHAPES, THE SAME WAY payoutGateFor() READS THEM (content/inlinePanel.js): the curated
   * record flattens payout to a number, the raw API shape is `{ value, unit }`. Read from the
   * record, never from the card's text — a price scraped from the DOM is a string in a currency
   * and a locale, and this has to do arithmetic on it.
   */
  function payoutOf(record) {
    if (!record) return null;
    var p = record.payout;
    if (p && typeof p === 'object' && typeof p.value === 'number') p = p.value;
    return (typeof p === 'number' && isFinite(p)) ? p : null;
  }

  /**
   * "$1,700" — whole dollars, thousands separated.
   * ⚠ ROUNDED, NOT TRUNCATED, and to a whole dollar: the record carries figures like
   * 1699.5023456, and "$1,699.50" in a negotiation line reads as a machine talking.
   */
  function money(n) {
    var rounded = Math.round(n);
    return '$' + String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Every variable this understands, as one expression. `{payout}`, `{payout+150}`, `{payout+10%}`
   * — and, deliberately, their minus forms, because a counter-offer below the board rate is a real
   * negotiating move.
   */
  var VAR_RE = /\{payout([+-]\d+(?:\.\d+)?%?)?\}/gi;

  /** Anything in braces at all — used to find the ones we do NOT understand. */
  var ANY_VAR_RE = /\{[^}]*\}/g;

  /**
   * A phrase + a load record → the text to send, and what stopped it if anything did.
   *
   * Returns `{ text, usable, reason, unknown: [] }`.
   *
   * 🔴 `usable: false` MEANS DO NOT SEND IT. A phrase that mentions the payout and has no payout to
   * put there would go into a live negotiation with a hole in it — or worse, with "$0" — so the
   * caller must refuse rather than substitute. A phrase with no variables is always usable.
   */
  function renderPhrase(text, record) {
    var src = String(text == null ? '' : text);
    var pay = payoutOf(record);

    var unknown = [];
    var all = src.match(ANY_VAR_RE) || [];
    for (var i = 0; i < all.length; i++) {
      VAR_RE.lastIndex = 0;
      if (!VAR_RE.test(all[i])) unknown.push(all[i]);
    }

    var needsPayout = false;
    VAR_RE.lastIndex = 0;
    needsPayout = VAR_RE.test(src);
    VAR_RE.lastIndex = 0;

    if (needsPayout && pay === null) {
      return {
        text: src,                       // ⚠ AS TYPED. Never a half-substituted line.
        usable: false,
        reason: 'no-payout',
        unknown: unknown,
      };
    }

    var out = src.replace(VAR_RE, function (_whole, mod) {
      if (!mod) return money(pay);
      var percent = mod.slice(-1) === '%';
      var raw = percent ? mod.slice(0, -1) : mod;
      var delta = parseFloat(raw);
      if (!isFinite(delta)) return money(pay);
      return money(percent ? pay * (1 + delta / 100) : pay + delta);
    });

    return {
      text: out,
      usable: true,
      // ⚠ An unknown variable does NOT block the phrase: it is left exactly as typed and flagged,
      // because a dispatcher may be using braces as punctuation of his own.
      reason: unknown.length ? 'unknown-variables' : null,
      unknown: unknown,
    };
  }

  /** True when the text uses any payout variable — i.e. it needs a payout to be usable. */
  function hasVariables(text) {
    VAR_RE.lastIndex = 0;
    var r = VAR_RE.test(String(text == null ? '' : text));
    VAR_RE.lastIndex = 0;
    return r;
  }

  /** Whether one more phrase may be added to a list of `count`. */
  function canAdd(count) { return count < MAX_PHRASES; }

  /**
   * The editor's line about the limit, or '' when there is nothing to say. Shared by the popup and
   * the chat dropdown so they say the same thing.
   */
  function limitNote(count) {
    if (count > MAX_PHRASES) {
      return 'You have ' + count + ' phrases; the limit is now ' + MAX_PHRASES + '. All are kept — ' +
        'delete ' + (count - MAX_PHRASES + 1) + ' to add a new one.';
    }
    if (count === MAX_PHRASES) return 'That is the maximum of ' + MAX_PHRASES + '. Delete one to add another.';
    return '';
  }

  /* ── export / import ──────────────────────────────────────────────────────────────────────── */

  /** The file a dispatcher keeps. Pretty-printed: it is meant to be readable and hand-editable. */
  function exportJson(items) {
    return JSON.stringify({
      kind: 'tenlane-relay-phrases',
      version: PHRASES_VERSION,
      exportedAt: new Date().toISOString(),
      items: items.map(function (i) { return { text: i.text }; }),
    }, null, 2);
  }

  /**
   * A pasted file → items, or a reason it was refused.
   * ⚠ IT ACCEPTS A BARE ARRAY OF STRINGS TOO. Somebody will paste `["a","b"]`, and refusing that on
   * a technicality helps nobody.
   */
  function importJson(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, items: [], error: 'That is not valid JSON.' };
    }
    var raw = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
    if (!raw) return { ok: false, items: [], error: 'No phrase list found in that file.' };

    var items = [];
    var skipped = 0;
    for (var i = 0; i < raw.length; i++) {
      var t = (raw[i] && typeof raw[i] === 'object') ? raw[i].text : raw[i];
      if (typeof t !== 'string' || !t.trim()) { skipped++; continue; }
      if (items.length >= MAX_PHRASES) { skipped++; continue; }
      items.push(makeItem(t.slice(0, MAX_PHRASE_LENGTH)));
    }
    if (!items.length) return { ok: false, items: [], error: 'That file has no usable phrases in it.' };
    return { ok: true, items: items, error: null, skipped: skipped };
  }

  /* ── the entry point the chat integration will call ───────────────────────────────────────── */

  /**
   * 🔑 THE ONE NAMED ENTRY POINT FOR THE FUTURE CHAT PANEL (EXT-D9).
   *
   * Given a load id, it returns every phrase already rendered against that load's record:
   * `[{ id, source, text, usable, reason, unknown }]`. The panel beside Amazon's chat will call
   * exactly this, draw the list, and send `text` on a click — so the panel will contain no
   * formatting, no arithmetic and no storage code of its own.
   *
   * ⚠ NOTHING CALLS IT YET, DELIBERATELY. The chat DOM is not captured, so there is no panel; this
   * exists so the later work is a UI change and not a redesign.
   */
  async function phrasesForLoad(loadId) {
    var record = (typeof getLoadRecord === 'function') ? getLoadRecord(loadId) : null;
    var loaded = await load();
    return (loaded.value.items || []).map(function (item) {
      var r = renderPhrase(item.text, record);
      return {
        id: item.id,
        source: item.text,
        text: r.text,
        usable: r.usable,
        reason: r.reason,
        unknown: r.unknown,
      };
    });
  }

  return {
    KEY: PHRASES_KEY,
    VERSION: PHRASES_VERSION,
    MAX_PHRASES: MAX_PHRASES,
    MAX_STORED_PHRASES: MAX_STORED_PHRASES,
    MAX_PHRASE_LENGTH: MAX_PHRASE_LENGTH,
    hasVariables: hasVariables,
    canAdd: canAdd,
    limitNote: limitNote,
    STARTER_PHRASES: STARTER_PHRASES,
    load: load,
    save: save,
    whereStored: whereStored,
    starterValue: starterValue,
    migratePhrases: migratePhrases,
    renderPhrase: renderPhrase,
    payoutOf: payoutOf,
    money: money,
    exportJson: exportJson,
    importJson: importJson,
    phrasesForLoad: phrasesForLoad,
  };

})();
