// utils/priceProbe.js
// ── HOW RELIABLE IS THE PRICE READ? MEASURED, NOT ASSUMED (EXT-D6) ──────────────────────────────
//
// Ihor's decision: Fast Book will be ONE CLICK, and it must NOT book when the price cannot be read.
// The payout gate that would enforce that currently ABSTAINS whenever it cannot read one of the two
// numbers (content/inlinePanel.js payoutGateFor) — so before the rule is tightened we need to know
// how often each outcome actually happens on a real board.
//
// 🔑 PASSIVE. THIS RECORDS; IT DECIDES NOTHING. Every time Amazon's sheet opens and our panel binds
// to it, the SAME read the gate performs is run once and its verdict is filed here. No click, no
// booking, no change to the gate's behaviour. Turning the measurement off would not change any
// booking outcome, which is the property that makes it safe to ship while Fast Book is disabled.
//
// 🔑 IT FILES THE GATE'S OWN VERDICT, NOT A SECOND IMPLEMENTATION. `payoutGateFor()` is called by
// the caller and its result handed in whole. A measurement that re-derived the numbers would be
// measuring itself, and would drift the moment the gate changed.
//
// ⚠ NO DOM, NO chrome.tabs, NO MESSAGING — so this same file loads in the content scripts (which
// write) and in the popup (which reads and summarises). That is why the summary lives here rather
// than in popup.js: one definition of the buckets, used by whoever needs them.
//
// ⚠ THE KEY IS DELIBERATELY OUTSIDE STORAGE_KEYS, exactly as `loadSenderStats` is (utils/storage.js
// :58): "Reset to defaults" clears settings, and a measurement is not a setting. Wiping weeks of
// evidence as a side effect of resetting a toggle is not a trade worth making.

/** chrome.storage.local key holding the ring buffer of probe events. */
const PRICE_PROBE_KEY = 'priceProbeEvents';

/**
 * How many events are kept. The newest win; the oldest are dropped.
 * ⚠ 500 × ~110 bytes ≈ 55 KB, well inside chrome.storage.local's 5 MB — and a cap is what keeps a
 * board left open all week from growing this without bound.
 */
const PRICE_PROBE_MAX = 500;

var priceProbe = (function () {

  /**
   * The gate's verdict → one of four RESULTS, in Ihor's words rather than the gate's.
   *
   *   match             both numbers read, and they agree within one cent
   *   differ            both numbers read, and they disagree — the case that must block a booking
   *   record-unreadable we have no captured record for this load, or it carries no payout
   *   sheet-unreadable  nothing money-shaped could be parsed out of Amazon's open sheet
   *
   * ⚠ 'threw' IS FILED AS UNREADABLE, NOT DROPPED. An exception inside the read is exactly the
   * case a "must not book when the price cannot be read" rule has to cover, so it must appear in
   * the numbers rather than vanish from them.
   */
  function classify(gate) {
    if (!gate || typeof gate !== 'object') return { result: 'sheet-unreadable', reason: 'no-gate-result' };
    if (gate.verdict === 'match')    return { result: 'match',  reason: gate.why || 'matched' };
    if (gate.verdict === 'mismatch') return { result: 'differ', reason: gate.why || 'no-amount-matches' };
    if (gate.why === 'no-record' || gate.why === 'record-has-no-payout') {
      return { result: 'record-unreadable', reason: gate.why };
    }
    if (gate.why === 'no-amount-in-sheet') return { result: 'sheet-unreadable', reason: gate.why };
    if (gate.why === 'threw')              return { result: 'sheet-unreadable', reason: 'threw' };
    return { result: 'sheet-unreadable', reason: gate.why || 'unknown' };
  }

  /**
   * The sheet amount to file against the record: the CLOSEST one to it.
   *
   * ⚠ THE SHEET PRINTS SEVERAL AMOUNTS (the payout, and rate-per-mile figures) and the gate asks
   * only whether the record's payout is among them. For a difference to mean anything it has to be
   * measured against the amount that was nearest to matching — filing the first amount in DOM order
   * would report a $2.31 per-mile figure as a "$665 difference" and make every mismatch look alike.
   */
  function nearest(amounts, pay) {
    if (!amounts || !amounts.length || typeof pay !== 'number') return null;
    var best = amounts[0];
    var bestGap = Math.abs(amounts[0] - pay);
    for (var i = 1; i < amounts.length; i++) {
      var gap = Math.abs(amounts[i] - pay);
      if (gap < bestGap) { best = amounts[i]; bestGap = gap; }
    }
    return best;
  }

  /** One event from a gate result. Pure — no storage, no clock beyond `now`. */
  function eventFrom(loadId, gate, now) {
    var c = classify(gate);
    var pay = (gate && typeof gate.recordPayout === 'number') ? gate.recordPayout : null;
    var amounts = (gate && gate.sheetAmounts) || [];
    var near = nearest(amounts, pay);
    // ⚠ SIGNED, sheet MINUS record: positive means Amazon is showing MORE than we recorded. The
    // direction is the point — "the price moved up" and "the price moved down" are different risks.
    var diff = (pay !== null && near !== null) ? Math.round((near - pay) * 100) / 100 : null;
    return {
      t: new Date(now).toISOString(),
      // The first 8 characters, as every other log line in this extension abbreviates a load id.
      id: loadId ? String(loadId).slice(0, 8) : null,
      rec: pay,
      sheet: near,
      n: amounts.length,
      result: c.result,
      reason: c.reason,
      diff: diff
    };
  }

  /**
   * File one event. Fire-and-forget: the caller is on the panel-render path and must never wait
   * for storage, and a failed write must never surface as a broken panel.
   *
   * ⚠ DEDUPED WITHIN 1500 ms PER LOAD. One sheet opening can render our panel more than once (a
   * re-render replaces it), and counting that twice would inflate every percentage below.
   */
  var _lastId = null;
  var _lastAt = 0;
  function record(loadId, gate) {
    try {
      var now = Date.now();
      if (loadId && loadId === _lastId && (now - _lastAt) < 1500) {
        logger.log('priceProbe', 'skipped a duplicate probe for the same sheet', { withinMs: now - _lastAt });
        return;
      }
      _lastId = loadId || null;
      _lastAt = now;

      var ev = eventFrom(loadId, gate, now);
      logger.log('priceProbe', 'price-read', ev);

      chrome.storage.local.get(PRICE_PROBE_KEY, function (data) {
        try {
          var list = (data && Array.isArray(data[PRICE_PROBE_KEY])) ? data[PRICE_PROBE_KEY] : [];
          list.push(ev);
          if (list.length > PRICE_PROBE_MAX) list = list.slice(list.length - PRICE_PROBE_MAX);
          var o = {};
          o[PRICE_PROBE_KEY] = list;
          chrome.storage.local.set(o);
        } catch (e) {
          logger.error('priceProbe', 'could not append the probe event', { error: e });
        }
      });
    } catch (e) {
      logger.error('priceProbe', 'record failed — the panel is unaffected', { error: e });
    }
  }

  /**
   * The buckets Ihor asked for. ⚠ ONE DEFINITION, used by the popup and by anything later.
   * `$0` is |diff| ≤ PAYOUT_TOLERANCE, the same one cent the gate itself calls equal, so the
   * summary can never disagree with the verdict beside it.
   */
  var BUCKETS = [
    { key: 'eq0',    label: '$0',        test: function (d) { return d <= 0.01; } },
    { key: 'to5',    label: 'up to $5',  test: function (d) { return d <= 5; } },
    { key: 'to15',   label: '$5–15',     test: function (d) { return d <= 15; } },
    { key: 'to50',   label: '$15–50',    test: function (d) { return d <= 50; } },
    { key: 'over50', label: 'over $50',  test: function () { return true; } }
  ];

  /** Events → the summary the popup prints. Pure: give it a list, it gives you numbers. */
  function summarise(list) {
    var evs = Array.isArray(list) ? list : [];
    var out = {
      total: evs.length,
      results: { match: 0, differ: 0, 'record-unreadable': 0, 'sheet-unreadable': 0 },
      pct: { match: 0, differ: 0, 'record-unreadable': 0, 'sheet-unreadable': 0 },
      reasons: {},
      buckets: {},
      first: evs.length ? evs[0].t : null,
      last: evs.length ? evs[evs.length - 1].t : null
    };
    for (var b = 0; b < BUCKETS.length; b++) {
      out.buckets[BUCKETS[b].key] = { label: BUCKETS[b].label, higher: 0, lower: 0 };
    }
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i] || {};
      if (out.results[ev.result] === undefined) out.results[ev.result] = 0;
      out.results[ev.result]++;
      if (ev.reason) out.reasons[ev.reason] = (out.reasons[ev.reason] || 0) + 1;
      if (typeof ev.diff !== 'number') continue;
      var mag = Math.abs(ev.diff);
      for (var k = 0; k < BUCKETS.length; k++) {
        if (!BUCKETS[k].test(mag)) continue;
        var slot = out.buckets[BUCKETS[k].key];
        // ⚠ A $0 difference has no direction; it is counted under `higher` purely so the two
        // columns still add up to the total, and the popup prints that row as one number.
        if (ev.diff < 0) slot.lower++; else slot.higher++;
        break;
      }
    }
    var keys = Object.keys(out.results);
    for (var p = 0; p < keys.length; p++) {
      out.pct[keys[p]] = out.total ? Math.round((out.results[keys[p]] / out.total) * 1000) / 10 : 0;
    }
    return out;
  }

  /** Read the raw events. The popup's Copy button and any later export use this. */
  function read(cb) {
    try {
      chrome.storage.local.get(PRICE_PROBE_KEY, function (data) {
        cb((data && Array.isArray(data[PRICE_PROBE_KEY])) ? data[PRICE_PROBE_KEY] : []);
      });
    } catch (e) {
      logger.error('priceProbe', 'read failed', { error: e });
      cb([]);
    }
  }

  /** Empty the log. Only the popup's own button calls this. */
  function clear(cb) {
    try {
      var o = {};
      o[PRICE_PROBE_KEY] = [];
      chrome.storage.local.set(o, function () { if (cb) cb(); });
    } catch (e) {
      logger.error('priceProbe', 'clear failed', { error: e });
      if (cb) cb();
    }
  }

  return {
    record: record,
    read: read,
    clear: clear,
    summarise: summarise,
    // Exposed for the proof harness, which drives the classification without a browser profile.
    _eventFrom: eventFrom,
    _buckets: BUCKETS
  };

})();
