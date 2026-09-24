// utils/tabIndicator.js
// ── WHAT THE AMAZON RELAY TAB SAYS WHILE WE WATCH THE BOARD (EXT-D4) ────────────────────────────
//
// THE SAME INDICATOR THE TENLANE NETWORK BOARD SHOWS, with ONE deliberate difference: the idle
// icon is AMAZON'S OWN FAVICON, not our logo. This is Amazon's tab; when we are not doing anything
// it must look exactly as Amazon serves it.
//
//   paused / idle   Amazon's own favicon, written back explicitly (see the 🔴 note below)
//   searching       our magnifier with a sweep travelling round its ring, while the loop runs
//   new load        our red disc with an exclamation, blinking, plus "(3) " on the title
//
// 🔑 THE DRAWING AND THE STATE MACHINE ARE THE SITE'S, COPIED, NOT REDESIGNED. Frame counts,
// intervals, colours, the alert-wins rule and the title rule are the ones in the site repo's
// `web/src/lib/tabState.ts`; the two tabs must not drift apart. The site is read-only from here,
// so this is a copy on purpose — if you change one, change both.
//
// 🔑 THE ALERT WINS OVER SEARCHING. What was found matters more than that we are still looking.
//
// 🔑 THE TITLE CARRIES NO GLYPH, only the count. The favicon is the part always visible in a
// collapsed tab, so it is the part that states the mood; a magnifier in the title beside a
// magnifier in the icon says it twice (site decision, 2026-09-23).
//
// ⚠ THE TWO BOARD ICONS ARE DRAWN IN CODE — a canvas, handed over as a data URL. No image file and
// no request: a favicon fetch whose whole purpose is to say "still working" would be absurd. And
// the idle icon is not drawn at all; it is Amazon's own href.
//
// 🔴 IDLE IS AN EXPLICIT href WRITE, NEVER JUST REMOVING OUR LINK. Both repos learned this the hard
// way — the extension in U1 (2026-08-20) and the site again on 2026-09-24. A browser does not
// re-read the remaining icon links because one was detached, so "stopping" left our mark on the
// tab: it stopped animating but never disappeared. The site's measurement put a number on it: the
// idle path performed ZERO href writes, while the sweep and the blink move precisely because they
// write href four times a second. So every state here, idle included, is an href write on ONE link
// that we own for as long as we are showing anything.
//
// 🔴 AND AMAZON'S OWN ICON LINKS CAN COME BACK. Relay is a single-page app: its framework may
// re-insert its <link rel="icon"> elements at any time, and one appearing AFTER ours would sit
// later in document order and win. Ours is therefore the only LIVE icon link while a state is
// showing — every other one is parked (its `rel` renamed, which takes it out of the running) — and
// a MutationObserver on <head> parks any that appear between two writes. `release()` puts them all
// back and takes ours away, so a logged-out or unloaded page is left exactly as Amazon served it.
//
// ⚠ THE PARKED LIST IS BOUNDED. It holds only elements still in the document and never stores one
// twice: the site's version pushed on every write and climbed 1, 6, 9… over a session.
//
// NO clicks, no Amazon DOM changes beyond <head> icon links and document.title, no network.

var tabIndicator = (function () {

  /** Ours, and findable again after a re-run of this file (never two of ours). */
  var OURS_ID    = 'ext-tab-indicator-icon';
  var OURS_SEL   = 'link[data-ext-tab-indicator="true"]';
  /** A parked link's `rel`. Not a word the HTML spec knows, so the browser ignores the element. */
  var PARKED_REL = 'ext-parked-icon';

  /*
   * ⚠ 4 FRAMES A SECOND, 12 FRAMES, ONE TURN EVERY 3 SECONDS, and a 2-frame blink just under 2 Hz
   * — the site's figures. Slow enough to read as a calm sweep rather than a flicker at 16px; the
   * blink is the strongest signal a 16px square can carry without becoming a strobe. The frames
   * are drawn ONCE and then cycled, so a running search costs one attribute write every 250 ms.
   */
  var FRAMES    = 12;
  var FRAME_MS  = 250;
  var BLINK_MS  = 550;

  /*
   * ⚠ THE SITE'S TWO COLOURS, AS LITERALS, AND DELIBERATELY NOT --ext-* TOKENS. The indicator's
   * job is to look like the Tenlane board's tab, not like this extension's UI; reading our own
   * accent token here would make the two tabs disagree the moment either palette is retuned.
   * (`content/tabAlert.js`'s old dot did read the token — that indicator is gone.)
   */
  var ACCENT = '#2563eb';
  var ALERT  = '#dc2626';

  var alertCount = 0;
  var searching  = false;
  /** The state currently on the tab, so `tab-state` is logged on CHANGE only, as on the site. */
  var shown      = null;

  /** Our one link, and Amazon's own links parked while it is live. */
  var link   = null;
  var parked = [];

  /**
   * Amazon's own favicon href, captured from the last icon link in document order — the one the
   * browser was following — BEFORE we park anything.
   *
   * ⚠ MEASURED FROM THE LIVE PAGE, NOT ASSUMED. If Relay declares no icon link at all (a page can
   * rely on the origin's /favicon.ico), `originalHref()` falls back to that same default, which is
   * what the browser would have used anyway.
   */
  var originalHref = null;

  var baseTitle  = null;
  /** The last title WE wrote, so Amazon changing it under us is distinguishable from our own write. */
  var wroteTitle = null;

  var frames      = null;
  var blinkFrames = null;
  var frame       = 0;
  var timer       = null;
  /** Which live state the timer is driving, so a state change re-arms it at its own pace. */
  var animating   = null;
  var headWatch   = null;

  /* ── the icons ──────────────────────────────────────────────────────────────────────────────── */

  function canvas32() {
    try {
      // 32px for a 16px slot: browsers downscale, and a 16px canvas with a 3px stroke lands
      // between pixels and reads as mud.
      var c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      var g = c.getContext('2d');
      return g ? { c: c, g: g } : null;
    } catch (e) {
      logger.error('tabIndicator', 'canvas unavailable — the tab icon will be left alone', { error: e });
      return null;
    }
  }

  /**
   * The magnifier, with a bright arc at `turn` (0..1) travelling round the ring.
   *
   * ⚠ THE GLASS AND THE HANDLE NEVER MOVE. Only the sweep does, so the icon keeps its silhouette —
   * a spinning magnifier would read as "busy/stuck", and its handle would smear at this size.
   */
  function drawSearching(turn) {
    var made = canvas32();
    if (!made) return null;
    var g = made.g;
    try {
      g.lineCap = 'round';

      // The ring, quiet, so the sweep has something to travel along.
      g.strokeStyle = ACCENT;
      g.globalAlpha = 0.3;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(13, 13, 8.5, 0, Math.PI * 2);
      g.stroke();

      // The sweep: a quarter of the ring, bright.
      g.globalAlpha = 1;
      var from = turn * Math.PI * 2;
      g.beginPath();
      g.arc(13, 13, 8.5, from, from + Math.PI / 2);
      g.stroke();

      // The handle, fixed.
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(19.5, 19.5);
      g.lineTo(28, 28);
      g.stroke();
      return made.c.toDataURL('image/png');
    } catch (e) {
      logger.error('tabIndicator', 'drawSearching failed', { error: e });
      return null;
    }
  }

  /**
   * A solid disc — the opposite of a ring — with an exclamation cut out of it in white.
   * `dim` is the off beat of the blink: the same silhouette, paler, so the shape never flickers
   * away and only the weight pulses.
   */
  function drawAlert(dim) {
    var made = canvas32();
    if (!made) return null;
    var g = made.g;
    try {
      g.globalAlpha = dim ? 0.4 : 1;
      g.fillStyle = ALERT;
      g.beginPath();
      g.arc(16, 16, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      // ⚠ roundRect is missing before Safari 16.4; a square bar reads the same at 16px.
      g.beginPath();
      if (typeof g.roundRect === 'function') g.roundRect(13.5, 6.5, 5, 12.5, 2.5);
      else g.rect(13.5, 6.5, 5, 12.5);
      g.fill();
      g.beginPath();
      g.arc(16, 24.5, 2.9, 0, Math.PI * 2);
      g.fill();
      return made.c.toDataURL('image/png');
    } catch (e) {
      logger.error('tabIndicator', 'drawAlert failed', { error: e });
      return null;
    }
  }

  /* ── the one link ───────────────────────────────────────────────────────────────────────────── */

  /** Every live icon link, in document order. The browser uses the LAST of them. */
  function iconLinks() {
    try {
      var out = [];
      var all = document.querySelectorAll('link[rel~="icon"]');
      for (var i = 0; i < all.length; i++) out.push(all[i]);
      return out;
    } catch (e) {
      return [];
    }
  }

  /** What the browser is following right now, shortened so it fits one log line. */
  function effectiveHref() {
    var live = iconLinks();
    if (live.length === 0) return '(no icon link)';
    var href = live[live.length - 1].getAttribute('href') || '';
    if (!href) return '(no href)';
    // ⚠ A drawn frame is reported by SIZE, never truncated: two truncated data URLs look
    // identical, which once made a working animation read as frozen in the site's log.
    return href.indexOf('data:') === 0 ? ('drawn-in-code (' + href.length + ' chars)') : href;
  }

  /**
   * Amazon's own favicon — captured before we parked anything, or the origin default if Relay
   * declares no icon link of its own.
   */
  function amazonHref() {
    if (originalHref) return originalHref;
    try { return location.origin + '/favicon.ico'; } catch (e) { return '/favicon.ico'; }
  }

  /** Remember Amazon's icon once, from the link the browser was actually using. */
  function captureOriginal() {
    if (originalHref) return;
    var live = iconLinks();
    for (var i = live.length - 1; i >= 0; i--) {
      if (live[i].id === OURS_ID) continue;
      var href = live[i].href || live[i].getAttribute('href');
      if (href) {
        originalHref = href;
        logger.log('tabIndicator', 'captured Amazon favicon', { href: href, links: live.length });
        return;
      }
    }
    logger.log('tabIndicator', 'Relay declares no icon link — falling back to the origin default', {
      fallback: amazonHref()
    });
  }

  /**
   * Our link — the one and only one this file writes to.
   * ⚠ LOOKED UP IN THE DOCUMENT BEFORE IT IS CREATED: a re-injected content script would otherwise
   * append a second one, and two of ours is the competing-links bug again.
   */
  function ourLink() {
    try {
      if (link && link.isConnected) return link;
      var found = document.getElementById(OURS_ID) || document.querySelector(OURS_SEL);
      if (found) { link = found; return link; }
      var el = document.createElement('link');
      el.id  = OURS_ID;
      el.rel = 'icon';
      el.setAttribute('data-ext-tab-indicator', 'true');
      document.head.appendChild(el);
      link = el;
      return link;
    } catch (e) {
      logger.error('tabIndicator', 'could not create our icon link', { error: e });
      return null;
    }
  }

  /**
   * Take every icon link that is not ours out of the running, and remember it.
   * ⚠ ONLY WHAT IS STILL IN THE DOCUMENT is remembered, and never twice: Relay's framework can
   * replace its own links, and restoring `rel` on a detached element is not a restoration.
   */
  function parkOthers() {
    try {
      var keep = [];
      for (var i = 0; i < parked.length; i++) if (parked[i].el.isConnected) keep.push(parked[i]);
      parked = keep;

      var live = iconLinks();
      for (var j = 0; j < live.length; j++) {
        var el = live[j];
        if (el === link || el.id === OURS_ID) continue;
        var seen = false;
        for (var k = 0; k < parked.length; k++) if (parked[k].el === el) { seen = true; break; }
        if (seen) continue;   // parking renames `rel`, so this cannot happen — belt and braces
        parked.push({ el: el, rel: el.getAttribute('rel') || 'icon' });
        el.setAttribute('rel', PARKED_REL);
      }
    } catch (e) {
      logger.error('tabIndicator', 'parkOthers failed', { error: e });
    }
  }

  /**
   * Watch <head> so a link Relay inserts between two icon writes is parked at once — while paused
   * nothing is writing, and a fresh icon link would otherwise sit live after ours.
   */
  function watchHead() {
    if (headWatch !== null || typeof MutationObserver === 'undefined') return;
    try {
      // ⚠ childList only: parking writes attributes, and observing those would feed itself.
      headWatch = new MutationObserver(function () { if (link !== null) parkOthers(); });
      headWatch.observe(document.head, { childList: true });
    } catch (e) {
      headWatch = null;
      logger.error('tabIndicator', 'head observer failed — a re-inserted Relay icon could win', { error: e });
    }
  }

  /**
   * 🔑 THE ONE WAY THE TAB ICON EVER CHANGES: an href write on our single live link.
   * Nothing here removes a link — see the 🔴 note at the top of the file.
   */
  function setIcon(href) {
    try {
      captureOriginal();
      var el = ourLink();
      if (!el) return;
      parkOthers();
      watchHead();
      // The blink and the sweep can ask for the frame they are already showing; don't write twice.
      if (el.getAttribute('href') !== href) el.setAttribute('href', href);
    } catch (e) {
      logger.error('tabIndicator', 'setIcon failed', { error: e });
    }
  }

  /* ── the timer ──────────────────────────────────────────────────────────────────────────────── */

  function stopAnimation() {
    animating = null;
    if (timer === null) return;
    try { clearInterval(timer); } catch (e) { /* ignore */ }
    timer = null;
  }

  /** Start (or keep) the animation for `state`. One timer serves both live states. */
  function startAnimation(state) {
    var wanted = state === 'searching' ? FRAME_MS : BLINK_MS;
    if (timer !== null && animating === state) return;
    stopAnimation();
    animating = state;

    if (state === 'searching') {
      if (!frames) {
        var built = [];
        for (var i = 0; i < FRAMES; i++) {
          var url = drawSearching(i / FRAMES);
          if (url) built.push(url);
        }
        frames = built.length > 0 ? built : null;
      }
    } else if (!blinkFrames) {
      var on  = drawAlert(false);
      var off = drawAlert(true);
      blinkFrames = (on && off) ? [on, off] : null;
    }

    var set = state === 'searching' ? frames : blinkFrames;
    if (!set) return;
    frame = 0;
    setIcon(set[0]);
    try {
      timer = setInterval(function () {
        var cur = animating === 'searching' ? frames : blinkFrames;
        if (!cur) return;
        frame = (frame + 1) % cur.length;
        setIcon(cur[frame]);
      }, wanted);
    } catch (e) {
      logger.error('tabIndicator', 'could not start the icon timer', { error: e });
    }
  }

  /* ── applying a state ───────────────────────────────────────────────────────────────────────── */

  function currentState() {
    return alertCount > 0 ? 'alert' : (searching ? 'searching' : 'idle');
  }

  function render() {
    try {
      if (typeof document === 'undefined') return;

      /*
       * Amazon owns its own title; we only ever prefix a count onto it.
       *
       * ⚠ THE BASE IS ADOPTED ONLY WHEN THE TITLE IS NOT OURS. Relay is a single-page app and
       * retitles itself on navigation, so a base captured once would be stale — but a base re-read
       * while OUR count is on the tab would swallow the count into the base and never let it go.
       * (Measured: the title stayed "(3) Relay | Load Board" for the rest of the session.) So:
       * capture once, and re-adopt only when what is on the tab is not what we last wrote.
       */
      if (baseTitle === null) baseTitle = document.title;
      else if (wroteTitle !== null && document.title !== wroteTitle) baseTitle = document.title;

      var state = currentState();
      // 🔑 THE COUNT, AND NOTHING ELSE. No glyph: the favicon already says which state this is.
      var next  = alertCount > 0 ? ('(' + alertCount + ') ' + baseTitle) : baseTitle;
      document.title = next;
      wroteTitle = next;

      if (state === 'idle') {
        stopAnimation();
        // 🔴 AMAZON'S OWN href, WRITTEN EXPLICITLY. Not a removal — that leaves the last icon we
        // loaded on the tab for as long as the page lives.
        setIcon(amazonHref());
      } else {
        startAnimation(state);
      }

      /*
       * ⚠ readBack IS TAKEN IMMEDIATELY. It separates "the write never happened" from "the write
       * happened and Relay's app undid it" — two different bugs that look identical from the tab
       * strip. Kept from the site's 2026-09-20 investigation.
       */
      logger.log('tabIndicator', 'tab-title-set', {
        wrote: next, baseTitle: baseTitle, readBack: document.title
      });

      if (state !== shown) {
        var live = iconLinks();
        var ours = 0;
        for (var i = 0; i < live.length; i++) if (live[i].id === OURS_ID) ours++;
        // The site's `tab-state` entry, field for field, plus the idle icon being Amazon's.
        logger.log('tabIndicator', 'tab-state', {
          state: state,
          favicon: state === 'idle' ? 'amazon-original'
            : (state === 'alert' ? 'alert-disc-blinking' : 'magnifier-sweep'),
          animated: state !== 'idle',
          frames: state === 'searching' ? (frames ? frames.length : 0) : (state === 'alert' ? 2 : 0),
          frameMs: state === 'searching' ? FRAME_MS : (state === 'alert' ? BLINK_MS : 0),
          count: alertCount,
          // 🔑 WHICH ICON THE BROWSER IS USING, READABLE FROM THE LOG ALONE. `liveIconLinks` must
          // be 1 and `ours` must be that one; anything else means a link slipped in after ours.
          liveIconLinks: live.length,
          ours: ours,
          effectiveHref: effectiveHref(),
          parkedLinks: parked.length,
          // ⚠ Empty by decision: the title carries no state glyph.
          glyph: ''
        });
        shown = state;
      }
    } catch (e) {
      logger.error('tabIndicator', 'render failed — the tab may be left mid-state', { error: e });
    }
  }

  /* ── the public surface ─────────────────────────────────────────────────────────────────────── */

  /** How many new loads are waiting. 0 clears the alert state. */
  function setAlertCount(count) {
    var n = (typeof count === 'number' && count > 0) ? Math.floor(count) : 0;
    if (alertCount === n) return;
    alertCount = n;
    render();
  }

  /** Whether the loop is running — the searching state. */
  function setSearching(on) {
    var next = on === true;
    if (searching === next) return;
    searching = next;
    render();
  }

  /**
   * Hand Amazon its tab back: its href on our link FIRST, then its own links unparked, then ours
   * removed and the title restored. For unload, for logout, and for the setting being switched off.
   *
   * ⚠ THE ORDER IS THE POINT. The tab is already showing Amazon's icon before the only link the
   * browser is following disappears.
   */
  function release() {
    alertCount = 0;
    searching  = false;
    stopAnimation();
    try {
      if (link || parked.length > 0) setIcon(amazonHref());
      for (var i = 0; i < parked.length; i++) {
        if (parked[i].el.isConnected) parked[i].el.setAttribute('rel', parked[i].rel);
      }
      parked = [];
      if (headWatch) { try { headWatch.disconnect(); } catch (e) { /* ignore */ } }
      headWatch = null;
      if (link) { try { link.remove(); } catch (e) { /* ignore */ } }
      link = null;
      if (baseTitle !== null && document.title !== baseTitle) document.title = baseTitle;
    } catch (e) {
      logger.error('tabIndicator', 'release failed — the tab may keep our icon until a navigation', { error: e });
    }
    if (shown !== null && shown !== 'idle') {
      var live = iconLinks();
      logger.log('tabIndicator', 'tab-state', {
        state: 'idle', favicon: 'amazon-original', animated: false, frames: 0, frameMs: 0, count: 0,
        // Amazon's own links are live again here — ours is gone, so `ours` is 0 by design.
        liveIconLinks: live.length, ours: 0, effectiveHref: effectiveHref(),
        parkedLinks: 0, glyph: ''
      });
    }
    shown      = null;
    baseTitle  = null;
    wroteTitle = null;
    frame      = 0;
  }

  return {
    setSearching: setSearching,
    setAlertCount: setAlertCount,
    currentState: currentState,
    release: release,
    // For the proof harness and for console work; not called by the extension itself.
    _effectiveHref: effectiveHref,
    _amazonHref: amazonHref
  };

})();
