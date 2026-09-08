// Load sender — ships the work opportunities this board shows to the Tenlane load network.
//
// Added 2026-09-08. See tenlane-network/docs/DECISIONS.md D4 and D7.
//
// ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────
// networkObserver.js (MAIN world) emits __extRelayRawLoads with the RAW work opportunities.
// This file buffers them, deduplicates by work-opportunity id, and flushes on a timer through
// the dispatcher's EXISTING Supabase session by calling the ingest_loads RPC.
//
// 🔑 BATCHED, NEVER ONE REQUEST PER LOAD. A board response carries dozens of records; a request
// each would be slow, would burn the session's rate limit, and would turn one bad network moment
// into dozens of failures.
//
// 🔑 EVERY FAILURE IS SILENT TO THE DISPATCHER AND LOGGED. This feature is not what the
// dispatcher opened the board for. A network error, an expired session or a rejected batch must
// cost nothing visible — no banner, no modal, no thrown error that could unwind a caller. The
// board keeps working exactly as it does with the sender switched off.
//
// ⚠ IT DOES NOT TOUCH THE OTP LOGIN FLOW. It only READS the session popup.js already wrote, the
// same way utils/authGate.js does. It never signs in, never signs out, and never clears a
// session — a bad session here just means this flush is skipped.

var loadSender = (function () {

  // id -> row ready for ingest_loads. A Map so insertion order is the eviction order.
  var _buffer = new Map();
  var _timer = null;
  var _client = null;
  var _flushing = false;

  // Counters for __EXT_DEBUG.loadSenderReport(). Diagnostics only; nothing reads them.
  var _stats = { seen: 0, buffered: 0, sent: 0, inserted: 0, updated: 0, failures: 0, lastError: null };

  // ── Is the sender switched on? ───────────────────────────────────────────────────────────
  // TRUE-DEFAULT: an unset key means ON, exactly like AUTO_OPEN. The build-time constant is the
  // outer gate; the storage key is the dispatcher's.
  function isEnabled() {
    logger.log('loadSender', 'isEnabled called');
    return new Promise(function (resolve) {
      try {
        if (typeof LOAD_SENDER_ENABLED !== 'undefined' && LOAD_SENDER_ENABLED === false) {
          resolve(false);
          return;
        }
        chrome.storage.local.get(STORAGE_KEYS.LOAD_SENDER_ENABLED, function (data) {
          if (chrome.runtime.lastError) { resolve(true); return; } // default ON
          resolve(data[STORAGE_KEYS.LOAD_SENDER_ENABLED] !== false);
        });
      } catch (e) {
        logger.error('loadSender', 'isEnabled failed — defaulting to ON', { error: e });
        resolve(true);
      }
    });
  }

  // ── Turn one raw work opportunity into an ingest_loads element ───────────────────────────
  //
  // 🔑 `payload` IS THE WHOLE RAW RECORD, UNSTRIPPED. That is the decision in D7: the website's
  // src/lib/loads.ts and SCHEMA.md both read the raw shape (payout.value,
  // stops[].location.{city,state,stopCode,postalCode}), and the curated projection has none of
  // it. Removing fields here would silently reintroduce the exact mismatch D7 exists to close.
  //
  // The typed columns are lifted from the SAME nested location object SCHEMA.md documents —
  // loads[0].stops[0].location — and are null when absent, which is normal: coordinates were
  // present on 14 of 18 stops in the reference capture, because a city-level stop has none.
  function toRow(item, endpoint) {
    logger.log('loadSender', 'toRow called');
    try {
      if (!item || !item.id) return null;

      var stop = null;
      try {
        stop = item.loads && item.loads[0] && item.loads[0].stops && item.loads[0].stops[0];
      } catch (e) { stop = null; }
      var loc = (stop && stop.location) || null;

      var lat = (loc && typeof loc.latitude === 'number') ? loc.latitude : null;
      var lng = (loc && typeof loc.longitude === 'number') ? loc.longitude : null;

      return {
        amazon_wo_id: String(item.id),
        payload: item,
        pickup_lat: lat,
        pickup_lng: lng,
        pickup_stop_code: (loc && typeof loc.stopCode === 'string' && loc.stopCode) ? loc.stopCode : null,
        pickup_postal_code: (loc && typeof loc.postalCode === 'string' && loc.postalCode) ? loc.postalCode : null,
        // The RPC's CHECK constraint accepts exactly these three. endpointLabel() in
        // networkObserver.js already emits them, but an unexpected value would abort the whole
        // batch on a constraint violation, so it is pinned here rather than trusted.
        source: (endpoint === 'similar' || endpoint === 'recommendations') ? endpoint : 'search'
      };
    } catch (e) {
      logger.error('loadSender', 'toRow failed — record skipped', { error: e });
      return null;
    }
  }

  // ── Buffer ───────────────────────────────────────────────────────────────────────────────
  function accept(records, endpoint) {
    logger.log('loadSender', 'accept called', { count: records ? records.length : 0 });
    try {
      if (!Array.isArray(records)) return;
      for (var i = 0; i < records.length; i++) {
        var row = toRow(records[i], endpoint);
        if (!row) continue;
        _stats.seen++;
        // Re-inserting moves nothing in a Map, so delete first: the newest sighting must be the
        // youngest entry, or the eviction below would drop the freshest data first.
        if (_buffer.has(row.amazon_wo_id)) _buffer.delete(row.amazon_wo_id);
        _buffer.set(row.amazon_wo_id, row);
      }

      // ⚠ BOUNDED. A dispatcher leaves the board open all shift; if flushing is failing the
      // buffer would otherwise grow until the tab dies. Oldest go first.
      var max = (typeof LOAD_SENDER_MAX_BUFFER === 'number') ? LOAD_SENDER_MAX_BUFFER : 500;
      while (_buffer.size > max) {
        var oldest = _buffer.keys().next();
        if (oldest.done) break;
        _buffer.delete(oldest.value);
      }
      _stats.buffered = _buffer.size;
    } catch (e) {
      logger.error('loadSender', 'accept failed', { error: e });
    }
  }

  // ── The session, read the way authGate reads it ──────────────────────────────────────────
  //
  // ⚠ READ-ONLY with respect to the login flow. A refreshed session is written back so the
  // refresh is not wasted, which is exactly what authGate.js already does — but a FAILED refresh
  // never clears anything. Clearing is popup.js's job, deliberately, so N tabs cannot race each
  // other into logging the dispatcher out.
  async function sessionOrNull() {
    logger.log('loadSender', 'sessionOrNull called');
    try {
      if (!_client) {
        if (typeof supabase === 'undefined' ||
            typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
          return null;
        }
        _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
      }

      var data = await chrome.storage.local.get(SUPABASE_SESSION_KEY);
      var stored = data[SUPABASE_SESSION_KEY];
      if (!stored || !stored.refresh_token) return null;

      var res = await _client.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token
      });
      if (res.error || !res.data || !res.data.session) {
        logger.warn('loadSender', 'setSession failed — flush skipped, session NOT cleared', res.error);
        return null;
      }

      // Only write when it actually changed, to avoid a pointless storage write (and a pointless
      // storage.onChanged wake-up in every other tab) on every single flush.
      if (res.data.session.access_token !== stored.access_token) {
        await chrome.storage.local.set({ [SUPABASE_SESSION_KEY]: res.data.session });
      }
      return res.data.session;
    } catch (e) {
      logger.error('loadSender', 'sessionOrNull failed', { error: e });
      return null;
    }
  }

  // ── Flush ────────────────────────────────────────────────────────────────────────────────
  async function flush(reason) {
    logger.log('loadSender', 'flush called', { reason: reason, buffered: _buffer.size });
    // Re-entrancy guard: a slow request must not overlap with the next tick and send the same
    // rows twice. Harmless for correctness — the RPC upserts — but it would inflate seen_count.
    if (_flushing || _buffer.size === 0) return;

    try {
      if (!(await isEnabled())) {
        // Switched off mid-shift: drop what was buffered rather than holding it to send later.
        // "Off" must mean nothing leaves, including anything already collected.
        if (_buffer.size) logger.log('loadSender', 'disabled — buffer discarded', { dropped: _buffer.size });
        _buffer.clear();
        _stats.buffered = 0;
        return;
      }

      var session = await sessionOrNull();
      if (!session) return; // Signed out. Keep the buffer; a later flush may succeed.

      _flushing = true;

      var max = (typeof LOAD_SENDER_MAX_BATCH === 'number') ? LOAD_SENDER_MAX_BATCH : 50;
      var batch = [];
      var keys = [];
      var it = _buffer.keys();
      for (var n = 0; n < max; n++) {
        var k = it.next();
        if (k.done) break;
        keys.push(k.value);
        batch.push(_buffer.get(k.value));
      }
      if (!batch.length) return;

      var res = await _client.rpc('ingest_loads', { p_loads: batch });

      if (res.error) {
        // ⚠ THE BATCH STAYS IN THE BUFFER. Dropping it on a transient failure would lose loads
        // silently; the ceiling in accept() is what stops that becoming unbounded.
        _stats.failures++;
        _stats.lastError = res.error.message || String(res.error);
        logger.warn('loadSender', 'ingest_loads failed — batch retained for retry', {
          message: res.error.message, code: res.error.code, batch: batch.length
        });
        return;
      }

      for (var j = 0; j < keys.length; j++) _buffer.delete(keys[j]);

      var out = res.data || {};
      _stats.sent += batch.length;
      _stats.inserted += (typeof out.inserted === 'number') ? out.inserted : 0;
      _stats.updated += (typeof out.updated === 'number') ? out.updated : 0;
      _stats.buffered = _buffer.size;

      logger.log('loadSender', 'flush ok', {
        sent: batch.length, inserted: out.inserted, updated: out.updated, remaining: _buffer.size
      });
    } catch (e) {
      // 🔑 THE OUTERMOST CATCH. Nothing below this line may reach the board. An exception here
      // is a bug in the sender, and a bug in the sender must not be a broken load board.
      _stats.failures++;
      _stats.lastError = (e && e.message) ? e.message : String(e);
      logger.error('loadSender', 'flush threw — swallowed so the board is unaffected', { error: e });
    } finally {
      _flushing = false;
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────────────────
  function onMessage(ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data;
      if (!d || d.__extRelayRawLoads !== true) return;
      accept(d.records, d.endpoint);
    } catch (e) {
      logger.error('loadSender', 'onMessage failed', { error: e });
    }
  }

  function start() {
    logger.log('loadSender', 'start called');
    try {
      if (typeof isLoadBoardPage === 'function' && !isLoadBoardPage()) return;
      if (typeof LOAD_SENDER_ENABLED !== 'undefined' && LOAD_SENDER_ENABLED === false) return;

      window.addEventListener('message', onMessage);

      var every = (typeof LOAD_SENDER_FLUSH_MS === 'number') ? LOAD_SENDER_FLUSH_MS : 15000;
      _timer = setInterval(function () { flush('timer'); }, every);

      // A tab being hidden or closed is the most likely moment to lose a buffer. Best effort:
      // the flush is async and may not finish, which is acceptable — the same load will be seen
      // again on the next board tick.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush('hidden');
      });

      logger.log('loadSender', 'started', { flushMs: every });
    } catch (e) {
      logger.error('loadSender', 'start failed — sender inactive, board unaffected', { error: e });
    }
  }

  function stop() {
    logger.log('loadSender', 'stop called');
    try {
      if (_timer) { clearInterval(_timer); _timer = null; }
      window.removeEventListener('message', onMessage);
      _buffer.clear();
    } catch (e) {
      logger.error('loadSender', 'stop failed', { error: e });
    }
  }

  function report() {
    return {
      enabledConstant: (typeof LOAD_SENDER_ENABLED !== 'undefined') ? LOAD_SENDER_ENABLED : null,
      buffered: _buffer.size,
      stats: JSON.parse(JSON.stringify(_stats))
    };
  }

  return { start: start, stop: stop, flush: flush, report: report, isEnabled: isEnabled };
})();

loadSender.start();

// Diagnostics. Read-only except flushNow(), which only does early what the timer would do anyway.
try {
  window.__EXT_DEBUG = window.__EXT_DEBUG || {};
  window.__EXT_DEBUG.loadSenderReport = function () { return loadSender.report(); };
  window.__EXT_DEBUG.loadSenderFlush = function () { return loadSender.flush('manual'); };
} catch (e) { /* diagnostics are optional; never let them break startup */ }
