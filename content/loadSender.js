// Load sender — ships the work opportunities this board shows to the Tenlane load network.
//
// Added 2026-09-08. See tenlane-network/docs/DECISIONS.md D4 and D7.
//
// ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────
// networkObserver.js (MAIN world) emits CURATED records — projectRecord()'s explicit allow-list,
// never the raw body — on the existing __extRelayCityCoords message. This file buffers them,
// narrows them further still, deduplicates by work-opportunity id, and flushes on a timer through
// the dispatcher's EXISTING Supabase session by calling the ingest_loads RPC.
//
// 🔑 TWO LISTS. What the local panel sees and what the network receives are NOT the same set —
// see transmittedStop() below and DECISIONS.md D10. The panel is not a disclosure; the network is.
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

  // ── TWO LISTS, NOT ONE — the transmitted subset ──────────────────────────────────────────
  //
  // 🔑 THE LOCAL PANEL IS NOT A DISCLOSURE; THE NETWORK IS. projectRecord() keeps the panel's
  // full field set, because those values never leave the machine. What goes to `public.loads` is
  // narrower, because that table is readable by EVERY authenticated user — one carrier's data is
  // visible to all of them.
  //
  // NOT TRANSMITTED, by decision (DECISIONS.md D10): line1, label, zip, loadingType,
  // unloadingType. Facility street addresses and postal codes are not read in the load table and
  // are not used by the PAT form.
  //
  // ⚠ AND NOTHING FROM THE RAW RECORD CAN LEAK HERE EVEN BY MISTAKE. The input is already the
  // curated projection — contacts, instructions, purchase orders, shipper references, carrier
  // accounts and cost items were never in it and never crossed the world boundary.
  function transmittedStop(st) {
    if (!st) return null;
    return {
      seq:      (typeof st.seq === 'number') ? st.seq : null,
      stopType: st.stopType || null,
      city:     st.city || null,
      // Normalised to a two-letter code with the PAT form's own mapper — never a second table.
      // Measured across 524 stops, Amazon returns three formats ("KY", "Kentucky", "KENTUCKY"),
      // so an un-normalised value reaches the site as whatever Amazon felt like sending.
      // patStateCode returns null for anything unrecognised; the RAW value is kept in that case
      // so a new spelling shows up as itself rather than silently vanishing.
      state:    (typeof patStateCode === 'function')
                  ? (patStateCode(st.state) || st.state || null)
                  : (st.state || null),
      stopCode: st.stopCode || null,
      lat:      (typeof st.lat === 'number') ? st.lat : null,
      lng:      (typeof st.lng === 'number') ? st.lng : null,
      tz:       st.tz || null,
      checkIn:  st.checkIn || null,
      checkOut: st.checkOut || null
    };
  }

  // ── Turn one CURATED record into an ingest_loads element ─────────────────────────────────
  function toRow(rec, endpoint) {
    logger.log('loadSender', 'toRow called');
    try {
      if (!rec || !rec.id) return null;

      var loads = [];
      var srcLoads = rec.loads || [];
      for (var i = 0; i < srcLoads.length; i++) {
        var l = srcLoads[i] || {};
        var stops = [];
        var srcStops = l.stops || [];
        for (var j = 0; j < srcStops.length; j++) {
          var s = transmittedStop(srcStops[j]);
          if (s) stops.push(s);
        }
        loads.push({
          distance:      (typeof l.distance === 'number') ? l.distance : null,
          distanceUnit:  l.distanceUnit || null,
          loadType:      l.loadType || null,
          equipmentType: l.equipmentType || null,
          stops:         stops
        });
      }

      var payload = {
        id:                  String(rec.id),
        transitOperatorType: rec.transitOperatorType || null,
        stopCount:           (typeof rec.stopCount === 'number') ? rec.stopCount : null,
        totalDistance:       (typeof rec.totalDistance === 'number') ? rec.totalDistance : null,
        distanceUnit:        rec.distanceUnit || null,
        payout:              (typeof rec.payout === 'number') ? rec.payout : null,
        payoutUnit:          rec.payoutUnit || null,
        deadhead:            (typeof rec.deadhead === 'number') ? rec.deadhead : null,
        deadheadUnit:        rec.deadheadUnit || null,

        // 🔑 A DERIVED BOOLEAN, NOT THE RAW trailerDetails OBJECT. true = Amazon PROVIDED the
        // trailer, false = the carrier is REQUIRED to bring one, null = unknown.
        //
        // ⚠ assetId, assetSource, assetType, trailerLoadingStatus, dropTrailerETA and the owner
        // CODE itself are all withheld. The owner code names a specific carrier; a dispatcher
        // needs only whether a trailer comes with the load. DECISIONS.md D10-AMENDED.
        trailerProvided:     (typeof rec.trailerProvided === 'boolean') ? rec.trailerProvided : null,

        loads:               loads
      };

      // The typed columns come from the FIRST stop of the FIRST load — the pickup.
      var first = (loads[0] && loads[0].stops && loads[0].stops[0]) || null;

      return {
        amazon_wo_id: String(rec.id),
        payload: payload,
        pickup_lat: first ? first.lat : null,
        pickup_lng: first ? first.lng : null,
        pickup_stop_code: first ? first.stopCode : null,
        // Provided / Required as a typed column, so the site can sort and filter on it without
        // reaching into jsonb. `pickup_postal_code` used to sit here and was dropped by
        // 0003_trailer_provided.sql — it had been permanently null since `zip` was excluded.
        trailer_provided: payload.trailerProvided,
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
  // 🔑 READS THE EXISTING MESSAGE. The sender has no message of its own — it takes `records` off
  // the __extRelayCityCoords message the city filter already receives. So adding the load network
  // costs the MAIN world NOTHING in new data crossing the boundary, which is exactly what the
  // restored raw-body contract requires.
  function onMessage(ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data;
      if (!d || d.__extRelayCityCoords !== true) return;
      accept(d.records, d.endpoint);
    } catch (e) {
      logger.error('loadSender', 'onMessage failed', { error: e });
    }
  }

  // ── START / STOP ─────────────────────────────────────────────────────────────────────────
  //
  // 🔴 FIXED 2026-09-12, AFTER A LIVE MEASUREMENT. start() used to be called ONCE, at file load
  // (document_idle). On a live board the probe measured 13 messages carrying 200 records while
  // the sender's `seen` stayed at 0 — because `isLoadBoardPage()` was FALSE at document_idle
  // (the SPA had not routed yet), start() returned early, and NOTHING ever called it again.
  // Calling start() by hand then produced seen 300 / sent 100 / inserted 55 / updated 45 on the
  // same page, which is what proved the pipeline itself was fine and the startup path was not.
  //
  // 🔑 IT IS NOW WIRED LIKE initCityAssign(): called from content.js's activateExtensionUI(),
  // which runs when the auth gate and the page check have BOTH passed, and re-runs on SPA
  // navigation and after a re-login. Torn down by deactivateExtensionUI().
  //
  // ⚠ THE isLoadBoardPage() GUARD STAYS. The bug was never that the guard was wrong — it was
  // that the guard was evaluated once, at the wrong moment. Removing it would let the sender
  // run off the board.
  var _listening = false;
  var _onVisibility = null;

  function start() {
    logger.log('loadSender', 'start called');
    try {
      // ⚠ IDEMPOTENT, AND THAT IS LOAD-BEARING. activateExtensionUI() can be entered more than
      // once — SPA navigation, a re-login, a manual re-activation. Without this guard each call
      // would add ANOTHER message listener and ANOTHER flush interval, so every board response
      // would be accepted N times and seen_count would inflate on the server.
      if (_listening) {
        logger.log('loadSender', 'start: already listening — ignoring');
        return;
      }
      if (typeof isLoadBoardPage === 'function' && !isLoadBoardPage()) return;
      if (typeof LOAD_SENDER_ENABLED !== 'undefined' && LOAD_SENDER_ENABLED === false) return;

      window.addEventListener('message', onMessage);

      var every = (typeof LOAD_SENDER_FLUSH_MS === 'number') ? LOAD_SENDER_FLUSH_MS : 15000;
      _timer = setInterval(function () { flush('timer'); }, every);

      // A tab being hidden or closed is the most likely moment to lose a buffer. Best effort:
      // the flush is async and may not finish, which is acceptable — the same load will be seen
      // again on the next board tick.
      //
      // ⚠ Held in a variable so stop() can actually remove it. As an anonymous function it was
      // unremovable, and every activate/deactivate cycle left another copy on the document.
      _onVisibility = function () {
        if (document.visibilityState === 'hidden') flush('hidden');
      };
      document.addEventListener('visibilitychange', _onVisibility);

      _listening = true;
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
      if (_onVisibility) {
        document.removeEventListener('visibilitychange', _onVisibility);
        _onVisibility = null;
      }
      // Dropped on teardown: deactivation means logout or leaving the board, and buffered loads
      // cannot be sent without a session. They will be seen again on the next board tick.
      _buffer.clear();
      _listening = false;
    } catch (e) {
      logger.error('loadSender', 'stop failed', { error: e });
    }
  }

  function report() {
    return {
      enabledConstant: (typeof LOAD_SENDER_ENABLED !== 'undefined') ? LOAD_SENDER_ENABLED : null,
      // 🔑 THE FIELD THAT WOULD HAVE CAUGHT THE STARTUP BUG IMMEDIATELY. `false` here with a
      // board on screen means start() never registered the listener — exactly the state the
      // live probe had to be written to discover.
      listening: _listening,
      buffered: _buffer.size,
      stats: JSON.parse(JSON.stringify(_stats))
    };
  }

  return { start: start, stop: stop, flush: flush, report: report, isEnabled: isEnabled };
})();

// ⚠ DELIBERATELY NOT STARTED HERE. This file is injected at document_idle, when the SPA has
// often not routed yet and isLoadBoardPage() is still false — start() returned early and nothing
// ever called it again, so the sender never saw a single record on a live board. It is now
// started by content.js's activateExtensionUI(), which runs only once the auth gate AND the page
// check have passed, and re-runs on navigation. See the note above start().

// Diagnostics. Read-only except flushNow(), which only does early what the timer would do anyway.
try {
  window.__EXT_DEBUG = window.__EXT_DEBUG || {};
  window.__EXT_DEBUG.loadSenderReport = function () { return loadSender.report(); };
  window.__EXT_DEBUG.loadSenderFlush = function () { return loadSender.flush('manual'); };
} catch (e) { /* diagnostics are optional; never let them break startup */ }
