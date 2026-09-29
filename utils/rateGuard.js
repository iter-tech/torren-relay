// utils/rateGuard.js — THE RATE GUARD (EXT-D12, 2026-09-29). One removable module.
//
// WHY. Live, 2026-09-29 05:22–05:26 UTC (Ihor, freshness recorder): manual refreshing on top of our
// 2.5 s auto-refresh made Amazon block the board with 503s (usually for 5–20 min). There was NO early
// marker — isBotRequest null, headers unchanged — until the first 503. The only signal was the RATE:
// search requests in the last 60 s were 55–72 normally, rose to 93–105, and the first 503 came at
// r1 = 107 (r5 = 347). ONE observation; the thresholds below sit under it with a margin.
//
// WHAT IT DOES.
//   - Counts, across ALL open Relay tabs together (Amazon sees them as one user), every completed
//     /api/loadboard/search (all variants) and /api/loadboard/recommendations/get request — the
//     same set the freshness recorder's r1 counted, so the live numbers above apply unchanged.
//     Each tab forwards its census events (content/networkObserver.js, key + status only) to the
//     background service worker, which keeps the one combined count and broadcasts the state
//     (chrome.storage.local `extRateGuard`) to every tab.
//   - green < 80/min · yellow ≥ 80 · red ≥ 95. RED PAUSES OUR AUTO-REFRESH IN EVERY TAB: the
//     background permit (background.js grantOrDenyPermit) is refused, so each tab's loop simply
//     skips its ticks and resumes by itself once the combined rate is below 70. Amazon's own UI
//     and Amazon's own requests are never touched; the dispatcher's manual refreshes still work.
//   - A block log: a 503 streak's start, end, duration and the rate at its start.
//   - A compact block in our top bar (with the friendly message when yellow/red), and a
//     "last block" line in the popup's Freshness block.
//
// 🔴 RATE_GUARD_ENABLED (utils/constants.js) = false → NOTHING here runs, renders or logs.
// Removal instructions: docs/DECISIONS.md EXT-D12 "HOW TO REMOVE".
//
// ⚠ LOADED IN THREE PLACES: the content scripts (manifest.json), the popup (popup.html) and the
// background service worker (background.js importScripts). No DOM is touched at load time; each
// context installs only its own part.

/** All thresholds in one place. Rates are per minute (requests in the last 60 s). */
var RATE_GUARD_CFG = {
  windowMs: 60 * 1000,         // r1
  window5Ms: 5 * 60 * 1000,    // r5
  yellowAt: 80,
  redAt: 95,
  resumeBelow: 70,             // red is left only below this (hysteresis)
  blockStatus: 503,            // what starts a block streak
  broadcastEveryMs: 2000,      // the rate number is re-broadcast at most this often
  logMax: 100,
  blocksMax: 20
};
var RATE_GUARD_KEY = 'extRateGuard';         // the broadcast state every tab reads
var RATE_GUARD_LOG_KEY = 'extRateGuardLog';  // events + blocks, for export
var RATE_GUARD_MESSAGES = {
  yellow: 'Refreshing a bit fast — ease off to keep loads coming.',
  red: 'Short pause to keep your board available. Resuming automatically.'
};

var rateGuard = (function () {
  var ENABLED = (typeof RATE_GUARD_ENABLED !== 'undefined') && RATE_GUARD_ENABLED === true;
  // The service worker has no window. RATE_GUARD_FORCE_BG is a TEST-ONLY override (the headless
  // suite runs the background part in a page); nothing in the product defines it.
  var IS_BG = (typeof RATE_GUARD_FORCE_BG !== 'undefined') ? RATE_GUARD_FORCE_BG === true
    : ((typeof window === 'undefined') || (typeof document === 'undefined'));

  function counted(ek) {
    return typeof ek === 'string' && (ek.indexOf('search:') === 0 || ek === 'recommendations');
  }

  // ══ BACKGROUND: the one combined count ═══════════════════════════════════════════════════
  var bg = { times: [], state: 'green', paused: false, block: null, lastBlock: null, lastWrite: 0, r1: 0, r5: 0 };

  function bgLog(ev) {
    try {
      console.log('[rateGuard] ' + ev.kind, ev);
      chrome.storage.local.get(RATE_GUARD_LOG_KEY, function (d) {
        var log = (d && d[RATE_GUARD_LOG_KEY]) || { events: [], blocks: [] };
        log.events.push(ev);
        while (log.events.length > RATE_GUARD_CFG.logMax) log.events.shift();
        if (ev.kind === 'block-end') {
          log.blocks.push(ev);
          while (log.blocks.length > RATE_GUARD_CFG.blocksMax) log.blocks.shift();
        }
        var o = {}; o[RATE_GUARD_LOG_KEY] = log;
        chrome.storage.local.set(o);
      });
    } catch (e) { console.error('[rateGuard] log failed', e); }
  }

  function bgBroadcast(now, force) {
    if (!force && now - bg.lastWrite < RATE_GUARD_CFG.broadcastEveryMs) return;
    bg.lastWrite = now;
    var o = {};
    o[RATE_GUARD_KEY] = { state: bg.state, paused: bg.paused, r1: bg.r1, r5: bg.r5, updatedAt: now,
                          block: bg.block, lastBlock: bg.lastBlock };
    try { chrome.storage.local.set(o); } catch (e) { console.error('[rateGuard] broadcast failed', e); }
  }

  function bgEvaluate(now) {
    while (bg.times.length && now - bg.times[0] > RATE_GUARD_CFG.window5Ms) bg.times.shift();
    var r1 = 0;
    for (var i = bg.times.length - 1; i >= 0 && now - bg.times[i] <= RATE_GUARD_CFG.windowMs; i--) r1++;
    bg.r1 = r1;
    bg.r5 = bg.times.length;
    var prev = bg.state;
    var next;
    if (prev === 'red') next = (r1 < RATE_GUARD_CFG.resumeBelow) ? 'green' : 'red';
    else next = (r1 >= RATE_GUARD_CFG.redAt) ? 'red' : (r1 >= RATE_GUARD_CFG.yellowAt) ? 'yellow' : 'green';
    if (next !== prev) {
      bg.state = next;
      bgLog({ t: now, kind: 'state', from: prev, to: next, r1: r1, r5: bg.r5 });
      if (next === 'red' && !bg.paused) {
        bg.paused = true;
        bgLog({ t: now, kind: 'auto-pause', r1: r1, r5: bg.r5 });
      } else if (next !== 'red' && bg.paused) {
        bg.paused = false;
        bgLog({ t: now, kind: 'auto-resume', r1: r1, r5: bg.r5 });
      }
      bgBroadcast(now, true);
    } else {
      bgBroadcast(now, false);
    }
  }

  function bgOnEvent(msg) {
    if (!msg || !counted(msg.ek)) return;
    var now = Date.now();
    bg.times.push(now);
    var st = (typeof msg.st === 'number') ? msg.st : null;
    if (st === RATE_GUARD_CFG.blockStatus) {
      if (!bg.block) {
        bgEvaluate(now);   // the rate AT the start, this request included
        bg.block = { start: now, r1AtStart: bg.r1, r5AtStart: bg.r5, responses503: 1 };
        bgLog({ t: now, kind: 'block-start', r1: bg.r1, r5: bg.r5 });
        bgBroadcast(now, true);
        return;
      }
      bg.block.responses503++;
    } else if (st !== null && st >= 200 && st < 300 && bg.block) {
      var b = bg.block;
      bg.block = null;
      bg.lastBlock = { start: new Date(b.start).toISOString(), end: new Date(now).toISOString(),
                       durationMin: Math.round((now - b.start) / 6000) / 10,
                       r1AtStart: b.r1AtStart, r5AtStart: b.r5AtStart, responses503: b.responses503 };
      bgLog(Object.assign({ t: now, kind: 'block-end' }, bg.lastBlock));
      bgEvaluate(now);
      bgBroadcast(now, true);
      return;
    }
    bgEvaluate(now);
  }

  /** Called by background.js before granting a permit. Synchronous; re-evaluates with "now". */
  function isPaused() {
    if (!ENABLED || !IS_BG) return false;
    bgEvaluate(Date.now());
    return bg.paused;
  }

  function installBackground() {
    // After a service-worker restart the per-request times are gone (they rebuild within a
    // minute); the paused flag, an open block and the last block are restored so nothing is lost.
    try {
      chrome.storage.local.get(RATE_GUARD_KEY, function (d) {
        var s = d && d[RATE_GUARD_KEY];
        if (!s) return;
        bg.state = s.state || 'green';
        bg.paused = !!s.paused;
        bg.block = s.block || null;
        bg.lastBlock = s.lastBlock || null;
      });
    } catch (e) { console.error('[rateGuard] restore failed', e); }
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'RATE_GUARD_EVENT') bgOnEvent(msg);
      return false;
    });
  }

  // ══ CONTENT: forward this tab's census, follow the broadcast ═════════════════════════════
  var _current = null;          // the last broadcast seen in this tab
  var _renderers = [];          // mounted bar blocks / popup lines

  function onBroadcast(s) {
    var prev = _current;
    _current = s || null;
    if (s && (!prev || prev.state !== s.state)) {
      logger.notice('rateGuard', 'rate-guard state ' + (prev ? prev.state : '—') + ' → ' + s.state +
        (s.paused ? ' (auto-refresh paused in all tabs)' : ''), { r1: s.r1, r5: s.r5 });
    }
    if (s && prev && !prev.paused && s.paused) logger.notice('rateGuard', 'rate-guard auto-pause (all tabs)', { r1: s.r1 });
    if (s && prev && prev.paused && !s.paused) logger.notice('rateGuard', 'rate-guard auto-resume (all tabs)', { r1: s.r1 });
    if (s && s.block && (!prev || !prev.block)) logger.notice('rateGuard', 'rate-guard block start (503)', s.block);
    if (s && s.lastBlock && (!prev || !prev.lastBlock || prev.lastBlock.end !== s.lastBlock.end)) {
      logger.notice('rateGuard', 'rate-guard block end', s.lastBlock);
    }
    for (var i = 0; i < _renderers.length; i++) {
      try { _renderers[i](_current); } catch (e) { logger.error('rateGuard', 'render failed', { error: e }); }
    }
  }

  function installContent() {
    try {
      window.addEventListener('message', function (ev) {
        if (ev.source !== window || !ev.data || ev.data.__extRelayCensus !== true || !ev.data.ev) return;
        var e = ev.data.ev;
        if (!counted(e.ek)) return;
        try {
          var p = chrome.runtime.sendMessage({ type: 'RATE_GUARD_EVENT', ek: e.ek, st: e.st });
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (err) { /* service worker unreachable for a moment — the next event counts */ }
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[RATE_GUARD_KEY]) onBroadcast(changes[RATE_GUARD_KEY].newValue);
      });
      chrome.storage.local.get(RATE_GUARD_KEY, function (d) { onBroadcast((d && d[RATE_GUARD_KEY]) || null); });
    } catch (e) {
      logger.error('rateGuard', 'install failed — no rate guard in this tab', { error: e });
    }
  }

  // ══ THE BAR BLOCK (content/sidebar.js mounts it) ══════════════════════════════════════════
  /**
   * Builds the rate block into `parent`. Returns null — and adds nothing — when disabled.
   * `makeInfo(infoTestid, tipTestid, text)` is the bar's own "i" helper, so the tooltip matches.
   */
  function mountBarBlock(parent, makeInfo) {
    if (!ENABLED || !parent) return null;
    var wrap = document.createElement('span');
    wrap.className = 'ext-bar-rate';
    wrap.setAttribute('data-testid', 'ext-rate-guard');
    wrap.setAttribute('data-state', 'green');
    var dot = document.createElement('span');
    dot.className = 'ext-bar-rate__dot';
    dot.setAttribute('data-testid', 'ext-rate-guard-dot');
    var label = document.createElement('span');
    label.className = 'ext-bar-rate__label';
    label.setAttribute('data-testid', 'ext-rate-guard-label');
    label.textContent = '— /min';
    var msg = document.createElement('span');
    msg.className = 'ext-bar-rate__msg';
    msg.setAttribute('data-testid', 'ext-rate-guard-msg');
    wrap.appendChild(dot);
    wrap.appendChild(label);
    wrap.appendChild(msg);
    parent.appendChild(wrap);
    if (typeof makeInfo === 'function') {
      parent.appendChild(makeInfo('ext-info-rate', 'ext-info-rate-tip',
        'Requests per minute from all your Relay tabs together — Amazon sees them as one user. ' +
        'Above ' + RATE_GUARD_CFG.redAt + '/min our auto-refresh takes a short pause in every tab and ' +
        'resumes by itself below ' + RATE_GUARD_CFG.resumeBelow + '/min. Your own clicks are never blocked.'));
    }
    function render(s) {
      var state = (s && s.state) || 'green';
      wrap.setAttribute('data-state', state);
      label.textContent = (s && typeof s.r1 === 'number') ? (s.r1 + '/min') : '— /min';
      msg.textContent = RATE_GUARD_MESSAGES[state] || '';
      wrap.title = msg.textContent || ('Request rate OK' + (s ? ' — ' + s.r1 + '/min' : ''));
    }
    _renderers.push(render);
    render(_current);
    return wrap;
  }

  // ══ THE POPUP LINE (popup.js mounts it into the Freshness block) ══════════════════════════
  function mountPopup(container) {
    if (!ENABLED || !container) return null;
    var line = document.createElement('div');
    line.className = 'popup-stat-line';
    line.setAttribute('data-testid', 'popup-rate-guard-line');
    line.appendChild(document.createTextNode('rate guard · last block '));
    var val = document.createElement('span');
    val.setAttribute('data-testid', 'popup-rate-lastblock');
    val.textContent = '—';
    line.appendChild(val);
    var anchor = container.querySelector('#popup-fresh-endpoints') || null;
    container.insertBefore(line, anchor);
    function render(s) {
      var lb = s && s.lastBlock;
      var open = s && s.block;
      val.textContent = open ? 'now (since ' + new Date(open.start).toISOString().slice(11, 16) + ' UTC)'
        : lb ? (lb.durationMin + ' min · r1 ' + lb.r1AtStart + ' at start · ' + String(lb.start).slice(5, 16).replace('T', ' '))
        : 'none';
    }
    chrome.storage.local.get(RATE_GUARD_KEY, function (d) { render((d && d[RATE_GUARD_KEY]) || null); });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[RATE_GUARD_KEY]) render(changes[RATE_GUARD_KEY].newValue);
    });
    return line;
  }

  if (ENABLED) {
    if (IS_BG) installBackground();
    else if (typeof location !== 'undefined' && location.protocol !== 'chrome-extension:') installContent();
  }

  return {
    enabled: function () { return ENABLED; },
    isPaused: isPaused,
    mountBarBlock: mountBarBlock,
    mountPopup: mountPopup,
    current: function () { return _current; },
    _bg: function () { return { state: bg.state, paused: bg.paused, r1: bg.r1, r5: bg.r5, block: bg.block, lastBlock: bg.lastBlock }; }
  };
})();
