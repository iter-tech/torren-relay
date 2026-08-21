// Stage 13 — neutral-zone click to open load details.
// One of the three allowed Amazon-DOM click sites (neutral zone) — see docs/SAFETY.md (canonical).
// Target: inner element of div.load-card body, resolved via elementFromPoint
//         at a point biased left (30% width) to stay away from the Book button.
// isForbiddenElement() MUST return false on BOTH the card container AND the
// resolved target before any click is dispatched.
// NO booking. NO Layout B. ONE card per call only.
//
// 2026-08-20: the dispatch is a constructed MouseEvent carrying real coordinates, not a bare
// target.click() — .click() takes no arguments, so every synthetic click landed at (0,0),
// outside the target's own box. Still ONE click event, same gates, same intent.
// Caller (runDetectionPipeline) passes payout-sorted loads so newLoads[0] is always highest-paying.

// ── FAILURE 2 (measured 2026-08-20): the card had ZERO GEOMETRY at click time ──────────────
//
// CLICKDIAG on a failed auto-open:
//     C3 ZONE  distance from the CARD edges: top+0 bottom+0 left+0 right+0  (card is 0x0)
//     outcome: highlight=FALSE, panel=false — Amazon did not react either
//
// The element existed and was attached; it had simply not been laid out yet. A 0x0 box makes
// elementFromPoint(x, y) resolve whatever sits at the top-left corner of the viewport, and the
// click goes to that instead — which is why Amazon did not react. The 250 ms settle is a fixed
// guess and a fixed guess is sometimes wrong; nothing about it can be tuned into a guarantee.
//
// So: check for a real box, and if there is none, WAIT FOR ONE. Bounded — no unbounded loop, no
// longer fixed sleep. If the box never arrives, log it and give up cleanly rather than clicking
// into the void.
var AUTO_OPEN_LAYOUT_ATTEMPTS = 10;

// A real, laid-out box. Zero on either axis means "not laid out yet", which is exactly the
// measured failure. Also treats a missing element as no box rather than throwing.
function hasLayoutBox(el) {
  try {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch (e) {
    logger.error('detailOpener', 'hasLayoutBox failed — treating the element as unlaid-out so ' +
      'the click is deferred rather than sent into the void', { error: e });
    return false;
  }
}

// One retry step.
//
// ⚠ requestAnimationFrame IS SUSPENDED IN A BACKGROUND TAB. Ihor's measurement showed failures
// and successes in BOTH foreground and background tabs, so a pure-rAF retry would have converted
// "sometimes does not open" into "never opens, and logs nothing" for hidden tabs — a worse bug
// than the one being fixed. When the document is hidden we fall back to a short timer, which
// Chrome throttles but still runs.
function autoOpenNextFrame(fn) {
  logger.log('detailOpener', 'autoOpenNextFrame called');
  try {
    if (document.visibilityState !== 'hidden' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(fn);
      return;
    }
    setTimeout(fn, 16);
  } catch (e) {
    logger.error('detailOpener', 'autoOpenNextFrame failed — retrying on a timer instead', { error: e });
    try { setTimeout(fn, 16); } catch (e2) {
      logger.error('detailOpener', 'autoOpenNextFrame could not schedule a retry at all — the ' +
        'auto-open is abandoned, the loop stays stopped', { error: e2 });
    }
  }
}

// The centre of the element we actually intend to hit.
//
// ── THE COORDINATES (measured 2026-08-20) ────────────────────────────────────────────────
// All five attempts logged: click (0,0) ** OUTSIDE ** the innermost interactive element's box.
// Amazon tolerated it three times out of five.
//
// WHAT THE DISPATCH USED TO CONSTRUCT, read from the source before changing it: nothing. It was
// a bare `target.click()` — HTMLElement.click(), not a constructed event. That API takes no
// arguments, so clientX/clientY are 0 by definition and cannot be set. Getting coordinates onto
// the event therefore requires constructing a MouseEvent and dispatching it; there is no way to
// do it through .click().
//
// Still exactly ONE click event on ONE element, through the same gates, with the same intent —
// see docs/SAFETY.md Click 2. No pointerdown/mousedown/mouseup sequence was added.
function autoOpenPointIn(el) {
  logger.log('detailOpener', 'autoOpenPointIn called');
  try {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  } catch (e) {
    logger.error('detailOpener', 'autoOpenPointIn failed — dispatching without coordinates ' +
      'rather than not at all', { error: e });
    return { x: 0, y: 0, rect: null };
  }
}

// The neutral-zone click itself, re-attempted while the card has no box. Extracted from the
// setTimeout body below so the retry has something to call; every gate inside is the one that
// was already there.
function attemptNeutralZoneClick(load, el, attemptsLeft, scheduledAt, seqNo) {
  logger.log('detailOpener', 'attemptNeutralZoneClick called', {
    loadId: load.loadId, attemptsLeft: attemptsLeft
  });
  try {
    // Re-validate: React can detach the card during the 250ms scroll settle (e.g., filter change).
    // A detached element has a zero rect; elementFromPoint(0,0) would click a corner-of-viewport element.
    if (!document.contains(el)) {
      logger.warn('detailOpener', 'element detached during scroll settle — NOT clicking', { loadId: load.loadId });
      autoDiagBail(seqNo, load, 'the card was detached during the ' +
        (Date.now() - scheduledAt) + ' ms scroll settle');
      return;
    }

    // FAILURE 2 GATE. No box yet — do not dispatch into the void.
    if (!hasLayoutBox(el)) {
      if (attemptsLeft > 0) {
        logger.log('detailOpener', 'card has no layout box yet — deferring the click one frame', {
          loadId: load.loadId, attemptsLeft: attemptsLeft
        });
        autoOpenNextFrame(function () {
          attemptNeutralZoneClick(load, el, attemptsLeft - 1, scheduledAt, seqNo);
        });
        return;
      }
      logger.warn('detailOpener', 'card still has a 0x0 box after ' + AUTO_OPEN_LAYOUT_ATTEMPTS +
        ' frames — giving up cleanly rather than clicking an element with no box', {
          loadId: load.loadId
        });
      autoDiagBail(seqNo, load, 'the card still had a 0x0 box after ' + AUTO_OPEN_LAYOUT_ATTEMPTS +
        ' frames — no click was sent (measured failure 2)');
      return;
    }

    // Re-read rect after scroll has settled
    var r      = el.getBoundingClientRect();
    var x      = r.left + r.width  * 0.3;
    var y      = r.top  + r.height * 0.5;
    var target = document.elementFromPoint(x, y);

    // AUTODIAG: the point, and what the point resolved to BEFORE the fallback below can rewrite
    // it. Recorded, never acted on.
    load._autoDiagX = x; load._autoDiagY = y;
    var autoDiagResolved = target;

    if (!target) {
      logger.warn('detailOpener', 'elementFromPoint returned null — NOT clicking', {
        loadId: load.loadId, x: x, y: y
      });
      autoDiagBail(seqNo, load, 'elementFromPoint(' + Math.round(x) + ',' + Math.round(y) +
        ') returned null — the point was outside the viewport, so no click was sent');
      return;
    }

    // SAFETY: resolved target must not be a forbidden element
    if (isForbiddenElement(target)) {
      logger.error('detailOpener', 'BLOCKED: elementFromPoint resolved to a forbidden element — NOT clicking', {
        loadId: load.loadId, tagName: target.tagName, id: target.id
      });
      autoDiagBail(seqNo, load, 'the resolved target matched a FORBIDDEN selector');
      return;
    }

    // SAFETY: resolved target must be inside the card; fall back to card itself if not
    if (!el.contains(target) && target !== el) {
      logger.warn('detailOpener', 'resolved target outside card, falling back to card element', {
        loadId: load.loadId, targetTag: target.tagName
      });
      target = el;
    }

    // FAILURE 2 GATE, second half: the brief says verify THE TARGET has a non-zero box, not just
    // the card. A laid-out card can still resolve to a zero-box descendant, and dispatching at
    // its centre would compute coordinates from a rect that is a point.
    if (!hasLayoutBox(target)) {
      if (attemptsLeft > 0) {
        logger.log('detailOpener', 'resolved target has no layout box yet — deferring one frame', {
          loadId: load.loadId, attemptsLeft: attemptsLeft
        });
        autoOpenNextFrame(function () {
          attemptNeutralZoneClick(load, el, attemptsLeft - 1, scheduledAt, seqNo);
        });
        return;
      }
      logger.warn('detailOpener', 'resolved target still has a 0x0 box — giving up cleanly', {
        loadId: load.loadId
      });
      autoDiagBail(seqNo, load, 'the resolved target still had a 0x0 box after ' +
        AUTO_OPEN_LAYOUT_ATTEMPTS + ' frames — no click was sent');
      return;
    }

    // AUTODIAG: X1/X2/X3, computed and printed BEFORE the click so the block reads in dispatch
    // order. Nothing below re-resolves the target, changes the timing, or touches the guard.
    var autoDiagFellBack = (target === el && autoDiagResolved !== el);
    var autoDiagSnap = autoDiagBeforeClick(seqNo, load, el, target, autoDiagResolved,
      autoDiagFellBack, scheduledAt);
    _autoDiagEvent   = null;
    _autoDiagPending = { target: target, at: Date.now() };

    // ONE click on the resolved inner element (neutral zone). NOT a booking element.
    // Constructed rather than target.click() so it can carry the coordinates a real click has —
    // see autoOpenPointIn() for what the old dispatch built and why this is the only way.
    var pt = autoOpenPointIn(target);
    var ev = new MouseEvent('click', {
      view:       window,
      bubbles:    true,
      cancelable: true,
      composed:   true,
      detail:     1,          // a single click, as a real one reports
      clientX:    pt.x,
      clientY:    pt.y,
      screenX:    pt.x,
      screenY:    pt.y,
      button:     0,
      buttons:    0           // no button held DURING a click event — 0 is what a real click carries
    });
    target.dispatchEvent(ev);

    // AUTODIAG: dispatchEvent is SYNCHRONOUS, so the probe has already run and the pending flag
    // closes here — a real mouse click can never be mislabelled as ours.
    _autoDiagPending = null;
    autoDiagAfterClick(seqNo);

    logger.log('detailOpener', 'neutral zone click sent — details panel should open', {
      loadId: load.loadId,
      payout: load.payout,
      clientX: Math.round(pt.x),
      clientY: Math.round(pt.y)
    });

    // AUTODIAG: X4 at two checkpoints, because a background tab may be SLOW rather than broken.
    // Each prints its own ACTUAL elapsed time, since these timers are throttled exactly like the
    // 250 ms settle above.
    if (autoDiagSnap) {
      var autoDiagFiredAt = Date.now();
      setTimeout(function () { autoDiagOutcome(autoDiagSnap, 300,  autoDiagFiredAt, false); }, 300);
      setTimeout(function () { autoDiagOutcome(autoDiagSnap, 1000, autoDiagFiredAt, true);  }, 1000);
    }
  } catch (e) {
    logger.error('detailOpener', 'attemptNeutralZoneClick failed — no click was sent, the refresh ' +
      'loop stays stopped and Amazon is untouched', { error: e, loadId: load && load.loadId });
  }
}

function openTopNewLoad(newLoads) {
  logger.log('detailOpener', 'openTopNewLoad called', { newCount: newLoads ? newLoads.length : 0 });

  if (!newLoads || newLoads.length === 0) {
    logger.log('detailOpener', 'no new loads to open');
    return false;
  }

  var load = newLoads[0];
  var el   = load._element;

  // AUTODIAG: one sequence number per ATTEMPT, allocated here so the bail paths below and the
  // dispatch path share the same numbering. Diagnostic only — see the AUTODIAG block at the
  // bottom of this file.
  var autoDiagSeqNo = ++_autoDiagSeq;

  // Gate 1: element must exist
  if (!el) {
    logger.warn('detailOpener', 'top new load has no _element, NOT clicking', {
      loadId: load.loadId
    });
    autoDiagBail(autoDiagSeqNo, load, 'gate 1 — the load has no _element');
    return false;
  }

  // Gate 2: MANDATORY — isForbiddenElement must return false on the card container
  if (isForbiddenElement(el)) {
    logger.error('detailOpener', 'BLOCKED: target matched FORBIDDEN selector — NOT clicking', {
      loadId: load.loadId
    });
    autoDiagBail(autoDiagSeqNo, load, 'gate 2 — the card element matched a FORBIDDEN selector');
    return false;
  }

  // Gate 3: element must still be in the live DOM
  if (!document.contains(el)) {
    logger.warn('detailOpener', 'target element no longer in DOM, NOT clicking', {
      loadId: load.loadId
    });
    autoDiagBail(autoDiagSeqNo, load, 'gate 3 — the card element was no longer in the DOM');
    return false;
  }

  // All gates passed — declare intent before clicking
  logger.log('detailOpener', 'intent: ' + ALLOWED_CLICK_INTENTS.NEUTRAL_ZONE, {
    loadId: load.loadId,
    payout: load.payout
  });

  // Scroll the card into view so elementFromPoint can resolve a target,
  // then schedule the point-resolve + click after layout settles.
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (scrollErr) {
    logger.warn('detailOpener', 'scrollIntoView failed (ignored)', { error: scrollErr });
  }

  // AUTODIAG: when the settle timer was SCHEDULED. Compared against when it actually fires, which
  // is how background-tab timer throttling becomes a number instead of a suspicion.
  var autoDiagScheduledAt = Date.now();

  setTimeout(function () {
    attemptNeutralZoneClick(load, el, AUTO_OPEN_LAYOUT_ATTEMPTS, autoDiagScheduledAt, autoDiagSeqNo);
  }, 250);

  // Return true optimistically — the click is scheduled and will fire after scroll settles
  return true;
}

// Expose for manual console testing only — NOT called automatically.
window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.openTopNew = function () {
  var r = detectNewLoads(parseLoads());
  return openTopNewLoad(r.newLoads);
};


// ══════════════════════════════════════════════════════════════════════════════════════════
// AUTODIAG — why the AUTO-OPEN click sometimes does not open Amazon's detail sheet.
// DIAGNOSTIC ONLY, 2026-08-20. Ihor, live board: manual mouse clicks open the sheet every
// time; the programmatic click this file fires sometimes does not, especially — but not only —
// when the tab is in the BACKGROUND.
//
// NOTHING HERE CHANGES BEHAVIOUR. No target is re-resolved, no timing is altered, no gate is
// added or removed, and the stop-the-loop ordering (PLAN 7b, content.js) is untouched. Every
// value below is read from the same expressions the real path already uses.
//
// ⚠ THE PROBE IS PASSIVE. It listens in the CAPTURE phase and calls neither preventDefault nor
// stopPropagation, so it is invisible to every other handler — the same construction CLICKDIAG
// uses in inlinePanel.js. It reads the dispatched event's own properties rather than asserting
// what .click() produces, because a measurement is worth more here than a spec quotation.
//
// ⚠ IT PRINTS WITH console.log, NOT logger.log — deliberate, and a departure from CLICKDIAG.
// logger.log requires DEBUG_LEVEL >= 3 (utils/logger.js LOG_LEVEL_REQUIRED), so a CLICKDIAG-style
// diagnostic is SILENT in a stock build even with CITY_ASSIGN_DEBUG on. The gate that matters is
// CITY_ASSIGN_DEBUG, which ships false — so a stock build still prints nothing at all. Same
// reasoning as dumpTrailerLabels() in cityAssign.js.
//
// One block per auto-open attempt. Nothing per frame, nothing per tick.

var _autoDiagSeq     = 0;
var _autoDiagPending = null;   // non-null ONLY for the duration of one synchronous dispatch
var _autoDiagEvent   = null;   // properties of the real dispatched event, captured by the probe
var _autoDiagHistory = [];     // last attempts, so X5 can say what differed from a working one

function autoDiagEnabled() {
  return (typeof CITY_ASSIGN_DEBUG !== 'undefined') && CITY_ASSIGN_DEBUG;
}

function autoDiagSay(line) {
  if (!autoDiagEnabled()) return;
  try {
    console.log('[AUTODIAG] ' + line);
  } catch (e) {
    logger.error('detailOpener', 'autoDiagSay failed — diagnostics only, the auto-open path is ' +
      'unaffected', { error: e });
  }
}

// A node as one readable line. Reuses inlinePanel's describer when it is loaded so there is one
// format in practice; the fallback exists only because detailOpener.js is listed BEFORE
// inlinePanel.js in the manifest. Classes are PRINTED as evidence, never selected on.
function autoDiagDescribe(el) {
  try {
    if (typeof clickDiagDescribe === 'function') return clickDiagDescribe(el);
    if (!el || !el.tagName) return '(no element)';
    var cls = String(el.className || '');
    if (cls.length > 90) cls = cls.slice(0, 90) + '\u2026';
    return '<' + String(el.tagName).toLowerCase() + '>' + (el.id ? ' id=' + el.id : '') +
           (cls ? '  class="' + cls + '"' : '  (no class)');
  } catch (e) {
    logger.error('detailOpener', 'autoDiagDescribe failed — diagnostics only', { error: e });
    return '(describe failed)';
  }
}

// Hops from a descendant up to an ancestor. -1 when it is not an ancestor at all.
function autoDiagHops(from, to) {
  try {
    var node = from, hops = 0;
    while (node && hops < 30) {
      if (node === to) return hops;
      node = node.parentElement; hops++;
    }
    return -1;
  } catch (e) {
    logger.error('detailOpener', 'autoDiagHops failed — diagnostics only', { error: e });
    return -1;
  }
}

// Is this node inside OUR OWN UI? If elementFromPoint lands here, the point was covered by
// something we injected — which is one concrete way the card-container fallback below gets hit.
function autoDiagOurs(el) {
  try {
    if (!el || !el.closest) return null;
    var hit = el.closest('#ext-sidebar, #ext-origin-cities, #ext-inline-panel, #ext-pat-modal');
    return hit ? (hit.id || '(ext element)') : null;
  } catch (e) {
    logger.error('detailOpener', 'autoDiagOurs failed — diagnostics only', { error: e });
    return null;
  }
}

// The id Amazon currently shows as SELECTED on the board. Same expression CLICKDIAG C4 uses.
function autoDiagSelectedId() {
  try {
    var selEl   = document.querySelector('div.load-card__selected');
    var selIdEl = selEl ? selEl.querySelector('div[id]') : null;
    return { present: !!selEl, id: selIdEl ? selIdEl.id : null };
  } catch (e) {
    logger.error('detailOpener', 'autoDiagSelectedId failed — diagnostics only', { error: e });
    return { present: false, id: null };
  }
}

// Amazon's own detail sheet, via inlinePanel's reader when loaded (SHEET_SELECTOR lives there).
function autoDiagSheet() {
  try {
    if (typeof clickDiagSheetLoadId === 'function') return clickDiagSheetLoadId();
    return { present: false, id: null };
  } catch (e) {
    logger.error('detailOpener', 'autoDiagSheet failed — diagnostics only', { error: e });
    return { present: false, id: null };
  }
}

// X3 — the tab's state at one instant. Read at DISPATCH, not at schedule: a tab can be
// backgrounded during the 250 ms scroll settle, and that is exactly the window in question.
function autoDiagVisibility(el) {
  try {
    var vis   = document.visibilityState;
    var focus = document.hasFocus();
    var r     = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var vh    = window.innerHeight, vw = window.innerWidth;
    var fully = r ? (r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw) : false;
    var partly = r ? (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) : false;
    return {
      visibilityState: vis, hasFocus: focus, rect: r,
      inViewport: fully ? 'FULLY' : (partly ? 'PARTIALLY' : '** NOT AT ALL **'),
      viewport: vw + 'x' + vh
    };
  } catch (e) {
    logger.error('detailOpener', 'autoDiagVisibility failed — diagnostics only', { error: e });
    return { visibilityState: '?', hasFocus: null, rect: null, inViewport: '?', viewport: '?' };
  }
}

// The passive capture-phase probe. Registered once, only when the flag is on, so a stock build
// carries no extra listener at all. It fires DURING the dispatch — dispatchEvent runs
// synchronously — so the _autoDiagPending flag correlates exactly and can never mislabel a real
// mouse click as ours.
function autoDiagInstallProbe() {
  logger.log('detailOpener', 'autoDiagInstallProbe called');
  try {
    if (window.__extAutoDiagProbe) return;
    if (!autoDiagEnabled()) return;
    window.__extAutoDiagProbe = true;

    document.addEventListener('click', function (ev) {
      // READ ONLY. No preventDefault, no stopPropagation, no state written that anything else
      // reads. A capture-phase listener that does neither is invisible to every other handler.
      if (!_autoDiagPending) return;               // a real mouse click — not ours, ignore it
      try {
        _autoDiagEvent = {
          ctor:        (ev.constructor && ev.constructor.name) || '(unknown)',
          type:        ev.type,
          isTrusted:   ev.isTrusted,
          bubbles:     ev.bubbles,
          cancelable:  ev.cancelable,
          composed:    (typeof ev.composed === 'boolean') ? ev.composed : null,
          detail:      ev.detail,
          clientX:     ev.clientX,
          clientY:     ev.clientY,
          buttons:     (typeof ev.buttons === 'number') ? ev.buttons : null,
          pointerType: (typeof ev.pointerType === 'string') ? ev.pointerType : null,
          sameTarget:  ev.target === _autoDiagPending.target
        };
      } catch (e) {
        logger.error('detailOpener', 'AUTODIAG probe failed to read the event — diagnostics ' +
          'only, the click is unaffected', { error: e });
      }
    }, true);

    autoDiagSay('probe installed — passive, capture phase, no preventDefault, no stopPropagation');
  } catch (e) {
    logger.error('detailOpener', 'autoDiagInstallProbe failed — no diagnostics, the auto-open ' +
      'path is unaffected', { error: e });
  }
}

// An attempt that never reached the click at all. This is a DIFFERENT outcome from "clicked and
// Amazon ignored it", and without a line here it would look identical from the console.
function autoDiagBail(seq, load, reason) {
  logger.log('detailOpener', 'autoDiagBail called', { seq: seq, reason: reason });
  if (!autoDiagEnabled()) return;
  try {
    var v = autoDiagVisibility(load && load._element);
    autoDiagSay('#' + seq + ' \u2500\u2500\u2500\u2500\u2500 auto-open attempt: NO CLICK WAS SENT \u2500\u2500\u2500\u2500\u2500');
    autoDiagSay('#' + seq + ' X5 VERDICT   NOT OPENED \u2014 ** no click was dispatched ** \u2014 ' + reason);
    autoDiagSay('#' + seq + ' X3 VISIBLE   visibilityState=' + v.visibilityState +
      '  hasFocus=' + v.hasFocus + '  card in viewport: ' + v.inViewport);
    _autoDiagHistory.push({
      seq: seq, clicked: false, opened: false, reason: reason,
      visibilityState: v.visibilityState, hasFocus: v.hasFocus, inViewport: v.inViewport
    });
    if (_autoDiagHistory.length > 40) _autoDiagHistory.shift();
  } catch (e) {
    logger.error('detailOpener', 'autoDiagBail failed — diagnostics only', { error: e });
  }
}

// X1 + X2 + X3, printed immediately BEFORE the click so the block reads in dispatch order.
// Returns the snapshot the outcome checkpoints need. Never throws into the caller.
function autoDiagBeforeClick(seq, load, el, target, resolved, fellBack, scheduledAt) {
  logger.log('detailOpener', 'autoDiagBeforeClick called', { seq: seq });
  if (!autoDiagEnabled()) return null;
  try {
    // ── X2 is computed with the EXACT expression initManualToggle() uses (inlinePanel.js), not
    //    a paraphrase of it, so this reports what the guard will actually decide.
    var guardCard  = (target && target.closest)
      ? target.closest('div.load-card, div.load-card__selected') : null;
    var guardEarly = !!guardCard && target === guardCard;
    var registered = window.__extManualToggleInit === true;

    var v = autoDiagVisibility(el);
    var hopsToCard = guardCard ? autoDiagHops(target, guardCard) : -1;
    var hopsToEl   = autoDiagHops(target, el);
    // ⚠ RESOLVED, not target. By this point the fallback above may already have rewritten target
    // to the card element — and "what covered the point" is a question about what
    // elementFromPoint actually returned. Asking it of the post-fallback target answers nothing
    // and would hide the very cause this line exists to name. Caught by autodiag-suite.
    var ours       = autoDiagOurs(resolved);
    var lateness   = Date.now() - scheduledAt;

    autoDiagSay('#' + seq + ' \u2500\u2500\u2500\u2500\u2500 auto-open attempt  load=' + (load && load.loadId) + ' \u2500\u2500\u2500\u2500\u2500');

    // ── X1 WHAT WE DISPATCH ──
    autoDiagSay('#' + seq + ' X1 TARGET    ' + autoDiagDescribe(target));
    autoDiagSay('#' + seq + ' X1 WHERE     ' +
      (target === el
        ? '** THE CARD ELEMENT ITSELF ** (0 hops) \u2014 not a descendant'
        : 'a DESCENDANT, ' + (hopsToEl >= 0 ? hopsToEl + ' hop(s) below the card element' :
           '** NOT INSIDE THE CARD ELEMENT AT ALL **')) +
      '  |  target === div.load-card container: ' + (guardEarly ? '** YES **' : 'no') +
      (guardCard ? '  (' + (hopsToCard >= 0 ? hopsToCard + ' hop(s) up to it)' : 'not an ancestor)') : '  (no div.load-card ancestor)'));
    autoDiagSay('#' + seq + ' X1 RESOLVE   elementFromPoint(' + Math.round(load._autoDiagX) + ',' +
      Math.round(load._autoDiagY) + ') returned ' + autoDiagDescribe(resolved) +
      (fellBack
        ? '  ||  ** FELL BACK to the card element ** (detailOpener.js: resolved target was outside the card)'
        : '  ||  used as-is') +
      (ours ? '  ||  ** THE POINT WAS COVERED BY OUR OWN UI: ' + ours + ' **' : ''));
    autoDiagSay('#' + seq + ' X1 CARD?     load._element matches div.load-card/__selected: ' +
      ((el && el.matches && el.matches('div.load-card, div.load-card__selected')) ? 'yes' :
       '** NO \u2014 the parser also accepts div.wo-card-header--highlighted, and closest() would ' +
       'find no card for it **'));

    // ── X2 DID OUR GUARD SEE IT ──
    autoDiagSay('#' + seq + ' X2 GUARD     our handler registered: ' + (registered ? 'yes' : '** NO **') +
      '  |  it will run for this event: ' + (guardCard ? 'yes' : 'no \u2014 no div.load-card ancestor') +
      '  |  it returns early via the container-target guard: ' + (guardEarly ? '** YES **' : 'NO'));
    autoDiagSay('#' + seq + ' X2 REACH     \u26a0 the guard CANNOT swallow this click: initManualToggle() ' +
      'calls neither preventDefault nor stopPropagation anywhere, so Amazon receives the event ' +
      'either way. The guard only decides whether OUR panel renders.');

    // ── X3 TAB VISIBILITY ──
    autoDiagSay('#' + seq + ' X3 VISIBLE   visibilityState=' + v.visibilityState +
      '  hasFocus=' + v.hasFocus +
      '  |  card in viewport: ' + v.inViewport + ' (viewport ' + v.viewport + ')' +
      (v.rect ? '  rect[' + Math.round(v.rect.left) + ',' + Math.round(v.rect.top) + ' ' +
        Math.round(v.rect.width) + 'x' + Math.round(v.rect.height) + ']' : '') +
      '  |  card box: ' + (hasLayoutBox(el) ? 'laid out' : '** 0x0, NOT LAID OUT **') +
      '  |  target box: ' + (hasLayoutBox(target) ? 'laid out' : '** 0x0 **'));
    autoDiagSay('#' + seq + ' X3 TIMER     the 250 ms settle actually fired ' + lateness + ' ms after it ' +
      'was scheduled' + (lateness > 900
        ? '  ** LATE \u2014 consistent with background-tab timer throttling (Chrome clamps to >=1 s, ' +
          'and to >=60 s under intensive throttling) **'
        : '  (on time)'));

    return {
      seq: seq, loadId: load && load.loadId, cardRef: guardCard || el,
      classesBefore: String((guardCard || el) && (guardCard || el).className || ''),
      sheetBefore: autoDiagSheet(), selBefore: autoDiagSelectedId(),
      guardEarly: guardEarly, targetWasContainer: (target === el) || guardEarly,
      fellBack: fellBack, ours: ours, lateness: lateness,
      visibilityState: v.visibilityState, hasFocus: v.hasFocus, inViewport: v.inViewport
    };
  } catch (e) {
    logger.error('detailOpener', 'autoDiagBeforeClick failed — diagnostics only, the click is ' +
      'unaffected', { error: e, seq: seq });
    return null;
  }
}

// The one line that has to be right: what the dispatched event ACTUALLY was. Read from the probe,
// not asserted from the spec.
function autoDiagAfterClick(seq) {
  logger.log('detailOpener', 'autoDiagAfterClick called', { seq: seq });
  if (!autoDiagEnabled()) return;
  try {
    var e = _autoDiagEvent;
    if (!e) {
      autoDiagSay('#' + seq + ' X1 EVENT     ** THE PROBE SAW NOTHING ** \u2014 the click event never ' +
        'reached document in the capture phase. That alone would explain a sheet that does not open.');
      return;
    }
    autoDiagSay('#' + seq + ' X1 EVENT     ' + e.ctor + ' type=' + e.type +
      '  isTrusted=' + e.isTrusted + '  bubbles=' + e.bubbles + '  cancelable=' + e.cancelable +
      '  composed=' + e.composed + '  detail=' + e.detail +
      '  client=(' + e.clientX + ',' + e.clientY + ')' +
      '  buttons=' + e.buttons + '  pointerType=' + e.pointerType +
      '  |  dispatched as a constructed MouseEvent (was HTMLElement.click() until 2026-08-20, ' +
      'which cannot carry coordinates) \u2014 still ONE click event, with NO preceding ' +
      'pointerdown/mousedown/pointerup/mouseup and no focus change');
  } catch (err) {
    logger.error('detailOpener', 'autoDiagAfterClick failed — diagnostics only', { error: err, seq: seq });
  }
}

// X4 — the outcome, twice. The ELAPSED time is printed rather than the nominal one, because these
// timers are throttled in a background tab exactly like the 250 ms settle is.
function autoDiagOutcome(snap, nominalMs, firedAt, isLast) {
  logger.log('detailOpener', 'autoDiagOutcome called', { seq: snap && snap.seq, nominalMs: nominalMs });
  if (!autoDiagEnabled() || !snap) return;
  try {
    var added = [];
    if (snap.cardRef) {
      var before = snap.classesBefore.split(/\s+/);
      var after  = String(snap.cardRef.className || '').split(/\s+/);
      for (var a = 0; a < after.length; a++) {
        if (after[a] && before.indexOf(after[a]) === -1) added.push(after[a]);
      }
    }
    var selAfter   = autoDiagSelectedId();
    var sheetAfter = autoDiagSheet();
    var panel      = document.getElementById('ext-inline-panel');

    var selectedIsOurs = selAfter.id !== null && selAfter.id === snap.loadId;
    var sheetChanged   = snap.sheetBefore.id !== sheetAfter.id;
    var sheetIsOurs    = sheetAfter.id !== null && sheetAfter.id === snap.loadId;
    var opened         = selectedIsOurs || sheetIsOurs;

    autoDiagSay('#' + snap.seq + ' X4 +' + nominalMs + 'ms   (actually ' + (Date.now() - firedAt) +
      ' ms later)  |  card gained a class: ' + (added.length ? 'YES [' + added.join(' ') + ']' : 'no') +
      '  |  Amazon sheet id: ' + (snap.sheetBefore.id || (snap.sheetBefore.present ? 'no UUID readable' : 'no sheet')) +
      ' -> ' + (sheetAfter.id || (sheetAfter.present ? 'no UUID readable' : 'no sheet')) +
      (sheetChanged ? ' (CHANGED)' : ' (unchanged)') +
      '  |  board selection: ' + (selAfter.id || 'NONE') +
      (selectedIsOurs ? ' == our load' : (selAfter.id ? ' ** a DIFFERENT load **' : '')) +
      '  |  our panel: ' + (panel ? 'YES' : 'no (expected \u2014 Stage C was never done)'));

    if (!isLast) return;

    // ── X5 VERDICT, once, at the last checkpoint ──
    var rec = {
      seq: snap.seq, clicked: true, opened: opened,
      targetWasContainer: snap.targetWasContainer, guardEarly: snap.guardEarly,
      fellBack: snap.fellBack, ours: snap.ours, lateness: snap.lateness,
      visibilityState: snap.visibilityState, hasFocus: snap.hasFocus, inViewport: snap.inViewport
    };
    var lastGood = null;
    for (var i = _autoDiagHistory.length - 1; i >= 0; i--) {
      if (_autoDiagHistory[i].opened) { lastGood = _autoDiagHistory[i]; break; }
    }
    var diffs = [];
    if (lastGood && !opened) {
      if (rec.targetWasContainer !== lastGood.targetWasContainer)
        diffs.push('X2 target-was-container ' + lastGood.targetWasContainer + ' -> ' + rec.targetWasContainer);
      if (rec.guardEarly !== lastGood.guardEarly)
        diffs.push('X2 guard-returned-early ' + lastGood.guardEarly + ' -> ' + rec.guardEarly);
      if (rec.fellBack !== lastGood.fellBack)
        diffs.push('X1 fell-back-to-card ' + lastGood.fellBack + ' -> ' + rec.fellBack);
      if (rec.visibilityState !== lastGood.visibilityState)
        diffs.push('X3 visibilityState ' + lastGood.visibilityState + ' -> ' + rec.visibilityState);
      if (rec.hasFocus !== lastGood.hasFocus)
        diffs.push('X3 hasFocus ' + lastGood.hasFocus + ' -> ' + rec.hasFocus);
      if (rec.inViewport !== lastGood.inViewport)
        diffs.push('X3 inViewport ' + lastGood.inViewport + ' -> ' + rec.inViewport);
      if ((rec.lateness > 900) !== (lastGood.lateness > 900))
        diffs.push('X3 timer-throttled ' + (lastGood.lateness > 900) + ' -> ' + (rec.lateness > 900) +
          ' (' + lastGood.lateness + 'ms -> ' + rec.lateness + 'ms)');
    }

    autoDiagSay('#' + snap.seq + ' X5 VERDICT   ' + (opened ? 'OPENED' : '** NOT OPENED **') +
      '  |  load=' + snap.loadId +
      '  |  ' + (opened
        ? 'nothing to compare \u2014 this one worked'
        : (!lastGood
            ? 'no successful attempt recorded yet in this tab, so nothing to compare against'
            : (diffs.length
                ? 'differs from the last OPENED attempt (#' + lastGood.seq + ') in: ' + diffs.join('  ||  ')
                : '** IDENTICAL on every X2 and X3 dimension to the last OPENED attempt (#' +
                  lastGood.seq + ') ** \u2014 neither the guard nor tab visibility explains this one'))));

    _autoDiagHistory.push(rec);
    if (_autoDiagHistory.length > 40) _autoDiagHistory.shift();
  } catch (e) {
    logger.error('detailOpener', 'autoDiagOutcome failed — diagnostics only', { error: e });
  }
}

// One compact table of everything this tab has seen, for Ihor to copy back in a single block.
function dumpAutoOpenDiag() {
  try {
    if (!autoDiagEnabled()) {
      console.log('[AUTODIAG] CITY_ASSIGN_DEBUG is off — nothing was recorded.');
      return [];
    }
    console.log('[AUTODIAG] ' + _autoDiagHistory.length + ' auto-open attempt(s) in this tab:');
    console.table(_autoDiagHistory.map(function (r) {
      return {
        '#': r.seq,
        clicked: r.clicked,
        OPENED: r.opened,
        'target=container': r.targetWasContainer,
        'guard early': r.guardEarly,
        'fell back': r.fellBack,
        'covered by ours': r.ours || '',
        visibility: r.visibilityState,
        hasFocus: r.hasFocus,
        'in viewport': r.inViewport,
        'timer late ms': r.lateness,
        reason: r.reason || ''
      };
    }));
    return _autoDiagHistory;
  } catch (e) {
    logger.error('detailOpener', 'dumpAutoOpenDiag failed — diagnostics only', { error: e });
    return [];
  }
}

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.dumpAutoOpenDiag = dumpAutoOpenDiag;

autoDiagInstallProbe();
