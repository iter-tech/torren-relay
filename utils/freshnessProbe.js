// utils/freshnessProbe.js
// ── IS AMAZON SILENTLY HOLDING BACK THE NEWEST LOADS? RECORD IT WHEN IT HAPPENS (EXT-D11) ─────────
//
// Ihor's observation: an IP that refreshes often keeps getting answers, but the newest loads stop
// appearing; the same account on another IP sees them. docs/THROTTLE_SIGNALS.md found NO captured
// example, so this keeps one: for every search / recommendations response the page already receives,
// content/networkObserver.js (MAIN world) posts a small record, and this file keeps the last 500.
//
// 🔑 PASSIVE, like the EXT-D6 price probe (utils/priceProbe.js). No request is added, none is
// changed, the refresh rate is untouched, and nothing here decides anything. The 503 slow-down in
// background.js is unaffected.
//
// ⚠ NO DOM, NO chrome.tabs — the same file loads in the content scripts (which write) and in the
// popup (which reads and summarises).
//
// ⚠ THE KEY IS OUTSIDE STORAGE_KEYS, for the same reason as priceProbeEvents: "Reset to defaults"
// clears settings, and a measurement is not a setting.
//
// A record (all fields may be null when the response had no readable body):
//   t       ISO time the response was observed        pg   random id of the page (tab) it came from
//   ep      'search' | 'recommendations'               st   HTTP status (0 = network error / timeout)
//   bot     isBotRequest, raw (null in every capture so far)
//   mk      metadata keys          mcodes  metadata.reasonList[].code
//   rows    workOpportunities returned                 total  totalResultsSize
//   newestAgeMin  minutes since the newest createdAtTime in the response
//   hdr     headers that could mean caching or throttling (ids masked; never cookies or tokens)
//   hints   the throttle-like signals seen in THIS response ('isBotRequest=…', 'x-cache=Hit…', 'age=…')
//   r1, r5  this page's search/recommendations requests in the last 1 and 5 minutes
//   note    'non-2xx' | 'network-error' | 'timeout' | null

/** chrome.storage.local key holding the ring buffer. */
const FRESHNESS_PROBE_KEY = 'freshnessProbeRecords';

/** How many records are kept (~350 bytes each ≈ 175 KB, well inside local storage's 5 MB). */
const FRESHNESS_PROBE_MAX = 500;

/** A repeated identical warning is logged at most once per this many ms, so a throttled board
 *  refreshing every few seconds does not flood the console. Every record is still stored. */
const FRESHNESS_WARN_EVERY_MS = 10 * 60 * 1000;

var freshnessProbe = (function () {

  // Serialised read-modify-write, as in priceProbe: chrome.storage has no transaction.
  var _chain = Promise.resolve();
  function mutate(fn, what) {
    _chain = _chain.then(function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(FRESHNESS_PROBE_KEY, function (data) {
            try {
              var list = (data && Array.isArray(data[FRESHNESS_PROBE_KEY])) ? data[FRESHNESS_PROBE_KEY] : [];
              var next = fn(list);
              if (!next) { resolve(); return; }
              if (next.length > FRESHNESS_PROBE_MAX) next = next.slice(next.length - FRESHNESS_PROBE_MAX);
              var o = {};
              o[FRESHNESS_PROBE_KEY] = next;
              chrome.storage.local.set(o, function () { resolve(); });
            } catch (e) {
              logger.error('freshnessProbe', 'could not ' + what, { error: e });
              resolve();
            }
          });
        } catch (e) {
          logger.error('freshnessProbe', 'could not ' + what, { error: e });
          resolve();
        }
      });
    });
    return _chain;
  }

  // Only the fields we defined, with sane types — the message comes over postMessage, which
  // anything on the page can post to, so nothing arbitrary is stored.
  function clean(r) {
    if (!r || typeof r !== 'object') return null;
    var str = function (v, n) { return (typeof v === 'string') ? v.slice(0, n) : null; };
    var num = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : null; };
    var hdr = {};
    if (r.hdr && typeof r.hdr === 'object') {
      Object.keys(r.hdr).slice(0, 20).forEach(function (k) {
        if (/cookie|authorization|token|csrf|session|secret/i.test(k)) return;
        hdr[String(k).slice(0, 60)] = String(r.hdr[k]).slice(0, 120);
      });
    }
    var bot = r.bot;
    if (!(bot === null || typeof bot === 'boolean' || typeof bot === 'number')) bot = str(bot, 80);
    return {
      t: str(r.t, 30), pg: str(r.pg, 12),
      ep: (r.ep === 'search' || r.ep === 'recommendations') ? r.ep : null,
      st: num(r.st), bot: bot,
      mk: Array.isArray(r.mk) ? r.mk.slice(0, 20).map(function (k) { return String(k).slice(0, 60); }) : null,
      mcodes: Array.isArray(r.mcodes) ? r.mcodes.slice(0, 10).map(function (k) { return k == null ? null : String(k).slice(0, 40); }) : null,
      rows: num(r.rows), total: num(r.total), newestAgeMin: num(r.newestAgeMin),
      hdr: hdr,
      hints: Array.isArray(r.hints) ? r.hints.slice(0, 10).map(function (h) { return String(h).slice(0, 120); }) : [],
      r1: num(r.r1), r5: num(r.r5), note: str(r.note, 30)
    };
  }

  var _lastWarn = {};
  function record(raw) {
    try {
      var rec = clean(raw);
      if (!rec || !rec.ep) return;
      logger.log('freshnessProbe', 'freshness-record', rec);
      if (rec.hints.length) {
        // 🔑 THE WARNING (Ihor: debug log only, no UI alert yet). `notice` so it prints at the
        // shipped DEBUG_LEVEL 1; deduplicated per distinct set of hints.
        var sig = rec.hints.join('|');
        var now = Date.now();
        if (!_lastWarn[sig] || now - _lastWarn[sig] > FRESHNESS_WARN_EVERY_MS) {
          _lastWarn[sig] = now;
          logger.notice('freshnessProbe', '⚠ FRESHNESS WARNING — possible throttle/caching signal: ' + sig, rec);
        }
      }
      mutate(function (list) { list.push(rec); return list; }, 'append the freshness record');
    } catch (e) {
      logger.error('freshnessProbe', 'record failed — the board is unaffected', { error: e });
    }
  }

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
  }

  /** Records → the numbers the popup prints. Pure. */
  function summarise(list) {
    var rs = Array.isArray(list) ? list : [];
    var ages = [], lastAge = null, botNonNull = 0, s503 = 0, hinted = 0, maxR1 = 0, lastR1 = null;
    var byEp = { search: 0, recommendations: 0 };
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i] || {};
      if (byEp[r.ep] !== undefined) byEp[r.ep]++;
      if (r.bot !== null && r.bot !== undefined) botNonNull++;
      if (r.st === 503) s503++;
      if (r.hints && r.hints.length) hinted++;
      if (typeof r.newestAgeMin === 'number') { ages.push(r.newestAgeMin); lastAge = r.newestAgeMin; }
      if (typeof r.r1 === 'number') { lastR1 = r.r1; if (r.r1 > maxR1) maxR1 = r.r1; }
    }
    return {
      total: rs.length, byEp: byEp, botNonNull: botNonNull, s503: s503, hinted: hinted,
      lastAge: lastAge, medianAge: median(ages), lastR1: lastR1, maxR1: maxR1,
      first: rs.length ? rs[0].t : null, last: rs.length ? rs[rs.length - 1].t : null
    };
  }

  function read(cb) {
    try {
      chrome.storage.local.get(FRESHNESS_PROBE_KEY, function (data) {
        cb((data && Array.isArray(data[FRESHNESS_PROBE_KEY])) ? data[FRESHNESS_PROBE_KEY] : []);
      });
    } catch (e) {
      logger.error('freshnessProbe', 'read failed', { error: e });
      cb([]);
    }
  }

  function clear(cb) {
    try {
      var o = {};
      o[FRESHNESS_PROBE_KEY] = [];
      chrome.storage.local.set(o, function () { if (cb) cb(); });
    } catch (e) {
      logger.error('freshnessProbe', 'clear failed', { error: e });
      if (cb) cb();
    }
  }

  // The receiver. Content scripts only: the popup is a chrome-extension:// page and never gets
  // these messages, so it only reads.
  function listen() {
    try {
      window.addEventListener('message', function (ev) {
        if (ev.source !== window || !ev.data || ev.data.__extRelayFreshness !== true) return;
        record(ev.data.rec);
      });
    } catch (e) {
      logger.error('freshnessProbe', 'could not listen — nothing will be recorded', { error: e });
    }
  }
  if (typeof location !== 'undefined' && location.protocol !== 'chrome-extension:') listen();

  return { record: record, read: read, clear: clear, summarise: summarise, _clean: clean };

})();
