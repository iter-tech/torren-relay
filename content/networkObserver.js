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

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var input = arguments[0];
      var url = (input && typeof input === 'object' && 'url' in input) ? input.url : input;
      var isWatched = typeof url === 'string' && url.indexOf(WATCH_PATH) !== -1;
      var result = origFetch.apply(this, arguments);
      if (isWatched) {
        result.then(function (resp) {
          report(url, resp.ok, resp.status);
        }).catch(function () {
          report(url, false, 0); // network failure — no HTTP status at all
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
      xhr.addEventListener('loadend', function () {
        report(xhr.__extUrl, xhr.status >= 200 && xhr.status < 300, xhr.status);
      });
    }
    return origSend.apply(this, arguments);
  };
})();
