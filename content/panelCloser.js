// panelCloser.js — closes the load-detail sheet, and collapses Amazon's left filters panel,
// when the loop starts.
// Called once per loop start from content.js (tabState 'running' subscriber, val=true).
// Uses each panel's own control (not CSS hiding) to avoid FOUC.
//
// Two allowed click sites — both authorized in docs/SAFETY.md:
//   CLOSE_DETAIL_PANEL: detail-sheet close control  (cannot trigger booking)
//   CLOSE_FILTER_PANEL: Amazon's Filter toggle      (cannot trigger booking)
//
// Both guarded by isForbiddenElement() before the click.
// If a panel is not open (element not found), logs and skips — never throws.

// Returns the load-detail sheet's close button, or null if the sheet is not open.
// The detail sheet has the stable ID #selected-work-sheet.
// Strategy 1: button[aria-label*="close" i] inside the sheet.
// Strategy 2: first icon-only button (SVG child, no text) inside the sheet.
// See AMAZON_SELECTORS.md → Detail panel close for selector rationale.
function findDetailCloseButton() {
  logger.log('panelCloser', 'findDetailCloseButton called');
  try {
    var sheet = document.querySelector('#selected-work-sheet');
    if (!sheet) return null;

    var sheetBtns = sheet.querySelectorAll('button[aria-label]');
    for (var i = 0; i < sheetBtns.length; i++) {
      if (sheetBtns[i].getAttribute('aria-label').toLowerCase().includes('close')) {
        return sheetBtns[i];
      }
    }

    // Strategy 2: collect ALL icon-only buttons (no text, has SVG child), then prefer
    // the one closest to the top of the sheet (within 80px of sheet.rect.top) — most likely
    // to be the close/X button. Fall back to the first candidate (previous behavior).
    var allSheetBtns = sheet.querySelectorAll('button');
    var candidates = [];
    for (var j = 0; j < allSheetBtns.length; j++) {
      var candidate = allSheetBtns[j];
      if (!candidate.textContent.trim() && candidate.querySelector('svg')) {
        candidates.push(candidate);
      }
    }
    if (candidates.length > 0) {
      var sheetRect = sheet.getBoundingClientRect();
      var topMatch  = null;
      var topMatchIdx = -1;
      for (var k = 0; k < candidates.length; k++) {
        var btnRect = candidates[k].getBoundingClientRect();
        if (btnRect.top - sheetRect.top <= 80) {
          topMatch    = candidates[k];
          topMatchIdx = k;
          break;
        }
      }
      if (topMatch) {
        logger.log('panelCloser', 'findDetailCloseButton: strategy 2 top-area match', {
          candidateIndex: topMatchIdx, totalCandidates: candidates.length
        });
        return topMatch;
      }
      logger.log('panelCloser', 'findDetailCloseButton: strategy 2 first-candidate fallback', {
        totalCandidates: candidates.length
      });
      return candidates[0];
    }

    return null;
  } catch (e) {
    logger.error('panelCloser', 'findDetailCloseButton failed', { error: e });
    return null;
  }
}

// Collapses Amazon's left filters panel. Called once per loop START only.
//
// STATE TEST IS PRESENCE, NOTHING ELSE (captured live 2026-08-05, same session, no reload):
//   panel OPEN      -> div.filters__column is present in the DOM
//   panel COLLAPSED -> div.filters__column is ABSENT entirely
// Amazon unmounts the panel rather than hiding it, so a single querySelector answers the
// question outright. If it is already gone we return without clicking — the button is a
// toggle, so clicking it then would OPEN the panel.
//
// Deliberately NOT used here, and none of it should come back:
//   - pixel measurement of any kind (widths, offsets, getBoundingClientRect, viewport) — this
//     runs on any monitor and any zoom level, so layout is not a reliable signal
//   - aria-expanded — the Filter button has none; its attributes are byte-identical in both
//     states (type="button" mdn-popover-offset="-9" class="css-14evw8c")
//   - click-then-verify — the previous implementation clicked, measured, and clicked a second
//     time to undo itself when it guessed wrong. That made the panel visibly flash open and
//     shut every time it was already collapsed. Presence removes the guess entirely.
//
// Synchronous, never throws, and never blocks START.
// Returns true only when this call actually collapsed an open panel.
function collapseFilterPanel() {
  logger.log('panelCloser', 'collapseFilterPanel called');
  try {
    // 1. Presence IS the state. Absent means already collapsed — do nothing, click nothing.
    var panel = document.querySelector('div.filters__column');
    if (!panel) {
      logger.log('panelCloser', 'filters panel already collapsed — nothing to do');
      return false;
    }

    // 2. Find the button. The aria-label sits on an inner <span role="img">, NOT on the
    // button, and carries trailing spaces ("Filter  ") on the live board — hence the trim
    // rather than an exact match. No dependency on the generated css-14evw8c hash.
    var icon = Array.prototype.find.call(
      document.querySelectorAll('[role="img"][aria-label]'),
      function (el) { return el.getAttribute('aria-label').trim() === 'Filter'; }
    );
    var btn = icon && icon.closest('button');
    if (!btn) {
      logger.warn('panelCloser', 'collapseFilterPanel: panel is open but Filter button not found — skipping', {
        iconFound: !!icon, labelledIcons: document.querySelectorAll('[role="img"][aria-label]').length
      });
      return false;
    }

    // 3. SAFETY gate — same check every other click site in this extension runs.
    if (isForbiddenElement(btn)) {
      logger.error('panelCloser', 'collapseFilterPanel: Filter button matched a forbidden selector — NOT clicking', {});
      return false;
    }

    // 4. Click. No verification pass: the presence test above already established the state.
    btn.click();
    logger.log('panelCloser', 'filters panel collapsed', {
      intent: ALLOWED_CLICK_INTENTS.CLOSE_FILTER_PANEL
    });
    return true;
  } catch (e) {
    logger.error('panelCloser', 'collapseFilterPanel threw', { error: e });
    return false;
  }
}

// Closes the load-detail sheet if it is currently open, and collapses the left filters panel.
// Called once per loop start (val === true only), so neither runs on stop, pause or resume.
function closePanelsForStart() {
  logger.log('panelCloser', 'closePanelsForStart called');
  // collapseFilterPanel is synchronous now (it was async while it waited on layout to settle)
  // and swallows its own errors. The try/catch is belt-and-braces so a filters-panel problem
  // can never stop the detail-sheet close below from running, or block START.
  try {
    collapseFilterPanel();
  } catch (e) {
    logger.error('panelCloser', 'collapseFilterPanel could not be invoked', { error: e });
  }
  try {
    var detailBtn = findDetailCloseButton();
    if (!detailBtn) {
      logger.log('panelCloser', 'detail panel not open or close button not found — skipping');
    } else if (isForbiddenElement(detailBtn)) {
      logger.error('panelCloser', 'detail close button matched a forbidden selector — skipping', {});
    } else {
      logger.log('panelCloser', 'closing detail panel', { intent: ALLOWED_CLICK_INTENTS.CLOSE_DETAIL_PANEL });
      detailBtn.click();
    }
  } catch (e) {
    logger.error('panelCloser', 'detail panel close threw', { error: e });
  }
}
