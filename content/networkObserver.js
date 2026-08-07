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
      } else if (rt === 'json') {
        var obj = xhr.response;
        if (obj) summariseAndDiscard(xhr.__extUrl, JSON.stringify(obj));
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
              .then(function (bodyText) { summariseAndDiscard(url, bodyText); })
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
