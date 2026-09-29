// aiChatPhrases.js — ISOLATED world, document_idle (EXT-D10.2, 2026-09-28).
//
// A "Phrases ▾" button inside Amazon's open Relay Assistant, next to its message input. It opens a
// dropdown of the dispatcher's phrases (utils/phrases.js, the EXT-D9 library and storage). A click
// INSERTS the rendered phrase into Amazon's input and focuses it. 🔴 IT NEVER SENDS: the dispatcher
// presses Amazon's own send button. The dropdown also edits the list (pencil, delete, + Add). That is
// the same storage as the popup editor, and each follows the other's changes.
//
// AMAZON'S CHAT DOM — facts captured live by Ihor, and nothing else is assumed:
//   chat root   .chat-box-position                (works whoever opened it: our button or Amazon's icon)
//   input       textarea#ra-input                 (the id is the stable anchor)
//   send        the <button> right after the input's container — hashed class, NEVER clicked
//   payout      .wo-total_payout inside the chat root, e.g. "$580.05"
//   🔴 booking  #rlb-book-btn, #rlb-book-trip-confirm-booking-btn, #rlb-book-trip-no-btn — NEVER
//               touched, clicked, hidden or moved. This file never even queries them.
//
// INSERTING SO REACT REGISTERS IT. The native HTMLTextAreaElement value setter, then a bubbling
// 'input' event. From this (isolated) world the native setter bypasses React's value tracker on the
// page's side, so React sees a changed value and runs Amazon's onChange. The result is then
// CHECKED, not assumed: the bridge reads the textarea's React props (aiChat.probeInput) and reports
// whether the value is registered or only painted.
//
// THE PAYOUT for {payout} variables: the load our AI Chat button opened, if this chat is that one;
// otherwise the single .wo-total_payout shown inside the chat. None, or two different ones, means
// unknown: phrases with variables are disabled with a reason, and plain phrases still work.
var aiChatPhrases = (function () {
  var OBSERVE_DEBOUNCE_MS = 150;
  var PROBE_DELAY_MS = 150;
  var MENU_MAX_WIDTH = 320;
  var EDGE = 6;

  var T = {
    btn: 'ext-phrases-btn', menu: 'ext-phrases-menu', style: 'ext-phrases-style',
    note: 'ext-phrases-note', limit: 'ext-phrases-limit', add: 'ext-phrase-add'
  };

  var _bound = null;       // { loadId, root, chatPayoutAtOpen } — set when OUR button opened the chat
  var _menu = null;        // { el, root, btn, items, editing, confirmDel, payout }
  var _timer = null;
  var _observer = null;

  function mask(id) { return (typeof aiChat !== 'undefined') ? aiChat.mask(id) : null; }

  function log(name, ev) {
    if (typeof aiChat !== 'undefined' && aiChat.logEvent) aiChat.logEvent(ev, name);
    else logger.notice('aiChatPhrases', name, ev);
  }

  function signedIn() {
    return typeof isAuthGateActiveSync !== 'function' || isAuthGateActiveSync() === true;
  }

  // ── Amazon's chat, read-only ────────────────────────────────────────────────────────────────
  function chatRoots() {
    var out = [];
    document.querySelectorAll('.chat-box-position').forEach(function (r) {
      if (r.querySelector('#ra-input')) out.push(r);
    });
    return out;
  }

  // The input's container is the ancestor of #ra-input whose next sibling is the send <button>.
  // Found by structure, never by the hashed class.
  function inputContainerOf(ta, root) {
    var el = ta;
    for (var i = 0; el && el !== root && i < 6; i++, el = el.parentElement) {
      var next = el.nextElementSibling;
      if (next && next.tagName === 'BUTTON') return el;
    }
    return null;
  }

  function parseMoney(s) {
    var m = String(s || '').replace(/[,\s]/g, '').match(/\$?(-?\d+(?:\.\d+)?)/);
    var n = m ? parseFloat(m[1]) : NaN;
    return isFinite(n) ? n : null;
  }

  function chatShownPayout(root) {
    var seen = [];
    root.querySelectorAll('.wo-total_payout').forEach(function (el) {
      var n = parseMoney(el.textContent);
      if (n !== null && seen.indexOf(Math.round(n * 100)) === -1) seen.push(Math.round(n * 100));
    });
    if (seen.length === 1) return { payout: seen[0] / 100, n: 1 };
    return { payout: null, n: seen.length };
  }

  function payoutFor(root) {
    logger.log('aiChatPhrases', 'payoutFor called');
    var shown = chatShownPayout(root);
    if (_bound && _bound.root === root && root.isConnected) {
      // The chat can move to another load inside the same box (Amazon's own controls). If what it
      // shows is no longer what it showed when we bound it, the binding is stale — drop it.
      var moved = shown.payout !== null && _bound.chatPayoutAtOpen !== null &&
                  Math.abs(shown.payout - _bound.chatPayoutAtOpen) > 0.009;
      if (!moved) {
        var rec = (typeof getLoadRecord === 'function') ? getLoadRecord(_bound.loadId) : null;
        var p = phrases.payoutOf(rec);
        if (p !== null) return { payout: p, source: 'button', loadId: _bound.loadId };
      } else {
        log('phrase-failed', { step: 'payout', reason: 'chat moved to another load — button binding dropped' });
        _bound = null;
      }
    }
    if (shown.payout !== null) return { payout: shown.payout, source: 'chat' };
    return { payout: null, source: shown.n > 1 ? 'ambiguous' : 'none' };
  }

  // ── our button in Amazon's input row ──────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById(T.style)) return;
    var s = document.createElement('style');
    s.id = T.style;
    s.setAttribute('data-testid', T.style);
    // Amazon's look: white, thin neutral border, dark ink, 4px radius. Nothing of Amazon's is restyled.
    s.textContent =
      '.ext-phrases-btn{flex:0 0 auto;align-self:center;margin:0 8px 0 0;height:32px;padding:0 10px;' +
        'font:inherit;font-size:13px;line-height:30px;white-space:nowrap;cursor:pointer;color:#232f3e;' +
        'background:#fff;border:1px solid #879596;border-radius:4px;}' +
      '.ext-phrases-btn:hover{background:#f2f4f4;}' +
      '.ext-phrases-btn:focus-visible{outline:2px solid #0972d3;outline-offset:1px;}' +
      '.ext-phrases-btn[data-state="warn"]{border-color:#b3261e;color:#b3261e;}' +
      '.ext-phrases-menu{position:absolute;z-index:10000;box-sizing:border-box;overflow:auto;' +
        'background:#fff;color:#232f3e;border:1px solid #879596;border-radius:6px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.18);font-size:13px;line-height:1.35;padding:4px 0;text-align:left;}' +
      '.ext-phrases-menu .ext-ph-note{padding:4px 10px 6px;font-size:11px;color:#5f6b7a;border-bottom:1px solid #e9ebed;}' +
      '.ext-phrases-menu .ext-ph-row{display:flex;align-items:flex-start;gap:4px;padding:5px 6px 5px 10px;cursor:pointer;}' +
      '.ext-phrases-menu .ext-ph-row:hover,.ext-phrases-menu .ext-ph-row:focus{background:#f2f8fd;outline:none;}' +
      '.ext-phrases-menu .ext-ph-row[aria-disabled="true"]{cursor:default;color:#8d99a8;}' +
      '.ext-phrases-menu .ext-ph-text{flex:1 1 auto;min-width:0;white-space:normal;overflow-wrap:anywhere;}' +
      '.ext-phrases-menu .ext-ph-why{display:block;font-size:11px;color:#b3261e;}' +
      '.ext-phrases-menu .ext-ph-icon{flex:0 0 auto;border:none;background:none;cursor:pointer;color:#5f6b7a;' +
        'padding:0 4px;font-size:13px;line-height:18px;border-radius:3px;}' +
      '.ext-phrases-menu .ext-ph-icon:hover{background:#e9ebed;color:#232f3e;}' +
      '.ext-phrases-menu input.ext-ph-input{flex:1 1 auto;min-width:0;font:inherit;font-size:13px;padding:2px 4px;' +
        'border:1px solid #879596;border-radius:3px;}' +
      '.ext-phrases-menu .ext-ph-small{border:1px solid #879596;background:#fff;border-radius:3px;cursor:pointer;' +
        'font-size:12px;padding:1px 6px;}' +
      '.ext-phrases-menu .ext-ph-foot{border-top:1px solid #e9ebed;padding:5px 10px 3px;}' +
      '.ext-phrases-menu .ext-ph-foot button{border:none;background:none;color:#0972d3;cursor:pointer;padding:0;font-size:13px;}' +
      '.ext-phrases-menu .ext-ph-foot button:disabled{color:#8d99a8;cursor:default;}' +
      '.ext-phrases-menu .ext-ph-limit{display:block;font-size:11px;color:#b3261e;margin-top:2px;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureButton(root) {
    logger.log('aiChatPhrases', 'ensureButton called');
    try {
      var ta = root.querySelector('#ra-input');
      if (!ta || root.querySelector('[data-testid="' + T.btn + '"]')) return;
      injectStyle();
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ext-phrases-btn';
      btn.setAttribute('data-testid', T.btn);
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.title = 'Insert one of your phrases (it is not sent)';
      btn.textContent = 'Phrases ▾';
      isolate(btn);
      btn.addEventListener('click', function () {
        if (_menu && _menu.btn === btn) closeMenu(true); else openMenu(root, btn);
      });
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && _menu) { ev.preventDefault(); closeMenu(true); }
      });
      // Left of the input's container, inside the same row — Amazon's send button stays the row's
      // last child, where it was. Without that structure, directly before the textarea.
      var container = inputContainerOf(ta, root);
      if (container) container.parentNode.insertBefore(btn, container);
      else ta.parentNode.insertBefore(btn, ta);
    } catch (e) {
      logger.error('aiChatPhrases', 'ensureButton failed', { error: e });
      log('phrase-failed', { step: 'button', reason: (e && e.name) || 'Error' });
    }
  }

  // Our clicks and keys stay ours: Amazon's chat never sees them (no Enter-to-send, no outside-click).
  function isolate(el) {
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input']
      .forEach(function (t) { el.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
  }

  function scan() {
    logger.log('aiChatPhrases', 'scan called');
    if (!signedIn()) return;
    chatRoots().forEach(ensureButton);
    if (_menu && (!_menu.root.isConnected || !_menu.btn.isConnected)) closeMenu(false);
  }

  function schedule() {
    if (_timer !== null) clearTimeout(_timer);
    _timer = setTimeout(function () { _timer = null; scan(); }, OBSERVE_DEBOUNCE_MS);
  }

  // ── the dropdown ─────────────────────────────────────────────────────────────────────────────
  async function openMenu(root, btn) {
    logger.log('aiChatPhrases', 'openMenu called');
    try {
      closeMenu(false);
      var loaded = await phrases.load();
      var el = document.createElement('div');
      el.className = 'ext-phrases-menu';
      el.setAttribute('data-testid', T.menu);
      el.setAttribute('role', 'listbox');
      el.setAttribute('aria-label', 'Your phrases');
      isolate(el);
      el.addEventListener('keydown', onMenuKey);
      _menu = { el: el, root: root, btn: btn, items: loaded.value.items || [], editing: null,
                confirmDel: null, payout: payoutFor(root) };
      root.appendChild(el);
      btn.setAttribute('aria-expanded', 'true');
      render();
      var first = el.querySelector('[role="option"]:not([aria-disabled="true"])') || el.querySelector('[role="option"]');
      if (first) first.focus();
      document.addEventListener('pointerdown', onOutside, true);
    } catch (e) {
      logger.error('aiChatPhrases', 'openMenu failed', { error: e });
      log('phrase-failed', { step: 'open', reason: (e && e.name) || 'Error' });
    }
  }

  function closeMenu(refocusButton) {
    if (!_menu) return;
    var m = _menu;
    _menu = null;
    document.removeEventListener('pointerdown', onOutside, true);
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    m.btn.setAttribute('aria-expanded', 'false');
    if (refocusButton && m.btn.isConnected) m.btn.focus();
  }

  function onOutside(ev) {
    if (!_menu) return;
    if (_menu.el.contains(ev.target) || _menu.btn.contains(ev.target)) return;
    closeMenu(false);
  }

  function onMenuKey(ev) {
    if (!_menu) return;
    var inEdit = ev.target && ev.target.tagName === 'INPUT';
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (_menu.editing !== null || _menu.confirmDel !== null) {
        _menu.editing = null; _menu.confirmDel = null; render(); focusRow(0);
      } else {
        closeMenu(true);
      }
      return;
    }
    if (inEdit) return;                       // the edit input handles its own Enter
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      var rows = Array.prototype.slice.call(_menu.el.querySelectorAll('[role="option"]'));
      var i = rows.indexOf(document.activeElement);
      var j = i + (ev.key === 'ArrowDown' ? 1 : -1);
      if (rows[j]) rows[j].focus();
      return;
    }
    if (ev.key === 'Enter' && ev.target && ev.target.getAttribute('role') === 'option') {
      ev.preventDefault();
      var idx = Number(ev.target.getAttribute('data-index'));
      pick(idx);
    }
  }

  function focusRow(i) {
    if (!_menu) return;
    var r = _menu.el.querySelector('[data-testid="ext-phrase-row-' + i + '"]');
    if (r) r.focus();
  }

  function mkBtn(label, title, testid, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('data-testid', testid);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
    return b;
  }

  function render() {
    logger.log('aiChatPhrases', 'render called');
    if (!_menu) return;
    var m = _menu, el = m.el;
    el.textContent = '';

    var note = document.createElement('div');
    note.className = 'ext-ph-note';
    note.setAttribute('data-testid', T.note);
    note.textContent = m.payout.payout !== null
      ? 'Payout ' + phrases.money(m.payout.payout) + (m.payout.source === 'button' ? ' (this load)' : ' (from the chat)') +
        ' · click to insert — it is not sent'
      : 'No payout found for this chat — phrases with {payout} are disabled';
    el.appendChild(note);

    var record = m.payout.payout !== null ? { payout: m.payout.payout } : null;
    m.items.forEach(function (item, i) {
      if (m.editing === i) { el.appendChild(editRow(i, item.text)); return; }
      var r = phrases.renderPhrase(item.text, record);
      var row = document.createElement('div');
      row.className = 'ext-ph-row';
      row.setAttribute('role', 'option');
      row.setAttribute('tabindex', '0');
      row.setAttribute('data-index', String(i));
      row.setAttribute('data-testid', 'ext-phrase-row-' + i);
      if (!r.usable) row.setAttribute('aria-disabled', 'true');

      var text = document.createElement('span');
      text.className = 'ext-ph-text';
      text.textContent = r.text;
      if (!r.usable) {
        var why = document.createElement('span');
        why.className = 'ext-ph-why';
        why.textContent = 'needs a payout — none found for this chat';
        text.appendChild(why);
      }
      row.appendChild(text);

      if (m.confirmDel === i) {
        row.appendChild(mkBtn('Delete', 'Delete this phrase', 'ext-phrase-del-yes-' + i, 'ext-ph-small', function () { removeAt(i); }));
        row.appendChild(mkBtn('Keep', 'Keep it', 'ext-phrase-del-no-' + i, 'ext-ph-small', function () { m.confirmDel = null; render(); focusRow(i); }));
      } else {
        row.appendChild(mkBtn('✎', 'Edit this phrase', 'ext-phrase-edit-' + i, 'ext-ph-icon', function () { m.editing = i; m.confirmDel = null; render(); }));
        row.appendChild(mkBtn('🗑', 'Delete this phrase', 'ext-phrase-del-' + i, 'ext-ph-icon', function () { m.confirmDel = i; m.editing = null; render(); }));
      }
      row.addEventListener('click', function (ev) {
        if (ev.target !== row && ev.target !== text && !text.contains(ev.target)) return;
        pick(i);
      });
      el.appendChild(row);
    });
    if (m.editing === 'new') el.appendChild(editRow('new', ''));

    var foot = document.createElement('div');
    foot.className = 'ext-ph-foot';
    var add = mkBtn('+ Add phrase', 'Add a phrase', T.add, '', function () { m.editing = 'new'; m.confirmDel = null; render(); });
    add.disabled = !phrases.canAdd(m.items.length) || m.editing === 'new';
    foot.appendChild(add);
    var limit = phrases.limitNote(m.items.length);
    if (limit) {
      var ln = document.createElement('span');
      ln.className = 'ext-ph-limit';
      ln.setAttribute('data-testid', T.limit);
      ln.textContent = limit;
      foot.appendChild(ln);
    }
    el.appendChild(foot);

    place();
    var input = el.querySelector('input.ext-ph-input');
    if (input) input.focus();
  }

  function editRow(i, value) {
    var row = document.createElement('div');
    row.className = 'ext-ph-row';
    row.setAttribute('data-testid', 'ext-phrase-editing-' + i);
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ext-ph-input';
    input.maxLength = phrases.MAX_PHRASE_LENGTH;
    input.value = value;
    input.setAttribute('data-testid', 'ext-phrase-input-' + i);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(i, input.value); }
    });
    row.appendChild(input);
    row.appendChild(mkBtn('Save', 'Save', 'ext-phrase-save-' + i, 'ext-ph-small', function () { commit(i, input.value); }));
    row.appendChild(mkBtn('Cancel', 'Cancel', 'ext-phrase-cancel-' + i, 'ext-ph-small', function () {
      _menu.editing = null; render(); focusRow(i === 'new' ? 0 : i);
    }));
    return row;
  }

  // Opens UPWARD from our button and stays inside the chat box. Coordinates are computed against the
  // menu's own offsetParent, so it works whatever Amazon's positioning of the chat is.
  function place() {
    if (!_menu) return;
    var el = _menu.el, rootR = _menu.root.getBoundingClientRect(), btnR = _menu.btn.getBoundingClientRect();
    var width = Math.max(160, Math.min(MENU_MAX_WIDTH, rootR.width - EDGE * 2));
    el.style.width = width + 'px';
    el.style.maxHeight = Math.max(60, btnR.top - rootR.top - EDGE * 2) + 'px';
    el.style.left = '0px';
    el.style.top = '0px';
    var op = el.offsetParent || document.documentElement;
    var opR = op.getBoundingClientRect();
    var h = el.offsetHeight;
    var top = Math.max(rootR.top + EDGE, btnR.top - 4 - h);
    var left = Math.min(Math.max(btnR.left, rootR.left + EDGE), rootR.right - EDGE - width);
    el.style.top = (top - opR.top - op.clientTop + op.scrollTop) + 'px';
    el.style.left = (left - opR.left - op.clientLeft + op.scrollLeft) + 'px';
  }

  // ── editing, persisted through utils/phrases.js (the popup's storage) ──────────────────────────
  async function persist(items, ev) {
    var r = await phrases.save(items);
    if (_menu) _menu.items = r.items;
    ev.count = r.items.length;
    ev.area = r.area;
    if (!r.ok) ev.error = r.error;
    log(r.ok ? 'phrase-edit' : 'phrase-failed', ev);
    return r.ok;
  }

  async function commit(i, value) {
    logger.log('aiChatPhrases', 'commit called', { index: i });
    if (!_menu) return;
    var text = String(value || '').slice(0, phrases.MAX_PHRASE_LENGTH);
    if (!text.trim()) { _menu.editing = null; render(); return; }
    var latest = (await phrases.load()).value.items || [];       // the popup may have changed it
    if (i === 'new') {
      if (!phrases.canAdd(latest.length)) { _menu.items = latest; _menu.editing = null; render(); return; }
      latest.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text });
      await persist(latest, { action: 'add', index: latest.length - 1 });
    } else {
      var id = _menu.items[i] && _menu.items[i].id;
      var at = latest.findIndex(function (x) { return x.id === id; });
      if (at === -1) { _menu.items = latest; _menu.editing = null; render(); return; }
      latest[at] = { id: id, text: text };
      await persist(latest, { action: 'edit', index: at });
    }
    if (!_menu) return;
    _menu.editing = null;
    render();
  }

  async function removeAt(i) {
    logger.log('aiChatPhrases', 'removeAt called', { index: i });
    if (!_menu) return;
    var id = _menu.items[i] && _menu.items[i].id;
    var latest = (await phrases.load()).value.items || [];
    var kept = latest.filter(function (x) { return x.id !== id; });
    await persist(kept, { action: 'delete', index: i });
    if (!_menu) return;
    _menu.confirmDel = null;
    render();
    focusRow(Math.max(0, i - 1));
  }

  // ── inserting into Amazon's input ─────────────────────────────────────────────────────────────
  async function pick(i) {
    logger.log('aiChatPhrases', 'pick called', { index: i });
    if (!_menu) return;
    var m = _menu, item = m.items[i];
    if (!item) return;
    var record = m.payout.payout !== null ? { payout: m.payout.payout } : null;
    var r = phrases.renderPhrase(item.text, record);
    var ev = { index: i, hadVariables: phrases.hasVariables(item.text), payoutSource: m.payout.source };
    if (m.payout.source === 'button') ev.loadId = mask(m.payout.loadId);
    if (!r.usable) {
      ev.reason = r.reason;
      log('phrase-failed', ev);
      return;
    }
    var ta = m.root.querySelector('#ra-input');
    closeMenu(false);
    if (!ta) { ev.reason = 'no-ra-input'; log('phrase-failed', ev); return; }
    try {
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, r.text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      try { ta.setSelectionRange(r.text.length, r.text.length); } catch (e2) { /* not fatal */ }
    } catch (e) {
      ev.reason = 'set-threw ' + ((e && e.name) || 'Error');
      log('phrase-failed', ev);
      return;
    }
    await new Promise(function (res) { setTimeout(res, PROBE_DELAY_MS); });
    var probe = (typeof aiChat !== 'undefined' && aiChat.probeInput)
      ? await aiChat.probeInput(r.text)
      : { ok: ta.value === r.text, result: 'dom-only', reason: 'no-bridge', diag: {} };
    ev.registered = probe.ok === true;
    ev.check = probe.result + (probe.reason ? ' (' + probe.reason + ')' : '');
    if (probe.diag && probe.diag.controlled !== undefined) ev.controlled = probe.diag.controlled;
    log(ev.registered ? 'phrase-insert' : 'phrase-failed', ev);
    if (!ev.registered && m.btn.isConnected) flash(m.btn, 'Not registered');
  }

  function flash(btn, text) {
    btn.textContent = text;
    btn.setAttribute('data-state', 'warn');
    setTimeout(function () { btn.textContent = 'Phrases ▾'; btn.removeAttribute('data-state'); }, 3000);
  }

  // ── wiring ──────────────────────────────────────────────────────────────────────────────────
  function onOpenedByButton(loadId) {
    var root = chatRoots()[0] || null;
    _bound = root ? { loadId: loadId, root: root, chatPayoutAtOpen: chatShownPayout(root).payout } : null;
    schedule();
  }

  function start() {
    logger.log('aiChatPhrases', 'start called');
    try {
      if (typeof phrases === 'undefined') {
        logger.error('aiChatPhrases', 'utils/phrases.js not loaded — no phrase dropdown');
        return;
      }
      if (typeof aiChat !== 'undefined' && aiChat.onChatOpened) aiChat.onChatOpened(onOpenedByButton);
      _observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes.length || muts[i].removedNodes.length) { schedule(); return; }
        }
      });
      _observer.observe(document.body, { childList: true, subtree: true });
      if (chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes) {
          if (!changes[phrases.KEY] || !_menu || _menu.editing !== null) return;
          phrases.load().then(function (l) { if (_menu) { _menu.items = l.value.items || []; render(); } });
        });
      }
      if (typeof onAuthGateChange === 'function') onAuthGateChange(schedule);
      schedule();
    } catch (e) {
      logger.error('aiChatPhrases', 'start failed', { error: e });
    }
  }

  start();

  return { scan: scan, payoutFor: payoutFor, _state: function () { return { bound: !!_bound, open: !!_menu }; } };
})();
