// aiChat.js — ISOLATED world, document_idle (EXT-D10, 2026-09-28).
//
// The "AI Chat" button: on each negotiable load card in Amazon's list, and in the bottom action row
// of our inline panel. One click asks content/aiChatBridge.js (MAIN world) to open AMAZON'S OWN
// Relay Assistant already bound to that load — the mechanism in docs/AI_CHAT_CAPTURE.md §10.
//
// WHICH LOADS. Only a load whose captured record says `demandSupportEnabled === true` (projected by
// networkObserver.js from Amazon's search response). No record, or anything but a literal true, and
// there is no button — the button never appears on a load the assistant cannot take.
//
// 🔴 THIS FILE CLICKS NOTHING OF AMAZON'S AND SENDS NO REQUEST. It builds our own buttons, signs a
// request with the secret from content/aiChatKey.js, posts it to the bridge, and shows the answer on
// the button. The card button stops its own click from propagating, so Amazon never sees it as a
// card click and our inline panel does not toggle.
//
// ⚠ NOTHING HERE FALLS BACK TO CLICKING AMAZON'S UI. When the bridge cannot find the context, the
// setter or the load, the button says "Chat unavailable" and the reason is logged.
//
// THE PHRASE PANEL HOOK. aiChat.onChatOpened(fn) registers fn(loadId), called after the chat is
// confirmed open. The later phrase panel registers there and reads phrases.phrasesForLoad(loadId)
// (utils/phrases.js). Nothing registers yet, deliberately.
var aiChat = (function () {
  var MSG_OPEN   = 'tenlane-aichat-open-v1';
  var MSG_RESULT = 'tenlane-aichat-result-v1';
  var MSG_PROBE  = 'tenlane-aichat-probe-input-v1';
  var REPLY_TIMEOUT_MS = 4000;
  var STATUS_HOLD_MS   = 3500;
  var PAINT_DEBOUNCE_MS = 250;
  var LOG_MAX = 30;
  var LABEL = 'AI Chat';

  var TESTID_CARD  = 'ext-ai-chat-card';
  var TESTID_PANEL = 'ext-action-ai-chat';

  var _cryptoKey = null;      // Promise<CryptoKey>
  var _pending = {};          // requestId -> { resolve, timer }
  var _openedHooks = [];
  var _events = [];           // last LOG_MAX ai-chat-open events, for __EXT_DEBUG.aiChatLog()
  var _paintTimer = null;
  var _observer = null;

  function mask(id) { return id ? String(id).slice(0, 4) + '***' : null; }

  function hex(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }
  function unhex(h) {
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function key() {
    if (_cryptoKey) return _cryptoKey;
    var k = (typeof aiChatKeyring !== 'undefined') ? aiChatKeyring.hex() : null;
    if (!k) return null;
    _cryptoKey = crypto.subtle.importKey('raw', unhex(k), { name: 'HMAC', hash: 'SHA-256' }, false,
                                         ['sign', 'verify']);
    return _cryptoKey;
  }

  // Same canonical strings as the bridge. Any change here must be made there too.
  function canonOpen(d) { return ['open', d.requestId, d.loadId, d.ts].join('\n'); }
  function canonProbe(d) { return ['probe-input', d.requestId, d.ts, d.text].join('\n'); }
  function canonResult(r) {
    return ['result', r.requestId, r.ok ? '1' : '0', r.result, r.reason || '', r.source || '',
            r.diagJson || ''].join('\n');
  }

  // ── eligibility ───────────────────────────────────────────────────────────────────────────
  function isEligible(loadId) {
    logger.log('aiChat', 'isEligible called');
    try {
      if (!loadId || typeof getLoadRecord !== 'function') return false;
      var rec = getLoadRecord(loadId);
      return !!rec && rec.demandSupportEnabled === true;
    } catch (e) {
      logger.error('aiChat', 'isEligible failed', { error: e, loadId: mask(loadId) });
      return false;
    }
  }

  function signedIn() {
    return typeof isAuthGateActiveSync !== 'function' || isAuthGateActiveSync() === true;
  }

  // ── the debug log ─────────────────────────────────────────────────────────────────────────
  // `name` is the event type: 'ai-chat-open' (default), and since EXT-D10.2 'phrase-insert',
  // 'phrase-edit' and 'phrase-failed' from content/aiChatPhrases.js — one log for the whole feature.
  function logEvent(ev, name) {
    ev.event = name || 'ai-chat-open';
    _events.push(ev);
    while (_events.length > LOG_MAX) _events.shift();
    // `notice`, not `log`: one line per dispatcher click, and it must survive DEBUG_LEVEL 1 so a
    // live test can be read from the console without changing the build.
    logger.notice('aiChat', ev.event, ev);
  }

  // ── talking to the bridge ─────────────────────────────────────────────────────────────────
  function onMessage(ev) {
    var d = ev.data;
    if (ev.source !== window || !d || d.type !== MSG_RESULT) return;
    var p = _pending[d.requestId];
    if (!p) return;                                     // not ours, or already settled
    var k = key();
    if (!k || typeof d.sig !== 'string' || !/^[0-9a-f]{64}$/.test(d.sig)) return;
    k.then(function (ck) {
      return crypto.subtle.verify('HMAC', ck, unhex(d.sig), new TextEncoder().encode(canonResult(d)));
    }).then(function (valid) {
      if (!valid || !_pending[d.requestId]) return;     // forged answers are ignored
      clearTimeout(p.timer);
      delete _pending[d.requestId];
      var diag = {};
      try { diag = JSON.parse(d.diagJson || '{}'); } catch (e2) { diag = { unparseable: true }; }
      p.resolve({ ok: d.ok === true, result: d.result, reason: d.reason || '', source: d.source || '',
                  diag: diag });
    }).catch(function (e) {
      logger.error('aiChat', 'verifying the bridge reply failed', { error: e });
    });
  }

  async function requestOpen(loadId) {
    logger.log('aiChat', 'requestOpen called', { loadId: mask(loadId) });
    return signedRequest({ type: MSG_OPEN, loadId: String(loadId) }, canonOpen);
  }

  // EXT-D10.2: asks the bridge whether Amazon's React REGISTERED the text in #ra-input — the
  // textarea's React props, read in the page world. The text is already visible in the DOM, so
  // sending it here discloses nothing new.
  function probeInput(text) {
    logger.log('aiChat', 'probeInput called');
    return signedRequest({ type: MSG_PROBE, text: String(text) }, canonProbe);
  }

  async function signedRequest(msg, canon) {
    var k = key();
    if (!k) return { ok: false, result: 'unavailable', reason: 'no-bridge-key', source: '', diag: {} };
    var rid = new Uint8Array(16);
    crypto.getRandomValues(rid);
    msg.requestId = hex(rid);
    msg.ts = Date.now();
    var sig = await crypto.subtle.sign('HMAC', await k, new TextEncoder().encode(canon(msg)));
    msg.sig = hex(sig);
    return new Promise(function (resolve) {
      _pending[msg.requestId] = {
        resolve: resolve,
        timer: setTimeout(function () {
          delete _pending[msg.requestId];
          resolve({ ok: false, result: 'unavailable', reason: 'no-bridge-response', source: '', diag: {} });
        }, REPLY_TIMEOUT_MS)
      };
      window.postMessage(msg, window.location.origin);
    });
  }

  // ── the click ─────────────────────────────────────────────────────────────────────────────
  function setStatus(btn, text, state) {
    btn.textContent = text;
    if (state) btn.setAttribute('data-state', state); else btn.removeAttribute('data-state');
  }

  async function openFor(loadId, btn, where) {
    logger.log('aiChat', 'openFor called', { loadId: mask(loadId), where: where });
    if (btn.getAttribute('data-busy') === 'true') return;
    btn.setAttribute('data-busy', 'true');
    setStatus(btn, 'Opening…', 'busy');
    var r;
    try {
      r = await requestOpen(loadId);
    } catch (e) {
      logger.error('aiChat', 'openFor failed', { error: e, loadId: mask(loadId) });
      r = { ok: false, result: 'unavailable', reason: 'error ' + ((e && e.name) || 'Error'), source: '' };
    }
    var ev = { loadId: mask(loadId), where: where, source: r.source || null, result: r.result };
    if (r.reason) ev.reason = r.reason;
    // EXT-D10.1 diagnostics — names and types only, never values. Flattened so console.table and a
    // copied log line read without expanding anything.
    var g = r.diag || {};
    if (g.contextsConsumed !== undefined) ev.contexts = g.contextsConsumed + ' consumed / ' +
      (g.contextsProviderOnly || 0) + ' provider-only';
    if (g.chosen !== undefined) ev.chosen = g.chosen;
    if (g.keysBefore) ev.keysBefore = g.keysBefore.join(',');
    if (g.keysAfter) ev.keysAfter = g.keysAfter.join(',');
    if (g.types) ev.types = Object.keys(g.types).map(function (k) { return k + ':' + g.types[k]; }).join(' ');
    if (g.verify) ev.verify = 'state ' + (g.verify.stateApplied ? 'yes' : 'NO') + ', panel ' +
      (g.verify.panel || 'NOT SEEN') + ', ' + g.verify.waitedMs + 'ms';
    if (g.panelBefore) ev.panelBefore = g.panelBefore;
    logEvent(ev);

    setStatus(btn, r.ok ? 'Chat opened' : 'Chat unavailable', r.ok ? 'ok' : 'unavailable');
    setTimeout(function () {
      btn.removeAttribute('data-busy');
      setStatus(btn, LABEL, null);
    }, STATUS_HOLD_MS);

    if (r.ok) {
      for (var i = 0; i < _openedHooks.length; i++) {
        try { _openedHooks[i](loadId); }
        catch (e) { logger.error('aiChat', 'onChatOpened hook threw', { error: e, loadId: mask(loadId) }); }
      }
    }
    return r;
  }

  // ── building the buttons ──────────────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('ext-ai-chat-style')) return;
    var style = document.createElement('style');
    style.id = 'ext-ai-chat-style';
    style.setAttribute('data-testid', 'ext-ai-chat-style');
    style.textContent =
      // EXT-D10.2: LEFT of the price, 20 px clear of it (Ihor). The price's own element and styles
      // are untouched; only this button's margin makes the gap.
      '.ext-ai-chat-card{' +
        'display:inline-block;margin:0 20px 0 0;padding:1px 7px;vertical-align:middle;' +
        'font-size:11px;font-weight:600;line-height:16px;white-space:nowrap;cursor:pointer;' +
        'color:var(--ext-accent);background:transparent;' +
        'border:1px solid var(--ext-accent);border-radius:var(--ext-radius-sm);' +
      '}' +
      '.ext-ai-chat-card:hover{background:var(--ext-accent-bg);}' +
      '.ext-ai-chat-card:focus-visible{outline:2px solid var(--ext-accent);outline-offset:2px;}' +
      '.ext-ai-chat-card[data-state="unavailable"],' +
      '.ext-action-btn--aichat[data-state="unavailable"]{color:#b3261e;border-color:#b3261e;}' +
      // Panel variant: same size and colours as the row's icon buttons, text instead of an icon.
      // EXT-D10.2: ONE LINE, always. Live it wrapped to "AI" / "Chat". ROOT CAUSE (found by the
      // headless measurement): this stylesheet is injected at card-paint time, BEFORE the panel's own
      // (inlinePanel.js injectPanelStyle), so the panel's `.ext-action-btn{width:28px}` — same
      // specificity, later in the document — won, and "AI Chat" was squeezed into a 28 px box. The
      // selector below out-ranks it regardless of order; nowrap + no shrink keep one line, and the
      // row's 28 px height keeps it level with the camera/map/post icons.
      '.ext-action-bar .ext-action-btn.ext-action-btn--aichat{' +
        'width:auto;min-width:0;height:28px;padding:0 8px;font-size:11px;font-weight:600;' +
        'letter-spacing:0.02em;line-height:28px;white-space:nowrap;flex:0 0 auto;color:var(--ext-accent);' +
      '}' +
      '.ext-action-bar .ext-action-btn.ext-action-btn--aichat:hover{color:var(--ext-accent-hover);}';
    (document.head || document.documentElement).appendChild(style);
  }

  function makeButton(loadId, where) {
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-testid', where === 'card' ? TESTID_CARD : TESTID_PANEL);
    btn.setAttribute('data-load-id', loadId);
    btn.setAttribute('aria-label', 'Open Amazon\'s Relay Assistant for this load');
    btn.setAttribute('title', 'Open Amazon\'s Relay Assistant for this load');
    btn.className = where === 'card' ? 'ext-ai-chat-card' : 'ext-action-btn ext-action-btn--aichat';
    btn.textContent = LABEL;
    // Keep the gesture ours: neither Amazon's card handler nor our panel toggle may see it.
    ['pointerdown', 'mousedown', 'mouseup'].forEach(function (t) {
      btn.addEventListener(t, function (ev) { ev.stopPropagation(); });
    });
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      openFor(loadId, btn, where);
    });
    return btn;
  }

  // Panel: called by inlinePanel.js renderPanelFromData() with the panel's own action bar.
  function decoratePanelBar(bar, loadId) {
    logger.log('aiChat', 'decoratePanelBar called', { loadId: mask(loadId) });
    try {
      if (!bar || !loadId) return null;
      var old = bar.querySelector('[data-testid="' + TESTID_PANEL + '"]');
      if (old) old.parentNode.removeChild(old);
      if (!signedIn() || !isEligible(loadId)) return null;
      injectStyle();
      var btn = makeButton(loadId, 'panel');
      // After the three icons, before Fast Book if a build ever has one.
      var fb = bar.querySelector('[data-testid="ext-action-fastbook"]');
      bar.insertBefore(btn, fb || null);
      return btn;
    } catch (e) {
      logger.error('aiChat', 'decoratePanelBar failed', { error: e, loadId: mask(loadId) });
      return null;
    }
  }

  // Cards: one compact button just before (left of) Amazon's payout, on eligible cards only. Idempotent — safe to
  // run on every mutation burst.
  function paintCards() {
    logger.log('aiChat', 'paintCards called');
    try {
      var existing = document.querySelectorAll('[data-testid="' + TESTID_CARD + '"]');
      if (!signedIn() || typeof readMainCardElements !== 'function') {
        existing.forEach(function (b) { b.parentNode && b.parentNode.removeChild(b); });
        return;
      }
      var cards = readMainCardElements();
      var keep = new Set();
      for (var i = 0; i < cards.length; i++) {
        var id = cards[i].id, el = cards[i].el;
        var btn = el.querySelector('[data-testid="' + TESTID_CARD + '"]');
        if (!isEligible(id)) continue;
        if (btn && btn.getAttribute('data-load-id') === id) { keep.add(btn); continue; }
        var payout = el.querySelector('.wo-total_payout');
        if (!payout || !payout.parentNode) continue;       // no known anchor → no button, no guess
        injectStyle();
        btn = makeButton(id, 'card');
        payout.parentNode.insertBefore(btn, payout);      // EXT-D10.2: left of the price
        keep.add(btn);
      }
      existing.forEach(function (b) {
        if (!keep.has(b) && b.parentNode) b.parentNode.removeChild(b);
      });
    } catch (e) {
      logger.error('aiChat', 'paintCards failed', { error: e });
    }
  }

  function schedulePaint() {
    if (_paintTimer !== null) clearTimeout(_paintTimer);
    _paintTimer = setTimeout(function () { _paintTimer = null; paintCards(); }, PAINT_DEBOUNCE_MS);
  }

  function isOurs(node) {
    return node.nodeType !== 1 ||
      (node.getAttribute && /^ext-/.test(node.getAttribute('data-testid') || '')) ||
      (node.id && node.id.indexOf('ext-') === 0);
  }

  function start() {
    logger.log('aiChat', 'start called');
    try {
      window.addEventListener('message', onMessage);
      // New records arrive on networkObserver's message; cityAssign merges them on the same event,
      // and the debounce lets that happen first.
      window.addEventListener('message', function (ev) {
        if (ev.source === window && ev.data && ev.data.__extRelayCityCoords === true) schedulePaint();
      });
      if (typeof isLoadBoardPage === 'function' && !isLoadBoardPage()) return;
      _observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var a = muts[i].addedNodes, r = muts[i].removedNodes;
          for (var j = 0; j < a.length; j++) if (!isOurs(a[j])) { schedulePaint(); return; }
          for (var k = 0; k < r.length; k++) if (!isOurs(r[k])) { schedulePaint(); return; }
        }
      });
      _observer.observe(document.body, { childList: true, subtree: true });
      if (typeof onAuthGateChange === 'function') onAuthGateChange(schedulePaint);
      schedulePaint();
    } catch (e) {
      logger.error('aiChat', 'start failed', { error: e });
    }
  }

  function onChatOpened(fn) {
    logger.log('aiChat', 'onChatOpened called');
    if (typeof fn === 'function') _openedHooks.push(fn);
  }

  function debugLog() {
    console.log('[EXT] AI chat events — ai-chat-open / phrase-* (newest last), bridge key ' +
      ((typeof aiChatKeyring !== 'undefined' && aiChatKeyring.ready()) ? 'READY' : 'MISSING'));
    console.table(_events);
    return _events.slice();
  }

  start();

  return {
    isEligible: isEligible,
    decoratePanelBar: decoratePanelBar,
    paintCards: paintCards,
    openFor: openFor,
    onChatOpened: onChatOpened,
    debugLog: debugLog,
    logEvent: logEvent,
    probeInput: probeInput,
    mask: mask
  };
})();

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.aiChatLog = aiChat.debugLog;
