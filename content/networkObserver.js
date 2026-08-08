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
  var CAPTURE_RESPONSES = true;

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
  var CITY_ASSIGN_DEBUG = true;

  // Capture scope is DELIBERATELY SEPARATE from WATCH_PATH and must stay that way.
  // WATCH_PATH drives the rate-limit reporting path (search only) — widening it would start
  // feeding /similar failures into background.js's backoff, which is a behaviour change and
  // is explicitly out of scope. These two lists are independent on purpose.
  var CAPTURE_PATHS = ['/api/loadboard/search', '/api/loadboard/similar'];

  function report(url, ok, status) {
    try {
      window.postMessage({ __extRelaySearchResult: true, url: url, ok: ok, status: status }, '*');
    } catch (e) {
      // Never let a postMessage failure surface to the page.
    }
  }

  // True only when the flag is ON and the URL is one of the two capture endpoints.
  // Short-circuits on the flag first, so with capture OFF this is a single boolean read.
  function isCapturePath(url) {
    if (!CAPTURE_RESPONSES) return false;
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
        endpoint:   url.indexOf('/api/loadboard/similar') !== -1 ? 'similar' : 'search',
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
  function emitCityAssignCoords(url, bodyText) {
    if (!CAPTURE_RESPONSES || !CITY_ASSIGN_DEBUG) return;
    try {
      var parsed = JSON.parse(bodyText);
      var wo = parsed && parsed.workOpportunities;
      if (!Array.isArray(wo)) { parsed = null; return; }
      var pairs = [];
      var noCoordIds = [];
      for (var i = 0; i < wo.length; i++) {
        var item = wo[i];
        if (!item || !item.id) continue;
        var id    = String(item.id);
        var loads = item.loads;
        var stop  = (loads && loads[0] && loads[0].stops && loads[0].stops[0]) || null;
        var loc   = (stop && stop.location) || null;
        if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
          // Sent explicitly rather than just omitted. Without this the receiver could not tell
          // "this response had the load but no usable coordinates" from "this response never
          // mentioned the load", and the unmatched reason would be a guess.
          noCoordIds.push(id);
          continue;
        }
        pairs.push({ id: id, lat: loc.latitude, lng: loc.longitude });
      }
      window.postMessage({
        __extRelayCityCoords: true,
        endpoint:   url.indexOf('/api/loadboard/similar') !== -1 ? 'similar' : 'search',
        woCount:    wo.length,
        pairs:      pairs,
        noCoordIds: noCoordIds,
        // Added 2026-08-08 for the unmatched-card diagnostic. Both are plain counters already
        // emitted by summariseAndDiscard() — no new class of data crosses the boundary. They
        // are carried on THIS message so they stay correlated with the ids from the SAME
        // response; the summary message cannot be joined to a specific buffer after the fact.
        // totalResultsSize > ids in this response, or a non-null nextItemToken, is the
        // signature of pagination (hypothesis A).
        totalResultsSize: parsed ? parsed.totalResultsSize : null,
        nextItemToken:    parsed ? parsed.nextItemToken : null,

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
        rawBody:          bodyText.length > 500000 ? bodyText.slice(0, 500000) : bodyText,
        rawBodyTruncated: bodyText.length > 500000,
        rawBodyLength:    bodyText.length,

        // First few ids WITH the exact JSON path they were read from, so the receiver states
        // the path as fact rather than inferring it. Taken before any coordinate filtering,
        // so index i here is genuinely workOpportunities[i].
        idSamples: (function () {
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
      parsed = null; wo = null; pairs = null; noCoordIds = null; // nothing retained
    } catch (e) {
      // Same posture as summariseAndDiscard: a debug feed must never become a page failure.
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
        emitCityAssignCoords(xhr.__extUrl, xhr.responseText);
      } else if (rt === 'json') {
        var obj = xhr.response;
        if (obj) {
          var jsonText = JSON.stringify(obj);
          summariseAndDiscard(xhr.__extUrl, jsonText);
          emitCityAssignCoords(xhr.__extUrl, jsonText);
          jsonText = null;
        }
        obj = null;
      }
      // every other responseType: deliberately ignored
    } catch (e) {
      // Never surface to the page.
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
      var result = origFetch.apply(this, arguments);
      if (isWatched || isCaptured) {
        result.then(function (resp) {
          // CLONE FIRST, before anything else in this handler can disturb the body. resp.ok
          // and resp.status below do not disturb it, but ordering this first means no future
          // edit above can. The ORIGINAL `resp` is never read — Amazon consumes that. Our
          // handler was registered synchronously inside this wrapper, before Amazon could
          // attach theirs, so this clone runs while the body is still untouched.
          var snapshot = null;
          if (isCaptured) {
            try { snapshot = resp.clone(); } catch (e) { snapshot = null; }
          }
          if (isWatched) report(url, resp.ok, resp.status); // UNCHANGED reporting path
          if (snapshot) {
            // .text() consumes the clone FULLY, so neither branch is left buffered.
            snapshot.text()
              .then(function (bodyText) {
                summariseAndDiscard(url, bodyText);
                emitCityAssignCoords(url, bodyText);
              })
              .catch(function () { /* clone read failed — never surface to the page */ });
          }
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
    this.__extUrl = url;
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
