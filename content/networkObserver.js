// Runs in the page's MAIN world (declared with "world":"MAIN" in manifest.json — a
// SEPARATE content_scripts entry from every other file in this extension, which all run
// isolated). This is required specifically to see Amazon's own fetch()/XMLHttpRequest
// calls: the page's own JS uses its own window.fetch reference, invisible to a script
// running in the isolated world (isolated-world scripts get their own separate JS
// globals, even though they share the same DOM).
//
// READ-ONLY OBSERVATION ONLY. This wraps fetch/XHR to WATCH responses — it never
// modifies a request, never delays or blocks one, never invents a new one, and never
// touches any Amazon DOM or click site (SAFETY.md's click-site rules do not apply here;
// there is no .click() anywhere in this file). Only requests whose URL contains the
// confirmed '/api/loadboard/search' path are reported; every other request on the page is
// passed through untouched and unobserved. This exists to detect HTTP 503 / 5xx on that
// endpoint for the cross-tab rate-limit coordinator — see background.js and
// content/content.js.
//
// Communicates back to the isolated-world content script via window.postMessage — the
// standard, documented technique for MAIN<->ISOLATED world messaging (both worlds share
// the same window/DOM object). content/content.js listens for these on the isolated side.
(function () {
  var WATCH_PATH = '/api/loadboard/search';

  // ───────────────────────────────────────────────────────────────────────────────────────
  // DEVELOPMENT SWITCH — response-body capture (2026-07-31). SHIPPED OFF.
  //
  // ⚠ MIRROR of CAPTURE_RESPONSES in utils/constants.js. Duplicated, not imported, because
  // this file is the ONE content script that runs in the page's MAIN world (manifest.json)
  // and so cannot see any isolated-world global — same reason, and same pattern, as
  // background.js duplicating RATE_LIMITER_KEY. THIS copy is the one that gates the body
  // read; flip both or the two halves disagree.
  //
  // WHY IT EXISTS: to prove, on a live board, that reading the body is harmless BEFORE
  // anything depends on it. It captures, summarises to five counters, logs once, and
  // DISCARDS. It stores nothing, caches nothing, renders nothing.
  //
  // WHEN OFF, this file behaves exactly as it did before the flag existed: CAPTURE_PATHS is
  // never consulted, no clone is taken, no body is touched, and every `|| isCaptured` below
  // collapses to the original `isWatched` condition.
  var CAPTURE_RESPONSES = false;

  // ⚠ MIRROR of CITY_ASSIGN_DEBUG in utils/constants.js (2026-08-06). Same duplication, same
  // reason as CAPTURE_RESPONSES above — this world cannot see isolated-world globals.
  //
  // This gate is deliberately HERE rather than only on the receiving side, because it controls
  // whether work-opportunity ids and pickup coordinates cross the postMessage boundary at all.
  // summariseAndDiscard() below is contractually counters-only; emitCityAssignCoords() is the
  // one path allowed to emit identifiers, and only with BOTH this and CAPTURE_RESPONSES on.
  //
  // Subordinate to CAPTURE_RESPONSES: with capture off there is no body to read, so this flag
  // alone does nothing.
  var CITY_ASSIGN_DEBUG = false;

  // ⚠ MIRROR of CITY_FILTER_ENABLED in utils/constants.js (2026-08-13). PRODUCT FLAG, ON by
  // default — unlike the two debug switches above.
  //
  // This is what makes per-city filtering work in a SHIPPED build. The assignment needs the
  // pickup coordinates, so the id + lat/lng emit must run at DEBUG_LEVEL 1 with both debug flags
  // off. Turning this off returns the file to pure rate-limit observation.
  //
  // ⚠ IT DOES NOT ENABLE THE DEBUG PAYLOAD. The raw response body, the id samples, the capture
  // summary, the drop/OK trace and the endpoint recon all remain behind CITY_ASSIGN_DEBUG and
  // CAPTURE_RESPONSES. On this path the ONLY things that cross postMessage are the work-
  // opportunity id and its PICKUP latitude/longitude — see emitCityAssignCoords().
  var CITY_FILTER_ENABLED = true;

  // True when a body must be read at all — for the shipped feature, or for the debug capture.
  function bodyCaptureNeeded() {
    return CITY_FILTER_ENABLED || CAPTURE_RESPONSES;
  }

  // Capture scope is DELIBERATELY SEPARATE from WATCH_PATH and must stay that way.
  // WATCH_PATH drives the rate-limit reporting path (search only) — widening it would start
  // feeding /similar and /recommendations failures into background.js's backoff, which is a
  // behaviour change and is explicitly out of scope. These two lists are independent on purpose.
  //
  // /recommendations/get ADDED 2026-08-13. It was already being SEEN by this observer and
  // discarded, because it was not on this list — and it is the source of the "Recently added"
  // cards. That made the newest loads, the entire point of the extension, the ones reported as
  // "id never seen in any captured response" and therefore left unassigned and unfilterable.
  //
  // Its body has the same shape as /search — confirmed against a real capture: searchAuditId,
  // workOpportunities[].id, and workOpportunities[].loads[0].stops[0].location.latitude /
  // .longitude, with stops[0].stopType === 'PICKUP', so the existing stops[0] rule holds and the
  // extractor needs no special case.
  var CAPTURE_PATHS = [
    '/api/loadboard/search',
    '/api/loadboard/similar',
    '/api/loadboard/recommendations/get'
  ];

  // The label carried on every emitted message and printed in CITY ENDPOINT SHAPE, so the three
  // sources stay distinguishable in the console. Order matters only in that 'search' is the
  // fallback — it is the path every other branch is measured against.
  function endpointLabel(url) {
    if (typeof url !== 'string') return 'search';
    if (url.indexOf('/api/loadboard/recommendations') !== -1) return 'recommendations';
    if (url.indexOf('/api/loadboard/similar') !== -1) return 'similar';
    return 'search';
  }

  // ── DROP TRACING (2026-08-13) ─────────────────────────────────────────────────────────────
  //
  // WHY. On a live board every refresh logs "board search result observed" TWICE for
  // /api/loadboard/search but "response captured (dev switch)" ONCE. Exactly one of the two
  // responses is discarded somewhere between report() and the capture path, and every place it
  // could happen currently swallows silently — three bare catches, an early return, an
  // unhandled responseType, and the isCaptured branch. This makes each of those audible.
  //
  // DIAGNOSTIC ONLY. Nothing here changes what is captured, when, or from which endpoints. Every
  // emitter below is gated on CITY_ASSIGN_DEBUG and is a no-op when it is off.
  //
  // PRIVACY: the PATH ONLY — the query string is stripped because it carries the dispatcher's
  // filter values (cities, radius, equipment). Never a body, never an id, never an address.

  // Per-request sequence number, assigned in the fetch/XHR wrapper before the request goes out.
  // This is what lets the two /search responses of one refresh be told apart and matched
  // observed-to-captured; without it the log lines are indistinguishable.
  var _reqSeq = 0;
  function nextSeq() { return ++_reqSeq; }

  // Strips the query string. Defensive against non-string input rather than assuming.
  function pathOnly(url) {
    try {
      if (typeof url !== 'string') return '(non-string url)';
      var q = url.indexOf('?');
      return q === -1 ? url : url.slice(0, q);
    } catch (e) {
      return '(unparseable url)';
    }
  }

  // The single exit for every drop reason. `extra` carries status/bodyLength/responseType when
  // the call site knows them; absent fields are simply omitted rather than sent as null.
  function reportDrop(reason, url, seq, extra) {
    if (!CITY_ASSIGN_DEBUG) return;
    try {
      var msg = {
        __extRelayCaptureDrop: true,
        reason: reason,
        path: pathOnly(url),
        seq: (seq === undefined || seq === null) ? null : seq
      };
      if (extra) {
        if (extra.status !== undefined)       msg.status = extra.status;
        if (extra.bodyLength !== undefined)   msg.bodyLength = extra.bodyLength;
        if (extra.responseType !== undefined) msg.responseType = extra.responseType;
        if (extra.detail !== undefined)       msg.detail = extra.detail;
      }
      window.postMessage(msg, '*');
    } catch (e) {
      // A diagnostic must never become a failure mode for the page.
    }
  }

  // The positive counterpart: a response that made it all the way through. Emitted next to the
  // drops so the log reads as a matched set — observed N, captured M, dropped N-M with reasons.
  function reportCaptureOk(url, seq, totalResultsSize, bodyLength, woCount) {
    if (!CITY_ASSIGN_DEBUG) return;
    try {
      window.postMessage({
        __extRelayCaptureOk: true,
        path: pathOnly(url),
        seq: (seq === undefined || seq === null) ? null : seq,
        totalResultsSize: (totalResultsSize === undefined) ? null : totalResultsSize,
        bodyLength: (bodyLength === undefined) ? null : bodyLength,
        woCount: (woCount === undefined) ? null : woCount
      }, '*');
    } catch (e) {
      // Same posture.
    }
  }

  function report(url, ok, status) {
    try {
      window.postMessage({ __extRelaySearchResult: true, url: url, ok: ok, status: status }, '*');
    } catch (e) {
      // Never let a postMessage failure surface to the page.
    }
  }

  // ENDPOINT RECONNAISSANCE (2026-08-08) — read-only, CITY_ASSIGN_DEBUG only.
  //
  // WHY. The board's cards were reported as coming from an endpoint we do not capture. But
  // CAPTURE_PATHS has matched '/api/loadboard/similar' since the flag was written, so if the
  // cards really are unmatched, the live path must differ from BOTH strings we test for. The
  // only way to know is to read the actual URLs — guessing a new pattern is exactly what the
  // last two rounds of this investigation punished.
  //
  // So: report EVERY '/api/loadboard/' request this observer sees, with whether it was
  // captured. An endpoint serving 50 loads while showing captured:false is the answer.
  // Reports the URL only — no body, no ids. Deduped so a refresh loop cannot flood the log.
  var _seenEndpoints = {};
  function reportEndpointSeen(url, captured) {
    if (!CITY_ASSIGN_DEBUG) return;
    try {
      if (typeof url !== 'string') return;
      if (url.indexOf('/api/loadboard/') === -1) return;
      // Key on the path, not the full URL: query strings differ per request and would defeat
      // the dedupe. The path is what CAPTURE_PATHS actually tests against.
      var path = url.split('?')[0];
      if (Object.prototype.hasOwnProperty.call(_seenEndpoints, path)) return;
      _seenEndpoints[path] = true;
      window.postMessage({
        __extRelayEndpointSeen: true, path: path, captured: !!captured
      }, '*');
    } catch (e) {
      // A diagnostic must never become a failure mode for the page.
    }
  }

  // True only when the flag is ON and the URL is one of the two capture endpoints.
  // Short-circuits on the flag first, so with capture OFF this is a single boolean read.
  function isCapturePath(url) {
    // 2026-08-13: was `if (!CAPTURE_RESPONSES)`. The shipped city filter needs the body read too,
    // so the gate is now "either reason". With both off this is still a single boolean read.
    if (!bodyCaptureNeeded()) return false;
    if (typeof url !== 'string') return false;
    for (var i = 0; i < CAPTURE_PATHS.length; i++) {
      if (url.indexOf(CAPTURE_PATHS[i]) !== -1) return true;
    }
    return false;
  }

  // Reduces a raw body string to the ONLY five values we are allowed to emit, then drops the
  // parsed object on return. No ids, no cities, no addresses, no payouts, no timestamps — we
  // just finished removing PII from logs and this must not reintroduce any. Everything here
  // is a count, a total, a cursor, or a length.
  //
  // Emits via postMessage rather than console: this world has no `logger`, and requirement is
  // that the line be silent at the shipped DEBUG_LEVEL of 1. content/content.js receives it on
  // the isolated side and logs it with logger.log, which IS level-gated.
  function summariseAndDiscard(url, bodyText) {
    try {
      var parsed = JSON.parse(bodyText);
      var wo = parsed && parsed.workOpportunities;
      window.postMessage({
        __extRelayCaptureSummary: true,
        endpoint:   endpointLabel(url),
        woCount:    Array.isArray(wo) ? wo.length : null,
        totalSize:  parsed ? parsed.totalResultsSize : null,
        nextToken:  parsed ? parsed.nextItemToken : null,
        bodyLength: bodyText.length
      }, '*');
      parsed = null; // explicit: nothing is retained past this function
    } catch (e) {
      // Malformed/non-JSON body, or postMessage refused. Silent by design — a diagnostic
      // must never become a failure mode for the page.
    }
  }

  // CITY ASSIGNMENT FEED (2026-08-06) — the ONLY path in this file permitted to emit
  // identifiers, and only while CITY_ASSIGN_DEBUG and CAPTURE_RESPONSES are both on.
  //
  // Deliberately a SEPARATE function from summariseAndDiscard() rather than extra fields on
  // its message: that function's five-value, no-identifiers contract is load-bearing and
  // documented, and widening it would quietly reintroduce exactly what it was written to keep
  // out. Its body is unchanged to the byte.
  //
  // Emits the MINIMUM the assignment needs: the join id and the PICKUP stop's coordinates.
  // No cities, no addresses, no payouts, no times, no counts of anything else. The extraction
  // happens here, in the MAIN world, so the ~300KB body never crosses postMessage — only a
  // few dozen small triples do.
  //
  // stops[0] is the PICKUP stop (verified in api-samples.md). Anything without a numeric
  // lat/lng pair is skipped rather than sent as null, so the receiver never has to guess
  // whether a missing coordinate means "absent" or "malformed".
  // String entry point — used by the XHR path, which genuinely has a body string.
  // Parses, then hands off to the shared extractor below.
  function emitCityAssignCoords(url, bodyText, seq) {
    // 2026-08-13: was gated on the two DEBUG flags. The shipped filter needs this path, so it
    // now runs whenever a body was captured for any reason.
    if (!bodyCaptureNeeded()) return;
    try {
      emitFromParsed(url, JSON.parse(bodyText), seq, bodyText);
    } catch (e) {
      // DROP — JSON.parse failed on a body we were handed as text.
      reportDrop('emit-threw', url, seq, {
        bodyLength: bodyText ? bodyText.length : null,
        detail: (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : 'unknown')
      });
    }
  }

  // ── THE PANEL'S PROJECTION (STAGE B, 2026-08-14) ────────────────────────────────────────
  //
  // Turns one work opportunity into the SMALLEST record the inline panel needs. An explicit
  // allow-list, never a copy: what is not named here does not leave this world.
  //
  // Segment order is loads[] order — verified four independent ways across all 71 multi-load
  // records on disk (chained stop codes, non-decreasing first CHECKIN, non-decreasing last
  // CHECKOUT, rising stopSequenceNumber). See the Stage B report.
  //
  // Times are emitted as the payload's own UTC ISO strings, PAIRED WITH EACH STOP'S OWN
  // timeZone. Formatting happens in the isolated world, per stop — 31% of the captured records
  // have stops in more than one zone, so a single conversion for the whole load would be wrong
  // on nearly a third of them.
  function projectRecord(item, id) {
    try {
      var loads = [];
      var srcLoads = item.loads || [];
      for (var li = 0; li < srcLoads.length; li++) {
        var l = srcLoads[li];
        var stops = [];
        var srcStops = (l && l.stops) || [];
        for (var si = 0; si < srcStops.length; si++) {
          var st = srcStops[si] || {};
          var lo = st.location || {};
          var acts = st.actions || [];
          var tin = null, tout = null;
          for (var ai = 0; ai < acts.length; ai++) {
            if (acts[ai] && acts[ai].type === 'CHECKIN'  && !tin)  tin  = acts[ai].plannedTime || null;
            if (acts[ai] && acts[ai].type === 'CHECKOUT')          tout = acts[ai].plannedTime || null;
          }
          stops.push({
            seq:      st.stopSequenceNumber,
            label:    lo.label || lo.stopCode || null,
            line1:    lo.line1 || null,
            city:     lo.city || null,
            state:    lo.state || null,
            zip:      lo.postalCode || null,
            tz:       lo.timeZone || null,
            loadingType:   st.loadingType || null,
            unloadingType: st.unloadingType || null,
            checkIn:  tin,
            checkOut: tout
          });
        }
        loads.push({
          distance: (l && l.distance && typeof l.distance.value === 'number') ? l.distance.value : null,
          distanceUnit: (l && l.distance && l.distance.unit) || null,
          loadType: (l && l.loadType) || null,
          equipmentType: (l && l.equipmentType) || null,
          stops: stops
        });
      }
      return {
        id: id,
        // 2026-08-19, DIAGNOSTIC (PATDIAG DRIVER). The only field on the work opportunity whose
        // NAME or VALUE could distinguish a team load from a solo one — established by scanning
        // every key path in all 159 captured records. It reads "SINGLE_DRIVER" in 159/159, i.e.
        // no captured load is a team load, so the TEAM VALUE IS UNKNOWN and nothing may be
        // inferred from it yet. An operational enum, not PII; the allow-list contract holds.
        transitOperatorType: (typeof item.transitOperatorType === 'string')
          ? item.transitOperatorType : null,
        stopCount: (typeof item.stopCount === 'number') ? item.stopCount : null,
        totalDistance: (item.totalDistance && typeof item.totalDistance.value === 'number')
          ? item.totalDistance.value : null,
        distanceUnit: (item.totalDistance && item.totalDistance.unit) || null,
        payout: (item.payout && typeof item.payout.value === 'number') ? item.payout.value : null,
        payoutUnit: (item.payout && item.payout.unit) || null,
        loads: loads
      };
    } catch (e) {
      // A malformed record must not cost the whole response. Reported, then skipped.
      reportDrop('project-record-threw', 'projectRecord', 0, {
        detail: (e && e.message) ? e.message : 'unknown'
      });
      return { id: id, transitOperatorType: null, stopCount: null, totalDistance: null,
               distanceUnit: null, payout: null, payoutUnit: null, loads: [] };
    }
  }

  // Shared extractor. `parsed` is an ALREADY-PARSED object; `bodyText` is the original string
  // when one exists and null when it does not.
  //
  // ⚠ bodyText is null on the Response.json() path (2026-08-13), and that is deliberate:
  // re-stringifying a ~300KB object purely to reuse the string code path would cost more than
  // the whole capture. The consequence is that rawBody/rawBodyLength are null there — see the
  // note in cityAssign.js's CITY RAW 3, which already reports "UNKNOWN (no raw body retained)"
  // rather than mistaking absence for a negative result.
  function emitFromParsed(url, parsed, seq, bodyText) {
    if (!bodyCaptureNeeded()) return;
    try {
      var wo = parsed && parsed.workOpportunities;
      if (!Array.isArray(wo)) {
        // DROP POINT 4 — the body parsed as JSON but carries no workOpportunities array. Was a
        // bare `return`, so a response of the wrong shape vanished without a trace.
        reportDrop('no-workOpportunities-array', url, seq, {
          bodyLength: bodyText ? bodyText.length : null,
          detail: 'typeof workOpportunities = ' + (parsed ? typeof parsed.workOpportunities : 'no body')
        });
        parsed = null;
        return;
      }
      var pairs = [];
      var noCoordIds = [];
      // ── CITY-LEVEL STOPS (2026-08-24) ───────────────────────────────────────────────────
      // Amazon returns TWO shapes of stop in the same response:
      //   FACILITY   label "UNC3", stopCode "UNC3", line1 set, postalCode set, lat/lng SET
      //   CITY-LEVEL label "LOCKBOURNE, OH", stopCode null, line1 null, postalCode null,
      //              lat/lng NULL — but city, state and timeZone always populated.
      //
      // MEASURED, 59 city-level stops across every capture on disk (47 older + 12 in
      // samples/search-city-level-2026-08-24.json): a null latitude is ALWAYS accompanied by
      // null stopCode, line1, postalCode AND longitude. Zero counter-examples.
      //
      // 🔑 In samples/search-city-level-2026-08-24.json SIX OF EIGHT records have a city-level
      // FIRST stop — and stops[0] is the only stop assignment reads. That is the whole defect.
      //
      // The isolated world resolves these through the SAME resolveCityCoords() that already
      // resolves the dispatcher's own origin cities. All that crosses here is city + state,
      // which projectRecord() already carries for every stop — no new class of data.
      var cityStops = [];
      var records = [];
      for (var i = 0; i < wo.length; i++) {
        var item = wo[i];
        if (!item || !item.id) continue;
        var id    = String(item.id);
        var loads = item.loads;
        var stop  = (loads && loads[0] && loads[0].stops && loads[0].stops[0]) || null;
        var loc   = (stop && stop.location) || null;

        // STAGE B (2026-08-14): a CURATED PROJECTION for the inline panel.
        //
        // ⚠ THE RAW BODY STILL NEVER CROSSES. This is an explicit field list — every value the
        // panel renders and nothing else. Measured on the captures: 757 bytes per record, 37 KB
        // for a 50-record page against a 299 KB raw body, i.e. 12%. No contacts, no instructions,
        // no shipper references, no purchase orders, no carrier accounts, no cost items.
        records.push(projectRecord(item, id));

        if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
          // Sent explicitly rather than just omitted. Without this the receiver could not tell
          // "this response had the load but no usable coordinates" from "this response never
          // mentioned the load", and the unmatched reason would be a guess.
          noCoordIds.push(id);
          // A CITY-LEVEL stop still says WHERE it is, just not in coordinates. Carry the city
          // and state so the isolated world can resolve them. Only when both are present — a
          // stop with neither is genuinely unplaceable and stays in noCoordIds alone.
          if (loc && typeof loc.city === 'string' && loc.city &&
              typeof loc.state === 'string' && loc.state) {
            cityStops.push({ id: id, city: loc.city, state: loc.state });
          }
          continue;
        }
        pairs.push({ id: id, lat: loc.latitude, lng: loc.longitude });
      }
      window.postMessage({
        __extRelayCityCoords: true,
        endpoint:   endpointLabel(url),
        woCount:    wo.length,
        pairs:      pairs,
        noCoordIds: noCoordIds,
        // City-level stops: { id, city, state } for ids that had no coordinates but DID say
        // which city they are in. See the note beside cityStops above.
        cityStops:  cityStops,
        // The panel's data source (STAGE B). See projectRecord() for the exact field list.
        records:    records,
        // Added 2026-08-08 for the unmatched-card diagnostic. Both are plain counters already
        // emitted by summariseAndDiscard() — no new class of data crosses the boundary. They
        // are carried on THIS message so they stay correlated with the ids from the SAME
        // response; the summary message cannot be joined to a specific buffer after the fact.
        // totalResultsSize > ids in this response, or a non-null nextItemToken, is the
        // signature of pagination (hypothesis A).
        totalResultsSize: parsed ? parsed.totalResultsSize : null,
        nextItemToken:    parsed ? parsed.nextItemToken : null,

        // Added 2026-08-08 for the accumulator's reset rule. One opaque UUID per RESPONSE
        // (api-samples.md §2). Whether it is stable across PAGES of one search is NOT
        // established — see the accumulator notes in cityAssign.js. Plain scalar, no new
        // class of data.
        searchAuditId: parsed ? parsed.searchAuditId : null,

        // ── ID-SHAPE PROBE (2026-08-08) ──────────────────────────────────────────────────
        // Added after a live run showed ZERO overlap between DOM card ids and captured ids
        // (0/50 across all four buffers). Zero — not a shortfall — means the two sides are
        // not producing the same strings at all, so the only way forward is to look at the
        // raw strings and to test containment against the WHOLE body, not just the id field.
        //
        // ⚠ THIS RETAINS AND TRANSPORTS THE RAW BODY, which every other path here is
        // careful not to do. It happens ONLY while CITY_ASSIGN_DEBUG is on (this function
        // has already returned otherwise), it is capped, and it must be off before ship.
        // Truncation is reported so a "not found" on a cut body is never mistaken for
        // proof of absence.
        // NULL on the Response.json() path — there is no raw string there and we will not
        // manufacture one. CITY RAW 3's containment check already degrades to
        // "UNKNOWN (no raw body retained)" rather than reporting a false negative.
        // ⚠ THE RAW BODY NEVER SHIPS (2026-08-13). It is attached ONLY when CITY_ASSIGN_DEBUG
        // is on, i.e. never in a shipped build. On the product path these three are null/false
        // and nothing but ids and coordinates crosses postMessage. CITY RAW 3's containment
        // check already degrades to "UNKNOWN (no raw body retained)" rather than reporting a
        // false negative.
        rawBody:          (CITY_ASSIGN_DEBUG && bodyText)
                            ? (bodyText.length > 500000 ? bodyText.slice(0, 500000) : bodyText)
                            : null,
        rawBodyTruncated: (CITY_ASSIGN_DEBUG && bodyText) ? bodyText.length > 500000 : false,
        rawBodyLength:    (CITY_ASSIGN_DEBUG && bodyText) ? bodyText.length : null,

        // First few ids WITH the exact JSON path they were read from, so the receiver states
        // the path as fact rather than inferring it. Taken before any coordinate filtering,
        // so index i here is genuinely workOpportunities[i].
        // DEBUG ONLY — an empty array on the product path.
        idSamples: !CITY_ASSIGN_DEBUG ? [] : (function () {
          var out = [];
          for (var s = 0; s < wo.length && s < 3; s++) {
            out.push({
              path: 'workOpportunities[' + s + '].id',
              id:   (wo[s] && wo[s].id !== undefined && wo[s].id !== null)
                      ? String(wo[s].id) : null,
              idType: wo[s] ? typeof wo[s].id : 'missing'
            });
          }
          return out;
        })()
      }, '*');
      // Made it through. Emitted so the log reads as a matched set against the drops above, and
      // so the request PATH and totalResultsSize are visible together — that pair is what
      // identifies WHICH saved-search tab a captured response belongs to.
      reportCaptureOk(url, seq, parsed ? parsed.totalResultsSize : null,
                      bodyText ? bodyText.length : null, wo.length);
      parsed = null; wo = null; pairs = null; noCoordIds = null; // nothing retained
    } catch (e) {
      // DROP — postMessage refused the payload (a structured-clone failure on the message object
      // lands here), or extraction threw. Never rethrown: a debug feed must not become a page
      // failure, and this runs inside Amazon's own promise chain.
      reportDrop('emit-threw', url, seq, {
        bodyLength: bodyText ? bodyText.length : null,
        detail: (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : 'unknown')
      });
    }
  }

  // XHR needs no clone: unlike a fetch Response body, xhr.responseText / xhr.response can be
  // read any number of times without consuming anything, so reading here cannot starve
  // Amazon's own handler, and listener ordering is irrelevant.
  //
  // The real hazard is different: accessing .responseText THROWS InvalidStateError unless
  // responseType is '' or 'text'. So branch on responseType and never assume text.
  //   '' | 'text'          -> responseText is the raw string
  //   'json'               -> .response is ALREADY a parsed object; re-stringify only to
  //                           measure length, then summarise from it directly
  //   blob/arraybuffer/... -> skip entirely; not worth converting for a diagnostic
  function captureFromXhr(xhr) {
    try {
      var rt = xhr.responseType;
      if (rt === '' || rt === 'text') {
        summariseAndDiscard(xhr.__extUrl, xhr.responseText);
        emitCityAssignCoords(xhr.__extUrl, xhr.responseText, xhr.__extSeq);
      } else if (rt === 'json') {
        var obj = xhr.response;
        if (obj) {
          var jsonText = JSON.stringify(obj);
          summariseAndDiscard(xhr.__extUrl, jsonText);
          emitCityAssignCoords(xhr.__extUrl, jsonText, xhr.__extSeq);
          jsonText = null;
        } else {
          // json responseType but a null .response — a parse failure inside XHR itself.
          reportDrop('xhr-json-response-null', xhr.__extUrl, xhr.__extSeq, {
            status: xhr.status, responseType: rt
          });
        }
        obj = null;
      } else {
        // DROP POINT 5 — blob / arraybuffer / document. Previously an unlogged fall-through, so
        // a response Amazon happened to request in a binary type looked exactly like one that
        // was never made. The actual responseType string is reported, not just "other".
        reportDrop('xhr-unhandled-responseType', xhr.__extUrl, xhr.__extSeq, {
          status: xhr.status, responseType: (rt === undefined || rt === null) ? '(undefined)' : String(rt)
        });
      }
    } catch (e) {
      // Reading responseText on a non-text responseType throws InvalidStateError; that and any
      // other read failure used to vanish here.
      reportDrop('xhr-read-threw', xhr.__extUrl, xhr.__extSeq, {
        status: (function () { try { return xhr.status; } catch (e2) { return null; } })(),
        detail: (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : 'unknown')
      });
    }
  }

  // ABORT IS NOT A FAILURE (2026-07-31). A rejected fetch used to be reported wholesale as a
  // failure, which meant every ordinary saved-search switch — the SPA aborts the in-flight
  // search to issue the new one — was reported as if Amazon had refused us, pausing the
  // monitoring loop. Two independent signals distinguish an abort, and either is sufficient:
  //
  //   1. signal.aborted — the AbortSignal belonging to THIS request, captured below before
  //      the call. Authoritative regardless of what the rejection value turns out to be, which
  //      matters because AbortController.abort(reason) rejects with that caller-supplied
  //      reason rather than a DOMException.
  //   2. err.name === 'AbortError' — the standard DOMException from a bare abort(). Covers
  //      aborts we could not attribute to a signal we can see (e.g. one attached by a wrapper
  //      layered over ours).
  //
  // A genuine network failure (offline, DNS, connection refused) rejects with a TypeError and
  // no aborted signal, so it still reports — as status 0, exactly as before. Deciding what
  // status 0 MEANS is background.js's job, not this file's.
  // ── PIGGYBACK ON AMAZON'S OWN BODY READ (2026-08-13) ──────────────────────────────────────
  //
  // WHY THE CLONE APPROACH IS GONE. The SPA aborts its own in-flight search on every refresh
  // (`onAutoRefresh` -> `executeAvailableWorkFilterActions`). `resp.clone()` succeeds and tees
  // the body, but `abort()` errors BOTH branches of a tee regardless of what is already
  // buffered, so our read died with `AbortError` on exactly the response that renders the board
  // — every single cycle. Proven live: `text() FAILED AbortError` while `json() OK wo: 1` on the
  // same response. No amount of reading earlier or salvaging chunks can win that race.
  //
  // WHAT THIS DOES INSTEAD. Amazon reads that body itself, via Response.json(), and that read
  // completes — abort-after-read is harmless to them. So we stop competing for the body and
  // observe the read they are already performing.
  //
  // ⚠ Response.prototype IS GLOBAL — this sits in the path of EVERY fetch on the page, not just
  // ours. Three things keep that safe:
  //   1. The ORIGINAL promise object is returned, always. Never a .then()-derived promise, never
  //      a re-wrapped value. Amazon's caller receives byte-for-byte what it would have.
  //   2. A flag check is the FIRST thing after the passthrough call, so with the switches off
  //      (the shipped state) the added cost is one boolean read. No URL parsing, no try/catch
  //      entry, nothing.
  //   3. Our observation is a SEPARATE promise branch with its own rejection handler, and the
  //      whole wrapper body is inside try/catch. Nothing we do can throw into Amazon's caller or
  //      create an unhandled rejection.
  //
  // The Response object is NOT mutated — the sequence number is held in a WeakMap keyed by the
  // Response, so we add no property Amazon's code could ever enumerate.
  var _respSeq = (typeof WeakMap === 'function') ? new WeakMap() : null;

  var _responseHookInstalled = false;
  // ══ SEARCH REQUEST CAPTURE (2026-08-20) ═════════════════════════════════════════════════
  //
  // WHY: the dispatcher's per-city search RADIUS is in the /search REQUEST body. Ihor captured
  // it live on 2026-08-20. Our own limit (CITY_ASSIGN_MAX_MILES = 150) is a development guess
  // that is wrong in BOTH directions — at radius 250 it marked six legitimately-returned loads
  // "Origin not determined"; at radius 50 it put a 122 mi load under the HEBRON tab.
  //
  // ⚠ THE RADIUS IS PER CITY, NOT ONE GLOBAL VALUE. The body carries
  // originCitiesRadiusFilters[] with one entry per origin city. The UI may well set them all
  // alike; the API does not, so nothing here assumes it.
  //
  // 🔑 THIS DOES NOT TOUCH THE RESPONSE MACHINERY. installResponseReadHook() below and the
  // Response.prototype.json piggyback (api-samples.md §6.8) are UNCHANGED and untouched. This
  // reads the REQUEST, in the fetch wrapper, from a plain object Amazon already handed us.
  // There is no clone, no tee, and none of the abort hazard that killed response cloning —
  // that hazard is a property of response STREAMS and does not exist here.
  //
  // 🔑 NO REQUEST IS EVER CLONED. If the body turns out to be a stream (the fetch(new Request)
  // call shape), this reports the shape and STOPS. Cloning a Request is not on the table.

  // ⚠ WHY THIS IS NOT reportDrop(). reportDrop is gated on CITY_ASSIGN_DEBUG, which ships OFF —
  // a drop there is invisible in a real build. "We could not read your radius" must NEVER be
  // invisible: silently falling back is precisely the defect being removed. This rides on the
  // PRODUCT flag instead, and the isolated world surfaces it with console.warn so it is legible
  // at the shipped DEBUG_LEVEL.
  //
  // DEDUPED BY REASON, once per page session. Auto-refresh runs every 2.5s; without this the
  // console would fill with the same line.
  var _reqIssuesSeen = {};
  function reportRequestIssue(reason, url, seq, detail) {
    try {
      if (!CITY_FILTER_ENABLED) return;
      if (Object.prototype.hasOwnProperty.call(_reqIssuesSeen, reason)) return;
      _reqIssuesSeen[reason] = true;
      window.postMessage({
        __extRelaySearchRequestIssue: true,
        reason: reason,
        path: pathOnly(url),
        seq: (seq === undefined || seq === null) ? null : seq,
        detail: (detail === undefined) ? null : detail
      }, '*');
    } catch (e) {
      // Never surface to the page.
    }
  }

  // Key names that must never leave this world, whatever shape their value has. Checked before
  // the shape allow-list below, so a scalar cannot slip through on a credential-shaped name.
  var REQ_DENY_KEY_RE = /token|secret|auth|csrf|session|cookie|password|jwt|bearer|signature/i;

  // A scalar we are willing to carry: a number, a boolean, or a SHORT string.
  function isCarryableScalar(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'boolean') return true;
    if (typeof v === 'string') return v.length <= 64;
    return false;
  }

  // ⚠ THE RADIUS FIELD NAME IS NOT KNOWN YET. Ihor's paste truncates the entry, and guessing a
  // field name is exactly what this project forbids. So a radius-filter entry is projected BY
  // SHAPE, not by name: every own property whose value is a carryable scalar, or a
  // {value, unit} pair, is kept — minus the deny-list above. That captures the radius whatever
  // it is called, and the capture itself is what reveals the name.
  //
  // This is deliberately NARROWER than it sounds: nested objects, arrays and long strings are
  // all dropped, so an audit blob or a token bag cannot ride along.
  function projectRadiusFilter(entry) {
    var out = {};
    try {
      if (!entry || typeof entry !== 'object') return out;
      for (var k in entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, k)) continue;
        if (REQ_DENY_KEY_RE.test(k)) continue;
        var v = entry[k];
        if (isCarryableScalar(v)) { out[k] = v; continue; }
        // The {value, unit} shape Amazon uses for every other distance in this API.
        if (v && typeof v === 'object' && !Array.isArray(v) &&
            isCarryableScalar(v.value) && typeof v.unit === 'string' && v.unit.length <= 16) {
          out[k] = { value: v.value, unit: v.unit };
        }
      }
    } catch (e) {
      reportDrop('project-radius-filter-threw', 'projectRadiusFilter', 0, {
        detail: (e && e.message) ? e.message : 'unknown'
      });
    }
    return out;
  }

  // originCities entries, by NAME — unlike the radius filters, these field names ARE known
  // (AMAZON_SELECTORS.md, the cities endpoint: name, stateCode, country, latitude, longitude).
  // A strict allow-list is correct where the names are known; shape-projection is only for the
  // one entry whose key we genuinely do not have.
  function projectOriginCity(c) {
    try {
      if (!c || typeof c !== 'object') return null;
      return {
        name:      (typeof c.name === 'string') ? c.name : null,
        stateCode: (typeof c.stateCode === 'string') ? c.stateCode : null,
        country:   (typeof c.country === 'string') ? c.country : null,
        latitude:  (typeof c.latitude === 'number') ? c.latitude : null,
        longitude: (typeof c.longitude === 'number') ? c.longitude : null
      };
    } catch (e) {
      reportDrop('project-origin-city-threw', 'projectOriginCity', 0, {
        detail: (e && e.message) ? e.message : 'unknown'
      });
      return null;
    }
  }

  // WHAT IS KEPT, and why — the whole contract in one place:
  //   originCitiesRadiusFilters  the point of the exercise: the per-city radius
  //   originCities              needed to match a radius entry to an active origin city
  //   startCityRadius           a named, scalar radius sitting beside them
  //
  // WHAT IS DROPPED, deliberately, though it is all in the body Ihor captured:
  //   savedSearchId             an identifier for the dispatcher's saved search
  //   minPayout, minPricePerDistance   his commercial settings; none of our business
  //   resultSize, maximumNumberOfStops, isAutoRefreshCall   not needed for membership
  //   everything else           not enumerated, not carried
  function projectSearchRequest(parsed) {
    var out = { originCitiesRadiusFilters: [], originCities: [], startCityRadius: null };
    try {
      if (!parsed || typeof parsed !== 'object') return out;

      var rf = parsed.originCitiesRadiusFilters;
      if (Array.isArray(rf)) {
        for (var i = 0; i < rf.length; i++) out.originCitiesRadiusFilters.push(projectRadiusFilter(rf[i]));
      }
      var oc = parsed.originCities;
      if (Array.isArray(oc)) {
        for (var j = 0; j < oc.length; j++) {
          var p = projectOriginCity(oc[j]);
          if (p) out.originCities.push(p);
        }
      }
      if (isCarryableScalar(parsed.startCityRadius)) out.startCityRadius = parsed.startCityRadius;
      else if (parsed.startCityRadius && typeof parsed.startCityRadius === 'object' &&
               isCarryableScalar(parsed.startCityRadius.value)) {
        out.startCityRadius = { value: parsed.startCityRadius.value,
                                unit: (typeof parsed.startCityRadius.unit === 'string')
                                  ? parsed.startCityRadius.unit : null };
      }
    } catch (e) {
      reportDrop('project-search-request-threw', 'projectSearchRequest', 0, {
        detail: (e && e.message) ? e.message : 'unknown'
      });
    }
    return out;
  }

  // Classifies what we were actually handed, so an unreadable shape is REPORTED rather than
  // guessed at. Returns { kind, text } — text is non-null only for 'string'.
  function classifyRequestBody(input, init) {
    try {
      // The fetch(new Request(...)) call shape: the body lives on the Request as a stream.
      // ⚠ WE DO NOT CLONE IT. Report and stop.
      if (input && typeof input === 'object' && 'url' in input) {
        return { kind: 'request-object', text: null };
      }
      if (!init || !('body' in init) || init.body === null || init.body === undefined) {
        return { kind: 'none', text: null };
      }
      var b = init.body;
      if (typeof b === 'string') return { kind: 'string', text: b };
      if (typeof URLSearchParams === 'function' && b instanceof URLSearchParams) {
        return { kind: 'urlsearchparams', text: null };
      }
      if (typeof FormData === 'function' && b instanceof FormData)   return { kind: 'formdata', text: null };
      if (typeof Blob === 'function' && b instanceof Blob)           return { kind: 'blob', text: null };
      if (typeof ReadableStream === 'function' && b instanceof ReadableStream) {
        return { kind: 'stream', text: null };
      }
      if (b && typeof b === 'object' && typeof b.byteLength === 'number') {
        return { kind: 'arraybuffer', text: null };
      }
      return { kind: 'unknown-object', text: null };
    } catch (e) {
      return { kind: 'classify-threw', text: null };
    }
  }

  // Reads and emits ONE search request body. Search only — the caller gates on isWatched, which
  // is WATCH_PATH and nothing else. WATCH_PATH is NOT widened by this change.
  //
  // Gated on CITY_FILTER_ENABLED, the same PRODUCT flag the coordinate emit rides on, and for
  // the same reason: city membership needs this in a shipped build. It is NOT behind a debug
  // flag, so what Ihor re-tests is the real path.
  function emitSearchRequest(url, input, init, seq) {
    try {
      if (!CITY_FILTER_ENABLED) return;

      var body = classifyRequestBody(input, init);
      if (body.kind === 'none') return;          // GET, or no body: nothing to read, not an error

      if (body.kind !== 'string') {
        // ⚠ STOP. Anything that is not already a plain string would need a clone or a stream
        // read, and neither is acceptable here. Reported so the shape is KNOWN rather than
        // assumed, and so this line is what tells us to change approach.
        var notString = 'shape=' + body.kind + ' — NOT read, NOT cloned. The radius cannot be ' +
          'taken from this call shape without touching the request stream.';
        reportDrop('request-body-not-a-string', url, seq, { detail: notString });
        reportRequestIssue('request-body-not-a-string', url, seq, notString);
        return;
      }

      var parsed = null;
      try {
        parsed = JSON.parse(body.text);
      } catch (e1) {
        reportDrop('request-body-not-json', url, seq, { detail: 'length=' + body.text.length });
        reportRequestIssue('request-body-not-json', url, seq,
          'the request body is a string but not JSON (length ' + body.text.length + ')');
        return;
      }

      var projected = projectSearchRequest(parsed);
      // Nothing to say if the body carried neither list — do not post an empty message every
      // refresh.
      if (!projected.originCitiesRadiusFilters.length && !projected.originCities.length &&
          projected.startCityRadius === null) {
        var noFields = 'parsed OK but carried no originCitiesRadiusFilters, no originCities and ' +
          'no startCityRadius — Amazon may have renamed them';
        reportDrop('request-body-no-radius-fields', url, seq, { detail: noFields });
        reportRequestIssue('request-body-no-radius-fields', url, seq, noFields);
        return;
      }

      window.postMessage({
        __extRelaySearchRequest: true,
        seq: seq,
        path: pathOnly(url),
        radiusFilters: projected.originCitiesRadiusFilters,
        originCities: projected.originCities,
        startCityRadius: projected.startCityRadius,
        // How many keys each entry actually carried BEFORE projection, so a shrinking entry is
        // visible rather than silent. Counts only — no names, no values.
        rawFilterKeyCounts: (function () {
          var counts = [];
          try {
            var rf = parsed.originCitiesRadiusFilters;
            if (Array.isArray(rf)) {
              for (var i = 0; i < rf.length; i++) {
                counts.push((rf[i] && typeof rf[i] === 'object') ? Object.keys(rf[i]).length : 0);
              }
            }
          } catch (e2) { /* counts stay short; never surface to the page */ }
          return counts;
        })()
      }, '*');
    } catch (e) {
      // Never surface to the page. This runs inside Amazon's own fetch call.
      try {
        reportDrop('emit-search-request-threw', url, seq, {
          detail: (e && e.message) ? e.message : 'unknown'
        });
      } catch (e2) { /* nothing further is safe to do */ }
    }
  }

  function installResponseReadHook() {
    if (_responseHookInstalled) return;
    try {
      if (typeof Response !== 'function' || !Response.prototype) return;
      // Double-installation guard: a re-injected content script must never wrap the wrapper,
      // which would stack observers and double-emit. Non-enumerable so it cannot show up in
      // anything Amazon iterates.
      if (Response.prototype.__extRelayReadHooked) { _responseHookInstalled = true; return; }
      try {
        Object.defineProperty(Response.prototype, '__extRelayReadHooked', {
          value: true, enumerable: false, configurable: false, writable: false
        });
      } catch (e) { /* non-fatal: the flag below still prevents a second install this session */ }

      var origJson = Response.prototype.json;
      var origText = Response.prototype.text;

      // `observe` never returns anything and never throws — the caller ignores it entirely.
      function observe(res, promise, isJson) {
        try {
          var url = res.url;
          if (!isCapturePath(url)) return;   // not ours: nothing attached, nothing scheduled
          var seq = _respSeq ? _respSeq.get(res) : null;
          promise.then(function (value) {
            if (isJson) {
              emitFromParsed(url, value, seq, null);      // already parsed — no stringify
            } else {
              emitCityAssignCoords(url, value, seq);      // a string — parse as before
            }
          }, function (err) {
            reportDrop(isJson ? 'amazon-json-rejected' : 'amazon-text-rejected', url, seq, {
              detail: (err && err.name ? err.name : 'Error') + ': ' +
                      (err && err.message ? err.message : 'unknown')
            });
          });
        } catch (e) {
          // Deliberately swallowed: this runs inside Amazon's read path.
        }
      }

      if (typeof origJson === 'function') {
        Response.prototype.json = function () {
          var p = origJson.apply(this, arguments);
          // Flag check FIRST — this is the zero-cost path for every non-capture fetch and for
          // the entire shipped build.
          if (!bodyCaptureNeeded()) return p;
          observe(this, p, true);
          return p;   // the ORIGINAL promise, unchanged
        };
      }
      if (typeof origText === 'function') {
        Response.prototype.text = function () {
          var p = origText.apply(this, arguments);
          if (!bodyCaptureNeeded()) return p;
          observe(this, p, false);
          return p;   // the ORIGINAL promise, unchanged
        };
      }
      _responseHookInstalled = true;
    } catch (e) {
      // If installation fails the extension simply captures nothing. The page is untouched.
      _responseHookInstalled = true; // do not retry in a loop
    }
  }
  installResponseReadHook();

  function isAbort(err, signal) {
    if (signal && signal.aborted) return true;
    return !!(err && err.name === 'AbortError');
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var input = arguments[0];
      var init  = arguments[1];
      var url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
      var isWatched = typeof url === 'string' && url.indexOf(WATCH_PATH) !== -1;
      // Both call shapes carry the signal in a different place: fetch(url, {signal}) puts it
      // on init, fetch(new Request(url, {signal})) puts it on the Request.
      var signal = (init && init.signal) ||
                   ((input && typeof input === 'object' && input.signal) || null);
      var isCaptured = isCapturePath(url); // always false while CAPTURE_RESPONSES is off
      reportEndpointSeen(url, isCaptured);  // read-only recon; no-op unless CITY_ASSIGN_DEBUG

      // Sequence assigned BEFORE the request goes out, so the two /search responses of one
      // refresh are distinguishable in the log and each capture can be matched to its observe.
      var seq = (isWatched || isCaptured) ? nextSeq() : null;

      // DROP POINT 6 — a URL the rate-limit path watches but the capture path does not. Since
      // WATCH_PATH and CAPTURE_PATHS both contain '/api/loadboard/search' this should be
      // impossible; if it ever fires, the two lists have drifted and that is the bug.
      if (isWatched && !isCaptured) {
        reportDrop('watched-but-not-captured', url, seq, {
          detail: 'CAPTURE_RESPONSES=' + CAPTURE_RESPONSES + ' isCapturePath=false'
        });
      }

      // SEARCH REQUEST CAPTURE (2026-08-20). BEFORE origFetch, because init.body must be read
      // while it is still the plain object Amazon handed us — after the call it may have been
      // consumed. Reads only; never mutates init, never replaces arguments, and the call below
      // still forwards `arguments` verbatim.
      //
      // isWatched is WATCH_PATH ('/api/loadboard/search') and nothing else. NOT widened.
      if (isWatched) emitSearchRequest(url, input, init, seq);

      var result = origFetch.apply(this, arguments);
      if (isWatched || isCaptured) {
        result.then(function (resp) {
          // NO CLONE ANY MORE (2026-08-13). The body is captured by observing Amazon's own
          // Response.json() read — see installResponseReadHook(). Cloning here was the bug: the
          // SPA's abort errored our tee branch on the one response that renders the board.
          //
          // We touch NOTHING on `resp`. The sequence number is recorded in a WeakMap so the
          // Response object itself gains no property.
          if (isCaptured && _respSeq) {
            try { _respSeq.set(resp, seq); } catch (e) { /* never surface to the page */ }
          }
          if (isWatched) report(url, resp.ok, resp.status); // UNCHANGED reporting path
        }).catch(function (err) {
          if (isAbort(err, signal)) return; // aborted — normal navigation, report NOTHING
          if (isWatched) report(url, false, 0); // genuine network failure — no HTTP status at all
        });
      }
      return result; // ALWAYS the original promise — Amazon's consumption is untouched
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__extWatched = typeof url === 'string' && url.indexOf(WATCH_PATH) !== -1;
    this.__extCaptured = isCapturePath(url); // always false while CAPTURE_RESPONSES is off
    reportEndpointSeen(url, this.__extCaptured); // read-only recon; see the function comment
    this.__extUrl = url;
    // Same sequence space as the fetch wrapper, so a refresh that mixes fetch and XHR still
    // produces one ordered, matchable series.
    this.__extSeq = (this.__extWatched || this.__extCaptured) ? nextSeq() : null;
    // DROP POINT 6, XHR half — watched by the rate-limit path but invisible to the capture path.
    if (this.__extWatched && !this.__extCaptured) {
      reportDrop('watched-but-not-captured', url, this.__extSeq, {
        detail: 'XHR; CAPTURE_RESPONSES=' + CAPTURE_RESPONSES + ' isCapturePath=false'
      });
    }
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__extWatched || this.__extCaptured) {
      var xhr = this;
      // 2026-07-31: was a single 'loadend' listener. loadend fires for EVERY terminal
      // outcome — load, error, timeout AND abort — and an abort arrives with status 0, which
      // is indistinguishable there from a genuine network failure. That is the XHR half of
      // the same bug as the fetch path above: switching a saved search aborts the in-flight
      // search and it was reported as a failure.
      //
      // Subscribing to the specific events instead makes the distinction structural rather
      // than inferred — 'abort' is simply not subscribed, so an aborted request reports
      // NOTHING. The three below reproduce exactly what loadend used to cover, minus aborts:
      //   load    — a response was received; xhr.status is the real status (any value)
      //   error   — genuine network failure; status is 0
      //   timeout — request timed out; status is 0
      // Deciding what status 0 means is background.js's job, not this file's.
      xhr.addEventListener('load', function () {
        if (xhr.__extWatched) {
          report(xhr.__extUrl, xhr.status >= 200 && xhr.status < 300, xhr.status);
        }
        if (xhr.__extCaptured) captureFromXhr(xhr);
      });
      xhr.addEventListener('error', function () {
        if (xhr.__extWatched) report(xhr.__extUrl, false, 0);
      });
      xhr.addEventListener('timeout', function () {
        if (xhr.__extWatched) report(xhr.__extUrl, false, 0);
      });
    }
    return origSend.apply(this, arguments);
  };
})();
