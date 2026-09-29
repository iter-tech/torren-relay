// aiChatKey.js — ISOLATED world, run_at document_start (EXT-D10, 2026-09-28).
//
// Hands a per-page secret to content/aiChatBridge.js (MAIN world) BEFORE ANY PAGE SCRIPT RUNS, so
// that every later "open the chat" request can be signed with it. This is what lets the bridge tell
// OUR request apart from one posted by Amazon's page or by another extension (LoadFetcher posts its
// own `LOADFETCHER_OPEN_AI_CHAT` on the same window — docs/AI_CHAT_CAPTURE.md §10).
//
// 🔑 WHY A HANDSHAKE AND NOT A TOKEN IN THE MESSAGE. window.postMessage is broadcast: every listener
// on the page sees every message, and ev.source is `window` for all of them. A bare token would be
// readable by the page after its first use. A secret that never crosses postMessage, plus a
// signature per request, cannot be replayed into a different load or forged at all.
//
// 🔑 WHY THIS IS SAFE FROM THE PAGE. Both halves run at document_start, before the parser has
// executed a single page <script>. The exchange is one SYNCHRONOUS dispatchEvent whose detail
// carries the secret, so only listeners that already exist see it — and none of the page's can
// exist yet. Neither half takes part once a page <script> exists. Whichever half runs second
// completes it:
//   - bridge first: it is already listening for 'tenlane-aichat-key', deliver() reaches it now;
//   - this file first: deliver() reaches nobody; the bridge then dispatches 'tenlane-aichat-hello'
//     and onHello() delivers.
// The bridge acknowledges synchronously ('tenlane-aichat-ack'), and after that nothing here answers
// anything again.
//
// The secret lives only in this closure (isolated-world memory, invisible to the page) and is read by
// content/aiChat.js through aiChatKeyring.hex().
var aiChatKeyring = (function () {
  var _hex = null;
  var _delivered = false;
  var _answeredHello = false;

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  function onAck() {
    _delivered = true;
    detach();
  }

  // 🔴 THE ONLY WINDOW IN WHICH THE SECRET MAY BE SHOWN: before the page has any <script>. Once one
  // exists, a page script may be the one listening or asking, so from then on this file stays
  // silent for good. Measured necessity, not theory: in the headless proof a late-running copy of
  // this file answered a page's 'tenlane-aichat-hello' with the key until this check existed.
  function pageScriptsExist() {
    return !document.scripts || document.scripts.length > 0 || document.readyState !== 'loading';
  }

  function onHello() {
    // One answer, ever. A second hello can only come from something that is not our bridge.
    if (_delivered || _answeredHello) return;
    _answeredHello = true;
    if (pageScriptsExist()) { detach(); return; }
    deliver();
  }

  // The secret rides in the event's `detail`. Chrome copies a detail string into the other world, and
  // the dispatch is synchronous, so only listeners registered BEFORE this line see it — at
  // document_start that is our bridge alone. (It is not an attribute on <html>: measured in the
  // headless proof, document.documentElement is still null when a document_start script runs.)
  function deliver() {
    if (_delivered || pageScriptsExist()) return;
    document.dispatchEvent(new CustomEvent('tenlane-aichat-key', { detail: _hex }));
  }

  function detach() {
    document.removeEventListener('tenlane-aichat-hello', onHello);
    document.removeEventListener('tenlane-aichat-ack', onAck);
  }

  try {
    _hex = randomHex(32);
    if (pageScriptsExist()) throw new Error('not at document_start');
    document.addEventListener('tenlane-aichat-ack', onAck);
    document.addEventListener('tenlane-aichat-hello', onHello);
    deliver();
    // If the bridge has not appeared by the time the document is parsed, it is not coming. Stop
    // answering, so nothing that runs later can obtain the secret with a hello of its own.
    document.addEventListener('DOMContentLoaded', detach, { once: true });
  } catch (e) {
    // No logger at document_start (utils/logger.js loads at document_idle). The failure is
    // observable later: aiChatKeyring.ready() stays false and aiChat.js logs it on the first click.
    _hex = null;
  }

  return {
    // The hex secret, or null when the exchange never completed. Only aiChat.js reads it.
    hex: function () { return _delivered ? _hex : null; },
    ready: function () { return _delivered && !!_hex; }
  };
})();
