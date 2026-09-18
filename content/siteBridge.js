// Site Bridge — the TENLANE-WEBSITE half of the bridge.
//
// Runs as a content script on the Tenlane origin only (see manifest `matches`). It speaks the
// ping/pong protocol `web/src/lib/relayBridge.ts` already implements, and forwards submits to the
// service worker, which routes them to the Relay tab.
//
// ── WHY postMessage AND NOT externally_connectable ────────────────────────────────────────
//
// 🔑 externally_connectable WOULD MAKE THE WEBSITE HARDCODE THE EXTENSION ID. The page would call
// `chrome.runtime.sendMessage(EXTENSION_ID, …)`, and that id is different for an unpacked
// development load than for a store build — so the site would have to ship both and keep them in
// sync with however the extension happens to be installed. The manifest's `matches` already
// pins WHERE this script runs, which is the same origin guarantee, with no id anywhere.
//
// ⚠ NEITHER CHANNEL IS "MORE TRUSTED" THAN THE OTHER, and choosing postMessage gives nothing
// away. Both are reachable by any script executing on the page — a third-party script, or an XSS
// — because in both cases the caller is page JavaScript. The protection is not the channel: it is
// the allow-list validation in patBridge.js and what the dispatcher confirms. See DECISIONS.md D24.
//
// ── ORIGIN CHECKING, BOTH DIRECTIONS ──────────────────────────────────────────────────────
//   inbound : event.source must be this window AND event.origin must equal this page's origin.
//   outbound: every reply is posted to window.location.origin, never '*'.
// ⚠ Posting to '*' would leak the Relay session state and Amazon's response into any embedding
// frame. It is never correct here.

(function () {
  var SITE_BRIDGE_VERSION = 1;
  var TAG = '[Tenlane siteBridge]';

  // ⚠ NO logger.js ON THIS ORIGIN. The Relay content-script bundle is not injected here — this
  // file is deliberately dependency-free so it cannot break on a page that has none of it.
  function log() {
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }
  function err() {
    try { console.error.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  function reply(message) {
    try { window.postMessage(message, window.location.origin); }
    catch (e) { err('reply failed', e); }
  }

  function onMessage(event) {
    try {
      // ── inbound origin check ──
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;

      var d = event.data;
      if (!d || typeof d !== 'object') return;
      if (d.__tenlaneBridge !== 'ping' && d.__tenlaneBridge !== 'submit') return;

      if (d.__tenlaneBridge === 'ping') {
        chrome.runtime.sendMessage({ type: 'TENLANE_RELAY_STATUS' }, function (res) {
          // ⚠ A dead service worker sets chrome.runtime.lastError and calls back with undefined.
          // Reading it clears the "Unchecked runtime.lastError" console noise AND is the only way
          // to distinguish "no answer" from "answered no".
          if (chrome.runtime.lastError || !res) {
            err('status query failed', chrome.runtime.lastError);
            reply({
              __tenlaneBridge: 'pong', v: SITE_BRIDGE_VERSION,
              relaySignedIn: false, accounts: [],
              reason: 'extension-error',
            });
            return;
          }
          reply({
            __tenlaneBridge: 'pong', v: SITE_BRIDGE_VERSION,
            relaySignedIn: res.signedIn === true,
            accounts: Array.isArray(res.accounts) ? res.accounts : [],
            reason: res.reason || null,
          });
        });
        return;
      }

      // ── submit ──
      // 🔑 THE requestId IS ECHOED BACK UNCHANGED so the page can match a reply to the click that
      // caused it. Without it two rapid submits are indistinguishable and the UI could report the
      // wrong one's result.
      var requestId = (typeof d.requestId === 'string') ? d.requestId : null;
      log('submit requested', { requestId: requestId });

      chrome.runtime.sendMessage({
        type: 'TENLANE_RELAY_SUBMIT',
        payload: d.payload,
        origin: d.origin,
        dest: d.dest,
      }, function (res) {
        if (chrome.runtime.lastError || !res) {
          err('submit failed', chrome.runtime.lastError);
          reply({
            __tenlaneBridge: 'submitResult', v: SITE_BRIDGE_VERSION, requestId: requestId,
            ok: false, refused: true,
            reason: 'The extension did not respond. Reload the page and try again.',
          });
          return;
        }
        reply({
          __tenlaneBridge: 'submitResult', v: SITE_BRIDGE_VERSION, requestId: requestId,
          ok: res.ok === true,
          refused: res.refused === true,
          reason: res.reason || null,
          status: typeof res.status === 'number' ? res.status : null,
          body: typeof res.body === 'string' ? res.body : null,
        });
      });
    } catch (e) {
      err('onMessage threw', e);
    }
  }

  window.addEventListener('message', onMessage);
  log('ready on ' + window.location.origin);
}());
