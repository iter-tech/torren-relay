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
//
// ── EXT-D8 (2026-09-24): WHICH TRIGGER, AND WAS IT ONLY EARLY? ───────────────────────────────────
//
// Live result of EXT-D6 over 25 sheets: 18 match, 1 differ, 6 sheet-unreadable (24 %). Ihor's
// observation is that the unreadable ones are the AUTO-OPENED loads, and that a load he clicks
// himself reads fine. Two things were therefore missing from an event, and both are added here:
//
//   `trig`  WHICH PATH OPENED THE SHEET — 'auto-open' / 'manual-click' / 'other'. Decided by the
//           CALLER from `event.isTrusted`, the browser's own bit, corroborated by the auto-open
//           dispatch's in-flight flag. ⚠ NEVER INFERRED FROM TIMING: inferring the trigger from
//           how long the read took, and then using it to explain the timing, would be circular.
//
//   `re1` / `re3`  THE SAME READ AGAIN AT +1 s AND +3 s. If the first read fails only because it
//           happens too early, a later read of the very same sheet succeeds and says so. If the
//           sheet is genuinely unreadable, all three fail and the hypothesis is dead.
//
// ⚠ STILL PASSIVE, AND STILL DECIDES NOTHING. The re-reads call the same read-only
// `payoutGateFor()` through a callback the caller supplies; no verdict reaches the booking path,
// and FAST_BOOK_ENABLED is still false.
//
// ⚠ NO DOM HERE EITHER — that is why the re-read is a CALLBACK rather than a selector. This file
// still loads unchanged in the popup, which has no Amazon sheet to read.
//
// ⚠ A RE-READ THAT WOULD READ ANOTHER LOAD'S SHEET IS 'skipped', NOT FILED. Three seconds is long
// enough for the dispatcher to open a different load; the caller's callback re-checks identity and
// returns null, and null is recorded as `skipped` rather than as a reading of this load.

/** chrome.storage.local key holding the ring buffer of probe events. */
const PRICE_PROBE_KEY = 'priceProbeEvents';

/**
 * When the sheet is read again, in ms after the first read. Ihor's two checkpoints.
 * ⚠ THESE ARE SETTIMEOUTS IN A CONTENT SCRIPT AND ARE THROTTLED IN A BACKGROUND TAB, exactly as
 * the auto-open settle is (content/detailOpener.js:681). The recorded `ms` is the ACTUAL elapsed
 * time, never the nominal one, so a throttled tab reports what really happened.
 */
const PRICE_PROBE_REREADS = [1000, 3000];

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

  /**
   * ONE READ of the sheet, as numbers. Shared by the first read and by both re-reads, so a
   * re-read can never be classified by a different rule than the read it is compared against.
   */
  function readingFrom(gate) {
    var c = classify(gate);
    var pay = (gate && typeof gate.recordPayout === 'number') ? gate.recordPayout : null;
    var amounts = (gate && gate.sheetAmounts) || [];
    var near = nearest(amounts, pay);
    // ⚠ SIGNED, sheet MINUS record: positive means Amazon is showing MORE than we recorded. The
    // direction is the point — "the price moved up" and "the price moved down" are different risks.
    var diff = (pay !== null && near !== null) ? Math.round((near - pay) * 100) / 100 : null;
    return { rec: pay, sheet: near, n: amounts.length, result: c.result, reason: c.reason, diff: diff };
  }

  /**
   * Did this read actually get the money off the sheet? `match` and `differ` both did — the two
   * numbers were read and compared, which is the question "is the sheet readable?" asks. A
   * `differ` is a READABLE sheet that disagrees, and counting it as unreadable would hide the one
   * case Fast Book must block on.
   */
  function isReadable(reading) {
    return !!reading && (reading.result === 'match' || reading.result === 'differ');
  }

  /**
   * A monotonic key, so the +1 s / +3 s re-read can find its own event again in the ring buffer.
   * ⚠ NOT THE LOAD ID: the same load can be opened twice and each opening is its own event.
   */
  var _seq = 0;

  /** One event from a gate result. Pure — no storage, no clock beyond `now`. */
  function eventFrom(loadId, gate, now, trigger) {
    var r = readingFrom(gate);
    return {
      t: new Date(now).toISOString(),
      // The first 8 characters, as every other log line in this extension abbreviates a load id.
      id: loadId ? String(loadId).slice(0, 8) : null,
      // ⚠ 'unknown' IS A REAL VALUE, NOT A DEFAULT TO HIDE: every event recorded before EXT-D8
      // carries no trigger, and the summary must show them as unattributed rather than quietly
      // counting them as one of the two paths.
      trig: trigger || 'unknown',
      k: String(now) + '-' + (++_seq),
      rec: r.rec,
      sheet: r.sheet,
      n: r.n,
      result: r.result,
      reason: r.reason,
      diff: r.diff,
      // Filled in by the re-reads. `null` means the read has not happened yet (or never will,
      // because the tab was closed inside the 3 seconds) — which is different from having failed.
      re1: null,
      re3: null
    };
  }

  /**
   * File one event. Fire-and-forget: the caller is on the panel-render path and must never wait
   * for storage, and a failed write must never surface as a broken panel.
   *
   * ⚠ DEDUPED WITHIN 1500 ms PER LOAD. One sheet opening can render our panel more than once (a
   * re-render replaces it), and counting that twice would inflate every percentage below.
   */
  /*
   * ⚠ EVERY WRITE GOES THROUGH ONE CHAIN (EXT-D8). An append and a +3 s patch are two
   * read-modify-write cycles over the same key; overlapping them loses whichever finished first.
   * chrome.storage has no transaction, so the ordering is ours to impose — and with re-reads there
   * are now up to three writes per sheet instead of one.
   */
  var _chain = Promise.resolve();

  function mutate(fn, what) {
    _chain = _chain.then(function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(PRICE_PROBE_KEY, function (data) {
            try {
              var list = (data && Array.isArray(data[PRICE_PROBE_KEY])) ? data[PRICE_PROBE_KEY] : [];
              var next = fn(list);
              if (!next) { resolve(); return; }   // nothing to write — see patch()
              if (next.length > PRICE_PROBE_MAX) next = next.slice(next.length - PRICE_PROBE_MAX);
              var o = {};
              o[PRICE_PROBE_KEY] = next;
              chrome.storage.local.set(o, function () { resolve(); });
            } catch (e) {
              logger.error('priceProbe', 'could not ' + what, { error: e });
              resolve();
            }
          });
        } catch (e) {
          logger.error('priceProbe', 'could not ' + what, { error: e });
          resolve();
        }
      });
    });
    return _chain;
  }

  /**
   * Write one re-read onto the event it belongs to.
   * ⚠ IF THE EVENT IS GONE, NOTHING IS WRITTEN. The ring buffer can have dropped it under a busy
   * board; inventing a new event for a re-read would count the same sheet twice.
   */
  function patch(key, field, reading) {
    mutate(function (list) {
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i] && list[i].k === key) { list[i][field] = reading; return list; }
      }
      logger.log('priceProbe', 'the re-read had no event left to attach to — dropped', { field: field });
      return null;
    }, 'attach the ' + field + ' re-read');
  }

  /**
   * Schedule the +1 s / +3 s re-reads of the SAME sheet.
   *
   * `reread` is the caller's closure — it re-runs `payoutGateFor()` against the live sheet and is
   * expected to return `null` when the sheet is no longer the one this event was opened for. That
   * check belongs to the caller because only the caller can see the DOM.
   */
  function scheduleRereads(ev, reread) {
    if (typeof reread !== 'function') return;
    var firstAt = Date.now();
    for (var i = 0; i < PRICE_PROBE_REREADS.length; i++) {
      (function (nominal, field) {
        setTimeout(function () {
          var ms = Date.now() - firstAt;   // ACTUAL, not nominal — background tabs throttle timers
          var reading;
          try {
            var gate = reread();
            reading = (gate === null || gate === undefined)
              // ⚠ NOT A FAILED READ. The sheet we were measuring is not on screen any more, so
              // there was nothing of THIS load to read; calling that "still unreadable" would
              // invent evidence against the hypothesis.
              ? { result: 'skipped', reason: 'sheet-gone-or-another-load', rec: null, sheet: null, n: 0, diff: null }
              : readingFrom(gate);
          } catch (e) {
            logger.error('priceProbe', 'the re-read threw — filed as unreadable', { error: e });
            reading = { result: 'sheet-unreadable', reason: 'threw', rec: null, sheet: null, n: 0, diff: null };
          }
          reading.ms = ms;
          reading.at = nominal;
          logger.log('priceProbe', 'price-reread', { k: ev.k, at: nominal, ms: ms, result: reading.result });
          patch(ev.k, field, reading);
        }, nominal);
      })(PRICE_PROBE_REREADS[i], i === 0 ? 're1' : 're3');
    }
  }

  var _lastId = null;
  var _lastAt = 0;
  function record(loadId, gate, opts) {
    try {
      var now = Date.now();
      if (loadId && loadId === _lastId && (now - _lastAt) < 1500) {
        logger.log('priceProbe', 'skipped a duplicate probe for the same sheet', { withinMs: now - _lastAt });
        return;
      }
      _lastId = loadId || null;
      _lastAt = now;

      var trigger = (opts && opts.trigger) || 'unknown';
      var ev = eventFrom(loadId, gate, now, trigger);
      logger.log('priceProbe', 'price-read', ev);

      mutate(function (list) { list.push(ev); return list; }, 'append the probe event');

      // ⚠ SCHEDULED EVEN WHEN THE FIRST READ SUCCEEDED. A re-read of a sheet that already matched
      // is what makes "the first read was too early" falsifiable rather than merely plausible: if
      // the early reads failed for some other reason, the later ones fail too.
      scheduleRereads(ev, opts && opts.reread);
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

  /**
   * Every trigger label that can be filed, in the order the popup prints them.
   *
   *   auto-open        an untrusted click WITH our own auto-open dispatch on the stack
   *   manual-click     `event.isTrusted` — a real input device, i.e. the dispatcher
   *   synthetic-other  an untrusted click that was NOT our auto-open. ⚠ KEPT SEPARATE RATHER THAN
   *                    FOLDED INTO 'auto-open': attributing someone else's synthetic click to the
   *                    auto-open path would corrupt the exact comparison this exists to make.
   *   other            a caller that named no trigger (the console helper)
   *   unknown          every event recorded before EXT-D8 — unattributed, not "neither".
   */
  var TRIGGERS = ['auto-open', 'manual-click', 'synthetic-other', 'other', 'unknown'];

  function blankTrigger() {
    return { total: 0, match: 0, differ: 0, 'record-unreadable': 0, 'sheet-unreadable': 0 };
  }

  /**
   * One trigger's sheet-unreadable events, and what the later reads of those same sheets said.
   *
   * ⚠ `at1` AND `at3` ARE CUMULATIVE OVER THE SAME POOL, not stages of a funnel: each says how
   * many of THIS trigger's unreadable sheets were readable at that checkpoint. A sheet readable at
   * both is counted in both, because the question is "had it rendered by then?".
   *
   * ⚠ `pending` IS NOT `never`. A tab closed inside the 3 seconds, or an event recorded before
   * EXT-D8, has no re-read at all — filing that as "never became readable" would manufacture
   * evidence against the very hypothesis this measures.
   */
  function blankRecovery() {
    return { unreadable: 0, at1: 0, at3: 0, never: 0, skipped: 0, pending: 0 };
  }

  /** Events → the summary the popup prints. Pure: give it a list, it gives you numbers. */
  function summarise(list) {
    var evs = Array.isArray(list) ? list : [];
    var out = {
      total: evs.length,
      results: { match: 0, differ: 0, 'record-unreadable': 0, 'sheet-unreadable': 0 },
      pct: { match: 0, differ: 0, 'record-unreadable': 0, 'sheet-unreadable': 0 },
      reasons: {},
      buckets: {},
      triggers: {},
      recovery: { byTrigger: {} },
      first: evs.length ? evs[0].t : null,
      last: evs.length ? evs[evs.length - 1].t : null
    };
    // Every trigger is present with zeros, so "no auto-opens were measured" reads as 0 rather
    // than as a missing row the popup would print as "—".
    for (var t = 0; t < TRIGGERS.length; t++) {
      out.triggers[TRIGGERS[t]] = blankTrigger();
      out.recovery.byTrigger[TRIGGERS[t]] = blankRecovery();
    }
    var allRecovery = blankRecovery();
    for (var b = 0; b < BUCKETS.length; b++) {
      out.buckets[BUCKETS[b].key] = { label: BUCKETS[b].label, higher: 0, lower: 0 };
    }
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i] || {};
      if (out.results[ev.result] === undefined) out.results[ev.result] = 0;
      out.results[ev.result]++;
      if (ev.reason) out.reasons[ev.reason] = (out.reasons[ev.reason] || 0) + 1;

      // ── BY TRIGGER (EXT-D8) ──────────────────────────────────────────────────────────────
      var trig = ev.trig || 'unknown';
      if (!out.triggers[trig]) { out.triggers[trig] = blankTrigger(); out.recovery.byTrigger[trig] = blankRecovery(); }
      out.triggers[trig].total++;
      if (out.triggers[trig][ev.result] === undefined) out.triggers[trig][ev.result] = 0;
      out.triggers[trig][ev.result]++;

      // ── AND, FOR AN UNREADABLE SHEET, WHAT THE LATER READS SAW ───────────────────────────
      if (ev.result === 'sheet-unreadable') {
        var rec = out.recovery.byTrigger[trig];
        rec.unreadable++; allRecovery.unreadable++;
        var r1 = ev.re1, r3 = ev.re3;
        var got1 = isReadable(r1), got3 = isReadable(r3);
        if (got1) { rec.at1++; allRecovery.at1++; }
        if (got3) { rec.at3++; allRecovery.at3++; }
        if (!r1 && !r3) {
          rec.pending++; allRecovery.pending++;
        } else if (!got1 && !got3) {
          // Both reads happened and neither got the money. If either was skipped because the
          // dispatcher moved on, that is not evidence about the sheet at all.
          var skipped = (r1 && r1.result === 'skipped') || (r3 && r3.result === 'skipped');
          if (skipped) { rec.skipped++; allRecovery.skipped++; }
          else         { rec.never++;   allRecovery.never++; }
        }
      }

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
    // The all-triggers totals, kept beside the per-trigger split rather than derived in the popup.
    out.recovery.unreadable = allRecovery.unreadable;
    out.recovery.at1        = allRecovery.at1;
    out.recovery.at3        = allRecovery.at3;
    out.recovery.never      = allRecovery.never;
    out.recovery.skipped    = allRecovery.skipped;
    out.recovery.pending    = allRecovery.pending;
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
    _buckets: BUCKETS,
    _triggers: TRIGGERS,
    _rereads: PRICE_PROBE_REREADS,
    _isReadable: isReadable
  };

})();
