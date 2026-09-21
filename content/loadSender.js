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

  // Counters for __EXT_DEBUG.loadSenderReport() AND for the popup, which renders them from
  // chrome.storage.local. No longer diagnostics-only.
  /*
   * 🔑 EVERY WAY A RECORD CAN VANISH HAS ITS OWN COUNTER. (docs/DECISIONS.md EXT-D2.)
   *
   * ⚠ `seen` NOW COUNTS EVERY RECORD HANDED TO accept(), BEFORE ANY SKIP. It used to be
   * incremented only after toRow() succeeded, so a record dropped for a missing id was
   * counted nowhere at all — not in seen, not in sent, not in failures.
   *
   * The arithmetic that must hold:
   *   seen === accepted + dropped.noId + dropped.threw
   *   accepted === sent + buffered + dropped.evicted + dropped.discardedDisabled
   */
  var _stats = {
    seen: 0,          // every record accept() was handed, before any filter
    accepted: 0,      // records that became a row and entered the buffer
    buffered: 0,      // in the buffer right now (runtime only, not cumulative)
    sent: 0, inserted: 0, updated: 0, failures: 0, lastError: null,
    dropped: {
      noId: 0,               // toRow() — record has no `id`
      discardedTeardown: 0,  // stop() — deactivation clears the buffer
      acceptThrew: 0,        // accept() threw mid-loop; the rest of that batch never ran
      threw: 0,              // toRow() catch — the record threw while being converted
      evicted: 0,            // accept() — buffer over LOAD_SENDER_MAX_BUFFER, oldest evicted
      discardedDisabled: 0,  // flush() — the toggle went off, buffer cleared
      notArrayEvents: 0      // accept() was handed a non-array; RECORD COUNT UNKNOWABLE
    }
  };

  /*
   * ⚠ PERSISTED, BECAUSE A COUNTER THAT DIES WITH THE TAB CANNOT MEASURE LOSS. Written
   * through chrome.storage.local — the same mechanism the toggle and the session already use.
   * No new storage layer.
   *
   * ⚠ DEBOUNCED. accept() runs per record; writing storage on each one would be hundreds of
   * writes a minute. The flush path also saves explicitly, so a number is never more than one
   * flush interval stale.
   */
  var _saveTimer = null;
  function saveStats() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      try {
        var o = {};
        o[LOAD_SENDER_STATS_KEY] = _stats;
        chrome.storage.local.set(o);
      } catch (e) {
        logger.error('loadSender', 'saveStats failed', { error: e });
      }
    }, 2000);
  }

  // Merge whatever was persisted, so the counters are cumulative across reloads.
  async function loadStats() {
    try {
      var data = await chrome.storage.local.get(LOAD_SENDER_STATS_KEY);
      var s = data && data[LOAD_SENDER_STATS_KEY];
      if (!s || typeof s !== 'object') return;
      var d = s.dropped || {};
      _stats.seen      = s.seen      || 0;
      _stats.accepted  = s.accepted  || 0;
      _stats.sent      = s.sent      || 0;
      _stats.inserted  = s.inserted  || 0;
      _stats.updated   = s.updated   || 0;
      _stats.failures  = s.failures  || 0;
      _stats.lastError = s.lastError || null;
      _stats.dropped.noId              = d.noId              || 0;
      _stats.dropped.threw             = d.threw             || 0;
      _stats.dropped.evicted           = d.evicted           || 0;
      _stats.dropped.discardedDisabled = d.discardedDisabled || 0;
      _stats.dropped.notArrayEvents    = d.notArrayEvents    || 0;
      _stats.dropped.discardedTeardown = d.discardedTeardown || 0;
      _stats.dropped.acceptThrew       = d.acceptThrew       || 0;
      // ⚠ NOT restored: `buffered` describes this tab's live Map, not history.
      _stats.buffered = _buffer.size;
    } catch (e) {
      logger.error('loadSender', 'loadStats failed — counters start at zero', { error: e });
    }
  }

  function resetStats() {
    _stats.seen = 0; _stats.accepted = 0; _stats.sent = 0; _stats.inserted = 0;
    _stats.updated = 0; _stats.failures = 0; _stats.lastError = null;
    _stats.dropped = { noId: 0, threw: 0, evicted: 0, discardedDisabled: 0,
                       notArrayEvents: 0, discardedTeardown: 0, acceptThrew: 0 };
    _stats.buffered = _buffer.size;
    try {
      var o = {};
      o[LOAD_SENDER_STATS_KEY] = _stats;
      chrome.storage.local.set(o);
    } catch (e) {
      logger.error('loadSender', 'resetStats failed to persist', { error: e });
    }
    return report();
  }

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
  // NOT TRANSMITTED, by decision (DECISIONS.md D10): line1, label, zip. Facility street addresses
  // and postal codes are not read in the load table and are not used by the PAT form.
  //
  // ✅ loadingType / unloadingType ARE now transmitted (D10-AMENDED-2, 2026-09-12). They were
  // excluded when nothing consumed them; the board's Load Type column consumes them now. They
  // describe the LOAD, not the carrier — no facility identity, no third party.
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
      checkOut: st.checkOut || null,

      // 🔑 BOTH, because the board's Load Type is read from whichever applies to the stop. A stop
      // is either loaded or unloaded, never both in any capture — `formatEquipment()` in
      // inlinePanel.js takes `loadingType || unloadingType` for exactly that reason, and this
      // reuses that rule rather than writing a second one.
      //
      // Measured values across all captures: loadingType ∈ {null, PRELOADED, LIVE},
      // unloadingType ∈ {null, DROP, LIVE}. Nothing else has ever been seen.
      loadingType:   st.loadingType || null,
      unloadingType: st.unloadingType || null
    };
  }

  // ── LOAD TYPE: TWO STOPS, NOT ONE (2026-09-13, DECISIONS.md D20-REVISED) ─────────────────
  //
  // The board's Load Type combines the START of the tour with its END:
  //
  //     first stop's loadingType   +   last stop's unloadingType
  //
  // Same value twice collapses to one word; different values join with a slash. That is what
  // produces "Live/Drop" — a load LIVE-loaded at the pickup and DROPped at the delivery.
  //
  // 🔑 MEASURED, 326 work opportunities across all 10 captures. Every combination that occurs:
  //
  //     PRELOADED × DROP   239      LIVE × LIVE   64      DROP × DROP   14
  //     PRELOADED × LIVE     7      LIVE × DROP    2
  //
  // ⚠ AN EARLIER VERSION READ ONLY THE FIRST PICKUP STOP, with a `loadingType || unloadingType`
  // fallback. That is why a combined label could never appear: it never looked at the last stop.
  // The two readings differ on 248 of 326 records, so this is not a cosmetic change.
  //
  // ⚠ NOTHING IS INVENTED FOR A COMBINATION THE DATA DOES NOT SHOW. Only the five above exist;
  // an unseen enum simply passes through as itself, and a missing half yields the other half
  // alone rather than a guessed pairing.
  //
  // ⚠ THE WHOLE TOUR, not loads[0]. Restricting to the first leg gives a different answer
  // (PRELOADED × LIVE 31 instead of 7), because a multi-leg tour ends on a later leg.
  function loadTypeOf(loads) {
    try {
      var stops = [];
      for (var i = 0; i < loads.length; i++) {
        var st = (loads[i] && loads[i].stops) || [];
        for (var j = 0; j < st.length; j++) stops.push(st[j]);
      }
      if (!stops.length) return null;

      var a = stops[0] && stops[0].loadingType;
      var b = stops[stops.length - 1] && stops[stops.length - 1].unloadingType;
      if (!a && !b) return null;
      if (!a) return String(b);
      if (!b) return String(a);
      return (a === b) ? String(a) : (String(a) + '/' + String(b));
    } catch (e) {
      logger.error('loadSender', 'loadTypeOf failed — load type left unknown', { error: e });
      return null;
    }
  }

  // ── Turn one CURATED record into an ingest_loads element ─────────────────────────────────
  function toRow(rec, endpoint) {
    logger.log('loadSender', 'toRow called');
    try {
      // ⚠ COUNTED, NOT CHANGED. The skip itself is exactly as it was — a record with no id
      // cannot be keyed for the upsert. It is simply no longer invisible.
      if (!rec || !rec.id) { _stats.dropped.noId++; return null; }

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
        load_type: loadTypeOf(loads),
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
      _stats.dropped.threw++;
      logger.error('loadSender', 'toRow failed — record skipped', { error: e });
      return null;
    }
  }

  // ── Buffer ───────────────────────────────────────────────────────────────────────────────
  var _acceptIndex = 0;
  function accept(records, endpoint) {
    _acceptIndex = 0;
    logger.log('loadSender', 'accept called', { count: records ? records.length : 0 });
    try {
      if (!Array.isArray(records)) {
        // ⚠ THE RECORD COUNT HERE IS UNKNOWABLE — there is no array to measure. Counted as an
        // EVENT, not as a number of loads, so the arithmetic above is never quietly wrong.
        _stats.dropped.notArrayEvents++;
        saveStats();
        return;
      }
      for (var i = 0; i < records.length; i++) {
        _acceptIndex = i;
        // 🔑 BEFORE ANY FILTER. This is the whole point: every record the sender is handed is
        // counted here, whether or not it survives toRow().
        _stats.seen++;
        var row = toRow(records[i], endpoint);
        if (!row) continue;
        _stats.accepted++;
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
        // 🔴 THE ONE PLACE A LOAD IS LOST OUTRIGHT. The limit is unchanged; it is now visible.
        _stats.dropped.evicted++;
      }
      _stats.buffered = _buffer.size;
      saveStats();
    } catch (e) {
      // ⚠ FOUND WHILE INSTRUMENTING. If this throws at record i, records i+1..n never ran —
      // they were never seen, never buffered and never counted anywhere. `_acceptIndex` is the
      // loop counter, so the remainder is knowable and is recorded rather than lost silently.
      if (Array.isArray(records)) {
        _stats.dropped.acceptThrew += Math.max(0, records.length - _acceptIndex);
      }
      saveStats();
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
        // A DROP, and it was uncounted. Deliberate behaviour — "off" must mean nothing leaves —
        // but the loads still vanish, so they are counted like any other loss.
        _stats.dropped.discardedDisabled += _buffer.size;
        _buffer.clear();
        _stats.buffered = 0;
        saveStats();
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
        saveStats();
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
      saveStats();

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

      // ⚠ CUMULATIVE ACROSS RELOADS. Without this the counters restart at zero on every SPA
      // navigation and a whole shift's losses are invisible again. Async on purpose — the
      // listener below must be attached now, not after a storage round-trip.
      loadStats();

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
      // ⚠ FOUND WHILE INSTRUMENTING, AND UNCOUNTED UNTIL NOW. The behaviour is unchanged and
      // deliberate; what changes is that the loads no longer vanish without a number.
      _stats.dropped.discardedTeardown += _buffer.size;
      _buffer.clear();
      _stats.buffered = 0;
      saveStats();
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

  return { start: start, stop: stop, flush: flush, report: report, isEnabled: isEnabled,
           resetStats: resetStats, loadStats: loadStats };
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
  window.__EXT_DEBUG.loadSenderResetStats = function () { return loadSender.resetStats(); };
} catch (e) { /* diagnostics are optional; never let them break startup */ }
