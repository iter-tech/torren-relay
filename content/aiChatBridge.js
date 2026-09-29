// aiChatBridge.js — MAIN world, run_at document_start (EXT-D10, amended EXT-D10.1 2026-09-28).
//
// Opens AMAZON'S OWN Relay Assistant chat bound to a load the dispatcher chose. The mechanism is the
// one documented in docs/AI_CHAT_CAPTURE.md §10: Amazon keeps the chat's state in a React context
// value carrying `chatBotState` and `setChatBotState`; setting `workOpportunityForDemandSupport` and
// `setIsChatBoxOpen` in that state makes Amazon's chat component re-render open on that load, and
// Amazon's own effect then sends every chat request (§9.3). This is our own implementation of that
// documented mechanism.
//
// 🔴 EXT-D10.1 — WHY THE FIRST VERSION SAID "Chat opened" AND NOTHING OPENED (live, 2026-09-28).
// Three differences from the path that is proven to work on the same page (docs/AI_CHAT_BUTTON.md §7):
//   1. It accepted a context value from a Provider's props even when no rendered component reads
//      it, and walked children first. Now ONLY values a rendered component actually consumes
//      (fiber.dependencies) count, in sibling-first order, preferring a non-empty candidate list.
//   2. It passed setChatBotState a NEW object. Now Amazon's own chatBotState object is updated IN
//      PLACE and that same object is passed to Amazon's setter — so every holder of the reference
//      sees the change, exactly as on the working path.
//   3. Its "verification" re-read the context it had itself just written, so it could only ever
//      confirm its own write. Now success also requires Amazon's chat panel to be VISIBLE.
//
// 🔴 WHAT THIS FILE NEVER DOES. It sends no request of its own. It clicks nothing and dispatches no
// DOM event at Amazon's UI. It touches no Book button or any booking element. It writes three fields
// of one state object, and only after the consumed context, the setter AND the load have all been
// found — any miss is a no-op on Amazon's page and a reported reason. It refuses to overwrite a field
// that holds a function.
//
// ⚠ FRAGILE BY NATURE: it reads React internals (`__reactFiber$`, fiber return/child/sibling,
// memoizedProps, dependencies) and Amazon's field names and chat-panel classes. Any rename turns the
// button into "Chat unavailable" — never into a wrong load, because every lookup is by exact name and id.
//
// MESSAGING. Requests arrive by window.postMessage from content/aiChat.js and are accepted ONLY when
// signed (HMAC-SHA-256) with the secret exchanged at document_start with content/aiChatKey.js — see
// that file for why the exchange cannot be observed by the page. Unsigned, stale, replayed or
// mis-signed messages are dropped silently, and so is anything of another type (e.g. LoadFetcher's
// LOADFETCHER_OPEN_AI_CHAT). Results go back signed the same way, diagnostics included.
//
// No logger in this world (same as networkObserver.js); outcomes are reported to the isolated side,
// which logs them.
(function () {
  if (window.__tenlaneAiChatBridge) return;
  // Non-enumerable marker so a second injection is a no-op; it carries no capability.
  try { Object.defineProperty(window, '__tenlaneAiChatBridge', { value: true }); } catch (e) { return; }

  var MSG_OPEN   = 'tenlane-aichat-open-v1';
  var MSG_RESULT = 'tenlane-aichat-result-v1';
  var MSG_PROBE  = 'tenlane-aichat-probe-input-v1';   // EXT-D10.2
  var MAX_AGE_MS = 15000;
  var VERIFY_WINDOW_MS = 1000;
  var VERIFY_STEP_MS   = 100;
  var MAX_FIBERS = 300000;
  var MAX_ROOTS  = 8;
  var PROPS_WALK_LEVELS = 60;

  // Amazon's chat panel. Class/id names read from the dark-mode stylesheet the competitor ships for
  // Amazon's chat (samples/competitor-ext, docs/AI_CHAT_CAPTURE.md §10.4). ⚠ Not yet seen live by us.
  var CHAT_PANEL_SELECTORS = [
    '.chat-box-position', '.chatbot-body', '.bot-header', '#demand-support-chat-action-panel-input'
  ];

  // Captured at document_start, before any page script can replace them.
  var subtle    = window.crypto && window.crypto.subtle;
  var importKey = subtle && subtle.importKey.bind(subtle);
  var hmacSign  = subtle && subtle.sign.bind(subtle);
  var hmacCheck = subtle && subtle.verify.bind(subtle);
  var encoder   = new TextEncoder();
  var objKeys   = Object.keys;
  var toJson    = JSON.stringify;
  var nowMs     = Date.now;
  var post      = window.postMessage.bind(window);

  var _key = null;          // Promise<CryptoKey> once the handshake has completed
  var _seen = new Map();    // requestId -> ts, replay guard (pruned by age)
  var _busy = false;

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  // ── the handshake (see content/aiChatKey.js) ───────────────────────────────────────────────
  function onKey(ev) {
    if (_key) return;
    var hex = ev && ev.detail;
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex) || !importKey) return;
    // Only while no page script can have run yet. Both halves run at document_start, so a key
    // arriving later than that did not come from our isolated world.
    if (document.scripts && document.scripts.length > 0) return;
    _key = importKey('raw', hexToBytes(hex), { name: 'HMAC', hash: 'SHA-256' }, false,
                     ['sign', 'verify']);
    document.removeEventListener('tenlane-aichat-key', onKey);
    document.dispatchEvent(new CustomEvent('tenlane-aichat-ack'));
  }
  try {
    document.addEventListener('tenlane-aichat-key', onKey);
    document.dispatchEvent(new CustomEvent('tenlane-aichat-hello'));
  } catch (e) { /* no handshake → every request is refused as unsigned */ }

  function canonOpen(d)   { return ['open', d.requestId, d.loadId, d.ts].join('\n'); }
  function canonProbe(d)  { return ['probe-input', d.requestId, d.ts, d.text].join('\n'); }
  // The diagnostics are signed too — a forged reply cannot plant a misleading log line.
  function canonResult(r) {
    return ['result', r.requestId, r.ok ? '1' : '0', r.result, r.reason || '', r.source || '',
            r.diagJson || ''].join('\n');
  }

  async function verifySigned(d, canon) {
    if (!_key || typeof d.sig !== 'string' || !/^[0-9a-f]{64}$/.test(d.sig)) return false;
    return hmacCheck('HMAC', await _key, hexToBytes(d.sig), encoder.encode(canon(d)));
  }

  // EXT-D10.2 — did Amazon's React REGISTER the text in #ra-input, or is it only painted there?
  // Reads the textarea's own React props (`__reactProps$…`, refreshed on every commit). A controlled
  // input is registered only when props.value equals the text; an uncontrolled one keeps its value in
  // the DOM, which is then what Amazon reads. READ-ONLY: nothing is written here.
  function probeInput(expected) {
    var ta = document.getElementById('ra-input');
    if (!ta) return { ok: false, result: 'not-registered', reason: 'no-ra-input', diag: {} };
    var props = null, ks = objKeys(ta);
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].indexOf('__reactProps$') === 0) { props = ta[ks[i]]; break; }
    }
    var domMatches = ta.value === expected;
    if (!props || typeof props !== 'object') {
      return { ok: domMatches, result: domMatches ? 'registered' : 'not-registered',
               reason: domMatches ? 'no-react-props (dom value kept)' : 'no-react-props',
               diag: { controlled: null, domMatches: domMatches } };
    }
    var controlled = Object.prototype.hasOwnProperty.call(props, 'value');
    var propsMatch = controlled ? props.value === expected : null;
    var ok = controlled ? propsMatch === true : domMatches;
    return { ok: ok, result: ok ? 'registered' : 'not-registered',
             reason: ok ? '' : (controlled ? 'react-props-value-differs' : 'dom-value-lost'),
             diag: { controlled: controlled, propsMatch: propsMatch, domMatches: domMatches,
                     hasOnChange: typeof props.onChange === 'function' } };
  }

  async function reply(r) {
    try {
      r.type = MSG_RESULT;
      r.sig = bytesToHex(await hmacSign('HMAC', await _key, encoder.encode(canonResult(r))));
      post(r, window.location.origin);
    } catch (e) { /* nothing more can be said — the isolated side times out and reports that */ }
  }

  // ── React fiber reading ─────────────────────────────────────────────────────────────────────
  function fiberOf(node) {
    if (!node) return null;
    var ks = objKeys(node);
    for (var i = 0; i < ks.length; i++) {
      if (ks[i].indexOf('__reactFiber$') === 0) return node[ks[i]];
    }
    return null;
  }

  // From any fiber to its root's CURRENT (committed) tree.
  function currentRootOf(fiber) {
    var f = fiber, guard = 0;
    while (f && f.return && guard++ < 100000) f = f.return;
    if (!f) return null;
    var fr = f.stateNode;
    return (fr && fr.current) ? fr.current : f;
  }

  function isChatContextValue(v) {
    return !!v && typeof v === 'object' && !!v.chatBotState &&
           typeof v.chatBotState === 'object' && typeof v.setChatBotState === 'function';
  }

  // Roots in a fixed order: the page's own first (document.body, then the first element in document
  // order that has a fiber — the same starting point as the working path), then the card's, then
  // any other distinct root.
  function findRoots(loadId) {
    var roots = [];
    function addFrom(node) {
      var f = fiberOf(node);
      if (!f) return false;
      var r = currentRootOf(f);
      if (r && roots.indexOf(r) === -1) roots.push(r);
      return true;
    }
    if (!addFrom(document.body)) {
      var all0 = document.getElementsByTagName('*');
      for (var j = 0; j < all0.length; j++) if (addFrom(all0[j])) break;
    }
    addFrom(document.getElementById(loadId));
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length && roots.length < MAX_ROOTS; i++) addFrom(all[i]);
    return roots;
  }

  // Scans every root. CONSUMED context values (read by a rendered component through
  // fiber.dependencies) are candidates; Provider-only values are counted for the log and NEVER chosen
  // — a provider nobody reads cannot open anything, and writing to one is exactly how the first version
  // "succeeded" with the chat still closed. Order: depth-first, SIBLING before CHILD.
  function scanChatContexts(roots) {
    var consumed = [], providerOnly = [], visited = 0;
    for (var r = 0; r < roots.length; r++) {
      var stack = [roots[r]];
      while (stack.length && visited < MAX_FIBERS) {
        var f = stack.pop();
        visited++;
        var dep = f.dependencies && f.dependencies.firstContext;
        for (var n = 0; dep && n < 64; n++, dep = dep.next) {
          var v = dep.memoizedValue;
          if (isChatContextValue(v) && consumed.indexOf(v) === -1) consumed.push(v);
        }
        var p = f.memoizedProps;
        if (p && typeof p === 'object' && isChatContextValue(p.value) &&
            providerOnly.indexOf(p.value) === -1) {
          providerOnly.push(p.value);
        }
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
    }
    providerOnly = providerOnly.filter(function (v) { return consumed.indexOf(v) === -1; });
    var chosen = -1;
    for (var i = 0; i < consumed.length; i++) {
      var list = consumed[i].chatBotCandidateList;
      if (Array.isArray(list) && list.length) { chosen = i; break; }
    }
    if (chosen === -1 && consumed.length) chosen = 0;
    return { consumed: consumed, providerOnly: providerOnly.length, chosen: chosen, visited: visited };
  }

  function sameId(o, loadId) { return !!o && typeof o === 'object' && String(o.id) === loadId; }

  function findInList(list, loadId) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (sameId(list[i], loadId)) return list[i];
    return null;
  }

  // Amazon's own props on the card's ancestors — the object Amazon itself rendered the card from.
  function findInCardProps(loadId) {
    var f = fiberOf(document.getElementById(loadId));
    for (var lvl = 0; f && lvl < PROPS_WALK_LEVELS; lvl++, f = f.return) {
      var p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      var ks = objKeys(p);
      for (var i = 0; i < ks.length; i++) {
        var o = p[ks[i]];
        if (sameId(o, loadId) && Array.isArray(o.loads)) return o;
      }
    }
    return null;
  }

  function locateLoad(ctx, loadId) {
    var wo = findInList(ctx.chatBotCandidateList, loadId);
    if (wo) return { wo: wo, source: 'amazon-candidate-list' };
    wo = findInList(ctx.workOpportunityList, loadId);
    if (wo) return { wo: wo, source: 'amazon-wo-list' };
    wo = findInCardProps(loadId);
    if (wo) return { wo: wo, source: 'amazon-card-props' };
    return null;
  }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array(' + v.length + ')';
    return typeof v;
  }

  function panelVisible() {
    for (var i = 0; i < CHAT_PANEL_SELECTORS.length; i++) {
      var el = document.querySelector(CHAT_PANEL_SELECTORS[i]);
      if (el && el.getClientRects().length > 0) return CHAT_PANEL_SELECTORS[i];
    }
    return null;
  }

  function stateApplied(loadId) {
    var s = scanChatContexts(findRoots(loadId));
    var ctx = s.chosen >= 0 ? s.consumed[s.chosen] : null;
    var st = ctx && ctx.chatBotState;
    return !!st && sameId(st.workOpportunityForDemandSupport, loadId) && st.setIsChatBoxOpen === true;
  }

  async function openChat(loadId) {
    var diag = {};
    var roots = findRoots(loadId);
    diag.roots = roots.length;
    if (!roots.length) return { ok: false, result: 'unavailable', reason: 'no-react-root', diag: diag };

    var scan = scanChatContexts(roots);
    diag.contextsConsumed = scan.consumed.length;
    diag.contextsProviderOnly = scan.providerOnly;
    diag.fibers = scan.visited;
    if (scan.chosen < 0) {
      return { ok: false, result: 'unavailable', diag: diag,
               reason: scan.providerOnly ? 'no-consumed-chat-context' : 'no-chat-context' };
    }
    diag.chosen = scan.chosen;
    var ctx = scan.consumed[scan.chosen];
    var st = ctx.chatBotState;
    diag.types = {
      setChatBotState: typeOf(ctx.setChatBotState),
      chatBotCandidateList: typeOf(ctx.chatBotCandidateList),
      workOpportunityList: typeOf(ctx.workOpportunityList),
      workOpportunityForDemandSupport: typeOf(st.workOpportunityForDemandSupport),
      setIsChatBoxOpen: typeOf(st.setIsChatBoxOpen),
      setShowBadgeOnIcon: typeOf(st.setShowBadgeOnIcon)
    };
    diag.keysBefore = objKeys(st);

    var hit = locateLoad(ctx, loadId);
    if (!hit) return { ok: false, result: 'unavailable', reason: 'load-not-in-amazon-state', diag: diag };

    // These are data fields on the working path (it assigns true/false to them). If Amazon ever
    // makes one a function, overwriting it would break Amazon's own code — refuse instead.
    if (typeof st.setIsChatBoxOpen === 'function' || typeof st.setShowBadgeOnIcon === 'function') {
      return { ok: false, result: 'unavailable', reason: 'open-flag-is-a-function', source: hit.source, diag: diag };
    }

    diag.panelBefore = panelVisible();

    // IN PLACE, then Amazon's setter with THE SAME object — see the header, difference 2.
    st.workOpportunityForDemandSupport = hit.wo;
    st.setIsChatBoxOpen = true;
    st.setShowBadgeOnIcon = false;
    ctx.setChatBotState(st);
    diag.keysAfter = objKeys(st);

    // Success only when BOTH hold within ~1 s: the consumed state says open-on-this-load, AND Amazon's
    // chat panel is visible. Either alone is not proof — difference 3.
    var applied = false, panel = null, waited = 0;
    while (waited <= VERIFY_WINDOW_MS) {
      await new Promise(function (res) { setTimeout(res, VERIFY_STEP_MS); });
      waited += VERIFY_STEP_MS;
      applied = stateApplied(loadId);
      panel = panelVisible();
      if (applied && panel) break;
    }
    diag.verify = { stateApplied: applied, panel: panel, waitedMs: waited };
    var ok = applied && !!panel;
    return {
      ok: ok,
      result: ok ? 'opened' : 'set-not-applied',
      reason: ok ? '' : (!applied ? 'state-not-applied' : 'panel-not-seen'),
      source: hit.source,
      diag: diag
    };
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (ev.source !== window || !d || (d.type !== MSG_OPEN && d.type !== MSG_PROBE)) return;
    (async function () {
      if (typeof d.requestId !== 'string' || !/^[0-9a-f]{32}$/.test(d.requestId)) return;
      if (typeof d.ts !== 'number') return;
      var isProbe = d.type === MSG_PROBE;
      if (isProbe ? typeof d.text !== 'string' : (typeof d.loadId !== 'string' || !d.loadId)) return;
      var now = nowMs();
      if (Math.abs(now - d.ts) > MAX_AGE_MS || _seen.has(d.requestId)) return;
      if (!(await verifySigned(d, isProbe ? canonProbe : canonOpen))) return;   // forged or unsigned — silent
      _seen.set(d.requestId, now);
      _seen.forEach(function (t, id) { if (now - t > MAX_AGE_MS * 2) _seen.delete(id); });

      var r;
      if (isProbe) {
        try { r = probeInput(d.text); }
        catch (e) { r = { ok: false, result: 'not-registered', reason: 'error ' + ((e && e.name) || 'Error'), diag: {} }; }
      } else if (_busy) {
        r = { ok: false, result: 'unavailable', reason: 'busy', diag: {} };
      } else {
        _busy = true;
        try { r = await openChat(d.loadId); }
        catch (e) { r = { ok: false, result: 'unavailable', reason: 'error ' + ((e && e.name) || 'Error'), diag: {} }; }
        finally { _busy = false; }
      }
      var out = { requestId: d.requestId, ok: r.ok, result: r.result, reason: r.reason || '',
                  source: r.source || '', diagJson: toJson(r.diag || {}) };
      await reply(out);
    })();
  });
})();
