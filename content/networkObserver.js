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

  function report(url, ok, status) {
    try {
      window.postMessage({ __extRelaySearchResult: true, url: url, ok: ok, status: status }, '*');
    } catch (e) {
      // Never let a postMessage failure surface to the page.
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
      var result = origFetch.apply(this, arguments);
      if (isWatched) {
        result.then(function (resp) {
          report(url, resp.ok, resp.status);
        }).catch(function (err) {
          if (isAbort(err, signal)) return; // aborted — normal navigation, report NOTHING
          report(url, false, 0); // genuine network failure — no HTTP status at all
        });
      }
      return result;
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__extWatched = typeof url === 'string' && url.indexOf(WATCH_PATH) !== -1;
    this.__extUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__extWatched) {
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
        report(xhr.__extUrl, xhr.status >= 200 && xhr.status < 300, xhr.status);
      });
      xhr.addEventListener('error', function () {
        report(xhr.__extUrl, false, 0);
      });
      xhr.addEventListener('timeout', function () {
        report(xhr.__extUrl, false, 0);
      });
    }
    return origSend.apply(this, arguments);
  };
})();
