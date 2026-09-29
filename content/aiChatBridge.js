// aiChatBridge.js — MAIN world, run_at document_start (EXT-D10, 2026-09-28).
//
// Opens AMAZON'S OWN Relay Assistant chat bound to a load the dispatcher chose. The mechanism is the
// one documented in docs/AI_CHAT_CAPTURE.md §10: Amazon keeps the chat's state in a React context
// value carrying `chatBotState` and `setChatBotState`; setting `workOpportunityForDemandSupport` and
// `setIsChatBoxOpen` in that state makes Amazon's chat component re-render open on that load, and
// Amazon's own effect then sends every chat request (§9.3). This is our own implementation of that
// documented mechanism.
//
// 🔴 WHAT THIS FILE NEVER DOES. It sends no request of its own. It clicks nothing and dispatches no
// DOM event at Amazon's UI. It touches no Book button or any booking element. It writes nothing but
// the one state object below, and only after the context, the setter AND the load have all been
// found — any miss is a no-op on Amazon's page and a reported reason.
//
// ⚠ FRAGILE BY NATURE: it reads React internals (`__reactFiber$`, fiber return/child/sibling,
// memoizedProps, dependencies) and Amazon's field names. Any rename on Amazon's side turns the button
// into "Chat unavailable" — never into a wrong action, because every lookup is by exact name and id.
//
// MESSAGING. Requests arrive by window.postMessage from content/aiChat.js and are accepted ONLY when
// signed (HMAC-SHA-256) with the secret exchanged at document_start with content/aiChatKey.js — see
// that file for why the exchange cannot be observed by the page. Unsigned, stale, replayed or
// mis-signed messages are dropped silently, and so is anything of another type (e.g. LoadFetcher's
// LOADFETCHER_OPEN_AI_CHAT). Results go back signed the same way.
//
// No logger in this world (same as networkObserver.js); outcomes are reported to the isolated side,
// which logs them.
(function () {
  if (window.__tenlaneAiChatBridge) return;
  // Non-enumerable marker so a second injection is a no-op; it carries no capability.
  try { Object.defineProperty(window, '__tenlaneAiChatBridge', { value: true }); } catch (e) { return; }

  var MSG_OPEN   = 'tenlane-aichat-open-v1';
  var MSG_RESULT = 'tenlane-aichat-result-v1';
  var MAX_AGE_MS = 15000;
  var CONFIRM_DELAY_MS = 400;
  var MAX_FIBERS = 300000;
  var MAX_ROOTS  = 8;
  var PROPS_WALK_LEVELS = 40;

  // Captured at document_start, before any page script can replace them.
  var subtle    = window.crypto && window.crypto.subtle;
  var importKey = subtle && subtle.importKey.bind(subtle);
  var hmacSign  = subtle && subtle.sign.bind(subtle);
  var hmacCheck = subtle && subtle.verify.bind(subtle);
  var encoder   = new TextEncoder();
  var objKeys   = Object.keys;
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
  function canonResult(r) {
    return ['result', r.requestId, r.ok ? '1' : '0', r.result, r.reason || '', r.source || ''].join('\n');
  }

  async function verifyOpen(d) {
    if (!_key || typeof d.sig !== 'string' || !/^[0-9a-f]{64}$/.test(d.sig)) return false;
    return hmacCheck('HMAC', await _key, hexToBytes(d.sig), encoder.encode(canonOpen(d)));
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

  // From any fiber to its root's CURRENT tree. A DOM node's fiber pointer can be the alternate
  // (the previous render); the root's stateNode.current is always the committed tree, so state read
  // from it is never stale.
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

  // Every distinct React root reachable from the card and from the page. Amazon may mount more than
  // one app; the chat's context need not live in the same root as the board.
  function findRoots(loadId) {
    var roots = [];
    function addFrom(node) {
      var f = fiberOf(node);
      if (!f) return;
      var r = currentRootOf(f);
      if (r && roots.indexOf(r) === -1) roots.push(r);
    }
    addFrom(document.getElementById(loadId));
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length && roots.length < MAX_ROOTS; i++) addFrom(all[i]);
    return roots;
  }

  // Depth-first over one tree. Collects context values from Provider props and from consumers'
  // context dependencies. Prefers a value whose candidate list is non-empty.
  function findChatContext(roots) {
    var best = null, visited = 0;
    for (var r = 0; r < roots.length; r++) {
      var stack = [roots[r]];
      while (stack.length && visited < MAX_FIBERS) {
        var f = stack.pop();
        visited++;
        var p = f.memoizedProps;
        if (p && typeof p === 'object' && isChatContextValue(p.value)) {
          if (!best) best = p.value;
          if (Array.isArray(p.value.chatBotCandidateList) && p.value.chatBotCandidateList.length) {
            return { ctx: p.value, visited: visited };
          }
        }
        var dep = f.dependencies && f.dependencies.firstContext;
        for (var n = 0; dep && n < 64; n++, dep = dep.next) {
          if (isChatContextValue(dep.memoizedValue)) {
            if (!best) best = dep.memoizedValue;
            var list = dep.memoizedValue.chatBotCandidateList;
            if (Array.isArray(list) && list.length) return { ctx: dep.memoizedValue, visited: visited };
          }
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    }
    return { ctx: best, visited: visited };
  }

  function sameId(o, loadId) { return !!o && typeof o === 'object' && String(o.id) === loadId; }

  // The shape the chat needs: its requests carry workOpportunityId, version, majorVersion and
  // optionId (§9.1), so the object must at least be a work opportunity with that id and loads[].
  function isWorkOpportunity(o, loadId) { return sameId(o, loadId) && Array.isArray(o.loads); }

  function findInList(list, loadId) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (isWorkOpportunity(list[i], loadId)) return list[i];
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
        if (isWorkOpportunity(p[ks[i]], loadId)) return p[ks[i]];
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

  function shapeNote(wo) {
    var missing = [];
    if (typeof wo.version !== 'number') missing.push('version');
    if (wo.majorVersion === undefined) missing.push('majorVersion');
    if (wo.workOpportunityOptionId === undefined) missing.push('workOpportunityOptionId');
    return missing.length ? 'missing ' + missing.join(',') : '';
  }

  async function openChat(loadId) {
    var roots = findRoots(loadId);
    if (!roots.length) return { ok: false, result: 'unavailable', reason: 'no-react-root' };
    var found = findChatContext(roots);
    if (!found.ctx) {
      return { ok: false, result: 'unavailable',
               reason: 'no-chat-context (roots ' + roots.length + ', fibers ' + found.visited + ')' };
    }
    var ctx = found.ctx;
    var hit = locateLoad(ctx, loadId);
    if (!hit) return { ok: false, result: 'unavailable', reason: 'load-not-in-amazon-state' };

    // A NEW object every time. Passing Amazon's own state object back, mutated, would rely on the
    // setter re-rendering for an identical reference, which a plain useState setter does not do.
    var next = Object.assign({}, ctx.chatBotState, {
      workOpportunityForDemandSupport: hit.wo,
      setIsChatBoxOpen: true,
      setShowBadgeOnIcon: false
    });
    ctx.setChatBotState(next);

    // Confirm from the committed tree, not from what we passed.
    await new Promise(function (res) { setTimeout(res, CONFIRM_DELAY_MS); });
    var after = findChatContext(findRoots(loadId)).ctx;
    var st = after && after.chatBotState;
    var applied = !!st && sameId(st.workOpportunityForDemandSupport, loadId) && st.setIsChatBoxOpen === true;
    return {
      ok: applied,
      result: applied ? 'opened' : 'unavailable',
      reason: applied ? shapeNote(hit.wo) : 'state-not-applied',
      source: hit.source
    };
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (ev.source !== window || !d || d.type !== MSG_OPEN) return;
    (async function () {
      if (typeof d.requestId !== 'string' || !/^[0-9a-f]{32}$/.test(d.requestId)) return;
      if (typeof d.loadId !== 'string' || !d.loadId || typeof d.ts !== 'number') return;
      var now = nowMs();
      if (Math.abs(now - d.ts) > MAX_AGE_MS || _seen.has(d.requestId)) return;
      if (!(await verifyOpen(d))) return;                    // forged or unsigned — silent
      _seen.set(d.requestId, now);
      _seen.forEach(function (t, id) { if (now - t > MAX_AGE_MS * 2) _seen.delete(id); });

      var r;
      if (_busy) {
        r = { ok: false, result: 'unavailable', reason: 'busy' };
      } else {
        _busy = true;
        try { r = await openChat(d.loadId); }
        catch (e) { r = { ok: false, result: 'unavailable', reason: 'error ' + ((e && e.name) || 'Error') }; }
        finally { _busy = false; }
      }
      r.requestId = d.requestId;
      r.source = r.source || '';
      await reply(r);
    })();
  });
})();
