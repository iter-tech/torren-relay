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

/** EXT-D11.1: the per-endpoint table the popup reads (one snapshot, rewritten every few seconds). */
const FRESHNESS_ENDPOINTS_KEY = 'freshnessEndpoints';

/**
 * EXT-D11.1 THRESHOLDS — chosen from the samples (docs/DECISIONS.md EXT-D11.1):
 *   - a board cycle is search:nego + search:main + recommendations together, every ~30 s
 *     (samples/ai-chat-2.har gaps 30.0 / 33.6 s; ai-chat.har 50.0 s);
 *   - search:main brought 3 new ids per fresh cycle (ai-chat-2.har #38, ai-chat.har #46), and up to
 *     4 zero-new responses IN A ROW occurred normally (#57, #75, #79, #85), including quick repeats.
 *
 * silent  : a board endpoint with ≥ 3 calls not seen for > 3 × its median gap (gap floored at
 *           10 s) while another board endpoint is still cycling (seen within 1.5 × ITS median gap).
 * no-new  : a load endpoint whose last 10 responses all had 0 new ids, ≥ 5 min since its last new id,
 *           and it DID bring new ids within the last 60 min (i.e. it normally does).
 */
const FRESHNESS_CFG_DEFAULT = {
  silentFactor: 3, silentMinGapMs: 10000, silentMinCalls: 3, aliveFactor: 1.5,
  noNewStreak: 10, noNewMinMs: 5 * 60000, normalWindowMs: 60 * 60000,
  tickMs: 15000, snapshotEveryMs: 5000, keepMs: 10 * 60000
};
const FRESHNESS_BOARD_KEYS = ['search:main', 'search:nego', 'recommendations'];
const FRESHNESS_LOAD_KEYS  = ['search:main', 'search:nego', 'search:other', 'recommendations'];

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
      ek: str(r.ek, 80), newIds: num(r.newIds),
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
      endpointFromRecord(rec);
    } catch (e) {
      logger.error('freshnessProbe', 'record failed — the board is unaffected', { error: e });
    }
  }

  // ══ EXT-D11.1 — PER-ENDPOINT CENSUS, NEW IDS, AND THE TWO WARNINGS ═══════════════════════
  var CFG = Object.assign({}, FRESHNESS_CFG_DEFAULT);
  var _eps = {};
  var _snapTimer = null, _lastSnapAt = 0;

  function ep(ek) {
    if (!_eps[ek]) {
      _eps[ek] = { ek: ek, times: [], lastSeen: null, lastSt: null, perMin: {}, newHist: [], lastNewAt: null,
                   lastNewIds: null, lastAge: null, lastRows: null, silent: false, noNew: false, warnings: 0 };
    }
    return _eps[ek];
  }

  function warnOnce(kind, s, details) {
    s.warnings++;
    var sig = kind + '|' + s.ek;
    var now = Date.now();
    if (_lastWarn[sig] && now - _lastWarn[sig] <= FRESHNESS_WARN_EVERY_MS) return;
    _lastWarn[sig] = now;
    logger.notice('freshnessProbe', '⚠ FRESHNESS WARNING — ' + kind + ': ' + s.ek, details);
  }

  function medianGap(s) {
    var t = s.times.slice(-11), gaps = [];
    for (var i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
    var m = median(gaps);
    return Math.max(CFG.silentMinGapMs, m === null ? CFG.silentMinGapMs : m);
  }

  function census(ev) {
    try {
      if (!ev || typeof ev.ek !== 'string' || typeof ev.t !== 'number') return;
      var s = ep(ev.ek.slice(0, 80));
      var st = (typeof ev.st === 'number') ? ev.st : null;
      s.times.push(ev.t);
      while (s.times.length > 200 || (s.times.length && ev.t - s.times[0] > CFG.keepMs)) s.times.shift();
      s.lastSeen = ev.t;
      s.lastSt = st;
      var m = Math.floor(ev.t / 60000);
      var b = s.perMin[m] || (s.perMin[m] = { n: 0, st: {} });
      b.n++;
      b.st[st] = (b.st[st] || 0) + 1;
      Object.keys(s.perMin).forEach(function (k) { if (m - Number(k) >= 10) delete s.perMin[k]; });
      if (s.silent) {
        s.silent = false;
        logger.notice('freshnessProbe', 'endpoint back after silence: ' + s.ek, { lastSeen: new Date(ev.t).toISOString() });
      }
      scheduleSnapshot();
    } catch (e) {
      logger.error('freshnessProbe', 'census failed', { error: e });
    }
  }

  function endpointFromRecord(rec) {
    try {
      if (!rec.ek || FRESHNESS_LOAD_KEYS.indexOf(rec.ek) === -1) return;
      var s = ep(rec.ek);
      var t = Date.parse(rec.t) || Date.now();
      if (typeof rec.newestAgeMin === 'number') s.lastAge = rec.newestAgeMin;
      if (typeof rec.rows === 'number') s.lastRows = rec.rows;
      if (typeof rec.newIds !== 'number') { scheduleSnapshot(); return; }
      s.lastNewIds = rec.newIds;
      s.newHist.push({ t: t, n: rec.newIds });
      while (s.newHist.length > 50) s.newHist.shift();
      if (rec.newIds > 0) { s.lastNewAt = t; s.noNew = false; }
      evalNoNew(s, t);
      scheduleSnapshot();
    } catch (e) {
      logger.error('freshnessProbe', 'endpoint update failed', { error: e });
    }
  }

  function evalNoNew(s, now) {
    if (s.noNew || s.lastNewAt === null) return;
    var sinceNew = now - s.lastNewAt;
    if (sinceNew < CFG.noNewMinMs || sinceNew > CFG.normalWindowMs) return;
    var last = s.newHist.slice(-CFG.noNewStreak);
    if (last.length < CFG.noNewStreak) return;
    for (var i = 0; i < last.length; i++) if (last[i].n !== 0) return;
    s.noNew = true;
    warnOnce('no new loads', s, { responsesWithZeroNew: last.length, minutesSinceLastNew: Math.round(sinceNew / 6000) / 10,
                                  newestAgeMin: s.lastAge, rows: s.lastRows });
  }

  function boardAlive(now, except) {
    for (var i = 0; i < FRESHNESS_BOARD_KEYS.length; i++) {
      var k = FRESHNESS_BOARD_KEYS[i];
      if (k === except || !_eps[k] || _eps[k].times.length < 2) continue;
      if (now - _eps[k].lastSeen <= CFG.aliveFactor * medianGap(_eps[k])) return true;
    }
    return false;
  }

  function evalSilent(now) {
    for (var i = 0; i < FRESHNESS_BOARD_KEYS.length; i++) {
      var s = _eps[FRESHNESS_BOARD_KEYS[i]];
      if (!s || s.silent || s.times.length < CFG.silentMinCalls) continue;
      var gap = medianGap(s);
      if (now - s.lastSeen > CFG.silentFactor * gap && boardAlive(now, s.ek)) {
        s.silent = true;
        warnOnce('endpoint silent', s, { lastSeen: new Date(s.lastSeen).toISOString(),
                                         silentForS: Math.round((now - s.lastSeen) / 1000), usualGapS: Math.round(gap / 1000) });
        scheduleSnapshot();
      }
    }
  }

  function snapshotRows(now) {
    return Object.keys(_eps).sort().map(function (k) {
      var s = _eps[k];
      var in5 = s.times.filter(function (t) { return now - t <= 5 * 60000; }).length;
      var perMin = Object.keys(s.perMin).sort().map(function (m) {
        return { m: new Date(Number(m) * 60000).toISOString().slice(11, 16), n: s.perMin[m].n, st: s.perMin[m].st };
      });
      return {
        ek: s.ek, lastSeen: s.lastSeen ? new Date(s.lastSeen).toISOString() : null, lastSt: s.lastSt,
        callsPerMin: Math.round((in5 / 5) * 10) / 10, usualGapS: s.times.length >= 2 ? Math.round(medianGap(s) / 1000) : null,
        newestAgeMin: s.lastAge, newIdsLast: s.lastNewIds, rowsLast: s.lastRows,
        silent: s.silent, noNew: s.noNew, warnings: s.warnings, perMin: perMin
      };
    });
  }

  function writeSnapshot() {
    try {
      _lastSnapAt = Date.now();
      var o = {};
      o[FRESHNESS_ENDPOINTS_KEY] = { updatedAt: new Date(_lastSnapAt).toISOString(), rows: snapshotRows(_lastSnapAt) };
      chrome.storage.local.set(o);
    } catch (e) {
      logger.error('freshnessProbe', 'snapshot failed', { error: e });
    }
  }
  function scheduleSnapshot() {
    if (_snapTimer !== null) return;
    var wait = Math.max(0, CFG.snapshotEveryMs - (Date.now() - _lastSnapAt));
    _snapTimer = setTimeout(function () { _snapTimer = null; writeSnapshot(); }, wait);
  }

  function tick() {
    try { evalSilent(Date.now()); } catch (e) { logger.error('freshnessProbe', 'tick failed', { error: e }); }
  }

  function readEndpoints(cb) {
    try {
      chrome.storage.local.get(FRESHNESS_ENDPOINTS_KEY, function (data) { cb((data && data[FRESHNESS_ENDPOINTS_KEY]) || null); });
    } catch (e) { cb(null); }
  }

  // TEST ONLY — the headless suite shortens the thresholds so minutes can be proved in seconds.
  // Product code never calls this.
  var _tickTimer = null;
  function configure(over) {
    CFG = Object.assign({}, FRESHNESS_CFG_DEFAULT, over || {});
    if (_tickTimer !== null) { clearInterval(_tickTimer); _tickTimer = setInterval(tick, CFG.tickMs); }
    return CFG;
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
        if (ev.source !== window || !ev.data) return;
        if (ev.data.__extRelayFreshness === true) record(ev.data.rec);
        else if (ev.data.__extRelayCensus === true) census(ev.data.ev);    // EXT-D11.1
      });
      _tickTimer = setInterval(tick, CFG.tickMs);                          // silence needs a clock
    } catch (e) {
      logger.error('freshnessProbe', 'could not listen — nothing will be recorded', { error: e });
    }
  }
  if (typeof location !== 'undefined' && location.protocol !== 'chrome-extension:') listen();

  return { record: record, read: read, clear: clear, summarise: summarise, _clean: clean,
           readEndpoints: readEndpoints, configure: configure, _tick: tick,
           _endpoints: function () { return snapshotRows(Date.now()); } };

})();
